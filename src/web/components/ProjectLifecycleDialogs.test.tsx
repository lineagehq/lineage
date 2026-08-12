// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectWorkspaceSummary } from '../../shared/projectWorkspaceTypes';
import { CreateProjectDialog, DeleteProjectDialog } from './ProjectLifecycleDialogs';

let container: HTMLDivElement;
let root: Root;

describe('project lifecycle dialogs', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('derives and validates the stable project ID before creation', async () => {
    mockJson({ ok: true, project });
    const onCreated = vi.fn();
    render(<CreateProjectDialog onClose={vi.fn()} onCreated={onCreated} />);
    const inputs = container.querySelectorAll<HTMLInputElement>('input');

    act(() => {
      setInput(inputs[0], 'Summer Launch');
    });
    expect(inputs[1].value).toBe('summer-launch');

    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await settle();
    });
    expect(fetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
      body: expect.stringContaining('"id":"summer-launch"'),
    }));
    expect(onCreated).toHaveBeenCalled();
  });

  it('shows exact impact and media preservation before requiring typed deletion', async () => {
    mockJson({
      ok: true,
      plan: {
        schema_version: 'lineage.project_deletion_plan.v1',
        digest: 'digest',
        project: project.id,
        display_name: project.display_name,
        collection_revision: 3,
        state_digest: 'state',
        counts: [{ table: 'lineage_workspaces', count: 2 }, { table: 'assets', count: 9 }],
        blockers: [],
        preserved: { local_files: true, generated_files: true, cloud_objects: true },
      },
    });
    render(<DeleteProjectDialog onClose={vi.fn()} onDeleted={vi.fn()} project={project} />);
    await act(settle);

    expect(container.textContent).toContain('lineage workspaces');
    expect(container.textContent).toContain('Local source files, generated files, and cloud objects are not deleted');
    const remove = button('Delete project permanently');
    expect(remove.disabled).toBe(true);

    act(() => setInput(container.querySelector('input')!, project.display_name));
    expect(remove.disabled).toBe(false);
  });

  it('keeps deletion disabled when the impact plan has an active-work blocker', async () => {
    mockJson({
      ok: true,
      plan: {
        schema_version: 'lineage.project_deletion_plan.v1',
        digest: 'digest',
        project: project.id,
        display_name: project.display_name,
        collection_revision: 3,
        state_digest: 'state',
        counts: [],
        blockers: [{ code: 'active_claim', message: 'Release the active claim first.' }],
        preserved: { local_files: true, generated_files: true, cloud_objects: true },
      },
    });
    render(<DeleteProjectDialog onClose={vi.fn()} onDeleted={vi.fn()} project={project} />);
    await act(settle);
    act(() => setInput(container.querySelector('input')!, project.display_name));

    expect(container.textContent).toContain('Release the active claim first.');
    expect(button('Delete project permanently').disabled).toBe(true);
  });

  it('closes on Escape and returns focus to the invoking control', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open dialog';
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn(() => root.render(null));
    render(<CreateProjectDialog onClose={onClose} onCreated={vi.fn()} />);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    expect(onClose).toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('exposes its description and cannot be dismissed while a write is in flight', async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => undefined));
    const onClose = vi.fn();
    render(<CreateProjectDialog onClose={onClose} onCreated={vi.fn()} />);
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const inputs = container.querySelectorAll<HTMLInputElement>('input');
    act(() => setInput(inputs[0], 'Busy Project'));

    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toContain('Projects keep related workspaces');
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(onClose).not.toHaveBeenCalled();
  });
});

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

function mockJson(payload: unknown, ok = true) {
  vi.mocked(fetch).mockResolvedValue({
    ok,
    status: ok ? 200 : 409,
    json: async () => payload,
  } as Response);
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function button(text: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.includes(text))!;
}

async function settle() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

const project: ProjectWorkspaceSummary = {
  id: 'summer-launch',
  display_name: 'Summer Launch',
  product: 'summer-launch',
  catalog_state: 'ready',
  sort_position: 0,
  asset_count: 9,
  workspace_count: 2,
  created_at: '2026-07-29T00:00:00.000Z',
  updated_at: '2026-07-29T00:00:00.000Z',
};
