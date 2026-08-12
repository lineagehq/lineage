import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { join, resolve } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { createAgentClaim } from './agentClaims';
import { getLineageSnapshot, indexLineageAssets, linkLineageAssets } from './assetLineage';
import { lineageDb } from './assetLineageDb';
import { createLineageWorkspace, lineageWorkspaceId } from './assetLineageWorkspaces';
import { fileSha256 } from './localReview';
import { listAssetSocialMarks, markAssetSocial, registerAssetSocialMarkRoutes, unmarkAssetSocial } from './assetSocialMarks';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-social-marks');
const dbFile = join(scratchDir, 'asset-social-marks.sqlite');
let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedLineage() {
  mkdirSync(scratchDir, { recursive: true });
  const root = join(scratchDir, 'demo-linkedin-social-root.png');
  const child = join(scratchDir, 'demo-linkedin-social-child.png');
  const sibling = join(scratchDir, 'demo-linkedin-social-sibling.png');
  writeFileSync(root, Buffer.from('social-root'));
  writeFileSync(child, Buffer.from('social-child'));
  writeFileSync(sibling, Buffer.from('social-sibling'));
  indexLineageAssets(defaultProject);
  const rootId = localId(root);
  const childId = localId(child);
  const siblingId = localId(sibling);
  linkLineageAssets(defaultProject, { childAssetId: childId, confirmWrite: true, parentAssetId: rootId });
  linkLineageAssets(defaultProject, { childAssetId: siblingId, confirmWrite: true, parentAssetId: rootId });
  return { child, childId, root, rootId, sibling, siblingId };
}

