// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Position, ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { AssetNode, type AssetFlowNode } from './LineageAssetNode';
import { hoverPreviewPosition } from './lineageHoverPreview';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe('AssetNode', () => {
  it('opens stacked attempt history from keyboard activation', () => {
    const onOpenHistory = vi.fn();
    const onOpenDetail = vi.fn();
    renderNode({ attempt_count: 3, onOpenDetail, onOpenHistory });
    const node = container!.querySelector<HTMLElement>('.lineage-node')!;

    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' })));

    expect(node.getAttribute('role')).toBe('button');
    expect(node.getAttribute('tabindex')).toBe('0');
    expect(onOpenHistory).toHaveBeenCalledTimes(2);
    expect(onOpenHistory).toHaveBeenCalledWith('local-node');
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('opens detail from keyboard activation for a single-attempt node', () => {
    const onOpenHistory = vi.fn();
    const onOpenDetail = vi.fn();
    renderNode({ attempt_count: 1, onOpenDetail, onOpenHistory });
    const node = container!.querySelector<HTMLElement>('.lineage-node')!;

    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));

    expect(onOpenDetail).toHaveBeenCalledWith('local-node');
    expect(onOpenHistory).not.toHaveBeenCalled();
  });

  it('marks the lineage root for a persistent visual treatment', () => {
    renderNode({ root: true });
    const node = container!.querySelector<HTMLElement>('.lineage-node')!;

    expect(node.classList.contains('root-node')).toBe(true);
    expect(node.dataset.lineageRoot).toBe('true');
    expect(node.querySelector('.lineage-badges .root')?.textContent).toBe('root');
  });

  it('renders the image-first portrait card without compact metadata chrome', () => {
    renderNode({
      attempt_count: 3,
      canvasPresentation: 'portrait',
      preview_url: '/api/assets/local-node/preview',
      root: true,
      semanticZoomTier: 'medium',
      user_selected: true,
    });
    const node = container!.querySelector<HTMLElement>('.lineage-node')!;

    expect(node.classList.contains('lineage-node-portrait')).toBe(true);
    expect(node.classList.contains('lineage-zoom-medium')).toBe(true);
    expect(node.querySelector('.lineage-node-portrait-footer strong')?.textContent).toBe('Swissifier node');
    expect(node.querySelector('.lineage-node-portrait-state')?.textContent).toContain('root');
    expect(node.querySelector('.lineage-node-portrait-state')?.textContent).not.toContain('selected');
    expect(node.querySelector('.lineage-state-chips .branch')?.textContent).toContain('B');
    expect(node.querySelector('.lineage-node-portrait-state')?.textContent).toContain('v3');
    expect(node.querySelector('.lineage-badges')).toBeNull();
    expect(node.textContent).not.toContain('local-node');
  });

  it('keeps work and review markers outside the footer at far portrait zoom', () => {
    renderNode({
      canvasPresentation: 'portrait',
      lineage_tasks: {
        iterate: {
          id: 'task-iterate',
          project_id: 'demo-project',
          root_asset_id: 'local-root',
          target_asset_id: 'local-node',
          task_type: 'iterate',
          status: 'in_progress',
          instructions: 'Make a clean variant.',
          created_by: 'human',
          created_at: '2026-07-07T00:00:00.000Z',
          updated_at: '2026-07-07T00:00:00.000Z',
        },
      },
      review_state: 'needs_revision',
      semanticZoomTier: 'far',
    });
    const node = container!.querySelector<HTMLElement>('.lineage-node')!;
    const markers = node.querySelector<HTMLElement>('.lineage-node-overview-markers')!;

    expect(node.classList.contains('lineage-has-work')).toBe(true);
    expect(node.classList.contains('lineage-review-needs_revision')).toBe(true);
    expect(node.dataset.hasWork).toBe('true');
    expect(node.dataset.reviewState).toBe('needs_revision');
    expect(markers.textContent).toContain('work');
    expect(markers.textContent).toContain('needs revision');
    expect(markers.closest('.lineage-node-portrait-footer')).toBeNull();
  });

  it('keeps future replay nodes mounted but hidden from keyboard and accessibility interaction', () => {
    renderNode({ branchDescendantCount: 2, collapseInteractive: false, replayInteractive: false, replayState: 'future', sourcePosition: Position.Right });
    const shell = container!.querySelector<HTMLElement>('.lineage-node-shell')!;
    const node = container!.querySelector<HTMLElement>('.lineage-node')!;
    const toggle = container!.querySelector<HTMLButtonElement>('.lineage-branch-toggle')!;

    expect(shell.classList.contains('lineage-node-shell-replay-future')).toBe(true);
    expect(node.classList.contains('lineage-node-replay-future')).toBe(true);
    expect(node.getAttribute('aria-hidden')).toBe('true');
    expect(node.getAttribute('tabindex')).toBe('-1');
    expect(toggle.getAttribute('aria-hidden')).toBe('true');
    expect(toggle.getAttribute('tabindex')).toBe('-1');
    expect(toggle.disabled).toBe(true);
  });

  it('offers an accessible branch collapse control without opening the asset', () => {
    const onOpenDetail = vi.fn();
    const onToggleCollapse = vi.fn();
    renderNode({
      branchCollapsed: false,
      branchDescendantCount: 3,
      onOpenDetail,
      onToggleCollapse,
      sourcePosition: Position.Right,
    });
    const toggle = container!.querySelector<HTMLButtonElement>('.lineage-branch-toggle')!;

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Collapse 3 descendants of Swissifier node');
    expect(toggle.textContent).toBe('−');
    expect(toggle.querySelector('strong')).toBeNull();
    act(() => toggle.click());

    expect(onToggleCollapse).toHaveBeenCalledWith('local-node');
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('stages branch motion from the junction without exposing motion metadata', () => {
    renderNode({
      branchTransition: 'entering',
      branchTransitionOffset: { x: -120, y: 36 },
    });
    const shell = container!.querySelector<HTMLElement>('.lineage-node-shell')!;

    expect(shell.classList.contains('lineage-node-branch-entering')).toBe(true);
    expect(shell.style.getPropertyValue('--lineage-branch-motion-x')).toBe('-120px');
    expect(shell.style.getPropertyValue('--lineage-branch-motion-y')).toBe('36px');
    expect(shell.getAttribute('aria-label')).toBeNull();
  });

  it('describes hidden descendants and disables branch changes during replay', () => {
    const onToggleCollapse = vi.fn();
    renderNode({
      branchCollapsed: true,
      branchDescendantCount: 1,
      collapseInteractive: false,
      onToggleCollapse,
      sourcePosition: Position.Bottom,
    });
    const toggle = container!.querySelector<HTMLButtonElement>('.lineage-branch-toggle')!;

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Expand 1 hidden descendant of Swissifier node');
    expect(toggle.disabled).toBe(true);
    expect(toggle.classList.contains('lineage-branch-toggle-bottom')).toBe(true);
    act(() => toggle.click());
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  it.each(['compact', 'portrait'] as const)('requests the full media preview from %s cards without opening detail', canvasPresentation => {
    const onOpenDetail = vi.fn();
    const onOpenHistory = vi.fn();
    const onPreviewChange = vi.fn();
    renderNode({ canvasPresentation, hoverPreviewsEnabled: true, onOpenDetail, onOpenHistory, onPreviewChange, preview_url: '/api/assets/local-node/preview' });
    const node = container!.querySelector<HTMLElement>('.lineage-node')!;

    act(() => node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));

    expect(onPreviewChange).toHaveBeenCalledWith('hover', 'local-node', expect.objectContaining({ left: expect.any(Number), top: expect.any(Number) }));
    expect(onOpenDetail).not.toHaveBeenCalled();
    expect(onOpenHistory).not.toHaveBeenCalled();

    act(() => node.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    expect(onPreviewChange).toHaveBeenLastCalledWith('hover', 'local-node', null);
  });

  it('does not request previews when the preference is disabled', () => {
    const onPreviewChange = vi.fn();
    renderNode({ hoverPreviewsEnabled: false, onPreviewChange, preview_url: '/api/assets/local-node/preview' });
    const node = container!.querySelector<HTMLElement>('.lineage-node')!;

    act(() => node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));

    expect(onPreviewChange).not.toHaveBeenCalled();
    expect(node.title).toBe('Double-click to open detail; drag to reposition');
    expect(node.textContent).toContain('Double-click for details');
  });

  it('keeps double-click as the full-detail action', () => {
    const onOpenDetail = vi.fn();
    const onPreviewDismiss = vi.fn();
    renderNode({ onOpenDetail, onPreviewDismiss, preview_url: '/api/assets/local-node/preview' });
    const node = container!.querySelector<HTMLElement>('.lineage-node')!;

    act(() => node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));

    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).toHaveBeenCalledWith('local-node');
    expect(onPreviewDismiss).toHaveBeenCalledTimes(1);
  });

  it('runs Branch, Re-roll, Flag, Social, and Details from focus-scoped shortcuts', () => {
    const onOpenDetail = vi.fn();
    const onOpenHistory = vi.fn();
    const onPreviewDismiss = vi.fn();
    const onToggleBranch = vi.fn();
    const onToggleReroll = vi.fn();
    const onToggleDiscussion = vi.fn();
    const onToggleSocial = vi.fn();
    renderNode({ attempt_count: 3, onOpenDetail, onOpenHistory, onPreviewDismiss, onToggleBranch, onToggleReroll, onToggleDiscussion, onToggleSocial });
    const node = container!.querySelector<HTMLElement>('.lineage-node')!;

    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'b' })));
    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'R' })));
    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 's' })));
    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'f' })));
    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'd' })));
    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'b' })));
    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, metaKey: true, key: 'd' })));

    expect(onToggleBranch).toHaveBeenCalledTimes(1);
    expect(onToggleBranch).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 'local-node' }));
    expect(onToggleReroll).toHaveBeenCalledTimes(1);
    expect(onToggleReroll).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 'local-node' }));
    expect(onToggleSocial).toHaveBeenCalledTimes(1);
    expect(onToggleSocial).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 'local-node' }));
    expect(onToggleDiscussion).toHaveBeenCalledTimes(1);
    expect(onToggleDiscussion).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 'local-node' }));
    expect(onPreviewDismiss).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).toHaveBeenCalledWith('local-node');
    expect(onOpenHistory).not.toHaveBeenCalled();
  });

  it('suppresses the Social shortcut in editable, modifier, and modal interactions', () => {
    const onToggleSocial = vi.fn();
    renderNode({ onToggleSocial });
    const node = container!.querySelector<HTMLElement>('.lineage-node')!;
    const input = document.createElement('input');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const modalInput = document.createElement('input');
    dialog.appendChild(modalInput);
    document.body.append(input, editable, dialog);

    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 's' })));
    act(() => editable.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 's' })));
    act(() => modalInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 's' })));
    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, bubbles: true, key: 's' })));
    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 's', shiftKey: true })));

    expect(onToggleSocial).not.toHaveBeenCalled();
    input.remove();
    editable.remove();
    dialog.remove();
  });

  it('shows a persistent Social state chip for an active mark', () => {
    renderNode({
      social_mark: {
        active: true,
        asset_id: 'local-node',
        id: 'social-1',
        marked_at: '2026-07-25T00:00:00.000Z',
        marked_by: 'human:owner',
        project_id: 'demo-project',
        root_asset_id: 'local-root',
        updated_at: '2026-07-25T00:00:00.000Z',
      },
    });

    expect(container!.querySelector('.lineage-state-chips .social')?.textContent).toContain('S');
    expect(container!.querySelector('.lineage-state-chips .social')?.getAttribute('title')).toBe('Marked for Social');
  });

  it('shows a persistent labeled discussion Flag chip and shortcut', () => {
    renderNode({
      discussion_mark: { active: true, asset_id: 'local-node', id: 'discussion-1', marked_at: 'now', marked_by: 'human', project_id: 'demo-project', root_asset_id: 'local-root', updated_at: 'now' },
    });
    expect(container!.querySelector('.lineage-state-chips .flag')?.textContent).toContain('F');
    expect(container!.querySelector('.lineage-state-chips .flag')?.getAttribute('title')).toBe('Flagged for discussion');
    expect(container!.querySelector('.lineage-node')?.getAttribute('aria-label')).toContain('Active states: Flagged for discussion');
    expect(container!.querySelector('.lineage-node')?.getAttribute('aria-keyshortcuts')).toBe('B R F S D');
  });

  it('renders compact badges for pending and locked lineage tasks', () => {
    renderNode({
      lineage_tasks: {
        iterate: {
          id: 'task-iterate',
          project_id: 'demo-project',
          root_asset_id: 'local-root',
          target_asset_id: 'local-node',
          task_type: 'iterate',
          status: 'pending',
          instructions: 'Make a clean variant.',
          created_by: 'human',
          created_at: '2026-07-07T00:00:00.000Z',
          updated_at: '2026-07-07T00:00:00.000Z',
        },
        reroll: {
          id: 'task-reroll',
          project_id: 'demo-project',
          root_asset_id: 'local-root',
          target_asset_id: 'local-node',
          task_type: 'reroll',
          status: 'in_progress',
          instructions: 'Repair the current output.',
          created_by: 'human',
          created_at: '2026-07-07T00:00:00.000Z',
          updated_at: '2026-07-07T00:00:00.000Z',
        },
      },
      reroll_request: {
        id: 'reroll-request',
        project_id: 'demo-project',
        root_asset_id: 'local-root',
        node_asset_id: 'local-node',
        status: 'pending',
        requested_by: 'human',
        created_at: '2026-07-07T00:00:00.000Z',
      },
    });

    const badges = Array.from(container!.querySelectorAll<HTMLElement>('.lineage-task-badge'));
    expect(badges.map(badge => badge.textContent)).toEqual(['iterate pending', 'reroll locked']);
    expect(badges[0].className).toContain('pending');
    expect(badges[1].className).toContain('locked');
    expect(container!.textContent).not.toContain('re-roll');
  });

  it('renders locked and explicit unlocked output targets as distinct receipt-derived badges', () => {
    renderNode({ generation_target: { destinations: ['Instagram Story'], dimensions: '1080×1920', imported: true, locked: true } });
    const locked = container!.querySelector<HTMLElement>('.lineage-badges .output-target.locked')!;
    expect(locked.textContent).toBe('locked 1080×1920');
    expect(locked.title).toContain('Instagram Story');
    expect(locked.title).toContain('imported');

    act(() => root!.unmount());
    root = null;
    container!.remove();
    renderNode({ generation_target: { destinations: [], imported: false, locked: false } });
    const unlocked = container!.querySelector<HTMLElement>('.lineage-badges .output-target.unlocked')!;
    expect(unlocked.textContent).toBe('explicitly unlocked');
    expect(unlocked.title).toContain('No pixel lock');
  });

  it('keeps future-child target intent distinct from the current asset receipt badge', () => {
    renderNode({
      generation_target: { destinations: ['Instagram Story'], dimensions: '1080×1920', imported: true, locked: true },
      next_output_target: {
        dimensions: ['1080×1350'],
        label: 'Sticky next 1080×1350',
        origin: 'node_override',
      },
    });

    expect(container!.querySelector('.output-target')?.textContent).toBe('locked 1080×1920');
    const next = container!.querySelector<HTMLElement>('.next-output-target')!;
    expect(next.textContent).toBe('next 1080×1350');
    expect(next.title).toContain('Future children only');
    expect(next.className).toContain('origin-node_override');
  });

  it('makes unresolved future geometry visible without changing the current node geometry', () => {
    renderNode({
      next_output_target: {
        dimensions: [],
        label: 'Next targets unresolved',
        origin: 'unresolved',
      },
    });

    expect(container!.querySelector('.next-output-target')?.textContent).toBe('next unresolved');
    expect(container!.querySelector('.output-target')).toBeNull();
  });

  it('keeps exact branch and re-roll prompts visible on the node', () => {
    renderNode({
      branch_prompt: 'Restyle with a strict Swiss grid.',
      reroll_request: {
        id: 'reroll-1', project_id: 'demo-project', root_asset_id: 'local-node', node_asset_id: 'local-node',
        status: 'pending', requested_by: 'human', prompt: 'Repair the headline only.', created_at: '2026-07-30T00:00:00.000Z',
      },
      user_selected: true,
    });

    const prompts = container!.querySelectorAll<HTMLElement>('.lineage-node-prompts span');
    expect(prompts).toHaveLength(2);
    expect(prompts[0].title).toBe('Branch prompt: Restyle with a strict Swiss grid.');
    expect(prompts[1].title).toBe('Re-roll prompt: Repair the headline only.');
  });
});

