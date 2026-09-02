import { type CSSProperties, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Edge, type EdgeChange, type ReactFlowInstance, useEdgesState, useNodesState } from '@xyflow/react';
import { ArrowLeft } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './LineageView.css';
import './LineageFocus.css';
import type { AgentClaimsResponse, AgentClaimSummary, AssetReviewState, GrowthAsset, LineageAttempt, LineageAttemptPromotionResponse, LineageAttemptsResponse, LineageBriefResponse, LineageEdgeSummaryMutationResponse, LineageIndexSummary, LineageNode, LineageSnapshot } from '../../shared/types';
import type { GenerationJob, GenerationJobListResponse } from '../../shared/generationTypes';
import type { LineageWorkspace } from '../../shared/lineageWorkspaceTypes';
import { api, ApiError } from '../api';
import {
  readHoverPreviewsEnabled,
  readCanvasSettingsHintDismissed,
  readLineageCanvasPresentation,
  readLineageEdgeLabelsVisible,
  readLineageEdgeWeight,
  readLineageGraphDirection,
  readLineageMinimapVisible,
  readVariationPromptAutoEdit,
  readBranchPromptOnMark,
  readRerollPromptOnMark,
  readDiscussionNotePrompt,
  readLineagePreviewActions,
  lineagePreviewActionDefaults,
  resetLineageAppearancePreferences,
  writeHoverPreviewsEnabled,
  writeCanvasSettingsHintDismissed,
  writeLineageCanvasPresentation,
  writeLineageEdgeLabelsVisible,
  writeLineageEdgeWeight,
  writeLineageGraphDirection,
  writeLineageMinimapVisible,
  writeVariationPromptAutoEdit,
  writeBranchPromptOnMark,
  writeRerollPromptOnMark,
  writeDiscussionNotePrompt,
  writeLineagePreviewActions,
  type LineageEdgeWeight,
  type LineagePreviewAction,
} from '../lineagePreferences';
import type { AssetFlowNode, LineageCanvasPresentation } from './LineageAssetNode';
import { LineageCanvas, type LineageWorkspaceProgress } from './LineageCanvas';
import { LineageCanvasAppearanceControls } from './LineageCanvasAppearanceControls';
import { LineageContextMenu } from './LineageContextMenu';
import { activeNodeIdAfterRefresh } from './lineageRefreshState';
import { LineageAttemptHistoryModal } from './LineageAttemptHistoryModal';
import { LineageDetailModal } from './LineageDetailModal';
import { NodeEditorSessionDialog } from './NodeEditorSessionDialog';
import { LineageEdgeSummaryDialog, type EdgeSummaryEditAction } from './LineageEdgeSummaryDialog';
import { LineageNewWorkspaceModal } from './LineageNewWorkspaceModal';
import { LineageReplayControls } from './LineageReplayControls';
import { LineageSidePanel } from './LineageSidePanel';
import { LineageToolbar } from './LineageToolbar';
import { LineageGenerationSheet } from './LineageGenerationSheet';
import { LineageVariationPromptDialog, type VariationPromptMode } from './LineageVariationPromptDialog';
import { LineageDiscussionNoteDialog } from './LineageDiscussionNoteDialog';
import { LineageVariationQueuePanel, type VariationQueueSelection, variationTaskLocked } from './LineageVariationQueuePanel';
import { decorateSnapshotWithGenerationTargets } from './LineageGenerationTargets';
import { NodeNextOutputTargetsEditor } from './NodeNextOutputTargets';
import { loadNodeNextOutputTargets, type NodeNextOutputTargetsResponse } from './NodeNextOutputTargetsModel';
import { OutputTargetPreferencesDialog } from './OutputTargetPreferencesDialog';
import { saveLineagePositions } from './lineageLayoutApi';
import { reconcileAuthoritativeEdgeChanges } from './lineageEdgeState';
import { lineageReviewConflict } from './lineageReviewConflict';
import { layoutLineageTree, lineageGraphKey, projectLineageBranches, toGraph, type LineageGraphDirection } from './lineageGraph';
import { buildLineageReplayTimeline, isLineageReplayable, projectLineageReplay, type LineageReplayPhase } from './lineageReplay';
import { useEscapeClear } from './useEscapeClear';
import { useLineageWorkspaces } from './useLineageWorkspaces';
import { useLineageViewportFit } from './useLineageViewportFit';

// eslint-disable-next-line react-refresh/only-export-components -- pure URL contract shared with regression tests
export function lineageCanvasPresentationFromSearch(
  search: string,
  fallback: LineageCanvasPresentation = 'compact',
): LineageCanvasPresentation {
  const requested = new URLSearchParams(search).get('lineageCanvas');
  return requested === 'portrait' || requested === 'compact' ? requested : fallback;
}

type VariationLimitTarget = { project: string; rootAssetId: string; workspaceId: string | null };

// eslint-disable-next-line react-refresh/only-export-components -- pure stale-response guard shared with regression tests
export function variationLimitTargetIsCurrent(requested: VariationLimitTarget, current: VariationLimitTarget): boolean {
  return requested.project === current.project
    && requested.rootAssetId === current.rootAssetId
    && requested.workspaceId === current.workspaceId;
}

// eslint-disable-next-line react-refresh/only-export-components -- pure save-result policy shared with regression tests
export function variationLimitSaveOutcome(
  generation: number,
  currentGeneration: number,
  requested: VariationLimitTarget,
  current: VariationLimitTarget,
): { announce: boolean; apply: boolean } {
  const apply = variationLimitTargetIsCurrent(requested, current);
  return { apply, announce: apply && generation === currentGeneration };
}

// eslint-disable-next-line react-refresh/only-export-components -- pure request sequencing helper shared with regression tests
export function serializeVariationLimitSave(previous: Promise<void>, save: () => Promise<void>): Promise<void> {
  return previous.catch(() => undefined).then(save);
}

type RectBounds = Pick<DOMRect, 'bottom' | 'height' | 'left' | 'right' | 'top' | 'width'>;

// eslint-disable-next-line react-refresh/only-export-components -- pure viewport geometry shared with regression tests
export function variationQueueVisibleBounds(canvas: RectBounds, panel?: RectBounds): { bottom: number; left: number; right: number; top: number } {
  const bounds = { bottom: canvas.height, left: 0, right: canvas.width, top: 0 };
  if (!panel) return bounds;

  const overlapLeft = Math.max(canvas.left, panel.left);
  const overlapRight = Math.min(canvas.right, panel.right);
  const overlapTop = Math.max(canvas.top, panel.top);
  const overlapBottom = Math.min(canvas.bottom, panel.bottom);
  const overlapWidth = Math.max(0, overlapRight - overlapLeft);
  const overlapHeight = Math.max(0, overlapBottom - overlapTop);
  if (overlapWidth === 0 || overlapHeight === 0) return bounds;

  const coversMostWidth = overlapWidth >= canvas.width * 0.8;
  if (coversMostWidth && overlapTop > canvas.top) bounds.bottom = overlapTop - canvas.top;
  else if (overlapLeft > canvas.left) bounds.right = overlapLeft - canvas.left;
  return bounds;
}

type LineageBranchMotion = {
  edgeIds: ReadonlySet<string>;
  nodeOffsets: ReadonlyMap<string, { x: number; y: number }>;
  phase: 'entering' | 'exiting';
};

const branchMotionDuration = {
  entering: 240,
  exiting: 210,
} as const;

