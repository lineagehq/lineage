// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { App } from './App';

vi.mock('./api', () => ({ api: vi.fn() }));
vi.mock('./components/Sidebar', async () => {
  const React = await import('react');
  return {
    Sidebar: (props: { project: string; setProject: (project: string) => void }) => React.createElement('nav', null,
      React.createElement('span', { 'data-testid': 'selected-project' }, props.project),
      React.createElement('button', { onClick: () => props.setProject('project-b') }, 'Select B'),
      React.createElement('button', { onClick: () => props.setProject('demo-project') }, 'Select A')),
  };
});
vi.mock('./components/LineageView', async () => {
  const React = await import('react');
  return {
    LineageView: (props: { onSocialDirtyChange: (dirty: boolean) => void; onSocialTransitionPendingChange?: (pending: boolean) => void; project: string }) => {
      React.useEffect(() => {
        if (props.project === 'project-b') props.onSocialTransitionPendingChange?.(true);
        return () => props.onSocialTransitionPendingChange?.(false);
      }, [props.onSocialTransitionPendingChange, props.project]);
      return React.createElement('section', { 'data-testid': 'lineage-project' }, props.project);
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});
beforeEach(() => { window.history.replaceState(null, '', '/projects/demo-project/workspaces/workspace-1'); });

describe('App latest project intent', () => {
  it('honors A-to-B-to-A while B lineage refresh is unsettled', async () => {
    vi.mocked(api).mockImplementation((path: string) => {
      if (path === '/api/projects') return Promise.resolve({ projects: [{ project: 'demo-project' }, { project: 'project-b' }] });
      if (path.startsWith('/api/assets?')) {
        const project = new URLSearchParams(path.split('?')[1]).get('project') || 'demo-project';
        return Promise.resolve({ catalog: { project, asset_count: 0 }, assets: [], liveObjects: [], orphanObjects: [], facets: { channels: [], totalSizeBytes: 0 } });
      }
      return Promise.reject(new Error('Runtime identity unavailable'));
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(createElement(App)); await Promise.resolve(); await Promise.resolve(); });

    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Select B')!.click());
    expect(container.querySelector('[data-testid="selected-project"]')?.textContent).toBe('project-b');
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Select A')!.click());
    expect(container.querySelector('[data-testid="selected-project"]')?.textContent).toBe('demo-project');
    expect(window.location.pathname).toBe('/projects/demo-project/workspaces');

    act(() => root.unmount());
  });
});
