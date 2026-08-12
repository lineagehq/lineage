// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONTEXT_PANEL_OPEN_KEY,
  PROJECTS_PRESENTATION_KEY,
  WORKSPACES_PRESENTATION_KEY,
  readCollectionPresentation,
  readContextPanelOpen,
  writeCollectionPresentation,
  writeContextPanelOpen,
} from './navigationPreferences';

describe('navigation preferences', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults the desktop contextual panel open', () => {
    expect(readContextPanelOpen()).toBe(true);
  });

  it('round trips the desktop contextual panel state with the versioned key', () => {
    writeContextPanelOpen(false);

    expect(window.localStorage.getItem(CONTEXT_PANEL_OPEN_KEY)).toBe('false');
    expect(readContextPanelOpen()).toBe(false);
  });

  it('falls back safely when storage cannot be read or written', () => {
    const unavailable = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };

    expect(readContextPanelOpen(unavailable)).toBe(true);
    expect(() => writeContextPanelOpen(false, unavailable)).not.toThrow();
    expect(readCollectionPresentation(PROJECTS_PRESENTATION_KEY, unavailable)).toBe('list');
    expect(() => writeCollectionPresentation(WORKSPACES_PRESENTATION_KEY, 'list', unavailable)).not.toThrow();
  });

  it('persists one presentation preference for each organization level', () => {
    writeCollectionPresentation(PROJECTS_PRESENTATION_KEY, 'list');
    writeCollectionPresentation(WORKSPACES_PRESENTATION_KEY, 'cards');

    expect(readCollectionPresentation(PROJECTS_PRESENTATION_KEY)).toBe('list');
    expect(readCollectionPresentation(WORKSPACES_PRESENTATION_KEY)).toBe('cards');
  });

  it('defaults both organization levels to list presentation', () => {
    expect(readCollectionPresentation(PROJECTS_PRESENTATION_KEY)).toBe('list');
    expect(readCollectionPresentation(WORKSPACES_PRESENTATION_KEY)).toBe('list');
  });
});
