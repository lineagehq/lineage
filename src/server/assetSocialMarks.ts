import { accessSync, constants, existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type express from 'express';
import type {
  AssetSocialMark,
  AssetSocialMarkListItem,
  AssetSocialMarkMutationResponse,
  AssetSocialMarksResponse,
} from '../shared/socialMarkTypes';
import { SOCIAL_MARK_NOTES_MAX_CODE_POINTS } from '../shared/socialMarkTypes';
import type { LineageNode, LineageSnapshot } from '../shared/types';
import { repoRoot } from './assetCore';
import { getLineageSnapshot, LineageError } from './assetLineage';
import { lineageDb, nowIso } from './assetLineageDb';
import { lineageWorkspaceId } from './assetLineageWorkspaces';
import { requireLineageWorkspaceClaimForWrite } from './lineageClaimGuards';
import { lineageCliCommand, shellQuote } from './lineageRuntimeCommand';

interface SocialMarkMutationFields {
  asset: string;
  claimToken?: string;
  confirmWrite: boolean;
  rootAssetId: string;
}

interface SocialMarkRow {
  asset_id: string;
  id: string;
  marked_at: string;
  marked_by: string;
  notes: string | null;
  project_id: string;
  root_asset_id: string;
  unmarked_at: string | null;
  unmarked_by: string | null;
  updated_at: string;
}

export interface MarkAssetSocialFields extends SocialMarkMutationFields {
  markedBy: string;
  notes?: string;
}

export interface UnmarkAssetSocialFields extends SocialMarkMutationFields {
  unmarkedBy: string;
}

type ProjectFrom = (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string;
type AsyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void) => express.RequestHandler;

function markFromRow(row: SocialMarkRow): AssetSocialMark {
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
  };
}

function requireCanonicalSnapshot(project: string, rootAssetId: string): LineageSnapshot {
  const snapshot = getLineageSnapshot(project, rootAssetId);
  if (snapshot.root_asset_id !== rootAssetId) {
    throw new LineageError(`Asset ${rootAssetId} is not a canonical lineage canvas root`, 400);
  }
  return snapshot;
}

function resolveVisibleNode(snapshot: LineageSnapshot, asset: string): LineageNode {
  const exactId = snapshot.nodes.find(node => node.asset_id === asset);
  if (exactId) return exactId;
  const title = asset.trim().toLocaleLowerCase();
  const matches = snapshot.nodes.filter(node => node.title.trim().toLocaleLowerCase() === title);
  if (matches.length > 1) throw new LineageError(`Asset title "${asset}" matches multiple visible nodes; use an exact asset ID.`, 409);
  if (matches.length === 1) return matches[0];
  throw new LineageError(`Asset ${asset} is not visible in lineage canvas ${snapshot.root_asset_id}`, 404);
}

function rootChannel(snapshot: LineageSnapshot): string | undefined {
  return snapshot.nodes.find(node => node.asset_id === snapshot.root_asset_id)?.channel;
}

function requireActor(actor: string, field: 'markedBy' | 'unmarkedBy'): string {
  const normalized = actor.trim();
  if (!normalized) throw new LineageError(`Social mark ${field} is required`);
  return normalized;
}

function normalizeNotes(notes?: string): string | undefined {
  if (notes === undefined) return undefined;
  const trimmed = notes.trim();
  if ([...trimmed].length > SOCIAL_MARK_NOTES_MAX_CODE_POINTS) {
    throw new LineageError(`Social mark notes must be at most ${SOCIAL_MARK_NOTES_MAX_CODE_POINTS} Unicode code points after trimming`);
  }
  return trimmed || undefined;
}

function socialMarkId(project: string, rootAssetId: string, assetId: string): string {
  return `${project}:${rootAssetId}:social:${assetId}`;
}

function activeRow(project: string, rootAssetId: string, assetId: string): SocialMarkRow | undefined {
  const database = lineageDb();
  try {
    return database.prepare(`
      select * from asset_social_marks
      where project_id = ? and root_asset_id = ? and asset_id = ? and unmarked_at is null
    `).get(project, rootAssetId, assetId) as SocialMarkRow | undefined;
  } finally {
    database.close();
  }
}

function mutationResponse(project: string, rootAssetId: string, active: boolean, mark?: AssetSocialMark, dryRun?: true): AssetSocialMarkMutationResponse {
  return {
    active,
    ...(dryRun ? { dryRun } : {}),
    ...(mark ? { mark } : {}),
    ok: true,
    snapshot: getLineageSnapshot(project, rootAssetId),
  };
}

