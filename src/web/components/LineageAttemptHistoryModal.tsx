import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { AssetReviewState, LineageAttempt, LineageNode, LineageSnapshot } from '../../shared/types';
import { LineageNodeActionFooter } from './LineageNodeActionFooter';
import './LineageAttemptHistoryModal.css';

export function LineageAttemptHistoryModal({
  actions,
  attempts,
  node,
  onClose,
  onPromoteAttempt,
  project,
}: {
  actions?: {
    canRemoveFromLineage: boolean;
    onClearAllNext: () => void;
    onClearNext: () => void;
    onEdit?: (node: LineageNode) => void;
    onOpenNode: (assetId: string) => void;
    onRemoveFromLineage: (node: LineageNode) => void;
    onReplaceNext: (node: LineageNode) => void;
    onReview: (reviewState: AssetReviewState, assetId: string) => void;
    onSelectNext: (node: LineageNode) => void;
    onToast: (type: 'ok' | 'error', message: string) => void;
    selectedCount: number;
    selectionFull: boolean;
    snapshot: LineageSnapshot;
  };
  attempts: LineageAttempt[];
  node: LineageNode;
  onClose: () => void;
  onPromoteAttempt?: (attempt: LineageAttempt) => Promise<void> | void;
  project: string;
}) {
  const ordered = useMemo(() => [...attempts].sort((a, b) => b.attempt_index - a.attempt_index), [attempts]);
  const current = ordered.find(attempt => attempt.is_current) || ordered[0];
  const [selectedAttemptId, setSelectedAttemptId] = useState(current?.id);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousActive?.focus();
    };
  }, []);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab') trapModalFocus(event, modalRef);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  useEffect(() => { setSelectedAttemptId(current?.id); }, [current?.id, node.asset_id]);
  const selected = ordered.find(attempt => attempt.id === selectedAttemptId) || current;
  const previewUrl = attemptPreviewUrl(project, node, selected);
  return (
    <div className="lineage-attempt-backdrop" onClick={onClose}>
      <section aria-labelledby="lineage-attempt-title" aria-modal="true" className="lineage-attempt-modal" onClick={event => event.stopPropagation()} ref={modalRef} role="dialog" tabIndex={-1}>
        <header>
          <div>
            <h3 id="lineage-attempt-title">Attempt history</h3>
            <strong>{node.title}</strong>
            <code>{node.asset_id}</code>
          </div>
          <button onClick={onClose} ref={closeButtonRef} type="button">Close</button>
        </header>
        <div className="lineage-attempt-body">
          <div className="lineage-attempt-preview">
            {previewUrl ? <img src={previewUrl} alt={node.title} /> : <span>{selected?.source || node.media_type}</span>}
          </div>
          <div aria-label="Attempt versions" className="lineage-attempt-list" role="listbox">
            {ordered.map(attempt => {
              const attemptUrl = attemptPreviewUrl(project, node, attempt);
              const selectedRow = attempt.id === selected?.id;
              return (
                <article
                  aria-selected={selectedRow}
                  className={`lineage-attempt-item ${attempt.is_current ? 'current' : ''} ${selectedRow ? 'selected' : ''}`}
                  key={attempt.id}
                  onClick={() => setSelectedAttemptId(attempt.id)}
                  onKeyDown={event => selectAttemptFromKey(event, () => setSelectedAttemptId(attempt.id))}
                  role="option"
                  tabIndex={0}
                >
                  <div>
                    <strong>v{attempt.attempt_index}</strong>
                    <div className="lineage-attempt-flags">
                      {selectedRow && <span className="viewing">viewing</span>}
                      {attempt.is_current && <span>current</span>}
                    </div>
                  </div>
                  <div className="lineage-attempt-row">
                    <div className="lineage-attempt-thumb">
                      {attemptUrl ? <img src={attemptUrl} alt="" loading="lazy" /> : <span>{attempt.source}</span>}
                    </div>
                    <dl>
                      <div><dt>Source</dt><dd>{attempt.source}</dd></div>
                      <div><dt>Asset</dt><dd>{attempt.asset_id}</dd></div>
                      {attempt.file_path && <div><dt>File</dt><dd>{attempt.file_path}</dd></div>}
                      {attempt.generation_job_id && <div><dt>Job</dt><dd>{attempt.generation_job_id}</dd></div>}
                      {attempt.prompt && <div><dt>Prompt</dt><dd>{attempt.prompt}</dd></div>}
                      {attempt.editor_provenance && <>
                        <div><dt>Editor</dt><dd>{attempt.editor_provenance.plugin_id} · {attempt.editor_provenance.package_version}</dd></div>
                        <div><dt>Edit summary</dt><dd>{attempt.editor_provenance.edit_summary}</dd></div>
                        <div><dt>Protocol</dt><dd>{attempt.editor_provenance.protocol}</dd></div>
                      </>}
                      <div><dt>Created</dt><dd>{attempt.created_at}</dd></div>
                    </dl>
                  </div>
                  {!attempt.is_current && onPromoteAttempt && (
                    <button
                      className="lineage-attempt-promote"
                      onClick={event => {
                        event.stopPropagation();
                        void onPromoteAttempt(attempt);
                      }}
                      onKeyDown={event => stopRowKeyboardActivation(event)}
                      type="button"
                    >
                      Set current
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </div>
        {actions && (
          <LineageNodeActionFooter
            canRemoveFromLineage={actions.canRemoveFromLineage}
            node={node}
            onClearAllNext={actions.onClearAllNext}
            onClearNext={actions.onClearNext}
            onEdit={actions.onEdit}
            onOpenNode={actions.onOpenNode}
            onRemoveFromLineage={actions.onRemoveFromLineage}
            onReplaceNext={actions.onReplaceNext}
            onReview={actions.onReview}
            onSelectNext={actions.onSelectNext}
            onToast={actions.onToast}
            selectedCount={actions.selectedCount}
            selectionFull={actions.selectionFull}
            snapshot={actions.snapshot}
          />
        )}
      </section>
    </div>
  );
}

function selectAttemptFromKey(event: KeyboardEvent<HTMLElement>, select: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select();
}

function stopRowKeyboardActivation(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.stopPropagation();
}

function trapModalFocus(event: globalThis.KeyboardEvent, modalRef: RefObject<HTMLElement>): void {
  const modal = modalRef.current;
  if (!modal) return;
  const focusable = Array.from(modal.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(element => !element.hasAttribute('disabled') && !element.hidden);
  if (focusable.length === 0) {
    event.preventDefault();
    modal.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function attemptPreviewUrl(project: string, node: LineageNode, attempt?: LineageAttempt): string | undefined {
  if (!attempt) return node.preview_url;
  if (attempt.file_path) {
    const params = new URLSearchParams({ project, path: attempt.file_path });
    return `/api/assets/local-preview?${params.toString()}`;
  }
  if (attempt.asset_id === node.asset_id) return node.preview_url;
  return undefined;
}
