// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineageSnapshot, LineageWorkspace } from '../../shared/types';
import { LineageToolbar } from './LineageToolbar';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('LineageToolbar', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, claims: [], fetchedAt: '2026-07-09T00:00:00.000Z' }),
    }));
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows static workspace identity without an in-canvas workspace picker', () => {
    renderToolbar();

    expect(container!.querySelector('.lineage-title')).toBeNull();
    expect(container!.querySelector('h2')?.textContent).not.toBe('Lineage');
    expect(container!.querySelector('.lineage-workspace-picker')).toBeNull();
    expect(container!.querySelector(`[aria-label="Current canvas: ${workspace.title}"]`)).not.toBeNull();
    expect(container!.querySelector('.lineage-workspace-context')?.textContent).toContain('Current canvas');
    expect(container!.querySelector('.lineage-workspace-context')?.textContent).toContain('Open');
    expect(container!.querySelector('.lineage-workspace-context strong')?.textContent).toBe(workspace.title);
    expect(container!.querySelector('.lineage-toolbar-context')?.textContent).toContain('7 nodes');
    expect(container!.querySelector('.lineage-toolbar-context')?.textContent).toContain('6 links');
  });

  it('keeps canvas-specific selection and output commands visible without workspace management', () => {
    renderToolbar();

    expect(container!.querySelector('.lineage-primary-controls')?.textContent).toContain('Replay growth');
    expect(container!.querySelector('.lineage-primary-controls')?.textContent).toContain('Plan outputs');
    expect(container!.querySelector('.lineage-primary-controls')?.textContent).toContain('Variation queue');
    expect(container!.querySelector('.lineage-primary-controls')?.textContent).toContain('Output target defaults');
    expect(container!.querySelector('.lineage-primary-controls')?.textContent).not.toContain('New lineage');
    expect([...container!.querySelectorAll('summary')].some(summary => summary.textContent === 'Actions')).toBe(false);
    expect(container!.textContent).not.toContain('Fit graph');
    expect(container!.textContent).not.toContain('Tidy tree');
  });

  it('keeps the persistent Discussion collection out of the contextual left column', () => {
    renderToolbar();
    expect(container!.querySelector('[aria-label="Discussion set"]')).toBeNull();
    expect(container!.querySelector('.lineage-discussion-set')).toBeNull();
  });

  it('opens target planning from the selected branch and keeps defaults in human settings', () => {
    const onOpenGeneration = vi.fn();
    const onOpenOutputDefaults = vi.fn();
    renderToolbar({
      onOpenGeneration,
      onOpenOutputDefaults,
      snapshot: { ...snapshot, selected: ['child-1'] },
    });

    const plan = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Plan outputs')!;
    act(() => plan.click());
    expect(onOpenGeneration).toHaveBeenCalledOnce();
    const defaults = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Output target defaults')!;
    act(() => defaults.click());
    expect(onOpenOutputDefaults).toHaveBeenCalledOnce();
  });

  it('starts replay from its visible control and disables duplicate entry while active', () => {
    const onReplayGrowth = vi.fn();
    renderToolbar({ onReplayGrowth });

    const replay = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Replay growth')!;
    expect(replay.disabled).toBe(false);
    act(() => replay.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onReplayGrowth).toHaveBeenCalledOnce();

    renderToolbar({ replayActive: true });
    const activeReplay = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Replay growth')!;
    expect(activeReplay.disabled).toBe(true);
    expect(activeReplay.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps maintenance and Demo/QA tools reachable in default-collapsed sections', () => {
    renderToolbar({ activeWorkspace: null });

    const sections = [...container!.querySelectorAll<HTMLDetailsElement>('.lineage-tool-section')];
    const maintenance = sections.find(section => section.querySelector('summary')?.textContent === 'Maintenance')!;
    const demo = sections.find(section => section.querySelector('summary')?.textContent === 'Demo/QA')!;

    expect(maintenance.open).toBe(false);
    expect(demo.open).toBe(false);
    expect(maintenance.textContent).toContain('Index local');
    expect(maintenance.textContent).toContain('Refresh graph');
    expect(maintenance.textContent).toContain('Refresh workspaces');
    expect(demo.textContent).toContain('QA seed media');
    expect(demo.textContent).toContain('Load demo lineage');
    expect(demo.textContent).toContain('Restore basic media');
    expect(demo.textContent).toContain('Load SVG placeholder demo');
    expect(demo.textContent).toContain('Download rich images');
    expect(demo.textContent).toContain('Restore rich media');
    expect(demo.textContent).toContain('Load rich image demo');
  });

  it('preserves maintenance and Demo/QA command callbacks', () => {
    const onRefreshLineage = vi.fn();
    const onRefreshWorkspaces = vi.fn();
    const onRestoreSwissifierMedia = vi.fn();
    const onIndexLocal = vi.fn();
    const onRestoreDemoMedia = vi.fn();
    const onDownloadSwissifierMedia = vi.fn();
    const onSeedDemo = vi.fn();
    const onSeedSwissifierDemo = vi.fn();
    renderToolbar({
      demoSeedStatus: demoMediaStatus({ present: 9, total: 10 }),
      onDownloadSwissifierMedia,
      onIndexLocal,
      onRefreshLineage,
      onRefreshWorkspaces,
      onRestoreDemoMedia,
      onRestoreSwissifierMedia,
      onSeedDemo,
      onSeedSwissifierDemo,
    });

    for (const [label, callback] of [
      ['Refresh graph', onRefreshLineage],
      ['Refresh workspaces', onRefreshWorkspaces],
      ['Index local', onIndexLocal],
      ['Restore basic media', onRestoreDemoMedia],
      ['Load SVG placeholder demo', onSeedDemo],
      ['Download rich images', onDownloadSwissifierMedia],
      ['Restore rich media', onRestoreSwissifierMedia],
      ['Load rich image demo', onSeedSwissifierDemo],
    ] as const) {
      const button = [...container!.querySelectorAll<HTMLButtonElement>('button')]
        .find(candidate => candidate.textContent === label)!;
      act(() => button.click());
      expect(callback).toHaveBeenCalledOnce();
    }
  });

  it('preserves direct selection and output callbacks', () => {
    const onOpenGeneration = vi.fn();
    const onOpenOutputDefaults = vi.fn();
    const onToggleNextPanel = vi.fn();
    renderToolbar({
      onOpenGeneration,
      onOpenOutputDefaults,
      onToggleNextPanel,
      snapshot: { ...snapshot, selected: ['child-1'] },
    });

    for (const [label, callback] of [
      ['Plan outputs', onOpenGeneration],
      ['Output target defaults', onOpenOutputDefaults],
      ['Variation queue', onToggleNextPanel],
    ] as const) {
      const button = [...container!.querySelectorAll<HTMLButtonElement>('.lineage-primary-controls button')]
        .find(candidate => candidate.textContent?.includes(label))!;
      act(() => button.click());
      expect(callback).toHaveBeenCalledOnce();
    }
  });

  it('shows automatic rich-demo indexing progress and disables duplicate index or seed actions', () => {
    renderToolbar({ workspaceProgress: 'indexing' });

    expect(container!.querySelector('.lineage-toolbar-context')?.textContent).toBe('Indexing 14 rich demo images');
    const index = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Index local');
    const richSeed = [...container!.querySelectorAll('button')].find(button => button.textContent === 'Load rich image demo');
    expect(index?.disabled).toBe(true);
    expect(richSeed?.disabled).toBe(true);
    expect(container!.textContent).not.toContain('No lineage index yet');
  });

});

