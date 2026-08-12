import { defaultProject, listProjects } from './assetCore';
import { chooseReviewSetLabels, labelsFromPrompt } from './assetSelections';
import { listAssetSocialMarks } from './assetSocialMarks';
import { listAssetDiscussionMarks } from './assetDiscussionMarks';
import { listLineageWorkspaces } from './assetLineageWorkspaces';
import { getAssetSelectionAgentHandoff, getContentQueueNextAgentHandoff, getContentTargetAgentHandoff, getLineageWorkspaceAgentHandoff } from './contentAgentHandoff';
import { lineageCliCommand, shellQuote } from './lineageRuntimeCommand';
import type { ContentAgentHandoff, ContentAgentHandoffNaturalLanguage, ContentAgentResolvedHandoff } from '../shared/types';

const assetSelectionTerms = [
  'my selections',
  'my selected assets',
  'selected assets',
  'selected images',
  'images i picked',
  'assets i picked',
  'keep working on my selections',
  'work on my selections',
  'continue my selections',
];
const variationChoiceTerms = [
  'i like',
  'i choose',
  'choose variation',
  'select variation',
  'pick variation',
  'use variation',
];
const socialMarkTerms = [
  'marked for social',
  'social marked',
  'social marks',
  'social candidates',
];
const discussionMarkTerms = [
  'marked for discussion',
  'discussion set',
  'discussion flags',
  'flagged for discussion',
  'nodes to discuss',
];
const lineageWorkspaceTerms = [
  'active lineage',
  'current lineage',
  'lineage workspace',
  'selected lineage',
  'selected lineage workspace',
  'this lineage',
  'work on my lineage',
  'keep working on my selected lineage workspace',
  'keep working on the selected lineage',
  'continue the lineage workspace',
];
const selectedTerms = [
  'selected',
  'selection',
  'chosen',
  'current target',
  'selected target',
  'target i picked',
  'what i picked',
  'user selected',
  'human selected',
];
const nextTerms = [
  'next actionable',
  'next action',
  'next queue',
  'queue next',
  'continue next',
  'work on next',
  'what should i work on',
  'needs work',
  'ready to work',
];
const blockedTerms = [
  'post externally',
  'publish',
  'schedule on',
  'post to tiktok',
  'post to linkedin',
  'post to instagram',
  'post to facebook',
  'tweet',
  'delete everything',
];
const defaultDoNotModify = [
  'external social platforms',
  'unrelated projects',
  'posted or archived content unless explicitly requested',
];

function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function aliasFor(project: string): string[] {
  const compact = project.replace(/-/g, ' ');
  return [
    project,
    compact,
    compact.replace(/\bapp\b/g, '').trim(),
    project.replace(/-project$/, ''),
  ].filter(Boolean);
}

function resolveProject(prompt: string, fallbackProject: string): { alias: string | null; project: string } {
  const normalized = normalizePrompt(prompt);
  for (const item of listProjects()) {
    const aliases = [...aliasFor(item.project), ...aliasFor(item.product)];
    const match = aliases.find(alias => normalized.includes(normalizePrompt(alias)));
    if (match) return { alias: match, project: item.project };
  }
  const fallback = fallbackProject || defaultProject;
  const fallbackMatch = aliasFor(fallback).find(alias => normalized.includes(normalizePrompt(alias)));
  if (fallbackMatch) return { alias: fallbackMatch, project: fallback };
  return { alias: null, project: fallbackProject || defaultProject };
}

function matchedTerms(normalized: string, terms: string[]): string[] {
  return terms.filter(term => normalized.includes(normalizePrompt(term)));
}

function unresolved(
  project: string,
  prompt: string,
  natural: Omit<ContentAgentHandoffNaturalLanguage, 'normalized_prompt' | 'prompt'>,
  status: ContentAgentHandoff['status'],
  level: 'question' | 'error',
  text: string,
): ContentAgentResolvedHandoff {
  return {
    context: { notes: [], related_assets: [], selected_target: null },
    guardrails: { do_not_modify: defaultDoNotModify, requires_confirmation: true, safe_to_start: false, write_scope: [] },
    intent: { project, resolved: 'content.handoff.unresolved', selection_mode: 'unresolved' },
    messages: [{ level, text }],
    natural_language: { ...natural, normalized_prompt: normalizePrompt(prompt), prompt },
    next_action: null,
    schema_version: 'lineage.agent_handoff.v1',
    status,
    target: null,
  };
}

function withNatural(handoff: ContentAgentHandoff, natural: ContentAgentHandoffNaturalLanguage): ContentAgentResolvedHandoff {
  return { ...handoff, natural_language: natural };
}

