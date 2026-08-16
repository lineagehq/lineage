import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { createAgentClaim } from '../agentClaims';
import { defaultProject, repoRoot } from '../assetCore';
import { indexLineageAssets } from '../assetLineage';
import { lineageDb, nowIso } from '../assetLineageDb';
import { lineageWorkspaceId } from '../assetLineageWorkspaces';
import { fileSha256 } from '../localReview';
import { BUFFER_CAPABILITY_REGISTRY_VERSION, canonicalBufferCapabilityJson } from '../adapters/buffer/bufferCapabilities';
import { registerSocialMarkRoutes } from './socialRoutes';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-canonical-social-routes');
const dbFile = join(scratchDir, 'lineage.sqlite');
let server: Server | undefined;

beforeEach(() => {
  rmSync(scratchDir, { force: true, recursive: true });
  mkdirSync(scratchDir, { recursive: true });
  useLineageTestProfile(dbFile);
});

afterEach(() => {
  server?.close();
  server = undefined;
  rmSync(scratchDir, { force: true, recursive: true });
});

function seedRoot(): string {
  const file = join(scratchDir, 'canonical-http-root.png');
  writeFileSync(file, Buffer.from('canonical-http-root'));
  indexLineageAssets(defaultProject);
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function startServer(): string {
  const app = express();
  app.use(express.json());
  registerSocialMarkRoutes(app, input => {
    const candidate = input.body?.project || input.query?.project;
    return typeof candidate === 'string' ? candidate : defaultProject;
  }, handler => (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof Error && 'status' in error ? Number(error.status) : 500;
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  });
  server = app.listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('canonical Social-mark HTTP transport', () => {
  it('does not register any provider-mutation or legacy delivery-lifecycle routes', async () => {
    const baseUrl = startServer();
    const paths = [
      '/api/social/qa/gate5-scenarios',
      '/api/social/variants/variant-1/schedule',
      '/api/social/deliveries/operation-1',
      '/api/social/deliveries/operation-1/reconcile',
      '/api/social/deliveries/operation-1/adopt',
      '/api/social/deliveries/operation-1/lifecycle-preview',
      '/api/social/deliveries/operation-1/lifecycle-confirm',
      '/api/social/deliveries/operation-1/lease',
    ];
    for (const path of paths) {
      const response = await fetch(`${baseUrl}${path}`, { method: path.endsWith('operation-1') ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: path.endsWith('operation-1') ? undefined : JSON.stringify({ project: defaultProject }) });
      expect(response.status, path).toBe(404);
    }
  });

  it('executes list, dry-run, confirmed, claim-token, and schema-versioned contracts', async () => {
    const rootAssetId = seedRoot();
    const baseUrl = startServer();
    const route = `${baseUrl}/api/lineage/${rootAssetId}/social-marks/${rootAssetId}`;
    const request = (url: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => fetch(url, {
      body: JSON.stringify({ project: defaultProject, ...body }),
      headers: { 'Content-Type': 'application/json', ...headers },
      method: 'POST',
    });

    const dryMarkResponse = await request(route, { actor: 'agent:http', confirmWrite: false, notes: 'Preview only' });
    expect(dryMarkResponse.status).toBe(200);
    await expect(dryMarkResponse.json()).resolves.toMatchObject({
      active: true,
      dryRun: true,
      schema_version: 'lineage.social_mark_mutation.v1',
    });
    const emptyResponse = await fetch(`${baseUrl}/api/lineage/${rootAssetId}/social-marks?project=${defaultProject}`);
    await expect(emptyResponse.json()).resolves.toMatchObject({ marks: [], schema_version: 'lineage.social_marks.v1' });

    const claim = createAgentClaim({
      agentName: 'HTTP Social agent',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(defaultProject, rootAssetId),
    });
    const missingClaimResponse = await request(route, { actor: 'agent:http', confirmWrite: true });
    expect(missingClaimResponse.status).toBe(401);

    const confirmedMarkResponse = await request(route, { actor: 'agent:http', confirmWrite: true }, {
      'X-Lineage-Claim-Token': claim.claim_token,
    });
    expect(confirmedMarkResponse.status).toBe(200);
    await expect(confirmedMarkResponse.json()).resolves.toMatchObject({
      active: true,
      schema_version: 'lineage.social_mark_mutation.v1',
      snapshot: { nodes: [expect.objectContaining({ social_mark: expect.objectContaining({ active: true }) })] },
    });
    const listedResponse = await fetch(`${baseUrl}/api/lineage/${rootAssetId}/social-marks?project=${defaultProject}`);
    await expect(listedResponse.json()).resolves.toMatchObject({ marks: [expect.objectContaining({ asset_id: rootAssetId })] });

    const dryUnmarkResponse = await request(`${route}/unmark`, { actor: 'agent:http', confirmWrite: false });
    await expect(dryUnmarkResponse.json()).resolves.toMatchObject({
      active: false,
      dryRun: true,
      schema_version: 'lineage.social_mark_mutation.v1',
    });
    const stillListedResponse = await fetch(`${baseUrl}/api/lineage/${rootAssetId}/social-marks?project=${defaultProject}`);
    await expect(stillListedResponse.json()).resolves.toMatchObject({ marks: [expect.objectContaining({ asset_id: rootAssetId })] });

    const confirmedUnmarkResponse = await request(`${route}/unmark`, {
      actor: 'agent:http',
      claimToken: claim.claim_token,
      confirmWrite: true,
    });
    expect(confirmedUnmarkResponse.status).toBe(200);
    await expect(confirmedUnmarkResponse.json()).resolves.toMatchObject({
      active: false,
      schema_version: 'lineage.social_mark_mutation.v1',
      snapshot: { nodes: [expect.not.objectContaining({ social_mark: expect.anything() })] },
    });
    const finalListResponse = await fetch(`${baseUrl}/api/lineage/${rootAssetId}/social-marks?project=${defaultProject}`);
    await expect(finalListResponse.json()).resolves.toMatchObject({ marks: [] });
  });

  it('transports claimed item promotion, immutable variant edits, validation, conflicts, and tenant isolation', async () => {
    const rootAssetId = seedRoot(); const baseUrl = startServer();
    const post = (path: string, body: Record<string, unknown>, token?: string) => fetch(`${baseUrl}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Lineage-Claim-Token': token } : {}) },
      body: JSON.stringify({ project: defaultProject, ...body }),
    });
    await post(`/api/lineage/${rootAssetId}/social-marks/${rootAssetId}`, { actor: 'human:http', confirmWrite: true });
    const database = lineageDb(); const timestamp = nowIso();
    try {
      database.prepare(`insert into buffer_channels (project_id, channel_id, organization_id, service, service_id, display_name, avatar_ref, timezone, posting_schedule_json, allowed_actions_json, capability_json, disconnected, locked, paused, available, capability_registry_version, provider_fingerprint, synced_at, stale_at)
        values (?, 'channel-http', 'org-http', 'instagram', null, 'HTTP channel', null, null, ?, '[]', ?, 0, 0, 0, 1, ?, 'http-fingerprint', ?, null)`)
        .run(defaultProject, JSON.stringify({ slots: ['09:00'] }), canonicalBufferCapabilityJson('instagram'), BUFFER_CAPABILITY_REGISTRY_VERSION, timestamp);
    } finally { database.close(); }
    const claim = createAgentClaim({ agentName: 'HTTP editor', project: defaultProject, scopeType: 'lineage_workspace', targetId: lineageWorkspaceId(defaultProject, rootAssetId) });
    const unknownQueryCreate = await post('/api/social/items?apiKey=secret', { rootAssetId, sourceAssetId: rootAssetId, confirmWrite: true }, claim.claim_token);
    expect(unknownQueryCreate.status).toBe(400);
    const conflictingQueryCreate = await post('/api/social/items?project=other-project', { rootAssetId, sourceAssetId: rootAssetId, confirmWrite: true }, claim.claim_token);
    expect(conflictingQueryCreate.status).toBe(400);
    const conflictingBodyCreate = await post('/api/social/items', { product: 'other-project', rootAssetId, sourceAssetId: rootAssetId, confirmWrite: true }, claim.claim_token);
    expect(conflictingBodyCreate.status).toBe(400);
    const rejectedCreate = await post('/api/social/items', { rootAssetId, sourceAssetId: rootAssetId, providerConfig: { accessToken: 'secret', state: 'scheduled' }, confirmWrite: true }, claim.claim_token);
    expect(rejectedCreate.status).toBe(400);
    const rejectedCreateDb = lineageDb();
    try { expect(Number((rejectedCreateDb.prepare('select count(*) count from social_work_items').get() as { count: number }).count)).toBe(0); }
    finally { rejectedCreateDb.close(); }
    const denied = await post('/api/social/items', { rootAssetId, sourceAssetId: rootAssetId, confirmWrite: true });
    expect(denied.status).toBe(401);
    const createdResponse = await post('/api/social/items', { rootAssetId, sourceAssetId: rootAssetId, campaignKey: 'http', confirmWrite: true }, claim.claim_token);
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json() as { item: { id: string } };
    const isolated = await fetch(`${baseUrl}/api/social/items/${created.item.id}?project=other-project`);
    expect(isolated.status).toBe(404);
    const addedResponse = await post(`/api/social/items/${created.item.id}/variants`, { channelId: 'channel-http', confirmWrite: true }, claim.claim_token);
    const added = await addedResponse.json() as { item: { variants: Array<{ id: string }> } };
    const variantId = added.item.variants[0].id;
    const beforeRejected = lineageDb();
    const revisionCountBefore = Number((beforeRejected.prepare('select count(*) count from social_variant_revisions where variant_id=?').get(variantId) as { count: number }).count);
    beforeRejected.close();
    const unknownNested = await post(`/api/social/variants/${variantId}/edit`, { expectedRevision: 1, networkMetadata: { state: 'scheduled', nested: { apiKey: 'secret', remoteId: 'remote' } }, confirmWrite: true }, claim.claim_token);
    expect(unknownNested.status).toBe(400);
    const unknownDelivery = await post(`/api/social/variants/${variantId}/edit`, { expectedRevision: 1, deliveryState: 'published', confirmWrite: true }, claim.claim_token);
    expect(unknownDelivery.status).toBe(400);
    const afterRejected = lineageDb();
    try { expect(Number((afterRejected.prepare('select count(*) count from social_variant_revisions where variant_id=?').get(variantId) as { count: number }).count)).toBe(revisionCountBefore); }
    finally { afterRejected.close(); }
    const missingExpected = await post(`/api/social/variants/${variantId}/edit`, { copy: 'missing expected revision', confirmWrite: true }, claim.claim_token);
    expect(missingExpected.status).toBe(400);
    const invalidEnum = await post(`/api/social/variants/${variantId}/edit`, { publishMethod: 'silent', confirmWrite: true }, claim.claim_token);
    expect(invalidEnum.status).toBe(400);
    await expect(invalidEnum.json()).resolves.toMatchObject({ error: expect.stringContaining('publishMethod must be one of') });
    const invalidRevision = await post(`/api/social/variants/${variantId}/edit`, { expectedRevision: 1.5, confirmWrite: true }, claim.claim_token);
    expect(invalidRevision.status).toBe(400);
    const invalidHashtags = await post(`/api/social/variants/${variantId}/edit`, { hashtags: '#not-an-array', confirmWrite: true }, claim.claim_token);
    expect(invalidHashtags.status).toBe(400);
    const editedResponse = await post(`/api/social/variants/${variantId}/edit`, {
      expectedRevision: 1, copy: 'HTTP caption', hashtags: ['One', '#Two'], hashtagPlacement: 'caption',
      altText: 'Reviewed HTTP image', altTextReviewed: true, altTextReviewedBy: 'human:http',
      compositionMode: 'addToQueue', confirmWrite: true,
    }, claim.claim_token);
    expect(editedResponse.status).toBe(200);
    await expect(editedResponse.json()).resolves.toMatchObject({ schema_version: 'lineage.social_work_item.v1', item: { variants: [expect.objectContaining({ current_revision: 2, revision: expect.objectContaining({ composition_mode: 'addToQueue' }) })] } });
    const conflict = await post(`/api/social/variants/${variantId}/edit`, { expectedRevision: 1, copy: 'stale', confirmWrite: true }, claim.claim_token);
    expect(conflict.status).toBe(409);
    const unknownEditQuery = await post(`/api/social/variants/${variantId}/edit?deliveryState=published`, { expectedRevision: 2, copy: 'query must reject', confirmWrite: true }, claim.claim_token);
    expect(unknownEditQuery.status).toBe(400);
    const validation = await post(`/api/social/items/${created.item.id}/preflight`, {});
    await expect(validation.json()).resolves.toMatchObject({ schema_version: 'lineage.social_validation.v1', valid: true, scheduled: false });
    const missingRemoveRevision = await post(`/api/social/variants/${variantId}/remove`, { confirmWrite: true }, claim.claim_token);
    expect(missingRemoveRevision.status).toBe(400);
    const staleRemove = await post(`/api/social/variants/${variantId}/remove`, { expectedRevision: 1, confirmWrite: true }, claim.claim_token);
    expect(staleRemove.status).toBe(409);
    const removedResponse = await post(`/api/social/variants/${variantId}/remove`, { expectedRevision: 2, confirmWrite: true }, claim.claim_token);
    await expect(removedResponse.json()).resolves.toMatchObject({ item: { variants: [expect.objectContaining({ id: variantId, active: false, current_revision: 3, revision: expect.objectContaining({ editorial_state: 'archived' }) })] } });
    const readdedResponse = await post(`/api/social/items/${created.item.id}/variants`, { channelId: 'channel-http', confirmWrite: true }, claim.claim_token);
    const readded = await readdedResponse.json() as { item: { variants: Array<{ id: string; active: boolean; current_revision: number }> } };
    const replacement = readded.item.variants.find(candidate => candidate.active)!;
    const missingArchiveConcurrency = await post(`/api/social/items/${created.item.id}/archive`, { confirmWrite: true }, claim.claim_token);
    expect(missingArchiveConcurrency.status).toBe(400);
    const archivedResponse = await post(`/api/social/items/${created.item.id}/archive`, { expectedVariants: [{ variantId: replacement.id, expectedRevision: 1 }], confirmWrite: true }, claim.claim_token);
    await expect(archivedResponse.json()).resolves.toMatchObject({
      item: {
        editorial_state: 'archived',
        variants: expect.arrayContaining([
          expect.objectContaining({
            id: replacement.id,
            current_revision: 2,
            revision: expect.objectContaining({ editorial_state: 'archived' }),
          }),
        ]),
      },
    });
  });
});
