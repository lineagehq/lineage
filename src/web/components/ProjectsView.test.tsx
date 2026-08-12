// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectWorkspaceSummary } from '../../shared/projectWorkspaceTypes';
import { ProjectsView } from './ProjectsView';

let container: HTMLDivElement;
let root: Root;

describe('ProjectsView', () => {
  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/projects/reorder') return response({ ok: true });
      return response(snapshot);
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('renders a paginated project collection and preserves order across presentations', async () => {
    render();
    await act(settle);

    expect(headings()).toEqual(['Swissifier Demo', 'Summer Launch']);
    expect(container.textContent).toContain('Page 1 of 2');
    expect(button('Open project')).toBeTruthy();
    expect(container.querySelector('[data-presentation="list"]')).not.toBeNull();

    act(() => ariaButton('Show projects as cards').click());
    expect(headings()).toEqual(['Swissifier Demo', 'Summer Launch']);
    expect(container.querySelector('[data-presentation="cards"]')).not.toBeNull();
  });

  it('opens the selected project without forcing Canvas', async () => {
    const onOpenProject = vi.fn<(project: ProjectWorkspaceSummary) => void>();
    render({ onOpenProject });
    await act(settle);

    const summer = Array.from(container.querySelectorAll<HTMLElement>('.organization-item'))
      .find(item => item.textContent?.includes('Summer Launch'))!;
    act(() => Array.from(summer.querySelectorAll<HTMLButtonElement>('button'))
      .find(item => item.textContent?.includes('Open project'))!.click());
    expect(onOpenProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'summer-launch' }));
  });

  it('opens Swissifier at its workspace list rather than bypassing the project overview', async () => {
    const onOpenProject = vi.fn();
    render({ onOpenProject });
    await act(settle);

    const swissifier = Array.from(container.querySelectorAll<HTMLElement>('.ordered-collection-item'))
      .find(item => item.textContent?.includes('Swissifier Demo'))!;
    act(() => swissifier.querySelector('h2')!.click());
    expect(onOpenProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'swissifier-demo' }));
  });

  it('requires an explicit restore after Swissifier was deleted', async () => {
    const onOpenProject = vi.fn();
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === '/api/projects/demo/swissifier/restore' && init?.method === 'POST') {
        return response({
          ok: true,
          message: 'Restored Swissifier Demo project',
          project: snapshot.projects[0],
        });
      }
      return response({
        ...snapshot,
        projects: snapshot.projects.filter(project => project.id !== 'swissifier-demo'),
        demo_restore_available: true,
      });
    });
    render({ onOpenProject });
    await act(settle);

    expect(container.textContent).toContain('Swissifier Demo is hidden');
    await act(async () => {
      button('Restore demo').click();
      await settle();
    });

    expect(fetch).toHaveBeenCalledWith('/api/projects/demo/swissifier/restore', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ confirmWrite: true }),
    }));
    expect(onOpenProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'swissifier-demo' }));
  });

  it('writes deterministic absolute position with the observed manual revision', async () => {
    render();
    await act(settle);
    const handle = ariaButton('Reorder Summer Launch');

    act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    act(() => ariaButton('Reorder Summer Launch').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    await act(async () => {
      ariaButton('Reorder Summer Launch').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();
    });

    expect(fetch).toHaveBeenCalledWith('/api/projects/reorder', expect.objectContaining({
      body: JSON.stringify({ itemId: 'summer-launch', targetIndex: 0, expectedRevision: 7, confirmWrite: true }),
    }));
  });

  it('disables reorder while search makes hidden ordering ambiguous', async () => {
    render();
    await act(settle);
    act(() => setInput(container.querySelector<HTMLInputElement>('[aria-label="Search projects"]')!, 'summer'));
    await act(settle);

    expect(ariaButton('Reorder Summer Launch').disabled).toBe(true);
    expect(container.textContent).toContain('hidden projects never move unexpectedly');
  });

  it('ignores an older collection response that resolves after a newer search', async () => {
    let resolveInitial!: (value: Response) => void;
    const initial = new Promise<Response>(resolve => {
      resolveInitial = resolve;
    });
    const searched = {
      ...snapshot,
      projects: [snapshot.projects[1]],
      pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
      query: 'summer',
      reorder_enabled: false,
    };
    vi.mocked(fetch)
      .mockImplementationOnce(() => initial)
      .mockImplementation(async () => response(searched));

    render();
    act(() => setInput(container.querySelector<HTMLInputElement>('[aria-label="Search projects"]')!, 'summer'));
    await act(settle);
    expect(headings()).toEqual(['Summer Launch']);

    await act(async () => {
      resolveInitial(response(snapshot));
      await settle();
    });
    expect(headings()).toEqual(['Summer Launch']);
  });

  it('reports the exact deleted project so the app can clear active selection', async () => {
    const onProjectDeleted = vi.fn();
    let deleted = false;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === '/api/projects/summer-launch/deletion-plan') {
        return response({
          ok: true,
          plan: {
            schema_version: 'lineage.project_deletion_plan.v1',
            digest: 'd'.repeat(64),
            project: 'summer-launch',
            display_name: 'Summer Launch',
            collection_revision: 7,
            state_digest: 's'.repeat(64),
            counts: [],
            blockers: [],
            preserved: { local_files: true, generated_files: true, cloud_objects: true },
          },
        });
      }
      if (path === '/api/projects/summer-launch/delete' && init?.method === 'POST') {
        deleted = true;
        return response({ ok: true, message: 'Deleted Summer Launch' });
      }
      return response({
        ...snapshot,
        projects: deleted ? snapshot.projects.filter(project => project.id !== 'summer-launch') : snapshot.projects,
      });
    });
    render({ onProjectDeleted });
    await act(settle);

    const summer = Array.from(container.querySelectorAll<HTMLElement>('.organization-item'))
      .find(item => item.textContent?.includes('Summer Launch'))!;
    act(() => Array.from(summer.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.includes('Delete'))!.click());
    await act(settle);
    const confirmation = container.querySelector<HTMLInputElement>('.organization-danger-dialog input')!;
    act(() => setInput(confirmation, 'Summer Launch'));
    await act(async () => {
      button('Delete project permanently').click();
      await settle();
      await settle();
    });

    expect(onProjectDeleted).toHaveBeenCalledWith('summer-launch');
  });

  it('reveals a newly created project on its deterministic last manual-order page', async () => {
    const created = {
      ...snapshot.projects[1],
      id: 'browser-created-project',
      display_name: 'Browser Created Project',
      product: 'browser-created-project',
      sort_position: 12,
      workspace_count: 0,
      asset_count: 0,
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === '/api/projects' && init?.method === 'POST') return response({ ok: true, project: created });
      if (path.includes('page=2')) {
        return response({
          ...snapshot,
          projects: [created],
          pagination: { page: 2, pageSize: 12, total: 13, totalPages: 2 },
        });
      }
      if (path.includes('q=Summer')) {
        return response({
          ...snapshot,
          projects: [snapshot.projects[1]],
          pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
          query: 'summer',
          reorder_enabled: false,
        });
      }
      return response({
        ...snapshot,
        pagination: { page: 1, pageSize: 12, total: 12, totalPages: 1 },
      });
    });
    render();
    await act(settle);
    act(() => setInput(container.querySelector<HTMLInputElement>('[aria-label="Search projects"]')!, 'Summer'));
    await act(settle);
    const createButton = button('New project');
    act(() => createButton.click());
    const inputs = container.querySelectorAll<HTMLInputElement>('.organization-dialog input');
    act(() => setInput(inputs[0], created.display_name));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.organization-dialog button[type="submit"]')!.click();
      await settle();
      await settle();
    });

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('page=2'), undefined);
    expect(headings()).toEqual([created.display_name]);
    expect(document.activeElement).toBe(createButton);
  });
});

