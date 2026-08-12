import type { LineageEdgeWeight, LineagePreviewAction, LineagePreviewActionVisibility } from '../lineagePreferences';
import type { LineageCanvasPresentation } from './LineageAssetNode';
import type { LineageGraphDirection } from './lineageGraph';

type ChoiceOption<T extends string> = {
  ariaLabel: string;
  description: string;
  icon: string;
  label: string;
  sample?: string;
  value: T;
};

function SettingChoice<T extends string>({
  checked,
  disabled,
  name,
  onChange,
  option,
}: {
  checked: boolean;
  disabled: boolean;
  name: string;
  onChange: (value: T) => void;
  option: ChoiceOption<T>;
}) {
  return (
    <label className="lineage-setting-choice">
      <input
        aria-label={option.ariaLabel}
        checked={checked}
        disabled={disabled}
        name={name}
        onChange={() => onChange(option.value)}
        type="radio"
        value={option.value}
      />
      <span className="lineage-setting-choice-surface">
        <span aria-hidden="true" className="lineage-setting-choice-icon">
          {option.sample ? <span className={`lineage-edge-sample ${option.sample}`} /> : option.icon}
        </span>
        <span className="lineage-setting-choice-copy">
          <strong>{option.label}</strong>
          <small>{option.description}</small>
        </span>
        <span aria-hidden="true" className="lineage-setting-choice-check">✓</span>
      </span>
    </label>
  );
}

function SettingSwitch({
  ariaLabel,
  checked,
  description,
  disabled,
  label,
  onChange,
}: {
  ariaLabel: string;
  checked: boolean;
  description: string;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={ariaLabel}
      className="lineage-setting-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span className="lineage-setting-switch-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span aria-hidden="true" className="lineage-setting-switch-state">
        <span>{checked ? 'On' : 'Off'}</span>
        <span className="lineage-setting-switch-track">
          <span className="lineage-setting-switch-thumb" />
        </span>
      </span>
    </button>
  );
}

const cardOptions: Array<ChoiceOption<LineageCanvasPresentation>> = [
  {
    ariaLabel: 'Compact nodes',
    description: 'Scan more lineage at once',
    icon: '▦',
    label: 'Compact',
    value: 'compact',
  },
  {
    ariaLabel: 'Portrait cards',
    description: 'See the full social image',
    icon: '▯',
    label: 'Portrait',
    value: 'portrait',
  },
];

const directionOptions: Array<ChoiceOption<LineageGraphDirection>> = [
  { ariaLabel: 'Left to right', description: 'Flow across', icon: '→', label: 'Right', value: 'LR' },
  { ariaLabel: 'Top to bottom', description: 'Flow down', icon: '↓', label: 'Down', value: 'TB' },
  { ariaLabel: 'Right to left', description: 'Flow back', icon: '←', label: 'Left', value: 'RL' },
  { ariaLabel: 'Bottom to top', description: 'Flow up', icon: '↑', label: 'Up', value: 'BT' },
];

const edgeOptions: Array<ChoiceOption<LineageEdgeWeight>> = [
  {
    ariaLabel: 'Fine edges',
    description: 'Quiet',
    icon: '',
    label: 'Fine',
    sample: 'fine',
    value: 'fine',
  },
  {
    ariaLabel: 'Standard edges',
    description: 'Balanced',
    icon: '',
    label: 'Standard',
    sample: 'standard',
    value: 'standard',
  },
  {
    ariaLabel: 'Bold edges',
    description: 'Strong',
    icon: '',
    label: 'Bold',
    sample: 'bold',
    value: 'bold',
  },
];

