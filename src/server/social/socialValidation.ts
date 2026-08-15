import type { SocialValidationIssue, SocialValidationResponse } from '../../shared/socialTypes';
import { lineageDb } from '../assetLineageDb';
import { getSocialWorkItem } from './socialWorkItems';
import { BUFFER_CAPABILITY_REGISTRY_VERSION, canonicalBufferCapabilityJson } from '../adapters/buffer/bufferCapabilities';

export function validateSocialWorkItem(project: string, itemId: string): SocialValidationResponse {
  const { item } = getSocialWorkItem(project, itemId);
  const issues: SocialValidationIssue[] = [];
  if (!item.variants.some(candidate => candidate.active)) {
    issues.push({ field: 'variants', code: 'variant_required', message: 'Add at least one active channel variant before composition is valid.' });
  }
  const database = lineageDb();
  try {
    for (const variant of item.variants.filter(candidate => candidate.active)) {
      const channel = database.prepare(`select service, available, disconnected, locked, paused, stale_at, provider_fingerprint, capability_json, capability_registry_version from buffer_channels where project_id=? and channel_id=?`)
        .get(project, variant.channel_id) as Record<string, unknown> | undefined;
      const add = (field: string, code: string, message: string) => issues.push({ field, code, message, variant_id: variant.id });
      if (!channel) { add('channel_id', 'channel_missing', 'Channel is absent from the synchronized catalog; sync Buffer channels.'); continue; }
      if (variant.revision.channel_fingerprint !== channel.provider_fingerprint) add('channel_id', 'channel_stale', 'Channel evidence changed; sync Buffer channels and save a new revision.');
      if (channel.stale_at !== null || Number(channel.capability_registry_version) !== BUFFER_CAPABILITY_REGISTRY_VERSION || String(channel.capability_json) !== canonicalBufferCapabilityJson(String(channel.service))) add('channel_id', 'channel_stale', 'Channel capability evidence changed; sync Buffer channels and save a new revision.');
      const capability = JSON.parse(String(channel.capability_json)) as { supported?: boolean; reason?: string; automatic?: boolean; notification?: boolean; scheduling_modes?: string[] };
      if (!capability.supported) add('channel_id', 'channel_unsupported', capability.reason || 'This channel service is unsupported.');
      if (channel.available !== 1 || channel.disconnected === 1 || channel.locked === 1) add('channel_id', 'channel_unavailable', 'Channel is unavailable, disconnected, or locked; sync Buffer channels.');
      if (channel.paused === 1) add('channel_id', 'channel_paused', 'Channel queue is paused.');
      if (variant.revision.publish_method === 'automatic' && !capability.automatic) add('publish_method', 'publish_method_unsupported', 'Automatic publishing is unsupported for this channel.');
      if (variant.revision.publish_method === 'notification' && !capability.notification) add('publish_method', 'publish_method_unsupported', 'Notification publishing is unsupported for this channel.');
      if (variant.revision.composition_mode && !capability.scheduling_modes?.includes(variant.revision.composition_mode)) add('composition_mode', 'composition_mode_unsupported', 'Composition timing intent is unsupported for this channel.');
      if (!variant.revision.copy.trim()) add('copy', 'copy_required', 'Caption copy is required.');
      if (!variant.revision.alt_text?.trim() || !variant.revision.alt_text_reviewed || !variant.revision.alt_text_reviewed_by || !variant.revision.alt_text_reviewed_at) add('alt_text', 'alt_text_review_required', 'Non-empty alt text must carry human review provenance.');
    }
  } finally { database.close(); }
  return { schema_version: 'lineage.social_validation.v1', item_id: item.id, valid: issues.length === 0, scheduled: false, issues };
}
