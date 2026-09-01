import { Readable } from 'node:stream';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lineageDb } from '../assetLineageDb';
import { createNodeEditorTestContext, processRequest, sha256, tinyPng } from './testSupport';
import { collectNodeEditorOrphans } from './materialization';
import positiveFixtures from '../../../packages/node-editor-protocol/fixtures/positive.json';
import type { PluginManifest } from '../../../packages/node-editor-protocol/generated/protocol';

const contexts: Array<ReturnType<typeof createNodeEditorTestContext>> = [];
afterEach(async () => Promise.all(contexts.splice(0).map(context => context.supervisor.stopAll())));

async function prepared(name: string, inject?: Parameters<typeof createNodeEditorTestContext>[1]) {
  const context = createNodeEditorTestContext(name, inject);
  contexts.push(context);
  const launch = await context.service.create({ contributionId: 'reference.editor', project: 'test-project', rootAssetId: 'root-asset', nodeAssetId: 'node-asset' });
  const read = processRequest(context.service, launch.sessionId, 'document.read');
  const document = context.service.handleProcessRequest(launch.sessionId, read.capability, read.request);
  const checksum = document.type === 'document.result' ? document.checksum : '';
  const proposal = processRequest(context.service, launch.sessionId, 'proposal.create', {
    header: { proposalId: 'proposal-1', idempotencyKey: `idem-${name}`, baseRevision: 0, baseChecksum: checksum },
    document: { baseAttemptId: 'test-project:node-asset:attempt:implicit', mimeType: 'image/png', sizeBytes: tinyPng.length, checksumSha256: sha256(tinyPng), editSummary: 'Unit test edit' },
  });
  expect(context.service.handleProcessRequest(launch.sessionId, proposal.capability, proposal.request)).toMatchObject({ status: 'pending' });
  return { context, launch };
}

function stagingFiles(context: ReturnType<typeof createNodeEditorTestContext>): string[] {
  const staging = join(context.profile.asset_root, '.lineage', 'node-editor', 'staging');
  return existsSync(staging) ? readdirSync(staging) : [];
}

