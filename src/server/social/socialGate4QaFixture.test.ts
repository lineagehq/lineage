import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../profileWriterLease', async importOriginal => ({
  ...(await importOriginal<typeof import('../profileWriterLease')>()),
  assertProfileWriterLeaseHeld: vi.fn(),
}));

import { localPreviewPath, setLineageAssetRoot } from '../assetCore';
import { lineageDb } from '../assetLineageDb';
import { canonicalSocialRevisionDigest } from './socialRevisionDigest';
import { gate4QaPngBytes, reseedGate4QaFixture } from './socialGate4QaFixture';
import { validateSocialWorkItem } from './socialValidation';
import { previewSocialDelivery } from './socialDelivery';

const PROJECT = 'swissifier-demo';
const root = 'local-5748fb8ba6df';
const itemId = '19846893-362c-46be-b5bf-c15e9bcf0b44';
const variantId = '58b44a51-58fc-4b2c-b813-8a12a6b6d167';
let scratch = '';

function seed(overrides: { channel?: string; credential?: string; delivery?: boolean } = {}) {
  const db = lineageDb();
  try {
    const now = '2026-08-12T00:00:00.000Z';
    db.prepare('insert into projects (id, product, display_name, created_at, updated_at) values (?, ?, ?, ?, ?)').run(PROJECT, PROJECT, 'Swissifier Demo', now, now);
    db.prepare(`insert into assets (id, project_id, source, local_path, checksum_sha256, media_type, title, status, channel, created_at, updated_at, last_seen_at)
      values (?, ?, 'local', 'old.png', ?, 'image', 'Root', 'ready', 'linkedin', ?, ?, ?)`).run(root, PROJECT, '5748fb8ba6dffea448a0eabf2c361d95958a8b54a3ad5d8e0d499381b820b36b', now, now, now);
    db.prepare(`insert into lineage_workspaces (id, project_id, root_asset_id, title, status, created_by, active_at, created_at, updated_at)
      values (?, ?, ?, 'Swissifier rich demo', 'active', 'system', ?, ?, ?)`).run(`${PROJECT}:lineage-workspace:${root}`, PROJECT, root, now, now, now);
    db.prepare(`insert into buffer_connections (project_id, organization_id, credential_ref, cli_version, schema_fingerprint, connection_fingerprint, health_state, channel_synced_at, created_at, updated_at)
      values (?, 'fixture-org', ?, 'fixture-only', 'fixture-schema', 'fixture-connection-r2', 'connected', ?, ?, ?)`).run(PROJECT, overrides.credential || 'env:FIXTURE_ONLY', now, now, now);
    db.prepare(`insert into buffer_channels (project_id, channel_id, organization_id, service, service_id, display_name, posting_schedule_json, allowed_actions_json, capability_json, disconnected, locked, paused, available, capability_registry_version, provider_fingerprint, synced_at, stale_at)
      values (?, ?, 'fixture-org', 'linkedin', 'fixture-linkedin-service', 'Synthetic LinkedIn QA', '{}', '[]', '{}', 0, 0, 0, 1, 1, 'fixture-channel-fingerprint-r2', ?, null)`)
      .run(PROJECT, overrides.channel || 'fixture-linkedin-r2', now);
    db.prepare(`insert into social_work_items (id, project_id, root_asset_id, source_asset_id, source_checksum_sha256, campaign_key, editorial_state, created_by, created_at, updated_at)
      values (?, ?, ?, ?, ?, 'release-2-gate2-qa', 'active', 'system', ?, ?)`).run(itemId, PROJECT, root, root, '5748fb8ba6dffea448a0eabf2c361d95958a8b54a3ad5d8e0d499381b820b36b', now, now);
    db.prepare(`insert into social_variants (id, item_id, project_id, channel_id, editorial_state, active, current_revision, created_at, updated_at)
      values (?, ?, ?, ?, 'ready', 1, 2, ?, ?)`).run(variantId, itemId, PROJECT, overrides.channel || 'fixture-linkedin-r2', now, now);
    const revisionHash = canonicalSocialRevisionDigest({
      channelId: overrides.channel || 'fixture-linkedin-r2', copy: 'Synthetic fixture caption', hashtags: [], hashtagPlacement: 'caption',
      altText: 'Synthetic abstract gradient', altTextReviewed: true, altTextReviewedBy: 'human:qa', editorialState: 'ready',
      publishMethod: 'automatic', compositionMode: 'addToQueue', channelFingerprint: 'fixture-channel-fingerprint-r2',
    });
    db.prepare(`insert into social_variant_revisions (id, variant_id, revision, copy, hashtag_placement, alt_text, alt_text_reviewed, alt_text_reviewed_by, alt_text_reviewed_at, editorial_state, publish_method, composition_mode, channel_fingerprint, revision_hash, created_by, created_at)
      values ('revision', ?, 2, 'Synthetic fixture caption', 'caption', 'Synthetic abstract gradient', 1, 'human:qa', ?, 'ready', 'automatic', 'addToQueue', 'fixture-channel-fingerprint-r2', ?, 'system', ?)`)
      .run(variantId, now, revisionHash, now);
    if (overrides.delivery) {
      // Existing upgraded profiles may retain inert historical evidence. The reseed must still refuse it.
      db.exec('create table social_delivery_operations (id text primary key, project_id text not null)');
      db.prepare("insert into social_delivery_operations values ('legacy-operation', ?)").run(PROJECT);
    }
  } finally { db.close(); }
}

