import { expect, test } from 'playwright/test';

const project = 'demo-project';

test('collapses lineage branches in both card modes while preserving nested choices', async ({ page, request }) => {
  const seed = await request.post('/api/lineage-workspaces/demo/seed', {
    data: { project, confirmWrite: true },
  });
  expect(seed.ok()).toBe(true);
  const seeded = await seed.json() as { workspace?: { id: string } };
  const workspaceId = seeded.workspace?.id;
  if (!workspaceId) throw new Error('Demo seed did not return an exact workspace ID');

  try {
    await page.goto(`/projects/${project}/workspaces/${encodeURIComponent(workspaceId)}?lineageCanvas=portrait`);
    await expect(page.locator('.lineage-workspace-title strong'))
      .toHaveText('Demo: Content iteration tree', { timeout: 20_000 });
    await expect(page.locator('.react-flow__node')).toHaveCount(10);
    await expect(page.locator('.react-flow__edge')).toHaveCount(9);

    const rootFlowNode = page.locator('.react-flow__node:has(.lineage-node.root-node)');
    const rootBeforeCollapse = await requiredBox(rootFlowNode);
    const rootCollapse = page.getByRole('button', { name: 'Collapse 9 descendants of Initial Demo Concept' });
    await expect(rootCollapse).toHaveText('−');
    await Promise.all([
      expect(page.locator('.lineage-node-branch-exiting')).toHaveCount(9, { timeout: 1_000 }),
      rootCollapse.click(),
    ]);
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    assertSameAnchor(rootBeforeCollapse, await requiredBox(rootFlowNode));
    await Promise.all([
      expect(page.locator('.lineage-node-branch-entering')).toHaveCount(9, { timeout: 1_000 }),
      page.getByRole('button', { name: 'Expand 9 hidden descendants of Initial Demo Concept' }).click(),
    ]);
    await expect(page.locator('.react-flow__node')).toHaveCount(10);
    await expect(page.locator('.lineage-node-branch-entering')).toHaveCount(0);
    assertSameAnchor(rootBeforeCollapse, await requiredBox(rootFlowNode));
    await assertRenderedEdges(page, 9);

    for (let cycle = 0; cycle < 4; cycle += 1) {
      await page.getByRole('button', { name: 'Collapse 3 descendants of Hook A v01' }).click();
      await expect(page.locator('.react-flow__node')).toHaveCount(7);
      await assertRenderedEdges(page, 6);
      await page.getByRole('button', { name: 'Expand 3 hidden descendants of Hook A v01' }).click();
      await expect(page.locator('.react-flow__node')).toHaveCount(10);
      await assertRenderedEdges(page, 9);
    }

    const hookToggle = page.getByRole('button', { name: 'Collapse 3 descendants of Hook A v01' });
    await expect(hookToggle).toHaveAttribute('aria-expanded', 'true');
    await hookToggle.click();
    await expect(page.locator('.react-flow__node')).toHaveCount(7);
    await expect(page.getByRole('button', { name: 'Expand 3 hidden descendants of Hook A v01' }))
      .toHaveAttribute('aria-expanded', 'false');

    await page.getByRole('button', { name: 'Collapse 6 descendants of Initial Demo Concept' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    await page.getByRole('button', { name: 'Expand 6 hidden descendants of Initial Demo Concept' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(7);
    await expect(page.getByRole('button', { name: 'Expand 3 hidden descendants of Hook A v01' })).toBeVisible();

    await page.getByRole('button', { name: 'Expand 3 hidden descendants of Hook A v01' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(10);
    await expect(page.locator('.react-flow__edge')).toHaveCount(9);

    await openCanvasSettings(page);
    await page.getByRole('radio', { name: 'Compact nodes' }).check();
    await expect(page.locator('.lineage-node.root-node')).toHaveClass(/lineage-node-compact/);
    await expect(page.locator('.react-flow__node:has(.lineage-node.root-node)').getByRole('button', { name: 'Collapse 9 descendants of Initial Demo Concept' }))
      .toHaveClass(/lineage-branch-toggle-right/);
    await page.getByRole('button', { name: 'Close Canvas settings' }).click();

    await page.getByRole('button', { name: 'Replay growth' }).click();
    await expect(page.getByRole('button', { name: 'Collapse 9 descendants of Initial Demo Concept' })).toBeDisabled();
  } finally {
    if (seeded.workspace?.id) {
      await request.post(`/api/lineage-workspaces/${encodeURIComponent(seeded.workspace.id)}/archive`, {
        data: { project, confirmWrite: true },
      });
    }
  }
});

async function openCanvasSettings(page: import('playwright/test').Page) {
  const panel = page.getByRole('complementary', { name: 'Canvas settings' });
  if (!await panel.isVisible()) await page.getByRole('button', { name: 'Open Canvas settings' }).click();
  await expect(panel).toBeVisible();
}

async function requiredBox(locator: import('playwright/test').Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

function assertSameAnchor(expected: { x: number; y: number }, actual: { x: number; y: number }) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(1);
}

async function assertRenderedEdges(page: import('playwright/test').Page, expectedCount: number) {
  const edges = page.locator('.react-flow__edge');
  await expect(edges).toHaveCount(expectedCount);
  await expect(page.locator('.lineage-edge-branch-entering, .lineage-edge-branch-exiting')).toHaveCount(0);
  const rendered = await edges.evaluateAll(items => items.map(edge => {
    const path = edge.querySelector<SVGPathElement>('.react-flow__edge-path');
    return {
      opacity: getComputedStyle(edge).opacity,
      path: path?.getAttribute('d') || '',
      visibility: getComputedStyle(edge).visibility,
    };
  }));
  expect(rendered).toHaveLength(expectedCount);
  expect(rendered.every(edge => edge.opacity !== '0' && edge.visibility === 'visible' && edge.path.length > 0)).toBe(true);
}
