import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalogPath, removeProjectCatalogDefinition, repoRoot, setLineageAssetRoot } from './assetCore';
import { createAgentClaim } from './agentClaims';
import { ensureWorkspaceRootAsset, linkLineageAssets, recordLineageRerollAttempt, updateLineageLayout } from './assetLineage';
import { removeLineageNode } from './assetLineageRemove';
import { lineageDb } from './assetLineageDb';
import { createLineageWorkspace, listLineageWorkspaces, migrateLegacyLineageWorkspaces } from './assetLineageWorkspaces';
import { createContentBatch } from './contentBatches';
import {
  assertProjectWorkspaceAvailable,
  createProjectWorkspace,
  deleteProject,
  deleteWorkspace,
  listProjectCollection,
  listWorkspaceCollection,
  planProjectDeletion,
  reconcileProjectWorkspaceState,
  planWorkspaceDeletion,
  reorderProjects,
  reorderWorkspaces,
  restoreWorkspace,
} from './projectWorkspaces';
import { useLineageTestProfile } from '../test/lineageTestProfile';

const originalAssetRoot = repoRoot;
const scratchRoot = join(originalAssetRoot, '.asset-scratch', 'vitest-project-workspaces');
const assetRoot = join(scratchRoot, 'media');
const databasePath = join(assetRoot, '.asset-scratch', 'project-workspaces.sqlite');

function insertAsset(project: string, id: string, localPath?: string): void {
  const database = lineageDb();
  const timestamp = '2026-07-29T12:00:00.000Z';
  database.prepare(`
    insert into assets (
      id, project_id, source, local_path, s3_key, checksum_sha256, media_type, title,
      status, channel, campaign, audience, size_bytes, content_type, created_at,
      updated_at, last_seen_at
    ) values (?, ?, 'local', ?, null, ?, 'image/png', ?, 'working', 'linkedin',
      'test', 'testers', 10, 'image/png', ?, ?, ?)
  `).run(id, project, localPath || null, `${id}-checksum`, id, timestamp, timestamp, timestamp);
  database.close();
}

beforeEach(() => {
  rmSync(scratchRoot, { force: true, recursive: true });
  mkdirSync(assetRoot, { recursive: true });
  setLineageAssetRoot(assetRoot);
  useLineageTestProfile(databasePath);
});

afterEach(() => {
  setLineageAssetRoot(originalAssetRoot);
  rmSync(scratchRoot, { force: true, recursive: true });
});

