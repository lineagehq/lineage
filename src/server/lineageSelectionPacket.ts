import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { listAssets, repoRoot, validateProject } from './assetCore';
import { getLineageSnapshot } from './assetLineage';
import { lineageDb, lineageDbPath } from './assetLineageDb';
import { loadAssetOutputSpec } from './generationTargetPersistence';
import {
  nodeTargetResolutionsDigest,
  resolveEffectiveNodeNextOutputTargets,
} from './nodeNextOutputTargets';
import { lineageWorkspaceId, listLineageWorkspaces } from './assetLineageWorkspaces';
import { contentTypeFor, fileSha256 } from './localReview';
import type {
  GrowthAsset,
  LineageNode,
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
  LineageWorkspace,
} from '../shared/types';

export interface LineageSelectionPacketOptions {
  campaign?: string;
  channel?: string;
  command?: string;
  contextNotes?: string;
  dbPath?: string;
  labels?: string[];
  packageVersion?: string;
  rootAssetId?: string;
  schema?: 'v2' | 'v3';
  strict?: boolean;
  workspaceId?: string;
}

export class LineageSelectionPacketError extends Error {
  constructor(
    message: string,
    public warnings: string[] = [],
    public errors: string[] = [],
    public diagnostics: LineageSelectionPacketDiagnostic[] = [],
  ) {
    super(message);
  }
}

function listAllAssets(project: string): GrowthAsset[] {
  const pageSize = 100;
  const first = listAssets(project, { page: 1, pageSize, source: 'all' });
  const assets = [...first.assets];
  for (let page = 2; page <= first.pagination.totalPages; page += 1) {
    assets.push(...listAssets(project, { page, pageSize, source: 'all' }).assets);
  }
  return assets;
}

function resolveWorkspace(project: string, options: LineageSelectionPacketOptions): LineageWorkspace {
  if (options.rootAssetId && options.workspaceId) {
    throw new LineageSelectionPacketError('Use either --root or --workspace, not both.', [], ['ambiguous_workspace']);
  }
  const snapshot = listLineageWorkspaces(project);
  const target = options.workspaceId || options.rootAssetId;
  const workspace = target
    ? snapshot.workspaces.find(item => item.id === target || item.root_asset_id === target)
    : snapshot.active_workspace;
  if (workspace) return workspace;
  if (options.rootAssetId) {
    return {
      id: lineageWorkspaceId(project, options.rootAssetId),
      project,
      root_asset_id: options.rootAssetId,
      title: `${options.rootAssetId} lineage`,
      status: 'active',
      created_by: 'system',
      created_at: '',
      updated_at: '',
    };
  }
  const message = options.workspaceId
    ? `Unknown lineage workspace: ${options.workspaceId}`
    : 'No active lineage workspace. Pass --root or activate a workspace first.';
  throw new LineageSelectionPacketError(message, [], [options.workspaceId ? 'unknown_workspace' : 'missing_active_workspace']);
}

function resolveLocalReference(reference?: string): string | undefined {
  if (!reference) return undefined;
  if (isAbsolute(reference)) return reference;
  const repoRelative = resolve(repoRoot, reference);
  if (existsSync(repoRelative)) return repoRelative;
  return resolve(repoRoot, '.asset-scratch', reference);
}

