import { defaultProject, listProjects } from '../assetCore';
import { lineageDb, nowIso, type DatabaseSync } from '../assetLineageDb';
import { findAdapterCatalogEntry } from '../../shared/adapterCatalog';
import type { AdapterProvider, AdapterSetting, AdapterSettingsSnapshot, AdapterType } from '../../shared/adapterSettingsTypes';

interface AdapterDefinition {
  adapter_type: AdapterType;
  default_enabled: boolean;
  description: string;
  label: string;
  provider: AdapterProvider;
  safeConfig(project: string): Record<string, unknown>;
  secret_ref: string | null;
}

interface AdapterSettingRow {
  adapter_type: AdapterType;
  enabled: number;
  provider: AdapterProvider;
  safe_config_json: string;
  secret_ref: string | null;
  updated_at: string;
}

export interface UpdateAdapterSettingFields {
  adapterType: AdapterType;
  confirmWrite: boolean;
  enabled: boolean;
  provider: AdapterProvider;
  safeConfig?: Record<string, unknown>;
}

export class AdapterSettingsError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isAdapterSettingsError(error: unknown): error is AdapterSettingsError {
  return error instanceof AdapterSettingsError;
}

const definitions: AdapterDefinition[] = [
  {
    adapter_type: 'cloud',
    default_enabled: false,
    description: findAdapterCatalogEntry('cloud', 's3').description,
    label: findAdapterCatalogEntry('cloud', 's3').providerLabel,
    provider: 's3',
    safeConfig: project => {
      if (project === defaultProject) return { bucket: '', mode: 'local-public-fallback', region: '' };
      const summary = listProjects().find(item => item.project === project);
      return { bucket: summary?.default_bucket || '', region: summary?.default_region || '' };
    },
    secret_ref: null,
  },
  {
    adapter_type: 'scheduler',
    default_enabled: false,
    description: findAdapterCatalogEntry('scheduler', 'buffer').description,
    label: findAdapterCatalogEntry('scheduler', 'buffer').providerLabel,
    provider: 'buffer',
    safeConfig: () => ({ defaultMode: 'dry-run' }),
    secret_ref: `env:${['BUFFER', 'API', 'KEY'].join('_')}`,
  },
  {
    adapter_type: 'image_generator',
    default_enabled: true,
    description: findAdapterCatalogEntry('image_generator', 'codex-handoff').description,
    label: findAdapterCatalogEntry('image_generator', 'codex-handoff').providerLabel,
    provider: 'codex-handoff',
    safeConfig: () => ({ clearSelectionAfterImport: true, defaultVariationCount: 3, receipts: 'sqlite' }),
    secret_ref: null,
  },
];

function ensureProject(database: DatabaseSync, project: string): void {
  const timestamp = nowIso();
  database.prepare(`
    insert into projects (id, product, created_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(id) do update set product = excluded.product, updated_at = excluded.updated_at
  `).run(project, project, timestamp, timestamp);
}

function definitionFor(adapterType: AdapterType, provider: AdapterProvider): AdapterDefinition {
  const definition = definitions.find(item => item.adapter_type === adapterType && item.provider === provider);
  if (!definition) throw new AdapterSettingsError(`Unsupported adapter setting: ${adapterType}/${provider}`, 404);
  return definition;
}

function seedDefaults(database: DatabaseSync, project: string): void {
  ensureProject(database, project);
  const timestamp = nowIso();
  for (const definition of definitions) {
    database.prepare(`
      insert into adapter_settings (
        project_id, adapter_type, provider, enabled, secret_ref, safe_config_json, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(project_id, adapter_type, provider) do nothing
    `).run(
      project,
      definition.adapter_type,
      definition.provider,
      definition.default_enabled ? 1 : 0,
      definition.secret_ref,
      JSON.stringify(definition.safeConfig(project)),
      timestamp,
      timestamp
    );
  }
}

