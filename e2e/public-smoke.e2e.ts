import { expect, test, type APIRequestContext } from 'playwright/test';

type WorkspaceListResponse = {
  workspaces?: Array<{ id: string; status?: string }>;
};

async function seedDemo(request: APIRequestContext) {
  const response = await request.post('/api/lineage-workspaces/demo/seed', {
    data: { confirmWrite: true, project: 'demo-project' },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).workspace.id as string;
}

function demoCanvasPath(workspaceId: string) {
  return `/projects/demo-project/workspaces/${encodeURIComponent(workspaceId)}`;
}

test.beforeEach(async ({ request }) => {
  const response = await request.get('/api/lineage-workspaces');
  expect(response.ok()).toBe(true);
  const body = await response.json() as WorkspaceListResponse;
  for (const workspace of body.workspaces || []) {
    if (workspace.status === 'archived') continue;
    const archive = await request.post(`/api/lineage-workspaces/${encodeURIComponent(workspace.id)}/archive`, {
      data: { confirmWrite: true },
    });
    expect(archive.ok()).toBe(true);
  }
});

test('loads the public demo project and app shell', async ({ page, request }) => {
  const projectsResponse = await request.get('/api/projects');
  expect(projectsResponse.ok()).toBe(true);

  const body = await projectsResponse.json() as { projects: Array<{ id: string; asset_count: number }> };
  expect(body.projects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'demo-project', asset_count: expect.any(Number) }),
    ])
  );

  await page.goto('/');
  await expect(page).toHaveURL('/projects');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'About Lineage', exact: true })).toBeVisible();
});

test('exposes contextual Canvas tooling without legacy More or Actions menus', async ({ page, request }) => {
  const workspaceId = await seedDemo(request);
  await page.goto(demoCanvasPath(workspaceId));
  const canvasTools = page.getByRole('region', { name: 'Canvas workspace tools' });

  await expect(canvasTools).toBeVisible();
  await expect(canvasTools.getByText('Maintenance', { exact: true })).toBeVisible();
  await expect(canvasTools.getByText('Demo/QA', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /More/ })).toHaveCount(0);
  await expect(page.getByText('Actions', { exact: true })).toHaveCount(0);
});

test('shows runtime channel and SQLite identity in settings', async ({ page, request }) => {
  const workspaceId = await seedDemo(request);
  await page.goto(demoCanvasPath(workspaceId));

  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  const release = page.getByLabel('Release information');
  await expect(release).toBeVisible();
  await expect(release.getByText('Version')).toBeVisible();
  await expect(release.getByText('Channel')).toBeVisible();
  await expect(release.getByText('dev', { exact: true })).toBeVisible();
  await expect(release.getByText('Assets', { exact: true })).toBeVisible();
  await expect(release.getByText('SQLite', { exact: true })).toBeVisible();
  await expect(release.getByText(/lineage-e2e-.*\.sqlite/)).toBeVisible();
  await expect(release.getByText(/projects \/ .*workspaces/)).toBeVisible();
});

