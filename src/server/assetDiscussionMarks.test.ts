import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { getLineageSnapshot, indexLineageAssets, linkLineageAssets, markLineageRerollRequest, updateSelectedAsset } from './assetLineage';
import { lineageDb } from './assetLineageDb';
import { fileSha256 } from './localReview';
import {
  clearAssetDiscussionMarks,
  listAssetDiscussionMarks,
  markAssetDiscussion,
  noteAssetDiscussion,
  registerAssetDiscussionMarkRoutes,
  unmarkAssetDiscussion,
} from './assetDiscussionMarks';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-discussion-marks');
const dbFile = join(scratchDir, 'asset-discussion-marks.sqlite');
let server: Server | undefined;

afterEach(() => { server?.close(); server = undefined; });

function localId(file: string): string { return `local-${fileSha256(file).slice(0, 12)}`; }

function seedLineage() {
  mkdirSync(scratchDir, { recursive: true });
  const root = join(scratchDir, 'discussion-root.png');
  const child = join(scratchDir, 'discussion-child.png');
  const sibling = join(scratchDir, 'discussion-sibling.png');
  writeFileSync(root, Buffer.from('discussion-root'));
  writeFileSync(child, Buffer.from('discussion-child'));
  writeFileSync(sibling, Buffer.from('discussion-sibling'));
  indexLineageAssets(defaultProject);
  const rootId = localId(root); const childId = localId(child); const siblingId = localId(sibling);
  linkLineageAssets(defaultProject, { childAssetId: childId, confirmWrite: true, parentAssetId: rootId });
  linkLineageAssets(defaultProject, { childAssetId: siblingId, confirmWrite: true, parentAssetId: rootId });
  return { child, childId, rootId, siblingId };
}

function nonGenerativeState() {
  const database = lineageDb();
  try {
    return Object.fromEntries(['asset_selections', 'asset_reroll_requests', 'agent_claims', 'lineage_tasks'].map(table => [
      table,
      database.prepare(`select * from ${table} order by id`).all(),
    ]));
  } finally { database.close(); }
}

