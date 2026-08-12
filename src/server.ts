import express from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { archiveAsset, cleanupUploadedTemp, defaultProduct, deleteObjectGuarded, ensureUploadDir, isLineageAssetError, listAssets, listProjects, localPreviewPath, packageRoot, presignAsset, pullAsset, promoteAsset, uploadAsset, updatePlacement } from './server/assetCore';
import { isAssetLookupError, lookupAssets } from './server/assetLookup';
import {
  clearLineageRerollRequest,
  getLineageAttempts,
  getLineageChildren,
  getLineageNextAsset,
  getLineageSnapshot,
  indexLineageAssets,
  isLineageError,
  linkLineageAssets,
  listLineageRerollRequests,
  markLineageRerollRequest,
  promoteLineageAttempt,
  updateAssetReview,
  updateLineageEdgeSummary,
  updateLineageLayout,
  updateSelectedAsset,
} from './server/assetLineage';
import { getLineageBrief, linkSelectedLineageChild } from './server/assetLineageHandoff';
import { removeLineageNode } from './server/assetLineageRemove';
import { registerSocialMarkRoutes } from './server/social/socialRoutes';
import { isLineageTaskError } from './server/assetLineageTasks';
import { isLineageWorkspaceError } from './server/assetLineageWorkspaces';
import { lineageDb } from './server/assetLineageDb';
import { getLedgerPageFromQuery } from './server/assetLedgerApi';
import { isAssetReviewError, markAssetReview, markAssetReviewsFromRequestBody, requireApprovedLocalBackupPath, withLocalReviewMetadata } from './server/assetReviews';
import { getReviewQueue } from './server/assetReviewQueue';
import { isAssetReviewSetError } from './server/assetReviewSets';
import { assetSelectionRouter, isAssetSelectionError } from './server/assetSelections';
import { isAgentClaimError } from './server/agentClaims';
import { claimTokenFromRequest, registerAgentClaimRoutes } from './server/agentClaimRoutes';
import { registerAdapterRoutes } from './server/adapters/adapterRoutes';
import { isAdapterSettingsError } from './server/adapters/adapterSettings';
import { isPostingAdapterError } from './server/adapters/posting/bufferPostingService';
import { isBufferConnectionError } from './server/adapters/buffer/bufferConnection';
import { registerBufferRoutes } from './server/adapters/buffer/bufferRoutes';
import { handleBufferRuntimeServerError } from './server/adapters/buffer/bufferRuntime';
import { contentBatchRouter } from './server/contentBatchRoutes';
import { isContentBatchError } from './server/contentBatches';
import { listImageGenerationJobs } from './server/generationReceiptJobs';
import { isGenerationReceiptError } from './server/generationReceipts';
import { registerGenerationTargetRoutes } from './server/generationTargetRoutes';
import { registerLineageTaskRoutes } from './server/lineageTaskRoutes';
import { registerLineageWorkspaceRoutes } from './server/lineageWorkspaceRoutes';
import { assertLineageCodeOrigin, getLineageRuntimeInfo, normalizeRuntimeChannel } from './server/runtimeInfo';
import { assertResolvedRuntimeProfileEnvironment, assertRuntimeProfileSafety, assertUnselectedDatabaseIsUnbound, doctorLineageProfile } from './server/lineageProfiles';
import { isManagedWriterRoutingError, registerManagedWriterRoute } from './server/managedWriterRouting';
import { acquireProfileWriterLease } from './server/profileWriterLease';
import { executeDelegatedLineageMutation, lineageCliCanDelegateMutation } from './cli/lineageCli';
import type { ResolvedLineageProfile } from './shared/lineageProfileTypes';
import { OutputTargetResolutionError } from './shared/outputTargetTypes';
import type { AssetContentType, AssetReviewState, PlacementFields, PlacementStatus, UploadFields } from './shared/types';
const runtimeChannel = normalizeRuntimeChannel(process.env.LINEAGE_CHANNEL || process.env.LINEAGE_RELEASE_CHANNEL);
const startupCode = assertLineageCodeOrigin(runtimeChannel);
assertRuntimeProfileSafety(runtimeChannel);
const startupRuntime = getLineageRuntimeInfo({ channel: runtimeChannel, code: startupCode });
if (!process.env.LINEAGE_PROFILE) {
  if (process.env.LINEAGE_ALLOW_UNBOUND_DIAGNOSTIC !== '1') {
    throw new Error('Lineage server startup requires a named profile. Use a channel launcher with start --profile <id>, or use `npm run dev -- --profile <id>` for hot reload. Set LINEAGE_ALLOW_UNBOUND_DIAGNOSTIC=1 only for an explicit read-only diagnostic server.');
  }
  assertUnselectedDatabaseIsUnbound(startupRuntime);
}
let startupProfile: ResolvedLineageProfile | undefined;
if (process.env.LINEAGE_PROFILE) {
  if (!process.env.LINEAGE_PROFILE_ID || !process.env.LINEAGE_PROFILE_ENVIRONMENT || !process.env.LINEAGE_PROFILE_MANIFEST) {
    throw new Error('LINEAGE_PROFILE must be resolved by the Lineage CLI before server startup; use lineage start --profile or lineage-dev start --profile');
  }
  const doctor = doctorLineageProfile(process.env.LINEAGE_PROFILE, {
    channel: runtimeChannel,
    code: startupRuntime.code,
    gitSha: startupRuntime.git_sha,
    version: startupRuntime.version,
  });
  if (!doctor.ok) {
    const failures = doctor.checks.filter(check => check.status === 'fail').map(check => `${check.id}: ${check.message}`).join('; ');
    throw new Error(`Configured Lineage profile failed doctor: ${failures}`);
  }
  assertResolvedRuntimeProfileEnvironment(doctor.profile!);
  startupProfile = doctor.profile!;
}
const writerLease = startupProfile ? acquireProfileWriterLease(startupProfile, runtimeChannel, 'service') : undefined;
if (startupProfile) delete process.env.LINEAGE_DB_ACCESS;
else process.env.LINEAGE_DB_ACCESS = 'read-only';
if (writerLease) {
  try {
    const startupDatabase = lineageDb();
    startupDatabase.close();
  } catch (error) {
    writerLease.release();
    throw error;
  }
}
const app = express();
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || 'lineage.localhost';
const isProduction = process.env.NODE_ENV === 'production';
const maxUploadBytes = Number(process.env.LINEAGE_MAX_UPLOAD_MB || 200) * 1024 * 1024;
const upload = multer({
  limits: { fileSize: maxUploadBytes },
  storage: startupProfile
    ? multer.diskStorage({ destination: ensureUploadDir() })
    : multer.memoryStorage(),
});
app.use(express.json({ limit: '1mb' }));
registerManagedWriterRoute(app, {
  accepts: lineageCliCanDelegateMutation,
  channel: runtimeChannel,
  execute: executeDelegatedLineageMutation,
  profile: startupProfile,
  writerLease,
});
app.use((req, res, next) => {
  if (startupProfile || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.status(409).json({
    error: 'profile_required',
    message: 'Persistent writes require a selected named Lineage profile; legacy-unbound service access is read-only. Create a fresh profile with `profile init --profile <id> --confirm-write`, then start with that profile.',
  });
});
function projectFrom(input: { body?: Record<string, unknown>; query?: Record<string, unknown> }): string {
  const candidate = input.body?.project || input.body?.product || input.query?.project || input.query?.product;
  return typeof candidate === 'string' ? candidate : defaultProduct;
}

function asyncRoute(handler: (req: express.Request, res: express.Response) => Promise<void> | void): express.RequestHandler {
  return (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); };
}
app.get('/api/projects', asyncRoute((_req, res) => { res.json({ projects: listProjects() }); }));
app.get('/api/runtime', asyncRoute((_req, res) => {
  res.json({ ok: true, runtime: getLineageRuntimeInfo({ channel: runtimeChannel, code: startupCode }) });
}));
app.get(
  '/api/assets',
  asyncRoute((req, res) => {
    const project = projectFrom(req);
    const snapshot = listAssets(project, {
      audience: typeof req.query.audience === 'string' ? req.query.audience : undefined,
      campaign: typeof req.query.campaign === 'string' ? req.query.campaign : undefined,
      channel: typeof req.query.channel === 'string' ? req.query.channel : undefined,
      includeLive: req.query.live === 'true',
      page: Number(req.query.page || 1),
      pageSize: Number(req.query.pageSize || 10),
      placementStatus: typeof req.query.placementStatus === 'string' ? req.query.placementStatus : undefined,
      query: typeof req.query.q === 'string' ? req.query.q : undefined,
      source: typeof req.query.source === 'string' ? req.query.source : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
    });
    res.json(withLocalReviewMetadata(project, snapshot));
  })
);
app.get('/api/ledger', asyncRoute((req, res) => { res.json(getLedgerPageFromQuery(projectFrom(req), req.query)); }));
app.post('/api/assets/lookup', asyncRoute((req, res) => { res.json(lookupAssets(projectFrom(req), Array.isArray(req.body.assetIds) ? req.body.assetIds.map(String) : [])); }));
registerAdapterRoutes(app, projectFrom, asyncRoute);
registerBufferRoutes(app, projectFrom, asyncRoute);
registerAgentClaimRoutes(app, projectFrom, asyncRoute);
app.use('/api/content', contentBatchRouter(projectFrom));
app.use('/api/selections', assetSelectionRouter(projectFrom));
app.get('/api/generation/jobs', asyncRoute((req, res) => { res.json(listImageGenerationJobs(projectFrom(req), { assetId: typeof req.query.assetId === 'string' ? req.query.assetId : undefined, rootAssetId: typeof req.query.rootAssetId === 'string' ? req.query.rootAssetId : undefined, limit: Number(req.query.limit || 12) })); }));
registerGenerationTargetRoutes(app, projectFrom, asyncRoute);
app.get(
  '/api/review/queue',
  asyncRoute((req, res) => {
    res.json(
      getReviewQueue(projectFrom(req), {
        channel: typeof req.query.channel === 'string' ? req.query.channel : undefined,
        limit: Number(req.query.limit || 6),
      })
    );
  })
);

