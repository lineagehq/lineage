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
  const archiveBytes = Buffer.from('route archive');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(manifestPath, manifestBytes);
  writeFileSync(hostPath, hostBytes);
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

  it('runs the real host through a configured lineage-dev.localhost origin and preserves exact launch binding', async () => {
    const context = createNodeEditorTestContext('routes-session');
    contexts.push(context);
    const base = await serve(context.config, context.profile);
    const createdResponse = await fetch(`${base}/api/node-editor-plugins/reference.editor/sessions`, {
      body: JSON.stringify({ project: 'test-project', rootAssetId: 'root-asset', nodeAssetId: 'node-asset' }),
      headers: { 'content-type': 'application/json', host: `lineage-dev.localhost:${new URL(base).port}` }, method: 'POST',
    });
    const created = await createdResponse.json() as { launch: { sessionId: string; launchCredential: string; binding: Record<string, string> } };
    expect(createdResponse.status).toBe(201);
    expect(JSON.stringify(created)).not.toMatch(/processCapability|bootstrap|controlCredential|cookie/);
    const exchangeBody = JSON.stringify({
      launchCredential: created.launch.launchCredential,
      profileId: created.launch.binding.profileId,
      pluginId: created.launch.binding.pluginId,
      contributionId: created.launch.binding.contributionId,
      source: 'browser',
    });
    const wrongOrigin = await fetch(`${base}/api/node-editor-plugins/sessions/${created.launch.sessionId}/exchange`, {
      body: exchangeBody, headers: { 'content-type': 'application/json', origin: 'https://wrong.test.invalid' }, method: 'POST',
    });
    expect(wrongOrigin.status).toBe(401);
    const exchanged = await fetch(`${base}/api/node-editor-plugins/sessions/${created.launch.sessionId}/exchange`, {
      body: exchangeBody, headers: { 'content-type': 'application/json', origin: 'https://editor.test.invalid' }, method: 'POST',
    });
    const cookie = exchanged.headers.get('set-cookie') || '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain(`Path=/api/node-editor-plugins/sessions/${created.launch.sessionId}`);
    const replay = await fetch(`${base}/api/node-editor-plugins/sessions/${created.launch.sessionId}/exchange`, {
      body: exchangeBody, headers: { 'content-type': 'application/json', origin: 'https://editor.test.invalid' }, method: 'POST',
    });
    expect(replay.status).toBe(401);
    const service = runtime?.sessionService;
    if (!service) throw new Error('expected node editor session service');
    const deadline = Date.now() + 5_000;
    let terminal = service.terminal(created.launch.sessionId);
    while (!terminal && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
      terminal = service.terminal(created.launch.sessionId);
    }
    expect(terminal).toMatchObject({ outcome: 'accepted' });
    const proposalId = terminal?.proposalId || '';
    const retry = await fetch(`${base}/api/node-editor-plugins/sessions/${created.launch.sessionId}/proposals/${proposalId}/content`, {
      body: Buffer.alloc(1_000_000), headers: { cookie: cookie.split(';')[0], origin: 'https://editor.test.invalid' }, method: 'PUT',
    });
    expect(retry.ok).toBe(true);
    expect(await retry.json()).toMatchObject({ outcome: terminal });
  }, 15_000);
});
