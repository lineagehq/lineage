import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { fileSha256 } from './localReview';
import { attachContentPostAsset, createContentBatch, createContentPost } from './contentBatches';
import { createReviewSet, selectCurrentAssets } from './assetSelections';
import { indexLineageAssets, linkLineageAssets, updateSelectedAsset } from './assetLineage';
import { createLineageWorkspace } from './assetLineageWorkspaces';
import { resolveContentAgentHandoff } from './contentAgentIntent';
import { markAssetSocial } from './assetSocialMarks';
import { markAssetDiscussion } from './assetDiscussionMarks';
import { setContentTarget } from './contentTargets';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-content-agent-intent');
const dbFile = join(scratchDir, 'content-agent-intent.sqlite');

function resetDb() {
  rmSync(scratchDir, { force: true, recursive: true });
  useLineageTestProfile(dbFile);
}

function seedLocalAsset(): string {
  const file = join(scratchDir, 'demo-content-agent-intent-local.png');
  mkdirSync(scratchDir, { recursive: true });
  writeFileSync(file, Buffer.from('content-agent-intent-local'));
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedQueue() {
  const localAssetId = seedLocalAsset();
  createContentBatch(defaultProject, {
    batchId: 'intent-batch',
    campaign: '2026-06-natural-language-handoff',
    channel: 'tiktok',
    confirmWrite: true,
    title: 'Intent resolver batch',
  });
  createContentPost(defaultProject, {
    batchId: 'intent-batch',
    channel: 'tiktok',
    confirmWrite: true,
    phase: 'draft',
    postId: 'needs-asset-post',
    title: 'Needs asset post',
  });
  createContentPost(defaultProject, {
    batchId: 'intent-batch',
    channel: 'linkedin',
    confirmWrite: true,
    phase: 'draft',
    postId: 'selected-ready-post',
    title: 'Selected ready post',
  });
  attachContentPostAsset(defaultProject, { assetId: localAssetId, confirmWrite: true, postId: 'selected-ready-post' });
  setContentTarget(defaultProject, { confirmWrite: true, notes: 'Human selected this one.', postId: 'selected-ready-post' });
}

function seedLineageWorkspace(prompt?: string) {
  const root = join(scratchDir, 'demo-lineage-intent-root.png');
  const child = join(scratchDir, 'demo-lineage-intent-child.png');
  mkdirSync(scratchDir, { recursive: true });
  writeFileSync(root, Buffer.from('lineage-intent-root'));
  writeFileSync(child, Buffer.from('lineage-intent-child'));
  const rootId = `local-${fileSha256(root).slice(0, 12)}`;
  const childId = `local-${fileSha256(child).slice(0, 12)}`;
  indexLineageAssets(defaultProject);
  linkLineageAssets(defaultProject, { childAssetId: childId, confirmWrite: true, parentAssetId: rootId });
  updateSelectedAsset(defaultProject, { assetId: childId, confirmWrite: true, notes: prompt, rootAssetId: rootId });
  const workspace = createLineageWorkspace(defaultProject, {
    activate: true,
    confirmWrite: true,
    rootAssetId: rootId,
    title: 'Intent lineage workspace',
  }).workspace!;
  return { childId, rootId, workspace };
}

describe('content agent natural-language intent resolver', () => {
  beforeEach(resetDb);

  it('resolves next actionable content prompts to queue-next handoff', () => {
    seedQueue();
    const handoff = resolveContentAgentHandoff('Continue the next actionable Demo content item');

    expect(handoff).toMatchObject({
      intent: { resolved: 'content.queue.next', selection_mode: 'next_action' },
      natural_language: { matched_intent: 'content.queue.next', project_alias: 'demo' },
      status: 'ok',
      target: { id: 'needs-asset-post' },
    });
  });

  it('resolves selected target prompts without falling through to queue next', () => {
    seedQueue();
    const handoff = resolveContentAgentHandoff('Work on the selected target for the Demo app');

    expect(handoff).toMatchObject({
      intent: { resolved: 'content.target.selected', selection_mode: 'selected_target' },
      natural_language: { matched_intent: 'content.target.selected' },
      target: { id: 'selected-ready-post', is_selected_target: true },
    });
    expect(handoff.target?.id).not.toBe('needs-asset-post');
  });

  it('resolves my selections to the asset selection ledger', () => {
    selectCurrentAssets(defaultProject, { assetIds: ['selected-image-a', 'selected-image-b'], confirmWrite: true });

    const handoff = resolveContentAgentHandoff('Let us keep working on my selections for Demo');

    expect(handoff).toMatchObject({
      context: { selected_assets: ['selected-image-a', 'selected-image-b'] },
      intent: { resolved: 'asset.selection.current', selection_mode: 'asset_selection' },
      natural_language: { matched_intent: 'asset.selection.current' },
      status: 'ok',
      target: null,
    });
  });

  it('resolves selected lineage workspace prompts before selected content-target prompts', () => {
    const { childId, workspace } = seedLineageWorkspace();

    const handoff = resolveContentAgentHandoff('Let us keep working on my selected lineage workspace for Demo');

    expect(handoff).toMatchObject({
      intent: { resolved: 'lineage.workspace.active', selection_mode: 'lineage_workspace' },
      natural_language: { matched_intent: 'lineage.workspace.active' },
      guardrails: { safe_to_start: false },
      next_action: { kind: 'continue_lineage_workspace' },
      status: 'needs_clarification',
      target: {
        id: workspace.id,
        next_asset_id: childId,
        type: 'lineage_workspace',
      },
    });
    expect(handoff.messages[0]?.text).toContain('without a prompt');
  });

  it('resolves current social marks as a read-only canvas asset selection', () => {
    const { childId, rootId } = seedLineageWorkspace();
    markAssetSocial(defaultProject, {
      asset: childId,
      confirmWrite: true,
      markedBy: 'human:owner',
      notes: 'Prepare distinct LinkedIn and Instagram copy',
      rootAssetId: rootId,
    });

    const handoff = resolveContentAgentHandoff('Which nodes in this canvas are marked for social for Demo?');

    expect(handoff).toMatchObject({
      context: {
        related_assets: [childId],
        selected_assets: [childId],
      },
      guardrails: {
        do_not_modify: expect.arrayContaining(['external social platforms']),
        requires_confirmation: true,
        safe_to_start: true,
        write_scope: [],
      },
      intent: { resolved: 'asset.selection.current', selection_mode: 'asset_selection' },
      natural_language: { matched_intent: 'asset.selection.current' },
      next_action: {
        canonical_call: {
          args: { project: defaultProject, root: rootId },
          command: 'social list',
          tool: 'lineage_cli',
        },
        commands: { list: expect.stringContaining(`social list --project '${defaultProject}' --root '${rootId}'`) },
      },
      status: 'ok',
      target: null,
    });
    const commands = handoff.next_action?.commands;
    expect(commands && 'list' in commands ? commands.list : undefined).toContain(`--profile '${process.env.LINEAGE_PROFILE_MANIFEST}' --json`);
  });

  it('resolves the whole Discussion set with notes and an empty write scope', () => {
    const { childId, rootId } = seedLineageWorkspace();
    markAssetDiscussion(defaultProject, {
      asset: rootId, confirmWrite: true, markedBy: 'human:owner', notes: 'Is the hierarchy clear?', rootAssetId: rootId,
    });
    markAssetDiscussion(defaultProject, {
      asset: childId, confirmWrite: true, markedBy: 'human:owner', rootAssetId: rootId,
    });

    const handoff = resolveContentAgentHandoff('Can we discuss these nodes in the Discussion set for Demo?');

    expect(handoff).toMatchObject({
      context: {
        related_assets: expect.arrayContaining([rootId, childId]),
        selected_assets: expect.arrayContaining([rootId, childId]),
        notes: expect.arrayContaining([expect.stringContaining('note=Is the hierarchy clear?')]),
      },
      guardrails: {
        do_not_modify: expect.arrayContaining([expect.stringContaining('branches, re-roll requests, agent claims, or tasks')]),
        requires_confirmation: true,
        safe_to_start: true,
        write_scope: [],
      },
      intent: { resolved: 'asset.selection.current', selection_mode: 'asset_selection' },
      next_action: {
        canonical_call: { args: { project: defaultProject, root: rootId }, command: 'discuss list', tool: 'lineage_cli' },
        commands: { list: expect.stringContaining(`discuss list --project '${defaultProject}' --root '${rootId}'`) },
      },
      status: 'ok',
      target: null,
    });
    expect(handoff.messages[0]?.text).toContain('not permission to branch, re-roll, claim, or execute tasks');
  });

  it('does not route an ordinary request to discuss selected assets through the saved Discussion set', () => {
    selectCurrentAssets(defaultProject, { assetIds: ['selected-image-a'], confirmWrite: true });

    const handoff = resolveContentAgentHandoff('Can we discuss these selected assets for Demo?');

    expect(handoff.context.selected_assets).toEqual(['selected-image-a']);
    expect(handoff.next_action?.canonical_call?.command).not.toBe('discuss list');
  });

  it('prefers a ready active lineage workspace for generic selections prompts', () => {
    const { childId, workspace } = seedLineageWorkspace('Create a more editorial variation.');
    createReviewSet(defaultProject, {
      assetIds: ['variation-a', 'variation-b'],
      confirmWrite: true,
      key: 'intent-review-set',
      label: 'Intent review set',
    });

    const handoff = resolveContentAgentHandoff('Let us keep working on my selections for Demo');

    expect(handoff).toMatchObject({
      context: { selected_assets: [childId] },
      intent: { resolved: 'lineage.workspace.active', selection_mode: 'lineage_workspace' },
      natural_language: { matched_intent: 'lineage.workspace.active' },
      next_action: { kind: 'continue_lineage_workspace' },
      status: 'ok',
      target: {
        id: workspace.id,
        next_asset_id: childId,
        type: 'lineage_workspace',
      },
    });
  });

  it('keeps an active promptless lineage queue ahead of generic asset selections', () => {
    const { childId, workspace } = seedLineageWorkspace();

    const handoff = resolveContentAgentHandoff('Let us keep working on my selections for Demo');

    expect(handoff).toMatchObject({
      context: { selected_assets: [childId] },
      guardrails: { safe_to_start: false },
      intent: { resolved: 'lineage.workspace.active', selection_mode: 'lineage_workspace' },
      natural_language: { matched_intent: 'lineage.workspace.active' },
      next_action: { kind: 'continue_lineage_workspace' },
      status: 'needs_clarification',
      target: {
        id: workspace.id,
        next_asset_id: childId,
        type: 'lineage_workspace',
      },
    });
    expect(handoff.messages[0]?.text).toContain('without a prompt');
  });

  it('resolves variation choices to selected assets through the active review set', () => {
    createReviewSet(defaultProject, {
      assetIds: ['variation-a', 'variation-b', 'variation-c', 'variation-d'],
      confirmWrite: true,
      key: 'intent-variations',
      label: 'Intent variations',
    });

    const handoff = resolveContentAgentHandoff('I like variation B and D for Demo');

    expect(handoff).toMatchObject({
      context: { selected_assets: ['variation-b', 'variation-d'] },
      intent: { resolved: 'asset.selection.current', selection_mode: 'asset_selection' },
      natural_language: { matched_intent: 'asset.selection.choose_variations' },
      status: 'ok',
    });
  });

  it('returns clarification when selected-target and next-action language conflict', () => {
    seedQueue();
    const handoff = resolveContentAgentHandoff('Work on the selected target and the next actionable queue item');

    expect(handoff).toMatchObject({
      guardrails: { requires_confirmation: true, safe_to_start: false, write_scope: [] },
      intent: { resolved: 'content.handoff.unresolved', selection_mode: 'unresolved' },
      natural_language: { matched_intent: 'ambiguous' },
      status: 'needs_clarification',
      target: null,
    });
  });

  it('blocks external posting and scheduling prompts', () => {
    seedQueue();
    const handoff = resolveContentAgentHandoff('Publish this to TikTok now');

    expect(handoff).toMatchObject({
      intent: { resolved: 'content.handoff.unresolved' },
      natural_language: { matched_intent: 'blocked', matched_terms: ['publish'] },
      status: 'blocked',
      target: null,
    });
    expect(handoff.messages[0].text).toContain('will not post');
  });

  it('returns clarification for empty prompts', () => {
    const handoff = resolveContentAgentHandoff('   ');

    expect(handoff).toMatchObject({
      natural_language: { matched_intent: 'empty' },
      status: 'needs_clarification',
      target: null,
    });
  });
});
