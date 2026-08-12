// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineageNode, LineageSnapshot } from '../../shared/types';
import { api } from '../api';
import { LineageView } from './LineageView';

vi.mock('../api', () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(),
}));

vi.mock('./useLineageWorkspaces', () => {
  const noop = vi.fn(async () => undefined);
  return {
    useLineageWorkspaces: () => ({
      activateWorkspace: noop,
      activeWorkspace: null,
      archiveWorkspace: noop,
      demoSeedStatus: null,
      downloadSwissifierDemoMedia: noop,
      handleWorkspaceCreated: noop,
      refreshDemoSeedStatus: noop,
      refreshWorkspaces: noop,
      restoreDemoSeedMedia: noop,
      restoreSwissifierDemoMedia: noop,
      seedDemoWorkspace: noop,
      seedSwissifierDemoWorkspace: noop,
      swissifierDemoStatus: null,
      visibleWorkspaces: [],
      workspaceLoading: false,
      workspaceRootAssetId: 'social-root',
    }),
  };
});

vi.mock('./LineageCanvas', async () => {
  const React = await import('react');
  return {
    LineageCanvas: (props: { flowNodes: Array<{ data: LineageNode }>; onNodeInspect: (assetId: string) => boolean | void; onSelectedAsset: (assetId: string) => void; onToggleCollapse: (assetId: string) => void; onToggleSocial: (node: LineageNode) => void }) => {
      const node = props.flowNodes[0]?.data;
      const other = props.flowNodes[1]?.data;
      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'react-flow__node', 'data-id': node?.asset_id }, React.createElement('button', {
          className: 'lineage-node',
          'data-social-state': node?.social_mark?.active ? 'marked' : 'unmarked',
          'data-testid': 'social-toggle',
          disabled: !node,
          onClick: () => node && props.onToggleSocial(node),
        }, 'Toggle Social')),
        other && React.createElement('button', {
          'data-testid': 'switch-social-source',
          onClick: () => { if (props.onNodeInspect(other.asset_id) !== false) props.onSelectedAsset(other.asset_id); },
        }, 'Switch source'),
        React.createElement('button', { 'data-testid': 'collapse-social-source', onClick: () => props.onToggleCollapse('social-root') }, 'Collapse source'));
    },
  };
});

