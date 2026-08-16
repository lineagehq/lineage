import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { createAgentClaim } from '../agentClaims';
import { defaultProject, repoRoot } from '../assetCore';
import { indexLineageAssets } from '../assetLineage';
import { lineageDb, nowIso } from '../assetLineageDb';
import { lineageWorkspaceId } from '../assetLineageWorkspaces';
import { BUFFER_CAPABILITY_REGISTRY_VERSION, bufferChannelCapability } from '../adapters/buffer/bufferCapabilities';
import type { BufferInsightsRuntime } from '../adapters/buffer/bufferInsightsRuntime';
import { fileSha256 } from '../localReview';
import { markAssetSocial } from './socialMarks';
import { previewSocialDelivery } from './socialDelivery';
import { addSocialVariant, createSocialWorkItem, editSocialVariant } from './socialWorkItems';
import { getSocialProviderPost, linkSocialProviderPost, syncSocialProviderPost } from './socialInsights';

const scratch = join(repoRoot, '.asset-scratch', 'vitest-social-insights');

function setup(hashtagPlacement: 'caption' | 'first_comment' = 'caption', customScheduledAt?: string) {
  mkdirSync(scratch, { recursive: true }); useLineageTestProfile(join(scratch, 'lineage.sqlite'));
  const image = join(scratch, 'insights.png'); const sharpPath = createRequire(import.meta.url).resolve('sharp');
  if (spawnSync(process.execPath, ['-e', `const sharp=require(process.argv[1]);sharp({create:{width:1200,height:628,channels:3,background:'#224466'}}).png().toFile(process.argv[2]).catch(()=>process.exit(1))`, sharpPath, image]).status !== 0) throw new Error('fixture image failed');
  indexLineageAssets(defaultProject); const assetId = `local-${fileSha256(image).slice(0, 12)}`; const channelId = 'insights-linkedin';
  markAssetSocial(defaultProject, { asset: assetId, rootAssetId: assetId, markedBy: 'human:insights', confirmWrite: true });
  const claim = createAgentClaim({ agentName: 'Insights Fixture', project: defaultProject, scopeType: 'lineage_workspace', targetId: lineageWorkspaceId(defaultProject, assetId) });
  const database = lineageDb();
  try {
    const timestamp = nowIso(); database.prepare('update assets set channel=? where project_id=? and id=?').run('linkedin', defaultProject, assetId);
    database.prepare(`insert into buffer_connections (project_id, organization_id, credential_ref, cli_version, schema_fingerprint, connection_fingerprint, health_state, created_at, updated_at) values (?, 'fixture-org', 'env:FIXTURE_ONLY', 'fixture', 'fixture-schema', 'fixture-connection', 'connected', ?, ?)`).run(defaultProject, timestamp, timestamp);
    database.prepare(`insert into buffer_channels (project_id, channel_id, organization_id, service, display_name, posting_schedule_json, allowed_actions_json, capability_json, disconnected, locked, paused, available, capability_registry_version, provider_fingerprint, synced_at) values (?, ?, 'fixture-org', 'linkedin', 'Insights LinkedIn', ?, '[]', ?, 0, 0, 0, 1, ?, 'insights-fingerprint', ?)`)
      .run(defaultProject, channelId, JSON.stringify({ slots: ['09:00'] }), JSON.stringify(bufferChannelCapability('linkedin')), BUFFER_CAPABILITY_REGISTRY_VERSION, timestamp);
  } finally { database.close(); }
  const item = createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, confirmWrite: true, claimToken: claim.claim_token }).item;
  const added = addSocialVariant(defaultProject, { itemId: item.id, channelId, confirmWrite: true, claimToken: claim.claim_token }).item.variants[0];
  const variant = editSocialVariant(defaultProject, { variantId: added.id, expectedRevision: 1, copy: 'Insights caption', hashtags: ['lineageqa'], hashtagPlacement, altText: 'Blue rectangle', altTextReviewed: true, altTextReviewedBy: 'human:insights', editorialState: 'ready', compositionMode: customScheduledAt ? 'customScheduled' : 'addToQueue', ...(customScheduledAt ? { customScheduledAt } : {}), confirmWrite: true, claimToken: claim.claim_token }).item.variants[0];
  const preview = previewSocialDelivery(defaultProject, { variantId: variant.id, expectedRevision: 2 });
  return { channelId, claimToken: claim.claim_token, preview, variant };
}