function socialMarksHandoff(project: string, prompt: string, alias: string | null, matched: string[]): ContentAgentResolvedHandoff {
  const workspace = listLineageWorkspaces(project).active_workspace;
  if (!workspace) {
    return unresolved(
      project,
      prompt,
      { matched_intent: 'asset.selection.current', matched_terms: matched, project_alias: alias },
      'needs_clarification',
      'question',
      'No active lineage canvas is available. Name the canvas root before asking for Social marks.',
    );
  }
  const listed = listAssetSocialMarks(project, workspace.root_asset_id);
  const listCommand = lineageCliCommand(`social list --project ${shellQuote(project)} --root ${shellQuote(workspace.root_asset_id)}`);
  return {
    context: {
      notes: listed.marks.flatMap(mark => [
        `${mark.asset_id} (${mark.title}) local=${mark.local.absolute_path || 'unavailable'} checksum=${mark.checksum_sha256 || 'unavailable'}`,
        ...mark.warnings,
      ]),
      related_assets: listed.marks.map(mark => mark.asset_id),
      selected_assets: listed.marks.map(mark => mark.asset_id),
      selected_target: null,
    },
    guardrails: {
      do_not_modify: defaultDoNotModify,
      requires_confirmation: true,
      safe_to_start: true,
      write_scope: [],
    },
    intent: {
      project,
      resolved: 'asset.selection.current',
      selection_mode: 'asset_selection',
    },
    messages: [{
      level: 'info',
      text: `${listed.marks.length} asset(s) are marked for Social in ${workspace.title}. A Social mark is context for discussion, not permission to upload, schedule, or post.`,
    }],
    natural_language: {
      matched_intent: 'asset.selection.current',
      matched_terms: matched,
      normalized_prompt: normalizePrompt(prompt),
      project_alias: alias,
      prompt,
    },
    next_action: {
      canonical_call: {
        args: { project, root: workspace.root_asset_id },
        command: 'social list',
        tool: 'lineage_cli',
      },
      commands: { list: listCommand },
      instructions: 'Use the listed local asset context to discuss or prepare social work. Do not upload, schedule, or post without a separate explicit request and confirmation.',
      kind: 'continue_asset_selection',
      label: 'Continue with Social-marked assets',
      lane: null,
    },
    schema_version: 'lineage.agent_handoff.v1',
    status: 'ok',
    target: null,
  };
}

function discussionMarksHandoff(project: string, prompt: string, alias: string | null, matched: string[]): ContentAgentResolvedHandoff {
  const workspace = listLineageWorkspaces(project).active_workspace;
  if (!workspace) {
    return unresolved(
      project,
      prompt,
      { matched_intent: 'asset.selection.current', matched_terms: matched, project_alias: alias },
      'needs_clarification',
      'question',
      'No active lineage canvas is available. Name the canvas root before asking about the Discussion set.',
    );
  }
  const listed = listAssetDiscussionMarks(project, workspace.root_asset_id);
  const listCommand = lineageCliCommand(`discuss list --project ${shellQuote(project)} --root ${shellQuote(workspace.root_asset_id)}`);
  return {
    context: {
      notes: listed.marks.flatMap(mark => [
        `${mark.asset_id} (${mark.title})${mark.notes ? ` note=${mark.notes}` : ''} local=${mark.local.absolute_path || 'unavailable'} checksum=${mark.checksum_sha256 || 'unavailable'}`,
        ...mark.warnings,
      ]),
      related_assets: listed.marks.map(mark => mark.asset_id),
      selected_assets: listed.marks.map(mark => mark.asset_id),
      selected_target: null,
    },
    guardrails: {
      do_not_modify: [
        ...defaultDoNotModify,
        'lineage branches, re-roll requests, agent claims, or tasks based only on Discussion membership',
      ],
      requires_confirmation: true,
      safe_to_start: true,
      write_scope: [],
    },
    intent: { project, resolved: 'asset.selection.current', selection_mode: 'asset_selection' },
    messages: [{
      level: 'info',
      text: `${listed.marks.length} asset(s) are in the Discussion set for ${workspace.title}. Discussion membership is read-only conversational context, not permission to branch, re-roll, claim, or execute tasks.`,
    }],
    natural_language: {
      matched_intent: 'asset.selection.current', matched_terms: matched,
      normalized_prompt: normalizePrompt(prompt), project_alias: alias, prompt,
    },
    next_action: {
      canonical_call: { args: { project, root: workspace.root_asset_id }, command: 'discuss list', tool: 'lineage_cli' },
      commands: { list: listCommand },
      instructions: 'Use every listed asset and optional note to answer the user’s general discussion question. Do not branch, re-roll, claim, create tasks, or generate work without a separate explicit request.',
      kind: 'continue_asset_selection', label: 'Discuss marked assets', lane: null,
    },
    schema_version: 'lineage.agent_handoff.v1', status: 'ok', target: null,
  };
}