function fileSize(path?: string): number | undefined {
  if (!path || !existsSync(path)) return undefined;
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

function storageState(hasLocal: boolean, hasS3: boolean): LineageSelectionPacketStorageState {
  if (hasLocal && hasS3) return 'local_and_s3';
  if (hasLocal) return 'local_only';
  if (hasS3) return 's3_backed';
  return 'unresolved';
}

function currentAttemptFor(node: LineageNode): LineageSelectionPacketAsset['current_attempt'] {
  if (!node.current_attempt) return undefined;
  return {
    asset_id: node.current_attempt.asset_id,
    checksum_sha256: node.current_attempt.checksum_sha256,
    file_path: node.current_attempt.file_path,
    generation_job_id: node.current_attempt.generation_job_id,
    id: node.current_attempt.id,
    is_current: node.current_attempt.is_current,
    source: node.current_attempt.source,
  };
}

function lockedDimensions(assetId: string): { height: number; width: number } | undefined {
  const database = lineageDb();
  try {
    const outputSpec = loadAssetOutputSpec(database, assetId);
    return outputSpec
      ? { height: outputSpec.output_spec.height, width: outputSpec.output_spec.width }
      : undefined;
  } finally {
    database.close();
  }
}

function assetForNode(node: LineageNode, catalogAsset: GrowthAsset | undefined, warnings: string[]): LineageSelectionPacketAsset {
  const localReference = catalogAsset?.local?.absolute_path || node.current_attempt?.file_path || node.local_path || catalogAsset?.local?.relative_path;
  const absolutePath = catalogAsset?.local?.absolute_path || resolveLocalReference(localReference);
  const localExists = absolutePath ? existsSync(absolutePath) : false;
  const hasLocalClaim = Boolean(absolutePath || node.local_path || catalogAsset?.local?.relative_path);
  const s3Key = catalogAsset?.s3?.key || node.s3_key;
  const hasS3 = Boolean(s3Key);
  const checksum = catalogAsset?.local?.checksum_sha256 || node.current_attempt?.checksum_sha256 || node.checksum_sha256 || catalogAsset?.s3?.checksum_sha256;
  const mimeType = catalogAsset?.local?.content_type || catalogAsset?.s3?.content_type;
  const mediaType = catalogAsset?.content_type || node.media_type;

  if (hasLocalClaim && !localExists) warnings.push(`Selected asset ${node.asset_id} has a local path but the file is missing: ${absolutePath || node.local_path}`);
  if (!hasLocalClaim && !hasS3) warnings.push(`Selected asset ${node.asset_id} has neither a local file nor S3 key.`);
  if (mediaType && mediaType !== 'image' && mediaType !== 'gif') warnings.push(`Selected asset ${node.asset_id} is ${mediaType}, not an image/gif asset.`);

  return {
    asset_id: node.asset_id,
    branch_prompt: node.branch_prompt || node.selection_note,
    campaign: catalogAsset?.campaign || node.campaign,
    channel: catalogAsset?.channel || node.channel,
    checksum_sha256: checksum,
    current_attempt: currentAttemptFor(node),
    dimensions: lockedDimensions(node.asset_id),
    local: {
      absolute_path: absolutePath,
      content_type: catalogAsset?.local?.content_type,
      exists: localExists,
      relative_path: catalogAsset?.local?.relative_path || node.local_path || node.current_attempt?.file_path,
      size_bytes: catalogAsset?.local?.size_bytes || fileSize(absolutePath),
    },
    media_type: mediaType,
    mime_type: mimeType,
    review_notes: node.review_notes,
    review_state: node.review_state,
    s3: {
      bucket: catalogAsset?.s3?.bucket,
      checksum_sha256: catalogAsset?.s3?.checksum_sha256,
      content_type: catalogAsset?.s3?.content_type,
      etag: catalogAsset?.s3?.etag,
      key: s3Key,
      region: catalogAsset?.s3?.region,
      size_bytes: catalogAsset?.s3?.size_bytes,
      version_id: catalogAsset?.s3?.version_id,
    },
    selection_note: node.selection_note,
    source: catalogAsset?.source || node.source,
    status: catalogAsset?.status || node.status,
    storage_state: storageState(hasLocalClaim, hasS3),
    title: catalogAsset?.title || node.title || node.asset_id,
  };
}

function packetId(packetIdentity: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(packetIdentity)).digest('hex').slice(0, 24);
  return `lineage_packet_${digest}`;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => canonicalValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalLineageSelectionPacketIdentityJson(projection: LineageSelectionPacketV2IdentityProjection): string {
  return JSON.stringify(canonicalValue(projection));
}

export function lineageSelectionPacketV2IdentityProjection(packet: LineageSelectionPacketV2): LineageSelectionPacketV2IdentityProjection {
  const assetsById = new Map(packet.assets.map(asset => [asset.asset_id, asset]));
  const selection = packet.selection.items.map(item => {
    const asset = assetsById.get(item.asset_id);
    if (!asset) {
      const diagnostics: LineageSelectionPacketDiagnostic[] = [{ asset_id: item.asset_id, code: 'selected_asset_missing', severity: 'error' }];
      throw new LineageSelectionPacketError(
        `Selected asset ${item.asset_id} is absent from the v2 packet asset envelope.`,
        [],
        ['selected_asset_missing'],
        diagnostics,
      );
    }
    return {
      asset_id: item.asset_id,
      branch_prompt: item.branch_prompt || item.selection_note,
      campaign: asset.campaign,
      channel: asset.channel,
      current_attempt: {
        asset_id: asset.current_attempt.asset_id,
        attempt_index: asset.current_attempt.attempt_index,
        checksum_sha256: asset.current_attempt.checksum_sha256,
        id: asset.current_attempt.id,
        source: asset.current_attempt.source,
      },
      dimensions: asset.dimensions,
      media_type: asset.media_type,
      mime_type: asset.mime_type,
      position: item.position,
      selection_note: item.selection_note,
      title: asset.title,
    };
  });
  return {
    schema_version: 'lineage.selection_packet.v2',
    project: packet.project,
    product: packet.product,
    workspace: {
      id: packet.workspace.id,
      root_asset_id: packet.workspace.root_asset_id,
    },
    context: {
      campaign: packet.context.campaign,
      channel: packet.context.channel,
      labels: packet.context.labels,
      notes: packet.context.notes,
    },
    selection,
    diagnostics: packet.diagnostics.map(diagnostic => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      ...(diagnostic.asset_id ? { asset_id: diagnostic.asset_id } : {}),
    })),
  };
}

