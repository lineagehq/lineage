import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { createAgentClaim, inspectAgentClaim, releaseAgentClaim } from './agentClaims';
import { defaultProject, repoRoot } from './assetCore';
import { lineageDb, nowIso } from './assetLineageDb';
import { lineageWorkspaceId } from './assetLineageWorkspaces';
import { canonicalLineageWorkspaceChannel, decideLineageWorkspaceClaimForWrite, requireLineageWorkspaceClaimForWrite } from './lineageClaimGuards';

const rootAssetId = 'claim-guard-root';
const scratch = join(repoRoot, '.asset-scratch', 'vitest-lineage-claim-guards');

describe('Lineage workspace claim decisions', () => {
  beforeEach(() => {
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(scratch, { recursive: true });
    useLineageTestProfile(join(scratch, 'lineage.sqlite'));
  });

  it('allows no-token human ownership only without an overlapping active claim', () => {
    expect(decideLineageWorkspaceClaimForWrite({ project: defaultProject, rootAssetId, writeKind: 'fixture' }))
      .toEqual({ claim_decision: 'no_active_claim', claim_id: null });
    createAgentClaim({ agentName: 'Workspace owner', project: defaultProject, scopeType: 'lineage_workspace', targetId: lineageWorkspaceId(defaultProject, rootAssetId) });
    expect(() => decideLineageWorkspaceClaimForWrite({ project: defaultProject, rootAssetId, writeKind: 'fixture' })).toThrow('matching claim token');
  });

  it('validates supplied workspace or overlapping project-channel tokens', () => {
    const workspace = createAgentClaim({ agentName: 'Workspace owner', project: defaultProject, scopeType: 'lineage_workspace', targetId: lineageWorkspaceId(defaultProject, rootAssetId) });
    expect(decideLineageWorkspaceClaimForWrite({ claimToken: workspace.claim_token, project: defaultProject, rootAssetId, writeKind: 'fixture' }))
      .toEqual({ claim_decision: 'validated_claim', claim_id: workspace.claim!.id });
    releaseAgentClaim(workspace.claim_token);
    const channel = createAgentClaim({ agentName: 'Channel owner', project: defaultProject, channel: 'instagram', scopeType: 'project_channel', targetId: `${defaultProject}:instagram` });
    expect(decideLineageWorkspaceClaimForWrite({ channel: 'instagram', claimToken: channel.claim_token, project: defaultProject, rootAssetId: 'other-root', writeKind: 'fixture' }))
      .toEqual({ claim_decision: 'validated_claim', claim_id: channel.claim!.id });
  });

  it('keeps decisions side-effect free while the legacy required-write guard records one allowed audit event', () => {
    const workspace = createAgentClaim({ agentName: 'Audited workspace owner', project: defaultProject, scopeType: 'lineage_workspace', targetId: lineageWorkspaceId(defaultProject, rootAssetId) });
    decideLineageWorkspaceClaimForWrite({ claimToken: workspace.claim_token, project: defaultProject, rootAssetId, writeKind: 'fixture' });
    expect(inspectAgentClaim(workspace.claim!.id, defaultProject).events.filter(event => event.event_type === 'write_allowed')).toHaveLength(0);

    requireLineageWorkspaceClaimForWrite({ claimToken: workspace.claim_token, confirmWrite: true, project: defaultProject, rootAssetId, writeKind: 'fixture' });
    const allowed = inspectAgentClaim(workspace.claim!.id, defaultProject).events.filter(event => event.event_type === 'write_allowed');
    expect(allowed).toHaveLength(1);
  });

  it('rejects every supplied invalid or wrong-scope token even without overlap', () => {
    expect(() => decideLineageWorkspaceClaimForWrite({ claimToken: 'claim_invalid.fixture', project: defaultProject, rootAssetId, writeKind: 'fixture' })).toThrow('invalid claim token');
    const wrong = createAgentClaim({ agentName: 'Other workspace', project: defaultProject, scopeType: 'lineage_workspace', targetId: lineageWorkspaceId(defaultProject, 'other-root') });
    expect(() => decideLineageWorkspaceClaimForWrite({ claimToken: wrong.claim_token, project: defaultProject, rootAssetId, writeKind: 'fixture' })).toThrow('does not cover');
    releaseAgentClaim(wrong.claim_token);
    expect(() => decideLineageWorkspaceClaimForWrite({ claimToken: wrong.claim_token, project: defaultProject, rootAssetId: 'other-root', writeKind: 'fixture' })).toThrow('released');
    const foreign = createAgentClaim({ agentName: 'Foreign owner', project: 'foreign-project', scopeType: 'lineage_workspace', targetId: lineageWorkspaceId('foreign-project', rootAssetId) });
    expect(() => decideLineageWorkspaceClaimForWrite({ claimToken: foreign.claim_token, project: defaultProject, rootAssetId, writeKind: 'fixture' })).toThrow('does not match');
  });

  it('projects the root canvas channel and conservatively overlaps project-channel claims when it is absent', () => {
    const db = lineageDb();
    try {
      const timestamp = nowIso();
      db.prepare('insert into projects (id, product, created_at, updated_at) values (?, ?, ?, ?) on conflict(id) do nothing').run(defaultProject, defaultProject, timestamp, timestamp);
      db.prepare(`insert into assets (id, project_id, source, media_type, title, status, channel, created_at, updated_at, last_seen_at) values (?, ?, 'local', 'image', 'Channel root', 'working', 'instagram', ?, ?, ?)`)
        .run(rootAssetId, defaultProject, timestamp, timestamp, timestamp);
    } finally { db.close(); }
    expect(canonicalLineageWorkspaceChannel(defaultProject, rootAssetId)).toBe('instagram');
    const claim = createAgentClaim({ agentName: 'Any channel owner', project: defaultProject, channel: 'linkedin', scopeType: 'project_channel', targetId: `${defaultProject}:linkedin` });
    expect(() => decideLineageWorkspaceClaimForWrite({ project: defaultProject, rootAssetId: 'channel-less-root', writeKind: 'fixture' })).toThrow('matching claim token');
    expect(decideLineageWorkspaceClaimForWrite({ claimToken: claim.claim_token, project: defaultProject, rootAssetId: 'channel-less-root', writeKind: 'fixture' }))
      .toEqual({ claim_decision: 'validated_claim', claim_id: claim.claim!.id });
  });
});
