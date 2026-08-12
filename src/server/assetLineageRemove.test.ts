import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { getLineageSnapshot, indexLineageAssets, linkLineageAssets, updateLineageLayout, updateSelectedAsset } from './assetLineage';
import { lineageDb } from './assetLineageDb';
import { removeLineageNode } from './assetLineageRemove';
import { listAssetSocialMarks, markAssetSocial } from './assetSocialMarks';
import { listAssetDiscussionMarks, markAssetDiscussion } from './assetDiscussionMarks';
import { createAgentClaim } from './agentClaims';
import { lineageWorkspaceId } from './assetLineageWorkspaces';
import { fileSha256 } from './localReview';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-lineage-remove');
const dbFile = join(scratchDir, 'asset-lineage.sqlite');

function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedFiles() {
  mkdirSync(scratchDir, { recursive: true });
  const parent = join(scratchDir, 'demo-lineage-remove-parent.png');
  const child = join(scratchDir, 'demo-lineage-remove-child.png');
  const variation = join(scratchDir, 'demo-lineage-remove-variation.png');
  const alternate = join(scratchDir, 'demo-lineage-remove-alternate.png');
  writeFileSync(parent, Buffer.from('lineage-remove-parent'));
  writeFileSync(child, Buffer.from('lineage-remove-child'));
  writeFileSync(variation, Buffer.from('lineage-remove-variation'));
  writeFileSync(alternate, Buffer.from('lineage-remove-alternate'));
  return {
    alternateId: localId(alternate), childId: localId(child),
    parentId: localId(parent), variationId: localId(variation),
  };
}

