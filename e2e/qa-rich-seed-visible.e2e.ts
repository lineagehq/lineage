import { expect, test } from 'playwright/test';
import { spawnSync } from 'node:child_process';

const project = 'swissifier-demo';
const richWorkspaceTitle = 'Swissifier rich demo';

test('QA seed shows truthful progress and rich PNG previews in the first lineage view', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const projects = await request.get('/api/projects');
  expect(projects.ok()).toBe(true);
  const downloaded = await request.post('/api/lineage-workspaces/demo/swissifier/media/download', {
    data: { project, confirmWrite: true },
  });
  expect(downloaded.ok()).toBe(true);
  await page.setViewportSize({ height: 640, width: 1024 });
  await page.goto('/projects');
  const swissifier = page.locator('.organization-item').filter({ hasText: 'swissifier-demo' });
  await swissifier.getByRole('heading', { name: 'Swissifier Demo' }).click();
  const richWorkspace = page.locator('.organization-item').filter({ hasText: richWorkspaceTitle });
  await richWorkspace.getByRole('heading', { name: richWorkspaceTitle }).click();
  const canvasTools = page.getByRole('region', { name: 'Canvas workspace tools' });
  const demoTools = canvasTools.locator('.lineage-tool-section').filter({ has: page.locator('summary', { hasText: 'Demo/QA' }) });
  await demoTools.locator('summary').click();
  const download = demoTools.getByRole('button', { name: 'Download rich images' });
  await expect.poll(async () => (
    await download.isEnabled()
    || await demoTools.getByText('14/14 PNG images').count() > 0
  ), {
    message: 'wait for rich media status and workspace readiness',
  }).toBe(true);
  expect(await download.isEnabled()).toBe(false);
  await expect(demoTools).toContainText('14/14 PNG images');

  await expect(page.locator('.lineage-workspace-title strong')).toHaveText(richWorkspaceTitle, { timeout: 20_000 });
  await expect(page.locator('.lineage-node')).toHaveCount(14, { timeout: 20_000 });
  await expect(page.locator('.react-flow__edge')).toHaveCount(13);
  expect(consoleErrors).toEqual([]);

  const verifier = spawnSync('npm', [
    'run',
    '--silent',
    'seed:qa:verify',
    '--',
    '--base-url',
    String(baseURL),
    '--json',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  expect(verifier.status, verifier.stderr || verifier.stdout).toBe(0);
  expect(JSON.parse(verifier.stdout)).toMatchObject({
    ok: true,
    project,
    root_asset_id: 'local-5748fb8ba6df',
    snapshot: {
      nodes: 14,
      png_preview_urls: 14,
      svg_preview_urls: 0,
    },
    swissifier_media: {
      present: 14,
      total: 14,
    },
  });

  await demoTools.locator('summary').click();
  await expect(demoTools).toContainText('QA seed media');
  await expect(demoTools).toContainText('14/14 PNG images');
  await demoTools.locator('summary').click();

  const rootNode = page.locator('.lineage-node.root-node');
  await expect(rootNode).toHaveAttribute('title', /^Hover to preview;/);
  const inspector = page.getByTestId('lineage-hover-preview');
  const preview = inspector.locator('.lineage-hover-preview-media img');
  await expect(async () => {
    await demoTools.locator('summary').focus();
    await rootNode.focus();
    await expect(rootNode).toBeFocused();
    await expect(inspector).toBeVisible({ timeout: 1_000 });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('src', /rich-demo-drafts.*\.png/);
    const proof = await preview.evaluate((image: HTMLImageElement) => {
      const rect = image.getBoundingClientRect();
      return {
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        renderedWidth: rect.width,
        renderedHeight: rect.height,
        objectFit: getComputedStyle(image).objectFit,
        src: image.getAttribute('src') || '',
      };
    });
    expect(proof.naturalWidth).toBeGreaterThan(900);
    expect(proof.naturalHeight).toBeGreaterThan(900);
    expect(proof.renderedWidth).toBeGreaterThan(180);
    expect(proof.renderedHeight).toBeGreaterThan(100);
    expect(proof.objectFit).toBe('contain');
    expect(proof.src).not.toContain('.svg');
  }).toPass({ intervals: [100, 250, 500], timeout: 15_000 });

  const visibleSvgPreviews = await page.locator('.lineage-thumb img[src*=".svg"]:visible').count();
  expect(visibleSvgPreviews).toBe(0);
});
