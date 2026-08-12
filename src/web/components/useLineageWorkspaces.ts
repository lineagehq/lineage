import { useCallback, useEffect, useRef, useState } from 'react';
import type { GrowthAsset, LineageWorkspace, LineageWorkspaceSnapshot } from '../../shared/types';
import { api } from '../api';
import { lineageWorkspaceRootAssetId } from './lineageWorkspaceModel';

export interface DemoSeedMediaStatus {
  demo_id?: string;
  download_available?: boolean;
  download_file?: string;
  download_sha256?: string;
  download_url?: string;
  fixture_present: number;
  fixture_total: number;
  invalid?: string[];
  media_root: string;
  media_target?: string;
  missing: string[];
  ok: boolean;
  present: number;
  source_env?: string;
  source_hint?: string;
  source_required?: boolean;
  total: number;
}

export function useLineageWorkspaces({
  asset,
  isTransitionOwner = () => true,
  onBeforeTransition = () => 1,
  onResetLineage = () => undefined,
  onTransitionSettled = () => true,
  onSelectedAsset,
  onToast,
  onWorkspaceChange = () => undefined,
  onWorkspaceUnavailable = () => undefined,
  project,
  workspaceId,
}: {
  asset?: GrowthAsset;
  isTransitionOwner?: (token: number) => boolean;
  onBeforeTransition?: () => number | null;
  onResetLineage?: () => void;
  onTransitionSettled?: (token: number, outcome: 'failure' | 'noop' | 'success') => boolean;
  onSelectedAsset: (assetId: string) => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  onWorkspaceChange?: (workspace: LineageWorkspace | null) => void;
  onWorkspaceUnavailable?: (message: string) => void;
  project: string;
  workspaceId?: string | null;
}) {
  const currentProjectRef = useRef(project);
  const beforeTransitionRef = useRef(onBeforeTransition);
  const workspaceSnapshotRef = useRef<LineageWorkspaceSnapshot | null>(null);
  const currentWorkspaceIdRef = useRef(workspaceId);
  const refreshGenerationRef = useRef(0);
  currentProjectRef.current = project;
  currentWorkspaceIdRef.current = workspaceId;
  const onWorkspaceUnavailableRef = useRef(onWorkspaceUnavailable);
  onWorkspaceUnavailableRef.current = onWorkspaceUnavailable;
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState<LineageWorkspaceSnapshot | null>(null);
  const [demoSeedStatus, setDemoSeedStatus] = useState<DemoSeedMediaStatus | null>(null);
  const [swissifierDemoStatus, setSwissifierDemoStatus] = useState<DemoSeedMediaStatus | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const hasCurrentWorkspaceSnapshot = workspaceSnapshot?.project === project;
  const projectWorkspaceSnapshot = hasCurrentWorkspaceSnapshot ? workspaceSnapshot : null;
  const visibleWorkspaces = (projectWorkspaceSnapshot?.workspaces || []).filter(workspace => workspace.status !== 'archived');
  const activeWorkspace = workspaceId
    ? visibleWorkspaces.find(workspace => workspace.id === workspaceId) || null
    : null;
  const fallbackAssetId = !workspaceId && hasCurrentWorkspaceSnapshot && projectWorkspaceSnapshot?.workspaces.length === 0 ? asset?.asset_id : undefined;
  const workspaceRootAssetId = lineageWorkspaceRootAssetId(activeWorkspace, fallbackAssetId);
  beforeTransitionRef.current = onBeforeTransition;
  workspaceSnapshotRef.current = workspaceSnapshot;

  useEffect(() => {
    setWorkspaceSnapshot(null);
    setDemoSeedStatus(null);
    setSwissifierDemoStatus(null);
  }, [project]);

  const refreshWorkspaces = useCallback(async (options: { transitionToken?: number } = {}) => {
    const ownsTransaction = options.transitionToken === undefined;
    const token = options.transitionToken ?? beforeTransitionRef.current();
    if (token === null) return false;
    const generation = ++refreshGenerationRef.current;
    const requestedProject = project;
    const requestedWorkspaceId = workspaceId;
    setWorkspaceLoading(true);
    try {
      const params = new URLSearchParams({ project });
      const next = await api<LineageWorkspaceSnapshot>(`/api/lineage-workspaces?${params.toString()}`);
      if (generation !== refreshGenerationRef.current || !isTransitionOwner(token)) return false;
      if (
        next.project !== currentProjectRef.current
        || requestedProject !== currentProjectRef.current
        || requestedWorkspaceId !== currentWorkspaceIdRef.current
      ) {
        if (ownsTransaction) onTransitionSettled(token, 'failure');
        return false;
      }
      const current = workspaceSnapshotRef.current;
      const currentActive = requestedWorkspaceId
        ? current?.workspaces.find(workspace => workspace.id === requestedWorkspaceId && workspace.status !== 'archived') || null
        : null;
      const nextActive = requestedWorkspaceId
        ? next.workspaces.find(workspace => workspace.id === requestedWorkspaceId && workspace.status !== 'archived') || null
        : null;
      const sourceReplaced = Boolean(currentActive) && currentActive?.root_asset_id !== nextActive?.root_asset_id;
      if (ownsTransaction && !onTransitionSettled(token, sourceReplaced ? 'success' : 'noop')) return false;
      setWorkspaceSnapshot(next);
      if (requestedWorkspaceId) {
        const requested = next.workspaces.find(workspace => workspace.id === requestedWorkspaceId && workspace.status !== 'archived');
        if (!requested) onWorkspaceUnavailableRef.current(`Workspace ${requestedWorkspaceId} is unavailable in ${requestedProject}.`);
      }
      return true;
    } catch (error) {
      if (generation !== refreshGenerationRef.current || !isTransitionOwner(token)) return false;
      if (ownsTransaction) onTransitionSettled(token, 'failure');
      onToast('error', error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      if (generation === refreshGenerationRef.current) setWorkspaceLoading(false);
    }
  }, [isTransitionOwner, onToast, onTransitionSettled, project, workspaceId]);

  const refreshDemoSeedStatus = useCallback(async () => {
    try {
      const params = new URLSearchParams({ project });
      const [demo, swissifier] = await Promise.all([
        api<{ status: DemoSeedMediaStatus }>(`/api/lineage-workspaces/demo/media?${params.toString()}`),
        api<{ status: DemoSeedMediaStatus }>(`/api/lineage-workspaces/demo/swissifier/media?${params.toString()}`),
      ]);
      if (currentProjectRef.current !== project) return;
      setDemoSeedStatus(demo.status);
      setSwissifierDemoStatus(swissifier.status);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }, [onToast, project]);

  async function activateWorkspace(workspaceId: string) {
    if (!workspaceId) return;
    const token = onBeforeTransition();
    if (token === null) return;
    const requested = visibleWorkspaces.find(workspace => workspace.id === workspaceId);
    if (!requested) {
      onTransitionSettled(token, 'failure');
      onWorkspaceUnavailable(`Workspace ${workspaceId} is unavailable in ${project}.`);
      return;
    }
    if (!isTransitionOwner(token)) return;
    onResetLineage();
    if (!onTransitionSettled(token, 'success')) return;
    onSelectedAsset(requested.root_asset_id);
    onWorkspaceChange(requested);
    onToast('ok', `Using ${requested.title}`);
  }

  async function seedDemoWorkspace(options: { quiet?: boolean } = {}) {
    const token = onBeforeTransition();
    if (token === null) return null;
    setWorkspaceLoading(true);
    try {
      const result = await api<{ workspace?: LineageWorkspace; root_asset_id: string }>('/api/lineage-workspaces/demo/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, confirmWrite: true }),
      });
      if (!isTransitionOwner(token)) return null;
      const refreshed = await refreshWorkspaces({ transitionToken: token });
      if (!refreshed) { onTransitionSettled(token, 'failure'); return null; }
      await refreshDemoSeedStatus();
      if (!isTransitionOwner(token) || !onTransitionSettled(token, 'success')) return null;
      onSelectedAsset(result.workspace?.root_asset_id || result.root_asset_id);
      if (result.workspace) onWorkspaceChange(result.workspace);
      if (!options.quiet) onToast('ok', 'Seeded demo lineage workspace');
      return result;
    } catch (error) {
      if (!isTransitionOwner(token)) return null;
      onTransitionSettled(token, 'failure');
      onToast('error', error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function seedSwissifierDemoWorkspace(options: { quiet?: boolean } = {}) {
    const token = onBeforeTransition();
    if (token === null) return null;
    setWorkspaceLoading(true);
    try {
      const result = await api<{ workspace?: LineageWorkspace; root_asset_id: string }>('/api/lineage-workspaces/demo/swissifier/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, confirmWrite: true }),
      });
      if (!isTransitionOwner(token)) return null;
      const refreshed = await refreshWorkspaces({ transitionToken: token });
      if (!refreshed) { onTransitionSettled(token, 'failure'); return null; }
      await refreshDemoSeedStatus();
      if (!isTransitionOwner(token) || !onTransitionSettled(token, 'success')) return null;
      onSelectedAsset(result.workspace?.root_asset_id || result.root_asset_id);
      if (result.workspace) onWorkspaceChange(result.workspace);
      if (!options.quiet) onToast('ok', 'Seeded Swissifier demo lineage');
      return result;
    } catch (error) {
      if (!isTransitionOwner(token)) return null;
      onTransitionSettled(token, 'failure');
      onToast('error', error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function restoreDemoSeedMedia() {
    setWorkspaceLoading(true);
    try {
      const result = await api<{ result: { restored?: number } }>('/api/lineage-workspaces/demo/media/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, confirmWrite: true }),
      });
      await refreshDemoSeedStatus();
      onToast('ok', `Restored ${result.result.restored || 0} demo media file${result.result.restored === 1 ? '' : 's'}`);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function restoreSwissifierDemoMedia() {
    setWorkspaceLoading(true);
    try {
      const result = await api<{ result: { restored?: number; source_required?: boolean; source_env?: string } }>('/api/lineage-workspaces/demo/swissifier/media/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, confirmWrite: true }),
      });
      await refreshDemoSeedStatus();
      if (result.result.source_required) {
        onToast('error', `Set ${result.result.source_env || 'LINEAGE_SWISSIFIER_MEDIA_DIR'} to restore Swissifier media`);
      } else {
        onToast('ok', `Restored ${result.result.restored || 0} Swissifier media file${result.result.restored === 1 ? '' : 's'}`);
      }
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function downloadSwissifierDemoMedia() {
    setWorkspaceLoading(true);
    try {
      const result = await api<{ result: { restored?: number; download_available?: boolean; media_status?: DemoSeedMediaStatus } }>('/api/lineage-workspaces/demo/swissifier/media/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, confirmWrite: true }),
      });
      if (result.result.media_status) {
        setSwissifierDemoStatus(result.result.media_status);
      } else {
        await refreshDemoSeedStatus();
      }
      if (!result.result.download_available) {
        onToast('error', 'Swissifier media download is not configured');
        return false;
      } else {
        onToast('ok', `Downloaded ${result.result.restored || 0} Swissifier media file${result.result.restored === 1 ? '' : 's'}`);
        return true;
      }
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function archiveWorkspace() {
    if (!activeWorkspace) return;
    const confirmed = window.confirm(`Archive ${activeWorkspace.title}? This hides it from the picker and clears its next-variation selection.`);
    if (!confirmed) return;
    const token = onBeforeTransition();
    if (token === null) return;
    setWorkspaceLoading(true);
    try {
      await api(`/api/lineage-workspaces/${encodeURIComponent(activeWorkspace.id)}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, confirmWrite: true }),
      });
      if (!isTransitionOwner(token)) return;
      const refreshed = await refreshWorkspaces({ transitionToken: token });
      if (!refreshed) { onTransitionSettled(token, 'failure'); return; }
      await refreshDemoSeedStatus();
      if (!isTransitionOwner(token) || !onTransitionSettled(token, 'success')) return;
      onWorkspaceChange(null);
      onToast('ok', `Archived ${activeWorkspace.title}`);
    } catch (error) {
      if (!isTransitionOwner(token)) return;
      onTransitionSettled(token, 'failure');
      onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspaceLoading(false);
    }
  }

  function handleWorkspaceCreated(workspace: LineageWorkspace, transitionToken?: number) {
    const token = transitionToken ?? onBeforeTransition();
    if (token === null) return false;
    if (!isTransitionOwner(token) || !onTransitionSettled(token, 'success')) return false;
    setWorkspaceSnapshot(current => ({
      project,
      active_workspace: workspace,
      workspaces: [workspace, ...(current?.workspaces || []).filter(item => item.id !== workspace.id)],
      fetchedAt: new Date().toISOString(),
    }));
    onSelectedAsset(workspace.root_asset_id);
    onWorkspaceChange(workspace);
    onToast('ok', `Using ${workspace.title}`);
    return true;
  }

  return {
    activateWorkspace,
    activeWorkspace,
    archiveWorkspace,
    demoSeedStatus,
    downloadSwissifierDemoMedia,
    handleWorkspaceCreated,
    refreshDemoSeedStatus,
    refreshWorkspaces,
    restoreDemoSeedMedia,
    restoreSwissifierDemoMedia,
    seedDemoWorkspace,
    seedSwissifierDemoWorkspace,
    swissifierDemoStatus,
    visibleWorkspaces,
    workspaceLoading,
    workspaceRootAssetId,
  };
}