vi.mock('./LineageSocialPanel', async () => {
  const React = await import('react');
  return {
    LineageSocialPanel: (props: { isTransitionLocked?: () => boolean; node: LineageNode; onClose?: () => void; onDirtyChange: (dirty: boolean) => void; onMark: () => void; transitionLocked?: boolean }) => {
      const [campaign, setCampaign] = React.useState('default');
      const [draft, setDraft] = React.useState('confirmed draft');
      const [variant, setVariant] = React.useState('first');
      const accept = (effect: () => void) => { if (!props.isTransitionLocked?.()) effect(); };
      return React.createElement('section', { 'aria-busy': props.transitionLocked || undefined, 'data-testid': 'social-panel', id: 'lineage-canvas-panel' },
        React.createElement('span', null, props.node.title),
        React.createElement('button', { 'aria-label': 'Close Social composition', onClick: props.onClose }, 'Close'),
        !props.node.social_mark?.active && React.createElement('button', { 'data-testid': 'mark-social', onClick: () => accept(props.onMark) }, 'Mark for Social'),
        React.createElement('button', { 'data-testid': 'create-social-item', onClick: () => accept(() => { void api('/api/social/items'); }) }, 'Create or open work item'),
        React.createElement('input', { 'data-testid': 'social-campaign', onChange: (event: React.ChangeEvent<HTMLInputElement>) => accept(() => setCampaign(event.target.value)), value: campaign }),
        React.createElement('input', { 'data-testid': 'social-draft', onChange: (event: React.ChangeEvent<HTMLInputElement>) => accept(() => setDraft(event.target.value)), value: draft }),
        React.createElement('button', { 'data-testid': 'social-variant', onClick: () => accept(() => setVariant('second')) }, variant),
        React.createElement('button', { 'data-testid': 'make-social-dirty', disabled: props.transitionLocked, onClick: () => accept(() => props.onDirtyChange(true)) }, 'Edit draft'));
    },
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.querySelectorAll('#canvas-context-tools').forEach(element => element.remove());
  vi.clearAllMocks();
  vi.useRealTimers();
});

function snapshot(marked: boolean): LineageSnapshot {
  return {
    active_asset_id: 'social-root',
    edges: [{ child_asset_id: 'social-other', created_at: '2026-08-11T20:00:00.000Z', id: 'edge-social', parent_asset_id: 'social-root', relation_type: 'derived_from' }],
    fetchedAt: marked ? '2026-08-11T20:00:01.000Z' : '2026-08-11T20:00:00.000Z',
    latest: ['social-root', 'social-other'],
    nodes: [{
      asset_id: 'social-root',
      is_latest: true,
      media_type: 'image',
      project: 'demo-project',
      review_state: 'unreviewed',
      social_mark: marked ? {
        active: true,
        asset_id: 'social-root',
        id: 'demo-project:social-root:social:social-root',
        marked_at: '2026-08-11T20:00:01.000Z',
        marked_by: 'human:canvas',
        project_id: 'demo-project',
        root_asset_id: 'social-root',
        updated_at: '2026-08-11T20:00:01.000Z',
      } : undefined,
      source: 'local',
      status: 'working',
      title: 'Social root',
      user_selected: false,
    }, {
      asset_id: 'social-other',
      is_latest: true,
      media_type: 'image',
      project: 'demo-project',
      review_state: 'unreviewed',
      source: 'local',
      status: 'working',
      title: 'Other source',
      user_selected: false,
    }],
    project: 'demo-project',
    root_asset_id: 'social-root',
    selected: [],
    selection: null,
    selections: [],
    tasks: [],
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; }); return { promise, reject, resolve }; }

