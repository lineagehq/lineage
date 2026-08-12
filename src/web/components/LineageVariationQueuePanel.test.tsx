// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineageNode, LineageTaskStatus } from '../../shared/types';
import { LineageVariationQueuePanel, variationPromptFor, variationTaskLocked } from './LineageVariationQueuePanel';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });

describe('LineageVariationQueuePanel', () => {
  it('keeps branch and re-roll prompts distinct on the same node', () => {
    const dual = node({ branch_prompt: 'Branch prompt', reroll_request: reroll('Re-roll prompt'), user_selected: true });
    render({ branchNodes: [dual], rerollNodes: [dual] });
    expect(container!.querySelector('[data-mode="branch"]')?.textContent).toContain('Branch prompt');
    expect(container!.querySelector('[data-mode="reroll"]')?.textContent).toContain('Re-roll prompt');
    expect(container!.querySelectorAll('.lineage-variation-card')).toHaveLength(2);
  });

  it('selects then automatically focuses inline editing by default while child actions stay isolated', () => {
    const onSelect = vi.fn();
    const onShow = vi.fn();
    render({ branchNodes: [node({ branch_prompt: 'Existing', user_selected: true })], onSelect, onShow });
    act(() => container!.querySelector<HTMLButtonElement>('.lineage-variation-select')!.click());
    expect(onSelect).toHaveBeenCalledWith({ mode: 'branch', nodeId: 'node-1' });
    expect(document.activeElement).toBe(container!.querySelector('textarea'));
    act(() => button('Show').click());
    expect(onShow).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('does not auto-edit when disabled but explicit Edit still works', () => {
    render({ autoEdit: false, branchNodes: [node({ branch_prompt: 'Existing', user_selected: true })] });
    act(() => container!.querySelector<HTMLButtonElement>('.lineage-variation-select')!.click());
    expect(container!.querySelector('textarea')).toBeNull();
    act(() => button('Edit').click());
    expect(container!.querySelector('textarea')).not.toBeNull();
  });

  it.each(['claimed', 'in_progress'] as const)('locks edit and removal for %s work', status => {
    const locked = node({ lineage_tasks: { iterate: task(status) }, user_selected: true });
    expect(variationTaskLocked(locked, 'branch')).toBe(true);
    render({ branchNodes: [locked] });
    expect(button('Add prompt').disabled).toBe(true);
    expect(button('Remove').disabled).toBe(true);
    expect(container!.textContent).toContain('prompt locked');
  });

  it('saves trimmed prompts with Cmd/Ctrl+Enter and cancels with Escape', async () => {
    const onSave = vi.fn(async () => true);
    render({ branchNodes: [node({ user_selected: true })], onSave });
    act(() => button('Add prompt').click());
    const textarea = container!.querySelector('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '  Exact prompt  ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'Enter' })));
    expect(onSave).toHaveBeenCalledWith(expect.anything(), 'branch', 'Exact prompt');
    act(() => button('Add prompt').click());
    act(() => container!.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
    expect(container!.querySelector('textarea')).toBeNull();
  });

  it('shows and saves promptless queue items as needing a prompt', async () => {
    const onSave = vi.fn(async () => true);
    render({ branchNodes: [node({ user_selected: true })], onSave });
    expect(container!.textContent).toContain('No prompt yet — your agent will ask');
    expect(container!.textContent).toContain('Needs prompt');
    act(() => button('Add prompt').click());
    await act(async () => button('Save without prompt').click());
    expect(onSave).toHaveBeenCalledWith(expect.anything(), 'branch', '');
  });
});

function render(overrides: Partial<Parameters<typeof LineageVariationQueuePanel>[0]> = {}) {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  const props: Parameters<typeof LineageVariationQueuePanel>[0] = {
    autoEdit: true, branchNodes: [], closePanel: vi.fn(), onRemove: vi.fn(), onSave: vi.fn(async () => true), onSelect: vi.fn(), onShow: vi.fn(), primary: null, rerollNodes: [], ...overrides,
  };
  act(() => root!.render(<LineageVariationQueuePanel {...props} />));
}

function button(text: string) { return [...container!.querySelectorAll('button')].find(item => item.textContent?.replaceAll(/\s/g, '').includes(text.replaceAll(/\s/g, ''))) as HTMLButtonElement; }
function node(overrides: Partial<LineageNode> = {}): LineageNode { return { asset_id: 'node-1', is_latest: true, media_type: 'image', project: 'demo-project', review_state: 'unreviewed', source: 'local', status: 'working', title: 'Node one', user_selected: false, ...overrides }; }
function reroll(prompt: string) { return { created_at: '2026-07-30T00:00:00.000Z', id: 'reroll-1', node_asset_id: 'node-1', project_id: 'demo-project', prompt, requested_by: 'human' as const, root_asset_id: 'root', status: 'pending' as const }; }
function task(status: LineageTaskStatus) { return { created_at: '2026-07-30T00:00:00.000Z', created_by: 'human' as const, id: `task-${status}`, project_id: 'demo-project', root_asset_id: 'root', status, target_asset_id: 'node-1', task_type: 'iterate' as const, updated_at: '2026-07-30T00:00:00.000Z' }; }

describe('variationPromptFor', () => {
  it('supports promptless legacy aliases', () => {
    expect(variationPromptFor(node({ selection_note: 'Legacy branch' }), 'branch')).toBe('Legacy branch');
    expect(variationPromptFor(node({ reroll_request: { ...reroll(''), notes: 'Legacy reroll' } }), 'reroll')).toBe('Legacy reroll');
  });
});