export function LineageCanvasAppearanceControls({
  canvasPresentation,
  edgeSummariesVisible,
  edgeWeight,
  graphDirection,
  hoverPreviewsEnabled,
  loading,
  minimapVisible,
  nextVariationLimit,
  variationPromptAutoEdit,
  branchPromptOnMark,
  rerollPromptOnMark,
  discussionNotePrompt,
  previewActions,
  onCanvasPresentation,
  onEdgeSummariesVisible,
  onEdgeWeight,
  onFitGraph,
  onGraphDirection,
  onHoverPreviewsEnabled,
  onMinimapVisible,
  onNextVariationLimit,
  onVariationPromptAutoEdit,
  onBranchPromptOnMark,
  onRerollPromptOnMark,
  onDiscussionNotePrompt,
  onPreviewAction,
  onResetAppearance,
  onTidyGraph,
  snapshotAvailable,
}: {
  canvasPresentation: LineageCanvasPresentation;
  edgeSummariesVisible: boolean;
  edgeWeight: LineageEdgeWeight;
  graphDirection: LineageGraphDirection;
  hoverPreviewsEnabled: boolean;
  loading: boolean;
  minimapVisible: boolean;
  nextVariationLimit: number;
  variationPromptAutoEdit: boolean;
  branchPromptOnMark: boolean;
  rerollPromptOnMark: boolean;
  discussionNotePrompt: boolean;
  previewActions: LineagePreviewActionVisibility;
  onCanvasPresentation: (presentation: LineageCanvasPresentation) => void;
  onEdgeSummariesVisible: (visible: boolean) => void;
  onEdgeWeight: (weight: LineageEdgeWeight) => void;
  onFitGraph: () => void;
  onGraphDirection: (direction: LineageGraphDirection) => void;
  onHoverPreviewsEnabled: (enabled: boolean) => void;
  onMinimapVisible: (visible: boolean) => void;
  onNextVariationLimit: (limit: number) => void;
  onVariationPromptAutoEdit: (enabled: boolean) => void;
  onBranchPromptOnMark: (enabled: boolean) => void;
  onRerollPromptOnMark: (enabled: boolean) => void;
  onDiscussionNotePrompt: (enabled: boolean) => void;
  onPreviewAction: (action: LineagePreviewAction, enabled: boolean) => void;
  onResetAppearance: () => void;
  onTidyGraph: () => void;
  snapshotAvailable: boolean;
}) {
  const disabled = !snapshotAvailable || loading;

  return (
    <>
      <div className="lineage-canvas-settings-groups">
        <section aria-labelledby="canvas-settings-appearance" className="lineage-canvas-settings-group">
        <div className="lineage-canvas-settings-group-head">
          <span aria-hidden="true">◫</span>
          <div>
            <h4 id="canvas-settings-appearance">Appearance</h4>
            <p>Choose how each piece of lineage reads on the canvas.</p>
          </div>
        </div>
        <fieldset className="lineage-setting-fieldset">
          <legend>Cards</legend>
          <div className="lineage-setting-choice-grid cards">
            {cardOptions.map(option => (
              <SettingChoice
                checked={canvasPresentation === option.value}
                disabled={disabled}
                key={option.value}
                name="canvas-card-style"
                onChange={onCanvasPresentation}
                option={option}
              />
            ))}
          </div>
        </fieldset>
        </section>

        <section aria-labelledby="canvas-settings-layout" className="lineage-canvas-settings-group">
        <div className="lineage-canvas-settings-group-head">
          <span aria-hidden="true">↳</span>
          <div>
            <h4 id="canvas-settings-layout">Layout</h4>
            <p>Set the story's reading direction, then frame it when needed.</p>
          </div>
        </div>
        <fieldset className="lineage-setting-fieldset">
          <legend>Direction</legend>
          <div className="lineage-setting-choice-grid directions">
            {directionOptions.map(option => (
              <SettingChoice
                checked={graphDirection === option.value}
                disabled={disabled}
                key={option.value}
                name="lineage-graph-direction"
                onChange={onGraphDirection}
                option={option}
              />
            ))}
          </div>
        </fieldset>
        <div className="lineage-canvas-settings-actions">
          <button disabled={!snapshotAvailable} onClick={onFitGraph} type="button">
            <span aria-hidden="true">⌗</span>
            <span><strong>Fit graph</strong><small>Frame everything</small></span>
          </button>
          <button disabled={!snapshotAvailable} onClick={onTidyGraph} type="button">
            <span aria-hidden="true">✦</span>
            <span><strong>Tidy tree</strong><small>Restore spacing</small></span>
          </button>
        </div>
        </section>

        <section aria-labelledby="canvas-settings-connections" className="lineage-canvas-settings-group">
        <div className="lineage-canvas-settings-group-head">
          <span aria-hidden="true">⌁</span>
          <div>
            <h4 id="canvas-settings-connections">Connections</h4>
            <p>Control how strongly relationships speak.</p>
          </div>
        </div>
        <fieldset className="lineage-setting-fieldset">
          <legend>Edge weight</legend>
          <div className="lineage-setting-choice-grid edges">
            {edgeOptions.map(option => (
              <SettingChoice
                checked={edgeWeight === option.value}
                disabled={disabled}
                key={option.value}
                name="canvas-edge-weight"
                onChange={onEdgeWeight}
                option={option}
              />
            ))}
          </div>
        </fieldset>
        <SettingSwitch
          ariaLabel="Canvas edge labels"
          checked={edgeSummariesVisible}
          description="Show relationship details on each connection"
          disabled={!snapshotAvailable}
          label="Edge labels"
          onChange={onEdgeSummariesVisible}
        />
        </section>

        <section aria-labelledby="canvas-settings-workflow" className="lineage-canvas-settings-group">
        <div className="lineage-canvas-settings-group-head">
          <span aria-hidden="true">⑂</span>
          <div>
            <h4 id="canvas-settings-workflow">Workflow</h4>
            <p>Keep the variation queue focused for this workspace.</p>
          </div>
        </div>
        <label className="lineage-setting-number">
          <span><strong>Maximum queued branches</strong><small>New branches pause when this workspace reaches the limit</small></span>
          <input
            aria-label="Maximum queued branches"
            disabled={disabled}
            max={12}
            min={1}
            onChange={event => onNextVariationLimit(Number(event.target.value))}
            type="number"
            value={nextVariationLimit}
          />
        </label>
        </section>

        <section aria-labelledby="canvas-settings-view-aids" className="lineage-canvas-settings-group">
        <div className="lineage-canvas-settings-group-head">
          <span aria-hidden="true">⌖</span>
          <div>
            <h4 id="canvas-settings-view-aids">View aids</h4>
            <p>Keep orientation helpers close without crowding the work.</p>
          </div>
        </div>
        <SettingSwitch
          ariaLabel="Canvas minimap"
          checked={minimapVisible}
          description="Show a small overview for navigating large trees"
          disabled={!snapshotAvailable}
          label="Minimap"
          onChange={onMinimapVisible}
        />
        </section>

        <section aria-labelledby="canvas-settings-interaction" className="lineage-canvas-settings-group">
        <div className="lineage-canvas-settings-group-head">
          <span aria-hidden="true">◎</span>
          <div>
            <h4 id="canvas-settings-interaction">Interaction</h4>
            <p>Choose what appears as you explore.</p>
          </div>
        </div>
        <SettingSwitch
          ariaLabel="Canvas hover previews"
          checked={hoverPreviewsEnabled}
          description="Reveal a larger preview when a node is hovered"
          disabled={!snapshotAvailable}
          label="Hover previews"
          onChange={onHoverPreviewsEnabled}
        />
        <SettingSwitch
          ariaLabel="Edit prompt when selecting a variation"
          checked={variationPromptAutoEdit}
          description="Open the inline prompt editor when you choose a queued variation"
          disabled={!snapshotAvailable}
          label="Edit prompt when selecting a variation"
          onChange={onVariationPromptAutoEdit}
        />
        <SettingSwitch
          ariaLabel="Ask for a Branch prompt when marking"
          checked={branchPromptOnMark}
          description="Open the prompt editor before marking a card for Branch"
          disabled={!snapshotAvailable}
          label="Ask for Branch prompt"
          onChange={onBranchPromptOnMark}
        />
        <SettingSwitch
          ariaLabel="Ask for a Re-roll prompt when marking"
          checked={rerollPromptOnMark}
          description="Open the prompt editor before marking a card for Re-roll"
          disabled={!snapshotAvailable}
          label="Ask for Re-roll prompt"
          onChange={onRerollPromptOnMark}
        />
        <SettingSwitch
          ariaLabel="Ask for a note when flagging for discussion"
          checked={discussionNotePrompt}
          description="Offer an optional note before adding a discussion flag"
          disabled={!snapshotAvailable}
          label="Ask for a note when flagging for discussion"
          onChange={onDiscussionNotePrompt}
        />
        </section>

        <section aria-labelledby="canvas-settings-preview-actions" className="lineage-canvas-settings-group">
        <div className="lineage-canvas-settings-group-head">
          <span aria-hidden="true">⌨</span>
          <div>
            <h4 id="canvas-settings-preview-actions">Preview actions</h4>
            <p>Choose which shortcut buttons appear beneath a hover preview. Active states remain visible on cards.</p>
          </div>
        </div>
        {([
          ['branch', 'Branch', 'B'],
          ['reroll', 'Re-roll', 'R'],
          ['social', 'Social', 'S'],
          ['flag', 'Flag for discussion', 'F'],
          ['details', 'Details', 'D'],
        ] as const).map(([action, label, shortcut]) => (
          <SettingSwitch
            ariaLabel={`Show ${label} in hover preview`}
            checked={previewActions[action]}
            description={`Show the ${shortcut} shortcut button`}
            disabled={!snapshotAvailable}
            key={action}
            label={label}
            onChange={enabled => onPreviewAction(action, enabled)}
          />
        ))}
        </section>
      </div>

      <div className="lineage-canvas-settings-footer">
        <button className="lineage-reset-appearance" onClick={onResetAppearance} type="button">
          <span aria-hidden="true">↺</span>
          <span><strong>Reset appearance</strong><small>Return every Canvas setting to its default</small></span>
        </button>
      </div>
    </>
  );
}
