import { createHash } from 'node:crypto';
import { once } from 'node:events';
import express, { type Express } from 'express';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import positiveFixtures from '../../../packages/node-editor-protocol/fixtures/positive.json';
import type { PluginManifest } from '../../../packages/node-editor-protocol/generated/protocol';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { repoRoot } from '../assetCore';
import type { NodeEditorPluginConfig } from '../../shared/nodeEditorPluginTypes';
import type { ResolvedLineageProfile } from '../../shared/lineageProfileTypes';
import { registerNodeEditorPluginRoutes, type NodeEditorPluginRouteRuntime } from './routes';
import { createNodeEditorTestContext } from './testSupport';

const scratch = join(repoRoot, '.asset-scratch', 'vitest-node-editor-routes');
const referenceHostPath = join(repoRoot, 'packages', 'node-editor-reference-plugin', 'src', 'host.js');
const referenceEditorPath = join(repoRoot, 'packages', 'node-editor-reference-plugin', 'editor', 'index.html');
let server: ReturnType<Express['listen']> | undefined;
let runtime: NodeEditorPluginRouteRuntime | undefined;
const contexts: Array<ReturnType<typeof createNodeEditorTestContext>> = [];
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const referenceManifest = positiveFixtures[0].value as PluginManifest;

function enabledConfig(): NodeEditorPluginConfig {
  const root = join(scratch, 'plugin');
  const manifestPath = join(root, 'manifest.json');
  const hostPath = join(root, 'src', 'host.js');
  const archivePath = join(scratch, 'plugin.tgz');
  const manifestBytes = `${JSON.stringify(referenceManifest)}\n`;
  const hostBytes = readFileSync(referenceHostPath);
  const editorBytes = readFileSync(referenceEditorPath);
  const archiveBytes = Buffer.from('route archive');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'editor'), { recursive: true });
  writeFileSync(manifestPath, manifestBytes);
  writeFileSync(hostPath, hostBytes);
  writeFileSync(join(root, 'editor', 'index.html'), editorBytes);
  writeFileSync(archivePath, archiveBytes);
  return {
    schemaVersion: 1,
    experimentalEnabled: true,
    installations: [{
      schemaVersion: 1,
      pluginId: referenceManifest.pluginId,
      contributionId: referenceManifest.nodeEditors[0].id,
      packageArchivePath: archivePath,
      packageArchiveSha256: sha256(archiveBytes),
      manifestSha256: sha256(manifestBytes),
      extractedRoot: root,
      hostSha256: sha256(hostBytes),
      editorSha256: sha256(editorBytes),
    }],
  };
}

async function serve(config: NodeEditorPluginConfig, selectedProfile?: ResolvedLineageProfile): Promise<string> {
  const profile = selectedProfile ?? useLineageTestProfile(join(scratch, `${config.experimentalEnabled ? 'on' : 'off'}.sqlite`));
  const app = express();
  app.use(express.json());
  runtime = registerNodeEditorPluginRoutes(app, profile, { config, supervisorOptions: { idleTimeoutMs: 1_000, healthIntervalMs: 100 } });
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await runtime?.close();
  await Promise.all(contexts.splice(0).map(context => context.supervisor.stopAll()));
  await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve());
  runtime = undefined;
  server = undefined;
  rmSync(scratch, { force: true, recursive: true });
});

