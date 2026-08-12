import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { GitBranch, RefreshCcw } from 'lucide-react';
import type { LineageNode } from '../../shared/types';
import './LineageVariationPromptDialog.css';

export type VariationPromptMode = 'branch' | 'reroll';
export type VariationPromptAnchor = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>;

// eslint-disable-next-line react-refresh/only-export-components -- pure positioning contract shared with regression tests
export function variationPromptPosition(anchor: VariationPromptAnchor, viewportWidth: number, viewportHeight: number) {
  const gap = 14;
  const margin = 16;
  const width = Math.min(430, viewportWidth - margin * 2);
  const estimatedHeight = 390;
  const left = anchor.right + gap + width <= viewportWidth - margin
    ? anchor.right + gap
    : Math.max(margin, anchor.left - width - gap);
  const top = Math.min(Math.max(margin, anchor.top), Math.max(margin, viewportHeight - estimatedHeight - margin));
  return { left, top };
}

export function LineageVariationPromptDialog({
  initialPrompt = '',
  anchor,
  mode,
  node,
  onClose,
  onSubmit,
}: {
  initialPrompt?: string;
  anchor?: VariationPromptAnchor;
  mode: VariationPromptMode;
  node: LineageNode;
  onClose: () => void;
  onSubmit: (prompt: string) => Promise<void> | void;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isBranch = mode === 'branch';
  const title = isBranch ? 'Describe the next branch' : 'Describe the re-roll';
  const action = isBranch ? 'Queue branch' : 'Queue re-roll';
  const queued = isBranch ? node.user_selected : node.reroll_request?.status === 'pending';
  const trimmed = prompt.trim();
  const position = anchor && typeof window !== 'undefined'
    ? variationPromptPosition(anchor, window.innerWidth, window.innerHeight)
    : undefined;

  useEffect(() => {
    textareaRef.current?.focus();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setBusy(false);
    }
  }

  const Icon = isBranch ? GitBranch : RefreshCcw;
  return (
    <div className={`lineage-prompt-backdrop ${anchor ? 'anchored' : ''}`} onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <form aria-labelledby="lineage-prompt-title" aria-modal="true" className={`lineage-prompt-dialog ${anchor ? 'anchored' : ''}`} onSubmit={submit} role="dialog" style={position as CSSProperties | undefined}>
        <header>
          <span aria-hidden="true" className={`lineage-prompt-icon ${mode}`}><Icon size={22} /></span>
          <div>
            <span className="lineage-prompt-eyebrow">{isBranch ? 'New variation' : 'New attempt'}</span>
            <h2 id="lineage-prompt-title">{title}</h2>
            <p>{node.title}</p>
          </div>
          <button aria-label="Close prompt" className="lineage-prompt-close" disabled={busy} onClick={onClose} type="button">×</button>
        </header>
        <label className="lineage-prompt-field">
          <span>What should your agent change?</span>
          <textarea
            maxLength={1600}
            onChange={event => setPrompt(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={isBranch
              ? 'e.g. Restyle this as a crisp Swiss editorial poster with a tighter grid and warmer red.'
              : 'e.g. Keep the composition exactly, but fix the distorted headline and soften the shadows.'}
            ref={textareaRef}
            rows={6}
            value={prompt}
          />
          <small><span>{prompt.length}/1600</span> Leave blank and your agent will ask what should change.</small>
        </label>
        <footer>
          <button disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? 'Saving…' : trimmed ? (queued ? 'Save prompt' : action) : (queued ? 'Save without prompt' : 'Queue without prompt')}
          </button>
        </footer>
      </form>
    </div>
  );
}
