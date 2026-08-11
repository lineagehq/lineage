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
    LineageCanvas: (props: { flowNodes: Array<{ data: LineageNode }>; onToggleSocial: (node: LineageNode) => void }) => {
      const node = props.flowNodes[0]?.data;
      return React.createElement('button', {
        'data-social-state': node?.social_mark?.active ? 'marked' : 'unmarked',
        'data-testid': 'social-toggle',
        disabled: !node,
        onClick: () => node && props.onToggleSocial(node),
      }, 'Toggle Social');
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
  vi.clearAllMocks();
});

function snapshot(marked: boolean): LineageSnapshot {
  return {
    active_asset_id: 'social-root',
    edges: [],
    fetchedAt: marked ? '2026-08-11T20:00:01.000Z' : '2026-08-11T20:00:00.000Z',
    latest: ['social-root'],
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

describe('LineageView Social-mark integration', () => {
  it('keeps the interaction unmarked until the authoritative persisted reload returns', async () => {
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
    act(() => root!.render(createElement(LineageView, {
      onSelectedAsset: vi.fn(),
      onToast,
      project: 'demo-project',
    })));
    await flush();
    await flush();
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="social-toggle"]')!;
    expect(toggle.dataset.socialState).toBe('unmarked');

    act(() => toggle.click());
    await flush();
    expect(toggle.dataset.socialState).toBe('unmarked');
    expect(lineageReads).toBe(2);
    expect(apiMock).toHaveBeenCalledWith('/api/lineage/social-root/social-marks/social-root', expect.objectContaining({
      body: JSON.stringify({ project: 'demo-project', actor: 'human:canvas', confirmWrite: true }),
      method: 'POST',
    }));

    await act(async () => resolveReload());
    await flush();
    expect(toggle.dataset.socialState).toBe('marked');
    expect(onToast).toHaveBeenCalledWith('ok', 'Marked social-root for Social');
  });
});
