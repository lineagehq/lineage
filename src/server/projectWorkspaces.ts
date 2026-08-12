import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  catalogPath,
  cleanProject,
  loadCatalog,
  listProjects as listCatalogProjects,
  projectCatalogDefinitionExists,
  removeProjectCatalogDefinition,
} from './assetCore';
import { initProject } from './assetProjects';
import { projectScopedAssetAlias } from './assetLineage';
import { lineageDb, nowIso, type DatabaseSync } from './assetLineageDb';
import { inferredLegacyLineageWorkspaces } from './assetLineageWorkspaces';
import type {
  CollectionPagination,
  CollectionReorderFields,
  CollectionSort,
  DeletionBlocker,
  DeletionImpactCount,
  LineageWorkspace,
  ProjectCollectionSnapshot,
  ProjectDeletionPlan,
  ProjectWorkspaceSummary,
  WorkspaceCollectionKind,
  WorkspaceCollectionSnapshot,
  WorkspaceDeletionPlan,
} from '../shared/types';

type Row = Record<string, unknown>;

export const swissifierDemoProject = 'swissifier-demo';
const swissifierDemoDisplayName = 'Swissifier Demo';

export class ProjectWorkspaceError extends Error {
  constructor(message: string, public status = 400, public code = 'project_workspace_error') {
    super(message);
  }
}

export function isProjectWorkspaceError(error: unknown): error is ProjectWorkspaceError {
  return error instanceof ProjectWorkspaceError;
}

export function assertProjectWorkspaceAvailable(projectInput: string): void {
  const project = cleanProject(projectInput);
  const database = lineageDb();
  try {
    if (!tableExists(database, 'project_tombstones')) return;
    const deleted = database.prepare(`
      select 1 from project_tombstones where project_key = ?
    `).get(project);
    if (deleted) {
      throw new ProjectWorkspaceError(
        `Project ${project} was permanently deleted`,
        410,
        'project_deleted',
      );
    }
  } finally {
    database.close();
  }
}

function transaction<T>(database: DatabaseSync, callback: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function pagination(pageInput: number | undefined, pageSizeInput: number | undefined, total: number): CollectionPagination {
  const pageSize = Math.min(100, Math.max(1, Math.trunc(pageSizeInput || 12)));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.trunc(pageInput || 1)));
  return { page, pageSize, total, totalPages };
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare(`
    select 1 from sqlite_master where type = 'table' and name = ?
  `).get(table));
}

function projectRevision(database: DatabaseSync): number {
  if (!tableExists(database, 'project_collection_state')) return 1;
  const row = database.prepare("select revision from project_collection_state where singleton_id = 'projects'").get() as { revision?: number } | undefined;
  return Number(row?.revision || 1);
}

function bumpProjectRevision(database: DatabaseSync): number {
  const timestamp = nowIso();
  database.prepare(`
    insert into project_collection_state (singleton_id, revision, updated_at)
    values ('projects', 2, ?)
    on conflict(singleton_id) do update set revision = revision + 1, updated_at = excluded.updated_at
  `).run(timestamp);
  return projectRevision(database);
}

function workspaceRevision(database: DatabaseSync, project: string, collection: WorkspaceCollectionKind): number {
  if (!tableExists(database, 'workspace_collection_state')) return 1;
  const row = database.prepare(`
    select revision from workspace_collection_state where project_id = ? and collection_kind = ?
  `).get(project, collection) as { revision?: number } | undefined;
  return Number(row?.revision || 1);
}

function bumpWorkspaceRevision(database: DatabaseSync, project: string, collection: WorkspaceCollectionKind): number {
  const timestamp = nowIso();
  database.prepare(`
    insert into workspace_collection_state (project_id, collection_kind, revision, updated_at)
    values (?, ?, 2, ?)
    on conflict(project_id, collection_kind)
    do update set revision = revision + 1, updated_at = excluded.updated_at
  `).run(project, collection, timestamp);
  return workspaceRevision(database, project, collection);
}

function nextProjectPosition(database: DatabaseSync): number {
  const row = database.prepare('select coalesce(max(sort_position), -1) + 1 value from projects').get() as { value: number };
  return Number(row.value || 0);
}

function nextWorkspacePosition(database: DatabaseSync, project: string, collection: WorkspaceCollectionKind): number {
  const row = database.prepare(`
    select coalesce(max(sort_position), -1) + 1 value
    from lineage_workspaces where project_id = ? and collection_kind = ?
  `).get(project, collection) as { value: number };
  return Number(row.value || 0);
}

function ensureWorkspaceStates(database: DatabaseSync, project: string): void {
  const timestamp = nowIso();
  for (const collection of ['open', 'archived'] as const) {
    database.prepare(`
      insert or ignore into workspace_collection_state (project_id, collection_kind, revision, updated_at)
      values (?, ?, 1, ?)
    `).run(project, collection, timestamp);
  }
}

function reconcileCatalogProjects(database: DatabaseSync): void {
  const pending = database.prepare(`
    select project_key from project_tombstones where finalized_at is null
  `).all() as Array<{ project_key: string }>;
  for (const marker of pending) {
    try {
      removeProjectCatalogDefinition(marker.project_key);
      database.prepare('update project_tombstones set finalized_at = ? where project_key = ?')
        .run(nowIso(), marker.project_key);
    } catch {
      // Keep the tombstone pending and the project invisible until a later retry succeeds.
    }
  }
  const tombstones = new Set(
    (database.prepare('select project_key from project_tombstones').all() as Array<{ project_key: string }>)
      .map(row => row.project_key),
  );
  const timestamp = nowIso();
  const catalogProjects = listCatalogProjects();
  const catalogProjectIds = new Set(catalogProjects.map(project => project.project));
  let insertedProject = false;
  const vanishedCatalogProjects = (database.prepare(`
    select id from projects
    where catalog_path is not null and catalog_state = 'ready'
  `).all() as Array<{ id: string }>).filter(project => !catalogProjectIds.has(project.id));
  if (vanishedCatalogProjects.length) {
    const markMissing = database.prepare(`
      update projects set catalog_state = 'missing', updated_at = ? where id = ?
    `);
    vanishedCatalogProjects.forEach(project => markMissing.run(timestamp, project.id));
    bumpProjectRevision(database);
  }
  for (const project of catalogProjects) {
    if (tombstones.has(project.project)) continue;
    const existing = database.prepare('select id from projects where id = ?').get(project.project);
    database.prepare(`
      insert into projects (
        id, product, display_name, catalog_path, catalog_state, sort_position, created_at, updated_at
      ) values (?, ?, ?, ?, 'ready', ?, ?, ?)
      on conflict(id) do update set
        product = excluded.product,
        display_name = coalesce(nullif(projects.display_name, ''), excluded.display_name),
        catalog_path = excluded.catalog_path,
        catalog_state = 'ready',
        updated_at = case
          when projects.product != excluded.product
            or coalesce(projects.catalog_path, '') != coalesce(excluded.catalog_path, '')
            or projects.catalog_state != 'ready'
          then excluded.updated_at
          else projects.updated_at
        end
    `).run(
      project.project,
      project.product,
      project.product || project.project,
      project.catalogPath,
      existing ? 0 : nextProjectPosition(database),
      timestamp,
      timestamp,
    );
    insertedProject ||= !existing;
    ensureWorkspaceStates(database, project.project);
  }
  if (insertedProject) bumpProjectRevision(database);
}

