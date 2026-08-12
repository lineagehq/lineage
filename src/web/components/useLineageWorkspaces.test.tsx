// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineageWorkspace, LineageWorkspaceSnapshot } from '../../shared/types';
import { api } from '../api';
import { useLineageWorkspaces } from './useLineageWorkspaces';

vi.mock('../api', () => ({ api: vi.fn() }));

const first: LineageWorkspace = { id: 'workspace-1', project: 'demo', root_asset_id: 'root-1', title: 'First', status: 'active', created_by: 'human', created_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' };
const second: LineageWorkspace = { ...first, id: 'workspace-2', root_asset_id: 'root-2', title: 'Second' };
const snapshot = (active: LineageWorkspace): LineageWorkspaceSnapshot => ({ project: 'demo', active_workspace: active, fetchedAt: '2026-08-12T00:00:00Z', workspaces: [first, second] });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; }); return { promise, reject, resolve }; }
function transactionContract() {
  let active: number | null = null; let enabled = true; let generation = 0;
  const reset = vi.fn();
  const before = vi.fn(() => enabled && active === null ? (active = ++generation) : null);
  const isOwner = vi.fn((token: number) => active === token);
  const settled = vi.fn((token: number, outcome: 'failure' | 'noop' | 'success') => {
    if (active !== token) return false;
    active = null;
    if (outcome === 'success') reset();
    return true;
  });
  return { before, isOwner, reset, settled, setEnabled: (value: boolean) => { enabled = value; }, supersede: () => { active = ++generation; } };
}
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root?.unmount()); root = null; container?.remove(); container = null; vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('useLineageWorkspaces dirty transition coordination', () => {
  it('ignores a stale workspace completion after transaction ownership advances', async () => {
    const activation = deferred<{ workspace: LineageWorkspace }>(); const transaction = transactionContract(); const selected = vi.fn();
    vi.mocked(api).mockImplementation((path: string) => path.endsWith('/activate') ? activation.promise : Promise.resolve(snapshot(first)));
    let latest!: ReturnType<typeof useLineageWorkspaces>;
    function Harness() { latest = useLineageWorkspaces({ isTransitionOwner: transaction.isOwner, onBeforeTransition: transaction.before, onSelectedAsset: selected, onToast: vi.fn(), onTransitionSettled: transaction.settled, project: 'demo' }); return null; }
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root!.render(createElement(Harness)));
    const pending = latest.activateWorkspace('workspace-2');
    transaction.supersede();
    await act(async () => activation.resolve({ workspace: second })); await act(async () => pending);
    expect(selected).not.toHaveBeenCalled();
    expect(transaction.reset).not.toHaveBeenCalled();
    expect(transaction.settled).not.toHaveBeenCalled();
    expect(vi.mocked(api).mock.calls.filter(([path]) => String(path).startsWith('/api/lineage-workspaces?'))).toHaveLength(0);
  });

  it('settles deferred workspace mutations transactionally and resets only after complete success', async () => {
    const activation = deferred<{ workspace: LineageWorkspace }>();
    let failRefresh = false;
    const transaction = transactionContract();
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.startsWith('/api/lineage-workspaces?')) return failRefresh ? Promise.reject(new Error('refresh failed')) : Promise.resolve(snapshot(second));
      if (path.endsWith('/activate')) return activation.promise;
      return Promise.resolve({});
    });
    let latest!: ReturnType<typeof useLineageWorkspaces>;
    function Harness() { latest = useLineageWorkspaces({ isTransitionOwner: transaction.isOwner, onBeforeTransition: transaction.before, onSelectedAsset: vi.fn(), onToast: vi.fn(), onTransitionSettled: transaction.settled, project: 'demo' }); return null; }
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root!.render(createElement(Harness)));
    const pending = latest.activateWorkspace('workspace-2');
    expect(transaction.before).toHaveBeenCalledTimes(1); expect(transaction.settled).not.toHaveBeenCalled(); expect(transaction.reset).not.toHaveBeenCalled();
    failRefresh = true;
    await act(async () => activation.resolve({ workspace: second }));
    await act(async () => pending);
    expect(transaction.settled).toHaveBeenLastCalledWith(1, 'failure'); expect(transaction.reset).not.toHaveBeenCalled();

    failRefresh = false;
    const success = latest.activateWorkspace('workspace-2');
    await act(async () => activation.resolve({ workspace: second }));
    await act(async () => success);
    expect(transaction.settled).toHaveBeenLastCalledWith(2, 'success'); expect(transaction.reset).toHaveBeenCalledTimes(1);
  });

  it('cancels mutations and automatic source replacement, then resets once after acceptance', async () => {
    let currentSnapshot = snapshot(first);
    const transaction = transactionContract();
    const selected = vi.fn();
    const toast = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.startsWith('/api/lineage-workspaces?')) return Promise.resolve(currentSnapshot);
      if (path.endsWith('/activate')) return Promise.resolve({ workspace: second });
      if (path.endsWith('/archive')) return Promise.resolve({});
      if (path.endsWith('/demo/seed')) return Promise.resolve({ workspace: second, root_asset_id: second.root_asset_id });
      if (path.includes('/demo/media?') || path.includes('/swissifier/media?')) return Promise.resolve({ status: { fixture_present: 0, fixture_total: 0, media_root: '', missing: [], ok: true, present: 0, total: 0 } });
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    let latest!: ReturnType<typeof useLineageWorkspaces>;
    function Harness() { latest = useLineageWorkspaces({ isTransitionOwner: transaction.isOwner, onBeforeTransition: transaction.before, onSelectedAsset: selected, onToast: toast, onTransitionSettled: transaction.settled, project: 'demo' }); return null; }
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root!.render(createElement(Harness)));
    await act(async () => { await latest.refreshWorkspaces(); });
    expect(latest.workspaceRootAssetId).toBe('root-1');
    transaction.setEnabled(false);

    await act(async () => { await latest.activateWorkspace('workspace-2'); await latest.seedDemoWorkspace(); await latest.archiveWorkspace(); });
    expect(vi.mocked(api).mock.calls.some(([path]) => String(path).endsWith('/activate'))).toBe(false);
    expect(transaction.reset).not.toHaveBeenCalled();
    expect(latest.handleWorkspaceCreated(second)).toBe(false);
    expect(transaction.reset).not.toHaveBeenCalled();

    currentSnapshot = snapshot(second);
    await act(async () => { await latest.refreshWorkspaces(); });
    expect(latest.workspaceRootAssetId).toBe('root-1');

    transaction.setEnabled(true);
    await act(async () => { await latest.refreshWorkspaces(); });
    expect(latest.workspaceRootAssetId).toBe('root-2');
    expect(transaction.reset).toHaveBeenCalledTimes(1);
    await act(async () => { await latest.activateWorkspace('workspace-2'); });
    expect(latest.workspaceRootAssetId).toBe('root-2');
    expect(transaction.reset).toHaveBeenCalledTimes(2);
    expect(selected).toHaveBeenLastCalledWith('root-2');
  });

  it('uses the same accepted transaction settlement for seed, archive, and create', async () => {
    const transaction = transactionContract();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.startsWith('/api/lineage-workspaces?')) return Promise.resolve(snapshot(first));
      if (path.endsWith('/demo/seed') || path.endsWith('/swissifier/seed')) return Promise.resolve({ workspace: second, root_asset_id: 'root-2' });
      if (path.endsWith('/archive')) return Promise.resolve({});
      if (path.includes('/media?')) return Promise.resolve({ status: { fixture_present: 0, fixture_total: 0, media_root: '', missing: [], ok: true, present: 0, total: 0 } });
      return Promise.resolve({});
    });
    let latest!: ReturnType<typeof useLineageWorkspaces>;
    function Harness() { latest = useLineageWorkspaces({ isTransitionOwner: transaction.isOwner, onBeforeTransition: transaction.before, onSelectedAsset: vi.fn(), onToast: vi.fn(), onTransitionSettled: transaction.settled, project: 'demo' }); return null; }
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root!.render(createElement(Harness)));
    await act(async () => { await latest.refreshWorkspaces(); });
    await act(async () => { await latest.seedDemoWorkspace(); await latest.seedSwissifierDemoWorkspace(); await latest.archiveWorkspace(); });
    act(() => { expect(latest.handleWorkspaceCreated(second)).toBe(true); });
    expect(transaction.before).toHaveBeenCalledTimes(5);
    expect(transaction.settled.mock.calls.filter(([, outcome]) => outcome === 'success').length).toBe(4);
    expect(transaction.reset).toHaveBeenCalledTimes(4);
  });
});