describe('hoverPreviewPosition', () => {
  it('places the preview to the right when space is available', () => {
    expect(hoverPreviewPosition({ bottom: 300, left: 100, right: 300, top: 100 }, 1200, 800)).toEqual({ left: 316, top: 16 });
  });

  it('flips and clamps the preview near the viewport edge', () => {
    expect(hoverPreviewPosition({ bottom: 790, left: 900, right: 1100, top: 650 }, 1200, 800)).toEqual({ left: 464, top: 344 });
  });
});

function renderNode(data: Partial<AssetFlowNode['data']>) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const props = {
    data: {
      active: false,
      asset_id: 'local-node',
      attempt_count: 1,
      focusRole: 'none',
      is_latest: true,
      media_type: 'image',
      project: 'demo-project',
      review_state: 'unreviewed',
      root: false,
      source: 'local',
      status: 'planned',
      title: 'Swissifier node',
      user_selected: false,
      ...data,
    },
    dragging: false,
    id: 'local-node',
    isConnectable: false,
    selected: false,
    type: 'assetNode',
    xPos: 0,
    yPos: 0,
    zIndex: 0,
  } as unknown as NodeProps<AssetFlowNode>;
  act(() => {
    root!.render(
      <ReactFlowProvider>
        <AssetNode {...props} />
      </ReactFlowProvider>
    );
  });
}
