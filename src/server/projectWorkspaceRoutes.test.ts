import express from 'express';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProduct, repoRoot, setLineageAssetRoot } from './assetCore';
import { lineageDb } from './assetLineageDb';
import { seedSwissifierRichDemoWorkspace } from './assetLineageDemo';
import { archiveLineageWorkspace } from './assetLineageWorkspaces';
import { projectLifecycleGate, registerProjectWorkspaceRoutes } from './projectWorkspaceRoutes';
import { isProjectWorkspaceError } from './projectWorkspaces';
import { useLineageTestProfile } from '../test/lineageTestProfile';

const originalAssetRoot = repoRoot;
const scratchRoot = join(originalAssetRoot, '.asset-scratch', 'vitest-project-workspace-routes');
const assetRoot = join(scratchRoot, 'media');
const databasePath = join(assetRoot, '.asset-scratch', 'routes.sqlite');
let server: Server | undefined;
let origin = '';

beforeEach(async () => {
  rmSync(scratchRoot, { force: true, recursive: true });
  mkdirSync(assetRoot, { recursive: true });
  setLineageAssetRoot(assetRoot);
  useLineageTestProfile(databasePath);
  const app = express();
  app.use(express.json());
  const asyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void): express.RequestHandler =>
    (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); };
  registerProjectWorkspaceRoutes(app, asyncRoute);
  app.use('/api', projectLifecycleGate(input => {
    const candidate = input.body?.project || input.body?.product || input.query?.project || input.query?.product;
    return typeof candidate === 'string' ? candidate : defaultProduct;
  }));
  app.post('/api/assets/archive', (_req, res) => {
    res.json({ ok: true, mutation: 'would-have-run' });
  });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isProjectWorkspaceError(error)) {
      res.status(error.status).json({ error: error.code, message: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  });
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP address');
      origin = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  setLineageAssetRoot(originalAssetRoot);
  rmSync(scratchRoot, { force: true, recursive: true });
});

