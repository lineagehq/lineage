import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Background, Controls, MiniMap, ReactFlow, type Edge, type EdgeChange, type NodeChange, type ReactFlowInstance } from '@xyflow/react';
import type { LineageNode } from '../../shared/types';
import {
  AssetNode,
  type AssetFlowNode,
  type LineageCanvasPresentation,
  type LineagePreviewSource,
  type LineageSemanticZoomTier,
} from './LineageAssetNode';
import type { HoverPreviewPosition } from './lineageHoverPreview';
import { quickActionState } from './lineageQuickActions';
import './LineageCanvas.css';

const nodeTypes = { assetNode: AssetNode };

type PreviewTarget = { assetId: string; position: HoverPreviewPosition };
type PreviewState = {
  activeSource: LineagePreviewSource | null;
  focus: PreviewTarget | null;
  hover: PreviewTarget | null;
};

const emptyPreviewState: PreviewState = { activeSource: null, focus: null, hover: null };

export type LineageWorkspaceProgress = 'downloading' | 'downloaded' | 'seeding' | 'indexing' | 'ready' | 'error' | null;

// eslint-disable-next-line react-refresh/only-export-components -- pure presentation rule shared with regression tests
export function lineageSemanticZoomTier(zoom: number): LineageSemanticZoomTier {
  if (zoom < 0.45) return 'far';
  if (zoom < 0.72) return 'medium';
  return 'near';
}

// eslint-disable-next-line react-refresh/only-export-components -- pure state contract shared with regression tests
export function lineageCanvasEmptyState(workspaceRootAssetId: string, progress: LineageWorkspaceProgress) {
  if (progress === 'downloading') return { action: 'none' as const, description: 'Fetching and verifying the 14 rich demo images.', title: 'Downloading rich demo media' };
  if (progress === 'seeding') return { action: 'none' as const, description: 'Creating the rich demo workspace without starting a second index.', title: 'Creating rich demo workspace' };
  if (progress === 'indexing') return { action: 'none' as const, description: 'Loading the automatic 14-node index. No manual action is needed.', title: 'Indexing rich demo images' };
  if (progress === 'error') return { action: workspaceRootAssetId ? 'retry-index' as const : 'seed' as const, description: 'The automatic setup stopped. Review the error message, then retry.', title: 'Rich demo setup failed' };
  if (workspaceRootAssetId) return { action: 'index' as const, description: 'Index local/catalog assets to inspect this tree.', title: 'No lineage index yet' };
  return { action: 'new' as const, description: 'Search local and catalog assets, choose a root, and name the iteration tree.', title: 'Start a lineage' };
}

