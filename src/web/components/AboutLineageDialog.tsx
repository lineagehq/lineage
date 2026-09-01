import {
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  Github,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { appDescription, appName } from '../../shared/appConstants';
import type { LineageRuntimeInfo } from '../../shared/runtimeInfoTypes';
import { buildAboutLineageDiagnostics } from '../aboutLineageDiagnostics';
import { copyToClipboard } from '../clipboard';
import { lineageReleaseInfo } from '../releaseInfo';
import './AboutLineageDialog.css';

const repositoryUrl = 'https://github.com/mean-weasel/lineage';
const documentationUrl = 'https://lineage.neonwatty.com/docs/';

export function AboutLineageDialog({
  onClose,
  returnFocusRef,
  runtime,
  runtimeIdentityUnavailable,
}: {
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  runtime: LineageRuntimeInfo | null;
  runtimeIdentityUnavailable: boolean;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnTarget = returnFocusRef?.current || previousActive;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      returnTarget?.focus();
    };
  }, [returnFocusRef]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab') trapDialogFocus(event, dialogRef);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const runtimeUnavailable = runtimeIdentityUnavailable || !runtime;
  const revision = runtime?.code?.git_sha || runtime?.git_sha;
  const runtimeChannel = runtimeUnavailable ? 'Unavailable' : runtime.channel;
  const environment = runtimeUnavailable ? 'Unavailable' : runtime.profile.environment;
  const profile = runtimeUnavailable ? 'Unavailable' : runtime.profile.id;

  async function copyDiagnostics() {
    try {
      await copyToClipboard(buildAboutLineageDiagnostics(runtime, runtimeIdentityUnavailable));
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  return createPortal(
    <div className="about-lineage-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="about-lineage-title"
        aria-modal="true"
        className="about-lineage-dialog"
        onMouseDown={event => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="about-lineage-header">
          <div className="about-lineage-identity">
            <span aria-hidden="true" className="about-lineage-mark">L</span>
            <div>
              <p>Creative provenance, made visible</p>
              <h2 id="about-lineage-title">About {appName}</h2>
            </div>
          </div>
          <button
            aria-label="Close About Lineage"
            className="about-lineage-close"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="about-lineage-body">
          <p className="about-lineage-description">{appDescription}.</p>

          <dl className="about-lineage-facts">
            <Fact label="Version" value={`v${lineageReleaseInfo.version}`} />
            <Fact label="Release channel" value={lineageReleaseInfo.channel} />
            <Fact label="Runtime channel" value={runtimeChannel} />
            <Fact label="Environment" value={environment} />
            <Fact label="Profile" title={runtimeUnavailable ? undefined : profile} value={profile} />
            <Fact
              label="Revision"
              title={runtimeUnavailable ? undefined : revision}
              value={!runtimeUnavailable && revision ? revision.slice(0, 10) : 'Unavailable'}
            />
          </dl>

          <div className="about-lineage-links">
            <a href={repositoryUrl} rel="noreferrer" target="_blank">
              <Github aria-hidden="true" size={18} />
              <span><strong>GitHub repository</strong><small>Source, issues, and releases</small></span>
              <ExternalLink aria-hidden="true" size={15} />
            </a>
            <a href={documentationUrl} rel="noreferrer" target="_blank">
              <BookOpen aria-hidden="true" size={18} />
              <span><strong>Documentation</strong><small>Guides and reference</small></span>
              <ExternalLink aria-hidden="true" size={15} />
            </a>
          </div>
        </div>

        <footer className="about-lineage-footer">
          <p aria-live="polite" className={`about-lineage-copy-status ${copyState}`}>
            {copyState === 'copied' && 'Diagnostics copied'}
            {copyState === 'error' && 'Could not copy diagnostics'}
          </p>
          <button className="about-lineage-copy" onClick={() => void copyDiagnostics()} type="button">
            {copyState === 'copied' ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
            {copyState === 'copied' ? 'Copied' : 'Copy diagnostics'}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}

function Fact({ label, title, value }: { label: string; title?: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={title}>{value}</dd>
    </div>
  );
}

function trapDialogFocus(event: globalThis.KeyboardEvent, dialogRef: RefObject<HTMLElement | null>): void {
  const dialog = dialogRef.current;
  if (!dialog) return;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(element => !element.hasAttribute('disabled') && !element.hidden);
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
