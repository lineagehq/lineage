import express, { type Express } from 'express';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, listAssets, repoRoot } from './assetCore';
import { getLineageAttempts, getLineageNextAsset, getLineageSnapshot, indexLineageAssets, linkLineageAssets, updateSelectedAsset } from './assetLineage';
import {
  archiveDemoLineageWorkspace,
  demoSeedMediaStatus,
  downloadSwissifierRichDemoMedia,
  ensureSwissifierRichDemoWorkspace,
  restoreDemoSeedMedia,
  restoreSwissifierRichDemoProject,
  restoreSwissifierRichDemoMedia,
  seedDemoLineageWorkspace,
  seedSwissifierRichDemoWorkspace,
  swissifierRichDemoMediaStatus,
} from './assetLineageDemo';
import {
  activateLineageWorkspace,
  activeLineageWorkspaceRoot,
  archiveLineageWorkspace,
  createLineageWorkspace,
  inspectLineageWorkspace,
  lineageWorkspaceId,
  listLineageWorkspaces,
  migrateLegacyLineageWorkspaces,
  updateLineageWorkspace,
} from './assetLineageWorkspaces';
import { registerLineageWorkspaceRoutes } from './lineageWorkspaceRoutes';
import { fileSha256 } from './localReview';
import { lineageDb } from './assetLineageDb';
import { claimLineageTask, listLineageTasks } from './assetLineageTasks';
import {
  deleteProject,
  deleteWorkspace,
  demoBootstrapSuppressed,
  listProjectCollection,
  planProjectDeletion,
  planWorkspaceDeletion,
  swissifierDemoProject,
} from './projectWorkspaces';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-lineage-workspaces');
const dbFile = join(scratchDir, 'asset-lineage-workspaces.sqlite');
const demoProject = 'vitest-lineage-demo';
const demoProjectDir = join(repoRoot, demoProject);
const demoFilesDir = join(repoRoot, '.asset-scratch', 'lineage-demo', '2026-06-lineage-demo', demoProject);
const defaultDemoFilesDir = join(repoRoot, '.asset-scratch', 'lineage-demo', '2026-06-lineage-demo', defaultProject);
let server: ReturnType<Express['listen']> | null = null;

function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedFiles() {
  mkdirSync(scratchDir, { recursive: true });
  const rootA = join(scratchDir, 'demo-tiktok-hook-root-a.png');
  const childA = join(scratchDir, 'demo-tiktok-hook-child-a.png');
  const rootB = join(scratchDir, 'demo-linkedin-founder-root-b.png');
  const childB = join(scratchDir, 'demo-linkedin-founder-child-b.png');
  writeFileSync(rootA, Buffer.from('workspace-root-a'));
  writeFileSync(childA, Buffer.from('workspace-child-a'));
  writeFileSync(rootB, Buffer.from('workspace-root-b'));
  writeFileSync(childB, Buffer.from('workspace-child-b'));
  return {
    childA,
    childAId: localId(childA),
    childB,
    childBId: localId(childB),
    rootA,
    rootAId: localId(rootA),
    rootB,
    rootBId: localId(rootB),
  };
}

function seedTwoLineages() {
  const files = seedFiles();
  indexLineageAssets(defaultProject);
  linkLineageAssets(defaultProject, { childAssetId: files.childAId, confirmWrite: true, parentAssetId: files.rootAId });
  linkLineageAssets(defaultProject, { childAssetId: files.childBId, confirmWrite: true, parentAssetId: files.rootBId });
  updateSelectedAsset(defaultProject, {
    assetId: files.childBId,
    confirmWrite: true,
    notes: 'Use LinkedIn branch next.',
    rootAssetId: files.rootBId,
  });
  updateSelectedAsset(defaultProject, {
    assetId: files.childAId,
    confirmWrite: true,
    notes: 'Use TikTok branch next.',
    rootAssetId: files.rootAId,
  });
  return files;
}

function seedDemoProjectCatalog() {
  mkdirSync(join(demoProjectDir, 'assets'), { recursive: true });
  writeFileSync(join(demoProjectDir, 'assets', 'catalog.json'), JSON.stringify({
    assets: [],
    default_bucket: '',
    default_region: '',
    product: demoProject,
    project: demoProject,
  }, null, 2));
}

function projectFrom(input: { body?: Record<string, unknown>; query?: Record<string, unknown> }): string {
  const candidate = input.body?.project || input.query?.project;
  return typeof candidate === 'string' ? candidate : defaultProject;
}

function asyncRoute(handler: (req: express.Request, res: express.Response) => Promise<void> | void): express.RequestHandler {
  return (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); };
}

