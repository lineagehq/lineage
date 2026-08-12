// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineageWorkspace } from '../../shared/lineageWorkspaceTypes';
import { ProjectOverview } from './ProjectOverview';

let container: HTMLDivElement;
let root: Root;

describe('ProjectOverview', () => {
  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes('/reorder')) return response({ ok: true });
      return response(path.includes('collection=archived') ? archivedSnapshot : openSnapshot);
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('keeps project hierarchy visible and opens the exact workspace on request', async () => {
    const onAllProjects = vi.fn<() => void>();
    const onOpenCanvas = vi.fn<(project: string, workspace: LineageWorkspace) => void>();
    render({ onAllProjects, onOpenCanvas });
    await act(settle);

    expect(container.querySelector('h1')?.textContent).toBe('Workspaces');
    expect(container.querySelector('.organization-eyebrow')?.textContent).toBe('Summer Launch');
    expect(container.querySelector('[data-presentation="list"]')).not.toBeNull();
    act(() => button('All projects').click());
    expect(onAllProjects).toHaveBeenCalled();

    const firstWorkspace = Array.from(container.querySelectorAll<HTMLElement>('.ordered-collection-item'))
      .find(item => item.textContent?.includes('Portrait concepts'))!;
    act(() => firstWorkspace.querySelector('h2')!.click());
    expect(onOpenCanvas).toHaveBeenCalledWith('summer-launch', expect.objectContaining({ id: 'workspace-a' }));
  });

  it('keeps archived workspaces distinct and exposes restore instead of open', async () => {
    render();
    await act(settle);
    act(() => button('Archived').click());
    await act(settle);

    expect(container.textContent).toContain('Archived ideas');
    expect(button('Restore')).toBeTruthy();
    expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent?.includes('Open Canvas'))).toBe(false);
  });

  it('ignores an older workspace response that resolves after a collection switch', async () => {
    let resolveOpen!: (value: Response) => void;
    const open = new Promise<Response>(resolve => {
      resolveOpen = resolve;
    });
    vi.mocked(fetch)
      .mockImplementationOnce(() => open)
      .mockImplementation(async () => response(archivedSnapshot));

    render();
    act(() => button('Archived').click());
    await act(settle);
    expect(container.textContent).toContain('Archived ideas');

    await act(async () => {
      resolveOpen(response(openSnapshot));
      await settle();
    });
    expect(container.textContent).toContain('Archived ideas');
    expect(container.textContent).not.toContain('Portrait concepts');
  });

  it('uses the collection-specific revision for workspace reorder', async () => {
    render();
    await act(settle);
    const handle = container.querySelector<HTMLButtonElement>('[aria-label="Reorder Portrait concepts"]')!;

    act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Reorder Portrait concepts"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Reorder Portrait concepts"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/projects/summer-launch/workspaces/reorder',
      expect.objectContaining({
        body: JSON.stringify({
          collection: 'open',
          itemId: 'workspace-a',
          targetIndex: 1,
          expectedRevision: 11,
          confirmWrite: true,
        }),
      })
    );
  });

  it('implements roving keyboard focus between lifecycle tabs', async () => {
    render();
    await act(settle);
    const open = container.querySelector<HTMLButtonElement>('#workspace-open-tab')!;
    const archived = container.querySelector<HTMLButtonElement>('#workspace-archived-tab')!;
    open.focus();

    act(() => open.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    await act(settle);

    expect(archived.getAttribute('aria-selected')).toBe('true');
    expect(archived.tabIndex).toBe(0);
    expect(document.activeElement).toBe(archived);
    expect(container.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('workspace-archived-tab');
  });

  it('invalidates the remembered Canvas when its workspace is archived', async () => {
    const onWorkspaceInvalidated = vi.fn<(workspaceId: string) => void>();
    render({ onWorkspaceInvalidated });
    await act(settle);

    act(() => exactButton('Archive').click());
    await act(settle);
    await act(async () => {
      exactButton('Archive workspace').click();
      await settle();
    });

    expect(onWorkspaceInvalidated).toHaveBeenCalledWith('workspace-a');
  });
});

function render(overrides: {
  onAllProjects?: () => void;
  onOpenCanvas?: (project: string, workspace: LineageWorkspace) => void;
  onWorkspaceInvalidated?: (workspaceId: string) => void;
} = {}) {
  act(() => root.render(
    <ProjectOverview
      onAllProjects={overrides.onAllProjects || vi.fn()}
      onNewWorkspace={vi.fn()}
      onOpenCanvas={overrides.onOpenCanvas || vi.fn()}
      onToast={vi.fn()}
      onWorkspaceInvalidated={overrides.onWorkspaceInvalidated || vi.fn()}
      projectId="summer-launch"
    />
  ));
}

function button(text: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.includes(text))!;
}

function exactButton(text: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.trim() === text)!;
}

function response(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload } as Response;
}

async function settle() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

const project = {
  id: 'summer-launch',
  display_name: 'Summer Launch',
  product: 'Campaign',
  catalog_state: 'ready',
  sort_position: 0,
  asset_count: 8,
  workspace_count: 3,
  created_at: '2026-07-29T00:00:00.000Z',
  updated_at: '2026-07-29T00:00:00.000Z',
};

const workspaceBase = {
  project: 'summer-launch',
  root_asset_id: 'root-a',
  created_by: 'human',
  created_at: '2026-07-29T00:00:00.000Z',
  updated_at: '2026-07-29T00:00:00.000Z',
};

const openSnapshot = {
  project,
  workspaces: [
    { ...workspaceBase, id: 'workspace-a', title: 'Portrait concepts', status: 'active', sort_position: 0 },
    { ...workspaceBase, id: 'workspace-b', root_asset_id: 'root-b', title: 'Story variants', status: 'paused', sort_position: 1 },
  ],
  collection: 'open',
  pagination: { page: 1, pageSize: 12, total: 2, totalPages: 1 },
  manual_revision: 11,
  reorder_enabled: true,
  sort: 'manual',
  fetched_at: '2026-07-29T00:00:00.000Z',
};

const archivedSnapshot = {
  project,
  workspaces: [
    { ...workspaceBase, id: 'workspace-z', title: 'Archived ideas', status: 'archived', sort_position: 0 },
  ],
  collection: 'archived',
  pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
  manual_revision: 4,
  reorder_enabled: true,
  sort: 'manual',
  fetched_at: '2026-07-29T00:00:00.000Z',
};