export function reconcileProjectWorkspaceState(): string[] {
  const database = lineageDb();
  try {
    reconcileCatalogProjects(database);
    return (database.prepare("select id from projects where catalog_state in ('ready', 'missing') order by sort_position, id").all() as Array<{ id: string }>)
      .map(project => project.id);
  } finally {
    database.close();
  }
}

export function ensureSwissifierDemoProject(): ProjectWorkspaceSummary | null {
  const database = lineageDb();
  try {
    const suppressed = database.prepare(`
      select suppressed_at from demo_bootstrap_state where demo_id = 'swissifier-rich-demo'
    `).get() as { suppressed_at?: string | null } | undefined;
    if (suppressed?.suppressed_at) return null;
    const existing = database.prepare("select * from projects where id = ? and catalog_state = 'ready'")
      .get(swissifierDemoProject) as Row | undefined;
    if (existing) return rowToProject(database, existing);
    return transaction(database, () => {
      const timestamp = nowIso();
      database.prepare('delete from project_tombstones where project_key = ?').run(swissifierDemoProject);
      database.prepare(`
        insert into projects (
          id, product, display_name, catalog_path, catalog_state, sort_position, created_at, updated_at
        ) values (?, ?, ?, null, 'ready', ?, ?, ?)
        on conflict(id) do update set
          product = excluded.product,
          display_name = excluded.display_name,
          catalog_path = null,
          catalog_state = 'ready',
          updated_at = excluded.updated_at
      `).run(
        swissifierDemoProject,
        swissifierDemoDisplayName,
        swissifierDemoDisplayName,
        nextProjectPosition(database),
        timestamp,
        timestamp,
      );
      ensureWorkspaceStates(database, swissifierDemoProject);
      bumpProjectRevision(database);
      return requireProject(database, swissifierDemoProject);
    });
  } finally {
    database.close();
  }
}

export function restoreSwissifierDemoProjectDefinition(confirmWrite: boolean): ProjectWorkspaceSummary | { dryRun: true } {
  if (!confirmWrite) return { dryRun: true as const };
  const database = lineageDb();
  try {
    transaction(database, () => {
      const timestamp = nowIso();
      database.prepare(`
        insert into demo_bootstrap_state (demo_id, suppressed_at, restored_at, updated_at)
        values ('swissifier-rich-demo', null, ?, ?)
        on conflict(demo_id) do update set
          suppressed_at = null,
          restored_at = excluded.restored_at,
          updated_at = excluded.updated_at
      `).run(timestamp, timestamp);
      database.prepare('delete from project_tombstones where project_key = ?').run(swissifierDemoProject);
    });
  } finally {
    database.close();
  }
  const project = ensureSwissifierDemoProject();
  if (!project) throw new ProjectWorkspaceError('Swissifier Demo restore remained suppressed', 409, 'demo_restore_failed');
  return project;
}

