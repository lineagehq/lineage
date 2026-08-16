import { createHash } from 'node:crypto';
import type {
  SocialDeliveryPreview,
  SocialVariantRevision,
} from '../../shared/socialTypes';
import { lineageDb, type DatabaseSync } from '../assetLineageDb';
import { canonicalLineageWorkspaceChannel } from '../lineageClaimGuards';
import { lineageCurrentAttemptIdentityForNodeInDatabase } from '../lineageSelectionPacket';
import { canonicalSocialRevisionDigest } from './socialRevisionDigest';
import { getSocialWorkItemInDatabase } from './socialWorkItems';
import { BUFFER_CAPABILITY_REGISTRY_VERSION, bufferChannelCapability, canonicalBufferCapabilityJson } from '../adapters/buffer/bufferCapabilities';
import { compileBufferSingleImageRequest } from '../adapters/buffer/bufferSocialCompiler';
import { inspectSocialImage, type SocialImageIdentity } from './socialMedia';

export class SocialDeliveryError extends Error {
  constructor(message: string, public status = 400, public code = 'social_delivery_invalid') { super(message); }
}

export function isSocialDeliveryError(error: unknown): error is SocialDeliveryError {
  return error instanceof SocialDeliveryError;
}

export interface SocialDeliveryPreviewInput { variantId: string; expectedRevision: number }
type PreviewInput = SocialDeliveryPreviewInput;

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertRevision(expectedRevision: number): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new SocialDeliveryError('expectedRevision must be a positive integer');
}


function revisionPayload(revision: SocialVariantRevision) {
  if (!revision.composition_mode) throw new SocialDeliveryError('Variant composition mode is required before scheduling', 409, 'preflight_failed');
  return {
    channelId: '',
    copy: revision.copy,
    hashtags: revision.hashtags.map(tag => tag.value),
    hashtagPlacement: revision.hashtag_placement,
    publishMethod: revision.publish_method,
    compositionMode: revision.composition_mode,
    ...(revision.custom_scheduled_at ? { customScheduledAt: revision.custom_scheduled_at } : {}),
  };
}

export interface CompiledSocialDelivery {
  preview: SocialDeliveryPreview;
  media: SocialImageIdentity & { localReference: string; localFilePath: string };
  requestSeed: Omit<Parameters<typeof compileBufferSingleImageRequest>[0], 'imageUrl'>;
  sourceAttemptAssetId: string;
}

function usablePostingSchedule(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    const hasSlot = (entry: unknown): boolean => {
      if (typeof entry === 'string') return entry.trim().length > 0;
      if (Array.isArray(entry)) return entry.some(hasSlot);
      if (!entry || typeof entry !== 'object') return false;
      const row = entry as Record<string, unknown>;
      if (row.paused === true) return false;
      return ['slots', 'times', 'schedules', 'postingTimes'].some(key => hasSlot(row[key]));
    };
    return hasSlot(parsed);
  } catch { return false; }
}

