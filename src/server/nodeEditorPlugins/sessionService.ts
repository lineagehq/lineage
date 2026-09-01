import type { Readable } from 'node:stream';
import type { Capability, ProxyRequest, ProxyResult } from '../../../packages/node-editor-protocol/generated/protocol';
import type {
  NodeEditorProposalDeclaration,
  NodeEditorSessionLaunch,
  NodeEditorTerminalOutcome,
  VerifiedNodeEditorPlugin,
} from '../../shared/nodeEditorPluginTypes';
import type { ResolvedLineageProfile } from '../../shared/lineageProfileTypes';
import { discardStagedNodeEditorContent, materializeNodeEditorContent, stageNodeEditorContent, type NodeEditorFaultInjector } from './materialization';
import { NodeEditorPluginRegistry } from './registry';
import { NodeEditorSessionAuthority, type CreatedNodeEditorAuthority } from './sessionAuthority';
import { acceptNodeEditorResult, getNodeEditorBase, getNodeEditorTerminal, recordNodeEditorCancelled, recordNodeEditorStale } from './persistence';
import { NodeEditorPluginSupervisor } from './supervisor';

interface EditSession {
  authority: CreatedNodeEditorAuthority;
  plugin: VerifiedNodeEditorPlugin;
  project: string;
  rootAssetId: string;
  nodeAssetId: string;
  baseAttemptId: string;
  baseChecksumSha256: string;
  proposal?: NodeEditorProposalDeclaration;
  requestIds: Set<string>;
  closed: boolean;
}

class NodeEditorSessionError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = 'NodeEditorSessionError';
  }
}

function sri(hex: string): string {
  return `sha256-${Buffer.from(hex, 'hex').toString('base64')}`;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new NodeEditorSessionError('invalid-message', `${label} fields are invalid`);
}

export class NodeEditorSessionService {
  readonly #profile: ResolvedLineageProfile;
  readonly #registry: NodeEditorPluginRegistry;
  readonly #supervisor: NodeEditorPluginSupervisor;
  readonly #authority: NodeEditorSessionAuthority;
  readonly #sessions = new Map<string, EditSession>();
  readonly #maxProtocolBytes: number;
  readonly #inject?: NodeEditorFaultInjector;

  constructor(input: {
    profile: ResolvedLineageProfile;
    registry: NodeEditorPluginRegistry;
    supervisor: NodeEditorPluginSupervisor;
    authority?: NodeEditorSessionAuthority;
    maxProtocolBytes?: number;
    inject?: NodeEditorFaultInjector;
  }) {
    this.#profile = input.profile;
    this.#registry = input.registry;
    this.#supervisor = input.supervisor;
    this.#authority = input.authority ?? new NodeEditorSessionAuthority();
    this.#maxProtocolBytes = input.maxProtocolBytes ?? 64 * 1024;
    this.#inject = input.inject;
  }

