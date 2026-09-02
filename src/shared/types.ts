import type { AssetSocialMark } from './socialMarkTypes';
import type { AssetDiscussionMark } from './discussionMarkTypes';

type AssetStatus = 'planned' | 'working' | 'approved' | 'published' | 'archived';
export type AssetContentType = 'image' | 'video' | 'gif' | 'audio' | 'doc' | 'other';
export type PlacementStatus = 'planned' | 'scheduled' | 'posted' | 'skipped';
export type AssetReviewState = 'unreviewed' | 'approved' | 'needs_revision' | 'rejected' | 'ignored';

interface AssetS3Object {
  bucket: string;
  region: string;
  key: string;
  version_id: string;
  etag?: string;
  size_bytes?: number;
  content_type?: string;
  checksum_sha256?: string;
  updated_at?: string;
}

interface LocalAssetObject {
  relative_path: string;
  absolute_path: string;
  size_bytes: number;
  content_type: string;
  checksum_sha256: string;
  updated_at: string;
}

interface AssetPlacement {
  channel: string;
  status: PlacementStatus;
  scheduled_at?: string;
  posted_at?: string;
  url?: string;
  notes?: string;
  updated_at: string;
}

export interface GrowthAsset {
  asset_id: string;
  project: string;
  product: string;
  source?: 'catalog' | 'local';
  campaign: string;
  channel: string;
  audience: string;
  status: AssetStatus;
  content_type: AssetContentType;
  title: string;
  hook: string;
  message_family?: string;
  format?: string;
  cta: string;
  utm_content: string;
  notes?: string;
  placements?: AssetPlacement[];
  s3?: AssetS3Object;
  local?: LocalAssetObject;
}

export interface AssetCatalog {
  project: string;
  product: string;
  default_bucket: string;
  default_region: string;
  assets: GrowthAsset[];
}

interface AssetCatalogSummary {
  project: string;
  product: string;
  default_bucket: string;
  default_region: string;
  asset_count: number;
}

export interface AssetFacets {
  audiences: string[];
  campaigns: string[];
  channels: string[];
  contentTypes: AssetContentType[];
  placementStatuses: PlacementStatus[];
  statuses: AssetStatus[];
  totalSizeBytes: number;
}
interface AssetPagination { page: number; pageSize: number; total: number; totalPages: number; }

export interface LiveS3Object {
  key: string;
  size: number;
  lastModified: string;
  storageClass?: string;
  cataloged: boolean;
  assetId?: string;
}

