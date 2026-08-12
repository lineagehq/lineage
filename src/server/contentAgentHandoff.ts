import { getContentOpsQueue } from './contentOpsQueue';
import { getContentTarget } from './contentTargets';
import { getAssetSelectionSnapshot } from './assetSelections';
import { getAssetSelectionWorkPacket } from './assetSelectionWorkPacket';
import { getLineageNextAsset } from './assetLineage';
import { listLineageWorkspaces } from './assetLineageWorkspaces';
import { lineageCliCommand, shellQuote } from './lineageRuntimeCommand';
import type { ContentAgentHandoff, ContentAgentHandoffNextAction, ContentAgentHandoffTarget, ContentOpsQueueItem, ContentOpsQueueLaneId, ContentPost, ContentPostReadiness, ContentTargetSnapshot } from '../shared/types';

const schemaVersion = 'lineage.agent_handoff.v1' as const;
const defaultDoNotModify = [
  'external social platforms',
  'unrelated projects',
  'posted or archived content unless explicitly requested',
];

function targetFor(post: ContentPost, readiness: ContentPostReadiness, isSelectedTarget: boolean): ContentAgentHandoffTarget {
  return {
    asset_count: post.assets.length,
    batch_id: post.batch_id,
    channel: post.channel,
    id: post.id,
    is_selected_target: isSelectedTarget,
    phase: post.phase,
    project: post.project,
    readiness,
    title: post.title,
    type: 'content_post',
  };
}

function instructionsFor(readiness: ContentPostReadiness): string {
  switch (readiness) {
    case 'needs_asset':
      return 'Generate or choose an approved asset, attach it to the post, then move the post toward review when ready.';
    case 'draft_ready':
      return 'Inspect the draft and attached assets, refine the copy or asset pairing if needed, then move the post toward review.';
    case 'in_review':
      return 'Review the post and assets, resolve any remaining issues, and prepare a human-controlled scheduling handoff.';
    case 'scheduled':
      return 'This item is already scheduled. Inspect before making changes, and do not post externally.';
    case 'posted':
      return 'This item is already posted. Do not revise it unless the user explicitly asks to reopen or repurpose it.';
    case 'skipped_or_archived':
      return 'This item is skipped or archived. Do not continue unless the user explicitly asks to reopen it.';
  }
}

function nextActionFor(item: ContentOpsQueueItem, lane: ContentOpsQueueLaneId | null, canonicalCommand = 'content queue next'): ContentAgentHandoffNextAction {
  return {
    canonical_call: {
      args: { agent: true, project: item.post.project },
      command: canonicalCommand,
      tool: 'lineage_cli',
    },
    commands: item.handoff || {},
    instructions: instructionsFor(item.readiness),
    kind: 'continue_content_item',
    label: item.readiness.replace(/_/g, ' '),
    lane,
  };
}

function guardrailsFor(readiness: ContentPostReadiness | undefined, selectedTargetMode = false): ContentAgentHandoff['guardrails'] {
  const terminal = readiness === 'posted' || readiness === 'skipped_or_archived';
  const scheduled = readiness === 'scheduled';
  const requiresConfirmation = terminal || (selectedTargetMode && scheduled);
  return {
    do_not_modify: defaultDoNotModify,
    requires_confirmation: requiresConfirmation,
    safe_to_start: Boolean(readiness) && !requiresConfirmation,
    write_scope: ['content_posts', 'content_assets'],
  };
}

function selectedTargetContext(target: ContentTargetSnapshot['target']): ContentAgentHandoffTarget | null {
  return target ? targetFor(target.post, target.readiness, true) : null;
}

