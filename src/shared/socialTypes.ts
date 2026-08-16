import type { AssetSocialMarkMutationResponse as LegacyAssetSocialMarkMutationResponse } from './socialMarkTypes';

export type {
  AssetSocialMark,
  AssetSocialMarksResponse,
} from './socialMarkTypes';

export type AssetSocialMarkMutationResponse = LegacyAssetSocialMarkMutationResponse & {
  schema_version: 'lineage.social_mark_mutation.v1';
};

export type SocialEditorialState = 'draft' | 'needs_review' | 'ready' | 'archived';
export type SocialHashtagPlacement = 'caption' | 'first_comment';
export type SocialPublishMethod = 'automatic' | 'notification';
export type SocialCompositionMode = 'customScheduled' | 'addToQueue';

interface SocialHashtag {
  position: number;
  value: string;
}

interface SocialChannelCapability {
  automatic: boolean;
  image_post: boolean;
  notification: boolean;
  scheduling_modes: SocialCompositionMode[];
  supported: boolean;
  reason: string | null;
}

export interface SocialBufferConnection {
  project: string;
  organization_id: string;
  health_state: 'connected' | 'credential_missing' | 'organization_mismatch';
  channel_synced_at: string | null;
  updated_at: string;
}

export interface SocialBufferChannel {
  channel_id: string;
  service: string;
  display_name: string;
  timezone: string | null;
  disconnected: boolean;
  locked: boolean;
  paused: boolean;
  available: boolean;
  capability: SocialChannelCapability;
  synced_at: string;
  stale_at: string | null;
}

export interface SocialVariantRevision {
  id: string;
  variant_id: string;
  revision: number;
  copy: string;
  hashtags: SocialHashtag[];
  hashtag_placement: SocialHashtagPlacement;
  alt_text?: string;
  alt_text_reviewed: boolean;
  alt_text_reviewed_by?: string;
  alt_text_reviewed_at?: string;
  editorial_state: SocialEditorialState;
  publish_method: SocialPublishMethod;
  composition_mode?: SocialCompositionMode;
  custom_scheduled_at?: string;
  channel_fingerprint: string;
  revision_hash: string;
  created_by: string;
  created_at: string;
}

export interface SocialVariant {
  id: string;
  item_id: string;
  project_id: string;
  channel_id: string;
  editorial_state: SocialEditorialState;
  active: boolean;
  current_revision: number;
  created_at: string;
  updated_at: string;
  archived_at?: string;
  revision: SocialVariantRevision;
}

export interface SocialWorkItem {
  id: string;
  project_id: string;
  root_asset_id: string;
  source_asset_id: string;
  source_checksum_sha256?: string;
  campaign_key: string;
  content_post_id?: string;
  editorial_state: 'active' | 'archived';
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at?: string;
  variants: SocialVariant[];
}

export interface SocialWorkItemResponse {
  schema_version: 'lineage.social_work_item.v1';
  item: SocialWorkItem;
  idempotent?: boolean;
}

export interface SocialValidationIssue {
  field: string;
  code: string;
  message: string;
  variant_id?: string;
}

export interface SocialValidationResponse {
  schema_version: 'lineage.social_validation.v1';
  item_id: string;
  valid: boolean;
  scheduled: false;
  issues: SocialValidationIssue[];
}

export interface SocialDeliveryPreview {
  schema_version: 'lineage.social_delivery_preview.v1';
  preview_sha256: string;
  project: string;
  item_id: string;
  workspace_channel?: string;
  variant_id: string;
  revision_id: string;
  revision: number;
  revision_sha256: string;
  root_asset_id: string;
  source_asset_id: string;
  source_attempt_id: string;
  source_checksum_sha256: string;
  source_attempt_asset_id: string;
  rendition_sha256: string;
  media_content_type: 'image/png' | 'image/jpeg';
  media_width: number;
  media_height: number;
  media_size_bytes: number;
  capability_registry_version: number;
  service: 'instagram' | 'linkedin';
  channel_id: string;
  channel_fingerprint: string;
  capability_fingerprint: string;
  connection_fingerprint: string;
  publish_method: SocialPublishMethod;
  composition_mode: SocialCompositionMode;
  custom_scheduled_at?: string;
}

export interface SocialAgentHandoff {
  schema_version: 'lineage.social_agent_handoff.v1';
  handoff_id: string;
  preview_sha256: string;
  project: string;
  variant_id: string;
  revision_id: string;
  revision: number;
  buffer_url: string;
  channel: {
    id: string;
    display_name: string;
    service: 'instagram' | 'linkedin';
  };
  caption: string;
  hashtags: string[];
  hashtag_placement: SocialHashtagPlacement;
  rendered_text: string;
  first_comment?: string;
  alt_text: string;
  publish_method: SocialPublishMethod;
  composition_mode: SocialCompositionMode;
  custom_scheduled_at?: string;
  media: {
    local_file_path: string;
    local_reference: string;
    content_type: 'image/png' | 'image/jpeg';
    checksum_sha256: string;
    rendition_sha256: string;
    width: number;
    height: number;
    size_bytes: number;
  };
  confirmation_policy: 'explicit_operator_confirmation_in_buffer';
  agent_brief_markdown: string;
}

export interface SocialProviderMetric {
  type: 'reactions' | 'comments' | 'shares' | 'reposts' | 'reach' | 'impressions' | 'views' | 'clicks' | 'engagementRate' | 'saves' | 'follows' | 'quotes' | 'viewers' | 'totalTimeWatched' | 'likes' | 'replies' | 'favorites' | 'reblogs' | 'retweets' | 'repins' | 'link_clicks' | 'other';
  name: string;
  value: number;
  unit: 'count' | 'percentage';
}

export interface SocialProviderPostInsights {
  schema_version: 'lineage.social_provider_post_insights.v1';
  link_id: string;
  provider_post_id: string;
  project: string;
  variant_id: string;
  revision: number;
  preview_sha256: string;
  channel_id: string;
  status: 'needs_approval' | 'scheduled' | 'sending' | 'sent' | 'error';
  external_link?: string;
  due_at?: string;
  sent_at?: string;
  metrics: SocialProviderMetric[];
  metrics_updated_at?: string;
  observed_at: string;
  stale: boolean;
  idempotent: boolean;
}
