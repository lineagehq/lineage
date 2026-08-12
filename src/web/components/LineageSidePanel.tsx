import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import type { AssetReviewState, LineageBriefResponse, LineageNode, LineageSnapshot, LineageTask, LineageTaskMutationResponse } from '../../shared/types';
import { api } from '../api';
import { storageStateFor } from '../assetUi';
import { useLineageCli } from '../lineageRuntimeCommand';
import { CandidateMeta } from './LineageCandidateMeta';
import { LineageHandoffPanel } from './LineageHandoffPanel';
import type { VariationPromptMode } from './LineageVariationPromptDialog';

interface LineageSidePanelProps {
  activeNode?: LineageNode;
  brief: LineageBriefResponse | null;
  childAssetId: string;
  clearNextVariation: (assetId?: string) => Promise<void>;
  closePanel: () => void;
  editVariationPrompt?: (node: LineageNode, mode: VariationPromptMode, branchAction?: 'add' | 'edit' | 'replace') => void;
  latestNodes: LineageNode[];
  linkChild: () => Promise<void>;
  noteDirty: boolean;
  nextVariationLimit: number;
  onSelectedAsset: (assetId: string) => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  project: string;
  refreshBrief: () => Promise<void>;
  refreshLineage: () => Promise<void>;
  replaceNextVariation?: (node: LineageNode, notes?: string) => void;
  saveRationale: () => void;
  selectNextBase?: (node: LineageNode, notes?: string) => void;
  selectedNode?: LineageNode;
  selectedNodes: LineageNode[];
  selectionFull: boolean;
  selectionNote: string;
  setActiveNodeId: Dispatch<SetStateAction<string | null>>;
  setChildAssetId: Dispatch<SetStateAction<string>>;
  setDetailNodeId: Dispatch<SetStateAction<string | null>>;
  setSelected?: () => void;
  setSelectionNote: Dispatch<SetStateAction<string>>;
  sideOpen: boolean;
  snapshot: LineageSnapshot;
  markReview: (reviewState: AssetReviewState, assetId?: string) => Promise<void>;
  mode: 'selection' | 'asset';
}