function compileSocialDeliveryInDatabase(database: DatabaseSync, project: string, input: PreviewInput, currentTime = Date.now()): CompiledSocialDelivery {
  assertRevision(input.expectedRevision);
  const variant = database.prepare(`select item_id, channel_id, current_revision, active, editorial_state from social_variants where project_id=? and id=?`)
      .get(project, input.variantId) as { item_id: string; channel_id: string; current_revision: number; active: number; editorial_state: string } | undefined;
    if (!variant) throw new SocialDeliveryError('Social variant was not found', 404, 'not_found');
    if (variant.active !== 1 || variant.editorial_state !== 'ready') throw new SocialDeliveryError('Social variant must be active and ready', 409, 'preflight_failed');
    if (Number(variant.current_revision) !== input.expectedRevision) throw new SocialDeliveryError('Social variant revision conflict', 409, 'revision_conflict');
    const { item } = getSocialWorkItemInDatabase(database, project, variant.item_id);
    const selected = item.variants.find(candidate => candidate.id === input.variantId)!;
    const revision = selected.revision;
    let computedRevisionHash: string;
    try {
      computedRevisionHash = canonicalSocialRevisionDigest({
        channelId: selected.channel_id,
        copy: revision.copy,
        hashtags: revision.hashtags,
        hashtagPlacement: revision.hashtag_placement,
        altText: revision.alt_text,
        altTextReviewed: revision.alt_text_reviewed,
        altTextReviewedBy: revision.alt_text_reviewed_by,
        editorialState: revision.editorial_state,
        publishMethod: revision.publish_method,
        compositionMode: revision.composition_mode,
        customScheduledAt: revision.custom_scheduled_at,
        channelFingerprint: revision.channel_fingerprint,
      });
    } catch {
      throw new SocialDeliveryError('Social variant immutable digest input is invalid', 409, 'revision_integrity_failed');
    }
    if (computedRevisionHash !== revision.revision_hash) {
      throw new SocialDeliveryError('Social variant revision content does not match its immutable digest', 409, 'revision_integrity_failed');
    }
    const revisionRequest = revisionPayload(revision);
    if (!revision.copy.trim()) {
      throw new SocialDeliveryError('Caption copy is required before creating an agent handoff', 409, 'preflight_failed');
    }
    if (!revision.alt_text?.trim() || revision.alt_text_reviewed !== true || !revision.alt_text_reviewed_by?.trim() || !revision.alt_text_reviewed_at) {
      throw new SocialDeliveryError('Human-reviewed alt text with provenance is required', 409, 'preflight_failed');
    }
    const connection = database.prepare(`select organization_id, connection_fingerprint, health_state from buffer_connections where project_id=?`).get(project) as { organization_id: string; connection_fingerprint: string; health_state: string } | undefined;
    if (!connection || connection.health_state !== 'connected') throw new SocialDeliveryError('Buffer connection is not ready', 409, 'preflight_failed');
    const channel = database.prepare(`select organization_id, service, provider_fingerprint, posting_schedule_json, capability_json, capability_registry_version, available, disconnected, locked, paused, stale_at from buffer_channels where project_id=? and channel_id=?`)
      .get(project, selected.channel_id) as Record<string, unknown> | undefined;
    if (!channel || channel.available !== 1 || channel.disconnected === 1 || channel.locked === 1 || channel.paused === 1 || channel.stale_at !== null) throw new SocialDeliveryError('Buffer channel is not available', 409, 'preflight_failed');
    if (channel.organization_id !== connection.organization_id) throw new SocialDeliveryError('Buffer channel organization does not match the pinned connection', 409, 'connection_mismatch');
    if (revision.channel_fingerprint !== channel.provider_fingerprint) throw new SocialDeliveryError('Buffer channel fingerprint changed', 409, 'channel_stale');
    const service = String(channel.service).trim().toLowerCase();
    if (service !== 'instagram' && service !== 'linkedin') throw new SocialDeliveryError('Buffer channel service is unsupported', 409, 'preflight_failed');
    if (Number(channel.capability_registry_version) !== BUFFER_CAPABILITY_REGISTRY_VERSION || String(channel.capability_json) !== canonicalBufferCapabilityJson(service)) {
      throw new SocialDeliveryError('Buffer channel capability registry changed; sync and save a new revision', 409, 'channel_stale');
    }
    const capability = bufferChannelCapability(service);
    if (!capability.supported || !capability[revision.publish_method] || !capability.scheduling_modes?.includes(revision.composition_mode!)) {
      throw new SocialDeliveryError('Buffer channel capability does not support this variant', 409, 'preflight_failed');
    }
    if (revision.composition_mode === 'addToQueue' && !usablePostingSchedule(String(channel.posting_schedule_json))) throw new SocialDeliveryError('Buffer queue has no usable posting schedule', 409, 'preflight_failed');
    if (revision.composition_mode === 'customScheduled') {
      const scheduled = Date.parse(revision.custom_scheduled_at || '');
      if (!Number.isFinite(scheduled) || scheduled <= currentTime) throw new SocialDeliveryError('Custom scheduled time must still be in the future', 409, 'preflight_failed');
    }
    const attempt = lineageCurrentAttemptIdentityForNodeInDatabase(database, project, item.root_asset_id, item.source_asset_id);
    if (item.source_checksum_sha256 && item.source_checksum_sha256 !== attempt.checksum_sha256) throw new SocialDeliveryError('Social source checksum changed', 409, 'source_stale');
    let media: SocialImageIdentity;
    try { media = inspectSocialImage({ project, service, localReference: attempt.local_reference, localFilePath: attempt.local_file_path, expectedChecksum: attempt.checksum_sha256 }); }
    catch (error) { throw new SocialDeliveryError(error instanceof Error ? error.message : 'Social image preflight failed', 409, 'media_preflight_failed'); }
    const workspaceChannel = canonicalLineageWorkspaceChannel(project, item.root_asset_id, database);
    const identity = {
      schema_version: 'lineage.social_delivery_preview.v1',
      project,
      item_id: item.id,
      ...(workspaceChannel ? { workspace_channel: workspaceChannel } : {}),
      variant_id: selected.id,
      revision_id: revision.id,
      revision: revision.revision,
      revision_sha256: revision.revision_hash,
      root_asset_id: item.root_asset_id,
      source_asset_id: item.source_asset_id,
      source_attempt_id: attempt.attempt_id,
      source_checksum_sha256: attempt.checksum_sha256,
      source_attempt_asset_id: attempt.attempt_asset_id,
      rendition_sha256: media.renditionSha256,
      media_content_type: media.contentType,
      media_width: media.width,
      media_height: media.height,
      media_size_bytes: media.sizeBytes,
      capability_registry_version: BUFFER_CAPABILITY_REGISTRY_VERSION,
      service,
      channel_id: selected.channel_id,
      channel_fingerprint: revision.channel_fingerprint,
      capability_fingerprint: digest({ registry: BUFFER_CAPABILITY_REGISTRY_VERSION, capability }),
      connection_fingerprint: connection.connection_fingerprint,
      publish_method: revision.publish_method,
      composition_mode: revision.composition_mode!,
      ...(revision.custom_scheduled_at ? { custom_scheduled_at: revision.custom_scheduled_at } : {}),
    } as const;
    return {
      preview: { ...identity, preview_sha256: digest(identity) },
      media: { ...media, localReference: attempt.local_reference, localFilePath: attempt.local_file_path },
      sourceAttemptAssetId: attempt.attempt_asset_id,
      requestSeed: {
        ...revisionRequest, channelId: selected.channel_id, service,
        altText: revision.alt_text, width: media.width, height: media.height,
      },
    };
}

export function previewSocialDelivery(project: string, input: PreviewInput, currentTime = Date.now()): SocialDeliveryPreview {
  const database = lineageDb();
  try { return compileSocialDeliveryInDatabase(database, project, input, currentTime).preview; }
  finally { database.close(); }
}

export function compileSocialDeliveryForAgentHandoff(project: string, input: SocialDeliveryPreviewInput, currentTime = Date.now()): CompiledSocialDelivery {
  const database = lineageDb();
  try { return compileSocialDeliveryInDatabase(database, project, input, currentTime); }
  finally { database.close(); }
}