export function getContentQueueNextAgentHandoff(project: string): ContentAgentHandoff {
  const queue = getContentOpsQueue(project);
  const lane = queue.next_action_lane?.id || null;
  const item = queue.next_action;
  const selectedTarget = selectedTargetContext(queue.target);
  if (!item) {
    return {
      context: { notes: [], related_assets: [], selected_target: selectedTarget },
      guardrails: { do_not_modify: defaultDoNotModify, requires_confirmation: false, safe_to_start: false, write_scope: [] },
      intent: { project, resolved: 'content.queue.next', selection_mode: 'next_action' },
      messages: [{ level: 'info', text: `No actionable content queue item is available for ${project}.` }],
      next_action: null,
      schema_version: schemaVersion,
      status: 'empty',
      target: null,
    };
  }
  return {
    context: {
      notes: [],
      related_assets: item.post.assets.map(asset => asset.asset_id),
      selected_target: selectedTarget,
    },
    guardrails: guardrailsFor(item.readiness),
    intent: { project, resolved: 'content.queue.next', selection_mode: 'next_action' },
    messages: [{ level: 'info', text: `Resolved next actionable content item for ${project}.` }],
    next_action: nextActionFor(item, lane),
    schema_version: schemaVersion,
    status: 'ok',
    target: targetFor(item.post, item.readiness, item.is_target),
  };
}

export function getContentTargetAgentHandoff(project: string): ContentAgentHandoff {
  const snapshot = getContentTarget(project);
  if (!snapshot.target) {
    return {
      context: { notes: [], related_assets: [], selected_target: null },
      guardrails: { do_not_modify: defaultDoNotModify, requires_confirmation: true, safe_to_start: false, write_scope: [] },
      intent: { project, resolved: 'content.target.selected', selection_mode: 'selected_target' },
      messages: [{ level: 'question', text: `No selected content target exists for ${project}. Select a target or ask for the next actionable queue item.` }],
      next_action: null,
      schema_version: schemaVersion,
      status: 'needs_clarification',
      target: null,
    };
  }
  const item: ContentOpsQueueItem = {
    asset_storage: { local: 0, s3: 0, total: snapshot.target.post.assets.length, unresolved: 0 },
    attached_asset_count: snapshot.target.post.assets.length,
    handoff: snapshot.target.handoff,
    is_target: true,
    post: snapshot.target.post,
    readiness: snapshot.target.readiness,
  };
  return {
    context: {
      notes: [snapshot.target.notes || ''].filter(Boolean),
      related_assets: snapshot.target.post.assets.map(asset => asset.asset_id),
      selected_target: targetFor(snapshot.target.post, snapshot.target.readiness, true),
    },
    guardrails: guardrailsFor(snapshot.target.readiness, true),
    intent: { project, resolved: 'content.target.selected', selection_mode: 'selected_target' },
    messages: [{ level: 'info', text: `Resolved selected content target for ${project}.` }],
    next_action: nextActionFor(item, 'next_target', 'content target inspect'),
    schema_version: schemaVersion,
    status: 'ok',
    target: targetFor(snapshot.target.post, snapshot.target.readiness, true),
  };
}

