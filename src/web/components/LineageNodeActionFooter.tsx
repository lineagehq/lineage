import type { AssetReviewState, LineageNode, LineageSnapshot } from '../../shared/types';
import { copyToClipboard } from '../clipboard';
import './LineageNodeActionFooter.css';

export function LineageNodeActionFooter({
  canRemoveFromLineage,
  node,
  onClearAllNext,
  onClearNext,
  onEdit,
  onOpenNode,
  onRemoveFromLineage,
  onReplaceNext,
  onReview,
  onSelectNext,
  onToast,
  selectedCount,
  selectionFull,
  snapshot,
}: {
  canRemoveFromLineage: boolean;
  node: LineageNode;
  onClearAllNext: () => void;
  onClearNext: () => void;
  onEdit?: (node: LineageNode) => void;
  onOpenNode: (assetId: string) => void;
  onRemoveFromLineage: (node: LineageNode) => void;
  onReplaceNext: (node: LineageNode) => void;
  onReview: (reviewState: AssetReviewState, assetId: string) => void;
  onSelectNext: (node: LineageNode) => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  selectedCount: number;
  selectionFull: boolean;
  snapshot: LineageSnapshot;
}) {
  const latestNodes = snapshot.nodes.filter(item => snapshot.latest.includes(item.asset_id));
  const latestIndex = latestNodes.findIndex(item => item.asset_id === node.asset_id);
  const previousLatest = latestIndex > 0 ? latestNodes[latestIndex - 1] : null;
  const nextLatest = latestIndex >= 0 && latestIndex < latestNodes.length - 1 ? latestNodes[latestIndex + 1] : null;
  const nextBaseLabel = node.user_selected ? 'Remove from next variation' : selectionFull ? 'Selection full' : 'Use for next variation';
  const localPath = node.absolute_path || node.local_path;

  async function copyPath() {
    const path = localPath || node.s3_key;
    if (!path) return;
    const label = localPath ? 'local path' : 'S3 key';
    try {
      await copyToClipboard(path);
      onToast('ok', `Copied ${label}`);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <footer className="lineage-node-actions">
      <div className="lineage-node-actions-primary">
        {onEdit && <button className="primary-lite" onClick={() => onEdit(node)} type="button">Edit</button>}
        <button aria-label={node.user_selected ? `Remove ${node.title} from next variation` : `Use ${node.title} for next variation`} className="primary-lite" disabled={!node.user_selected && selectionFull} onClick={() => node.user_selected ? onClearNext() : onSelectNext(node)} type="button">
          {nextBaseLabel}
        </button>
        {node.user_selected && selectedCount > 1 && <button className="selection-lite" onClick={() => onReplaceNext(node)} type="button">Use only this for next variation</button>}
        {!node.user_selected && selectedCount > 0 && <button className="selection-lite" onClick={() => onReplaceNext(node)} type="button">Replace selection</button>}
        <div className="lineage-node-review-actions" aria-label="Review actions">
          <button aria-label={`Approve ${node.title}`} onClick={() => onReview('approved', node.asset_id)} type="button">Approve</button>
          <button aria-label={`Reject ${node.title}`} onClick={() => onReview('rejected', node.asset_id)} type="button">Reject</button>
          <button aria-label={`Ignore ${node.title}`} onClick={() => onReview('ignored', node.asset_id)} type="button">Ignore</button>
        </div>
      </div>
      <details className="lineage-node-actions-menu">
        <summary>More actions</summary>
        <div>
          {selectedCount > 0 && <button onClick={onClearAllNext} type="button">Clear all next variation</button>}
          {previousLatest && <button onClick={() => onOpenNode(previousLatest.asset_id)} type="button">Previous latest</button>}
          {nextLatest && <button onClick={() => onOpenNode(nextLatest.asset_id)} type="button">Next latest</button>}
          {node.preview_url && <a href={node.preview_url} rel="noreferrer" target="_blank">Open preview</a>}
          {(localPath || node.s3_key) && <button onClick={() => void copyPath()} type="button">Copy {localPath ? 'local path' : 'S3 key'}</button>}
          <button aria-label={canRemoveFromLineage ? `Remove ${node.title} from lineage` : 'Root cannot be removed from lineage'} className="danger" disabled={!canRemoveFromLineage} onClick={() => onRemoveFromLineage(node)} type="button">
            {canRemoveFromLineage ? 'Remove from lineage' : 'Root cannot be removed'}
          </button>
        </div>
      </details>
    </footer>
  );
}