app.get(
  '/api/assets/local-preview',
  asyncRoute((req, res) => {
    if (typeof req.query.path !== 'string') {
      res.status(400).json({ error: 'Local preview requires path' });
      return;
    }
    res.sendFile(localPreviewPath(req.query.path));
  })
);

app.post(
  '/api/index/local',
  asyncRoute((req, res) => {
    res.json({ ok: true, command: 'index local', project: projectFrom(req), summary: indexLineageAssets(projectFrom(req)) });
  })
);

app.get(
  '/api/lineage/:assetId/next',
  asyncRoute((req, res) => {
    res.json(getLineageNextAsset(projectFrom(req), req.params.assetId));
  })
);

app.get(
  '/api/lineage/:assetId/brief',
  asyncRoute((req, res) => {
    res.json(getLineageBrief(projectFrom(req), req.params.assetId));
  })
);

app.get(
  '/api/lineage/:assetId/children',
  asyncRoute((req, res) => {
    res.json(getLineageChildren(projectFrom(req), req.params.assetId));
  })
);

registerLineageWorkspaceRoutes(app, projectFrom, asyncRoute);
registerLineageTaskRoutes(app, projectFrom, asyncRoute);
registerSocialMarkRoutes(app, projectFrom, asyncRoute);

app.get('/api/lineage/:rootAssetId/rerolls', asyncRoute((req, res) => {
  res.json(listLineageRerollRequests(projectFrom(req), req.params.rootAssetId));
}));

