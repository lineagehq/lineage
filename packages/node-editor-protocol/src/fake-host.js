import { createHash } from 'node:crypto';
import { assertWireValue, negotiateProtocol, ProtocolError, validateManifest } from './index.js';

const REDACTED = '[redacted]';
/** @type {Readonly<Record<string, string>>} */
const capabilityFeatures = Object.freeze({
  'document.read': 'document-read',
  'proposal.create': 'save-proposal',
  'proposal.status': 'proposal-status',
  'proposal.cancel': 'proposal-cancel',
  'session.close': 'terminal-close'
});
/** @type {Readonly<Record<string, string>>} */
const requestCapabilities = Object.freeze({
  'document.read': 'document.read',
  'proposal.create': 'proposal.create',
  'proposal.status': 'proposal.status',
  'proposal.cancel': 'proposal.cancel',
  'session.close': 'session.close'
});
const defaultLimits = Object.freeze({
  maxDocumentBytes: 1_000_000,
  maxProposals: 100,
  maxIdempotencyKeys: 100,
  maxRequests: 1_000,
  maxTraceEntries: 2_000
});

/** @param {unknown} value */
function checksum(value) {
  return `sha256-${createHash('sha256').update(JSON.stringify(value)).digest('base64')}`;
}

/** @param {unknown} value */
function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/** @param {Record<string, number>} limits */
function validateLimits(limits) {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new ProtocolError('resource-limit', `${name} must be a finite positive safe integer`);
  }
}

/** A bounded in-memory conformance model, not an OS security boundary. */
export class FakeNodeEditorHost {
  /** @param {{ document?: Record<string, unknown>, now?: () => number, origin?: string, processOrigin?: string, uiSource?: string, limits?: Partial<typeof defaultLimits> }} [options] */
  constructor(options = {}) {
    this.now = options.now ?? (() => Date.now());
    this.origin = options.origin ?? 'https://editor.test.invalid';
    this.processOrigin = options.processOrigin ?? 'https://process.test.invalid';
    this.uiSource = options.uiSource ?? 'iframe-1';
    this.limits = { ...defaultLimits, ...options.limits };
    validateLimits(this.limits);
    this.document = structuredClone(options.document ?? { nodes: [] });
    if (byteLength(this.document) > this.limits.maxDocumentBytes) throw new ProtocolError('resource-limit', 'initial document exceeds maxDocumentBytes');
    this.revision = 1;
    this.proposals = new Map();
    this.idempotencyKeys = new Set();
    this.requestIds = new Set();
    /** @type {Array<Record<string, unknown>>} */
    this.trace = [];
    this.sensitiveValues = new Set();
    this.sequence = 0;
    this.terminal = false;
    this.bootstrap = null;
    this.process = null;
    this.uiLaunch = null;
    this.negotiated = null;
    this.manifest = null;
    this.editor = null;
    /** @type {string[]} */
    this.grants = [];
  }

  /** @param {string} label */
  token(label) {
    this.sequence += 1;
    const token = `${label}_${String(this.sequence).padStart(24, '0')}`;
    this.sensitiveValues.add(token);
    return token;
  }