export function markAssetSocial(project: string, fields: MarkAssetSocialFields): AssetSocialMarkMutationResponse {
  const snapshot = requireCanonicalSnapshot(project, fields.rootAssetId);
  const node = resolveVisibleNode(snapshot, fields.asset);
  const markedBy = requireActor(fields.markedBy, 'markedBy');
  const notes = normalizeNotes(fields.notes);
  requireLineageWorkspaceClaimForWrite({
    channel: rootChannel(snapshot),
    claimToken: fields.claimToken,
    confirmWrite: fields.confirmWrite,
    project,
    rootAssetId: fields.rootAssetId,
    writeKind: 'social_mark',
  });
  const existing = activeRow(project, fields.rootAssetId, node.asset_id);
  if (existing) return mutationResponse(project, fields.rootAssetId, true, markFromRow(existing), fields.confirmWrite ? undefined : true);
  const timestamp = nowIso();
  const preview: AssetSocialMark = {
    active: true,
    asset_id: node.asset_id,
    id: socialMarkId(project, fields.rootAssetId, node.asset_id),
    marked_at: timestamp,
    marked_by: markedBy,
    notes,
    project_id: project,
    root_asset_id: fields.rootAssetId,
    updated_at: timestamp,
  };
  if (!fields.confirmWrite) return mutationResponse(project, fields.rootAssetId, true, preview, true);
  const database = lineageDb();
  try {
    database.prepare(`
      insert into asset_social_marks (
        id, project_id, root_asset_id, asset_id, notes, marked_by, marked_at,
        unmarked_by, unmarked_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, null, null, ?)
      on conflict(project_id, root_asset_id, asset_id) do update set
        notes = excluded.notes,
        marked_by = excluded.marked_by,
        marked_at = excluded.marked_at,
        unmarked_by = null,
        unmarked_at = null,
        updated_at = excluded.updated_at
    `).run(
      preview.id,
      project,
      fields.rootAssetId,
      node.asset_id,
      preview.notes || null,
      markedBy,
      timestamp,
      timestamp,
    );
  } finally {
    database.close();
  }
  return mutationResponse(project, fields.rootAssetId, true, markFromRow(activeRow(project, fields.rootAssetId, node.asset_id)!));
}

export function unmarkAssetSocial(project: string, fields: UnmarkAssetSocialFields): AssetSocialMarkMutationResponse {
  const snapshot = requireCanonicalSnapshot(project, fields.rootAssetId);
  const node = resolveVisibleNode(snapshot, fields.asset);
  const unmarkedBy = requireActor(fields.unmarkedBy, 'unmarkedBy');
  requireLineageWorkspaceClaimForWrite({
    channel: rootChannel(snapshot),
    claimToken: fields.claimToken,
    confirmWrite: fields.confirmWrite,
    project,
    rootAssetId: fields.rootAssetId,
    writeKind: 'social_unmark',
  });
  const existing = activeRow(project, fields.rootAssetId, node.asset_id);
  if (!existing) return mutationResponse(project, fields.rootAssetId, false, undefined, fields.confirmWrite ? undefined : true);
  const timestamp = nowIso();
  const preview = markFromRow({
    ...existing,
    unmarked_at: timestamp,
    unmarked_by: unmarkedBy,
    updated_at: timestamp,
  });
  if (!fields.confirmWrite) return mutationResponse(project, fields.rootAssetId, false, preview, true);
  const database = lineageDb();
  try {
    database.prepare(`
      update asset_social_marks
      set unmarked_by = ?, unmarked_at = ?, updated_at = ?
      where project_id = ? and root_asset_id = ? and asset_id = ? and unmarked_at is null
    `).run(unmarkedBy, timestamp, timestamp, project, fields.rootAssetId, node.asset_id);
  } finally {
    database.close();
  }
  return mutationResponse(project, fields.rootAssetId, false, preview);
}

function absoluteLocalPath(reference?: string): string | undefined {
  if (!reference) return undefined;
  if (isAbsolute(reference)) return reference;
  const repoRelative = resolve(repoRoot, reference);
  return existsSync(repoRelative) || reference === '.asset-scratch' || reference.startsWith('.asset-scratch/')
    ? repoRelative
    : resolve(repoRoot, '.asset-scratch', reference);
}