function appWithSocialMarkRoutes() {
  const app = express();
  app.use(express.json());
  registerAssetSocialMarkRoutes(app, input => {
    const candidate = input.body?.project || input.query?.project;
    return typeof candidate === 'string' ? candidate : defaultProject;
  }, handler => (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof Error && 'status' in error ? Number(error.status) : 500;
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  });
  server = app.listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('asset social mark persistence', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    useLineageTestProfile(dbFile);
  });

  it('creates the canvas-scoped social mark table', () => {
    const database = lineageDb();
    try {
      const columns = database.prepare('pragma table_info(asset_social_marks)').all() as Array<{ name: string }>;
      const indexes = database.prepare('pragma index_list(asset_social_marks)').all() as Array<{ unique: number }>;

      expect(columns.map(column => column.name)).toEqual([
        'id',
        'project_id',
        'root_asset_id',
        'asset_id',
        'notes',
        'marked_by',
        'marked_at',
        'unmarked_by',
        'unmarked_at',
        'updated_at',
      ]);
      expect(indexes.some(index => Number(index.unique) === 1)).toBe(true);
    } finally {
      database.close();
    }
  });

  it('dry-runs, marks, unmarks, and reactivates one durable row', () => {
    const files = seedLineage();
    const dryRun = markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: false,
      markedBy: 'agent:caption-planner',
      notes: 'Lead image',
      rootAssetId: files.rootId,
    });

    expect(dryRun).toMatchObject({ active: true, dryRun: true, ok: true });
    expect(listAssetSocialMarks(defaultProject, files.rootId).marks).toHaveLength(0);

    const marked = markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'agent:caption-planner',
      notes: 'Lead image',
      rootAssetId: files.rootId,
    });
    expect(marked).toMatchObject({
      active: true,
      mark: {
        asset_id: files.childId,
        marked_by: 'agent:caption-planner',
        notes: 'Lead image',
        root_asset_id: files.rootId,
      },
      ok: true,
      snapshot: {
        nodes: expect.arrayContaining([
          expect.objectContaining({ asset_id: files.childId, social_mark: expect.objectContaining({ active: true }) }),
        ]),
      },
    });

    const unmarked = unmarkAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      rootAssetId: files.rootId,
      unmarkedBy: 'human:owner',
    });
    expect(unmarked).toMatchObject({ active: false, mark: { unmarked_by: 'human:owner' }, ok: true });
    expect(listAssetSocialMarks(defaultProject, files.rootId).marks).toHaveLength(0);

    markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'human:owner',
      rootAssetId: files.rootId,
    });
    const database = lineageDb();
    try {
      const rows = database.prepare('select * from asset_social_marks').all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ marked_by: 'human:owner', unmarked_at: null, unmarked_by: null });
    } finally {
      database.close();
    }
  });

  it('accepts exactly 1000 trimmed Unicode code points and rejects longer notes before any write', () => {
    const files = seedLineage();
    const exact = `  ${'💡'.repeat(1000)}  `;
    const overLimit = '💡'.repeat(1001);

    expect(() => markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'human:owner',
      notes: overLimit,
      rootAssetId: files.rootId,
    })).toThrow('1000 Unicode code points');
    expect(listAssetSocialMarks(defaultProject, files.rootId).marks).toEqual([]);

    const marked = markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'human:owner',
      notes: exact,
      rootAssetId: files.rootId,
    });
    expect(marked.mark?.notes).toBe('💡'.repeat(1000));
    expect([...marked.mark!.notes!]).toHaveLength(1000);

    const database = lineageDb();
    try {
      const before = database.prepare('select * from asset_social_marks where project_id = ? and root_asset_id = ? and asset_id = ?')
        .get(defaultProject, files.rootId, files.childId);
      expect(() => markAssetSocial(defaultProject, {
        asset: files.childId,
        confirmWrite: true,
        markedBy: 'agent:social',
        notes: overLimit,
        rootAssetId: files.rootId,
      })).toThrow('1000 Unicode code points');
      const after = database.prepare('select * from asset_social_marks where project_id = ? and root_asset_id = ? and asset_id = ?')
        .get(defaultProject, files.rootId, files.childId);
      expect(after).toEqual(before);
    } finally {
      database.close();
    }
  });

  it('keeps the same asset isolated between parent and child canvas roots', () => {
    const files = seedLineage();
    createLineageWorkspace(defaultProject, {
      confirmWrite: true,
      rootAssetId: files.childId,
      title: 'Child social canvas',
    });

    markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'human:owner',
      rootAssetId: files.rootId,
    });

    expect(listAssetSocialMarks(defaultProject, files.rootId).marks.map(mark => mark.asset_id)).toEqual([files.childId]);
    expect(listAssetSocialMarks(defaultProject, files.childId).marks).toEqual([]);

    markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'agent:social',
      rootAssetId: files.childId,
    });
    expect(listAssetSocialMarks(defaultProject, files.childId).marks.map(mark => mark.asset_id)).toEqual([files.childId]);
  });

  it('isolates active marks and authoritative snapshots across two projects and two canvases', () => {
    const files = seedLineage();
    const otherProject = 'other-project';
    const otherRoot = 'other-social-root';
    const otherChild = 'other-social-child';
    const timestamp = '2026-08-11T20:00:00.000Z';
    const database = lineageDb();
    try {
      database.prepare('insert into projects (id, product, catalog_path, created_at, updated_at) values (?, ?, null, ?, ?)')
        .run(otherProject, otherProject, timestamp, timestamp);
      const insertAsset = database.prepare(`
        insert into assets (
          id, project_id, source, local_path, s3_key, checksum_sha256, media_type,
          title, status, channel, campaign, audience, size_bytes, content_type,
          created_at, updated_at, last_seen_at
        ) values (?, ?, 'local', null, null, null, 'image', ?, 'working', 'social', null, null, null, 'image/png', ?, ?, ?)
      `);
      insertAsset.run(otherRoot, otherProject, 'Other root', timestamp, timestamp, timestamp);
      insertAsset.run(otherChild, otherProject, 'Other child', timestamp, timestamp, timestamp);
      database.prepare(`
        insert into asset_edges (id, project_id, parent_asset_id, child_asset_id, relation_type, created_at)
        values (?, ?, ?, ?, 'derived_from', ?)
      `).run(`${otherProject}:edge`, otherProject, otherRoot, otherChild, timestamp);
    } finally {
      database.close();
    }
    createLineageWorkspace(defaultProject, { confirmWrite: true, rootAssetId: files.childId, title: 'Default child canvas' });
    createLineageWorkspace(otherProject, { confirmWrite: true, rootAssetId: otherChild, title: 'Other child canvas' });

    markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'human:default',
      rootAssetId: files.rootId,
    });
    markAssetSocial(otherProject, {
      asset: otherChild,
      confirmWrite: true,
      markedBy: 'human:other',
      rootAssetId: otherRoot,
    });

    expect(listAssetSocialMarks(defaultProject, files.rootId).marks.map(mark => mark.asset_id)).toEqual([files.childId]);
    expect(listAssetSocialMarks(otherProject, otherRoot).marks.map(mark => mark.asset_id)).toEqual([otherChild]);
    expect(listAssetSocialMarks(defaultProject, files.childId).marks).toEqual([]);
    expect(listAssetSocialMarks(otherProject, otherChild).marks).toEqual([]);
    expect(getLineageSnapshot(defaultProject, files.rootId).nodes.find(node => node.asset_id === files.childId)?.social_mark?.marked_by).toBe('human:default');
    expect(getLineageSnapshot(otherProject, otherRoot).nodes.find(node => node.asset_id === otherChild)?.social_mark?.marked_by).toBe('human:other');
    expect(getLineageSnapshot(defaultProject, files.childId).nodes[0].social_mark).toBeUndefined();
    expect(getLineageSnapshot(otherProject, otherChild).nodes[0].social_mark).toBeUndefined();
    expect(() => listAssetSocialMarks(otherProject, files.rootId)).toThrow();
  });

  it('fails closed for non-canonical roots, invisible assets, and ambiguous titles', () => {
    const files = seedLineage();
    expect(() => listAssetSocialMarks(defaultProject, files.childId)).toThrow('not a canonical lineage canvas root');
    expect(() => markAssetSocial(defaultProject, {
      asset: 'missing-asset',
      confirmWrite: true,
      markedBy: 'agent:social',
      rootAssetId: files.rootId,
    })).toThrow('not visible in lineage canvas');

    const database = lineageDb();
    try {
      database.prepare('update assets set title = ? where id in (?, ?)').run('Same title', files.childId, files.siblingId);
    } finally {
      database.close();
    }
    expect(() => markAssetSocial(defaultProject, {
      asset: 'Same title',
      confirmWrite: true,
      markedBy: 'agent:social',
      rootAssetId: files.rootId,
    })).toThrow('matches multiple visible nodes');
  });

  it('enforces an active workspace claim for confirmed mutations but not listing', () => {
    const files = seedLineage();
    const claim = createAgentClaim({
      agentName: 'Social scheduling agent',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(defaultProject, files.rootId),
    });

    expect(() => markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'agent:social',
      rootAssetId: files.rootId,
    })).toThrow('Mutating agent write requires a matching claim token');
    expect(listAssetSocialMarks(defaultProject, files.rootId).marks).toEqual([]);

    markAssetSocial(defaultProject, {
      asset: files.childId,
      claimToken: claim.claim_token,
      confirmWrite: true,
      markedBy: 'agent:social',
      rootAssetId: files.rootId,
    });
    expect(listAssetSocialMarks(defaultProject, files.rootId).marks).toHaveLength(1);
  });

  it('enforces an active workspace claim for idempotent confirmed mutations', () => {
    const files = seedLineage();
    markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'human:owner',
      rootAssetId: files.rootId,
    });
    const claim = createAgentClaim({
      agentName: 'Social scheduling agent',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(defaultProject, files.rootId),
    });

    expect(() => markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'agent:social',
      rootAssetId: files.rootId,
    })).toThrow('Mutating agent write requires a matching claim token');

    unmarkAssetSocial(defaultProject, {
      asset: files.childId,
      claimToken: claim.claim_token,
      confirmWrite: true,
      rootAssetId: files.rootId,
      unmarkedBy: 'agent:social',
    });
    expect(() => unmarkAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      rootAssetId: files.rootId,
      unmarkedBy: 'agent:social',
    })).toThrow('Mutating agent write requires a matching claim token');
  });

  it('lists scheduling-ready local context and keeps missing media as an item warning', () => {
    const files = seedLineage();
    markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'human:owner',
      rootAssetId: files.rootId,
    });

    const listed = listAssetSocialMarks(defaultProject, files.rootId);
    expect(listed).toMatchObject({
      project: defaultProject,
      root_asset_id: files.rootId,
      schema_version: 'lineage.social_marks.v1',
      workspace: { id: lineageWorkspaceId(defaultProject, files.rootId), root_asset_id: files.rootId },
    });
    expect(listed.marks[0]).toMatchObject({
      asset_id: files.childId,
      checksum_sha256: fileSha256(files.child),
      local: { absolute_path: files.child, exists: true },
      source: 'local',
      warnings: [],
    });
    expect(listed.marks[0].commands.unmark).toContain(`social unmark --project '${defaultProject}' --root '${files.rootId}' --asset '${files.childId}'`);

    rmSync(files.child);
    const missing = listAssetSocialMarks(defaultProject, files.rootId).marks[0];
    expect(missing.local).toMatchObject({ absolute_path: files.child, exists: false });
    expect(missing.warnings).toEqual([expect.stringContaining('local file is missing')]);
  });

  it('keeps S3-only media listed with an actionable warning that redacts its storage key', () => {
    const files = seedLineage();
    markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'human:owner',
      rootAssetId: files.rootId,
    });
    const privateStorageKey = 'private/social-child.png?credential=do-not-expose';
    const database = lineageDb();
    try {
      database.prepare('update assets set local_path = null, s3_key = ? where id = ?').run(privateStorageKey, files.childId);
      database.prepare('update asset_attempts set file_path = null where node_asset_id = ? and is_current = 1').run(files.childId);
    } finally {
      database.close();
    }

    const listed = listAssetSocialMarks(defaultProject, files.rootId);
    expect(listed.marks).toHaveLength(1);
    expect(listed.marks[0]).toMatchObject({
      asset_id: files.childId,
      local: { absolute_path: undefined, exists: false },
      warnings: [expect.stringMatching(/non-local.*readable local copy/i)],
    });
    expect(listed.marks[0].warnings.join(' ')).not.toContain(privateStorageKey);
  });

  it('keeps unreadable local media listed with an actionable item warning', () => {
    const files = seedLineage();
    markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'human:owner',
      rootAssetId: files.rootId,
    });
    chmodSync(files.child, 0o000);

    const listed = listAssetSocialMarks(defaultProject, files.rootId);
    expect(listed.marks).toHaveLength(1);
    expect(listed.marks[0]).toMatchObject({
      asset_id: files.childId,
      local: { absolute_path: files.child, exists: true },
      warnings: [expect.stringMatching(/unreadable.*permissions/i)],
    });
  });

  it('generates every Social command with the selected runtime profile', () => {
    const files = seedLineage();
    markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'human:owner',
      rootAssetId: files.rootId,
    });

    const listed = listAssetSocialMarks(defaultProject, files.rootId);
    const commands = [
      listed.commands.mark,
      listed.marks[0].commands.mark,
      listed.marks[0].commands.unmark,
    ];
    for (const command of commands) {
      expect(command).toContain(`--profile '${process.env.LINEAGE_PROFILE_MANIFEST}' --json`);
    }
  });

  it('resolves an already scratch-prefixed missing path from the repository root', () => {
    const files = seedLineage();
    markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'human:owner',
      rootAssetId: files.rootId,
    });
    const relativePath = '.asset-scratch/vitest-social-marks/missing-prefixed.png';
    const database = lineageDb();
    try {
      database.prepare('update assets set local_path = ? where id = ?').run(relativePath, files.childId);
      database.prepare('update asset_attempts set file_path = ? where node_asset_id = ? and is_current = 1').run(relativePath, files.childId);
    } finally {
      database.close();
    }

    const missing = listAssetSocialMarks(defaultProject, files.rootId).marks[0];
    expect(missing.local).toEqual({
      absolute_path: resolve(repoRoot, relativePath),
      exists: false,
      relative_path: relativePath,
    });
  });

  it('treats a pre-feature read-only database without social marks as empty', () => {
    const files = seedLineage();
    const database = lineageDb();
    try {
      database.exec('drop table asset_social_marks');
    } finally {
      database.close();
    }
    process.env.LINEAGE_DB_ACCESS = 'read-only';

    expect(getLineageSnapshot(defaultProject, files.rootId).nodes.every(node => node.social_mark === undefined)).toBe(true);
    expect(listAssetSocialMarks(defaultProject, files.rootId).marks).toEqual([]);

    const readOnlyDatabase = lineageDb();
    try {
      expect(readOnlyDatabase.prepare("select name from sqlite_master where type = 'table' and name = 'asset_social_marks'").get()).toBeUndefined();
    } finally {
      readOnlyDatabase.close();
    }
  });

  it('does not project inactive audit rows into the lineage snapshot', () => {
    const files = seedLineage();
    markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'human:owner',
      rootAssetId: files.rootId,
    });
    unmarkAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      rootAssetId: files.rootId,
      unmarkedBy: 'human:owner',
    });

    expect(getLineageSnapshot(defaultProject, files.rootId).nodes.find(node => node.asset_id === files.childId)?.social_mark).toBeUndefined();
  });

  it('serves mark, list, and unmark through the canvas-scoped HTTP contract', async () => {
    const files = seedLineage();
    const baseUrl = appWithSocialMarkRoutes();
    const markResponse = await fetch(`${baseUrl}/api/lineage/${files.rootId}/social-marks/${files.childId}`, {
      body: JSON.stringify({ confirmWrite: true, markedBy: 'human:canvas', notes: 'Discuss this image', project: defaultProject }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const listedResponse = await fetch(`${baseUrl}/api/lineage/${files.rootId}/social-marks?project=${defaultProject}`);
    const listed = await listedResponse.json() as { marks: Array<{ asset_id: string; notes?: string }> };
    const unmarkResponse = await fetch(`${baseUrl}/api/lineage/${files.rootId}/social-marks/${files.childId}/unmark`, {
      body: JSON.stringify({ confirmWrite: true, project: defaultProject, unmarkedBy: 'human:canvas' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(markResponse.ok).toBe(true);
    expect(listedResponse.ok).toBe(true);
    expect(listed.marks).toEqual([expect.objectContaining({ asset_id: files.childId, notes: 'Discuss this image' })]);
    expect(unmarkResponse.ok).toBe(true);
    expect(listAssetSocialMarks(defaultProject, files.rootId).marks).toEqual([]);
  });
});
