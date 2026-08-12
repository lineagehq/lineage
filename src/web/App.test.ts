// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { api } from './api';
import { App } from './App';
import { shouldRevealCopiedText } from './copyFallback';
import { availableProjectSelection, projectFor, projectRouteIsUnavailable } from './projectWorkspaceNavigation';

vi.mock('./api', () => ({ api: vi.fn() }));
vi.mock('./components/Sidebar', async () => {
  const React = await import('react');
  return { Sidebar: (props: { project: string; setProject: (project: string) => void; setView: (view: 'settings' | 'agents') => void }) => React.createElement('nav', null,
    React.createElement('span', { 'data-testid': 'app-project' }, props.project),
    React.createElement('button', { onClick: () => props.setProject('other-project') }, 'Change project'),
    React.createElement('button', { onClick: () => props.setView('settings') }, 'Change view'),
    React.createElement('button', { onClick: () => props.setView('agents') }, 'Open agents')) };
});
vi.mock('./components/LineageView', async () => {
  const React = await import('react');
  return { LineageView: (props: { onSocialDirtyChange: (dirty: boolean) => void; onSocialTransitionPendingChange?: (pending: boolean) => void; project: string }) => {
    React.useEffect(() => () => props.onSocialDirtyChange(false), [props.onSocialDirtyChange]);
    return React.createElement('section', { 'data-testid': 'lineage-view' }, React.createElement('span', null, props.project), React.createElement('button', { onClick: () => props.onSocialDirtyChange(true) }, 'Dirty Social'), React.createElement('button', { onClick: () => props.onSocialTransitionPendingChange?.(true) }, 'Own child transition'));
  } };
});
vi.mock('./components/SettingsView', async () => {
  const React = await import('react');
  return { SettingsView: () => React.createElement('section', { 'data-testid': 'settings-view' }, 'Settings') };
});
vi.mock('./components/AgentsView', async () => {
  const React = await import('react');
  return { AgentsView: (props: { onOpenWork: (target: unknown) => void }) => React.createElement('section', { 'data-testid': 'agents-view' },
    React.createElement('button', { onClick: () => props.onOpenWork({ assetId: 'asset-2', claim: { project: 'demo-project', target_id: 'claim-1', target_title: 'Claim' }, view: 'lineage', workspaceId: 'workspace-2' }) }, 'Open agent graph')) };
});
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; }); return { promise, reject, resolve }; }
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); window.history.replaceState(null, '', '/'); });
beforeEach(() => { window.history.replaceState(null, '', '/projects/demo-project/workspaces/workspace-1'); });