function parseConfig(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function credentialFor(provider: AdapterProvider, env: NodeJS.ProcessEnv, secretRef: string | null = null) {
  if (provider === 's3') {
    return { detected: false, label: 'Optional local cloud CLI credential', secret_ref: null };
  }
  if (provider === 'buffer') {
    const resolvedRef = secretRef || `env:${['BUFFER', 'API', 'KEY'].join('_')}`;
    const key = /^env:([A-Z][A-Z0-9_]*)$/.exec(resolvedRef)?.[1];
    const detected = Boolean(key && env[key]);
    return { detected, label: `Credential reference ${resolvedRef}`, secret_ref: resolvedRef };
  }
  return { detected: true, label: 'No external secret required', secret_ref: null };
}

function healthStatus(provider: AdapterProvider, enabled: boolean, config: Record<string, unknown>, credential: ReturnType<typeof credentialFor>) {
  if (provider === 's3') {
    if (!enabled) return 'live_disabled';
    return config.bucket && config.region ? 'not_tested' : 'missing_config';
  }
  if (provider === 'buffer') {
    if (!enabled) return 'live_disabled';
    return credential.detected ? 'configured' : 'dry_run_available';
  }
  if (!enabled) return 'disabled';
  return credential.detected ? 'configured' : 'missing_config';
}

function settingFromRow(row: AdapterSettingRow, env: NodeJS.ProcessEnv): AdapterSetting {
  const definition = definitionFor(row.adapter_type, row.provider);
  const credential = credentialFor(row.provider, env, row.secret_ref);
  const enabled = row.enabled === 1;
  const safeConfig = parseConfig(row.safe_config_json);
  return {
    adapter_type: row.adapter_type,
    credential,
    description: definition.description,
    enabled,
    health_status: healthStatus(row.provider, enabled, safeConfig, credential),
    label: definition.label,
    provider: row.provider,
    safe_config: safeConfig,
    updated_at: row.updated_at,
  };
}

function rejectSecretLikeConfig(config: Record<string, unknown>): void {
  const blocked = ['secret', 'token', 'password', 'credential', 'api_key', 'apikey'];
  const visit = (value: unknown, path: string[]): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (blocked.some(term => normalized.includes(term.replace(/[^a-z0-9]/g, '')))) {
        throw new AdapterSettingsError(`Adapter settings cannot store secret-like keys: ${[...path, key].join('.')}`);
      }
      visit(child, [...path, key]);
    }
  };
  visit(config, []);
}

export function getAdapterSettings(project = defaultProject, env: NodeJS.ProcessEnv = process.env): AdapterSettingsSnapshot {
  const database = lineageDb();
  try {
    seedDefaults(database, project);
    const rows = database.prepare(`
      select adapter_type, provider, enabled, secret_ref, safe_config_json, updated_at
      from adapter_settings
      where project_id = ?
      order by case adapter_type when 'cloud' then 0 when 'scheduler' then 1 else 2 end
    `).all(project) as unknown as AdapterSettingRow[];
    return { fetchedAt: nowIso(), project, settings: rows.map(row => settingFromRow(row, env)) };
  } finally {
    database.close();
  }
}

export function updateAdapterSetting(project = defaultProject, fields: UpdateAdapterSettingFields, env: NodeJS.ProcessEnv = process.env): AdapterSetting {
  if (!fields.confirmWrite) throw new AdapterSettingsError('Adapter settings update requires confirmWrite=true');
  const definition = definitionFor(fields.adapterType, fields.provider);
  const database = lineageDb();
  try {
    seedDefaults(database, project);
    const current = database.prepare(`
      select safe_config_json, secret_ref from adapter_settings
      where project_id = ? and adapter_type = ? and provider = ?
    `).get(project, fields.adapterType, fields.provider) as { safe_config_json: string; secret_ref: string | null } | undefined;
    const safeConfig = fields.safeConfig || parseConfig(current?.safe_config_json || '{}') || definition.safeConfig(project);
    rejectSecretLikeConfig(safeConfig);
    const timestamp = nowIso();
    database.prepare(`
      update adapter_settings
      set enabled = ?, safe_config_json = ?, secret_ref = ?, updated_at = ?
      where project_id = ? and adapter_type = ? and provider = ?
    `).run(fields.enabled ? 1 : 0, JSON.stringify(safeConfig), current?.secret_ref ?? definition.secret_ref, timestamp, project, fields.adapterType, fields.provider);
    const row = database.prepare(`
      select adapter_type, provider, enabled, secret_ref, safe_config_json, updated_at
      from adapter_settings
      where project_id = ? and adapter_type = ? and provider = ?
    `).get(project, fields.adapterType, fields.provider) as unknown as AdapterSettingRow;
    return settingFromRow(row, env);
  } finally {
    database.close();
  }
}
