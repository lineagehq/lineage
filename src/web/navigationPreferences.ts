export const CONTEXT_PANEL_OPEN_KEY = 'lineage.navigation.context-open.v1';
export const PROJECTS_PRESENTATION_KEY = 'lineage.projects.presentation.v1';
export const WORKSPACES_PRESENTATION_KEY = 'lineage.workspaces.presentation.v1';

export type CollectionPresentationPreference = 'cards' | 'list';

export function readContextPanelOpen(storage: Pick<Storage, 'getItem'> | null = browserStorage()): boolean {
  if (!storage) return true;
  try {
    const stored = storage.getItem(CONTEXT_PANEL_OPEN_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export function writeContextPanelOpen(
  open: boolean,
  storage: Pick<Storage, 'setItem'> | null = browserStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(CONTEXT_PANEL_OPEN_KEY, String(open));
  } catch {
    // Navigation remains usable when browser storage is unavailable.
  }
}

export function readCollectionPresentation(
  key: typeof PROJECTS_PRESENTATION_KEY | typeof WORKSPACES_PRESENTATION_KEY,
  storage: Pick<Storage, 'getItem'> | null = browserStorage()
): CollectionPresentationPreference {
  if (!storage) return 'list';
  try {
    const stored = storage.getItem(key);
    return stored === 'cards' ? 'cards' : 'list';
  } catch {
    return 'list';
  }
}

export function writeCollectionPresentation(
  key: typeof PROJECTS_PRESENTATION_KEY | typeof WORKSPACES_PRESENTATION_KEY,
  presentation: CollectionPresentationPreference,
  storage: Pick<Storage, 'setItem'> | null = browserStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(key, presentation);
  } catch {
    // Collection presentation remains usable when browser storage is unavailable.
  }
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}
