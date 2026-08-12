import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { repoRoot } from './assetCore';
import { lineageDb } from './assetLineageDb';

describe('asset Social-mark schema', () => {
  beforeEach(() => {
    useLineageTestProfile(join(repoRoot, '.asset-scratch', 'vitest-social-mark-schema.sqlite'));
  });

  it('persists one auditable mark per project, canvas root, and asset', () => {
    const database = lineageDb();
    try {
      const columns = database.prepare('pragma table_info(asset_social_marks)').all() as Array<{ name: string }>;
      const indexes = database.prepare('pragma index_list(asset_social_marks)').all() as Array<{ name: string; unique: number }>;
      const uniqueIndex = indexes.find(index => Number(index.unique) === 1);
      const uniqueColumns = uniqueIndex
        ? database.prepare(`pragma index_info(${uniqueIndex.name})`).all() as Array<{ name: string }>
        : [];

      expect(columns.map(column => column.name)).toEqual([
        'id', 'project_id', 'root_asset_id', 'asset_id', 'notes', 'marked_by',
        'marked_at', 'unmarked_by', 'unmarked_at', 'updated_at',
      ]);
      expect(uniqueColumns.map(column => column.name)).toEqual(['project_id', 'root_asset_id', 'asset_id']);
    } finally {
      database.close();
    }
  });

  it('creates project-scoped Buffer connection and channel catalog tables without secret columns', () => {
    const database = lineageDb();
    try {
      const connectionColumns = database.prepare('pragma table_info(buffer_connections)').all() as Array<{ name: string }>;
      const channelColumns = database.prepare('pragma table_info(buffer_channels)').all() as Array<{ name: string }>;
      expect(connectionColumns.map(column => column.name)).toEqual(expect.arrayContaining(['project_id', 'organization_id', 'credential_ref', 'connection_fingerprint', 'channel_synced_at']));
      expect(channelColumns.map(column => column.name)).toEqual(expect.arrayContaining(['project_id', 'channel_id', 'organization_id', 'capability_json', 'available', 'stale_at']));
      expect([...connectionColumns, ...channelColumns].map(column => column.name).join(' ')).not.toMatch(/api_key|secret|token/);
    } finally { database.close(); }
  });

  it('creates provider-neutral Social Work Item, immutable revision, and ordered hashtag tables', () => {
    const database = lineageDb();
    try {
      const tables = ['social_work_items', 'social_variants', 'social_variant_revisions', 'social_hashtags'];
      for (const table of tables) expect(database.prepare("select name from sqlite_master where type='table' and name=?").get(table)).toBeTruthy();
      const revisionColumns = database.prepare('pragma table_info(social_variant_revisions)').all() as Array<{ name: string }>;
      const names = revisionColumns.map(column => column.name);
      expect(names).toEqual(expect.arrayContaining(['revision_hash', 'channel_fingerprint', 'composition_mode', 'custom_scheduled_at', 'alt_text_reviewed_by', 'editorial_state']));
      expect(names.join(' ')).not.toMatch(/network_metadata|provider_post|delivery|scheduled_state|buffer_payload/);
      const revisionSql = (database.prepare("select sql from sqlite_master where type='table' and name='social_variant_revisions'").get() as { sql: string }).sql;
      expect(revisionSql).toContain("composition_mode = 'customScheduled' and custom_scheduled_at is not null");
      expect(revisionSql).toContain('alt_text_reviewed = 1 and alt_text is not null');
      expect(revisionSql).not.toContain('unique(variant_id, revision_hash)');
      const indexes = database.prepare('pragma index_list(social_variants)').all() as Array<{ name: string; partial: number; unique: number }>;
      expect(indexes).toContainEqual(expect.objectContaining({ name: 'social_variants_one_active_channel', partial: 1, unique: 1 }));
    } finally { database.close(); }
  });

  it('fails closed without rewriting immutable rows from the interim open-metadata schema', () => {
    const scratch = join(repoRoot, '.asset-scratch', 'vitest-social-revision-migration');
    const path = join(scratch, 'lineage.sqlite');
    rmSync(scratch, { recursive: true, force: true }); mkdirSync(scratch, { recursive: true });
    useLineageTestProfile(path);
    const database = lineageDb();
    database.exec('PRAGMA foreign_keys = OFF');
    database.prepare(`insert into social_work_items (id, project_id, root_asset_id, source_asset_id, campaign_key, editorial_state, created_by, created_at, updated_at) values ('item-old', 'project-old', 'root-old', 'asset-old', 'default', 'active', 'human', '2026-08-12T00:00:00Z', '2026-08-12T00:00:00Z')`).run();
    database.prepare(`insert into social_variants (id, item_id, project_id, channel_id, editorial_state, active, current_revision, created_at, updated_at) values ('variant-old', 'item-old', 'project-old', 'channel-old', 'ready', 1, 1, '2026-08-12T00:00:00Z', '2026-08-12T00:00:00Z')`).run();
    database.prepare(`insert into social_variant_revisions (id, variant_id, revision, copy, hashtag_placement, alt_text_reviewed, editorial_state, publish_method, channel_fingerprint, revision_hash, created_by, created_at) values ('revision-old', 'variant-old', 1, 'Historical copy', 'caption', 0, 'ready', 'automatic', 'fingerprint-old', 'hash-old', 'human', '2026-08-12T00:00:00Z')`).run();
    database.exec(`
      PRAGMA legacy_alter_table = ON;
      alter table social_variant_revisions rename to social_variant_revisions_safe;
      create table social_variant_revisions (
        id text primary key, variant_id text not null, revision integer not null, copy text not null,
        hashtag_placement text not null, alt_text text, alt_text_reviewed integer not null,
        alt_text_reviewed_by text, alt_text_reviewed_at text, network_metadata_json text not null,
        publish_method text not null, composition_mode text, custom_scheduled_at text,
        channel_fingerprint text not null, revision_hash text not null, created_by text not null, created_at text not null
      );
      insert into social_variant_revisions
      select id, variant_id, revision, copy, hashtag_placement, alt_text, alt_text_reviewed,
        alt_text_reviewed_by, alt_text_reviewed_at, '{}', publish_method, composition_mode,
        custom_scheduled_at, channel_fingerprint, revision_hash, created_by, created_at
      from social_variant_revisions_safe;
      drop table social_variant_revisions_safe;
      PRAGMA legacy_alter_table = OFF;
    `);
    database.close();

    expect(() => lineageDb()).toThrow('refusing destructive migration');
    const preserved = new DatabaseSync(path, { readOnly: true });
    try {
      expect(preserved.prepare('select id, copy, network_metadata_json from social_variant_revisions').get()).toEqual({ id: 'revision-old', copy: 'Historical copy', network_metadata_json: '{}' });
    } finally { preserved.close(); rmSync(scratch, { recursive: true, force: true }); }
  });
});
