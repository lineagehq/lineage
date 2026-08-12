export type AdapterType = 'cloud' | 'scheduler' | 'image_generator';
export type AdapterProvider = 's3' | 'buffer' | 'codex-handoff';
type AdapterHealthStatus = 'configured' | 'missing_config' | 'disabled' | 'not_tested' | 'dry_run_available' | 'live_disabled';

interface AdapterCredentialStatus {
  detected: boolean;
  label: string;
  secret_ref: string | null;
}

export interface AdapterSetting {
  adapter_type: AdapterType;
  provider: AdapterProvider;
  enabled: boolean;
  label: string;
  description: string;
  health_status: AdapterHealthStatus;
  credential: AdapterCredentialStatus;
  safe_config: Record<string, unknown>;
  updated_at: string;
}

export interface AdapterSettingsSnapshot {
  project: string;
  fetchedAt: string;
  settings: AdapterSetting[];
}

export interface BufferConnectionStatus {
  available_channel_count: number;
  channel_count: number;
  channel_synced_at: string | null;
  cli_version: string;
  connected: boolean;
  credential_detected: boolean;
  credential_environment: string;
  disconnected_channel_count: number;
  health_state: 'connected' | 'credential_missing' | 'organization_mismatch';
  organization_id: string;
  stale_channel_count: number;
}

export interface AdapterStatusSnapshot {
  buffer_connection: BufferConnectionStatus | null;
  fetchedAt: string;
  posting: Array<{
    can_dry_run: boolean;
    can_post: boolean;
    configured: boolean;
    missing: string[];
    mode: 'dry-run-only';
    provider: string;
  }>;
  project: string;
  storage: Array<Record<string, unknown>>;
}
