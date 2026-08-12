import { AlertTriangle, Archive, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import type { LineageWorkspace } from '../../shared/lineageWorkspaceTypes';
import type { WorkspaceDeletionPlan } from '../../shared/projectWorkspaceTypes';
import { api } from '../api';

const focusableSelector = 'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

function useWorkspaceDialog(
  onClose: () => void,
  returnFocusRef?: RefObject<HTMLElement | null>,
  closeAllowed = true
) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeAllowedRef = useRef(closeAllowed);
  useEffect(() => {
    closeAllowedRef.current = closeAllowed;
  }, [closeAllowed]);
  useEffect(() => {
    const returnFocus = returnFocusRef?.current || document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus());
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && closeAllowedRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      returnFocus?.focus();
    };
  }, [onClose, returnFocusRef]);
  return dialogRef;
}

export function WorkspaceStatusDialog(props: {
  action: 'archive' | 'restore';
  onClose: () => void;
  onDone: (message: string) => void;
  project: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  workspace: LineageWorkspace;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useWorkspaceDialog(props.onClose, props.returnFocusRef, !busy);
  const restoring = props.action === 'restore';
  const Icon = restoring ? RotateCcw : Archive;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const path = restoring
        ? `/api/projects/${encodeURIComponent(props.project)}/workspaces/${encodeURIComponent(props.workspace.id)}/restore`
        : `/api/lineage-workspaces/${encodeURIComponent(props.workspace.id)}/archive`;
      const result = await api<{ message?: string }>(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: props.project, confirmWrite: true }),
      });
      props.onDone(result.message || `${restoring ? 'Restored' : 'Archived'} ${props.workspace.title}`);
      props.onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="organization-dialog-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) props.onClose();
    }}>
      <section aria-busy={busy} aria-describedby={descriptionId} aria-labelledby={titleId} aria-modal="true" className="organization-dialog" ref={dialogRef} role="dialog">
        <header>
          <div className="organization-dialog-icon"><Icon aria-hidden="true" size={20} /></div>
          <div>
            <h2 id={titleId}>{restoring ? 'Restore workspace?' : 'Archive workspace?'}</h2>
            <p id={descriptionId}>{restoring ? 'It will return to the open workspace collection.' : 'You can restore it later from Archived.'}</p>
          </div>
          <button aria-label={`Close ${props.action} workspace`} className="organization-dialog-close" disabled={busy} onClick={props.onClose} type="button"><X size={18} /></button>
        </header>
        <div className="organization-dialog-subject"><strong>{props.workspace.title}</strong><span>{props.workspace.id}</span></div>
        {error && <p className="organization-dialog-error" role="alert">{error}</p>}
        <footer>
          <button className="secondary-button" disabled={busy} onClick={props.onClose} type="button">Cancel</button>
          <button className="primary-button" disabled={busy} onClick={() => void submit()} type="button">
            {busy ? `${restoring ? 'Restoring' : 'Archiving'}…` : restoring ? 'Restore workspace' : 'Archive workspace'}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function DeleteWorkspaceDialog(props: {
  onClose: () => void;
  onDeleted: (message: string) => void;
  project: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  workspace: LineageWorkspace;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const [plan, setPlan] = useState<WorkspaceDeletionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useWorkspaceDialog(props.onClose, props.returnFocusRef, !busy);

  async function loadPlan() {
    try {
      const result = await api<{ ok: true; plan: WorkspaceDeletionPlan }>(
        `/api/projects/${encodeURIComponent(props.project)}/workspaces/${encodeURIComponent(props.workspace.id)}/deletion-plan`
      );
      setPlan(result.plan);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  useEffect(() => {
    void loadPlan();
  }, [props.project, props.workspace.id]);

  async function remove() {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ message: string }>(
        `/api/projects/${encodeURIComponent(props.project)}/workspaces/${encodeURIComponent(props.workspace.id)}/delete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedDigest: plan.digest, confirmWrite: true }),
        }
      );
      props.onDeleted(result.message);
      props.onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setPlan(null);
      await loadPlan();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="organization-dialog-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) props.onClose();
    }}>
      <section aria-busy={busy} aria-describedby={descriptionId} aria-labelledby={titleId} aria-modal="true" className="organization-dialog organization-danger-dialog" ref={dialogRef} role="alertdialog">
        <header>
          <div className="organization-dialog-icon danger"><AlertTriangle aria-hidden="true" size={20} /></div>
          <div>
            <h2 id={titleId}>Permanently delete workspace?</h2>
            <p id={descriptionId}>This is separate from archive and cannot be undone.</p>
          </div>
          <button aria-label="Close delete workspace" className="organization-dialog-close" disabled={busy} onClick={props.onClose} type="button"><X size={18} /></button>
        </header>
        {!plan && !error && <p className="organization-dialog-loading" role="status">Calculating the exact impact…</p>}
        {plan && (
          <>
            <div className="organization-dialog-subject">
              <strong>{props.workspace.title}</strong>
              <span>Root {plan.root_asset_id}</span>
            </div>
            {plan.blockers.length > 0 && (
              <div className="organization-blockers" role="alert">
                <strong>Deletion is currently blocked</strong>
                {plan.blockers.map(blocker => <p key={blocker.code}>{blocker.message}</p>)}
              </div>
            )}
            <dl className="organization-impact-grid">
              {plan.counts.filter(item => item.count > 0).map(item => (
                <div key={item.table}><dt>{item.table.replaceAll('_', ' ')}</dt><dd>{item.count}</dd></div>
              ))}
            </dl>
            <div className="organization-preservation-note">
              <ShieldCheck aria-hidden="true" size={19} />
              <p><strong>Your media and asset catalog stay intact.</strong> Asset records, local files, generated files, and cloud objects are preserved.</p>
            </div>
          </>
        )}
        {error && <p className="organization-dialog-error" role="alert">{error}</p>}
        <footer>
          <button className="secondary-button" disabled={busy} onClick={props.onClose} type="button">Cancel</button>
          <button
            className="danger-button"
            disabled={!plan || busy || Boolean(plan.blockers.length)}
            onClick={() => void remove()}
            type="button"
          >
            {busy ? 'Deleting…' : 'Delete workspace permanently'}
          </button>
        </footer>
      </section>
    </div>
  );
}
