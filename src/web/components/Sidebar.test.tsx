// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectWorkspaceSummary } from '../../shared/projectWorkspaceTypes';
import type { LineageRuntimeInfo } from '../../shared/runtimeInfoTypes';
import { Sidebar } from './Sidebar';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('Sidebar', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it('keeps project identity and asset filters in the contextual panel for asset views', () => {
    renderSidebar('assets');

    expect(text()).toContain('Demo Project');
    expect(selectOrNull('Project')).toBeNull();
    expect(buttonByLabel('Back to Demo Project workspaces')).not.toBeNull();
    expect(buttonByLabel('Back to Demo Project workspaces')?.textContent).toContain('Browse canvases and creative branches');
    expect(select('Source').value).toBe('local');
    expect(select('Status').value).toBe('all');
    expect(select('Channel').value).toBe('all');
    expect(select('Placement').value).toBe('all');
  });

  it('makes the project workspace return a full-row action', () => {
    const onProjectOverview = vi.fn();
    renderSidebar('lineage', { onProjectOverview });

    const workspaceReturn = buttonByLabel('Back to Demo Project workspaces')!;
    expect(workspaceReturn.classList.contains('context-location-card')).toBe(true);
    expect(workspaceReturn.textContent).toContain('Demo Project');
    act(() => workspaceReturn.click());
    expect(onProjectOverview).toHaveBeenCalledOnce();
  });

  it('removes quick sets and bucket stats from the default sidebar', () => {
    renderSidebar('assets');

    expect(text()).not.toContain('Quick Sets');
    expect(text()).not.toContain('Review queue');
    expect(text()).not.toContain('Ledger workflow');
    expect(text()).not.toContain('Bucket');
    expect(text()).not.toContain('Catalog');
    expect(text()).not.toContain('Live');
    expect(text()).not.toContain('Loose');
    expect(text()).not.toContain('Size');
  });

  it('keeps asset filters out of Canvas context', () => {
    renderSidebar('lineage');

    expect(selectOrNull('Project')).toBeNull();
    expect(text()).toContain('Demo Project');
    expect(container!.querySelector('#canvas-context-tools')?.getAttribute('aria-label')).toBe('Canvas workspace tools');
    expect(selectOrNull('Source')).toBeNull();
    expect(selectOrNull('Status')).toBeNull();
    expect(selectOrNull('Channel')).toBeNull();
    expect(selectOrNull('Placement')).toBeNull();
  });

  it('does not expose the Canvas tool host in non-Canvas context', () => {
    renderSidebar('assets');

    expect(container!.querySelector('#canvas-context-tools')).toBeNull();
  });

  it('separates the Workspaces directory from the active Canvas destination', () => {
    renderSidebar('lineage');

    const labels = ['Workspaces', 'Canvas', 'Assets', 'Content batches', 'Review', 'Backup queue', 'Agents', 'Ledger', 'Settings'];
    for (const label of labels) expect(buttonByLabel(label)).not.toBeNull();
    expect(buttonByLabel('Projects')).toBeNull();
    expect(buttonByLabel('Canvas')?.getAttribute('aria-current')).toBe('page');
    expect(buttonByLabel('Workspaces')?.getAttribute('aria-current')).toBeNull();
    expect(text()).not.toContain('More');
  });

  it('returns to the remembered Canvas independently from opening the Workspaces directory', () => {
    const onCanvas = vi.fn();
    const onProjectOverview = vi.fn();
    renderSidebar('assets', { onCanvas, onProjectOverview });

    act(() => buttonByLabel('Canvas')?.click());
    expect(onCanvas).toHaveBeenCalledOnce();
    expect(onProjectOverview).not.toHaveBeenCalled();

    act(() => buttonByLabel('Workspaces')?.click());
    expect(onProjectOverview).toHaveBeenCalledOnce();
  });

  it('disables Canvas until a workspace has been opened in this tab', () => {
    renderSidebar('assets', { canvasAvailable: false });

    expect(buttonByLabel('Canvas')?.disabled).toBe(true);
    expect(buttonByLabel('Canvas')?.title).toBe('Open a workspace to use Canvas');
    expect(buttonByLabel('Workspaces')?.disabled).toBe(false);
  });

  it('does not treat the new-workspace flow as an active Canvas', () => {
    const onCanvas = vi.fn();
    renderSidebar('lineage', { canvasActive: false, onCanvas });

    const canvas = buttonByLabel('Canvas')!;
    expect(canvas.getAttribute('aria-current')).toBeNull();
    act(() => canvas.click());
    expect(onCanvas).toHaveBeenCalledOnce();
  });

  it('uses the L brand as global home', () => {
    const onProjects = vi.fn();
    renderSidebar('lineage', { onProjects });

    act(() => buttonByLabel('Lineage home')?.click());
    expect(onProjects).toHaveBeenCalledOnce();
  });

  it('opens About Lineage from the secondary info action and restores focus when closed', () => {
    renderSidebar('lineage', { runtime });
    const opener = buttonByLabel('About Lineage')!;
    opener.focus();

    act(() => opener.click());

    const dialog = document.body.querySelector<HTMLElement>('[aria-labelledby="about-lineage-title"]');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.textContent).toContain('canvas-navigation-dev');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close About Lineage');

    act(() => {
      document.body.querySelector<HTMLButtonElement>('[aria-label="Close About Lineage"]')?.click();
    });
    expect(document.activeElement).toBe(opener);
  });

  it('keeps About Lineage reachable through the contextual header on mobile', () => {
    const onMobileContextOpenChange = vi.fn();
    renderSidebar('lineage', { mobileContextOpen: true, onMobileContextOpenChange, runtime });

    act(() => buttonByLabel('Open About Lineage')?.click());

    expect(onMobileContextOpenChange).toHaveBeenCalledWith(false);
    expect(document.body.querySelector('[aria-labelledby="about-lineage-title"]')).not.toBeNull();
  });

  it('keeps destinations and create/upload reachable in the mobile drawer', () => {
    renderSidebar('lineage');

    const mobileDestinations = container!.querySelector('.mobile-context-destinations');
    expect(mobileDestinations).not.toBeNull();
    expect(mobileDestinations?.textContent).toContain('Workspaces');
    expect(mobileDestinations?.textContent).toContain('Canvas');
    expect(mobileDestinations?.textContent).toContain('Backup queue');
    expect(mobileDestinations?.textContent).toContain('Settings');
    expect(mobileDestinations?.textContent).toContain('Create or upload');
  });

  it('hides project-scoped destinations until a project is open', () => {
    renderSidebar('lineage', { project: '', projects: [], surface: 'projects' });

    expect(buttonByLabel('Lineage home')).not.toBeNull();
    expect(buttonByLabel('Workspaces')).toBeNull();
    expect(buttonByLabel('Canvas')).toBeNull();
    expect(buttonByLabel('Assets')).toBeNull();
    expect(buttonByLabel('Create or upload')).toBeNull();
    expect(buttonByLabel('Settings')).toBeNull();
  });

  it('keeps the exact runtime and environment identity reachable in the mobile drawer only at the responsive breakpoint', () => {
    renderSidebar('lineage', { runtime });

    const mobileIdentity = container!.querySelector('.mobile-runtime-identity');
    const badge = mobileIdentity?.querySelector('.runtime-identity-badge');
    expect(mobileIdentity?.getAttribute('aria-label')).toBe('Mobile runtime identity');
    expect(badge?.getAttribute('aria-label')).toBe('Lineage development profile canvas-navigation-dev');
    expect(badge?.getAttribute('data-profile-id')).toBe('canvas-navigation-dev');
    expect(mobileIdentity?.textContent).toContain('DEVELOPMENT');
    expect(mobileIdentity?.textContent).toContain('canvas-navigation-dev');

    const css = readFileSync(join(process.cwd(), 'src/web/components/Sidebar.css'), 'utf8');
    expect(css).toMatch(/\.mobile-runtime-identity\s*\{[\s\S]*?display:\s*none;/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.mobile-runtime-identity\s*\{[\s\S]*?display:\s*grid;/);
  });

  it('keeps the mobile disclosure independent from desktop context state', () => {
    const onContextOpenChange = vi.fn();
    const onMobileContextOpenChange = vi.fn();
    renderSidebar('assets', { onContextOpenChange, onMobileContextOpenChange });

    buttonByLabel('Open navigation panel')?.click();

    expect(onMobileContextOpenChange).toHaveBeenCalledWith(true);
    expect(onContextOpenChange).not.toHaveBeenCalled();
  });

  it('uses the active destination to collapse and reopen the desktop contextual panel', () => {
    const onContextOpenChange = vi.fn();
    renderSidebar('lineage', { onContextOpenChange });

    expect(buttonByLabel('Expand contextual panel')).toBeNull();
    act(() => buttonByLabel('Canvas')?.click());
    expect(onContextOpenChange).toHaveBeenCalledWith(false);

    onContextOpenChange.mockClear();
    renderSidebar('lineage', { contextOpen: false, onContextOpenChange });
    act(() => buttonByLabel('Canvas')?.click());
    expect(onContextOpenChange).toHaveBeenCalledWith(true);
  });

  it('preserves a collapsed desktop contextual panel while switching destinations', () => {
    const onContextOpenChange = vi.fn();
    const onStudio = vi.fn();
    renderSidebar('lineage', {
      contextOpen: false,
      onContextOpenChange,
      onStudio,
    });

    act(() => buttonByLabel('Assets')?.click());

    expect(onStudio).toHaveBeenCalledWith('assets');
    expect(onContextOpenChange).not.toHaveBeenCalled();
  });

  it('moves focus into the mobile drawer and returns it to the trigger when closed', () => {
    renderSidebar('lineage', { mobileContextOpen: false });
    const trigger = buttonByLabel('Open navigation panel')!;
    act(() => trigger.focus());

    renderSidebar('lineage', { mobileContextOpen: true });
    const close = container!.querySelector<HTMLButtonElement>('.mobile-context-close')!;
    expect(document.activeElement).toBe(close);
    expect(container!.querySelector('#contextual-navigation-panel')?.getAttribute('role')).toBe('dialog');
    expect(container!.querySelector('#contextual-navigation-panel')?.getAttribute('aria-modal')).toBe('true');

    renderSidebar('lineage', { mobileContextOpen: false });
    expect(document.activeElement).toBe(trigger);
  });
});

