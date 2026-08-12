import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { LineageNode } from '../../shared/types';
import './LineageDiscussionNoteDialog.css';

export function LineageDiscussionNoteDialog({
  anchor,
  mode,
  node,
  onCancel,
  onSave,
}: {
  anchor?: { bottom: number; left: number; right: number; top: number };
  mode: 'edit' | 'mark';
  node: LineageNode;
  onCancel: () => void;
  onSave: (note: string) => Promise<void> | void;
}) {
  const [note, setNote] = useState(node.discussion_mark?.notes || '');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { textareaRef.current?.focus(); }, []);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);
  const position = discussionNotePosition(anchor, typeof window === 'undefined' ? 1024 : window.innerWidth, typeof window === 'undefined' ? 768 : window.innerHeight);

  return (
    <div className="lineage-discussion-note-backdrop" role="presentation">
      <section aria-labelledby="discussion-note-title" aria-modal="true" className="lineage-discussion-note-dialog" role="dialog" style={position as CSSProperties}>
        <header>
          <span>Discussion flag</span>
          <h3 id="discussion-note-title">{mode === 'edit' ? 'Edit optional note' : 'Add an optional note'}</h3>
          <p>{node.title}</p>
        </header>
        <label>
          <span>What should the agent consider?</span>
          <textarea
            aria-label="Discussion note"
            onChange={event => setNote(event.target.value)}
            placeholder="For example: Is this sized appropriately for LinkedIn?"
            ref={textareaRef}
            rows={4}
            value={note}
          />
        </label>
        <p className="lineage-discussion-note-help">This adds conversational context only. It does not branch, re-roll, or start work.</p>
        <footer>
          <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
          {mode === 'mark' && <button className="secondary-button" onClick={() => void onSave('')} type="button">Flag without note</button>}
          <button className="primary-button" onClick={() => void onSave(note.trim())} type="button">
            {mode === 'edit' ? (note.trim() ? 'Save note' : 'Clear note') : 'Flag for discussion'}
          </button>
        </footer>
      </section>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- viewport-safe geometry is tested independently
export function discussionNotePosition(
  anchor: { bottom: number; left: number; right: number; top: number } | undefined,
  viewportWidth: number,
  viewportHeight: number,
): { left?: number; top?: number } {
  if (!anchor || viewportWidth <= 520) return {};
  const width = Math.min(430, viewportWidth - 24);
  const estimatedHeight = 330;
  const left = Math.max(12, Math.min(anchor.left, viewportWidth - width - 12));
  const below = anchor.bottom + 10;
  const top = below + estimatedHeight <= viewportHeight
    ? below
    : Math.max(12, anchor.top - estimatedHeight - 10);
  return { left, top };
}
