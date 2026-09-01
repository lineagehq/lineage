import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { FakeNodeEditorHost } from '../src/fake-host.js';
import { ProtocolError } from '../src/index.js';

const positive = JSON.parse(await readFile(new URL('../fixtures/positive.json', import.meta.url), 'utf8'));
const manifest = positive.find(fixture => fixture.validator === 'manifest').value;
const hostSupport = [{ major: 1, minMinor: 0, maxMinor: 2, features: ['document-read', 'save-proposal', 'proposal-status', 'proposal-cancel', 'terminal-close'], requiredFeatures: ['terminal-close'] }];

function assertCode(callback, code) {
  assert.throws(callback, error => error instanceof ProtocolError && error.code === code);
}

function readyHost(options = {}, selectedManifest = manifest) {
  const host = new FakeNodeEditorHost({ document: { nodes: [{ id: 'one' }] }, now: () => 100, ...options });
  const negotiated = host.prepare(selectedManifest, hostSupport);
  const bootstrap = host.issueBootstrap();
  const authority = host.exchangeBootstrap({ credential: bootstrap.bootstrapCredential, source: 'process' });
  const proxy = request => host.proxy({ capability: authority.processCapability, request: { ...request, binding: authority.processBinding } });
  return { host, negotiated, bootstrap, authority, proxy };
}

