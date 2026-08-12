import { expect, test } from 'playwright/test';

const project = 'demo-project';
const firstRoot = 'demo-meta-short-form-upload-demo-post-static';
const secondRoot = 'demo-linkedin-ledger-catalog-shared';
let firstWorkspaceId = '';
let secondWorkspaceId = '';
const cleanupProjects = new Map<string, string>();

test.beforeAll(async ({ request }) => {
  const first = await request.post('/api/lineage-workspaces', {
    data: {
      confirmWrite: true,
      project,
      rootAssetId: firstRoot,
      title: 'Portrait launch concepts',
    },
  });
  expect(first.ok()).toBe(true);
  firstWorkspaceId = (await first.json()).workspace.id;

  const second = await request.post('/api/lineage-workspaces', {
    data: {
      confirmWrite: true,
      project,
      rootAssetId: secondRoot,
      title: 'Ledger story variants',
    },
  });
  expect(second.ok()).toBe(true);
  secondWorkspaceId = (await second.json()).workspace.id;
});

test.afterAll(async ({ request }) => {
  for (const [id, displayName] of cleanupProjects) {
    const planned = await request.get(`/api/projects/${id}/deletion-plan`);
    if (!planned.ok()) continue;
    const plan = (await planned.json()).plan;
    await request.post(`/api/projects/${id}/delete`, {
      data: {
        expectedDigest: plan.digest,
        confirmation: displayName,
        confirmWrite: true,
      },
    });
  }
});

test('starts on Projects and opens Workspaces before Canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/projects');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  const demoProject = page.locator('.organization-item').filter({ hasText: project }).first();
  await expect(demoProject).toBeVisible();
  await demoProject.getByRole('button', { name: /Open (project|demo)/ }).click();

  await expect(page).toHaveURL(`/projects/${project}/workspaces`);
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
  await expect(page.getByText('Choose a workspace to open its canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'All projects' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Canvas' }).first()).toBeVisible();
});

