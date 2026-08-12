import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetLibrarySnapshot, GrowthAsset, MutationResponse, PresignResponse, ProjectSummary } from '../shared/types';
import type { LineageRuntimeInfo } from '../shared/runtimeInfoTypes';
import { api } from './api';
import { normalizePlacementValues, postMutation } from './assetMutations';
import { AssetDetailDrawer } from './components/AssetDetailDrawer';
import { AssetBoard } from './components/AssetBoard';
import { AgentsView, type AgentWorkTarget } from './components/AgentsView';
import { ContentBatchesView } from './components/ContentBatchesView';
import { CopiedTextFallback } from './components/CopiedTextFallback';
import { LedgerView } from './components/LedgerView';
import { LineageView } from './components/LineageView';
import { LocalBackupDrawer } from './components/LocalBackupDrawer';
import { LocalBackupQueue } from './components/LocalBackupQueue';
import { LocalSelectionToolbar } from './components/LocalSelectionToolbar';
import { ReviewQueue } from './components/ReviewQueue';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { ToastBanner } from './components/ToastBanner';
import { UploadDrawer } from './components/UploadDrawer';
import { canPreview, defaultProject, selectedOrFirst, type PlacementFilter, type SourceFilter, type StudioView, type StatusFilter, type Toast } from './assetUi';
import { copyToClipboard } from './clipboard';
import { shouldRevealCopiedText } from './copyFallback';
import { LineageCliProvider } from './lineageRuntimeCommand';
import { readContextPanelOpen, writeContextPanelOpen } from './navigationPreferences';

function initialProjectFromUrl(): string {
  if (typeof window === 'undefined') return defaultProject;
  return new URLSearchParams(window.location.search).get('project') || defaultProject;
}

function confirmLineageSocialTransition(dirty: boolean, confirmDiscard: () => boolean): boolean {
  return !dirty || confirmDiscard();
}

