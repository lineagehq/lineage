import { expect, test, type Locator, type Page } from 'playwright/test';

const project = 'swissifier-demo';

test('rotates lineage graph layout and handles without stale saved positions', async ({ page, request }) => {
  const seed = await request.post('/api/lineage-workspaces/demo/swissifier/seed', {
    data: { project, confirmWrite: true },
  });
  expect(seed.ok()).toBe(true);
  const seeded = await seed.json() as { workspace?: { id: string } };
  const workspaceId = seeded.workspace?.id;
  if (!workspaceId) throw new Error('Swissifier seed did not return an exact workspace ID');

  try {
    await page.goto(`/projects/${project}/workspaces/${encodeURIComponent(workspaceId)}`);
    await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Swissifier rich demo', { timeout: 20_000 });

    const root = lineageNode(page, 'swissifier linkedin root v1');
    const child = lineageNode(page, 'swissifier vertical drill v1');
    await expect(root).toBeVisible();
    await expect(child).toBeVisible();

    await openCanvasSettings(page);
    await page.getByRole('radio', { name: 'Top to bottom' }).check();
    await assertRootAboveChild(root, child);
    await assertOrientationSaved(page, 'Rotated lineage graph top to bottom');
    const topToBottomPath = await firstEdgePath(page);
    expect(topToBottomPath).toMatch(/V|Q/);

    await page.getByRole('radio', { name: 'Left to right' }).check();
    await assertRootLeftOfChild(root, child);
    await assertOrientationSaved(page, 'Rotated lineage graph left to right');
    const leftToRightPath = await firstEdgePath(page);
    expect(leftToRightPath).not.toBe(topToBottomPath);

    await page.getByRole('radio', { name: 'Top to bottom' }).check();
    await assertRootAboveChild(root, child);
    await assertOrientationSaved(page, 'Rotated lineage graph top to bottom');

    await page.getByRole('radio', { name: 'Left to right' }).check();
    await assertRootLeftOfChild(root, child);
    await assertOrientationSaved(page, 'Rotated lineage graph left to right');

    await page.getByRole('radio', { name: 'Portrait cards' }).check();
    await page.getByRole('radio', { name: 'Top to bottom' }).check();
    await assertRootAboveChild(root, child);

    await page.getByRole('radio', { name: 'Compact nodes' }).check();
    await expect(page.getByRole('radio', { name: 'Left to right' })).toBeChecked();
    await assertRootLeftOfChild(root, child);
  } finally {
    const restored = await request.post('/api/lineage-workspaces/demo/swissifier/seed', {
      data: { activate: false, confirmWrite: true, project },
    });
    expect(restored.ok(), await restored.text()).toBe(true);
  }
});

function lineageNode(page: Page, title: string): Locator {
  return page.locator('.react-flow__node').filter({ hasText: title }).first();
}

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function assertRootLeftOfChild(root: Locator, child: Locator) {
  await expect.poll(async () => {
    const rootBox = await box(root);
    const childBox = await box(child);
    return childBox.x - rootBox.x;
  }).toBeGreaterThan(20);
}

async function assertRootAboveChild(root: Locator, child: Locator) {
  await expect.poll(async () => {
    const rootBox = await box(root);
    const childBox = await box(child);
    return childBox.y - rootBox.y;
  }).toBeGreaterThan(20);
}

async function firstEdgePath(page: Page): Promise<string> {
  await expect(page.locator('.react-flow__edge-path').first()).toBeVisible();
  return await page.locator('.react-flow__edge-path').first().getAttribute('d') || '';
}

async function assertOrientationSaved(page: Page, message: string) {
  await expect(page.locator('.toast[role="status"]')).toContainText(message);
}

async function openCanvasSettings(page: Page) {
  const panel = page.getByRole('complementary', { name: 'Canvas settings' });
  if (!await panel.isVisible()) await page.getByRole('button', { name: 'Open Canvas settings' }).click();
  await expect(panel).toBeVisible();
}
