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