export interface AssetLibrarySnapshot {
  catalog: AssetCatalogSummary;
  assets: GrowthAsset[];
  facets: AssetFacets;
  pagination: AssetPagination;
  liveObjects: LiveS3Object[];
  orphanObjects: LiveS3Object[];
  fetchedAt: string;
  identity?: {
    account: string;
    arn: string;
  };
  error?: string;
}
export interface AssetLookupSnapshot { project: string; assets: GrowthAsset[]; missing: string[]; fetchedAt: string; }
export type { AssetLedgerIndexOptions, AssetLedgerIndexRun, AssetLedgerIndexSourceMode, AssetLedgerIndexSummary, AssetLedgerRecord, AssetLedgerSelectionState, AssetLedgerSnapshot, AssetLedgerSource, AssetLedgerSourceType, AssetLedgerWorkflowState, AssetPlacementState, AssetReviewLedgerState } from './ledgerTypes';
export type { AssetSelectionActor, AssetSelectionItem, AssetSelectionItemRole, AssetSelectionSet, AssetSelectionSetKind, AssetSelectionSnapshot, AssetSelectionWorkPacket, AssetSelectionWorkPacketCandidate, AssetSelectionWorkPacketStorageState, ContentAgentHandoff, ContentAgentHandoffNaturalLanguage, ContentAgentHandoffNextAction, ContentAgentHandoffTarget, ContentAgentResolvedHandoff, ContentBatch, ContentBatchDetail, ContentBatchFields, ContentBatchSnapshot, ContentBatchSummary, ContentOpsQueueAssetStorage, ContentOpsQueueBackupCue, ContentOpsQueueItem, ContentOpsQueueLane, ContentOpsQueueLaneId, ContentOpsQueueLaneSummary, ContentOpsQueueSnapshot, ContentPost, ContentPostAsset, ContentPostAssetFields, ContentPostFields, ContentPostPhase, ContentPostReadiness, ContentPostUpdateFields, ContentTargetFields, ContentTargetHandoff, ContentTargetSnapshot } from './contentTypes';
export type {
  LineageSelectionPacket,
  LineageSelectionPacketAsset,
  LineageSelectionPacketDiagnostic,
  LineageSelectionPacketStorageState,
  LineageSelectionPacketV1,
  LineageSelectionPacketV2,
  LineageSelectionPacketV2Asset,
  LineageSelectionPacketV2Attempt,
  LineageSelectionPacketV2IdentityProjection,
  LineageSelectionPacketCurrentGeometry,
  LineageSelectionPacketV3,
  LineageSelectionPacketV3Asset,
  LineageSelectionPacketV3IdentityProjection,
} from './lineageSelectionPacketTypes';
export type {
  CollectionPagination,
  CollectionReorderFields,
  CollectionSort,
  DeletionBlocker,
  DeletionImpactCount,
  ProjectCollectionSnapshot,
  ProjectDeletionPlan,
  ProjectWorkspaceSummary,
  WorkspaceCollectionKind,
  WorkspaceCollectionSnapshot,
  WorkspaceDeletionPlan,
} from './projectWorkspaceTypes';

export interface ReviewableAsset extends GrowthAsset {
  review?: {
    review_state: AssetReviewState;
    notes?: string;
    updated_at?: string;
  };
}

export interface ReviewQueueLane {
  channel: string;
  needsQa: ReviewableAsset[];
  approvedLocal: ReviewableAsset[];
  needsRevision: ReviewableAsset[];
  rejectedLocal: ReviewableAsset[];
  readyToPost: GrowthAsset[];
  scheduled: GrowthAsset[];
  posted: GrowthAsset[];
  totals: {
    needsQa: number;
    approvedLocal: number;
    needsRevision: number;
    rejectedLocal: number;
    readyToPost: number;
    scheduled: number;
    posted: number;
  };
}

export interface ReviewQueueSnapshot {
  project: string;
  fetchedAt: string;
  totals: {
    needsQa: number;
    approvedLocal: number;
    needsRevision: number;
    rejectedLocal: number;
    readyToPost: number;
    scheduled: number;
    posted: number;
    channels: number;
  };
  lanes: ReviewQueueLane[];
  handoff: {
    queueCommand: string;
    localListCommand: string;
    backupTemplate: string;
    scheduleTemplate: string;
    lineageNextTemplate: string;
  };
}

export interface ProjectSummary {
  project: string;
  product: string;
  catalogPath: string;
  default_bucket: string;
  default_region: string;
  asset_count: number;
}

export interface ListAssetsOptions {
  audience?: string;
  campaign?: string;
  channel?: string;
  includeLive?: boolean;
  page?: number;
  pageSize?: number;
  placementStatus?: string;
  query?: string;
  source?: string;
  status?: string;
  type?: string;
}

export interface PlacementFields {
  assetId: string;
  channel: string;
  status: PlacementStatus;
  scheduledAt?: string;
  postedAt?: string;
  url?: string;
  notes?: string;
  confirmWrite: boolean;
}

export interface DoctorReport {
  catalogExists: boolean;
  deleteEnabled: boolean;
  project: ProjectSummary;
  liveCheck: 'skipped' | 'ok' | 'error';
  liveError?: string;
}

export interface PresignResponse {
  assetId: string;
  expiresIn: number;
  url: string;
}

export interface MutationResponse {
  ok: true;
  message: string;
  output?: unknown;
  catalog?: AssetCatalog;
}