function isReadable(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function listItem(project: string, rootAssetId: string, node: LineageNode, row: SocialMarkRow): AssetSocialMarkListItem {
  const relativePath = node.current_attempt?.file_path || node.local_path;
  const absolutePath = absoluteLocalPath(relativePath);
  const exists = absolutePath ? existsSync(absolutePath) : false;
  const warnings: string[] = [];
  if (absolutePath && !exists) warnings.push(`Asset ${node.asset_id} local file is missing: ${absolutePath}`);
  if (absolutePath && exists && !isReadable(absolutePath)) {
    warnings.push(`Asset ${node.asset_id} local file is unreadable: ${absolutePath}. Check file permissions before handoff.`);
  }
  if (!absolutePath && node.s3_key) {
    warnings.push(`Asset ${node.asset_id} is only available in non-local storage; create a readable local copy before handoff.`);
  }
  if (!absolutePath && !node.s3_key) warnings.push(`Asset ${node.asset_id} has no local file or storage key.`);
  const base = `--project ${shellQuote(project)} --root ${shellQuote(rootAssetId)} --asset ${shellQuote(node.asset_id)}`;
  return {
    ...markFromRow(row),
    checksum_sha256: node.current_attempt?.checksum_sha256 || node.checksum_sha256,
    commands: {
      mark: lineageCliCommand(`social mark ${base} --confirm-write`),
      unmark: lineageCliCommand(`social unmark ${base} --confirm-write`),
    },
    current_attempt: node.current_attempt,
    local: {
      absolute_path: absolutePath,
      exists,
      relative_path: relativePath,
    },
    media_type: node.media_type,
    s3: node.s3_key ? { key: node.s3_key } : undefined,
    source: node.source,
    title: node.title,
    warnings,
  };
}

export function listAssetSocialMarks(project: string, rootAssetId: string): AssetSocialMarksResponse {
  const snapshot = requireCanonicalSnapshot(project, rootAssetId);
  const database = lineageDb();
  let rows: SocialMarkRow[];
  try {
    const hasSocialMarks = database.prepare("select 1 from sqlite_master where type = 'table' and name = 'asset_social_marks'").get() !== undefined;
    rows = hasSocialMarks
      ? database.prepare(`
        select * from asset_social_marks
        where project_id = ? and root_asset_id = ? and unmarked_at is null
        order by marked_at, asset_id
      `).all(project, rootAssetId) as unknown as SocialMarkRow[]
      : [];
  } finally {
    database.close();
  }
  const nodesById = new Map(snapshot.nodes.map(node => [node.asset_id, node]));
  return {
    commands: {
      mark: lineageCliCommand(`social mark --project ${shellQuote(project)} --root ${shellQuote(rootAssetId)} --asset <asset-id> --confirm-write`),
    },
    fetchedAt: nowIso(),
    marks: rows.flatMap(row => {
      const node = nodesById.get(row.asset_id);
      return node ? [listItem(project, rootAssetId, node, row)] : [];
    }),
    project,
    root_asset_id: rootAssetId,
    schema_version: 'lineage.social_marks.v1',
    workspace: {
      id: lineageWorkspaceId(project, rootAssetId),
      root_asset_id: rootAssetId,
    },
  };
}

function bodyString(req: express.Request, key: string): string | undefined {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value : undefined;
}

function requestClaimToken(req: express.Request): string | undefined {
  return req.header('X-Lineage-Claim-Token') || bodyString(req, 'claimToken');
}

export function registerAssetSocialMarkRoutes(app: express.Express, projectFrom: ProjectFrom, asyncRoute: AsyncRoute): void {
  app.get('/api/lineage/:rootAssetId/social-marks', asyncRoute((req, res) => {
    res.json(listAssetSocialMarks(
      projectFrom({ query: req.query }),
      req.params.rootAssetId,
    ));
  }));
  app.post('/api/lineage/:rootAssetId/social-marks/:assetId', asyncRoute((req, res) => {
    res.json(markAssetSocial(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      asset: req.params.assetId,
      claimToken: requestClaimToken(req),
      confirmWrite: req.body?.confirmWrite === true,
      markedBy: bodyString(req, 'markedBy') || bodyString(req, 'actor') || 'human',
      notes: bodyString(req, 'notes'),
      rootAssetId: req.params.rootAssetId,
    }));
  }));
  app.post('/api/lineage/:rootAssetId/social-marks/:assetId/unmark', asyncRoute((req, res) => {
    res.json(unmarkAssetSocial(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      asset: req.params.assetId,
      claimToken: requestClaimToken(req),
      confirmWrite: req.body?.confirmWrite === true,
      rootAssetId: req.params.rootAssetId,
      unmarkedBy: bodyString(req, 'unmarkedBy') || bodyString(req, 'actor') || 'human',
    }));
  }));
}