describe('lineage node removal', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    useLineageTestProfile(dbFile);
  });

  it('blocks removing the root lineage node', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    expect(() => removeLineageNode(defaultProject, {
      assetId: files.parentId,
      confirmWrite: true,
      rootAssetId: files.parentId,
    })).toThrow('Cannot remove the root lineage node');
  });

  it('removes a leaf from lineage while preserving the indexed asset row', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, { childAssetId: files.childId, confirmWrite: true, parentAssetId: files.parentId });
    updateSelectedAsset(defaultProject, { assetId: files.childId, confirmWrite: true, rootAssetId: files.parentId });
    updateLineageLayout(defaultProject, {
      confirmWrite: true,
      rootAssetId: files.parentId,
      positions: [{ assetId: files.childId, x: 320, y: 180 }],
    });

    const dryRun = removeLineageNode(defaultProject, {
      assetId: files.childId,
      confirmWrite: false,
      rootAssetId: files.parentId,
    });
    expect(dryRun).toMatchObject({
      asset_id: files.childId,
      asset_preserved: true,
      dryRun: true,
      removed_edge_ids: [`${defaultProject}:${files.parentId}:derived_from:${files.childId}`],
      selection_removed: true,
    });

    const result = removeLineageNode(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      rootAssetId: files.parentId,
    });

    expect(result).toMatchObject({ asset_preserved: true, selection_removed: true });
    expect(getLineageSnapshot(defaultProject, files.parentId).nodes.map(node => node.asset_id)).toEqual([files.parentId]);
    const database = lineageDb();
    const assetRow = database.prepare('select id from assets where id = ?').get(files.childId);
    const layoutRow = database.prepare('select id from asset_layouts where root_asset_id = ? and asset_id = ?').get(files.parentId, files.childId);
    database.close();
    expect(assetRow).toMatchObject({ id: files.childId });
    expect(layoutRow).toBeUndefined();
  });

  it('deactivates a social mark when removing its node so relinking does not resurrect it', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, { childAssetId: files.childId, confirmWrite: true, parentAssetId: files.parentId });
    markAssetSocial(defaultProject, {
      asset: files.childId,
      confirmWrite: true,
      markedBy: 'human:owner',
      rootAssetId: files.parentId,
    });

    removeLineageNode(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      rootAssetId: files.parentId,
    });
    linkLineageAssets(defaultProject, { childAssetId: files.childId, confirmWrite: true, parentAssetId: files.parentId });

    expect(listAssetSocialMarks(defaultProject, files.parentId).marks).toEqual([]);
    const database = lineageDb();
    try {
      expect(database.prepare(`
        select unmarked_by, unmarked_at
        from asset_social_marks
        where project_id = ? and root_asset_id = ? and asset_id = ?
      `).get(defaultProject, files.parentId, files.childId)).toMatchObject({
        unmarked_by: 'lineage:remove-node',
        unmarked_at: expect.any(String),
      });
    } finally {
      database.close();
    }
  });

  it('deactivates a Discussion mark when removing its node so relinking does not resurrect it', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, { childAssetId: files.childId, confirmWrite: true, parentAssetId: files.parentId });
    markAssetDiscussion(defaultProject, { asset: files.childId, confirmWrite: true, markedBy: 'human:owner', rootAssetId: files.parentId });
    removeLineageNode(defaultProject, { assetId: files.childId, confirmWrite: true, rootAssetId: files.parentId });
    linkLineageAssets(defaultProject, { childAssetId: files.childId, confirmWrite: true, parentAssetId: files.parentId });
    expect(listAssetDiscussionMarks(defaultProject, files.parentId).marks).toEqual([]);
    const database = lineageDb();
    try {
      expect(database.prepare(`select unmarked_by, unmarked_at from asset_discussion_marks where project_id = ? and root_asset_id = ? and asset_id = ?`).get(defaultProject, files.parentId, files.childId)).toMatchObject({
        unmarked_by: 'lineage:remove-node', unmarked_at: expect.any(String),
      });
    } finally { database.close(); }
  });

  it('requires a matching active claim for confirmed node removal on a claimed workspace', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, { childAssetId: files.childId, confirmWrite: true, parentAssetId: files.parentId });
    const claim = createAgentClaim({
      agentName: 'Lineage removal agent',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(defaultProject, files.parentId),
    });
    const wrongClaim = createAgentClaim({
      agentName: 'Wrong removal agent',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(defaultProject, files.variationId),
    });

    const dryRun = removeLineageNode(defaultProject, {
      assetId: files.childId,
      confirmWrite: false,
      rootAssetId: files.parentId,
    });
    expect(dryRun).toMatchObject({ dryRun: true });
    expect(() => removeLineageNode(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      rootAssetId: files.parentId,
    })).toThrow('Mutating agent write requires a matching claim token.');
    expect(() => removeLineageNode(defaultProject, {
      assetId: files.childId,
      claimToken: wrongClaim.claim_token,
      confirmWrite: true,
      rootAssetId: files.parentId,
    })).toThrow('Claim does not cover lineage_workspace');

    const result = removeLineageNode(defaultProject, {
      assetId: files.childId,
      claimToken: claim.claim_token,
      confirmWrite: true,
      rootAssetId: files.parentId,
    });

    expect(result).toMatchObject({ asset_id: files.childId, asset_preserved: true });
    expect(getLineageSnapshot(defaultProject, files.parentId).nodes.map(node => node.asset_id)).toEqual([files.parentId]);
  });

  it('reparents a removed non-leaf node children to its parent and compacts selections', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, { childAssetId: files.childId, confirmWrite: true, parentAssetId: files.parentId });
    linkLineageAssets(defaultProject, { childAssetId: files.variationId, confirmWrite: true, parentAssetId: files.childId });
    linkLineageAssets(defaultProject, { childAssetId: files.alternateId, confirmWrite: true, parentAssetId: files.childId });
    updateSelectedAsset(defaultProject, {
      assetIds: [files.childId, files.variationId],
      confirmWrite: true,
      mode: 'replace',
      rootAssetId: files.parentId,
    });

    const result = removeLineageNode(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      rootAssetId: files.parentId,
    });
    const snapshot = getLineageSnapshot(defaultProject, files.parentId);

    expect(result.removed_edge_ids).toEqual(expect.arrayContaining([
      `${defaultProject}:${files.parentId}:derived_from:${files.childId}`,
      `${defaultProject}:${files.childId}:derived_from:${files.variationId}`,
      `${defaultProject}:${files.childId}:derived_from:${files.alternateId}`,
    ]));
    expect(result.reparented_edges.map(edge => [edge.parent_asset_id, edge.child_asset_id])).toEqual([
      [files.parentId, files.variationId],
      [files.parentId, files.alternateId],
    ]);
    expect(snapshot.nodes.map(node => node.asset_id).sort()).toEqual([files.alternateId, files.parentId, files.variationId].sort());
    expect(snapshot.edges.map(edge => [edge.parent_asset_id, edge.child_asset_id]).sort()).toEqual([
      [files.parentId, files.alternateId],
      [files.parentId, files.variationId],
    ].sort());
    expect(snapshot.selected).toEqual([files.variationId]);
    expect(snapshot.selections).toMatchObject([{ asset_id: files.variationId, position: 0 }]);
  });
});