async function request(path: string, init?: RequestInit) {
  return fetch(`${origin}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
}

describe('project/workspace organization routes', () => {
  it('creates and lists a paginated project through the public API', async () => {
    const created = await request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        id: 'route-project',
        displayName: 'Route Project',
        confirmWrite: true,
      }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      project: { id: 'route-project', display_name: 'Route Project' },
    });

    const listed = await request('/api/projects?page=1&pageSize=1&sort=manual');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      pagination: { page: 1, pageSize: 1 },
      manual_revision: expect.any(Number),
      projects: expect.any(Array),
    });

    const detail = await request('/api/projects/route-project');
    expect(await detail.json()).toMatchObject({ project: { id: 'route-project' } });
    const workspaces = await request('/api/projects/route-project/workspaces?collection=open');
    expect(await workspaces.json()).toMatchObject({
      collection: 'open',
      project: { id: 'route-project' },
      workspaces: [],
    });
  });

  it('rejects missing or nonnumeric reorder targets instead of moving an item to the beginning', async () => {
    await request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ id: 'route-reorder', displayName: 'Route Reorder', confirmWrite: true }),
    });
    const projects = await (await request('/api/projects?pageSize=100')).json() as { manual_revision: number };
    for (const path of ['/api/projects/reorder', '/api/projects/route-reorder/workspaces/reorder']) {
      for (const targetIndex of ['not-a-number', null]) {
        const response = await request(path, {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'route-reorder',
            targetIndex,
            expectedRevision: projects.manual_revision,
            confirmWrite: true,
          }),
        });
        expect(response.status, `${path} ${String(targetIndex)}`).toBe(400);
        expect(await response.json()).toMatchObject({ error: 'invalid_target_index' });
      }
    }
  });

  it('keeps project collection, detail, workspace collection, and deletion-plan GETs read-only', async () => {
    const created = await request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        id: 'route-read-only',
        displayName: 'Route Read Only',
        confirmWrite: true,
      }),
    });
    expect(created.status).toBe(200);
    const before = sha256(databasePath);
    process.env.LINEAGE_DB_ACCESS = 'read-only';
    try {
      for (const path of [
        '/api/projects?pageSize=100',
        '/api/projects/route-read-only',
        '/api/projects/route-read-only/workspaces',
        '/api/projects/route-read-only/deletion-plan',
      ]) {
        const response = await request(path);
        expect(response.status, path).toBe(200);
      }
    } finally {
      delete process.env.LINEAGE_DB_ACCESS;
    }
    expect(sha256(databasePath)).toBe(before);
  });

  it('binds project deletion to a fresh plan and exact typed confirmation', async () => {
    await request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        id: 'route-delete',
        displayName: 'Route Delete',
        confirmWrite: true,
      }),
    });
    const planned = await request('/api/projects/route-delete/deletion-plan');
    const plannedBody = await planned.json() as { plan: { digest: string } };
    expect(plannedBody.plan.digest).toMatch(/^[a-f0-9]{64}$/);

    const rejected = await request('/api/projects/route-delete/delete', {
      method: 'POST',
      body: JSON.stringify({
        expectedDigest: plannedBody.plan.digest,
        confirmation: 'wrong',
        confirmWrite: true,
      }),
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: 'confirmation_mismatch' });

    const deleted = await request('/api/projects/route-delete/delete', {
      method: 'POST',
      body: JSON.stringify({
        expectedDigest: plannedBody.plan.digest,
        confirmation: 'Route Delete',
        confirmWrite: true,
      }),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      catalog_finalized: true,
      preserved: { local_files: true, generated_files: true, cloud_objects: true },
    });
    expect((await request('/api/projects/route-delete')).status).toBe(404);
    const staleCatalogMutation = await request('/api/assets/archive', {
      method: 'POST',
      body: JSON.stringify({ project: 'route-delete', assetId: 'stale-asset' }),
    });
    expect(staleCatalogMutation.status).toBe(410);
    expect(await staleCatalogMutation.json()).toMatchObject({ error: 'project_deleted' });
  });

  it('opens Swissifier directly even when its workspace sorts beyond the first 100 entries', async () => {
    const restored = await request('/api/projects/demo/swissifier/restore', {
      method: 'POST',
      body: JSON.stringify({ confirmWrite: true }),
    });
    expect(restored.status).toBe(200);
    const restoredBody = await restored.json() as {
      project: { id: string };
      workspace: { id: string; root_asset_id: string };
    };
    const database = lineageDb();
    const assetColumns = (database.prepare('pragma table_info(assets)').all() as Array<{ name: string }>)
      .map(column => column.name);
    const quotedColumns = assetColumns.map(column => `"${column.replaceAll('"', '""')}"`);
    const cloneAsset = database.prepare(`
      insert into assets (${quotedColumns.join(', ')})
      select ${assetColumns.map(column => {
        if (column === 'id') return '?';
        if (column === 'title') return '?';
        return `"${column.replaceAll('"', '""')}"`;
      }).join(', ')}
      from assets where project_id = ? and id = ?
    `);
    const insertWorkspace = database.prepare(`
      insert into lineage_workspaces (
        id, project_id, root_asset_id, title, status, created_by,
        active_at, created_at, updated_at, sort_position, collection_kind, revision
      ) values (?, ?, ?, ?, 'paused', 'system', null, ?, ?, ?, 'open', 1)
    `);
    const timestamp = '2026-07-29T12:00:00.000Z';
    database.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < 101; index += 1) {
        const root = `swissifier-filler-${String(index).padStart(3, '0')}`;
        cloneAsset.run(root, `Filler ${index}`, restoredBody.project.id, restoredBody.workspace.root_asset_id);
        insertWorkspace.run(
          `${restoredBody.project.id}:lineage-workspace:${root}`,
          restoredBody.project.id,
          root,
          `Filler ${index}`,
          timestamp,
          timestamp,
          index,
        );
      }
      database.prepare('update lineage_workspaces set sort_position = 1000 where id = ?')
        .run(restoredBody.workspace.id);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    } finally {
      database.close();
    }

    const entry = await request('/api/projects/demo/swissifier/entry');
    expect(entry.status).toBe(200);
    expect(await entry.json()).toMatchObject({
      project: { id: restoredBody.project.id },
      workspace: { id: restoredBody.workspace.id },
    });
  });

  it('routes an archived Swissifier workspace through the project restoration flow', async () => {
    const restored = await request('/api/projects/demo/swissifier/restore', {
      method: 'POST',
      body: JSON.stringify({ confirmWrite: true }),
    });
    expect(restored.status).toBe(200);
    const restoredBody = await restored.json() as { project: { id: string }; workspace: { id: string } };
    archiveLineageWorkspace(restoredBody.project.id, restoredBody.workspace.id, true);

    const entry = await request('/api/projects/demo/swissifier/entry');
    expect(entry.status).toBe(404);
    expect(await entry.json()).toMatchObject({ code: 'demo_suppressed' });
  });

  it('opens the canonical aliased Swissifier workspace after migrating an existing demo graph', async () => {
    const legacy = seedSwissifierRichDemoWorkspace('demo-project', { confirmWrite: true });
    const restored = await request('/api/projects/demo/swissifier/restore', {
      method: 'POST',
      body: JSON.stringify({ confirmWrite: true }),
    });
    expect(restored.status, await restored.clone().text()).toBe(200);
    const restoredBody = await restored.json() as { workspace: { id: string; root_asset_id: string } };
    expect(restoredBody.workspace.root_asset_id).not.toBe(legacy.root_asset_id);

    const entry = await request('/api/projects/demo/swissifier/entry');
    expect(entry.status).toBe(200);
    expect(await entry.json()).toMatchObject({
      workspace: {
        id: restoredBody.workspace.id,
        root_asset_id: restoredBody.workspace.root_asset_id,
      },
    });
  });

  it('runs a read-only dynamic postcondition inventory for an isolated development profile', () => {
    const fixture = createOracleFixture('oracle-clean');
    fixture.database.close();
    const before = sha256(fixture.path);

    const result = runOracle(fixture, ['--preserved-file', fixture.preservedFile]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      identity: { profile_id: 'oracle-development', environment: 'development' },
      deleted_project: 'deleted-project',
      survivor_project: 'survivor-project',
      project_tombstone_finalized: true,
      project_residue: [],
      workspace: { live_rows: 0, tombstones: 1 },
      edges: {
        removed: [{ id: 'removed-edge', count: 0 }],
        preserved: [{ id: 'survivor-edge', count: 1 }],
      },
      assets: [{ id: 'shared-asset', count: 1 }],
      foreign_key_violations: [],
    });
    expect(sha256(fixture.path)).toBe(before);
  });

  it('makes the postcondition oracle fail closed on dynamic residue and production identity', () => {
    const residue = createOracleFixture('oracle-residue');
    residue.database.prepare("insert into custom_project_rows values ('deleted-project', 'residue')").run();
    residue.database.close();
    const residueResult = runOracle(residue);
    expect(residueResult.status).toBe(1);
    expect(JSON.parse(residueResult.stdout)).toMatchObject({
      ok: false,
      project_residue: [{ table: 'custom_project_rows', count: 1 }],
    });

    const production = createOracleFixture('oracle-production', 'production');
    production.database.close();
    const productionResult = runOracle(production);
    expect(productionResult.status).toBe(1);
    expect(JSON.parse(productionResult.stdout).failures).toContain(
      'Oracle refuses production databases; use an isolated development profile.'
    );
  });
});

function createOracleFixture(name: string, environment = 'development') {
  const root = join(scratchRoot, name);
  mkdirSync(root, { recursive: true });
  const path = join(root, 'lineage.sqlite');
  const preservedFile = join(root, 'preserved.png');
  writeFileSync(preservedFile, 'preserved');
  const database = new DatabaseSync(path);
  database.exec(`
    pragma foreign_keys = on;
    create table lineage_profile_identity (
      profile_id text primary key,
      environment text not null,
      profile_fingerprint text not null
    );
    create table projects (id text primary key);
    create table project_tombstones (
      project_key text primary key,
      finalized_at text
    );
    create table lineage_workspaces (
      id text primary key,
      project_id text not null references projects(id)
    );
    create table deleted_lineage_workspaces (
      project_id text not null references projects(id),
      workspace_id text not null
    );
    create table assets (
      id text primary key,
      project_id text not null references projects(id)
    );
    create table asset_edges (
      id text primary key,
      project_id text not null references projects(id)
    );
    create table custom_project_rows (
      project_id text not null,
      value text
    );
  `);
  database.prepare('insert into lineage_profile_identity values (?, ?, ?)').run('oracle-development', environment, 'fixture-fingerprint');
  database.prepare("insert into projects values ('survivor-project')").run();
  database.prepare("insert into project_tombstones values ('deleted-project', '2026-07-29T12:00:00.000Z')").run();
  database.prepare("insert into lineage_workspaces values ('survivor-workspace', 'survivor-project')").run();
  database.prepare("insert into deleted_lineage_workspaces values ('survivor-project', 'deleted-workspace')").run();
  database.prepare("insert into assets values ('shared-asset', 'survivor-project')").run();
  database.prepare("insert into asset_edges values ('survivor-edge', 'survivor-project')").run();
  return { database, path, preservedFile };
}

function runOracle(
  fixture: ReturnType<typeof createOracleFixture>,
  extra: string[] = []
) {
  return spawnSync(process.execPath, [
    'scripts/project-workspace-oracle.mjs',
    '--db', fixture.path,
    '--expected-profile', 'oracle-development',
    '--deleted-project', 'deleted-project',
    '--survivor-project', 'survivor-project',
    '--workspace-project', 'survivor-project',
    '--deleted-workspace', 'deleted-workspace',
    '--removed-edge', 'removed-edge',
    '--preserved-edge', 'survivor-edge',
    '--preserved-asset', 'shared-asset',
    '--json',
    ...extra,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function sha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