function renderToolbar(overrides: Partial<Parameters<typeof LineageToolbar>[0]> = {}) {
  const props: Parameters<typeof LineageToolbar>[0] = {
    activeWorkspace: workspace,
    closeSignal: 0,
    demoSeedStatus: demoMediaStatus({ present: 10, total: 10 }),
    loading: false,
    onDownloadSwissifierMedia: vi.fn(),
    onIndexLocal: vi.fn(),
    onOpenGeneration: vi.fn(),
    onOpenOutputDefaults: vi.fn(),
    onRefreshLineage: vi.fn(),
    onRefreshWorkspaces: vi.fn(),
    onReplayGrowth: vi.fn(),
    onRestoreDemoMedia: vi.fn(),
    onRestoreSwissifierMedia: vi.fn(),
    onSeedDemo: vi.fn(),
    onSeedSwissifierDemo: vi.fn(),
    onToggleNextPanel: vi.fn(),
    replayActive: false,
    sideOpen: false,
    snapshot,
    swissifierDemoStatus: demoMediaStatus({ download_available: true, present: 7, total: 14 }),
    workspaceLoading: false,
    workspaceProgress: null,
    workspaceRootAssetId: workspace.root_asset_id,
    variationQueueCount: 2,
    ...overrides,
  };

  act(() => {
    root!.render(<LineageToolbar {...props} />);
  });
}

const workspace: LineageWorkspace = {
  active_at: '2026-07-09T00:00:00.000Z',
  created_at: '2026-07-09T00:00:00.000Z',
  created_by: 'human',
  id: 'demo-project:lineage-workspace:local-root',
  project: 'demo-project',
  root_asset_id: 'local-root',
  status: 'active',
  title: 'Bleep Meta Vertical Save This',
  updated_at: '2026-07-09T00:00:00.000Z',
};

const snapshot = {
  active_asset_id: 'local-root',
  edges: Array.from({ length: 6 }, (_, index) => ({
    child_asset_id: `child-${index}`,
    created_at: '2026-07-09T00:00:00.000Z',
    id: `edge-${index}`,
    parent_asset_id: index === 0 ? 'local-root' : `child-${index - 1}`,
    relation_type: 'derived_from',
  })),
  fetchedAt: '2026-07-09T00:00:00.000Z',
  latest: ['child-6'],
  nodes: Array.from({ length: 7 }, (_, index) => ({
    asset_id: index === 0 ? 'local-root' : `child-${index}`,
    is_latest: index === 6,
    media_type: 'image',
    project: 'demo-project',
    review_state: 'unreviewed',
    source: 'local',
    status: 'working',
    title: index === 0 ? 'root' : `child ${index}`,
    user_selected: false,
  })),
  project: 'demo-project',
  root_asset_id: 'local-root',
  selected: [],
  selection: null,
  selections: [],
} satisfies LineageSnapshot;

function demoMediaStatus(overrides: { download_available?: boolean; present: number; total: number }) {
  return {
    fixture_present: overrides.present,
    fixture_total: overrides.total,
    media_root: '/tmp/lineage-demo-media',
    missing: [],
    ok: overrides.present === overrides.total,
    ...overrides,
  };
}
