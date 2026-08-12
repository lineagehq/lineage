import type { LineageBriefResponse, LineageSelectedChildFields } from '../shared/types';
import { requireEdgeSummary } from '../shared/edgeSummary';
import { AgentClaimError, validateAgentClaimForWrite } from './agentClaims';
import { getLineageNextAsset, getLineageWriteClaimContext, LineageError, linkLineageAssets, listLineageRerollRequests } from './assetLineage';
import { nowIso } from './assetLineageDb';
import { lineageWorkspaceId } from './assetLineageWorkspaces';
import { lineageCliCommand, shellQuote } from './lineageRuntimeCommand';

function lineageCommand(command: string, project: string, rootAssetId: string): string {
  return lineageCliCommand(`${command} --project ${shellQuote(project)} --root ${shellQuote(rootAssetId)}`);
}

function linkChildCommand(project: string, rootAssetId: string): string {
  return lineageCliCommand(`link-child --project ${shellQuote(project)} --root ${shellQuote(rootAssetId)} --child <asset-id> --summary "<one-or-two-words>" --confirm-write`);
}

function rerollImportGuidance(rootAssetId: string, targetAssetId: string): string {
  return `Use lineage reroll plan --root ${rootAssetId} --target ${targetAssetId} and lineage reroll import instead.`;
}

export function getLineageBrief(project: string, rootAssetId?: string): LineageBriefResponse {
  const next = getLineageNextAsset(project, rootAssetId);
  const assets = next.next_assets;
  const asset = next.next_asset;
  const referenceAssetIds = assets.map(item => item.asset_id);
  const variationPrompts = next.selections
    .map(selection => ({ asset_id: selection.asset_id, prompt: selection.prompt || selection.notes || '' }))
    .filter(item => Boolean(item.prompt));
  const missingVariationPromptIds = next.selections
    .filter(selection => !(selection.prompt || selection.notes || '').trim())
    .map(selection => selection.asset_id);
  const rationale = variationPrompts[0]?.prompt || asset?.branch_prompt || asset?.selection_note || next.selection?.prompt || next.selection?.notes;
  const channels = [...new Set(assets.map(item => item.channel || 'unknown'))];
  const campaigns = [...new Set(assets.map(item => item.campaign || 'unknown'))];
  const nextVariationLimit = next.next_variation_limit || 3;
  const prompt = assets.length > 0
    ? [
      assets.length === 1
        ? `Create 3-4 variations from asset ${assets[0].asset_id} (${assets[0].title}).`
        : `Create 3-4 variations using these ${assets.length} selected references: ${referenceAssetIds.join(', ')}.`,
      variationPrompts.length > 0
        ? `Follow the exact saved variation prompt${variationPrompts.length === 1 ? '' : 's'}: ${variationPrompts.map(item => `${item.asset_id}: ${item.prompt}`).join(' | ')}`
        : undefined,
      missingVariationPromptIds.length > 0
        ? `No variation prompt was provided for ${missingVariationPromptIds.join(', ')}. Ask the user what they want changed before generating.`
        : undefined,
      `Keep project=${project}, root=${next.root_asset_id}, channels=${channels.join(',')}, campaigns=${campaigns.join(',')}.`,
      'After generation, index outputs and link chosen children with lineage link-child.',
    ].filter(Boolean).join(' ')
    : `Select up to ${nextVariationLimit} latest lineage candidate${nextVariationLimit === 1 ? '' : 's'} before generating variations.`;
  return {
    project,
    root_asset_id: next.root_asset_id,
    strategy: next.strategy,
    selection_mode: next.selection_mode,
    recommended_action: next.recommended_action,
    reason: next.reason,
    next_asset: asset,
    next_assets: assets,
    selection: next.selection,
    selections: next.selections,
    latest: next.latest,
    warnings: [
      ...next.warnings,
      ...(missingVariationPromptIds.length > 0
        ? [`Missing variation prompt for ${missingVariationPromptIds.join(', ')}; ask the user before generating.`]
        : []),
    ],
    brief: {
      title: asset ? `Evolve ${assets.length > 1 ? `${assets.length} selected bases` : asset.title}` : 'Choose next lineage base',
      objective: asset ? 'Generate the next branch of visual variations from the selected lineage base or bases.' : 'Resolve the next base before generation.',
      prompt,
      reference_asset_id: asset?.asset_id,
      reference_asset_ids: referenceAssetIds,
      rationale,
      variation_prompts: variationPrompts.length > 0 ? variationPrompts : undefined,
    },
    handoff: {
      next_command: lineageCommand('next', project, next.root_asset_id),
      inspect_command: asset ? lineageCliCommand(`inspect --project ${shellQuote(project)} --asset-id ${shellQuote(asset.asset_id)}`) : undefined,
      link_child_command: asset ? linkChildCommand(project, next.root_asset_id) : undefined,
    },
    fetchedAt: nowIso(),
  };
}

export function linkSelectedLineageChild(project: string, fields: LineageSelectedChildFields) {
  const summary = fields.summaryActor ? requireEdgeSummary(fields.summary) : fields.summary;
  const next = getLineageNextAsset(project, fields.rootAssetId);
  if (!next.next_asset) throw new LineageError('Cannot link child until a next base is selected or unambiguous');
  const rerollRequests = listLineageRerollRequests(project, next.root_asset_id).requests;
  const pendingRerollForParent = rerollRequests.find(request => request.node_asset_id === next.next_asset?.asset_id);
  if (pendingRerollForParent && fields.confirmWrite) {
    throw new LineageError(
      `Pending re-roll exists for ${pendingRerollForParent.node_asset_id}. lineage link-child creates a visible child variation edge; it does not re-roll the same node. ${rerollImportGuidance(next.root_asset_id, pendingRerollForParent.node_asset_id)} Cancel the re-roll first if you intentionally want a new child variation.`,
      409
    );
  }
  if (fields.confirmWrite) {
    const claimContext = getLineageWriteClaimContext(project, next.next_asset.asset_id);
    const validation = validateAgentClaimForWrite({
      channel: claimContext.channel,
      claimToken: fields.claimToken,
      confirmWrite: fields.confirmWrite,
      dangerLevel: 'enforce',
      project,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(project, claimContext.rootAssetId),
      writeKind: 'link_child',
    });
    if (!validation.ok) throw new AgentClaimError(validation.message, validation.code === 'claim_required' ? 401 : 403, validation.code, validation.conflicts);
  }
  const result = linkLineageAssets(project, {
    childAssetId: fields.childAssetId,
    confirmWrite: fields.confirmWrite,
    claimToken: fields.claimToken,
    parentAssetId: next.next_asset.asset_id,
    summary,
    summaryActor: fields.summaryActor,
  });
  return {
    ...result,
    root_asset_id: next.root_asset_id,
    parent_asset_id: next.next_asset.asset_id,
    child_asset_id: fields.childAssetId,
    reference_asset_ids: next.next_assets.map(asset => asset.asset_id),
    warning: [
      pendingRerollForParent
        ? `Pending re-roll exists for ${pendingRerollForParent.node_asset_id}. link-child would create a visible child variation; use reroll plan/import to update the same node attempt.`
        : undefined,
      rerollRequests.length > 0 && !pendingRerollForParent
        ? `This lineage has ${rerollRequests.length} pending re-roll target(s). link-child is only for new visible child variations, not re-roll attempts.`
        : undefined,
      next.next_assets.length > 1
        ? 'Linked child to the primary selected base; add explicit edges to other selected references if the child derives from them too.'
        : undefined,
    ].filter(Boolean).join(' ') || undefined,
  };
}
