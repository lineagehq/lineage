import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { createAgentClaim } from '../agentClaims';
import * as assetCore from '../assetCore';
import { defaultProject, repoRoot } from '../assetCore';
import { indexLineageAssets } from '../assetLineage';
import { lineageDb, nowIso } from '../assetLineageDb';
import { lineageWorkspaceId } from '../assetLineageWorkspaces';
import * as bufferRuntime from '../adapters/buffer/bufferRuntime';
import { BUFFER_CAPABILITY_REGISTRY_VERSION, bufferChannelCapability } from '../adapters/buffer/bufferCapabilities';
import * as bufferPostingAdapter from '../adapters/posting/bufferPostingAdapter';
import * as bufferPostingService from '../adapters/posting/bufferPostingService';
import { fileSha256 } from '../localReview';
import { markAssetSocial } from './socialMarks';
import { addSocialVariant, createSocialWorkItem, editSocialVariant, getSocialWorkItem } from './socialWorkItems';
import { validateSocialWorkItem } from './socialValidation';

const scratch = join(repoRoot, '.asset-scratch', 'vitest-social-release-one');
function writeSyntheticImage(path: string): void {
  const sharpPath = createRequire(import.meta.url).resolve('sharp');
  const result = spawnSync(process.execPath, ['-e', `const sharp=require(process.argv[1]);sharp({create:{width:1080,height:1080,channels:3,background:'#446688'}}).png().toFile(process.argv[2]).catch(()=>process.exit(1))`, sharpPath, path]);
  if (result.status !== 0) throw new Error('Unable to create synthetic image');
}

afterEach(() => { vi.restoreAllMocks(); rmSync(scratch, { force: true, recursive: true }); });

describe('Social Release 1 persistence and claim integration', () => {
  it('carries a canvas mark through claimed immutable composition while preserving tenancy and zero Buffer mutation', () => {
    mkdirSync(scratch, { recursive: true });
    const media = join(scratch, 'synthetic-release-one-image.png');
    writeSyntheticImage(media);
    useLineageTestProfile(join(scratch, 'lineage.sqlite'));
    indexLineageAssets(defaultProject);
    const assetId = `local-${fileSha256(media).slice(0, 12)}`;
    const channelId = 'synthetic-release-one-channel';
    const providerFingerprint = 'synthetic-release-one-provider-fingerprint';
    const runtime = vi.spyOn(bufferRuntime, 'createBufferReadRuntime');
    const postingService = vi.spyOn(bufferPostingService, 'dryRunBufferContentPost');
    const postingAdapter = vi.spyOn(bufferPostingAdapter, 'createBufferPostingAdapter');
    const postingPayload = vi.spyOn(bufferPostingAdapter, 'buildBufferPostPayload');
    const upload = vi.spyOn(assetCore, 'uploadAsset');
    const presign = vi.spyOn(assetCore, 'presignAsset');

    const marked = markAssetSocial(defaultProject, { asset: assetId, rootAssetId: assetId, markedBy: 'human:release-one', confirmWrite: true });
    expect(marked.snapshot.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ asset_id: assetId, social_mark: expect.objectContaining({ active: true }) })]));
    const claim = createAgentClaim({ agentName: 'Synthetic Release One Editor', project: defaultProject, scopeType: 'lineage_workspace', targetId: lineageWorkspaceId(defaultProject, assetId) });
    const otherClaim = createAgentClaim({ agentName: 'Synthetic Other Tenant Editor', project: 'synthetic-other-project', scopeType: 'lineage_workspace', targetId: lineageWorkspaceId('synthetic-other-project', assetId) });
    expect(() => createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, campaignKey: 'synthetic-campaign', claimToken: otherClaim.claim_token, confirmWrite: true })).toThrow('does not match demo-project');

    const database = lineageDb();
    try {
      const timestamp = nowIso();
      database.prepare(`insert into buffer_channels (project_id, channel_id, organization_id, service, service_id, display_name, avatar_ref, timezone, posting_schedule_json, allowed_actions_json, capability_json, disconnected, locked, paused, available, capability_registry_version, provider_fingerprint, synced_at, stale_at)
        values (?, ?, 'synthetic-release-one-organization', 'instagram', null, 'Synthetic Canvas Channel', null, 'America/Phoenix', ?, '["read"]', ?, 0, 0, 0, 1, ?, ?, ?, null)`)
        .run(defaultProject, channelId, JSON.stringify({ slots: ['09:00'] }), JSON.stringify(bufferChannelCapability('instagram')), BUFFER_CAPABILITY_REGISTRY_VERSION, providerFingerprint, timestamp);
    } finally { database.close(); }

    const created = createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, campaignKey: 'synthetic-campaign', actor: 'human:release-one', claimToken: claim.claim_token, confirmWrite: true });
    const reopened = createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, campaignKey: ' synthetic-campaign ', claimToken: claim.claim_token, confirmWrite: true });
    expect(reopened).toMatchObject({ idempotent: true, item: { id: created.item.id } });
    const added = addSocialVariant(defaultProject, { itemId: created.item.id, channelId, claimToken: claim.claim_token, confirmWrite: true });
    const variant = added.item.variants[0];
    const edited = editSocialVariant(defaultProject, {
      variantId: variant.id,
      expectedRevision: 1,
      copy: 'Synthetic Release One caption',
      hashtags: ['proof', 'local-only'],
      altText: 'Synthetic geometric placeholder',
      altTextReviewed: true,
      altTextReviewedBy: 'human:release-one',
      publishMethod: 'notification',
      compositionMode: 'addToQueue',
      editorialState: 'ready',
      claimToken: claim.claim_token,
      confirmWrite: true,
    });
    expect(edited.item.variants[0]).toMatchObject({ current_revision: 2, revision: { copy: 'Synthetic Release One caption', composition_mode: 'addToQueue' } });
    expect(validateSocialWorkItem(defaultProject, created.item.id)).toMatchObject({ valid: true, scheduled: false, issues: [] });
    expect(getSocialWorkItem(defaultProject, created.item.id).item.variants[0].current_revision).toBe(2);
    expect(() => getSocialWorkItem('synthetic-other-project', created.item.id)).toThrow('synthetic-other-project');
    const persisted = lineageDb();
    try {
      expect(persisted.prepare('select revision, copy from social_variant_revisions where variant_id=? order by revision').all(variant.id)).toEqual([
        expect.objectContaining({ revision: 1, copy: '' }),
        expect.objectContaining({ revision: 2, copy: 'Synthetic Release One caption' }),
      ]);
    } finally { persisted.close(); }

    expect(runtime).not.toHaveBeenCalled();
    expect(postingService).not.toHaveBeenCalled();
    expect(postingAdapter).not.toHaveBeenCalled();
    expect(postingPayload).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(presign).not.toHaveBeenCalled();
  });
});