  async create(input: { contributionId: string; project: string; rootAssetId: string; nodeAssetId: string; serverOrigin?: string }): Promise<NodeEditorSessionLaunch> {
    const plugin = this.#registry.get(input.contributionId);
    const base = getNodeEditorBase(input.project, input.rootAssetId, input.nodeAssetId);
    const authority = this.#authority.create({
      profileId: this.#profile.profile_id,
      pluginId: plugin.manifest.pluginId,
      contributionId: plugin.contribution.id,
      origin: plugin.contribution.editor.origin,
    });
    const session: EditSession = {
      authority,
      plugin,
      project: input.project,
      rootAssetId: input.rootAssetId,
      nodeAssetId: input.nodeAssetId,
      baseAttemptId: base.attemptId,
      baseChecksumSha256: base.checksumSha256,
      requestIds: new Set(),
      closed: false,
    };
    this.#sessions.set(authority.launch.sessionId, session);
    try {
      await this.#supervisor.deliverProcessAuthority(input.contributionId, {
        processCapability: authority.processCapability,
        expiresAt: authority.processExpiresAt,
        serverOrigin: input.serverOrigin,
        binding: authority.processBinding,
      });
    } catch (error) {
      this.#authority.revoke(authority.launch.sessionId);
      this.#sessions.delete(authority.launch.sessionId);
      throw error;
    }
    return authority.launch;
  }

  exchange(input: { sessionId: string; launchCredential: string; profileId: string; pluginId: string; contributionId: string; origin: string; source: 'browser' }): { cookie: string; path: string; expiresAt: number } {
    const exchanged = this.#authority.exchange({ sessionId: input.sessionId, launchCredential: input.launchCredential, binding: input });
    return { cookie: exchanged.cookie, path: this.cookiePath(input.sessionId), expiresAt: exchanged.expiresAt };
  }

  cookiePath(sessionId: string): string {
    return `/api/node-editor-plugins/sessions/${sessionId}`;
  }

  authorizeBrowser(sessionId: string, cookie: string, origin: string): void {
    this.#authority.authorizeCookie(sessionId, cookie, origin);
  }

  authorizeProcessUpload(sessionId: string, capability: string): void {
    this.#requireSession(sessionId);
    this.#authority.authorizeProcessCapability(sessionId, capability);
  }

  authorizeTerminalRetry(sessionId: string, cookie: string, origin: string, proposalId: string): NodeEditorTerminalOutcome {
    const terminal = getNodeEditorTerminal(sessionId);
    if (!terminal || terminal.proposalId !== proposalId) throw new NodeEditorSessionError('proposal-terminal', 'no matching terminal result', 404);
    this.#authority.authorizeTerminalCookie(sessionId, cookie, origin);
    return terminal;
  }

  handleProcessRequest(sessionId: string, capability: string, request: ProxyRequest): ProxyResult {
    const session = this.#requireSession(sessionId);
    if (Buffer.byteLength(JSON.stringify(request)) > this.#maxProtocolBytes) throw new NodeEditorSessionError('resource-limit', 'protocol request exceeds maximum size', 413);
    const requestRecord = request as unknown as Record<string, unknown>;
    const requestId = typeof requestRecord.requestId === 'string' && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(requestRecord.requestId) && requestRecord.requestId.length <= 128
      ? requestRecord.requestId : 'invalid-request';
    const result = (value: ProxyResult): ProxyResult => {
      if (Buffer.byteLength(JSON.stringify(value)) > this.#maxProtocolBytes) return { type: 'protocol.error', requestId, code: 'resource-limit' };
      return value;
    };
    const binding = requestRecord.binding as Record<string, unknown> | undefined;
    if (!binding) return result({ type: 'protocol.error', requestId, code: 'invalid-message' });
    try {
      exactKeys(binding, ['pluginId', 'processId', 'sessionId', 'origin', 'source'], 'process binding');
      this.#authority.authorizeProcess(sessionId, capability, {
      profileId: this.#profile.profile_id,
      pluginId: String(binding.pluginId || ''),
      contributionId: session.plugin.contribution.id,
      processId: String(binding.processId || ''),
      sessionId: String(binding.sessionId || ''),
      origin: String(binding.origin || ''),
      source: binding.source as 'process',
      });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'invalid-message';
      return result({ type: 'protocol.error', requestId, code: code as Extract<ProxyResult, { type: 'protocol.error' }>['code'] });
    }
    if (requestId === 'invalid-request') return result({ type: 'protocol.error', requestId, code: 'invalid-message' });
    const capabilityByType: Record<string, Capability> = {
      'document.read': 'document.read', 'proposal.create': 'proposal.create', 'proposal.status': 'proposal.status',
      'proposal.cancel': 'proposal.cancel', 'session.close': 'session.close',
    };
    const featureByType: Record<string, string> = {
      'document.read': 'document-read', 'proposal.create': 'save-proposal', 'proposal.status': 'proposal-status',
      'proposal.cancel': 'proposal-cancel', 'session.close': 'terminal-close',
    };
    if (!capabilityByType[request.type]) return result({ type: 'protocol.error', requestId, code: 'invalid-message' });
    if (!session.plugin.protocol.capabilities.includes(capabilityByType[request.type])
      || !session.plugin.protocol.features.includes(featureByType[request.type] as never)) {
      return result({ type: 'protocol.error', requestId, code: 'capability-scope-denied' });
    }
    if (session.requestIds.has(requestId)) return result({ type: 'protocol.error', requestId, code: 'duplicate-request' });
    session.requestIds.add(requestId);
    if (request.type === 'document.read') {
      try { exactKeys(requestRecord, ['type', 'requestId', 'binding'], 'document.read'); }
      catch { return result({ type: 'protocol.error', requestId, code: 'invalid-message' }); }
      return result({
        type: 'document.result', requestId, revision: 0, checksum: sri(session.baseChecksumSha256),
        document: { project: session.project, rootAssetId: session.rootAssetId, nodeAssetId: session.nodeAssetId, baseAttemptId: session.baseAttemptId, baseChecksumSha256: session.baseChecksumSha256 },
      });
    }
    if (request.type === 'proposal.create') {
      try {
        exactKeys(requestRecord, ['type', 'requestId', 'binding', 'header', 'document'], 'proposal.create');
        exactKeys(request.header as unknown as Record<string, unknown>, ['proposalId', 'idempotencyKey', 'baseRevision', 'baseChecksum'], 'proposal header');
      } catch { return result({ type: 'protocol.error', requestId, code: 'invalid-message' }); }
      if (session.proposal) return result({ type: 'protocol.error', requestId, code: 'duplicate-proposal' });
      if (request.header.baseChecksum !== sri(session.baseChecksumSha256)) return result({ type: 'protocol.error', requestId, code: 'stale-base' });
      const document = request.document as Record<string, unknown>;
      try { exactKeys(document, ['baseAttemptId', 'mimeType', 'sizeBytes', 'checksumSha256', 'editSummary'], 'proposal content declaration'); }
      catch { return result({ type: 'protocol.error', requestId, code: 'invalid-message' }); }
      const mimeType = document.mimeType;
      const checksum = document.checksumSha256;
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(String(mimeType))
        || !Number.isInteger(document.sizeBytes) || Number(document.sizeBytes) < 1
        || typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum)
        || document.baseAttemptId !== session.baseAttemptId
        || typeof document.editSummary !== 'string' || document.editSummary.length < 1 || document.editSummary.length > 2048
        || !Number.isInteger(request.header.baseRevision) || request.header.baseRevision !== 0
        || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(request.header.proposalId)
        || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(request.header.idempotencyKey)) return result({ type: 'protocol.error', requestId, code: 'invalid-message' });
      session.proposal = {
        proposalId: request.header.proposalId,
        idempotencyKey: request.header.idempotencyKey,
        baseAttemptId: session.baseAttemptId,
        baseChecksum: session.baseChecksumSha256,
        mimeType: mimeType as NodeEditorProposalDeclaration['mimeType'],
        sizeBytes: Number(document.sizeBytes),
        checksumSha256: checksum,
        editSummary: document.editSummary,
      };
      return result({ type: 'proposal.result', requestId, proposalId: session.proposal.proposalId, status: 'pending' });
    }
    if (request.type === 'proposal.status') {
      try { exactKeys(requestRecord, ['type', 'requestId', 'binding', 'proposalId'], 'proposal.status'); }
      catch { return result({ type: 'protocol.error', requestId, code: 'invalid-message' }); }
      const terminal = getNodeEditorTerminal(sessionId);
      if (!session.proposal || session.proposal.proposalId !== request.proposalId) return result({ type: 'protocol.error', requestId, code: 'unknown-proposal' });
      const status = terminal?.outcome === 'accepted' ? 'accepted' : terminal?.outcome === 'cancelled' ? 'cancelled' : terminal?.outcome === 'stale' ? 'rejected' : 'pending';
      return result({ type: 'proposal.result', requestId, proposalId: request.proposalId, status });
    }
    if (request.type === 'proposal.cancel') {
      try { exactKeys(requestRecord, ['type', 'requestId', 'binding', 'proposalId'], 'proposal.cancel'); }
      catch { return result({ type: 'protocol.error', requestId, code: 'invalid-message' }); }
      const proposal = session.proposal;
      if (!proposal || proposal.proposalId !== request.proposalId) return result({ type: 'protocol.error', requestId, code: 'unknown-proposal' });
      recordNodeEditorCancelled(this.#acceptanceInput(session, proposal));
      session.closed = true;
      this.#authority.revoke(sessionId);
      return result({ type: 'proposal.result', requestId, proposalId: request.proposalId, status: 'cancelled' });
    }
    if (request.type === 'session.close') {
      try { exactKeys(requestRecord, ['type', 'requestId', 'binding'], 'session.close'); }
      catch { return result({ type: 'protocol.error', requestId, code: 'invalid-message' }); }
      session.closed = true;
      this.#authority.revoke(sessionId);
      return result({ type: 'session.closed', requestId, closed: true });
    }
    return result({ type: 'protocol.error', requestId, code: 'invalid-message' });
  }

  async upload(sessionId: string, proposalId: string, input: Readable): Promise<NodeEditorTerminalOutcome> {
    const session = this.#requireSession(sessionId);
    const prior = getNodeEditorTerminal(sessionId);
    if (prior) return prior;
    const proposal = session.proposal;
    if (!proposal || proposal.proposalId !== proposalId) throw new NodeEditorSessionError('unknown-proposal', 'proposal is not pending', 404);
    if (proposal.sizeBytes > session.plugin.contribution.accepts.maxBytes) throw new NodeEditorSessionError('resource-limit', 'proposal exceeds plugin byte limit', 413);
    const staged = await stageNodeEditorContent(input, this.#profile.asset_root, proposal, session.plugin.contribution.accepts.maxBytes);
    try {
      const terminalAfterStream = getNodeEditorTerminal(sessionId);
      if (terminalAfterStream) {
        discardStagedNodeEditorContent(staged);
        return terminalAfterStream;
      }
      if (session.closed) throw new NodeEditorSessionError('session-terminal', 'editor session is closed', 409);
      const current = getNodeEditorBase(session.project, session.rootAssetId, session.nodeAssetId);
      if (current.attemptId !== session.baseAttemptId || current.checksumSha256 !== session.baseChecksumSha256) {
        const stale = recordNodeEditorStale({ ...this.#acceptanceInput(session, proposal), content: { ...staged, absolutePath: staged.stagingPath, relativePath: staged.stagingPath } });
        discardStagedNodeEditorContent(staged);
        this.#authority.revoke(sessionId);
        session.closed = true;
        return stale;
      }
      const content = materializeNodeEditorContent(this.#profile.asset_root, staged, this.#inject);
      const outcome = acceptNodeEditorResult({ ...this.#acceptanceInput(session, proposal), content, inject: this.#inject });
      this.#authority.revoke(sessionId);
      session.closed = true;
      return outcome;
    } catch (error) {
      discardStagedNodeEditorContent(staged);
      throw error;
    }
  }

  terminal(sessionId: string): NodeEditorTerminalOutcome | undefined {
    return getNodeEditorTerminal(sessionId);
  }

  /** Unit-test seam only; owner-level integration exercises the real reference process. */
  processAuthorityForTest(sessionId: string): CreatedNodeEditorAuthority {
    return this.#requireSession(sessionId).authority;
  }

  #acceptanceInput(session: EditSession, proposal: NodeEditorProposalDeclaration) {
    return {
      sessionId: session.authority.launch.sessionId, proposalId: proposal.proposalId, idempotencyKey: proposal.idempotencyKey,
      project: session.project, rootAssetId: session.rootAssetId, nodeAssetId: session.nodeAssetId,
      baseAttemptId: session.baseAttemptId, baseChecksumSha256: session.baseChecksumSha256,
      pluginId: session.plugin.manifest.pluginId, contributionId: session.plugin.contribution.id, installation: session.plugin.installation,
      pluginPackageName: session.plugin.manifest.packageName, pluginPackageVersion: session.plugin.manifest.packageVersion,
      protocol: session.plugin.protocol, editSummary: proposal.editSummary ?? 'Editor proposal',
    };
  }

  #requireSession(sessionId: string): EditSession {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new NodeEditorSessionError('session-binding-mismatch', 'unknown editor session', 404);
    return session;
  }
}
