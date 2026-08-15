import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { repoRoot } from '../../assetCore';
import { useLineageTestProfile } from '../../../test/lineageTestProfile';
import { BUFFER_CLI_VERSION, BUFFER_SCHEMA_HASHES, type BufferReadRuntime } from './bufferRuntime';
import { BUFFER_SCHEMA_FINGERPRINT, connectBuffer, getBufferConnection, resolveBufferCredential } from './bufferConnection';

const generated = (scope: string) => `synthetic-${createHash('sha256').update(scope).digest('hex')}`;
const verifiedRuntime = (overrides: Partial<ReturnType<BufferReadRuntime['verify']>> = {}): BufferReadRuntime => ({
  verify: () => ({ cli_path: '/synthetic/package-local-cli', cli_version: BUFFER_CLI_VERSION, schema_fingerprint: BUFFER_SCHEMA_FINGERPRINT, schema_hashes: BUFFER_SCHEMA_HASHES, ...overrides }),
  run: () => { throw new Error('read not expected'); }, listChannels: () => [], getChannel: () => ({}),
});
describe('Buffer project connection', () => {
  beforeEach(() => useLineageTestProfile(join(repoRoot, '.asset-scratch', 'vitest-buffer-connection.sqlite')));
  it('stores one project-scoped organization and reference without persisting a secret', () => {
    const organizationId = generated('organization'); const secret = generated('secret');
    const connection = connectBuffer('project-a', { organizationId, credentialRef: 'env:BUFFER_TEST_KEY', confirmWrite: true }, { BUFFER_TEST_KEY: secret }, verifiedRuntime());
    connectBuffer('project-b', { organizationId: generated('other-organization'), credentialRef: 'env:BUFFER_TEST_KEY', confirmWrite: true }, { BUFFER_TEST_KEY: secret }, verifiedRuntime());
    expect(connection).toMatchObject({ project: 'project-a', organization_id: organizationId, credential_ref: 'env:BUFFER_TEST_KEY', health_state: 'connected' });
    expect(getBufferConnection('project-b')?.organization_id).not.toBe(organizationId);
    expect(JSON.stringify([connection, getBufferConnection('project-a')])).not.toContain(secret);
  });
  it('requires confirmation and migrates only the legacy credential reference', () => {
    expect(() => connectBuffer('project-a', { organizationId: generated('organization'), confirmWrite: false })).toThrow('confirmWrite=true');
    const connection = connectBuffer('project-a', { organizationId: generated('organization'), confirmWrite: true }, { LINEAGE_SCHEDULER_TOKEN: generated('legacy-secret') }, verifiedRuntime());
    expect(connection.credential_ref).toBe('env:LINEAGE_SCHEDULER_TOKEN');
    expect(resolveBufferCredential(connection.credential_ref, {})).toBeNull();
  });

  it('uses the CLI credential environment reference when no legacy reference is available', () => {
    const connection = connectBuffer('project-default-reference', { organizationId: generated('default-reference-organization'), confirmWrite: true }, {}, verifiedRuntime());
    expect(connection).toMatchObject({ credential_ref: `env:${['BUFFER', 'API', 'KEY'].join('_')}`, health_state: 'credential_missing' });
  });

  it('binds credential reference identity into the one-way connection fingerprint', () => {
    const organizationId = generated('fingerprint-organization');
    const first = connectBuffer('project-fingerprint', { organizationId, credentialRef: 'env:BUFFER_REFERENCE_A', confirmWrite: true }, { BUFFER_REFERENCE_A: generated('reference-a-secret') }, verifiedRuntime());
    const second = connectBuffer('project-fingerprint', { organizationId, credentialRef: 'env:BUFFER_REFERENCE_B', confirmWrite: true }, { BUFFER_REFERENCE_B: generated('reference-b-secret') }, verifiedRuntime());
    expect(second.connection_fingerprint).not.toBe(first.connection_fingerprint);
    expect(second.connection_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second.connection_fingerprint).not.toContain(second.credential_ref);
  });

  it('rejects an unverified runtime before any connection write', () => {
    expect(() => connectBuffer('project-unverified', { organizationId: generated('organization'), confirmWrite: true }, {}, verifiedRuntime({ cli_version: 'unexpected' }))).toThrow('runtime fingerprint mismatch');
    expect(getBufferConnection('project-unverified')).toBeNull();
  });
});
