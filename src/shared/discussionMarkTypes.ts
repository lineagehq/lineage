import type { LineageAttempt, LineageSnapshot } from './types';

export interface AssetDiscussionMark {
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
  updated_by?: string;
}

export interface AssetDiscussionMarkListItem extends AssetDiscussionMark {
  checksum_sha256?: string;
  commands: { mark: string; note: string; unmark: string };
  current_attempt?: LineageAttempt;
  local: { absolute_path?: string; exists: boolean; relative_path?: string };
  media_type: string;
  s3?: { key?: string };
  source: 'catalog' | 'local';
  title: string;
  warnings: string[];
}

export interface AssetDiscussionMarksResponse {
  commands: { clear: string; mark: string };
  fetchedAt: string;
  marks: AssetDiscussionMarkListItem[];
  project: string;
  root_asset_id: string;
  schema_version: 'lineage.discussion_marks.v1';
  workspace: { id: string; root_asset_id: string };
}

export interface AssetDiscussionMarkMutationResponse {
  active: boolean;
  dryRun?: true;
  mark?: AssetDiscussionMark;
  ok: true;
  operation: 'mark' | 'note' | 'unmark';
  snapshot: LineageSnapshot;
}

export interface AssetDiscussionClearResponse {
  cleared_count: number;
  dryRun?: true;
  ok: true;
  snapshot: LineageSnapshot;
}
