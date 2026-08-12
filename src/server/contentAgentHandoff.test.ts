import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { fileSha256 } from './localReview';
import { attachContentPostAsset, createContentBatch, createContentPost, updateContentPost } from './contentBatches';
import { createReviewSet, selectCurrentAssets } from './assetSelections';
import { getAssetSelectionAgentHandoff, getContentQueueNextAgentHandoff, getContentTargetAgentHandoff, getLineageWorkspaceAgentHandoff } from './contentAgentHandoff';
import { indexLineageAssets, linkLineageAssets, updateSelectedAsset } from './assetLineage';
import { createLineageWorkspace, updateLineageWorkspace } from './assetLineageWorkspaces';
import { setContentTarget } from './contentTargets';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-content-agent-handoff');
const dbFile = join(scratchDir, 'content-agent-handoff.sqlite');

function resetDb() {
  rmSync(scratchDir, { force: true, recursive: true });
  useLineageTestProfile(dbFile);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function seedLocalAsset(): string {
  const file = join(scratchDir, 'demo-content-agent-local.png');
  mkdirSync(scratchDir, { recursive: true });
  writeFileSync(file, Buffer.from('content-agent-handoff-local'));
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedQueue() {
  const localAssetId = seedLocalAsset();
  createContentBatch(defaultProject, {
    batchId: 'agent-batch',
    campaign: '2026-06-organic-traffic-test',
    channel: 'linkedin',
    confirmWrite: true,
    title: 'Agent handoff batch',
  });
  createContentPost(defaultProject, {
    batchId: 'agent-batch',
    channel: 'linkedin',
    confirmWrite: true,
    phase: 'draft',
    postId: 'needs-asset-post',
    title: 'Needs asset post',
  });
  createContentPost(defaultProject, {
    batchId: 'agent-batch',
    channel: 'linkedin',
    confirmWrite: true,
    phase: 'draft',
    postId: 'selected-ready-post',
    title: 'Selected ready post',
  });
  attachContentPostAsset(defaultProject, { assetId: localAssetId, confirmWrite: true, postId: 'selected-ready-post' });
  setContentTarget(defaultProject, { confirmWrite: true, notes: 'Human selected this one.', postId: 'selected-ready-post' });
}

function seedLineageWorkspace() {
  const root = join(scratchDir, 'demo-lineage-agent-root.png');
  const child = join(scratchDir, 'demo-lineage-agent-child.png');
  mkdirSync(scratchDir, { recursive: true });
  writeFileSync(root, Buffer.from('lineage-agent-root'));
  writeFileSync(child, Buffer.from('lineage-agent-child'));
  const rootId = `local-${fileSha256(root).slice(0, 12)}`;
  const childId = `local-${fileSha256(child).slice(0, 12)}`;
  indexLineageAssets(defaultProject);
  linkLineageAssets(defaultProject, { childAssetId: childId, confirmWrite: true, parentAssetId: rootId });
  updateSelectedAsset(defaultProject, {
    assetId: childId,
    confirmWrite: true,
    notes: 'The strongest hook direction.',
    rootAssetId: rootId,
  });
  const workspace = createLineageWorkspace(defaultProject, {
    activate: true,
    confirmWrite: true,
    rootAssetId: rootId,
    title: 'Agent lineage workspace',
  }).workspace!;
  return { childId, rootId, workspace };
}

describe('content agent handoff', () => {
  beforeEach(resetDb);

  it('wraps queue next in stable v1 agent handoff JSON', () => {
    seedQueue();
    const handoff = getContentQueueNextAgentHandoff(defaultProject);

    expect(handoff).toMatchObject({
      schema_version: 'lineage.agent_handoff.v1',
      status: 'ok',
      intent: { project: defaultProject, resolved: 'content.queue.next', selection_mode: 'next_action' },
      target: { id: 'needs-asset-post', is_selected_target: false, readiness: 'needs_asset', type: 'content_post' },
      next_action: { kind: 'continue_content_item', lane: 'needs_asset' },
      guardrails: { requires_confirmation: false, safe_to_start: true },
    });
    expect(handoff.context.selected_target).toMatchObject({ id: 'selected-ready-post', is_selected_target: true });
    expect(handoff.messages[0]).toMatchObject({ level: 'info' });
    expect(handoff.next_action?.commands.attachAssetTemplate).toContain("--post-id 'needs-asset-post'");
  });

  it('wraps selected target without using queue-next semantics', () => {
    seedQueue();
    const handoff = getContentTargetAgentHandoff(defaultProject);

    expect(handoff).toMatchObject({
      schema_version: 'lineage.agent_handoff.v1',
      status: 'ok',
      intent: { resolved: 'content.target.selected', selection_mode: 'selected_target' },
      target: { id: 'selected-ready-post', is_selected_target: true, readiness: 'draft_ready' },
      next_action: { lane: 'next_target' },
    });
    expect(handoff.target?.id).not.toBe('needs-asset-post');
  });

  it('returns a structured clarification when no target is selected', () => {
    createContentBatch(defaultProject, {
      batchId: 'empty-target-batch',
      channel: 'linkedin',
      confirmWrite: true,
      title: 'Empty target batch',
    });
    const handoff = getContentTargetAgentHandoff(defaultProject);

    expect(handoff).toMatchObject({
      status: 'needs_clarification',
      target: null,
      next_action: null,
      guardrails: { requires_confirmation: true, safe_to_start: false },
    });
    expect(handoff.messages[0]).toMatchObject({ level: 'question' });
  });

  it('marks scheduled selected targets as requiring confirmation', () => {
    seedQueue();
    updateContentPost(defaultProject, {
      confirmWrite: true,
      phase: 'scheduled',
      postId: 'selected-ready-post',
      scheduledAt: '2026-06-26T16:00:00-07:00',
    });
    const handoff = getContentTargetAgentHandoff(defaultProject);

    expect(handoff).toMatchObject({
      status: 'ok',
      target: { id: 'selected-ready-post', readiness: 'scheduled' },
      guardrails: { requires_confirmation: true, safe_to_start: false },
    });
  });

  it('wraps current asset selections in stable v1 agent handoff JSON', () => {
    createReviewSet(defaultProject, {
      assetIds: ['asset-selection-a', 'asset-selection-b'],
      confirmWrite: true,
      key: 'handoff-review-set',
      label: 'Handoff review set',
    });
    selectCurrentAssets(defaultProject, { assetIds: ['asset-selection-a', 'asset-selection-b'], confirmWrite: true });

    const handoff = getAssetSelectionAgentHandoff(defaultProject);

    expect(handoff).toMatchObject({
      context: {
        selected_assets: ['asset-selection-a', 'asset-selection-b'],
        selection_set_id: `${defaultProject}:review:handoff-review-set`,
      },
      guardrails: { requires_confirmation: false, safe_to_start: true, write_scope: ['asset_selections'] },
      intent: { resolved: 'asset.selection.current', selection_mode: 'asset_selection' },
      next_action: { kind: 'continue_asset_selection' },
      schema_version: 'lineage.agent_handoff.v1',
      status: 'ok',
      target: null,
    });
    expect(handoff.context.notes[0]).toContain('Next work context: Handoff review set');
    const commands = handoff.next_action?.commands as Record<string, string>;
    expect(commands.currentSelectionCommand).toContain(`--project ${shellQuote(defaultProject)}`);
    expect(commands.reviewSetInspectCommand).toContain(`--set-id ${shellQuote(`${defaultProject}:review:handoff-review-set`)}`);
    expect(commands.reviewSetSetNextCommand).toContain('review-set set-next');
    expect(handoff.next_action?.instructions).toContain('next work context');
  });

  it('uses active review set candidates as next context before labels are chosen', () => {
    createReviewSet(defaultProject, {
      assetIds: ['review-a', 'review-b'],
      confirmWrite: true,
      key: 'candidate-context',
      label: 'Candidate context',
    });

    const handoff = getAssetSelectionAgentHandoff(defaultProject);

    expect(handoff).toMatchObject({
      context: {
        asset_work_packet: {
          kind: 'asset_selection_work_packet',
          review_set: { id: `${defaultProject}:review:candidate-context` },
          suggested_next_action: 'choose_variations',
        },
        related_assets: ['review-a', 'review-b'],
        selected_assets: [],
        selection_set_id: `${defaultProject}:review:candidate-context`,
      },
      guardrails: { requires_confirmation: false, safe_to_start: true, write_scope: ['asset_selections'] },
      next_action: {
        canonical_call: {
          args: { project: defaultProject, 'set-id': `${defaultProject}:review:candidate-context` },
          command: 'selections review-set inspect',
        },
        kind: 'choose_asset_variations',
        label: 'next work context',
      },
      status: 'ok',
    });
    expect(handoff.next_action?.instructions).toContain('Inspect the active review set');
    expect(handoff.context.asset_work_packet?.commands.chooseLabelsTemplate).toContain('selections review-set choose');
    const commands = handoff.next_action?.commands as Record<string, string>;
    expect(commands.workPacketCommand).toContain('selections review-set packet');
  });

  it('quotes active review-set handoff commands with unsafe set ids', () => {
    const key = "unsafe key; echo 'nope'";
    const setId = `${defaultProject}:review:${key}`;
    createReviewSet(defaultProject, {
      assetIds: ['unsafe-review-a', 'unsafe-review-b'],
      confirmWrite: true,
      key,
      label: 'Unsafe candidate context',
    });

    const handoff = getAssetSelectionAgentHandoff(defaultProject);
    const commands = handoff.next_action?.commands as Record<string, string>;

    expect(handoff.next_action?.canonical_call).toMatchObject({
      args: { project: defaultProject, 'set-id': setId },
      command: 'selections review-set inspect',
    });
    expect(commands.currentSelectionCommand).toContain(`selections current --project ${shellQuote(defaultProject)}`);
    expect(commands.reviewSetInspectCommand).toContain(`selections review-set inspect --project ${shellQuote(defaultProject)} --set-id ${shellQuote(setId)}`);
    expect(commands.reviewSetSetNextCommand).toContain(`selections review-set set-next --project ${shellQuote(defaultProject)} --set-id ${shellQuote(setId)}`);
    expect(commands.workPacketCommand).toContain(`selections review-set packet --project ${shellQuote(defaultProject)}`);
    for (const command of Object.values(commands)) {
      expect(command).toContain(`--profile ${shellQuote(process.env.LINEAGE_PROFILE_MANIFEST!)}`);
      expect(command).not.toContain('npx lineage');
    }
  });

  it('wraps the active lineage workspace for agent continuation', () => {
    const { childId, rootId, workspace } = seedLineageWorkspace();

    const handoff = getLineageWorkspaceAgentHandoff(defaultProject);

    expect(handoff).toMatchObject({
      context: {
        related_assets: expect.arrayContaining([rootId, childId]),
        selected_assets: [childId],
      },
      guardrails: {
        requires_confirmation: false,
        safe_to_start: true,
        write_scope: ['lineage_workspaces', 'asset_selections', 'asset_edges'],
      },
      intent: { resolved: 'lineage.workspace.active', selection_mode: 'lineage_workspace' },
      next_action: {
        canonical_call: { command: 'lineage workspace inspect' },
        kind: 'continue_lineage_workspace',
      },
      schema_version: 'lineage.agent_handoff.v1',
      status: 'ok',
      target: {
        id: workspace.id,
        next_asset_id: childId,
        root_asset_id: rootId,
        type: 'lineage_workspace',
      },
    });
    const commands = handoff.next_action?.commands as Record<string, string>;
    expect(commands.workspaceInspectCommand).toContain('workspace inspect');
    expect(commands.lineageBriefCommand).toContain(`--root ${shellQuote(rootId)}`);
    expect(commands.linkChildCommand).toContain('--summary "<one-or-two-words>"');
    expect(handoff.next_action?.instructions).toContain('one- or two-word edge summary');
  });

  it('requires clarification before an agent starts a promptless queued branch', () => {
    const { childId, rootId } = seedLineageWorkspace();
    updateSelectedAsset(defaultProject, {
      assetId: childId,
      confirmWrite: true,
      mode: 'add',
      notes: '',
      rootAssetId: rootId,
    });

    const handoff = getLineageWorkspaceAgentHandoff(defaultProject);

    expect(handoff.status).toBe('needs_clarification');
    expect(handoff.guardrails).toMatchObject({
      requires_confirmation: true,
      safe_to_start: false,
      write_scope: [],
    });
    expect(handoff.context.notes).toContain(`No variation prompt was provided for ${childId}. Ask the user what they want changed before generating.`);
    expect(handoff.messages[0]?.text).toContain('without a prompt');
    expect(handoff.next_action?.instructions).toContain(`ask the human what they want changed for ${childId}`);
  });

  it('uses the workspace branch limit in agent selection guidance', () => {
    const { rootId, workspace } = seedLineageWorkspace();
    const sibling = join(scratchDir, 'demo-lineage-agent-sibling.png');
    writeFileSync(sibling, Buffer.from('lineage-agent-sibling'));
    const siblingId = `local-${fileSha256(sibling).slice(0, 12)}`;
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, { childAssetId: siblingId, confirmWrite: true, parentAssetId: rootId });
    updateSelectedAsset(defaultProject, { clear: true, confirmWrite: true, rootAssetId: rootId });
    updateLineageWorkspace(defaultProject, workspace.id, { confirmWrite: true, maxQueuedBranches: 2 });

    const handoff = getLineageWorkspaceAgentHandoff(defaultProject);

    expect(handoff.status).toBe('needs_clarification');
    expect(handoff.messages[0]?.text).toContain('needs up to 2 next variation bases');
  });
});
