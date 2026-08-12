import type { LineageNextResponse } from './types';
import type { GenerationJobSourceTargetResolution, ResolvedGenerationTargetPlan } from './outputTargetTypes';

export type GenerationProvider = 'codex-handoff';
type GenerationAdapterVersion = 'generation-receipts-v1' | 'generation-receipts-v2' | 'generation-receipts-v3';
type GenerationJobStatus = 'planned' | 'imported' | 'failed' | 'cancelled';
type GenerationReceiptType = 'plan' | 'import' | 'error';
type GenerationReceiptStatus = 'ok' | 'error';
export type GenerationSourceMode = 'lineage_reroll' | 'lineage_selection';
type GenerationInputRole = 'lineage_next_base' | 'reference' | 'reroll_target';

export interface GenerationJobInput {
  id: string; job_id: string; project_id: string; asset_id: string; root_asset_id: string;
  role: GenerationInputRole; position: number; selection_strategy: string;
  selection_snapshot: LineageNextResponse;
}

export interface GenerationJobOutput {
  id: string; job_id: string; project_id: string; output_index: number; file_path: string;
  checksum_sha256: string; size_bytes: number; content_type: string;
  imported_asset_id: string; parent_asset_id: string; imported_at: string; edge_summary?: string;
}

export interface GenerationAssetOutputSpec {
  actual_height: number;
  actual_width: number;
  asset_id: string;
  created_at: string;
  generation_job_id: string;
  output_index: number;
  output_spec: NonNullable<ResolvedGenerationTargetPlan['slots'][number]['output_spec']>;
  output_spec_digest: string;
  target_group_id: string;
  variant_index: number;
}

export interface GenerationJobReceipt {
  id: string; job_id: string; receipt_type: GenerationReceiptType;
  status: GenerationReceiptStatus; command: string; payload: unknown; created_at: string;
}

export interface GenerationHandoffPacket {
  schema_version: 'lineage.generation_handoff.v1' | 'lineage.generation_handoff.v2' | 'lineage.generation_handoff.v3';
  provider: GenerationProvider; project: string; job_id: string; prompt: string;
  expected_output_count: number; per_base_count?: number;
  source_prompts?: Array<{ asset_id: string; prompt: string }>;
  lineage: {
    root_asset_id: string; parent_asset_id: string; selection_strategy: string;
    parent_title: string; parent_local_path?: string; parent_s3_key?: string;
    parents?: Array<{ parent_asset_id: string; parent_title: string; parent_local_path?: string; parent_s3_key?: string; output_indexes: number[] }>;
  };
  instructions: string[]; import_command: string;
  output_manifest?: {
    schema_version: 'lineage.generation_output_manifest.v1' | 'lineage.generation_output_manifest.v2';
    job_id: string;
    outputs: Array<{
      output_index: number;
      file_path: '';
      parent_asset_id: string;
      edge_summary: '';
      target_group_id?: string;
      variant_index?: number;
      output_spec?: ResolvedGenerationTargetPlan['slots'][number]['output_spec'] | null;
      output_spec_digest?: string | null;
    }>;
  };
  target_resolution?: Pick<ResolvedGenerationTargetPlan, 'map' | 'digest_sha256' | 'groups' | 'slots' | 'expected_output_count'>;
  guardrails: {
    live_generation: false; external_services: false;
    output_root: '.asset-scratch'; confirm_write_required: true;
  };
}

export interface GenerationJob {
  id: string; project_id: string; provider: GenerationProvider; adapter_version: GenerationAdapterVersion;
  source_mode: GenerationSourceMode; root_asset_id: string; prompt: string;
  expected_output_count: number; status: GenerationJobStatus; output_dir?: string;
  handoff: GenerationHandoffPacket; created_at: string; updated_at: string; imported_at?: string;
  target_plan?: ResolvedGenerationTargetPlan;
  source_target_resolutions?: GenerationJobSourceTargetResolution[];
  inputs: GenerationJobInput[]; outputs: GenerationJobOutput[]; receipts: GenerationJobReceipt[];
}

export interface GenerationPlanResponse {
  ok: true; command: 'generate image plan' | 'reroll plan'; project: string; dryRun?: true; wouldWrite?: true; job: GenerationJob;
}

export interface GenerationInspectResponse {
  ok: true; command: 'generate image inspect'; project: string; job: GenerationJob;
}

export interface GenerationCancelResponse {
  ok: true; command: 'generate image cancel'; project: string; job: GenerationJob; idempotent?: true;
}

export interface GenerationJobListResponse {
  ok: true; command: 'generate image jobs'; project: string; jobs: GenerationJob[]; fetchedAt: string;
}

export interface GenerationImportResponse {
  ok: true; command: 'generate image import' | 'reroll import'; project: string; job: GenerationJob; imported: GenerationJobOutput[]; idempotent?: true;
}
