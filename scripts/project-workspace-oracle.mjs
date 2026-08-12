#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = parseArgs(process.argv.slice(2));
const databasePath = required('db');
const expectedProfile = required('expected-profile');
const deletedProject = required('deleted-project');
const survivorProject = required('survivor-project');
const workspaceProject = single('workspace-project');
const deletedWorkspace = single('deleted-workspace');
const removedEdges = values('removed-edge');
const preservedEdges = values('preserved-edge');
const preservedAssets = values('preserved-asset');
const preservedFiles = values('preserved-file').map(path => resolve(path));
const json = Boolean(args.json);
const failures = [];

if (!existsSync(databasePath)) fail(`Database does not exist: ${databasePath}`);

let database;
try {
  database = new DatabaseSync(databasePath, { readOnly: true });
  const identity = database.prepare(`
    select profile_id, environment, profile_fingerprint
    from lineage_profile_identity
  `).all();
  if (identity.length !== 1) fail(`Expected exactly one profile identity row, found ${identity.length}.`);
  const profile = identity[0] || {};
  if (profile.profile_id !== expectedProfile) {
    fail(`Database profile is ${profile.profile_id || 'unbound'}, expected ${expectedProfile}.`);
  }
  if (profile.environment !== 'development') {
    fail(`Oracle refuses ${profile.environment || 'unknown'} databases; use an isolated development profile.`);
  }

  const tableNames = database.prepare(`
    select name from sqlite_schema
    where type = 'table' and name not like 'sqlite_%'
    order by name
  `).all().map(row => String(row.name));
  const projectResidue = [];
  const inventory = [];
  for (const table of tableNames) {
    const columns = database.prepare(`pragma table_info(${quoteIdentifier(table)})`).all().map(row => String(row.name));
    let deletedRows = null;
    if (columns.includes('project_id')) {
      deletedRows = Number(database.prepare(`
        select count(*) count from ${quoteIdentifier(table)} where project_id = ?
      `).get(deletedProject).count);
    } else if (table === 'projects' && columns.includes('id')) {
      deletedRows = Number(database.prepare('select count(*) count from projects where id = ?').get(deletedProject).count);
    }
    inventory.push({ table, columns: columns.length, deleted_project_rows: deletedRows });
    if (deletedRows) projectResidue.push({ table, count: deletedRows });
  }
  if (projectResidue.length) {
    fail(`Deleted project rows remain: ${projectResidue.map(item => `${item.table}=${item.count}`).join(', ')}.`);
  }

  const tombstone = database.prepare(`
    select finalized_at from project_tombstones where project_key = ?
  `).get(deletedProject);
  if (!tombstone) fail(`Missing project tombstone for ${deletedProject}.`);
  else if (!tombstone.finalized_at) fail(`Project tombstone for ${deletedProject} is not finalized.`);

  const survivor = database.prepare('select count(*) count from projects where id = ?').get(survivorProject);
  if (Number(survivor?.count || 0) !== 1) fail(`Survivor project ${survivorProject} is missing.`);

  let workspaceProof = null;
  if (workspaceProject || deletedWorkspace) {
    if (!workspaceProject || !deletedWorkspace) {
      fail('Use --workspace-project and --deleted-workspace together.');
    } else {
      const live = Number(database.prepare(`
        select count(*) count from lineage_workspaces
        where project_id = ? and id = ?
      `).get(workspaceProject, deletedWorkspace).count);
      const deleted = Number(database.prepare(`
        select count(*) count from deleted_lineage_workspaces
        where project_id = ? and workspace_id = ?
      `).get(workspaceProject, deletedWorkspace).count);
      workspaceProof = { project: workspaceProject, workspace: deletedWorkspace, live_rows: live, tombstones: deleted };
      if (live !== 0) fail(`Deleted workspace ${deletedWorkspace} still has ${live} live row(s).`);
      if (deleted !== 1) fail(`Deleted workspace ${deletedWorkspace} has ${deleted} tombstone row(s), expected 1.`);
    }
  }

  const edgeProof = {
    removed: removedEdges.map(id => ({ id, count: rowCount(database, 'asset_edges', id) })),
    preserved: preservedEdges.map(id => ({ id, count: rowCount(database, 'asset_edges', id) })),
  };
  edgeProof.removed.filter(item => item.count !== 0)
    .forEach(item => fail(`Removed edge ${item.id} still has ${item.count} row(s).`));
  edgeProof.preserved.filter(item => item.count !== 1)
    .forEach(item => fail(`Preserved edge ${item.id} has ${item.count} row(s), expected 1.`));

  const assetProof = preservedAssets.map(id => ({ id, count: rowCount(database, 'assets', id) }));
  assetProof.filter(item => item.count !== 1)
    .forEach(item => fail(`Preserved asset ${item.id} has ${item.count} row(s), expected 1.`));

  const fileProof = preservedFiles.map(path => ({ path, exists: existsSync(path) }));
  fileProof.filter(item => !item.exists)
    .forEach(item => fail(`Preserved file is missing: ${item.path}.`));

  const foreignKeyViolations = database.prepare('pragma foreign_key_check').all();
  if (foreignKeyViolations.length) fail(`Foreign-key violations: ${JSON.stringify(foreignKeyViolations)}.`);

  const result = {
    ok: failures.length === 0,
    database: databasePath,
    identity: profile,
    deleted_project: deletedProject,
    survivor_project: survivorProject,
    project_tombstone_finalized: Boolean(tombstone?.finalized_at),
    project_residue: projectResidue,
    workspace: workspaceProof,
    edges: edgeProof,
    assets: assetProof,
    files: fileProof,
    table_inventory: inventory,
    foreign_key_violations: foreignKeyViolations,
    failures,
  };
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (result.ok) {
    process.stdout.write(`Project/workspace oracle passed for ${expectedProfile}: ${inventory.length} tables, zero deleted-project residue, clean foreign keys.\n`);
  } else {
    process.stderr.write(`Project/workspace oracle failed:\n${failures.map(message => `- ${message}`).join('\n')}\n`);
  }
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  database?.close();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=', 2);
    const value = inline ?? (argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true);
    parsed[key] = parsed[key] === undefined ? value : [...(Array.isArray(parsed[key]) ? parsed[key] : [parsed[key]]), value];
  }
  return parsed;
}

function values(key) {
  const value = args[key];
  if (value === undefined || value === true) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

function single(key) {
  return values(key)[0];
}

function required(key) {
  const value = single(key);
  if (!value) {
    process.stderr.write(`Missing required --${key}.\n`);
    process.exit(2);
  }
  return key === 'db' ? resolve(value) : value;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function rowCount(databaseHandle, table, id) {
  return Number(databaseHandle.prepare(`select count(*) count from ${quoteIdentifier(table)} where id = ?`).get(id).count);
}

function fail(message) {
  failures.push(message);
}