export function resolveContentAgentHandoff(prompt: string, fallbackProject = defaultProject): ContentAgentResolvedHandoff {
  const normalized = normalizePrompt(prompt);
  const { alias, project } = resolveProject(prompt, fallbackProject);
  if (!normalized) {
    return unresolved(project, prompt, { matched_intent: 'empty', matched_terms: [], project_alias: alias }, 'needs_clarification', 'question', 'Describe whether you want the selected target or the next actionable content item.');
  }

  const blocked = matchedTerms(normalized, blockedTerms);
  if (blocked.length > 0) {
    return unresolved(project, prompt, { matched_intent: 'blocked', matched_terms: blocked, project_alias: alias }, 'blocked', 'error', 'This resolver only prepares local Lineage handoffs. It will not post, publish, schedule, or modify external platforms.');
  }

  const variationChoice = matchedTerms(normalized, variationChoiceTerms);
  const labels = labelsFromPrompt(prompt);
  if (variationChoice.length > 0 && labels.length > 0) {
    chooseReviewSetLabels(project, { confirmWrite: true, labels, selectedBy: 'human' });
    return withNatural(getAssetSelectionAgentHandoff(project), {
      matched_intent: 'asset.selection.choose_variations',
      matched_terms: [...variationChoice, ...labels],
      normalized_prompt: normalized,
      project_alias: alias,
      prompt,
    });
  }

  const discussionMarks = matchedTerms(normalized, discussionMarkTerms);
  if (discussionMarks.length > 0) return discussionMarksHandoff(project, prompt, alias, discussionMarks);

  const socialMarks = matchedTerms(normalized, socialMarkTerms);
  if (socialMarks.length > 0) return socialMarksHandoff(project, prompt, alias, socialMarks);

  const lineageWorkspace = matchedTerms(normalized, lineageWorkspaceTerms);
  if (lineageWorkspace.length > 0) {
    return withNatural(getLineageWorkspaceAgentHandoff(project), {
      matched_intent: 'lineage.workspace.active',
      matched_terms: lineageWorkspace,
      normalized_prompt: normalized,
      project_alias: alias,
      prompt,
    });
  }

  const assetSelection = matchedTerms(normalized, assetSelectionTerms);
  if (assetSelection.length > 0) {
    const lineageHandoff = getLineageWorkspaceAgentHandoff(project);
    const activeLineageQueue = lineageHandoff.target?.type === 'lineage_workspace'
      && lineageHandoff.target.status === 'active'
      && Boolean(lineageHandoff.target.next_asset_ids?.length);
    if ((lineageHandoff.status === 'ok' && lineageHandoff.guardrails.safe_to_start) || activeLineageQueue) {
      return withNatural(lineageHandoff, {
        matched_intent: 'lineage.workspace.active',
        matched_terms: assetSelection,
        normalized_prompt: normalized,
        project_alias: alias,
        prompt,
      });
    }
    return withNatural(getAssetSelectionAgentHandoff(project), {
      matched_intent: 'asset.selection.current',
      matched_terms: assetSelection,
      normalized_prompt: normalized,
      project_alias: alias,
      prompt,
    });
  }

  const selected = matchedTerms(normalized, selectedTerms);
  const next = matchedTerms(normalized, nextTerms);
  if (selected.length > 0 && next.length > 0) {
    return unresolved(project, prompt, { matched_intent: 'ambiguous', matched_terms: [...selected, ...next], project_alias: alias }, 'needs_clarification', 'question', 'This prompt mentions both selected-target and next-action work. Ask for one of those explicitly.');
  }
  if (selected.length > 0) {
    return withNatural(getContentTargetAgentHandoff(project), { matched_intent: 'content.target.selected', matched_terms: selected, normalized_prompt: normalized, project_alias: alias, prompt });
  }
  if (next.length > 0 || normalized.includes('continue content')) {
    return withNatural(getContentQueueNextAgentHandoff(project), { matched_intent: 'content.queue.next', matched_terms: next, normalized_prompt: normalized, project_alias: alias, prompt });
  }

  return unresolved(project, prompt, { matched_intent: 'unsupported', matched_terms: [], project_alias: alias }, 'needs_clarification', 'question', 'I could not resolve this prompt. Ask for the selected target or the next actionable content item.');
}