export function LineageCanvas({
  canvasPresentation,
  collapseInteractive,
  flowEdges,
  flowNodes,
  graphKey,
  hoverPreviewsEnabled,
  loading,
  minimapVisible,
  onSeedDemo,
  onEdgesChange,
  onEdgeEdit,
  onIndexNow,
  onNewLineage,
  onClearFocus,
  onNodeActionMenu,
  onNodeInspect,
  onNodeOpenDetail,
  onNodeOpenHistory,
  onNodePosition,
  onToggleCollapse,
  onNodesChange,
  onReady,
  onSelectedAsset,
  onToggleBranch,
  onToggleReroll,
  onToggleSocial,
  onViewportInteraction,
  replayInteractive,
  selectionFull,
  workspaceProgress,
  workspaceRootAssetId,
}: {
  canvasPresentation: LineageCanvasPresentation;
  collapseInteractive: boolean;
  flowEdges: Edge[];
  flowNodes: AssetFlowNode[];
  graphKey: string;
  hoverPreviewsEnabled: boolean;
  loading: boolean;
  minimapVisible: boolean;
  onSeedDemo: () => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onEdgeEdit: (edgeId: string, trigger: HTMLElement | SVGElement | null) => void;
  onIndexNow: () => void;
  onNewLineage: () => void;
  onClearFocus: () => void;
  onNodeActionMenu: (assetId: string, x: number, y: number) => void;
  onNodeInspect: (assetId: string | null) => boolean | void;
  onNodeOpenDetail: (assetId: string) => void;
  onNodeOpenHistory: (assetId: string) => void;
  onNodePosition: (node: AssetFlowNode) => void;
  onToggleCollapse: (assetId: string) => void;
  onNodesChange: (changes: NodeChange<AssetFlowNode>[]) => void;
  onReady: (instance: ReactFlowInstance<AssetFlowNode, Edge>) => void;
  onSelectedAsset: (assetId: string) => void;
  onToggleBranch: (node: LineageNode) => Promise<void> | void;
  onToggleReroll: (node: LineageNode) => Promise<void> | void;
  onToggleSocial: (node: LineageNode) => Promise<void> | boolean | void;
  onViewportInteraction: () => void;
  replayInteractive: boolean;
  selectionFull: boolean;
  workspaceProgress: LineageWorkspaceProgress;
  workspaceRootAssetId: string;
}) {
  const [previews, setPreviews] = useState<PreviewState>(emptyPreviewState);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [semanticZoomTier, setSemanticZoomTier] = useState<LineageSemanticZoomTier>('near');
  const pendingActionRef = useRef(false);
  const previewCloseTimer = useRef<number | null>(null);
  const cancelPreviewClose = useCallback(() => {
    if (previewCloseTimer.current === null) return;
    window.clearTimeout(previewCloseTimer.current);
    previewCloseTimer.current = null;
  }, []);
  const dismissPreview = useCallback(() => {
    cancelPreviewClose();
    setPreviews(emptyPreviewState);
  }, [cancelPreviewClose]);
  const schedulePreviewClose = useCallback((action: () => void) => {
    cancelPreviewClose();
    previewCloseTimer.current = window.setTimeout(() => {
      previewCloseTimer.current = null;
      action();
    }, 180);
  }, [cancelPreviewClose]);
  const changePreview = useCallback((source: LineagePreviewSource, assetId: string, position: HoverPreviewPosition | null) => {
    const update = () => setPreviews(current => {
      if (position) return { ...current, activeSource: source, [source]: { assetId, position } };
      if (current[source]?.assetId !== assetId) return current;
      const next = { ...current, [source]: null };
      const otherSource = source === 'hover' ? 'focus' : 'hover';
      return {
        ...next,
        activeSource: current.activeSource === source ? (next[otherSource] ? otherSource : null) : current.activeSource,
      };
    });
    if (position) {
      cancelPreviewClose();
      update();
      return;
    }
    schedulePreviewClose(update);
  }, [cancelPreviewClose, schedulePreviewClose]);
  useEffect(() => dismissPreview(), [dismissPreview, graphKey]);
  useEffect(() => {
    if (!hoverPreviewsEnabled) dismissPreview();
  }, [dismissPreview, hoverPreviewsEnabled]);
  useEffect(() => () => cancelPreviewClose(), [cancelPreviewClose]);
  const openDetail = useCallback((assetId: string) => {
    dismissPreview();
    onNodeOpenDetail(assetId);
  }, [dismissPreview, onNodeOpenDetail]);
  const openHistory = useCallback((assetId: string) => {
    dismissPreview();
    onNodeOpenHistory(assetId);
  }, [dismissPreview, onNodeOpenHistory]);
  const openNodeActionMenu = useCallback((assetId: string, x: number, y: number) => {
    dismissPreview();
    onNodeActionMenu(assetId, x, y);
  }, [dismissPreview, onNodeActionMenu]);
  const runQuickAction = useCallback(async (action: 'branch' | 'reroll' | 'social', node: LineageNode) => {
    const actionId = `${action}:${node.asset_id}`;
    if (pendingActionRef.current) return;
    pendingActionRef.current = true;
    setPendingAction(actionId);
    try {
      if (action === 'branch') await onToggleBranch(node);
      else if (action === 'reroll') await onToggleReroll(node);
      else await onToggleSocial(node);
    } finally {
      pendingActionRef.current = false;
      setPendingAction(null);
    }
  }, [onToggleBranch, onToggleReroll, onToggleSocial]);
  const interactiveNodes = useMemo(() => flowNodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      canvasPresentation,
      collapseInteractive,
      hoverPreviewsEnabled,
      onOpenDetail: openDetail,
      onOpenHistory: openHistory,
      onPreviewChange: hoverPreviewsEnabled ? changePreview : undefined,
      onPreviewDismiss: dismissPreview,
      onToggleCollapse,
      onToggleBranch: (target: LineageNode) => {
        if (quickActionState(target, selectionFull).branchDisabled) return;
        void runQuickAction('branch', target);
      },
      onToggleReroll: (target: LineageNode) => {
        if (quickActionState(target, selectionFull).rerollDisabled) return;
        void runQuickAction('reroll', target);
      },
      onToggleSocial: (target: LineageNode) => {
        if (quickActionState(target, selectionFull).socialDisabled) return;
        void runQuickAction('social', target);
      },
      semanticZoomTier: canvasPresentation === 'portrait' ? semanticZoomTier : 'near',
    },
  })), [canvasPresentation, changePreview, collapseInteractive, dismissPreview, flowNodes, hoverPreviewsEnabled, onToggleCollapse, openDetail, openHistory, runQuickAction, selectionFull, semanticZoomTier]);

  if (!flowNodes.length) {
    const emptyState = lineageCanvasEmptyState(workspaceRootAssetId, workspaceProgress);
    return (
      <div className="lineage-empty-state" data-lineage-state={workspaceProgress || (workspaceRootAssetId ? 'empty' : 'new')}>
        <strong>{emptyState.title}</strong>
        <p>{emptyState.description}</p>
        {(emptyState.action === 'index' || emptyState.action === 'retry-index') && (
          <button className="primary-button" disabled={loading} onClick={onIndexNow}>{emptyState.action === 'retry-index' ? 'Retry index' : 'Index now'}</button>
        )}
        {emptyState.action === 'new' && (
          <div className="lineage-empty-actions">
            <button className="primary-button" onClick={onNewLineage}>New lineage</button>
            <button className="secondary-button" disabled={loading} onClick={onSeedDemo}>Load demo lineage</button>
          </div>
        )}
        {emptyState.action === 'seed' && <button className="primary-button" disabled={loading} onClick={onSeedDemo}>Load demo lineage</button>}
      </div>
    );
  }
  const activePreview = hoverPreviewsEnabled && previews.activeSource ? previews[previews.activeSource] : null;
  const previewNode = activePreview ? flowNodes.find(node => node.id === activePreview.assetId)?.data : undefined;
  const actionState = previewNode ? quickActionState(previewNode, selectionFull) : null;
  const editFocusedEdge = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!replayInteractive) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target instanceof Element ? event.target.closest<SVGElement>('.react-flow__edge') : null;
    const edgeId = target?.dataset.id;
    if (!edgeId || !flowEdges.some(edge => edge.id === edgeId)) return;
    event.preventDefault();
    event.stopPropagation();
    dismissPreview();
    onEdgeEdit(edgeId, target);
  };

  return (
    <>
      {activePreview && previewNode && actionState && createPortal(
        <section
          aria-label={`Quick actions for ${previewNode.title}`}
          className="lineage-hover-preview"
          data-testid="lineage-hover-preview"
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) schedulePreviewClose(dismissPreview);
          }}
          onKeyDown={event => {
            const key = event.key.toLowerCase();
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (key === 'b' && !actionState.branchDisabled) {
              event.preventDefault();
              void runQuickAction('branch', previewNode);
            }
            if (key === 'r' && !actionState.rerollDisabled) {
              event.preventDefault();
              void runQuickAction('reroll', previewNode);
            }
            if (key === 's' && !actionState.socialDisabled) {
              event.preventDefault();
              void runQuickAction('social', previewNode);
            }
            if (key === 'd') {
              event.preventDefault();
              openDetail(previewNode.asset_id);
            }
          }}
          onMouseEnter={cancelPreviewClose}
          onMouseLeave={event => {
            if (previews.activeSource === 'hover' && !event.currentTarget.contains(document.activeElement)) {
              changePreview('hover', previewNode.asset_id, null);
            }
          }}
          style={{ left: activePreview.position.left, top: activePreview.position.top }}
        >
          <div className="lineage-hover-preview-media">
            {previewNode.preview_url && (previewNode.media_type === 'image' || previewNode.media_type === 'gif') ? (
              <img alt="" src={previewNode.preview_url} />
            ) : previewNode.preview_url && previewNode.media_type === 'video' ? (
              <video autoPlay loop muted playsInline preload="metadata" src={previewNode.preview_url} />
            ) : (
              <span>{previewNode.media_type} preview unavailable</span>
            )}
          </div>
          <div className="lineage-hover-preview-copy">
            <strong>{previewNode.title}</strong>
            <code>{previewNode.asset_id}</code>
          </div>
          <div className="lineage-hover-preview-actions">
            <button
              aria-keyshortcuts="B"
              aria-pressed={previewNode.user_selected}
              className={previewNode.user_selected ? 'selected' : ''}
              disabled={actionState.branchDisabled || Boolean(pendingAction)}
              onClick={() => void runQuickAction('branch', previewNode)}
              title={actionState.branchTitle}
              type="button"
            >
              <kbd>B</kbd><span>{previewNode.user_selected ? 'Branch queued' : 'Branch'}</span>
            </button>
            <button
              aria-keyshortcuts="R"
              aria-pressed={actionState.rerollSelected}
              className={`reroll ${actionState.rerollSelected ? 'selected' : ''}`}
              disabled={actionState.rerollDisabled || Boolean(pendingAction)}
              onClick={() => void runQuickAction('reroll', previewNode)}
              title={actionState.rerollTitle}
              type="button"
            >
              <kbd>R</kbd><span>{actionState.rerollSelected ? 'Re-roll queued' : 'Re-roll'}</span>
            </button>
            <button
              aria-keyshortcuts="S"
              aria-controls="lineage-canvas-panel"
              className={`social ${actionState.socialSelected ? 'selected' : ''}`}
              disabled={actionState.socialDisabled || Boolean(pendingAction)}
              onClick={() => void runQuickAction('social', previewNode)}
              title="Open Social composition (S)"
              type="button"
            >
              <kbd>S</kbd><span>{actionState.socialSelected ? 'Social composition' : 'Social'}</span>
            </button>
            <button aria-keyshortcuts="D" onClick={() => openDetail(previewNode.asset_id)} type="button"><kbd>D</kbd><span>Details</span></button>
          </div>
          {(actionState.branchLocked || actionState.rerollLocked) && <p className="lineage-hover-preview-lock">Active work is managed in the task queue.</p>}
        </section>,
        document.body,
      )}
      <ReactFlow<AssetFlowNode, Edge>
        defaultViewport={{ x: 80, y: 120, zoom: 0.82 }} edges={flowEdges} nodes={interactiveNodes} nodeTypes={nodeTypes}
        deleteKeyCode={null}
        edgesFocusable={replayInteractive}
        elementsSelectable={replayInteractive}
        key={graphKey}
        minZoom={canvasPresentation === 'portrait' ? 0.08 : 0.3}
        nodesDraggable={replayInteractive}
        nodesFocusable={false}
        onEdgeDoubleClick={(event, edge) => {
          event.preventDefault();
          if (!replayInteractive) return;
          dismissPreview();
          onEdgeEdit(edge.id, event.currentTarget as SVGElement);
        }}
        onEdgesChange={onEdgesChange}
        onKeyDownCapture={editFocusedEdge}
        onNodeClick={(_event, node) => { if (onNodeInspect(node.id) === false) return; onNodeActionMenu('', 0, 0); onSelectedAsset(node.id); }}
        onNodeContextMenu={(event, node) => { event.preventDefault(); if (onNodeInspect(node.id) === false) return; openNodeActionMenu(node.id, event.clientX, event.clientY); onSelectedAsset(node.id); }}
        onNodeDoubleClick={(_event, node) => {
          dismissPreview();
          if (onNodeInspect(node.id) === false) return;
          if ((node.data.attempt_count || 1) > 1) onNodeOpenHistory(node.id);
          else onNodeOpenDetail(node.id);
          onSelectedAsset(node.id);
        }}
        onNodeDragStart={dismissPreview}
        onNodeDragStop={(_event, node) => onNodePosition(node)}
        onNodesChange={onNodesChange}
        onInit={onReady}
        onMove={(_event, viewport) => {
          if (canvasPresentation !== 'portrait') return;
          const nextTier = lineageSemanticZoomTier(viewport.zoom);
          setSemanticZoomTier(current => current === nextTier ? current : nextTier);
        }}
        onMoveStart={() => { dismissPreview(); onViewportInteraction(); }}
        onPaneClick={onClearFocus}
      >
        <Background />
        <Controls />
        {minimapVisible && <MiniMap pannable zoomable />}
      </ReactFlow>
    </>
  );
}