function logicalMutationSnapshot() {
  const db = lineageDb();
  try {
    const tables = [
      'projects', 'lineage_workspaces', 'assets', 'asset_attempts', 'buffer_connections', 'buffer_channels',
      'social_work_items', 'social_variants', 'social_variant_revisions', 'social_hashtags', 'social_media_renditions',
    ].filter(table => db.prepare("select 1 from sqlite_master where type='table' and name=?").get(table));
    const database = Object.fromEntries(tables.map(table => [
      table,
      db.prepare(`select * from ${table} order by rowid`).all(),
    ]));
    const filesystem: Array<{ path: string; type: string; mode: number; nlink: number; size: number; sha256?: string }> = [];
    const visit = (path: string, relativePath: string) => {
      const info = lstatSync(path);
      const entry = { path: relativePath, type: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', mode: info.mode & 0o777, nlink: info.nlink, size: info.size };
      filesystem.push(info.isFile() ? { ...entry, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') } : entry);
      if (info.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name), relativePath ? `${relativePath}/${name}` : name);
    };
    for (const tree of ['.asset-scratch', '.lineage']) {
      const treeRoot = join(scratch, tree);
      if (existsSync(treeRoot)) visit(treeRoot, tree);
    }
    return { database, filesystem };
  } finally { db.close(); }
}

function withoutFilesystemPaths(snapshot: ReturnType<typeof logicalMutationSnapshot>, ...paths: string[]) {
  const excluded = new Set(paths);
  return snapshot.filesystem.filter(entry => !excluded.has(entry.path)).map(entry => (
    entry.type === 'directory' ? { ...entry, nlink: 0, size: 0 } : entry
  ));
}

function placeReseedInLegacy() {
  const first = reseedGate4QaFixture(PROJECT, { confirmWrite: true });
  const relativePath = `gate4-qa/${first.source_checksum_sha256}.png`;
  const current = join(scratch, '.asset-scratch', relativePath);
  const legacyRelativePath = `.lineage/${relativePath}`;
  const legacy = join(scratch, legacyRelativePath);
  mkdirSync(join(scratch, '.lineage', 'gate4-qa'), { recursive: true, mode: 0o700 });
  renameSync(current, legacy);
  const db = lineageDb();
  db.prepare('update assets set local_path=? where id=(select asset_id from asset_attempts where id=?)').run(legacyRelativePath, first.current_attempt_id);
  db.prepare('update asset_attempts set file_path=? where id=?').run(legacyRelativePath, first.current_attempt_id);
  db.close();
  return { current, first, legacy, legacyRelativePath, relativePath };
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lineage-gate4-reseed-'));
  process.env.LINEAGE_DB = join(scratch, 'lineage.sqlite');
  writeFileSync(process.env.LINEAGE_DB, '');
  process.env.LINEAGE_ASSET_ROOT = scratch;
  process.env.LINEAGE_CHANNEL = 'dev';
  process.env.LINEAGE_PROFILE_ENVIRONMENT = 'development';
  process.env.LINEAGE_PROFILE_ID = 'gate4-test';
  delete process.env.LINEAGE_PROFILE;
  setLineageAssetRoot(scratch);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  for (const key of ['LINEAGE_DB', 'LINEAGE_ASSET_ROOT', 'LINEAGE_CHANNEL', 'LINEAGE_PROFILE_ENVIRONMENT', 'LINEAGE_PROFILE_ID', 'LINEAGE_PROFILE']) delete process.env[key];
});

describe('Gate 4 QA fixture reseed', () => {
  it('generates deterministic text-free single-frame 1200x628 PNG bytes', () => {
    const first = gate4QaPngBytes(); const second = gate4QaPngBytes();
    expect(first.equals(second)).toBe(true);
    expect(first.subarray(1, 4).toString()).toBe('PNG');
    expect(first.readUInt32BE(16)).toBe(1200); expect(first.readUInt32BE(20)).toBe(628);
    expect(first.toString('latin1')).not.toContain('acTL');
    expect(first.toString('latin1')).not.toMatch(/tEXt|iTXt|zTXt/);
    expect(first.length).toBeLessThan(5 * 1024 * 1024);
  });

  it('atomically repins only the exact fixture and is exactly idempotent', () => {
    seed();
    expect(() => previewSocialDelivery(PROJECT, { variantId, expectedRevision: 2 })).toThrow();
    const preservedBefore = lineageDb();
    const preserved = {
      channel: preservedBefore.prepare('select provider_fingerprint, synced_at from buffer_channels where project_id=? and channel_id=?').get(PROJECT, 'fixture-linkedin-r2'),
      revision: preservedBefore.prepare('select * from social_variant_revisions where id=\'revision\'').get(),
    };
    preservedBefore.close();
    const before = readFileSync(process.env.LINEAGE_DB!);
    const first = reseedGate4QaFixture(PROJECT, { confirmWrite: true });
    expect(first).toMatchObject({ project: PROJECT, channel_id: 'fixture-linkedin-r2', revision: 2, idempotent: false,
      media: { content_type: 'image/png', width: 1200, height: 628 }, capability_registry_version: 2, delivery_evidence_count: 0 });
    expect(first).toMatchObject({ schedule_sha256: '3d9f3014db0e00b54ba924e8583a1c4e5fc1a571f5b35f4af22ce10829cb9d97', synthetic_schedule: true });
    expect(validateSocialWorkItem(PROJECT, itemId).valid).toBe(true);
    expect(previewSocialDelivery(PROJECT, { variantId, expectedRevision: 2 }).preview_sha256).toBe(first.preview_sha256);
    const preservedAfter = lineageDb();
    expect({
      channel: preservedAfter.prepare('select provider_fingerprint, synced_at from buffer_channels where project_id=? and channel_id=?').get(PROJECT, 'fixture-linkedin-r2'),
      revision: preservedAfter.prepare('select * from social_variant_revisions where id=\'revision\'').get(),
    }).toEqual(preserved);
    expect(preservedAfter.prepare('select posting_schedule_json from buffer_channels where project_id=? and channel_id=?').get(PROJECT, 'fixture-linkedin-r2'))
      .toEqual({ posting_schedule_json: '{"_lineageSynthetic":"gate4-qa","paused":false,"times":["09:00"]}' });
    preservedAfter.close();
    const firstSnapshot = logicalMutationSnapshot();
    const db = lineageDb();
    const countsBefore = {
      attempts: (db.prepare('select count(*) count from asset_attempts').get() as { count: number }).count,
      assets: (db.prepare('select count(*) count from assets').get() as { count: number }).count,
      revisions: (db.prepare('select count(*) count from social_variant_revisions').get() as { count: number }).count,
    };
    db.close();
    const second = reseedGate4QaFixture(PROJECT, { confirmWrite: true });
    expect(second).toEqual({ ...first, idempotent: true });
    expect(logicalMutationSnapshot()).toEqual(firstSnapshot);
    const verify = lineageDb();
    expect({
      attempts: (verify.prepare('select count(*) count from asset_attempts').get() as { count: number }).count,
      assets: (verify.prepare('select count(*) count from assets').get() as { count: number }).count,
      revisions: (verify.prepare('select count(*) count from social_variant_revisions').get() as { count: number }).count,
    }).toEqual(countsBefore);
    expect(verify.prepare('select source_checksum_sha256 from social_work_items where id=?').get(itemId)).toEqual({ source_checksum_sha256: first.source_checksum_sha256 });
    verify.close();
    const file = join(scratch, '.asset-scratch', 'gate4-qa', `${first.source_checksum_sha256}.png`);
    const previewReference = `gate4-qa/${first.source_checksum_sha256}.png`;
    expect(localPreviewPath(previewReference)).toBe(file);
    const pathDb = lineageDb();
    expect(pathDb.prepare('select file_path from asset_attempts where id=?').get(first.current_attempt_id)).toEqual({ file_path: previewReference });
    expect(pathDb.prepare('select local_path from assets where id=(select asset_id from asset_attempts where id=?)').get(first.current_attempt_id)).toEqual({ local_path: previewReference });
    pathDb.close();
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(file).nlink).toBe(1);
    expect(before.equals(readFileSync(process.env.LINEAGE_DB!))).toBe(false);
    expect(JSON.stringify(first)).not.toMatch(/FIXTURE_ONLY|Synthetic fixture caption|abstract gradient|human:qa|\.lineage|gate4-qa\//i);
  });

  it.each([
    ['missing confirmation', () => seed(), () => reseedGate4QaFixture(PROJECT, { confirmWrite: false }), '--confirm-write'],
    ['wrong project', () => seed(), () => reseedGate4QaFixture('other', { confirmWrite: true }), 'project must'],
    ['non-dev channel', () => { seed(); process.env.LINEAGE_CHANNEL = 'stable'; }, () => reseedGate4QaFixture(PROJECT, { confirmWrite: true }), 'dev channel'],
    ['non-development profile', () => { seed(); process.env.LINEAGE_PROFILE_ENVIRONMENT = 'production'; }, () => reseedGate4QaFixture(PROJECT, { confirmWrite: true }), 'development profile'],
    ['wrong credential marker', () => seed({ credential: 'env:OTHER' }), () => reseedGate4QaFixture(PROJECT, { confirmWrite: true }), 'connection markers'],
    ['wrong channel marker', () => seed({ channel: 'other-channel' }), () => reseedGate4QaFixture(PROJECT, { confirmWrite: true }), 'fixture channel'],
    ['existing delivery evidence', () => seed({ delivery: true }), () => reseedGate4QaFixture(PROJECT, { confirmWrite: true }), 'delivery evidence'],
  ])('fails closed for %s', (_name, arrange, act, message) => {
    arrange(); const before = logicalMutationSnapshot();
    expect(act).toThrow(message);
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it.each([
    ['workspace', "update lineage_workspaces set id='drift'"],
    ['item', "update social_work_items set id='drift'"],
    ['variant', "update social_variants set id='drift'"],
    ['campaign', "update social_work_items set campaign_key='drift'"],
    ['root', "update social_work_items set root_asset_id='drift'"],
    ['source', "update social_work_items set source_asset_id='drift'"],
    ['source checksum', "update social_work_items set source_checksum_sha256='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"],
  ])('refuses canonical %s marker drift without mutation', (_label, sql) => {
    seed(); const db = lineageDb(); db.exec('pragma foreign_keys=off'); db.exec(sql); db.exec('pragma foreign_keys=on'); db.close();
    const before = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toThrow('refused');
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it.each([
    ['organization', "update buffer_connections set organization_id='drift'"],
    ['connection CLI', "update buffer_connections set cli_version='drift'"],
    ['connection schema', "update buffer_connections set schema_fingerprint='drift'"],
    ['connection fingerprint', "update buffer_connections set connection_fingerprint='drift'"],
    ['provider fingerprint', "update buffer_channels set provider_fingerprint='drift'"],
    ['service ID', "update buffer_channels set service_id='drift'"],
    ['display name', "update buffer_channels set display_name='drift'"],
    ['coordinated identity', "update buffer_connections set organization_id='drift', connection_fingerprint='drift'; update buffer_channels set organization_id='drift', provider_fingerprint='drift'; update social_variant_revisions set channel_fingerprint='drift'"],
    ['schedule', "update buffer_channels set posting_schedule_json='{\"times\":[\"10:00\"]}'"],
  ])('refuses exact r2 %s drift without mutation', (_label, sql) => {
    seed(); const db = lineageDb(); db.exec(sql); db.close(); const before = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toThrow('refused');
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it.each(['directory:.asset-scratch', 'directory:gate4-qa', 'file:created', 'file:written', 'file:verified'])(
    'owns and removes partial installation when %s fails', stage => {
      seed(); const before = logicalMutationSnapshot();
      expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, { fileStage: current => { if (current === stage) throw new Error(`injected ${stage}`); } })).toThrow(`injected ${stage}`);
      expect(logicalMutationSnapshot()).toEqual(before);
    });

  it('does not recreate a missing idempotent fixture file', () => {
    seed(); const first = reseedGate4QaFixture(PROJECT, { confirmWrite: true });
    const file = join(scratch, '.asset-scratch', 'gate4-qa', `${first.source_checksum_sha256}.png`);
    rmSync(file); const before = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toThrow('missing its fixture asset');
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('atomically corrects the exact legacy reseed path and is idempotent afterward', () => {
    seed(); const { current, first, legacy, relativePath } = placeReseedInLegacy();

    const corrected = reseedGate4QaFixture(PROJECT, { confirmWrite: true });
    expect(corrected).toEqual(first);
    expect(localPreviewPath(relativePath)).toBe(current);
    expect(existsSync(legacy)).toBe(false);
    const snapshot = logicalMutationSnapshot();
    expect(reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toEqual({ ...first, idempotent: true });
    expect(logicalMutationSnapshot()).toEqual(snapshot);
  });

  it('rolls back a legacy path correction and removes only the newly installed copy', () => {
    seed(); const { current, legacy } = placeReseedInLegacy();
    const before = logicalMutationSnapshot();

    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, { beforeCommit: () => { throw new Error('injected legacy correction failure'); } }))
      .toThrow('injected legacy correction failure');
    expect(logicalMutationSnapshot()).toEqual(before);
    expect(existsSync(legacy)).toBe(true);
    expect(existsSync(current)).toBe(false);
  });

  it('restores the complete two-tree snapshot when interrupted after legacy deletion', () => {
    seed(); placeReseedInLegacy(); const before = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      afterLegacyDelete: () => { throw new Error('injected interruption after legacy deletion'); },
    })).toThrow('injected interruption after legacy deletion');
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('restarts deterministically after interruption left the canonical copy and legacy database path', () => {
    seed(); const { current, first, legacy, relativePath } = placeReseedInLegacy();
    const bytes = readFileSync(legacy); writeFileSync(current, bytes, { mode: 0o600 }); unlinkSync(legacy);
    const recovered = reseedGate4QaFixture(PROJECT, { confirmWrite: true });
    expect(recovered).toEqual(first);
    expect(existsSync(current)).toBe(true); expect(existsSync(legacy)).toBe(false);
    const db = lineageDb();
    expect(db.prepare('select file_path from asset_attempts where id=?').get(first.current_attempt_id)).toEqual({ file_path: relativePath });
    db.close();
  });

  it('recovers a recognizable pending legacy deletion after restart', () => {
    seed(); const { current, first, legacy } = placeReseedInLegacy();
    const pending = `${legacy}.lineage-delete-pending`; renameSync(legacy, pending);
    expect(reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toEqual(first);
    expect(existsSync(current)).toBe(true); expect(existsSync(legacy)).toBe(false); expect(existsSync(pending)).toBe(false);
  });

  it('finishes a retained two-link quarantine state on restart', () => {
    seed(); const { current, first, legacy } = placeReseedInLegacy();
    const pending = `${legacy}.lineage-delete-pending`; linkSync(legacy, pending);
    expect(statSync(legacy).nlink).toBe(2); expect(statSync(pending).nlink).toBe(2);

    expect(reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toEqual(first);
    expect(existsSync(current)).toBe(true); expect(existsSync(legacy)).toBe(false); expect(existsSync(pending)).toBe(false);
    expect(statSync(current).nlink).toBe(1);
  });

  it('never overwrites a migration quarantine destination introduced at the atomic boundary', () => {
    seed(); const { current, first, legacy } = placeReseedInLegacy(); const before = logicalMutationSnapshot();
    const pending = `${legacy}.lineage-delete-pending`;
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      beforeLegacyQuarantine: () => writeFileSync(pending, 'quarantine substitute', { mode: 0o600 }),
    })).toThrow('atomic move destination already exists');

    const immediate = logicalMutationSnapshot();
    expect(immediate.database).toEqual(before.database);
    expect(readFileSync(pending, 'utf8')).toBe('quarantine substitute');
    expect(readFileSync(legacy).equals(gate4QaPngBytes())).toBe(true);
    expect(existsSync(current)).toBe(false);
    expect(withoutFilesystemPaths(immediate, pending.slice(scratch.length + 1))).toEqual(withoutFilesystemPaths(before));
    expect(statSync(pending).mode & 0o777).toBe(0o600); expect(statSync(pending).nlink).toBe(1);

    unlinkSync(pending);
    expect(reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toEqual(first);
    expect(existsSync(current)).toBe(true); expect(existsSync(legacy)).toBe(false);
  });

  it('retains a restoration collision and deterministically resumes after the substitute is removed', () => {
    seed(); const { current, first, legacy } = placeReseedInLegacy(); const before = logicalMutationSnapshot();
    const pending = `${legacy}.lineage-delete-pending`;
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      unlinkPath: path => { if (path === pending) throw new Error('force restoration'); unlinkSync(path); },
      beforeLegacyRestore: () => writeFileSync(legacy, 'restoration substitute', { mode: 0o600 }),
    })).toThrow('force restoration');

    const immediate = logicalMutationSnapshot();
    expect(immediate.database).toEqual(before.database);
    expect(readFileSync(legacy, 'utf8')).toBe('restoration substitute');
    expect(readFileSync(pending).equals(gate4QaPngBytes())).toBe(true);
    expect(existsSync(current)).toBe(false);
    const legacyRelative = legacy.slice(scratch.length + 1); const pendingRelative = pending.slice(scratch.length + 1);
    expect(withoutFilesystemPaths(immediate, legacyRelative, pendingRelative)).toEqual(withoutFilesystemPaths(before, legacyRelative));
    expect(statSync(legacy).mode & 0o777).toBe(0o600); expect(statSync(legacy).nlink).toBe(1);
    expect(statSync(pending).mode & 0o777).toBe(0o600); expect(statSync(pending).nlink).toBe(1);
    const retained = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toThrow('recovery paths conflict');
    expect(logicalMutationSnapshot()).toEqual(retained);

    unlinkSync(legacy);
    expect(reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toEqual(first);
    expect(existsSync(current)).toBe(true); expect(existsSync(legacy)).toBe(false); expect(existsSync(pending)).toBe(false);
  });

  it('refuses a dangling pending-path collision without overwriting either legacy path', () => {
    seed(); const { legacy } = placeReseedInLegacy();
    const pending = `${legacy}.lineage-delete-pending`;
    symlinkSync(join(scratch, 'missing-pending-target'), pending);
    const before = logicalMutationSnapshot();

    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toThrow('recovery paths conflict');
    expect(lstatSync(pending).isSymbolicLink()).toBe(true);
    expect(existsSync(legacy)).toBe(true);
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it.each(['dangling symlink', 'substituted file'])('refuses %s as a pending restoration source without mutation', kind => {
    seed(); const { legacy } = placeReseedInLegacy();
    const pending = `${legacy}.lineage-delete-pending`;
    unlinkSync(legacy);
    if (kind === 'dangling symlink') symlinkSync(join(scratch, 'missing-restoration-target'), pending);
    else writeFileSync(pending, 'substituted pending bytes', { mode: 0o600 });
    const before = logicalMutationSnapshot();

    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toThrow();
    expect(lstatSync(pending).isSymbolicLink()).toBe(kind === 'dangling symlink');
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('rolls back both trees when legacy unlink fails and never reports success', () => {
    seed(); placeReseedInLegacy(); const before = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      unlinkPath: path => {
        if (path.includes(`${join('.lineage', 'gate4-qa')}`)) throw new Error('injected legacy unlink failure');
        unlinkSync(path);
      },
    })).toThrow('injected legacy unlink failure');
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('restores both trees when an unlink reports failure after removing the legacy file', () => {
    seed(); placeReseedInLegacy(); const before = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      unlinkPath: path => {
        unlinkSync(path);
        if (path.includes(`${join('.lineage', 'gate4-qa')}`)) throw new Error('injected post-unlink failure');
      },
    })).toThrow('injected post-unlink failure');
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('does not report idempotent success while an undeletable legacy duplicate remains', () => {
    seed(); const first = reseedGate4QaFixture(PROJECT, { confirmWrite: true });
    const canonical = join(scratch, '.asset-scratch', 'gate4-qa', `${first.source_checksum_sha256}.png`);
    const legacyDirectory = join(scratch, '.lineage', 'gate4-qa'); mkdirSync(legacyDirectory, { recursive: true, mode: 0o700 });
    const legacy = join(legacyDirectory, `${first.source_checksum_sha256}.png`); writeFileSync(legacy, readFileSync(canonical), { mode: 0o600 });
    const before = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      unlinkPath: path => { if (path.includes('.lineage')) throw new Error('legacy duplicate retained'); unlinkSync(path); },
    })).toThrow('legacy duplicate retained');
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('removes an exact legacy duplicate before reporting idempotent success', () => {
    seed(); const first = reseedGate4QaFixture(PROJECT, { confirmWrite: true });
    const canonical = join(scratch, '.asset-scratch', 'gate4-qa', `${first.source_checksum_sha256}.png`);
    const legacyDirectory = join(scratch, '.lineage', 'gate4-qa'); mkdirSync(legacyDirectory, { recursive: true, mode: 0o700 });
    const legacy = join(legacyDirectory, `${first.source_checksum_sha256}.png`); writeFileSync(legacy, readFileSync(canonical), { mode: 0o600 });
    expect(reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toEqual({ ...first, idempotent: true });
    expect(existsSync(legacy)).toBe(false); expect(existsSync(canonical)).toBe(true);
  });

  it('never overwrites an idempotent duplicate quarantine collision and resumes cleanly', () => {
    seed(); const first = reseedGate4QaFixture(PROJECT, { confirmWrite: true });
    const canonical = join(scratch, '.asset-scratch', 'gate4-qa', `${first.source_checksum_sha256}.png`);
    const legacyDirectory = join(scratch, '.lineage', 'gate4-qa'); mkdirSync(legacyDirectory, { recursive: true, mode: 0o700 });
    const legacy = join(legacyDirectory, `${first.source_checksum_sha256}.png`); writeFileSync(legacy, readFileSync(canonical), { mode: 0o600 });
    const pending = `${legacy}.lineage-delete-pending`; const before = logicalMutationSnapshot();

    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      beforeLegacyQuarantine: () => symlinkSync(join(scratch, 'missing-quarantine-target'), pending),
    })).toThrow('atomic move destination already exists');
    const immediate = logicalMutationSnapshot();
    expect(immediate.database).toEqual(before.database);
    expect(lstatSync(pending).isSymbolicLink()).toBe(true);
    expect(readFileSync(legacy).equals(readFileSync(canonical))).toBe(true);
    expect(statSync(legacy).nlink).toBe(1); expect(statSync(canonical).nlink).toBe(1);
    expect(withoutFilesystemPaths(immediate, pending.slice(scratch.length + 1))).toEqual(withoutFilesystemPaths(before));

    unlinkSync(pending);
    expect(reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toEqual({ ...first, idempotent: true });
    expect(existsSync(legacy)).toBe(false); expect(existsSync(canonical)).toBe(true);
  });

  it('retains an idempotent restoration collision, refuses unchanged, then resumes without touching the substitute', () => {
    seed(); const first = reseedGate4QaFixture(PROJECT, { confirmWrite: true });
    const canonical = join(scratch, '.asset-scratch', 'gate4-qa', `${first.source_checksum_sha256}.png`);
    const legacyDirectory = join(scratch, '.lineage', 'gate4-qa'); mkdirSync(legacyDirectory, { recursive: true, mode: 0o700 });
    const legacy = join(legacyDirectory, `${first.source_checksum_sha256}.png`); writeFileSync(legacy, readFileSync(canonical), { mode: 0o600 });
    const pending = `${legacy}.lineage-delete-pending`; const before = logicalMutationSnapshot();

    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      unlinkPath: path => { if (path === pending) throw new Error('force idempotent restoration'); unlinkSync(path); },
      beforeLegacyRestore: () => writeFileSync(legacy, 'idempotent restoration substitute', { mode: 0o600 }),
    })).toThrow('force idempotent restoration');
    const immediate = logicalMutationSnapshot();
    expect(immediate.database).toEqual(before.database);
    expect(readFileSync(legacy, 'utf8')).toBe('idempotent restoration substitute');
    expect(readFileSync(pending).equals(readFileSync(canonical))).toBe(true);
    const legacyRelative = legacy.slice(scratch.length + 1); const pendingRelative = pending.slice(scratch.length + 1);
    expect(withoutFilesystemPaths(immediate, legacyRelative, pendingRelative)).toEqual(withoutFilesystemPaths(before, legacyRelative));
    expect(statSync(legacy).mode & 0o777).toBe(0o600); expect(statSync(legacy).nlink).toBe(1);
    expect(statSync(pending).mode & 0o777).toBe(0o600); expect(statSync(pending).nlink).toBe(1);
    const retained = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toThrow('recovery paths conflict');
    expect(logicalMutationSnapshot()).toEqual(retained);

    unlinkSync(legacy);
    expect(reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toEqual({ ...first, idempotent: true });
    expect(existsSync(legacy)).toBe(false); expect(existsSync(pending)).toBe(false); expect(existsSync(canonical)).toBe(true);
  });

  it('revalidates legacy file identity immediately before deletion and retains a substitute', () => {
    seed(); const { legacy } = placeReseedInLegacy(); const before = logicalMutationSnapshot();
    const held = `${legacy}.held`;
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      beforeLegacyDelete: () => { renameSync(legacy, held); writeFileSync(legacy, 'substitute', { mode: 0o600 }); },
    })).toThrow('identity changed before deletion');
    expect(readFileSync(legacy, 'utf8')).toBe('substitute'); expect(existsSync(held)).toBe(true);
    expect(logicalMutationSnapshot().database).toEqual(before.database);
    unlinkSync(legacy); renameSync(held, legacy);
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('revalidates the legacy parent at deletion and never unlinks from a substituted parent', () => {
    seed(); const { legacy } = placeReseedInLegacy(); const before = logicalMutationSnapshot();
    const parent = join(scratch, '.lineage', 'gate4-qa'); const heldParent = `${parent}.held`;
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      beforeLegacyDelete: () => {
        renameSync(parent, heldParent); mkdirSync(parent, { mode: 0o700 });
        writeFileSync(legacy, 'parent substitute', { mode: 0o600 });
      },
    })).toThrow('parent identity changed before deletion');
    expect(readFileSync(legacy, 'utf8')).toBe('parent substitute'); expect(existsSync(join(heldParent, legacy.split('/').pop()!))).toBe(true);
    expect(logicalMutationSnapshot().database).toEqual(before.database);
    rmSync(parent, { recursive: true }); renameSync(heldParent, parent);
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('retains a file substituted after quarantine and never invokes unlink', () => {
    seed(); const { legacy } = placeReseedInLegacy(); const before = logicalMutationSnapshot();
    const pending = `${legacy}.lineage-delete-pending`; const held = `${pending}.held`;
    const unlinkPath = vi.fn((path: string) => unlinkSync(path));

    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      beforeLegacyUnlink: () => { renameSync(pending, held); writeFileSync(pending, 'post-quarantine substitute', { mode: 0o600 }); },
      unlinkPath,
    })).toThrow('identity changed before deletion');
    expect(unlinkPath).not.toHaveBeenCalledWith(pending);
    expect(readFileSync(pending, 'utf8')).toBe('post-quarantine substitute');
    expect(existsSync(held)).toBe(true);
    expect(logicalMutationSnapshot().database).toEqual(before.database);

    unlinkSync(pending); renameSync(held, legacy);
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('retains a substituted parent after quarantine and never invokes unlink', () => {
    seed(); const { legacy } = placeReseedInLegacy(); const before = logicalMutationSnapshot();
    const parent = join(scratch, '.lineage', 'gate4-qa'); const heldParent = `${parent}.held`;
    const pending = `${legacy}.lineage-delete-pending`;
    const unlinkPath = vi.fn((path: string) => unlinkSync(path));

    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      beforeLegacyUnlink: () => {
        renameSync(parent, heldParent); mkdirSync(parent, { mode: 0o700 });
        writeFileSync(pending, 'post-quarantine parent substitute', { mode: 0o600 });
      },
      unlinkPath,
    })).toThrow('parent identity changed before deletion');
    expect(unlinkPath).not.toHaveBeenCalledWith(pending);
    expect(readFileSync(pending, 'utf8')).toBe('post-quarantine parent substitute');
    expect(existsSync(join(heldParent, pending.split('/').pop()!))).toBe(true);
    expect(logicalMutationSnapshot().database).toEqual(before.database);

    rmSync(parent, { recursive: true }); renameSync(heldParent, parent); renameSync(pending, legacy);
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('does not overwrite an existing deterministic target with wrong bytes', () => {
    seed(); const checksum = createHash('sha256').update(gate4QaPngBytes()).digest('hex');
    const directory = join(scratch, '.asset-scratch', 'gate4-qa'); mkdirSync(directory, { recursive: true, mode: 0o700 });
    const target = join(directory, `${checksum}.png`); writeFileSync(target, 'wrong bytes', { mode: 0o600 });
    const before = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toThrow('does not match deterministic bytes');
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('rolls back file and database state when the transaction fails', () => {
    seed(); const checksum = createHash('sha256').update(gate4QaPngBytes()).digest('hex');
    const db = lineageDb();
    db.prepare(`insert into assets (id, project_id, source, local_path, checksum_sha256, media_type, title, status, created_at, updated_at, last_seen_at)
      values (?, ?, 'local', 'collision.png', ?, 'image', 'Collision', 'ready', ?, ?, ?)`)
      .run(`${PROJECT}:gate4-qa:${checksum.slice(0, 24)}`, PROJECT, checksum, '2026-08-12T00:00:00Z', '2026-08-12T00:00:00Z', '2026-08-12T00:00:00Z');
    db.close(); const before = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true })).toThrow();
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('rolls back database and file changes when precommit validation fails', () => {
    seed(); const before = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, { beforeValidation: () => { throw new Error('injected validation failure'); } })).toThrow('injected validation failure');
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('rolls back database and file changes when precommit preview fails', () => {
    seed(); const before = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, { beforePreview: () => { throw new Error('injected preview failure'); } })).toThrow('injected preview failure');
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('rolls back database and file changes when commit preparation fails', () => {
    seed(); const before = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, { beforeCommit: () => { throw new Error('injected transaction failure'); } })).toThrow('injected transaction failure');
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('finishes owned cleanup before surfacing an injected cleanup failure', () => {
    seed(); const before = logicalMutationSnapshot();
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      beforeCommit: () => { throw new Error('injected transaction failure'); },
      beforeCleanup: () => { throw new Error('injected cleanup failure'); },
    })).toThrow('injected cleanup failure');
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('does not unlink a substituted cleanup target', () => {
    seed(); const before = logicalMutationSnapshot(); const checksum = createHash('sha256').update(gate4QaPngBytes()).digest('hex');
    const target = join(scratch, '.asset-scratch', 'gate4-qa', `${checksum}.png`); const held = `${target}.held`;
    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      beforeCommit: () => { throw new Error('force cleanup'); },
      beforeCleanup: () => { renameSync(target, held); writeFileSync(target, 'cleanup substitute', { mode: 0o600 }); },
    })).toThrow('identity changed before deletion');
    expect(readFileSync(target, 'utf8')).toBe('cleanup substitute'); expect(existsSync(held)).toBe(true);
    unlinkSync(target); renameSync(held, target); unlinkSync(target);
    rmSync(join(scratch, '.asset-scratch'), { recursive: true });
    expect(logicalMutationSnapshot()).toEqual(before);
  });

  it('refuses a dangling cleanup quarantine collision without overwrite or unlink across either tree', () => {
    seed();
    const legacyDirectory = join(scratch, '.lineage', 'gate4-qa');
    mkdirSync(legacyDirectory, { recursive: true, mode: 0o700 });
    const legacyMarker = join(legacyDirectory, 'unrelated-private-marker');
    writeFileSync(legacyMarker, 'preserve me', { mode: 0o600 });
    const before = logicalMutationSnapshot();
    const checksum = createHash('sha256').update(gate4QaPngBytes()).digest('hex');
    const target = join(scratch, '.asset-scratch', 'gate4-qa', `${checksum}.png`);
    const pending = `${target}.lineage-delete-pending`;
    const unlinkPath = vi.fn((path: string) => unlinkSync(path));

    expect(() => reseedGate4QaFixture(PROJECT, { confirmWrite: true }, {
      beforeCommit: () => { throw new Error('force cleanup'); },
      beforeCleanup: () => { symlinkSync(join(scratch, 'missing-cleanup-target'), pending); },
      unlinkPath,
    })).toThrow('atomic move destination already exists');
    expect(unlinkPath).not.toHaveBeenCalled();
    expect(existsSync(target)).toBe(true);
    expect(lstatSync(pending).isSymbolicLink()).toBe(true);
    expect(readFileSync(legacyMarker, 'utf8')).toBe('preserve me');

    unlinkSync(pending); unlinkSync(target); rmSync(join(scratch, '.asset-scratch'), { recursive: true });
    expect(logicalMutationSnapshot()).toEqual(before);
  });
});
