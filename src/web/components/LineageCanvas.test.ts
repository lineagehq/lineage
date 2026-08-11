// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineageNode, LineageTask, LineageTaskStatus, LineageTaskType } from '../../shared/types';
import { lineageCanvasEmptyState, lineageSemanticZoomTier } from './LineageCanvas';
import { quickActionState } from './lineageQuickActions';

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  const Empty = () => null;
  return {
    Background: Empty,
    Controls: Empty,
    Handle: Empty,
    MiniMap: () => React.createElement('div', { 'data-testid': 'minimap' }),
    Position: { Bottom: 'bottom', Left: 'left', Right: 'right', Top: 'top' },
    ReactFlow: (props: { children?: ReactNode; nodes: Array<{ data: LineageNode & { onToggleSocial: (node: LineageNode) => void } }> }) => React.createElement(
      React.Fragment,
      null,
      React.createElement(
        'button',
        { 'data-testid': 'invoke-social', onClick: () => props.nodes[0].data.onToggleSocial(props.nodes[0].data) },
        'Invoke Social',
      ),
      props.children,
    ),
  };
});

let canvasRoot: Root | null = null;
let canvasContainer: HTMLDivElement | null = null;

afterEach(() => {
  if (canvasRoot) act(() => canvasRoot?.unmount());
  canvasRoot = null;
  canvasContainer?.remove();
  canvasContainer = null;
});

describe('lineage inspector quick-action safety', () => {
  it('enforces branch capacity without trapping an already selected node', () => {
    expect(quickActionState(node(), false)).toMatchObject({
      branchDisabled: false,
      branchLocked: false,
      branchTitle: 'Use as a base for the next branch (B)',
    });
    expect(quickActionState(node(), true)).toMatchObject({
      branchDisabled: true,
      branchLocked: false,
      branchTitle: 'The branch selection is full.',
    });
    expect(quickActionState(node({ user_selected: true }), true)).toMatchObject({
      branchDisabled: false,
      branchLocked: false,
      branchTitle: 'Remove from the next branch (B)',
    });
  });

  it.each(['claimed', 'in_progress'] satisfies LineageTaskStatus[])('locks active %s work against inspector toggles', status => {
    const state = quickActionState(node({
      lineage_tasks: {
        iterate: task('iterate', status),
        reroll: task('reroll', status),
      },
    }), false);

    expect(state).toMatchObject({
      branchDisabled: true,
      branchLocked: true,
      rerollDisabled: true,
      rerollLocked: true,
    });
    expect(state.branchTitle).toContain('task queue');
    expect(state.rerollTitle).toContain('task queue');
  });

  it.each(['pending', 'resolved', 'cancelled'] satisfies LineageTaskStatus[])('leaves %s task records toggleable', status => {
    const state = quickActionState(node({
      lineage_tasks: {
        iterate: task('iterate', status),
        reroll: task('reroll', status),
      },
      reroll_request: rerollRequest('pending'),
    }), false);

    expect(state).toMatchObject({
      branchDisabled: false,
      branchLocked: false,
      rerollDisabled: false,
      rerollLocked: false,
      rerollSelected: true,
      rerollTitle: 'Remove from the re-roll queue (R)',
    });
  });

  it('exposes independent Social selected state and shortcut copy', () => {
    expect(quickActionState(node(), false)).toMatchObject({
      socialDisabled: false,
      socialSelected: false,
      socialTitle: 'Mark for Social (S)',
    });
    expect(quickActionState(node({
      social_mark: {
        active: true,
        asset_id: 'local-node',
        id: 'social-1',
        marked_at: '2026-07-25T00:00:00.000Z',
        marked_by: 'human:owner',
        project_id: 'demo-project',
        root_asset_id: 'root',
        updated_at: '2026-07-25T00:00:00.000Z',
      },
    }), false)).toMatchObject({
      socialDisabled: false,
      socialSelected: true,
      socialTitle: 'Unmark from Social (S)',
    });
  });
});

describe('lineage canvas empty-state truthfulness', () => {
  it('never offers a second index while automatic rich-demo indexing is active', () => {
    const state = lineageCanvasEmptyState('rich-root', 'indexing');

    expect(state).toEqual({
      action: 'none',
      description: 'Loading the automatic 14-node index. No manual action is needed.',
      title: 'Indexing rich demo images',
    });
    expect(state.title).not.toContain('No lineage index yet');
  });

  it('separates genuine empty and failed automatic index recovery', () => {
    expect(lineageCanvasEmptyState('real-empty-root', null)).toMatchObject({ action: 'index', title: 'No lineage index yet' });
    expect(lineageCanvasEmptyState('rich-root', 'error')).toMatchObject({ action: 'retry-index', title: 'Rich demo setup failed' });
    expect(lineageCanvasEmptyState('', 'error')).toMatchObject({ action: 'seed', title: 'Rich demo setup failed' });
  });
});

