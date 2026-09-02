import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { repoRoot } from '../assetCore';
import { lineageDb } from '../assetLineageDb';
import { acceptNodeEditorResult, getNodeEditorTerminal, readNodeEditorBaseContent, type NodeEditorAcceptanceInput } from './persistence';
import { collectNodeEditorOrphans, materializeNodeEditorContent, type NodeEditorFaultPoint } from './materialization';
import { createNodeEditorTestContext, forbiddenStateSnapshot, sha256, tinyPng } from './testSupport';

const contexts: Array<ReturnType<typeof createNodeEditorTestContext>> = [];
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.supervisor.stopAll()));
});

function acceptance(name: string, inject?: (point: NodeEditorFaultPoint) => void): { context: ReturnType<typeof createNodeEditorTestContext>; input: NodeEditorAcceptanceInput } {
  const context = createNodeEditorTestContext(name);
  contexts.push(context);
  const stagingPath = join(context.root, 'accepted.stage');
  mkdirSync(context.root, { recursive: true });
  writeFileSync(stagingPath, tinyPng);
  const content = materializeNodeEditorContent(context.profile.asset_root, { stagingPath, bytes: tinyPng.length, checksumSha256: sha256(tinyPng), mimeType: 'image/png' });
  return {
    context,
    input: {
      sessionId: `session-${name}`, proposalId: `proposal-${name}`, idempotencyKey: `idem-${name}`,
      project: 'test-project', rootAssetId: 'root-asset', nodeAssetId: 'node-asset',
      baseAttemptId: 'test-project:node-asset:attempt:implicit', baseChecksumSha256: sha256(tinyPng),
      pluginId: 'reference.editor', contributionId: 'reference.editor', installation: context.config.installations[0], content, inject,
      pluginPackageName: '@mean-weasel/reference-editor', pluginPackageVersion: '1.2.3',
      protocol: { major: 1, minor: 2, features: ['document-read', 'save-proposal'], capabilities: ['document.read', 'proposal.create'] },
      editSummary: 'Reference edit',
    },
  };
}