export function LineageSidePanel(props: LineageSidePanelProps) {
  const cli = useLineageCli();
  const {
    activeNode, brief, childAssetId, clearNextVariation, closePanel, editVariationPrompt, latestNodes, linkChild, markReview, noteDirty, onSelectedAsset,
    nextVariationLimit, onToast, project, refreshBrief, saveRationale, selectedNode, selectedNodes, selectionFull,
    refreshLineage, replaceNextVariation, selectNextBase, selectionNote, setActiveNodeId, setChildAssetId, setDetailNodeId, setSelected, setSelectionNote, sideOpen, snapshot, mode,
  } = props;
  const editPrompt = editVariationPrompt || ((node: LineageNode, mode: VariationPromptMode, branchAction?: 'add' | 'edit' | 'replace') => {
    if (mode !== 'branch') return;
    if (branchAction === 'replace') replaceNextVariation?.(node);
    else if (node.asset_id === activeNode?.asset_id) setSelected?.();
    else selectNextBase?.(node);
  });
  const activeStorage = activeNode ? storageStateFor({ hasLocal: Boolean(activeNode.local_path), hasS3: Boolean(activeNode.s3_key) }) : null;
  const staleSelectedNodes = selectedNodes.filter(node => !node.is_latest);
  const pendingRerollNodes = snapshot.nodes.filter(node => node.reroll_request?.status === 'pending');
  const branchLimitMessage = `${selectedNodes.length} of ${nextVariationLimit} branches queued. Raise the maximum in Canvas settings or remove a branch.`;
  const toggleBranch = (node: LineageNode) => {
    if (node.user_selected) {
      void clearNextVariation(node.asset_id);
      return;
    }
    if (selectionFull) {
      onToast('error', branchLimitMessage);
      return;
    }
    editPrompt(node, 'branch', 'add');
  };
  const submitChild = (event: FormEvent) => {
    event.preventDefault();
    void linkChild();
  };

  if (mode === 'asset') {
    return (
      <aside aria-hidden={!sideOpen} aria-label="Canvas asset details" className={`lineage-side ${sideOpen ? '' : 'collapsed'}`} id="lineage-canvas-panel">
        <div className="lineage-side-head">
          <div>
            <h3>Asset details</h3>
            <p className="muted-copy">Canvas-scoped details for the inspected node.</p>
          </div>
          <button aria-label="Close Canvas asset details" className="icon-button" onClick={closePanel} type="button">×</button>
        </div>
        {activeNode ? (
          <section className="lineage-asset-panel">
            <strong>{activeNode.title}</strong>
            <code>{activeNode.asset_id}</code>
            <dl>
              <div><dt>Storage</dt><dd>{activeStorage && <span className={`storage-chip ${activeStorage.kind}`}>{activeStorage.label}</span>}</dd></div>
              <div><dt>Source</dt><dd>{activeNode.source}</dd></div>
              <div><dt>Review</dt><dd>{activeNode.review_state}</dd></div>
              <div><dt>Latest</dt><dd>{activeNode.is_latest ? 'yes' : 'no'}</dd></div>
              <div><dt>Next variation</dt><dd>{activeNode.user_selected ? 'yes' : 'no'}</dd></div>
            </dl>
            <div className="lineage-side-actions">
              <button aria-disabled={!activeNode.user_selected && selectionFull || undefined} aria-label={activeNode.user_selected ? `Remove ${activeNode.title} from next variation` : `Use ${activeNode.title} for next variation`} className="primary-lite" onClick={() => toggleBranch(activeNode)} title={!activeNode.user_selected && selectionFull ? branchLimitMessage : undefined}>{activeNode.user_selected ? 'Remove from next variation' : selectionFull ? 'Selection full' : 'Use for next variation'}</button>
              <button aria-label={`Open full detail for ${activeNode.title}`} onClick={() => setDetailNodeId(activeNode.asset_id)}>Open full detail</button>
              <button aria-label={`Approve ${activeNode.title}`} onClick={() => void markReview('approved')}>Approve</button>
              <button aria-label={`Reject ${activeNode.title}`} onClick={() => void markReview('rejected')}>Reject</button>
              <button aria-label={`Ignore ${activeNode.title}`} onClick={() => void markReview('ignored')}>Ignore</button>
            </div>
          </section>
        ) : <p className="muted-copy">No lineage node selected.</p>}
      </aside>
    );
  }

  return (
    <aside aria-hidden={!sideOpen} aria-label="Canvas selection" className={`lineage-side ${sideOpen ? '' : 'collapsed'}`} id="lineage-canvas-panel">
      <div className="lineage-side-head">
        <div>
          <h3>Next variation</h3>
          <p className="muted-copy">Choose what the agent will evolve next; double-click nodes for full details.</p>
        </div>
        <button aria-label="Close lineage selection panel" className="icon-button" onClick={closePanel} type="button">×</button>
      </div>
      <section className="lineage-next-panel">
        <div className="lineage-panel-title-row">
          <h3>Using for next variation</h3>
          <span className={`lineage-count-pill ${selectionFull ? 'full' : ''}`}>{selectedNodes.length}/{nextVariationLimit}</span>
        </div>
        {selectedNodes.length > 0 && (
          <div className="lineage-panel-action-row">
            <button onClick={() => void clearNextVariation()} type="button">Clear all</button>
          </div>
        )}
        {staleSelectedNodes.length > 0 && (
          <div className="lineage-selection-warning" role="status">
            {staleSelectedNodes.length} selected asset{staleSelectedNodes.length === 1 ? ' is' : 's are'} not latest. This is valid for branching, but clear or replace it if you meant to continue from the newest leaves.
          </div>
        )}
        {selectedNodes.length > 0 ? (
          selectedNodes.map(node => (
            <div className="lineage-candidate selected" key={node.asset_id}>
              <button aria-label={`Inspect asset used for next variation ${node.title}`} className="lineage-candidate-main" onClick={() => { setActiveNodeId(node.asset_id); onSelectedAsset(node.asset_id); }}>
                <span>{node.title}</span>
                <code>{node.asset_id}</code>
                <CandidateMeta node={node} />
                <small className={`lineage-saved-prompt ${node.branch_prompt ? '' : 'missing'}`}>{node.branch_prompt ? `“${node.branch_prompt}”` : 'No prompt — your agent will ask'}</small>
              </button>
              {!node.is_latest && <span className="lineage-candidate-warning">Not latest</span>}
              <div className="lineage-candidate-actions">
                <button className="lineage-candidate-action secondary" onClick={() => editPrompt(node, 'branch', 'edit')}>Edit prompt</button>
                {selectedNodes.length > 1 && <button className="lineage-candidate-action secondary" onClick={() => editPrompt(node, 'branch', 'replace')}>Use only this</button>}
                <button className="lineage-candidate-action remove" onClick={() => void clearNextVariation(node.asset_id)}>Remove</button>
              </div>
            </div>
          ))
        ) : (
          <p className="muted-copy">Choose up to {nextVariationLimit} assets to guide the next generation.</p>
        )}
        {selectedNodes.length > 1 && <p className="muted-copy">The agent will use these as separate next-variation bases; imported outputs should link back to the matching selected parent.</p>}
      </section>
      <LineageTaskQueuePanel
        activeNode={activeNode}
        onSelectedAsset={onSelectedAsset}
        onToast={onToast}
        project={project}
        refreshLineage={refreshLineage}
        setActiveNodeId={setActiveNodeId}
        snapshot={snapshot}
      />
      <section className="lineage-next-panel">
        <div className="lineage-panel-title-row">
          <h3>Re-roll queue</h3>
          <span className="lineage-count-pill">{pendingRerollNodes.length}</span>
        </div>
        {pendingRerollNodes.length > 0 ? pendingRerollNodes.map(node => (
          <div className={`lineage-candidate ${node.asset_id === activeNode?.asset_id ? 'active' : ''}`} key={node.asset_id}>
            <button aria-label={`Inspect re-roll target ${node.title}`} className="lineage-candidate-main" onClick={() => { setActiveNodeId(node.asset_id); onSelectedAsset(node.asset_id); }}>
              <span>{node.title}</span>
              <code>{node.asset_id}</code>
              {(node.reroll_request?.prompt || node.reroll_request?.notes) && <small className="lineage-saved-prompt">“{node.reroll_request.prompt || node.reroll_request.notes}”</small>}
            </button>
            <div className="lineage-candidate-actions"><button className="lineage-candidate-action secondary" onClick={() => editPrompt(node, 'reroll')}>Edit prompt</button></div>
          </div>
        )) : <p className="muted-copy">No pending re-roll targets.</p>}
      </section>
      <section className="lineage-next-panel">
        <h3>Latest candidates</h3>
        {latestNodes.length > 0 ? latestNodes.map(node => {
          const cannotAdd = !node.user_selected && selectionFull;
          return (
            <div className={`lineage-candidate ${node.asset_id === activeNode?.asset_id ? 'active' : ''} ${node.user_selected ? 'selected' : ''}`} key={node.asset_id}>
              <button aria-label={`Inspect ${node.title}`} className="lineage-candidate-main" onClick={() => { setActiveNodeId(node.asset_id); onSelectedAsset(node.asset_id); }}>
                <span>{node.title}</span>
                <code>{node.asset_id}</code>
                <CandidateMeta node={node} />
              </button>
              <div className="lineage-candidate-actions">
                <button aria-disabled={cannotAdd || undefined} aria-label={node.user_selected ? `Remove ${node.title} from next variation` : `Use ${node.title} for next variation`} className={`lineage-candidate-action ${node.user_selected ? 'remove' : ''}`} onClick={() => toggleBranch(node)} title={cannotAdd ? branchLimitMessage : undefined}>
                  {node.user_selected ? 'Remove' : cannotAdd ? 'Selection full' : 'Use for next variation'}
                </button>
                {!node.user_selected && selectedNodes.length > 0 && <button className="lineage-candidate-action secondary" onClick={() => editPrompt(node, 'branch', 'replace')}>Replace selection</button>}
              </div>
            </div>
          );
        }) : <p className="muted-copy">No latest leaves yet.</p>}
      </section>
      <LineageHandoffPanel brief={brief} cli={cli} nextBase={selectedNode} onRefreshBrief={() => void refreshBrief()} onToast={onToast} project={project} rerollTargets={pendingRerollNodes} rootAssetId={snapshot.root_asset_id} />
      <h3>Inspecting</h3>
      {activeNode ? (
        <>
          <strong>{activeNode.title}</strong>
          <code>{activeNode.asset_id}</code>
          <dl>
            <div><dt>Storage</dt><dd>{activeStorage && <span className={`storage-chip ${activeStorage.kind}`}>{activeStorage.label}</span>}</dd></div>
            <div><dt>Source</dt><dd>{activeNode.source}</dd></div>
            <div><dt>Review</dt><dd>{activeNode.review_state}</dd></div>
            <div><dt>Latest</dt><dd>{activeNode.is_latest ? 'yes' : 'no'}</dd></div>
            <div><dt>Next variation</dt><dd>{activeNode.user_selected ? 'yes' : 'no'}</dd></div>
          </dl>
          {activeNode.user_selected && !activeNode.is_latest && (
            <div className="lineage-selection-warning" role="status">
              This selected asset is not a latest leaf. Keep it selected to branch from an earlier idea, or replace it with the current inspected asset.
            </div>
          )}
          <label className="lineage-note-field">
            Exact branch prompt
            <textarea value={selectionNote} onChange={event => setSelectionNote(event.target.value)} placeholder="What exactly should your agent change in the next branch?" />
            <span className={`lineage-note-status ${noteDirty ? 'dirty' : ''}`}>{activeNode.user_selected ? (noteDirty ? 'Unsaved prompt' : selectionNote.trim() ? 'Prompt saved on this node' : 'No prompt — your agent will ask') : 'The prompt saves when this node is queued for a branch'}</span>
          </label>
          <div className="lineage-side-actions">
            <button aria-disabled={!activeNode.user_selected && selectionFull || undefined} aria-label={activeNode.user_selected ? `Remove ${activeNode.title} from next variation` : `Use ${activeNode.title} for next variation`} className="primary-lite" onClick={() => toggleBranch(activeNode)} title={!activeNode.user_selected && selectionFull ? branchLimitMessage : undefined}>{activeNode.user_selected ? 'Remove from next variation' : selectionFull ? 'Selection full' : 'Queue branch'}</button>
            {activeNode.user_selected && selectedNodes.length > 1 && <button onClick={() => editPrompt(activeNode, 'branch', 'replace')}>Use only this</button>}
            {!activeNode.user_selected && selectedNodes.length > 0 && <button onClick={() => editPrompt(activeNode, 'branch', 'replace')}>Replace selection</button>}
            <button disabled={!activeNode.user_selected || !noteDirty} onClick={saveRationale}>{selectionNote.trim() ? 'Save prompt' : 'Clear prompt'}</button>
            {activeNode.reroll_request?.status === 'pending' && <button onClick={() => editPrompt(activeNode, 'reroll')}>Edit re-roll prompt</button>}
            <button aria-label={`Open detail for ${activeNode.title}`} onClick={() => setDetailNodeId(activeNode.asset_id)}>Open detail</button>
            <button aria-label={`Approve ${activeNode.title}`} onClick={() => void markReview('approved')}>Approve</button>
            <button aria-label={`Reject ${activeNode.title}`} onClick={() => void markReview('rejected')}>Reject</button>
            <button aria-label={`Ignore ${activeNode.title}`} onClick={() => void markReview('ignored')}>Ignore</button>
          </div>
          <form className="lineage-link-form" onSubmit={submitChild}>
            <label>
              Child asset ID
              <input value={childAssetId} onChange={event => setChildAssetId(event.target.value)} placeholder="local-... or catalog id" />
            </label>
            <button disabled={!childAssetId.trim()} type="submit">Link child</button>
          </form>
        </>
      ) : (
        <p className="muted-copy">No lineage node selected.</p>
      )}
    </aside>
  );
}

