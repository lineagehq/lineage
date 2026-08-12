import { expect, test } from 'playwright/test';

const project = 'swissifier-demo';
const rootAssetId = 'local-5748fb8ba6df';
const stackedNodeTitle = 'swissifier vertical before after v1';
const stackedNodeId = 'local-27050bc5c393';
let workspaceId = '';

test.beforeEach(async ({ request }) => {
  const seeded = await request.post('/api/lineage-workspaces/demo/swissifier/seed', {
    data: { confirmWrite: true, project },
  });
  expect(seeded.ok()).toBe(true);
  workspaceId = (await seeded.json() as { workspace?: { id: string } }).workspace?.id || '';
  if (!workspaceId) throw new Error('Swissifier seed did not return an exact workspace ID');
});

test('browses and promotes re-roll history without panning the background canvas', async ({ page, request }) => {
  await page.goto(`/projects/${project}/workspaces/${encodeURIComponent(workspaceId)}`);

  await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Swissifier rich demo', { timeout: 20_000 });
  const node = page.locator('.lineage-node', { hasText: stackedNodeTitle }).first();
  await expect(node).toBeVisible();
  await expect(node.locator('.attempt-stack')).toHaveText('v3');

  await node.dblclick();
  await expect(page.getByRole('dialog', { name: 'Attempt history' })).toBeVisible();
  await expect(page.getByTestId('lineage-hover-preview')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Use .* next variation/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();
  const preview = page.locator('.lineage-attempt-preview img');
  await expect(preview).toHaveAttribute('src', /reroll-v3\.png/);
  const viewportBefore = await page.locator('.react-flow__viewport').getAttribute('transform');

  const v2 = page.getByRole('option', { name: /v2/ });
  await v2.click();
  await expect(preview).toHaveAttribute('src', /reroll-v2\.png/);
  await expect(v2).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('option', { name: /v3/ })).toContainText('current');

  await page.locator('.lineage-attempt-list').hover();
  await page.mouse.wheel(0, 800);
  const viewportAfter = await page.locator('.react-flow__viewport').getAttribute('transform');
  expect(viewportAfter).toBe(viewportBefore);

  await v2.getByRole('button', { name: 'Set current' }).click();
  await expect(page.getByRole('option', { name: /v2/ })).toContainText('current');

  const attempts = await request.get(`/api/lineage/${rootAssetId}/attempts/${stackedNodeId}?project=${project}`);
  expect(attempts.ok()).toBe(true);
  const attemptsBody = await attempts.json() as { attempts: Array<{ attempt_index: number; is_current: boolean }> };
  expect(attemptsBody.attempts.filter(attempt => attempt.is_current).map(attempt => attempt.attempt_index)).toEqual([2]);

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(node.locator('.lineage-thumb img')).toHaveAttribute('src', /reroll-v2\.png/);

  await node.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Attempt history' })).toBeVisible();
  const v1 = page.locator('.lineage-attempt-item', { has: page.locator('strong', { hasText: /^v1$/ }) });
  await v1.getByRole('button', { name: 'Set current' }).focus();
  await page.keyboard.press('Enter');
  await expect(v1).toContainText('current');

  const v1Attempts = await request.get(`/api/lineage/${rootAssetId}/attempts/${stackedNodeId}?project=${project}`);
  expect(v1Attempts.ok()).toBe(true);
  const v1AttemptsBody = await v1Attempts.json() as { attempts: Array<{ attempt_index: number; is_current: boolean }> };
  expect(v1AttemptsBody.attempts.filter(attempt => attempt.is_current).map(attempt => attempt.attempt_index)).toEqual([1]);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Attempt history' })).toBeHidden();
  await expect(node).toBeFocused();
  await expect(node.locator('.lineage-thumb img')).toHaveAttribute('src', /swissifier-vertical-before-after-v1\.png/);
});