describe('node editor plugin routes', () => {
  it('does not register routes or start processes while the flag is off', async () => {
    const base = await serve({ schemaVersion: 1, experimentalEnabled: false, installations: [] });
    const list = await fetch(`${base}/api/node-editor-plugins`);
    const start = await fetch(`${base}/api/node-editor-plugins/reference.editor/start`, { method: 'POST' });
    expect(runtime?.enabled).toBe(false);
    expect(list.status).toBe(404);
    expect(start.status).toBe(404);
  });

  it('discovers, starts, and reports status without exposing host-private capabilities', async () => {
    const base = await serve(enabledConfig());
    const list = await fetch(`${base}/api/node-editor-plugins`);
    const started = await fetch(`${base}/api/node-editor-plugins/reference.editor/start`, { method: 'POST' });
    const status = await fetch(`${base}/api/node-editor-plugins/reference.editor/status`);
    expect(list.ok).toBe(true);
    expect(started.ok).toBe(true);
    expect(status.ok).toBe(true);
    const responseText = JSON.stringify([await list.json(), await started.json(), await status.json()]);
    expect(responseText).toContain('reference.editor');
    for (const forbidden of ['Credential', 'token', 'command', 'args', 'extractedRoot', 'manifestPath', 'packageArchive', '127.0.0.1']) {
      expect(responseText).not.toContain(forbidden);
    }
  });

  it('rate limits session authority attempts before repeated authorization work', async () => {
    const base = await serve(enabledConfig());
    const responses = await Promise.all(Array.from({ length: 121 }, () => (
      fetch(`${base}/api/node-editor-plugins/sessions/missing/document`)
    )));

    expect(responses.filter(response => response.status === 404)).toHaveLength(120);
    expect(responses.filter(response => response.status === 429)).toHaveLength(1);
    const limited = responses.find(response => response.status === 429);
    expect(limited?.headers.get('ratelimit')).toBeTruthy();
    expect(await limited?.json()).toMatchObject({ error: 'node_editor_rate_limited' });
  });

  it('runs the real host through a configured lineage-dev.localhost origin and preserves exact launch binding', async () => {
    const context = createNodeEditorTestContext('routes-session');
    contexts.push(context);
    const base = await serve(context.config, context.profile);
    const controllerBase = base.replace('127.0.0.1', 'lineage-dev.localhost');
    const createdResponse = await fetch(`${controllerBase}/api/node-editor-plugins/reference.editor/sessions`, {
      body: JSON.stringify({ project: 'test-project', rootAssetId: 'root-asset', nodeAssetId: 'node-asset' }),
      headers: { 'content-type': 'application/json' }, method: 'POST',
    });
    const created = await createdResponse.json() as { launch: { sessionId: string; launchCredential: string; editorUrl: string; runtimeOrigin: string; binding: Record<string, string> } };
    expect(createdResponse.status).toBe(201);
    expect(JSON.stringify(created)).not.toMatch(/processCapability|bootstrap|controlCredential|cookie/);
    const exchangeBody = JSON.stringify({
      launchCredential: created.launch.launchCredential,
      profileId: created.launch.binding.profileId,
      pluginId: created.launch.binding.pluginId,
      contributionId: created.launch.binding.contributionId,
      source: 'browser',
    });
    expect(new URL(created.launch.editorUrl).origin).toBe(created.launch.runtimeOrigin);
    expect(created.launch.binding.origin).toBe(controllerBase);
    expect(created.launch.binding.origin).not.toBe(created.launch.runtimeOrigin);
    const editor = await fetch(created.launch.editorUrl);
    expect(editor.ok).toBe(true);
    expect(editor.headers.get('cache-control')).toBe('no-store');
    const exchanged = await fetch(`${controllerBase}/api/node-editor-plugins/sessions/${created.launch.sessionId}/exchange`, {
      body: exchangeBody, headers: { 'content-type': 'application/json' }, method: 'POST',
    });
    const cookie = exchanged.headers.get('set-cookie') || '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain(`Path=/api/node-editor-plugins/sessions/${created.launch.sessionId}`);
    const replay = await fetch(`${controllerBase}/api/node-editor-plugins/sessions/${created.launch.sessionId}/exchange`, {
      body: exchangeBody, headers: { 'content-type': 'application/json' }, method: 'POST',
    });
    expect(replay.status).toBe(401);
    const browserCookie = cookie.split(';')[0];
    const wrongOriginDocument = await fetch(`${base}/api/node-editor-plugins/sessions/${created.launch.sessionId}/document`, { headers: { cookie: browserCookie } });
    expect(wrongOriginDocument.status).toBe(401);
    const mismatchedOriginHeader = await fetch(`${controllerBase}/api/node-editor-plugins/sessions/${created.launch.sessionId}/document`, { headers: { cookie: browserCookie, origin: base } });
    expect(mismatchedOriginHeader.status).toBe(403);
    const document = await (await fetch(`${controllerBase}/api/node-editor-plugins/sessions/${created.launch.sessionId}/document`, { headers: { cookie: browserCookie } })).json() as { document: { baseAttemptId: string; baseChecksumSha256: string } };
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const proposalId = 'proposal-browser-route';
    const proposal = await fetch(`${controllerBase}/api/node-editor-plugins/sessions/${created.launch.sessionId}/proposals`, {
      body: JSON.stringify({ proposalId, idempotencyKey: 'idem-browser-route', ...document.document, mimeType: 'image/png', sizeBytes: bytes.length, checksumSha256: sha256(bytes), editSummary: 'Browser route edit' }),
      headers: { cookie: browserCookie, 'content-type': 'application/json' }, method: 'POST',
    });
    expect(proposal.status).toBe(201);
    const upload = await fetch(`${controllerBase}/api/node-editor-plugins/sessions/${created.launch.sessionId}/proposals/${proposalId}/content`, { body: bytes, headers: { cookie: browserCookie }, method: 'PUT' });
    const terminal = (await upload.json() as { outcome: { outcome: string; proposalId: string } }).outcome;
    expect(terminal).toMatchObject({ outcome: 'accepted', proposalId });
    const retry = await fetch(`${controllerBase}/api/node-editor-plugins/sessions/${created.launch.sessionId}/proposals/${proposalId}/content`, {
      body: Buffer.alloc(1_000_000), headers: { cookie: browserCookie }, method: 'PUT',
    });
    expect(retry.ok).toBe(true);
    expect(await retry.json()).toMatchObject({ outcome: terminal });
  }, 15_000);
});
