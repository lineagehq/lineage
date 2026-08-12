import { AlertTriangle, Check, FolderPlus, ShieldCheck, X } from 'lucide-react';
import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from 'react';
import type { ProjectDeletionPlan, ProjectWorkspaceSummary } from '../../shared/projectWorkspaceTypes';
import { api } from '../api';

const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

function useDialogBehavior(
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
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });
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

export function CreateProjectDialog(props: {
  onClose: () => void;
  onCreated: (project: ProjectWorkspaceSummary) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const [displayName, setDisplayName] = useState('');
  const [id, setId] = useState('');
  const [idEdited, setIdEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useDialogBehavior(props.onClose, props.returnFocusRef, !busy);

  function deriveId(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanName = displayName.trim();
    const cleanId = id.trim();
    if (!cleanName) return setError('Enter a project name.');
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(cleanId)) {
      return setError('Use a stable ID with lowercase letters, numbers, and hyphens.');
    }
    setBusy(true);
    setError('');
    try {
      const result = await api<{ ok: true; project: ProjectWorkspaceSummary }>('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cleanId, displayName: cleanName, confirmWrite: true }),
      });
      props.onCreated(result.project);
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
          <div className="organization-dialog-icon"><FolderPlus aria-hidden="true" size={20} /></div>
          <div>
            <h2 id={titleId}>Create project</h2>
            <p id={descriptionId}>Projects keep related workspaces and creative assets together.</p>
          </div>
          <button aria-label="Close create project" className="organization-dialog-close" onClick={props.onClose} type="button"><X size={18} /></button>
        </header>
        <form onSubmit={submit}>
          <label>
            Project name
            <input
              autoComplete="off"
              onChange={event => {
                setDisplayName(event.target.value);
                if (!idEdited) setId(deriveId(event.target.value));
              }}
              placeholder="Spring campaign"
              value={displayName}
            />
          </label>
          <label>
            Stable project ID
            <input
              autoComplete="off"
              onChange={event => {
                setIdEdited(true);
                setId(event.target.value);
              }}
              placeholder="spring-campaign"
              value={id}
            />
            <span className="organization-field-help">Used in links and cannot be changed later.</span>
          </label>
          {error && <p className="organization-dialog-error" role="alert">{error}</p>}
          <footer>
            <button className="secondary-button" disabled={busy} onClick={props.onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={busy} type="submit"><Check size={16} />{busy ? 'Creating…' : 'Create project'}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function DeleteProjectDialog(props: {
  onClose: () => void;
  onDeleted: (message: string) => void;
  project: ProjectWorkspaceSummary;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const [plan, setPlan] = useState<ProjectDeletionPlan | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useDialogBehavior(props.onClose, props.returnFocusRef, !busy);

  useEffect(() => {
    let active = true;
    api<{ ok: true; plan: ProjectDeletionPlan }>(`/api/projects/${encodeURIComponent(props.project.id)}/deletion-plan`)
      .then(result => {
        if (active) setPlan(result.plan);
      })
      .catch(nextError => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => { active = false; };
  }, [props.project.id]);

  async function remove() {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ message: string }>(`/api/projects/${encodeURIComponent(props.project.id)}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedDigest: plan.digest,
          confirmation,
          confirmWrite: true,
        }),
      });
      props.onDeleted(result.message);
      props.onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setPlan(null);
      try {
        const refreshed = await api<{ ok: true; plan: ProjectDeletionPlan }>(`/api/projects/${encodeURIComponent(props.project.id)}/deletion-plan`);
        setPlan(refreshed.plan);
      } catch {
        // Keep the actionable deletion error visible.
      }
    } finally {
      setBusy(false);
    }
  }

  const confirmed = confirmation === props.project.display_name || confirmation === props.project.id;
  return (
    <div className="organization-dialog-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) props.onClose();
    }}>
      <section aria-busy={busy} aria-describedby={descriptionId} aria-labelledby={titleId} aria-modal="true" className="organization-dialog organization-danger-dialog" ref={dialogRef} role="alertdialog">
        <header>
          <div className="organization-dialog-icon danger"><AlertTriangle aria-hidden="true" size={20} /></div>
          <div>
            <h2 id={titleId}>Permanently delete project?</h2>
            <p id={descriptionId}>This removes project organization and all associated SQLite state.</p>
          </div>
          <button aria-label="Close delete project" className="organization-dialog-close" disabled={busy} onClick={props.onClose} type="button"><X size={18} /></button>
        </header>
        {!plan && !error && <p className="organization-dialog-loading" role="status">Calculating the exact impact…</p>}
        {plan && (
          <>
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
              <p><strong>Your media stays intact.</strong> Local source files, generated files, and cloud objects are not deleted.</p>
            </div>
            <label>
              Type <strong>{props.project.display_name}</strong> or <strong>{props.project.id}</strong> to confirm
              <input autoComplete="off" onChange={event => setConfirmation(event.target.value)} value={confirmation} />
            </label>
          </>
        )}
        {error && <p className="organization-dialog-error" role="alert">{error}</p>}
        <footer>
          <button className="secondary-button" disabled={busy} onClick={props.onClose} type="button">Cancel</button>
          <button
            className="danger-button"
            disabled={!plan || !confirmed || busy || Boolean(plan.blockers.length)}
            onClick={() => void remove()}
            type="button"
          >
            {busy ? 'Deleting…' : 'Delete project permanently'}
          </button>
        </footer>
      </section>
    </div>
  );
}