describe('node editor session service', () => {
  it('supports bounded read, proposal, streamed acceptance, retry, and authority revocation', async () => {
    const { context, launch } = await prepared('service-accepted');
    const outcome = await context.service.upload(launch.sessionId, 'proposal-1', Readable.from([tinyPng]));
    const retry = await context.service.upload(launch.sessionId, 'proposal-1', Readable.from([Buffer.alloc(1_000_000)]));
    expect(outcome).toEqual(retry);
    expect(outcome.outcome).toBe('accepted');
    const authority = context.service.processAuthorityForTest(launch.sessionId);
    const status = processRequest(context.service, launch.sessionId, 'proposal.status', { proposalId: 'proposal-1' });
    expect(context.service.handleProcessRequest(launch.sessionId, authority.processCapability, status.request)).toMatchObject({ type: 'protocol.error', code: 'authority-denied' });
  });

  it('persists deterministic pre-materialization stale outcome', async () => {
    const { context, launch } = await prepared('service-stale');
    const database = lineageDb();
    try { database.prepare("update assets set checksum_sha256 = ? where id = 'node-asset'").run('9'.repeat(64)); }
    finally { database.close(); }
    const stale = await context.service.upload(launch.sessionId, 'proposal-1', Readable.from([tinyPng]));
    const retry = await context.service.upload(launch.sessionId, 'proposal-1', Readable.from([Buffer.alloc(1000)]));
    expect(stale).toEqual({ outcome: 'stale', sessionId: launch.sessionId, proposalId: 'proposal-1', code: 'stale-base' });
    expect(retry).toEqual(stale);
    expect(stagingFiles(context)).toEqual([]);
  });

  it('cleans staging when acceptance fails before materialization', async () => {
    const { context, launch } = await prepared('service-failed-cleanup', point => { if (point === 'before-materialize') throw new Error('before-materialize'); });
    await expect(context.service.upload(launch.sessionId, 'proposal-1', Readable.from([tinyPng]))).rejects.toThrow('before-materialize');
    expect(stagingFiles(context)).toEqual([]);
  });

  it.each(['cancel', 'close'] as const)('protects a live upload from GC and cleans staging after %s', async action => {
    const { context, launch } = await prepared(`service-live-${action}`);
    let startedResolve!: () => void;
    let continueResolve!: () => void;
    const started = new Promise<void>(resolve => { startedResolve = resolve; });
    const continueStream = new Promise<void>(resolve => { continueResolve = resolve; });
    async function* chunks() {
      yield tinyPng.subarray(0, 5);
      startedResolve();
      await continueStream;
      yield tinyPng.subarray(5);
    }
    const uploading = context.service.upload(launch.sessionId, 'proposal-1', Readable.from(chunks()));
    await started;
    const stagingDeadline = Date.now() + 1_000;
    while (stagingFiles(context).length === 0 && Date.now() < stagingDeadline) await new Promise(resolve => setTimeout(resolve, 1));
    expect(stagingFiles(context)).toHaveLength(1);
    expect(collectNodeEditorOrphans(context.profile.asset_root, new Set(), 10, { minimumAgeMs: 0, now: Date.now() + 86_400_000 }).removed).toEqual([]);
    const terminal = processRequest(context.service, launch.sessionId, action === 'cancel' ? 'proposal.cancel' : 'session.close', action === 'cancel' ? { proposalId: 'proposal-1' } : {});
    context.service.handleProcessRequest(launch.sessionId, terminal.capability, terminal.request);
    continueResolve();
    if (action === 'cancel') await expect(uploading).resolves.toMatchObject({ outcome: 'cancelled' });
    else await expect(uploading).rejects.toThrow(/closed/);
    expect(stagingFiles(context)).toEqual([]);
  });

  it('authorizes only the retained terminal cookie for a stale retry after mutation revocation', async () => {
    const { context, launch } = await prepared('service-stale-terminal-cookie');
    const exchanged = context.service.exchange({ ...launch.binding, sessionId: launch.sessionId, launchCredential: launch.launchCredential });
    const database = lineageDb();
    try { database.prepare("update assets set checksum_sha256 = ? where id = 'node-asset'").run('8'.repeat(64)); }
    finally { database.close(); }
    const stale = await context.service.upload(launch.sessionId, 'proposal-1', Readable.from([tinyPng]));
    expect(() => context.service.authorizeBrowser(launch.sessionId, exchanged.cookie, launch.binding.origin)).toThrow();
    expect(context.service.authorizeTerminalRetry(launch.sessionId, exchanged.cookie, launch.binding.origin, 'proposal-1')).toEqual(stale);
  });

  it('rejects oversized protocol JSON before operation dispatch', async () => {
    const context = createNodeEditorTestContext('service-protocol-limit');
    contexts.push(context);
    const launch = await context.service.create({ contributionId: 'reference.editor', project: 'test-project', rootAssetId: 'root-asset', nodeAssetId: 'node-asset' });
    const read = processRequest(context.service, launch.sessionId, 'document.read');
    (read.request as unknown as Record<string, unknown>).padding = 'x'.repeat(70_000);
    expect(() => context.service.handleProcessRequest(launch.sessionId, read.capability, read.request)).toThrow(/maximum size/);
  });

  it('rejects duplicate IDs, strict-field violations, and capabilities outside negotiation', async () => {
    const context = createNodeEditorTestContext('service-conformance');
    contexts.push(context);
    const launch = await context.service.create({ contributionId: 'reference.editor', project: 'test-project', rootAssetId: 'root-asset', nodeAssetId: 'node-asset' });
    const read = processRequest(context.service, launch.sessionId, 'document.read');
    expect(context.service.handleProcessRequest(launch.sessionId, read.capability, read.request).type).toBe('document.result');
    expect(context.service.handleProcessRequest(launch.sessionId, read.capability, read.request)).toMatchObject({ type: 'protocol.error', code: 'duplicate-request' });
    const strict = processRequest(context.service, launch.sessionId, 'document.read');
    strict.request.requestId = 'strict-read';
    (strict.request as unknown as Record<string, unknown>).extra = true;
    expect(context.service.handleProcessRequest(launch.sessionId, strict.capability, strict.request)).toMatchObject({ type: 'protocol.error', code: 'invalid-message' });

    const manifest = structuredClone(positiveFixtures[0].value) as PluginManifest;
    manifest.nodeEditors[0].requestedCapabilities = ['document.read'];
    const restricted = createNodeEditorTestContext('service-capability', undefined, { manifest });
    contexts.push(restricted);
    const restrictedLaunch = await restricted.service.create({ contributionId: 'reference.editor', project: 'test-project', rootAssetId: 'root-asset', nodeAssetId: 'node-asset' });
    const denied = processRequest(restricted.service, restrictedLaunch.sessionId, 'proposal.create', {
      header: { proposalId: 'proposal-denied', idempotencyKey: 'idem-denied', baseRevision: 0, baseChecksum: `sha256-${Buffer.from('2'.repeat(64), 'hex').toString('base64')}` },
      document: { baseAttemptId: 'test-project:node-asset:attempt:implicit', mimeType: 'image/png', sizeBytes: tinyPng.length, checksumSha256: sha256(tinyPng), editSummary: 'Denied' },
    });
    expect(restricted.service.handleProcessRequest(restrictedLaunch.sessionId, denied.capability, denied.request)).toMatchObject({ type: 'protocol.error', code: 'capability-scope-denied' });
  });

  it('bounds protocol responses independently of a valid smaller request', async () => {
    const baseline = createNodeEditorTestContext('service-response-measure');
    contexts.push(baseline);
    const launch = await baseline.service.create({ contributionId: 'reference.editor', project: 'test-project', rootAssetId: 'root-asset', nodeAssetId: 'node-asset' });
    const read = processRequest(baseline.service, launch.sessionId, 'document.read');
    const requestBytes = Buffer.byteLength(JSON.stringify(read.request));
    const bounded = createNodeEditorTestContext('service-response-bound', undefined, { maxProtocolBytes: requestBytes + 8 });
    contexts.push(bounded);
    const boundedLaunch = await bounded.service.create({ contributionId: 'reference.editor', project: 'test-project', rootAssetId: 'root-asset', nodeAssetId: 'node-asset' });
    const boundedRead = processRequest(bounded.service, boundedLaunch.sessionId, 'document.read');
    expect(bounded.service.handleProcessRequest(boundedLaunch.sessionId, boundedRead.capability, boundedRead.request)).toMatchObject({ type: 'protocol.error', code: 'resource-limit' });
  });
});
