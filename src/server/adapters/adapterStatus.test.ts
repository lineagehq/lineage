import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, repoRoot } from '../assetCore';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { BUFFER_SCHEMA_FINGERPRINT, connectBuffer } from './buffer/bufferConnection';
import { BUFFER_CLI_VERSION, BUFFER_SCHEMA_HASHES, type BufferReadRuntime } from './buffer/bufferRuntime';
import { syncBufferChannels } from './buffer/bufferChannelSync';
import { getAdapterStatus } from './adapterStatus';

describe('adapter status', () => {
  const dbFile = join(repoRoot, '.asset-scratch', 'vitest-adapter-status.sqlite');
  beforeEach(() => {
    rmSync(dbFile, { force: true });
    useLineageTestProfile(dbFile);
  });
  it('reports local fallback storage and dry-run-only Buffer posting adapters without credentials', () => {
    const status = getAdapterStatus(defaultProject, {});

    expect(status.project).toBe(defaultProject);
    expect(status.storage).toEqual([
      expect.objectContaining({
        can_list: true,
        can_upload: false,
        configured: true,
        mode: 'public-fallback-catalog',
        provider: 'local',
      }),
    ]);
    expect(status.posting).toEqual([
      {
        can_dry_run: true,
        can_post: false,
        configured: false,
        missing: ['LINEAGE_SCHEDULER_TOKEN', 'LINEAGE_SCHEDULER_ORGANIZATION_ID'],
        mode: 'dry-run-only',
        provider: 'buffer',
      },
    ]);
    expect(status.buffer_connection).toBeNull();
  });

  it('reports Buffer configured status while keeping live posting disabled', () => {
    const status = getAdapterStatus(defaultProject, { LINEAGE_SCHEDULER_TOKEN: 'token', LINEAGE_SCHEDULER_ORGANIZATION_ID: 'org' });

    expect(status.posting[0]).toMatchObject({
      can_dry_run: true,
      can_post: false,
      configured: true,
      missing: [],
      provider: 'buffer',
    });
  });

  it('reports only the selected project connection while preserving dry-run-only posting status', () => {
    const generated = (scope: string) => `synthetic-${createHash('sha256').update(scope).digest('hex')}`;
    const runtime: BufferReadRuntime = { verify: () => ({ cli_path: '/synthetic/package-local-cli', cli_version: BUFFER_CLI_VERSION, schema_fingerprint: BUFFER_SCHEMA_FINGERPRINT, schema_hashes: BUFFER_SCHEMA_HASHES }), run: () => null, listChannels: () => [], getChannel: () => ({}) };
    const env = { BUFFER_TEST_KEY: generated('credential') };
    connectBuffer('project-a', { organizationId: generated('organization-a'), credentialRef: 'env:BUFFER_TEST_KEY', confirmWrite: true }, env, runtime);
    connectBuffer('project-b', { organizationId: generated('organization-b'), credentialRef: 'env:BUFFER_TEST_KEY', confirmWrite: true }, env, runtime);
    expect(getAdapterStatus('project-a', env).buffer_connection).toMatchObject({ connected: true, organization_id: generated('organization-a'), cli_version: BUFFER_CLI_VERSION });
    expect(getAdapterStatus('project-b', env).buffer_connection).toMatchObject({ connected: true, organization_id: generated('organization-b'), cli_version: BUFFER_CLI_VERSION });
    expect(getAdapterStatus('project-a', env).buffer_connection?.organization_id).not.toBe(getAdapterStatus('project-b', env).buffer_connection?.organization_id);
    expect(getAdapterStatus('project-a', env).posting[0]).toMatchObject({ can_dry_run: true, can_post: false });
  });

  it('summarizes credential, compatibility, current, disconnected, and stale channel status without provider payloads', () => {
    const generated = (scope: string) => `synthetic-${createHash('sha256').update(scope).digest('hex')}`;
    const organizationId = generated('status-organization');
    const env = { SYNTHETIC_BUFFER_KEY: generated('status-credential') };
    let includeDisconnected = true;
    const runtime: BufferReadRuntime = {
      verify: () => ({ cli_path: '/synthetic/package-local-cli', cli_version: BUFFER_CLI_VERSION, schema_fingerprint: BUFFER_SCHEMA_FINGERPRINT, schema_hashes: BUFFER_SCHEMA_HASHES }),
      run: () => null,
      listChannels: () => [{ id: generated('available-channel') }, ...(includeDisconnected ? [{ id: generated('disconnected-channel') }] : [])],
      getChannel: channelId => ({
        id: channelId,
        organizationId,
        service: 'synthetic-image-service',
        displayName: channelId === generated('available-channel') ? 'Available channel' : 'Disconnected channel',
        isDisconnected: channelId === generated('disconnected-channel'),
      }),
    };
    connectBuffer(defaultProject, { organizationId, credentialRef: 'env:SYNTHETIC_BUFFER_KEY', confirmWrite: true }, env, runtime);
    syncBufferChannels(defaultProject, { confirmWrite: true }, { env, runtime });
    includeDisconnected = false;
    syncBufferChannels(defaultProject, { confirmWrite: true }, { env, runtime });

    const status = getAdapterStatus(defaultProject, env);
    expect(status.buffer_connection).toMatchObject({
      available_channel_count: 1,
      channel_count: 2,
      cli_version: BUFFER_CLI_VERSION,
      connected: true,
      credential_detected: true,
      credential_environment: 'SYNTHETIC_BUFFER_KEY',
      disconnected_channel_count: 1,
      health_state: 'connected',
      organization_id: organizationId,
      stale_channel_count: 1,
    });
    expect(JSON.stringify(status)).not.toContain(env.SYNTHETIC_BUFFER_KEY);
    expect(JSON.stringify(status)).not.toContain('schema_fingerprint');
    expect(JSON.stringify(status)).not.toContain('providerFingerprint');
  });

  it('normalizes a missing runtime credential to a safe connection state', () => {
    const generated = (scope: string) => `synthetic-${createHash('sha256').update(scope).digest('hex')}`;
    const runtime: BufferReadRuntime = { verify: () => ({ cli_path: '/synthetic/package-local-cli', cli_version: BUFFER_CLI_VERSION, schema_fingerprint: BUFFER_SCHEMA_FINGERPRINT, schema_hashes: BUFFER_SCHEMA_HASHES }), run: () => null, listChannels: () => [], getChannel: () => ({}) };
    connectBuffer(defaultProject, { organizationId: generated('missing-credential-organization'), credentialRef: 'env:SYNTHETIC_BUFFER_KEY', confirmWrite: true }, { SYNTHETIC_BUFFER_KEY: 'only-present-during-connect' }, runtime);

    expect(getAdapterStatus(defaultProject, {}).buffer_connection).toMatchObject({
      connected: false,
      credential_detected: false,
      credential_environment: 'SYNTHETIC_BUFFER_KEY',
      health_state: 'credential_missing',
    });
  });
});
