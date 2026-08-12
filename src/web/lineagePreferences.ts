import type { LineageCanvasPresentation } from './components/LineageAssetNode';
import type { LineageGraphDirection } from './components/lineageGraph';

const hoverPreviewsKey = 'lineage.preferences.hover-previews';
const canvasPresentationKey = 'lineage.preferences.canvas-presentation';
const edgeWeightKey = 'lineage.preferences.edge-weight';
const edgeLabelsKey = 'lineage.preferences.edge-labels';
const minimapVisibleKey = 'lineage.preferences.minimap-visible';
const compactDirectionKey = 'lineage.preferences.compact-direction';
const portraitDirectionKey = 'lineage.preferences.portrait-direction';
const canvasSettingsHintDismissedKey = 'lineage.preferences.canvas-settings-hint-dismissed';
const variationPromptAutoEditKey = 'lineage.preferences.variation-prompt-auto-edit';
const branchPromptOnMarkKey = 'lineage.preferences.branch-prompt-on-mark';
const rerollPromptOnMarkKey = 'lineage.preferences.reroll-prompt-on-mark';
const discussionNotePromptKey = 'lineage.preferences.discussion-note-prompt';
const previewActionsKey = 'lineage.preferences.preview-actions';

type PreferenceReader = Pick<Storage, 'getItem'>;
type PreferenceWriter = Pick<Storage, 'setItem'>;

export type LineageEdgeWeight = 'fine' | 'standard' | 'bold';
export type LineagePreviewAction = 'branch' | 'reroll' | 'social' | 'flag' | 'details';
export type LineagePreviewActionVisibility = Record<LineagePreviewAction, boolean>;
export const lineagePreviewActionDefaults: LineagePreviewActionVisibility = {
  branch: true,
  reroll: true,
  social: true,
  flag: true,
  details: true,
};
const lineageAppearanceDefaults = {
  canvasPresentation: 'compact',
  compactDirection: 'LR',
  edgeLabelsVisible: true,
  edgeWeight: 'standard',
  hoverPreviewsEnabled: true,
  minimapVisible: true,
  portraitDirection: 'LR',
  variationPromptAutoEdit: true,
  branchPromptOnMark: true,
  rerollPromptOnMark: true,
  discussionNotePrompt: false,
} as const;

export function readLineagePreviewActions(storage?: PreferenceReader): LineagePreviewActionVisibility {
  try {
    const stored = JSON.parse((storage || window.localStorage).getItem(previewActionsKey) || '{}') as Partial<LineagePreviewActionVisibility>;
    return Object.fromEntries(
      Object.entries(lineagePreviewActionDefaults).map(([action, enabled]) => [action, typeof stored[action as LineagePreviewAction] === 'boolean' ? stored[action as LineagePreviewAction] : enabled]),
    ) as LineagePreviewActionVisibility;
  } catch {
    return { ...lineagePreviewActionDefaults };
  }
}

export function writeLineagePreviewActions(actions: LineagePreviewActionVisibility, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(previewActionsKey, JSON.stringify(actions));
    return true;
  } catch {
    return false;
  }
}

export function readDiscussionNotePrompt(storage?: PreferenceReader): boolean {
  try {
    return (storage || window.localStorage).getItem(discussionNotePromptKey) === 'true';
  } catch {
    return lineageAppearanceDefaults.discussionNotePrompt;
  }
}

export function writeDiscussionNotePrompt(enabled: boolean, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(discussionNotePromptKey, String(enabled));
    return true;
  } catch {
    return false;
  }
}

export function readVariationPromptAutoEdit(storage?: PreferenceReader): boolean {
  try {
    return (storage || window.localStorage).getItem(variationPromptAutoEditKey) !== 'false';
  } catch {
    return lineageAppearanceDefaults.variationPromptAutoEdit;
  }
}

export function writeVariationPromptAutoEdit(enabled: boolean, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(variationPromptAutoEditKey, String(enabled));
    return true;
  } catch {
    return false;
  }
}

export function readBranchPromptOnMark(storage?: PreferenceReader): boolean {
  try {
    return (storage || window.localStorage).getItem(branchPromptOnMarkKey) !== 'false';
  } catch {
    return lineageAppearanceDefaults.branchPromptOnMark;
  }
}

export function writeBranchPromptOnMark(enabled: boolean, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(branchPromptOnMarkKey, String(enabled));
    return true;
  } catch {
    return false;
  }
}

export function readRerollPromptOnMark(storage?: PreferenceReader): boolean {
  try {
    return (storage || window.localStorage).getItem(rerollPromptOnMarkKey) !== 'false';
  } catch {
    return lineageAppearanceDefaults.rerollPromptOnMark;
  }
}

export function writeRerollPromptOnMark(enabled: boolean, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(rerollPromptOnMarkKey, String(enabled));
    return true;
  } catch {
    return false;
  }
}