app.post('/api/lineage/:rootAssetId/rerolls/:nodeAssetId', asyncRoute((req, res) => {
  res.json(markLineageRerollRequest(projectFrom(req), {
    rootAssetId: req.params.rootAssetId,
    nodeAssetId: req.params.nodeAssetId,
    notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
    requestedBy: req.body.requestedBy === 'agent' || req.body.requestedBy === 'system' ? req.body.requestedBy : 'human',
    confirmWrite: req.body.confirmWrite === true,
  }));
}));

app.post('/api/lineage/:rootAssetId/rerolls/:nodeAssetId/cancel', asyncRoute((req, res) => {
  res.json(clearLineageRerollRequest(projectFrom(req), {
    rootAssetId: req.params.rootAssetId,
    nodeAssetId: req.params.nodeAssetId,
    confirmWrite: req.body.confirmWrite === true,
  }));
}));

app.get('/api/lineage/:rootAssetId/attempts/:nodeAssetId', asyncRoute((req, res) => {
  res.json(getLineageAttempts(projectFrom(req), req.params.rootAssetId, req.params.nodeAssetId));
}));

app.post('/api/lineage/:rootAssetId/attempts/:nodeAssetId/promote', asyncRoute((req, res) => {
  res.json(promoteLineageAttempt(projectFrom(req), {
    rootAssetId: req.params.rootAssetId,
    nodeAssetId: req.params.nodeAssetId,
    attemptId: String(req.body.attemptId || ''),
    confirmWrite: req.body.confirmWrite === true,
  }));
}));

