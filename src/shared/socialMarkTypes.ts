import type { LineageAttempt, LineageSnapshot } from './types';

export const SOCIAL_MARK_NOTES_MAX_CODE_POINTS = 1000;

export interface AssetSocialMark {
  active: boolean;
  asset_id: string;
  id: string;
  marked_at: string;
  marked_by: string;
  notes?: string;
  project_id: string;
  root_asset_id: string;
  unmarked_at?: string;
  unmarked_by?: string;
  updated_at: string;
}

export interface AssetSocialMarkListItem extends AssetSocialMark {
  checksum_sha256?: string;
  commands: {
    mark: string;
    unmark: string;
  };
  current_attempt?: LineageAttempt;
  local: {
    absolute_path?: string;
    exists: boolean;
    relative_path?: string;
  };
  media_type: string;
  s3?: {
    key?: string;
  };
  source: 'catalog' | 'local';
  title: string;
  warnings: string[];
}

export interface AssetSocialMarksResponse {
  commands: {
    mark: string;
  };
  fetchedAt: string;
  marks: AssetSocialMarkListItem[];
  project: string;
  root_asset_id: string;
  schema_version: 'lineage.social_marks.v1';
  workspace: {
    id: string;
    root_asset_id: string;
  };
}

export interface AssetSocialMarkMutationResponse {
  active: boolean;
  dryRun?: true;
  mark?: AssetSocialMark;
  ok: true;
  snapshot: LineageSnapshot;
}
