import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'playwright/test';

const project = 'bleep-e2e-project';
const rootAssetId = 'bleep-e2e-root-static';
const workspaceTitle = 'Bleep e2e workspace';
const projectDir = join(process.cwd(), project);
let workspaceId = '';

function writeProjectCatalog() {
  mkdirSync(join(projectDir, 'assets'), { recursive: true });
  writeFileSync(join(projectDir, 'assets', 'catalog.json'), `${JSON.stringify({
    assets: [{
      asset_id: rootAssetId,
      audience: 'creators',
      campaign: '2026-07-project-state',
      channel: 'meta',
      content_type: 'image',
      cta: 'Try it',
      hook: 'Project state regression root asset.',
      product: project,
      project,
      s3: {
        bucket: 'lineage-demo-assets',
        content_type: 'image/png',
        key: `products/${project}/assets/${rootAssetId}.png`,
        region: 'us-east-1',
        size_bytes: 2048,
        updated_at: '2026-07-01T00:00:00.000Z',
        version_id: 'project-state-e2e',
      },
      source: 'catalog',
      status: 'working',
      title: 'Bleep e2e root static',
      utm_content: 'bleep_e2e_root_static',
    }],
    default_bucket: '',
    default_region: 'us-east-1',
    product: project,
    project,
  }, null, 2)}\n`);
}

test.beforeEach(async ({ request }) => {
  rmSync(projectDir, { force: true, recursive: true });
  writeProjectCatalog();

  const created = await request.post('/api/lineage-workspaces', {
    data: {
      confirmWrite: true,
      project,
      rootAssetId,
      title: workspaceTitle,
    },
  });
  expect(created.ok()).toBe(true);
  workspaceId = (await created.json()).workspace.id;
});

test.afterEach(() => {
  rmSync(projectDir, { force: true, recursive: true });
});

test('honors exact workspace URLs and clears stale lineage state through browser history', async ({ page }) => {
  await page.goto(`/projects/${project}/workspaces/${encodeURIComponent(workspaceId)}`);

  const workspaceExit = page.locator('.lineage-workspace-exit');
  await expect(page.locator('.lineage-workspace-title strong')).toHaveText(workspaceTitle);
  await expect(page).toHaveURL(new RegExp(`/projects/${project}/workspaces/`));
  await expect(page.getByText('Unknown indexed asset')).not.toBeVisible();
  await expect(page.getByText('No workspace selected')).not.toBeVisible();

  await workspaceExit.click();
  await expect(page).toHaveURL(`/projects/${project}/workspaces`);
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/projects/${project}/workspaces/`));
  await expect(page.locator('.lineage-workspace-title strong')).toHaveText(workspaceTitle);
  await expect(page.getByText('Unknown indexed asset')).not.toBeVisible();
  await expect(page.getByText('No workspace selected')).not.toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(`/projects/${project}/workspaces`);
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
});
