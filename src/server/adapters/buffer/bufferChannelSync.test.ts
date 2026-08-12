import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { repoRoot } from '../../assetCore';
import { lineageDb } from '../../assetLineageDb';
import { useLineageTestProfile } from '../../../test/lineageTestProfile';
import { updateAdapterSetting } from '../adapterSettings';
import { BUFFER_CLI_VERSION, BUFFER_SCHEMA_HASHES, type BufferReadRuntime } from './bufferRuntime';
import { BUFFER_SCHEMA_FINGERPRINT, connectBuffer } from './bufferConnection';
import { listBufferChannels, syncBufferChannels } from './bufferChannelSync';

const generated = (scope: string) => `synthetic-${createHash('sha256').update(scope).digest('hex')}`;
const runtime = (fields: Partial<BufferReadRuntime> = {}): BufferReadRuntime => ({
  verify: vi.fn(() => ({ cli_path: '/synthetic/package-local-cli', cli_version: BUFFER_CLI_VERSION, schema_fingerprint: BUFFER_SCHEMA_FINGERPRINT, schema_hashes: BUFFER_SCHEMA_HASHES })),
  run: vi.fn(), listChannels: vi.fn(() => []), getChannel: vi.fn(() => ({})), ...fields,
});
describe('Buffer channel sync', () => {
  beforeEach(() => {
    rmSync(join(repoRoot, '.asset-scratch', 'vitest-buffer-channel-sync.sqlite'), { force: true });
    useLineageTestProfile(join(repoRoot, '.asset-scratch', 'vitest-buffer-channel-sync.sqlite'));
  });
  it('uses only list/get with the exact organization, retains stale channels, and never returns credentials', () => {
    const project = 'project-a'; const organizationId = generated('organization'); const apiKey = generated('credential');
    connectBuffer(project, { organizationId, credentialRef: 'env:BUFFER_TEST_KEY', confirmWrite: true }, { BUFFER_TEST_KEY: apiKey }, runtime());
    const ids = [generated('channel-one'), generated('channel-two')];
    const listChannels = vi.fn(() => ids.map(id => ({ id })));
    const getChannel = vi.fn((id: string) => ({ id, organizationId, service: id === ids[0] ? 'linkedin' : 'future-network', displayName: id.slice(-8), isDisconnected: false }));
    const firstRuntime = runtime({ listChannels, getChannel });
    const first = syncBufferChannels(project, { confirmWrite: true }, { env: { BUFFER_TEST_KEY: apiKey }, runtime: firstRuntime });
    expect(listChannels).toHaveBeenCalledWith(organizationId, apiKey);
    expect(getChannel.mock.calls.map(call => call[0])).toEqual(ids);
    expect(first.channels).toHaveLength(2);
    expect(JSON.stringify(first)).not.toContain(apiKey);
    syncBufferChannels(project, { confirmWrite: true }, { env: { BUFFER_TEST_KEY: apiKey }, runtime: runtime({ listChannels: () => [{ id: ids[0] }], getChannel }) });
    expect(listBufferChannels(project).find(channel => channel.channel_id === ids[1])).toMatchObject({ available: false, stale_at: expect.any(String) });
  });
  it('does not invoke Buffer when unconfirmed, disconnected, credential-missing, or organization-mismatched', () => {
    const readRuntime = runtime();
    expect(() => syncBufferChannels('missing', { confirmWrite: true }, { runtime: readRuntime })).toThrow('not connected');
    expect(readRuntime.listChannels).not.toHaveBeenCalled();
    const organizationId = generated('organization');
    connectBuffer('project-a', { organizationId, credentialRef: 'env:BUFFER_TEST_KEY', confirmWrite: true }, {}, runtime());
    expect(() => syncBufferChannels('project-a', { confirmWrite: false }, { runtime: readRuntime })).toThrow('confirmWrite=true');
    expect(() => syncBufferChannels('project-a', { confirmWrite: true }, { env: {}, runtime: readRuntime })).toThrow('credential is unavailable');
    expect(readRuntime.listChannels).not.toHaveBeenCalled();
  });

  it('leaves connection, catalog bytes, and timestamps unchanged after a wrong-organization response', () => {
    const project = 'project-a'; const organizationId = generated('organization'); const apiKey = generated('credential'); const channelId = generated('channel');
    connectBuffer(project, { organizationId, credentialRef: 'env:BUFFER_TEST_KEY', confirmWrite: true }, { BUFFER_TEST_KEY: apiKey }, runtime());
    syncBufferChannels(project, { confirmWrite: true }, { env: { BUFFER_TEST_KEY: apiKey }, runtime: runtime({ listChannels: () => [{ id: channelId }], getChannel: () => ({ id: channelId, organizationId, service: 'linkedin', displayName: generated('display') }) }) });
    const database = lineageDb();
    const before = JSON.stringify({ connection: database.prepare('select * from buffer_connections where project_id=?').get(project), channels: database.prepare('select * from buffer_channels where project_id=? order by channel_id').all(project) });
    database.close();
    const wrong = runtime({ listChannels: () => [{ id: channelId }], getChannel: () => ({ id: channelId, organizationId: generated('wrong-organization'), service: 'linkedin' }) });
    expect(() => syncBufferChannels(project, { confirmWrite: true }, { env: { BUFFER_TEST_KEY: apiKey }, runtime: wrong })).toThrow('organization mismatch');
    const afterDatabase = lineageDb();
    const after = JSON.stringify({ connection: afterDatabase.prepare('select * from buffer_connections where project_id=?').get(project), channels: afterDatabase.prepare('select * from buffer_channels where project_id=? order by channel_id').all(project) });
    afterDatabase.close();
    expect(after).toBe(before);
  });

  it('rejects disabled adapters and fingerprint drift before runtime verification or Buffer invocation', () => {
    const project = 'project-a'; const organizationId = generated('organization'); const apiKey = generated('credential');
    connectBuffer(project, { organizationId, credentialRef: 'env:BUFFER_TEST_KEY', confirmWrite: true }, { BUFFER_TEST_KEY: apiKey }, runtime());
    updateAdapterSetting(project, { adapterType: 'scheduler', confirmWrite: true, enabled: false, provider: 'buffer' });
    const disabledRuntime = runtime();
    expect(() => syncBufferChannels(project, { confirmWrite: true }, { env: { BUFFER_TEST_KEY: apiKey }, runtime: disabledRuntime })).toThrow('adapter is disabled');
    expect(disabledRuntime.verify).not.toHaveBeenCalled();
    expect(disabledRuntime.listChannels).not.toHaveBeenCalled();
    updateAdapterSetting(project, { adapterType: 'scheduler', confirmWrite: true, enabled: true, provider: 'buffer' });
    const database = lineageDb(); database.prepare('update buffer_connections set connection_fingerprint=? where project_id=?').run(generated('drift'), project); database.close();
    const driftRuntime = runtime();
    expect(() => syncBufferChannels(project, { confirmWrite: true }, { env: { BUFFER_TEST_KEY: apiKey }, runtime: driftRuntime })).toThrow('connection fingerprint mismatch');
    expect(driftRuntime.listChannels).not.toHaveBeenCalled();
  });
});