describe('project/workspace organization persistence', () => {
  it('projects pre-migration rows through read-only collection and detail APIs', () => {
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      create table projects (
        id text primary key,
        product text not null,
        catalog_path text,
        created_at text not null,
        updated_at text not null
      );
      create table assets (
        id text primary key,
        project_id text not null,
        source text,
        media_type text,
        title text,
        status text,
        created_at text,
        updated_at text,
        last_seen_at text
      );
      create table lineage_workspaces (
        id text primary key,
        project_id text not null,
        root_asset_id text not null,
        title text not null,
        status text not null,
        created_by text not null,
        created_at text not null,
        updated_at text not null
      );
      insert into projects values (
        'legacy-project', 'Legacy Project', '/tmp/legacy/catalog.json',
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
      );
      insert into assets values (
        'legacy-root', 'legacy-project', 'local', 'image/png', 'Legacy Root',
        'working', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z',
        '2026-07-01T00:00:00.000Z'
      );
      insert into lineage_workspaces values (
        'legacy-workspace', 'legacy-project', 'legacy-root', 'Legacy Workspace',
        'active', 'system', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
      );
    `);
    legacy.close();

    process.env.LINEAGE_DB_ACCESS = 'read-only';
    const projects = listProjectCollection({ pageSize: 100 });
    const workspaces = listWorkspaceCollection('legacy-project', { pageSize: 100 });
    expect(() => assertProjectWorkspaceAvailable('legacy-project')).not.toThrow();

    expect(projects.manual_revision).toBe(1);
    expect(projects.projects).toContainEqual(expect.objectContaining({
      id: 'legacy-project',
      catalog_state: 'ready',
      sort_position: 0,
    }));
    expect(workspaces).toMatchObject({
      manual_revision: 1,
      workspaces: [expect.objectContaining({
        id: 'legacy-workspace',
        collection_kind: 'open',
        revision: 1,
      })],
    });
  });

  it('discovers catalog-only projects without mutating a legacy read-only database', () => {
    createProjectWorkspace({ id: 'catalog-only-read', displayName: 'Catalog Only Read', confirmWrite: true });
    const database = lineageDb();
    database.prepare("delete from workspace_collection_state where project_id = 'catalog-only-read'").run();
    database.prepare("delete from projects where id = 'catalog-only-read'").run();
    database.close();

    process.env.LINEAGE_DB_ACCESS = 'read-only';
    const before = readFileSync(databasePath);
    expect(listProjectCollection({ pageSize: 100 }).projects).toContainEqual(expect.objectContaining({
      id: 'catalog-only-read',
      display_name: 'Catalog Only Read',
    }));
    expect(readFileSync(databasePath)).toEqual(before);
  });

  it('bumps the collection revision when reconciliation discovers a catalog-backed project', () => {
    createProjectWorkspace({ id: 'catalog-reconciled', displayName: 'Catalog Reconciled', confirmWrite: true });
    const database = lineageDb();
    const revision = Number((database.prepare(
      "select revision from project_collection_state where singleton_id = 'projects'"
    ).get() as { revision: number }).revision);
    database.prepare("delete from workspace_collection_state where project_id = 'catalog-reconciled'").run();
    database.prepare("delete from projects where id = 'catalog-reconciled'").run();
    database.close();

    reconcileProjectWorkspaceState();

    expect(listProjectCollection({ pageSize: 100 })).toMatchObject({
      manual_revision: revision + 1,
      projects: expect.arrayContaining([expect.objectContaining({ id: 'catalog-reconciled' })]),
    });
  });

  it('projects inferred graph roots into read-only workspace collections without persisting migration rows', () => {
    const project = 'read-only-inferred-workspace';
    createProjectWorkspace({ id: project, displayName: 'Read Only Inferred Workspace', confirmWrite: true });
    insertAsset(project, 'legacy-root');
    insertAsset(project, 'legacy-child');
    const database = lineageDb();
    database.prepare(`
      insert into asset_edges (id, project_id, parent_asset_id, child_asset_id, relation_type, created_at)
      values ('legacy-edge', ?, 'legacy-root', 'legacy-child', 'derived_from', ?)
    `).run(project, '2026-07-29T12:00:00.000Z');
    database.close();

    process.env.LINEAGE_DB_ACCESS = 'read-only';
    const before = readFileSync(databasePath);
    expect(listWorkspaceCollection(project, { pageSize: 100 })).toMatchObject({
      project: { id: project },
      workspaces: [
        expect.objectContaining({
          id: `${project}:lineage-workspace:legacy-root`,
          root_asset_id: 'legacy-root',
          collection_kind: 'open',
        }),
      ],
    });
    expect(readFileSync(databasePath)).toEqual(before);
  });

  it('creates, paginates, and revision-orders one durable project collection', () => {
    createProjectWorkspace({ id: 'project-alpha', displayName: 'Project Alpha', confirmWrite: true });
    createProjectWorkspace({ id: 'project-beta', displayName: 'Project Beta', confirmWrite: true });

    const before = listProjectCollection({ page: 1, pageSize: 100 });
    const alphaIndex = before.projects.findIndex(project => project.id === 'project-alpha');
    const betaIndex = before.projects.findIndex(project => project.id === 'project-beta');
    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(betaIndex).toBeGreaterThan(alphaIndex);

    const reordered = reorderProjects({
      itemId: 'project-beta',
      targetIndex: alphaIndex,
      expectedRevision: before.manual_revision,
      confirmWrite: true,
    });
    expect(reordered).toMatchObject({ manual_revision: before.manual_revision + 1 });
    expect(() => reorderProjects({
      itemId: 'project-alpha',
      targetIndex: betaIndex,
      expectedRevision: before.manual_revision,
      confirmWrite: true,
    })).toThrow(/changed/i);

    const after = listProjectCollection({ page: 1, pageSize: 1 });
    expect(after.pagination.total).toBeGreaterThanOrEqual(2);
    expect(listProjectCollection({ page: 1, pageSize: 100 }).projects.findIndex(project => project.id === 'project-beta'))
      .toBeLessThan(listProjectCollection({ page: 1, pageSize: 100 }).projects.findIndex(project => project.id === 'project-alpha'));
  });

  it('counts catalog-only assets in project summaries before they are indexed into SQLite', () => {
    const project = 'catalog-count';
    createProjectWorkspace({ id: project, displayName: 'Catalog Count', confirmWrite: true });
    const definition = catalogPath(project);
    const catalog = JSON.parse(readFileSync(definition, 'utf8')) as { assets: unknown[] };
    catalog.assets = [{
      asset_id: 'catalog-only',
      title: 'Catalog only',
      project,
      product: project,
      source: 'catalog',
    }];
    writeFileSync(definition, `${JSON.stringify(catalog, null, 2)}\n`);

    expect(listProjectCollection({ pageSize: 100 }).projects.find(item => item.id === project))
      .toMatchObject({ asset_count: 1 });
    const database = lineageDb();
    expect(database.prepare('select count(*) count from assets where project_id = ?').get(project)).toEqual({ count: 0 });
    database.close();
  });

  it('counts a project-scoped alias as its single logical catalog asset', () => {
    const owner = 'alias-count-owner';
    const project = 'alias-count-project';
    createProjectWorkspace({ id: owner, displayName: 'Alias Count Owner', confirmWrite: true });
    createProjectWorkspace({ id: project, displayName: 'Alias Count Project', confirmWrite: true });
    insertAsset(owner, 'shared-catalog-id');
    const definition = catalogPath(project);
    const catalog = JSON.parse(readFileSync(definition, 'utf8')) as { assets: unknown[] };
    catalog.assets = [{
      asset_id: 'shared-catalog-id',
      title: 'Shared catalog asset',
      project,
      product: project,
      source: 'catalog',
      content_type: 'image',
      status: 'working',
    }];
    writeFileSync(definition, `${JSON.stringify(catalog, null, 2)}\n`);

    const alias = ensureWorkspaceRootAsset(project, 'shared-catalog-id');
    expect(alias).not.toBe('shared-catalog-id');
    expect(listProjectCollection({ pageSize: 100 }).projects.find(item => item.id === project))
      .toMatchObject({ asset_count: 1 });
  });

  it('shares workspace manual order across pages and keeps archived order separate', () => {
    const project = 'workspace-order';
    createProjectWorkspace({ id: project, displayName: 'Workspace Order', confirmWrite: true });
    for (const id of ['root-a', 'root-b', 'root-c']) {
      insertAsset(project, id);
      createLineageWorkspace(project, { rootAssetId: id, title: id, confirmWrite: true });
    }
    const before = listWorkspaceCollection(project, { page: 1, pageSize: 2 });
    const moved = reorderWorkspaces(project, 'open', {
      itemId: `${project}:lineage-workspace:root-c`,
      targetIndex: 0,
      expectedRevision: before.manual_revision,
      confirmWrite: true,
    });
    expect(moved).toMatchObject({ manual_revision: before.manual_revision + 1 });
    expect(listWorkspaceCollection(project, { page: 1, pageSize: 2 }).workspaces[0].root_asset_id).toBe('root-c');

    const workspaceA = `${project}:lineage-workspace:root-a`;
    const database = lineageDb();
    database.prepare(`
      update lineage_workspaces
      set status = 'archived', collection_kind = 'archived', sort_position = 0, revision = revision + 1
      where project_id = ? and id = ?
    `).run(project, workspaceA);
    database.close();
    expect(restoreWorkspace(project, workspaceA, true)).toMatchObject({ ok: true });
    expect(listWorkspaceCollection(project, { collection: 'archived' }).workspaces).toHaveLength(0);
    expect(listWorkspaceCollection(project, { collection: 'open' }).workspaces).toHaveLength(3);
  });

  it('preserves content timestamps and workspace revisions while changing only manual order', () => {
    const project = 'order-metadata';
    createProjectWorkspace({ id: project, displayName: 'Order Metadata', confirmWrite: true });
    createProjectWorkspace({ id: 'order-metadata-peer', displayName: 'Order Metadata Peer', confirmWrite: true });
    for (const id of ['order-root-a', 'order-root-b']) {
      insertAsset(project, id);
      createLineageWorkspace(project, { rootAssetId: id, title: id, confirmWrite: true });
    }
    const beforeProjects = listProjectCollection({ pageSize: 100 });
    const beforeDatabase = lineageDb();
    const projectMetadata = beforeDatabase.prepare(`
      select id, updated_at from projects where id in (?, ?) order by id
    `).all(project, 'order-metadata-peer');
    const workspaceMetadata = beforeDatabase.prepare(`
      select id, updated_at, revision from lineage_workspaces where project_id = ? order by id
    `).all(project);
    beforeDatabase.close();

    const peerIndex = beforeProjects.projects.findIndex(item => item.id === 'order-metadata-peer');
    reorderProjects({
      itemId: 'order-metadata-peer',
      targetIndex: Math.max(0, peerIndex - 1),
      expectedRevision: beforeProjects.manual_revision,
      confirmWrite: true,
    });
    const beforeWorkspaces = listWorkspaceCollection(project, { pageSize: 100 });
    reorderWorkspaces(project, 'open', {
      itemId: `${project}:lineage-workspace:order-root-b`,
      targetIndex: 0,
      expectedRevision: beforeWorkspaces.manual_revision,
      confirmWrite: true,
    });

    const afterDatabase = lineageDb();
    expect(afterDatabase.prepare(`
      select id, updated_at from projects where id in (?, ?) order by id
    `).all(project, 'order-metadata-peer')).toEqual(projectMetadata);
    expect(afterDatabase.prepare(`
      select id, updated_at, revision from lineage_workspaces where project_id = ? order by id
    `).all(project)).toEqual(workspaceMetadata);
    afterDatabase.close();
  });

  it('migrates legacy graph roots even when the project catalog is missing', () => {
    const project = 'missing-catalog-legacy';
    createProjectWorkspace({ id: project, displayName: 'Missing Catalog Legacy', confirmWrite: true });
    insertAsset(project, 'missing-root');
    insertAsset(project, 'missing-child');
    const database = lineageDb();
    database.prepare(`
      insert into asset_edges (id, project_id, parent_asset_id, child_asset_id, relation_type, created_at)
      values ('missing-edge', ?, 'missing-root', 'missing-child', 'derived_from', ?)
    `).run(project, '2026-07-29T12:00:00.000Z');
    database.close();
    rmSync(catalogPath(project));

    const migrationProjects = reconcileProjectWorkspaceState();
    expect(migrationProjects).toContain(project);
    migrationProjects.forEach(migrateLegacyLineageWorkspaces);
    expect(listLineageWorkspaces(project).workspaces).toContainEqual(expect.objectContaining({
      root_asset_id: 'missing-root',
    }));
  });

  it('updates both collection revisions and positions when a workspace upsert changes lifecycle', () => {
    const project = 'workspace-upsert-lifecycle';
    createProjectWorkspace({ id: project, displayName: 'Workspace Upsert Lifecycle', confirmWrite: true });
    for (const id of ['root-a', 'root-b']) {
      insertAsset(project, id);
      createLineageWorkspace(project, { rootAssetId: id, title: id, confirmWrite: true });
    }
    const openBeforeArchive = listWorkspaceCollection(project, { collection: 'open' });
    const archivedBeforeArchive = listWorkspaceCollection(project, { collection: 'archived' });

    createLineageWorkspace(project, {
      rootAssetId: 'root-a',
      title: 'root-a archived',
      status: 'archived',
      confirmWrite: true,
    });

    const openAfterArchive = listWorkspaceCollection(project, { collection: 'open' });
    const archivedAfterArchive = listWorkspaceCollection(project, { collection: 'archived' });
    expect(openAfterArchive.manual_revision).toBe(openBeforeArchive.manual_revision + 1);
    expect(archivedAfterArchive.manual_revision).toBe(archivedBeforeArchive.manual_revision + 1);
    expect(openAfterArchive.workspaces.map(workspace => [workspace.root_asset_id, workspace.sort_position]))
      .toEqual([['root-b', 0]]);
    expect(archivedAfterArchive.workspaces.map(workspace => [workspace.root_asset_id, workspace.sort_position, workspace.active_at]))
      .toEqual([['root-a', 0, undefined]]);

    createLineageWorkspace(project, {
      rootAssetId: 'root-a',
      title: 'root-a restored',
      status: 'active',
      activate: false,
      confirmWrite: true,
    });

    const openAfterRestore = listWorkspaceCollection(project, { collection: 'open' });
    const archivedAfterRestore = listWorkspaceCollection(project, { collection: 'archived' });
    expect(openAfterRestore.manual_revision).toBe(openAfterArchive.manual_revision + 1);
    expect(archivedAfterRestore.manual_revision).toBe(archivedAfterArchive.manual_revision + 1);
    expect(openAfterRestore.workspaces.map(workspace => [workspace.root_asset_id, workspace.sort_position]))
      .toEqual([['root-b', 0], ['root-a', 1]]);
    expect(archivedAfterRestore.workspaces).toEqual([]);
  });

  it('deletes workspace-owned state atomically while preserving asset rows and physical media', () => {
    const project = 'workspace-delete';
    const root = 'delete-root';
    const child = 'delete-child';
    createProjectWorkspace({ id: project, displayName: 'Workspace Delete', confirmWrite: true });
    const physicalPath = join(assetRoot, '.asset-scratch', 'preserved-workspace.png');
    mkdirSync(join(assetRoot, '.asset-scratch'), { recursive: true });
    writeFileSync(physicalPath, 'preserve-me');
    insertAsset(project, root, '.asset-scratch/preserved-workspace.png');
    insertAsset(project, child);
    createLineageWorkspace(project, { rootAssetId: root, title: 'Delete me', confirmWrite: true });
    const database = lineageDb();
    database.prepare(`
      insert into asset_edges (id, project_id, parent_asset_id, child_asset_id, relation_type, created_at)
      values ('delete-edge', ?, ?, ?, 'derived_from', ?)
    `).run(project, root, child, '2026-07-29T12:00:00.000Z');
    database.prepare(`
      insert into asset_layouts (id, project_id, root_asset_id, asset_id, x, y, updated_at)
      values ('delete-layout', ?, ?, ?, 1, 2, ?)
    `).run(project, root, child, '2026-07-29T12:00:00.000Z');
    database.prepare(`
      insert into asset_discussion_marks (id, project_id, root_asset_id, asset_id, notes, marked_by, marked_at, updated_at)
      values ('workspace-delete-discussion', ?, ?, ?, 'Discuss', 'human', ?, ?)
    `).run(project, root, child, '2026-07-29T12:00:00.000Z', '2026-07-29T12:00:00.000Z');
    database.prepare(`
      insert into agent_claims (
        id, token_hash, project_id, scope_type, target_id, agent_name, agent_kind,
        status, created_at, heartbeat_at, expires_at
      ) values (
        'workspace-delete-claim', 'workspace-delete-token', ?, 'lineage_workspace', ?,
        'test-agent', 'codex', 'active', ?, ?, '2099-01-01T00:00:00.000Z'
      )
    `).run(project, `${project}:lineage-workspace:${root}`, '2026-07-29T12:00:00.000Z', '2026-07-29T12:00:00.000Z');
    database.prepare(`
      insert into agent_claims (
        id, token_hash, project_id, channel, scope_type, target_id, agent_name, agent_kind,
        status, created_at, heartbeat_at, expires_at
      ) values (
        'workspace-delete-project-claim', 'workspace-delete-project-token', ?, 'linkedin',
        'project_channel', 'linkedin', 'project-agent', 'codex', 'active', ?, ?,
        '2099-01-01T00:00:00.000Z'
      )
    `).run(project, '2026-07-29T12:00:00.000Z', '2026-07-29T12:00:00.000Z');
    database.close();

    const blockedPlan = planWorkspaceDeletion(project, root);
    expect(blockedPlan.blockers).toContainEqual(expect.objectContaining({ code: 'active_claims', count: 2 }));
    expect(() => deleteWorkspace(project, root, { expectedDigest: blockedPlan.digest, confirmWrite: true })).toThrow(/Release active/i);
    const released = lineageDb();
    released.prepare(`
      update agent_claims set status = 'released', released_at = ?
      where id in ('workspace-delete-claim', 'workspace-delete-project-claim')
    `).run('2026-07-29T12:01:00.000Z');
    released.prepare(`
      insert into agent_claim_events (id, claim_id, event_type, actor, message, created_at)
      values ('workspace-delete-claim-event', 'workspace-delete-claim', 'released', 'human', 'done', ?)
    `).run('2026-07-29T12:01:00.000Z');
    released.prepare(`
      insert into lineage_tasks (
        id, project_id, root_asset_id, target_asset_id, task_type, status,
        created_by, created_at, updated_at
      ) values (
        'workspace-delete-task', ?, ?, ?, 'iterate', 'cancelled',
        'human', ?, ?
      )
    `).run(project, root, child, '2026-07-29T12:00:00.000Z', '2026-07-29T12:00:00.000Z');
    released.prepare(`
      insert into lineage_task_events (id, task_id, event_type, actor, message, created_at)
      values ('workspace-delete-task-event', 'workspace-delete-task', 'cancelled', 'human', 'done', ?)
    `).run('2026-07-29T12:01:00.000Z');
    released.prepare(`
      insert into generation_jobs (
        id, project_id, provider, adapter_version, source_mode, root_asset_id,
        prompt, expected_output_count, status, created_at, updated_at
      ) values (
        'workspace-delete-job', ?, 'codex-handoff', 'v1', 'lineage_selection', ?,
        'proof', 1, 'imported', ?, ?
      )
    `).run(project, root, '2026-07-29T12:00:00.000Z', '2026-07-29T12:00:00.000Z');
    released.prepare(`
      insert into generation_job_receipts (
        id, job_id, receipt_type, status, command, payload_json, created_at
      ) values (
        'workspace-delete-receipt', 'workspace-delete-job', 'plan', 'ok',
        'proof', '{}', ?
      )
    `).run('2026-07-29T12:00:00.000Z');
    released.prepare(`
      insert into generation_job_inputs (
        id, job_id, project_id, asset_id, root_asset_id, role, position,
        selection_strategy, selection_snapshot_json
      ) values (
        'workspace-delete-input', 'workspace-delete-job', ?, ?, ?,
        'reference', 0, 'proof', '{}'
      )
    `).run(project, child, root);
    released.close();

    const plan = planWorkspaceDeletion(project, root);
    expect(plan.preserved).toMatchObject({ local_files: true, cloud_objects: true, asset_rows: 2 });
    expect(Object.fromEntries(plan.counts.map(item => [item.table, item.count]))).toMatchObject({
      asset_discussion_marks: 1,
      agent_claim_events: 1,
      agent_claims: 1,
      generation_job_inputs: 1,
      generation_job_receipts: 1,
      generation_jobs: 1,
      lineage_task_events: 1,
      lineage_tasks: 1,
    });
    const deleted = deleteWorkspace(project, root, { expectedDigest: plan.digest, confirmWrite: true });
    expect(deleted).toMatchObject({ ok: true, preserved: { local_files: true, asset_rows: 2 } });
    expect(existsSync(physicalPath)).toBe(true);

    const verification = lineageDb();
    expect(verification.prepare('select count(*) count from lineage_workspaces where project_id = ?').get(project)).toEqual({ count: 0 });
    expect(verification.prepare('select count(*) count from deleted_lineage_workspaces where project_id = ?').get(project)).toEqual({ count: 1 });
    expect(verification.prepare('select count(*) count from assets where project_id = ?').get(project)).toEqual({ count: 2 });
    expect(verification.prepare('select count(*) count from asset_discussion_marks where project_id = ?').get(project)).toEqual({ count: 0 });
    expect(verification.prepare('pragma foreign_key_check').all()).toEqual([]);
    verification.close();
    expect(listLineageWorkspaces(project).workspaces).toHaveLength(0);
    expect(() => updateLineageLayout(project, {
      rootAssetId: root,
      positions: [{ assetId: root, x: 12, y: 24 }],
      confirmWrite: true,
    })).toThrow(/lineage_workspace_deleted/);
    expect(() => linkLineageAssets(project, {
      parentAssetId: root,
      childAssetId: child,
      confirmWrite: true,
    })).toThrow(/permanently deleted/i);
    expect(() => recordLineageRerollAttempt(project, {
      rootAssetId: root,
      nodeAssetId: root,
      assetId: child,
      prompt: 'stale attempt',
      generationJobId: 'stale-job',
      filePath: 'stale.png',
      checksumSha256: 'stale-checksum',
      confirmWrite: true,
    })).toThrow(/permanently deleted/i);
    expect(() => removeLineageNode(project, {
      rootAssetId: root,
      assetId: child,
      confirmWrite: true,
    })).toThrow(/permanently deleted/i);
    expect(() => createAgentClaim({
      project,
      scopeType: 'lineage_workspace',
      targetId: `${project}:lineage-workspace:${root}`,
      agentName: 'stale-client',
    })).toThrow(/lineage_workspace_deleted/);
    expect(() => createLineageWorkspace(project, {
      rootAssetId: root,
      title: 'Accidental recreation',
      confirmWrite: true,
    })).toThrow(/explicit restore/i);
    expect(createLineageWorkspace(project, {
      rootAssetId: root,
      title: 'Explicitly restored',
      restoreDeleted: true,
      confirmWrite: true,
    })).toMatchObject({ workspace: { title: 'Explicitly restored' } });
  });

  it('rejects stale deletion receipts and preserves shared graph state', () => {
    const project = 'workspace-shared';
    createProjectWorkspace({ id: project, displayName: 'Workspace Shared', confirmWrite: true });
    for (const id of ['root-one', 'root-two', 'shared-child']) insertAsset(project, id);
    createLineageWorkspace(project, { rootAssetId: 'root-one', title: 'One', confirmWrite: true });
    createLineageWorkspace(project, { rootAssetId: 'root-two', title: 'Two', confirmWrite: true });
    const database = lineageDb();
    const edge = database.prepare(`
      insert into asset_edges (id, project_id, parent_asset_id, child_asset_id, relation_type, created_at)
      values (?, ?, ?, 'shared-child', 'derived_from', ?)
    `);
    edge.run('edge-one', project, 'root-one', '2026-07-29T12:00:00.000Z');
    edge.run('edge-two', project, 'root-two', '2026-07-29T12:00:00.000Z');
    database.close();

    const stale = planWorkspaceDeletion(project, 'root-one');
    const mutation = lineageDb();
    mutation.prepare("update lineage_workspaces set title = 'Changed', revision = revision + 1 where project_id = ? and root_asset_id = 'root-one'").run(project);
    mutation.close();
    expect(() => deleteWorkspace(project, 'root-one', { expectedDigest: stale.digest, confirmWrite: true })).toThrow(/changed/i);

    const fresh = planWorkspaceDeletion(project, 'root-one');
    deleteWorkspace(project, 'root-one', { expectedDigest: fresh.digest, confirmWrite: true });
    const verification = lineageDb();
    expect(verification.prepare("select count(*) count from asset_edges where id = 'edge-one'").get()).toEqual({ count: 0 });
    expect(verification.prepare("select count(*) count from asset_edges where id = 'edge-two'").get()).toEqual({ count: 1 });
    expect(verification.prepare("select count(*) count from assets where id = 'shared-child'").get()).toEqual({ count: 1 });
    verification.close();
  });

  it.each([
    {
      stage: 'early',
      trigger: (project: string) => `
        create trigger inject_workspace_delete_early
        before insert on deleted_lineage_workspaces
        when new.project_id = '${project}'
        begin select raise(abort, 'injected early workspace failure'); end
      `,
    },
    {
      stage: 'middle',
      trigger: (project: string) => `
        create trigger inject_workspace_delete_middle
        before delete on asset_layouts
        when old.project_id = '${project}'
        begin select raise(abort, 'injected middle workspace failure'); end
      `,
    },
    {
      stage: 'late',
      trigger: (project: string) => `
        create trigger inject_workspace_delete_late
        before delete on lineage_workspaces
        when old.project_id = '${project}'
        begin select raise(abort, 'injected late workspace failure'); end
      `,
    },
  ])('rolls back the complete workspace mutation after a $stage failure', ({ stage, trigger }) => {
    const project = `workspace-rollback-${stage}`;
    const root = `${project}-root`;
    const physicalPath = join(assetRoot, `${project}.png`);
    createProjectWorkspace({ id: project, displayName: `Workspace rollback ${stage}`, confirmWrite: true });
    writeFileSync(physicalPath, `preserve-${stage}`);
    insertAsset(project, root, `${project}.png`);
    createLineageWorkspace(project, { rootAssetId: root, title: `Workspace rollback ${stage}`, confirmWrite: true });
    const setup = lineageDb();
    setup.prepare(`
      insert into asset_layouts (id, project_id, root_asset_id, asset_id, x, y, updated_at)
      values (?, ?, ?, ?, 1, 2, ?)
    `).run(`${project}-layout`, project, root, root, '2026-07-29T12:00:00.000Z');
    setup.exec(trigger(project));
    setup.close();
    const before = planWorkspaceDeletion(project, root);

    expect(() => deleteWorkspace(project, root, {
      expectedDigest: before.digest,
      confirmWrite: true,
    })).toThrow(new RegExp(`injected ${stage} workspace failure`, 'i'));

    const verification = lineageDb();
    expect(verification.prepare('select count(*) count from lineage_workspaces where project_id = ?').get(project)).toEqual({ count: 1 });
    expect(verification.prepare('select count(*) count from asset_layouts where project_id = ?').get(project)).toEqual({ count: 1 });
    expect(verification.prepare('select count(*) count from deleted_lineage_workspaces where project_id = ?').get(project)).toEqual({ count: 0 });
    expect(verification.prepare('pragma foreign_key_check').all()).toEqual([]);
    verification.close();
    expect(existsSync(physicalPath)).toBe(true);
    expect(planWorkspaceDeletion(project, root).state_digest).toBe(before.state_digest);
    expect(listLineageWorkspaces(project).workspaces).toHaveLength(1);
  });

  it('permanently deletes project SQLite state and only the catalog definition', () => {
    const project = 'project-delete';
    const otherProject = 'project-keep';
    createProjectWorkspace({ id: project, displayName: 'Project Delete', confirmWrite: true });
    createProjectWorkspace({ id: otherProject, displayName: 'Project Keep', confirmWrite: true });
    const physicalPath = join(assetRoot, project, 'preserved-source.png');
    writeFileSync(physicalPath, 'preserve-project-media');
    insertAsset(project, 'project-delete-asset', `${project}/preserved-source.png`);
    insertAsset(otherProject, 'project-keep-asset');
    const plan = planProjectDeletion(project);
    expect(() => deleteProject(project, {
      expectedDigest: plan.digest,
      confirmation: 'wrong',
      confirmWrite: true,
    })).toThrow(/Type Project Delete/i);

    const changed = lineageDb();
    changed.prepare("update assets set title = 'Changed after plan' where project_id = ?").run(project);
    changed.close();
    expect(() => deleteProject(project, {
      expectedDigest: plan.digest,
      confirmation: 'Project Delete',
      confirmWrite: true,
    })).toThrow(/changed/i);
    const freshPlan = planProjectDeletion(project);

    const deleted = deleteProject(project, {
      expectedDigest: freshPlan.digest,
      confirmation: 'Project Delete',
      confirmWrite: true,
    });
    expect(deleted).toMatchObject({ ok: true, catalog_finalized: true, preserved: { local_files: true, cloud_objects: true } });
    expect(existsSync(catalogPath(project))).toBe(false);
    expect(existsSync(physicalPath)).toBe(true);

    const verification = lineageDb();
    expect(verification.prepare('select count(*) count from projects where id = ?').get(project)).toEqual({ count: 0 });
    expect(verification.prepare('select count(*) count from assets where project_id = ?').get(project)).toEqual({ count: 0 });
    expect(verification.prepare('select count(*) count from projects where id = ?').get(otherProject)).toEqual({ count: 1 });
    expect(verification.prepare('select finalized_at from project_tombstones where project_key = ?').get(project))
      .toEqual({ finalized_at: expect.any(String) });
    expect(verification.prepare('pragma foreign_key_check').all()).toEqual([]);
    verification.close();
    expect(listProjectCollection({ pageSize: 100 }).projects.some(item => item.id === project)).toBe(false);
    expect(() => createContentBatch(project, {
      batchId: 'stale-client-batch',
      title: 'Must not return',
      confirmWrite: true,
    })).toThrow(/lineage_project_deleted/);
    const afterStaleWrite = lineageDb();
    expect(afterStaleWrite.prepare('select count(*) count from projects where id = ?').get(project)).toEqual({ count: 0 });
    expect(afterStaleWrite.prepare('select count(*) count from content_batches where project_id = ?').get(project)).toEqual({ count: 0 });
    afterStaleWrite.close();

    expect(createProjectWorkspace({
      id: project,
      displayName: 'Project Delete Restored',
      confirmWrite: true,
    })).toMatchObject({ project: { id: project, display_name: 'Project Delete Restored' } });
  });

  it('stales project deletion approval when catalog-only records change', () => {
    const project = 'catalog-deletion-plan';
    createProjectWorkspace({ id: project, displayName: 'Catalog Deletion Plan', confirmWrite: true });
    const before = planProjectDeletion(project);
    const definition = catalogPath(project);
    const catalog = JSON.parse(readFileSync(definition, 'utf8')) as { assets: unknown[] };
    catalog.assets.push({
      asset_id: 'late-catalog-record',
      project,
      product: project,
      source: 'catalog',
      title: 'Late catalog record',
    });
    writeFileSync(definition, `${JSON.stringify(catalog, null, 2)}\n`);

    expect(() => deleteProject(project, {
      expectedDigest: before.digest,
      confirmation: 'Catalog Deletion Plan',
      confirmWrite: true,
    })).toThrow(/changed/i);
    expect(planProjectDeletion(project).counts).toContainEqual({ table: 'catalog_records', count: 1 });
  });

  it('reports catalog and indexed asset preservation counts independently for workspace deletion', () => {
    const project = 'workspace-preservation-counts';
    createProjectWorkspace({ id: project, displayName: 'Workspace Preservation Counts', confirmWrite: true });
    insertAsset(project, 'workspace-root');
    insertAsset(project, 'database-only');
    createLineageWorkspace(project, {
      rootAssetId: 'workspace-root',
      title: 'Workspace preservation counts',
      confirmWrite: true,
    });
    const definition = catalogPath(project);
    const catalog = JSON.parse(readFileSync(definition, 'utf8')) as { assets: unknown[] };
    catalog.assets.push({
      asset_id: 'catalog-only',
      project,
      product: project,
      source: 'catalog',
      title: 'Catalog only',
    });
    writeFileSync(definition, `${JSON.stringify(catalog, null, 2)}\n`);

    expect(planWorkspaceDeletion(project, 'workspace-root').preserved).toMatchObject({
      asset_rows: 2,
      catalog_records: 1,
    });
    expect(listProjectCollection({ pageSize: 100 }).projects).toContainEqual(
      expect.objectContaining({ id: project, asset_count: 3 })
    );
  });

  it('refuses to remove a catalog through a project-directory symlink', () => {
    const project = 'symlinked-catalog';
    const outside = join(scratchRoot, 'outside-asset-root');
    mkdirSync(join(outside, 'assets'), { recursive: true });
    const outsideCatalog = join(outside, 'assets', 'catalog.json');
    writeFileSync(outsideCatalog, '{"assets":[]}');
    symlinkSync(outside, join(assetRoot, project));

    expect(() => removeProjectCatalogDefinition(project)).toThrow(/symlinked project catalog path/i);
    expect(existsSync(outsideCatalog)).toBe(true);
  });

  it.each([
    {
      stage: 'early',
      trigger: (project: string) => `
        create trigger inject_project_delete_early
        before insert on project_tombstones
        when new.project_key = '${project}'
        begin select raise(abort, 'injected early deletion failure'); end
      `,
    },
    {
      stage: 'middle',
      trigger: (project: string) => `
        create trigger inject_project_delete_middle
        before delete on assets
        when old.project_id = '${project}'
        begin select raise(abort, 'injected middle deletion failure'); end
      `,
    },
    {
      stage: 'late',
      trigger: (project: string) => `
        create trigger inject_project_delete_late
        before delete on projects
        when old.id = '${project}'
        begin select raise(abort, 'injected late deletion failure'); end
      `,
    },
  ])('rolls back every logical row and leaves catalog recovery intact after a $stage failure', ({ stage, trigger }) => {
    const project = `rollback-${stage}`;
    const root = `${project}-root`;
    createProjectWorkspace({ id: project, displayName: `Rollback ${stage}`, confirmWrite: true });
    insertAsset(project, root);
    createLineageWorkspace(project, { rootAssetId: root, title: `Rollback ${stage}`, confirmWrite: true });
    const before = planProjectDeletion(project);
    const injected = lineageDb();
    injected.exec(trigger(project));
    injected.close();

    expect(() => deleteProject(project, {
      expectedDigest: before.digest,
      confirmation: `Rollback ${stage}`,
      confirmWrite: true,
    })).toThrow(new RegExp(`injected ${stage} deletion failure`, 'i'));

    const verification = lineageDb();
    expect(verification.prepare('select count(*) count from projects where id = ?').get(project)).toEqual({ count: 1 });
    expect(verification.prepare('select count(*) count from assets where project_id = ?').get(project)).toEqual({ count: 1 });
    expect(verification.prepare('select count(*) count from lineage_workspaces where project_id = ?').get(project)).toEqual({ count: 1 });
    expect(verification.prepare('select count(*) count from project_tombstones where project_key = ?').get(project)).toEqual({ count: 0 });
    expect(verification.prepare('pragma foreign_key_check').all()).toEqual([]);
    verification.close();
    expect(existsSync(catalogPath(project))).toBe(true);
    expect(planProjectDeletion(project).state_digest).toBe(before.state_digest);
  });

  it('normalizes migrated positions and finalizes a pending exact-catalog tombstone', () => {
    createProjectWorkspace({ id: 'position-a', displayName: 'Position A', confirmWrite: true });
    createProjectWorkspace({ id: 'position-b', displayName: 'Position B', confirmWrite: true });
    createProjectWorkspace({ id: 'pending-finalize', displayName: 'Pending Finalize', confirmWrite: true });
    insertAsset('position-a', 'position-root-a');
    insertAsset('position-a', 'position-root-b');
    createLineageWorkspace('position-a', { rootAssetId: 'position-root-a', title: 'Position Root A', confirmWrite: true });
    createLineageWorkspace('position-a', { rootAssetId: 'position-root-b', title: 'Position Root B', confirmWrite: true });
    const pendingCatalog = catalogPath('pending-finalize');
    expect(existsSync(pendingCatalog)).toBe(true);

    const database = lineageDb();
    const projectRevisionBefore = Number((database.prepare(`
      select revision from project_collection_state where singleton_id = 'projects'
    `).get() as { revision: number }).revision);
    const workspaceRevisionBefore = Number((database.prepare(`
      select revision from workspace_collection_state
      where project_id = 'position-a' and collection_kind = 'open'
    `).get() as { revision: number }).revision);
    database.prepare("update projects set sort_position = 0 where id in ('position-a', 'position-b')").run();
    database.prepare(`
      update lineage_workspaces set sort_position = 0
      where project_id = 'position-a' and collection_kind = 'open'
    `).run();
    database.prepare(`
      insert into project_tombstones (
        project_key, display_name, catalog_path, deleted_at, finalized_at, reason
      ) values ('pending-finalize', 'Pending Finalize', ?, ?, null, 'failure_injection')
    `).run(pendingCatalog, '2026-07-29T12:00:00.000Z');
    database.prepare("delete from workspace_collection_state where project_id = 'pending-finalize'").run();
    database.prepare("delete from projects where id = 'pending-finalize'").run();
    database.close();

    const normalized = lineageDb();
    const positions = normalized.prepare(`
      select sort_position from projects where id in ('position-a', 'position-b') order by sort_position
    `).all() as Array<{ sort_position: number }>;
    expect(positions.map(row => row.sort_position)).toEqual([0, 1]);
    const workspacePositions = normalized.prepare(`
      select sort_position from lineage_workspaces
      where project_id = 'position-a' and collection_kind = 'open'
      order by sort_position
    `).all() as Array<{ sort_position: number }>;
    expect(workspacePositions.map(row => row.sort_position)).toEqual([0, 1]);
    expect(normalized.prepare(`
      select revision from project_collection_state where singleton_id = 'projects'
    `).get()).toEqual({ revision: projectRevisionBefore + 1 });
    expect(normalized.prepare(`
      select revision from workspace_collection_state
      where project_id = 'position-a' and collection_kind = 'open'
    `).get()).toEqual({ revision: workspaceRevisionBefore + 1 });
    normalized.close();

    reconcileProjectWorkspaceState();
    expect(listProjectCollection({ pageSize: 100 }).projects.some(project => project.id === 'pending-finalize')).toBe(false);
    expect(existsSync(pendingCatalog)).toBe(false);
    const finalized = lineageDb();
    expect(finalized.prepare("select finalized_at from project_tombstones where project_key = 'pending-finalize'").get())
      .toEqual({ finalized_at: expect.any(String) });
    finalized.close();
  });

  it('marks vanished catalog-backed projects missing and restores them when the catalog returns', () => {
    createProjectWorkspace({ id: 'missing-catalog', displayName: 'Missing Catalog', confirmWrite: true });
    const definition = catalogPath('missing-catalog');
    const original = readFileSync(definition, 'utf8');
    rmSync(definition);

    reconcileProjectWorkspaceState();
    expect(listProjectCollection({ pageSize: 100 }).projects).toContainEqual(
      expect.objectContaining({ id: 'missing-catalog', catalog_state: 'missing' })
    );

    writeFileSync(definition, original);
    reconcileProjectWorkspaceState();
    expect(listProjectCollection({ pageSize: 100 }).projects).toContainEqual(
      expect.objectContaining({ id: 'missing-catalog', catalog_state: 'ready' })
    );
  });
});