app.get('/api/lineage/:assetId', asyncRoute((req, res) => { res.json(getLineageSnapshot(projectFrom(req), req.params.assetId)); }));

app.post(
  '/api/lineage/link',
  asyncRoute((req, res) => {
    res.json(
      linkLineageAssets(projectFrom(req), {
        parentAssetId: String(req.body.parentAssetId || ''),
        childAssetId: String(req.body.childAssetId || ''),
        confirmWrite: req.body.confirmWrite === true,
        claimToken: claimTokenFromRequest(req),
      })
    );
  })
);

app.post('/api/lineage/edges/:edgeId/summary', asyncRoute((req, res) => {
  res.json(updateLineageEdgeSummary(projectFrom(req), {
    edgeId: req.params.edgeId,
    action: req.body.action,
    summary: req.body.summary,
    expectedSummaryUpdatedAt: req.body.expectedSummaryUpdatedAt,
    confirmWrite: req.body.confirmWrite === true,
    claimToken: claimTokenFromRequest(req),
  }));
}));

app.post('/api/lineage/remove-node', asyncRoute((req, res) => {
  res.json(removeLineageNode(projectFrom(req), { assetId: String(req.body.assetId || ''), rootAssetId: typeof req.body.rootAssetId === 'string' ? req.body.rootAssetId : undefined, confirmWrite: req.body.confirmWrite === true, claimToken: claimTokenFromRequest(req) }));
}));

app.post(
  '/api/lineage/layout',
  asyncRoute((req, res) => {
    const positions = (Array.isArray(req.body.positions) ? req.body.positions : []) as Array<Record<string, unknown>>;
    res.json(
      updateLineageLayout(projectFrom(req), {
        rootAssetId: String(req.body.rootAssetId || ''),
        positions: positions.map(position => ({
          assetId: String(position.assetId || ''),
          x: Number(position.x),
          y: Number(position.y),
        })),
        confirmWrite: req.body.confirmWrite === true,
        claimToken: claimTokenFromRequest(req),
      })
    );
  })
);

app.post(
  '/api/lineage/link-child',
  asyncRoute((req, res) => {
    res.json(
      linkSelectedLineageChild(projectFrom(req), {
        rootAssetId: typeof req.body.rootAssetId === 'string' ? req.body.rootAssetId : undefined,
        childAssetId: String(req.body.childAssetId || ''),
        confirmWrite: req.body.confirmWrite === true,
        claimToken: claimTokenFromRequest(req),
      })
    );
  })
);

