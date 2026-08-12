import { existsSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { defaultProject, repoRoot } from './assetCore';
import {
  getLineageNextAsset,
  getLineageSnapshot,
  indexImportedLineageAssetInTransaction,
  indexLineageAssets,
  listLineageRerollRequests,
  recordLineageRerollAttempt,
  recordLineageRerollAttemptInTransaction,
} from './assetLineage';
import { lineageDb, nowIso, type DatabaseSync } from './assetLineageDb';
import {
  cancelLineageIterateTasksForAssets,
  cancelPendingLineageIterateTasksInTransaction,
  listLineageTasks,
  resolvePendingLineageRerollTaskInTransaction,
  resolveLineageTask,
} from './assetLineageTasks';
import { activeLineageWorkspaceRoot } from './assetLineageWorkspaces';
import { contentTypeFor, fileSha256 } from './localReview';
import { lineageCliCommand } from './lineageRuntimeCommand';
import {
  createGenerationOutputManifestDraft,
  generationOutputSpecDigest,
  parseGenerationOutputManifest,
  type GenerationOutputManifest,
} from '../shared/generationOutputManifest';
import type { GenerationTargetMap } from '../shared/outputTargetTypes';
import type { ResolvedGenerationTargetPlan } from '../shared/outputTargetTypes';
import { generationTargetMapFromShorthand, type OutputTargetShorthand } from '../shared/generationTargetMap';
import { planGenerationTargets } from './generationTargetPlanning';
import {
  loadAssetOutputSpec,
  loadGenerationJobTargetResolutions,
  loadGenerationTargetPlan,
  persistAssetOutputSpec,
  persistTargetAwareGenerationAggregate,
  persistTargetAwareGenerationAggregateInTransaction,
} from './generationTargetPersistence';
import {
  initializeChildNextOutputTargetsInTransaction,
  materializeNodeTargetPlan,
  nodeTargetResolutionsDigest,
  resolveEffectiveNodeNextOutputTargets,
} from './nodeNextOutputTargets';
import { readStaticImageMetadata, type StaticImageMetadata } from './staticImageMetadata';
import type {
  GenerationHandoffPacket,
  GenerationCancelResponse,
  GenerationImportResponse,
  GenerationInspectResponse,
  GenerationJob,
  GenerationJobInput,
  GenerationJobOutput,
  GenerationJobReceipt,
  GenerationPlanResponse,
  GenerationProvider,
  GenerationSourceMode,
  LineageNextResponse,
  LineageRerollRequest,
} from '../shared/types';

const legacyAdapterVersion = 'generation-receipts-v1';
const manifestAdapterVersion = 'generation-receipts-v2';
const provider: GenerationProvider = 'codex-handoff';

class GenerationReceiptError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isGenerationReceiptError(error: unknown): error is GenerationReceiptError {
  return error instanceof GenerationReceiptError;
}

function jobId(): string {
  return `gen-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  return JSON.parse(value) as T;
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function resolveLineageSelection(project: string): LineageNextResponse {
  const rootAssetId = activeLineageWorkspaceRoot(project);
  if (!rootAssetId) throw new GenerationReceiptError('No active lineage workspace for generation planning');
  const next = getLineageNextAsset(project, rootAssetId);
  if (!next.next_asset) throw new GenerationReceiptError(`No clear lineage next asset: ${next.reason}`);
  if (next.strategy !== 'selected') throw new GenerationReceiptError('Generation v1 requires an explicit selected lineage next base');
  if (next.selection_mode !== 'multiple' && next.selection?.asset_id !== next.next_asset.asset_id) throw new GenerationReceiptError('Generation v1 requires one explicit selected lineage next base');
  return next;
}

function selectedParents(next: LineageNextResponse) {
  const parents = next.next_assets.length > 0 ? next.next_assets : next.next_asset ? [next.next_asset] : [];
  if (parents.length === 0) throw new GenerationReceiptError('Missing lineage next base');
  return parents;
}

function parentMappings(next: LineageNextResponse, perBaseCount: number) {
  return selectedParents(next).map((parent, parentIndex) => ({
    parent,
    output_indexes: Array.from({ length: perBaseCount }, (_value, index) => parentIndex * perBaseCount + index),
  }));
}

function buildHandoff(
  project: string,
  id: string,
  prompt: string,
  count: number,
  perBaseCount: number,
  next: LineageNextResponse,
  inputs: GenerationJobInput[],
  targetOutputParents?: string[],
  targetPlan?: NonNullable<GenerationJob['target_plan']>,
): GenerationHandoffPacket {
  const parent = next.next_asset;
  if (!parent) throw new GenerationReceiptError('Missing lineage next base');
  const parents = targetOutputParents
    ? selectedParents(next).map(parent => ({
      parent,
      output_indexes: targetOutputParents.flatMap((assetId, index) => assetId === parent.asset_id ? [index] : []),
    }))
    : parentMappings(next, perBaseCount);
  const outputManifest = createGenerationOutputManifestDraft({
    id,
    expected_output_count: count,
    inputs,
    ...(targetPlan ? { target_plan: targetPlan } : {}),
  });
  const importCommand = lineageCliCommand(`generate image import --project ${quote(project)} --job-id ${quote(id)} --manifest ${quote('.asset-scratch/generation-output-manifest.json')} --confirm-write`);
  const sourcePrompts = next.selections
    .map(selection => ({ asset_id: selection.asset_id, prompt: selection.prompt || selection.notes || '' }))
    .filter(item => Boolean(item.prompt));
  return {
    schema_version: targetPlan ? 'lineage.generation_handoff.v3' : 'lineage.generation_handoff.v2',
    provider, project, job_id: id, prompt, expected_output_count: count,
    per_base_count: !targetPlan && next.selection_mode === 'multiple' ? perBaseCount : undefined,
    source_prompts: sourcePrompts.length > 0 ? sourcePrompts : undefined,
    lineage: {
      root_asset_id: next.root_asset_id, parent_asset_id: parent.asset_id, selection_strategy: next.strategy,
      parent_title: parent.title, parent_local_path: parent.local_path, parent_s3_key: parent.s3_key,
      parents: parents.length > 1 ? parents.map(mapping => ({
        parent_asset_id: mapping.parent.asset_id, parent_title: mapping.parent.title,
        parent_local_path: mapping.parent.local_path, parent_s3_key: mapping.parent.s3_key, output_indexes: mapping.output_indexes,
      })) : undefined,
    },
    instructions: [
      'Use Codex image generation outside Lineage server code.',
      ...(sourcePrompts.length > 0 ? ['Use each source prompt exactly for outputs mapped to that source.'] : []),
      'Write generated output files under .asset-scratch before import.',
      'Do not call live provider APIs from the CLI or server.',
      'Fill every output_manifest entry with its generated file path and a one- or two-word edge summary.',
      'Import the completed manifest with --confirm-write to persist every lineage child.',
    ],
    import_command: importCommand,
    output_manifest: outputManifest,
    ...(targetPlan ? {
      target_resolution: {
        map: targetPlan.map,
        digest_sha256: targetPlan.digest_sha256,
        groups: targetPlan.groups,
        slots: targetPlan.slots,
        expected_output_count: targetPlan.expected_output_count,
      },
    } : {}),
    guardrails: { live_generation: false, external_services: false, output_root: '.asset-scratch', confirm_write_required: true },
  };
}

function buildRerollHandoff(
  project: string,
  id: string,
  prompt: string,
  rootAssetId: string,
  target: { asset_id: string; title: string; local_path?: string; s3_key?: string },
  request: LineageRerollRequest,
  targetPlan?: ResolvedGenerationTargetPlan,
): GenerationHandoffPacket {
  const importCommand = lineageCliCommand(`reroll import --project ${quote(project)} --job-id ${quote(id)} --file <.asset-scratch-file> --confirm-write`);
  return {
    schema_version: targetPlan ? 'lineage.generation_handoff.v3' : 'lineage.generation_handoff.v1',
    provider,
    project,
    job_id: id,
    prompt,
    expected_output_count: 1,
    source_prompts: [{ asset_id: target.asset_id, prompt: request.prompt || request.notes || prompt }],
    lineage: {
      root_asset_id: rootAssetId,
      parent_asset_id: target.asset_id,
      selection_strategy: 'reroll_request',
      parent_title: target.title,
      parent_local_path: target.local_path,
      parent_s3_key: target.s3_key,
    },
    instructions: [
      'Use Codex image generation outside Lineage server code.',
      'Write the regenerated output file under .asset-scratch before import.',
      'Do not call live provider APIs from the CLI or server.',
      'Import exactly one output with reroll import, not link-child or generate image import.',
      `Resolve re-roll request ${request.id}; do not create a visible lineage child edge.`,
      ...(targetPlan?.slots[0]?.output_spec
        ? [`The inherited output lock is immutable: ${targetPlan.slots[0].output_spec.width}x${targetPlan.slots[0].output_spec.height} pixels.`]
        : []),
    ],
    import_command: importCommand,
    ...(targetPlan ? {
      target_resolution: {
        map: targetPlan.map,
        digest_sha256: targetPlan.digest_sha256,
        groups: targetPlan.groups,
        slots: targetPlan.slots,
        expected_output_count: targetPlan.expected_output_count,
      },
    } : {}),
    guardrails: { live_generation: false, external_services: false, output_root: '.asset-scratch', confirm_write_required: true },
  };
}

function inheritedRerollTargetPlan(
  generationJobId: string,
  targetAssetId: string,
  inherited: NonNullable<ReturnType<typeof loadAssetOutputSpec>>,
): ResolvedGenerationTargetPlan {
  const sourceSpec = inherited.output_spec;
  const targets: GenerationTargetMap['sources'][number]['targets'] = sourceSpec.delivery_surfaces.length > 0
    ? sourceSpec.delivery_surfaces.map(surface => ({
      kind: 'delivery_surface' as const,
      surface_id: surface.id,
      surface_version: surface.version,
    }))
    : [{ kind: 'custom', width: sourceSpec.width, height: sourceSpec.height }];
  const map: GenerationTargetMap = {
    schema_version: 'lineage.generation_target_map.v1',
    sources: [{ asset_id: targetAssetId, default_variant_count: 1, targets }],
  };
  const canonicalJson = JSON.stringify(map);
  const digest = createHash('sha256').update(canonicalJson).digest('hex');
  const groupId = `${generationJobId}:target-group:inherited`;
  const outputSpec = structuredClone(sourceSpec);
  outputSpec.target_group_id = groupId;
  outputSpec.variant_index = 0;
  return {
    canonical_json: canonicalJson,
    digest_sha256: digest,
    expected_output_count: 1,
    groups: [{
      id: groupId,
      parent_asset_id: targetAssetId,
      media_kind: 'static_image',
      width: sourceSpec.width,
      height: sourceSpec.height,
      ...(sourceSpec.geometry ? { geometry: structuredClone(sourceSpec.geometry) } : {}),
      ...(sourceSpec.custom_geometry ? { custom_geometry: structuredClone(sourceSpec.custom_geometry) } : {}),
      delivery_surfaces: structuredClone(sourceSpec.delivery_surfaces),
      grouping_mode: sourceSpec.grouping_mode,
      variant_count: 1,
      target_map_digest: digest,
      guidance: sourceSpec.delivery_surfaces.flatMap(surface => surface.guidance),
      unlocked: false,
    }],
    map,
    slots: [{
      id: `${generationJobId}:output-slot:0`,
      group_id: groupId,
      parent_asset_id: targetAssetId,
      output_index: 0,
      variant_index: 0,
      output_spec: outputSpec,
    }],
  };
}

function inputsFrom(jobIdValue: string, project: string, next: LineageNextResponse): GenerationJobInput[] {
  return selectedParents(next).map((parent, position) => ({
    id: `${jobIdValue}:input:${position}`,
    job_id: jobIdValue,
    project_id: project,
    asset_id: parent.asset_id,
    root_asset_id: next.root_asset_id,
    role: 'lineage_next_base',
    position,
    selection_strategy: next.strategy,
    selection_snapshot: next,
  }));
}

function receiptFrom(row: Record<string, unknown>): GenerationJobReceipt {
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    receipt_type: row.receipt_type as GenerationJobReceipt['receipt_type'],
    status: row.status as GenerationJobReceipt['status'],
    command: String(row.command),
    payload: parseJson(String(row.payload_json), null),
    created_at: String(row.created_at),
  };
}

function outputFrom(row: Record<string, unknown>): GenerationJobOutput {
  const edgeSummary = typeof row.edge_summary === 'string' && row.edge_summary.length > 0 ? row.edge_summary : undefined;
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    project_id: String(row.project_id),
    output_index: Number(row.output_index),
    file_path: String(row.file_path),
    checksum_sha256: String(row.checksum_sha256),
    size_bytes: Number(row.size_bytes),
    content_type: String(row.content_type),
    imported_asset_id: String(row.imported_asset_id),
    parent_asset_id: String(row.parent_asset_id),
    imported_at: String(row.imported_at),
    ...(edgeSummary ? { edge_summary: edgeSummary } : {}),
  };
}

export function loadGenerationJob(database: DatabaseSync, project: string, id: string): GenerationJob {
  const row = database.prepare('select * from generation_jobs where project_id = ? and id = ?').get(project, id) as Record<string, unknown> | undefined;
  if (!row) throw new GenerationReceiptError(`Unknown generation job: ${id}`, 404);
  const inputRows = database.prepare('select * from generation_job_inputs where job_id = ? order by position').all(id) as Array<Record<string, unknown>>;
  const inputs = inputRows.map(input => ({
    id: String(input.id),
    job_id: String(input.job_id),
    project_id: String(input.project_id),
    asset_id: String(input.asset_id),
    root_asset_id: String(input.root_asset_id),
    role: input.role as GenerationJobInput['role'],
    position: Number(input.position),
    selection_strategy: String(input.selection_strategy),
    selection_snapshot: parseJson<LineageNextResponse>(String(input.selection_snapshot_json), {} as LineageNextResponse),
  }));
  const outputs = (database.prepare('select * from generation_job_outputs where job_id = ? order by output_index').all(id) as Array<Record<string, unknown>>).map(outputFrom);
  const receipts = (database.prepare('select * from generation_job_receipts where job_id = ? order by created_at, id').all(id) as Array<Record<string, unknown>>).map(receiptFrom);
  const targetPlan = loadGenerationTargetPlan(database, id);
  const sourceTargetResolutions = loadGenerationJobTargetResolutions(database, id);
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    provider: row.provider as GenerationProvider,
    adapter_version: String(row.adapter_version) as GenerationJob['adapter_version'],
    source_mode: String(row.source_mode) as GenerationSourceMode,
    root_asset_id: String(row.root_asset_id),
    prompt: String(row.prompt),
    expected_output_count: Number(row.expected_output_count),
    status: row.status as GenerationJob['status'],
    output_dir: typeof row.output_dir === 'string' ? row.output_dir : undefined,
    handoff: parseJson<GenerationHandoffPacket>(String(row.handoff_json), {} as GenerationHandoffPacket),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    imported_at: typeof row.imported_at === 'string' ? row.imported_at : undefined,
    ...(targetPlan ? { target_plan: targetPlan } : {}),
    ...(sourceTargetResolutions.length > 0 ? { source_target_resolutions: sourceTargetResolutions } : {}),
    inputs,
    outputs,
    receipts,
  };
}

function insertReceipt(database: DatabaseSync, id: string, type: 'plan' | 'import' | 'error', command: string, payload: unknown): void {
  database.prepare(`
    insert into generation_job_receipts (id, job_id, receipt_type, status, command, payload_json, created_at)
    values (?, ?, ?, 'ok', ?, ?, ?)
  `).run(`${id}:receipt:${type}:${Date.now()}`, id, type, command, JSON.stringify(payload), nowIso());
}

function assertPlannedGenerationJobInTransaction(
  database: DatabaseSync,
  project: string,
  id: string,
): void {
  const row = database.prepare(
    'select status from generation_jobs where project_id = ? and id = ?',
  ).get(project, id) as { status?: string } | undefined;
  if (row?.status !== 'planned') {
    throw new GenerationReceiptError(`Generation job is not importable from status: ${row?.status ?? 'missing'}`, 409);
  }
}

export function cancelImageGeneration(
  project = defaultProject,
  fields: { jobId: string; confirmWrite: boolean },
): GenerationCancelResponse {
  if (!fields.jobId) throw new GenerationReceiptError('Missing --job-id');
  if (!fields.confirmWrite) throw new GenerationReceiptError('Generation cancellation requires --confirm-write');
  const database = lineageDb();
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      const job = loadGenerationJob(database, project, fields.jobId);
      if (job.status === 'cancelled') {
        database.exec('COMMIT');
        return { ok: true, command: 'generate image cancel', project, job, idempotent: true };
      }
      if (job.status !== 'planned') {
        throw new GenerationReceiptError(`Generation job is not cancellable from status: ${job.status}`, 409);
      }
      const timestamp = nowIso();
      const result = database.prepare(`
        update generation_jobs
        set status = 'cancelled', updated_at = ?
        where project_id = ? and id = ? and status = 'planned'
      `).run(timestamp, project, fields.jobId);
      if (Number(result.changes) !== 1) {
        throw new GenerationReceiptError('Generation job changed while cancellation was being applied', 409);
      }
      database.exec('COMMIT');
      return {
        ok: true,
        command: 'generate image cancel',
        project,
        job: loadGenerationJob(database, project, fields.jobId),
      };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

export function planImageGeneration(project = defaultProject, fields: {
  prompt: string;
  count?: number;
  dryRun?: boolean;
  fromLineageSelection: boolean;
  perBaseCount?: number;
  targetMap?: GenerationTargetMap;
  targetShorthand?: OutputTargetShorthand;
  fromNodeTargets?: boolean;
  expectedTargetResolutionDigest?: string;
  variantsPerTarget?: number;
  beforePersistForTesting?: () => void;
}): GenerationPlanResponse {
  const prompt = fields.prompt.trim();
  if (!prompt) throw new GenerationReceiptError('Missing --prompt');
  if (!fields.fromLineageSelection) throw new GenerationReceiptError('Generation v1 requires --from-lineage-selection');
  const next = resolveLineageSelection(project);
  const parentCount = selectedParents(next).length;
  const id = jobId();
  const inputs = inputsFrom(id, project, next);
  if (fields.fromNodeTargets && (fields.targetMap || fields.targetShorthand !== undefined)) {
    throw new GenerationReceiptError('Use locked node targets or an explicit target map, not both');
  }
  let sourceTargetResolutions: NonNullable<GenerationJob['source_target_resolutions']> | undefined;
  if (fields.fromNodeTargets) {
    if (!fields.expectedTargetResolutionDigest) {
      throw new GenerationReceiptError('Locked-from-node planning requires expectedTargetResolutionDigest from selection packet v3');
    }
    if (fields.variantsPerTarget !== undefined && !positiveInteger(fields.variantsPerTarget)) {
      throw new GenerationReceiptError('variantsPerTarget must be a positive integer');
    }
    const targetDatabase = lineageDb();
    try {
      sourceTargetResolutions = resolveNodeTargetSources(
        targetDatabase,
        project,
        next.root_asset_id,
        inputs,
      );
    } finally {
      targetDatabase.close();
    }
    const resolutionDigest = nodeTargetResolutionsDigest(sourceTargetResolutions);
    if (fields.expectedTargetResolutionDigest !== resolutionDigest) {
      throw new GenerationReceiptError(
        `Node target resolution changed: expected ${fields.expectedTargetResolutionDigest}, current ${resolutionDigest}`,
        409,
      );
    }
  }
  const shorthandRequested = fields.targetShorthand !== undefined;
  if (fields.targetMap && shorthandRequested) {
    throw new GenerationReceiptError('Use --target-map or destination/custom-dimension flags, not both');
  }
  if (shorthandRequested && inputs.length !== 1) {
    throw new GenerationReceiptError('Target-aware multi-source generation requires --target-map with an explicit mapping for every selected source');
  }
  const targetMap = fields.targetMap ?? (shorthandRequested
    ? generationTargetMapFromShorthand(inputs[0].asset_id, fields.targetShorthand ?? {})
    : undefined);
  const targetPlan = sourceTargetResolutions
    ? materializeNodeTargetPlan(id, sourceTargetResolutions, fields.variantsPerTarget ?? 1)
    : targetMap
      ? planGenerationTargets({ jobId: id, sourceAssetIds: inputs.map(input => input.asset_id), targetMap })
      : undefined;
  if (targetPlan && (fields.count !== undefined || fields.perBaseCount !== undefined)) {
    throw new GenerationReceiptError('Target-aware generation does not accept legacy --count or --per-base-count; use --variants-per-target or target-map variant_count');
  }
  if (!targetPlan && parentCount > 1 && !positiveInteger(fields.perBaseCount)) throw new GenerationReceiptError('Multi-parent generation requires --per-base-count');
  const perBaseCount = targetPlan ? 1 : parentCount > 1 ? Number(fields.perBaseCount) : Number(fields.count ?? fields.perBaseCount);
  const count = targetPlan?.expected_output_count ?? parentCount * perBaseCount;
  if (!targetPlan && !positiveInteger(perBaseCount)) throw new GenerationReceiptError('Generation count must be a positive integer');
  if (!targetPlan && fields.count !== undefined && fields.count !== count) throw new GenerationReceiptError(`Generation count mismatch: expected ${count} from selected bases, received ${fields.count}`);
  const targetOutputParents = targetPlan?.slots.map(slot => slot.parent_asset_id);
  const handoff = buildHandoff(project, id, prompt, count, perBaseCount, next, inputs, targetOutputParents, targetPlan);
  const mappings = targetPlan
    ? selectedParents(next).map(parent => ({
      parent_asset_id: parent.asset_id,
      output_indexes: targetPlan.slots.filter(slot => slot.parent_asset_id === parent.asset_id).map(slot => slot.output_index),
    }))
    : parentMappings(next, perBaseCount).map(mapping => ({ parent_asset_id: mapping.parent.asset_id, output_indexes: mapping.output_indexes }));
  const timestamp = nowIso();
  const preview: GenerationJob = {
    id,
    project_id: project,
    provider,
    adapter_version: targetPlan ? 'generation-receipts-v3' : manifestAdapterVersion,
    source_mode: 'lineage_selection',
    root_asset_id: next.root_asset_id,
    prompt,
    expected_output_count: count,
    status: 'planned',
    output_dir: '.asset-scratch',
    handoff,
    created_at: timestamp,
    updated_at: timestamp,
    ...(targetPlan ? { target_plan: targetPlan } : {}),
    ...(sourceTargetResolutions ? { source_target_resolutions: structuredClone(sourceTargetResolutions) } : {}),
    inputs,
    outputs: [],
    receipts: [{
      id: `${id}:receipt:plan:preview`,
      job_id: id,
      receipt_type: 'plan',
      status: 'ok',
      command: 'generate image plan',
      payload: {
        prompt,
        expected_output_count: count,
        per_base_count: !targetPlan && parentCount > 1 ? perBaseCount : undefined,
        lineage: handoff.lineage,
        parent_mappings: mappings,
        ...(targetPlan ? {
          target_map_digest: targetPlan.digest_sha256,
          target_groups: targetPlan.groups,
          output_slots: targetPlan.slots,
          ...(sourceTargetResolutions ? {
            source_target_resolutions: sourceTargetResolutions,
            source_target_resolution_digest: nodeTargetResolutionsDigest(sourceTargetResolutions),
          } : {}),
        } : {}),
      },
      created_at: timestamp,
    }],
  };
  if (fields.dryRun) return { ok: true, command: 'generate image plan', project, dryRun: true, wouldWrite: true, job: preview };

  const database = lineageDb();
  try {
    if (targetPlan) {
      if (sourceTargetResolutions) {
        fields.beforePersistForTesting?.();
        database.exec('BEGIN IMMEDIATE');
        try {
          const transactionalResolutions = resolveNodeTargetSources(
            database,
            project,
            next.root_asset_id,
            inputs,
          );
          const transactionalDigest = nodeTargetResolutionsDigest(transactionalResolutions);
          if (fields.expectedTargetResolutionDigest !== transactionalDigest) {
            throw new GenerationReceiptError(
              `Node target resolution changed: expected ${fields.expectedTargetResolutionDigest}, current ${transactionalDigest}`,
              409,
            );
          }
          const transactionalPlan = materializeNodeTargetPlan(
            id,
            transactionalResolutions,
            fields.variantsPerTarget ?? 1,
          );
          const transactionalHandoff = buildHandoff(
            project,
            id,
            prompt,
            transactionalPlan.expected_output_count,
            perBaseCount,
            next,
            inputs,
            transactionalPlan.slots.map(slot => slot.parent_asset_id),
            transactionalPlan,
          );
          persistTargetAwareGenerationAggregateInTransaction(database, {
            job: {
              id,
              project_id: project,
              provider,
              adapter_version: 'generation-receipts-v3',
              source_mode: 'lineage_selection',
              root_asset_id: next.root_asset_id,
              prompt,
              expected_output_count: transactionalPlan.expected_output_count,
              status: 'planned',
              output_dir: '.asset-scratch',
              handoff: transactionalHandoff,
              created_at: timestamp,
              updated_at: timestamp,
              inputs,
            },
            inputs,
            plan: transactionalPlan,
            sourceTargetResolutions: transactionalResolutions,
            receipt: {
              id: `${id}:receipt:plan:${Date.now()}`,
              command: 'generate image plan',
              payload: {
                ...(preview.receipts[0].payload as Record<string, unknown>),
                target_map_digest: transactionalPlan.digest_sha256,
                target_groups: transactionalPlan.groups,
                output_slots: transactionalPlan.slots,
                source_target_resolutions: transactionalResolutions,
                source_target_resolution_digest: transactionalDigest,
              },
              created_at: timestamp,
            },
          });
          database.exec('COMMIT');
          return { ok: true, command: 'generate image plan', project, job: loadGenerationJob(database, project, id) };
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      }
      persistTargetAwareGenerationAggregate(database, {
        job: {
          id,
          project_id: project,
          provider,
          adapter_version: 'generation-receipts-v3',
          source_mode: 'lineage_selection',
          root_asset_id: next.root_asset_id,
          prompt,
          expected_output_count: count,
          status: 'planned',
          output_dir: '.asset-scratch',
          handoff,
          created_at: timestamp,
          updated_at: timestamp,
          inputs,
        },
        inputs,
        plan: targetPlan,
        ...(sourceTargetResolutions ? { sourceTargetResolutions } : {}),
        receipt: {
          id: `${id}:receipt:plan:${Date.now()}`,
          command: 'generate image plan',
          payload: preview.receipts[0].payload,
          created_at: timestamp,
        },
      });
      return { ok: true, command: 'generate image plan', project, job: loadGenerationJob(database, project, id) };
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare(`
        insert into generation_jobs (
          id, project_id, provider, adapter_version, source_mode, root_asset_id, prompt,
          expected_output_count, status, output_dir, handoff_json, created_at, updated_at
        ) values (?, ?, ?, ?, 'lineage_selection', ?, ?, ?, 'planned', ?, ?, ?, ?)
      `).run(id, project, provider, manifestAdapterVersion, next.root_asset_id, prompt, count, '.asset-scratch', JSON.stringify(handoff), timestamp, timestamp);
      const insertInput = database.prepare('insert into generation_job_inputs (id, job_id, project_id, asset_id, root_asset_id, role, position, selection_strategy, selection_snapshot_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const input of inputs) insertInput.run(input.id, id, project, input.asset_id, input.root_asset_id, input.role, input.position, input.selection_strategy, JSON.stringify(next));
      insertReceipt(database, id, 'plan', 'generate image plan', preview.receipts[0].payload);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return { ok: true, command: 'generate image plan', project, job: loadGenerationJob(database, project, id) };
  } finally {
    database.close();
  }
}

function resolveNodeTargetSources(
  database: DatabaseSync,
  project: string,
  rootAssetId: string,
  inputs: readonly GenerationJobInput[],
): NonNullable<GenerationJob['source_target_resolutions']> {
  return inputs.map(input => {
    const effective = resolveEffectiveNodeNextOutputTargets(
      database,
      project,
      rootAssetId,
      input.asset_id,
    );
    if (effective.origin === 'unresolved') {
      throw new GenerationReceiptError(
        `Node ${input.asset_id} has no resolvable next-output targets; set explicit node targets or human canvas defaults first`,
      );
    }
    return {
      parent_asset_id: input.asset_id,
      origin: effective.origin,
      ...(effective.setting_revision === undefined ? {} : { setting_revision: effective.setting_revision }),
      ...(effective.setting_digest_sha256 ? { setting_digest_sha256: effective.setting_digest_sha256 } : {}),
      ...(effective.canvas_default_digest_sha256
        ? { canvas_default_digest_sha256: effective.canvas_default_digest_sha256 }
        : {}),
      resolution_digest_sha256: effective.resolution_digest_sha256,
      targets: structuredClone(effective.targets),
      resolved_targets: structuredClone(effective.resolved_targets),
    };
  });
}

export function planImageReroll(project = defaultProject, fields: {
  rootAssetId: string;
  targetAssetId: string;
  prompt: string;
  dryRun?: boolean;
  requestedDimensions?: { height: number; width: number };
}): GenerationPlanResponse {
  const prompt = fields.prompt.trim();
  if (!prompt) throw new GenerationReceiptError('Missing --prompt');
  if (!fields.rootAssetId) throw new GenerationReceiptError('Missing --root');
  if (!fields.targetAssetId) throw new GenerationReceiptError('Missing --target');
  const snapshot = getLineageSnapshot(project, fields.rootAssetId);
  const target = snapshot.nodes.find(node => node.asset_id === fields.targetAssetId);
  if (!target) throw new GenerationReceiptError(`Re-roll target is not in lineage: ${fields.targetAssetId}`, 404);
  const request = listLineageRerollRequests(project, snapshot.root_asset_id).requests.find(item => item.node_asset_id === fields.targetAssetId);
  if (!request) throw new GenerationReceiptError(`No pending re-roll request for ${fields.targetAssetId}`);
  const id = jobId();
  const timestamp = nowIso();
  const specDatabase = lineageDb();
  let inheritedSpec: ReturnType<typeof loadAssetOutputSpec>;
  try {
    inheritedSpec = loadAssetOutputSpec(specDatabase, target.asset_id);
  } finally {
    specDatabase.close();
  }
  if (
    inheritedSpec
    && fields.requestedDimensions
    && (
      fields.requestedDimensions.width !== inheritedSpec.output_spec.width
      || fields.requestedDimensions.height !== inheritedSpec.output_spec.height
    )
  ) {
    throw new GenerationReceiptError(
      'Geometry changes are child variations and must use durable node next-output targets. Set or replace the node targets, then use the branch planner.',
      409,
    );
  }
  const targetPlan = inheritedSpec ? inheritedRerollTargetPlan(id, target.asset_id, inheritedSpec) : undefined;
  const handoff = buildRerollHandoff(project, id, prompt, snapshot.root_asset_id, target, request, targetPlan);
  const input: GenerationJobInput = {
    id: `${id}:input:0`,
    job_id: id,
    project_id: project,
    asset_id: target.asset_id,
    root_asset_id: snapshot.root_asset_id,
    role: 'reroll_target',
    position: 0,
    selection_strategy: 'reroll_request',
    selection_snapshot: {
      project,
      root_asset_id: snapshot.root_asset_id,
      strategy: 'selected',
      selection_mode: 'single',
      recommended_action: 'evolve_variations',
      reason: 'user_selected',
      next_asset: target,
      next_assets: [target],
      latest: snapshot.latest,
      selected: [target.asset_id],
      selection: null,
      selections: [],
      candidates: snapshot.nodes,
      warnings: ['Re-roll target: import output as an attempt, not a lineage child.'],
      fetchedAt: timestamp,
    },
  };
  const preview: GenerationJob = {
    id,
    project_id: project,
    provider,
    adapter_version: targetPlan ? 'generation-receipts-v3' : legacyAdapterVersion,
    source_mode: 'lineage_reroll',
    root_asset_id: snapshot.root_asset_id,
    prompt,
    expected_output_count: 1,
    status: 'planned',
    output_dir: '.asset-scratch',
    handoff,
    created_at: timestamp,
    updated_at: timestamp,
    ...(targetPlan ? { target_plan: targetPlan } : {}),
    inputs: [input],
    outputs: [],
    receipts: [{
      id: `${id}:receipt:plan:preview`,
      job_id: id,
      receipt_type: 'plan',
      status: 'ok',
      command: 'reroll plan',
      payload: {
        prompt,
        expected_output_count: 1,
        lineage: handoff.lineage,
        reroll_request_id: request.id,
        ...(targetPlan ? {
          inherited_output_spec_digest: inheritedSpec?.output_spec_digest,
          target_groups: targetPlan.groups,
        } : {}),
      },
      created_at: timestamp,
    }],
  };
  if (fields.dryRun) return { ok: true, command: 'reroll plan', project, dryRun: true, wouldWrite: true, job: preview };
  const database = lineageDb();
  try {
    if (targetPlan) {
      persistTargetAwareGenerationAggregate(database, {
        job: {
          id,
          project_id: project,
          provider,
          adapter_version: 'generation-receipts-v3',
          source_mode: 'lineage_reroll',
          root_asset_id: snapshot.root_asset_id,
          prompt,
          expected_output_count: 1,
          status: 'planned',
          output_dir: '.asset-scratch',
          handoff,
          created_at: timestamp,
          updated_at: timestamp,
          inputs: [input],
        },
        inputs: [input],
        plan: targetPlan,
        receipt: {
          id: `${id}:receipt:plan:${Date.now()}`,
          command: 'reroll plan',
          payload: preview.receipts[0].payload,
          created_at: timestamp,
        },
      });
      return { ok: true, command: 'reroll plan', project, job: loadGenerationJob(database, project, id) };
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare(`
        insert into generation_jobs (
          id, project_id, provider, adapter_version, source_mode, root_asset_id, prompt,
          expected_output_count, status, output_dir, handoff_json, created_at, updated_at
        ) values (?, ?, ?, ?, 'lineage_reroll', ?, ?, 1, 'planned', ?, ?, ?, ?)
      `).run(id, project, provider, legacyAdapterVersion, snapshot.root_asset_id, prompt, '.asset-scratch', JSON.stringify(handoff), timestamp, timestamp);
      database.prepare('insert into generation_job_inputs (id, job_id, project_id, asset_id, root_asset_id, role, position, selection_strategy, selection_snapshot_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(input.id, id, project, input.asset_id, input.root_asset_id, input.role, input.position, input.selection_strategy, JSON.stringify(input.selection_snapshot));
      insertReceipt(database, id, 'plan', 'reroll plan', preview.receipts[0].payload);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return { ok: true, command: 'reroll plan', project, job: loadGenerationJob(database, project, id) };
  } finally {
    database.close();
  }
}

function parentForOutput(job: GenerationJob, outputIndex: number): string {
  const inputs = job.inputs.filter(input => input.role === 'lineage_next_base');
  if (inputs.length === 0) throw new GenerationReceiptError('Generation job has no lineage_next_base input');
  if (inputs.length === 1) return inputs[0].asset_id;
  if (job.expected_output_count % inputs.length !== 0) throw new GenerationReceiptError('Generation job has invalid parent mapping');
  return inputs[Math.floor(outputIndex / (job.expected_output_count / inputs.length))]?.asset_id || inputs[inputs.length - 1].asset_id;
}

function parentInputs(job: GenerationJob): GenerationJobInput[] {
  const inputs = job.inputs.filter(input => input.role === 'lineage_next_base');
  if (inputs.length === 0) throw new GenerationReceiptError('Generation job has no lineage_next_base input');
  return inputs;
}

function parentFilesFor(job: GenerationJob, parentFiles: Record<string, string[]>): Array<{ file: string; parentAssetId: string }> {
  const inputs = parentInputs(job);
  const expectedPerParent = job.expected_output_count / inputs.length;
  if (!Number.isInteger(expectedPerParent)) throw new GenerationReceiptError('Generation job has invalid parent mapping');
  const allowedParents = new Set(inputs.map(input => input.asset_id));
  const seenParents = new Set<string>();
  const mapped: Array<{ file: string; parentAssetId: string }> = [];
  for (const parentAssetId of Object.keys(parentFiles)) {
    if (!allowedParents.has(parentAssetId)) throw new GenerationReceiptError(`Unknown generation parent mapping: ${parentAssetId}`);
    if (seenParents.has(parentAssetId)) throw new GenerationReceiptError(`Duplicate generation parent mapping: ${parentAssetId}`);
    seenParents.add(parentAssetId);
  }
  for (const input of inputs) {
    const files = (parentFiles[input.asset_id] || []).map(file => file.trim()).filter(Boolean);
    if (files.length === 0) throw new GenerationReceiptError(`Missing generation parent mapping for ${input.asset_id}`);
    if (files.length !== expectedPerParent) throw new GenerationReceiptError(`Parent ${input.asset_id} requires ${expectedPerParent} output file${expectedPerParent === 1 ? '' : 's'}, received ${files.length}`);
    for (const file of files) mapped.push({ file, parentAssetId: input.asset_id });
  }
  return mapped;
}

function orderedFilesFor(job: GenerationJob, files: string[]): Array<{ file: string; parentAssetId: string }> {
  return files.map((file, index) => ({ file, parentAssetId: parentForOutput(job, index) }));
}

export function inspectImageGeneration(project = defaultProject, jobIdValue: string): GenerationInspectResponse {
  if (!jobIdValue) throw new GenerationReceiptError('Missing --job-id');
  const database = lineageDb();
  try {
    return { ok: true, command: 'generate image inspect', project, job: loadGenerationJob(database, project, jobIdValue) };
  } finally {
    database.close();
  }
}

function isPathInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return Boolean(rel) && !rel.startsWith('..') && !rel.startsWith('/');
}

function scratchCandidate(file: string): { candidate: string; scratchRoot: string } {
  const scratchRoot = resolve(repoRoot, '.asset-scratch');
  const candidate = file.startsWith('.asset-scratch/') || resolve(file).startsWith(scratchRoot)
    ? resolve(repoRoot, file)
    : resolve(scratchRoot, file);
  if (!isPathInside(candidate, scratchRoot)) throw new GenerationReceiptError(`Import file must be under .asset-scratch: ${file}`);
  return { candidate, scratchRoot };
}

function resolveScratchManifestPath(file: string): string {
  const { candidate, scratchRoot } = scratchCandidate(file);
  return relative(scratchRoot, candidate);
}

function resolveScratchFile(file: string): {
  absolutePath: string;
  relativePath: string;
  checksum: string;
  size: number;
  contentType: string;
  assetId: string;
} {
  const { candidate, scratchRoot } = scratchCandidate(file);
  if (!existsSync(candidate)) throw new GenerationReceiptError(`Missing import file: ${file}`, 404);
  const realScratchRoot = realpathSync(scratchRoot);
  const realCandidate = realpathSync(candidate);
  if (!isPathInside(realCandidate, realScratchRoot)) throw new GenerationReceiptError(`Import file must be under .asset-scratch: ${file}`);
  const stats = statSync(candidate);
  if (!stats.isFile()) throw new GenerationReceiptError(`Import path is not a file: ${file}`);
  const checksum = fileSha256(candidate);
  return {
    absolutePath: realCandidate,
    relativePath: relative(scratchRoot, candidate),
    checksum,
    size: stats.size,
    contentType: contentTypeFor(candidate),
    assetId: `local-${checksum.slice(0, 12)}`,
  };
}

interface GenerationImportRow {
  edgeSummary?: string;
  file: string;
  parentAssetId: string;
}

function generationManifestConflict(): never {
  throw new GenerationReceiptError('Generation import already exists with different output, summary, or provenance', 409);
}

function confirmManifestRetry(project: string, job: GenerationJob, manifest: GenerationOutputManifest): GenerationImportResponse {
  if (job.outputs.length !== manifest.outputs.length) generationManifestConflict();
  const database = lineageDb();
  try {
    for (const expected of manifest.outputs) {
      const recorded = job.outputs.find(output => output.output_index === expected.output_index);
      const current = resolveScratchFile(expected.file_path);
      if (
        !recorded
        || recorded.file_path !== expected.file_path
        || recorded.parent_asset_id !== expected.parent_asset_id
        || recorded.edge_summary !== expected.edge_summary
        || recorded.checksum_sha256 !== current.checksum
        || recorded.size_bytes !== current.size
      ) generationManifestConflict();
      const slot = job.target_plan?.slots.find(candidate => candidate.output_index === expected.output_index);
      if (slot?.output_spec) {
        const metadata = readStaticImageMetadata(current.absolutePath);
        if (metadata.width !== slot.output_spec.width || metadata.height !== slot.output_spec.height) generationManifestConflict();
      }
      const edge = database.prepare(`
        select summary, summary_created_by, summary_updated_by, summary_updated_at
        from asset_edges
        where project_id = ? and parent_asset_id = ? and child_asset_id = ? and relation_type = 'derived_from'
      `).get(project, recorded.parent_asset_id, recorded.imported_asset_id) as Record<string, unknown> | undefined;
      if (
        !edge
        || edge.summary !== expected.edge_summary
        || edge.summary_created_by !== 'agent'
        || edge.summary_updated_by !== 'agent'
        || typeof edge.summary_updated_at !== 'string'
        || edge.summary_updated_at.length === 0
      ) generationManifestConflict();
    }
    return { ok: true, command: 'generate image import', project, job, imported: job.outputs, idempotent: true };
  } finally {
    database.close();
  }
}

export function importImageGenerationOutputs(
  project = defaultProject,
  fields: { jobId: string; files?: string[]; parentFiles?: Record<string, string[]>; manifest?: unknown; confirmWrite: boolean },
): GenerationImportResponse {
  if (!fields.jobId) throw new GenerationReceiptError('Missing --job-id');
  if (!fields.confirmWrite) throw new GenerationReceiptError('Generation import requires --confirm-write');
  const database = lineageDb();
  let job: GenerationJob;
  try {
    job = loadGenerationJob(database, project, fields.jobId);
  } finally {
    database.close();
  }
  if (job.source_mode !== 'lineage_selection') throw new GenerationReceiptError(`Generation job is not an image-selection job: ${job.source_mode}`);

  const hasManifestInput = fields.manifest !== undefined;
  const hasParentFilesInput = fields.parentFiles !== undefined;
  const hasFilesInput = fields.files !== undefined;
  if (hasManifestInput && (hasParentFilesInput || hasFilesInput)) {
    throw new GenerationReceiptError('Use --manifest or legacy --files/--parent-files, not both');
  }
  if (hasParentFilesInput && hasFilesInput) throw new GenerationReceiptError('Use --files or --parent-files, not both');

  let manifest: GenerationOutputManifest | undefined;
  let parentFileRows: GenerationImportRow[];
  let mappingStrategy: 'generation_output_manifest_v1' | 'generation_output_manifest_v2' | 'explicit_parent_files' | 'ordered_per_base';
  if (job.adapter_version === manifestAdapterVersion || job.adapter_version === 'generation-receipts-v3') {
    if (!hasManifestInput) throw new GenerationReceiptError('New generation jobs require --manifest');
    manifest = parseGenerationOutputManifest(fields.manifest, job, { resolveFilePath: resolveScratchManifestPath });
    if (job.status === 'imported') return confirmManifestRetry(project, job, manifest);
    if (job.status !== 'planned') throw new GenerationReceiptError(`Generation job is not importable from status: ${job.status}`);
    parentFileRows = manifest.outputs.map(output => ({
      edgeSummary: output.edge_summary,
      file: output.file_path,
      parentAssetId: output.parent_asset_id,
    }));
    mappingStrategy = job.adapter_version === 'generation-receipts-v3'
      ? 'generation_output_manifest_v2'
      : 'generation_output_manifest_v1';
  } else if (job.adapter_version === legacyAdapterVersion) {
    if (hasManifestInput) throw new GenerationReceiptError('Already-planned legacy generation jobs require --files or --parent-files');
    if (job.status !== 'planned') throw new GenerationReceiptError(`Generation job is not importable from status: ${job.status}`);
    const hasExplicitParentFiles = Boolean(fields.parentFiles && Object.keys(fields.parentFiles).length > 0);
    parentFileRows = hasExplicitParentFiles
      ? parentFilesFor(job, fields.parentFiles || {})
      : orderedFilesFor(job, (fields.files || []).map(file => file.trim()).filter(Boolean));
    mappingStrategy = hasExplicitParentFiles ? 'explicit_parent_files' : 'ordered_per_base';
  } else {
    throw new GenerationReceiptError(`Unsupported generation adapter version: ${job.adapter_version}`);
  }
  if (parentFileRows.length === 0) throw new GenerationReceiptError('Generation import requires --files or --parent-files');
  if (parentFileRows.length !== job.expected_output_count) {
    throw new GenerationReceiptError(`Output count mismatch: expected ${job.expected_output_count}, received ${parentFileRows.length}`);
  }
  const resolved = parentFileRows.map((row, outputIndex) => {
    const file = resolveScratchFile(row.file);
    const slot = job.target_plan?.slots.find(candidate => candidate.output_index === outputIndex);
    let metadata: StaticImageMetadata | undefined;
    if (slot?.output_spec) {
      try {
        metadata = readStaticImageMetadata(file.absolutePath);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new GenerationReceiptError(
          `Generation job ${job.id} output ${outputIndex} for parent ${row.parentAssetId} `
          + `target group ${slot.group_id} must decode as PNG, JPEG, or WebP at `
          + `${slot.output_spec.width}x${slot.output_spec.height}: ${detail}. Replace the file and retry the same import command.`,
        );
      }
      if (metadata.width !== slot.output_spec.width || metadata.height !== slot.output_spec.height) {
        const destinations = slot.output_spec.delivery_surfaces
          .map(surface => `${surface.platform} ${surface.surface}`)
          .join(', ') || 'custom dimensions';
        throw new GenerationReceiptError(
          `Generation job ${job.id} output ${outputIndex} for parent ${row.parentAssetId} `
          + `target group ${slot.group_id} (${destinations}) requires `
          + `${slot.output_spec.width}x${slot.output_spec.height} pixels, decoded `
          + `${metadata.width}x${metadata.height}. Replace the file with the exact locked pixels and retry the same import command.`,
        );
      }
    }
    return {
      ...file,
      ...(metadata ? { contentType: metadata.contentType, metadata } : {}),
      edgeSummary: row.edgeSummary,
      parentAssetId: row.parentAssetId,
      slot,
    };
  });
  const uniquePaths = new Set(resolved.map(file => file.relativePath));
  if (uniquePaths.size !== resolved.length) throw new GenerationReceiptError('Generation import files must be unique');
  const targetAware = job.adapter_version === 'generation-receipts-v3';
  if (!targetAware) {
    cancelLineageIterateTasksForAssets(project, {
      actor: 'system',
      confirmWrite: false,
      rootAssetId: job.root_asset_id,
    });
    indexLineageAssets(project);
  }
  const writeDb = lineageDb();
  try {
    const timestamp = nowIso();
    writeDb.exec('BEGIN IMMEDIATE');
    try {
      assertPlannedGenerationJobInTransaction(writeDb, project, fields.jobId);
      for (const [index, file] of resolved.entries()) {
        if (targetAware) {
          indexImportedLineageAssetInTransaction(writeDb, project, {
            assetId: file.assetId,
            checksumSha256: file.checksum,
            contentType: file.contentType,
            relativePath: file.relativePath,
            sizeBytes: file.size,
          });
        }
        const assetRow = writeDb.prepare('select id from assets where project_id = ? and id = ?').get(project, file.assetId);
        if (!assetRow) throw new GenerationReceiptError(`Indexed local asset was not found: ${file.relativePath}`);
        const outputId = `${fields.jobId}:output:${index}`;
        writeDb.prepare(`insert into generation_job_outputs (
          id, job_id, project_id, output_index, file_path, checksum_sha256, size_bytes, content_type,
          imported_asset_id, parent_asset_id, imported_at, edge_summary
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          outputId, fields.jobId, project, index, file.relativePath, file.checksum, file.size,
          file.contentType, file.assetId, file.parentAssetId, timestamp, file.edgeSummary || null,
        );
        const insertedEdge = writeDb.prepare(`insert into asset_edges (
          id, project_id, parent_asset_id, child_asset_id, relation_type, created_at,
          summary, summary_created_by, summary_updated_by, summary_updated_at
        ) values (?, ?, ?, ?, 'derived_from', ?, ?, ?, ?, ?)
        on conflict(project_id, parent_asset_id, child_asset_id, relation_type) do nothing`).run(
          `${project}:${file.parentAssetId}:derived_from:${file.assetId}`,
          project,
          file.parentAssetId,
          file.assetId,
          timestamp,
          file.edgeSummary || null,
          file.edgeSummary ? 'agent' : null,
          file.edgeSummary ? 'agent' : null,
          file.edgeSummary ? timestamp : null,
        );
        if (file.edgeSummary && insertedEdge.changes === 0) {
          const edge = writeDb.prepare(`
            select summary, summary_created_by, summary_updated_by, summary_updated_at
            from asset_edges
            where project_id = ? and parent_asset_id = ? and child_asset_id = ? and relation_type = 'derived_from'
          `).get(project, file.parentAssetId, file.assetId) as Record<string, unknown> | undefined;
          if (
            !edge
            || edge.summary !== file.edgeSummary
            || edge.summary_created_by !== 'agent'
            || edge.summary_updated_by !== 'agent'
            || typeof edge.summary_updated_at !== 'string'
            || edge.summary_updated_at.length === 0
          ) generationManifestConflict();
        }
        if (targetAware && file.slot?.output_spec && file.metadata) {
          const digest = generationOutputSpecDigest(file.slot.output_spec);
          if (!digest) throw new GenerationReceiptError(`Generation output ${index} is missing its locked output specification digest`);
          persistAssetOutputSpec(writeDb, {
            actual_height: file.metadata.height,
            actual_width: file.metadata.width,
            asset_id: file.assetId,
            created_at: timestamp,
            generation_job_id: fields.jobId,
            output_index: index,
            output_spec: file.slot.output_spec,
            output_spec_digest: digest,
            target_group_id: file.slot.group_id,
            variant_index: file.slot.variant_index,
          });
          initializeChildNextOutputTargetsInTransaction(writeDb, {
            projectId: project,
            rootAssetId: job.root_asset_id,
            nodeAssetId: file.assetId,
            outputSpec: file.slot.output_spec,
            timestamp,
          });
        }
      }
      const jobUpdate = writeDb.prepare(`
        update generation_jobs
        set status = 'imported', imported_at = ?, updated_at = ?
        where project_id = ? and id = ? and status = 'planned'
      `).run(timestamp, timestamp, project, fields.jobId);
      if (Number(jobUpdate.changes) !== 1) {
        throw new GenerationReceiptError('Generation job changed while import was being applied', 409);
      }
      insertReceipt(writeDb, fields.jobId, 'import', 'generate image import', {
        mapping_strategy: mappingStrategy,
        files: resolved.map((file, index) => ({
          output_index: index,
          file_path: file.relativePath,
          imported_asset_id: file.assetId,
          parent_asset_id: file.parentAssetId,
          ...(file.metadata ? {
            actual_dimensions: { height: file.metadata.height, width: file.metadata.width },
            output_spec_digest: generationOutputSpecDigest(file.slot?.output_spec),
          } : {}),
          ...(file.edgeSummary ? { edge_summary: file.edgeSummary } : {}),
        })),
        selection_reset: { root_asset_id: job.root_asset_id, cleared: true },
      });
      writeDb.prepare('delete from asset_selections where project_id = ? and root_asset_id = ?').run(project, job.root_asset_id);
      if (targetAware) cancelPendingLineageIterateTasksInTransaction(writeDb, project, job.root_asset_id);
      writeDb.exec('COMMIT');
    } catch (error) {
      writeDb.exec('ROLLBACK');
      throw error;
    }
    if (!targetAware) {
      cancelLineageIterateTasksForAssets(project, {
        actor: 'system',
        confirmWrite: true,
        rootAssetId: job.root_asset_id,
      });
    }
    const importedJob = loadGenerationJob(writeDb, project, fields.jobId);
    return { ok: true, command: 'generate image import', project, job: importedJob, imported: importedJob.outputs };
  } finally {
    writeDb.close();
  }
}

