import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { defaultProject, packageRoot } from '../../assetCore';
import { lineageDb, nowIso } from '../../assetLineageDb';
import { BUFFER_CAPABILITY_REGISTRY_VERSION, bufferChannelCapability } from './bufferCapabilities';
import { assertBufferConnectionFingerprint, BufferConnectionError, getBufferConnection, resolveBufferCredential } from './bufferConnection';
import { createBufferReadRuntime, type BufferReadRuntime } from './bufferRuntime';

type ProviderChannel = Record<string, unknown>;
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function bool(value: unknown): boolean { return value === true; }
function listPayload(payload: unknown): ProviderChannel[] {
  if (Array.isArray(payload)) return payload.filter(value => value && typeof value === 'object') as ProviderChannel[];
  if (payload && typeof payload === 'object') {
    const value = payload as Record<string, unknown>;
    for (const key of ['channels', 'data', 'items']) if (Array.isArray(value[key])) return value[key] as ProviderChannel[];
  }
  throw new BufferConnectionError('Buffer channel list response was incompatible');
}
function channelPayload(payload: unknown): ProviderChannel {
  if (payload && typeof payload === 'object') {
    const value = payload as Record<string, unknown>;
    if (value.channel && typeof value.channel === 'object') return value.channel as ProviderChannel;
    return value;
  }
  throw new BufferConnectionError('Buffer channel response was incompatible');
}
function safeJson(value: unknown): string { return JSON.stringify(value ?? null); }

export interface BufferChannelRecord {
  channel_id: string;
  service: string;
  service_id: string | null;
  display_name: string;
  avatar_ref: string | null;
  timezone: string | null;
  disconnected: boolean;
  locked: boolean;
  paused: boolean;
  available: boolean;
  capability: ReturnType<typeof bufferChannelCapability>;
  synced_at: string;
  stale_at: string | null;
}

export function listBufferChannels(project = defaultProject): BufferChannelRecord[] {
  const database = lineageDb();
  try {
    return database.prepare(`select channel_id, service, service_id, display_name, avatar_ref, timezone, disconnected, locked, paused, available, capability_json, synced_at, stale_at
      from buffer_channels where project_id = ? order by display_name, channel_id`).all(project).map(row => {
        const value = row as Record<string, unknown>;
        const { capability_json: _capabilityJson, ...safe } = value;
        return { ...safe, disconnected: value.disconnected === 1, locked: value.locked === 1, paused: value.paused === 1, available: value.available === 1, capability: JSON.parse(String(value.capability_json)) } as unknown as BufferChannelRecord;
      });
  } finally { database.close(); }
}

export function syncBufferChannels(project = defaultProject, fields: { confirmWrite: boolean }, deps: { env?: NodeJS.ProcessEnv; runtime?: BufferReadRuntime } = {}) {
  if (!fields.confirmWrite) throw new BufferConnectionError('Buffer channel sync requires confirmWrite=true');
  const connection = getBufferConnection(project);
  if (!connection) throw new BufferConnectionError('Buffer is not connected for this project', 409);
  const database = lineageDb();
  const enabled = (() => {
    try { return (database.prepare("select enabled from adapter_settings where project_id=? and adapter_type='scheduler' and provider='buffer'").get(project) as { enabled: number } | undefined)?.enabled === 1; }
    finally { database.close(); }
  })();
  if (!enabled) throw new BufferConnectionError('Buffer adapter is disabled', 409);
  const apiKey = resolveBufferCredential(connection.credential_ref, deps.env);
  if (!apiKey) throw new BufferConnectionError('Buffer credential is unavailable', 409);
  const runtime = deps.runtime || createBufferReadRuntime(join(packageRoot, '.lineage', 'buffer-config'));
  assertBufferConnectionFingerprint(connection, runtime.verify());
  const summaries = listPayload(runtime.listChannels(connection.organization_id, apiKey));
  const details = summaries.map(summary => channelPayload(runtime.getChannel(text(summary.id), apiKey)));
  if (details.some(channel => text(channel.organizationId) !== connection.organization_id)) throw new BufferConnectionError('Buffer organization mismatch', 409);
  const timestamp = nowIso();
  const writeDb = lineageDb();
  try {
    writeDb.exec('begin immediate');
    writeDb.prepare('update buffer_channels set available=0, stale_at=? where project_id=?').run(timestamp, project);
    for (const channel of details) {
      const capability = bufferChannelCapability(text(channel.service));
      const disconnected = bool(channel.isDisconnected); const locked = bool(channel.isLocked); const paused = bool(channel.isQueuePaused) || bool((channel.postingSchedule as Record<string, unknown> | undefined)?.paused);
      const providerFingerprint = createHash('sha256').update(safeJson(channel)).digest('hex');
      writeDb.prepare(`insert into buffer_channels (project_id, channel_id, organization_id, service, service_id, display_name, avatar_ref, timezone, posting_schedule_json, allowed_actions_json, capability_json, disconnected, locked, paused, available, capability_registry_version, provider_fingerprint, synced_at, stale_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)
        on conflict(project_id, channel_id) do update set organization_id=excluded.organization_id, service=excluded.service, service_id=excluded.service_id, display_name=excluded.display_name, avatar_ref=excluded.avatar_ref, timezone=excluded.timezone, posting_schedule_json=excluded.posting_schedule_json, allowed_actions_json=excluded.allowed_actions_json, capability_json=excluded.capability_json, disconnected=excluded.disconnected, locked=excluded.locked, paused=excluded.paused, available=excluded.available, capability_registry_version=excluded.capability_registry_version, provider_fingerprint=excluded.provider_fingerprint, synced_at=excluded.synced_at, stale_at=null`)
        .run(project, text(channel.id), connection.organization_id, text(channel.service), text(channel.serviceId) || null, text(channel.displayName) || text(channel.name), text(channel.avatar) || null, text(channel.timezone) || null, safeJson(channel.postingSchedule), safeJson(channel.allowedActions), safeJson(capability), disconnected ? 1 : 0, locked ? 1 : 0, paused ? 1 : 0, disconnected || locked ? 0 : 1, BUFFER_CAPABILITY_REGISTRY_VERSION, providerFingerprint, timestamp);
    }
    writeDb.prepare('update buffer_connections set channel_synced_at=?, health_state=\'connected\', updated_at=? where project_id=?').run(timestamp, timestamp, project);
    writeDb.exec('commit');
  } catch (error) { try { writeDb.exec('rollback'); } catch { /* transaction was not active */ } throw error; }
  finally { writeDb.close(); }
  return { project, synced_at: timestamp, channels: listBufferChannels(project) };
}
