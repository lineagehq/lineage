import type { AgentClaimSummary, AssetReviewState, LineageNode } from '../../shared/types';
import './LineageContextMenu.css';

type ClaimControlAction = 'release-stale' | 'revoke' | 'transfer';
type ClaimControlBody = { confirmWrite: true; reason?: string; toAgentName?: string };

export function LineageContextMenu({
  node,
  claims = [],
  onClearAllNext,
  onClearReroll,
  onClaimControl,
  canRemoveFromLineage,
  onClearNext,
  onClose,
  onEditOutputTargets,
  onOpenDetail,
  onRemoveFromLineage,
  onReplaceNext,
  onReview,
  onSelectNext,
  onMarkReroll,
  onEditDiscussionNote,
  onToggleSocial,
  onToggleDiscussion,
  position,
  selectedCount,
  selectionFull,
}: {
  node: LineageNode;
  canRemoveFromLineage: boolean;
  claims?: AgentClaimSummary[];
  onClearAllNext: () => void;
  onClearReroll: () => void;
  onClaimControl?: (action: ClaimControlAction, claim: AgentClaimSummary, body: ClaimControlBody) => void;
  onClearNext: () => void;
  onClose: () => void;
  onEditOutputTargets?: () => void;
  onOpenDetail: () => void;
  onRemoveFromLineage: () => void;
  onReplaceNext: () => void;
  onReview: (reviewState: AssetReviewState) => void;
  onSelectNext: () => void;
  onMarkReroll: () => void;
  onToggleSocial: () => unknown;
  onEditDiscussionNote: () => void;
  onToggleDiscussion: () => void;
  position: { x: number; y: number };
  selectedCount: number;
  selectionFull: boolean;
}) {
  function run(action: () => unknown) {
    if (action() === false) return;
    onClose();
  }

  return (
    <div className="lineage-context-menu" role="menu" style={{ left: position.x, top: position.y }}>
      <strong>{node.title}</strong>
      <button disabled={!node.user_selected && selectionFull} onClick={() => run(node.user_selected ? onClearNext : onSelectNext)} role="menuitem">
        {node.user_selected ? 'Remove from next variation' : selectionFull ? 'Selection full' : 'Use for next variation'}
      </button>
      {!node.user_selected && selectedCount > 0 && <button className="selection-replace" onClick={() => run(onReplaceNext)} role="menuitem">Replace selection</button>}
      {node.user_selected && selectedCount > 1 && <button className="selection-replace" onClick={() => run(onReplaceNext)} role="menuitem">Use only this for next variation</button>}
      {selectedCount > 0 && <button onClick={() => run(onClearAllNext)} role="menuitem">Clear all next variation</button>}
      {node.user_selected && !node.is_latest && <p role="status">Selected but not latest. Good for branching from an earlier idea.</p>}
      {node.reroll_request?.status === 'pending'
        ? <button className="reroll-action" onClick={() => run(onClearReroll)} role="menuitem">Clear re-roll request</button>
        : <button className="reroll-action" onClick={() => run(onMarkReroll)} role="menuitem">Mark for re-roll</button>}
      <button className="social-action" onClick={() => run(onToggleSocial)} role="menuitem">
        Open Social composition
      </button>
      <button className="discussion-action" onClick={() => run(onToggleDiscussion)} role="menuitem">
        {node.discussion_mark?.active ? 'Remove discussion flag' : 'Flag for discussion'}
      </button>
      {node.discussion_mark?.active && (
        <button className="discussion-action" onClick={() => run(onEditDiscussionNote)} role="menuitem">Edit discussion note</button>
      )}
      {claims.length > 0 && (
        <div className="lineage-context-claims" role="group" aria-label="Agent claim controls">
          <span>{claimLabel(claims)}</span>
          {claims.length === 1 && onClaimControl && (
            <div>
              {claims[0].derived_state === 'stale' && <button onClick={() => runClaimControl('release-stale', claims[0], onClaimControl)} role="menuitem">Release stale claim</button>}
              <button onClick={() => runClaimControl('transfer', claims[0], onClaimControl)} role="menuitem">Transfer claim</button>
              <button onClick={() => runClaimControl('revoke', claims[0], onClaimControl)} role="menuitem">Revoke claim</button>
            </div>
          )}
        </div>
      )}
      {onEditOutputTargets && <button onClick={() => run(onEditOutputTargets)} role="menuitem">Edit next output targets</button>}
      <button onClick={() => run(onOpenDetail)} role="menuitem">Open detail</button>
      <button className="danger" disabled={!canRemoveFromLineage} onClick={() => run(onRemoveFromLineage)} role="menuitem">
        {canRemoveFromLineage ? 'Remove from lineage' : 'Root cannot be removed'}
      </button>
      <button onClick={() => run(() => onReview('approved'))} role="menuitem">Approve</button>
      <button onClick={() => run(() => onReview('needs_revision'))} role="menuitem">Needs revision</button>
      <button onClick={() => run(() => onReview('rejected'))} role="menuitem">Reject</button>
      <button onClick={() => run(() => onReview('ignored'))} role="menuitem">Ignore</button>
    </div>
  );
}

function claimLabel(claims: AgentClaimSummary[]): string {
  if (claims.length !== 1) return `${claims.length} active claims on this lineage`;
  const claim = claims[0];
  const prefix = claim.derived_state === 'stale' ? 'Stale claim' : claim.derived_state === 'idle' ? 'Idle claim' : 'Claimed';
  return `${prefix} by ${claim.agent_name}`;
}

function runClaimControl(action: ClaimControlAction, claim: AgentClaimSummary, onClaimControl: (action: ClaimControlAction, claim: AgentClaimSummary, body: ClaimControlBody) => void) {
  const body = claimControlBody(action, claim);
  if (!body) return;
  onClaimControl(action, claim, body);
}

function claimControlBody(action: ClaimControlAction, claim: AgentClaimSummary): ClaimControlBody | null {
  if (action === 'release-stale') {
    if (!window.confirm(`Release stale claim held by ${claim.agent_name}?`)) return null;
    return { confirmWrite: true, reason: `Released stale ${claim.scope_type} claim ${claim.id} from the lineage context menu.` };
  }
  if (action === 'revoke') {
    const reason = window.prompt(`Reason for revoking ${claim.agent_name}'s claim?`);
    if (!reason?.trim()) return null;
    if (!window.confirm(`Revoke claim ${claim.id} from ${claim.agent_name}?`)) return null;
    return { confirmWrite: true, reason: reason.trim() };
  }
  const toAgentName = window.prompt(`Transfer claim ${claim.id} to which agent?`);
  if (!toAgentName?.trim()) return null;
  if (!window.confirm(`Transfer claim ${claim.id} from ${claim.agent_name} to ${toAgentName.trim()}?`)) return null;
  return { confirmWrite: true, reason: 'Transferred from lineage context menu.', toAgentName: toAgentName.trim() };
}
