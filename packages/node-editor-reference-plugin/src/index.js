import { validateManifest } from '@mean-weasel/lineage-node-editor-protocol';

export const referenceManifest = Object.freeze({
  schemaVersion: 1,
  pluginId: 'reference.editor',
  packageName: '@mean-weasel/lineage-node-editor-reference-plugin',
  packageVersion: '0.1.0',
  displayName: 'Reference editor',
  protocol: [{
    major: 1,
    minMinor: 0,
    maxMinor: 3,
    features: ['document-read', 'document-content', 'save-proposal', 'proposal-status', 'proposal-cancel', 'terminal-close'],
    requiredFeatures: ['document-read', 'save-proposal', 'terminal-close']
  }],
  nodeEditors: [{
    kind: 'nodeEditor',
    id: 'reference.editor',
    displayName: 'Reference editor',
    accepts: { mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'], maxBytes: 10_000_000 },
    editor: { entrypoint: 'editor/index.html', origin: 'https://editor.test.invalid' },
    minimumViewport: { width: 640, height: 480 },
    requestedCapabilities: ['document.read', 'proposal.create', 'proposal.status', 'proposal.cancel', 'session.close'],
    health: { kind: 'process-heartbeat', intervalMs: 5_000, timeoutMs: 1_000 }
  }]
});

validateManifest(referenceManifest);

export const referenceHostSupport = Object.freeze([{
  major: 1,
  minMinor: 0,
  maxMinor: 3,
  features: ['document-read', 'document-content', 'save-proposal', 'proposal-status', 'proposal-cancel', 'terminal-close'],
  requiredFeatures: ['terminal-close']
}]);

/** @param {import('@mean-weasel/lineage-node-editor-protocol/fake-host').FakeNodeEditorHost} host */
export function runReferenceFlow(host) {
  const negotiated = host.prepare(referenceManifest, referenceHostSupport);
  const bootstrap = host.issueBootstrap();
  const authority = host.exchangeBootstrap({ credential: bootstrap.bootstrapCredential, source: 'process' });
  const ui = host.consumeUiLaunch({ credential: authority.uiLaunchCredential, binding: authority.uiBinding });
  const read = host.proxy({ capability: authority.processCapability, request: { type: 'document.read', requestId: 'read-1', binding: authority.processBinding } });
  const proposal = host.proxy({
    capability: authority.processCapability,
    request: {
      type: 'proposal.create', requestId: 'propose-1', binding: authority.processBinding,
      header: { proposalId: 'proposal-1', idempotencyKey: 'reference-flow-1', baseRevision: read.revision, baseChecksum: read.checksum },
      document: { ...read.document, editedBy: 'reference.editor' }
    }
  });
  host.acceptProposal(proposal.proposalId);
  const status = host.proxy({ capability: authority.processCapability, request: { type: 'proposal.status', requestId: 'status-1', binding: authority.processBinding, proposalId: proposal.proposalId } });
  const closed = host.proxy({ capability: authority.processCapability, request: { type: 'session.close', requestId: 'close-1', binding: authority.processBinding } });
  return { negotiated, ui, read, proposal, status, closed, trace: host.getRedactedTrace() };
}