function appWithRoutes() {
  const app = express(); app.use(express.json());
  registerAssetDiscussionMarkRoutes(app, input => {
    const candidate = input.body?.project || input.query?.project;
    return typeof candidate === 'string' ? candidate : defaultProject;
  }, handler => (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof Error && 'status' in error ? Number(error.status) : 500).json({ error: error instanceof Error ? error.message : String(error) });
  });
  server = app.listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('asset Discussion set persistence', () => {
  beforeEach(() => { rmSync(scratchDir, { force: true, recursive: true }); useLineageTestProfile(dbFile); });

  it('creates a dedicated canvas-scoped table without changing Social storage', () => {
    const database = lineageDb();
    try {
      const columns = database.prepare('pragma table_info(asset_discussion_marks)').all() as Array<{ name: string }>;
      expect(columns.map(column => column.name)).toEqual([
        'id', 'project_id', 'root_asset_id', 'asset_id', 'notes', 'marked_by', 'marked_at', 'unmarked_by', 'unmarked_at', 'updated_at', 'updated_by',
      ]);
      expect(database.prepare("select name from sqlite_master where type = 'table' and name = 'asset_social_marks'").get()).toBeDefined();
    } finally { database.close(); }
  });

  it('marks multiple nodes, edits and clears optional notes, unmarks, and clears all', () => {
    const files = seedLineage();
    markAssetDiscussion(defaultProject, { asset: files.childId, confirmWrite: true, markedBy: 'human:canvas', rootAssetId: files.rootId });
    markAssetDiscussion(defaultProject, { asset: files.siblingId, confirmWrite: true, markedBy: 'human:canvas', notes: 'Check channel sizing', rootAssetId: files.rootId });
    expect(listAssetDiscussionMarks(defaultProject, files.rootId).marks).toEqual([
      expect.objectContaining({ asset_id: files.childId, notes: undefined }),
      expect.objectContaining({ asset_id: files.siblingId, notes: 'Check channel sizing' }),
    ]);
    expect(getLineageSnapshot(defaultProject, files.rootId).nodes.find(node => node.asset_id === files.childId)?.discussion_mark?.active).toBe(true);

    noteAssetDiscussion(defaultProject, { asset: files.childId, confirmWrite: true, notes: 'Compare hierarchy', rootAssetId: files.rootId, updatedBy: 'human:editor' });
    expect(listAssetDiscussionMarks(defaultProject, files.rootId).marks[0]).toMatchObject({ notes: 'Compare hierarchy', updated_by: 'human:editor' });
    expect(getLineageSnapshot(defaultProject, files.rootId).nodes.find(node => node.asset_id === files.childId)?.discussion_mark)
      .toMatchObject({ notes: 'Compare hierarchy', updated_by: 'human:editor' });
    noteAssetDiscussion(defaultProject, { asset: files.childId, confirmWrite: true, notes: '', rootAssetId: files.rootId, updatedBy: 'human:canvas' });
    expect(listAssetDiscussionMarks(defaultProject, files.rootId).marks[0].notes).toBeUndefined();

    unmarkAssetDiscussion(defaultProject, { asset: files.childId, confirmWrite: true, rootAssetId: files.rootId, unmarkedBy: 'human:canvas' });
    expect(listAssetDiscussionMarks(defaultProject, files.rootId).marks.map(mark => mark.asset_id)).toEqual([files.siblingId]);
    markAssetDiscussion(defaultProject, { asset: files.childId, confirmWrite: true, markedBy: 'human:canvas', notes: 'Fresh cycle', rootAssetId: files.rootId });
    expect(listAssetDiscussionMarks(defaultProject, files.rootId).marks.find(mark => mark.asset_id === files.childId))
      .toMatchObject({ notes: 'Fresh cycle', updated_by: undefined });
    unmarkAssetDiscussion(defaultProject, { asset: files.childId, confirmWrite: true, rootAssetId: files.rootId, unmarkedBy: 'human:canvas' });
    expect(clearAssetDiscussionMarks(defaultProject, { clearedBy: 'human:canvas', confirmWrite: true, rootAssetId: files.rootId })).toMatchObject({ cleared_count: 1, ok: true });
    expect(listAssetDiscussionMarks(defaultProject, files.rootId).marks).toEqual([]);
  });

  it('leaves branch selections, re-roll requests, agent claims, and lineage tasks unchanged for every mutation', () => {
    const files = seedLineage();
    updateSelectedAsset(defaultProject, { assetId: files.childId, confirmWrite: true, rootAssetId: files.rootId });
    markLineageRerollRequest(defaultProject, { confirmWrite: true, nodeAssetId: files.siblingId, requestedBy: 'human', rootAssetId: files.rootId });
    const before = nonGenerativeState();
    markAssetDiscussion(defaultProject, { asset: files.childId, confirmWrite: true, markedBy: 'human:canvas', rootAssetId: files.rootId });
    expect(nonGenerativeState()).toEqual(before);
    noteAssetDiscussion(defaultProject, { asset: files.childId, confirmWrite: true, notes: 'Question', rootAssetId: files.rootId, updatedBy: 'human:canvas' });
    expect(nonGenerativeState()).toEqual(before);
    unmarkAssetDiscussion(defaultProject, { asset: files.childId, confirmWrite: true, rootAssetId: files.rootId, unmarkedBy: 'human:canvas' });
    expect(nonGenerativeState()).toEqual(before);
    markAssetDiscussion(defaultProject, { asset: files.siblingId, confirmWrite: true, markedBy: 'human:canvas', rootAssetId: files.rootId });
    clearAssetDiscussionMarks(defaultProject, { clearedBy: 'human:canvas', confirmWrite: true, rootAssetId: files.rootId });
    expect(nonGenerativeState()).toEqual(before);
  });

  it('lists agent-readable local context and canonical discuss commands', () => {
    const files = seedLineage();
    markAssetDiscussion(defaultProject, { asset: files.childId, confirmWrite: true, markedBy: 'human:canvas', notes: 'Discuss crop', rootAssetId: files.rootId });
    const listed = listAssetDiscussionMarks(defaultProject, files.rootId);
    expect(listed.schema_version).toBe('lineage.discussion_marks.v1');
    expect(listed.marks).toHaveLength(1);
    expect(listed.marks[0]).toMatchObject({
      asset_id: files.childId, checksum_sha256: fileSha256(files.child), local: { absolute_path: files.child, exists: true }, notes: 'Discuss crop', warnings: [],
    });
    expect(listed.commands.clear).toContain('discuss clear');
    expect(listed.marks[0].commands.note).toContain('discuss note');
    expect(listed.marks[0].commands.unmark).toContain('discuss unmark');
  });

  it('treats a pre-feature read-only database as an empty Discussion set', () => {
    const files = seedLineage();
    const database = lineageDb();
    try { database.exec('drop table asset_discussion_marks'); } finally { database.close(); }
    process.env.LINEAGE_DB_ACCESS = 'read-only';
    expect(getLineageSnapshot(defaultProject, files.rootId).nodes.every(node => node.discussion_mark === undefined)).toBe(true);
    expect(listAssetDiscussionMarks(defaultProject, files.rootId).marks).toEqual([]);
  });

  it('serves mark, note, list, unmark, and clear through the HTTP contract', async () => {
    const files = seedLineage(); const baseUrl = appWithRoutes();
    const post = (path: string, body: Record<string, unknown>) => fetch(`${baseUrl}${path}`, {
      body: JSON.stringify({ ...body, confirmWrite: true, project: defaultProject }), headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect((await post(`/api/lineage/${files.rootId}/discussion-marks/${files.childId}`, { markedBy: 'human:canvas' })).ok).toBe(true);
    expect((await post(`/api/lineage/${files.rootId}/discussion-marks/${files.childId}/note`, { notes: 'General question' })).ok).toBe(true);
    expect((await post(`/api/lineage/${files.rootId}/discussion-marks/${files.childId}/note`, {})).status).toBe(400);
    expect((await post(`/api/lineage/${files.rootId}/discussion-marks/${files.childId}/note`, { notes: 42 })).status).toBe(400);
    const listed = await (await fetch(`${baseUrl}/api/lineage/${files.rootId}/discussion-marks?project=${defaultProject}`)).json() as { marks: Array<{ notes?: string }> };
    expect(listed.marks[0].notes).toBe('General question');
    expect((await post(`/api/lineage/${files.rootId}/discussion-marks/${files.childId}/note`, { notes: '' })).ok).toBe(true);
    expect((await post(`/api/lineage/${files.rootId}/discussion-marks/${files.childId}/unmark`, {})).ok).toBe(true);
    markAssetDiscussion(defaultProject, { asset: files.siblingId, confirmWrite: true, markedBy: 'human:canvas', rootAssetId: files.rootId });
    expect((await post(`/api/lineage/${files.rootId}/discussion-marks/actions/clear`, {})).ok).toBe(true);
    expect(listAssetDiscussionMarks(defaultProject, files.rootId).marks).toEqual([]);
  });

  it('does not confuse a node named clear with the clear-all action', async () => {
    const files = seedLineage();
    const database = lineageDb();
    try {
      database.prepare(`
        insert into assets (
          id, project_id, source, local_path, s3_key, checksum_sha256, media_type, title, status,
          channel, campaign, audience, size_bytes, content_type, created_at, updated_at, last_seen_at
        )
        select 'clear', project_id, source, local_path, s3_key, checksum_sha256, media_type, 'Clear node', status,
          channel, campaign, audience, size_bytes, content_type, created_at, updated_at, last_seen_at
        from assets where id = ?
      `).run(files.childId);
    } finally { database.close(); }
    linkLineageAssets(defaultProject, { childAssetId: 'clear', confirmWrite: true, parentAssetId: files.rootId });
    const baseUrl = appWithRoutes();
    const post = (path: string) => fetch(`${baseUrl}${path}`, {
      body: JSON.stringify({ actor: 'human:canvas', confirmWrite: true, project: defaultProject }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect((await post(`/api/lineage/${files.rootId}/discussion-marks/clear`)).ok).toBe(true);
    expect(listAssetDiscussionMarks(defaultProject, files.rootId).marks.map(mark => mark.asset_id)).toEqual(['clear']);
    expect((await post(`/api/lineage/${files.rootId}/discussion-marks/actions/clear`)).ok).toBe(true);
    expect(listAssetDiscussionMarks(defaultProject, files.rootId).marks).toEqual([]);
  });
});
