import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { lineageDb } from '../assetLineageDb';
import { createNodeEditorTestContext, forbiddenStateSnapshot, processRequest, sha256, tinyPng } from './testSupport';

const contexts: Array<ReturnType<typeof createNodeEditorTestContext>> = [];
afterEach(async () => Promise.all(contexts.splice(0).map(context => context.supervisor.stopAll())));

describe('complete node editor edit session', () => {
  it('accepts a streamed edit without mutating graph, claims, queue/tasks, rerolls, or unrelated node fields', async () => {
    const context = createNodeEditorTestContext('vertical');
    contexts.push(context);
    const beforeForbidden = forbiddenStateSnapshot();
    const databaseBefore = lineageDb();
    const nodeBefore = databaseBefore.prepare("select title, channel, campaign, audience from assets where id = 'node-asset'").get();
    databaseBefore.close();
    const launch = await context.service.create({ contributionId: 'reference.editor', project: 'test-project', rootAssetId: 'root-asset', nodeAssetId: 'node-asset' });
    const read = processRequest(context.service, launch.sessionId, 'document.read');
    const document = context.service.handleProcessRequest(launch.sessionId, read.capability, read.request);
    if (document.type !== 'document.result') throw new Error('expected document result');
    const proposal = processRequest(context.service, launch.sessionId, 'proposal.create', {
      header: { proposalId: 'proposal-vertical', idempotencyKey: 'idem-vertical', baseRevision: document.revision, baseChecksum: document.checksum },
      document: { baseAttemptId: 'test-project:node-asset:attempt:implicit', mimeType: 'image/png', sizeBytes: tinyPng.length, checksumSha256: sha256(tinyPng), editSummary: 'Vertical test edit' },
    });
    context.service.handleProcessRequest(launch.sessionId, proposal.capability, proposal.request);
    const outcome = await context.service.upload(launch.sessionId, 'proposal-vertical', Readable.from([tinyPng.subarray(0, 5), tinyPng.subarray(5)]));
    expect(outcome.outcome).toBe('accepted');
    expect(forbiddenStateSnapshot()).toEqual(beforeForbidden);
    const databaseAfter = lineageDb();
    try {
      expect(databaseAfter.prepare("select title, channel, campaign, audience from assets where id = 'node-asset'").get()).toEqual(nodeBefore);
      expect(databaseAfter.prepare("select count(*) count from asset_attempts where source='editor' and is_current=1").get()).toEqual({ count: 1 });
    } finally { databaseAfter.close(); }
  });
});
