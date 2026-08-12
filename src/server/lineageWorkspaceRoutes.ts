import type express from 'express';
import { defaultProject, projectCatalogDefinitionExists } from './assetCore';
import {
  ensureWorkspaceRootAsset,
  indexLineageAssets,
} from './assetLineage';
import {
  activateLineageWorkspace,
  archiveLineageWorkspace,
  createLineageWorkspace,
  inspectLineageWorkspace,
  listLineageWorkspaces,
  updateLineageWorkspace,
} from './assetLineageWorkspaces';
import {
  archiveDemoLineageWorkspace,
  demoSeedMediaStatus,
  downloadSwissifierRichDemoMedia,
  restoreDemoSeedMedia,
  restoreSwissifierRichDemoMedia,
  seedDemoLineageWorkspace,
  seedSwissifierRichDemoWorkspace,
  swissifierRichDemoMediaStatus,
} from './assetLineageDemo';
import { swissifierDemoProject } from './projectWorkspaces';

type ProjectFrom = (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string;
type AsyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void) => express.RequestHandler;

export function registerLineageWorkspaceRoutes(app: express.Express, projectFrom: ProjectFrom, asyncRoute: AsyncRoute): void {
  app.get('/api/lineage-workspaces', asyncRoute((req, res) => {
    res.json(listLineageWorkspaces(projectFrom(req)));
  }));

  app.post('/api/lineage-workspaces', asyncRoute((req, res) => {
    const project = projectFrom(req);
    let rootAssetId = String(req.body.rootAssetId || '');
    if (req.body.confirmWrite === true) {
      if (project === defaultProject || projectCatalogDefinitionExists(project)) {
        indexLineageAssets(project);
      }
      rootAssetId = ensureWorkspaceRootAsset(project, rootAssetId);
    }
    res.json(createLineageWorkspace(project, {
      rootAssetId,
      title: typeof req.body.title === 'string' ? req.body.title : undefined,
      status: req.body.status === 'paused' || req.body.status === 'archived' ? req.body.status : 'active',
      notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
      createdBy: req.body.createdBy === 'agent' || req.body.createdBy === 'system' ? req.body.createdBy : 'human',
      activate: req.body.activate !== false,
      restoreDeleted: req.body.restoreDeleted === true,
      confirmWrite: req.body.confirmWrite === true,
    }));
  }));

  app.post('/api/lineage-workspaces/demo/seed', asyncRoute((req, res) => {
    res.json(seedDemoLineageWorkspace(projectFrom(req), {
      activate: req.body.activate !== false,
      confirmWrite: req.body.confirmWrite === true,
    }));
  }));

  app.post('/api/lineage-workspaces/demo/archive', asyncRoute((req, res) => {
    res.json(archiveDemoLineageWorkspace(projectFrom(req), req.body.confirmWrite === true));
  }));

  app.post('/api/lineage-workspaces/demo/swissifier/seed', asyncRoute((req, res) => {
    res.json(seedSwissifierRichDemoWorkspace(swissifierDemoProject, {
      activate: req.body.activate !== false,
      confirmWrite: req.body.confirmWrite === true,
    }));
  }));

  app.get('/api/lineage-workspaces/demo/media', asyncRoute((req, res) => {
    res.json({ ok: true, status: demoSeedMediaStatus(projectFrom(req)) });
  }));

  app.get('/api/lineage-workspaces/demo/swissifier/media', asyncRoute((req, res) => {
    res.json({ ok: true, status: swissifierRichDemoMediaStatus(swissifierDemoProject) });
  }));

  app.post('/api/lineage-workspaces/demo/media/restore', asyncRoute((req, res) => {
    res.json({ ok: true, result: restoreDemoSeedMedia(projectFrom(req), { confirmWrite: req.body.confirmWrite === true }) });
  }));

  app.post('/api/lineage-workspaces/demo/swissifier/media/restore', asyncRoute((req, res) => {
    res.json({
      ok: true,
      result: restoreSwissifierRichDemoMedia(swissifierDemoProject, {
        confirmWrite: req.body.confirmWrite === true,
        sourceDir: typeof req.body.sourceDir === 'string' ? req.body.sourceDir : undefined,
      }),
    });
  }));

  app.post('/api/lineage-workspaces/demo/swissifier/media/download', asyncRoute(async (req, res) => {
    res.json({
      ok: true,
      result: await downloadSwissifierRichDemoMedia(swissifierDemoProject, {
        confirmWrite: req.body.confirmWrite === true,
      }),
    });
  }));

  app.get('/api/lineage-workspaces/:workspaceId', asyncRoute((req, res) => {
    res.json({
      ok: true,
      project: projectFrom(req),
      workspace: inspectLineageWorkspace(projectFrom(req), req.params.workspaceId),
    });
  }));

  app.post('/api/lineage-workspaces/:workspaceId', asyncRoute((req, res) => {
    res.json(updateLineageWorkspace(projectFrom(req), req.params.workspaceId, {
      title: typeof req.body.title === 'string' ? req.body.title : undefined,
      status: req.body.status === 'active' || req.body.status === 'paused' || req.body.status === 'archived' ? req.body.status : undefined,
      notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
      activate: req.body.activate === true,
      maxQueuedBranches: typeof req.body.maxQueuedBranches === 'number' ? req.body.maxQueuedBranches : undefined,
      confirmWrite: req.body.confirmWrite === true,
    }));
  }));

  app.post('/api/lineage-workspaces/:workspaceId/activate', asyncRoute((req, res) => {
    res.json(activateLineageWorkspace(projectFrom(req), req.params.workspaceId, req.body.confirmWrite === true));
  }));

  app.post('/api/lineage-workspaces/:workspaceId/archive', asyncRoute((req, res) => {
    res.json(archiveLineageWorkspace(projectFrom(req), req.params.workspaceId, req.body.confirmWrite === true));
  }));
}
