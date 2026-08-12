// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineageNode } from '../../shared/types';
import { discussionNotePosition, LineageDiscussionNoteDialog } from './LineageDiscussionNoteDialog';

let container: HTMLDivElement; let root: Root;
const node = { asset_id: 'asset-1', title: 'Hero crop', media_type: 'image', project: 'demo', review_state: 'unreviewed', source: 'local', status: 'working', is_latest: true, user_selected: false } as LineageNode;

describe('LineageDiscussionNoteDialog', () => {
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('keeps the note optional when marking', () => {
    const onSave = vi.fn();
    act(() => root.render(<LineageDiscussionNoteDialog mode="mark" node={node} onCancel={() => undefined} onSave={onSave} />));
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === 'Flag without note')!;
    act(() => button.click());
    expect(onSave).toHaveBeenCalledWith('');
    expect(container.textContent).toContain('does not branch, re-roll, or start work');
  });

  it('edits and clears a note while Escape cancels without saving', () => {
    const onCancel = vi.fn(); const onSave = vi.fn();
    act(() => root.render(<LineageDiscussionNoteDialog mode="edit" node={{ ...node, discussion_mark: { active: true, asset_id: 'asset-1', id: 'mark', marked_at: 'now', marked_by: 'human', notes: 'Old note', project_id: 'demo', root_asset_id: 'root', updated_at: 'now' } }} onCancel={onCancel} onSave={onSave} />));
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(textarea.value).toBe('Old note');
    act(() => { textarea.value = ''; textarea.dispatchEvent(new Event('change', { bubbles: true })); });
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('anchors below a trigger when space permits and flips above near the viewport edge', () => {
    expect(discussionNotePosition({ bottom: 120, left: 900, right: 940, top: 80 }, 1024, 800)).toEqual({ left: 582, top: 130 });
    expect(discussionNotePosition({ bottom: 720, left: 100, right: 140, top: 680 }, 1024, 800)).toEqual({ left: 100, top: 340 });
    expect(discussionNotePosition({ bottom: 120, left: 20, right: 60, top: 80 }, 390, 844)).toEqual({});
  });
});