function appWithLineageWorkspaceRoutes() {
  const app = express();
  app.use(express.json());
  registerLineageWorkspaceRoutes(app, projectFrom, asyncRoute);
  server = app.listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function bufferServer(body: Buffer, status = 200) {
  server = createServer((_req, res) => {
    res.statusCode = status;
    res.setHeader('content-length', String(body.length));
    res.end(body);
  }).listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/swissifier-rich-demo-v1.tar.gz`;
}

function sha256(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

function tarGz(entries: Array<{ name: string; body: Buffer; typeflag?: string }>) {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(`${entry.body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii');
    header.fill(' ', 148, 156);
    header.write(entry.typeflag || '0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    const checksum = [...header].reduce((sum, value) => sum + value, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    chunks.push(header, entry.body);
    const padding = (512 - (entry.body.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

async function postJson<T>(baseUrl: string, path: string, body: Record<string, unknown>): Promise<{ body: T; status: number }> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  return { body: await response.json() as T, status: response.status };
}

describe('lineage workspaces', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    useLineageTestProfile(dbFile);
    rmSync(demoProjectDir, { force: true, recursive: true });
    rmSync(demoFilesDir, { force: true, recursive: true });
  });

  afterEach(() => {
    server?.close();
    server = null;
    rmSync(demoProjectDir, { force: true, recursive: true });
    rmSync(demoFilesDir, { force: true, recursive: true });
    rmSync(defaultDemoFilesDir, { force: true, recursive: true });
  });

  it('indexes catalog assets before creating a workspace through the HTTP route', async () => {
    const catalogAssets = listAssets(defaultProject, { source: 'catalog', page: 1, pageSize: 2 }).assets;
    const [catalogAsset, siblingAsset] = catalogAssets;
    const baseUrl = appWithLineageWorkspaceRoutes();

    const created = await postJson<{ workspace?: { root_asset_id: string; title: string } }>(baseUrl, '/api/lineage-workspaces', {
      confirmWrite: true,
      project: defaultProject,
      rootAssetId: catalogAsset.asset_id,
      title: 'Catalog root workspace',
    });

    expect(created.status).toBe(200);
    expect(created.body.workspace).toMatchObject({
      root_asset_id: catalogAsset.asset_id,
      title: 'Catalog root workspace',
    });
    expect(getLineageSnapshot(defaultProject, catalogAsset.asset_id).nodes[0]).toMatchObject({
      asset_id: catalogAsset.asset_id,
      source: 'catalog',
    });
    expect(linkLineageAssets(defaultProject, {
      childAssetId: siblingAsset.asset_id,
      confirmWrite: false,
      parentAssetId: catalogAsset.asset_id,
    })).toMatchObject({
      dryRun: true,
      edge: {
        child_asset_id: siblingAsset.asset_id,
        parent_asset_id: catalogAsset.asset_id,
      },
    });
  });

  it('aliases a visible local root already owned by another project without stealing the original asset', async () => {
    const files = seedFiles();
    seedDemoProjectCatalog();
    indexLineageAssets(defaultProject);
    const originalHash = fileSha256(files.rootA);
    const baseUrl = appWithLineageWorkspaceRoutes();

    const created = await postJson<{ workspace?: { root_asset_id: string; title: string } }>(baseUrl, '/api/lineage-workspaces', {
      confirmWrite: true,
      project: demoProject,
      rootAssetId: files.rootAId,
      title: 'Project-scoped local root',
    });
    const aliasedRoot = created.body.workspace?.root_asset_id;

    expect(created.status).toBe(200);
    expect(aliasedRoot).toBeTruthy();
    if (!aliasedRoot) throw new Error('Expected a project-scoped root asset identity');
    expect(aliasedRoot).not.toBe(files.rootAId);
    expect(created.body.workspace?.title).toBe('Project-scoped local root');
    expect(getLineageSnapshot(demoProject, aliasedRoot).nodes[0]).toMatchObject({
      asset_id: aliasedRoot,
      source: 'local',
    });

    const database = lineageDb();
    expect(database.prepare('select project_id from assets where id = ?').get(files.rootAId)).toEqual({
      project_id: defaultProject,
    });
    expect(database.prepare('select project_id, local_path from assets where id = ?').get(aliasedRoot)).toEqual({
      project_id: demoProject,
      local_path: expect.stringContaining('demo-tiktok-hook-root-a.png'),
    });
    database.close();
    expect(fileSha256(files.rootA)).toBe(originalHash);

    const repeated = await postJson<{ workspace?: { root_asset_id: string } }>(baseUrl, '/api/lineage-workspaces', {
      confirmWrite: true,
      project: demoProject,
      rootAssetId: files.rootAId,
      title: 'Project-scoped local root',
    });
    expect(repeated.status).toBe(200);
    expect(repeated.body.workspace?.root_asset_id).toBe(aliasedRoot);

    const releasedOriginal = lineageDb();
    releasedOriginal.prepare('delete from asset_reviews where asset_id = ?').run(files.rootAId);
    releasedOriginal.prepare('delete from assets where id = ?').run(files.rootAId);
    releasedOriginal.close();
    const afterOwnerDeletion = await postJson<{ workspace?: { root_asset_id: string } }>(baseUrl, '/api/lineage-workspaces', {
      confirmWrite: true,
      project: demoProject,
      rootAssetId: files.rootAId,
      title: 'Project-scoped local root',
    });
    expect(afterOwnerDeletion.status).toBe(200);
    expect(afterOwnerDeletion.body.workspace?.root_asset_id).toBe(aliasedRoot);
  });

  it('creates a workspace from an existing indexed root in a catalogless SQLite project', async () => {
    const project = 'vitest-catalogless-project';
    const rootAssetId = 'catalogless-indexed-root';
    const timestamp = '2026-07-29T12:00:00.000Z';
    const database = lineageDb();
    database.prepare(`
      insert into projects (
        id, product, display_name, catalog_path, catalog_state, sort_position, created_at, updated_at
      ) values (?, ?, ?, null, 'ready', 0, ?, ?)
    `).run(project, project, 'Catalogless project', timestamp, timestamp);
    database.prepare(`
      insert into assets (
        id, project_id, source, local_path, s3_key, checksum_sha256, media_type, title, status,
        channel, campaign, audience, size_bytes, content_type, created_at, updated_at, last_seen_at
      ) values (?, ?, 'local', 'catalogless/root.png', null, null, 'image', 'Catalogless root',
        'working', null, null, null, 10, 'image/png', ?, ?, ?)
    `).run(rootAssetId, project, timestamp, timestamp, timestamp);
    database.close();
    const baseUrl = appWithLineageWorkspaceRoutes();

    const created = await postJson<{ workspace?: { root_asset_id: string; title: string } }>(baseUrl, '/api/lineage-workspaces', {
      confirmWrite: true,
      project,
      rootAssetId,
      title: 'Catalogless workspace',
    });

    expect(created.status).toBe(200);
    expect(created.body.workspace).toMatchObject({
      root_asset_id: rootAssetId,
      title: 'Catalogless workspace',
    });
    expect(getLineageSnapshot(project, rootAssetId).nodes[0]).toMatchObject({
      asset_id: rootAssetId,
      project,
    });
  });

  it('seeds workspace rows from existing root-scoped selections without rewriting them', () => {
    const files = seedTwoLineages();

    migrateLegacyLineageWorkspaces(defaultProject);
    const snapshot = listLineageWorkspaces(defaultProject);

    expect(snapshot.workspaces.map(workspace => workspace.root_asset_id).sort()).toEqual([files.rootAId, files.rootBId].sort());
    expect(snapshot.workspaces.every(workspace => workspace.status === 'active')).toBe(true);
    expect(inspectLineageWorkspace(defaultProject, lineageWorkspaceId(defaultProject, files.rootAId))).toMatchObject({
      root_asset_id: files.rootAId,
      created_by: 'system',
    });
    expect(getLineageNextAsset(defaultProject, files.rootAId).next_asset?.asset_id).toBe(files.childAId);
    expect(getLineageNextAsset(defaultProject, files.rootBId).next_asset?.asset_id).toBe(files.childBId);
  });

  it('infers adopted legacy workspaces without writes when a profile command opens the database read-only', () => {
    const files = seedTwoLineages();
    const database = lineageDb();
    database.exec('delete from lineage_workspaces');
    database.close();
    process.env.LINEAGE_DB_ACCESS = 'read-only';
    try {
      const snapshot = listLineageWorkspaces(defaultProject);

      expect(snapshot.active_workspace).not.toBeNull();
      expect(snapshot.workspaces.map(workspace => workspace.root_asset_id).sort()).toEqual([files.rootAId, files.rootBId].sort());
      expect(inspectLineageWorkspace(defaultProject, files.rootAId)).toMatchObject({
        created_by: 'system',
        root_asset_id: files.rootAId,
      });
      expect(activeLineageWorkspaceRoot(defaultProject)).toBeTruthy();

      const verification = new DatabaseSync(dbFile, { readOnly: true });
      expect(verification.prepare('select count(*) count from lineage_workspaces').get()).toEqual({ count: 0 });
      verification.close();
    } finally {
      delete process.env.LINEAGE_DB_ACCESS;
    }
  });

  it('projects legacy workspaces read-only before tombstone tables have been migrated', () => {
    const files = seedTwoLineages();
    const database = lineageDb();
    database.exec('delete from lineage_workspaces; drop table deleted_lineage_workspaces');
    database.close();
    process.env.LINEAGE_DB_ACCESS = 'read-only';
    try {
      expect(listLineageWorkspaces(defaultProject).workspaces.map(workspace => workspace.root_asset_id).sort())
        .toEqual([files.rootAId, files.rootBId].sort());
    } finally {
      delete process.env.LINEAGE_DB_ACCESS;
    }
  });

  it('creates, updates, and activates explicit workspaces independently under one project', () => {
    const files = seedTwoLineages();

    const dryRun = createLineageWorkspace(defaultProject, {
      confirmWrite: false,
      notes: 'dry run only',
      rootAssetId: files.rootAId,
      title: 'TikTok hook workspace',
    });
    expect(dryRun).toMatchObject({ dryRun: true, workspace: { title: 'TikTok hook workspace' } });

    const saved = createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      notes: 'vertical hook exploration',
      rootAssetId: files.rootAId,
      title: 'TikTok hook workspace',
    });
    expect(saved.workspace).toMatchObject({
      notes: 'vertical hook exploration',
      root_asset_id: files.rootAId,
      status: 'active',
      title: 'TikTok hook workspace',
    });

    const updated = updateLineageWorkspace(defaultProject, saved.workspace!.id, {
      confirmWrite: true,
      notes: 'paused while reviewing',
      status: 'paused',
      title: 'TikTok paused workspace',
    });
    expect(updated.workspace).toMatchObject({
      notes: 'paused while reviewing',
      status: 'paused',
      title: 'TikTok paused workspace',
    });

    const linkedIn = createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      rootAssetId: files.rootBId,
      title: 'LinkedIn founder workspace',
    });
    const active = activateLineageWorkspace(defaultProject, linkedIn.workspace!.id, true);

    expect(active.workspace).toMatchObject({ root_asset_id: files.rootBId, status: 'active' });
    const snapshot = listLineageWorkspaces(defaultProject);
    expect(snapshot.active_workspace?.root_asset_id).toBe(files.rootBId);
    expect(snapshot.workspaces.map(workspace => workspace.root_asset_id)).toContain(files.rootAId);
    expect(snapshot.workspaces.map(workspace => workspace.root_asset_id)).toContain(files.rootBId);
  });

  it('uses active workspace root before latest selected root for rootless lineage next', () => {
    const files = seedTwoLineages();
    createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      rootAssetId: files.rootAId,
      title: 'TikTok workspace',
    });
    createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      rootAssetId: files.rootBId,
      title: 'LinkedIn workspace',
    });

    const next = getLineageNextAsset(defaultProject);

    expect(next.root_asset_id).toBe(files.rootBId);
    expect(next.next_asset?.asset_id).toBe(files.childBId);
    expect(next.selection?.notes).toBe('Use LinkedIn branch next.');
  });

  it('keeps snapshots scoped to an explicit child workspace root', () => {
    const files = seedTwoLineages();
    createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      rootAssetId: files.childAId,
      title: 'TikTok child workspace',
    });

    const snapshot = getLineageSnapshot(defaultProject, files.childAId);

    expect(snapshot.root_asset_id).toBe(files.childAId);
    expect(snapshot.active_asset_id).toBe(files.childAId);
    expect(snapshot.nodes.map(node => node.asset_id)).toEqual([files.childAId]);
  });

  it('archives a workspace and clears its selected next variation', () => {
    const files = seedTwoLineages();
    const saved = createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      rootAssetId: files.rootAId,
      title: 'Workspace to archive',
    });

    const archived = archiveLineageWorkspace(defaultProject, saved.workspace!.id, true);

    expect(archived.workspace).toMatchObject({ status: 'archived', active_at: undefined });
    expect(getLineageNextAsset(defaultProject, files.rootAId)).toMatchObject({
      selected: [],
      selection: null,
    });
  });

  it('keeps archived manual order and revisions stable when archive is retried', () => {
    const files = seedTwoLineages();
    const first = createLineageWorkspace(defaultProject, {
      confirmWrite: true,
      rootAssetId: files.rootAId,
      title: 'First archived workspace',
    }).workspace!;
    const second = createLineageWorkspace(defaultProject, {
      confirmWrite: true,
      rootAssetId: files.rootBId,
      title: 'Second archived workspace',
    }).workspace!;
    archiveLineageWorkspace(defaultProject, first.id, true);
    archiveLineageWorkspace(defaultProject, second.id, true);

    const beforeDatabase = lineageDb();
    const beforeRows = beforeDatabase.prepare(`
      select id, sort_position, revision from lineage_workspaces
      where project_id = ? and collection_kind = 'archived'
      order by sort_position, id
    `).all(defaultProject);
    const beforeRevision = beforeDatabase.prepare(`
      select revision from workspace_collection_state
      where project_id = ? and collection_kind = 'archived'
    `).get(defaultProject);
    beforeDatabase.close();

    expect(archiveLineageWorkspace(defaultProject, first.id, true)).toMatchObject({
      message: expect.stringContaining('already archived'),
      workspace: { id: first.id, status: 'archived' },
    });

    const afterDatabase = lineageDb();
    expect(afterDatabase.prepare(`
      select id, sort_position, revision from lineage_workspaces
      where project_id = ? and collection_kind = 'archived'
      order by sort_position, id
    `).all(defaultProject)).toEqual(beforeRows);
    expect(afterDatabase.prepare(`
      select revision from workspace_collection_state
      where project_id = ? and collection_kind = 'archived'
    `).get(defaultProject)).toEqual(beforeRevision);
    afterDatabase.close();
  });

  it('seeds and archives a repeatable demo workspace', () => {
    seedDemoProjectCatalog();

    const dryRun = seedDemoLineageWorkspace(demoProject, { confirmWrite: false });
    expect(dryRun).toMatchObject({ dryRun: true });
    expect(existsSync(demoFilesDir)).toBe(false);

    const seeded = seedDemoLineageWorkspace(demoProject, { confirmWrite: true });
    expect(seeded.workspace).toMatchObject({
      status: 'active',
      title: 'Demo: Content iteration tree',
    });
    expect(existsSync(demoFilesDir)).toBe(true);
    expect(getLineageNextAsset(demoProject).strategy).toBe('selected');

    const archived = archiveDemoLineageWorkspace(demoProject, true);
    expect(archived.archived.workspace).toMatchObject({ status: 'archived' });
    expect(existsSync(demoFilesDir)).toBe(false);
    expect(listLineageWorkspaces(demoProject).active_workspace).toBeNull();
  });

  it('uses generated local media for the default demo seed', () => {
    const seeded = seedDemoLineageWorkspace(defaultProject, { confirmWrite: true });
    const snapshot = getLineageSnapshot(defaultProject, seeded.root_asset_id);
    const next = getLineageNextAsset(defaultProject, seeded.root_asset_id);

    expect(seeded.workspace).toMatchObject({
      status: 'active',
      title: 'Demo: Content iteration tree',
    });
    expect(snapshot.nodes).toHaveLength(10);
    expect(snapshot.edges).toHaveLength(9);
    expect(snapshot.nodes.every(node => node.preview_url?.includes('/api/assets/local-preview?'))).toBe(true);
    expect(snapshot.nodes.every(node => node.local_path?.includes('lineage-demo'))).toBe(true);
    expect(next.strategy).toBe('selected');

    const archived = archiveDemoLineageWorkspace(defaultProject, true);
    expect(archived.archived.workspace).toMatchObject({ status: 'archived' });
    expect(existsSync(defaultDemoFilesDir)).toBe(false);
  });

  it('preserves a legacy demo prompt while its iterate task is active during reseed', () => {
    const seeded = seedDemoLineageWorkspace(defaultProject, { confirmWrite: true });
    const snapshot = getLineageSnapshot(defaultProject, seeded.root_asset_id);
    const targetAssetId = snapshot.selected[0];
    const legacyPrompt = 'Demo selected winner for the next variation.';
    const database = lineageDb();
    try {
      database.prepare(`
        update asset_selections set notes = ?
        where project_id = ? and root_asset_id = ? and asset_id = ?
      `).run(legacyPrompt, defaultProject, seeded.root_asset_id, targetAssetId);
      database.prepare(`
        update lineage_tasks set instructions = ?
        where project_id = ? and root_asset_id = ? and target_asset_id = ?
          and task_type = 'iterate' and status = 'pending'
      `).run(legacyPrompt, defaultProject, seeded.root_asset_id, targetAssetId);
    } finally {
      database.close();
    }
    const task = listLineageTasks(defaultProject, seeded.root_asset_id).tasks.find(item => item.target_asset_id === targetAssetId);
    if (!task) throw new Error('Expected the demo selection to have an iterate task');
    claimLineageTask(defaultProject, { agentName: 'Demo migration test', taskId: task.id });

    expect(() => seedDemoLineageWorkspace(defaultProject, { confirmWrite: true })).not.toThrow();

    expect(getLineageSnapshot(defaultProject, seeded.root_asset_id).selections.find(item => item.asset_id === targetAssetId)).toMatchObject({
      prompt: legacyPrompt,
    });
    expect(listLineageTasks(defaultProject, seeded.root_asset_id).tasks.find(item => item.id === task.id)).toMatchObject({
      instructions: legacyPrompt,
      status: 'claimed',
    });
  });

  it('reports and restores missing generated demo media', () => {
    const seeded = seedDemoLineageWorkspace(defaultProject, { confirmWrite: true });
    expect(demoSeedMediaStatus(defaultProject)).toMatchObject({
      present: 10,
      total: 10,
      missing: [],
    });

    rmSync(defaultDemoFilesDir, { force: true, recursive: true });
    expect(demoSeedMediaStatus(defaultProject)).toMatchObject({
      present: 0,
      total: 10,
    });

    const dryRun = restoreDemoSeedMedia(defaultProject, { confirmWrite: false });
    expect(dryRun).toMatchObject({ dryRun: true, restored: 0, would_restore: 10 });
    expect(existsSync(defaultDemoFilesDir)).toBe(false);

    const restored = restoreDemoSeedMedia(defaultProject, { confirmWrite: true });
    const snapshot = getLineageSnapshot(defaultProject, seeded.root_asset_id);

    expect(restored).toMatchObject({ dryRun: false, restored: 10 });
    expect(demoSeedMediaStatus(defaultProject)).toMatchObject({
      present: 10,
      total: 10,
      missing: [],
    });
    expect(snapshot.nodes.every(node => node.preview_url?.includes('/api/assets/local-preview?'))).toBe(true);

    archiveDemoLineageWorkspace(defaultProject, true);
  });

  it('seeds the manifest-backed Swissifier rich demo without bundling media', () => {
    const dryRun = seedSwissifierRichDemoWorkspace(defaultProject, { confirmWrite: false });
    expect(dryRun).toMatchObject({
      demo_id: 'swissifier-rich-demo',
      dryRun: true,
      root_asset_id: 'local-5748fb8ba6df',
    });

    const seeded = seedSwissifierRichDemoWorkspace(defaultProject, { confirmWrite: true });
    const snapshot = getLineageSnapshot(defaultProject, seeded.root_asset_id);
    const next = getLineageNextAsset(defaultProject, seeded.root_asset_id);
    const workspaces = listLineageWorkspaces(defaultProject);

    expect(seeded.workspace).toMatchObject({
      created_by: 'system',
      status: 'active',
      title: 'Swissifier rich demo',
    });
    expect(snapshot.nodes).toHaveLength(14);
    expect(snapshot.edges).toHaveLength(13);
    expect(snapshot.edges.every(edge => edge.summary)).toBe(true);
    expect(snapshot.edges.find(edge => edge.child_asset_id === 'local-befe299c503d')).toMatchObject({
      summary: 'Poster branch',
      summary_created_by: 'system',
      summary_updated_by: 'system',
      summary_updated_at: expect.any(String),
    });
    expect(snapshot.selected).toEqual(['local-27050bc5c393', 'local-6d06bdbd9f56']);
    expect(snapshot.nodes.find(node => node.asset_id === seeded.root_asset_id)).toMatchObject({
      channel: 'linkedin',
      local_path: 'rich-demo-drafts/swissifier-v1/swissifier-linkedin-root-v1.png',
      position: { x: 40, y: 894 },
    });
    const beforeAfter = snapshot.nodes.find(node => node.asset_id === 'local-27050bc5c393');
    const mintDrill = snapshot.nodes.find(node => node.asset_id === 'local-6d06bdbd9f56');
    expect(beforeAfter).toMatchObject({
      attempt_count: 3,
      current_attempt: {
        attempt_index: 3,
        file_path: 'rich-demo-drafts/swissifier-v1/reroll-attempts/swissifier-vertical-before-after-reroll-v3.png',
        source: 'reroll',
      },
    });
    expect(decodeURIComponent(beforeAfter?.preview_url || '')).toContain('reroll-attempts/swissifier-vertical-before-after-reroll-v3.png');
    expect(mintDrill).toMatchObject({
      attempt_count: 2,
      current_attempt: {
        attempt_index: 2,
        file_path: 'rich-demo-drafts/swissifier-v1/reroll-attempts/swissifier-drill-mint-diagonal-reroll-v2.png',
        source: 'reroll',
      },
    });
    const attempts = getLineageAttempts(defaultProject, seeded.root_asset_id, 'local-27050bc5c393').attempts;
    expect(attempts.map(attempt => attempt.attempt_index)).toEqual([3, 2, 1]);
    expect(attempts[0].prompt).toContain('Re-roll again');
    const currentAttemptPath = join(repoRoot, '.asset-scratch', attempts[0].file_path!);
    expect(existsSync(currentAttemptPath)).toBe(true);
    expect(readFileSync(currentAttemptPath).subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(snapshot.nodes.every(node => node.local_path?.startsWith('rich-demo-drafts/swissifier-v1/'))).toBe(true);
    expect(snapshot.selections.every(selection => !selection.prompt && !selection.notes)).toBe(true);
    expect(next.strategy).toBe('selected');
    expect(next.selection_mode).toBe('multiple');
    expect(workspaces.active_workspace).toMatchObject({
      root_asset_id: seeded.root_asset_id,
      title: 'Swissifier rich demo',
    });
    expect(seeded.media_status).toMatchObject({
      demo_id: 'swissifier-rich-demo',
      total: 14,
    });
    expect(seeded.reroll_attempts).toEqual({ total: 3 });

    const database = lineageDb();
    database.prepare(`
      update asset_edges
      set summary = 'Human edit', summary_created_by = 'system', summary_updated_by = 'human', summary_updated_at = '2026-07-21T12:00:00.000Z'
      where project_id = ? and child_asset_id = 'local-befe299c503d'
    `).run(defaultProject);
    database.prepare(`
      update asset_edges
      set summary = null, summary_created_by = null, summary_updated_by = null, summary_updated_at = null
      where project_id = ? and child_asset_id = 'local-2e102785131f'
    `).run(defaultProject);
    database.close();

    seedSwissifierRichDemoWorkspace(defaultProject, { confirmWrite: true });
    const reseeded = getLineageSnapshot(defaultProject, seeded.root_asset_id);
    expect(reseeded.edges.find(edge => edge.child_asset_id === 'local-befe299c503d')).toMatchObject({
      summary: 'Human edit',
      summary_created_by: 'system',
      summary_updated_by: 'human',
      summary_updated_at: '2026-07-21T12:00:00.000Z',
    });
    expect(reseeded.edges.find(edge => edge.child_asset_id === 'local-2e102785131f')).toMatchObject({
      summary: 'Drill branch',
      summary_created_by: 'system',
      summary_updated_by: 'system',
      summary_updated_at: expect.any(String),
    });
  });

  it('clears legacy Swissifier prompts per node without changing claimed work', () => {
    const seeded = seedSwissifierRichDemoWorkspace(defaultProject, { confirmWrite: true });
    const legacyPrompt = 'Swissifier rich demo bases selected for the next variation.';
    const claimedTarget = 'local-27050bc5c393';
    const pendingTarget = 'local-6d06bdbd9f56';
    const initialTasks = listLineageTasks(defaultProject, seeded.root_asset_id).tasks.filter(task => task.task_type === 'iterate');
    const claimedTask = initialTasks.find(task => task.target_asset_id === claimedTarget);
    expect(claimedTask).toBeDefined();
    expect(initialTasks.find(task => task.target_asset_id === pendingTarget)).toBeDefined();

    const database = lineageDb();
    database.prepare(`
      update asset_selections set notes = ?
      where project_id = ? and root_asset_id = ? and asset_id in (?, ?)
    `).run(legacyPrompt, defaultProject, seeded.root_asset_id, claimedTarget, pendingTarget);
    database.prepare(`
      update lineage_tasks set instructions = ?
      where project_id = ? and root_asset_id = ? and task_type = 'iterate' and target_asset_id in (?, ?)
    `).run(legacyPrompt, defaultProject, seeded.root_asset_id, claimedTarget, pendingTarget);
    database.close();
    claimLineageTask(defaultProject, { taskId: claimedTask!.id, agentName: 'migration-test' });

    seedSwissifierRichDemoWorkspace(defaultProject, { confirmWrite: true });

    const snapshot = getLineageSnapshot(defaultProject, seeded.root_asset_id);
    expect(snapshot.selections.find(selection => selection.asset_id === claimedTarget)).toMatchObject({ prompt: legacyPrompt, prompt_status: 'ready' });
    expect(snapshot.selections.find(selection => selection.asset_id === pendingTarget)).toMatchObject({ prompt_status: 'needs_prompt' });
    expect(snapshot.selections.find(selection => selection.asset_id === pendingTarget)?.prompt).toBeUndefined();
    const tasks = listLineageTasks(defaultProject, seeded.root_asset_id).tasks.filter(task => task.task_type === 'iterate');
    expect(tasks.find(task => task.target_asset_id === claimedTarget)).toMatchObject({ instructions: legacyPrompt, status: 'claimed' });
    expect(tasks.find(task => task.target_asset_id === pendingTarget)).toMatchObject({ prompt_status: 'needs_prompt', status: 'pending' });
    expect(tasks.find(task => task.target_asset_id === pendingTarget)?.instructions).toBeUndefined();
  });

  it('raises an incompatible archived Swissifier branch cap before restoring manifest selections', () => {
    const seeded = seedSwissifierRichDemoWorkspace(defaultProject, { confirmWrite: true });
    updateLineageWorkspace(defaultProject, seeded.workspace!.id, {
      confirmWrite: true,
      maxQueuedBranches: 1,
      status: 'archived',
    });

    const reseeded = seedSwissifierRichDemoWorkspace(defaultProject, { confirmWrite: true });

    expect(reseeded.workspace).toMatchObject({ max_queued_branches: 2, status: 'active' });
    expect(getLineageSnapshot(defaultProject, seeded.root_asset_id).selected).toEqual(['local-27050bc5c393', 'local-6d06bdbd9f56']);
  });

  it('bootstraps Swissifier as its own project and respects delete until explicit restore', () => {
    const bootstrapped = ensureSwissifierRichDemoWorkspace();
    expect(bootstrapped).toMatchObject({
      project: { id: swissifierDemoProject, display_name: 'Swissifier Demo' },
      workspace: {
        project: swissifierDemoProject,
        root_asset_id: 'local-5748fb8ba6df',
        title: 'Swissifier rich demo',
      },
    });
    expect(listProjectCollection({ pageSize: 100 }).projects).toContainEqual(
      expect.objectContaining({ id: swissifierDemoProject, workspace_count: 1 })
    );
    expect(listLineageWorkspaces(defaultProject).workspaces).not.toContainEqual(
      expect.objectContaining({ title: 'Swissifier rich demo' })
    );

    const plan = planProjectDeletion(swissifierDemoProject);
    expect(deleteProject(swissifierDemoProject, {
      expectedDigest: plan.digest,
      confirmation: 'Swissifier Demo',
      confirmWrite: true,
    })).toMatchObject({ ok: true });
    expect(demoBootstrapSuppressed()).toBe(true);
    expect(ensureSwissifierRichDemoWorkspace()).toBeNull();
    expect(listLineageWorkspaces(swissifierDemoProject).workspaces).toEqual([]);
    expect(listProjectCollection({ pageSize: 100 }).projects).not.toContainEqual(
      expect.objectContaining({ id: swissifierDemoProject })
    );

    const restored = restoreSwissifierRichDemoProject(true);
    expect(restored).toMatchObject({
      project: { id: swissifierDemoProject },
      workspace: { project: swissifierDemoProject, title: 'Swissifier rich demo' },
    });
    expect(demoBootstrapSuppressed()).toBe(false);
    expect(ensureSwissifierRichDemoWorkspace()).toMatchObject({ seeded: false });
  });

  it('copies Swissifier into its own project without deleting or rewriting a legacy workspace', () => {
    const legacy = seedSwissifierRichDemoWorkspace(defaultProject, { confirmWrite: true });
    expect(listLineageWorkspaces(defaultProject).workspaces).toContainEqual(
      expect.objectContaining({ root_asset_id: legacy.root_asset_id })
    );
    const before = lineageDb();
    const legacyEdges = before.prepare('select count(*) count from asset_edges where project_id = ?')
      .get(defaultProject) as { count: number };
    const legacyAssets = before.prepare('select count(*) count from assets where project_id = ?')
      .get(defaultProject) as { count: number };
    before.close();

    const copied = ensureSwissifierRichDemoWorkspace();
    expect(copied).toMatchObject({
      workspace: { project: swissifierDemoProject },
    });
    expect(copied!.workspace!.root_asset_id).not.toBe(legacy.root_asset_id);
    expect(listLineageWorkspaces(defaultProject).workspaces).toContainEqual(
      expect.objectContaining({ root_asset_id: legacy.root_asset_id })
    );
    expect(listLineageWorkspaces(swissifierDemoProject).workspaces).toContainEqual(
      expect.objectContaining({ root_asset_id: copied!.workspace!.root_asset_id })
    );
    const database = lineageDb();
    expect(database.prepare('select count(*) count from asset_edges where project_id = ?').get(defaultProject))
      .toEqual(legacyEdges);
    expect(database.prepare('select count(*) count from assets where project_id = ?').get(defaultProject))
      .toEqual(legacyAssets);
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([]);
    database.close();

    const deletionPlan = planProjectDeletion(defaultProject);
    deleteProject(defaultProject, {
      expectedDigest: deletionPlan.digest,
      confirmation: deletionPlan.display_name,
      confirmWrite: true,
    });
    expect(ensureSwissifierRichDemoWorkspace()).toMatchObject({
      seeded: false,
      workspace: { root_asset_id: copied!.workspace!.root_asset_id },
    });
  });

  it('preserves archived and permanently deleted Swissifier workspace lifecycle state during bootstrap', () => {
    const bootstrapped = ensureSwissifierRichDemoWorkspace();
    const workspaceId = bootstrapped!.workspace!.id;
    archiveLineageWorkspace(swissifierDemoProject, workspaceId, true);

    expect(ensureSwissifierRichDemoWorkspace()).toMatchObject({
      seeded: false,
      workspace: { id: workspaceId, status: 'archived' },
    });

    const plan = planWorkspaceDeletion(swissifierDemoProject, workspaceId);
    deleteWorkspace(swissifierDemoProject, workspaceId, {
      expectedDigest: plan.digest,
      confirmWrite: true,
    });
    expect(ensureSwissifierRichDemoWorkspace()).toMatchObject({
      seeded: false,
      workspace: null,
      workspace_deleted: true,
    });
  });

  it('keeps active legacy claims intact while creating an independent Swissifier project', () => {
    const legacy = seedSwissifierRichDemoWorkspace(defaultProject, { confirmWrite: true });
    const database = lineageDb();
    const timestamp = '2026-07-29T12:00:00.000Z';
    database.prepare(`
      insert into agent_claims (
        id, token_hash, project_id, scope_type, target_id, agent_name, agent_kind,
        status, created_at, heartbeat_at, expires_at
      ) values (?, ?, ?, 'lineage_workspace', ?, 'migration-test', 'codex',
        'active', ?, ?, '2099-01-01T00:00:00.000Z')
    `).run('migration-claim', 'migration-token', defaultProject, legacy.workspace!.id, timestamp, timestamp);
    database.close();

    expect(ensureSwissifierRichDemoWorkspace()).toMatchObject({
      project: { id: swissifierDemoProject },
      workspace: { project: swissifierDemoProject },
    });
    expect(listLineageWorkspaces(defaultProject).workspaces).toContainEqual(
      expect.objectContaining({ id: legacy.workspace!.id })
    );
    const verification = lineageDb();
    expect(verification.prepare("select status from agent_claims where id = 'migration-claim'").get())
      .toEqual({ status: 'active' });
    verification.close();
  });

  it('preserves project metadata while reconciling legacy workspaces', () => {
    seedDemoLineageWorkspace(defaultProject, { confirmWrite: true });
    const database = lineageDb();
    const sentinel = '2020-01-02T03:04:05.000Z';
    database.prepare('update projects set product = ?, updated_at = ? where id = ?')
      .run('Catalog product label', sentinel, defaultProject);
    database.close();

    listLineageWorkspaces(defaultProject);

    const verification = lineageDb();
    expect(verification.prepare('select product, updated_at from projects where id = ?').get(defaultProject))
      .toEqual({ product: 'Catalog product label', updated_at: sentinel });
    verification.close();
  });

  it('reports Swissifier media status and requires an optional source to restore it', () => {
    const previousSource = process.env.LINEAGE_SWISSIFIER_MEDIA_DIR;
    delete process.env.LINEAGE_SWISSIFIER_MEDIA_DIR;
    try {
      const status = swissifierRichDemoMediaStatus(defaultProject);
      expect(status).toMatchObject({
        download_available: true,
        download_file: 'swissifier-rich-demo-v1.tar.gz',
        download_sha256: '24edc5307d0932ddc8a151c6a8c1001a08c45075e3ae198082038c44519be0de',
        demo_id: 'swissifier-rich-demo',
        total: 14,
      });
      expect(status.present + status.missing.length + status.invalid.length).toBe(status.total);

      const restored = restoreSwissifierRichDemoMedia(defaultProject, { confirmWrite: true });
      expect(restored).toMatchObject({
        demo_id: 'swissifier-rich-demo',
        restored: 0,
        source_env: 'LINEAGE_SWISSIFIER_MEDIA_DIR',
        source_required: true,
      });
    } finally {
      if (previousSource === undefined) delete process.env.LINEAGE_SWISSIFIER_MEDIA_DIR;
      else process.env.LINEAGE_SWISSIFIER_MEDIA_DIR = previousSource;
    }
  });

  it('verifies the Swissifier media download checksum before restore work', async () => {
    const body = Buffer.from('not a tarball, but enough for dry-run checksum proof');
    const url = bufferServer(body);

    const downloaded = await downloadSwissifierRichDemoMedia(defaultProject, {
      confirmWrite: false,
      expectedSha256: sha256(body),
      sourceUrl: url,
    });

    expect(downloaded).toMatchObject({
      archive_sha256: sha256(body),
      demo_id: 'swissifier-rich-demo',
      download_available: true,
      dryRun: true,
      restored: 0,
      total: 14,
      would_restore: 14,
    });
  });

  it('rejects Swissifier media downloads with mismatched archive checksums', async () => {
    const body = Buffer.from('wrong archive body');
    const url = bufferServer(body);

    await expect(downloadSwissifierRichDemoMedia(defaultProject, {
      confirmWrite: true,
      expectedSha256: '0'.repeat(64),
      sourceUrl: url,
    })).rejects.toThrow('checksum mismatch');
  });

  it('rejects Swissifier media archives with unsafe paths before writing files', async () => {
    const archive = tarGz([{ name: '../swissifier-linkedin-root-v1.png', body: Buffer.from('unsafe') }]);
    const url = bufferServer(archive);

    await expect(downloadSwissifierRichDemoMedia(defaultProject, {
      confirmWrite: true,
      expectedSha256: sha256(archive),
      sourceUrl: url,
    })).rejects.toThrow('Unsafe Swissifier media archive path');
  });

  it('ignores known archive metadata before validating expected media files', async () => {
    const archive = tarGz([
      { name: './._.', body: Buffer.from('appledouble') },
      { name: 'PaxHeader/currentdir', body: Buffer.from('path=./\n'), typeflag: 'x' },
    ]);
    const url = bufferServer(archive);

    await expect(downloadSwissifierRichDemoMedia(defaultProject, {
      confirmWrite: true,
      expectedSha256: sha256(archive),
      sourceUrl: url,
    })).rejects.toThrow('missing 14 expected files');
  });
});
