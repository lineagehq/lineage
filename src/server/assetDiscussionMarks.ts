import { accessSync, constants, existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type express from 'express';
import type {
  AssetDiscussionClearResponse,
  AssetDiscussionMark,
  AssetDiscussionMarkListItem,
  AssetDiscussionMarkMutationResponse,
  AssetDiscussionMarksResponse,
} from '../shared/discussionMarkTypes';
import type { LineageNode, LineageSnapshot } from '../shared/types';
import { repoRoot } from './assetCore';
import { getLineageSnapshot, LineageError } from './assetLineage';
import { lineageDb, nowIso } from './assetLineageDb';
import { lineageWorkspaceId } from './assetLineageWorkspaces';
import { requireLineageWorkspaceClaimForWrite } from './lineageClaimGuards';
import { lineageCliCommand, shellQuote } from './lineageRuntimeCommand';

interface DiscussionMarkRow {
  asset_id: string; id: string; marked_at: string; marked_by: string; notes: string | null;
  project_id: string; root_asset_id: string; unmarked_at: string | null; unmarked_by: string | null; updated_at: string; updated_by: string | null;
}

interface MutationFields {
  asset: string;
  claimToken?: string;
  confirmWrite: boolean;
  rootAssetId: string;
}

export interface MarkAssetDiscussionFields extends MutationFields { markedBy: string; notes?: string }
export interface UnmarkAssetDiscussionFields extends MutationFields { unmarkedBy: string }
export interface NoteAssetDiscussionFields extends MutationFields { notes: string; updatedBy: string }
export interface ClearAssetDiscussionFields { claimToken?: string; confirmWrite: boolean; clearedBy: string; rootAssetId: string }

type ProjectFrom = (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string;
type AsyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void) => express.RequestHandler;

function markFromRow(row: DiscussionMarkRow): AssetDiscussionMark {
  return {
    active: row.unmarked_at === null,
    asset_id: row.asset_id,
    id: row.id,
    marked_at: row.marked_at,
    marked_by: row.marked_by,
    notes: row.notes || undefined,
    project_id: row.project_id,
    root_asset_id: row.root_asset_id,
    unmarked_at: row.unmarked_at || undefined,
    unmarked_by: row.unmarked_by || undefined,
    updated_at: row.updated_at,
    updated_by: row.updated_by || undefined,
  };
}

function canonicalSnapshot(project: string, rootAssetId: string): LineageSnapshot {
  const snapshot = getLineageSnapshot(project, rootAssetId);
  if (snapshot.root_asset_id !== rootAssetId) throw new LineageError(`Asset ${rootAssetId} is not a canonical lineage canvas root`, 400);
  return snapshot;
}

function visibleNode(snapshot: LineageSnapshot, asset: string): LineageNode {
  const exact = snapshot.nodes.find(node => node.asset_id === asset);
  if (exact) return exact;
  const title = asset.trim().toLocaleLowerCase();
  const matches = snapshot.nodes.filter(node => node.title.trim().toLocaleLowerCase() === title);
  if (matches.length > 1) throw new LineageError(`Asset title "${asset}" matches multiple visible nodes; use an exact asset ID.`, 409);
  if (matches.length === 1) return matches[0];
  throw new LineageError(`Asset ${asset} is not visible in lineage canvas ${snapshot.root_asset_id}`, 404);
}

function actor(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new LineageError(`Discussion mark ${field} is required`);
  return normalized;
}

function rootChannel(snapshot: LineageSnapshot): string | undefined {
  return snapshot.nodes.find(node => node.asset_id === snapshot.root_asset_id)?.channel;
}

function guard(snapshot: LineageSnapshot, project: string, fields: { claimToken?: string; confirmWrite: boolean; rootAssetId: string }, writeKind: string): void {
  requireLineageWorkspaceClaimForWrite({
    channel: rootChannel(snapshot), claimToken: fields.claimToken, confirmWrite: fields.confirmWrite,
    project, rootAssetId: fields.rootAssetId, writeKind,
  });
}

function activeRow(project: string, rootAssetId: string, assetId: string): DiscussionMarkRow | undefined {
  const database = lineageDb();
  try {
    return database.prepare(`select * from asset_discussion_marks where project_id = ? and root_asset_id = ? and asset_id = ? and unmarked_at is null`)
      .get(project, rootAssetId, assetId) as DiscussionMarkRow | undefined;
  } finally { database.close(); }
}

function response(project: string, rootAssetId: string, active: boolean, operation: AssetDiscussionMarkMutationResponse['operation'], mark?: AssetDiscussionMark, dryRun?: true): AssetDiscussionMarkMutationResponse {
  return { active, ...(dryRun ? { dryRun } : {}), ...(mark ? { mark } : {}), ok: true, operation, snapshot: getLineageSnapshot(project, rootAssetId) };
}

export function markAssetDiscussion(project: string, fields: MarkAssetDiscussionFields): AssetDiscussionMarkMutationResponse {
  const snapshot = canonicalSnapshot(project, fields.rootAssetId);
  const node = visibleNode(snapshot, fields.asset);
  const markedBy = actor(fields.markedBy, 'markedBy');
  guard(snapshot, project, fields, 'discussion_mark');
  const existing = activeRow(project, fields.rootAssetId, node.asset_id);
  if (existing) return response(project, fields.rootAssetId, true, 'mark', markFromRow(existing), fields.confirmWrite ? undefined : true);
  const timestamp = nowIso();
  const preview: AssetDiscussionMark = {
    active: true, asset_id: node.asset_id, id: `${project}:${fields.rootAssetId}:discussion:${node.asset_id}`,
    marked_at: timestamp, marked_by: markedBy, notes: fields.notes?.trim() || undefined,
    project_id: project, root_asset_id: fields.rootAssetId, updated_at: timestamp,
  };
  if (!fields.confirmWrite) return response(project, fields.rootAssetId, true, 'mark', preview, true);
  const database = lineageDb();
  try {
    database.prepare(`
      insert into asset_discussion_marks (id, project_id, root_asset_id, asset_id, notes, marked_by, marked_at, unmarked_by, unmarked_at, updated_at, updated_by)
      values (?, ?, ?, ?, ?, ?, ?, null, null, ?, null)
      on conflict(project_id, root_asset_id, asset_id) do update set
        notes = excluded.notes, marked_by = excluded.marked_by, marked_at = excluded.marked_at,
        unmarked_by = null, unmarked_at = null, updated_at = excluded.updated_at, updated_by = null
    `).run(preview.id, project, fields.rootAssetId, node.asset_id, preview.notes || null, markedBy, timestamp, timestamp);
  } finally { database.close(); }
  return response(project, fields.rootAssetId, true, 'mark', markFromRow(activeRow(project, fields.rootAssetId, node.asset_id)!));
}

export function noteAssetDiscussion(project: string, fields: NoteAssetDiscussionFields): AssetDiscussionMarkMutationResponse {
  const snapshot = canonicalSnapshot(project, fields.rootAssetId);
  const node = visibleNode(snapshot, fields.asset);
  const updatedBy = actor(fields.updatedBy, 'updatedBy');
  guard(snapshot, project, fields, 'discussion_note');
  const existing = activeRow(project, fields.rootAssetId, node.asset_id);
  if (!existing) throw new LineageError(`Asset ${node.asset_id} is not marked for discussion`, 404);
  const timestamp = nowIso();
  const preview = markFromRow({ ...existing, notes: fields.notes?.trim() || null, updated_at: timestamp, updated_by: updatedBy });
  if (!fields.confirmWrite) return response(project, fields.rootAssetId, true, 'note', preview, true);
  const database = lineageDb();
  try {
    database.prepare(`update asset_discussion_marks set notes = ?, updated_at = ?, updated_by = ? where project_id = ? and root_asset_id = ? and asset_id = ? and unmarked_at is null`)
      .run(preview.notes || null, timestamp, updatedBy, project, fields.rootAssetId, node.asset_id);
  } finally { database.close(); }
  return response(project, fields.rootAssetId, true, 'note', markFromRow(activeRow(project, fields.rootAssetId, node.asset_id)!));
}

export function unmarkAssetDiscussion(project: string, fields: UnmarkAssetDiscussionFields): AssetDiscussionMarkMutationResponse {
  const snapshot = canonicalSnapshot(project, fields.rootAssetId);
  const node = visibleNode(snapshot, fields.asset);
  const unmarkedBy = actor(fields.unmarkedBy, 'unmarkedBy');
  guard(snapshot, project, fields, 'discussion_unmark');
  const existing = activeRow(project, fields.rootAssetId, node.asset_id);
  if (!existing) return response(project, fields.rootAssetId, false, 'unmark', undefined, fields.confirmWrite ? undefined : true);
  const timestamp = nowIso();
  const preview = markFromRow({ ...existing, unmarked_at: timestamp, unmarked_by: unmarkedBy, updated_at: timestamp });
  if (!fields.confirmWrite) return response(project, fields.rootAssetId, false, 'unmark', preview, true);
  const database = lineageDb();
  try {
    database.prepare(`update asset_discussion_marks set unmarked_by = ?, unmarked_at = ?, updated_at = ? where project_id = ? and root_asset_id = ? and asset_id = ? and unmarked_at is null`)
      .run(unmarkedBy, timestamp, timestamp, project, fields.rootAssetId, node.asset_id);
  } finally { database.close(); }
  return response(project, fields.rootAssetId, false, 'unmark', preview);
}

export function clearAssetDiscussionMarks(project: string, fields: ClearAssetDiscussionFields): AssetDiscussionClearResponse {
  const snapshot = canonicalSnapshot(project, fields.rootAssetId);
  const clearedBy = actor(fields.clearedBy, 'clearedBy');
  guard(snapshot, project, fields, 'discussion_clear');
  const database = lineageDb();
  try {
    const count = Number((database.prepare(`select count(*) count from asset_discussion_marks where project_id = ? and root_asset_id = ? and unmarked_at is null`).get(project, fields.rootAssetId) as { count: number }).count);
    if (!fields.confirmWrite) return { cleared_count: count, dryRun: true, ok: true, snapshot };
    const timestamp = nowIso();
    database.prepare(`update asset_discussion_marks set unmarked_by = ?, unmarked_at = ?, updated_at = ? where project_id = ? and root_asset_id = ? and unmarked_at is null`)
      .run(clearedBy, timestamp, timestamp, project, fields.rootAssetId);
    return { cleared_count: count, ok: true, snapshot: getLineageSnapshot(project, fields.rootAssetId) };
  } finally { database.close(); }
}

function absoluteLocalPath(reference?: string): string | undefined {
  if (!reference) return undefined;
  if (isAbsolute(reference)) return reference;
  const repoRelative = resolve(repoRoot, reference);
  return existsSync(repoRelative) || reference === '.asset-scratch' || reference.startsWith('.asset-scratch/')
    ? repoRelative : resolve(repoRoot, '.asset-scratch', reference);
}

function readable(path: string): boolean {
  try { accessSync(path, constants.R_OK); return true; } catch { return false; }
}

function listItem(project: string, rootAssetId: string, node: LineageNode, row: DiscussionMarkRow): AssetDiscussionMarkListItem {
  const relativePath = node.current_attempt?.file_path || node.local_path;
  const absolutePath = absoluteLocalPath(relativePath);
  const exists = absolutePath ? existsSync(absolutePath) : false;
  const warnings: string[] = [];
  if (absolutePath && !exists) warnings.push(`Asset ${node.asset_id} local file is missing: ${absolutePath}`);
  if (absolutePath && exists && !readable(absolutePath)) warnings.push(`Asset ${node.asset_id} local file is unreadable: ${absolutePath}. Check file permissions before handoff.`);
  if (!absolutePath && node.s3_key) warnings.push(`Asset ${node.asset_id} is only available in non-local storage; create a readable local copy before handoff.`);
  if (!absolutePath && !node.s3_key) warnings.push(`Asset ${node.asset_id} has no local file or storage key.`);
  const base = `--project ${shellQuote(project)} --root ${shellQuote(rootAssetId)} --asset ${shellQuote(node.asset_id)}`;
  return {
    ...markFromRow(row), checksum_sha256: node.current_attempt?.checksum_sha256 || node.checksum_sha256,
    commands: {
      mark: lineageCliCommand(`discuss mark ${base} --confirm-write`),
      note: lineageCliCommand(`discuss note ${base} --notes <text> --confirm-write`),
      unmark: lineageCliCommand(`discuss unmark ${base} --confirm-write`),
    },
    current_attempt: node.current_attempt, local: { absolute_path: absolutePath, exists, relative_path: relativePath },
    media_type: node.media_type, s3: node.s3_key ? { key: node.s3_key } : undefined,
    source: node.source, title: node.title, warnings,
  };
}

export function listAssetDiscussionMarks(project: string, rootAssetId: string): AssetDiscussionMarksResponse {
  const snapshot = canonicalSnapshot(project, rootAssetId);
  const database = lineageDb();
  let rows: DiscussionMarkRow[] = [];
  try {
    const available = database.prepare("select 1 from sqlite_master where type = 'table' and name = 'asset_discussion_marks'").get() !== undefined;
    if (available) rows = database.prepare(`select * from asset_discussion_marks where project_id = ? and root_asset_id = ? and unmarked_at is null order by marked_at, asset_id`).all(project, rootAssetId) as unknown as DiscussionMarkRow[];
  } finally { database.close(); }
  const nodes = new Map(snapshot.nodes.map(node => [node.asset_id, node]));
  const base = `--project ${shellQuote(project)} --root ${shellQuote(rootAssetId)}`;
  return {
    commands: {
      clear: lineageCliCommand(`discuss clear ${base} --confirm-write`),
      mark: lineageCliCommand(`discuss mark ${base} --asset <asset-id> --confirm-write`),
    },
    fetchedAt: nowIso(), marks: rows.flatMap(row => nodes.has(row.asset_id) ? [listItem(project, rootAssetId, nodes.get(row.asset_id)!, row)] : []),
    project, root_asset_id: rootAssetId, schema_version: 'lineage.discussion_marks.v1',
    workspace: { id: lineageWorkspaceId(project, rootAssetId), root_asset_id: rootAssetId },
  };
}

function bodyString(req: express.Request, key: string): string | undefined {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value : undefined;
}

function claimToken(req: express.Request): string | undefined {
  return req.header('X-Lineage-Claim-Token') || bodyString(req, 'claimToken');
}

export function registerAssetDiscussionMarkRoutes(app: express.Express, projectFrom: ProjectFrom, asyncRoute: AsyncRoute): void {
  app.get('/api/lineage/:rootAssetId/discussion-marks', asyncRoute((req, res) => {
    res.json(listAssetDiscussionMarks(projectFrom({ query: req.query }), req.params.rootAssetId));
  }));
  app.post('/api/lineage/:rootAssetId/discussion-marks/actions/clear', asyncRoute((req, res) => {
    res.json(clearAssetDiscussionMarks(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      claimToken: claimToken(req), clearedBy: bodyString(req, 'clearedBy') || bodyString(req, 'actor') || 'human',
      confirmWrite: req.body?.confirmWrite === true, rootAssetId: req.params.rootAssetId,
    }));
  }));
  app.post('/api/lineage/:rootAssetId/discussion-marks/:assetId', asyncRoute((req, res) => {
    res.json(markAssetDiscussion(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      asset: req.params.assetId, claimToken: claimToken(req), confirmWrite: req.body?.confirmWrite === true,
      markedBy: bodyString(req, 'markedBy') || bodyString(req, 'actor') || 'human', notes: bodyString(req, 'notes'), rootAssetId: req.params.rootAssetId,
    }));
  }));
  app.post('/api/lineage/:rootAssetId/discussion-marks/:assetId/note', asyncRoute((req, res) => {
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'notes') || typeof req.body?.notes !== 'string') {
      throw new LineageError('Discussion note requires a string notes field; send an empty string to clear it.');
    }
    res.json(noteAssetDiscussion(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      asset: req.params.assetId, claimToken: claimToken(req), confirmWrite: req.body?.confirmWrite === true,
      notes: req.body.notes, rootAssetId: req.params.rootAssetId, updatedBy: bodyString(req, 'updatedBy') || bodyString(req, 'actor') || 'human',
    }));
  }));
  app.post('/api/lineage/:rootAssetId/discussion-marks/:assetId/unmark', asyncRoute((req, res) => {
    res.json(unmarkAssetDiscussion(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      asset: req.params.assetId, claimToken: claimToken(req), confirmWrite: req.body?.confirmWrite === true,
      rootAssetId: req.params.rootAssetId, unmarkedBy: bodyString(req, 'unmarkedBy') || bodyString(req, 'actor') || 'human',
    }));
  }));
}
