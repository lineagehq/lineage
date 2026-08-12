import { join } from 'node:path';
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
});
