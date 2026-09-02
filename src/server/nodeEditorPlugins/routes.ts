import type express from 'express';
import { rateLimit } from 'express-rate-limit';
import type { ResolvedLineageProfile } from '../../shared/lineageProfileTypes';
import type { NodeEditorPluginConfig } from '../../shared/nodeEditorPluginTypes';
import { loadNodeEditorPluginConfig } from './config';
import { NodeEditorPluginRegistry, publicNodeEditorPluginSummary } from './registry';
import { NodeEditorPluginSupervisor, type NodeEditorSupervisorOptions } from './supervisor';
import { NodeEditorSessionService } from './sessionService';
import { NodeEditorSessionAuthority } from './sessionAuthority';
import { collectNodeEditorOrphans } from './materialization';
import { registeredNodeEditorChecksums } from './persistence';
import type { ProxyRequest } from '../../../packages/node-editor-protocol/generated/protocol';

function actualControllerOrigin(req: express.Request): string {
  const host = req.get('host');
  if (!host || /[\s\\/@]/.test(host)) throw Object.assign(new Error('request target origin is invalid'), { status: 400 });
  const protocol = 'encrypted' in req.socket && req.socket.encrypted ? 'https:' : 'http:';
  const origin = new URL(`${protocol}//${host}`).origin;
  const suppliedOrigin = req.get('origin');
  if (suppliedOrigin) {
    let canonical: string;
    try { canonical = new URL(suppliedOrigin).origin; } catch { throw Object.assign(new Error('request origin is invalid'), { status: 403 }); }
    if (canonical !== suppliedOrigin || canonical !== origin) throw Object.assign(new Error('request origin does not match request target'), { status: 403 });
  }
  return origin;
}