test('successful new-workspace creation stays on its exact Canvas destination', async ({ page }) => {
  const root = 'demo-linkedin-upload-demo-done-static-grounded-v2';
  await page.goto(`/projects/${project}/new-workspace`);
  const dialog = page.getByRole('form', { name: 'New lineage' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Root asset').fill(root);
  await dialog.getByRole('button').filter({ hasText: root }).click();
  await dialog.getByLabel('Name').fill('Created from project overview');
  await dialog.getByRole('button', { name: 'Create lineage' }).click();

  await expect(page).toHaveURL(canvasPath(`${project}:lineage-workspace:${root}`));
  await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Created from project overview');
});

test('routes project-level destinations and create/upload onto an explicit studio surface', async ({ page }) => {
  await page.goto(`/projects/${project}/workspaces`);
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await expect(page).toHaveURL(`/projects/${project}/studio/assets`);
  await expect(page.locator('.asset-board')).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(`/projects/${project}/studio/assets`);
  await expect(page.locator('.asset-board')).toBeVisible();

  await page.goto(`/projects/${project}/workspaces`);
  await page.getByRole('button', { name: 'Create or upload', exact: true }).click();
  await expect(page).toHaveURL(`/projects/${project}/studio/assets`);
  await expect(page.getByRole('heading', { name: 'Upload asset' })).toBeVisible();

  await page.goto(canvasPath(firstWorkspaceId));
  await expect(page.locator('.lineage-workbench')).toBeVisible();
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await expect(page).toHaveURL(`/projects/${project}/studio/assets`);
  await page.goBack();
  await expect(page).toHaveURL(canvasPath(firstWorkspaceId));
  await expect(page.locator('.lineage-workbench')).toBeVisible();
});

test('shows Swissifier as its own project and enters through its workspace list', async ({ page }) => {
  await page.goto('/projects');
  const swissifier = page.locator('.organization-item').filter({ hasText: 'swissifier-demo' });
  await expect(swissifier.getByRole('heading', { name: 'Swissifier Demo' })).toBeVisible();
  await swissifier.getByRole('heading', { name: 'Swissifier Demo' }).click();

  await expect(page).toHaveURL('/projects/swissifier-demo/workspaces');
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
  await expect(page.locator('.organization-item').filter({ hasText: 'Swissifier rich demo' })).toBeVisible();
});

test('keeps explicit Swissifier deletion suppressed until Restore demo', async ({ page, request }) => {
  const planResponse = await request.get('/api/projects/swissifier-demo/deletion-plan');
  expect(planResponse.ok()).toBe(true);
  const plan = (await planResponse.json()).plan;
  const deleted = await request.post('/api/projects/swissifier-demo/delete', {
    data: {
      expectedDigest: plan.digest,
      confirmation: 'Swissifier Demo',
      confirmWrite: true,
    },
  });
  expect(deleted.ok()).toBe(true);

  await page.goto('/projects');
  await expect(page.locator('.organization-item').filter({ hasText: 'swissifier-demo' })).toHaveCount(0);
  const restore = page.getByRole('button', { name: 'Restore demo' });
  await expect(restore).toBeVisible();
  await page.reload();
  await expect(page.locator('.organization-item').filter({ hasText: 'swissifier-demo' })).toHaveCount(0);
  await restore.click();

  await expect(page).toHaveURL('/projects/swissifier-demo/workspaces');
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
  await expect(page.locator('.organization-item').filter({ hasText: 'Swissifier rich demo' })).toBeVisible();
});

test('keeps exact workspace identity independent in two tabs and switches through Workspaces', async ({ context, request }) => {
  const firstPage = await context.newPage();
  const secondPage = await context.newPage();
  await Promise.all([
    firstPage.goto(canvasPath(firstWorkspaceId)),
    secondPage.goto(canvasPath(secondWorkspaceId)),
  ]);

  const firstWorkspace = firstPage.locator('.lineage-workspace-title strong');
  const secondWorkspace = secondPage.locator('.lineage-workspace-title strong');
  await expect(firstWorkspace).toHaveText('Portrait launch concepts');
  await expect(secondWorkspace).toHaveText('Ledger story variants');

  const legacyActivation = await request.post(`/api/lineage-workspaces/${encodeURIComponent(secondWorkspaceId)}/activate`, {
    data: { confirmWrite: true, project },
  });
  expect(legacyActivation.ok()).toBe(true);
  await firstPage.waitForTimeout(250);
  await expect(firstWorkspace).toHaveText('Portrait launch concepts');
  await expect(firstPage).toHaveURL(canvasPath(firstWorkspaceId));

  await firstPage.locator('.lineage-workspace-exit').click();
  await expect(firstPage).toHaveURL(`/projects/${project}/workspaces`);
  await expect(firstPage.locator('.lineage-workspace-picker')).toHaveCount(0);
  const ledgerWorkspace = firstPage.locator('.organization-item').filter({ hasText: 'Ledger story variants' });
  await ledgerWorkspace.getByRole('button', { name: 'Open Canvas' }).click();
  await expect(firstPage).toHaveURL(canvasPath(secondWorkspaceId));
  await expect(firstPage.locator('.lineage-workspace-title strong')).toHaveText('Ledger story variants');
});

test('Back and Forward traverse Projects, Workspaces, and exact Canvas', async ({ page }) => {
  await page.goto('/projects');
  const demoProject = page.locator('.organization-item').filter({ hasText: project }).first();
  await demoProject.getByRole('button', { name: /Open (project|demo)/ }).click();
  await expect(page).toHaveURL(`/projects/${project}/workspaces`);

  await page.getByRole('button', { name: 'Show workspaces as a list' }).click();
  const workspace = page.locator('.organization-item').filter({ hasText: 'Portrait launch concepts' });
  await workspace.getByRole('button', { name: 'Open Canvas' }).click();
  await expect(page).toHaveURL(canvasPath(firstWorkspaceId));

  await page.goBack();
  await expect(page).toHaveURL(`/projects/${project}/workspaces`);
  await page.goBack();
  await expect(page).toHaveURL('/projects');
  await page.goForward();
  await expect(page).toHaveURL(`/projects/${project}/workspaces`);
  await page.goForward();
  await expect(page).toHaveURL(canvasPath(firstWorkspaceId));
});

test('an invalid workspace fails visibly and recovers to its project', async ({ page }) => {
  await page.goto(canvasPath('missing-workspace'));

  await expect(page).toHaveURL(`/projects/${project}/workspaces`);
  await expect(page.getByRole('status').filter({ hasText: 'missing-workspace' })).toBeVisible();
  await expect(page.getByText('Choose a workspace to open its canvas')).toBeVisible();
});

test('keeps collection ordering accessible, responsive, animated, and durable', async ({ page, request }) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const created = Array.from({ length: 11 }, (_, index) => ({
    id: `organization-${String.fromCharCode(97 + index)}`,
    displayName: `Organization ${String.fromCharCode(65 + index)}`,
  }));
  for (const project of created) {
    const response = await request.post('/api/projects', {
      data: { id: project.id, displayName: project.displayName, confirmWrite: true },
    });
    expect(response.ok()).toBe(true);
    cleanupProjects.set(project.id, project.displayName);
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/projects');
  await page.getByLabel('Projects per page').selectOption('6');
  await expect(page.getByText(/Page 1 of/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }))).toEqual({ documentWidth: 320, viewportWidth: 320 });

  const target = created[1];
  const handle = () => page.getByRole('button', { name: `Reorder ${target.displayName}` });
  await handle().press('Space');
  await handle().press('Home');
  await handle().press('Enter');
  await expect.poll(async () => {
    const response = await request.get('/api/projects?page=1&pageSize=100&sort=manual');
    return (await response.json()).projects[0]?.id;
  }).toBe(target.id);

  await page.reload();
  await page.getByLabel('Projects per page').selectOption('6');
  await expect(page.locator('.organization-item h2').first()).toHaveText(target.displayName);
  await page.getByRole('button', { name: 'Show projects as a list' }).click();
  await expect(page.locator('[data-presentation="list"] .organization-item h2').first()).toHaveText(target.displayName);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  const orderedItem = page.locator('.ordered-collection-item').filter({ hasText: target.displayName });
  await orderedItem.getByRole('button', { name: `Move ${target.displayName} later` }).click();
  await expect.poll(async () => {
    const response = await request.get('/api/projects?page=1&pageSize=100&sort=manual');
    return (await response.json()).projects[1]?.id;
  }).toBe(target.id);

  const firstItem = page.locator('.ordered-collection-item').first();
  await expect(firstItem).toHaveCSS('transition-duration', '0s');
  const newProject = page.getByRole('button', { name: 'New project' });
  await newProject.click();
  const createDialog = page.getByRole('dialog', { name: 'Create project' });
  await expect(createDialog).toHaveCSS('animation-name', 'none');
  await page.keyboard.press('Escape');
  await expect(createDialog).toHaveCount(0);
  await expect(newProject).toBeFocused();

  const deleteItem = page.locator('.organization-item').filter({ hasText: target.displayName });
  const deleteButton = deleteItem.getByRole('button', { name: 'Delete' });
  await deleteButton.click();
  const deleteDialog = page.getByRole('alertdialog', { name: 'Permanently delete project?' });
  await expect(deleteDialog).toContainText('Local source files, generated files, and cloud objects are not deleted');
  await page.keyboard.press('Escape');
  await expect(deleteDialog).toHaveCount(0);
  await expect(deleteButton).toBeFocused();

  await deleteButton.click();
  const confirmedDialog = page.getByRole('alertdialog', { name: 'Permanently delete project?' });
  await confirmedDialog.getByRole('textbox').fill(target.displayName);
  await confirmedDialog.getByRole('button', { name: 'Delete project permanently' }).click();
  await expect(confirmedDialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeFocused();
  expect((await request.get(`/api/projects/${target.id}`)).status()).toBe(404);
  cleanupProjects.delete(target.id);
  expect(consoleErrors).toEqual([]);
});

test('creates a project and completes workspace archive, restore, and permanent deletion in the UI', async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const createdProject = {
    id: 'browser-created-project',
    displayName: 'Browser Created Project',
  };
  cleanupProjects.set(createdProject.id, createdProject.displayName);

  await page.goto('/projects');
  const createButton = page.getByRole('button', { name: 'New project' });
  await createButton.click();
  const createDialog = page.getByRole('dialog', { name: 'Create project' });
  await createDialog.getByLabel('Project name').fill(createdProject.displayName);
  await expect(createDialog.getByLabel('Stable project ID')).toHaveValue(createdProject.id);
  await createDialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(createDialog).toHaveCount(0);
  await expect(createButton).toBeFocused();
  await expect(page.locator('.organization-item').filter({ hasText: createdProject.displayName })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.organization-item').filter({ hasText: createdProject.displayName })).toBeVisible();

  const lifecycleRoot = 'demo-linkedin-upload-demo-done-static-grounded-v2';
  const lifecycleTitle = 'Lifecycle proof workspace';
  const created = await request.post('/api/lineage-workspaces', {
    data: {
      confirmWrite: true,
      project,
      rootAssetId: lifecycleRoot,
      title: lifecycleTitle,
    },
  });
  expect(created.ok()).toBe(true);
  const lifecycleWorkspaceId = (await created.json()).workspace.id;

  await page.goto(`/projects/${project}/workspaces`);
  let workspace = page.locator('.organization-item').filter({ hasText: lifecycleTitle });
  await workspace.getByRole('button', { name: 'Archive' }).click();
  let lifecycleDialog = page.getByRole('dialog', { name: 'Archive workspace?' });
  await lifecycleDialog.getByRole('button', { name: 'Archive workspace', exact: true }).click();
  await expect(lifecycleDialog).toHaveCount(0);
  await expect(page.locator('#project-workspaces-title')).toBeFocused();

  await page.getByRole('tab', { name: 'Archived' }).click();
  workspace = page.locator('.organization-item').filter({ hasText: lifecycleTitle });
  await expect(workspace).toBeVisible();
  await workspace.getByRole('button', { name: 'Restore' }).click();
  lifecycleDialog = page.getByRole('dialog', { name: 'Restore workspace?' });
  await lifecycleDialog.getByRole('button', { name: 'Restore workspace', exact: true }).click();
  await expect(lifecycleDialog).toHaveCount(0);

  await page.getByRole('tab', { name: 'Open' }).click();
  workspace = page.locator('.organization-item').filter({ hasText: lifecycleTitle });
  await workspace.getByRole('button', { name: 'Delete' }).click();
  const deleteDialog = page.getByRole('alertdialog', { name: 'Permanently delete workspace?' });
  await expect(deleteDialog).toContainText('Asset records, local files, generated files, and cloud objects are preserved');
  await deleteDialog.getByRole('button', { name: 'Delete workspace permanently' }).click();
  await expect(deleteDialog).toHaveCount(0);
  await expect(page.locator('#project-workspaces-title')).toBeFocused();
  await expect(page.locator('.organization-item').filter({ hasText: lifecycleTitle })).toHaveCount(0);

  const collection = await request.get(`/api/projects/${project}/workspaces?collection=open&pageSize=100`);
  expect(collection.ok()).toBe(true);
  expect((await collection.json()).workspaces.some((item: { id: string }) => item.id === lifecycleWorkspaceId)).toBe(false);
  const preservedAsset = await request.post('/api/assets/lookup', {
    data: { project, assetIds: [lifecycleRoot] },
  });
  expect(preservedAsset.ok()).toBe(true);
  expect((await preservedAsset.json()).assets).toEqual([
    expect.objectContaining({ asset_id: lifecycleRoot }),
  ]);
  expect(consoleErrors).toEqual([]);
});

function canvasPath(workspaceId: string) {
  return `/projects/${project}/workspaces/${encodeURIComponent(workspaceId)}`;
}