export function getAssetSelectionAgentHandoff(project: string): ContentAgentHandoff {
  const snapshot = getAssetSelectionSnapshot(project);
  const selectedAssets = snapshot.current.items.filter(item => item.selected_at && !item.deselected_at).map(item => item.asset_id);
  const activeReviewSet = snapshot.active_review_set;
  const reviewAssets = activeReviewSet?.items.map(item => item.asset_id) || [];
  const ready = selectedAssets.length > 0 || reviewAssets.length > 0;
  const actionKind = selectedAssets.length > 0 ? 'continue_asset_selection' : 'choose_asset_variations';
  const workPacket = getAssetSelectionWorkPacket(project);
  const useReviewSetInspect = Boolean(activeReviewSet && selectedAssets.length === 0);
  const canonicalCommand = useReviewSetInspect ? 'selections review-set inspect' : 'selections current';
  const canonicalArgs: Record<string, string | boolean | null> = useReviewSetInspect && activeReviewSet
    ? { project, 'set-id': activeReviewSet.id }
    : { project };
  const quotedProject = shellQuote(project);
  return {
    context: {
      asset_work_packet: workPacket,
      notes: activeReviewSet ? [`Next work context: ${activeReviewSet.label} (${activeReviewSet.id})`] : [],
      related_assets: selectedAssets.length > 0 ? selectedAssets : reviewAssets,
      selected_assets: selectedAssets,
      selected_target: null,
      selection_set_id: activeReviewSet?.id || snapshot.current.id,
    },
    guardrails: {
      do_not_modify: defaultDoNotModify,
      requires_confirmation: !ready,
      safe_to_start: ready,
      write_scope: ready ? ['asset_selections'] : [],
    },
    intent: { project, resolved: 'asset.selection.current', selection_mode: 'asset_selection' },
    messages: [{
      level: ready ? 'info' : 'question',
      text: selectedAssets.length > 0 || activeReviewSet
        ? `Resolved ${selectedAssets.length || reviewAssets.length} asset${(selectedAssets.length || reviewAssets.length) === 1 ? '' : 's'} from ${activeReviewSet ? 'the next work context' : 'current selections'} for ${project}.`
        : `No selected assets exist for ${project}. Select assets in the UX or create a review set first.`,
    }],
    next_action: ready ? {
      canonical_call: {
        args: canonicalArgs,
        command: canonicalCommand,
        tool: 'lineage_cli',
      },
      commands: {
        currentSelectionCommand: lineageCliCommand(`selections current --project ${quotedProject}`),
        ...(activeReviewSet ? {
          reviewSetInspectCommand: lineageCliCommand(`selections review-set inspect --project ${quotedProject} --set-id ${shellQuote(activeReviewSet.id)}`),
          reviewSetSetNextCommand: lineageCliCommand(`selections review-set set-next --project ${quotedProject} --set-id ${shellQuote(activeReviewSet.id)}`),
          workPacketCommand: lineageCliCommand(`selections review-set packet --project ${quotedProject}`),
        } : {}),
      },
      instructions: selectedAssets.length > 0
        ? 'Continue with the current selected assets from the active review set next work context. Do not upload, delete, or post externally without explicit user confirmation.'
        : 'Inspect the active review set next work context, help choose labels or generate follow-up variations, and do not upload, delete, or post externally without explicit user confirmation.',
      kind: actionKind,
      label: selectedAssets.length > 0 ? 'selected assets' : 'next work context',
      lane: null,
    } satisfies ContentAgentHandoffNextAction : null,
    schema_version: schemaVersion,
    status: ready ? 'ok' : 'needs_clarification',
    target: null,
  };
}