function LineageTaskQueuePanel({ activeNode, onSelectedAsset, onToast, project, refreshLineage, setActiveNodeId, snapshot }: {
  activeNode?: LineageNode;
  onSelectedAsset: (assetId: string) => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  project: string;
  refreshLineage: () => Promise<void>;
  setActiveNodeId: Dispatch<SetStateAction<string | null>>;
  snapshot: LineageSnapshot;
}) {
  const tasks = useMemo(() => orderedLineageTasks(snapshot.tasks || []), [snapshot.tasks]);
  const openCount = tasks.filter(task => isOpenTask(task)).length;
  const nodesByAsset = useMemo(() => new Map(snapshot.nodes.map(node => [node.asset_id, node])), [snapshot.nodes]);
  return (
    <section className="lineage-next-panel lineage-task-queue-panel">
      <div className="lineage-panel-title-row">
        <h3>Task queue</h3>
        <span className="lineage-count-pill">{openCount}</span>
      </div>
      {tasks.length > 0 ? tasks.map(task => (
        <LineageTaskCard
          active={task.target_asset_id === activeNode?.asset_id}
          key={`${task.id}:${task.updated_at}`}
          node={nodesByAsset.get(task.target_asset_id)}
          onInspect={() => {
            setActiveNodeId(task.target_asset_id);
            onSelectedAsset(task.target_asset_id);
          }}
          onToast={onToast}
          project={project}
          refreshLineage={refreshLineage}
          task={task}
        />
      )) : <p className="muted-copy">No open lineage tasks.</p>}
    </section>
  );
}

