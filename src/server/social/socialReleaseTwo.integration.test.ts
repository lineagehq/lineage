import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { createAgentClaim } from '../agentClaims';
import { defaultProject, repoRoot } from '../assetCore';
import { indexLineageAssets } from '../assetLineage';
import { lineageDb, nowIso } from '../assetLineageDb';
import { lineageWorkspaceId } from '../assetLineageWorkspaces';
import { BUFFER_CAPABILITY_REGISTRY_VERSION, bufferChannelCapability } from '../adapters/buffer/bufferCapabilities';
import { fileSha256 } from '../localReview';
import { markAssetSocial } from './socialMarks';
import { registerSocialMarkRoutes } from './socialRoutes';
import { addSocialVariant, createSocialWorkItem, editSocialVariant } from './socialWorkItems';

const scratch = join(repoRoot, '.asset-scratch', 'vitest-social-release-two');
let server: Server | undefined;
function writeSyntheticImage(path: string): void {
  const sharpPath = createRequire(import.meta.url).resolve('sharp');
  const result = spawnSync(process.execPath, ['-e', `const sharp=require(process.argv[1]);sharp({create:{width:1080,height:1080,channels:3,background:'#884422'}}).png().toFile(process.argv[2]).catch(()=>process.exit(1))`, sharpPath, path]);
  if (result.status !== 0) throw new Error('Unable to create synthetic image');
}

afterEach(() => { server?.close(); server = undefined; rmSync(scratch, { recursive: true, force: true }); });

describe('Social Release 2 fixture integration', () => {
  it('prepares an immutable agent handoff while every legacy provider-mutation route stays absent', async () => {
    mkdirSync(scratch, { recursive: true });
    useLineageTestProfile(join(scratch, 'lineage.sqlite'));
    const media = join(scratch, 'fixture-media.png');
    writeSyntheticImage(media);
    indexLineageAssets(defaultProject);
    const assetId = `local-${fileSha256(media).slice(0, 12)}`;
    const channelId = 'release-two-fixture-channel';
    const fingerprint = 'release-two-channel-fingerprint';
    markAssetSocial(defaultProject, { asset: assetId, rootAssetId: assetId, markedBy: 'human:release-two', confirmWrite: true });
    const claim = createAgentClaim({ agentName: 'Release Two Fixture', project: defaultProject, scopeType: 'lineage_workspace', targetId: lineageWorkspaceId(defaultProject, assetId) });
    const database = lineageDb();
    try {
      const timestamp = nowIso();
      database.prepare('update assets set channel=? where project_id=? and id=?').run('instagram', defaultProject, assetId);
      database.prepare(`insert into buffer_connections (project_id, organization_id, credential_ref, cli_version, schema_fingerprint, connection_fingerprint, health_state, created_at, updated_at) values (?, 'fixture-org', 'env:FIXTURE_ONLY', 'fixture', 'fixture-schema', 'fixture-connection', 'connected', ?, ?)`).run(defaultProject, timestamp, timestamp);
      database.prepare(`insert into buffer_channels (project_id, channel_id, organization_id, service, display_name, posting_schedule_json, allowed_actions_json, capability_json, disconnected, locked, paused, available, capability_registry_version, provider_fingerprint, synced_at) values (?, ?, 'fixture-org', 'instagram', 'Fixture', ?, '[]', ?, 0, 0, 0, 1, ?, ?, ?)`)
        .run(defaultProject, channelId, JSON.stringify({ slots: ['09:00'] }), JSON.stringify(bufferChannelCapability('instagram')), BUFFER_CAPABILITY_REGISTRY_VERSION, fingerprint, timestamp);
    } finally { database.close(); }
    const item = createSocialWorkItem(defaultProject, { rootAssetId: assetId, sourceAssetId: assetId, confirmWrite: true, claimToken: claim.claim_token }).item;
    const initial = addSocialVariant(defaultProject, { itemId: item.id, channelId, confirmWrite: true, claimToken: claim.claim_token }).item.variants[0];
    const variant = editSocialVariant(defaultProject, { variantId: initial.id, expectedRevision: 1, copy: 'Controlled synthetic caption', altText: 'Synthetic blue square', altTextReviewed: true, altTextReviewedBy: 'human:release-two', editorialState: 'ready', compositionMode: 'addToQueue', confirmWrite: true, claimToken: claim.claim_token }).item.variants[0];
    const makeApp = () => {
      const app = express();
      app.use(express.json());
      registerSocialMarkRoutes(app, input => String(input.body?.project || input.query?.project || defaultProject), handler => (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); });
      app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof Error && 'status' in error ? Number(error.status) : 500).json({ error: error instanceof Error ? error.message : String(error) }));
      return app;
    };
    const app = makeApp();
    server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: string, body: Record<string, unknown>) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: defaultProject, ...body }) });
    const previewResponse = await post(`/api/social/variants/${variant.id}/delivery-preview`, { expectedRevision: 2 });
    const preview = await previewResponse.json() as { preview_sha256: string };
    expect(previewResponse.status).toBe(200);
    const handoff = await post(`/api/social/variants/${variant.id}/agent-handoff`, { expectedRevision: 2, previewSha256: preview.preview_sha256 });
    expect(handoff.status).toBe(200);
    await expect(handoff.json()).resolves.toMatchObject({
      schema_version: 'lineage.social_agent_handoff.v1',
      preview_sha256: preview.preview_sha256,
      variant_id: variant.id,
      confirmation_policy: 'explicit_operator_confirmation_in_buffer',
      channel: { id: channelId },
    });
    for (const path of [
      `/api/social/variants/${variant.id}/schedule`,
      '/api/social/deliveries/legacy-operation/reconcile',
      '/api/social/deliveries/legacy-operation/adopt',
      '/api/social/deliveries/legacy-operation/lifecycle-preview',
      '/api/social/deliveries/legacy-operation/lifecycle-confirm',
    ]) expect((await post(path, { expectedRevision: 2, previewSha256: preview.preview_sha256, confirmExternal: true })).status, path).toBe(404);
    const noRows = lineageDb();
    try { expect(noRows.prepare("select name from sqlite_master where type='table' and name='social_delivery_operations'").get()).toBeUndefined(); }
    finally { noRows.close(); }
  });
});