test('lets users disable lineage hover previews without disabling details', async ({ page, request }) => {
  const workspaceId = await seedDemo(request);
  await page.goto(demoCanvasPath(workspaceId));
  const canvasTools = page.getByRole('region', { name: 'Canvas workspace tools' });
  await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Demo: Content iteration tree');

  await openCanvasSettings(page);
  const hoverPreviews = page.getByRole('switch', { name: 'Canvas hover previews' });
  await expect(hoverPreviews).toHaveAttribute('aria-checked', 'true');
  await hoverPreviews.click();
  await expect(hoverPreviews).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await openCanvasSettings(page);
  await expect(page.getByRole('switch', { name: 'Canvas hover previews' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Close Canvas settings' }).click();
  const rootNode = page.locator('.lineage-node.root-node');
  await expect(rootNode).toBeVisible();
  await rootNode.hover();
  await expect(page.getByTestId('lineage-hover-preview')).toHaveCount(0);

  await rootNode.dblclick();
  await page.getByRole('button', { name: 'Open full detail for Initial Demo Concept' }).click();
  await expect(page.getByRole('dialog', { name: 'Initial Demo Concept' })).toBeVisible();
});

test('loads the demo lineage at its canonical project and workspace route', async ({ page, request }) => {
  const workspaceId = await seedDemo(request);
  await page.goto(demoCanvasPath(workspaceId));

  const canvasTools = page.getByRole('region', { name: 'Canvas workspace tools' });
  await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Demo: Content iteration tree', { timeout: 20_000 });
  await expect(page.getByText('No workspace selected')).not.toBeVisible();
  await expect(page.locator('.lineage-scope-bar')).toHaveCount(0);
  await expect(page.locator('.lineage-selection-strip')).toHaveCount(0);
  await expect(page.getByText('ROOT SCOPE')).toHaveCount(0);
  await expect(page.getByText('USE FOR NEXT VARIATION')).toHaveCount(0);

  const rootNode = page.locator('.lineage-node.root-node');
  await expect(rootNode).toHaveAttribute('data-lineage-root', 'true');
  expect(await rootNode.evaluate(node => node.closest('.react-flow__node')?.getAttribute('tabindex') ?? null)).toBeNull();
  await expect(page.getByTestId('lineage-canvas-status')).toHaveCount(0);
  await page.waitForTimeout(500); // Allow the intentional first-load viewport fit to finish before preview arbitration.
  await rootNode.hover();
  const hoverPreview = page.getByTestId('lineage-hover-preview');
  await expect(hoverPreview).toBeVisible();
  await expect(hoverPreview.locator('img')).toBeVisible();
  await expect(hoverPreview).toContainText('Initial Demo Concept');
  const branchAction = hoverPreview.getByRole('button', { name: /Branch/ });
  await expect(branchAction).toBeVisible();
  const rerollAction = hoverPreview.getByRole('button', { name: /Re-roll/ });
  await expect(rerollAction).toBeVisible();
  await expect(hoverPreview.getByRole('button', { name: /Details/ })).toBeVisible();
  await branchAction.hover();
  await expect(hoverPreview).toBeVisible();
  await branchAction.click();
  const branchPrompt = page.getByRole('dialog', { name: 'Describe the next branch' });
  await branchPrompt.getByLabel('What should your agent change?').fill('Create a smoke-test branch with a tighter editorial grid.');
  await branchPrompt.getByRole('button', { name: 'Queue branch' }).click();
  await rootNode.hover();
  const queuedBranchAction = page.getByTestId('lineage-hover-preview').getByRole('button', { name: /Remove branch/ });
  await expect(queuedBranchAction).toHaveAttribute('aria-pressed', 'true');
  await expect(queuedBranchAction).toHaveClass(/selected/);
  await page.getByTestId('lineage-hover-preview').getByRole('button', { name: /Edit branch prompt/ }).click();
  const branchEditPrompt = page.getByRole('dialog', { name: 'Describe the next branch' });
  await expect(branchEditPrompt).toBeVisible();
  await expect(hoverPreview).toHaveCount(0);
  await branchEditPrompt.getByRole('button', { name: 'Cancel' }).click();
  await rootNode.hover();
  await page.getByTestId('lineage-hover-preview').getByRole('button', { name: /Remove branch/ }).click();
  await expect(rootNode).not.toHaveClass(/selected/);
  await rootNode.focus();
  await rootNode.press('b');
  await expect(page.getByRole('dialog', { name: 'Describe the next branch' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Describe the next branch' }).getByRole('button', { name: 'Cancel' }).click();
  await rootNode.hover();
  const freshRerollAction = page.getByTestId('lineage-hover-preview').getByRole('button', { name: /Re-roll/ });
  await freshRerollAction.click();
  const rerollPrompt = page.getByRole('dialog', { name: 'Describe the re-roll' });
  await rerollPrompt.getByLabel('What should your agent change?').fill('Keep the composition and repair the smoke-test headline.');
  await rerollPrompt.getByRole('button', { name: 'Queue re-roll' }).click();
  await rootNode.hover();
  const queuedRerollAction = page.getByTestId('lineage-hover-preview').getByRole('button', { name: /Remove re-roll/ });
  await expect(queuedRerollAction).toHaveAttribute('aria-pressed', 'true');
  await expect(queuedRerollAction).toHaveClass(/selected/);
  await page.getByTestId('lineage-hover-preview').getByRole('button', { name: /Edit re-roll prompt/ }).click();
  const rerollEditPrompt = page.getByRole('dialog', { name: 'Describe the re-roll' });
  await expect(rerollEditPrompt).toBeVisible();
  await rerollEditPrompt.getByRole('button', { name: 'Cancel' }).click();
  await rootNode.hover();
  await page.getByTestId('lineage-hover-preview').getByRole('button', { name: /Remove re-roll/ }).click();
  await expect(rootNode.locator('.lineage-node-prompts span.reroll')).toHaveCount(0);
  await rootNode.focus();
  await rootNode.press('r');
  await expect(page.getByRole('dialog', { name: 'Describe the re-roll' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Describe the re-roll' }).getByRole('button', { name: 'Cancel' }).click();

  const firstCandidate = page.locator('.lineage-node:not(.root-node)').first();
  const anotherNodeTitle = await firstCandidate.locator('strong').textContent();
  expect(anotherNodeTitle).toBeTruthy();
  const anotherNode = page.locator('.lineage-node:not(.root-node)').filter({ hasText: anotherNodeTitle! }).first();
  await page.mouse.move(0, 0);
  await anotherNode.focus();
  await expect(hoverPreview).toHaveCount(1);
  await expect(hoverPreview).toContainText(anotherNodeTitle!);
  await page.mouse.move(0, 0);
  await expect(hoverPreview).toContainText(anotherNodeTitle!);
  await rootNode.evaluate(node => node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await expect(hoverPreview).toContainText('Initial Demo Concept');
  await rootNode.evaluate(node => node.dispatchEvent(new MouseEvent('mouseout', {
    bubbles: true,
    relatedTarget: document.body,
  })));
  await expect(hoverPreview).toContainText(anotherNodeTitle!);
  await anotherNode.press('Enter');
  await expect(hoverPreview).toHaveCount(0);
  await page.getByRole('button', { name: `Open full detail for ${anotherNodeTitle}` }).click();
  const keyboardDialog = page.getByRole('dialog').first();
  await expect(keyboardDialog).toBeVisible();
  await keyboardDialog.getByRole('button', { name: 'Close' }).click();

  await rootNode.focus();
  await rootNode.press('d');
  await page.getByRole('button', { name: 'Open full detail for Initial Demo Concept' }).click();
  const shortcutDetailDialog = page.getByRole('dialog', { name: 'Initial Demo Concept' });
  await expect(shortcutDetailDialog).toBeVisible();
  await shortcutDetailDialog.getByTitle('Close detail').click();

  await rootNode.hover();
  await expect(hoverPreview).toBeVisible();
  await rootNode.click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(hoverPreview).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await rootNode.dblclick();
  await page.getByRole('button', { name: 'Open full detail for Initial Demo Concept' }).click();
  const detailDialog = page.getByRole('dialog', { name: 'Initial Demo Concept' });
  await expect(detailDialog).toBeVisible();
  await expect(hoverPreview).toHaveCount(0);
  await detailDialog.getByTitle('Close detail').click();

  await rootNode.focus();
  await page.mouse.move(0, 0);
  await expect(hoverPreview).toContainText('Initial Demo Concept');
  await openCanvasSettings(page);
  await page.getByRole('radio', { name: 'Top to bottom' }).check();
  await expect(hoverPreview).toHaveCount(0);

  await canvasTools.getByRole('button', { name: /Variation queue/ }).click();
  await expect(page.locator('#lineage-canvas-panel')).toBeVisible();
});

test('creates a lineage workspace from its Workspaces page', async ({ page, request }) => {
  const workspaceId = await seedDemo(request);
  await page.goto(demoCanvasPath(workspaceId));

  await page.locator('.lineage-workspace-exit').click();
  await page.getByRole('button', { name: 'New workspace' }).click();
  const modal = page.getByRole('form', { name: 'New lineage' });
  await expect(modal).toBeVisible();
  await page.getByPlaceholder('Search by title, id, campaign, channel...').fill('meta short-form');
  await modal.getByRole('button', { name: /Meta short-form demo post static/ }).click();
  await page.getByLabel('Name').fill('Catalog e2e lineage');
  await page.getByRole('button', { name: 'Create lineage' }).click();

  await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Catalog e2e lineage');
  await expect(page.getByText('Unknown indexed asset')).not.toBeVisible();
});

async function openCanvasSettings(page: Page) {
  const panel = page.getByRole('complementary', { name: 'Canvas settings' });
  if (!await panel.isVisible()) await page.getByRole('button', { name: 'Open Canvas settings' }).click();
  await expect(panel).toBeVisible();
}