export function importImageRerollOutput(project = defaultProject, fields: { jobId: string; file: string; confirmWrite: boolean }): GenerationImportResponse {
  if (!fields.jobId) throw new GenerationReceiptError('Missing --job-id');
  if (!fields.confirmWrite) throw new GenerationReceiptError('Generation import requires --confirm-write');
  const database = lineageDb();
  let job: GenerationJob;
  try {
    job = loadGenerationJob(database, project, fields.jobId);
  } finally {
    database.close();
  }
  if (job.source_mode !== 'lineage_reroll') throw new GenerationReceiptError(`Generation job is not a re-roll job: ${job.source_mode}`);
  const target = job.inputs.filter(input => input.role === 'reroll_target');
  if (target.length !== 1) throw new GenerationReceiptError('Re-roll import requires exactly one reroll_target input');
  const resolved = resolveScratchFile(fields.file);
  if (job.status === 'imported') {
    const recorded = job.outputs[0];
    if (
      job.outputs.length === 1
      && recorded?.file_path === resolved.relativePath
      && recorded.checksum_sha256 === resolved.checksum
      && recorded.parent_asset_id === target[0].asset_id
    ) {
      return { ok: true, command: 'reroll import', project, job, imported: job.outputs, idempotent: true };
    }
    generationManifestConflict();
  }
  if (job.status !== 'planned') throw new GenerationReceiptError(`Generation job is not importable from status: ${job.status}`);
  const lockedSpec = job.target_plan?.slots[0]?.output_spec;
  let metadata: StaticImageMetadata | undefined;
  if (lockedSpec) {
    try {
      metadata = readStaticImageMetadata(resolved.absolutePath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new GenerationReceiptError(
        `Re-roll job ${job.id} for locked node ${target[0].asset_id} must decode as PNG, JPEG, or WebP `
        + `at ${lockedSpec.width}x${lockedSpec.height}: ${detail}. Replace the file and retry the same import command.`,
      );
    }
    if (metadata.width !== lockedSpec.width || metadata.height !== lockedSpec.height) {
      throw new GenerationReceiptError(
        `Re-roll job ${job.id} cannot mutate locked node ${target[0].asset_id} from `
        + `${lockedSpec.width}x${lockedSpec.height} to ${metadata.width}x${metadata.height}. `
        + 'Create a child variation for different geometry, or replace the file and retry this re-roll.',
      );
    }
  }
  const targetAware = Boolean(lockedSpec);
  if (!targetAware) indexLineageAssets(project);
  const writeDb = lineageDb();
  try {
    const timestamp = nowIso();
    writeDb.exec('BEGIN IMMEDIATE');
    try {
      assertPlannedGenerationJobInTransaction(writeDb, project, fields.jobId);
      if (targetAware) {
        indexImportedLineageAssetInTransaction(writeDb, project, {
          assetId: resolved.assetId,
          checksumSha256: resolved.checksum,
          contentType: metadata?.contentType || resolved.contentType,
          relativePath: resolved.relativePath,
          sizeBytes: resolved.size,
        });
      }
      const assetRow = writeDb.prepare('select id from assets where project_id = ? and id = ?').get(project, resolved.assetId);
      if (!assetRow) throw new GenerationReceiptError(`Indexed local asset was not found: ${resolved.relativePath}`);
      const outputId = `${fields.jobId}:output:0`;
      writeDb.prepare(`insert into generation_job_outputs (
        id, job_id, project_id, output_index, file_path, checksum_sha256, size_bytes, content_type, imported_asset_id, parent_asset_id, imported_at
      ) values (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`).run(outputId, fields.jobId, project, resolved.relativePath, resolved.checksum, resolved.size, resolved.contentType, resolved.assetId, target[0].asset_id, timestamp);
      const jobUpdate = writeDb.prepare(`
        update generation_jobs
        set status = 'imported', imported_at = ?, updated_at = ?
        where project_id = ? and id = ? and status = 'planned'
      `).run(timestamp, timestamp, project, fields.jobId);
      if (Number(jobUpdate.changes) !== 1) {
        throw new GenerationReceiptError('Generation job changed while import was being applied', 409);
      }
      insertReceipt(writeDb, fields.jobId, 'import', 'reroll import', {
        file: { output_index: 0, file_path: resolved.relativePath, imported_asset_id: resolved.assetId, parent_asset_id: target[0].asset_id },
        reroll: { root_asset_id: job.root_asset_id, node_asset_id: target[0].asset_id },
        ...(metadata ? {
          actual_dimensions: { height: metadata.height, width: metadata.width },
          inherited_output_spec_digest: generationOutputSpecDigest(lockedSpec),
        } : {}),
      });
      if (targetAware) {
        recordLineageRerollAttemptInTransaction(writeDb, project, {
          rootAssetId: job.root_asset_id,
          nodeAssetId: target[0].asset_id,
          assetId: resolved.assetId,
          prompt: job.prompt,
          generationJobId: fields.jobId,
          filePath: resolved.relativePath,
          checksumSha256: resolved.checksum,
        });
        resolvePendingLineageRerollTaskInTransaction(writeDb, project, {
          actor: 'agent',
          resolvedAssetId: resolved.assetId,
          resolvedGenerationJobId: fields.jobId,
          rootAssetId: job.root_asset_id,
          targetAssetId: target[0].asset_id,
        });
      }
      writeDb.exec('COMMIT');
    } catch (error) {
      writeDb.exec('ROLLBACK');
      throw error;
    }
    if (!targetAware) {
      recordLineageRerollAttempt(project, {
        rootAssetId: job.root_asset_id,
        nodeAssetId: target[0].asset_id,
        assetId: resolved.assetId,
        prompt: job.prompt,
        generationJobId: fields.jobId,
        filePath: resolved.relativePath,
        checksumSha256: resolved.checksum,
        confirmWrite: true,
      });
      const rerollTask = listLineageTasks(project, job.root_asset_id).tasks.find(task => task.task_type === 'reroll' && task.target_asset_id === target[0].asset_id);
      if (rerollTask) {
        resolveLineageTask(project, {
          actor: 'agent',
          confirmWrite: true,
          resolvedAssetId: resolved.assetId,
          resolvedGenerationJobId: fields.jobId,
          taskId: rerollTask.id,
        });
      }
    }
    const importedJob = loadGenerationJob(writeDb, project, fields.jobId);
    return { ok: true, command: 'reroll import', project, job: importedJob, imported: importedJob.outputs };
  } finally {
    writeDb.close();
  }
}