export interface UploadFields {
  project?: string;
  product?: string;
  campaign: string;
  channel: string;
  audience: string;
  status: 'working' | 'published';
  type: AssetContentType;
  assetId: string;
  title: string;
  hook: string;
  cta: string;
  utmContent: string;
  messageFamily?: string;
  format?: string;
  notes?: string;
  confirmWrite: boolean;
}

export interface LineageIndexSummary {
  catalog: number;
  local: number;
  total: number;
  database: string;
}

export interface LineageNode {
  asset_id: string;
  project: string;
  source: 'catalog' | 'local';
  title: string;
  media_type: AssetContentType;
  status: string;
  channel?: string;
  campaign?: string;
  local_path?: string;
  absolute_path?: string;
  s3_key?: string;
  checksum_sha256?: string;
  review_state: AssetReviewState;
  review_notes?: string;
  is_latest: boolean;
  user_selected: boolean;
  /** Exact prompt saved for the next child branch. `selection_note` remains as a compatibility alias. */
  branch_prompt?: string;
  selection_note?: string;
  preview_url?: string;
  position?: LineagePosition;
  attempt_count?: number;
  current_attempt?: LineageAttempt;
  lineage_tasks?: Partial<Record<LineageTaskType, LineageTask>>;
  reroll_request?: LineageRerollRequest;
  discussion_mark?: AssetDiscussionMark;
  social_mark?: AssetSocialMark;
}

export interface LineagePosition {
  x: number;
  y: number;
}

interface LineageSelection {
  asset_id: string; notes?: string; prompt?: string; prompt_status?: 'needs_prompt' | 'ready'; position: number; selected_at: string;
}

type LineageAttemptSource = 'editor' | 'generated_child' | 'initial' | 'reroll';
type LineageRerollActor = 'agent' | 'human' | 'system';
type LineageRerollRequestStatus = 'cancelled' | 'pending' | 'resolved';

export interface LineageAttempt {
  id: string;
  project_id: string;
  node_asset_id: string;
  asset_id: string;
  attempt_index: number;
  source: LineageAttemptSource;
  prompt?: string;
  generation_job_id?: string;
  file_path?: string;
  checksum_sha256?: string;
  created_at: string;
  promoted_at?: string;
  is_current: boolean;
  editor_provenance?: {
    plugin_id: string;
    contribution_id: string;
    package_name: string;
    package_version: string;
    protocol: string;
    edit_summary: string;
    accepted_at: string;
  };
}

export interface LineageRerollRequest {
  id: string;
  project_id: string;
  root_asset_id: string;
  node_asset_id: string;
  status: LineageRerollRequestStatus;
  requested_by: LineageRerollActor;
  /** Exact prompt saved for the next attempt. `notes` remains as a compatibility alias. */
  prompt?: string;
  notes?: string;
  prompt_status?: 'needs_prompt' | 'ready';
  agent_instruction?: string;
  created_at: string;
  resolved_at?: string;
  task_id?: string;
  task?: LineageTask;
}

export type LineageTaskType = 'iterate' | 'reroll';
export type LineageTaskStatus = 'pending' | 'claimed' | 'in_progress' | 'resolved' | 'cancelled';
export type LineageTaskActor = 'human' | 'agent' | 'system';