export function getLineageWorkspaceAgentHandoff(project: string): ContentAgentHandoff {
  const snapshot = listLineageWorkspaces(project);
  const workspace = snapshot.active_workspace;
  if (!workspace) {
    return {
      context: { notes: [], related_assets: [], selected_target: null },
      guardrails: { do_not_modify: defaultDoNotModify, requires_confirmation: true, safe_to_start: false, write_scope: [] },
      intent: { project, resolved: 'lineage.workspace.active', selection_mode: 'lineage_workspace' },
      messages: [{ level: 'question', text: `No active lineage workspace exists for ${project}. Create or activate one before asking an agent to continue lineage work.` }],
      next_action: null,
      schema_version: schemaVersion,
      status: 'needs_clarification',
      target: null,
    };
  }
  const next = getLineageNextAsset(project, workspace.root_asset_id);
  const nextAsset = next.next_asset;
  const nextAssets = next.next_assets;
  const quotedProject = shellQuote(project);
  const quotedWorkspace = shellQuote(workspace.id);
  const nextVariationLimit = next.next_variation_limit || workspace.max_queued_branches || 3;
  const missingVariationPromptIds = next.selections
    .filter(selection => !(selection.prompt || selection.notes || '').trim())
    .map(selection => selection.asset_id);
  const needsVariationPrompt = missingVariationPromptIds.length > 0;
  const safeToStart = workspace.status === 'active' && nextAssets.length > 0 && !needsVariationPrompt;
  const target: ContentAgentHandoffTarget = {
    id: workspace.id,
    latest_count: next.latest.length,
    next_asset_id: nextAsset?.asset_id,
    next_asset_ids: nextAssets.map(asset => asset.asset_id),
    project,
    root_asset_id: workspace.root_asset_id,
    status: workspace.status,
    title: workspace.title,
    type: 'lineage_workspace',
  };
  return {
    context: {
      notes: [
        `Lineage workspace: ${workspace.title} (${workspace.id})`,
        workspace.notes || '',
        ...next.selections.map(selection => selection.notes ? `Use for next variation rationale (${selection.asset_id}): ${selection.notes}` : ''),
        ...(needsVariationPrompt
          ? [`No variation prompt was provided for ${missingVariationPromptIds.join(', ')}. Ask the user what they want changed before generating.`]
          : []),
        ...next.warnings,
      ].filter(Boolean),
      related_assets: [...new Set([workspace.root_asset_id, ...next.latest, ...nextAssets.map(asset => asset.asset_id)])],
      selected_assets: next.selected,
      selected_target: null,
    },
    guardrails: {
      do_not_modify: defaultDoNotModify,
      requires_confirmation: !safeToStart,
      safe_to_start: safeToStart,
      write_scope: safeToStart ? ['lineage_workspaces', 'asset_selections', 'asset_edges'] : [],
    },
    intent: { project, resolved: 'lineage.workspace.active', selection_mode: 'lineage_workspace' },
    messages: [{
      level: safeToStart ? 'info' : 'question',
      text: safeToStart
        ? `Resolved active lineage workspace ${workspace.title} for ${project}; continue from ${nextAssets.length} selected next variation base${nextAssets.length === 1 ? '' : 's'}.`
        : needsVariationPrompt
          ? `Active lineage workspace ${workspace.title} has ${missingVariationPromptIds.length} queued branch${missingVariationPromptIds.length === 1 ? '' : 'es'} without a prompt. Ask the user what they want changed before generating.`
          : `Active lineage workspace ${workspace.title} needs up to ${nextVariationLimit} next variation base${nextVariationLimit === 1 ? '' : 's'} before generation.`,
    }],
    next_action: {
      canonical_call: {
        args: { project, workspace: workspace.id },
        command: 'lineage workspace inspect',
        tool: 'lineage_cli',
      },
      commands: {
        workspaceListCommand: lineageCliCommand(`workspace list --project ${quotedProject}`),
        workspaceInspectCommand: lineageCliCommand(`workspace inspect --project ${quotedProject} --workspace ${quotedWorkspace}`),
        workspaceActivateCommand: lineageCliCommand(`workspace activate --project ${quotedProject} --workspace ${quotedWorkspace} --confirm-write`),
        lineageNextCommand: lineageCliCommand(`next --project ${quotedProject} --root ${shellQuote(workspace.root_asset_id)}`),
        lineageBriefCommand: lineageCliCommand(`brief --project ${quotedProject} --root ${shellQuote(workspace.root_asset_id)}`),
        linkChildCommand: nextAssets.length > 0 ? lineageCliCommand(`link-child --project ${quotedProject} --root ${shellQuote(workspace.root_asset_id)} --child <asset-id> --summary "<one-or-two-words>" --confirm-write`) : '',
      },
      instructions: safeToStart
        ? 'Continue this lineage workspace from the selected next variation base or bases. Generate local variations, index them, and link chosen children back to the workspace root with a one- or two-word edge summary before any S3 backup or external posting.'
        : needsVariationPrompt
          ? `Inspect the lineage workspace and ask the human what they want changed for ${missingVariationPromptIds.join(', ')} before generating any variations.`
          : 'Inspect the lineage workspace and ask the human to choose "Use for next variation" before generating more variations.',
      kind: 'continue_lineage_workspace',
      label: 'selected lineage workspace',
      lane: null,
    },
    schema_version: schemaVersion,
    status: safeToStart ? 'ok' : 'needs_clarification',
    target,
  };
}
