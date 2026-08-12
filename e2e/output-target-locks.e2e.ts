import { expect, test } from 'playwright/test';

const project = 'demo-project';

test('canvas persists independent node targets, plans only from their digest, and can cancel the immutable job', async ({ page, request }) => {
  const seededResponse = await request.post('/api/lineage-workspaces/demo/seed', {
    data: { project, confirmWrite: true },
  });
  expect(seededResponse.ok()).toBe(true);
  const seeded = await seededResponse.json() as { root_asset_id: string; workspace?: { id: string } };
  const workspaceId = seeded.workspace?.id;
  if (!workspaceId) throw new Error('Demo seed did not return an exact workspace ID');

  try {
    const snapshotResponse = await request.get(`/api/lineage/${seeded.root_asset_id}?project=${project}`);
    expect(snapshotResponse.ok()).toBe(true);
    const snapshot = await snapshotResponse.json() as {
      nodes: Array<{ asset_id: string; title: string }>;
      selected: string[];
    };
    const firstSourceId = snapshot.selected[0] || seeded.root_asset_id;
    const secondSource = snapshot.nodes.find(node => node.asset_id !== firstSourceId);
    expect(secondSource).toBeTruthy();
    const selectionResponse = await request.post('/api/selection', {
      data: {
        project,
        assetId: secondSource!.asset_id,
        rootAssetId: seeded.root_asset_id,
        mode: 'add',
        confirmWrite: true,
      },
    });
    expect(selectionResponse.ok()).toBe(true);

    await page.goto(`/projects/${project}/workspaces/${encodeURIComponent(workspaceId)}`);
    const canvasTools = page.getByRole('region', { name: 'Canvas workspace tools' });
    await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Demo: Content iteration tree', { timeout: 20_000 });

    await canvasTools.getByRole('button', { name: 'Output target defaults' }).click();
    const defaults = page.getByRole('dialog', { name: 'Output target defaults' });
    await expect(defaults).toContainText('agents and CLI can read them but cannot change them');
    await defaults.getByRole('checkbox', { name: /Instagram · Story/ }).check();
    await defaults.getByRole('button', { name: 'Save human defaults' }).click();
    await expect(defaults).toBeHidden();

    await canvasTools.getByRole('button', { name: 'Plan outputs' }).click();
    const sheet = page.getByRole('dialog', { name: 'Plan next branch' });
    const sourceCards = sheet.locator('.lineage-node-target-source');
    await expect(sourceCards).toHaveCount(2);
    await expect(sourceCards).toContainText(['Inherited next 1080×1920', 'Inherited next 1080×1920']);
    const aggregateDigest = sheet.locator('.lineage-resolution-digest code');
    const initialAggregateDigest = await aggregateDigest.textContent();

    const secondCard = sourceCards.filter({ hasText: secondSource!.asset_id });
    await secondCard.locator('summary').click();
    const editor = secondCard.locator('.node-next-targets');
    await expect(editor).toContainText('future children only');
    await editor.getByRole('button', { name: 'Set sticky targets' }).click();
    await editor.getByRole('checkbox', { name: /Instagram · Story/ }).uncheck();
    await editor.getByRole('button', { name: 'Add size' }).click();
    await editor.locator('.node-next-custom-targets input[type="number"]').nth(0).fill('1200');
    await editor.locator('.node-next-custom-targets input[type="number"]').nth(1).fill('1500');
    await editor.getByRole('button', { name: 'Set sticky targets' }).click();
    await expect(secondCard).toContainText('Sticky next 1200×1500');
    await expect.poll(() => aggregateDigest.textContent()).not.toBe(initialAggregateDigest);

    await sheet.getByLabel('Generation prompt').fill('Create exact independent static-image variants');
    await sheet.getByLabel('Variations per produced geometry').fill('2');
    await sheet.getByRole('button', { name: 'Resolve from persisted targets' }).click();
    await expect(sheet.getByText(/4 exact outputs/)).toBeVisible();
    await expect(sheet.getByText('1080 × 1920 px', { exact: true })).toBeVisible();
    await expect(sheet.getByText('1200 × 1500 px', { exact: true })).toBeVisible();
    await expect(aggregateDigest).toHaveText(/^[a-f0-9]{64}$/);

    await sheet.getByRole('button', { name: 'Create planned job' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator('.lineage-node').filter({ hasText: firstSourceId }).locator('.next-output-target')).toHaveText('next 1080×1920');
    await expect(page.locator('.lineage-node').filter({ hasText: secondSource!.asset_id }).locator('.next-output-target')).toHaveText('next 1200×1500');

    const jobsResponse = await request.get(`/api/generation/jobs?project=${project}&rootAssetId=${seeded.root_asset_id}&limit=10`);
    expect(jobsResponse.ok()).toBe(true);
    const jobs = await jobsResponse.json() as {
      jobs: Array<{
        id: string;
        expected_output_count: number;
        status: string;
        source_target_resolutions: Array<{
          origin: string;
          parent_asset_id: string;
          resolution_digest_sha256: string;
          resolved_targets: Array<{ height: number; width: number }>;
        }>;
        target_plan: {
          groups: Array<{ height: number; parent_asset_id: string; variant_count: number; width: number }>;
        };
      }>;
    };
    const job = jobs.jobs[0];
    expect(job.expected_output_count).toBe(4);
    expect(job.source_target_resolutions.map(source => ({
      dimensions: source.resolved_targets.map(target => `${target.width}x${target.height}`),
      origin: source.origin,
      parent: source.parent_asset_id,
    })).sort((a, b) => a.parent.localeCompare(b.parent))).toEqual([
      { dimensions: ['1080x1920'], origin: 'canvas_default', parent: firstSourceId },
      { dimensions: ['1200x1500'], origin: 'node_override', parent: secondSource!.asset_id },
    ].sort((a, b) => a.parent.localeCompare(b.parent)));
    expect(job.source_target_resolutions.every(source => /^[a-f0-9]{64}$/.test(source.resolution_digest_sha256))).toBe(true);
    expect(job.target_plan.groups.map(group => ({
      dimensions: `${group.width}x${group.height}`,
      parent: group.parent_asset_id,
      variants: group.variant_count,
    })).sort((a, b) => a.parent.localeCompare(b.parent))).toEqual([
      { dimensions: '1080x1920', parent: firstSourceId, variants: 2 },
      { dimensions: '1200x1500', parent: secondSource!.asset_id, variants: 2 },
    ].sort((a, b) => a.parent.localeCompare(b.parent)));

    const firstSourceTitle = snapshot.nodes.find(node => node.asset_id === firstSourceId)!.title;
    await page.getByRole('button', { name: `${firstSourceTitle} details` }).dispatchEvent('dblclick');
    await expect(page.getByRole('complementary', { name: 'Canvas asset details' })).toBeVisible();
    await page.getByRole('button', { name: `Open full detail for ${firstSourceTitle}` }).click();
    const detail = page.getByRole('dialog', { name: firstSourceTitle });
    await expect(detail).toBeVisible();
    await detail.locator('[data-testid="lineage-generation-proof"] summary').click();
    await expect(detail).toContainText('Frozen source target resolution');
    await expect(detail).toContainText(job.id);
    await detail.getByRole('button', { name: 'Cancel planned job' }).click();
    await expect(detail).toContainText('cancelled');

    const cancelledResponse = await request.get(`/api/generation/jobs?project=${project}&rootAssetId=${seeded.root_asset_id}&limit=10`);
    const cancelled = await cancelledResponse.json() as { jobs: Array<{ id: string; status: string }> };
    expect(cancelled.jobs.find(item => item.id === job.id)?.status).toBe('cancelled');
  } finally {
    if (seeded.workspace?.id) {
      await request.post(`/api/lineage-workspaces/${encodeURIComponent(seeded.workspace.id)}/archive`, {
        data: { project, confirmWrite: true },
      });
    }
  }
});