export function lineageSelectionPacketV2IdentitySha256(packet: LineageSelectionPacketV2): string {
  const projection = lineageSelectionPacketV2IdentityProjection(packet);
  return createHash('sha256').update(canonicalLineageSelectionPacketIdentityJson(projection)).digest('hex');
}

export function lineageSelectionPacketV3IdentityProjection(packet: LineageSelectionPacketV3): LineageSelectionPacketV3IdentityProjection {
  const assetsById = new Map(packet.assets.map(asset => [asset.asset_id, asset]));
  return {
    schema_version: 'lineage.selection_packet.v3',
    project: packet.project,
    product: packet.product,
    workspace: {
      id: packet.workspace.id,
      root_asset_id: packet.workspace.root_asset_id,
    },
    context: {
      campaign: packet.context.campaign,
      channel: packet.context.channel,
      labels: packet.context.labels,
      notes: packet.context.notes,
    },
    selection: packet.selection.items.map(item => {
      const asset = assetsById.get(item.asset_id);
      if (!asset) {
        const diagnostics: LineageSelectionPacketDiagnostic[] = [{
          asset_id: item.asset_id,
          code: 'selected_asset_missing',
          severity: 'error',
        }];
        throw new LineageSelectionPacketError(
          `Selected asset ${item.asset_id} is absent from the v3 packet asset envelope.`,
          [],
          ['selected_asset_missing'],
          diagnostics,
        );
      }
      return {
        asset_id: item.asset_id,
        branch_prompt: item.branch_prompt || item.selection_note,
        campaign: asset.campaign,
        channel: asset.channel,
        current_attempt: {
          asset_id: asset.current_attempt.asset_id,
          attempt_index: asset.current_attempt.attempt_index,
          checksum_sha256: asset.current_attempt.checksum_sha256,
          id: asset.current_attempt.id,
          source: asset.current_attempt.source,
        },
        current_geometry: structuredClone(asset.current_geometry),
        media_type: asset.media_type,
        mime_type: asset.mime_type,
        next_output_targets: structuredClone(asset.next_output_targets),
        position: item.position,
        selection_note: item.selection_note,
        title: asset.title,
      };
    }),
    diagnostics: packet.diagnostics.map(diagnostic => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      ...(diagnostic.asset_id ? { asset_id: diagnostic.asset_id } : {}),
    })),
    selected_source_resolution_digest_sha256: packet.selected_source_resolution_digest_sha256,
  };
}

export function lineageSelectionPacketV3IdentitySha256(packet: LineageSelectionPacketV3): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue(lineageSelectionPacketV3IdentityProjection(packet))))
    .digest('hex');
}

function addDiagnostic(diagnostics: LineageSelectionPacketDiagnostic[], diagnostic: LineageSelectionPacketDiagnostic): void {
  if (diagnostics.some(item => item.code === diagnostic.code && item.severity === diagnostic.severity && item.asset_id === diagnostic.asset_id)) return;
  diagnostics.push(diagnostic);
}

