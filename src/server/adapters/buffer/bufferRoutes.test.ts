import { createHash } from 'node:crypto';
import { join } from 'node:path';
import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { repoRoot } from '../../assetCore';
import { useLineageTestProfile } from '../../../test/lineageTestProfile';
import { BUFFER_SCHEMA_FINGERPRINT, isBufferConnectionError } from './bufferConnection';
import { BUFFER_CLI_VERSION, BUFFER_SCHEMA_HASHES, type BufferReadRuntime } from './bufferRuntime';
import { registerBufferRoutes } from './bufferRoutes';

const generated = (scope: string) => `synthetic-${createHash('sha256').update(scope).digest('hex')}`;
describe('Buffer routes', () => {
  beforeEach(() => useLineageTestProfile(join(repoRoot, '.asset-scratch', 'vitest-buffer-routes.sqlite')));
  it('implements the approved HTTP contract with confirmation, project isolation, normalized errors, and secret-free responses', async () => {
    const organizationId = generated('organization'); const channelId = generated('channel'); const apiKey = generated('credential');
    const runtime: BufferReadRuntime = {
      verify: vi.fn(() => ({ cli_path: '/synthetic/package-local-cli', cli_version: BUFFER_CLI_VERSION, schema_fingerprint: BUFFER_SCHEMA_FINGERPRINT, schema_hashes: BUFFER_SCHEMA_HASHES })),
      run: vi.fn(),
      listChannels: vi.fn(() => [{ id: channelId }]),
      getChannel: vi.fn(() => ({ id: channelId, organizationId, service: 'linkedin', displayName: generated('display') })),
    };
    const app = express(); app.use(express.json());
    const asyncRoute = (handler: express.RequestHandler): express.RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };
    registerBufferRoutes(app, input => String(input.body?.project || input.query?.project || 'project-a'), asyncRoute as never, { env: { BUFFER_TEST_KEY: apiKey }, runtime });
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (isBufferConnectionError(error)) { res.status(error.status).json({ error: 'buffer_connection_error', message: error.message }); return; }
      res.status(500).json({ error: 'internal_error' });
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing test address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      expect((await fetch(`${base}/api/adapters/buffer/connection?project=project-a`)).status).toBe(200);
      const rejected = await fetch(`${base}/api/adapters/buffer/connection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'project-a', organizationId, credentialRef: 'env:BUFFER_TEST_KEY' }) });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({ error: 'buffer_connection_error', message: 'Buffer connection update requires confirmWrite=true' });
      const connected = await fetch(`${base}/api/adapters/buffer/connection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'project-a', organizationId, credentialRef: 'env:BUFFER_TEST_KEY', confirmWrite: true }) });
      const connectedBody = await connected.json();
      expect(connectedBody.connection).toMatchObject({ project: 'project-a', organization_id: organizationId });
      expect(JSON.stringify(connectedBody)).not.toContain(apiKey);
      const other = await (await fetch(`${base}/api/adapters/buffer/connection?project=project-b`)).json();
      expect(other.connection).toBeNull();
      const unconfirmedSync = await fetch(`${base}/api/adapters/buffer/channels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'project-a' }) });
      expect(unconfirmedSync.status).toBe(400);
      expect(runtime.listChannels).not.toHaveBeenCalled();
      const synced = await fetch(`${base}/api/adapters/buffer/channels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'project-a', confirmWrite: true }) });
      const syncedBody = await synced.json();
      expect(synced.status).toBe(200);
      expect(syncedBody.channels).toEqual([expect.objectContaining({ channel_id: channelId, service: 'linkedin' })]);
      expect(JSON.stringify(syncedBody)).not.toContain(apiKey);
      const otherChannelsResponse = await fetch(`${base}/api/adapters/buffer/channels?project=project-b`);
      expect(otherChannelsResponse.status).toBe(200);
      expect(await otherChannelsResponse.json()).toEqual({ ok: true, project: 'project-b', channels: [] });
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