test('manifest requests and negotiated features produce exact grants and descriptor capabilities', () => {
  const readOnly = structuredClone(manifest);
  readOnly.nodeEditors[0].requestedCapabilities = ['document.read'];
  readOnly.protocol[0].features = ['document-read'];
  readOnly.protocol[0].requiredFeatures = ['document-read'];
  const support = [{ major: 1, minMinor: 0, maxMinor: 2, features: ['document-read'], requiredFeatures: ['document-read'] }];
  const host = new FakeNodeEditorHost();
  const negotiated = host.prepare(readOnly, support);
  assert.deepEqual(negotiated.capabilities, ['document.read']);
  const bootstrap = host.issueBootstrap();
  const authority = host.exchangeBootstrap({ credential: bootstrap.bootstrapCredential, source: 'process' });
  const descriptor = host.consumeUiLaunch({ credential: authority.uiLaunchCredential, binding: authority.uiBinding });
  assert.deepEqual(descriptor.capabilities, negotiated.capabilities);
  const denied = [
    { type: 'proposal.create', requestId: 'denied-create-1', binding: authority.processBinding, header: { proposalId: 'proposal-1', idempotencyKey: 'key-1', baseRevision: 1, baseChecksum: 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=' }, document: {} },
    { type: 'proposal.status', requestId: 'denied-status-1', binding: authority.processBinding, proposalId: 'proposal-1' },
    { type: 'proposal.cancel', requestId: 'denied-cancel-1', binding: authority.processBinding, proposalId: 'proposal-1' },
    { type: 'session.close', requestId: 'denied-close-1', binding: authority.processBinding }
  ];
  for (const request of denied) assertCode(() => host.proxy({ capability: authority.processCapability, request }), 'capability-scope-denied');
});

test('bootstrap, process, and UI authorities are distinct, bound, single-use, and recursively redacted', () => {
  const { host, bootstrap, authority } = readyHost();
  assert.notEqual(bootstrap.bootstrapCredential, authority.processCapability);
  assert.notEqual(authority.processCapability, authority.uiLaunchCredential);
  assertCode(() => host.exchangeBootstrap({ credential: bootstrap.bootstrapCredential, source: 'process' }), 'capability-replayed');
  const wrongUi = structuredClone(authority.uiBinding);
  wrongUi.origin = 'https://wrong.test.invalid';
  assertCode(() => host.consumeUiLaunch({ credential: authority.uiLaunchCredential, binding: wrongUi }), 'origin-binding-mismatch');
  const descriptor = host.consumeUiLaunch({ credential: authority.uiLaunchCredential, binding: authority.uiBinding });
  assert.deepEqual(descriptor.capabilities, authority.processBinding ? host.grants : []);
  assertCode(() => host.consumeUiLaunch({ credential: authority.uiLaunchCredential, binding: authority.uiBinding }), 'capability-replayed');
  const read = host.proxy({ capability: authority.processCapability, request: { type: 'document.read', requestId: 'redaction-read-1', binding: authority.processBinding } });
  const embedded = `${bootstrap.bootstrapCredential}/${authority.processCapability}/${authority.uiLaunchCredential}/${authority.processCapability}`;
  const sourceDocument = { nodes: [{ nested: [`https://trace.invalid/${embedded}`, { repeated: embedded }] }] };
  const sourceSnapshot = structuredClone(sourceDocument);
  host.proxy({ capability: authority.processCapability, request: { type: 'proposal.create', requestId: 'redaction-1', binding: authority.processBinding, header: { proposalId: 'redaction-1', idempotencyKey: 'redaction-key-1', baseRevision: read.revision, baseChecksum: read.checksum }, document: sourceDocument } });
  const transcript = JSON.stringify(host.getRedactedTrace());
  for (const secret of [bootstrap.bootstrapCredential, authority.processCapability, authority.uiLaunchCredential]) assert.equal(transcript.includes(secret), false);
  assert.deepEqual(sourceDocument, sourceSnapshot);
});

test('process requests enforce every schema-derived binding with exact denial codes', () => {
  const { host, authority } = readyHost();
  const matrix = [
    ['pluginId', 'wrong.plugin', 'plugin-binding-mismatch'],
    ['processId', 'wrong-process', 'process-binding-mismatch'],
    ['sessionId', 'wrong-session', 'session-binding-mismatch'],
    ['origin', 'https://wrong.test.invalid', 'origin-binding-mismatch'],
    ['source', 'iframe-1', 'source-binding-mismatch']
  ];
  for (const [index, [field, value, code]] of matrix.entries()) {
    const binding = { ...authority.processBinding, [field]: value };
    assertCode(() => host.proxy({ capability: authority.processCapability, request: { type: 'document.read', requestId: `binding-${index}`, binding } }), code);
  }
});

test('read, stale, duplicate, status, terminal proposal, and terminal session outcomes have exact codes', () => {
  const { host, authority, proxy } = readyHost();
  const read = proxy({ type: 'document.read', requestId: 'read-1' });
  const header = { proposalId: 'proposal-1', idempotencyKey: 'idempotency-1', baseRevision: read.revision, baseChecksum: read.checksum };
  assertCode(() => proxy({ type: 'proposal.create', requestId: 'stale-1', header: { ...header, baseRevision: read.revision + 1 }, document: {} }), 'stale-base');
  const proposal = proxy({ type: 'proposal.create', requestId: 'propose-1', header, document: { nodes: [] } });
  assertCode(() => proxy({ type: 'proposal.create', requestId: 'propose-2', header, document: {} }), 'duplicate-proposal');
  host.acceptProposal(proposal.proposalId);
  assert.equal(proxy({ type: 'proposal.status', requestId: 'status-1', proposalId: proposal.proposalId }).status, 'accepted');
  assertCode(() => proxy({ type: 'proposal.cancel', requestId: 'cancel-1', proposalId: proposal.proposalId }), 'proposal-terminal');
  assert.equal(proxy({ type: 'session.close', requestId: 'close-1' }).closed, true);
  assertCode(() => host.proxy({ capability: authority.processCapability, request: { type: 'document.read', requestId: 'read-2', binding: authority.processBinding } }), 'session-terminal');
});

test('duplicate request IDs and host acceptance after close fail exactly without document mutation', () => {
  const duplicate = readyHost();
  duplicate.proxy({ type: 'document.read', requestId: 'duplicate-1' });
  assertCode(() => duplicate.proxy({ type: 'document.read', requestId: 'duplicate-1' }), 'duplicate-request');

  const terminal = readyHost();
  const read = terminal.proxy({ type: 'document.read', requestId: 'terminal-read-1' });
  const proposal = terminal.proxy({ type: 'proposal.create', requestId: 'terminal-proposal-1', header: { proposalId: 'terminal-proposal-1', idempotencyKey: 'terminal-key-1', baseRevision: read.revision, baseChecksum: read.checksum }, document: { nodes: [{ id: 'replacement' }] } });
  const documentBeforeClose = structuredClone(terminal.host.document);
  terminal.proxy({ type: 'session.close', requestId: 'terminal-close-1' });
  assertCode(() => terminal.host.acceptProposal(proposal.proposalId), 'session-terminal');
  assert.deepEqual(terminal.host.document, documentBeforeClose);
});

test('expiry and revocation reject process capabilities with exact codes', () => {
  let time = 100;
  const host = new FakeNodeEditorHost({ now: () => time });
  host.prepare(manifest, hostSupport);
  const bootstrap = host.issueBootstrap();
  const authority = host.exchangeBootstrap({ credential: bootstrap.bootstrapCredential, source: 'process' });
  time = 20_000;
  assertCode(() => host.proxy({ capability: authority.processCapability, request: { type: 'document.read', requestId: 'read-1', binding: authority.processBinding } }), 'capability-expired');
  const revoked = readyHost();
  revoked.host.revokeProcessCapability();
  assertCode(() => revoked.proxy({ type: 'document.read', requestId: 'read-1' }), 'capability-revoked');
});

test('document, proposal, idempotency, request, and trace state have configurable finite ceilings', () => {
  assertCode(() => new FakeNodeEditorHost({ document: { oversized: true }, limits: { maxDocumentBytes: 2 } }), 'resource-limit');

  const requests = readyHost({ limits: { maxRequests: 1 } });
  requests.proxy({ type: 'document.read', requestId: 'read-1' });
  assertCode(() => requests.proxy({ type: 'document.read', requestId: 'read-2' }), 'resource-limit');

  const proposals = readyHost({ limits: { maxProposals: 1, maxIdempotencyKeys: 2 } });
  const read = proposals.proxy({ type: 'document.read', requestId: 'read-1' });
  proposals.proxy({ type: 'proposal.create', requestId: 'proposal-1', header: { proposalId: 'proposal-1', idempotencyKey: 'key-1', baseRevision: read.revision, baseChecksum: read.checksum }, document: {} });
  assertCode(() => proposals.proxy({ type: 'proposal.create', requestId: 'proposal-2', header: { proposalId: 'proposal-2', idempotencyKey: 'key-2', baseRevision: read.revision, baseChecksum: read.checksum }, document: {} }), 'resource-limit');

  const traces = readyHost({ limits: { maxTraceEntries: 3 } });
  assertCode(() => traces.proxy({ type: 'document.read', requestId: 'read-1' }), 'resource-limit');
});
