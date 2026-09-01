import type express from 'express';
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
  const sessionService = new NodeEditorSessionService({ profile, registry, supervisor, authority: options.authority });

  app.get('/api/node-editor-plugins', (_req, res) => {
    try {
      res.json({ ok: true, plugins: registry.list().map(publicNodeEditorPluginSummary) });
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
  app.post('/api/node-editor-plugins/:contributionId/sessions', (req, res) => {
    void sessionService.create({
      contributionId: req.params.contributionId,
      project: String(req.body.project || ''),
      rootAssetId: String(req.body.rootAssetId || ''),
      nodeAssetId: String(req.body.nodeAssetId || ''),
      serverOrigin: `${req.protocol}://${req.get('host')}`,
    }).then(launch => res.status(201).json({ ok: true, launch })).catch(error => {
      res.status('status' in Object(error) ? Number((error as { status: number }).status) : 409).json({ error: 'session_create_failed', message: error instanceof Error ? error.message : String(error) });
    });
  });
  app.post('/api/node-editor-plugins/sessions/:sessionId/exchange', (req, res) => {
    try {
      const origin = String(req.headers.origin || '');
      const exchanged = sessionService.exchange({
        sessionId: req.params.sessionId,
        launchCredential: String(req.body.launchCredential || ''),
        profileId: String(req.body.profileId || ''),
        pluginId: String(req.body.pluginId || ''),
        contributionId: String(req.body.contributionId || ''),
        origin,
        source: req.body.source,
      });
      const maxAge = Math.max(0, Math.ceil((exchanged.expiresAt - Date.now()) / 1_000));
      res.setHeader('Set-Cookie', `lineage_node_editor_session=${exchanged.cookie}; HttpOnly; SameSite=Strict; Path=${exchanged.path}; Max-Age=${maxAge}`);
      res.json({ ok: true, sessionId: req.params.sessionId });
    } catch (error) {
      res.status('status' in Object(error) ? Number((error as { status: number }).status) : 401).json({ error: 'launch_exchange_failed', message: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post('/api/node-editor-plugins/sessions/:sessionId/protocol', (req, res) => {
    try {
      const authorization = String(req.headers.authorization || '');
      const capability = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      res.json(sessionService.handleProcessRequest(req.params.sessionId, capability, req.body as ProxyRequest));
    } catch (error) {
      res.status('status' in Object(error) ? Number((error as { status: number }).status) : 400).json({ error: 'protocol_request_failed', message: error instanceof Error ? error.message : String(error) });
    }
  });
  app.put('/api/node-editor-plugins/sessions/:sessionId/proposals/:proposalId/content', (req, res) => {
    try {
      const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => part.trim().split('=', 2)).filter(parts => parts.length === 2));
      const authorization = String(req.headers.authorization || '');
      const capability = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      const prior = sessionService.terminal(req.params.sessionId);
      if (prior) {
        if (capability) throw Object.assign(new Error('terminal process authority is revoked'), { status: 401 });
        const outcome = sessionService.authorizeTerminalRetry(req.params.sessionId, cookies.lineage_node_editor_session || '', String(req.headers.origin || ''), req.params.proposalId);
        res.json({ ok: true, outcome });
        return;
      }
      if (capability) sessionService.authorizeProcessUpload(req.params.sessionId, capability);
      else sessionService.authorizeBrowser(req.params.sessionId, cookies.lineage_node_editor_session || '', String(req.headers.origin || ''));
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
