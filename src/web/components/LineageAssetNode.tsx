import type { CSSProperties } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { LineageNode, LineageTask } from '../../shared/types';
import { storageStateFor } from '../assetUi';
import { hoverPreviewPosition, type HoverPreviewPosition } from './lineageHoverPreview';

export type LineageFocusRole = 'active' | 'child' | 'none' | 'parent';

export type LineagePreviewSource = 'focus' | 'hover';
export type LineageCanvasPresentation = 'compact' | 'portrait';
export type LineageSemanticZoomTier = 'far' | 'medium' | 'near';

type AssetNodeData = LineageNode & {
  active: boolean;
  branchCollapsed?: boolean;
  branchDescendantCount?: number;
  branchTransition?: 'entering' | 'exiting';
  branchTransitionOffset?: { x: number; y: number };
  canvasPresentation?: LineageCanvasPresentation;
  collapseInteractive?: boolean;
  focusRole: LineageFocusRole;
  hoverPreviewsEnabled?: boolean;
  variationQueueState?: 'ancestor' | 'primary' | 'queued';
  onOpenDetail?: (assetId: string) => void;
  onOpenHistory?: (assetId: string) => void;
  onPreviewChange?: (source: LineagePreviewSource, assetId: string, position: HoverPreviewPosition | null) => void;
  onPreviewDismiss?: () => void;
  onToggleCollapse?: (assetId: string) => void;
  onToggleBranch?: (node: LineageNode) => void;
  onToggleReroll?: (node: LineageNode) => void;
  onToggleDiscussion?: (node: LineageNode) => void;
  onToggleSocial?: (node: LineageNode) => void;
  root: boolean;
  replayInteractive?: boolean;
  replayState?: 'entering' | 'future' | 'visible';
  semanticZoomTier?: LineageSemanticZoomTier;
  sourcePosition: Position;
  targetPosition: Position;
  generation_target?: {
    destinations: string[];
    dimensions?: string;
    imported: boolean;
    locked: boolean;
  };
  next_output_target?: {
    dimensions: string[];
    label: string;
    origin: 'canvas_default' | 'derived_child' | 'node_override' | 'unresolved';
  };
} & Record<string, unknown>;
export type AssetFlowNode = Node<AssetNodeData, 'assetNode'>;

function lineageActiveStateLabels(node: LineageNode): string[] {
  return [
    node.user_selected ? 'Branch queued' : null,
    node.reroll_request?.status === 'pending' ? 'Re-roll queued' : null,
    node.social_mark?.active ? 'Marked for Social' : null,
    node.discussion_mark?.active ? 'Flagged for discussion' : null,
  ].filter((label): label is string => Boolean(label));
}