function requireV2CurrentAttempt(
  node: LineageNode,
  warnings: string[],
  diagnostics: LineageSelectionPacketDiagnostic[],
): LineageSelectionPacketV2Attempt {
  const attempt = node.current_attempt;
  if (!attempt) {
    const message = `Selected asset ${node.asset_id} has no current attempt identity.`;
    const diagnostic = { asset_id: node.asset_id, code: 'current_attempt_missing', severity: 'error' } as const;
    throw new LineageSelectionPacketError(message, warnings, ['current_attempt_missing'], [...diagnostics, diagnostic]);
  }
  if (!attempt.id || !attempt.asset_id || !Number.isInteger(attempt.attempt_index) || attempt.attempt_index <= 0 || !attempt.source || attempt.is_current !== true) {
    const message = `Selected asset ${node.asset_id} has malformed current attempt identity.`;
    const diagnostic = { asset_id: node.asset_id, code: 'current_attempt_invalid_identity', severity: 'error' } as const;
    throw new LineageSelectionPacketError(message, warnings, ['current_attempt_invalid_identity'], [...diagnostics, diagnostic]);
  }
  if (!attempt.checksum_sha256 || !SHA256_PATTERN.test(attempt.checksum_sha256)) {
    const message = `Selected asset ${node.asset_id} current attempt does not have a valid lowercase SHA-256 checksum.`;
    const diagnostic = { asset_id: node.asset_id, code: 'current_attempt_invalid_checksum', severity: 'error' } as const;
    throw new LineageSelectionPacketError(message, warnings, ['current_attempt_invalid_checksum'], [...diagnostics, diagnostic]);
  }
  return {
    asset_id: attempt.asset_id,
    attempt_index: attempt.attempt_index,
    checksum_sha256: attempt.checksum_sha256,
    file_path: attempt.file_path,
    generation_job_id: attempt.generation_job_id,
    id: attempt.id,
    is_current: attempt.is_current,
    source: attempt.source,
  };
}

