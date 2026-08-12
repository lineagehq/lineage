// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineageWorkspace } from '../../shared/lineageWorkspaceTypes';
import { DeleteWorkspaceDialog, WorkspaceStatusDialog } from './WorkspaceLifecycleDialogs';

let container: HTMLDivElement;
let root: Root;

describe('workspace lifecycle dialogs', () => {
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

  it('keeps archive reversible and separate from permanent deletion', async () => {
    mockJson({ message: 'Archived Portrait concepts' });
    const onDone = vi.fn();
    act(() => root.render(
      <WorkspaceStatusDialog action="archive" onClose={vi.fn()} onDone={onDone} project="summer-launch" workspace={workspace} />
    ));

    await act(async () => {
      button('Archive workspace').click();
      await settle();
    });
    expect(fetch).toHaveBeenCalledWith(`/api/lineage-workspaces/${workspace.id}/archive`, expect.any(Object));
    expect(onDone).toHaveBeenCalledWith('Archived Portrait concepts');
  });

  it('shows blockers, root-scoped impact, and explicit preservation policy', async () => {
    mockJson({
      ok: true,
      plan: {
        schema_version: 'lineage.workspace_deletion_plan.v1',
        digest: 'digest',
        project: 'summer-launch',
        workspace_id: workspace.id,
        root_asset_id: workspace.root_asset_id,
        workspace_revision: 2,
        collection_revision: 4,
        state_digest: 'state',
        counts: [{ table: 'asset_layouts', count: 4 }],
        blockers: [{ code: 'active_claim', message: 'Finish the active generation first.' }],
        preserved: { asset_rows: 9, catalog_records: 9, local_files: true, generated_files: true, cloud_objects: true },
      },
    });
    act(() => root.render(
      <DeleteWorkspaceDialog onClose={vi.fn()} onDeleted={vi.fn()} project="summer-launch" workspace={workspace} />
    ));
    await act(settle);

    expect(container.textContent).toContain(workspace.root_asset_id);
    expect(container.textContent).toContain('Finish the active generation first.');
    expect(container.textContent).toContain('Asset records, local files, generated files, and cloud objects are preserved');
    expect(button('Delete workspace permanently').disabled).toBe(true);
  });
});

function mockJson(payload: unknown) {
  vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => payload } as Response);
}

function button(text: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.includes(text))!;
}

async function settle() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

const workspace: LineageWorkspace = {
  id: 'workspace-1',
  project: 'summer-launch',
  root_asset_id: 'root-portrait',
  title: 'Portrait concepts',
  status: 'active',
  created_by: 'human',
  created_at: '2026-07-29T00:00:00.000Z',
  updated_at: '2026-07-29T00:00:00.000Z',
};
