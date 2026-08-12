import { AlertCircle, CheckCircle2, Cloud, ImagePlus, Loader2, RefreshCcw, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { adapterCatalog, findAdapterCatalogEntry } from '../../shared/adapterCatalog';
import type { AdapterSetting, AdapterSettingsSnapshot, AdapterStatusSnapshot, AdapterType, BufferConnectionStatus } from '../../shared/adapterSettingsTypes';
import type { LineageRuntimeInfo } from '../../shared/runtimeInfoTypes';
import { api } from '../api';
import { lineageReleaseInfo } from '../releaseInfo';
import './SettingsView.css';

const iconFor: Record<AdapterType, typeof Cloud> = {
  cloud: Cloud,
  image_generator: ImagePlus,
  scheduler: Send,
};

const titleFor = Object.fromEntries(
  adapterCatalog.map(entry => [entry.adapterType, entry.capabilityLabel]),
) as Record<AdapterType, string>;

const sections: Array<{ adapterType: AdapterType; ariaLabel: string }> = [
  { adapterType: 'cloud', ariaLabel: 'Cloud storage settings' },
  { adapterType: 'scheduler', ariaLabel: 'Social scheduling settings' },
  { adapterType: 'image_generator', ariaLabel: 'Image generation settings' },
];

const defaultCredentialEnvironment = ['BUFFER', 'API', 'KEY'].join('_');
const refreshFailureMessage = 'Settings could not be refreshed for this project. Verify the active runtime and try again.';
const connectFailureMessage = 'Buffer connection could not be saved. Verify the organization and credential environment, then try again.';
const syncFailureMessage = 'Buffer channels could not be synchronized. Verify the connection and try again.';
const toggleFailureMessage = 'Adapter setting could not be updated. Refresh and try again.';

function valueText(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value || 'not set';
  return JSON.stringify(value);
}

function configEntries(setting: AdapterSetting) {
  return Object.entries(setting.safe_config).filter(([key]) => !['secret', 'token', 'password', 'credential', 'apiKey'].includes(key));
}

function statusClass(setting: AdapterSetting) {
  if (setting.health_status === 'configured') return 'ok';
  if (setting.health_status === 'missing_config') return 'warn';
  return 'muted';
}

function bufferIssue(connection: BufferConnectionStatus | null): string {
  if (!connection) return 'Not connected. Connect selects one organization and a credential environment reference for this project.';
  if (!connection.credential_detected) return `Credential unavailable in ${connection.credential_environment}. Set it in the active Lineage service environment, then refresh.`;
  if (connection.health_state === 'organization_mismatch') return 'Organization mismatch. Reconnect with the intended organization before synchronizing channels.';
  if (!connection.channel_synced_at) return 'Connected, but channels have not been synchronized.';
  if (connection.stale_channel_count > 0 || connection.disconnected_channel_count > 0) {
    const issues = [
      connection.stale_channel_count > 0 ? `${connection.stale_channel_count} stale and unavailable until a successful sync` : '',
      connection.disconnected_channel_count > 0 ? `${connection.disconnected_channel_count} disconnected and unavailable for composition` : '',
    ].filter(Boolean);
    return `Channel catalog needs attention: ${issues.join('; ')}.`;
  }
  return 'Connection and local channel catalog are current.';
}

function Switch(props: { checked: boolean; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button
      aria-checked={props.checked}
      aria-label={props.label}
      className={`settings-switch ${props.checked ? 'on' : ''}`}
      disabled={props.disabled}
      onClick={props.onClick}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

export function SettingsView(props: { project: string; onToast: (type: 'ok' | 'error', message: string) => void }) {
  const projectEpoch = useRef({ epoch: 0, project: props.project });
  const refreshSequence = useRef(0);
  const bufferActionSequence = useRef(0);
  const toggleActionSequences = useRef(new Map<string, number>());
  if (projectEpoch.current.project !== props.project) {
    projectEpoch.current = { epoch: projectEpoch.current.epoch + 1, project: props.project };
    refreshSequence.current += 1;
    bufferActionSequence.current += 1;
  }
  const currentEpoch = projectEpoch.current.epoch;
  const [snapshot, setSnapshot] = useState<AdapterSettingsSnapshot | null>(null);
  const [adapterStatus, setAdapterStatus] = useState<AdapterStatusSnapshot | null>(null);
  const [runtime, setRuntime] = useState<LineageRuntimeInfo | null>(null);
  const [settledEpoch, setSettledEpoch] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ epoch: number; message: string } | null>(null);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set());
  const [bufferAction, setBufferAction] = useState<'connect' | 'sync' | ''>('');
  const [organizationId, setOrganizationId] = useState('');
  const [credentialEnvironment, setCredentialEnvironment] = useState(defaultCredentialEnvironment);
  const [formEpoch, setFormEpoch] = useState(currentEpoch);

  function isCurrent(project: string, epoch: number): boolean {
    return projectEpoch.current.project === project && projectEpoch.current.epoch === epoch;
  }

  async function refresh(project = props.project, epoch = projectEpoch.current.epoch) {
    const sequence = ++refreshSequence.current;
    setLoading(true);
    setLoadError(null);
    setSnapshot(null);
    setAdapterStatus(null);
    setRuntime(null);
    setSettledEpoch(-1);
    try {
      const [settings, status, runtimeInfo] = await Promise.all([
        api<AdapterSettingsSnapshot>(`/api/adapters/settings?project=${encodeURIComponent(project)}`),
        api<AdapterStatusSnapshot>(`/api/adapters/status?project=${encodeURIComponent(project)}`),
        api<{ runtime: LineageRuntimeInfo }>('/api/runtime'),
      ]);
      if (!isCurrent(project, epoch) || refreshSequence.current !== sequence) return;
      setSnapshot(settings);
      setAdapterStatus(status);
      setRuntime(runtimeInfo.runtime);
      setOrganizationId(status.buffer_connection?.organization_id || '');
      setCredentialEnvironment(status.buffer_connection?.credential_environment || defaultCredentialEnvironment);
      setFormEpoch(epoch);
      setSettledEpoch(epoch);
    } catch {
      if (!isCurrent(project, epoch) || refreshSequence.current !== sequence) return;
      setLoadError({ epoch, message: refreshFailureMessage });
      props.onToast('error', refreshFailureMessage);
    } finally {
      if (isCurrent(project, epoch) && refreshSequence.current === sequence) setLoading(false);
    }
  }

  async function connectBuffer() {
    const project = props.project;
    const epoch = projectEpoch.current.epoch;
    const action = ++bufferActionSequence.current;
    const currentOrganization = formEpoch === epoch ? organizationId : '';
    const environment = (formEpoch === epoch ? credentialEnvironment : defaultCredentialEnvironment).trim();
    if (!currentOrganization.trim()) {
      props.onToast('error', 'Buffer organization ID is required');
      return;
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(environment)) {
      props.onToast('error', 'Credential environment must be an uppercase environment-variable name');
      return;
    }
    setBufferAction('connect');
    try {
      await api('/api/adapters/buffer/connection', {
        body: JSON.stringify({ confirmWrite: true, credentialRef: `env:${environment}`, organizationId: currentOrganization.trim(), project }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!isCurrent(project, epoch) || bufferActionSequence.current !== action) return;
      props.onToast('ok', 'Buffer connection saved locally. Sync channels separately to refresh the catalog.');
      await refresh(project, epoch);
    } catch {
      if (isCurrent(project, epoch) && bufferActionSequence.current === action) props.onToast('error', connectFailureMessage);
    } finally {
      if (isCurrent(project, epoch) && bufferActionSequence.current === action) setBufferAction('');
    }
  }

  async function syncBufferChannels() {
    const project = props.project;
    const epoch = projectEpoch.current.epoch;
    const action = ++bufferActionSequence.current;
    setBufferAction('sync');
    try {
      await api('/api/adapters/buffer/channels', {
        body: JSON.stringify({ confirmWrite: true, project }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!isCurrent(project, epoch) || bufferActionSequence.current !== action) return;
      props.onToast('ok', 'Buffer channel catalog synchronized');
      await refresh(project, epoch);
    } catch {
      if (isCurrent(project, epoch) && bufferActionSequence.current === action) props.onToast('error', syncFailureMessage);
    } finally {
      if (isCurrent(project, epoch) && bufferActionSequence.current === action) setBufferAction('');
    }
  }

  async function toggle(setting: AdapterSetting) {
    const project = props.project;
    const epoch = projectEpoch.current.epoch;
    const key = `${setting.adapter_type}:${setting.provider}`;
    const action = (toggleActionSequences.current.get(key) || 0) + 1;
    toggleActionSequences.current.set(key, action);
    setSavingKeys(current => new Set(current).add(key));
    try {
      const result = await api<{ setting: AdapterSetting }>(`/api/adapters/settings/${setting.adapter_type}/${setting.provider}`, {
        body: JSON.stringify({
          confirmWrite: true,
          enabled: !setting.enabled,
          project,
          safeConfig: setting.safe_config,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!isCurrent(project, epoch) || toggleActionSequences.current.get(key) !== action) return;
      props.onToast('ok', `${titleFor[setting.adapter_type]} ${result.setting.enabled ? 'enabled' : 'disabled'}`);
      await refresh(project, epoch);
    } catch {
      if (isCurrent(project, epoch) && toggleActionSequences.current.get(key) === action) props.onToast('error', toggleFailureMessage);
    } finally {
      if (isCurrent(project, epoch) && toggleActionSequences.current.get(key) === action) {
        setSavingKeys(current => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    }
  }

  useEffect(() => {
    const epoch = projectEpoch.current.epoch;
    setSnapshot(null);
    setAdapterStatus(null);
    setRuntime(null);
    setSettledEpoch(-1);
    setLoadError(null);
    setSavingKeys(new Set());
    setBufferAction('');
    setOrganizationId('');
    setCredentialEnvironment(defaultCredentialEnvironment);
    setFormEpoch(epoch);
    void refresh(props.project, epoch);
  }, [props.project]);

  const hasCurrentData = settledEpoch === currentEpoch;
  const currentSnapshot = hasCurrentData ? snapshot : null;
  const currentStatus = hasCurrentData ? adapterStatus : null;
  const currentRuntime = hasCurrentData ? runtime : null;
  const currentLoadError = loadError?.epoch === currentEpoch ? loadError.message : '';
  const currentOrganizationId = formEpoch === currentEpoch ? organizationId : '';
  const currentCredentialEnvironment = formEpoch === currentEpoch ? credentialEnvironment : defaultCredentialEnvironment;

  return (
    <section className="settings-view">
      <header className="settings-header">
        <div>
          <h2>Settings</h2>
          <p>Adapter switches, safe local preferences, and credential-source status for {props.project}.</p>
        </div>
        <button className="secondary-button" disabled={loading} onClick={() => void refresh()} type="button">
          {loading ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
          Refresh
        </button>
      </header>
      <div className="settings-sections">
        <section aria-label="Release information" className="settings-section">
          <h3>Release</h3>
          <dl className="settings-release">
            <div>
              <dt>Version</dt>
              <dd>{currentRuntime?.version || lineageReleaseInfo.version}</dd>
            </div>
            <div>
              <dt>Channel</dt>
              <dd>{currentRuntime?.channel || lineageReleaseInfo.channel}</dd>
            </div>
            <div>
              <dt>Profile</dt>
              <dd>{currentRuntime?.profile.id || 'loading'}</dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>{currentRuntime?.profile.environment || 'loading'}</dd>
            </div>
            <div>
              <dt>Binding</dt>
              <dd>{currentRuntime ? (currentRuntime.profile.bound ? 'bound' : 'legacy unbound') : 'loading'}</dd>
            </div>
            <div>
              <dt>Git</dt>
              <dd>{currentRuntime?.git_sha || 'not available'}</dd>
            </div>
            <div>
              <dt>Assets</dt>
              <dd className="settings-path">{currentRuntime?.asset_root || 'loading'}</dd>
            </div>
            <div>
              <dt>SQLite</dt>
              <dd className="settings-path">{currentRuntime?.database.path || 'loading'}</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{currentRuntime?.database.exists ? `${currentRuntime.database.projects ?? 0} projects / ${currentRuntime.database.workspaces ?? 0} workspaces` : currentRuntime ? 'not created yet' : 'loading'}</dd>
            </div>
            <div>
              <dt>Schema</dt>
              <dd>{currentRuntime ? `${currentRuntime.schema.migration_keys.length} migration marker(s)` : 'loading'}</dd>
            </div>
          </dl>
        </section>
        {sections.map(section => (
          <section aria-label={section.ariaLabel} className="settings-section" key={section.adapterType}>
            <h3>{titleFor[section.adapterType]}</h3>
            <div className="settings-grid">
              {(currentSnapshot?.settings || []).filter(setting => setting.adapter_type === section.adapterType).map(setting => {
                const Icon = iconFor[setting.adapter_type];
                const catalogEntry = findAdapterCatalogEntry(setting.adapter_type, setting.provider);
                const switchLabel = `Enable ${setting.label === 'Buffer' ? 'Buffer scheduling' : setting.label}`;
                const saving = savingKeys.has(`${setting.adapter_type}:${setting.provider}`);
                const bufferConnection = setting.provider === 'buffer' ? currentStatus?.buffer_connection || null : null;
                const postingStatus = setting.provider === 'buffer' ? currentStatus?.posting?.find(item => item.provider === 'buffer') : undefined;
                return (
                  <article className="settings-card" key={`${setting.adapter_type}:${setting.provider}`}>
                    <div className="settings-card-head">
                      <span className="settings-icon"><Icon size={19} /></span>
                      <div>
                        <h4>{setting.label}</h4>
                        <p>{setting.description}</p>
                      </div>
                      <Switch checked={setting.enabled} disabled={saving} label={switchLabel} onClick={() => void toggle(setting)} />
                    </div>
                    <dl className="settings-meta">
                      <div>
                        <dt>Status</dt>
                        <dd className={statusClass(setting)}>
                          {setting.health_status === 'configured' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                          {setting.health_status.replace(/_/g, ' ')}
                        </dd>
                      </div>
                      <div>
                        <dt>Maturity</dt>
                        <dd>{catalogEntry.maturity}</dd>
                      </div>
                      <div>
                        <dt>Credential source</dt>
                        <dd>{setting.credential.label}</dd>
                      </div>
                      <div>
                        <dt>Credential reference</dt>
                        <dd>{setting.credential.secret_ref || 'none'}</dd>
                      </div>
                    </dl>
                    {configEntries(setting).length > 0 && (
                      <div className="settings-config">
                        {configEntries(setting).map(([key, value]) => (
                          <span key={key}><strong>{key}</strong>{valueText(value)}</span>
                        ))}
                      </div>
                    )}
                    {setting.provider === 'buffer' && (
                      <div className="settings-section" aria-label="Buffer connection and channel sync">
                        <h4>Release 1 connection and channel catalog</h4>
                        <p role="status">{bufferIssue(bufferConnection)}</p>
                        <dl className="settings-meta">
                          <div><dt>Compatibility</dt><dd>{bufferConnection ? `Buffer CLI ${bufferConnection.cli_version} pinned` : 'Available after Connect'}</dd></div>
                          <div><dt>Credential detected</dt><dd>{bufferConnection?.credential_detected ? 'yes' : 'no'}</dd></div>
                          <div><dt>Organization</dt><dd>{bufferConnection?.organization_id || 'not selected'}</dd></div>
                          <div><dt>Channels</dt><dd>{bufferConnection ? `${bufferConnection.available_channel_count} available / ${bufferConnection.channel_count} synced · ${bufferConnection.stale_channel_count} stale · ${bufferConnection.disconnected_channel_count} disconnected` : 'not synced'}</dd></div>
                          <div><dt>Last sync</dt><dd>{bufferConnection?.channel_synced_at ? new Date(bufferConnection.channel_synced_at).toLocaleString() : 'never'}</dd></div>
                          <div><dt>Legacy posting adapter</dt><dd>{postingStatus?.mode === 'dry-run-only' && postingStatus.can_post === false ? 'dry-run only · live posting disabled' : 'dry-run only · live posting unavailable'}</dd></div>
                        </dl>
                        <label>
                          Organization ID
                          <input aria-label="Buffer organization ID" onChange={event => { setFormEpoch(currentEpoch); setOrganizationId(event.target.value); }} value={currentOrganizationId} />
                        </label>
                        <label>
                          Credential environment variable
                          <input aria-label="Buffer credential environment variable" onChange={event => { setFormEpoch(currentEpoch); setCredentialEnvironment(event.target.value); }} value={currentCredentialEnvironment} />
                        </label>
                        <div className="settings-config">
                          <button className="secondary-button" disabled={Boolean(bufferAction)} onClick={() => void connectBuffer()} type="button">
                            {bufferAction === 'connect' && <Loader2 className="spin" size={15} />}
                            Connect
                          </button>
                          <button className="secondary-button" disabled={Boolean(bufferAction) || !bufferConnection?.connected || !setting.enabled} onClick={() => void syncBufferChannels()} type="button">
                            {bufferAction === 'sync' && <Loader2 className="spin" size={15} />}
                            Sync channels
                          </button>
                        </div>
                        <p>Connect stores the organization and environment-variable reference locally. Sync channels is a separate confirmed local catalog update using Buffer reads only. Neither action schedules, uploads, or publishes anything.</p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
        {loading && !currentSnapshot && <div className="settings-loading">Loading settings...</div>}
        {currentLoadError && <div className="settings-loading" role="alert">{currentLoadError}</div>}
      </div>
    </section>
  );
}