function positiveEnvironmentMilliseconds(name: string): number | undefined {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export interface NodeEditorPluginRouteRuntime {
  enabled: boolean;
  supervisor?: NodeEditorPluginSupervisor;
  sessionService?: NodeEditorSessionService;
  close(): Promise<void>;
}

export function registerNodeEditorPluginRoutes(
  app: express.Express,
  profile: ResolvedLineageProfile | undefined,
  options: { config?: NodeEditorPluginConfig; supervisorOptions?: NodeEditorSupervisorOptions; authority?: NodeEditorSessionAuthority } = {},
): NodeEditorPluginRouteRuntime {
  if (!profile) return { enabled: false, close: async () => {} };
  const config = options.config ?? loadNodeEditorPluginConfig(profile);
  if (!config.experimentalEnabled) return { enabled: false, close: async () => {} };
  const registry = new NodeEditorPluginRegistry(config);
  const supervisor = new NodeEditorPluginSupervisor(profile.profile_id, registry, options.supervisorOptions);
  const authority = options.authority ?? new NodeEditorSessionAuthority({
    launchTtlMs: positiveEnvironmentMilliseconds('LINEAGE_NODE_EDITOR_LAUNCH_TTL_MS'),
    cookieTtlMs: positiveEnvironmentMilliseconds('LINEAGE_NODE_EDITOR_COOKIE_TTL_MS'),
  });
  const sessionService = new NodeEditorSessionService({ profile, registry, supervisor, authority });
  const sessionRateLimit = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'node_editor_rate_limited', message: 'Too many node editor requests; try again later.' });
    },
  });

  const cookies = (req: express.Request) => Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => part.trim().split('=', 2)).filter(parts => parts.length === 2));
  const authorizeBrowser = (req: express.Request) => sessionService.authorizeBrowser(req.params.sessionId, cookies(req).lineage_node_editor_session || '', actualControllerOrigin(req));
  app.get('/api/node-editor-plugins', (req, res) => {
    try {
      const project = String(req.query.project || '');
      const rootAssetId = String(req.query.rootAssetId || '');
      const nodeAssetId = String(req.query.nodeAssetId || '');
      const plugins = registry.list().map(plugin => {
        const summary = publicNodeEditorPluginSummary(plugin);
        if (!project || !rootAssetId || !nodeAssetId) return summary;
        try {
          const base = sessionService.eligibility(project, rootAssetId, nodeAssetId);
          const mimeEligible = plugin.contribution.accepts.mimeTypes.includes(base.mimeType as never);
          const sizeEligible = base.sizeBytes <= plugin.contribution.accepts.maxBytes;
          return { ...summary, eligible: mimeEligible && sizeEligible, ...(!mimeEligible ? { ineligibleReason: 'mime-type' as const } : !sizeEligible ? { ineligibleReason: 'size' as const } : {}) };
        } catch { return { ...summary, eligible: false, ineligibleReason: 'mime-type' as const }; }
      });
      res.json({ ok: true, plugins });
    } catch (error) {
      res.status(409).json({ error: 'plugin_verification_failed', message: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post('/api/node-editor-plugins/:contributionId/start', (req, res) => {
    void supervisor.start(req.params.contributionId).then(status => {
      res.json({ ok: true, status });
    }).catch(error => {
      res.status(409).json({ error: 'plugin_start_failed', message: error instanceof Error ? error.message : String(error) });
    });
  });
  app.get('/api/node-editor-plugins/:contributionId/status', (req, res) => {
    res.json({ ok: true, status: supervisor.status(req.params.contributionId) });
  });
  app.post('/api/node-editor-plugins/:contributionId/sessions', sessionRateLimit, (req, res) => {
    let controllerOrigin: string;
    try { controllerOrigin = actualControllerOrigin(req); }
    catch (error) { res.status('status' in Object(error) ? Number((error as { status: number }).status) : 400).json({ error: 'session_create_failed', message: error instanceof Error ? error.message : String(error) }); return; }
    void sessionService.create({
      contributionId: req.params.contributionId,
      project: String(req.body.project || ''),
      rootAssetId: String(req.body.rootAssetId || ''),
      nodeAssetId: String(req.body.nodeAssetId || ''),
      serverOrigin: controllerOrigin,
      controllerOrigin,
    }).then(launch => res.status(201).json({ ok: true, launch })).catch(error => {
      res.status('status' in Object(error) ? Number((error as { status: number }).status) : 409).json({ error: 'session_create_failed', message: error instanceof Error ? error.message : String(error) });
    });
  });
  app.post('/api/node-editor-plugins/sessions/:sessionId/exchange', sessionRateLimit, (req, res) => {
    try {
      const exchanged = sessionService.exchange({
        sessionId: req.params.sessionId,
        launchCredential: String(req.body.launchCredential || ''),
        profileId: String(req.body.profileId || ''),
        pluginId: String(req.body.pluginId || ''),
        contributionId: String(req.body.contributionId || ''),
        origin: actualControllerOrigin(req),
        source: req.body.source,
      });
      const maxAge = Math.max(0, Math.ceil((exchanged.expiresAt - Date.now()) / 1_000));
      res.setHeader('Set-Cookie', `lineage_node_editor_session=${exchanged.cookie}; HttpOnly; SameSite=Strict; Path=${exchanged.path}; Max-Age=${maxAge}`);
      res.json({ ok: true, sessionId: req.params.sessionId });
    } catch (error) {
      res.status('status' in Object(error) ? Number((error as { status: number }).status) : 401).json({ error: 'launch_exchange_failed', message: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get('/api/node-editor-plugins/sessions/:sessionId/document', sessionRateLimit, (req, res) => {
    try { authorizeBrowser(req); res.json({ ok: true, document: sessionService.browserDocument(req.params.sessionId) }); }
    catch (error) { res.status('status' in Object(error) ? Number((error as { status: number }).status) : 401).json({ error: 'browser_document_failed', message: error instanceof Error ? error.message : String(error) }); }
  });
  app.post('/api/node-editor-plugins/sessions/:sessionId/proposals', sessionRateLimit, (req, res) => {
    try { authorizeBrowser(req); res.status(201).json({ ok: true, proposal: sessionService.browserCreateProposal(req.params.sessionId, req.body) }); }
    catch (error) { res.status('status' in Object(error) ? Number((error as { status: number }).status) : 400).json({ error: 'browser_proposal_failed', message: error instanceof Error ? error.message : String(error) }); }
  });
  app.get('/api/node-editor-plugins/sessions/:sessionId/status', sessionRateLimit, (req, res) => {
    try { authorizeBrowser(req); res.json({ ok: true, ...sessionService.browserStatus(req.params.sessionId) }); }
    catch (error) { res.status('status' in Object(error) ? Number((error as { status: number }).status) : 401).json({ error: 'browser_status_failed', message: error instanceof Error ? error.message : String(error) }); }
  });
  app.post('/api/node-editor-plugins/sessions/:sessionId/cancel', sessionRateLimit, (req, res) => {
    try { authorizeBrowser(req); res.json({ ok: true, outcome: sessionService.browserCancel(req.params.sessionId) }); }
    catch (error) { res.status('status' in Object(error) ? Number((error as { status: number }).status) : 401).json({ error: 'browser_cancel_failed', message: error instanceof Error ? error.message : String(error) }); }
  });
  app.post('/api/node-editor-plugins/sessions/:sessionId/close', sessionRateLimit, (req, res) => {
    try { authorizeBrowser(req); res.json({ ok: true, ...sessionService.browserClose(req.params.sessionId) }); }
    catch (error) { res.status('status' in Object(error) ? Number((error as { status: number }).status) : 401).json({ error: 'browser_close_failed', message: error instanceof Error ? error.message : String(error) }); }
  });
  app.post('/api/node-editor-plugins/sessions/:sessionId/protocol', sessionRateLimit, (req, res) => {
    try {
      const authorization = String(req.headers.authorization || '');
      const capability = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      res.json(sessionService.handleProcessRequest(req.params.sessionId, capability, req.body as ProxyRequest));
    } catch (error) {
      res.status('status' in Object(error) ? Number((error as { status: number }).status) : 400).json({ error: 'protocol_request_failed', message: error instanceof Error ? error.message : String(error) });
    }
  });
  app.put('/api/node-editor-plugins/sessions/:sessionId/proposals/:proposalId/content', sessionRateLimit, (req, res) => {
    try {
      const requestCookies = cookies(req);
      const authorization = String(req.headers.authorization || '');
      const capability = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      const prior = sessionService.terminal(req.params.sessionId);
      if (prior) {
        if (capability) throw Object.assign(new Error('terminal process authority is revoked'), { status: 401 });
        const outcome = sessionService.authorizeTerminalRetry(req.params.sessionId, requestCookies.lineage_node_editor_session || '', actualControllerOrigin(req), req.params.proposalId);
        res.json({ ok: true, outcome });
        return;
      }
      if (capability) sessionService.authorizeProcessUpload(req.params.sessionId, capability);
      else sessionService.authorizeBrowser(req.params.sessionId, requestCookies.lineage_node_editor_session || '', actualControllerOrigin(req));
      void sessionService.upload(req.params.sessionId, req.params.proposalId, req).then(outcome => res.json({ ok: true, outcome })).catch(error => {
        res.status('status' in Object(error) ? Number((error as { status: number }).status) : 409).json({ error: 'proposal_upload_failed', message: error instanceof Error ? error.message : String(error) });
      });
    } catch (error) {
      res.status('status' in Object(error) ? Number((error as { status: number }).status) : 401).json({ error: 'proposal_upload_failed', message: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post('/api/node-editor-plugins/orphans/collect', (req, res) => {
    const limit = Number(req.body.limit || 25);
    res.json({ ok: true, ...collectNodeEditorOrphans(profile.asset_root, registeredNodeEditorChecksums(), limit) });
  });
  return { enabled: true, supervisor, sessionService, close: () => supervisor.stopAll() };
}