describe('shouldRevealCopiedText', () => {
  it('does not let a delayed project catalog redirect a valid dirty Canvas route', async () => {
    const projects = deferred<{ projects: Array<{ project: string }> }>();
    vi.mocked(api).mockImplementation((path: string) => {
      if (path === '/api/projects') return projects.promise;
      if (path.startsWith('/api/assets?')) return Promise.resolve({ catalog: { project: 'demo-project', asset_count: 0 }, assets: [], liveObjects: [], orphanObjects: [], facets: { channels: [], totalSizeBytes: 0 } });
      return Promise.reject(new Error('Runtime identity unavailable'));
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    await act(async () => { root.render(createElement(App)); await Promise.resolve(); });
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Dirty Social')!.click());
    await act(async () => projects.resolve({ projects: [{ project: 'demo-project' }, { project: 'fallback-project' }] }));
    expect(container.querySelector('[data-testid="app-project"]')?.textContent).toBe('demo-project');
    expect(window.location.pathname).toBe('/projects/demo-project/workspaces/workspace-1');
    expect(confirm).not.toHaveBeenCalled();
    act(() => root.unmount()); container.remove();
  });

  it('does not let delayed fallback settle through child ownership or an unchanged catalog', async () => {
    const projects = deferred<{ projects: Array<{ project: string }> }>(); const confirm = vi.spyOn(window, 'confirm');
    vi.mocked(api).mockImplementation((path: string) => path === '/api/projects' ? projects.promise : path.startsWith('/api/assets?') ? Promise.resolve({ catalog: { project: 'demo-project', asset_count: 0 }, assets: [], liveObjects: [], orphanObjects: [], facets: { channels: [], totalSizeBytes: 0 } }) : Promise.reject(new Error('Runtime identity unavailable')));
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    await act(async () => { root.render(createElement(App)); await Promise.resolve(); });
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Own child transition')!.click(); await Promise.resolve(); });
    await act(async () => projects.resolve({ projects: [{ project: 'fallback-project' }] }));
    expect(container.querySelector('[data-testid="app-project"]')?.textContent).toBe('demo-project'); expect(confirm).not.toHaveBeenCalled();
    act(() => root.unmount()); container.remove();

    const unchanged = deferred<{ projects: Array<{ project: string }> }>();
    vi.mocked(api).mockImplementation((path: string) => path === '/api/projects' ? unchanged.promise : path.startsWith('/api/assets?') ? Promise.resolve({ catalog: { project: 'demo-project', asset_count: 0 }, assets: [], liveObjects: [], orphanObjects: [], facets: { channels: [], totalSizeBytes: 0 } }) : Promise.reject(new Error('Runtime identity unavailable')));
    const sameContainer = document.createElement('div'); document.body.appendChild(sameContainer); const sameRoot = createRoot(sameContainer);
    await act(async () => { sameRoot.render(createElement(App)); await Promise.resolve(); });
    act(() => [...sameContainer.querySelectorAll('button')].find(button => button.textContent === 'Dirty Social')!.click());
    await act(async () => unchanged.resolve({ projects: [{ project: 'demo-project' }] }));
    expect(sameContainer.querySelector('[data-testid="app-project"]')?.textContent).toBe('demo-project'); expect(confirm).not.toHaveBeenCalled();
    act(() => sameRoot.unmount()); sameContainer.remove();
  });

  it('ignores stale overlapping project-catalog responses', async () => {
    const first = deferred<{ projects: Array<{ project: string }> }>(); const second = deferred<{ projects: Array<{ project: string }> }>(); let calls = 0;
    vi.mocked(api).mockImplementation((path: string) => path === '/api/projects' ? (++calls === 1 ? first : second).promise : path.startsWith('/api/assets?') ? Promise.resolve({ catalog: { project: 'demo-project', asset_count: 0 }, assets: [], liveObjects: [], orphanObjects: [], facets: { channels: [], totalSizeBytes: 0 } }) : Promise.reject(new Error('Runtime identity unavailable')));
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    await act(async () => { root.render(createElement(StrictMode, null, createElement(App))); await Promise.resolve(); });
    expect(calls).toBe(2);
    await act(async () => second.resolve({ projects: [{ project: 'demo-project' }] }));
    await act(async () => first.resolve({ projects: [{ project: 'stale-project' }] }));
    expect(container.querySelector('[data-testid="app-project"]')?.textContent).toBe('demo-project');
    act(() => root.unmount()); container.remove();
  });

  it('protects App view and project transitions with one deliberate dirty-discard decision', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/App.tsx'), 'utf8');
    expect(source).toContain('return !dirty || confirmDiscard();');
    expect(source).toContain('setProject={changeProject}');
    expect(source).toContain('setView={changeView}');
    expect(source).toContain('if (!allowLineageTransition()) return;');
    expect(source).toContain('onSocialDirtyChange={updateLineageSocialDirty}');
  });

  it('preserves the active App view and project on cancel and transitions on acceptance', async () => {
    vi.mocked(api).mockImplementation((path: string) => {
      if (path === '/api/projects') return Promise.resolve({ projects: [{ project: 'demo-project' }, { project: 'other-project' }] });
      if (path.startsWith('/api/assets?')) return Promise.resolve({ catalog: { project: 'demo-project', asset_count: 0 }, assets: [], liveObjects: [], orphanObjects: [], facets: { channels: [], totalSizeBytes: 0 } });
      return Promise.reject(new Error('Runtime identity unavailable'));
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const container = document.createElement('div'); document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => { root.render(createElement(App)); await Promise.resolve(); });
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Dirty Social')!.click());
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Change project')!.click());
    expect(container.querySelector('[data-testid="app-project"]')?.textContent).toBe('demo-project');
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Change view')!.click());
    expect(container.querySelector('[data-testid="lineage-view"]')).not.toBeNull();
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockReturnValue(true);
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Change view')!.click());
    expect(container.querySelector('[data-testid="settings-view"]')).not.toBeNull();
    act(() => root.unmount()); container.remove();
  });

  it('guards agent-to-Canvas navigation and opens the exact linked workspace after acceptance', async () => {
    vi.mocked(api).mockImplementation((path: string) => {
      if (path === '/api/projects') return Promise.resolve({ projects: [{ project: 'demo-project' }] });
      if (path.startsWith('/api/assets?')) return Promise.resolve({ catalog: { project: 'demo-project', asset_count: 0 }, assets: [], liveObjects: [], orphanObjects: [], facets: { channels: [], totalSizeBytes: 0 } });
      return Promise.reject(new Error('Runtime identity unavailable'));
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    await act(async () => { root.render(createElement(App)); await Promise.resolve(); });
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Dirty Social')!.click());
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Open agents')!.click());
    expect(container.querySelector('[data-testid="lineage-view"]')).not.toBeNull();
    confirm.mockReturnValue(true);
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Open agents')!.click());
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Open agent graph')!.click());
    expect(container.querySelector('[data-testid="lineage-view"]')).not.toBeNull();
    expect(window.location.pathname).toBe('/projects/demo-project/workspaces/workspace-2');
    expect(confirm).toHaveBeenCalledTimes(2);
    act(() => root.unmount()); container.remove();
  });

  it('reveals agent handoff commands as a visible fallback', () => {
    expect(shouldRevealCopiedText('next context command', 'npx lineage agent "keep working on my selections"')).toBe(true);
  });

  it('keeps ordinary copied links out of the fallback panel', () => {
    expect(shouldRevealCopiedText('preview link', 'https://example.com/asset.png')).toBe(false);
  });

  it('keeps the Agents view read-only and tokenless', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/components/AgentsView.tsx'), 'utf8');

    expect(source).toContain('/api/agent-claims');
    expect(source).toContain('Open graph');
    expect(source).toContain('Copy briefing');
    expect(source).toContain('onDoubleClick={openWork}');
    expect(source).toContain('agent-row-open-graph');
    expect(source).toContain('agent-row-copy-briefing');
    expect(source).toContain('agentBriefingText');
    expect(source).toContain("view: 'lineage'");
    expect(source).not.toContain('/api/agent-claims/${selectedClaimId}');
    expect(source).not.toContain('ClaimDetailPanel');
    expect(source).not.toContain("view: 'content'");
    expect(source).not.toContain('Open work');
    expect(source).not.toContain('Copy handoff');
    expect(source).not.toContain('Transfer');
    expect(source).not.toContain('claim_token');
    expect(source).not.toContain('claimToken');
    expect(source).not.toContain('metadata');
    expect(source).not.toContain("method: 'POST'");
  });

  it('opens agent work only through a canonical destination', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/App.tsx'), 'utf8');
    const start = source.indexOf('async function openAgentWork');
    const end = source.indexOf('function toggleLocalBackup', start);
    const handoff = source.slice(start, end);

    expect(handoff).toContain("if (!target.workspaceId)");
    expect(handoff).toContain('is not linked to an exact Canvas workspace');
    expect(handoff).toContain("navigate({ kind: 'canvas', projectId: target.claim.project, workspaceId: target.workspaceId })");
    expect(handoff).toContain("navigate({ kind: 'studio', projectId: target.claim.project, view: target.view })");
    expect(handoff).not.toContain('setView(target.view)');
  });

  it('composes the rail and contextual utilities outside the workspace', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/App.tsx'), 'utf8');
    const sidebarStart = source.indexOf('<Sidebar');
    const sidebarEnd = source.indexOf('</Sidebar>');
    const workspaceStart = source.indexOf('<main className="workspace">');

    expect(sidebarStart).toBeGreaterThan(-1);
    expect(source.slice(sidebarStart, sidebarEnd)).toContain('<Topbar');
    expect(sidebarEnd).toBeLessThan(workspaceStart);
    expect(source).toContain('context-panel-collapsed');
    expect(source).toContain('mobile-context-open');
    expect(source).not.toContain('CurrentWorkTarget');
    expect(source).not.toContain('Agent context');
  });

  it('does not preload a catalog while the lineage canvas owns the workspace surface', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/App.tsx'), 'utf8');

    expect(source).toContain("return surface === 'studio' && view !== 'lineage'");
    expect(source).toContain('if (shouldRefreshAssetLibrary(surface, view)) void refresh()');
  });

  it('starts Projects without a phantom default and replaces deleted selections deterministically', () => {
    const projects = [
      { id: 'survivor' },
      { id: 'second' },
    ] as Parameters<typeof availableProjectSelection>[1];

    expect(projectFor({ kind: 'projects' })).toBe('');
    expect(availableProjectSelection('deleted-project', projects)).toBe('survivor');
    expect(availableProjectSelection('second', projects)).toBe('second');
    expect(availableProjectSelection('deleted-project', [])).toBe('');
    expect(projectRouteIsUnavailable({ kind: 'project', projectId: 'deleted-project' }, projects)).toBe(true);
    expect(projectRouteIsUnavailable({ kind: 'project', projectId: 'survivor' }, projects)).toBe(false);
    const source = readFileSync(join(process.cwd(), 'src/web/App.tsx'), 'utf8');
    expect(source).toContain("`/api/projects/${encodeURIComponent(unavailableProject)}`");
    expect(source).toContain('availableProjects = [...normalizedProjects, detail.project]');
    expect(source).not.toContain('onOpenDemo=');
    expect(source).toContain('setProjects(current => rememberProjectSummary(current, nextProject))');
  });
});
