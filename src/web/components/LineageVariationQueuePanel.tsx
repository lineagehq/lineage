import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Crosshair, GitBranch, Pencil, RefreshCcw, Trash2 } from 'lucide-react';
import type { LineageNode, LineageTask } from '../../shared/types';
import type { VariationPromptMode } from './LineageVariationPromptDialog';
import './LineageVariationQueuePanel.css';

export type VariationQueueSelection = { mode: VariationPromptMode; nodeId: string };

export function LineageVariationQueuePanel({
  autoEdit,
  branchNodes,
  closePanel,
  onRemove,
  onSave,
  onSelect,
  onShow,
  primary,
  rerollNodes,
}: {
  autoEdit: boolean;
  branchNodes: LineageNode[];
  closePanel: () => void;
  onRemove: (node: LineageNode, mode: VariationPromptMode) => Promise<void> | void;
  onSave: (node: LineageNode, mode: VariationPromptMode, prompt: string) => Promise<boolean | void> | boolean | void;
  onSelect: (selection: VariationQueueSelection) => void;
  onShow: (node: LineageNode, mode: VariationPromptMode) => void;
  primary: VariationQueueSelection | null;
  rerollNodes: LineageNode[];
}) {
  const [editing, setEditing] = useState<VariationQueueSelection | null>(null);
  const total = branchNodes.length + rerollNodes.length;
  const missingPromptCount = [...branchNodes.map(node => variationPromptFor(node, 'branch')), ...rerollNodes.map(node => variationPromptFor(node, 'reroll'))]
    .filter(prompt => !prompt.trim()).length;

  return (
    <aside aria-label="Variation queue" className="lineage-side lineage-variation-queue" id="lineage-canvas-panel">
      <header className="lineage-side-head lineage-variation-queue-head">
        <div>
          <span className="lineage-prompt-eyebrow">{missingPromptCount > 0 ? `${missingPromptCount} ${missingPromptCount === 1 ? 'item needs' : 'items need'} a prompt` : 'Ready for your agent'}</span>
          <h3>Variation queue <span>{total}</span></h3>
          <p>Review every instruction and its place on the Canvas.</p>
        </div>
        <button autoFocus aria-label="Close Variation queue" className="icon-button" onClick={closePanel} type="button">×</button>
      </header>
      {total === 0 ? (
        <div className="lineage-variation-empty">
          <strong>No variations queued</strong>
            <p>Choose Branch or Re-roll on a Canvas node to add it here.</p>
        </div>
      ) : (
        <div className="lineage-variation-groups">
          <VariationGroup
            autoEdit={autoEdit}
            editing={editing}
            mode="branch"
            nodes={branchNodes}
            onEdit={setEditing}
            onRemove={onRemove}
            onSave={onSave}
            onSelect={onSelect}
            onShow={onShow}
            primary={primary}
          />
          <VariationGroup
            autoEdit={autoEdit}
            editing={editing}
            mode="reroll"
            nodes={rerollNodes}
            onEdit={setEditing}
            onRemove={onRemove}
            onSave={onSave}
            onSelect={onSelect}
            onShow={onShow}
            primary={primary}
          />
        </div>
      )}
    </aside>
  );
}

function VariationGroup({
  autoEdit,
  editing,
  mode,
  nodes,
  onEdit,
  onRemove,
  onSave,
  onSelect,
  onShow,
  primary,
}: {
  autoEdit: boolean;
  editing: VariationQueueSelection | null;
  mode: VariationPromptMode;
  nodes: LineageNode[];
  onEdit: (selection: VariationQueueSelection | null) => void;
  onRemove: (node: LineageNode, mode: VariationPromptMode) => Promise<void> | void;
  onSave: (node: LineageNode, mode: VariationPromptMode, prompt: string) => Promise<boolean | void> | boolean | void;
  onSelect: (selection: VariationQueueSelection) => void;
  onShow: (node: LineageNode, mode: VariationPromptMode) => void;
  primary: VariationQueueSelection | null;
}) {
  const Icon = mode === 'branch' ? GitBranch : RefreshCcw;
  return (
    <section aria-labelledby={`lineage-variation-${mode}`} className={`lineage-variation-group ${mode}`}>
      <div className="lineage-variation-group-title">
        <span aria-hidden="true"><Icon size={15} /></span>
        <h4 id={`lineage-variation-${mode}`}>{mode === 'branch' ? 'Branches' : 'Re-rolls'}</h4>
        <small>{nodes.length}</small>
      </div>
      {nodes.length === 0 ? <p className="lineage-variation-none">None queued</p> : nodes.map(node => {
        const selection = { mode, nodeId: node.asset_id };
        const selected = primary?.mode === mode && primary.nodeId === node.asset_id;
        const isEditing = editing?.mode === mode && editing.nodeId === node.asset_id;
        return (
          <VariationCard
            autoEdit={autoEdit}
            editing={isEditing}
            key={`${mode}:${node.asset_id}`}
            mode={mode}
            node={node}
            onEdit={() => onEdit(selection)}
            onEditClose={() => onEdit(null)}
            onRemove={() => void onRemove(node, mode)}
            onSave={prompt => onSave(node, mode, prompt)}
            onSelect={() => {
              onSelect(selection);
              if (autoEdit && !variationTaskLocked(node, mode)) onEdit(selection);
            }}
            onShow={() => onShow(node, mode)}
            selected={selected}
          />
        );
      })}
    </section>
  );
}