function renderSidebar(
  view: 'lineage' | 'assets' = 'assets',
  overrides: {
    onContextOpenChange?: (open: boolean) => void;
    onMobileContextOpenChange?: (open: boolean) => void;
    onCanvas?: () => void;
    onProjects?: () => void;
    onProjectOverview?: () => void;
    onStudio?: (view: 'lineage' | 'assets' | 'content' | 'review' | 'backup' | 'agents' | 'ledger' | 'settings') => void;
    canvasActive?: boolean;
    canvasAvailable?: boolean;
    contextOpen?: boolean;
    mobileContextOpen?: boolean;
    project?: string;
    projects?: ProjectWorkspaceSummary[];
    runtime?: LineageRuntimeInfo;
    surface?: 'projects' | 'project' | 'studio';
  } = {}
) {
  act(() => {
    root!.render(
      <Sidebar
        channel="all"
        channels={['all', 'tiktok']}
        contextOpen={overrides.contextOpen ?? true}
        mobileContextOpen={overrides.mobileContextOpen || false}
        onContextOpenChange={overrides.onContextOpenChange || vi.fn()}
        onMobileContextOpenChange={overrides.onMobileContextOpenChange || vi.fn()}
        placementStatus="all"
        canvasActive={overrides.canvasActive ?? view === 'lineage'}
        canvasAvailable={overrides.canvasAvailable ?? true}
        project={overrides.project ?? 'demo-project'}
        projects={overrides.projects ?? [{
          id: 'demo-project',
          display_name: 'Demo Project',
          product: 'demo-project',
          catalog_path: 'catalog.json',
          catalog_state: 'ready',
          sort_position: 0,
          asset_count: 29,
          workspace_count: 2,
          created_at: '2026-07-29T00:00:00.000Z',
          updated_at: '2026-07-29T00:00:00.000Z',
        }]}
        surface={overrides.surface || 'studio'}
        onCanvas={overrides.onCanvas || vi.fn()}
        onProjects={overrides.onProjects || vi.fn()}
        onProjectOverview={overrides.onProjectOverview || vi.fn()}
        onStudio={overrides.onStudio || vi.fn()}
        setChannel={vi.fn()}
        setPlacementStatus={vi.fn()}
        setSource={vi.fn()}
        setStatus={vi.fn()}
        setUploadOpen={vi.fn()}
        setView={vi.fn()}
        showBackupQueue={vi.fn()}
        source="local"
        status="all"
        runtime={overrides.runtime || null}
        runtimeIdentityUnavailable={false}
        view={view}
      >
        <div>Context utilities</div>
      </Sidebar>
    );
  });
}