export function LineageView({
  asset,
  newWorkspaceRequest,
  onAssetsChanged,
  onCanvasPresentationChange,
  onExitWorkspace,
  onNewWorkspaceCancelled,
  onSelectedAsset,
  onToast,
  onWorkspaceChange,
  onWorkspaceUnavailable,
  project,
  workspaceId,
}: {
  asset?: GrowthAsset;
  newWorkspaceRequest?: number;
  onAssetsChanged?: () => Promise<void> | void;
  onCanvasPresentationChange: (presentation: LineageCanvasPresentation) => void;
  onExitWorkspace: () => void;
  onNewWorkspaceCancelled: () => void;
  onSelectedAsset: (assetId: string) => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  onWorkspaceChange: (workspace: LineageWorkspace | null) => void;
  onWorkspaceUnavailable: (message: string) => void;
  project: string;
  workspaceId: string | null;
}) {
  const [canvasPresentation, setCanvasPresentation] = useState<LineageCanvasPresentation>(() =>
    lineageCanvasPresentationFromSearch(
      typeof window === 'undefined' ? '' : window.location.search,
      readLineageCanvasPresentation(),
    ));
  const [snapshot, setSnapshot] = useState<LineageSnapshot | null>(null);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => new Set());
  const [branchMotion, setBranchMotion] = useState<LineageBranchMotion | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [childAssetId, setChildAssetId] = useState('');
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  const [targetNodeId, setTargetNodeId] = useState<string | null>(null);
  const [historyNodeId, setHistoryNodeId] = useState<string | null>(null);
  const [historyAttempts, setHistoryAttempts] = useState<LineageAttempt[]>([]);
  const [editorNodeId, setEditorNodeId] = useState<string | null>(null);
  const [editorEligibleNodeIds, setEditorEligibleNodeIds] = useState<Set<string>>(() => new Set());
  const [hoverPreviewsEnabled, setHoverPreviewsEnabled] = useState(readHoverPreviewsEnabled);
  const [variationPromptAutoEdit, setVariationPromptAutoEdit] = useState(readVariationPromptAutoEdit);
  const [branchPromptOnMark, setBranchPromptOnMark] = useState(readBranchPromptOnMark);

  useEffect(() => {
    if (!snapshot) { setEditorEligibleNodeIds(new Set()); return; }
    const abort = new AbortController();
    void Promise.all(snapshot.nodes.map(async node => {
      const query = new URLSearchParams({ project, rootAssetId: snapshot.root_asset_id, nodeAssetId: node.asset_id });
      try {
        const response = await fetch(`/api/node-editor-plugins?${query}`, { signal: abort.signal });
        if (!response.ok) return undefined;
        const body = await response.json() as { plugins?: Array<{ eligible?: boolean }> };
        return body.plugins?.some(plugin => plugin.eligible === true) ? node.asset_id : undefined;
      } catch { return undefined; }
    })).then(ids => { if (!abort.signal.aborted) setEditorEligibleNodeIds(new Set(ids.filter((id): id is string => Boolean(id)))); });
    return () => abort.abort();
  }, [project, snapshot]);
  const [rerollPromptOnMark, setRerollPromptOnMark] = useState(readRerollPromptOnMark);
  const [discussionNotePrompt, setDiscussionNotePrompt] = useState(readDiscussionNotePrompt);
  const [previewActions, setPreviewActions] = useState(readLineagePreviewActions);
  const [minimapVisible, setMinimapVisible] = useState(readLineageMinimapVisible);
  const [brief, setBrief] = useState<LineageBriefResponse | null>(null);
  const [claims, setClaims] = useState<AgentClaimSummary[]>([]);
  const [edgeSummariesVisible, setEdgeSummariesVisible] = useState(readLineageEdgeLabelsVisible);
  const [edgeWeight, setEdgeWeight] = useState<LineageEdgeWeight>(readLineageEdgeWeight);
  const [edgeEditor, setEdgeEditor] = useState<{ edgeId: string; returnFocus: HTMLElement | SVGElement | null } | null>(null);
  const [compactGraphDirection, setCompactGraphDirection] = useState<LineageGraphDirection>(() => readLineageGraphDirection('compact'));
  const [portraitGraphDirection, setPortraitGraphDirection] = useState<LineageGraphDirection>(() => readLineageGraphDirection('portrait'));
  const [selectionNote, setSelectionNote] = useState('');
  const [variationPrompt, setVariationPrompt] = useState<{
    anchor?: { bottom: number; left: number; right: number; top: number };
    branchAction?: 'add' | 'edit' | 'replace';
    mode: VariationPromptMode;
    nodeId: string;
    returnFocus?: HTMLElement;
  } | null>(null);
  const [discussionDialog, setDiscussionDialog] = useState<{
    anchor?: { bottom: number; left: number; right: number; top: number };
    mode: 'edit' | 'mark';
    nodeId: string;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{ assetId: string; x: number; y: number } | null>(null);
  const [newLineageOpen, setNewLineageOpen] = useState(false);
  const [externalNewWorkspaceOpen, setExternalNewWorkspaceOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<'settings' | 'queue' | 'asset' | null>(null);
  const [variationQueuePrimary, setVariationQueuePrimary] = useState<VariationQueueSelection | null>(null);
  const [settingsHintVisible, setSettingsHintVisible] = useState(() => !readCanvasSettingsHintDismissed());
  const [canvasToolsHost, setCanvasToolsHost] = useState<HTMLElement | null>(null);
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<AssetFlowNode>([]);
  const [flowEdges, setFlowEdges] = useEdgesState<Edge>([]);
  const [flowApi, setFlowApi] = useState<ReactFlowInstance<AssetFlowNode, Edge> | null>(null);
  const [loading, setLoading] = useState(false);
  const [generationJobs, setGenerationJobs] = useState<GenerationJob[]>([]);
  const [nodeTargetStates, setNodeTargetStates] = useState<Record<string, NodeNextOutputTargetsResponse>>({});
  const [generationOpen, setGenerationOpen] = useState(false);
  const [outputDefaultsOpen, setOutputDefaultsOpen] = useState(false);
  const [workspaceProgress, setWorkspaceProgress] = useState<LineageWorkspaceProgress>(null);
  const indexingRefreshStarted = useRef(false);
  const [menuCloseSignal, setMenuCloseSignal] = useState(0);
  const [replaySnapshot, setReplaySnapshot] = useState<LineageSnapshot | null>(null);
  const [replayStageIndex, setReplayStageIndex] = useState(-1);
  const [replayPhase, setReplayPhase] = useState<LineageReplayPhase>('settled');
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [reduceReplayMotion, setReduceReplayMotion] = useState(false);
  const replayTimeline = useMemo(
    () => replaySnapshot ? buildLineageReplayTimeline(replaySnapshot) : { stages: [] },
    [replaySnapshot],
  );
  const replayLastStage = replayTimeline.stages.length - 1;
  const replayAtEnd = Boolean(replaySnapshot && replayStageIndex === replayLastStage && replayPhase === 'settled');
  const decoratedSnapshot = useMemo(
    () => snapshot ? decorateSnapshotWithGenerationTargets(snapshot, generationJobs, nodeTargetStates) : null,
    [generationJobs, nodeTargetStates, snapshot],
  );
  const graphSnapshot = replaySnapshot && !replayAtEnd ? replaySnapshot : decoratedSnapshot;
  const effectiveCollapsedNodeIds = useMemo(
    () => replaySnapshot ? new Set<string>() : collapsedNodeIds,
    [collapsedNodeIds, replaySnapshot],
  );
  const activeNode = snapshot?.nodes.find(node => node.asset_id === activeNodeId) || snapshot?.nodes[0];
  const editingEdge = snapshot?.edges.find(edge => edge.id === edgeEditor?.edgeId);
  const latestNodes = snapshot?.nodes.filter(node => snapshot.latest.includes(node.asset_id)) || [];
  const selectedNodes = useMemo(
    () => snapshot?.selected.map(assetId => snapshot.nodes.find(node => node.asset_id === assetId)).filter((node): node is LineageNode => Boolean(node)) || [],
    [snapshot],
  );
  const discussionDialogNode = snapshot?.nodes.find(node => node.asset_id === discussionDialog?.nodeId);
  const selectedNode = selectedNodes[0];
  const rerollNodes = useMemo(
    () => snapshot?.nodes.filter(node => node.reroll_request?.status === 'pending') || [],
    [snapshot],
  );
  const variationQueueCount = selectedNodes.length + rerollNodes.length;
  const variationQueueNodeIds = useMemo(
    () => new Set([...selectedNodes, ...rerollNodes].map(node => node.asset_id)),
    [rerollNodes, selectedNodes],
  );
  const nextVariationLimit = snapshot?.next_variation_limit || 3;
  const selectionFull = selectedNodes.length >= nextVariationLimit;
  const branchLimitMessage = `${selectedNodes.length} of ${nextVariationLimit} branches queued. Raise the maximum in Canvas settings or remove a branch.`;
  const detailNode = snapshot?.nodes.find(node => node.asset_id === detailNodeId) || null, historyNode = snapshot?.nodes.find(node => node.asset_id === historyNodeId) || null, menuNode = snapshot?.nodes.find(node => node.asset_id === nodeMenu?.assetId), targetNode = snapshot?.nodes.find(node => node.asset_id === targetNodeId) || null;
  const variationPromptNode = snapshot?.nodes.find(node => node.asset_id === variationPrompt?.nodeId) || null;
  const canvasHoverPreviewsEnabled = hoverPreviewsEnabled && !detailNode && !historyNode && !editingEdge && !variationPrompt && !panelMode && (!replaySnapshot || replayAtEnd);
  const noteDirty = Boolean(activeNode && selectionNote !== (activeNode.selection_note || ''));
  const graphDirection = canvasPresentation === 'portrait' ? portraitGraphDirection : compactGraphDirection;
  const authoritativeEdges = useRef<Edge[]>([]);
  const renderedGraphKey = useRef('');
  const workspaceRootRef = useRef('');
  const activeWorkspaceIdRef = useRef<string | null>(null);
  const variationLimitSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const variationLimitSaveGenerationRef = useRef(0);
  const panelReturnFocusRef = useRef<HTMLElement | null>(null);
  const branchMotionRef = useRef<LineageBranchMotion | null>(null);
  const branchMotionTimer = useRef<number | null>(null);
  const { fitGraph, markViewportInteraction } = useLineageViewportFit(
    flowApi,
    snapshot?.root_asset_id,
    false,
    `${canvasPresentation}:${graphDirection}`,
  );
  const closeTransientMenus = useCallback(() => {
    setMenuCloseSignal(value => value + 1);
    setNodeMenu(null);
  }, []);
  const currentProjectRef = useRef(project);
  useEffect(() => { currentProjectRef.current = project; }, [project]);
  const clearFocus = useCallback(() => { setActiveNodeId(null); closeTransientMenus(); }, [closeTransientMenus]);
  const toggleCollapsedBranch = useCallback((assetId: string) => {
    if (!decoratedSnapshot || replaySnapshot || branchMotionRef.current) return;
    const next = new Set(collapsedNodeIds);
    const expanding = next.has(assetId);
    if (expanding) next.delete(assetId);
    else next.add(assetId);
    const currentProjection = projectLineageBranches(decoratedSnapshot, collapsedNodeIds);
    const nextProjection = projectLineageBranches(decoratedSnapshot, next);
    const motionNodeIds = expanding
      ? setDifference(nextProjection.visibleNodeIds, currentProjection.visibleNodeIds)
      : setDifference(currentProjection.visibleNodeIds, nextProjection.visibleNodeIds);
    if (activeNodeId && !nextProjection.visibleNodeIds.has(activeNodeId)) setActiveNodeId(null);
    if (motionNodeIds.size === 0) {
      setCollapsedNodeIds(next);
      closeTransientMenus();
      return;
    }

    const nextGraph = toGraph(decoratedSnapshot, activeNodeId, graphDirection, edgeSummariesVisible, canvasPresentation, next);
    const motionNodes = expanding ? nextGraph.nodes : flowNodes;
    const motionEdges = expanding ? nextGraph.edges : flowEdges;
    const sourceNode = flowNodes.find(node => node.id === assetId) || nextGraph.nodes.find(node => node.id === assetId);
    const motion: LineageBranchMotion = {
      edgeIds: new Set(motionEdges
        .filter(edge => motionNodeIds.has(edge.source) || motionNodeIds.has(edge.target))
        .map(edge => edge.id)),
      nodeOffsets: branchMotionOffsets(motionNodes, sourceNode, motionNodeIds, graphDirection),
      phase: expanding ? 'entering' : 'exiting',
    };
    branchMotionRef.current = motion;
    setBranchMotion(motion);
    if (expanding) setCollapsedNodeIds(next);
    branchMotionTimer.current = window.setTimeout(() => {
      if (!expanding) setCollapsedNodeIds(next);
      branchMotionRef.current = null;
      branchMotionTimer.current = null;
      setBranchMotion(null);
    }, reduceReplayMotion ? 1 : branchMotionDuration[motion.phase]);
    closeTransientMenus();
  }, [activeNodeId, canvasPresentation, closeTransientMenus, collapsedNodeIds, decoratedSnapshot, edgeSummariesVisible, flowEdges, flowNodes, graphDirection, reduceReplayMotion, replaySnapshot]);
  const resetLineage = useCallback(() => {
    setSnapshot(null);
    setActiveNodeId(null);
    setBrief(null);
    setGenerationJobs([]);
    setNodeTargetStates({});
    setTargetNodeId(null);
    setReplaySnapshot(null);
    setReplayPlaying(false);
    setReplayPhase('settled');
    setReplayStageIndex(-1);
    setCollapsedNodeIds(new Set());
  }, []);
  const refreshNodeTargets = useCallback(async (targetSnapshot: LineageSnapshot | null = snapshot) => {
    if (!targetSnapshot) return;
    const results = await Promise.allSettled(targetSnapshot.nodes.map(node =>
      loadNodeNextOutputTargets(project, targetSnapshot.root_asset_id, node.asset_id)));
    const next: Record<string, NodeNextOutputTargetsResponse> = {};
    results.forEach(result => {
      if (result.status === 'fulfilled') next[result.value.node_asset_id] = result.value;
    });
    setNodeTargetStates(next);
  }, [project, snapshot]);
  const snapshotTargetKey = useMemo(
    () => snapshot ? `${snapshot.root_asset_id}\0${snapshot.nodes.map(node => node.asset_id).sort().join('\0')}` : '',
    [snapshot],
  );
  useEffect(() => {
    if (!snapshot) return;
    void refreshNodeTargets(snapshot);
  }, [refreshNodeTargets, snapshotTargetKey]);

  useEffect(() => {
    if (branchMotionTimer.current !== null) {
      window.clearTimeout(branchMotionTimer.current);
      branchMotionTimer.current = null;
    }
    branchMotionRef.current = null;
    setBranchMotion(null);
    setCollapsedNodeIds(new Set());
  }, [project, snapshot?.root_asset_id]);

  useEffect(() => () => {
    if (branchMotionTimer.current !== null) window.clearTimeout(branchMotionTimer.current);
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const collapsibleIds = new Set(snapshot.edges.map(edge => edge.parent_asset_id));
    setCollapsedNodeIds(current => {
      const next = new Set([...current].filter(nodeId => collapsibleIds.has(nodeId)));
      return next.size === current.size ? current : next;
    });
  }, [snapshot]);
  const {
    activeWorkspace,
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
    workspaceLoading,
    workspaceRootAssetId,
  } = useLineageWorkspaces({
    asset,
    onResetLineage: resetLineage,
    onSelectedAsset,
    onToast,
    onWorkspaceChange,
    onWorkspaceUnavailable,
    project,
    workspaceId,
  });
  activeWorkspaceIdRef.current = activeWorkspace?.id || null;
  useEffect(() => {
    if (activeWorkspace?.id === workspaceId) onCanvasPresentationChange(canvasPresentation);
  }, [activeWorkspace?.id, canvasPresentation, onCanvasPresentationChange, workspaceId]);
  workspaceRootRef.current = workspaceRootAssetId;
  useEffect(() => { void refreshDemoSeedStatus(); }, [refreshDemoSeedStatus]);
  const refresh = useCallback(async (options: { quiet?: boolean; rootAssetId?: string } = {}) => {
    const requestedRoot = options.rootAssetId || workspaceRootAssetId;
    if (!requestedRoot) return false;
    if (!options.quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ project });
      const [next, nextClaims] = await Promise.all([
        api<LineageSnapshot>(`/api/lineage/${requestedRoot}?${params.toString()}`),
        api<AgentClaimsResponse>(`/api/agent-claims?${params.toString()}`),
      ]);
      if (!options.rootAssetId && workspaceRootRef.current !== requestedRoot) return false;
      setSnapshot(next);
      void api<GenerationJobListResponse>(`/api/generation/jobs?${new URLSearchParams({ project, rootAssetId: requestedRoot, limit: '50' }).toString()}`)
        .then(result => {
          if (workspaceRootRef.current === requestedRoot) setGenerationJobs(result.jobs);
        })
        .catch(() => undefined);
      setClaims(nextClaims.claims);
      if (!options.quiet) setBrief(null);
      setActiveNodeId(current => activeNodeIdAfterRefresh(current, next.nodes, next.active_asset_id, Boolean(options.quiet)));
      return true;
    } catch (error) {
      if (!options.rootAssetId && workspaceRootRef.current !== requestedRoot) return false;
      if (!options.quiet && currentProjectRef.current === project) {
        setSnapshot(null);
        onToast('error', error instanceof Error ? error.message : String(error));
      }
      return false;
    } finally {
      if (!options.quiet && currentProjectRef.current === project) setLoading(false);
    }
  }, [onToast, project, workspaceRootAssetId]);
  const startReplay = useCallback(() => {
    if (!snapshot || !isLineageReplayable(snapshot)) return;
    closeTransientMenus();
    setActiveNodeId(null);
    setDetailNodeId(null);
    setHistoryNodeId(null);
    setHistoryAttempts([]);
    setEdgeEditor(null);
    setPanelMode(null);
    setReplaySnapshot(snapshot);
    setReplayStageIndex(-1);
    setReplayPhase('node');
    setReplayPlaying(true);
  }, [closeTransientMenus, snapshot]);
  const returnToLive = useCallback(() => {
    setReplaySnapshot(null);
    setReplayStageIndex(-1);
    setReplayPhase('settled');
    setReplayPlaying(false);
    void refresh({ quiet: true });
  }, [refresh]);
  const restartReplay = useCallback(() => {
    if (replayAtEnd && snapshot) setReplaySnapshot(snapshot);
    setReplayStageIndex(-1);
    setReplayPhase('node');
    setReplayPlaying(true);
  }, [replayAtEnd, snapshot]);
  const toggleReplay = useCallback(() => {
    if (replayAtEnd) {
      restartReplay();
      return;
    }
    setReplayPlaying(value => !value);
  }, [replayAtEnd, restartReplay]);
  const scrubReplay = useCallback((stageIndex: number) => {
    setReplayPlaying(false);
    setReplayPhase('settled');
    setReplayStageIndex(Math.max(0, Math.min(stageIndex, replayLastStage)));
  }, [replayLastStage]);
  async function indexAndRefresh() {
    setWorkspaceProgress(null);
    setLoading(true);
    try {
      const result = await api<{ summary: LineageIndexSummary }>('/api/index/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project }),
      });
      onToast('ok', `Indexed ${result.summary.total} assets`);
      await refreshWorkspaces();
      await refresh();
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }
  async function seedDemoAndRefreshAssets() {
    closeTransientMenus();
    setWorkspaceProgress(null);
    const seeded = await seedDemoWorkspace();
    if (!seeded) return;
    try {
      await onAssetsChanged?.();
      await refresh({ rootAssetId: seeded.workspace?.root_asset_id || seeded.root_asset_id });
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  async function seedSwissifierAndRefreshAssets() {
    closeTransientMenus();
    indexingRefreshStarted.current = false;
    setWorkspaceProgress('seeding');
    const seeded = await seedSwissifierDemoWorkspace();
    if (!seeded) {
      setWorkspaceProgress('error');
      return;
    }
    try {
      setWorkspaceProgress('indexing');
      await nextBrowserPaint();
      await onAssetsChanged?.();
      indexingRefreshStarted.current = true;
      const ready = await refresh({ rootAssetId: seeded.workspace?.root_asset_id || seeded.root_asset_id });
      if (!ready) {
        indexingRefreshStarted.current = false;
        setWorkspaceProgress('error');
      }
    } catch (error) {
      indexingRefreshStarted.current = false;
      setWorkspaceProgress('error');
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  async function downloadSwissifierAndTrack() {
    setWorkspaceProgress('downloading');
    const downloaded = await downloadSwissifierDemoMedia();
    setWorkspaceProgress(downloaded ? 'downloaded' : 'error');
  }
  async function mutateLineage(path: string, body: Record<string, unknown>, message: string) {
    try {
      await api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, ...body }),
      });
      onToast('ok', message);
      await refresh();
      return true;
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
      return false;
    }
  }
  function saveRationale() {
    if (!activeNode?.user_selected) return;
    void mutateLineage('/api/selection', {
      assetId: activeNode.asset_id,
      rootAssetId: snapshot?.root_asset_id,
      mode: 'add',
      notes: selectionNote.trim(),
      confirmWrite: true,
    }, `Updated branch prompt for ${activeNode.asset_id}`);
  }
  async function selectNextBase(node: LineageNode, notes = node.selection_note || '') {
    if (!node.user_selected && selectionFull) {
      onToast('error', branchLimitMessage);
      return;
    }
    return mutateLineage('/api/selection', {
      assetId: node.asset_id,
      rootAssetId: snapshot?.root_asset_id,
      mode: node.user_selected ? 'remove' : 'add',
      notes,
      confirmWrite: true,
    }, node.user_selected ? `Removed ${node.asset_id} from next variation` : `Using ${node.asset_id} for next variation`);
  }
  async function replaceNextVariation(node: LineageNode, notes = node.selection_note || '') {
    return mutateLineage('/api/selection', {
      assetId: node.asset_id,
      rootAssetId: snapshot?.root_asset_id,
      mode: 'replace',
      notes,
      confirmWrite: true,
    }, `Using only ${node.asset_id} for next variation`);
  }
  async function clearNextVariation(assetId?: string) {
    if (!snapshot) return;
    if (assetId) {
      return mutateLineage('/api/selection', { assetId, rootAssetId: snapshot.root_asset_id, mode: 'remove', confirmWrite: true }, `Removed ${assetId} from next variation`);
    }
    if (selectedNodes.length > 0) return mutateLineage('/api/selection', { rootAssetId: snapshot.root_asset_id, clear: true, confirmWrite: true }, 'Removed all assets from next variation');
  }
  const closePanel = useCallback(() => {
    const returnFocus = panelReturnFocusRef.current;
    setPanelMode(null);
    panelReturnFocusRef.current = null;
    window.requestAnimationFrame(() => returnFocus?.focus());
  }, []);
  function dismissSettingsHint() {
    setSettingsHintVisible(false);
    writeCanvasSettingsHintDismissed();
  }
  function togglePanel(mode: 'settings' | 'queue' | 'asset') {
    if (mode === 'settings') dismissSettingsHint();
    const invokingControl = document.activeElement;
    if (invokingControl instanceof HTMLElement) panelReturnFocusRef.current = invokingControl;
    setPanelMode(current => {
      if (current !== mode) return mode;
      const returnFocus = panelReturnFocusRef.current;
      panelReturnFocusRef.current = null;
      window.requestAnimationFrame(() => returnFocus?.focus());
      return null;
    });
  }
  function openAssetPanel(assetId: string) {
    const invokingControl = document.activeElement;
    if (invokingControl instanceof HTMLElement) panelReturnFocusRef.current = invokingControl;
    setActiveNodeId(assetId);
    setPanelMode('asset');
  }
  async function markReview(reviewState: AssetReviewState, assetId = activeNode?.asset_id) {
    if (!assetId) return;
    const targetNode = snapshot?.nodes.find(node => node.asset_id === assetId);
    const conflict = lineageReviewConflict(targetNode, reviewState);
    if (conflict && !window.confirm(conflict.confirmation)) return;
    if (conflict) await clearNextVariation(assetId);
    void mutateLineage(`/api/reviews/${assetId}`, { reviewState, confirmWrite: true }, `Marked ${assetId} ${reviewState}`);
  }
  async function markReroll(node: LineageNode, prompt = node.reroll_request?.prompt || node.reroll_request?.notes || '') {
    if (!snapshot) return;
    return mutateLineage(`/api/lineage/${snapshot.root_asset_id}/rerolls/${node.asset_id}`, {
      confirmWrite: true,
      notes: prompt,
      requestedBy: 'human',
    }, `Marked ${node.asset_id} for re-roll`);
  }
  async function clearReroll(node: LineageNode) {
    if (!snapshot) return;
    return mutateLineage(`/api/lineage/${snapshot.root_asset_id}/rerolls/${node.asset_id}/cancel`, {
      confirmWrite: true,
    }, `Cleared re-roll request for ${node.asset_id}`);
  }
  function openVariationPrompt(node: LineageNode, mode: VariationPromptMode, branchAction?: 'add' | 'edit' | 'replace') {
    const anchorElement = [...document.querySelectorAll<HTMLElement>('.lineage-node')]
      .find(element => element.dataset.assetId === node.asset_id);
    const rect = anchorElement?.getBoundingClientRect();
    setVariationPrompt({
      anchor: rect ? { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top } : undefined,
      mode,
      nodeId: node.asset_id,
      branchAction,
      returnFocus: anchorElement || (document.activeElement instanceof HTMLElement ? document.activeElement : undefined),
    });
  }
  async function requestBranchAction(node: LineageNode, branchAction: 'add' | 'replace' = 'add') {
    if (variationTaskLocked(node, 'branch')) return;
    if (branchAction === 'add' && !node.user_selected && selectionFull) {
      onToast('error', branchLimitMessage);
      return;
    }
    if (branchPromptOnMark) {
      openVariationPrompt(node, 'branch', branchAction);
      return;
    }
    if (branchAction === 'replace') {
      await replaceNextVariation(node, node.branch_prompt || node.selection_note || '');
      return;
    }
    await selectNextBase(node, '');
  }
  async function requestRerollAction(node: LineageNode) {
    if (variationTaskLocked(node, 'reroll')) return;
    if (rerollPromptOnMark) {
      openVariationPrompt(node, 'reroll');
      return;
    }
    await markReroll(node, '');
  }
  async function toggleBranch(node: LineageNode) {
    if (variationTaskLocked(node, 'branch')) return;
    if (node.user_selected) {
      await clearNextVariation(node.asset_id);
      return;
    }
    await requestBranchAction(node, 'add');
  }
  async function toggleReroll(node: LineageNode) {
    if (variationTaskLocked(node, 'reroll')) return;
    if (node.reroll_request?.status === 'pending') {
      await clearReroll(node);
      return;
    }
    await requestRerollAction(node);
  }
  function closeVariationPrompt() {
    const returnFocus = variationPrompt?.returnFocus;
    setVariationPrompt(null);
    window.requestAnimationFrame(() => returnFocus?.focus());
  }
  async function saveQueuedVariation(node: LineageNode, mode: VariationPromptMode, prompt: string) {
    if (variationTaskLocked(node, mode)) return false;
    if (mode === 'reroll') return Boolean(await markReroll(node, prompt));
    return Boolean(await mutateLineage('/api/selection', {
      assetId: node.asset_id,
      rootAssetId: snapshot?.root_asset_id,
      mode: 'add',
      notes: prompt,
      confirmWrite: true,
    }, `Updated branch prompt for ${node.asset_id}`));
  }
  async function removeQueuedVariation(node: LineageNode, mode: VariationPromptMode) {
    if (variationTaskLocked(node, mode)) return;
    if (mode === 'reroll') await clearReroll(node);
    else await clearNextVariation(node.asset_id);
    setVariationQueuePrimary(current => current?.mode === mode && current.nodeId === node.asset_id ? null : current);
  }
  function selectQueuedVariation(selection: VariationQueueSelection) {
    setVariationQueuePrimary(selection);
    setActiveNodeId(selection.nodeId);
    onSelectedAsset(selection.nodeId);
    focusQueuedVariation(selection.nodeId);
  }
  function showQueuedVariation(node: LineageNode, mode: VariationPromptMode) {
    selectQueuedVariation({ mode, nodeId: node.asset_id });
  }
  function focusQueuedVariation(nodeId: string) {
    const target = flowApi?.getNode(nodeId);
    const canvas = document.querySelector<HTMLElement>('.lineage-canvas');
    if (!flowApi || !target || !canvas) return;

    const canvasRect = canvas.getBoundingClientRect();
    const panelRect = document.querySelector<HTMLElement>('.lineage-variation-queue')?.getBoundingClientRect();
    const targetWidth = target.measured?.width || target.width || 212;
    const targetHeight = target.measured?.height || target.height || 164;
    const targetCenter = {
      x: target.position.x + targetWidth / 2,
      y: target.position.y + targetHeight / 2,
    };
    const visibleBounds = variationQueueVisibleBounds(canvasRect, panelRect);
    const zoom = Math.min(1, Math.max(0.82, flowApi.getZoom()));

    void flowApi.setViewport({
      x: (visibleBounds.left + visibleBounds.right) / 2 - targetCenter.x * zoom,
      y: (visibleBounds.top + visibleBounds.bottom) / 2 - targetCenter.y * zoom,
      zoom,
    }, { duration: 260 });
  }
  async function submitVariationPrompt(prompt: string) {
    if (!variationPrompt || !variationPromptNode) return;
    let saved: boolean;
    if (variationPrompt.mode === 'reroll') {
      saved = Boolean(await markReroll(variationPromptNode, prompt));
    } else if (variationPrompt.branchAction === 'replace') {
      saved = Boolean(await replaceNextVariation(variationPromptNode, prompt));
    } else if (variationPrompt.branchAction === 'edit' || variationPromptNode.user_selected) {
      saved = Boolean(await mutateLineage('/api/selection', {
        assetId: variationPromptNode.asset_id,
        rootAssetId: snapshot?.root_asset_id,
        mode: 'add',
        notes: prompt,
        confirmWrite: true,
      }, `Updated branch prompt for ${variationPromptNode.asset_id}`));
    } else {
      saved = Boolean(await selectNextBase(variationPromptNode, prompt));
    }
    if (saved) closeVariationPrompt();
  }
  async function saveNextVariationLimit(limit: number) {
    if (!activeWorkspace) return;
    const normalized = Math.max(1, Math.min(12, Math.round(limit || 1)));
    const generation = ++variationLimitSaveGenerationRef.current;
    const requestedWorkspaceId = activeWorkspace.id;
    const requestedTarget: VariationLimitTarget = {
      project,
      rootAssetId: workspaceRootAssetId,
      workspaceId: requestedWorkspaceId,
    };
    const queued = serializeVariationLimitSave(variationLimitSaveQueueRef.current, async () => {
      try {
        const result = await api<{ workspace: LineageWorkspace }>(`/api/lineage-workspaces/${encodeURIComponent(requestedWorkspaceId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: requestedTarget.project, maxQueuedBranches: normalized, confirmWrite: true }),
        });
        const outcome = variationLimitSaveOutcome(generation, variationLimitSaveGenerationRef.current, requestedTarget, {
          project: currentProjectRef.current,
          rootAssetId: workspaceRootRef.current,
          workspaceId: activeWorkspaceIdRef.current,
        });
        if (!outcome.apply) return;
        setSnapshot(current => current ? { ...current, next_variation_limit: result.workspace.max_queued_branches || normalized } : current);
        await refreshWorkspaces();
        if (outcome.announce) {
          onToast('ok', `Branch queue maximum set to ${result.workspace.max_queued_branches || normalized}`);
        }
      } catch (error) {
        const outcome = variationLimitSaveOutcome(generation, variationLimitSaveGenerationRef.current, requestedTarget, {
          project: currentProjectRef.current,
          rootAssetId: workspaceRootRef.current,
          workspaceId: activeWorkspaceIdRef.current,
        });
        if (outcome.announce) {
          onToast('error', error instanceof Error ? error.message : String(error));
        }
      }
    });
    variationLimitSaveQueueRef.current = queued;
    await queued;
  }
  async function toggleSocial(node: LineageNode) {
    if (!snapshot) return;
    const active = node.social_mark?.active === true;
    const suffix = active ? '/unmark' : '';
    await mutateLineage(`/api/lineage/${snapshot.root_asset_id}/social-marks/${node.asset_id}${suffix}`, {
      actor: 'human:canvas',
      confirmWrite: true,
    }, active ? `Unmarked ${node.asset_id} from Social` : `Marked ${node.asset_id} for Social`);
  }
  function nodeElementForDiscussion(nodeId: string): HTMLElement | null {
    return Array.from(document.querySelectorAll<HTMLElement>('.lineage-node[data-asset-id]'))
      .find(element => element.dataset.assetId === nodeId) || null;
  }
  function openDiscussionDialog(node: LineageNode, mode: 'edit' | 'mark') {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const nodeElement = nodeElementForDiscussion(node.asset_id);
    const anchorElement = active?.isConnected ? active : nodeElement;
    const returnFocus = active?.isConnected && !active.closest('.lineage-context-menu') ? active : nodeElement;
    const rect = anchorElement?.getBoundingClientRect();
    setDiscussionDialog({
      anchor: rect ? { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top } : undefined,
      mode,
      nodeId: node.asset_id,
      returnFocus,
    });
  }
  function closeDiscussionDialog() {
    const returnFocus = discussionDialog?.returnFocus?.isConnected
      ? discussionDialog.returnFocus
      : discussionDialog ? nodeElementForDiscussion(discussionDialog.nodeId) : null;
    setDiscussionDialog(null);
    window.requestAnimationFrame(() => returnFocus?.focus());
  }
  async function toggleDiscussion(node: LineageNode) {
    if (!snapshot) return;
    if (node.discussion_mark?.active) {
      await mutateLineage(`/api/lineage/${encodeURIComponent(snapshot.root_asset_id)}/discussion-marks/${encodeURIComponent(node.asset_id)}/unmark`, {
        actor: 'human:canvas', confirmWrite: true,
      }, `Removed discussion flag from ${node.asset_id}`);
      return;
    }
    if (discussionNotePrompt) {
      openDiscussionDialog(node, 'mark');
      return;
    }
    await mutateLineage(`/api/lineage/${encodeURIComponent(snapshot.root_asset_id)}/discussion-marks/${encodeURIComponent(node.asset_id)}`, {
      actor: 'human:canvas', confirmWrite: true,
    }, `Flagged ${node.asset_id} for discussion`);
  }
  async function saveDiscussionNote(note: string) {
    if (!snapshot || !discussionDialog || !discussionDialogNode) return;
    const suffix = discussionDialog.mode === 'edit' ? '/note' : '';
    const saved = await mutateLineage(`/api/lineage/${encodeURIComponent(snapshot.root_asset_id)}/discussion-marks/${encodeURIComponent(discussionDialogNode.asset_id)}${suffix}`, {
      actor: 'human:canvas', confirmWrite: true, notes: note,
    }, discussionDialog.mode === 'edit' ? `Updated discussion note for ${discussionDialogNode.asset_id}` : `Flagged ${discussionDialogNode.asset_id} for discussion`);
    if (saved) closeDiscussionDialog();
  }
  async function openAttemptHistory(assetId: string) {
    if (!snapshot) return;
    try {
      const params = new URLSearchParams({ project });
      const result = await api<LineageAttemptsResponse>(`/api/lineage/${snapshot.root_asset_id}/attempts/${assetId}?${params.toString()}`);
      setHistoryAttempts(result.attempts);
      setHistoryNodeId(assetId);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  function closeAttemptHistory() {
    setHistoryNodeId(null);
    setHistoryAttempts([]);
  }
  function openDetailFromHistory(assetId: string) {
    closeAttemptHistory();
    setDetailNodeId(assetId);
  }
  async function promoteAttempt(attempt: LineageAttempt) {
    if (!snapshot || !historyNodeId) return;
    try {
      const result = await api<LineageAttemptPromotionResponse>(`/api/lineage/${snapshot.root_asset_id}/attempts/${historyNodeId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, attemptId: attempt.id, confirmWrite: true }),
      });
      setHistoryAttempts(result.attempts);
      onToast('ok', `Set v${attempt.attempt_index} as current`);
      await refresh({ quiet: true });
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  async function linkChild() {
    if (!activeNode || !childAssetId.trim()) return;
    await mutateLineage('/api/lineage/link', {
      childAssetId: childAssetId.trim(),
      confirmWrite: true,
      parentAssetId: activeNode.asset_id,
    }, `Linked ${childAssetId.trim()} from ${activeNode.asset_id}`);
    setChildAssetId('');
  }
  async function updateEdgeSummary(action: EdgeSummaryEditAction, summary?: string) {
    if (!editingEdge) return;
    try {
      const result = await api<LineageEdgeSummaryMutationResponse>(`/api/lineage/edges/${encodeURIComponent(editingEdge.id)}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          confirmWrite: true,
          expectedSummaryUpdatedAt: editingEdge.summary_updated_at || null,
          project,
          ...(action === 'set' ? { summary } : {}),
        }),
      });
      await refresh({ quiet: true });
      onToast('ok', result.message);
      setEdgeEditor(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.message.includes('Edge summary changed since it was opened')) {
        await refresh({ quiet: true });
        throw new Error('This edge changed elsewhere. The current label has been reloaded; review it and retry.', { cause: error });
      }
      throw error;
    }
  }
  async function removeNodeFromLineage(node: LineageNode) {
    if (!snapshot) return;
    if (node.asset_id === snapshot.root_asset_id) {
      onToast('error', 'Root lineage node cannot be removed. Archive this workspace or start a new lineage instead.');
      return;
    }
    const childCount = snapshot.edges.filter(edge => edge.parent_asset_id === node.asset_id).length;
    const parentCount = snapshot.edges.filter(edge => edge.child_asset_id === node.asset_id).length;
    const reparentCopy = childCount > 0 && parentCount > 0
      ? ` Its ${childCount} child${childCount === 1 ? '' : 'ren'} will be reconnected to its parent${parentCount === 1 ? '' : 's'}.`
      : '';
    if (!window.confirm(`Remove "${node.title}" from this lineage? This keeps the asset file and S3 object intact.${reparentCopy}`)) return;
    await mutateLineage('/api/lineage/remove-node', {
      assetId: node.asset_id,
      rootAssetId: snapshot.root_asset_id,
      confirmWrite: true,
    }, `Removed ${node.asset_id} from lineage`);
    setNodeMenu(null);
    setDetailNodeId(current => current === node.asset_id ? null : current);
    setActiveNodeId(current => current === node.asset_id ? snapshot.root_asset_id : current);
  }
  async function saveNodePosition(node: AssetFlowNode) {
    if (!snapshot) return;
    try {
      await saveLineagePositions(project, snapshot.root_asset_id, [{ assetId: node.id, x: node.position.x, y: node.position.y }]);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  async function tidyGraph() {
    if (!snapshot) return;
    const positions = [...layoutLineageTree(snapshot, graphDirection, canvasPresentation)].map(([assetId, position]) => ({ assetId, ...position }));
    setFlowNodes(current => current.map(node => ({
      ...node,
      position: positions.find(position => position.assetId === node.id) || node.position,
    })));
    if (canvasPresentation === 'portrait') {
      onToast('ok', `Tidied ${positions.length} portrait cards without changing compact positions`);
      fitGraph(80);
      return;
    }
    applySnapshotPositions(positions);
    try {
      await saveLineagePositions(project, snapshot.root_asset_id, positions);
      onToast('ok', `Tidied ${positions.length} lineage nodes`);
      fitGraph(80);
      await refresh({ quiet: true });
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  async function orientGraph(direction: LineageGraphDirection) {
    if (!snapshot) return;
    const positions = [...layoutLineageTree(snapshot, direction, canvasPresentation)].map(([assetId, position]) => ({ assetId, ...position }));
    setFlowApi(null);
    if (canvasPresentation === 'portrait') setPortraitGraphDirection(direction);
    else setCompactGraphDirection(direction);
    if (!writeLineageGraphDirection(canvasPresentation, direction)) {
      onToast('error', 'Direction changed for this session, but browser storage is unavailable so it could not be saved');
    }
    setFlowNodes(current => current.map(node => ({
      ...node,
      position: positions.find(position => position.assetId === node.id) || node.position,
    })));
    if (canvasPresentation === 'portrait') {
      onToast('ok', `Rotated portrait cards ${graphDirectionLabel(direction).toLowerCase()} without changing compact positions`);
      return;
    }
    applySnapshotPositions(positions);
    try {
      await saveLineagePositions(project, snapshot.root_asset_id, positions);
      onToast('ok', `Rotated lineage graph ${graphDirectionLabel(direction).toLowerCase()}`);
      await refresh({ quiet: true });
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  function applySnapshotPositions(positions: Array<{ assetId: string; x: number; y: number }>) {
    const positionMap = new Map(positions.map(position => [position.assetId, { x: position.x, y: position.y }]));
    setSnapshot(current => current ? {
      ...current,
      nodes: current.nodes.map(node => ({
        ...node,
        position: positionMap.get(node.asset_id) || node.position,
      })),
    } : current);
  }
  function selectCanvasPresentation(presentation: LineageCanvasPresentation) {
    setFlowApi(null);
    setCanvasPresentation(presentation);
    if (!writeLineageCanvasPresentation(presentation)) {
      onToast('error', 'Card style changed for this session, but browser storage is unavailable so it could not be saved');
    }
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (presentation === 'portrait') url.searchParams.set('lineageCanvas', 'portrait');
      else url.searchParams.delete('lineageCanvas');
      window.history.replaceState(window.history.state, '', url);
    }
  }
  function selectEdgeWeight(weight: LineageEdgeWeight) {
    setEdgeWeight(weight);
    if (!writeLineageEdgeWeight(weight)) {
      onToast('error', 'Edge weight changed for this session, but browser storage is unavailable so it could not be saved');
    }
  }
  function selectHoverPreviews(enabled: boolean) {
    setHoverPreviewsEnabled(enabled);
    if (!writeHoverPreviewsEnabled(enabled)) {
      onToast('error', 'Hover previews changed for this session, but browser storage is unavailable so the preference could not be saved');
    }
  }
  function selectVariationPromptAutoEdit(enabled: boolean) {
    setVariationPromptAutoEdit(enabled);
    if (!writeVariationPromptAutoEdit(enabled)) {
      onToast('error', 'Variation prompt behavior changed for this session, but browser storage is unavailable so the preference could not be saved');
    }
  }
  function selectBranchPromptOnMark(enabled: boolean) {
    setBranchPromptOnMark(enabled);
    if (!writeBranchPromptOnMark(enabled)) {
      onToast('error', 'Branch prompt behavior changed for this session, but browser storage is unavailable so the preference could not be saved');
    }
  }
  function selectRerollPromptOnMark(enabled: boolean) {
    setRerollPromptOnMark(enabled);
    if (!writeRerollPromptOnMark(enabled)) {
      onToast('error', 'Re-roll prompt behavior changed for this session, but browser storage is unavailable so the preference could not be saved');
    }
  }
  function selectDiscussionNotePrompt(enabled: boolean) {
    setDiscussionNotePrompt(enabled);
    if (!writeDiscussionNotePrompt(enabled)) {
      onToast('error', 'Discussion note behavior changed for this session, but browser storage is unavailable so the preference could not be saved');
    }
  }
  function selectPreviewAction(action: LineagePreviewAction, enabled: boolean) {
    const next = { ...previewActions, [action]: enabled };
    setPreviewActions(next);
    if (!writeLineagePreviewActions(next)) {
      onToast('error', 'Preview actions changed for this session, but browser storage is unavailable so the preference could not be saved');
    }
  }
  function selectEdgeSummariesVisible(visible: boolean) {
    setEdgeSummariesVisible(visible);
    if (!writeLineageEdgeLabelsVisible(visible)) {
      onToast('error', 'Edge labels changed for this session, but browser storage is unavailable so the preference could not be saved');
    }
  }
  function selectMinimapVisible(visible: boolean) {
    setMinimapVisible(visible);
    if (!writeLineageMinimapVisible(visible)) {
      onToast('error', 'Minimap visibility changed for this session, but browser storage is unavailable so the preference could not be saved');
    }
  }
  function resetAppearance() {
    setCanvasPresentation('compact');
    setCompactGraphDirection('LR');
    setPortraitGraphDirection('LR');
    setEdgeWeight('standard');
    setEdgeSummariesVisible(true);
    setHoverPreviewsEnabled(true);
    setMinimapVisible(true);
    setVariationPromptAutoEdit(true);
    setBranchPromptOnMark(true);
    setRerollPromptOnMark(true);
    setDiscussionNotePrompt(false);
    setPreviewActions({ ...lineagePreviewActionDefaults });
    setFlowApi(null);
    if (!resetLineageAppearancePreferences()) {
      onToast('error', 'Appearance reset for this session, but browser storage is unavailable so the defaults could not be saved');
    } else {
      onToast('ok', 'Canvas appearance reset');
    }
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('lineageCanvas');
      window.history.replaceState(window.history.state, '', url);
    }
  }
  async function refreshBrief() {
    if (!snapshot) return;
    try {
      const params = new URLSearchParams({ project });
      setBrief(await api<LineageBriefResponse>(`/api/lineage/${snapshot.root_asset_id}/brief?${params.toString()}`));
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  async function controlClaim(action: 'release-stale' | 'revoke' | 'transfer', claim: AgentClaimSummary, body: { confirmWrite: true; reason?: string; toAgentName?: string }) {
    try {
      await api(`/api/agent-claims/${claim.id}/${action}`, {
        body: JSON.stringify({ project, ...body }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      onToast('ok', `Updated claim ${claim.id}`);
      await refresh({ quiet: true });
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }
  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!workspaceRootAssetId) resetLineage();
  }, [resetLineage, workspaceRootAssetId]);

  useEffect(() => {
    if (!snapshot) return undefined;
    const timer = window.setInterval(() => void refresh({ quiet: true }), 8000);
    return () => window.clearInterval(timer);
  }, [refresh, snapshot?.root_asset_id]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return undefined;
    const update = () => setReduceReplayMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (!replaySnapshot || !replayPlaying || replayLastStage < 0) return undefined;
    const nextStageIndex = Math.min(replayStageIndex + 1, replayLastStage);
    if (replayPhase === 'settled' && replayStageIndex >= replayLastStage) {
      setReplayPlaying(false);
      return undefined;
    }

    const nextStage = replayTimeline.stages[nextStageIndex];
    const reducedDelay = reduceReplayMotion ? 40 : undefined;
    let delay = reducedDelay ?? 120 / replaySpeed;
    let advance = () => {
      const nextPhase = nextStage.enteringEdgeIds.length > 0 ? 'edge' : 'node';
      setReplayPhase(nextPhase);
    };

    if (replayPhase === 'edge') {
      delay = reducedDelay ?? 320 / replaySpeed;
      advance = () => {
        if (nextStage.enteringNodeIds.length > 0) setReplayPhase('node');
        else {
          setReplayStageIndex(nextStageIndex);
          setReplayPhase('settled');
        }
      };
    } else if (replayPhase === 'node') {
      delay = reducedDelay ?? 200 / replaySpeed;
      advance = () => {
        setReplayStageIndex(nextStageIndex);
        setReplayPhase('settled');
      };
    }

    const timer = window.setTimeout(advance, delay);
    return () => window.clearTimeout(timer);
  }, [reduceReplayMotion, replayLastStage, replayPhase, replayPlaying, replaySnapshot, replaySpeed, replayStageIndex, replayTimeline.stages]);

  const baseGraph = useMemo(
    () => toGraph(graphSnapshot, panelMode === 'queue' ? null : activeNodeId, graphDirection, edgeSummariesVisible, canvasPresentation, effectiveCollapsedNodeIds),
    [activeNodeId, canvasPresentation, edgeSummariesVisible, effectiveCollapsedNodeIds, graphDirection, graphSnapshot, panelMode],
  );
  const graph = useMemo(() => replaySnapshot && !replayAtEnd
    ? projectLineageReplay(baseGraph.nodes, baseGraph.edges, replayTimeline, replayStageIndex, replayPhase)
    : baseGraph,
  [baseGraph, replayAtEnd, replayPhase, replaySnapshot, replayStageIndex, replayTimeline]);
  const queueDecoratedGraph = useMemo(() => {
    if (panelMode !== 'queue' || !graphSnapshot) return graph;
    const related = new Set(variationQueueNodeIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of graphSnapshot.edges) {
        if (related.has(edge.child_asset_id) && !related.has(edge.parent_asset_id)) {
          related.add(edge.parent_asset_id);
          changed = true;
        }
      }
    }
    return {
      nodes: graph.nodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          variationQueueState: (variationQueueNodeIds.has(node.id)
            ? (variationQueuePrimary?.nodeId === node.id ? 'primary' : 'queued')
            : (related.has(node.id) ? 'ancestor' : undefined)) as AssetFlowNode['data']['variationQueueState'],
        },
      })),
      edges: graph.edges.map(edge => related.has(edge.source) && related.has(edge.target) ? {
        ...edge,
        className: [edge.className, 'lineage-edge-variation-related'].filter(Boolean).join(' '),
      } : edge),
    };
  }, [graph, graphSnapshot, panelMode, variationQueueNodeIds, variationQueuePrimary?.nodeId]);
  const renderedGraph = useMemo(() => {
    if (!branchMotion) return queueDecoratedGraph;
    const motionClass = `lineage-edge-branch-${branchMotion.phase}`;
    return {
      nodes: queueDecoratedGraph.nodes.map(node => {
        const offset = branchMotion.nodeOffsets.get(node.id);
        if (!offset) return node;
        return {
          ...node,
          data: {
            ...node.data,
            branchTransition: branchMotion.phase,
            branchTransitionOffset: offset,
          },
        };
      }),
      edges: queueDecoratedGraph.edges.map(edge => branchMotion.edgeIds.has(edge.id) ? {
        ...edge,
        className: [edge.className, motionClass].filter(Boolean).join(' '),
      } : edge),
    };
  }, [branchMotion, queueDecoratedGraph]);
  const graphKey = useMemo(
    () => lineageGraphKey(graphSnapshot, graphDirection, canvasPresentation),
    [canvasPresentation, graphDirection, graphSnapshot],
  );
  authoritativeEdges.current = renderedGraph.edges;

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    setFlowEdges(current => reconcileAuthoritativeEdgeChanges(changes, current, authoritativeEdges.current));
  }, [setFlowEdges]);
  const handleCanvasKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (event.target instanceof HTMLElement && event.target.closest('.lineage-variation-editor')) return;
      closeTransientMenus();
      if (panelMode) closePanel();
    }
  }, [closePanel, closeTransientMenus, panelMode]);

  useEffect(() => {
    function toggleVariationQueue(event: globalThis.KeyboardEvent) {
      if (event.key.toLowerCase() !== 'v' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="dialog"]')) return;
      const intentionalQueueTarget = target?.closest(
        '.lineage-node[data-asset-id], .lineage-variation-queue, .lineage-variation-queue-launch',
      );
      const unrelatedInteractiveTarget = target?.closest(
        'button, a[href], summary, [role="button"], [role="link"], [role="switch"], [role^="menuitem"], [tabindex]:not([tabindex="-1"])',
      );
      if (unrelatedInteractiveTarget && !intentionalQueueTarget) return;
      event.preventDefault();
      event.stopPropagation();
      const invokingControl = document.activeElement;
      setPanelMode(current => {
        if (current !== 'queue') {
          if (invokingControl instanceof HTMLElement) panelReturnFocusRef.current = invokingControl;
          return 'queue';
        }
        const returnFocus = panelReturnFocusRef.current;
        panelReturnFocusRef.current = null;
        window.requestAnimationFrame(() => returnFocus?.focus());
        return null;
      });
    }
    document.addEventListener('keydown', toggleVariationQueue, true);
    return () => document.removeEventListener('keydown', toggleVariationQueue, true);
  }, []);

  useEffect(() => {
    setSelectionNote(activeNode?.selection_note || '');
  }, [activeNode?.asset_id, activeNode?.selection_note]);

  useEffect(() => {
    const resetPositions = renderedGraphKey.current !== graphKey;
    renderedGraphKey.current = graphKey;
    setFlowNodes(current => renderedGraph.nodes.map(node => ({
      ...node,
      position: resetPositions ? node.position : current.find(existing => existing.id === node.id)?.position || node.position,
    })));
    setFlowEdges(renderedGraph.edges);
  }, [graphKey, renderedGraph.edges, renderedGraph.nodes, setFlowEdges, setFlowNodes]);

  useEffect(() => {
    if (workspaceProgress !== 'indexing' || !indexingRefreshStarted.current || !snapshot?.nodes.length) return;
    if (renderedGraphKey.current !== graphKey || flowNodes.length !== renderedGraph.nodes.length) return;
    indexingRefreshStarted.current = false;
    setWorkspaceProgress('ready');
  }, [flowNodes.length, graphKey, renderedGraph.nodes.length, snapshot, workspaceProgress]);

  useEscapeClear(Boolean(activeNodeId), clearFocus);

  useEffect(() => {
    resetLineage();
    setWorkspaceProgress(null);
  }, [project, resetLineage, workspaceId]);

  useEffect(() => {
    if (!newWorkspaceRequest) return;
    setExternalNewWorkspaceOpen(true);
    setNewLineageOpen(true);
  }, [newWorkspaceRequest]);

  useEffect(() => {
    setCanvasToolsHost(document.getElementById('canvas-context-tools'));
  }, []);

  return (
    <section className="lineage-view" onKeyDownCapture={handleCanvasKeyDown}>
      {canvasToolsHost && createPortal(
        <LineageToolbar
          activeWorkspace={activeWorkspace}
          closeSignal={menuCloseSignal}
          loading={loading}
          demoSeedStatus={demoSeedStatus}
          onIndexLocal={() => void indexAndRefresh()}
          onOpenGeneration={() => setGenerationOpen(true)}
          onOpenOutputDefaults={() => setOutputDefaultsOpen(true)}
          onRefreshLineage={() => void refresh()}
          onRefreshWorkspaces={() => void refreshWorkspaces()}
          onReplayGrowth={startReplay}
          onRestoreDemoMedia={() => void restoreDemoSeedMedia()}
          onRestoreSwissifierMedia={() => void restoreSwissifierDemoMedia()}
          onDownloadSwissifierMedia={() => void downloadSwissifierAndTrack()}
          onSeedDemo={() => void seedDemoAndRefreshAssets()}
          onSeedSwissifierDemo={() => void seedSwissifierAndRefreshAssets()}
          onToggleNextPanel={() => togglePanel('queue')}
          replayActive={Boolean(replaySnapshot)}
          sideOpen={panelMode === 'queue'}
          snapshot={snapshot}
          swissifierDemoStatus={swissifierDemoStatus}
          workspaceLoading={workspaceLoading}
          workspaceProgress={workspaceProgress}
          workspaceRootAssetId={workspaceRootAssetId}
          variationQueueCount={variationQueueCount}
        />,
        canvasToolsHost,
      )}
      <div
        className={`lineage-workbench ${settingsHintVisible ? 'settings-hint-visible' : ''}`}
        data-testid="lineage-workbench"
      >
        {activeWorkspace && (
          <nav aria-label="Canvas location" className="lineage-workspace-identity">
            <button
              aria-label={`Back to workspaces from ${activeWorkspace.title}`}
              className="lineage-workspace-exit"
              onClick={onExitWorkspace}
              type="button"
            >
              <span aria-hidden="true" className="lineage-workspace-exit-icon"><ArrowLeft size={16} /></span>
              <span className="lineage-workspace-exit-copy">
                <small>Back to</small>
                <strong>Workspaces</strong>
              </span>
            </button>
            <span aria-hidden="true" className="lineage-workspace-divider" />
            <span className="lineage-workspace-title">
              <small>Current canvas</small>
              <strong>{activeWorkspace.title}</strong>
            </span>
          </nav>
        )}
        <div
          className={`lineage-canvas lineage-canvas-${canvasPresentation} lineage-edges-${edgeWeight} ${activeNodeId && panelMode !== 'queue' ? 'focus-active' : ''} ${panelMode === 'queue' ? 'variation-queue-active' : ''} ${branchMotion ? `lineage-branch-motion lineage-branch-motion-${branchMotion.phase}` : ''} ${replaySnapshot ? 'lineage-replay-active' : ''} ${replayAtEnd ? 'lineage-replay-interactive' : ''} ${replaySnapshot && !replayPlaying ? 'lineage-replay-paused' : ''}`}
          data-lineage-canvas-presentation={canvasPresentation}
          data-lineage-edge-weight={edgeWeight}
          style={replaySnapshot ? {
            '--lineage-replay-edge-duration': `${reduceReplayMotion ? 1 : 320 / replaySpeed}ms`,
            '--lineage-replay-node-duration': `${reduceReplayMotion ? 1 : 200 / replaySpeed}ms`,
          } as CSSProperties : undefined}
        >
          {replaySnapshot && replayTimeline.stages.length > 0 && (
            <LineageReplayControls
              atEnd={replayAtEnd}
              onClose={returnToLive}
              onPlayPause={toggleReplay}
              onRestart={restartReplay}
              onScrub={scrubReplay}
              onSpeed={setReplaySpeed}
              playing={replayPlaying}
              speed={replaySpeed}
              stageIndex={replayStageIndex}
              totalStages={replayTimeline.stages.length}
            />
          )}
          <LineageCanvas
            canvasPresentation={canvasPresentation}
            collapseInteractive={!replaySnapshot && !branchMotion}
            flowEdges={graphSnapshot ? flowEdges : []}
            flowNodes={graphSnapshot ? flowNodes : []}
            graphKey={graphKey}
            hoverPreviewsEnabled={canvasHoverPreviewsEnabled}
            loading={loading}
            minimapVisible={minimapVisible}
            onBrowseWorkspaces={onExitWorkspace}
            onEdgesChange={handleEdgesChange}
            onEdgeEdit={(edgeId, returnFocus) => setEdgeEditor({ edgeId, returnFocus })}
            onClearFocus={clearFocus}
            onIndexNow={() => void indexAndRefresh()}
            onSeedDemo={() => void seedDemoAndRefreshAssets()}
            onNodeActionMenu={(assetId, x, y) => setNodeMenu(assetId ? { assetId, x, y } : null)}
            onNodeInspect={assetId => { closeTransientMenus(); setActiveNodeId(assetId); }}
            onNodeOpenDetail={openAssetPanel}
            onNodeOpenHistory={assetId => void openAttemptHistory(assetId)}
            onNodePosition={node => {
              if (canvasPresentation === 'compact') void saveNodePosition(node);
            }}
            onBranchLimitReached={() => onToast('error', branchLimitMessage)}
            onEditDiscussionNote={node => openDiscussionDialog(node, 'edit')}
            onEditVariationPrompt={(node, mode) => openVariationPrompt(node, mode, mode === 'branch' ? 'edit' : undefined)}
            onToggleCollapse={toggleCollapsedBranch}
            onNodesChange={onNodesChange}
            onReady={setFlowApi}
            onSelectedAsset={onSelectedAsset}
            onToggleBranch={toggleBranch}
            onToggleReroll={toggleReroll}
            onToggleDiscussion={toggleDiscussion}
            onToggleSocial={toggleSocial}
            onViewportInteraction={markViewportInteraction}
            replayInteractive={!replaySnapshot || replayAtEnd}
            selectedCount={selectedNodes.length}
            selectionLimit={nextVariationLimit}
            selectionFull={selectionFull}
            visibleActions={previewActions}
            workspaceProgress={workspaceProgress}
            workspaceRootAssetId={workspaceRootAssetId}
          />
          <button
            aria-controls="lineage-canvas-panel"
            aria-describedby={settingsHintVisible ? 'lineage-canvas-settings-hint-copy' : undefined}
            aria-expanded={panelMode === 'settings'}
            aria-label="Open Canvas settings"
            className="lineage-canvas-settings-trigger"
            onClick={() => togglePanel('settings')}
            title="Canvas settings"
            type="button"
          >
            <span aria-hidden="true">⚙</span>
          </button>
          {settingsHintVisible && !panelMode && (
            <div aria-label="Canvas settings tip" className="lineage-canvas-settings-hint" role="note">
              <span aria-hidden="true" className="lineage-canvas-settings-hint-icon">✦</span>
              <span id="lineage-canvas-settings-hint-copy">
                <strong>Customize your canvas</strong>
                <small>Shape cards, layout, connections, and view aids.</small>
              </span>
              <button aria-label="Dismiss Canvas settings hint" onClick={dismissSettingsHint} type="button">×</button>
            </div>
          )}
        </div>
        {panelMode && (
          <button
            aria-label="Close Canvas panel"
            className="lineage-panel-backdrop"
            onClick={closePanel}
            type="button"
          />
        )}
        {panelMode === 'settings' && (
          <aside aria-label="Canvas settings" className="lineage-side lineage-canvas-settings-panel" id="lineage-canvas-panel">
            <div className="lineage-side-head lineage-canvas-settings-head">
              <span aria-hidden="true" className="lineage-settings-sheet-handle" />
              <div>
                <h3>Canvas settings</h3>
                <p className="muted-copy">Appearance stays in this browser; workflow settings follow this workspace.</p>
              </div>
              <button autoFocus aria-label="Close Canvas settings" className="icon-button" onClick={closePanel} type="button">×</button>
            </div>
            <LineageCanvasAppearanceControls
              canvasPresentation={canvasPresentation}
              edgeSummariesVisible={edgeSummariesVisible}
              edgeWeight={edgeWeight}
              graphDirection={graphDirection}
              hoverPreviewsEnabled={hoverPreviewsEnabled}
              loading={loading}
              minimapVisible={minimapVisible}
              nextVariationLimit={nextVariationLimit}
              variationPromptAutoEdit={variationPromptAutoEdit}
              branchPromptOnMark={branchPromptOnMark}
              rerollPromptOnMark={rerollPromptOnMark}
              discussionNotePrompt={discussionNotePrompt}
              previewActions={previewActions}
              onCanvasPresentation={selectCanvasPresentation}
              onEdgeSummariesVisible={selectEdgeSummariesVisible}
              onEdgeWeight={selectEdgeWeight}
              onFitGraph={() => fitGraph()}
              onGraphDirection={direction => void orientGraph(direction)}
              onHoverPreviewsEnabled={selectHoverPreviews}
              onMinimapVisible={selectMinimapVisible}
              onNextVariationLimit={limit => void saveNextVariationLimit(limit)}
              onVariationPromptAutoEdit={selectVariationPromptAutoEdit}
              onBranchPromptOnMark={selectBranchPromptOnMark}
              onRerollPromptOnMark={selectRerollPromptOnMark}
              onDiscussionNotePrompt={selectDiscussionNotePrompt}
              onPreviewAction={selectPreviewAction}
              onResetAppearance={resetAppearance}
              onTidyGraph={() => void tidyGraph()}
              snapshotAvailable={Boolean(snapshot)}
            />
          </aside>
        )}
        {panelMode === 'queue' && snapshot && (
          <LineageVariationQueuePanel
            autoEdit={variationPromptAutoEdit}
            branchNodes={selectedNodes}
            closePanel={closePanel}
            onRemove={removeQueuedVariation}
            onSave={saveQueuedVariation}
            onSelect={selectQueuedVariation}
            onShow={showQueuedVariation}
            primary={variationQueuePrimary}
            rerollNodes={rerollNodes}
          />
        )}
        {panelMode === 'asset' && snapshot && (
          <LineageSidePanel
            activeNode={activeNode}
            brief={brief}
            childAssetId={childAssetId}
            clearNextVariation={async assetId => { await clearNextVariation(assetId); }}
            closePanel={closePanel}
            latestNodes={latestNodes}
            linkChild={linkChild}
            editVariationPrompt={(node, mode, branchAction) => {
              if (mode === 'branch' && branchAction !== 'edit') {
                void requestBranchAction(node, branchAction || 'add');
                return;
              }
              openVariationPrompt(node, mode, branchAction);
            }}
            markReview={markReview}
            nextVariationLimit={nextVariationLimit}
            noteDirty={noteDirty}
            onSelectedAsset={onSelectedAsset}
            onToast={onToast}
            project={project}
            refreshBrief={refreshBrief}
            refreshLineage={async () => { await refresh({ quiet: true }); }}
            saveRationale={saveRationale}
            selectedNode={selectedNode}
            selectedNodes={selectedNodes}
            selectionFull={selectionFull}
            selectionNote={selectionNote}
            setActiveNodeId={setActiveNodeId}
            setChildAssetId={setChildAssetId}
            setDetailNodeId={assetId => {
              setPanelMode(null);
              setDetailNodeId(assetId);
            }}
            setSelectionNote={setSelectionNote}
            mode="asset"
            sideOpen
            snapshot={snapshot}
          />
        )}
        {nodeMenu && menuNode && snapshot && <LineageContextMenu canRemoveFromLineage={menuNode.asset_id !== snapshot.root_asset_id} claims={lineageWorkspaceClaims(claims, project, snapshot.root_asset_id)} node={menuNode} onClaimControl={(action, claim, body) => { void controlClaim(action, claim, body); }} onClearAllNext={() => void clearNextVariation()} onClearNext={() => void clearNextVariation(menuNode.asset_id)} onClearReroll={() => void clearReroll(menuNode)} onClose={() => setNodeMenu(null)} onEditDiscussionNote={() => openDiscussionDialog(menuNode, 'edit')} onEditOutputTargets={() => setTargetNodeId(menuNode.asset_id)} onMarkReroll={() => void requestRerollAction(menuNode)} onOpenDetail={() => openAssetPanel(menuNode.asset_id)} onRemoveFromLineage={() => void removeNodeFromLineage(menuNode)} onReplaceNext={() => void requestBranchAction(menuNode, 'replace')} onReview={reviewState => void markReview(reviewState, menuNode.asset_id)} onSelectNext={() => void requestBranchAction(menuNode, 'add')} onToggleDiscussion={() => void toggleDiscussion(menuNode)} onToggleSocial={() => void toggleSocial(menuNode)} position={nodeMenu} selectedCount={selectedNodes.length} selectionFull={selectionFull} />}
      </div>
      {historyNode && snapshot && (
        <LineageAttemptHistoryModal
          actions={{
            canRemoveFromLineage: historyNode.asset_id !== snapshot.root_asset_id,
            onClearAllNext: () => void clearNextVariation(),
            onClearNext: () => void clearNextVariation(historyNode.asset_id),
            onEdit: editorEligibleNodeIds.has(historyNode.asset_id) ? node => { closeAttemptHistory(); setEditorNodeId(node.asset_id); } : undefined,
            onOpenNode: openDetailFromHistory,
            onRemoveFromLineage: node => void removeNodeFromLineage(node),
            onReplaceNext: node => void requestBranchAction(node, 'replace'),
            onReview: markReview,
            onSelectNext: node => void requestBranchAction(node, 'add'),
            onToast,
            selectedCount: selectedNodes.length,
            selectionFull,
            snapshot,
          }}
          attempts={historyAttempts}
          node={historyNode}
          onClose={closeAttemptHistory}
          onPromoteAttempt={promoteAttempt}
          project={project}
        />
      )}
      {detailNode && snapshot && <LineageDetailModal canRemoveFromLineage={detailNode.asset_id !== snapshot.root_asset_id} node={detailNode} onClearAllNext={() => void clearNextVariation()} onClearNext={() => void clearNextVariation(detailNode.asset_id)} onClose={() => setDetailNodeId(null)} onEditNode={editorEligibleNodeIds.has(detailNode.asset_id) ? node => { setDetailNodeId(null); setEditorNodeId(node.asset_id); } : undefined} onEditOutputTargets={() => setTargetNodeId(detailNode.asset_id)} onOpenNode={setDetailNodeId} onRemoveFromLineage={node => void removeNodeFromLineage(node)} onReplaceNext={node => void requestBranchAction(node, 'replace')} onReview={markReview} onSelectNext={node => void requestBranchAction(node, 'add')} onToast={onToast} selectedCount={selectedNodes.length} selectionFull={selectionFull} snapshot={snapshot} />}
      {editorNodeId && snapshot && snapshot.nodes.find(node => node.asset_id === editorNodeId) && <NodeEditorSessionDialog node={snapshot.nodes.find(node => node.asset_id === editorNodeId)!} project={project} rootAssetId={snapshot.root_asset_id} onClose={() => setEditorNodeId(null)} onAccepted={async () => { await refresh({ quiet: true }); if (historyNodeId === editorNodeId) await openAttemptHistory(editorNodeId); }} />}
      {targetNode && snapshot && (
        <NodeNextOutputTargetsEditor
          nodeAssetId={targetNode.asset_id}
          nodeTitle={targetNode.title}
          onClose={() => setTargetNodeId(null)}
          onSaved={() => { void refreshNodeTargets(snapshot); }}
          project={project}
          rootAssetId={snapshot.root_asset_id}
        />
      )}
      {discussionDialog && discussionDialogNode && (
        <LineageDiscussionNoteDialog
          anchor={discussionDialog.anchor}
          mode={discussionDialog.mode}
          node={discussionDialogNode}
          onCancel={closeDiscussionDialog}
          onSave={saveDiscussionNote}
        />
      )}
      {generationOpen && snapshot && (
        <LineageGenerationSheet
          onClose={() => setGenerationOpen(false)}
          onPlanned={job => { setGenerationJobs(current => [job, ...current.filter(item => item.id !== job.id)]); onToast('ok', `Planned ${job.expected_output_count} exact outputs`); }}
          project={project}
          rootAssetId={snapshot.root_asset_id}
          sources={selectedNodes}
        />
      )}
      {outputDefaultsOpen && snapshot && <OutputTargetPreferencesDialog onClose={() => setOutputDefaultsOpen(false)} onSaved={() => { void refreshNodeTargets(snapshot); }} project={project} rootAssetId={snapshot.root_asset_id} />}
      {editingEdge && edgeEditor && snapshot && (
        <LineageEdgeSummaryDialog
          childTitle={snapshot.nodes.find(node => node.asset_id === editingEdge.child_asset_id)?.title || editingEdge.child_asset_id}
          edge={editingEdge}
          onClose={() => setEdgeEditor(null)}
          onSubmit={updateEdgeSummary}
          parentTitle={snapshot.nodes.find(node => node.asset_id === editingEdge.parent_asset_id)?.title || editingEdge.parent_asset_id}
          returnFocus={edgeEditor.returnFocus}
        />
      )}
      {variationPrompt && variationPromptNode && (
        <LineageVariationPromptDialog
          anchor={variationPrompt.anchor}
          initialPrompt={variationPrompt.mode === 'branch'
            ? variationPromptNode.branch_prompt || variationPromptNode.selection_note || ''
            : variationPromptNode.reroll_request?.prompt || variationPromptNode.reroll_request?.notes || ''}
          mode={variationPrompt.mode}
          node={variationPromptNode}
          onClose={closeVariationPrompt}
          onSubmit={submitVariationPrompt}
        />
      )}
      <LineageNewWorkspaceModal
        onClose={() => {
          setNewLineageOpen(false);
          if (externalNewWorkspaceOpen) {
            setExternalNewWorkspaceOpen(false);
            onNewWorkspaceCancelled();
          }
        }}
        onCreated={workspace => {
          setExternalNewWorkspaceOpen(false);
          setNewLineageOpen(false);
          handleWorkspaceCreated(workspace);
        }}
        onToast={onToast}
        open={newLineageOpen}
        project={project}
      />
    </section>
  );
}

function setDifference(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  return new Set([...left].filter(value => !right.has(value)));
}

function branchMotionOffsets(
  nodes: readonly AssetFlowNode[],
  sourceNode: AssetFlowNode | undefined,
  movingNodeIds: ReadonlySet<string>,
  direction: LineageGraphDirection,
): Map<string, { x: number; y: number }> {
  if (!sourceNode) return new Map();
  const sourceWidth = sourceNode.width || sourceNode.measured?.width || 212;
  const sourceHeight = sourceNode.height || sourceNode.measured?.height || 164;
  const junction = {
    BT: { x: sourceNode.position.x + sourceWidth / 2, y: sourceNode.position.y - 55 },
    LR: { x: sourceNode.position.x + sourceWidth + 55, y: sourceNode.position.y + sourceHeight / 2 },
    RL: { x: sourceNode.position.x - 55, y: sourceNode.position.y + sourceHeight / 2 },
    TB: { x: sourceNode.position.x + sourceWidth / 2, y: sourceNode.position.y + sourceHeight + 55 },
  }[direction];
  return new Map(nodes
    .filter(node => movingNodeIds.has(node.id))
    .map(node => {
      const width = node.width || node.measured?.width || sourceWidth;
      const height = node.height || node.measured?.height || sourceHeight;
      return [node.id, {
        x: Math.round(junction.x - (node.position.x + width / 2)),
        y: Math.round(junction.y - (node.position.y + height / 2)),
      }];
    }));
}

function nextBrowserPaint(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function lineageWorkspaceClaims(claims: AgentClaimSummary[], project: string, rootAssetId: string): AgentClaimSummary[] {
  const targetId = `${project}:lineage-workspace:${rootAssetId}`;
  return claims.filter(claim => {
    if (claim.project !== project || claim.status !== 'active' || claim.derived_state === 'expired') return false;
    if (claim.scope_type === 'lineage_workspace') return claim.target_id === targetId;
    return claim.scope_type === 'project_channel';
  });
}

function graphDirectionLabel(direction: LineageGraphDirection): string {
  return {
    BT: 'bottom to top',
    LR: 'left to right',
    RL: 'right to left',
    TB: 'top to bottom',
  }[direction];
}
