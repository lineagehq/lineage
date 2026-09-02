import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from 'playwright/test';

type Seed = { root_asset_id: string; workspace: { id: string } };
type SnapshotNode = { asset_id: string; title: string };

async function seed(request: APIRequestContext, project: string): Promise<Seed> {
  const response = await request.post('/api/lineage-workspaces/demo/seed', { data: { confirmWrite: true, project } });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<Seed>;
}

async function openEditor(page: Page, request: APIRequestContext, project: string) {
  const seeded = await seed(request, project);
  const snapshot = await (await request.get(`/api/lineage/${seeded.root_asset_id}?project=${project}`)).json() as { nodes: SnapshotNode[] };
  const target = snapshot.nodes[0];
  await page.goto(`/projects/${project}/workspaces/${encodeURIComponent(seeded.workspace.id)}`);
  await page.getByRole('button', { name: `${target.title} details`, exact: true }).dblclick();
  await page.getByRole('button', { name: `Open full detail for ${target.title}` }).click();
  const detail = page.getByRole('dialog').filter({ hasText: target.asset_id });
  await detail.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Edit ${target.title}` });
  const frame = page.frameLocator('iframe[title*="editor"]');
  await expect(dialog.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(frame.getByRole('button', { name: 'Save edit' })).toBeEnabled();
  return { dialog, frame, seeded, target };
}

test('real packed editor transfers its bytes, saves, and exposes visible sanitized history provenance', async ({ page, request }) => {
  const { dialog, frame, seeded, target } = await openEditor(page, request, 'node-editor-save');
  await frame.getByLabel('Edit summary').fill('Packed browser payload');
  await frame.getByRole('button', { name: 'Save edit' }).click();
  await expect(dialog.getByRole('status')).toContainText('accepted', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();
  const node = page.locator(`.lineage-node[data-asset-id="${target.asset_id}"]`);
  await node.dblclick();
  const history = page.getByRole('dialog', { name: 'Attempt history' });
  await expect(history).toContainText('reference.editor');
  await expect(history).toContainText('Packed browser payload');
  const attempts = await (await request.get(`/api/lineage/${seeded.root_asset_id}/attempts/${target.asset_id}?project=node-editor-save`)).json() as { attempts: Array<Record<string, unknown>> };
  expect(attempts.attempts).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'editor', editor_provenance: expect.objectContaining({ plugin_id: 'reference.editor' }) })]));
  const serialized = JSON.stringify(attempts);
  for (const forbidden of ['session-', 'process-', 'package_archive_sha256', 'manifest_sha256', 'host_sha256', 'extractedRoot', 'Credential']) expect(serialized).not.toContain(forbidden);
});

test('real packed editor cancels without changing attempts', async ({ page, request }) => {
  const { dialog, frame, seeded, target } = await openEditor(page, request, 'node-editor-cancel');
  const before = await (await request.get(`/api/lineage/${seeded.root_asset_id}/attempts/${target.asset_id}?project=node-editor-cancel`)).json() as { attempts: unknown[] };
  await frame.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog.getByRole('status')).toContainText('cancelled');
  const after = await (await request.get(`/api/lineage/${seeded.root_asset_id}/attempts/${target.asset_id}?project=node-editor-cancel`)).json() as { attempts: unknown[] };
  expect(after.attempts).toHaveLength(before.attempts.length);
});

test('dirty close and dirty cancel require confirmation', async ({ page, request }) => {
  const { dialog, frame } = await openEditor(page, request, 'node-editor-dirty');
  await frame.getByLabel('Edit summary').fill('Unsaved dirty payload');
  await Promise.all([
    page.waitForEvent('dialog').then(prompt => prompt.dismiss()),
    dialog.getByRole('button', { name: 'Close' }).click(),
  ]);
  await expect(dialog).toBeVisible();
  await Promise.all([
    page.waitForEvent('dialog').then(prompt => prompt.dismiss()),
    frame.getByRole('button', { name: 'Cancel' }).click(),
  ]);
  await expect(dialog.getByRole('status')).toContainText('Changes stay local');
  await Promise.all([
    page.waitForEvent('dialog').then(prompt => prompt.accept()),
    dialog.getByRole('button', { name: 'Close' }).click(),
  ]);
  await expect(dialog).toBeHidden();
});

test('real packed editor reports a stale base after a public current-attempt mutation', async ({ page, request }) => {
  const project = 'swissifier-demo';
  const seededResponse = await request.post('/api/lineage-workspaces/demo/swissifier/seed', { data: { confirmWrite: true, project } });
  expect(seededResponse.ok()).toBe(true);
  const seeded = await seededResponse.json() as Seed;
  const nodeAssetId = 'local-27050bc5c393';
  const attempts = await (await request.get(`/api/lineage/${seeded.root_asset_id}/attempts/${nodeAssetId}?project=${project}`)).json() as { attempts: Array<{ id: string; is_current: boolean }> };
  await page.goto(`/projects/${project}/workspaces/${encodeURIComponent(seeded.workspace.id)}`);
  const node = page.locator('.lineage-node', { hasText: 'swissifier vertical before after v1' }).first();
  await node.dblclick();
  await page.getByRole('dialog', { name: 'Attempt history' }).getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Edit/ });
  const frame = page.frameLocator('iframe[title*="editor"]');
  await expect(frame.getByRole('button', { name: 'Save edit' })).toBeEnabled();
  const alternate = attempts.attempts.find(attempt => !attempt.is_current)!;
  const promoted = await request.post(`/api/lineage/${seeded.root_asset_id}/attempts/${nodeAssetId}/promote?project=${project}`, { data: { attemptId: alternate.id, confirmWrite: true } });
  expect(promoted.ok()).toBe(true);
  await frame.getByRole('button', { name: 'Save edit' }).click();
  await expect(dialog.getByRole('status')).toContainText('current attempt changed');
});

test('save transport failure is bounded and visible', async ({ page, request }) => {
  const { dialog, frame } = await openEditor(page, request, 'node-editor-failure');
  await page.route('**/api/node-editor-plugins/sessions/*/proposals/*/content', route => route.abort('failed'));
  await frame.getByRole('button', { name: 'Save edit' }).click();
  await expect(dialog.getByRole('status')).toContainText(/failed|fetch|network/i);
});

test('public launch exchange rejects replay', async ({ request }) => {
  const seeded = await seed(request, 'node-editor-replay');
  const snapshot = await (await request.get(`/api/lineage/${seeded.root_asset_id}?project=node-editor-replay`)).json() as { nodes: SnapshotNode[] };
  const created = await request.post('/api/node-editor-plugins/reference.editor/sessions', { data: { project: 'node-editor-replay', rootAssetId: seeded.root_asset_id, nodeAssetId: snapshot.nodes[0].asset_id } });
  expect(created.status()).toBe(201);
  const launch = (await created.json() as { launch: { sessionId: string; launchCredential: string; binding: Record<string, string> } }).launch;
  const data = { launchCredential: launch.launchCredential, profileId: launch.binding.profileId, pluginId: launch.binding.pluginId, contributionId: launch.binding.contributionId, source: 'browser' };
  expect((await request.post(`/api/node-editor-plugins/sessions/${launch.sessionId}/exchange`, { data })).ok()).toBe(true);
  expect((await request.post(`/api/node-editor-plugins/sessions/${launch.sessionId}/exchange`, { data })).status()).toBe(401);
});

test('short-lived packed profile enforces launch and session expiry', async () => {
  const request = await playwrightRequest.newContext({ baseURL: process.env.LINEAGE_E2E_EXPIRY_ORIGIN! });
  try {
    const seeded = await seed(request, 'node-editor-expiry');
    const snapshot = await (await request.get(`/api/lineage/${seeded.root_asset_id}?project=node-editor-expiry`)).json() as { nodes: SnapshotNode[] };
    const create = async () => (await (await request.post('/api/node-editor-plugins/reference.editor/sessions', { data: { project: 'node-editor-expiry', rootAssetId: seeded.root_asset_id, nodeAssetId: snapshot.nodes[0].asset_id } })).json() as { launch: { sessionId: string; launchCredential: string; expiresAt: number; binding: Record<string, string> } }).launch;
    const expiredLaunch = await create();
    await expect.poll(() => Date.now(), { timeout: 2_000 }).toBeGreaterThan(expiredLaunch.expiresAt);
    const exchangeData = (launch: typeof expiredLaunch) => ({ launchCredential: launch.launchCredential, profileId: launch.binding.profileId, pluginId: launch.binding.pluginId, contributionId: launch.binding.contributionId, source: 'browser' });
    expect((await request.post(`/api/node-editor-plugins/sessions/${expiredLaunch.sessionId}/exchange`, { data: exchangeData(expiredLaunch) })).status()).toBe(401);
    const live = await create();
    expect((await request.post(`/api/node-editor-plugins/sessions/${live.sessionId}/exchange`, { data: exchangeData(live) })).ok()).toBe(true);
    await expect.poll(async () => (await request.get(`/api/node-editor-plugins/sessions/${live.sessionId}/document`)).status(), { timeout: 2_000 }).toBe(401);
  } finally { await request.dispose(); }
});

test('incompatible assets and feature-off packed profiles expose no action or routes', async ({ page }) => {
  const runId = process.env.LINEAGE_E2E_RUN_ID!;
  expect(runId).toMatch(/^[a-f0-9]{12}$/);
  const project = `node-editor-incompatible-${runId}`;
  const assetId = `node-editor-text-root-${runId}`;
  const incompatibleOrigin = process.env.LINEAGE_E2E_EXPIRY_ORIGIN!;
  const incompatibleRequest = await playwrightRequest.newContext({ baseURL: incompatibleOrigin });
  try {
    const createdProject = await incompatibleRequest.post('/api/projects', { data: { id: project, displayName: 'Node editor incompatible', confirmWrite: true } });
    expect(createdProject.ok()).toBe(true);
    const upload = await incompatibleRequest.post('/api/assets/upload', { multipart: {
      file: { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('not an editable image') },
      project, assetId, title: 'Text-only root', type: 'doc', confirmWrite: 'true',
    } });
    expect(upload.ok()).toBe(true);
    const workspaceResponse = await incompatibleRequest.post(`/api/lineage-workspaces?project=${project}`, { data: { rootAssetId: assetId, title: 'Incompatible workspace', confirmWrite: true } });
    expect(workspaceResponse.ok()).toBe(true);
    const workspace = (await workspaceResponse.json() as { workspace: { id: string } }).workspace;
    await page.goto(`${incompatibleOrigin}/projects/${project}/workspaces/${encodeURIComponent(workspace.id)}`);
    await page.getByRole('button', { name: 'Text-only root details', exact: true }).dblclick();
    const detail = page.getByRole('dialog').filter({ hasText: assetId });
    await expect(detail.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  } finally { await incompatibleRequest.dispose(); }

  const offOrigin = process.env.LINEAGE_E2E_FEATURE_OFF_ORIGIN!;
  const offRequest = await playwrightRequest.newContext({ baseURL: offOrigin });
  try {
    const offDiscovery = await offRequest.get('/api/node-editor-plugins');
    expect(offDiscovery.headers()['content-type']).toContain('text/html');
    expect((await offRequest.post('/api/node-editor-plugins/reference.editor/sessions', { data: {} })).status()).toBe(404);
    const offSeed = await seed(offRequest, 'node-editor-feature-off');
    const offSnapshot = await (await offRequest.get(`/api/lineage/${offSeed.root_asset_id}?project=node-editor-feature-off`)).json() as { nodes: SnapshotNode[] };
    const offTarget = offSnapshot.nodes[0];
    await page.goto(`${offOrigin}/projects/node-editor-feature-off/workspaces/${encodeURIComponent(offSeed.workspace.id)}`);
    await page.getByRole('button', { name: `${offTarget.title} details`, exact: true }).dblclick();
    await page.getByRole('button', { name: `Open full detail for ${offTarget.title}` }).click();
    const offDetail = page.getByRole('dialog').filter({ hasText: offTarget.asset_id });
    await expect(offDetail.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  } finally { await offRequest.dispose(); }
});
