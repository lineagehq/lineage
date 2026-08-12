import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'playwright/test';

const project = 'demo-project';
const scratchDir = join(process.cwd(), '.asset-scratch', 'e2e-portrait-modal');
const portraitRelativePath = 'e2e-portrait-modal/portrait-1080x1350.svg';
let workspaceId: string | null = null;
const portraitSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <rect width="1080" height="1350" fill="#f8f4e8"/>
  <rect x="72" y="72" width="936" height="1206" rx="24" fill="#1c2e36"/>
  <rect x="132" y="132" width="816" height="1074" rx="18" fill="#f7d95f"/>
  <circle cx="540" cy="430" r="168" fill="#d9382f"/>
  <rect x="234" y="720" width="612" height="96" fill="#ffffff"/>
  <rect x="234" y="880" width="420" height="72" fill="#1c2e36"/>
  <text x="540" y="1120" fill="#1c2e36" font-family="Arial, sans-serif" font-size="72" font-weight="700" text-anchor="middle">1080 x 1350</text>
</svg>`;

test.beforeEach(() => {
  workspaceId = null;
  rmSync(scratchDir, { force: true, recursive: true });
  mkdirSync(scratchDir, { recursive: true });
  writeFileSync(join(scratchDir, 'portrait-1080x1350.svg'), portraitSvg);
});

test.afterEach(async ({ request }) => {
  if (workspaceId) {
    await request.post(`/api/lineage-workspaces/${encodeURIComponent(workspaceId)}/archive`, {
      data: { confirmWrite: true, project },
    });
  }
  rmSync(scratchDir, { force: true, recursive: true });
});

test('renders a 1080x1350 portrait detail preview without clipping', async ({ page, request }) => {
  const assetId = `local-${createHash('sha256').update(portraitSvg).digest('hex').slice(0, 12)}`;
  workspaceId = `${project}:lineage-workspace:${assetId}`;
  const workspace = await request.post('/api/lineage-workspaces', {
    data: {
      confirmWrite: true,
      createdBy: 'system',
      project,
      rootAssetId: assetId,
      title: 'Portrait 1080x1350 regression',
    },
  });
  expect(workspace.ok()).toBe(true);
  const created = await workspace.json() as { workspace?: { id: string } };
  workspaceId = created.workspace?.id || null;
  if (!workspaceId) throw new Error('Workspace creation did not return an exact workspace ID');

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`/projects/${project}/workspaces/${encodeURIComponent(workspaceId)}`);

  await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Portrait 1080x1350 regression', { timeout: 20_000 });
  const node = page.locator('.lineage-node', { hasText: 'portrait 1080x1350' });
  await expect(node).toBeVisible();

  await node.dblclick();
  await expect(page.getByRole('complementary', { name: 'Canvas asset details' })).toBeVisible();
  await page.getByRole('button', { name: 'Open full detail for portrait 1080x1350' }).click();
  await expect(page.getByRole('dialog', { name: 'portrait 1080x1350' })).toBeVisible();
  await page.waitForFunction(() => {
    const image = document.querySelector('.lineage-detail-preview img');
    return image instanceof HTMLImageElement && image.naturalWidth > 0 && image.naturalHeight > 0;
  });

  const measurement = await page.evaluate(() => {
    const preview = document.querySelector('.lineage-detail-preview');
    const image = document.querySelector('.lineage-detail-preview img');
    const footer = document.querySelector('.lineage-detail-modal footer');
    if (!(preview instanceof HTMLElement) || !(image instanceof HTMLImageElement)) {
      throw new Error('Detail preview image was not rendered');
    }
    const previewRect = preview.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    const footerRect = footer?.getBoundingClientRect();
    return {
      footerVisible: footerRect ? footerRect.top < window.innerHeight && footerRect.bottom <= window.innerHeight : false,
      image: { height: imageRect.height, width: imageRect.width },
      natural: { height: image.naturalHeight, width: image.naturalWidth },
      preview: { height: previewRect.height, width: previewRect.width },
      src: image.currentSrc,
    };
  });

  expect(measurement.natural).toEqual({ height: 1350, width: 1080 });
  expect(measurement.src).toContain(`/api/assets/local-preview?project=${project}`);
  expect(decodeURIComponent(measurement.src)).toContain(portraitRelativePath);
  expect(measurement.image.height).toBeLessThanOrEqual(measurement.preview.height);
  expect(measurement.image.width).toBeLessThanOrEqual(measurement.preview.width);
  expect(measurement.footerVisible).toBe(true);
});
