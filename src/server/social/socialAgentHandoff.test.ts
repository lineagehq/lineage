import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { createAgentClaim } from '../agentClaims';
import { defaultProject, repoRoot } from '../assetCore';
import { indexLineageAssets } from '../assetLineage';
import { lineageDb, nowIso } from '../assetLineageDb';
import { lineageWorkspaceId } from '../assetLineageWorkspaces';
import { BUFFER_CAPABILITY_REGISTRY_VERSION, bufferChannelCapability } from '../adapters/buffer/bufferCapabilities';
import { fileSha256 } from '../localReview';
import { markAssetSocial } from './socialMarks';
import { previewSocialDelivery } from './socialDelivery';
import { addSocialVariant, createSocialWorkItem, editSocialVariant } from './socialWorkItems';
import { createSocialAgentHandoff } from './socialAgentHandoff';

const scratch = join(repoRoot, '.asset-scratch', 'vitest-social-agent-handoff');
const fixtureNow = Date.parse('2026-08-14T12:00:00Z');

function fixture(compositionMode: 'addToQueue' | 'customScheduled' = 'customScheduled', copy = 'Controlled agent caption') {
  mkdirSync(scratch, { recursive: true });
  useLineageTestProfile(join(scratch, 'lineage.sqlite'));
  const image = join(scratch, 'agent-image.png');
  const sharpPath = createRequire(import.meta.url).resolve('sharp');
  const generated = spawnSync(process.execPath, ['-e', `const sharp=require(process.argv[1]);sharp({create:{width:1200,height:628,channels:3,background:'#224466'}}).png().toFile(process.argv[2]).catch(()=>process.exit(1))`, sharpPath, image]);
  if (generated.status !== 0) throw new Error('Unable to create synthetic image');
  indexLineageAssets(defaultProject);
  const assetId = `local-${fileSha256(image).slice(0, 12)}`;
  const channelId = 'agent-linkedin-channel';
  markAssetSocial(defaultProject, { asset: assetId, rootAssetId: assetId, markedBy: 'human:agent-brief', confirmWrite: true });
  const claim = createAgentClaim({ agentName: 'Agent Brief Fixture', project: defaultProject, scopeType: 'lineage_workspace', targetId: lineageWorkspaceId(defaultProject, assetId) });
  const database = lineageDb();
  try {
    const timestamp = nowIso();
    database.prepare('update assets set channel=? where project_id=? and id=?').run('linkedin', defaultProject, assetId);
    database.prepare(`insert into buffer_connections (project_id, organization_id, credential_ref, cli_version, schema_fingerprint, connection_fingerprint, health_state, created_at, updated_at) values (?, 'fixture-org', 'env:FIXTURE_ONLY', 'fixture', 'fixture-schema', 'fixture-connection', 'connected', ?, ?)`).run(defaultProject, timestamp, timestamp);
    database.prepare(`insert into buffer_channels (project_id, channel_id, organization_id, service, display_name, posting_schedule_json, allowed_actions_json, capability_json, disconnected, locked, paused, available, capability_registry_version, provider_fingerprint, synced_at) values (?, ?, 'fixture-org', 'linkedin', 'Agent Brief LinkedIn', ?, '[]', ?, 0, 0, 0, 1, ?, 'agent-channel-fingerprint', ?)`)
      .run(defaultProject, channelId, JSON.stringify({ slots: ['09:00'] }), JSON.stringify(bufferChannelCapability('linkedin')), BUFFER_CAPABILITY_REGISTRY_VERSION, timestamp);
  } finally { database.close(); }
  const item = createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, confirmWrite: true, claimToken: claim.claim_token }).item;
  const added = addSocialVariant(defaultProject, { itemId: item.id, channelId, confirmWrite: true, claimToken: claim.claim_token }).item.variants[0];
  const variant = editSocialVariant(defaultProject, {
    variantId: added.id, expectedRevision: 1, copy, hashtags: ['lineageqa'],
    hashtagPlacement: 'first_comment',
    altText: 'Synthetic blue rectangle', altTextReviewed: true, altTextReviewedBy: 'human:agent-brief', editorialState: 'ready',
    compositionMode, ...(compositionMode === 'customScheduled' ? { customScheduledAt: '2026-08-21T10:00:00-07:00' } : {}), confirmWrite: true, claimToken: claim.claim_token,
  }).item.variants[0];
  return { assetId, image, variant };
}