export function readHoverPreviewsEnabled(storage?: PreferenceReader): boolean {
  try {
    return (storage || window.localStorage).getItem(hoverPreviewsKey) !== 'false';
  } catch {
    return true;
  }
}

export function writeHoverPreviewsEnabled(enabled: boolean, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(hoverPreviewsKey, String(enabled));
    return true;
  } catch {
    return false;
  }
}

export function readLineageCanvasPresentation(storage?: PreferenceReader): LineageCanvasPresentation {
  try {
    return (storage || window.localStorage).getItem(canvasPresentationKey) === 'portrait' ? 'portrait' : 'compact';
  } catch {
    return 'compact';
  }
}

export function writeLineageCanvasPresentation(presentation: LineageCanvasPresentation, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(canvasPresentationKey, presentation);
    return true;
  } catch {
    return false;
  }
}

export function readLineageEdgeWeight(storage?: PreferenceReader): LineageEdgeWeight {
  try {
    const stored = (storage || window.localStorage).getItem(edgeWeightKey);
    return stored === 'fine' || stored === 'bold' ? stored : 'standard';
  } catch {
    return 'standard';
  }
}

export function writeLineageEdgeWeight(weight: LineageEdgeWeight, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(edgeWeightKey, weight);
    return true;
  } catch {
    return false;
  }
}

export function readLineageEdgeLabelsVisible(storage?: PreferenceReader): boolean {
  try {
    return (storage || window.localStorage).getItem(edgeLabelsKey) !== 'false';
  } catch {
    return lineageAppearanceDefaults.edgeLabelsVisible;
  }
}

export function writeLineageEdgeLabelsVisible(visible: boolean, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(edgeLabelsKey, String(visible));
    return true;
  } catch {
    return false;
  }
}

export function readLineageMinimapVisible(storage?: PreferenceReader): boolean {
  try {
    return (storage || window.localStorage).getItem(minimapVisibleKey) !== 'false';
  } catch {
    return lineageAppearanceDefaults.minimapVisible;
  }
}

export function writeLineageMinimapVisible(visible: boolean, storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(minimapVisibleKey, String(visible));
    return true;
  } catch {
    return false;
  }
}

function directionKey(presentation: LineageCanvasPresentation): string {
  return presentation === 'portrait' ? portraitDirectionKey : compactDirectionKey;
}

export function readLineageGraphDirection(
  presentation: LineageCanvasPresentation,
  storage?: PreferenceReader,
): LineageGraphDirection {
  try {
    const stored = (storage || window.localStorage).getItem(directionKey(presentation));
    return stored === 'TB' || stored === 'RL' || stored === 'BT' ? stored : 'LR';
  } catch {
    return lineageAppearanceDefaults.compactDirection;
  }
}

export function writeLineageGraphDirection(
  presentation: LineageCanvasPresentation,
  direction: LineageGraphDirection,
  storage?: PreferenceWriter,
): boolean {
  try {
    (storage || window.localStorage).setItem(directionKey(presentation), direction);
    return true;
  } catch {
    return false;
  }
}

export function readCanvasSettingsHintDismissed(storage?: PreferenceReader): boolean {
  try {
    return (storage || window.localStorage).getItem(canvasSettingsHintDismissedKey) === 'true';
  } catch {
    return true;
  }
}

export function writeCanvasSettingsHintDismissed(storage?: PreferenceWriter): boolean {
  try {
    (storage || window.localStorage).setItem(canvasSettingsHintDismissedKey, 'true');
    return true;
  } catch {
    return false;
  }
}

export function resetLineageAppearancePreferences(storage?: PreferenceWriter): boolean {
  const writer = storage || window.localStorage;
  try {
    writer.setItem(canvasPresentationKey, lineageAppearanceDefaults.canvasPresentation);
    writer.setItem(compactDirectionKey, lineageAppearanceDefaults.compactDirection);
    writer.setItem(portraitDirectionKey, lineageAppearanceDefaults.portraitDirection);
    writer.setItem(edgeWeightKey, lineageAppearanceDefaults.edgeWeight);
    writer.setItem(edgeLabelsKey, String(lineageAppearanceDefaults.edgeLabelsVisible));
    writer.setItem(hoverPreviewsKey, String(lineageAppearanceDefaults.hoverPreviewsEnabled));
    writer.setItem(minimapVisibleKey, String(lineageAppearanceDefaults.minimapVisible));
    writer.setItem(variationPromptAutoEditKey, String(lineageAppearanceDefaults.variationPromptAutoEdit));
    writer.setItem(branchPromptOnMarkKey, String(lineageAppearanceDefaults.branchPromptOnMark));
    writer.setItem(rerollPromptOnMarkKey, String(lineageAppearanceDefaults.rerollPromptOnMark));
    writer.setItem(discussionNotePromptKey, String(lineageAppearanceDefaults.discussionNotePrompt));
    writer.setItem(previewActionsKey, JSON.stringify(lineagePreviewActionDefaults));
    return true;
  } catch {
    return false;
  }
}
