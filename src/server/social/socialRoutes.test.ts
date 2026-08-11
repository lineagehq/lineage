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
import { lineageWorkspaceId } from '../assetLineageWorkspaces';
import { fileSha256 } from '../localReview';
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
});