function assetForNodeV2(
  node: LineageNode,
  visibleCatalogAsset: GrowthAsset | undefined,
  catalogById: Map<string, GrowthAsset>,
  warnings: string[],
  errors: string[],
  diagnostics: LineageSelectionPacketDiagnostic[],
): LineageSelectionPacketV2Asset {
  const currentAttempt = requireV2CurrentAttempt(node, warnings, diagnostics);
  const currentAttemptCatalogAsset = catalogById.get(currentAttempt.asset_id);
  const isVisibleNodeAttempt = currentAttempt.asset_id === node.asset_id;
  const mediaCatalogAsset = currentAttemptCatalogAsset || (isVisibleNodeAttempt ? visibleCatalogAsset : undefined);
  const localReference = currentAttempt.file_path
    || mediaCatalogAsset?.local?.absolute_path
    || mediaCatalogAsset?.local?.relative_path
    || (isVisibleNodeAttempt ? node.local_path : undefined);
  const absolutePath = resolveLocalReference(localReference);
  const localExists = absolutePath ? existsSync(absolutePath) : false;
  const hasLocalClaim = Boolean(localReference);
  const s3Key = mediaCatalogAsset?.s3?.key || (isVisibleNodeAttempt ? node.s3_key : undefined);
  const hasS3 = Boolean(s3Key);
  const mimeType = mediaCatalogAsset?.local?.content_type
    || mediaCatalogAsset?.s3?.content_type
    || visibleCatalogAsset?.local?.content_type
    || visibleCatalogAsset?.s3?.content_type
    || (localReference ? contentTypeFor(localReference) : undefined);
  const mediaType = mediaCatalogAsset?.content_type || visibleCatalogAsset?.content_type || node.media_type;

  if (localExists && absolutePath && fileSha256(absolutePath) !== currentAttempt.checksum_sha256) {
    const message = `Selected asset ${node.asset_id} current attempt checksum does not match its local file.`;
    const diagnostic = { asset_id: node.asset_id, code: 'current_attempt_checksum_mismatch', severity: 'error' } as const;
    throw new LineageSelectionPacketError(message, [...warnings, message], ['current_attempt_checksum_mismatch'], [...diagnostics, diagnostic]);
  }
  const s3Checksum = mediaCatalogAsset?.s3?.checksum_sha256;
  if (hasS3 && s3Checksum && s3Checksum !== currentAttempt.checksum_sha256) {
    const message = `Selected asset ${node.asset_id} current attempt checksum does not match its S3 media envelope.`;
    const diagnostic = { asset_id: node.asset_id, code: 'current_attempt_checksum_mismatch', severity: 'error' } as const;
    throw new LineageSelectionPacketError(message, [...warnings, message], ['current_attempt_checksum_mismatch'], [...diagnostics, diagnostic]);
  }

  if (hasLocalClaim && !localExists) {
    warnings.push(`Selected asset ${node.asset_id} current attempt has a local path but the file is missing: ${absolutePath || localReference}`);
  }
  if (!hasLocalClaim && !hasS3) {
    const message = `Selected asset ${node.asset_id} current attempt has neither a local file nor S3 key.`;
    warnings.push(message);
    errors.push(message);
  }
  if (mediaType && mediaType !== 'image' && mediaType !== 'gif') {
    warnings.push(`Selected asset ${node.asset_id} is ${mediaType}, not an image/gif asset.`);
    addDiagnostic(diagnostics, { asset_id: node.asset_id, code: 'unsupported_media_type', severity: 'warning' });
  }

  const conflictingChecksums = [
    currentAttemptCatalogAsset?.local?.checksum_sha256,
    currentAttemptCatalogAsset?.s3?.checksum_sha256,
    visibleCatalogAsset?.local?.checksum_sha256,
    visibleCatalogAsset?.s3?.checksum_sha256,
    node.checksum_sha256,
  ].filter((checksum): checksum is string => Boolean(checksum && checksum !== currentAttempt.checksum_sha256));
  if (conflictingChecksums.length > 0) {
    warnings.push(`Selected asset ${node.asset_id} catalog or visible-node checksum differs from its current attempt; current attempt checksum is authoritative.`);
  }

  return {
    asset_id: node.asset_id,
    branch_prompt: node.branch_prompt || node.selection_note,
    campaign: visibleCatalogAsset?.campaign || node.campaign,
    channel: visibleCatalogAsset?.channel || node.channel,
    checksum_sha256: currentAttempt.checksum_sha256,
    current_attempt: currentAttempt,
    dimensions: lockedDimensions(node.asset_id),
    local: {
      absolute_path: absolutePath,
      content_type: mediaCatalogAsset?.local?.content_type,
      exists: localExists,
      relative_path: mediaCatalogAsset?.local?.relative_path || currentAttempt.file_path || (isVisibleNodeAttempt ? node.local_path : undefined),
      size_bytes: mediaCatalogAsset?.local?.size_bytes || fileSize(absolutePath),
    },
    media_type: mediaType,
    mime_type: mimeType,
    review_notes: node.review_notes,
    review_state: node.review_state,
    s3: {
      bucket: mediaCatalogAsset?.s3?.bucket,
      checksum_sha256: mediaCatalogAsset?.s3?.checksum_sha256,
      content_type: mediaCatalogAsset?.s3?.content_type,
      etag: mediaCatalogAsset?.s3?.etag,
      key: s3Key,
      region: mediaCatalogAsset?.s3?.region,
      size_bytes: mediaCatalogAsset?.s3?.size_bytes,
      version_id: mediaCatalogAsset?.s3?.version_id,
    },
    selection_note: node.selection_note,
    source: mediaCatalogAsset?.source || visibleCatalogAsset?.source || node.source,
    status: visibleCatalogAsset?.status || node.status,
    storage_state: storageState(hasLocalClaim, hasS3),
    title: visibleCatalogAsset?.title || node.title || node.asset_id,
  };
}