describe('LineageView Social-mark integration', () => {
  it('coordinates automatic source replacement at response time without stale approval', async () => {
    vi.useFakeTimers();
    let reads = 0;
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.startsWith('/api/lineage/social-root?')) {
        reads += 1;
        if (reads === 1) return Promise.resolve(snapshot(true));
        const next = snapshot(true); next.nodes = next.nodes.map(node => node.asset_id === 'social-root' ? { ...node, checksum_sha256: 'automatic-replacement' } : node);
        return Promise.resolve(next);
      }
      if (path.startsWith('/api/agent-claims?')) return Promise.resolve({ claims: [] });
      if (path.startsWith('/api/generation/jobs?')) return Promise.resolve({ jobs: [] });
      if (path.startsWith('/api/generation/targets?')) return Promise.resolve({ effective: null, setting: null });
      return Promise.resolve({});
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root!.render(createElement(LineageView, { onSelectedAsset: vi.fn(), onToast: vi.fn(), project: 'demo-project' })); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="social-toggle"]')!.click());
    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="make-social-dirty"]')!.click());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => { vi.advanceTimersByTime(8000); await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="social-panel"]')).not.toBeNull();
    confirm.mockReturnValue(true);
    await act(async () => { vi.advanceTimersByTime(8000); await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="social-panel"]')).toBeNull();
  });

  it('locks a deferred manual refresh, preserves and unlocks on failure, and resets once on replacement success', async () => {
    const failedRefresh = deferred<LineageSnapshot>();
    const noOpRefresh = deferred<LineageSnapshot>();
    const successfulRefresh = deferred<LineageSnapshot>();
    let reads = 0;
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.startsWith('/api/lineage/social-root?')) {
        reads += 1;
        if (reads === 1) return Promise.resolve(snapshot(true));
        if (reads === 2) return failedRefresh.promise;
        if (reads === 3) return noOpRefresh.promise;
        return successfulRefresh.promise;
      }
      if (path.startsWith('/api/agent-claims?')) return Promise.resolve({ claims: [] });
      if (path.startsWith('/api/generation/jobs?')) return Promise.resolve({ jobs: [] });
      if (path.startsWith('/api/generation/targets?')) return Promise.resolve({ effective: null, setting: null });
      return Promise.resolve({});
    });
    const tools = document.createElement('div'); tools.id = 'canvas-context-tools'; document.body.appendChild(tools);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageView, { onSelectedAsset: vi.fn(), onToast: vi.fn(), project: 'demo-project' })));
    await flush(); await flush();
    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="social-toggle"]')!.click()); await flush();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refresh = [...tools.querySelectorAll('button')].find(button => button.textContent === 'Refresh graph')!;
    refresh.focus(); act(() => refresh.click()); await flush();
    expect(container.querySelector('[data-testid="social-panel"]')?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="make-social-dirty"]')?.disabled).toBe(true);
    await act(async () => failedRefresh.reject(new Error('refresh failed'))); await flush();
    expect(container.querySelector('[data-testid="social-panel"]')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="make-social-dirty"]')?.disabled).toBe(false);
    expect(document.activeElement).toBe(refresh);

    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="make-social-dirty"]')!.click()); await flush();
    act(() => refresh.click()); await flush();
    await act(async () => noOpRefresh.resolve(snapshot(true))); await flush();
    expect(container.querySelector('[data-testid="social-panel"]')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="make-social-dirty"]')?.disabled).toBe(false);

    act(() => refresh.click()); await flush();
    const replaced = snapshot(true); replaced.nodes = replaced.nodes.map(node => node.asset_id === 'social-root' ? { ...node, checksum_sha256: 'replacement' } : node);
    await act(async () => successfulRefresh.resolve(replaced)); await flush();
    expect(container.querySelector('[data-testid="social-panel"]')).toBeNull();
    tools.remove();
  });

  it('blocks Social entry while a closed-panel refresh transaction owns the view', async () => {
    const refreshResponse = deferred<LineageSnapshot>(); let reads = 0;
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.startsWith('/api/lineage/social-root?')) return ++reads === 1 ? Promise.resolve(snapshot(true)) : refreshResponse.promise;
      if (path.startsWith('/api/agent-claims?')) return Promise.resolve({ claims: [] });
      if (path.startsWith('/api/generation/jobs?')) return Promise.resolve({ jobs: [] });
      if (path.startsWith('/api/generation/targets?')) return Promise.resolve({ effective: null, setting: null });
      return Promise.resolve({});
    });
    const tools = document.createElement('div'); tools.id = 'canvas-context-tools'; document.body.appendChild(tools);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageView, { onSelectedAsset: vi.fn(), onToast: vi.fn(), project: 'demo-project' }))); await flush(); await flush();
    const refresh = [...tools.querySelectorAll('button')].find(button => button.textContent === 'Refresh graph')!;
    act(() => refresh.click()); await flush();
    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="social-toggle"]')!.click());
    expect(container.querySelector('[data-testid="social-panel"]')).toBeNull();
    await act(async () => refreshResponse.reject(new Error('closed refresh failed'))); await flush();
    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="social-toggle"]')!.click());
    expect(container.querySelector('[data-testid="social-panel"]')).not.toBeNull();
    tools.remove();
  });

  it('rejects Create/Open in the synchronous parent-ownership render gap and accepts it after settlement', async () => {
    const refreshResponse = deferred<LineageSnapshot>();
    const createResponse = deferred<unknown>();
    let reads = 0;
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.startsWith('/api/lineage/social-root?')) return ++reads === 1 ? Promise.resolve(snapshot(true)) : refreshResponse.promise;
      if (path.startsWith('/api/agent-claims?')) return Promise.resolve({ claims: [] });
      if (path.startsWith('/api/generation/jobs?')) return Promise.resolve({ jobs: [] });
      if (path.startsWith('/api/generation/targets?')) return Promise.resolve({ effective: null, setting: null });
      if (path === '/api/social/items') return createResponse.promise;
      return Promise.resolve({});
    });
    const tools = document.createElement('div'); tools.id = 'canvas-context-tools'; document.body.appendChild(tools);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageView, { onSelectedAsset: vi.fn(), onToast: vi.fn(), project: 'demo-project' }))); await flush(); await flush();
    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="social-toggle"]')!.click()); await flush();
    const refresh = [...tools.querySelectorAll('button')].find(button => button.textContent === 'Refresh graph')!;
    const create = container.querySelector<HTMLButtonElement>('[data-testid="create-social-item"]')!;
    expect(create.disabled).toBe(false);
    act(() => { refresh.click(); create.click(); });
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/api/social/items')).toHaveLength(0);
    await act(async () => refreshResponse.reject(new Error('refresh failed'))); await flush();
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/api/social/items')).toHaveLength(0);
    act(() => create.click());
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/api/social/items')).toHaveLength(1);
    await act(async () => createResponse.resolve({}));
    tools.remove();
  });

  it('rejects post-confirmation draft, campaign, and selection edits before protected source replacement', async () => {
    const refreshResponse = deferred<LineageSnapshot>();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    let reads = 0;
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.startsWith('/api/lineage/social-root?')) return ++reads === 1 ? Promise.resolve(snapshot(true)) : refreshResponse.promise;
      if (path.startsWith('/api/agent-claims?')) return Promise.resolve({ claims: [] });
      if (path.startsWith('/api/generation/jobs?')) return Promise.resolve({ jobs: [] });
      if (path.startsWith('/api/generation/targets?')) return Promise.resolve({ effective: null, setting: null });
      return Promise.resolve({});
    });
    const tools = document.createElement('div'); tools.id = 'canvas-context-tools'; document.body.appendChild(tools);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageView, { onSelectedAsset: vi.fn(), onToast: vi.fn(), project: 'demo-project' }))); await flush(); await flush();
    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="social-toggle"]')!.click()); await flush();
    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="make-social-dirty"]')!.click()); await flush();
    const refresh = [...tools.querySelectorAll('button')].find(button => button.textContent === 'Refresh graph')!;
    const campaign = container.querySelector<HTMLInputElement>('[data-testid="social-campaign"]')!;
    const draft = container.querySelector<HTMLInputElement>('[data-testid="social-draft"]')!;
    const selection = container.querySelector<HTMLButtonElement>('[data-testid="social-variant"]')!;
    act(() => {
      refresh.click();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campaign, 'post-confirmation campaign');
      campaign.dispatchEvent(new Event('change', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(draft, 'post-confirmation draft');
      draft.dispatchEvent(new Event('change', { bubbles: true }));
      selection.click();
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(campaign.value).toBe('default');
    expect(draft.value).toBe('confirmed draft');
    expect(selection.textContent).toBe('first');
    const replaced = snapshot(true); replaced.nodes = replaced.nodes.map(node => node.asset_id === 'social-root' ? { ...node, checksum_sha256: 'protected-replacement' } : node);
    await act(async () => refreshResponse.resolve(replaced)); await flush();
    expect(container.querySelector('[data-testid="social-panel"]')).toBeNull();
    tools.remove();
  });

  it('makes zero Mark mutation calls in the synchronous parent-ownership render gap', async () => {
    const refreshResponse = deferred<LineageSnapshot>();
    let reads = 0;
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.startsWith('/api/lineage/social-root?')) return ++reads === 1 ? Promise.resolve(snapshot(false)) : refreshResponse.promise;
      if (path.startsWith('/api/agent-claims?')) return Promise.resolve({ claims: [] });
      if (path.startsWith('/api/generation/jobs?')) return Promise.resolve({ jobs: [] });
      if (path.startsWith('/api/generation/targets?')) return Promise.resolve({ effective: null, setting: null });
      if (path.includes('/social-marks/')) return Promise.resolve({ active: true, schema_version: 'lineage.social_mark_mutation.v1', snapshot: snapshot(true) });
      return Promise.resolve({});
    });
    const tools = document.createElement('div'); tools.id = 'canvas-context-tools'; document.body.appendChild(tools);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageView, { onSelectedAsset: vi.fn(), onToast: vi.fn(), project: 'demo-project' }))); await flush(); await flush();
    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="social-toggle"]')!.click()); await flush();
    const refresh = [...tools.querySelectorAll('button')].find(button => button.textContent === 'Refresh graph')!;
    const mark = container.querySelector<HTMLButtonElement>('[data-testid="mark-social"]')!;
    act(() => { refresh.click(); mark.click(); });
    expect(vi.mocked(api).mock.calls.filter(([path]) => path.includes('/social-marks/'))).toHaveLength(0);
    await act(async () => refreshResponse.reject(new Error('refresh failed'))); await flush();
    expect(vi.mocked(api).mock.calls.filter(([path]) => path.includes('/social-marks/'))).toHaveLength(0);
    tools.remove();
  });

  it('honors one enabled Canvas settings click during a non-Social refresh settlement', async () => {
    const refreshResponse = deferred<LineageSnapshot>();
    let reads = 0;
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.startsWith('/api/lineage/social-root?')) return ++reads === 1 ? Promise.resolve(snapshot(true)) : refreshResponse.promise;
      if (path.startsWith('/api/agent-claims?')) return Promise.resolve({ claims: [] });
      if (path.startsWith('/api/generation/jobs?')) return Promise.resolve({ jobs: [] });
      if (path.startsWith('/api/generation/targets?')) return Promise.resolve({ effective: null, setting: null });
      return Promise.resolve({});
    });
    const tools = document.createElement('div'); tools.id = 'canvas-context-tools'; document.body.appendChild(tools);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageView, { onSelectedAsset: vi.fn(), onToast: vi.fn(), project: 'demo-project' })));
    await flush(); await flush();

    const refresh = [...tools.querySelectorAll('button')].find(button => button.textContent === 'Refresh graph')!;
    act(() => refresh.click()); await flush();
    const settings = container.querySelector<HTMLButtonElement>('[aria-label="Open Canvas settings"]')!;
    expect(settings.disabled).toBe(false);
    act(() => settings.click());
    expect(container.querySelectorAll('[aria-label="Canvas settings"]')).toHaveLength(1);

    await act(async () => refreshResponse.resolve(snapshot(true))); await flush();
    expect(container.querySelectorAll('[aria-label="Canvas settings"]')).toHaveLength(1);
    tools.remove();
  });

  it('owns the create-workspace flow from modal entry through cancellation', async () => {
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.startsWith('/api/lineage/social-root?')) return Promise.resolve(snapshot(true));
      if (path.startsWith('/api/agent-claims?')) return Promise.resolve({ claims: [] });
      if (path.startsWith('/api/generation/jobs?')) return Promise.resolve({ jobs: [] });
      if (path.startsWith('/api/generation/targets?')) return Promise.resolve({ effective: null, setting: null });
      return Promise.resolve({ assets: [] });
    });
    const tools = document.createElement('div'); tools.id = 'canvas-context-tools'; document.body.appendChild(tools);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    const onNewWorkspaceCancelled = vi.fn();
    act(() => root!.render(createElement(LineageView, { newWorkspaceRequest: 1, onNewWorkspaceCancelled, onSelectedAsset: vi.fn(), onToast: vi.fn(), project: 'demo-project' }))); await flush(); await flush();
    expect(container.querySelector('[aria-label="New lineage"]')).not.toBeNull();
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Cancel')!.click()); await flush();
    expect(onNewWorkspaceCancelled).toHaveBeenCalledTimes(1);
    tools.remove();
  });

  it('opens composition while keeping the source visible and marks only after the authoritative reload', async () => {
    const apiMock = vi.mocked(api);
    let lineageReads = 0;
    let resolveReload!: () => void;
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/lineage/social-root?')) {
        lineageReads += 1;
        if (lineageReads === 1) return Promise.resolve(snapshot(false));
        return new Promise(resolve => { resolveReload = () => resolve(snapshot(true)); });
      }
      if (path === '/api/lineage/social-root/social-marks/social-root') {
        return Promise.resolve({ active: true, schema_version: 'lineage.social_mark_mutation.v1', snapshot: snapshot(true) });
      }
      if (path.startsWith('/api/agent-claims?')) return Promise.resolve({ claims: [] });
      if (path.startsWith('/api/generation/jobs?')) return Promise.resolve({ jobs: [] });
      if (path.startsWith('/api/generation/targets?')) return Promise.resolve({ effective: null, setting: null });
      return Promise.resolve({});
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onToast = vi.fn();
    const onSelectedAsset = vi.fn();
    act(() => root!.render(createElement(LineageView, {
      onSelectedAsset,
      onToast,
      project: 'demo-project',
    })));
    await flush();
    await flush();
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="social-toggle"]')!;
    expect(toggle.dataset.socialState).toBe('unmarked');

    act(() => toggle.click());
    await flush();
    expect(container.querySelector('[data-testid="social-panel"]')?.textContent).toContain('Social root');
    expect(container.querySelector('.lineage-panel-backdrop')).toBeNull();
    expect(toggle.dataset.socialState).toBe('unmarked');
    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="mark-social"]')!.click());
    await flush();
    expect(lineageReads).toBe(2);
    expect(apiMock).toHaveBeenCalledWith('/api/lineage/social-root/social-marks/social-root', expect.objectContaining({
      body: JSON.stringify({ project: 'demo-project', actor: 'human:canvas', confirmWrite: true }),
      method: 'POST',
    }));

    await act(async () => resolveReload());
    await flush();
    expect(toggle.dataset.socialState).toBe('marked');
    expect(onToast).toHaveBeenCalledWith('ok', 'Marked social-root for Social');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const dirtyButton = container!.querySelector<HTMLButtonElement>('[data-testid="make-social-dirty"]')!;
    dirtyButton.focus();
    act(() => dirtyButton.click());
    await flush();
    act(() => toggle.click());
    const closeSocial = container!.querySelector<HTMLButtonElement>('[aria-label="Close Social composition"]');
    expect(confirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(closeSocial);
    act(() => container!.querySelector('[data-testid="social-panel"]')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved Social changes?');
    expect(container.querySelector('[data-testid="social-panel"]')).not.toBeNull();
    expect(document.activeElement).toBe(closeSocial);

    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="switch-social-source"]')!.click());
    expect(container.querySelector('[data-testid="social-panel"]')?.textContent).toContain('Social root');
    expect(onSelectedAsset).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="switch-social-source"]')!.click());
    await flush();
    expect(container.querySelector('[data-testid="social-panel"]')?.textContent).toContain('Other source');
    expect(onSelectedAsset).toHaveBeenCalledWith('social-other');
    const otherDirty = container!.querySelector<HTMLButtonElement>('[data-testid="make-social-dirty"]')!;
    act(() => otherDirty.click()); await flush();
    confirm.mockReturnValue(false);
    const collapse = container!.querySelector<HTMLButtonElement>('[data-testid="collapse-social-source"]')!;
    collapse.focus(); act(() => collapse.click());
    expect(container.querySelector('[data-testid="social-panel"]')?.textContent).toContain('Other source');
    expect(document.activeElement).toBe(collapse);
    confirm.mockReturnValue(true); act(() => collapse.click()); await flush();
    await flush();
    expect(container.querySelector('[data-testid="social-panel"]')).toBeNull();
    expect(document.activeElement).toBe(collapse);
  });
});