export function LineageStateChips({ className = '', node }: { className?: string; node: LineageNode }) {
  const states = [
    node.user_selected ? { className: 'branch', key: 'B', label: 'Branch queued' } : null,
    node.reroll_request?.status === 'pending' ? { className: 'reroll', key: 'R', label: 'Re-roll queued' } : null,
    node.social_mark?.active ? { className: 'social', key: 'S', label: 'Marked for Social' } : null,
    node.discussion_mark?.active ? { className: 'flag', key: 'F', label: 'Flagged for discussion' } : null,
  ].filter((state): state is { className: string; key: string; label: string } => Boolean(state));
  if (states.length === 0) return null;
  return (
    <ul aria-label="Active action states" className={`lineage-state-chips ${className}`.trim()}>
      {states.map(state => (
        <li className={state.className} key={state.key} title={state.label}>
          <span aria-hidden="true">{state.key}</span><span className="sr-only">{state.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function AssetNode({ data }: NodeProps<AssetFlowNode>) {
  const storage = storageStateFor({ hasLocal: Boolean(data.local_path), hasS3: Boolean(data.s3_key) });
  const taskBadges = lineageTaskBadges(data.lineage_tasks);
  const replayState = data.replayState;
  const activeStateLabels = lineageActiveStateLabels(data);
  const replayInteractive = data.replayInteractive !== false;
  const portrait = data.canvasPresentation === 'portrait';
  const collapseInteractive = data.collapseInteractive !== false;
  const semanticZoomTier = data.semanticZoomTier || 'near';
  const hasWork = taskBadges.length > 0 || (data.reroll_request?.status === 'pending' && !data.lineage_tasks?.reroll);
  const branchQueued = data.user_selected;
  const rerollQueued = data.reroll_request?.status === 'pending';
  const branchPrompt = branchQueued ? data.branch_prompt || data.selection_note : undefined;
  const rerollPrompt = rerollQueued
    ? data.reroll_request?.prompt || data.reroll_request?.notes
    : undefined;
  const openFromNode = () => {
    data.onPreviewDismiss?.();
    if ((data.attempt_count || 1) > 1) data.onOpenHistory?.(data.asset_id);
    else data.onOpenDetail?.(data.asset_id);
  };
  const showPreview = (source: LineagePreviewSource, element: HTMLElement) => {
    data.onPreviewChange?.(source, data.asset_id, hoverPreviewPosition(element.getBoundingClientRect(), window.innerWidth, window.innerHeight));
  };
  const branchCount = data.branchDescendantCount || 0;
  const collapseLabel = data.branchCollapsed
    ? `Expand ${branchCount} hidden ${branchCount === 1 ? 'descendant' : 'descendants'} of ${data.title}`
    : `Collapse ${branchCount} ${branchCount === 1 ? 'descendant' : 'descendants'} of ${data.title}`;
  const branchTransitionStyle = data.branchTransitionOffset ? {
    '--lineage-branch-motion-x': `${data.branchTransitionOffset.x}px`,
    '--lineage-branch-motion-y': `${data.branchTransitionOffset.y}px`,
  } as CSSProperties : undefined;
  return (
    <div
      className={`lineage-node-shell lineage-node-shell-${portrait ? 'portrait' : 'compact'} ${replayState ? `lineage-node-shell-replay-${replayState}` : ''} ${data.branchTransition ? `lineage-node-branch-${data.branchTransition}` : ''}`}
      style={branchTransitionStyle}
    >
      <div
        aria-label={`${data.title} ${((data.attempt_count || 1) > 1) ? 'attempt history' : 'details'}${activeStateLabels.length ? `. Active states: ${activeStateLabels.join(', ')}` : ''}`}
        aria-hidden={replayState === 'future' ? true : undefined}
        aria-keyshortcuts="B R F S D"
        className={`lineage-node lineage-node-${portrait ? 'portrait' : 'compact'} lineage-zoom-${semanticZoomTier} lineage-review-${data.review_state} ${hasWork ? 'lineage-has-work' : ''} ${data.root ? 'root-node' : ''} ${data.active ? 'active' : ''} ${data.user_selected ? 'selected' : ''} ${data.is_latest ? 'latest' : ''} ${data.variationQueueState ? `variation-${data.variationQueueState}` : ''} focus-${data.focusRole} ${replayState ? `lineage-node-replay-${replayState}` : ''}`}
        data-asset-id={data.asset_id}
        data-focus-role={data.focusRole}
        data-has-work={hasWork ? 'true' : undefined}
        data-lineage-root={data.root ? 'true' : undefined}
        data-review-state={data.review_state}
        onBlur={data.hoverPreviewsEnabled ? () => data.onPreviewChange?.('focus', data.asset_id, null) : undefined}
        onDoubleClick={event => {
          event.stopPropagation();
          openFromNode();
        }}
        onFocus={data.hoverPreviewsEnabled ? event => showPreview('focus', event.currentTarget) : undefined}
        onKeyDown={event => {
          const key = event.key.toLowerCase();
          if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'b') {
            event.preventDefault();
            event.stopPropagation();
            data.onToggleBranch?.(data);
            return;
          }
          if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'r') {
            event.preventDefault();
            event.stopPropagation();
            data.onToggleReroll?.(data);
            return;
          }
          if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 's') {
            event.preventDefault();
            event.stopPropagation();
            data.onToggleSocial?.(data);
            return;
          }
          if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'f') {
            event.preventDefault();
            event.stopPropagation();
            data.onToggleDiscussion?.(data);
            return;
          }
          if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'd') {
            event.preventDefault();
            event.stopPropagation();
            data.onPreviewDismiss?.();
            data.onOpenDetail?.(data.asset_id);
            return;
          }
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          openFromNode();
        }}
        onMouseEnter={data.hoverPreviewsEnabled ? event => showPreview('hover', event.currentTarget) : undefined}
        onMouseLeave={data.hoverPreviewsEnabled ? () => data.onPreviewChange?.('hover', data.asset_id, null) : undefined}
        role="button"
        tabIndex={replayInteractive ? 0 : -1}
        title={data.hoverPreviewsEnabled
          ? ((data.attempt_count || 1) > 1 ? 'Hover to preview; double-click to open attempt history; drag to reposition' : 'Hover to preview; double-click to open detail; drag to reposition')
          : ((data.attempt_count || 1) > 1 ? 'Double-click to open attempt history; drag to reposition' : 'Double-click to open detail; drag to reposition')}
      >
        <Handle className="lineage-handle" isConnectable={false} position={data.targetPosition} type="target" />
        <Handle className="lineage-handle" isConnectable={false} position={data.sourcePosition} type="source" />
        <LineageStateChips className="lineage-state-chips-node" node={data} />
        {portrait && (
          <div aria-hidden="true" className="lineage-node-overview-markers">
            {hasWork && <span className="work">work</span>}
            <span className={`review review-${data.review_state}`}>{data.review_state.replaceAll('_', ' ')}</span>
          </div>
        )}
        <div className="lineage-thumb">
          {data.preview_url && (data.media_type === 'image' || data.media_type === 'gif') ? (
            <img src={data.preview_url} alt="" loading="lazy" />
          ) : data.preview_url && data.media_type === 'video' ? (
            <video src={data.preview_url} muted preload="metadata" />
          ) : (
            <span>{data.media_type}</span>
          )}
        </div>
        {portrait ? (
          <div className="lineage-node-portrait-footer">
            <strong>{data.title}</strong>
            <div aria-label="Asset state" className="lineage-node-portrait-state">
              {data.root && <span className="root">root</span>}
              {data.is_latest && <span className="latest">latest</span>}
              {(data.attempt_count || 1) > 1 && <span className="attempt-stack">v{data.attempt_count}</span>}
              {taskBadges.length > 0 && <span className="lineage-task-badge">work</span>}
            </div>
            <small>{data.review_state.replaceAll('_', ' ')}</small>
            {(branchQueued || rerollQueued) && (
              <div className="lineage-node-prompts">
                {branchQueued && <span className={branchPrompt ? '' : 'missing'} title={branchPrompt ? `Branch prompt: ${branchPrompt}` : 'Branch has no prompt'}><b>Branch</b>{branchPrompt || 'No prompt'}</span>}
                {rerollQueued && <span className={`reroll ${rerollPrompt ? '' : 'missing'}`} title={rerollPrompt ? `Re-roll prompt: ${rerollPrompt}` : 'Re-roll has no prompt'}><b>Re-roll</b>{rerollPrompt || 'No prompt'}</span>}
              </div>
            )}
          </div>
        ) : (
          <>
            <strong>{data.title}</strong>
            <small>{data.asset_id}</small>
            <div className="lineage-badges">
              <span className={storage.kind}>{storage.label}</span>
              <span>{data.review_state}</span>
              {data.root && <span className="root">root</span>}
              {data.is_latest && <span className="latest">latest</span>}
              {(data.attempt_count || 1) > 1 && <span className="attempt-stack">v{data.attempt_count}</span>}
              {taskBadges.map(task => (
                <span className={`lineage-task-badge ${task.task_type} ${task.status === 'pending' ? 'pending' : 'locked'}`} key={task.id}>
                  {task.task_type} {task.status === 'pending' ? 'pending' : 'locked'}
                </span>
              ))}
              {data.generation_target && (
                <span
                  className={`output-target ${data.generation_target.locked ? 'locked' : 'unlocked'}`}
                  title={[
                    data.generation_target.locked ? data.generation_target.dimensions : 'No pixel lock',
                    ...data.generation_target.destinations,
                    data.generation_target.imported ? 'imported' : 'planned',
                  ].filter(Boolean).join(' · ')}
                >
                  {data.generation_target.locked ? `locked ${data.generation_target.dimensions}` : 'explicitly unlocked'}
                </span>
              )}
              {data.next_output_target && (
                <span
                  className={`next-output-target origin-${data.next_output_target.origin}`}
                  title={`Future children only · ${data.next_output_target.label}`}
                >
                  {data.next_output_target.origin === 'unresolved'
                    ? 'next unresolved'
                    : `next ${data.next_output_target.dimensions.join(', ')}`}
                </span>
              )}
            </div>
            {(branchQueued || rerollQueued) && (
              <div className="lineage-node-prompts">
                {branchQueued && <span className={branchPrompt ? '' : 'missing'} title={branchPrompt ? `Branch prompt: ${branchPrompt}` : 'Branch has no prompt'}><b>Branch</b>{branchPrompt || 'No prompt'}</span>}
                {rerollQueued && <span className={`reroll ${rerollPrompt ? '' : 'missing'}`} title={rerollPrompt ? `Re-roll prompt: ${rerollPrompt}` : 'Re-roll has no prompt'}><b>Re-roll</b>{rerollPrompt || 'No prompt'}</span>}
              </div>
            )}
            <span aria-hidden="true" className="lineage-node-hint">{data.hoverPreviewsEnabled ? 'Hover to preview' : 'Double-click for details'}</span>
          </>
        )}
      </div>
      {branchCount > 0 && (
        <button
          aria-expanded={!data.branchCollapsed}
          aria-hidden={replayState === 'future' ? true : undefined}
          aria-label={collapseLabel}
          className={`lineage-branch-toggle lineage-branch-toggle-${String(data.sourcePosition).toLowerCase()} ${data.branchCollapsed ? 'collapsed' : ''}`}
          disabled={!collapseInteractive}
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            data.onPreviewDismiss?.();
            data.onToggleCollapse?.(data.asset_id);
          }}
          onDoubleClick={event => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDown={event => event.stopPropagation()}
          onPointerDown={event => event.stopPropagation()}
          tabIndex={replayState === 'future' ? -1 : undefined}
          title={collapseInteractive ? collapseLabel : 'Branch collapsing is unavailable during replay'}
          type="button"
        >
          <span aria-hidden="true">{data.branchCollapsed ? '+' : '−'}</span>
        </button>
      )}
    </div>
  );
}

function lineageTaskBadges(tasks: LineageNode['lineage_tasks']): LineageTask[] {
  return (['iterate', 'reroll'] as const)
    .map(taskType => tasks?.[taskType])
    .filter((task): task is LineageTask => Boolean(task && ['pending', 'claimed', 'in_progress'].includes(task.status)));
}
