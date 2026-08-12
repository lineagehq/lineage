import { expect, test } from 'playwright/test';

const project = 'demo-project';
let workspaceId = '';
let rootAssetId = '';

test.beforeEach(async ({ request }) => {
  const seeded = await request.post('/api/lineage-workspaces/demo/seed', { data: { confirmWrite: true, project } });
  expect(seeded.ok()).toBe(true);
  const result = await seeded.json();
  workspaceId = result.workspace.id;
  rootAssetId = result.workspace.root_asset_id;
  const cleared = await request.post(`/api/lineage/${rootAssetId}/discussion-marks/actions/clear`, {
    data: { actor: 'e2e', confirmWrite: true, project },
  });
  expect(cleared.ok()).toBe(true);
});

function canvasPath() {
  return `/projects/${project}/workspaces/${encodeURIComponent(workspaceId)}`;
}

test('flags nodes for discussion with compact configurable actions and persistent state chips', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(canvasPath());
  await expect(page.getByRole('region', { name: 'Discussion set', exact: true })).toHaveCount(0);

  const nodes = page.locator('.lineage-node[data-asset-id]');
  await expect(nodes.first()).toBeVisible();
  const firstId = await nodes.first().getAttribute('data-asset-id');
  await nodes.first().hover();
  const quickActions = page.getByLabel(/Quick actions for/);
  const actionButtons = quickActions.locator('.lineage-hover-preview-actions button');
  await expect(actionButtons).toHaveCount(5);
  const actionTops = await actionButtons.evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().top)));
  expect(new Set(actionTops).size).toBe(1);
  await quickActions.getByRole('button', { name: 'Flag', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add an optional note' })).toHaveCount(0);
  await expect(nodes.first().locator('.lineage-state-chips-node .flag')).toContainText('F');
  await expect(nodes.first().locator('.lineage-state-chips-node .flag')).toHaveAttribute('title', 'Flagged for discussion');
  await expect(quickActions.getByRole('button', { name: 'Flag', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(quickActions.getByRole('button', { name: 'Flag', exact: true })).toHaveClass(/selected/);
  await nodes.first().focus();
  await page.keyboard.press('f');
  await expect(nodes.first().locator('.lineage-state-chips-node .flag')).toHaveCount(0);
  await nodes.first().hover();
  await expect(quickActions.getByRole('button', { name: 'Flag', exact: true })).not.toHaveClass(/selected/);
  await nodes.first().focus();
  await page.keyboard.press('f');
  await expect(nodes.first().locator('.lineage-state-chips-node .flag')).toContainText('F');
  await nodes.first().hover();
  await expect(quickActions.getByRole('button', { name: 'Flag', exact: true })).toHaveClass(/selected/);
  const socialButton = quickActions.getByRole('button', { name: 'Social', exact: true });
  await socialButton.click();
  const socialPanel = page.getByRole('complementary', { name: 'Social composition' });
  await expect(socialPanel).toBeVisible();
  await socialPanel.getByRole('button', { name: 'Close Social composition' }).click();
  await nodes.first().focus();
  await page.keyboard.press('s');
  await expect(socialPanel).toBeVisible();
  await socialPanel.getByRole('button', { name: 'Close Social composition' }).click();

  const snapshot = await (await request.get(`/api/lineage/${rootAssetId}?project=${project}`)).json();
  const additional = snapshot.nodes.map((node: { asset_id: string }) => node.asset_id).filter((id: string) => id !== firstId).slice(0, 2);
  for (const assetId of additional) {
    const marked = await request.post(`/api/lineage/${rootAssetId}/discussion-marks/${assetId}`, {
      data: { actor: 'e2e', confirmWrite: true, project },
    });
    expect(marked.ok()).toBe(true);
  }
  await page.reload();
  await expect(page.locator('.lineage-state-chips-node .flag')).toHaveCount(3);

  await page.getByRole('button', { name: 'Open Canvas settings' }).click();
  const askForNote = page.getByRole('switch', { name: 'Ask for a note when flagging for discussion' });
  await expect(askForNote).toHaveAttribute('aria-checked', 'false');
  await askForNote.click();
  await expect(askForNote).toHaveAttribute('aria-checked', 'true');
  const showSocial = page.getByRole('switch', { name: 'Show Social in hover preview' });
  await expect(showSocial).toHaveAttribute('aria-checked', 'true');
  await showSocial.click();
  await expect(showSocial).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Close Canvas settings' }).click();

  const unmarkedCandidate = nodes.filter({ hasNot: page.locator('.lineage-state-chips-node .flag') }).first();
  const unmarkedId = await unmarkedCandidate.getAttribute('data-asset-id');
  expect(unmarkedId).toBeTruthy();
  const unmarked = page.locator(`.lineage-node[data-asset-id="${unmarkedId}"]`);
  await unmarked.hover();
  await expect(quickActions.getByRole('button', { name: 'Social', exact: true })).toHaveCount(0);
  const flagButton = quickActions.getByRole('button', { name: 'Flag', exact: true });
  await flagButton.click();
  const dialog = page.getByRole('dialog', { name: 'Add an optional note' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.lineage-state-chips-node .flag')).toHaveCount(3);
  await expect(flagButton).toBeFocused();

  await flagButton.click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Discussion note').fill('Is this sized appropriately for the selected channel?');
  await dialog.getByRole('button', { name: 'Flag for discussion' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(unmarked.locator('.lineage-state-chips-node .flag')).toContainText('F');
  await unmarked.hover();
  await expect(quickActions.locator('.lineage-state-chips-preview .flag')).toContainText('F');
  await quickActions.getByRole('button', { name: `Edit discussion note for ${await unmarked.locator('strong').first().textContent()}` }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit optional note' });
  await expect(editDialog).toBeVisible();
  await editDialog.getByLabel('Discussion note').fill('Compare this size across the selected channels.');
  await editDialog.getByRole('button', { name: 'Save note' }).click();
  await expect(editDialog).toHaveCount(0);
  const flaggedSnapshot = await (await request.get(`/api/lineage/${rootAssetId}?project=${project}`)).json();
  expect(flaggedSnapshot.nodes.find((node: { asset_id: string }) => node.asset_id === unmarkedId).discussion_mark.notes).toBe('Compare this size across the selected channels.');

  const cleared = await request.post(`/api/lineage/${rootAssetId}/discussion-marks/actions/clear`, {
    data: { actor: 'e2e', confirmWrite: true, project },
  });
  expect(cleared.ok()).toBe(true);
  await page.reload();
  await expect(page.locator('.lineage-state-chips-node .flag')).toHaveCount(0);
});
