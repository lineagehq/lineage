import type {
  DeliverySurfaceSnapshot,
  EffectiveNodeNextOutputTargets,
} from './outputTargetTypes';

export type LineageSelectionPacketStorageState = 'local_and_s3' | 'local_only' | 's3_backed' | 'unresolved';

interface LineageSelectionPacketContext {
  campaign?: string;
  channel?: string;
  labels: string[];
  notes?: string;
}

interface LineageSelectionPacketWorkspace {
  active_at?: string;
  id: string;
  notes?: string;
  root_asset_id: string;
  status: string;
  title: string;
}

interface LineageSelectionPacketSelectedItem {
  asset_id: string;
  branch_prompt?: string;
  position: number;
  selected_at: string;
  selection_note?: string;
}

interface LineageSelectionPacketLocalMedia {
  absolute_path?: string;
  content_type?: string;
  exists: boolean;
  relative_path?: string;
  size_bytes?: number;
}

interface LineageSelectionPacketS3Media {
  bucket?: string;
  checksum_sha256?: string;
  content_type?: string;
  etag?: string;
  key?: string;
  region?: string;
  size_bytes?: number;
  version_id?: string;
}

interface LineageSelectionPacketAttempt {
  asset_id: string;
  checksum_sha256?: string;
  file_path?: string;
  generation_job_id?: string;
  id: string;
  is_current: boolean;
  source: string;
}

export interface LineageSelectionPacketV2Attempt extends LineageSelectionPacketAttempt {
  attempt_index: number;
  checksum_sha256: string;
}

export interface LineageSelectionPacketAsset {
  asset_id: string;
  branch_prompt?: string;
  campaign?: string;
  channel?: string;
  checksum_sha256?: string;
  current_attempt?: LineageSelectionPacketAttempt;
  dimensions?: {
    height: number;
    width: number;
  };
  local: LineageSelectionPacketLocalMedia;
  media_type?: string;
  mime_type?: string;
  review_notes?: string;
  review_state?: string;
  s3: LineageSelectionPacketS3Media;
  selection_note?: string;
  source?: string;
  status?: string;
  storage_state: LineageSelectionPacketStorageState;
  title: string;
}

export interface LineageSelectionPacketV2Asset extends Omit<LineageSelectionPacketAsset, 'checksum_sha256' | 'current_attempt'> {
  checksum_sha256: string;
  current_attempt: LineageSelectionPacketV2Attempt;
}

interface LineageSelectionPacketBase {
  context: LineageSelectionPacketContext;
  created_at: string;
  errors: string[];
  kind: 'lineage.selection_packet';
  packet_id: string;
  product: string;
  project: string;
  selection: {
    asset_ids: string[];
    count: number;
    items: LineageSelectionPacketSelectedItem[];
    root_asset_id: string;
  };
  source: {
    app: 'lineage';
    command?: string;
    db_path?: string;
    package?: string;
  };
  warnings: string[];
  workspace: LineageSelectionPacketWorkspace;
}

export interface LineageSelectionPacketV1 extends LineageSelectionPacketBase {
  assets: LineageSelectionPacketAsset[];
  schema_version: 'lineage.selection_packet.v1';
}

type LineageSelectionPacketDiagnosticSeverity = 'error' | 'warning';

export interface LineageSelectionPacketDiagnostic {
  asset_id?: string;
  code: string;
  severity: LineageSelectionPacketDiagnosticSeverity;
}

export interface LineageSelectionPacketV2 extends LineageSelectionPacketBase {
  assets: LineageSelectionPacketV2Asset[];
  diagnostics: LineageSelectionPacketDiagnostic[];
  identity_sha256: string;
  schema_version: 'lineage.selection_packet.v2';
}

export interface LineageSelectionPacketCurrentGeometry {
  media_kind: 'static_image';
  width: number;
  height: number;
  output_spec_digest: string;
  delivery_surfaces: DeliverySurfaceSnapshot[];
}

export interface LineageSelectionPacketV3Asset extends LineageSelectionPacketV2Asset {
  current_geometry: LineageSelectionPacketCurrentGeometry | null;
  next_output_targets: EffectiveNodeNextOutputTargets;
}

export interface LineageSelectionPacketV3 extends LineageSelectionPacketBase {
  assets: LineageSelectionPacketV3Asset[];
  diagnostics: LineageSelectionPacketDiagnostic[];
  identity_sha256: string;
  schema_version: 'lineage.selection_packet.v3';
  selected_source_resolution_digest_sha256: string;
}

export interface LineageSelectionPacketV2IdentityProjection {
  context: LineageSelectionPacketContext;
  diagnostics: LineageSelectionPacketDiagnostic[];
  product: string;
  project: string;
  schema_version: 'lineage.selection_packet.v2';
  selection: Array<{
    asset_id: string;
    branch_prompt?: string;
    campaign?: string;
    channel?: string;
    current_attempt: Pick<LineageSelectionPacketV2Attempt, 'asset_id' | 'attempt_index' | 'checksum_sha256' | 'id' | 'source'>;
    dimensions?: {
      height: number;
      width: number;
    };
    media_type?: string;
    mime_type?: string;
    position: number;
    selection_note?: string;
    title: string;
  }>;
  workspace: {
    id: string;
    root_asset_id: string;
  };
}

export interface LineageSelectionPacketV3IdentityProjection {
  context: LineageSelectionPacketContext;
  diagnostics: LineageSelectionPacketDiagnostic[];
  product: string;
  project: string;
  schema_version: 'lineage.selection_packet.v3';
  selected_source_resolution_digest_sha256: string;
  selection: Array<{
    asset_id: string;
    branch_prompt?: string;
    campaign?: string;
    channel?: string;
    current_attempt: Pick<LineageSelectionPacketV2Attempt, 'asset_id' | 'attempt_index' | 'checksum_sha256' | 'id' | 'source'>;
    current_geometry: LineageSelectionPacketCurrentGeometry | null;
    media_type?: string;
    mime_type?: string;
    next_output_targets: EffectiveNodeNextOutputTargets;
    position: number;
    selection_note?: string;
    title: string;
  }>;
  workspace: {
    id: string;
    root_asset_id: string;
  };
}

export type LineageSelectionPacket = LineageSelectionPacketV1 | LineageSelectionPacketV2 | LineageSelectionPacketV3;