function rowToProject(database: DatabaseSync, row: Row): ProjectWorkspaceSummary {
  const id = String(row.id);
  const indexedAssetIds = tableExists(database, 'assets')
    ? (database.prepare('select id from assets where project_id = ?').all(id) as Array<{ id: string }>).map(asset => asset.id)
    : [];
  const assetIds = new Set(indexedAssetIds);
  const workspace = tableExists(database, 'lineage_workspaces')
    ? database.prepare('select count(*) count from lineage_workspaces where project_id = ?').get(id) as { count: number }
    : { count: 0 };
  let catalogAssetCount = 0;
  try {
    const catalogAssets = loadCatalog(id).assets;
    const logicalCatalogIdsByAlias = new Map(
      catalogAssets.map(asset => [projectScopedAssetAlias(id, asset.asset_id), asset.asset_id])
    );
    for (const indexedId of indexedAssetIds) {
      const logicalId = logicalCatalogIdsByAlias.get(indexedId);
      if (logicalId) {
        assetIds.delete(indexedId);
        assetIds.add(logicalId);
      }
    }
    catalogAssets.forEach(asset => assetIds.add(asset.asset_id));
    catalogAssetCount = catalogAssets.length;
  } catch {
    // Missing or invalid catalogs remain visible with their indexed SQLite count.
  }
  return {
    id,
    display_name: String(row.display_name || row.product || id),
    product: String(row.product || id),
    catalog_path: typeof row.catalog_path === 'string' ? row.catalog_path : undefined,
    catalog_state: String(row.catalog_state || 'ready') as ProjectWorkspaceSummary['catalog_state'],
    sort_position: Number(row.sort_position || 0),
    asset_count: Math.max(assetIds.size, catalogAssetCount),
    workspace_count: Number(workspace.count || 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function projectRows(database: DatabaseSync): Row[] {
  const rows = database.prepare('select * from projects').all() as Row[];
  if (process.env.LINEAGE_DB_ACCESS !== 'read-only') return rows;
  const byId = new Map(rows.map(row => [String(row.id), row]));
  const tombstones = tableExists(database, 'project_tombstones')
    ? new Set((database.prepare('select project_key from project_tombstones').all() as Array<{ project_key: string }>).map(row => row.project_key))
    : new Set<string>();
  let nextPosition = rows.reduce((maximum, row) => Math.max(maximum, Number(row.sort_position || 0)), -1) + 1;
  for (const catalog of listCatalogProjects()) {
    if (tombstones.has(catalog.project)) continue;
    const existing = byId.get(catalog.project);
    if (existing) {
      byId.set(catalog.project, {
        ...existing,
        catalog_path: catalog.catalogPath,
        catalog_state: 'ready',
        product: catalog.product,
      });
      continue;
    }
    let timestamp = '1970-01-01T00:00:00.000Z';
    try {
      timestamp = statSync(catalog.catalogPath).mtime.toISOString();
    } catch {
      // Bundled fallback catalogs may not have a profile-local definition.
    }
    byId.set(catalog.project, {
      id: catalog.project,
      product: catalog.product,
      display_name: catalog.product || catalog.project,
      catalog_path: catalog.catalogPath,
      catalog_state: 'ready',
      sort_position: nextPosition,
      created_at: timestamp,
      updated_at: timestamp,
    });
    nextPosition += 1;
  }
  return [...byId.values()];
}

function requireProject(database: DatabaseSync, project: string): ProjectWorkspaceSummary {
  const row = projectRows(database).find(candidate => candidate.id === project);
  if (!row || row.catalog_state === 'pending_delete') {
    throw new ProjectWorkspaceError(`Unknown project: ${project}`, 404, 'project_not_found');
  }
  return rowToProject(database, row);
}

export function listProjectCollection(options: {
  page?: number;
  pageSize?: number;
  query?: string;
  sort?: CollectionSort;
} = {}): ProjectCollectionSnapshot {
  const database = lineageDb();
  try {
    const query = options.query?.trim().toLocaleLowerCase() || '';
    const sort = options.sort || 'manual';
    const rows = projectRows(database);
    const projects = rows
      .map(row => rowToProject(database, row))
      .filter(project => project.catalog_state === 'ready' || project.catalog_state === 'missing')
      .filter(project => !query || project.id.toLocaleLowerCase().includes(query) || project.display_name.toLocaleLowerCase().includes(query))
      .sort((left, right) => {
        if (sort === 'name') return left.display_name.localeCompare(right.display_name) || left.id.localeCompare(right.id);
        if (sort === 'updated') return right.updated_at.localeCompare(left.updated_at) || left.id.localeCompare(right.id);
        return left.sort_position - right.sort_position || left.id.localeCompare(right.id);
      });
    const page = pagination(options.page, options.pageSize, projects.length);
    const start = (page.page - 1) * page.pageSize;
    return {
      projects: projects.slice(start, start + page.pageSize),
      pagination: page,
      manual_revision: projectRevision(database),
      reorder_enabled: sort === 'manual' && !query,
      demo_restore_available: demoBootstrapSuppressedIn(database),
      query: query || undefined,
      sort,
      fetched_at: nowIso(),
    };
  } finally {
    database.close();
  }
}

export function inspectProjectWorkspace(project: string): ProjectWorkspaceSummary {
  const database = lineageDb();
  try {
    return requireProject(database, cleanProject(project));
  } finally {
    database.close();
  }
}

export function createProjectWorkspace(fields: {
  id: string;
  displayName: string;
  defaultBucket?: string;
  defaultRegion?: string;
  confirmWrite: boolean;
}) {
  const id = cleanProject(fields.id.trim());
  const displayName = fields.displayName.trim();
  if (!displayName) throw new ProjectWorkspaceError('Project display name is required');
  const expectedCatalogPath = catalogPath(id);
  if (!fields.confirmWrite) {
    return { ok: true as const, dryRun: true as const, project: { id, display_name: displayName, catalog_path: expectedCatalogPath } };
  }
  const database = lineageDb();
  let catalogCreated = false;
  try {
    if (database.prepare('select 1 from projects where id = ?').get(id)) {
      throw new ProjectWorkspaceError(`Project already exists: ${id}`, 409, 'project_conflict');
    }
    if (projectCatalogDefinitionExists(id)) {
      throw new ProjectWorkspaceError(`Project catalog already exists: ${id}`, 409, 'catalog_conflict');
    }
    const initialized = initProject(id, {
      defaultBucket: fields.defaultBucket,
      defaultRegion: fields.defaultRegion,
      product: displayName,
    });
    catalogCreated = initialized.created;
    const timestamp = nowIso();
    const project = transaction(database, () => {
      database.prepare('delete from project_tombstones where project_key = ?').run(id);
      database.prepare(`
        insert into projects (
          id, product, display_name, catalog_path, catalog_state, sort_position, created_at, updated_at
        ) values (?, ?, ?, ?, 'ready', ?, ?, ?)
      `).run(id, displayName, displayName, expectedCatalogPath, nextProjectPosition(database), timestamp, timestamp);
      ensureWorkspaceStates(database, id);
      bumpProjectRevision(database);
      return requireProject(database, id);
    });
    return { ok: true as const, message: `Created project ${displayName}`, project };
  } catch (error) {
    if (catalogCreated) {
      try {
        removeProjectCatalogDefinition(id);
      } catch (cleanupError) {
        const timestamp = nowIso();
        database.prepare(`
          insert into project_tombstones (
            project_key, display_name, catalog_path, deleted_at, finalized_at, reason
          ) values (?, ?, ?, ?, null, ?)
          on conflict(project_key) do update set
            display_name = excluded.display_name,
            catalog_path = excluded.catalog_path,
            deleted_at = excluded.deleted_at,
            finalized_at = null,
            reason = excluded.reason
        `).run(id, displayName, expectedCatalogPath, timestamp, `create_cleanup_failed:${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }
    throw error;
  } finally {
    database.close();
  }
}

function reorderRows(
  database: DatabaseSync,
  table: 'projects' | 'lineage_workspaces',
  ids: string[],
  itemId: string,
  targetIndex: number,
): boolean {
  assertReorderTarget(targetIndex);
  const currentIndex = ids.indexOf(itemId);
  if (currentIndex < 0) throw new ProjectWorkspaceError(`Unknown collection item: ${itemId}`, 404, 'item_not_found');
  const boundedTarget = Math.max(0, Math.min(ids.length - 1, Math.trunc(targetIndex)));
  if (boundedTarget === currentIndex) return false;
  ids.splice(currentIndex, 1);
  ids.splice(boundedTarget, 0, itemId);
  const statement = database.prepare(`update ${table} set sort_position = ? where id = ? and sort_position != ?`);
  ids.forEach((id, index) => statement.run(index, id, index));
  return true;
}

function assertReorderTarget(targetIndex: number): void {
  if (!Number.isFinite(targetIndex)) {
    throw new ProjectWorkspaceError('Reorder targetIndex must be a finite number', 400, 'invalid_target_index');
  }
}

export function reorderProjects(fields: CollectionReorderFields) {
  assertReorderTarget(fields.targetIndex);
  const database = lineageDb();
  try {
    const currentRevision = projectRevision(database);
    if (!fields.confirmWrite) return { ok: true as const, dryRun: true as const, expected_revision: currentRevision };
    return transaction(database, () => {
      const revision = projectRevision(database);
      if (revision !== fields.expectedRevision) {
        throw new ProjectWorkspaceError('Project order changed; refresh and try again', 409, 'stale_collection_revision');
      }
      const ids = (database.prepare(`
        select id from projects
        where catalog_state in ('ready', 'missing')
        order by sort_position, id
      `).all() as Array<{ id: string }>).map(row => row.id);
      const changed = reorderRows(database, 'projects', ids, fields.itemId, fields.targetIndex);
      return {
        ok: true as const,
        message: changed ? 'Project order updated' : 'Project order unchanged',
        manual_revision: changed ? bumpProjectRevision(database) : revision,
      };
    });
  } finally {
    database.close();
  }
}

export function listWorkspaceCollection(projectInput: string, options: {
  collection?: WorkspaceCollectionKind;
  page?: number;
  pageSize?: number;
  query?: string;
  sort?: CollectionSort;
} = {}): WorkspaceCollectionSnapshot {
  const project = cleanProject(projectInput);
  const database = lineageDb();
  try {
    const projectSummary = requireProject(database, project);
    const collection = options.collection || 'open';
    const query = options.query?.trim().toLocaleLowerCase() || '';
    const sort = options.sort || 'manual';
    const rows = database.prepare(`
      select * from lineage_workspaces where project_id = ?
    `).all(project) as Row[];
    const persistedWorkspaces = rows
      .map(row => ({
        id: String(row.id),
        project: String(row.project_id),
        root_asset_id: String(row.root_asset_id),
        title: String(row.title),
        status: String(row.status) as LineageWorkspace['status'],
        notes: typeof row.notes === 'string' ? row.notes : undefined,
        created_by: String(row.created_by) as LineageWorkspace['created_by'],
        active_at: typeof row.active_at === 'string' ? row.active_at : undefined,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
        sort_position: Number(row.sort_position || 0),
        collection_kind: String(row.collection_kind || (row.status === 'archived' ? 'archived' : 'open')) as WorkspaceCollectionKind,
        revision: Number(row.revision || 1),
      }));
    const workspaces = [...persistedWorkspaces, ...inferredLegacyLineageWorkspaces(database, project)]
      .filter(workspace => workspace.collection_kind === collection)
      .filter(workspace => !query || workspace.id.toLocaleLowerCase().includes(query)
        || workspace.title.toLocaleLowerCase().includes(query)
        || workspace.root_asset_id.toLocaleLowerCase().includes(query))
      .sort((left, right) => {
        if (sort === 'name') return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
        if (sort === 'updated') return right.updated_at.localeCompare(left.updated_at) || left.id.localeCompare(right.id);
        return (left.sort_position || 0) - (right.sort_position || 0) || left.id.localeCompare(right.id);
      });
    const page = pagination(options.page, options.pageSize, workspaces.length);
    const start = (page.page - 1) * page.pageSize;
    return {
      project: projectSummary,
      workspaces: workspaces.slice(start, start + page.pageSize),
      collection,
      pagination: page,
      manual_revision: workspaceRevision(database, project, collection),
      reorder_enabled: sort === 'manual' && !query,
      query: query || undefined,
      sort,
      fetched_at: nowIso(),
    };
  } finally {
    database.close();
  }
}

export function reorderWorkspaces(projectInput: string, collection: WorkspaceCollectionKind, fields: CollectionReorderFields) {
  assertReorderTarget(fields.targetIndex);
  const project = cleanProject(projectInput);
  const database = lineageDb();
  try {
    requireProject(database, project);
    if (!fields.confirmWrite) {
      return { ok: true as const, dryRun: true as const, expected_revision: workspaceRevision(database, project, collection) };
    }
    return transaction(database, () => {
      const revision = workspaceRevision(database, project, collection);
      if (revision !== fields.expectedRevision) {
        throw new ProjectWorkspaceError('Workspace order changed; refresh and try again', 409, 'stale_collection_revision');
      }
      const ids = (database.prepare(`
        select id from lineage_workspaces
        where project_id = ? and collection_kind = ?
        order by sort_position, id
      `).all(project, collection) as Array<{ id: string }>).map(row => row.id);
      const currentIndex = ids.indexOf(fields.itemId);
      if (currentIndex < 0) throw new ProjectWorkspaceError(`Unknown workspace: ${fields.itemId}`, 404, 'workspace_not_found');
      const boundedTarget = Math.max(0, Math.min(ids.length - 1, Math.trunc(fields.targetIndex)));
      if (boundedTarget === currentIndex) {
        return { ok: true as const, message: 'Workspace order unchanged', manual_revision: revision };
      }
      ids.splice(currentIndex, 1);
      ids.splice(boundedTarget, 0, fields.itemId);
      const update = database.prepare(`
        update lineage_workspaces set sort_position = ?
        where project_id = ? and id = ? and sort_position != ?
      `);
      ids.forEach((id, index) => update.run(index, project, id, index));
      return { ok: true as const, message: 'Workspace order updated', manual_revision: bumpWorkspaceRevision(database, project, collection) };
    });
  } finally {
    database.close();
  }
}

export function restoreWorkspace(projectInput: string, workspaceId: string, confirmWrite: boolean) {
  const project = cleanProject(projectInput);
  const database = lineageDb();
  try {
    const row = database.prepare(`
      select * from lineage_workspaces where project_id = ? and (id = ? or root_asset_id = ?)
    `).get(project, workspaceId, workspaceId) as Row | undefined;
    if (!row) throw new ProjectWorkspaceError(`Unknown workspace: ${workspaceId}`, 404, 'workspace_not_found');
    if (String(row.status) !== 'archived') throw new ProjectWorkspaceError('Only archived workspaces can be restored', 409, 'workspace_not_archived');
    if (!confirmWrite) return { ok: true as const, dryRun: true as const, workspace_id: String(row.id) };
    return transaction(database, () => {
      const timestamp = nowIso();
      database.prepare(`
        update lineage_workspaces
        set status = 'active', collection_kind = 'open', sort_position = ?, active_at = ?,
            updated_at = ?, revision = revision + 1
        where project_id = ? and id = ?
      `).run(nextWorkspacePosition(database, project, 'open'), timestamp, timestamp, project, String(row.id));
      const archivedIds = (database.prepare(`
        select id from lineage_workspaces
        where project_id = ? and collection_kind = 'archived'
        order by sort_position, created_at, id
      `).all(project) as Array<{ id: string }>).map(item => item.id);
      const compactArchived = database.prepare('update lineage_workspaces set sort_position = ? where project_id = ? and id = ?');
      archivedIds.forEach((id, index) => compactArchived.run(index, project, id));
      bumpWorkspaceRevision(database, project, 'archived');
      bumpWorkspaceRevision(database, project, 'open');
      return { ok: true as const, message: `Restored ${String(row.title)}`, workspace_id: String(row.id) };
    });
  } finally {
    database.close();
  }
}

function count(database: DatabaseSync, sql: string, ...params: Array<string | number>): number {
  const row = database.prepare(sql).get(...params) as { count?: number } | undefined;
  return Number(row?.count || 0);
}

function activeWorkspaceBlockers(database: DatabaseSync, project: string, workspaceId: string, rootAssetId: string): DeletionBlocker[] {
  const claimCount = count(database, `
    select count(*) count from agent_claims
    where project_id = ? and status = 'active' and expires_at > ?
      and (
        (scope_type = 'lineage_workspace' and target_id in (?, ?))
        or
        (scope_type = 'lineage_task' and target_id in (
          select id from lineage_tasks where project_id = ? and root_asset_id = ?
        ))
        or scope_type = 'project_channel'
      )
  `, project, nowIso(), workspaceId, `${project}:lineage-workspace:${rootAssetId}`, project, rootAssetId);
  const generationCount = count(database, `
    select count(*) count from generation_jobs
    where project_id = ? and root_asset_id = ? and status = 'planned'
  `, project, rootAssetId);
  const blockers: DeletionBlocker[] = [];
  if (claimCount) blockers.push({ code: 'active_claims', message: 'Release active project, workspace, or task claims before deletion.', count: claimCount });
  if (generationCount) blockers.push({ code: 'generation_in_flight', message: 'Complete or cancel planned generation work before deletion.', count: generationCount });
  return blockers;
}

function workspaceImpactCounts(database: DatabaseSync, project: string, workspaceId: string, root: string): DeletionImpactCount[] {
  const entries: Array<[string, string, Array<string>]> = [
    ['lineage_workspaces', 'select count(*) count from lineage_workspaces where project_id = ? and id = ?', [project, workspaceId]],
    ['asset_layouts', 'select count(*) count from asset_layouts where project_id = ? and root_asset_id = ?', [project, root]],
    ['asset_selections', 'select count(*) count from asset_selections where project_id = ? and root_asset_id = ?', [project, root]],
    ['asset_social_marks', 'select count(*) count from asset_social_marks where project_id = ? and root_asset_id = ?', [project, root]],
    ['asset_discussion_marks', 'select count(*) count from asset_discussion_marks where project_id = ? and root_asset_id = ?', [project, root]],
    ['asset_reroll_requests', 'select count(*) count from asset_reroll_requests where project_id = ? and root_asset_id = ?', [project, root]],
    ['generation_target_defaults', 'select count(*) count from generation_target_defaults where project_id = ? and root_asset_id = ?', [project, root]],
    ['node_next_output_target_settings', 'select count(*) count from node_next_output_target_settings where project_id = ? and root_asset_id = ?', [project, root]],
    ['lineage_tasks', 'select count(*) count from lineage_tasks where project_id = ? and root_asset_id = ?', [project, root]],
    ['lineage_task_events', `select count(*) count from lineage_task_events where task_id in (
      select id from lineage_tasks where project_id = ? and root_asset_id = ?
    )`, [project, root]],
    ['agent_claims', `select count(*) count from agent_claims where project_id = ? and (
      (scope_type = 'lineage_workspace' and target_id in (?, ?))
      or (scope_type = 'lineage_task' and target_id in (
        select id from lineage_tasks where project_id = ? and root_asset_id = ?
      ))
    )`, [project, workspaceId, `${project}:lineage-workspace:${root}`, project, root]],
    ['agent_claim_events', `select count(*) count from agent_claim_events where claim_id in (
      select id from agent_claims where project_id = ? and (
        (scope_type = 'lineage_workspace' and target_id in (?, ?))
        or (scope_type = 'lineage_task' and target_id in (
          select id from lineage_tasks where project_id = ? and root_asset_id = ?
        ))
      )
    )`, [project, workspaceId, `${project}:lineage-workspace:${root}`, project, root]],
    ['generation_jobs', 'select count(*) count from generation_jobs where project_id = ? and root_asset_id = ?', [project, root]],
    ['generation_job_inputs', `select count(*) count from generation_job_inputs where job_id in (
      select id from generation_jobs where project_id = ? and root_asset_id = ?
    )`, [project, root]],
    ['generation_job_outputs', `select count(*) count from generation_job_outputs where job_id in (
      select id from generation_jobs where project_id = ? and root_asset_id = ?
    )`, [project, root]],
    ['generation_job_receipts', `select count(*) count from generation_job_receipts where job_id in (
      select id from generation_jobs where project_id = ? and root_asset_id = ?
    )`, [project, root]],
    ['generation_target_maps', `select count(*) count from generation_target_maps where job_id in (
      select id from generation_jobs where project_id = ? and root_asset_id = ?
    )`, [project, root]],
    ['generation_target_groups', `select count(*) count from generation_target_groups where job_id in (
      select id from generation_jobs where project_id = ? and root_asset_id = ?
    )`, [project, root]],
    ['generation_output_slots', `select count(*) count from generation_output_slots where job_id in (
      select id from generation_jobs where project_id = ? and root_asset_id = ?
    )`, [project, root]],
    ['generation_job_target_resolutions', `select count(*) count from generation_job_target_resolutions where job_id in (
      select id from generation_jobs where project_id = ? and root_asset_id = ?
    )`, [project, root]],
    ['asset_output_specs', `select count(*) count from asset_output_specs where generation_job_id in (
      select id from generation_jobs where project_id = ? and root_asset_id = ?
    )`, [project, root]],
  ];
  const ownNodes = reachableNodes(database, project, root);
  const otherRoots = (database.prepare(`
    select root_asset_id from lineage_workspaces where project_id = ? and id != ?
  `).all(project, workspaceId) as Array<{ root_asset_id: string }>).map(item => item.root_asset_id);
  const sharedNodes = new Set<string>();
  otherRoots.forEach(otherRoot => reachableNodes(database, project, otherRoot).forEach(node => sharedNodes.add(node)));
  const exclusiveNodes = [...ownNodes].filter(node => !sharedNodes.has(node));
  const graphCounts: DeletionImpactCount[] = [
    { table: 'graph_nodes_reachable', count: ownNodes.size },
    { table: 'graph_nodes_shared', count: [...ownNodes].filter(node => sharedNodes.has(node)).length },
    { table: 'graph_nodes_exclusive', count: exclusiveNodes.length },
  ];
  if (exclusiveNodes.length) {
    const markers = exclusiveNodes.map(() => '?').join(',');
    graphCounts.push(
      {
        table: 'asset_edges_exclusive',
        count: count(database, `
          select count(*) count from asset_edges
          where project_id = ? and parent_asset_id in (${markers})
        `, project, ...exclusiveNodes),
      },
      {
        table: 'asset_attempts_exclusive',
        count: count(database, `
          select count(*) count from asset_attempts where project_id = ? and node_asset_id in (${markers})
        `, project, ...exclusiveNodes),
      },
    );
  } else {
    graphCounts.push({ table: 'asset_edges_exclusive', count: 0 }, { table: 'asset_attempts_exclusive', count: 0 });
  }
  return [...entries.map(([table, sql, params]) => ({ table, count: count(database, sql, ...params) })), ...graphCounts];
}

function workspacePlan(database: DatabaseSync, project: string, workspaceId: string): WorkspaceDeletionPlan {
  const row = database.prepare(`
    select * from lineage_workspaces where project_id = ? and (id = ? or root_asset_id = ?)
  `).get(project, workspaceId, workspaceId) as Row | undefined;
  if (!row) throw new ProjectWorkspaceError(`Unknown workspace: ${workspaceId}`, 404, 'workspace_not_found');
  const id = String(row.id);
  const root = String(row.root_asset_id);
  const collection = String(row.collection_kind) as WorkspaceCollectionKind;
  const counts = workspaceImpactCounts(database, project, id, root);
  const blockers = activeWorkspaceBlockers(database, project, id, root);
  const assetRows = count(database, 'select count(*) count from assets where project_id = ?', project);
  let catalogRecords = 0;
  try {
    catalogRecords = loadCatalog(project).assets.length;
  } catch {
    // A workspace can remain inspectable while its catalog is missing; report zero catalog records in that state.
  }
  const planWithoutDigest = {
    schema_version: 'lineage.workspace_deletion_plan.v1' as const,
    project,
    workspace_id: id,
    root_asset_id: root,
    workspace_revision: Number(row.revision || 1),
    collection_revision: workspaceRevision(database, project, collection),
    state_digest: projectStateDigest(database, project),
    counts,
    blockers,
    preserved: {
      asset_rows: assetRows,
      catalog_records: catalogRecords,
      local_files: true as const,
      generated_files: true as const,
      cloud_objects: true as const,
    },
  };
  return { ...planWithoutDigest, digest: digest(planWithoutDigest) };
}

export function planWorkspaceDeletion(projectInput: string, workspaceId: string): WorkspaceDeletionPlan {
  const database = lineageDb();
  try {
    return workspacePlan(database, cleanProject(projectInput), workspaceId);
  } finally {
    database.close();
  }
}

function reachableNodes(database: DatabaseSync, project: string, root: string): Set<string> {
  const edges = database.prepare('select parent_asset_id parent, child_asset_id child from asset_edges where project_id = ?').all(project) as Array<{ parent: string; child: string }>;
  const children = new Map<string, string[]>();
  for (const edge of edges) children.set(edge.parent, [...(children.get(edge.parent) || []), edge.child]);
  const reachable = new Set([root]);
  const queue = [root];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const child of children.get(parent) || []) {
      if (reachable.has(child)) continue;
      reachable.add(child);
      queue.push(child);
    }
  }
  return reachable;
}

function deleteGenerationJobsForRoot(database: DatabaseSync, project: string, root: string): void {
  database.prepare(`
    delete from asset_output_specs where generation_job_id in (
      select id from generation_jobs where project_id = ? and root_asset_id = ?
    )
  `).run(project, root);
  database.prepare('delete from generation_jobs where project_id = ? and root_asset_id = ?').run(project, root);
}

export function deleteWorkspace(projectInput: string, workspaceId: string, fields: {
  expectedDigest: string;
  confirmWrite: boolean;
}) {
  const project = cleanProject(projectInput);
  const database = lineageDb();
  try {
    const initial = workspacePlan(database, project, workspaceId);
    if (!fields.confirmWrite) return { ok: true as const, dryRun: true as const, plan: initial };
    return transaction(database, () => {
      const plan = workspacePlan(database, project, workspaceId);
      if (plan.digest !== fields.expectedDigest) {
        throw new ProjectWorkspaceError('Workspace deletion plan changed; review the new impact before deleting', 409, 'stale_deletion_plan');
      }
      if (plan.blockers.length) {
        throw new ProjectWorkspaceError(plan.blockers[0].message, 409, plan.blockers[0].code);
      }
      const row = database.prepare('select collection_kind from lineage_workspaces where project_id = ? and id = ?').get(project, plan.workspace_id) as { collection_kind: WorkspaceCollectionKind };
      const ownNodes = reachableNodes(database, project, plan.root_asset_id);
      const otherRoots = (database.prepare(`
        select root_asset_id from lineage_workspaces where project_id = ? and id != ?
      `).all(project, plan.workspace_id) as Array<{ root_asset_id: string }>).map(item => item.root_asset_id);
      const sharedNodes = new Set<string>();
      otherRoots.forEach(root => reachableNodes(database, project, root).forEach(node => sharedNodes.add(node)));
      const exclusiveNodes = [...ownNodes].filter(node => !sharedNodes.has(node));
      const timestamp = nowIso();

      database.prepare(`
        insert into deleted_lineage_workspaces (
          project_id, root_asset_id, workspace_id, deleted_at, deletion_digest
        ) values (?, ?, ?, ?, ?)
        on conflict(project_id, root_asset_id) do update set
          workspace_id = excluded.workspace_id,
          deleted_at = excluded.deleted_at,
          deletion_digest = excluded.deletion_digest
      `).run(project, plan.root_asset_id, plan.workspace_id, timestamp, plan.digest);

      database.prepare(`
        delete from agent_claim_events where claim_id in (
          select id from agent_claims where project_id = ? and (
            (scope_type = 'lineage_workspace' and target_id in (?, ?))
            or (scope_type = 'lineage_task' and target_id in (
              select id from lineage_tasks where project_id = ? and root_asset_id = ?
            ))
          )
        )
      `).run(project, plan.workspace_id, `${project}:lineage-workspace:${plan.root_asset_id}`, project, plan.root_asset_id);
      database.prepare(`
        delete from agent_claims where project_id = ? and (
          (scope_type = 'lineage_workspace' and target_id in (?, ?))
          or (scope_type = 'lineage_task' and target_id in (
            select id from lineage_tasks where project_id = ? and root_asset_id = ?
          ))
        )
      `).run(project, plan.workspace_id, `${project}:lineage-workspace:${plan.root_asset_id}`, project, plan.root_asset_id);
      database.prepare(`
        delete from lineage_task_events where task_id in (
          select id from lineage_tasks where project_id = ? and root_asset_id = ?
        )
      `).run(project, plan.root_asset_id);
      database.prepare('delete from lineage_tasks where project_id = ? and root_asset_id = ?').run(project, plan.root_asset_id);
      deleteGenerationJobsForRoot(database, project, plan.root_asset_id);
      for (const table of ['asset_layouts', 'asset_selections', 'asset_social_marks', 'asset_discussion_marks', 'asset_reroll_requests', 'generation_target_defaults', 'node_next_output_target_settings']) {
        database.prepare(`delete from ${table} where project_id = ? and root_asset_id = ?`).run(project, plan.root_asset_id);
      }
      if (exclusiveNodes.length) {
        const markers = exclusiveNodes.map(() => '?').join(',');
        database.prepare(`delete from asset_attempts where project_id = ? and node_asset_id in (${markers})`).run(project, ...exclusiveNodes);
        database.prepare(`
          delete from asset_edges
          where project_id = ? and parent_asset_id in (${markers})
        `).run(project, ...exclusiveNodes);
      }
      database.prepare('delete from lineage_workspaces where project_id = ? and id = ?').run(project, plan.workspace_id);
      const remaining = (database.prepare(`
        select id from lineage_workspaces
        where project_id = ? and collection_kind = ? order by sort_position, id
      `).all(project, row.collection_kind) as Array<{ id: string }>).map(item => item.id);
      const compact = database.prepare('update lineage_workspaces set sort_position = ? where project_id = ? and id = ?');
      remaining.forEach((id, index) => compact.run(index, project, id));
      const revision = bumpWorkspaceRevision(database, project, row.collection_kind);
      const violations = database.prepare('pragma foreign_key_check').all();
      if (violations.length) throw new ProjectWorkspaceError(`Workspace deletion violated foreign keys: ${JSON.stringify(violations)}`, 409, 'foreign_key_violation');
      return {
        ok: true as const,
        message: `Deleted workspace ${plan.workspace_id}; physical media was preserved`,
        deletion_digest: plan.digest,
        manual_revision: revision,
        preserved: plan.preserved,
      };
    });
  } finally {
    database.close();
  }
}

const projectDirectTables = [
  'content_targets',
  'content_post_assets',
  'content_posts',
  'content_batches',
  'asset_ledger_sources',
  'asset_ledger_placements',
  'asset_ledger_index_runs',
  'asset_ledger_records',
  'generation_target_defaults',
  'node_next_output_target_settings',
  'adapter_settings',
  'asset_social_marks',
  'asset_discussion_marks',
  'asset_reroll_requests',
  'asset_selections',
  'asset_layouts',
  'lineage_workspaces',
  'deleted_lineage_workspaces',
  'workspace_collection_state',
  'asset_attempts',
  'asset_edges',
  'selection_sets',
  'generation_jobs',
  'lineage_tasks',
  'agent_claims',
  'assets',
] as const;

function projectImpactCounts(database: DatabaseSync, project: string): DeletionImpactCount[] {
  const indirect: DeletionImpactCount[] = [
    { table: 'asset_reviews', count: count(database, 'select count(*) count from asset_reviews where asset_id in (select id from assets where project_id = ?)', project) },
    { table: 'selection_items', count: count(database, 'select count(*) count from selection_items where set_id in (select id from selection_sets where project_id = ?)', project) },
    { table: 'lineage_task_events', count: count(database, 'select count(*) count from lineage_task_events where task_id in (select id from lineage_tasks where project_id = ?)', project) },
    { table: 'agent_claim_events', count: count(database, 'select count(*) count from agent_claim_events where claim_id in (select id from agent_claims where project_id = ?)', project) },
    { table: 'generation_job_receipts', count: count(database, 'select count(*) count from generation_job_receipts where job_id in (select id from generation_jobs where project_id = ?)', project) },
    { table: 'generation_target_maps', count: count(database, 'select count(*) count from generation_target_maps where job_id in (select id from generation_jobs where project_id = ?)', project) },
    { table: 'generation_target_groups', count: count(database, 'select count(*) count from generation_target_groups where job_id in (select id from generation_jobs where project_id = ?)', project) },
    { table: 'generation_output_slots', count: count(database, 'select count(*) count from generation_output_slots where job_id in (select id from generation_jobs where project_id = ?)', project) },
    { table: 'generation_job_target_resolutions', count: count(database, 'select count(*) count from generation_job_target_resolutions where job_id in (select id from generation_jobs where project_id = ?)', project) },
    { table: 'asset_output_specs', count: count(database, 'select count(*) count from asset_output_specs where generation_job_id in (select id from generation_jobs where project_id = ?) or asset_id in (select id from assets where project_id = ?)', project, project) },
    { table: 'generation_job_inputs', count: count(database, 'select count(*) count from generation_job_inputs where project_id = ?', project) },
    { table: 'generation_job_outputs', count: count(database, 'select count(*) count from generation_job_outputs where project_id = ?', project) },
    { table: 'projects', count: count(database, 'select count(*) count from projects where id = ?', project) },
  ];
  return [
    ...projectDirectTables.map(table => ({ table, count: count(database, `select count(*) count from ${table} where project_id = ?`, project) })),
    { table: 'catalog_records', count: projectCatalogDeletionState(project).asset_count },
    ...indirect,
  ];
}

function projectCatalogDeletionState(project: string): {
  asset_count: number;
  exists: boolean;
  sha256: string | null;
} {
  const path = catalogPath(project);
  if (!existsSync(path)) return { asset_count: 0, exists: false, sha256: null };
  const body = readFileSync(path);
  let assetCount = 0;
  try {
    const parsed = JSON.parse(body.toString('utf8')) as { assets?: unknown[] };
    assetCount = Array.isArray(parsed.assets) ? parsed.assets.length : 0;
  } catch {
    // The raw checksum still binds deletion approval to an invalid catalog file.
  }
  return {
    asset_count: assetCount,
    exists: true,
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}

function projectBlockers(database: DatabaseSync, project: string): DeletionBlocker[] {
  const claims = count(database, "select count(*) count from agent_claims where project_id = ? and status = 'active' and expires_at > ?", project, nowIso());
  const generations = count(database, "select count(*) count from generation_jobs where project_id = ? and status = 'planned'", project);
  const blockers: DeletionBlocker[] = [];
  if (claims) blockers.push({ code: 'active_claims', message: 'Release active project claims before deletion.', count: claims });
  if (generations) blockers.push({ code: 'generation_in_flight', message: 'Complete or cancel planned project generation before deletion.', count: generations });
  return blockers;
}

function projectPlan(database: DatabaseSync, project: string): ProjectDeletionPlan {
  const summary = requireProject(database, project);
  const counts = projectImpactCounts(database, project);
  const blockers = projectBlockers(database, project);
  const planWithoutDigest = {
    schema_version: 'lineage.project_deletion_plan.v1' as const,
    project,
    display_name: summary.display_name,
    catalog_path: summary.catalog_path,
    collection_revision: projectRevision(database),
    state_digest: projectStateDigest(database, project),
    counts,
    blockers,
    preserved: { local_files: true as const, generated_files: true as const, cloud_objects: true as const },
  };
  return { ...planWithoutDigest, digest: digest(planWithoutDigest) };
}

function projectStateDigest(database: DatabaseSync, project: string): string {
  const directTables = [
    'assets',
    'asset_edges',
    'asset_attempts',
    'asset_reroll_requests',
    'asset_social_marks',
    'asset_discussion_marks',
    'asset_selections',
    'asset_layouts',
    'lineage_workspaces',
    'asset_ledger_records',
    'asset_ledger_sources',
    'asset_ledger_placements',
    'asset_ledger_index_runs',
    'content_batches',
    'content_posts',
    'content_post_assets',
    'content_targets',
    'selection_sets',
    'generation_jobs',
    'generation_job_inputs',
    'generation_job_outputs',
    'generation_target_defaults',
    'node_next_output_target_settings',
    'adapter_settings',
    'lineage_tasks',
    'agent_claims',
    'deleted_lineage_workspaces',
    'workspace_collection_state',
  ];
  const direct = Object.fromEntries(directTables.map(table => [
    table,
    database.prepare(`select rowid, * from ${table} where project_id = ? order by rowid`).all(project),
  ]));
  const indirect = {
    project: database.prepare('select rowid, * from projects where id = ?').all(project),
    asset_reviews: database.prepare(`
      select rowid, * from asset_reviews where asset_id in (
        select id from assets where project_id = ?
      ) order by rowid
    `).all(project),
    selection_items: database.prepare(`
      select rowid, * from selection_items where set_id in (
        select id from selection_sets where project_id = ?
      ) order by rowid
    `).all(project),
    generation_job_receipts: database.prepare(`
      select rowid, * from generation_job_receipts where job_id in (
        select id from generation_jobs where project_id = ?
      ) order by rowid
    `).all(project),
    generation_target_maps: database.prepare(`
      select rowid, * from generation_target_maps where job_id in (
        select id from generation_jobs where project_id = ?
      ) order by rowid
    `).all(project),
    generation_target_groups: database.prepare(`
      select rowid, * from generation_target_groups where job_id in (
        select id from generation_jobs where project_id = ?
      ) order by rowid
    `).all(project),
    generation_output_slots: database.prepare(`
      select rowid, * from generation_output_slots where job_id in (
        select id from generation_jobs where project_id = ?
      ) order by rowid
    `).all(project),
    generation_job_target_resolutions: database.prepare(`
      select rowid, * from generation_job_target_resolutions where job_id in (
        select id from generation_jobs where project_id = ?
      ) order by rowid
    `).all(project),
    asset_output_specs: database.prepare(`
      select rowid, * from asset_output_specs
      where generation_job_id in (select id from generation_jobs where project_id = ?)
        or asset_id in (select id from assets where project_id = ?)
      order by rowid
    `).all(project, project),
    lineage_task_events: database.prepare(`
      select rowid, * from lineage_task_events where task_id in (
        select id from lineage_tasks where project_id = ?
      ) order by rowid
    `).all(project),
    agent_claim_events: database.prepare(`
      select rowid, * from agent_claim_events where claim_id in (
        select id from agent_claims where project_id = ?
      ) order by rowid
    `).all(project),
  };
  return digest({ catalog: projectCatalogDeletionState(project), direct, indirect });
}

export function planProjectDeletion(projectInput: string): ProjectDeletionPlan {
  const database = lineageDb();
  try {
    return projectPlan(database, cleanProject(projectInput));
  } finally {
    database.close();
  }
}

function deleteProjectGenerationChildren(database: DatabaseSync, project: string): void {
  database.prepare('delete from asset_output_specs where generation_job_id in (select id from generation_jobs where project_id = ?) or asset_id in (select id from assets where project_id = ?)').run(project, project);
  database.prepare('delete from generation_job_target_resolutions where job_id in (select id from generation_jobs where project_id = ?)').run(project);
  database.prepare('delete from generation_output_slots where job_id in (select id from generation_jobs where project_id = ?)').run(project);
  database.prepare('delete from generation_target_groups where job_id in (select id from generation_jobs where project_id = ?)').run(project);
  database.prepare('delete from generation_target_maps where job_id in (select id from generation_jobs where project_id = ?)').run(project);
  database.prepare('delete from generation_job_receipts where job_id in (select id from generation_jobs where project_id = ?)').run(project);
  database.prepare('delete from generation_job_outputs where project_id = ?').run(project);
  database.prepare('delete from generation_job_inputs where project_id = ?').run(project);
}

function deleteProjectRows(database: DatabaseSync, project: string): void {
  database.prepare('delete from agent_claim_events where claim_id in (select id from agent_claims where project_id = ?)').run(project);
  database.prepare('delete from lineage_task_events where task_id in (select id from lineage_tasks where project_id = ?)').run(project);
  database.prepare('delete from selection_items where set_id in (select id from selection_sets where project_id = ?)').run(project);
  database.prepare('delete from asset_reviews where asset_id in (select id from assets where project_id = ?)').run(project);
  deleteProjectGenerationChildren(database, project);
  for (const table of [
    'content_targets',
    'content_post_assets',
    'content_posts',
    'content_batches',
    'asset_ledger_sources',
    'asset_ledger_placements',
    'asset_ledger_index_runs',
    'asset_ledger_records',
    'generation_target_defaults',
    'node_next_output_target_settings',
    'adapter_settings',
    'agent_claims',
    'lineage_tasks',
    'generation_jobs',
    'selection_sets',
    'asset_social_marks',
    'asset_discussion_marks',
    'asset_reroll_requests',
    'asset_selections',
    'asset_layouts',
    'lineage_workspaces',
    'deleted_lineage_workspaces',
    'workspace_collection_state',
    'asset_attempts',
    'asset_edges',
    'assets',
  ]) {
    database.prepare(`delete from ${table} where project_id = ?`).run(project);
  }
  database.prepare('delete from projects where id = ?').run(project);
}

export function deleteProject(projectInput: string, fields: {
  expectedDigest: string;
  confirmation: string;
  confirmWrite: boolean;
}) {
  const project = cleanProject(projectInput);
  const database = lineageDb();
  let plan: ProjectDeletionPlan;
  try {
    plan = projectPlan(database, project);
    if (!fields.confirmWrite) return { ok: true as const, dryRun: true as const, plan };
    if (fields.confirmation !== plan.display_name && fields.confirmation !== project) {
      throw new ProjectWorkspaceError(`Type ${plan.display_name} or ${project} exactly to delete`, 400, 'confirmation_mismatch');
    }
    transaction(database, () => {
      const current = projectPlan(database, project);
      if (current.digest !== fields.expectedDigest) {
        throw new ProjectWorkspaceError('Project deletion plan changed; review the new impact before deleting', 409, 'stale_deletion_plan');
      }
      if (current.blockers.length) {
        throw new ProjectWorkspaceError(current.blockers[0].message, 409, current.blockers[0].code);
      }
      const timestamp = nowIso();
      database.prepare(`
        insert into project_tombstones (
          project_key, display_name, catalog_path, deleted_at, finalized_at, reason
        ) values (?, ?, ?, ?, null, 'user_deleted')
        on conflict(project_key) do update set
          display_name = excluded.display_name,
          catalog_path = excluded.catalog_path,
          deleted_at = excluded.deleted_at,
          finalized_at = null,
          reason = excluded.reason
      `).run(project, current.display_name, current.catalog_path || null, timestamp);
      if (project === swissifierDemoProject) {
        database.prepare(`
          insert into demo_bootstrap_state (demo_id, suppressed_at, restored_at, updated_at)
          values ('swissifier-rich-demo', ?, null, ?)
          on conflict(demo_id) do update set suppressed_at = excluded.suppressed_at, restored_at = null, updated_at = excluded.updated_at
        `).run(timestamp, timestamp);
      }
      deleteProjectRows(database, project);
      bumpProjectRevision(database);
      const violations = database.prepare('pragma foreign_key_check').all();
      if (violations.length) throw new ProjectWorkspaceError(`Project deletion violated foreign keys: ${JSON.stringify(violations)}`, 409, 'foreign_key_violation');
    });
  } finally {
    database.close();
  }

  let catalog_finalized = false;
  let catalog_error: string | undefined;
  try {
    removeProjectCatalogDefinition(project);
    catalog_finalized = true;
  } catch (error) {
    catalog_error = error instanceof Error ? error.message : String(error);
  }
  const finalizeDatabase = lineageDb();
  try {
    if (catalog_finalized) {
      finalizeDatabase.prepare('update project_tombstones set finalized_at = ? where project_key = ?').run(nowIso(), project);
    }
  } finally {
    finalizeDatabase.close();
  }
  return {
    ok: true as const,
    message: catalog_finalized
      ? `Deleted project ${plan.display_name}; physical media was preserved`
      : `Deleted project ${plan.display_name}; catalog cleanup is pending retry and physical media was preserved`,
    deletion_digest: plan.digest,
    catalog_finalized,
    catalog_error,
    preserved: plan.preserved,
  };
}

function demoBootstrapSuppressedIn(database: DatabaseSync, demoId = 'swissifier-rich-demo'): boolean {
  if (!tableExists(database, 'demo_bootstrap_state')) return false;
  const row = database.prepare(`
    select suppressed_at from demo_bootstrap_state where demo_id = ?
  `).get(demoId) as { suppressed_at?: string | null } | undefined;
  return Boolean(row?.suppressed_at);
}

export function demoBootstrapSuppressed(demoId = 'swissifier-rich-demo'): boolean {
  const database = lineageDb();
  try {
    return demoBootstrapSuppressedIn(database, demoId);
  } finally {
    database.close();
  }
}