app.post(
  '/api/selection',
  asyncRoute((req, res) => {
    res.json(
      updateSelectedAsset(projectFrom(req), {
        assetId: typeof req.body.assetId === 'string' ? req.body.assetId : undefined,
        assetIds: Array.isArray(req.body.assetIds) ? req.body.assetIds.map(String) : undefined,
        rootAssetId: typeof req.body.rootAssetId === 'string' ? req.body.rootAssetId : undefined,
        clear: req.body.clear === true,
        maxSelections: typeof req.body.maxSelections === 'number' ? req.body.maxSelections : undefined,
        mode: req.body.mode === 'add' || req.body.mode === 'remove' || req.body.mode === 'toggle' || req.body.mode === 'replace' ? req.body.mode : undefined,
        notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
        confirmWrite: req.body.confirmWrite === true,
      })
    );
  })
);

app.post(
  '/api/reviews/:assetId',
  asyncRoute((req, res) => {
    res.json(
      updateAssetReview(projectFrom(req), {
        assetId: req.params.assetId,
        reviewState: String(req.body.reviewState || 'unreviewed') as AssetReviewState,
        notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
        confirmWrite: req.body.confirmWrite === true,
      })
    );
  })
);

app.post(
  '/api/local-review/batch',
  asyncRoute((req, res) => {
    res.json(markAssetReviewsFromRequestBody(projectFrom(req), req.body as Record<string, unknown>));
  })
);

app.post(
  '/api/local-review/:assetId',
  asyncRoute((req, res) => {
    const rawState = String(req.body.reviewState || req.body.state || 'unreviewed');
    res.json(
      markAssetReview(projectFrom(req), {
        assetId: req.params.assetId,
        reviewState: rawState.replace(/-/g, '_') as AssetReviewState,
        notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
        confirmWrite: req.body.confirmWrite === true,
      })
    );
  })
);

app.post(
  '/api/assets/presign',
  asyncRoute((req, res) => {
    res.json(presignAsset(projectFrom(req), req.body.assetId, Number(req.body.expiresIn || 900)));
  })
);

app.post(
  '/api/assets/promote',
  asyncRoute((req, res) => {
    res.json(promoteAsset(projectFrom(req), req.body.assetId, Boolean(req.body.confirmWrite)));
  })
);

app.post(
  '/api/assets/pull',
  asyncRoute((req, res) => {
    res.json(pullAsset(projectFrom(req), req.body.assetId, typeof req.body.out === 'string' ? req.body.out : '.asset-scratch'));
  })
);

app.post(
  '/api/assets/archive',
  asyncRoute((req, res) => {
    res.json(archiveAsset(projectFrom(req), req.body.assetId, Boolean(req.body.confirmArchive)));
  })
);

app.post(
  '/api/assets/placement',
  asyncRoute((req, res) => {
    const body = req.body as Record<string, string | boolean>;
    const fields: PlacementFields = {
      assetId: String(body.assetId || ''),
      channel: String(body.channel || ''),
      status: String(body.status || 'planned') as PlacementStatus,
      scheduledAt: typeof body.scheduledAt === 'string' ? body.scheduledAt : undefined,
      postedAt: typeof body.postedAt === 'string' ? body.postedAt : undefined,
      url: typeof body.url === 'string' ? body.url : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      confirmWrite: body.confirmWrite === true,
    };
    res.json(updatePlacement(projectFrom(req), fields));
  })
);

app.post(
  '/api/assets/delete-object',
  asyncRoute((req, res) => {
    res.json(deleteObjectGuarded(projectFrom(req), req.body.assetId, req.body.confirmation || ''));
  })
);

app.post(
  '/api/assets/upload',
  upload.single('file'),
  asyncRoute((req, res) => {
    const file = req.file?.path;
    try {
      if (!file) throw new Error('Upload requires a file');
      const body = req.body as Record<string, string>;
      const fields: UploadFields = {
        project: body.project || body.product || defaultProduct,
        campaign: body.campaign,
        channel: body.channel,
        audience: body.audience,
        status: body.status === 'published' ? 'published' : 'working',
        type: (body.type || 'image') as AssetContentType,
        assetId: body.assetId,
        title: body.title,
        hook: body.hook,
        cta: body.cta,
        utmContent: body.utmContent,
        messageFamily: body.messageFamily,
        format: body.format,
        notes: body.notes,
        confirmWrite: body.confirmWrite === 'true',
      };
      res.json(uploadAsset(file, fields));
    } finally {
      cleanupUploadedTemp(file);
    }
  })
);

