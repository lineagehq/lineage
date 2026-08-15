import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { defaultProject, packageRoot } from '../../assetCore';
import { lineageDb, nowIso, type DatabaseSync } from '../../assetLineageDb';
import { BUFFER_CLI_VERSION, BUFFER_SCHEMA_HASHES, createBufferReadRuntime, type BufferReadRuntime, type BufferRuntimeEvidence } from './bufferRuntime';

export class BufferConnectionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function isBufferConnectionError(error: unknown): error is BufferConnectionError { return error instanceof BufferConnectionError; }

export interface BufferConnection {
  project: string;
  organization_id: string;
  credential_ref: string;
  cli_version: string;
  schema_fingerprint: string;
  connection_fingerprint: string;
  health_state: 'connected' | 'credential_missing' | 'organization_mismatch';
  channel_synced_at: string | null;
  updated_at: string;
}

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
const bufferCredentialEnvironmentKey = ['BUFFER', 'API', 'KEY'].join('_');
export const BUFFER_SCHEMA_FINGERPRINT = digest(BUFFER_SCHEMA_HASHES);
function bufferConnectionFingerprint(organizationId: string, credentialRef: string): string {
  return digest({ organizationId, credentialRef, cli: BUFFER_CLI_VERSION, schemas: BUFFER_SCHEMA_HASHES });
}
function legacyBufferConnectionFingerprint(organizationId: string): string {
  return digest({ organizationId, cli: BUFFER_CLI_VERSION, schemas: BUFFER_SCHEMA_HASHES });
}

function assertBufferRuntimeEvidence(evidence: BufferRuntimeEvidence): void {
  if (evidence.cli_version !== BUFFER_CLI_VERSION || evidence.schema_fingerprint !== BUFFER_SCHEMA_FINGERPRINT || JSON.stringify(evidence.schema_hashes) !== JSON.stringify(BUFFER_SCHEMA_HASHES)) {
    throw new BufferConnectionError('Buffer runtime fingerprint mismatch', 409);
  }
}

export function assertBufferConnectionFingerprint(connection: BufferConnection, evidence: BufferRuntimeEvidence): 'current' | 'legacy' {
  assertBufferRuntimeEvidence(evidence);
  if (connection.cli_version !== evidence.cli_version || connection.schema_fingerprint !== evidence.schema_fingerprint) {
    throw new BufferConnectionError('Stored Buffer connection fingerprint mismatch', 409);
  }
  if (connection.connection_fingerprint === bufferConnectionFingerprint(connection.organization_id, connection.credential_ref)) return 'current';
  if (connection.connection_fingerprint === legacyBufferConnectionFingerprint(connection.organization_id)) return 'legacy';
  throw new BufferConnectionError('Stored Buffer connection fingerprint mismatch', 409);
}

export function currentBufferConnectionFingerprint(connection: Pick<BufferConnection, 'organization_id' | 'credential_ref'>): string {
  return bufferConnectionFingerprint(connection.organization_id, connection.credential_ref);
}

function ensureProject(database: DatabaseSync, project: string): void {
  const timestamp = nowIso();
  database.prepare('insert into projects (id, product, created_at, updated_at) values (?, ?, ?, ?) on conflict(id) do update set updated_at=excluded.updated_at')
    .run(project, project, timestamp, timestamp);
}

function rowToConnection(project: string, row: Omit<BufferConnection, 'project'>): BufferConnection { return { project, ...row }; }

function getBufferConnectionInDatabase(database: DatabaseSync, project = defaultProject): BufferConnection | null {
  const row = database.prepare('select organization_id, credential_ref, cli_version, schema_fingerprint, connection_fingerprint, health_state, channel_synced_at, updated_at from buffer_connections where project_id = ?').get(project) as Omit<BufferConnection, 'project'> | undefined;
  return row ? rowToConnection(project, row) : null;
}

export function getBufferConnection(project = defaultProject): BufferConnection | null {
  const database = lineageDb();
  try {
    return getBufferConnectionInDatabase(database, project);
  } finally { database.close(); }
}

export function resolveBufferCredential(reference: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const match = /^env:([A-Z][A-Z0-9_]*)$/.exec(reference);
  if (!match) throw new BufferConnectionError('Buffer credential reference must name an environment variable');
  return env[match[1]] || null;
}

export function connectBuffer(project = defaultProject, fields: { organizationId: string; credentialRef?: string; confirmWrite: boolean }, env: NodeJS.ProcessEnv = process.env, runtime: BufferReadRuntime = createBufferReadRuntime(join(packageRoot, '.lineage', 'buffer-config'))): BufferConnection {
  if (!fields.confirmWrite) throw new BufferConnectionError('Buffer connection update requires confirmWrite=true');
  const organizationId = fields.organizationId.trim();
  if (!organizationId) throw new BufferConnectionError('Buffer organization ID is required');
  const credentialRef = fields.credentialRef || (env.LINEAGE_SCHEDULER_TOKEN ? 'env:LINEAGE_SCHEDULER_TOKEN' : `env:${bufferCredentialEnvironmentKey}`);
  resolveBufferCredential(credentialRef, {});
  assertBufferRuntimeEvidence(runtime.verify());
  const timestamp = nowIso();
  const fingerprint = bufferConnectionFingerprint(organizationId, credentialRef);
  const health = resolveBufferCredential(credentialRef, env) ? 'connected' : 'credential_missing';
  const database = lineageDb();
  try {
    ensureProject(database, project);
    database.prepare(`insert into buffer_connections (project_id, organization_id, credential_ref, cli_version, schema_fingerprint, connection_fingerprint, health_state, channel_synced_at, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, null, ?, ?)
      on conflict(project_id) do update set organization_id=excluded.organization_id, credential_ref=excluded.credential_ref, cli_version=excluded.cli_version, schema_fingerprint=excluded.schema_fingerprint, connection_fingerprint=excluded.connection_fingerprint, health_state=excluded.health_state, channel_synced_at=null, updated_at=excluded.updated_at`)
      .run(project, organizationId, credentialRef, BUFFER_CLI_VERSION, BUFFER_SCHEMA_FINGERPRINT, fingerprint, health, timestamp, timestamp);
    database.prepare(`insert into adapter_settings (project_id, adapter_type, provider, enabled, secret_ref, safe_config_json, created_at, updated_at)
      values (?, 'scheduler', 'buffer', 1, ?, '{"defaultMode":"dry-run"}', ?, ?)
      on conflict(project_id, adapter_type, provider) do update set enabled=1, secret_ref=excluded.secret_ref, updated_at=excluded.updated_at`)
      .run(project, credentialRef, timestamp, timestamp);
  } finally { database.close(); }
  return getBufferConnection(project)!;
}
