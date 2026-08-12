import { expect, test } from 'playwright/test';

let demoWorkspaceId = '';

test.beforeEach(async ({ request }) => {
  const seeded = await request.post('/api/lineage-workspaces/demo/seed', {
    data: { confirmWrite: true, project: 'demo-project' },
  });
  expect(seeded.ok()).toBe(true);
  demoWorkspaceId = (await seeded.json()).workspace.id;
});

function canvasPath(query = '') {
  return `/projects/demo-project/workspaces/${encodeURIComponent(demoWorkspaceId)}${query}`;
}

test('opens About Lineage from the brand with safe diagnostics and mobile access', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/projects');

  const aboutTrigger = page.getByRole('button', { name: 'About Lineage', exact: true });
  await aboutTrigger.click();
  const about = page.getByRole('dialog', { name: 'About Lineage' });
  await expect(about).toBeVisible();
  await expect(about.getByRole('button', { name: 'Close About Lineage' })).toBeFocused();
  await expect(about).toContainText('Runtime channel');
  await expect(about.getByRole('link', { name: /GitHub repository/ })).toHaveAttribute('href', 'https://github.com/mean-weasel/lineage');
  await expect(about.getByRole('link', { name: /Documentation/ })).toHaveAttribute('href', 'https://mean-weasel.github.io/lineage/docs/');

  await about.getByRole('button', { name: 'Copy diagnostics' }).click();
  await expect(about.getByRole('button', { name: 'Copied' })).toBeVisible();
  const diagnostics = await page.evaluate(() => navigator.clipboard.readText());
  expect(diagnostics).toContain('Lineage diagnostics');
  expect(diagnostics).not.toContain('lineage.sqlite');
  expect(diagnostics).not.toContain('Application Support');

  await page.keyboard.press('Escape');
  await expect(about).toHaveCount(0);
  await expect(aboutTrigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileTrigger = page.getByRole('button', { name: 'Open navigation panel' });
  await mobileTrigger.click();
  const navigationDialog = page.getByRole('dialog', { name: 'Contextual navigation panel' });
  await navigationDialog.getByRole('button', { name: 'Open About Lineage' }).click();
  await expect(navigationDialog).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'About Lineage' })).toBeVisible();
  await page.getByRole('button', { name: 'Close About Lineage' }).click();
  await expect(mobileTrigger).toBeFocused();
});

test('offers the Canvas settings hint once without obstructing its gear', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(canvasPath());

  const gear = page.getByRole('button', { name: 'Open Canvas settings' });
  const hint = page.getByRole('note', { name: 'Canvas settings tip' });
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Customize your canvas');
  await expect(page.locator('.lineage-workspace-identity')).toBeVisible();
  const separated = await hint.evaluate((element, gearLabel) => {
    const hintBox = element.getBoundingClientRect();
    const gearBox = document.querySelector(`[aria-label="${gearLabel}"]`)?.getBoundingClientRect();
    const workspaceBox = document.querySelector('.lineage-workspace-identity')?.getBoundingClientRect();
    return {
      gear: Boolean(gearBox && hintBox.right <= gearBox.left),
      workspace: Boolean(workspaceBox && hintBox.bottom <= workspaceBox.top),
    };
  }, 'Open Canvas settings');
  expect(separated).toEqual({ gear: true, workspace: true });

  await gear.click();
  await expect(hint).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Canvas settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Close Canvas settings' }).click();
  await page.reload();
  await expect(hint).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem('lineage.preferences.canvas-settings-hint-dismissed'))).toBe('true');
});

test('uses the active destination to collapse and reopen the contextual panel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(canvasPath());

  const canvas = page.getByRole('button', { name: 'Canvas', exact: true });
  const assets = page.getByRole('button', { name: 'Assets', exact: true });
  await expect(canvas).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Expand contextual panel' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse contextual panel' }).click();
  await expect(canvas).toHaveAttribute('aria-expanded', 'false');

  await assets.click();
  await expect(page).toHaveURL('/projects/demo-project/studio/assets');
  await expect(assets).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Collapse contextual panel' })).toHaveCount(0);

  await canvas.click();
  await expect(page).toHaveURL(canvasPath('?lineageCanvas=compact'));
  await expect(canvas).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Collapse contextual panel' })).toHaveCount(0);

  await canvas.click();
  await expect(page.getByRole('button', { name: 'Collapse contextual panel' })).toBeVisible();
});