app.post(
  '/api/assets/local-backup',
  asyncRoute((req, res) => {
    const body = req.body as Record<string, string | boolean>;
    const project = projectFrom(req);
    const path = typeof body.path === 'string' ? body.path : '';
    if (!path) throw new Error('Local backup requires path');
    const file = localPreviewPath(path);
    const fields: UploadFields = {
      project,
      assetId: String(body.assetId || ''),
      audience: String(body.audience || ''),
      campaign: String(body.campaign || ''),
      channel: String(body.channel || ''),
      cta: String(body.cta || ''),
      hook: String(body.hook || ''),
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      status: body.status === 'published' ? 'published' : 'working',
      title: String(body.title || ''),
      type: (body.type || 'image') as AssetContentType,
      utmContent: String(body.utmContent || ''),
      confirmWrite: body.confirmWrite === true,
    };
    if (body.dryRun === true) {
      res.json({ ok: true, message: `Ready to back up ${fields.assetId}`, output: { dryRun: true, path, fields } });
      return;
    }
    const approvedAsset = requireApprovedLocalBackupPath(project, path);
    res.json(uploadAsset(approvedAsset.local?.absolute_path || file, fields));
  })
);
if (isProduction) {
  const dist = join(packageRoot, 'dist', 'web');
  if (existsSync(dist)) {
    app.use(express.static(dist)); app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
  }
} else {
  const { createServer: createViteServer } = await import('vite');
  const e2ePort = process.env.LINEAGE_E2E_PORT ? Number(process.env.LINEAGE_E2E_PORT) : undefined;
  const vite = await createViteServer({
    configFile: join(packageRoot, 'vite.config.ts'),
    server: {
      middlewareMode: true,
      ...(e2ePort ? { ws: { port: e2ePort + 1000 } } : {}),
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: `Upload exceeds ${Math.round(maxUploadBytes / 1024 / 1024)} MB` });
    return;
  }
  if (isLineageAssetError(error)) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (isAssetLookupError(error)) { res.status(error.status).json({ error: error.message }); return; }
  if (isAssetReviewSetError(error)) { res.status(error.status).json({ error: error.message }); return; }
  if (isAssetReviewError(error)) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (isContentBatchError(error)) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (isPostingAdapterError(error)) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (isBufferConnectionError(error)) { res.status(error.status).json({ error: error.message }); return; }
  if (handleBufferRuntimeServerError(error, res)) return;
  if (isAdapterSettingsError(error)) { res.status(error.status).json({ error: error.message }); return; }
  if (isAssetSelectionError(error)) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (isGenerationReceiptError(error)) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof OutputTargetResolutionError) {
    res.status(400).json({ error: error.code, message: error.message, choices: error.choices });
    return;
  }
  if (isManagedWriterRoutingError(error)) { res.status(error.status).json({ error: error.message }); return; }
  if (isAgentClaimError(error)) {
    res.status(error.status).json({ error: error.code, message: error.message, conflicts: error.conflicts });
    return;
  }
  if (isLineageWorkspaceError(error)) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (isLineageTaskError(error)) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (isLineageError(error)) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: message });
});

const listenOrigin = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
const server = app.listen(port, host, () => { console.log(`Lineage listening on ${listenOrigin}`); });
const releaseWriterLease = () => writerLease?.release();
process.once('exit', releaseWriterLease);
process.once('SIGINT', () => { releaseWriterLease(); process.exit(130); });
process.once('SIGTERM', () => { releaseWriterLease(); process.exit(143); });
server.once('error', error => {
  releaseWriterLease();
  console.error(`Lineage failed to listen on ${listenOrigin}: ${error.message}`);
  process.exit(1);
});