function VariationCard({ autoEdit, editing, mode, node, onEdit, onEditClose, onRemove, onSave, onSelect, onShow, selected }: {
  autoEdit: boolean;
  editing: boolean;
  mode: VariationPromptMode;
  node: LineageNode;
  onEdit: () => void;
  onEditClose: () => void;
  onRemove: () => void;
  onSave: (prompt: string) => Promise<boolean | void> | boolean | void;
  onSelect: () => void;
  onShow: () => void;
  selected: boolean;
}) {
  const initialPrompt = variationPromptFor(node, mode);
  const [draft, setDraft] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const locked = variationTaskLocked(node, mode);
  const task = node.lineage_tasks?.[mode === 'branch' ? 'iterate' : 'reroll'];

  useEffect(() => setDraft(initialPrompt), [initialPrompt]);
  useEffect(() => { if (editing) textareaRef.current?.focus(); }, [editing]);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    const prompt = draft.trim();
    if (busy || locked) return;
    setBusy(true);
    try {
      const saved = await onSave(prompt);
      if (saved !== false) onEditClose();
    } finally {
      setBusy(false);
    }
  }

  function editorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDraft(initialPrompt);
      onEditClose();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      void save();
    }
  }

  return (
    <article className={`lineage-variation-card ${selected ? 'primary' : ''}`} data-mode={mode} data-node-id={node.asset_id}>
      <button aria-pressed={selected} className="lineage-variation-select" onClick={onSelect} type="button">
        <span className={`lineage-variation-kind ${mode}`}>{mode === 'branch' ? 'Branch' : 'Re-roll'}</span>
        <strong>{node.title}</strong>
        <code>{node.asset_id}</code>
        {!editing && <span className={`lineage-variation-prompt ${initialPrompt ? '' : 'missing'}`}>{initialPrompt || 'No prompt yet — your agent will ask'}</span>}
      </button>
      {editing && !locked && (
        <form className="lineage-variation-editor" onSubmit={save}>
          <label>
            <span>Prompt</span>
            <textarea maxLength={1600} onChange={event => setDraft(event.target.value)} onKeyDown={editorKeyDown} ref={textareaRef} rows={4} value={draft} />
          </label>
          <small>⌘/Ctrl + Enter to save · Esc to cancel</small>
          <div>
            <button disabled={busy} onClick={() => { setDraft(initialPrompt); onEditClose(); }} type="button">Cancel</button>
            <button className="primary-button" disabled={busy} type="submit">{busy ? 'Saving…' : draft.trim() ? 'Save' : 'Save without prompt'}</button>
          </div>
        </form>
      )}
      <div className="lineage-variation-card-footer">
        <span className={locked ? 'locked' : initialPrompt ? 'ready' : 'needs-prompt'}>{locked ? `${task?.status === 'in_progress' ? 'In progress' : 'Claimed'} · prompt locked` : initialPrompt ? 'Ready for your agent' : 'Needs prompt'}</span>
        <div>
          <button aria-label={`${initialPrompt ? 'Edit' : 'Add'} ${mode} prompt for ${node.title}`} disabled={locked} onClick={onEdit} title={locked ? 'An agent is already working on this instruction' : undefined} type="button"><Pencil aria-hidden="true" size={14} />{initialPrompt ? 'Edit' : 'Add prompt'}</button>
          <button aria-label={`Show ${node.title} on canvas`} onClick={onShow} type="button"><Crosshair aria-hidden="true" size={14} />Show</button>
          <button aria-label={`Remove ${mode} for ${node.title}`} disabled={locked} onClick={onRemove} title={locked ? 'An agent is already working on this instruction' : undefined} type="button"><Trash2 aria-hidden="true" size={14} />Remove</button>
        </div>
      </div>
      {autoEdit && selected && !editing && !locked && <span className="lineage-variation-auto-edit-hint">Select again to edit</span>}
    </article>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- pure queue compatibility helper shared with regression tests
export function variationPromptFor(node: LineageNode, mode: VariationPromptMode): string {
  return mode === 'branch'
    ? node.branch_prompt || node.selection_note || ''
    : node.reroll_request?.prompt || node.reroll_request?.notes || '';
}

// eslint-disable-next-line react-refresh/only-export-components -- pure task-safety helper shared with the Canvas owner
export function variationTaskLocked(node: LineageNode, mode: VariationPromptMode): boolean {
  const task: LineageTask | undefined = node.lineage_tasks?.[mode === 'branch' ? 'iterate' : 'reroll'];
  return task?.status === 'claimed' || task?.status === 'in_progress';
}
