import { expect, test } from 'playwright/test';

const project = 'swissifier-demo';

test('toggles and remembers hover previews for portrait cards', async ({ page, request }) => {
  const seed = await request.post('/api/lineage-workspaces/demo/swissifier/seed', {
    data: { project, confirmWrite: true },
  });
  expect(seed.ok()).toBe(true);
  const seeded = await seed.json() as { workspace?: { id: string } };
  const workspaceId = seeded.workspace?.id;
  if (!workspaceId) throw new Error('Swissifier seed did not return an exact workspace ID');

  try {
    await page.goto(`/projects/${project}/workspaces/${encodeURIComponent(workspaceId)}?lineageCanvas=compact`);
    await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Swissifier rich demo', { timeout: 20_000 });
    await openCanvasSettings(page);
    await page.getByRole('radio', { name: 'Portrait cards' }).check();
    const rootNode = page.locator('.lineage-node.root-node');
    await expect(rootNode).toHaveClass(/lineage-node-portrait/);
    await expect.poll(() => graphFitsInsideCanvas(page), { timeout: 10_000 }).toBe(true);
    await expect(rootNode.locator('.lineage-node-overview-markers .review')).toBeVisible();
    await page.getByRole('button', { name: 'Close Canvas settings' }).click();
    await rootNode.hover();
    const preview = page.getByTestId('lineage-hover-preview');
    await expect(preview).toBeVisible();

    await openCanvasSettings(page);
    const hoverPreviews = page.getByRole('switch', { name: 'Canvas hover previews' });
    await expect(hoverPreviews).toHaveAttribute('aria-checked', 'true');
    await hoverPreviews.click();
    await expect(hoverPreviews).toHaveAttribute('aria-checked', 'false');
    await expect(preview).toHaveCount(0);
    await page.getByRole('button', { name: 'Close Canvas settings' }).click();
    await rootNode.hover();
    await expect(preview).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Swissifier rich demo', { timeout: 20_000 });
    await openCanvasSettings(page);
    await expect(page.getByRole('radio', { name: 'Portrait cards' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Canvas hover previews' })).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('switch', { name: 'Canvas hover previews' }).click();
    await page.getByRole('button', { name: 'Close Canvas settings' }).click();
    await page.locator('.lineage-node.root-node').hover();
    await expect(preview).toBeVisible();

    await page.evaluate(() => {
      Storage.prototype.setItem = () => { throw new Error('storage denied'); };
    });
    await openCanvasSettings(page);
    await page.getByRole('radio', { name: 'Bold edges' }).check();
    await expect(page.getByRole('status')).toContainText('Edge weight changed for this session');
  } finally {
    const restored = await request.post('/api/lineage-workspaces/demo/swissifier/seed', {
      data: { activate: false, confirmWrite: true, project },
    });
    expect(restored.ok(), await restored.text()).toBe(true);
  }
});

async function openCanvasSettings(page: import('playwright/test').Page) {
  const panel = page.getByRole('complementary', { name: 'Canvas settings' });
  if (!await panel.isVisible()) await page.getByRole('button', { name: 'Open Canvas settings' }).click();
  await expect(panel).toBeVisible();
}

async function graphFitsInsideCanvas(page: import('playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.lineage-canvas')?.getBoundingClientRect();
    const nodes = [...document.querySelectorAll('.react-flow__node')].map(node => node.getBoundingClientRect());
    if (!canvas || nodes.length !== 14) return false;
    const tolerance = 1;
    return Math.min(...nodes.map(node => node.left)) >= canvas.left - tolerance
      && Math.max(...nodes.map(node => node.right)) <= canvas.right + tolerance
      && Math.min(...nodes.map(node => node.top)) >= canvas.top - tolerance
      && Math.max(...nodes.map(node => node.bottom)) <= canvas.bottom + tolerance;
  });
}
