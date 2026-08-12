import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../../../test/lineageTestProfile';
import { repoRoot } from '../../assetCore';
import { lineageDb } from '../../assetLineageDb';
import { connectBuffer, getBufferConnection } from './bufferConnection';
import { listBufferChannels, syncBufferChannels } from './bufferChannelSync';
import { BUFFER_READ_ALLOWLIST, createBufferReadRuntime, type BufferSpawn } from './bufferRuntime';

const scratch = join(repoRoot, '.asset-scratch', 'vitest-buffer-release-one');
const synthetic = (scope: string) => `synthetic-${createHash('sha256').update(`release-one:${scope}`).digest('hex')}`;

afterEach(() => rmSync(scratch, { force: true, recursive: true }));

describe('Buffer Release 1 read-only integration boundary', () => {
  it('captures every subprocess, permits only allowlisted reads, and persists tenant-scoped safe channel evidence', () => {
    useLineageTestProfile(join(scratch, 'lineage.sqlite'));
    const project = 'synthetic-release-one-project';
    const otherProject = 'synthetic-release-one-other-project';
    const organizationId = synthetic('organization');
    const channelId = synthetic('channel');
    const credential = synthetic('credential');
    const invocations: Array<{ command: string; args: string[] }> = [];
    const spawn: BufferSpawn = (command, args, options) => {
      const cliArgs = args.slice(1);
      invocations.push({ command, args: cliArgs });
      if (cliArgs[0] === 'schema' && cliArgs[1] === 'describe') return spawnSync(command, args, options);
      if (cliArgs[0] === 'channels' && cliArgs[1] === 'list') return { status: 0, stdout: JSON.stringify([{ id: channelId }]) };
      if (cliArgs[0] === 'channels' && cliArgs[1] === 'get') return { status: 0, stdout: JSON.stringify({
        id: channelId,
        organizationId,
        service: 'instagram',
        displayName: 'Synthetic Release One Channel',
        timezone: 'America/Phoenix',
        allowedActions: ['read'],
        isDisconnected: false,
        isLocked: false,
        isQueuePaused: false,
      }) };
      return { status: 97, stderr: 'non-read command rejected by proof runner' };
    };
    const runtime = createBufferReadRuntime(join(scratch, 'isolated-buffer-config'), spawn);

    connectBuffer(project, { organizationId, credentialRef: 'env:BUFFER_RELEASE_ONE_TEST_KEY', confirmWrite: true }, { BUFFER_RELEASE_ONE_TEST_KEY: credential }, runtime);
    const synced = syncBufferChannels(project, { confirmWrite: true }, { env: { BUFFER_RELEASE_ONE_TEST_KEY: credential }, runtime });

    const normalized = invocations.map(({ args }) => args[0] === 'schema' && args[1] === 'describe' ? 'schema describe' : args.slice(0, 2).join(' '));
    expect(invocations.length).toBeGreaterThan(0);
    expect(normalized.every(command => (BUFFER_READ_ALLOWLIST as readonly string[]).includes(command))).toBe(true);
    expect(normalized).toContain('channels list');
    expect(normalized).toContain('channels get');
    expect(invocations.every(({ command }) => command === process.execPath)).toBe(true);
    expect(invocations.some(({ args }) => args[0] === 'posts' || args[0] === 'updates')).toBe(false);
    expect(() => runtime.run('posts create', { apiKey: credential, channelId })).toThrow('mutation rejected before invocation');
    expect(invocations.map(({ args }) => args.join(' ')).join('\n')).not.toContain(credential);

    expect(synced.channels).toEqual([expect.objectContaining({ channel_id: channelId, display_name: 'Synthetic Release One Channel', available: true })]);
    expect(listBufferChannels(otherProject)).toEqual([]);
    expect(getBufferConnection(otherProject)).toBeNull();
    const database = lineageDb();
    try {
      const persisted = JSON.stringify({
        connections: database.prepare('select project_id, organization_id, credential_ref, health_state from buffer_connections order by project_id').all(),
        channels: database.prepare('select project_id, channel_id, organization_id, service, display_name from buffer_channels order by project_id, channel_id').all(),
      });
      expect(persisted).not.toContain(credential);
      expect(persisted).toContain('env:BUFFER_RELEASE_ONE_TEST_KEY');
      expect(persisted).not.toContain(otherProject);
    } finally { database.close(); }
  });
});
