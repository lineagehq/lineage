import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { defaultProject, repoRoot } from '../assetCore';
import { lineageDb } from '../assetLineageDb';
import { getAdapterSettings, updateAdapterSetting } from './adapterSettings';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-adapter-settings');
const dbFile = join(scratchDir, 'adapter-settings.sqlite');

describe('adapter settings', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    useLineageTestProfile(dbFile);
  });

  it('creates safe default settings for each adapter type', () => {
    const snapshot = getAdapterSettings(defaultProject, {
      LINEAGE_CLOUD_PROFILE: 'local-cloud',
      LINEAGE_SCHEDULER_TOKEN: 'scheduler-secret',
      LINEAGE_SCHEDULER_ORGANIZATION_ID: 'scheduler-org',
    });

    expect(snapshot.settings.map(setting => [setting.adapter_type, setting.provider, setting.enabled])).toEqual([
      ['cloud', 's3', false],
      ['scheduler', 'buffer', false],
      ['image_generator', 'codex-handoff', true],
    ]);
    expect(snapshot.settings.find(setting => setting.provider === 's3')).toMatchObject({
      credential: { detected: false, label: 'Optional local cloud CLI credential', secret_ref: null },
      label: 'Amazon S3',
      health_status: 'live_disabled',
      safe_config: { bucket: '', mode: 'local-public-fallback', region: '' },
    });
    expect(snapshot.settings.find(setting => setting.provider === 'buffer')).toMatchObject({
      credential: { detected: false, label: `Credential reference env:${['BUFFER', 'API', 'KEY'].join('_')}`, secret_ref: `env:${['BUFFER', 'API', 'KEY'].join('_')}` },
      description: expect.stringContaining('without publishing'),
      health_status: 'live_disabled',
    });
    expect(JSON.stringify(snapshot)).not.toContain('scheduler-secret');
    expect(JSON.stringify(snapshot)).not.toContain('scheduler-org');
  });

  it('detects the configured credential reference without requiring or exposing global organization config', () => {
    updateAdapterSetting(defaultProject, { adapterType: 'scheduler', confirmWrite: true, enabled: true, provider: 'buffer' });
    const snapshot = getAdapterSettings(defaultProject, { [['BUFFER', 'API', 'KEY'].join('_')]: 'scheduler-secret' });
    expect(snapshot.settings.find(setting => setting.provider === 'buffer')).toMatchObject({ credential: { detected: true }, health_status: 'configured' });
    expect(JSON.stringify(snapshot)).not.toContain('scheduler-secret');
  });

  it('preserves an existing credential reference when the adapter switch changes', () => {
    getAdapterSettings(defaultProject, {});
    const database = lineageDb();
    database.prepare("update adapter_settings set secret_ref='env:SYNTHETIC_BUFFER_KEY' where project_id=? and provider='buffer'").run(defaultProject);
    database.close();

    updateAdapterSetting(defaultProject, { adapterType: 'scheduler', confirmWrite: true, enabled: true, provider: 'buffer' });

    expect(getAdapterSettings(defaultProject, { SYNTHETIC_BUFFER_KEY: 'not-returned' }).settings.find(setting => setting.provider === 'buffer')?.credential).toMatchObject({
      detected: true,
      secret_ref: 'env:SYNTHETIC_BUFFER_KEY',
    });
  });

  it('persists enabled state and non-secret config in sqlite', () => {
    updateAdapterSetting(defaultProject, {
      adapterType: 'scheduler',
      confirmWrite: true,
      enabled: true,
      provider: 'buffer',
      safeConfig: { defaultMode: 'dry-run' },
    });

    const snapshot = getAdapterSettings(defaultProject, {});
    expect(snapshot.settings.find(setting => setting.provider === 'buffer')).toMatchObject({
      adapter_type: 'scheduler',
      enabled: true,
      health_status: 'dry_run_available',
      provider: 'buffer',
      safe_config: { defaultMode: 'dry-run' },
    });
  });

  it('keeps cloud catalog storage disabled until a user enables live inspection', () => {
    const snapshot = getAdapterSettings(defaultProject, {});

    expect(snapshot.settings.find(setting => setting.provider === 's3')).toMatchObject({
      enabled: false,
      health_status: 'live_disabled',
      safe_config: {
        bucket: '',
        mode: 'local-public-fallback',
        region: '',
      },
    });
  });

  it('rejects raw secret-looking values in safe config', () => {
    expect(() =>
      updateAdapterSetting(defaultProject, {
        adapterType: 'scheduler',
        confirmWrite: true,
        enabled: true,
        provider: 'buffer',
        safeConfig: { apiKey: 'buffer-secret' },
      })
    ).toThrow('Adapter settings cannot store secret-like keys');
  });
});