function getLineageSelectionPacketV1(project: string, options: LineageSelectionPacketOptions = {}): LineageSelectionPacketV1 {
  const workspace = resolveWorkspace(project, options);
  const snapshot = getLineageSnapshot(project, workspace.root_asset_id);
  const catalogSummary = validateProject(project);
  const catalogAssets = listAllAssets(project);
  const catalogById = new Map(catalogAssets.map(asset => [asset.asset_id, asset]));
  const warnings: string[] = [];
  const errors: string[] = [];
  const nodeById = new Map(snapshot.nodes.map(node => [node.asset_id, node]));
  const selectedItems = snapshot.selections.map(selection => ({
    asset_id: selection.asset_id,
    branch_prompt: selection.prompt || selection.notes,
    position: selection.position,
    selected_at: selection.selected_at,
    selection_note: selection.notes,
  }));

  if (selectedItems.length === 0) warnings.push(`Lineage workspace ${workspace.id} has no selected assets.`);

  const assets = selectedItems.flatMap(item => {
    const node = nodeById.get(item.asset_id);
    if (!node) {
      const message = `Selected asset ${item.asset_id} is not present in the resolved workspace snapshot.`;
      warnings.push(message);
      errors.push('selected_asset_outside_workspace');
      return [];
    }
    return [assetForNode(node, catalogById.get(item.asset_id), warnings)];
  });

  if (assets.some(asset => !asset.dimensions)) warnings.push('Image dimensions are unavailable for one or more selected assets.');
  if (options.strict) {
    const strictErrors = [
      ...(selectedItems.length === 0 ? ['empty_selection'] : []),
      ...assets.filter(asset => asset.local.absolute_path && !asset.local.exists).map(asset => `missing_local_file:${asset.asset_id}`),
      ...errors,
    ];
    if (strictErrors.length > 0) {
      throw new LineageSelectionPacketError(`Lineage selection packet strict mode failed: ${strictErrors.join(', ')}`, warnings, strictErrors);
    }
  }

  const context = {
    campaign: options.campaign,
    channel: options.channel,
    labels: options.labels || [],
    notes: options.contextNotes,
  };
  const identity = {
    assets: assets.map(asset => ({
      asset_id: asset.asset_id,
      checksum_sha256: asset.checksum_sha256,
      local_path: asset.local.absolute_path,
      s3_key: asset.s3.key,
      storage_state: asset.storage_state,
    })),
    context,
    project,
    root_asset_id: workspace.root_asset_id,
    schema_version: 'lineage.selection_packet.v1',
    selection: selectedItems,
    workspace_id: workspace.id,
  };

  return {
    assets,
    context,
    created_at: new Date().toISOString(),
    errors,
    kind: 'lineage.selection_packet',
    packet_id: packetId(identity),
    product: catalogSummary.product,
    project,
    schema_version: 'lineage.selection_packet.v1',
    selection: {
      asset_ids: selectedItems.map(item => item.asset_id),
      count: selectedItems.length,
      items: selectedItems,
      root_asset_id: workspace.root_asset_id,
    },
    source: {
      app: 'lineage',
      command: options.command,
      db_path: options.dbPath || process.env.LINEAGE_DB || lineageDbPath(),
      package: options.packageVersion,
    },
    warnings: [...new Set(warnings)],
    workspace: {
      active_at: workspace.active_at,
      id: workspace.id,
      notes: workspace.notes,
      root_asset_id: workspace.root_asset_id,
      status: workspace.status,
      title: workspace.title,
    },
  };
}