function select(label: string): HTMLSelectElement {
  const match = Array.from(container!.querySelectorAll<HTMLSelectElement>('select'))
    .find(item => item.getAttribute('aria-label') === label);
  expect(match).toBeTruthy();
  return match!;
}

function selectOrNull(label: string): HTMLSelectElement | null {
  return Array.from(container!.querySelectorAll<HTMLSelectElement>('select'))
    .find(item => item.getAttribute('aria-label') === label) || null;
}

function buttonByLabel(label: string): HTMLButtonElement | null {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>('button'))
    .find(item => item.getAttribute('aria-label') === label) || null;
}

function text(): string {
  return container?.textContent || '';
}

const runtime: LineageRuntimeInfo = {
  asset_root: '/test/media',
  channel: 'dev',
  cli: { launcher: 'npm run lineage:dev --', runtime_selector: "--profile '/tmp/dev/profile.json'" },
  database: { exists: true, path: '/test/lineage.sqlite' },
  fetchedAt: '2026-07-28T00:00:00.000Z',
  package_name: '@mean-weasel/lineage',
  profile: {
    bound: true,
    environment: 'development',
    id: 'canvas-navigation-dev',
    service_origin: 'http://127.0.0.1:5301',
  },
  schema: {
    migration_keys: [],
    profile_environment: 'development',
    profile_id: 'canvas-navigation-dev',
  },
  version: '0.1.30',
};