describe('portrait canvas semantic zoom', () => {
  it('uses stable presentation tiers around the experiment thresholds', () => {
    expect(lineageSemanticZoomTier(0.3)).toBe('far');
    expect(lineageSemanticZoomTier(0.449)).toBe('far');
    expect(lineageSemanticZoomTier(0.45)).toBe('medium');
    expect(lineageSemanticZoomTier(0.719)).toBe('medium');
    expect(lineageSemanticZoomTier(0.72)).toBe('near');
  });
});

describe('lineage canvas view aids', () => {
  it('renders the minimap only when its Canvas preference is visible', async () => {
    await renderTestCanvas({ minimapVisible: false });
    expect(canvasContainer!.querySelector('[data-testid="minimap"]')).toBeNull();

    act(() => canvasRoot!.unmount());
    canvasRoot = null;
    canvasContainer!.remove();
    canvasContainer = null;
    await renderTestCanvas({ minimapVisible: true });
    expect(canvasContainer!.querySelector('[data-testid="minimap"]')).not.toBeNull();
  });

  it('serializes interacted Social actions so duplicate requests cannot overlap', async () => {
    let resolveFirst!: () => void;
    const onToggleSocial = vi.fn(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    await renderTestCanvas({ onToggleSocial });
    const invoke = canvasContainer!.querySelector<HTMLButtonElement>('[data-testid="invoke-social"]')!;

    act(() => {
      invoke.click();
      invoke.click();
    });
    expect(onToggleSocial).toHaveBeenCalledTimes(1);

    await act(async () => resolveFirst());
    act(() => invoke.click());
    expect(onToggleSocial).toHaveBeenCalledTimes(2);
  });
});

async function renderTestCanvas(overrides: Record<string, unknown> = {}) {
  const { LineageCanvas } = await import('./LineageCanvas');
  canvasContainer = document.createElement('div');
  document.body.appendChild(canvasContainer);
  canvasRoot = createRoot(canvasContainer);
  act(() => canvasRoot!.render(createElement(LineageCanvas, {
    canvasPresentation: 'compact',
    collapseInteractive: true,
    flowEdges: [],
    flowNodes: [{ data: { ...node(), active: false, focusRole: 'none', root: true }, id: 'local-node', position: { x: 0, y: 0 }, type: 'assetNode' } as never],
    graphKey: 'social-interaction-test',
    hoverPreviewsEnabled: false,
    loading: false,
    minimapVisible: false,
    onClearFocus: vi.fn(),
    onEdgesChange: vi.fn(),
    onEdgeEdit: vi.fn(),
    onIndexNow: vi.fn(),
    onNewLineage: vi.fn(),
    onNodeActionMenu: vi.fn(),
    onNodeInspect: vi.fn(),
    onNodeOpenDetail: vi.fn(),
    onNodeOpenHistory: vi.fn(),
    onNodePosition: vi.fn(),
    onNodesChange: vi.fn(),
    onReady: vi.fn(),
    onSeedDemo: vi.fn(),
    onSelectedAsset: vi.fn(),
    onToggleBranch: vi.fn(),
    onToggleCollapse: vi.fn(),
    onToggleReroll: vi.fn(),
    onToggleSocial: vi.fn(),
    onViewportInteraction: vi.fn(),
    replayInteractive: true,
    selectionFull: false,
    workspaceProgress: 'ready',
    workspaceRootAssetId: 'local-node',
    ...overrides,
  })));
}

function node(overrides: Partial<LineageNode> = {}): LineageNode {
  return {
    asset_id: 'local-node',
    is_latest: true,
    media_type: 'image',
    project: 'demo-project',
    review_state: 'unreviewed',
    source: 'local',
    status: 'working',
    title: 'Node',
    user_selected: false,
    ...overrides,
  };
}

function task(taskType: LineageTaskType, status: LineageTaskStatus): LineageTask {
  return {
    created_at: '2026-07-20T00:00:00.000Z',
    created_by: 'human',
    id: `${taskType}-${status}`,
    project_id: 'demo-project',
    root_asset_id: 'root',
    status,
    target_asset_id: 'local-node',
    task_type: taskType,
    updated_at: '2026-07-20T00:00:00.000Z',
  };
}

function rerollRequest(status: 'cancelled' | 'pending' | 'resolved') {
  return {
    created_at: '2026-07-20T00:00:00.000Z',
    id: `reroll-${status}`,
    node_asset_id: 'local-node',
    project_id: 'demo-project',
    requested_by: 'human' as const,
    root_asset_id: 'root',
    status,
  };
}
