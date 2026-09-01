import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeNodeEditorHost } from '@mean-weasel/lineage-node-editor-protocol/fake-host';
import { runReferenceFlow } from '../src/index.js';

test('reference plugin completes read-propose-status-close through public contracts', () => {
  const receipt = runReferenceFlow(new FakeNodeEditorHost({ document: { nodes: [] } }));
  assert.deepEqual(receipt.negotiated, {
    major: 1,
    minor: 2,
    features: ['document-read', 'proposal-cancel', 'proposal-status', 'save-proposal', 'terminal-close'],
    capabilities: ['document.read', 'proposal.cancel', 'proposal.create', 'proposal.status', 'session.close']
  });
  assert.equal(receipt.proposal.status, 'pending');
  assert.equal(receipt.status.status, 'accepted');
  assert.equal(receipt.closed.closed, true);
  const transcript = JSON.stringify(receipt.trace);
  assert.equal(transcript.includes('process_'), false);
  assert.equal(transcript.includes('ui_launch_'), false);
  assert.equal(transcript.includes('bootstrap_'), false);
});
