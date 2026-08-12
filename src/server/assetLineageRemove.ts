import { lineageDb as db, nowIso, type DatabaseSync } from './assetLineageDb';
import { selectedRows, selectionId } from './assetLineageSelection';
import { cancelLineageIterateTasksForAssets } from './assetLineageTasks';
import { assertWorkspaceRootAcceptsWrites, getLineageSnapshot, LineageError } from './assetLineage';
import { requireLineageWorkspaceClaimForWrite } from './lineageClaimGuards';
import type { LineageRemoveNodeFields, LineageRemoveNodeResponse } from '../shared/types';

function requireAsset(database: DatabaseSync, project: string, assetId: string): void {
  const row = database.prepare('select id from assets where project_id = ? and id = ?').get(project, assetId);
  if (!row) throw new LineageError(`Unknown indexed asset: ${assetId}`, 404);
}

function assetChannel(database: DatabaseSync, project: string, assetId: string): string | undefined {
  const row = database.prepare('select channel from assets where project_id = ? and id = ?').get(project, assetId) as { channel?: string } | undefined;
  return row?.channel;
}

function parentOf(database: DatabaseSync, project: string, assetId: string): string | undefined {
  const row = database.prepare('select parent_asset_id from asset_edges where project_id = ? and child_asset_id = ? order by created_at limit 1').get(project, assetId) as { parent_asset_id?: string } | undefined;
  return row?.parent_asset_id;
}

function rootFor(database: DatabaseSync, project: string, assetId: string): string {
  let root = assetId;
  const seen = new Set<string>();
  while (!seen.has(root)) {
    seen.add(root);
    const parent = parentOf(database, project, root);
    if (!parent) return root;
    root = parent;
  }
  return assetId;
}

function edgeId(project: string, parent: string, child: string): string {
  return `${project}:${parent}:derived_from:${child}`;
}

function compactSelectionsAfterRemove(database: DatabaseSync, project: string, root: string, assetId: string, timestamp: string): boolean {
  const current = selectedRows(database, project, root);
  const next = current.filter(row => row.asset_id !== assetId);
  if (next.length === current.length) return false;
  database.prepare('delete from asset_selections where project_id = ? and root_asset_id = ?').run(project, root);
  const insert = database.prepare(`
    insert into asset_selections (id, project_id, root_asset_id, asset_id, position, notes, selected_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `);
  next.forEach((row, position) => {
    insert.run(selectionId(project, root, row.asset_id), project, root, row.asset_id, position, row.notes || null, timestamp);
  });
  return true;
}

export function removeLineageNode(project: string, fields: LineageRemoveNodeFields): LineageRemoveNodeResponse {
  const database = db();
  requireAsset(database, project, fields.assetId);
  const root = fields.rootAssetId || rootFor(database, project, fields.assetId);
  requireAsset(database, project, root);
  assertWorkspaceRootAcceptsWrites(database, project, root);
  if (fields.assetId === root) {
    database.close();
    throw new LineageError('Cannot remove the root lineage node; archive the workspace or create a new root instead.');
  }
  const snapshot = getLineageSnapshot(project, root);
  if (!snapshot.nodes.some(node => node.asset_id === fields.assetId)) {
    database.close();
    throw new LineageError(`Asset ${fields.assetId} is not in lineage rooted at ${root}`, 404);
  }
  try {
    requireLineageWorkspaceClaimForWrite({
      channel: assetChannel(database, project, root),
      claimToken: fields.claimToken,
      confirmWrite: fields.confirmWrite,
      project,
      rootAssetId: root,
      writeKind: 'lineage_remove_node',
    });
  } catch (error) {
    database.close();
    throw error;
  }
  const parentEdges = snapshot.edges.filter(edge => edge.child_asset_id === fields.assetId);
  const childEdges = snapshot.edges.filter(edge => edge.parent_asset_id === fields.assetId);
  const removedIds = [...parentEdges, ...childEdges].map(edge => edge.id);
  const timestamp = nowIso();
  const reparentedEdges = parentEdges.flatMap(parentEdge => childEdges
    .filter(childEdge => parentEdge.parent_asset_id !== childEdge.child_asset_id)
    .map(childEdge => ({
      id: edgeId(project, parentEdge.parent_asset_id, childEdge.child_asset_id),
      parent_asset_id: parentEdge.parent_asset_id,
      child_asset_id: childEdge.child_asset_id,
      relation_type: 'derived_from' as const,
      created_at: timestamp,
    })));
  const selectionRemoved = selectedRows(database, project, root).some(row => row.asset_id === fields.assetId);
  if (!fields.confirmWrite) {
    database.close();
    return {
      ok: true, dryRun: true, asset_id: fields.assetId, root_asset_id: root,
      removed_edge_ids: removedIds, reparented_edges: reparentedEdges, selection_removed: selectionRemoved, asset_preserved: true,
    };
  }
  if (selectionRemoved) {
    try {
      cancelLineageIterateTasksForAssets(project, {
        actor: 'human',
        assetIds: [fields.assetId],
        confirmWrite: true,
        rootAssetId: root,
      });
    } catch (error) {
      database.close();
      throw error;
    }
  }
  try {
    database.exec('begin immediate transaction');
    const deleteEdge = database.prepare('delete from asset_edges where id = ? and project_id = ?');
    for (const edgeIdToRemove of removedIds) deleteEdge.run(edgeIdToRemove, project);
    const insertEdge = database.prepare(`
      insert into asset_edges (id, project_id, parent_asset_id, child_asset_id, relation_type, created_at)
      values (?, ?, ?, ?, 'derived_from', ?)
      on conflict(project_id, parent_asset_id, child_asset_id, relation_type) do nothing
    `);
    for (const edge of reparentedEdges) insertEdge.run(edge.id, project, edge.parent_asset_id, edge.child_asset_id, edge.created_at);
    database.prepare('delete from asset_layouts where project_id = ? and root_asset_id = ? and asset_id = ?').run(project, root, fields.assetId);
    database.prepare(`
      update asset_social_marks
      set unmarked_by = 'lineage:remove-node', unmarked_at = ?, updated_at = ?
      where project_id = ? and root_asset_id = ? and asset_id = ? and unmarked_at is null
    `).run(timestamp, timestamp, project, root, fields.assetId);
    database.prepare(`
      update asset_discussion_marks
      set unmarked_by = 'lineage:remove-node', unmarked_at = ?, updated_at = ?
      where project_id = ? and root_asset_id = ? and asset_id = ? and unmarked_at is null
    `).run(timestamp, timestamp, project, root, fields.assetId);
    compactSelectionsAfterRemove(database, project, root, fields.assetId, timestamp);
    database.exec('commit');
  } catch (error) {
    database.exec('rollback');
    database.close();
    throw error;
  }
  database.close();
  return {
    ok: true, message: `Removed ${fields.assetId} from lineage ${root}`, asset_id: fields.assetId, root_asset_id: root,
    removed_edge_ids: removedIds, reparented_edges: reparentedEdges, selection_removed: selectionRemoved, asset_preserved: true,
  };
}
