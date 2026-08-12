import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'src/web/App.tsx'), 'utf8');
const workspaceHookSource = readFileSync(join(process.cwd(), 'src/web/components/useLineageWorkspaces.ts'), 'utf8');

function snippetBetween(start: string, end: string): string {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex);
  return appSource.slice(startIndex, endIndex);
}

describe('Lineage navigation behavior', () => {
  it('includes the read-only Agents view as a direct rail destination', () => {
    const navSource = readFileSync(join(process.cwd(), 'src/web/components/Topbar.navigation.ts'), 'utf8');

    expect(navSource).toContain("{ label: 'Agents', view: 'agents' }");
    expect(navSource.indexOf("{ label: 'Agents', view: 'agents' }")).toBeLessThan(navSource.indexOf("{ label: 'Settings', view: 'settings' }"));
    expect(navSource).toContain("{ label: 'Canvas', view: 'lineage' }");
  });

  it('keeps desktop persistence separate from the mobile session disclosure', () => {
    expect(appSource).toContain('useState(readContextPanelOpen)');
    expect(appSource).toContain('useState(false)');
    expect(appSource).toContain('writeContextPanelOpen(open)');
    expect(appSource).toContain('setMobileContextOpen(false)');
  });

  it('keeps Review asset inspection in the current view instead of redirecting to Assets', () => {
    const reviewSnippet = snippetBetween('<ReviewQueue', 'project={project}');

    expect(reviewSnippet).toContain('inspectAssetInContext(asset)');
    expect(reviewSnippet).not.toContain("setView('assets')");
  });

  it('keeps shared asset details decoupled from the Assets tab', () => {
    const openDetailsSnippet = snippetBetween('async function openAssetDetails', 'function showBackupQueue');

    expect(openDetailsSnippet).toContain('setAssetDetailsOpen(true)');
    expect(openDetailsSnippet).not.toContain("setView('assets')");
  });

  it('uses canonical browser history for Projects, Workspaces, and exact Canvas identity', () => {
    expect(appSource).toContain('parseProjectWorkspaceLocation(window.location)');
    expect(appSource).toContain("window.history[options.replace ? 'replaceState' : 'pushState']");
    expect(appSource).toContain("window.addEventListener('popstate', onPopState)");
    expect(appSource).toContain("kind: 'canvas', projectId: nextProject, workspaceId: workspace.id");
    expect(appSource).toContain("navigateForUser({ kind: 'studio', projectId: project, view: nextView })");
    expect(appSource).toContain("if (next.kind === 'canvas' || next.kind === 'new-workspace') setView('lineage')");
    expect(appSource).toContain('onCanvasPresentationChange={rememberCurrentCanvasPresentation}');
    expect(appSource).toContain('navigateForUser(remembered, { search: remembered.search })');
    expect(appSource).toContain('forgetCanvasReturnDestination(project)');
    expect(appSource).toContain('workspaceId={workspaceId}');
    expect(appSource).toContain('onExitWorkspace={() => navigate');
  });

  it('keeps Canvas tab identity independent from the server-global active workspace', () => {
    expect(workspaceHookSource).toContain('visibleWorkspaces.find(workspace => workspace.id === workspaceId)');
    expect(workspaceHookSource).not.toContain('/activate');
    expect(workspaceHookSource).not.toContain('projectWorkspaceSnapshot?.active_workspace ||');
    expect(appSource).not.toContain('/activate');
  });

  it('rejects obsolete workspace refreshes after either route identity changes', () => {
    expect(workspaceHookSource).toContain('currentWorkspaceIdRef.current = workspaceId');
    expect(workspaceHookSource).toContain('requestedProject !== currentProjectRef.current');
    expect(workspaceHookSource).toContain('requestedWorkspaceId !== currentWorkspaceIdRef.current');
    expect(workspaceHookSource).toContain('generation !== refreshGenerationRef.current');
  });
});