function runtime(post: Record<string, unknown>): BufferInsightsRuntime {
  const assets = Object.hasOwn(post, 'assets') ? post.assets : [{
    __typename: 'ImageAsset', id: 'provider-image-1', type: 'image', mimeType: 'image/png', source: 'https://example.test/image.png',
    image: { altText: 'Blue rectangle', width: 1200, height: 628, isAnimated: false },
  }];
  return { verify: vi.fn(), getPost: vi.fn(() => ({ ...post, assets })), listSentPosts: vi.fn() };
}

afterEach(() => rmSync(scratch, { force: true, recursive: true }));

describe('Social provider post insights', () => {
  it('links only an exact browser-created post and appends idempotent freshness-aware snapshots', () => {
    const { channelId, claimToken, preview, variant } = setup(); const providerPostId = 'buffer-post-1';
    const firstRuntime = runtime({ id: providerPostId, text: 'Insights caption\n\n#lineageqa', channelId, status: 'scheduled', dueAt: '2026-08-21T17:00:00.000Z', metrics: null, metricsUpdatedAt: null });
    const linked = linkSocialProviderPost(defaultProject, { variantId: variant.id, expectedRevision: 2, previewSha256: preview.preview_sha256, providerPostId, claimToken, confirmWrite: true }, firstRuntime, '2026-08-14T12:00:00.000Z');
    expect(linked).toMatchObject({ provider_post_id: providerPostId, status: 'scheduled', metrics: [], stale: true, idempotent: false });
    expect(getSocialProviderPost(defaultProject, variant.id)?.provider_post_id).toBe(providerPostId);
    const sentRuntime = runtime({ id: providerPostId, text: 'Insights caption\n\n#lineageqa', channelId, status: 'sent', externalLink: 'https://linkedin.com/feed/update/post-1', sentAt: '2026-08-21T17:00:02.000Z', metricsUpdatedAt: '2026-08-22T12:00:00.000Z', metrics: [{ type: 'impressions', name: 'Impressions', value: 120, unit: 'count' }, { type: 'engagementRate', name: 'Eng. Rate', value: 4.5, unit: 'percentage' }] });
    const synced = syncSocialProviderPost(defaultProject, variant.id, { confirmWrite: true, claimToken }, sentRuntime, '2026-08-22T13:00:00.000Z');
    expect(synced).toMatchObject({ status: 'sent', stale: false, external_link: 'https://linkedin.com/feed/update/post-1', metrics: [{ type: 'engagementRate' }, { type: 'impressions' }] });
    expect(syncSocialProviderPost(defaultProject, variant.id, { confirmWrite: true, claimToken }, sentRuntime, '2026-08-22T14:00:00.000Z').idempotent).toBe(true);
    const failed = syncSocialProviderPost(defaultProject, variant.id, { confirmWrite: true, claimToken }, runtime({
      id: providerPostId, text: 'Insights caption\n\n#lineageqa', channelId, status: 'error',
      metrics: [{ type: 'retweets', name: 'Legacy retweets', value: 2, unit: 'count' }],
    }), '2026-08-22T15:00:00.000Z');
    expect(failed).toMatchObject({ status: 'error', idempotent: false, metrics: [{ type: 'retweets', value: 2 }] });
    const wrongChannel = createAgentClaim({
      agentName: 'Wrong sync channel', project: defaultProject, channel: 'instagram', scopeType: 'project_channel',
      targetId: `${defaultProject}:instagram`, force: true, reason: 'Prove that a foreign-channel token cannot authorize LinkedIn insight sync.',
    });
    expect(() => syncSocialProviderPost(defaultProject, variant.id, { confirmWrite: true, claimToken: wrongChannel.claim_token }, sentRuntime, '2026-08-22T15:00:00.000Z')).toThrow('does not match linkedin');
    const database = lineageDb();
    try {
      expect(database.prepare('select count(*) count from social_provider_post_links').get()).toEqual({ count: 1 });
      expect(database.prepare('select count(*) count from social_provider_post_snapshots').get()).toEqual({ count: 3 });
      expect(database.prepare("select name from sqlite_master where type='table' and name='social_delivery_operations'").get()).toBeUndefined();
    } finally { database.close(); }
  });

  it('rejects stale previews, heuristic associations, malformed metrics, and missing local confirmation', () => {
    const { channelId, claimToken, preview, variant } = setup(); const base = { id: 'post-2', text: 'Insights caption\n\n#lineageqa', channelId, status: 'sent', metrics: [] };
    expect(() => linkSocialProviderPost(defaultProject, { variantId: variant.id, expectedRevision: 2, previewSha256: preview.preview_sha256, providerPostId: 'post-2' }, runtime(base))).toThrow('confirmWrite');
    expect(() => linkSocialProviderPost(defaultProject, { variantId: variant.id, expectedRevision: 2, previewSha256: '0'.repeat(64), providerPostId: 'post-2', claimToken, confirmWrite: true }, runtime(base))).toThrow('preview changed');
    expect(() => linkSocialProviderPost(defaultProject, { variantId: variant.id, expectedRevision: 2, previewSha256: preview.preview_sha256, providerPostId: 'post-2', claimToken, confirmWrite: true }, runtime({ ...base, channelId: 'other' }))).toThrow('does not match');
    expect(() => linkSocialProviderPost(defaultProject, { variantId: variant.id, expectedRevision: 2, previewSha256: preview.preview_sha256, providerPostId: 'post-2', claimToken, confirmWrite: true }, runtime({ ...base, metrics: [{ type: 'made_up_metric', name: 'invalid', value: 2, unit: 'count' }] }))).toThrow('metric is invalid');
    expect(() => linkSocialProviderPost(defaultProject, { variantId: variant.id, expectedRevision: 2, previewSha256: preview.preview_sha256, providerPostId: 'post-2', confirmWrite: true }, runtime(base))).toThrow('matching claim token');
    const wrongChannel = createAgentClaim({
      agentName: 'Wrong channel', project: defaultProject, channel: 'instagram', scopeType: 'project_channel',
      targetId: `${defaultProject}:instagram`, force: true, reason: 'Prove that a foreign-channel token cannot authorize LinkedIn evidence.',
    });
    expect(() => linkSocialProviderPost(defaultProject, { variantId: variant.id, expectedRevision: 2, previewSha256: preview.preview_sha256, providerPostId: 'post-2', claimToken: wrongChannel.claim_token, confirmWrite: true }, runtime(base))).toThrow('does not match linkedin');
  });

  it('links exact sent evidence after its custom scheduled time has elapsed', () => {
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const observedAt = new Date(Date.parse(scheduledAt) + 60 * 60 * 1000).toISOString();
    const { channelId, claimToken, preview, variant } = setup('caption', scheduledAt);
    const providerPostId = 'elapsed-custom-post';
    const linked = linkSocialProviderPost(defaultProject, {
      variantId: variant.id, expectedRevision: 2, previewSha256: preview.preview_sha256, providerPostId, claimToken, confirmWrite: true,
    }, runtime({ id: providerPostId, text: 'Insights caption\n\n#lineageqa', channelId, status: 'sent', dueAt: scheduledAt, sentAt: observedAt, metrics: [] }), observedAt);
    expect(linked).toMatchObject({ provider_post_id: providerPostId, status: 'sent', due_at: scheduledAt, sent_at: observedAt });
  });

  it('rejects a custom-scheduled post whose provider time differs from the immutable brief', () => {
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { channelId, claimToken, preview, variant } = setup('caption', scheduledAt);
    expect(() => linkSocialProviderPost(defaultProject, {
      variantId: variant.id, expectedRevision: 2, previewSha256: preview.preview_sha256,
      providerPostId: 'wrong-scheduled-time', claimToken, confirmWrite: true,
    }, runtime({
      id: 'wrong-scheduled-time', text: 'Insights caption\n\n#lineageqa', channelId, status: 'scheduled',
      dueAt: new Date(Date.parse(scheduledAt) + 30 * 60 * 1000).toISOString(), metrics: [],
    }))).toThrow('immutable Lineage schedule');
  });

  it('rejects provider media or alt text that differs from the immutable brief', () => {
    const { channelId, claimToken, preview, variant } = setup();
    const base = { id: 'wrong-media', text: 'Insights caption\n\n#lineageqa', channelId, status: 'scheduled', metrics: [] };
    expect(() => linkSocialProviderPost(defaultProject, {
      variantId: variant.id, expectedRevision: 2, previewSha256: preview.preview_sha256,
      providerPostId: 'wrong-media', claimToken, confirmWrite: true,
    }, runtime({ ...base, assets: [{
      __typename: 'ImageAsset', id: 'other-image', type: 'image', mimeType: 'image/png', source: 'https://example.test/other.png',
      image: { altText: 'Different alt text', width: 1200, height: 628, isAnimated: false },
    }] }))).toThrow('image does not match');
  });

  it('binds first-comment hashtags into exact association and later sync identity', () => {
    const { channelId, claimToken, preview, variant } = setup('first_comment');
    const input = { variantId: variant.id, expectedRevision: 2, previewSha256: preview.preview_sha256, claimToken, confirmWrite: true };
    expect(() => linkSocialProviderPost(defaultProject, { ...input, providerPostId: 'missing-comment' }, runtime({ id: 'missing-comment', text: 'Insights caption', channelId, status: 'scheduled', metrics: [] }))).toThrow('does not match');
    expect(() => linkSocialProviderPost(defaultProject, { ...input, providerPostId: 'wrong-comment' }, runtime({ id: 'wrong-comment', text: 'Insights caption', channelId, status: 'scheduled', metadata: { firstComment: '#other' }, metrics: [] }))).toThrow('does not match');
    const linked = linkSocialProviderPost(defaultProject, { ...input, providerPostId: 'exact-comment' }, runtime({ id: 'exact-comment', text: 'Insights caption', channelId, status: 'scheduled', metadata: { firstComment: '#lineageqa' }, metrics: [] }));
    expect(linked.provider_post_id).toBe('exact-comment');
    expect(() => syncSocialProviderPost(defaultProject, variant.id, { confirmWrite: true, claimToken }, runtime({ id: 'exact-comment', text: 'Insights caption', channelId, status: 'sent', metadata: { firstComment: '#changed' }, metrics: [] }))).toThrow('identity changed');
  });

  it('keeps pre-asset-fingerprint provider links readable and syncable after schema upgrade', () => {
    const { channelId, claimToken, preview, variant } = setup();
    const providerPostId = 'legacy-provider-link';
    const post = { id: providerPostId, text: 'Insights caption\n\n#lineageqa', channelId, status: 'scheduled', metrics: [] };
    linkSocialProviderPost(defaultProject, {
      variantId: variant.id, expectedRevision: 2, previewSha256: preview.preview_sha256,
      providerPostId, claimToken, confirmWrite: true,
    }, runtime(post));
    const database = lineageDb();
    database.exec('drop trigger append_only_social_provider_post_links_update');
    database.prepare('update social_provider_post_links set provider_asset_sha256=null where provider_post_id=?').run(providerPostId);
    database.close();
    expect(syncSocialProviderPost(defaultProject, variant.id, { confirmWrite: true, claimToken }, runtime({ ...post, status: 'sent' })))
      .toMatchObject({ provider_post_id: providerPostId, status: 'sent' });
  });
});
