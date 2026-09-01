import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach } from 'vitest';
import { repoRoot } from '../server/assetCore';
import { lineageProfileFingerprint } from '../server/lineageProfiles';
import { acquireProfileWriterLease, type ProfileWriterLease } from '../server/profileWriterLease';
import type { LineageProfileManifest, ResolvedLineageProfile } from '../shared/lineageProfileTypes';

const managedEnvKeys = [
  'LINEAGE_DB',
  'LINEAGE_DB_ACCESS',
  'LINEAGE_CHANNEL',
  'LINEAGE_PROFILE',
  'LINEAGE_PROFILE_ENVIRONMENT',
  'LINEAGE_PROFILE_FINGERPRINT',
  'LINEAGE_PROFILE_ID',
  'LINEAGE_PROFILE_MANIFEST',
  'LINEAGE_PROFILE_SERVICE_ORIGIN',
  'LINEAGE_WRITER_LEASE_TOKEN',
  'LINEAGE_WRITER_LOCK_PATH',
] as const;

let activeLease: ProfileWriterLease | undefined;
let activeProfileDir: string | undefined;
let previousEnv: Partial<Record<(typeof managedEnvKeys)[number], string | undefined>> | undefined;

export function useLineageTestProfile(databasePath: string, options: { assetRoot?: string } = {}): ResolvedLineageProfile {
  resetLineageTestProfile();
  const resolvedDatabasePath = resolve(databasePath);
  mkdirSync(join(repoRoot, '.asset-scratch'), { recursive: true });
  const scratchRoot = realpathSync(join(repoRoot, '.asset-scratch'));
  mkdirSync(dirname(resolvedDatabasePath), { recursive: true });
  const resolvedParent = realpathSync(dirname(resolvedDatabasePath));
  const relativeParent = relative(scratchRoot, resolvedParent);
  if (relativeParent === '..' || relativeParent.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || resolve(resolvedDatabasePath) === scratchRoot) {
    throw new Error(`Lineage test profiles require a database under ${scratchRoot}: ${resolvedDatabasePath}`);
  }

  previousEnv = Object.fromEntries(managedEnvKeys.map(key => [key, process.env[key]]));
  const suffix = createHash('sha256').update(resolvedDatabasePath).digest('hex').slice(0, 16);
  const profileDir = join(dirname(resolvedDatabasePath), `.lineage-test-profile-${suffix}`);
  const manifestPath = join(profileDir, 'profile.json');
  mkdirSync(profileDir, { recursive: true });
  const manifest: LineageProfileManifest = {
    asset_root: options.assetRoot ? resolve(options.assetRoot) : repoRoot,
    database_path: resolvedDatabasePath,
    environment: 'development',
    expected_runtime: { channel: 'dev', code_fingerprint: 'd'.repeat(64), code_origin: 'checkout' },
    profile_id: `vitest-${suffix}`,
    schema_version: 'lineage.profile.v1',
    service_origin: 'http://127.0.0.1:6199',
  };
  const profile: ResolvedLineageProfile = {
    ...manifest,
    manifest_path: manifestPath,
    profile_fingerprint: lineageProfileFingerprint(manifest),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  const database = new DatabaseSync(resolvedDatabasePath);
  try {
    database.exec('create table if not exists lineage_profile_identity (profile_id text primary key, environment text not null, profile_fingerprint text not null, bound_at text not null)');
    database.exec('delete from lineage_profile_identity');
    database.prepare('insert into lineage_profile_identity (profile_id, environment, profile_fingerprint, bound_at) values (?, ?, ?, ?)')
      .run(profile.profile_id, profile.environment, profile.profile_fingerprint, '2026-07-16T00:00:00.000Z');
  } finally {
    database.close();
  }

  process.env.LINEAGE_DB = resolvedDatabasePath;
  process.env.LINEAGE_CHANNEL = 'dev';
  delete process.env.LINEAGE_DB_ACCESS;
  process.env.LINEAGE_PROFILE = profile.manifest_path;
  process.env.LINEAGE_PROFILE_ENVIRONMENT = profile.environment;
  process.env.LINEAGE_PROFILE_FINGERPRINT = profile.profile_fingerprint;
  process.env.LINEAGE_PROFILE_ID = profile.profile_id;
  process.env.LINEAGE_PROFILE_MANIFEST = profile.manifest_path;
  process.env.LINEAGE_PROFILE_SERVICE_ORIGIN = profile.service_origin;
  activeProfileDir = profileDir;
  activeLease = acquireProfileWriterLease(profile, 'dev', 'cli');
  return profile;
}

function resetLineageTestProfile(): void {
  activeLease?.release();
  activeLease = undefined;
  if (activeProfileDir) rmSync(activeProfileDir, { force: true, recursive: true });
  activeProfileDir = undefined;
  if (previousEnv) {
    for (const key of managedEnvKeys) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  previousEnv = undefined;
}

afterEach(() => {
  resetLineageTestProfile();
});