test('returns to the last exact Canvas while keeping Workspaces as the directory', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/projects');
  await page.evaluate(() => window.localStorage.setItem('lineage.preferences.canvas-presentation', 'portrait'));
  await page.goto(canvasPath());
  await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Demo: Content iteration tree');
  await expect(page.locator('.lineage-canvas')).toHaveAttribute('data-lineage-canvas-presentation', 'portrait');
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await page.evaluate(() => window.localStorage.setItem('lineage.preferences.canvas-presentation', 'compact'));
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(page).toHaveURL(canvasPath('?lineageCanvas=portrait'));
  await expect(page.locator('.lineage-canvas')).toHaveAttribute('data-lineage-canvas-presentation', 'portrait');

  await page.getByRole('button', { name: 'Open Canvas settings' }).click();
  await page.getByRole('radio', { name: 'Compact nodes' }).check();
  await expect(page).toHaveURL(canvasPath());
  await page.getByRole('radio', { name: 'Portrait cards' }).check();
  await expect(page).toHaveURL(canvasPath('?lineageCanvas=portrait'));
  await page.getByRole('button', { name: 'Reset appearance' }).click();
  await expect(page).toHaveURL(canvasPath());

  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await expect(page).toHaveURL('/projects/demo-project/studio/assets');
  await page.evaluate(() => window.localStorage.setItem('lineage.preferences.canvas-presentation', 'portrait'));
  const canvas = page.getByRole('button', { name: 'Canvas', exact: true });
  await expect(canvas).toBeEnabled();
  await canvas.click();
  await expect(page).toHaveURL(canvasPath('?lineageCanvas=compact'));
  await expect(page.locator('.lineage-canvas')).toHaveAttribute('data-lineage-canvas-presentation', 'compact');
  await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Demo: Content iteration tree');

  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await expect(page).toHaveURL('/projects/demo-project/workspaces');
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
  await expect(canvas).toBeEnabled();
});

test('keeps a valid Canvas return when an unrelated workspace URL is unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(canvasPath('?lineageCanvas=portrait'));
  await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Demo: Content iteration tree');
  await page.goto('/projects/demo-project/workspaces/not-a-workspace');
  await expect(page).toHaveURL('/projects/demo-project/workspaces');

  const canvas = page.getByRole('button', { name: 'Canvas', exact: true });
  await expect(canvas).toBeEnabled();
  await canvas.click();
  await expect(page).toHaveURL(canvasPath('?lineageCanvas=portrait'));
});

