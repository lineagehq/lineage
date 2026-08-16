import { AgentClaimError, listAgentClaims, validateAgentClaimForWrite } from './agentClaims';
import { lineageDb, type DatabaseSync } from './assetLineageDb';
import { lineageWorkspaceId } from './assetLineageWorkspaces';

function channelOverlaps(left?: string, right?: string): boolean {
  return !left || !right || left === right;
}

function hasActiveLineageWorkspaceClaim(project: string, targetId: string, channel?: string): boolean {
  return listAgentClaims(project).claims.some(claim => {
    if (claim.project !== project || claim.status !== 'active' || claim.derived_state === 'expired') return false;
    if (claim.scope_type === 'lineage_workspace') return claim.target_id === targetId;
    return claim.scope_type === 'project_channel' && channelOverlaps(channel, claim.channel);
  });
}

export type LineageWorkspaceClaimDecision =
  | { claim_decision: 'no_active_claim'; claim_id: null }
  | { claim_decision: 'validated_claim'; claim_id: string };

export function canonicalLineageWorkspaceChannel(project: string, rootAssetId: string, database?: DatabaseSync): string | undefined {
  const db = database || lineageDb();
  try {
    const row = db.prepare('select channel from assets where project_id=? and id=?').get(project, rootAssetId) as { channel: string | null } | undefined;
    const channel = row?.channel?.trim();
    return channel || undefined;
  } finally { if (!database) db.close(); }
}

export function decideLineageWorkspaceClaimForWrite(fields: {
  channel?: string;
  claimToken?: string;
  project: string;
  rootAssetId: string;
  writeKind: string;
}, recordValidatedClaimEvent = false): LineageWorkspaceClaimDecision {
  const targetId = lineageWorkspaceId(fields.project, fields.rootAssetId);
  if (!fields.claimToken && !hasActiveLineageWorkspaceClaim(fields.project, targetId, fields.channel)) {
    return { claim_decision: 'no_active_claim', claim_id: null };
  }
  const validation = validateAgentClaimForWrite({
    channel: fields.channel,
    claimToken: fields.claimToken,
    dangerLevel: 'enforce',
    project: fields.project,
    scopeType: 'lineage_workspace',
    targetId,
    writeKind: fields.writeKind,
    recordEvent: recordValidatedClaimEvent,
  });
  if (!validation.ok) {
    const status = validation.code === 'claim_required' || validation.code === 'claim_token_invalid' ? 401 : 409;
    throw new AgentClaimError(validation.message, status, validation.code, validation.conflicts);
  }
  return { claim_decision: 'validated_claim', claim_id: validation.claim.id };
}

export function requireLineageWorkspaceClaimForWrite(fields: {
  channel?: string;
  claimToken?: string;
  confirmWrite: boolean;
  project: string;
  rootAssetId: string;
  writeKind: string;
}): void {
  if (!fields.confirmWrite) return;
  decideLineageWorkspaceClaimForWrite({
    channel: fields.channel,
    claimToken: fields.claimToken,
    project: fields.project,
    rootAssetId: fields.rootAssetId,
    writeKind: fields.writeKind,
  }, true);
}
