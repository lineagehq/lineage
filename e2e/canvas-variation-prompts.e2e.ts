import { expect, test } from 'playwright/test';

const project = 'demo-project';

test('persists exact branch and re-roll prompts on nodes and in the agent task handoff', async ({ page, request }) => {
  test.setTimeout(90_000);
  const seededResponse = await request.post('/api/lineage-workspaces/demo/seed', {
    data: { project, confirmWrite: true },
  });
  expect(seededResponse.ok()).toBe(true);
  const seeded = await seededResponse.json() as { root_asset_id: string; workspace?: { id: string; max_queued_branches?: number } };
  if (!seeded.workspace?.id) throw new Error('Demo seed did not return a workspace');

  const before = await (await request.get(`/api/lineage/${seeded.root_asset_id}?project=${project}`)).json() as {
    nodes: Array<{ asset_id: string; title: string; reroll_request?: { status: string } }>;
  };
  await request.post('/api/selection', { data: { project, rootAssetId: seeded.root_asset_id, clear: true, confirmWrite: true } });
  for (const node of before.nodes.filter(item => item.reroll_request?.status === 'pending')) {
    await request.post(`/api/lineage/${seeded.root_asset_id}/rerolls/${node.asset_id}/cancel`, {
      data: { project, confirmWrite: true },
    });
  }

  try {
    await page.goto(`/projects/${project}/workspaces/${encodeURIComponent(seeded.workspace.id)}`);
    await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Demo: Content iteration tree', { timeout: 20_000 });

    const branchPrompt = 'Restyle this as a bold Swiss editorial poster with a tighter red grid.';
    const editedBranchPrompt = 'Restyle this as a strict Swiss editorial poster with a tighter red grid and more whitespace.';
    const rootNode = page.locator('.lineage-node.root-node');
    await rootNode.hover();
    await page.getByTestId('lineage-hover-preview').getByRole('button', { name: /Branch/ }).click();
    const branchDialog = page.getByRole('dialog', { name: 'Describe the next branch' });
    await expect(page.getByTestId('lineage-hover-preview')).toHaveCount(0);
    await expect(branchDialog).not.toContainText('Codex');
    await expect(branchDialog).toHaveClass(/anchored/);
    await branchDialog.getByLabel('What should your agent change?').fill(branchPrompt);
    await branchDialog.getByRole('button', { name: 'Queue branch' }).click();
    await expect(branchDialog).toBeHidden();
    await expect(rootNode.locator('.lineage-node-prompts span').filter({ hasText: 'Branch' })).toHaveAttribute('title', `Branch prompt: ${branchPrompt}`);

    const rerollPrompt = 'Keep the composition exactly; repair the distorted headline and soften the shadow.';
    const rerollNode = page.locator('.lineage-node:not(.root-node)').first();
    const rerollAssetId = await rerollNode.locator('small').first().textContent();
    expect(rerollAssetId).toBeTruthy();
    await page.mouse.move(0, 0);
    await rerollNode.focus();
    await rerollNode.press('r');
    const rerollDialog = page.getByRole('dialog', { name: 'Describe the re-roll' });
    await expect(page.getByTestId('lineage-hover-preview')).toHaveCount(0);
    await rerollDialog.getByLabel('What should your agent change?').fill(rerollPrompt);
    await rerollDialog.getByRole('button', { name: 'Queue re-roll' }).click();
    await expect(rerollDialog).toBeHidden();
    await expect(rerollNode.locator('.lineage-node-prompts span.reroll')).toHaveAttribute('title', `Re-roll prompt: ${rerollPrompt}`);

    const unrelatedControl = page.getByRole('button', { name: /Back to .* workspaces/ });
    await unrelatedControl.focus();
    await page.keyboard.press('v');
    await expect(page.getByRole('complementary', { name: 'Variation queue' })).toHaveCount(0);
    await expect(unrelatedControl).toBeFocused();

    await rootNode.focus();
    await page.keyboard.press('v');
    const queue = page.getByRole('complementary', { name: 'Variation queue' });
    await expect(queue).toBeVisible();
    await expect(page.getByTestId('lineage-hover-preview')).toHaveCount(0);
    await expect(queue).toContainText('Ready for your agent');
    await expect(queue.locator('.lineage-variation-card')).toHaveCount(2);
    await expect(rootNode).toHaveClass(/variation-queued/);
    await expect(rerollNode).toHaveClass(/variation-queued/);
    await page.keyboard.press('v');
    await expect(queue).toBeHidden();
    await expect(rootNode).toBeFocused();
    await page.keyboard.press('v');
    await expect(queue).toBeVisible();

    const rerollCard = queue.locator(`[data-mode="reroll"][data-node-id="${rerollAssetId}"]`);
    await rerollCard.locator('.lineage-variation-select').click();
    await expect(rerollNode).toHaveClass(/variation-primary/);
    await expect(rerollCard.locator('textarea')).toBeFocused();
    await expect.poll(async () => {
      const [nodeBox, queueBox] = await Promise.all([rerollNode.boundingBox(), queue.boundingBox()]);
      return Boolean(nodeBox && queueBox && nodeBox.x + nodeBox.width <= queueBox.x - 8);
    }).toBe(true);
    await page.keyboard.press('Escape');
    await expect(rerollCard.locator('textarea')).toHaveCount(0);
    await expect(queue).toBeVisible();
    await rerollCard.getByRole('button', { name: /Show .* on canvas/ }).click();
    await expect(rerollNode).toHaveClass(/variation-primary/);

    await queue.getByRole('button', { name: 'Close Variation queue' }).click();
    await page.getByRole('button', { name: 'Open Canvas settings' }).click();
    const autoEdit = page.getByRole('switch', { name: 'Edit prompt when selecting a variation' });
    await expect(autoEdit).toHaveAttribute('aria-checked', 'true');
    await autoEdit.focus();
    await page.keyboard.press('v');
    await expect(page.getByRole('complementary', { name: 'Canvas settings' })).toBeVisible();
    await expect(queue).toBeHidden();
    await expect(autoEdit).toBeFocused();
    await autoEdit.click();
    await expect(autoEdit).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('region', { name: 'Canvas workspace tools' }).getByRole('button', { name: /Variation queue/ }).click();
    await expect(page.getByRole('complementary', { name: 'Canvas settings' })).toBeHidden();
    await expect(queue).toBeVisible();
    const branchCard = queue.locator(`[data-mode="branch"][data-node-id="${seeded.root_asset_id}"]`);
    await branchCard.locator('.lineage-variation-select').click();
    await expect(branchCard.locator('textarea')).toHaveCount(0);
    await branchCard.getByRole('button', { name: /Edit branch prompt/ }).click();
    await branchCard.locator('textarea').fill(editedBranchPrompt);
    await branchCard.locator('textarea').press('Control+Enter');
    await expect(branchCard.locator('textarea')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.lineage-node.root-node .lineage-node-prompts span').filter({ hasText: 'Branch' })).toHaveAttribute('title', `Branch prompt: ${editedBranchPrompt}`);
    await expect(page.locator('.lineage-node').filter({ hasText: rerollAssetId! }).locator('.lineage-node-prompts span.reroll')).toHaveAttribute('title', `Re-roll prompt: ${rerollPrompt}`);

    const snapshot = await (await request.get(`/api/lineage/${seeded.root_asset_id}?project=${project}`)).json() as {
      nodes: Array<{ asset_id: string; branch_prompt?: string; reroll_request?: { prompt?: string } }>;
      tasks: Array<{ instructions?: string; target_asset_id: string; task_type: string }>;
    };
    expect(snapshot.nodes.find(node => node.asset_id === seeded.root_asset_id)?.branch_prompt).toBe(editedBranchPrompt);
    expect(snapshot.nodes.find(node => node.asset_id === rerollAssetId)?.reroll_request?.prompt).toBe(rerollPrompt);
    expect(snapshot.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ target_asset_id: seeded.root_asset_id, task_type: 'iterate', instructions: editedBranchPrompt }),
      expect.objectContaining({ target_asset_id: rerollAssetId, task_type: 'reroll', instructions: rerollPrompt }),
    ]));

    const brief = await (await request.get(`/api/lineage/${seeded.root_asset_id}/brief?project=${project}`)).json() as {
      brief: { prompt: string; variation_prompts?: Array<{ asset_id: string; prompt: string }> };
    };
    expect(brief.brief.variation_prompts).toContainEqual({ asset_id: seeded.root_asset_id, prompt: editedBranchPrompt });
    expect(brief.brief.prompt).toContain(editedBranchPrompt);

    await rootNode.focus();
    await rootNode.press('b');
    await expect(rootNode).not.toHaveClass(/selected/);
    await rerollNode.focus();
    await rerollNode.press('r');
    await expect(rerollNode.locator('.lineage-node-prompts span.reroll')).toHaveCount(0);

    const afterRemoval = await (await request.get(`/api/lineage/${seeded.root_asset_id}?project=${project}`)).json() as {
      nodes: Array<{ asset_id: string; branch_prompt?: string; reroll_request?: { prompt?: string } }>;
      tasks: Array<{ status: string; target_asset_id: string; task_type: string }>;
    };
    expect(afterRemoval.nodes.find(node => node.asset_id === seeded.root_asset_id)?.branch_prompt).toBeUndefined();
    expect(afterRemoval.nodes.find(node => node.asset_id === rerollAssetId)?.reroll_request).toBeUndefined();
    expect(afterRemoval.tasks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ target_asset_id: seeded.root_asset_id, task_type: 'iterate' }),
      expect.objectContaining({ target_asset_id: rerollAssetId, task_type: 'reroll' }),
    ]));

    await page.getByRole('button', { name: 'Open Canvas settings' }).click();
    const branchPromptOnMark = page.getByRole('switch', { name: 'Ask for a Branch prompt when marking' });
    const rerollPromptOnMark = page.getByRole('switch', { name: 'Ask for a Re-roll prompt when marking' });
    await expect(branchPromptOnMark).toHaveAttribute('aria-checked', 'true');
    await expect(rerollPromptOnMark).toHaveAttribute('aria-checked', 'true');
    await branchPromptOnMark.click();
    await expect(branchPromptOnMark).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Close Canvas settings' }).click();

    await rootNode.focus();
    await rootNode.press('b');
    await expect(page.getByRole('dialog', { name: 'Describe the next branch' })).toHaveCount(0);
    await expect(rootNode.locator('.lineage-state-chips-node .branch')).toContainText('B');
    await expect(rootNode.locator('.lineage-node-prompts span').filter({ hasText: 'Branch' })).toHaveAttribute('title', 'Branch has no prompt');

    await rerollNode.focus();
    await rerollNode.press('r');
    await expect(page.getByRole('dialog', { name: 'Describe the re-roll' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Describe the re-roll' }).getByRole('button', { name: 'Cancel' }).click();
    await rootNode.focus();
    await rootNode.press('b');
    await expect(rootNode.locator('.lineage-state-chips-node .branch')).toHaveCount(0);

    await page.getByRole('button', { name: 'Open Canvas settings' }).click();
    await branchPromptOnMark.click();
    await rerollPromptOnMark.click();
    await expect(branchPromptOnMark).toHaveAttribute('aria-checked', 'true');
    await expect(rerollPromptOnMark).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Close Canvas settings' }).click();

    await rerollNode.focus();
    await rerollNode.press('r');
    await expect(page.getByRole('dialog', { name: 'Describe the re-roll' })).toHaveCount(0);
    await expect(rerollNode.locator('.lineage-state-chips-node .reroll')).toContainText('R');
    await expect(rerollNode.locator('.lineage-node-prompts span.reroll')).toHaveAttribute('title', 'Re-roll has no prompt');

    await rootNode.focus();
    await rootNode.press('b');
    await expect(page.getByRole('dialog', { name: 'Describe the next branch' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Describe the next branch' }).getByRole('button', { name: 'Cancel' }).click();
    await rerollNode.focus();
    await rerollNode.press('r');
    await expect(rerollNode.locator('.lineage-state-chips-node .reroll')).toHaveCount(0);

    const limitResponse = await request.post(`/api/lineage-workspaces/${encodeURIComponent(seeded.workspace.id)}`, {
      data: { project, maxQueuedBranches: 1, confirmWrite: true },
    });
    expect(limitResponse.ok()).toBe(true);
    await page.reload();
    await rootNode.focus();
    await rootNode.press('b');
    await page.getByRole('dialog', { name: 'Describe the next branch' }).getByRole('button', { name: 'Queue without prompt' }).click();
    await expect(rootNode.locator('.lineage-node-prompts span').filter({ hasText: 'Branch' })).toHaveAttribute('title', 'Branch has no prompt');

    await page.getByRole('button', { name: /Back to .* workspaces/ }).focus();
    await rerollNode.hover();
    const cappedBranch = page.getByTestId('lineage-hover-preview').getByRole('button', { name: /Branch limit/ });
    const capMessage = '1 of 1 branches queued. Raise the maximum in Canvas settings or remove a branch.';
    await expect(cappedBranch).toHaveAttribute('aria-disabled', 'true');
    await expect(cappedBranch).toHaveAttribute('title', capMessage);
    await page.mouse.move(0, 0);
    await rerollNode.focus();
    await rerollNode.press('b');
    await expect(page.getByRole('status')).toContainText(capMessage);

    await page.getByRole('button', { name: 'Open Canvas settings' }).click();
    const maxBranches = page.getByRole('spinbutton', { name: 'Maximum queued branches' });
    await expect(maxBranches).toHaveValue('1');
    await maxBranches.fill('2');
    await expect(maxBranches).toHaveValue('2');
  } finally {
    await request.post('/api/selection', {
      data: { project, rootAssetId: seeded.root_asset_id, clear: true, confirmWrite: true },
    });
    const cleanupSnapshot = await (await request.get(`/api/lineage/${seeded.root_asset_id}?project=${project}`)).json() as {
      nodes: Array<{ asset_id: string; reroll_request?: { status: string } }>;
    };
    for (const node of cleanupSnapshot.nodes.filter(item => item.reroll_request?.status === 'pending')) {
      await request.post(`/api/lineage/${seeded.root_asset_id}/rerolls/${node.asset_id}/cancel`, {
        data: { project, confirmWrite: true },
      });
    }
    await request.post(`/api/lineage-workspaces/${encodeURIComponent(seeded.workspace.id)}`, {
      data: { project, maxQueuedBranches: seeded.workspace.max_queued_branches || 3, confirmWrite: true },
    });
  }
});