  /** @param {unknown} value @param {string} [key] @returns {unknown} */
  redact(value, key = '') {
    if (/credential|capability|token|cookie|authorization/i.test(key)) return REDACTED;
    if (typeof value === 'string') {
      let redacted = value;
      for (const secret of this.sensitiveValues) redacted = redacted.split(secret).join(REDACTED);
      return redacted;
    }
    if (Array.isArray(value)) return value.map(item => this.redact(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [nestedKey, this.redact(nestedValue, nestedKey)]));
    }
    return value;
  }

  /** @param {string} event @param {Record<string, unknown>} [details] */
  record(event, details = {}) {
    if (this.trace.length >= this.limits.maxTraceEntries) throw new ProtocolError('resource-limit', 'trace entry limit exceeded');
    this.trace.push({ event, .../** @type {Record<string, unknown>} */ (this.redact(details)) });
  }

  /** @param {unknown} manifest @param {unknown} hostSupport */
  prepare(manifest, hostSupport) {
    validateManifest(manifest);
    const typedManifest = /** @type {Record<string, any>} */ (manifest);
    const editor = typedManifest.nodeEditors[0];
    if (editor.editor.origin !== this.origin) throw new ProtocolError('origin-binding-mismatch', 'manifest editor origin does not match host editor origin');
    const negotiated = negotiateProtocol(hostSupport, typedManifest.protocol);
    this.negotiated = negotiated;
    this.grants = /** @type {string[]} */ (editor.requestedCapabilities)
      .filter(capability => negotiated.features.includes(capabilityFeatures[capability]))
      .sort();
    this.manifest = typedManifest;
    this.editor = editor;
    this.record('protocol.negotiated', { ...negotiated, capabilities: this.grants });
    return { ...negotiated, capabilities: [...this.grants] };
  }

  issueBootstrap() {
    if (!this.negotiated || !this.manifest) throw new ProtocolError('negotiation-required', 'negotiate before delivering capabilities');
    const envelope = {
      type: 'bootstrap', pluginId: this.manifest.pluginId, processId: 'process-1', sessionId: 'session-1',
      bootstrapCredential: this.token('bootstrap'), expiresAt: this.now() + 1_000
    };
    assertWireValue('BootstrapEnvelope', envelope);
    this.bootstrap = { value: envelope.bootstrapCredential, expiresAt: envelope.expiresAt, used: false, pluginId: envelope.pluginId, processId: envelope.processId, sessionId: envelope.sessionId };
    this.record('bootstrap.issued', { envelope });
    return envelope;
  }

  /** @param {{ credential: string, source: string }} input */
  exchangeBootstrap(input) {
    if (input.source !== 'process') throw new ProtocolError('source-binding-mismatch', 'bootstrap exchange is process-only');
    if (!this.bootstrap || input.credential !== this.bootstrap.value) throw new ProtocolError('capability-replayed', 'unknown bootstrap credential');
    if (this.bootstrap.used) throw new ProtocolError('capability-replayed', 'bootstrap credential already used');
    if (this.now() >= this.bootstrap.expiresAt) throw new ProtocolError('capability-expired', 'bootstrap credential expired');
    this.bootstrap.used = true;
    const processBinding = { pluginId: this.bootstrap.pluginId, processId: this.bootstrap.processId, sessionId: this.bootstrap.sessionId, origin: this.processOrigin, source: 'process' };
    const uiBinding = { pluginId: this.bootstrap.pluginId, sessionId: this.bootstrap.sessionId, origin: this.origin, source: this.uiSource };
    const result = {
      type: 'bootstrap.accepted', processCapability: this.token('process'), uiLaunchCredential: this.token('ui-launch'), processBinding, uiBinding, expiresAt: this.now() + 10_000
    };
    assertWireValue('BootstrapExchangeResult', result);
    this.process = { value: result.processCapability, binding: processBinding, expiresAt: result.expiresAt, revoked: false, grants: [...this.grants] };
    this.uiLaunch = { value: result.uiLaunchCredential, binding: uiBinding, expiresAt: result.expiresAt, used: false };
    this.record('bootstrap.exchanged', { result });
    return result;
  }

  /** @param {{ credential: string, binding: Record<string, unknown> }} input */
  consumeUiLaunch(input) {
    if (!this.uiLaunch || input.credential !== this.uiLaunch.value || this.uiLaunch.used) throw new ProtocolError('capability-replayed', 'UI launch credential is unknown or used');
    if (this.now() >= this.uiLaunch.expiresAt) throw new ProtocolError('capability-expired', 'UI launch credential expired');
    this.assertBinding(input.binding, this.uiLaunch.binding, false);
    this.uiLaunch.used = true;
    this.record('ui.launch-consumed', { input });
    const negotiated = this.negotiated;
    if (!negotiated) throw new ProtocolError('negotiation-required', 'negotiation state is unavailable');
    const descriptor = {
      type: 'session.descriptor', sessionId: this.uiLaunch.binding.sessionId, pluginId: this.uiLaunch.binding.pluginId,
      origin: this.uiLaunch.binding.origin, protocol: { major: negotiated.major, minor: negotiated.minor },
      features: [...negotiated.features], capabilities: [...this.grants]
    };
    assertWireValue('SessionDescriptor', descriptor);
    return descriptor;
  }

  revokeProcessCapability() {
    if (this.process) this.process.revoked = true;
    this.record('process.revoked');
  }

  /** @param {Record<string, unknown>} actual @param {Record<string, unknown>} expected @param {boolean} process */
  assertBinding(actual, expected, process) {
    if (actual.pluginId !== expected.pluginId) throw new ProtocolError('plugin-binding-mismatch', 'plugin binding mismatch');
    if (process && actual.processId !== expected.processId) throw new ProtocolError('process-binding-mismatch', 'process binding mismatch');
    if (actual.sessionId !== expected.sessionId) throw new ProtocolError('session-binding-mismatch', 'session binding mismatch');
    if (actual.origin !== expected.origin) throw new ProtocolError('origin-binding-mismatch', 'origin binding mismatch');
    if (actual.source !== expected.source) throw new ProtocolError('source-binding-mismatch', 'source binding mismatch');
  }

  /** @param {{ capability: string, request: unknown }} input */
  proxy(input) {
    if (!this.process || input.capability !== this.process.value) throw new ProtocolError('capability-replayed', 'unknown process capability');
    if (this.process.revoked) throw new ProtocolError('capability-revoked', 'process capability revoked');
    if (this.now() >= this.process.expiresAt) throw new ProtocolError('capability-expired', 'process capability expired');
    assertWireValue('ProxyRequest', input.request);
    const request = /** @type {Record<string, any>} */ (input.request);
    this.assertBinding(request.binding, this.process.binding, true);
    if (this.terminal) throw new ProtocolError('session-terminal', 'session is terminal');
    const requiredCapability = requestCapabilities[request.type];
    if (!this.process.grants.includes(requiredCapability)) throw new ProtocolError('capability-scope-denied', `${request.type} is outside effective grants`);
    if (this.requestIds.has(request.requestId)) throw new ProtocolError('duplicate-request', 'requestId already used');
    if (this.requestIds.size >= this.limits.maxRequests) throw new ProtocolError('resource-limit', 'request limit exceeded');
    this.requestIds.add(request.requestId);
    this.record('proxy.request', { request, processCapability: input.capability });
    let result;
    if (request.type === 'document.read') {
      result = { type: 'document.result', requestId: request.requestId, revision: this.revision, checksum: checksum(this.document), document: structuredClone(this.document) };
    } else if (request.type === 'proposal.create') {
      if (byteLength(request.document) > this.limits.maxDocumentBytes) throw new ProtocolError('resource-limit', 'proposed document exceeds maxDocumentBytes');
      if (request.header.baseRevision !== this.revision || request.header.baseChecksum !== checksum(this.document)) throw new ProtocolError('stale-base', 'proposal base is stale');
      if (this.idempotencyKeys.has(request.header.idempotencyKey) || this.proposals.has(request.header.proposalId)) throw new ProtocolError('duplicate-proposal', 'proposal or idempotency key already exists');
      if (this.proposals.size >= this.limits.maxProposals || this.idempotencyKeys.size >= this.limits.maxIdempotencyKeys) throw new ProtocolError('resource-limit', 'proposal or idempotency limit exceeded');
      this.idempotencyKeys.add(request.header.idempotencyKey);
      this.proposals.set(request.header.proposalId, { status: 'pending', document: structuredClone(request.document) });
      result = { type: 'proposal.result', requestId: request.requestId, proposalId: request.header.proposalId, status: 'pending' };
    } else if (request.type === 'proposal.status') {
      const proposal = this.proposals.get(request.proposalId);
      if (!proposal) throw new ProtocolError('unknown-proposal', 'proposal does not exist');
      result = { type: 'proposal.result', requestId: request.requestId, proposalId: request.proposalId, status: proposal.status };
    } else if (request.type === 'proposal.cancel') {
      const proposal = this.proposals.get(request.proposalId);
      if (!proposal) throw new ProtocolError('unknown-proposal', 'proposal does not exist');
      if (proposal.status !== 'pending') throw new ProtocolError('proposal-terminal', 'terminal proposal cannot transition');
      proposal.status = 'cancelled';
      result = { type: 'proposal.result', requestId: request.requestId, proposalId: request.proposalId, status: proposal.status };
    } else {
      this.terminal = true;
      result = { type: 'session.closed', requestId: request.requestId, closed: true };
    }
    assertWireValue('ProxyResult', result);
    return result;
  }

  /** @param {string} proposalId */
  acceptProposal(proposalId) {
    if (this.terminal) throw new ProtocolError('session-terminal', 'session is terminal');
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new ProtocolError('unknown-proposal', 'proposal does not exist');
    if (proposal.status !== 'pending') throw new ProtocolError('proposal-terminal', 'terminal proposal cannot transition');
    proposal.status = 'accepted';
    this.document = structuredClone(proposal.document);
    this.revision += 1;
  }

  getRedactedTrace() {
    return structuredClone(this.trace);
  }
}