afterEach(() => rmSync(scratch, { force: true, recursive: true }));

describe('Social agent handoff', () => {
  it('returns an immutable complete browser-session brief without creating delivery state', () => {
    const { image, variant } = fixture();
    const preview = previewSocialDelivery(defaultProject, { variantId: variant.id, expectedRevision: 2 }, fixtureNow);
    const handoff = createSocialAgentHandoff(defaultProject, { variantId: variant.id, expectedRevision: 2, previewSha256: preview.preview_sha256 }, fixtureNow);
    expect(handoff).toMatchObject({
      schema_version: 'lineage.social_agent_handoff.v1', preview_sha256: preview.preview_sha256, project: defaultProject,
      variant_id: variant.id, revision_id: preview.revision_id, revision: 2, buffer_url: `https://publish.buffer.com/channels/${preview.channel_id}/schedule`,
      channel: { id: preview.channel_id, display_name: 'Agent Brief LinkedIn', service: 'linkedin' },
      caption: 'Controlled agent caption', hashtags: ['lineageqa'], rendered_text: 'Controlled agent caption', first_comment: '#lineageqa',
      alt_text: 'Synthetic blue rectangle', composition_mode: 'customScheduled', custom_scheduled_at: '2026-08-21T10:00:00-07:00',
      confirmation_policy: 'explicit_operator_confirmation_in_buffer',
      media: { local_file_path: image, checksum_sha256: fileSha256(image), width: 1200, height: 628, content_type: 'image/png' },
    });
    expect(handoff.handoff_id).toMatch(/^[a-f0-9]{64}$/);
    expect(handoff.agent_brief_markdown).toContain(image);
    expect(handoff.agent_brief_markdown).toContain('## Exact first comment\n#lineageqa');
    expect(handoff.agent_brief_markdown).toContain('2026-08-21T10:00:00-07:00');
    expect(handoff.agent_brief_markdown).toContain('explicitly authorizes this exact immutable brief');
    const second = createSocialAgentHandoff(defaultProject, { variantId: variant.id, expectedRevision: 2, previewSha256: preview.preview_sha256 }, fixtureNow);
    expect(second).toEqual(handoff);
    const database = lineageDb();
    try { expect(database.prepare("select name from sqlite_master where type='table' and name='social_delivery_operations'").get()).toBeUndefined(); }
    finally { database.close(); }
  });

  it('rejects stale preview identity before producing a brief', () => {
    const { variant } = fixture();
    expect(() => createSocialAgentHandoff(defaultProject, { variantId: variant.id, expectedRevision: 2, previewSha256: '0'.repeat(64) }, fixtureNow)).toThrow('preview changed');
  });

  it('rejects a ready revision with empty caption copy before producing a brief', () => {
    const { variant } = fixture('customScheduled', '');
    expect(() => previewSocialDelivery(defaultProject, { variantId: variant.id, expectedRevision: 2 }, fixtureNow)).toThrow('Caption copy is required');
  });

  it('rejects all-empty or paused per-day Buffer queue schedules', () => {
    const { variant } = fixture('addToQueue');
    const database = lineageDb();
    database.prepare('update buffer_channels set posting_schedule_json=? where channel_id=?')
      .run(JSON.stringify([{ day: 'monday', times: [] }, { day: 'tuesday', paused: true, times: ['09:00'] }]), variant.channel_id);
    database.close();
    expect(() => previewSocialDelivery(defaultProject, { variantId: variant.id, expectedRevision: 2 })).toThrow('no usable posting schedule');
  });

  it('previews an owned absolute current-attempt path end to end', () => {
    const { assetId, image, variant } = fixture();
    const database = lineageDb();
    database.prepare('update asset_attempts set is_current=0 where project_id=? and node_asset_id=?').run(defaultProject, assetId);
    database.prepare(`insert into asset_attempts
      (id, project_id, node_asset_id, asset_id, attempt_index, source, file_path, checksum_sha256, created_at, promoted_at, is_current)
      values (?, ?, ?, ?, 2, 'reroll', ?, ?, ?, ?, 1)`)
      .run('absolute-owned-attempt', defaultProject, assetId, assetId, image, fileSha256(image), nowIso(), nowIso());
    database.close();
    expect(() => previewSocialDelivery(defaultProject, { variantId: variant.id, expectedRevision: 2 }, fixtureNow)).not.toThrow();
  });
});