describe('node editor persistence', () => {
  it('resolves only the authorized current asset and verifies immutable size and checksum metadata', () => {
    const context = createNodeEditorTestContext('source-content');
    contexts.push(context);
    const expected = { attemptId: 'test-project:node-asset:attempt:implicit', checksumSha256: sha256(tinyPng), maxBytes: 1024 };
    expect(readNodeEditorBaseContent(context.profile.asset_root, 'test-project', 'root-asset', 'node-asset', expected)).toMatchObject({
      attemptId: expected.attemptId,
      checksumSha256: expected.checksumSha256,
      mimeType: 'image/png',
      sizeBytes: tinyPng.length,
      bytes: tinyPng,
    });
    writeFileSync(join(context.profile.asset_root, 'node-asset.png'), Buffer.from('tampered'));
    expect(() => readNodeEditorBaseContent(context.profile.asset_root, 'test-project', 'root-asset', 'node-asset', expected)).toThrow(/size|checksum/);
    expect(() => readNodeEditorBaseContent(context.profile.asset_root, 'test-project', 'root-asset', 'root-asset', expected)).toThrow();
  });

  it('atomically accepts, preserves review notes, records provenance, and returns terminal retry', () => {
    const { input } = acceptance('accepted');
    const forbiddenBefore = forbiddenStateSnapshot();
    const first = acceptNodeEditorResult(input);
    const second = acceptNodeEditorResult(input);
    expect(first).toEqual(second);
    expect(first.outcome).toBe('accepted');
    const database = lineageDb();
    try {
      expect(database.prepare("select source, is_current from asset_attempts where source = 'editor'").get()).toEqual({ source: 'editor', is_current: 1 });
      expect(database.prepare("select review_state, notes from asset_reviews where asset_id = 'node-asset'").get()).toEqual({ review_state: 'unreviewed', notes: 'preserve me' });
      expect(database.prepare('select plugin_id, plugin_package_version, protocol_major, result_checksum_sha256, result_mime_type, result_size_bytes, edit_summary_json, base_attempt_id from node_editor_attempt_provenance').get()).toEqual({
        plugin_id: 'reference.editor', plugin_package_version: '1.2.3', protocol_major: 1,
        result_checksum_sha256: sha256(tinyPng), result_mime_type: 'image/png', result_size_bytes: tinyPng.length,
        edit_summary_json: JSON.stringify({ summary: 'Reference edit' }), base_attempt_id: input.baseAttemptId,
      });
      expect(database.prepare('select count(*) count from node_editor_terminal_results').get()).toEqual({ count: 1 });
    } finally { database.close(); }
    expect(forbiddenStateSnapshot()).toEqual(forbiddenBefore);
  }, 15_000);

  it('protects a materialized acceptance from concurrent GC until persistence releases its lease', () => {
    const { context, input } = acceptance('gc-acceptance');
    expect(collectNodeEditorOrphans(context.profile.asset_root, new Set(), 10, { minimumAgeMs: 0, now: Date.now() + 86_400_000 }).removed).toEqual([]);
    const outcome = acceptNodeEditorResult(input);
    expect(outcome.outcome).toBe('accepted');
    expect(collectNodeEditorOrphans(context.profile.asset_root, new Set([input.content.checksumSha256]), 10, { minimumAgeMs: 0, now: Date.now() + 86_400_000 }).removed).toEqual([]);
  });

  it.each(['after-begin', 'after-second-stale-check', 'after-asset', 'after-demote', 'after-attempt', 'after-provenance', 'after-review', 'after-terminal', 'before-commit'] as NodeEditorFaultPoint[])(
    'rolls back every database boundary at %s and leaves a reclaimable orphan',
    point => {
      const { context, input } = acceptance(`fault-${point}`, current => { if (current === point) throw new Error(`fault:${point}`); });
      expect(() => acceptNodeEditorResult(input)).toThrow(`fault:${point}`);
      expect(getNodeEditorTerminal(input.sessionId)).toBeUndefined();
      const database = lineageDb();
      try {
        expect(database.prepare("select count(*) count from asset_attempts where source = 'editor'").get()).toEqual({ count: 0 });
        expect(database.prepare("select review_state, notes from asset_reviews where asset_id = 'node-asset'").get()).toEqual({ review_state: 'approved', notes: 'preserve me' });
      } finally { database.close(); }
      expect(collectNodeEditorOrphans(context.profile.asset_root, new Set(), 10, { minimumAgeMs: 0, now: Date.now() + 1 }).removed).toHaveLength(1);
    },
  );

  it('preserves legacy attempts, current relationship, indexes, and foreign keys during source migration', () => {
    const root = join(repoRoot, '.asset-scratch', 'vitest-node-editor-migration');
    rmSync(root, { force: true, recursive: true });
    const dbPath = join(root, 'legacy.sqlite');
    useLineageTestProfile(dbPath);
    const database = new DatabaseSync(dbPath);
    database.exec(`
      create table projects (id text primary key, product text not null, display_name text, catalog_path text, catalog_state text not null default 'ready', sort_position integer not null default 0, created_at text not null, updated_at text not null);
      create table assets (id text primary key, project_id text not null references projects(id), source text not null check(source in ('local','catalog')), local_path text, s3_key text, checksum_sha256 text, media_type text not null, title text not null, status text not null, channel text, campaign text, audience text, size_bytes integer, content_type text, created_at text not null, updated_at text not null, last_seen_at text not null);
      create table asset_attempts (id text primary key, project_id text not null references projects(id), node_asset_id text not null references assets(id), asset_id text not null references assets(id), attempt_index integer not null check(attempt_index > 0), source text not null check(source in ('initial','generated_child','reroll')), prompt text, generation_job_id text, file_path text, checksum_sha256 text, created_at text not null, promoted_at text, is_current integer not null check(is_current in (0,1)), unique(project_id,node_asset_id,attempt_index), unique(project_id,node_asset_id,asset_id,source));
      create unique index asset_attempts_one_current on asset_attempts(project_id,node_asset_id) where is_current=1;
      create index asset_attempts_node_created on asset_attempts(project_id,node_asset_id,created_at);
      insert into projects (id,product,created_at,updated_at) values ('p','p','t','t');
      insert into assets (id,project_id,source,checksum_sha256,media_type,title,status,created_at,updated_at,last_seen_at) values ('a','p','local','abc','image','a','working','t','t','t');
      insert into asset_attempts values ('attempt','p','a','a',1,'initial',null,null,null,'abc','t','t',1);
    `);
    database.close();
    const migrated = lineageDb();
    try {
      expect(migrated.prepare('select id, source, is_current from asset_attempts').get()).toEqual({ id: 'attempt', source: 'initial', is_current: 1 });
      expect(migrated.prepare("select sql from sqlite_master where type='table' and name='asset_attempts'").get()).toMatchObject({ sql: expect.stringContaining("'editor'") });
      expect(migrated.prepare('pragma foreign_key_check').all()).toEqual([]);
      expect((migrated.prepare('pragma index_list(asset_attempts)').all() as Array<{ name: string }>).map(row => row.name)).toContain('asset_attempts_one_current');
    } finally { migrated.close(); }
  });
});