function getLineageSelectionPacketV2(project: string, options: LineageSelectionPacketOptions): LineageSelectionPacketV2 {
  const workspace = resolveWorkspace(project, options);
  const snapshot = getLineageSnapshot(project, workspace.root_asset_id);
  const catalogSummary = validateProject(project);
  const catalogAssets = listAllAssets(project);
  const catalogById = new Map(catalogAssets.map(asset => [asset.asset_id, asset]));
  const warnings: string[] = [];
  const errors: string[] = [];
  const diagnostics: LineageSelectionPacketDiagnostic[] = [];
  const nodeById = new Map(snapshot.nodes.map(node => [node.asset_id, node]));
  const selectedItems = snapshot.selections.map(selection => ({
    asset_id: selection.asset_id,
    branch_prompt: selection.prompt || selection.notes,
    position: selection.position,
    selected_at: selection.selected_at,
    selection_note: selection.notes,
  }));

  if (selectedItems.length === 0) {
    warnings.push(`Lineage workspace ${workspace.id} has no selected assets.`);
    addDiagnostic(diagnostics, { code: 'empty_selection', severity: 'warning' });
  }

  const assets: LineageSelectionPacketV2Asset[] = [];
  for (const item of selectedItems) {
    const node = nodeById.get(item.asset_id);
    if (!node) {
      const message = `Selected asset ${item.asset_id} is not present in the resolved workspace snapshot.`;
      warnings.push(message);
      errors.push(message);
      const diagnostic = { asset_id: item.asset_id, code: 'selected_asset_outside_workspace', severity: 'error' } as const;
      addDiagnostic(diagnostics, diagnostic);
      throw new LineageSelectionPacketError(message, warnings, ['selected_asset_outside_workspace'], diagnostics);
    }
    assets.push(assetForNodeV2(node, catalogById.get(item.asset_id), catalogById, warnings, errors, diagnostics));
  }

  if (assets.some(asset => !asset.dimensions)) {
    warnings.push('Image dimensions are unavailable for one or more selected assets.');
  }

  if (options.strict) {
    const strictErrors = [
      ...(selectedItems.length === 0 ? ['empty_selection'] : []),
      ...assets.filter(asset => asset.local.absolute_path && !asset.local.exists).map(asset => `missing_local_file:${asset.asset_id}`),
      ...assets.filter(asset => asset.storage_state === 'unresolved').map(asset => `unresolved_current_attempt_media:${asset.asset_id}`),
      ...diagnostics
        .filter(diagnostic => diagnostic.severity === 'error')
        .map(diagnostic => `${diagnostic.code}${diagnostic.asset_id ? `:${diagnostic.asset_id}` : ''}`),
    ];
    if (strictErrors.length > 0) {
      throw new LineageSelectionPacketError(
        `Lineage selection packet strict mode failed: ${strictErrors.join(', ')}`,
        warnings,
        strictErrors,
        diagnostics,
      );
    }
  }

  const packet: LineageSelectionPacketV2 = {
    assets,
    context: {
      campaign: options.campaign,
      channel: options.channel,
      labels: options.labels || [],
      notes: options.contextNotes,
    },
    created_at: new Date().toISOString(),
    diagnostics,
    errors: [...new Set(errors)],
    identity_sha256: '',
    kind: 'lineage.selection_packet',
    packet_id: '',
    product: catalogSummary.product,
    project,
    schema_version: 'lineage.selection_packet.v2',
    selection: {
      asset_ids: selectedItems.map(item => item.asset_id),
      count: selectedItems.length,
      items: selectedItems,
      root_asset_id: workspace.root_asset_id,
    },
    source: {
      app: 'lineage',
      command: options.command,
      db_path: options.dbPath || process.env.LINEAGE_DB || lineageDbPath(),
      package: options.packageVersion,
    },
    warnings: [...new Set(warnings)],
    workspace: {
      active_at: workspace.active_at,
      id: workspace.id,
      notes: workspace.notes,
      root_asset_id: workspace.root_asset_id,
      status: workspace.status,
      title: workspace.title,
    },
  };
  packet.identity_sha256 = lineageSelectionPacketV2IdentitySha256(packet);
  packet.packet_id = `lineage_packet_${packet.identity_sha256.slice(0, 24)}`;
  return packet;
}

function currentGeometryFor(
  database: ReturnType<typeof lineageDb>,
  assetId: string,
): LineageSelectionPacketCurrentGeometry | null {
  const spec = loadAssetOutputSpec(database, assetId);
  if (!spec) return null;
  return {
    media_kind: spec.output_spec.media_kind,
    width: spec.actual_width,
    height: spec.actual_height,
    output_spec_digest: spec.output_spec_digest,
    delivery_surfaces: structuredClone(spec.output_spec.delivery_surfaces),
  };
}

function getLineageSelectionPacketV3(project: string, options: LineageSelectionPacketOptions): LineageSelectionPacketV3 {
  const v2 = getLineageSelectionPacketV2(project, options);
  const database = lineageDb();
  let assets: LineageSelectionPacketV3Asset[];
  try {
    assets = v2.assets.map(asset => ({
      ...structuredClone(asset),
      current_geometry: currentGeometryFor(database, asset.asset_id),
      next_output_targets: resolveEffectiveNodeNextOutputTargets(
        database,
        project,
        v2.workspace.root_asset_id,
        asset.asset_id,
      ),
    }));
  } finally {
    database.close();
  }
  const selectedSourceResolutionDigest = nodeTargetResolutionsDigest(assets.map(asset => ({
    parent_asset_id: asset.asset_id,
    resolution_digest_sha256: asset.next_output_targets.resolution_digest_sha256,
  })));
  const packet: LineageSelectionPacketV3 = {
    ...v2,
    assets,
    identity_sha256: '',
    packet_id: '',
    schema_version: 'lineage.selection_packet.v3',
    selected_source_resolution_digest_sha256: selectedSourceResolutionDigest,
  };
  packet.identity_sha256 = lineageSelectionPacketV3IdentitySha256(packet);
  packet.packet_id = `lineage_packet_${packet.identity_sha256.slice(0, 24)}`;
  return packet;
}

export function getLineageSelectionPacket(project: string, options: LineageSelectionPacketOptions = {}): LineageSelectionPacket {
  if (options.schema === 'v3') return getLineageSelectionPacketV3(project, options);
  if (options.schema === 'v2') return getLineageSelectionPacketV2(project, options);
  return getLineageSelectionPacketV1(project, options);
}
