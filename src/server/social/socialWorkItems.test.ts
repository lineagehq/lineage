import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { createAgentClaim } from '../agentClaims';
import { defaultProject, repoRoot } from '../assetCore';
import * as assetCore from '../assetCore';
import { indexLineageAssets } from '../assetLineage';
import { lineageDb, nowIso } from '../assetLineageDb';
import { lineageWorkspaceId } from '../assetLineageWorkspaces';
import { fileSha256 } from '../localReview';
import * as bufferRuntime from '../adapters/buffer/bufferRuntime';
import { markAssetSocial } from './socialMarks';
import { addSocialVariant, archiveSocialWorkItem, createSocialWorkItem, editSocialVariant, getSocialWorkItem, removeSocialVariant } from './socialWorkItems';
import { validateSocialWorkItem } from './socialValidation';

const scratch = join(repoRoot, '.asset-scratch', 'vitest-social-work-items');
let assetId = '';

function seedChannel(channelId = 'channel-instagram', fingerprint = 'fingerprint-v1'): void {
  const database = lineageDb(); const timestamp = nowIso();
  try {
    database.prepare(`insert into buffer_channels (project_id, channel_id, organization_id, service, service_id, display_name, avatar_ref, timezone, posting_schedule_json, allowed_actions_json, capability_json, disconnected, locked, paused, available, capability_registry_version, provider_fingerprint, synced_at, stale_at)
      values (?, ?, 'org-safe', 'instagram', null, 'Instagram safe', null, 'America/Phoenix', '{}', '[]', ?, 0, 0, 0, 1, 1, ?, ?, null)`)
      .run(defaultProject, channelId, JSON.stringify({ automatic: true, image_post: true, notification: true, scheduling_modes: ['customScheduled', 'addToQueue'], supported: true, reason: null }), fingerprint, timestamp);
  } finally { database.close(); }
}

beforeEach(() => {
  rmSync(scratch, { recursive: true, force: true }); mkdirSync(scratch, { recursive: true });
  const file = join(scratch, 'root.png'); writeFileSync(file, Buffer.from('social-work-item-root'));
  useLineageTestProfile(join(scratch, 'lineage.sqlite')); indexLineageAssets(defaultProject);
  assetId = `local-${fileSha256(file).slice(0, 12)}`;
  markAssetSocial(defaultProject, { asset: assetId, confirmWrite: true, markedBy: 'human:test', rootAssetId: assetId });
  seedChannel();
});

afterEach(() => { vi.restoreAllMocks(); rmSync(scratch, { recursive: true, force: true }); });

function claimToken(): string {
  return createAgentClaim({ agentName: 'Social editor', project: defaultProject, scopeType: 'lineage_workspace', targetId: lineageWorkspaceId(defaultProject, assetId) }).claim_token;
}