function LineageTaskCard({ active, node, onInspect, onToast, project, refreshLineage, task }: {
  active: boolean;
  node?: LineageNode;
  onInspect: () => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  project: string;
  refreshLineage: () => Promise<void>;
  task: LineageTask;
}) {
  const locked = task.status === 'claimed' || task.status === 'in_progress';
  const pending = task.status === 'pending';
  const [instructions, setInstructions] = useState(task.instructions || '');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setInstructions(task.instructions || ''), [task.id, task.instructions]);

  async function mutate(path: string, body: Record<string, unknown>, message: string): Promise<boolean> {
    setBusy(true);
    try {
      await api<LineageTaskMutationResponse>(path, {
        body: JSON.stringify({ project, ...body }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      onToast('ok', message);
      await refreshLineage();
      return true;
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveInstructions(event: FormEvent) {
    event.preventDefault();
    await mutate(`/api/lineage/tasks/${encodeURIComponent(task.id)}/instructions`, { instructions }, `Updated ${taskLabel(task)} instructions`);
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    const message = comment.trim();
    if (!message) return;
    if (await mutate(`/api/lineage/tasks/${encodeURIComponent(task.id)}/comment`, { actor: 'human', message }, `Commented on ${taskLabel(task)}`)) {
      setComment('');
    }
  }

  async function overrideTask() {
    if (!window.confirm(`Unlock ${taskLabel(task)} for human edits?`)) return;
    await mutate(`/api/lineage/tasks/${encodeURIComponent(task.id)}/override`, {
      actor: 'human',
      reason: 'Human unlocked task from lineage UI.',
    }, `Unlocked ${taskLabel(task)}`);
  }

  async function cancelTask() {
    if (!window.confirm(locked ? `Cancel ${taskLabel(task)} while an agent is working?` : `Cancel ${taskLabel(task)}?`)) return;
    await mutate(`/api/lineage/tasks/${encodeURIComponent(task.id)}/cancel`, {
      actor: 'human',
      confirmWrite: true,
      override: locked,
    }, `Cancelled ${taskLabel(task)}`);
  }

  return (
    <article className={`lineage-task-card ${active ? 'active' : ''} ${locked ? 'locked' : task.status}`}>
      <button aria-label={`Inspect task target ${node?.title || task.target_asset_id}`} className="lineage-task-target" onClick={onInspect} type="button">
        <span>{node?.title || task.target_asset_id}</span>
        <code>{task.target_asset_id}</code>
      </button>
      <div className="lineage-task-meta">
        <span className={`lineage-task-status ${task.status}`}>{statusLabel(task.status)}</span>
        <span>{task.task_type}</span>
      </div>
      {pending ? (
        <form className="lineage-task-form" onSubmit={saveInstructions}>
          <label>
            Instructions
            <textarea aria-label={`Instructions for ${task.id}`} value={instructions} onChange={event => setInstructions(event.target.value)} />
          </label>
          <div className="lineage-task-actions">
            <button disabled={busy || instructions === (task.instructions || '')} type="submit">Save instructions</button>
            <button disabled={busy} onClick={cancelTask} type="button">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="lineage-task-locked-body">
          <label>
            Instructions
            <textarea aria-label={`Locked instructions for ${task.id}`} disabled readOnly value={instructions || 'No instructions.'} />
          </label>
          {locked && <ClaimLine claim={task.active_claim} />}
          {locked && (
            <form className="lineage-task-form" onSubmit={addComment}>
              <label>
                Comment
                <textarea aria-label={`Comment for ${task.id}`} value={comment} onChange={event => setComment(event.target.value)} />
              </label>
              <div className="lineage-task-actions">
                <button disabled={busy || !comment.trim()} type="submit">Add comment</button>
                <button disabled={busy} onClick={overrideTask} type="button">Unlock</button>
                <button disabled={busy} onClick={cancelTask} type="button">Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
    </article>
  );
}

function ClaimLine({ claim }: { claim?: LineageTask['active_claim'] }) {
  if (!claim) return <p className="lineage-task-claim">Claimed by agent</p>;
  const state = claim.derived_state === 'active' ? 'active' : claim.derived_state;
  return (
    <p className={`lineage-task-claim ${state}`}>
      <span>{statusLabel(claim.derived_state)} claim</span>
      <strong>{claim.agent_name}</strong>
    </p>
  );
}

function orderedLineageTasks(tasks: LineageTask[]): LineageTask[] {
  return [...tasks].sort((left, right) => {
    const leftOpen = isOpenTask(left) ? 0 : 1;
    const rightOpen = isOpenTask(right) ? 0 : 1;
    if (leftOpen !== rightOpen) return leftOpen - rightOpen;
    return left.created_at.localeCompare(right.created_at);
  });
}

function isOpenTask(task: LineageTask): boolean {
  return task.status === 'pending' || task.status === 'claimed' || task.status === 'in_progress';
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function taskLabel(task: LineageTask): string {
  return `${task.task_type} task`;
}