export function App() {
  const [snapshot, setSnapshot] = useState<AssetLibrarySnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [project, setProject] = useState(initialProjectFromUrl);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [placementStatus, setPlacementStatus] = useState<PlacementFilter>('all');
  const [source, setSource] = useState<SourceFilter>('local');
  const [channel, setChannel] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [liveSync, setLiveSync] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const [copiedText, setCopiedText] = useState<{ label: string; text: string } | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [localBackupIds, setLocalBackupIds] = useState<string[]>([]);
  const [queuedBackupAssets, setQueuedBackupAssets] = useState<GrowthAsset[]>([]);
  const [localBackupOpen, setLocalBackupOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [view, setView] = useState<StudioView>('lineage');
  const [assetDetailsOpen, setAssetDetailsOpen] = useState(false);
  const [inspectedAsset, setInspectedAsset] = useState<GrowthAsset | null>(null);
  const [runtime, setRuntime] = useState<LineageRuntimeInfo | null>(null);
  const [runtimeIdentityUnavailable, setRuntimeIdentityUnavailable] = useState(false);
  const [contextPanelOpen, setContextPanelOpen] = useState(readContextPanelOpen);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const [appTransitionPending, setAppTransitionPending] = useState(false);
  const lineageSocialDirtyRef = useRef(false);
  const lineageChildTransitionPendingRef = useRef(false);
  const appTransitionGenerationRef = useRef(0);
  const activeAppTransitionTokenRef = useRef<number | null>(null);
  const projectCatalogGenerationRef = useRef(0);
  const projectRef = useRef(project);
  const [lineageResetGeneration, setLineageResetGeneration] = useState(0);
  projectRef.current = project;
  const updateLineageSocialDirty = useCallback((dirty: boolean) => {
    lineageSocialDirtyRef.current = dirty;
  }, []);
  const updateLineageChildTransitionPending = useCallback((pending: boolean) => {
    lineageChildTransitionPendingRef.current = pending;
  }, []);
  const allowLineageTransition = useCallback(() => activeAppTransitionTokenRef.current === null && !lineageChildTransitionPendingRef.current && confirmLineageSocialTransition(lineageSocialDirtyRef.current, () => window.confirm('Discard unsaved Social changes?')), []);
  const beginAppTransition = useCallback(() => {
    if (!allowLineageTransition()) return null;
    const token = ++appTransitionGenerationRef.current;
    activeAppTransitionTokenRef.current = token;
    setAppTransitionPending(true);
    return token;
  }, [allowLineageTransition]);
  const settleAppTransition = useCallback((token: number) => {
    if (activeAppTransitionTokenRef.current !== token) return false;
    activeAppTransitionTokenRef.current = null;
    setAppTransitionPending(false);
    return true;
  }, []);
  const changeProject = useCallback((nextProject: string) => {
    if (nextProject === project || !allowLineageTransition()) return;
    setProject(nextProject);
  }, [allowLineageTransition, project]);
  const changeView = useCallback((nextView: StudioView) => {
    if (nextView === view || !allowLineageTransition()) return;
    setView(nextView);
  }, [allowLineageTransition, view]);
  const setDesktopContextPanelOpen = useCallback((open: boolean) => {
    setContextPanelOpen(open);
    writeContextPanelOpen(open);
  }, []);
  const showToast = useCallback((type: Toast['type'], message: string) => {
    setToast({ type, message });
  }, []);

  const projectSnapshot = snapshot?.catalog.project === project ? snapshot : null;
  const assets = projectSnapshot?.assets || [];
  const selectedFromList = selectedOrFirst(assets, selectedId);
  const selected = selectedFromList || (inspectedAsset?.project === project && inspectedAsset.asset_id === selectedId ? inspectedAsset : undefined);
  const selectedAssetId = selected?.asset_id || '';
  const localBackupAssets = [
    ...queuedBackupAssets.filter(asset => localBackupIds.includes(asset.asset_id)),
    ...assets.filter(asset => localBackupIds.includes(asset.asset_id) && asset.local?.relative_path),
  ].filter((asset, index, list) => list.findIndex(item => item.asset_id === asset.asset_id) === index);
  const selectedPreviewUrl = selected ? previewUrls[selected.asset_id] || null : null;
  const channels = useMemo(() => ['all', ...(projectSnapshot?.facets.channels || [])], [projectSnapshot]);
  const totals = useMemo(
    () => ({
      assets: projectSnapshot?.catalog.asset_count || 0,
      live: projectSnapshot?.liveObjects.length || 0,
      orphan: projectSnapshot?.orphanObjects.length || 0,
      size: projectSnapshot?.facets.totalSizeBytes || 0,
    }),
    [projectSnapshot]
  );
  async function refreshProjects() {
    const requestGeneration = ++projectCatalogGenerationRef.current;
    try {
      const result = await api<{ projects: ProjectSummary[] }>('/api/projects');
      if (requestGeneration !== projectCatalogGenerationRef.current) return;
      setProjects(result.projects);
      const currentProject = projectRef.current;
      const fallbackProject = result.projects.some(item => item.project === currentProject) ? currentProject : result.projects[0]?.project || defaultProject;
      if (fallbackProject === currentProject) return;
      const token = beginAppTransition();
      if (token === null) return;
      if (requestGeneration !== projectCatalogGenerationRef.current || projectRef.current !== currentProject) {
        settleAppTransition(token);
        return;
      }
      if (!settleAppTransition(token)) return;
      setProject(fallbackProject);
    } catch (error) {
      if (requestGeneration !== projectCatalogGenerationRef.current) return;
      setToast({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  async function refreshRuntimeIdentity() {
    try {
      const result = await api<{ runtime: LineageRuntimeInfo }>('/api/runtime');
      setRuntime(result.runtime);
      setRuntimeIdentityUnavailable(false);
    } catch {
      setRuntime(null);
      setRuntimeIdentityUnavailable(true);
    }
  }
  async function refresh() {
    setLoading(true);
    try {
      const next = await api<AssetLibrarySnapshot>(`/api/assets?${assetQuery()}`);
      setSnapshot(next);
      setSelectedId(current => {
        const nextSelected = selectedOrFirst(next.assets, current)?.asset_id;
        if (nextSelected) return nextSelected;
        if (current && inspectedAsset?.asset_id === current) return current;
        return null;
      });
      setPreviewUrls({});
      setPreviewErrors({});
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }
  function assetQuery() {
    const params = new URLSearchParams({ project, page: String(page), pageSize: String(pageSize), live: String(liveSync), source });
    if (status !== 'all') params.set('status', status);
    if (placementStatus !== 'all') params.set('placementStatus', placementStatus);
    if (channel !== 'all') params.set('channel', channel);
    if (query.trim()) params.set('q', query.trim());
    return params.toString();
  }
  async function mutate(action: () => Promise<MutationResponse>) {
    try {
      const result = await action();
      setToast({ type: 'ok', message: result.message });
      setPreviewUrls({});
      await refresh();
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  async function getPreviewUrl(asset: GrowthAsset, options: { open?: boolean; quiet?: boolean } = {}) {
    if (!canPreview(asset)) return null;
    const cached = previewUrls[asset.asset_id];
    if (cached) {
      if (options.open) window.open(cached, '_blank', 'noopener,noreferrer');
      return cached;
    }
    if (asset.local?.relative_path) {
      const params = new URLSearchParams({ project, path: asset.local.relative_path });
      const url = `/api/assets/local-preview?${params.toString()}`;
      setPreviewUrls(current => ({ ...current, [asset.asset_id]: url }));
      setPreviewErrors(current => ({ ...current, [asset.asset_id]: '' }));
      if (options.open) window.open(url, '_blank', 'noopener,noreferrer');
      return url;
    }
    try {
      const response = await api<PresignResponse>('/api/assets/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, assetId: asset.asset_id, expiresIn: 900 }),
      });
      setPreviewUrls(current => ({ ...current, [asset.asset_id]: response.url }));
      setPreviewErrors(current => ({ ...current, [asset.asset_id]: '' }));
      if (options.open) window.open(response.url, '_blank', 'noopener,noreferrer');
      return response.url;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPreviewErrors(current => ({ ...current, [asset.asset_id]: message }));
      if (!options.quiet) setToast({ type: 'error', message: 'Preview unavailable. Check S3 credentials or pull the asset locally.' });
      return null;
    }
  }
  async function copyText(text: string, label: string) {
    try {
      const result = await copyToClipboard(text);
      setToast({ type: 'ok', message: result.method === 'fallback' ? `Copied ${label} using browser fallback` : `Copied ${label}` });
      setCopiedText(shouldRevealCopiedText(label, text) ? { label, text } : null);
    } catch (error) {
      setCopiedText(shouldRevealCopiedText(label, text) ? { label, text } : null);
      setToast({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  async function copyPreviewUrl(asset: GrowthAsset) {
    const url = await getPreviewUrl(asset, { quiet: true });
    if (url) await copyText(url, 'preview link');
  }
  function queueLocalBackup(asset: GrowthAsset) {
    if (!asset.local?.relative_path) return;
    setLocalBackupIds(current => current.includes(asset.asset_id) ? current : [...current, asset.asset_id]);
    setQueuedBackupAssets(current => current.some(item => item.asset_id === asset.asset_id) ? current : [...current, asset]);
  }
  function inspectAssetInContext(asset: GrowthAsset) {
    setInspectedAsset(asset);
    setSelectedId(asset.asset_id);
    setAssetDetailsOpen(true);
  }
  async function openAssetDetails(assetId: string) {
    setSelectedId(assetId);
    setAssetDetailsOpen(true);
    const found = assets.find(asset => asset.asset_id === assetId);
    if (found) {
      setInspectedAsset(found);
      return;
    }
    try {
      const result = await api<{ assets: GrowthAsset[] }>(
        '/api/assets/lookup',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project, assetIds: [assetId] }),
        }
      );
      if (result.assets[0]) setInspectedAsset(result.assets[0]);
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  function showBackupQueue() {
    if (!allowLineageTransition()) return;
    setSource('local');
    setStatus('all');
    setPlacementStatus('all');
    setQuery('');
    setView('backup');
  }
  async function openAgentWork(target: AgentWorkTarget) {
    const token = beginAppTransition();
    if (token === null) return;
    try {
      if (target.view === 'lineage' && target.workspaceId) {
        await api(`/api/lineage-workspaces/${encodeURIComponent(target.workspaceId)}/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project, confirmWrite: true }),
        });
      }
      if (!settleAppTransition(token)) return;
      if (target.assetId) setSelectedId(target.assetId);
      setAssetDetailsOpen(false);
      if (target.view === 'lineage') setLineageResetGeneration(current => current + 1);
      setView(target.view);
      setToast({ type: 'ok', message: `Opened ${target.claim.target_title || target.claim.target_id}` });
    } catch (error) {
      if (!settleAppTransition(token)) return;
      setToast({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  function toggleLocalBackup(asset: GrowthAsset) {
    if (!asset.local?.relative_path) return;
    setLocalBackupIds(current => current.includes(asset.asset_id) ? current.filter(id => id !== asset.asset_id) : [...current, asset.asset_id]);
    setQueuedBackupAssets(current => current.filter(item => item.asset_id !== asset.asset_id));
  }
  useEffect(() => {
    void refreshProjects();
    void refreshRuntimeIdentity();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('project') === project) return;
    params.set('project', project);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, [project]);

  useEffect(() => {
    setToast(null);
    setCopiedText(null);
    setInspectedAsset(null);
    setAssetDetailsOpen(false);
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [page, pageSize, project, status, placementStatus, source, channel, query, liveSync]);

  useEffect(() => {
    setPage(1);
  }, [project, status, placementStatus, source, channel, query, pageSize]);

  useEffect(() => {
    if (!canPreview(selected) || previewUrls[selected.asset_id]) return;
    void getPreviewUrl(selected, { quiet: true });
  }, [selected?.asset_id, selected?.s3?.version_id, previewUrls]);

  useEffect(() => {
    if (toast?.type !== 'ok') return undefined;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast?.message, toast?.type]);

  useEffect(() => {
    if (view !== 'backup') return;
    setSource('local');
    setStatus('all');
    setPlacementStatus('all');
  }, [view]);

  useEffect(() => {
    setMobileContextOpen(false);
    if (view === 'lineage') setAssetDetailsOpen(false);
  }, [view]);

  useEffect(() => {
    if (selectedAssetId) return;
    setAssetDetailsOpen(false);
  }, [selectedAssetId]);

  useEffect(() => {
    if (!mobileContextOpen) return undefined;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileContextOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileContextOpen]);

  return (
    <LineageCliProvider runtime={runtime}>
    <div className={`app-shell ${view === 'lineage' ? 'lineage-mode' : ''} ${contextPanelOpen ? '' : 'context-panel-collapsed'} ${mobileContextOpen ? 'mobile-context-open' : ''}`}>
      <Sidebar
        channel={channel}
        channels={channels}
        contextOpen={contextPanelOpen}
        mobileContextOpen={mobileContextOpen}
        onContextOpenChange={setDesktopContextPanelOpen}
        onMobileContextOpenChange={setMobileContextOpen}
        placementStatus={placementStatus}
        project={project}
        projects={projects}
        runtime={runtime}
        runtimeIdentityUnavailable={runtimeIdentityUnavailable}
        setChannel={setChannel}
        setPlacementStatus={setPlacementStatus}
        setProject={changeProject}
        setSource={setSource}
        setStatus={setStatus}
        setUploadOpen={setUploadOpen}
        setView={changeView}
        showBackupQueue={showBackupQueue}
        source={source}
        status={status}
        view={view}
      >
        <Topbar
          assetDetailsOpen={assetDetailsOpen}
          canInspectAsset={Boolean(selected)}
          loading={loading}
          query={query}
          refresh={refresh}
          setAssetDetailsOpen={setAssetDetailsOpen}
          setQuery={setQuery}
          view={view}
        />
      </Sidebar>
      <main className="workspace">
        {toast && <ToastBanner toast={toast} onDismiss={() => setToast(null)} />}
        {copiedText && <CopiedTextFallback copiedText={copiedText} onDismiss={() => setCopiedText(null)} />}
        {view === 'review' ? (
          <ReviewQueue
            channel={channel}
            onCopy={copyText}
            onLocalReview={async (asset, reviewState) => {
              await mutate(() => postMutation(`/api/local-review/${asset.asset_id}`, project, { reviewState, confirmWrite: true }));
            }}
            onOpenBackup={asset => {
              queueLocalBackup(asset);
              setLocalBackupOpen(true);
            }}
            onSelectAsset={asset => {
              inspectAssetInContext(asset);
            }}
            project={project}
            selected={selected}
          />
        ) : view === 'ledger' ? (
          <LedgerView
            project={project}
            query={query}
            onOpenAsset={openAssetDetails}
          />
        ) : view === 'content' ? (
          <ContentBatchesView
            onCopy={copyText}
            onOpenAsset={openAssetDetails}
            onToast={showToast}
            project={project}
            selectedAsset={selected}
          />
        ) : view === 'agents' ? (
          <AgentsView onCopy={copyText} onOpenWork={openAgentWork} project={project} />
        ) : view === 'backup' ? (
          <LocalBackupQueue
            assets={assets}
            cli={runtime?.cli}
            onCopy={copyText}
            onLocalReview={async (asset, reviewState) => {
              await mutate(() => postMutation(`/api/local-review/${asset.asset_id}`, project, { reviewState, confirmWrite: true }));
            }}
            onOpenBackup={() => setLocalBackupOpen(true)}
            onQueueBackup={queueLocalBackup}
            onSelectAsset={asset => {
              inspectAssetInContext(asset);
            }}
            page={page}
            pageSize={pageSize}
            project={project}
            selected={selected}
            selectedBackupIds={localBackupIds}
            setPage={setPage}
            setPageSize={setPageSize}
            snapshot={projectSnapshot}
          />
        ) : view === 'assets' ? (
          <>
            <LocalSelectionToolbar
              assets={localBackupAssets}
              onClear={() => {
                setLocalBackupIds([]);
                setQueuedBackupAssets([]);
              }}
              onOpen={() => setLocalBackupOpen(true)}
            />
            <AssetBoard assets={assets} liveSync={liveSync} onCopy={copyText} page={page} pageSize={pageSize} previewUrls={previewUrls} project={project} selected={selected} setLiveSync={setLiveSync} setPage={setPage} setPageSize={setPageSize} setSelectedId={setSelectedId} snapshot={projectSnapshot} source={source} totals={totals} />
          </>
        ) : view === 'settings' ? <SettingsView onToast={showToast} project={project} /> : (
          <LineageView
            asset={selected}
            key={`${project}:${lineageResetGeneration}`}
            onAssetsChanged={refresh}
            onSocialDirtyChange={updateLineageSocialDirty}
            onSocialTransitionPendingChange={updateLineageChildTransitionPending}
            onSelectedAsset={setSelectedId}
            onToast={showToast}
            project={project}
            transitionLocked={appTransitionPending}
          />
        )}
      </main>
      {view !== 'lineage' && assetDetailsOpen && (
        <AssetDetailDrawer
          asset={selected}
          onArchive={asset => void mutate(() => postMutation('/api/assets/archive', project, { assetId: asset.asset_id, confirmArchive: true }))}
          onClose={() => setAssetDetailsOpen(false)}
          onCopy={(text, label) => void copyText(text, label)}
          onCopyPreview={asset => void copyPreviewUrl(asset)}
          onDelete={(asset, confirmation) =>
            void mutate(() =>
              postMutation('/api/assets/delete-object', project, { assetId: asset.asset_id, confirmation })
            )
          }
          onPlacement={(asset, placement, values) =>
            void mutate(() =>
              postMutation('/api/assets/placement', project, {
                assetId: asset.asset_id,
                channel: asset.channel,
                ...normalizePlacementValues(values),
                status: placement,
                confirmWrite: true,
              })
            )
          }
          onPresign={asset => void getPreviewUrl(asset, { open: true })}
          onPromote={asset => void mutate(() => postMutation('/api/assets/promote', project, { assetId: asset.asset_id, confirmWrite: true }))}
          onPull={asset => void mutate(() => postMutation('/api/assets/pull', project, { assetId: asset.asset_id, out: '.asset-scratch' }))}
          onToggleBackup={toggleLocalBackup}
          previewError={selected ? previewErrors[selected.asset_id] || null : null}
          previewUrl={selectedPreviewUrl}
          selectedForBackup={selected ? localBackupIds.includes(selected.asset_id) : false}
        />
      )}
      {uploadOpen && (
        <UploadDrawer
          channels={channels.filter(item => item !== 'all')}
          project={project}
          onClose={() => setUploadOpen(false)}
          onError={message => setToast({ type: 'error', message })}
          onUploaded={async message => {
            setToast({ type: 'ok', message });
            setUploadOpen(false);
            await refresh();
          }}
        />
      )}
      {localBackupOpen && (
        <LocalBackupDrawer assets={localBackupAssets} project={project} onClose={() => setLocalBackupOpen(false)} onError={message => setToast({ type: 'error', message })} onDone={async message => {
          setToast({ type: 'ok', message });
          setLocalBackupIds([]);
          setQueuedBackupAssets([]);
          setLocalBackupOpen(false);
          await refresh();
        }} />
      )}
    </div>
    </LineageCliProvider>
  );
}
