import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { defaultProject, repoRoot } from '../assetCore';
import { indexLineageAssets } from '../assetLineage';
import { lineageDb } from '../assetLineageDb';
import { fileSha256 } from '../localReview';
import * as bufferPostingAdapter from '../adapters/posting/bufferPostingAdapter';
import * as bufferPostingService from '../adapters/posting/bufferPostingService';
import { listAssetSocialMarks, markAssetSocial, unmarkAssetSocial } from './socialMarks';

const canonicalScratch = join(repoRoot, '.asset-scratch', 'vitest-canonical-social-marks');

afterEach(() => {
  rmSync(canonicalScratch, { force: true, recursive: true });
  vi.restoreAllMocks();
});

describe('canonical Social-mark domain boundary', () => {
  it('exposes only the canvas-local list, mark, and unmark operations', () => {
    expect(listAssetSocialMarks).toBeTypeOf('function');
    expect(markAssetSocial).toBeTypeOf('function');
    expect(unmarkAssetSocial).toBeTypeOf('function');
  });

  it('returns schema-versioned canonical mutations backed by authoritative snapshots', () => {
    rmSync(canonicalScratch, { force: true, recursive: true });
    mkdirSync(canonicalScratch, { recursive: true });
    const file = join(canonicalScratch, 'canonical-social-root.png');
    writeFileSync(file, Buffer.from('canonical-social-root'));
    useLineageTestProfile(join(canonicalScratch, 'lineage.sqlite'));
    indexLineageAssets(defaultProject);
    const assetId = `local-${fileSha256(file).slice(0, 12)}`;

    const marked = markAssetSocial(defaultProject, {
      asset: assetId,
      confirmWrite: true,
      markedBy: 'human:test',
      rootAssetId: assetId,
    });
    expect(marked).toMatchObject({
      active: true,
      schema_version: 'lineage.social_mark_mutation.v1',
      snapshot: {
        nodes: expect.arrayContaining([
          expect.objectContaining({ asset_id: assetId, social_mark: expect.objectContaining({ active: true }) }),
        ]),
      },
    });
    expect(listAssetSocialMarks(defaultProject, assetId).marks).toHaveLength(1);

    const unmarked = unmarkAssetSocial(defaultProject, {
      asset: assetId,
      confirmWrite: true,
      rootAssetId: assetId,
      unmarkedBy: 'human:test',
    });
    expect(unmarked).toMatchObject({ active: false, schema_version: 'lineage.social_mark_mutation.v1' });
    expect(unmarked.snapshot.nodes[0].social_mark).toBeUndefined();
  });

  it('captures zero Buffer calls and leaves every downstream record set unchanged', () => {
    rmSync(canonicalScratch, { force: true, recursive: true });
    mkdirSync(canonicalScratch, { recursive: true });
    const file = join(canonicalScratch, 'boundary-social-root.png');
    writeFileSync(file, Buffer.from('boundary-social-root'));
    useLineageTestProfile(join(canonicalScratch, 'lineage.sqlite'));
    indexLineageAssets(defaultProject);
    const assetId = `local-${fileSha256(file).slice(0, 12)}`;
    const dryRunBuffer = vi.spyOn(bufferPostingService, 'dryRunBufferContentPost');
    const createBufferAdapter = vi.spyOn(bufferPostingAdapter, 'createBufferPostingAdapter');
    const buildBufferPayload = vi.spyOn(bufferPostingAdapter, 'buildBufferPostPayload');
    const database = lineageDb();
    const downstreamState = () => ({
      contentPosts: Number((database.prepare('select count(*) count from content_posts').get() as { count: number }).count),
      lineageTasks: Number((database.prepare('select count(*) count from lineage_tasks').get() as { count: number }).count),
      socialWorkItems: Number((database.prepare('select count(*) count from social_work_items').get() as { count: number }).count),
    });
    try {
      const before = downstreamState();
      markAssetSocial(defaultProject, { asset: assetId, confirmWrite: true, markedBy: 'human:test', rootAssetId: assetId });
      unmarkAssetSocial(defaultProject, { asset: assetId, confirmWrite: true, rootAssetId: assetId, unmarkedBy: 'human:test' });

      expect(dryRunBuffer).not.toHaveBeenCalled();
      expect(createBufferAdapter).not.toHaveBeenCalled();
      expect(buildBufferPayload).not.toHaveBeenCalled();
      expect(downstreamState()).toEqual(before);
      expect(before.socialWorkItems).toBe(0);
    } finally {
      database.close();
    }
  });
});
