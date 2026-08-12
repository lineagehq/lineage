import { expect, test, type Page } from 'playwright/test';

const project = 'swissifier-demo';
const richTitle = 'Swissifier rich demo';
const isolationTitle = 'Replay isolation workspace';
const rootId = 'local-5748fb8ba6df';
const posterId = 'local-befe299c503d';
const rootPosterEdgeId = `${project}:${rootId}:derived_from:${posterId}`;

test('replays and scrubs a stable branching lineage, isolates refreshes, and remains accessible', async ({ page, request }) => {
  const richSeed = await request.post('/api/lineage-workspaces/demo/swissifier/seed', {
    data: { activate: true, confirmWrite: true, project },
  });
  expect(richSeed.ok()).toBe(true);
  const rich = await richSeed.json() as { workspace?: { id: string } };
  const richWorkspaceId = rich.workspace?.id;
  if (!richWorkspaceId) throw new Error('Swissifier seed did not return an exact workspace ID');
  const isolationSeed = await request.post('/api/lineage-workspaces', {
    data: {
      activate: false,
      confirmWrite: true,
      project,
      rootAssetId: posterId,
      title: isolationTitle,
    },
  });
  expect(isolationSeed.ok(), await isolationSeed.text()).toBe(true);
  const isolation = await isolationSeed.json() as { workspace?: { id: string } };
  if (!isolation.workspace?.id) throw new Error('Replay isolation seed did not return an exact workspace ID');

  try {
    await page.goto(`/projects/${project}/workspaces/${encodeURIComponent(richWorkspaceId)}`);
    await expect(page.locator('.lineage-workspace-title strong')).toHaveText(richTitle, { timeout: 20_000 });
    await expect(page.locator('.react-flow__node')).toHaveCount(14);
    await expect(page.locator('.react-flow__edge')).toHaveCount(13);

    // The workspace performs one intentional initial fit after React Flow mounts.
    // Capture the baseline after that fit so replay itself is the only variable.
    await page.waitForTimeout(600);
    const originalGeometry = await nodeGeometry(page);
    const replayButton = page.getByRole('button', { name: 'Replay growth' });
    await expect(replayButton).toBeVisible();
    await expect(replayButton).toBeEnabled();
    await replayButton.click();

    const controls = page.getByTestId('lineage-replay-controls');
    await expect(controls).toBeVisible();
    await expect(replayButton).toBeDisabled();
    await controls.getByRole('button', { name: 'Pause replay' }).click();
    const pausedProgress = await controls.locator('output').innerText();
    await page.waitForTimeout(700);
    await expect(controls.locator('output')).toHaveText(pausedProgress);

    const scrubber = controls.getByLabel('Replay stage');
    await scrubber.press('End');
    await scrubber.press('Home');
    await expect(scrubber).toHaveValue('0');
    await expect(page.locator('.lineage-node-replay-visible')).toHaveCount(1);
    await expect(page.locator('.lineage-node-replay-future')).toHaveCount(13);
    await expect(page.locator('.lineage-edge-replay-future[aria-hidden="true"]')).toHaveCount(13);
    await expect(page.locator('.lineage-edge-replay-future[tabindex]')).toHaveCount(0);
    expectGeometry(await nodeGeometry(page), originalGeometry);

    await controls.getByLabel('Replay speed').selectOption('2');
    await controls.getByRole('button', { name: 'Play replay' }).click();
    await expect.poll(async () => controls.locator('output').innerText()).not.toBe('Stage 1 of 14');
    await controls.getByRole('button', { name: 'Pause replay' }).click();

    await scrubber.press('End');
    await expect(scrubber).toHaveValue('13');
    await expect(page.locator('.react-flow__node')).toHaveCount(14);
    await expect(page.locator('.lineage-node-replay-future')).toHaveCount(0);
    await expect(page.locator('.react-flow__edge')).toHaveCount(13);
    await expect(page.locator('.lineage-edge-replay-future')).toHaveCount(0);
    await expect(page.locator('.react-flow__edge[aria-hidden="true"]')).toHaveCount(0);
    await expect(page.locator('.react-flow__edge[tabindex="0"]')).toHaveCount(13);
    expectGeometry(await nodeGeometry(page), originalGeometry);

    const rootNode = page.locator('.react-flow__node').filter({ hasText: 'swissifier linkedin root v1' });
    await rootNode.click();
    await expect(page.locator('.lineage-canvas')).toHaveClass(/focus-active/);
    const firstEdge = page.locator(`.react-flow__edge[data-id="${rootPosterEdgeId}"]`);
    await firstEdge.focus();
    await firstEdge.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Edit edge label' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Edge label' }).fill('Replay edit');
    await page.getByRole('button', { name: 'Save label' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit edge label' })).toHaveCount(0);
    await expect(firstEdge).toHaveAttribute('aria-label', /Replay edit/);
    await expect(controls).toBeVisible();

    await scrubber.press('Home');
    await expect(scrubber).toHaveValue('0');
    await scrubber.press('End');
    await expect(scrubber).toHaveValue('13');
    await controls.getByRole('button', { name: 'Replay from start' }).click();
    await controls.getByRole('button', { name: 'Pause replay' }).click();
    await expect(firstEdge).toHaveAttribute('aria-label', /Replay edit/);

    const currentSnapshotResponse = await request.get(`/api/lineage/${encodeURIComponent(rootId)}?project=${encodeURIComponent(project)}`);
    expect(currentSnapshotResponse.ok()).toBe(true);
    const currentSnapshot = await currentSnapshotResponse.json() as {
      edges: Array<{ id: string; summary_updated_at: string | null }>;
    };
    const currentEdge = currentSnapshot.edges.find(edge => edge.id === rootPosterEdgeId);
    expect(currentEdge).toBeDefined();
    const liveSummary = `Live ${Date.now()}`;
    const summaryUpdate = await request.post(`/api/lineage/edges/${encodeURIComponent(rootPosterEdgeId)}/summary`, {
      data: {
        action: 'set',
        confirmWrite: true,
        expectedSummaryUpdatedAt: currentEdge!.summary_updated_at,
        project,
        summary: liveSummary,
      },
    });
    expect(summaryUpdate.ok(), await summaryUpdate.text()).toBe(true);
    await page.waitForTimeout(8_500);
    await expect(firstEdge).not.toHaveAttribute('aria-label', new RegExp(liveSummary));
    await scrubber.press('End');
    await expect(firstEdge).toHaveAttribute('aria-label', new RegExp(liveSummary));
    await expect(controls).toBeVisible();
    await controls.getByRole('button', { name: 'Return to live' }).click();
    await expect(controls).toHaveCount(0);

    await replayButton.click();
    await page.setViewportSize({ height: 760, width: 520 });
    const compactBox = await controls.boundingBox();
    expect(compactBox).not.toBeNull();
    expect(compactBox!.x).toBeGreaterThanOrEqual(0);
    expect(compactBox!.x + compactBox!.width).toBeLessThanOrEqual(520);
    await controls.getByRole('button', { name: 'Return to live' }).click();

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ height: 900, width: 1280 });
    expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await replayButton.click();
    await expect(controls).toBeVisible();
    await expect.poll(async () => page.locator('.lineage-canvas').evaluate(element => (
      getComputedStyle(element).getPropertyValue('--lineage-replay-node-duration').trim()
    ))).toBe('1ms');
    await expect(controls.locator('output')).toHaveText('Stage 14 of 14', { timeout: 5_000 });

    await page.locator('.lineage-workspace-exit').click();
    const isolationWorkspace = page.locator('.organization-item').filter({ hasText: isolationTitle });
    await isolationWorkspace.getByRole('button', { name: 'Open Canvas' }).click();
    await expect(page.locator('.lineage-workspace-title strong')).toHaveText(isolationTitle);
    await expect(controls).toHaveCount(0);
  } finally {
    if (isolation.workspace?.id) {
      await request.post(`/api/lineage-workspaces/${encodeURIComponent(isolation.workspace.id)}/archive`, {
        data: { confirmWrite: true, project },
      });
    }
    const restored = await request.post('/api/lineage-workspaces/demo/swissifier/seed', {
      data: { activate: false, confirmWrite: true, project },
    });
    expect(restored.ok(), await restored.text()).toBe(true);
  }
});

async function nodeGeometry(page: Page): Promise<Record<string, { height: number; width: number; x: number; y: number }>> {
  return page.locator('.react-flow__node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return [node.getAttribute('data-id') || '', {
      height: Math.round(rect.height),
      width: Math.round(rect.width),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
    }];
  })));
}

function expectGeometry(
  actual: Record<string, { height: number; width: number; x: number; y: number }>,
  expected: Record<string, { height: number; width: number; x: number; y: number }>,
) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [nodeId, box] of Object.entries(expected)) expect(actual[nodeId]).toEqual(box);
}