export interface LineageTaskEvent {
  id: string;
  task_id: string;
  event_type: 'created' | 'instructions_updated' | 'comment_added' | 'claimed' | 'started' | 'resolved' | 'cancelled' | 'human_override' | 'claim_released';
  actor?: LineageTaskActor | string;
  message?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface LineageTask {
  id: string;
  project_id: string;
  root_asset_id: string;
  target_asset_id: string;
  task_type: LineageTaskType;
  status: LineageTaskStatus;
  instructions?: string;
  /** Derived execution readiness; older task payloads may omit it. */
  prompt_status?: 'needs_prompt' | 'ready';
  created_by: LineageTaskActor;
  created_at: string;
  updated_at: string;
  claimed_at?: string;
  started_at?: string;
  resolved_at?: string;
  cancelled_at?: string;
  resolved_generation_job_id?: string;
  resolved_asset_id?: string;
  claimed_by_claim_id?: string;
  metadata?: Record<string, unknown>;
  events?: LineageTaskEvent[];
  active_claim?: AgentClaimSummary;
}

export interface LineageTasksResponse {
  project: string;
  root_asset_id: string;
  tasks: LineageTask[];
  fetchedAt: string;
}

export interface LineageTaskMutationResponse {
  ok: true;
  dryRun?: true;
  task: LineageTask;
  events?: LineageTaskEvent[];
}

type EdgeSummaryActor = 'human' | 'agent' | 'system';

export interface LineageEdge {
  id: string;
  parent_asset_id: string;
  child_asset_id: string;
  relation_type: 'derived_from';
  created_at: string;
  summary?: string;
  summary_created_by?: EdgeSummaryActor;
  summary_updated_by?: EdgeSummaryActor;
  summary_updated_at?: string;
}

export interface LineageSnapshot {
  project: string; root_asset_id: string; active_asset_id: string;
  next_variation_limit?: number;
  selected: string[]; selection: LineageSelection | null; selections: LineageSelection[];
  latest: string[]; nodes: LineageNode[]; edges: LineageEdge[]; tasks?: LineageTask[]; fetchedAt: string;
}

export interface LineageNextResponse {
  project: string;
  root_asset_id: string;
  next_variation_limit?: number;
  strategy: 'selected' | 'single_latest' | 'ambiguous_latest' | 'empty';
  selection_mode: 'none' | 'single' | 'multiple' | 'fallback';
  recommended_action: 'evolve_variations' | 'choose_next_base' | 'none';
  reason: 'user_selected' | 'single_latest_fallback' | 'multiple_latest_no_selection' | 'no_lineage_candidates';
  next_asset: LineageNode | null;
  next_assets: LineageNode[];
  latest: string[];
  selected: string[];
  selection: LineageSelection | null;
  selections: LineageSelection[];
  candidates: LineageNode[];
  warnings: string[];
  fetchedAt: string;
}

export interface LineageChildrenResponse {
  project: string;
  parent_asset_id: string;
  children: LineageNode[];
  edges: LineageEdge[];
  fetchedAt: string;
}

export interface LineageAttemptsResponse {
  project: string;
  root_asset_id: string;
  node_asset_id: string;
  attempts: LineageAttempt[];
  fetchedAt: string;
}

export interface LineageAttemptPromotionResponse extends LineageAttemptsResponse {
  ok: true;
  dryRun?: true;
  attempt: LineageAttempt;
}

export interface LineageRerollRequestsResponse {
  project: string;
  root_asset_id: string;
  requests: LineageRerollRequest[];
  fetchedAt: string;
}

export interface LineageRerollRequestMutationResponse {
  ok: true;
  dryRun?: true;
  request: LineageRerollRequest;
  task_id?: string;
  task?: LineageTask;
}

export interface LineageBriefResponse {
  project: string;
  root_asset_id: string;
  strategy: LineageNextResponse['strategy'];
  selection_mode: LineageNextResponse['selection_mode'];
  recommended_action: LineageNextResponse['recommended_action'];
  reason: LineageNextResponse['reason'];
  next_asset: LineageNode | null;
  next_assets: LineageNode[];
  selection: LineageSelection | null;
  selections: LineageSelection[];
  latest: string[];
  warnings: string[];
  brief: {
    title: string;
    objective: string;
    prompt: string;
    reference_asset_id?: string;
    reference_asset_ids: string[];
    rationale?: string;
    variation_prompts?: Array<{ asset_id: string; prompt: string }>;
  };
  handoff: {
    next_command: string;
    inspect_command?: string;
    link_child_command?: string;
  };
  fetchedAt: string;
}
export type { GenerationCancelResponse, GenerationHandoffPacket, GenerationImportResponse, GenerationInspectResponse, GenerationJob, GenerationJobInput, GenerationJobListResponse, GenerationJobOutput, GenerationJobReceipt, GenerationPlanResponse, GenerationProvider, GenerationSourceMode } from './generationTypes';
export type { LineageWorkspace, LineageWorkspaceActor, LineageWorkspaceFields, LineageWorkspaceSnapshot, LineageWorkspaceStatus, LineageWorkspaceUpdateFields } from './lineageWorkspaceTypes';

type AgentClaimScopeType = 'lineage_workspace' | 'lineage_task' | 'content_post' | 'content_queue_lane' | 'selection_set' | 'project_channel';
type AgentClaimStatus = 'active' | 'expired' | 'released' | 'revoked' | 'transferred';
type AgentClaimDerivedState = 'active' | 'idle' | 'stale' | 'expired';

export interface AgentClaimSummary {
  id: string;
  project: string;
  channel?: string;
  scope_type: AgentClaimScopeType;
  target_id: string;
  target_title?: string;
  agent_id?: string;
  agent_name: string;
  agent_kind: string;
  thread_id?: string;
  status: AgentClaimStatus;
  created_at: string;
  heartbeat_at: string;
  expires_at: string;
  released_at?: string;
  revoked_at?: string;
  revoked_by?: string;
  override_reason?: string;
  metadata?: Record<string, unknown>;
  heartbeat_age_seconds: number;
  derived_state: AgentClaimDerivedState;
}

export interface AgentClaimsResponse {
  ok: true;
  claims: AgentClaimSummary[];
  fetchedAt: string;
}

export interface LineageLayoutFields {
  rootAssetId: string;
  positions: Array<{ assetId: string; x: number; y: number }>;
  confirmWrite: boolean;
  claimToken?: string;
}

export interface LineageSelectedChildFields {
  rootAssetId?: string; childAssetId: string; confirmWrite: boolean; claimToken?: string;
  summary?: string; summaryActor?: EdgeSummaryActor;
}

export interface LineageLinkFields {
  parentAssetId: string; childAssetId: string; confirmWrite: boolean; claimToken?: string;
  summary?: string; summaryActor?: EdgeSummaryActor;
}

export interface LineageEdgeSummaryFields {
  edgeId: string;
  action: 'set' | 'clear';
  summary?: unknown;
  expectedSummaryUpdatedAt?: unknown;
  confirmWrite: boolean;
  claimToken?: string;
}

export interface LineageEdgeSummaryMutationResponse {
  ok: true;
  edge: LineageEdge;
  message: string;
}

export interface LineageRemoveNodeFields {
  assetId: string; rootAssetId?: string; confirmWrite: boolean; claimToken?: string;
}

export interface LineageRemoveNodeResponse {
  ok: true; asset_id: string; root_asset_id: string;
  removed_edge_ids: string[]; reparented_edges: LineageEdge[];
  selection_removed: boolean; dryRun?: true; message?: string; asset_preserved: true;
}

export interface SelectionFields {
  assetId?: string; assetIds?: string[]; rootAssetId?: string; clear?: boolean;
  mode?: 'replace' | 'add' | 'remove' | 'toggle'; maxSelections?: number; notes?: string;
  confirmWrite: boolean;
}

export interface ReviewFields {
  assetId: string;
  reviewState: AssetReviewState;
  notes?: string;
  confirmWrite: boolean;
}

export interface BatchReviewFields {
  assetIds: string[];
  reviewState: AssetReviewState; notes?: string; confirmWrite: boolean;
}

interface BatchReviewItemResult {
  asset_id: string; review_state: AssetReviewState;
  notes?: string; message?: string; dryRun?: true;
}

export interface BatchReviewResponse {
  ok: true; message: string;
  review_state: AssetReviewState;
  count: number;
  dryRun?: true; notes?: string;
  results: BatchReviewItemResult[];
}