describe('Social Work Item composition aggregate', () => {
  it('promotes explicitly and idempotently by project, canvas, source, and normalized campaign key', () => {
    const token = claimToken();
    expect(() => createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, confirmWrite: true }))
      .toThrow('claim');
    const first = createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, confirmWrite: true, claimToken: token, actor: 'human:test' });
    const reopened = createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, campaignKey: ' default ', confirmWrite: true, claimToken: token });
    const campaign = createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, campaignKey: 'launch-b', confirmWrite: true, claimToken: token });
    expect(first.item).toMatchObject({ project_id: defaultProject, root_asset_id: assetId, source_asset_id: assetId, campaign_key: 'default', editorial_state: 'active' });
    expect(reopened).toMatchObject({ idempotent: true, item: { id: first.item.id } });
    expect(campaign.item.id).not.toBe(first.item.id);
    expect(() => getSocialWorkItem('isolated-project', first.item.id)).toThrow('isolated-project');
    const database = lineageDb(); const timestamp = nowIso();
    try {
      database.prepare(`insert into content_batches (id, project_id, title, campaign, channel, status, notes, created_at, updated_at) values ('social-batch', ?, 'Social batch', null, null, 'active', null, ?, ?)`)
        .run(defaultProject, timestamp, timestamp);
      database.prepare(`insert into content_posts (id, project_id, batch_id, channel, title, phase, created_at, updated_at) values ('social-post', ?, 'social-batch', 'social', 'Social post', 'draft', ?, ?)`)
        .run(defaultProject, timestamp, timestamp);
      database.prepare(`insert into content_posts (id, project_id, batch_id, channel, title, phase, created_at, updated_at) values ('different-post', ?, 'social-batch', 'social', 'Different post', 'draft', ?, ?)`)
        .run(defaultProject, timestamp, timestamp);
    } finally { database.close(); }
    const linked = createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, campaignKey: 'linked', contentPostId: 'social-post', confirmWrite: true, claimToken: token });
    expect(linked.item.content_post_id).toBe('social-post');
    expect(() => createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, campaignKey: 'linked', contentPostId: 'different-post', confirmWrite: true, claimToken: token })).toThrow('different content-post link');
    expect(() => createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, campaignKey: 'missing-post', contentPostId: 'missing', confirmWrite: true, claimToken: token })).toThrow('was not found');
  });

  it('keeps one active channel variant, appends immutable revisions, and archives without erasing history', () => {
    const token = claimToken();
    const item = createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, confirmWrite: true, claimToken: token }).item;
    expect(() => addSocialVariant(defaultProject, { itemId: item.id, channelId: 'channel-instagram', confirmWrite: true })).toThrow('claim');
    const added = addSocialVariant(defaultProject, { itemId: item.id, channelId: 'channel-instagram', confirmWrite: true, claimToken: token });
    const variant = added.item.variants[0];
    expect(variant.revision).toMatchObject({ revision: 1, hashtags: [], publish_method: 'automatic' });
    expect(() => editSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 1, copy: 'unclaimed', confirmWrite: true })).toThrow('claim');
    expect(() => editSocialVariant(defaultProject, { variantId: variant.id, copy: 'missing concurrency', confirmWrite: true, claimToken: token } as unknown as Parameters<typeof editSocialVariant>[1])).toThrow('expectedRevision is required');
    expect(() => addSocialVariant(defaultProject, { itemId: item.id, channelId: 'channel-instagram', confirmWrite: true, claimToken: token })).toThrow('active variant');

    const edited = editSocialVariant(defaultProject, {
      variantId: variant.id, expectedRevision: 1, copy: 'Caption one', hashtags: ['#Launch', 'Product'],
      hashtagPlacement: 'first_comment', altText: 'A reviewed product image', altTextReviewed: true,
      altTextReviewedBy: 'human:reviewer', publishMethod: 'notification', compositionMode: 'customScheduled',
      customScheduledAt: '2026-08-20T18:00:00-07:00', editorialState: 'ready', confirmWrite: true, claimToken: token,
    });
    expect(edited.item.variants[0]).toMatchObject({ current_revision: 2, editorial_state: 'ready', revision: {
      copy: 'Caption one', hashtags: [{ position: 0, value: 'launch' }, { position: 1, value: 'product' }],
      hashtag_placement: 'first_comment', alt_text_reviewed: true, alt_text_reviewed_by: 'human:reviewer',
      composition_mode: 'customScheduled', custom_scheduled_at: '2026-08-20T18:00:00-07:00',
    } });
    expect(() => editSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 1, copy: 'stale', confirmWrite: true, claimToken: token })).toThrow('revision conflict');
    const queued = editSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 2, compositionMode: 'addToQueue', confirmWrite: true, claimToken: token });
    expect(queued.item.variants[0].revision).toMatchObject({ revision: 3, composition_mode: 'addToQueue', alt_text_reviewed: true, alt_text_reviewed_by: 'human:reviewer' });
    expect(queued.item.variants[0].revision.custom_scheduled_at).toBeUndefined();
    const stateOnly = editSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 3, editorialState: 'needs_review', confirmWrite: true, claimToken: token });
    expect(stateOnly.item.variants[0]).toMatchObject({ current_revision: 4, editorial_state: 'needs_review', revision: { revision: 4, editorial_state: 'needs_review' } });
    const reviewedAgain = editSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 4, altTextReviewed: true, altTextReviewedBy: 'human:second-reviewer', confirmWrite: true, claimToken: token });
    expect(reviewedAgain.item.variants[0].revision).toMatchObject({ revision: 5, editorial_state: 'needs_review', alt_text_reviewed: true, alt_text_reviewed_by: 'human:second-reviewer' });
    expect(() => editSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 3, editorialState: 'ready', altTextReviewedBy: 'human:stale-reviewer', confirmWrite: true, claimToken: token })).toThrow('revision conflict');
    expect(getSocialWorkItem(defaultProject, item.id).item.variants[0]).toMatchObject({ current_revision: 5, editorial_state: 'needs_review', revision: { alt_text_reviewed_by: 'human:second-reviewer' } });
    const temporary = editSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 5, copy: 'Temporary caption', confirmWrite: true, claimToken: token });
    expect(temporary.item.variants[0].current_revision).toBe(6);
    const reverted = editSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 6, copy: 'Caption one', confirmWrite: true, claimToken: token });
    expect(reverted.item.variants[0].current_revision).toBe(7);
    const changedAlt = editSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 7, altText: 'Changed image description', confirmWrite: true, claimToken: token });
    expect(changedAlt.item.variants[0].revision).toMatchObject({ revision: 8, alt_text: 'Changed image description', alt_text_reviewed: false });
    expect(changedAlt.item.variants[0].revision.alt_text_reviewed_by).toBeUndefined();
    const finalReview = editSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 8, altTextReviewed: true, altTextReviewedBy: 'human:archive-reviewer', confirmWrite: true, claimToken: token });
    expect(finalReview.item.variants[0].revision).toMatchObject({ revision: 9, alt_text_reviewed: true, alt_text_reviewed_by: 'human:archive-reviewer' });
    expect(() => editSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 9, compositionMode: 'customScheduled', customScheduledAt: '2026-08-20T18:00:00', confirmWrite: true, claimToken: token }))
      .toThrow('exact ISO timestamp');
    expect(() => editSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 9, compositionMode: 'customScheduled', customScheduledAt: '2026-02-30T18:00:00Z', confirmWrite: true, claimToken: token }))
      .toThrow('exact ISO timestamp');
    const database = lineageDb();
    try { expect(database.prepare('select revision, copy from social_variant_revisions where variant_id=? order by revision').all(variant.id)).toEqual([
      expect.objectContaining({ revision: 1, copy: '' }), expect.objectContaining({ revision: 2, copy: 'Caption one' }),
      expect.objectContaining({ revision: 3, copy: 'Caption one' }),
      expect.objectContaining({ revision: 4, copy: 'Caption one' }), expect.objectContaining({ revision: 5, copy: 'Caption one' }),
      expect.objectContaining({ revision: 6, copy: 'Temporary caption' }), expect.objectContaining({ revision: 7, copy: 'Caption one' }),
      expect.objectContaining({ revision: 8, copy: 'Caption one' }),
      expect.objectContaining({ revision: 9, copy: 'Caption one' }),
    ]); } finally { database.close(); }

    expect(() => removeSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 9, confirmWrite: true } as unknown as Parameters<typeof removeSocialVariant>[1])).toThrow('claim');
    expect(() => removeSocialVariant(defaultProject, { variantId: variant.id, confirmWrite: true, claimToken: token } as unknown as Parameters<typeof removeSocialVariant>[1])).toThrow('expectedRevision is required');
    expect(() => removeSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 8, confirmWrite: true, claimToken: token } as unknown as Parameters<typeof removeSocialVariant>[1])).toThrow('revision conflict');
    const removed = removeSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 9, confirmWrite: true, claimToken: token } as unknown as Parameters<typeof removeSocialVariant>[1]);
    expect(removed.item.variants[0]).toMatchObject({ active: false, editorial_state: 'archived', current_revision: 10, revision: {
      revision: 10, editorial_state: 'archived', hashtags: [{ position: 0, value: 'launch' }, { position: 1, value: 'product' }],
      alt_text: 'Changed image description', alt_text_reviewed: true, alt_text_reviewed_by: 'human:archive-reviewer',
    } });
    const removeRetry = removeSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 9, confirmWrite: true, claimToken: token } as unknown as Parameters<typeof removeSocialVariant>[1]);
    expect(removeRetry).toMatchObject({ idempotent: true, item: { variants: [expect.objectContaining({ current_revision: 10 })] } });
    const replacement = addSocialVariant(defaultProject, { itemId: item.id, channelId: 'channel-instagram', confirmWrite: true, claimToken: token });
    expect(replacement.item.variants).toHaveLength(2);
    const replacementVariant = replacement.item.variants.find(candidate => candidate.active)!;
    const archiveFields = { itemId: item.id, expectedVariants: [{ variantId: replacementVariant.id, expectedRevision: 1 }], confirmWrite: true, claimToken: token } as unknown as Parameters<typeof archiveSocialWorkItem>[1];
    expect(() => archiveSocialWorkItem(defaultProject, { ...archiveFields, claimToken: undefined })).toThrow('claim');
    const archived = archiveSocialWorkItem(defaultProject, archiveFields);
    expect(archived.item).toMatchObject({ editorial_state: 'archived', variants: [expect.objectContaining({ editorial_state: 'archived' }), expect.objectContaining({ editorial_state: 'archived' })] });
    expect(archived.item.variants.find(candidate => candidate.id === replacementVariant.id)).toMatchObject({ active: false, current_revision: 2, revision: { editorial_state: 'archived' } });
    expect(archiveSocialWorkItem(defaultProject, archiveFields)).toMatchObject({ idempotent: true });
    expect(() => archiveSocialWorkItem(defaultProject, { ...archiveFields, expectedVariants: [{ variantId: variant.id, expectedRevision: 9 }] })).toThrow('concurrency contract');
  });

  it('archives every active variant atomically under a complete concurrency contract', () => {
    const token = claimToken(); seedChannel('channel-linkedin', 'fingerprint-linkedin');
    const item = createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, campaignKey: 'archive-all', confirmWrite: true, claimToken: token }).item;
    const first = addSocialVariant(defaultProject, { itemId: item.id, channelId: 'channel-instagram', confirmWrite: true, claimToken: token }).item.variants.find(candidate => candidate.active)!;
    const second = addSocialVariant(defaultProject, { itemId: item.id, channelId: 'channel-linkedin', confirmWrite: true, claimToken: token }).item.variants.find(candidate => candidate.channel_id === 'channel-linkedin')!;
    editSocialVariant(defaultProject, { variantId: first.id, expectedRevision: 1, copy: 'First archive copy', hashtags: ['one', 'two'], confirmWrite: true, claimToken: token });
    editSocialVariant(defaultProject, { variantId: second.id, expectedRevision: 1, copy: 'Second archive copy', altText: 'Second alt', altTextReviewed: true, altTextReviewedBy: 'human:archive', confirmWrite: true, claimToken: token });
    const call = (expectedVariants: Array<{ variantId: string; expectedRevision: number }>) => archiveSocialWorkItem(defaultProject, { itemId: item.id, expectedVariants, confirmWrite: true, claimToken: token } as unknown as Parameters<typeof archiveSocialWorkItem>[1]);
    const before = JSON.stringify(getSocialWorkItem(defaultProject, item.id));
    expect(() => call([{ variantId: first.id, expectedRevision: 2 }])).toThrow('complete');
    expect(() => call([{ variantId: first.id, expectedRevision: 2 }, { variantId: second.id, expectedRevision: 1 }])).toThrow('revision conflict');
    expect(() => call([{ variantId: first.id, expectedRevision: 2 }, { variantId: second.id, expectedRevision: 2 }, { variantId: 'extra', expectedRevision: 1 }])).toThrow('complete');
    expect(JSON.stringify(getSocialWorkItem(defaultProject, item.id))).toBe(before);
    const archived = call([{ variantId: first.id, expectedRevision: 2 }, { variantId: second.id, expectedRevision: 2 }]);
    expect(archived.item.variants).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, active: false, current_revision: 3, revision: expect.objectContaining({ editorial_state: 'archived', hashtags: [{ position: 0, value: 'one' }, { position: 1, value: 'two' }] }) }),
      expect.objectContaining({ id: second.id, active: false, current_revision: 3, revision: expect.objectContaining({ editorial_state: 'archived', alt_text_reviewed_by: 'human:archive' }) }),
    ]));
  });

  it('validates from local evidence only, reports field paths, and never invokes Buffer', () => {
    const invoke = vi.spyOn(bufferRuntime, 'createBufferReadRuntime'); const token = claimToken();
    const upload = vi.spyOn(assetCore, 'uploadAsset'); const presign = vi.spyOn(assetCore, 'presignAsset');
    const item = createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, confirmWrite: true, claimToken: token }).item;
    expect(validateSocialWorkItem(defaultProject, item.id)).toMatchObject({ valid: false, issues: [expect.objectContaining({ field: 'variants', code: 'variant_required' })] });
    const variant = addSocialVariant(defaultProject, { itemId: item.id, channelId: 'channel-instagram', confirmWrite: true, claimToken: token }).item.variants[0];
    let validation = validateSocialWorkItem(defaultProject, item.id);
    expect(validation).toMatchObject({ schema_version: 'lineage.social_validation.v1', valid: false, scheduled: false, issues: [expect.objectContaining({ field: 'copy', variant_id: variant.id })] });
    editSocialVariant(defaultProject, { variantId: variant.id, expectedRevision: 1, copy: 'Ready caption', compositionMode: 'addToQueue', confirmWrite: true, claimToken: token });
    validation = validateSocialWorkItem(defaultProject, item.id);
    expect(validation).toMatchObject({ valid: true, scheduled: false, issues: [] });
    const database = lineageDb();
    try { database.prepare("update buffer_channels set provider_fingerprint='fingerprint-v2' where project_id=? and channel_id=?").run(defaultProject, 'channel-instagram'); }
    finally { database.close(); }
    expect(validateSocialWorkItem(defaultProject, item.id).issues).toContainEqual(expect.objectContaining({ field: 'channel_id', code: 'channel_stale', message: expect.stringContaining('sync Buffer channels') }));
    expect(invoke).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(presign).not.toHaveBeenCalled();
  });
});