test('keeps Canvas full-height and restores focus when its shared panel closes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(canvasPath('?lineageCanvas=portrait'));

  await expect(page.locator('header.lineage-header')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Canvas workspace tools' })).toBeVisible();
  await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Demo: Content iteration tree');
  await expect(page.locator('.lineage-workbench')).toBeVisible();
  await expect(page.getByRole('button', { name: /Agent context/i })).toHaveCount(0);
  await expect(page).toHaveURL(/projects\/demo-project\/workspaces/);
  await expect(page).toHaveURL(/lineageCanvas=portrait/);

  const gear = page.getByRole('button', { name: 'Open Canvas settings' });
  const closedGeometry = await page.locator('.lineage-canvas').evaluate((canvas, gearLabel) => {
    const canvasBox = canvas.getBoundingClientRect();
    const gearBox = canvas.querySelector(`[aria-label="${gearLabel}"]`)?.getBoundingClientRect();
    return {
      rightGap: gearBox ? canvasBox.right - gearBox.right : -1,
      topGap: gearBox ? gearBox.top - canvasBox.top : -1,
    };
  }, 'Open Canvas settings');
  expect(closedGeometry.rightGap).toBeGreaterThanOrEqual(16);
  expect(closedGeometry.rightGap).toBeLessThanOrEqual(20);
  expect(closedGeometry.topGap).toBeGreaterThanOrEqual(16);
  expect(closedGeometry.topGap).toBeLessThanOrEqual(20);

  const minimap = page.locator('.react-flow__minimap');
  await expect(minimap).toBeVisible({ timeout: 20_000 });

  await gear.click();
  const settings = page.getByRole('complementary', { name: 'Canvas settings' });
  await expect(settings).toBeVisible();
  await expect(gear).toHaveAttribute('aria-expanded', 'true');
  await expect(settings.getByRole('radio')).toHaveCount(9);
  await expect(settings.getByRole('switch')).toHaveCount(12);
  await expect(settings.getByRole('radio', { name: 'Portrait cards' })).toBeChecked();
  await settings.getByRole('radio', { name: 'Compact nodes' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(settings.getByRole('radio', { name: 'Portrait cards' })).toBeChecked();
  await expect.poll(async () => settings.evaluate((panel, gearLabel) => {
    const panelBox = panel.getBoundingClientRect();
    const gearBox = document.querySelector(`[aria-label="${gearLabel}"]`)?.getBoundingClientRect();
    return Boolean(gearBox && gearBox.right <= panelBox.left);
  }, 'Open Canvas settings')).toBe(true);

  await expect(minimap).toBeVisible();
  const minimapSwitch = settings.getByRole('switch', { name: 'Canvas minimap' });
  await expect(minimapSwitch).toHaveAttribute('aria-checked', 'true');
  await minimapSwitch.click();
  await expect(minimapSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(minimap).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  await gear.click();
  await expect(page.getByRole('complementary', { name: 'Canvas settings' }).getByRole('switch', { name: 'Canvas minimap' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('complementary', { name: 'Canvas settings' }).getByRole('button', { name: 'Reset appearance' }).click();
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Canvas settings' }).getByRole('switch', { name: 'Canvas minimap' })).toHaveAttribute('aria-checked', 'true');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Canvas settings' })).toHaveCount(0);
  await expect(gear).toBeFocused();

  await gear.click();
  await page.getByRole('button', { name: 'Close Canvas panel' }).click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole('complementary', { name: 'Canvas settings' })).toHaveCount(0);
  await expect(gear).toBeFocused();
});

test('uses a mobile navigation dialog and Canvas bottom sheet with focus return', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(canvasPath());

  const navigationTrigger = page.getByRole('button', { name: 'Open navigation panel' });
  await navigationTrigger.click();
  const navigationDialog = page.getByRole('dialog', { name: 'Contextual navigation panel' });
  const closeNavigation = navigationDialog.getByRole('button', { name: 'Close navigation panel' });
  await expect(navigationDialog).toBeVisible();
  await expect(closeNavigation).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(navigationDialog).not.toBeVisible();
  await expect(navigationTrigger).toBeFocused();

  await navigationTrigger.click();
  await page.getByRole('button', { name: 'Close navigation panel' }).last().click({ position: { x: 380, y: 400 } });
  await expect(navigationDialog).not.toBeVisible();
  await expect(navigationTrigger).toBeFocused();

  const mobileGear = page.getByRole('button', { name: 'Open Canvas settings' });
  await mobileGear.click();
  const settings = page.getByRole('complementary', { name: 'Canvas settings' });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Close Canvas settings' })).toBeFocused();
  await expect(settings).toHaveCSS('animation-name', 'none');
  await expect(settings.locator('.lineage-settings-sheet-handle')).toBeVisible();
  const resetAppearance = settings.getByRole('button', { name: 'Reset appearance' });
  const settingsScroller = settings.locator('.lineage-canvas-settings-groups');
  await settingsScroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(settings.getByRole('button', { name: 'Close Canvas settings' })).toBeVisible();
  await expect(resetAppearance).toBeVisible();
  const geometry = await settings.evaluate((element, { gearLabel }) => {
    const box = element.getBoundingClientRect();
    const canvas = document.querySelector('.lineage-canvas')?.getBoundingClientRect();
    const gear = document.querySelector(`[aria-label="${gearLabel}"]`)?.getBoundingClientRect();
    const reset = element.querySelector('.lineage-reset-appearance')?.getBoundingClientRect();
    const header = element.querySelector('.lineage-canvas-settings-head')?.getBoundingClientRect();
    const footer = element.querySelector('.lineage-canvas-settings-footer')?.getBoundingClientRect();
    return {
      bottomGap: Math.abs(window.innerHeight - box.bottom),
      canvasWidth: canvas?.width || 0,
      footerAnchored: Boolean(footer && Math.abs(footer.bottom - box.bottom) <= 1),
      gearOverlapsSheet: Boolean(gear
        && gear.left < box.right
        && gear.right > box.left
        && gear.top < box.bottom
        && gear.bottom > box.top),
      gearOverlapsReset: Boolean(gear && reset
        && gear.left < reset.right
        && gear.right > reset.left
        && gear.top < reset.bottom
        && gear.bottom > reset.top),
      rightGap: canvas && gear ? canvas.right - gear.right : -1,
      headerAnchored: Boolean(header && Math.abs(header.top - box.top) <= 1),
      topGap: canvas && gear ? gear.top - canvas.top : -1,
      width: box.width,
    };
  }, { gearLabel: 'Open Canvas settings' });
  await expect(resetAppearance).toBeVisible();
  expect(geometry.bottomGap).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.canvasWidth - geometry.width)).toBeLessThanOrEqual(1);
  expect(geometry.headerAnchored).toBe(true);
  expect(geometry.footerAnchored).toBe(true);
  expect(geometry.gearOverlapsSheet).toBe(false);
  expect(geometry.gearOverlapsReset).toBe(false);
  expect(geometry.rightGap).toBeGreaterThanOrEqual(16);
  expect(geometry.rightGap).toBeLessThanOrEqual(20);
  expect(geometry.topGap).toBeGreaterThanOrEqual(16);
  expect(geometry.topGap).toBeLessThanOrEqual(20);
});