function render(overrides: {
  onOpenProject?: (project: ProjectWorkspaceSummary) => void;
  onProjectDeleted?: (projectId: string) => void;
} = {}) {
  act(() => root.render(
    <ProjectsView
      onOpenProject={overrides.onOpenProject || vi.fn()}
      onProjectDeleted={overrides.onProjectDeleted || vi.fn()}
      onToast={vi.fn()}
    />
  ));
}

function headings() {
  return Array.from(container.querySelectorAll('.organization-item h2')).map(item => item.textContent);
}

function button(text: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.includes(text))!;
}

function ariaButton(label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function response(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload } as Response;
}

async function settle() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

const snapshot = {
  projects: [
    {
      id: 'swissifier-demo',
      display_name: 'Swissifier Demo',
      product: 'Swissifier',
      catalog_state: 'ready',
      sort_position: 0,
      asset_count: 12,
      workspace_count: 1,
      created_at: '2026-07-29T00:00:00.000Z',
      updated_at: '2026-07-29T00:00:00.000Z',
    },
    {
      id: 'summer-launch',
      display_name: 'Summer Launch',
      product: 'Campaign',
      catalog_state: 'ready',
      sort_position: 1,
      asset_count: 8,
      workspace_count: 2,
      created_at: '2026-07-29T00:00:00.000Z',
      updated_at: '2026-07-29T00:00:00.000Z',
    },
  ],
  pagination: { page: 1, pageSize: 12, total: 14, totalPages: 2 },
  manual_revision: 7,
  reorder_enabled: true,
  sort: 'manual',
  fetched_at: '2026-07-29T00:00:00.000Z',
};
