import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GenerationJob } from '../../shared/generationTypes';
import type { LineageSnapshot } from '../../shared/types';
import { decorateSnapshotWithGenerationTargets } from './LineageGenerationTargets';
import { lineageCanvasPresentationFromSearch, serializeVariationLimitSave, variationLimitSaveOutcome, variationLimitTargetIsCurrent, variationQueueVisibleBounds } from './LineageView';
import type { NodeNextOutputTargetsResponse } from './NodeNextOutputTargetsModel';

describe('decorateSnapshotWithGenerationTargets', () => {
  it('keeps current produced geometry separate from the node future-child target state', () => {
    const decorated = decorateSnapshotWithGenerationTargets(snapshot, [job], {
      child: nodeTarget('child', 'node_override', 1080, 1350),
    });
    const child = decorated.nodes.find(node => node.asset_id === 'child') as typeof decorated.nodes[number] & {
      generation_target: { dimensions: string };
      next_output_target: { dimensions: string[]; origin: string };
    };

    expect(child.generation_target.dimensions).toBe('1080×1920');
    expect(child.next_output_target).toEqual(expect.objectContaining({
      dimensions: ['1080×1350'],
      origin: 'node_override',
    }));
  });

  it('decorates unresolved future intent even when the node has no generation receipt', () => {
    const unresolved = nodeTarget('root', 'unresolved');
    const decorated = decorateSnapshotWithGenerationTargets(snapshot, [], { root: unresolved });
    const root = decorated.nodes.find(node => node.asset_id === 'root') as typeof decorated.nodes[number] & {
      next_output_target: { dimensions: string[]; label: string; origin: string };
    };

    expect(root.next_output_target).toEqual({
      dimensions: [],
      label: 'Next targets unresolved',
      origin: 'unresolved',
    });
  });
});

describe('canvas presentation URL selection', () => {
  it('uses an explicit card style and otherwise preserves the supplied preference', () => {
    expect(lineageCanvasPresentationFromSearch('?project=demo-project')).toBe('compact');
    expect(lineageCanvasPresentationFromSearch('?project=demo-project&lineageCanvas=portrait')).toBe('portrait');
    expect(lineageCanvasPresentationFromSearch('?lineageCanvas=compact', 'portrait')).toBe('compact');
    expect(lineageCanvasPresentationFromSearch('?project=demo-project', 'portrait')).toBe('portrait');
    expect(lineageCanvasPresentationFromSearch('?lineageCanvas=other')).toBe('compact');
  });
});

describe('variation limit response targeting', () => {
  const requested = { project: 'project-a', rootAssetId: 'root-a', workspaceId: 'workspace-a' };

  it('accepts only the response for the workspace that is still active', () => {
    expect(variationLimitTargetIsCurrent(requested, requested)).toBe(true);
    expect(variationLimitTargetIsCurrent(requested, { ...requested, workspaceId: 'workspace-b' })).toBe(false);
    expect(variationLimitTargetIsCurrent(requested, { ...requested, rootAssetId: 'root-b' })).toBe(false);
    expect(variationLimitTargetIsCurrent(requested, { ...requested, project: 'project-b' })).toBe(false);
  });

  it('applies an earlier successful save even when a newer queued save may still fail', () => {
    expect(variationLimitSaveOutcome(1, 2, requested, requested)).toEqual({ apply: true, announce: false });
    expect(variationLimitSaveOutcome(2, 2, requested, requested)).toEqual({ apply: true, announce: true });
    expect(variationLimitSaveOutcome(1, 2, requested, { ...requested, workspaceId: 'workspace-b' })).toEqual({ apply: false, announce: false });
    expect(variationLimitSaveOutcome(2, 2, requested, { ...requested, workspaceId: 'workspace-b' })).toEqual({ apply: false, announce: false });
  });

  it('serializes saves so later user choices reach the server last', async () => {
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    let markFirstStarted: () => void = () => undefined;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve; });
    const first = serializeVariationLimitSave(Promise.resolve(), async () => {
      events.push('first:start');
      markFirstStarted();
      await firstGate;
      events.push('first:end');
    });
    const second = serializeVariationLimitSave(first, async () => {
      events.push('second:start');
      events.push('second:end');
    });

    await firstStarted;
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await second;
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });
});

describe('variation queue focus bounds', () => {
  const canvas = { bottom: 900, height: 900, left: 320, right: 1280, top: 0, width: 960 };

  it('centers into the unobscured canvas beside the desktop queue', () => {
    const panel = { bottom: 900, height: 900, left: 870, right: 1280, top: 0, width: 410 };
    expect(variationQueueVisibleBounds(canvas, panel)).toEqual({ bottom: 900, left: 0, right: 550, top: 0 });
  });

  it('centers above a mobile bottom sheet and preserves the full canvas without a panel', () => {
    const panel = { bottom: 900, height: 620, left: 320, right: 1280, top: 280, width: 960 };
    expect(variationQueueVisibleBounds(canvas, panel)).toEqual({ bottom: 280, left: 0, right: 960, top: 0 });
    expect(variationQueueVisibleBounds(canvas)).toEqual({ bottom: 900, left: 0, right: 960, top: 0 });
  });
});

describe('Canvas contextual tool composition', () => {
  it('portals Canvas-owned controls into the sidebar without reserving a graph header row', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/components/LineageView.tsx'), 'utf8');
    const css = readFileSync(join(process.cwd(), 'src/web/components/LineageView.css'), 'utf8');
    const viewRuleStart = css.indexOf('.lineage-view {');
    const viewRule = css.slice(viewRuleStart, css.indexOf('}', viewRuleStart) + 1);

    expect(source).toContain("document.getElementById('canvas-context-tools')");
    expect(source).toContain('createPortal(');
    expect(source.indexOf('createPortal(')).toBeLessThan(source.indexOf('data-testid="lineage-workbench"'));
    expect(viewRule).toContain('grid-template-rows: minmax(0, 1fr);');
    expect(viewRule).not.toContain('grid-template-rows: auto');
  });

  it('restores panel focus and uses the mobile breakpoint for the bottom sheet', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/components/LineageView.tsx'), 'utf8');
    const controls = readFileSync(join(process.cwd(), 'src/web/components/LineageCanvasAppearanceControls.tsx'), 'utf8');
    const css = readFileSync(join(process.cwd(), 'src/web/components/LineageView.css'), 'utf8');

    expect(source).toContain('window.requestAnimationFrame(() => returnFocus?.focus())');
    expect(source).toContain('!variationPrompt && !panelMode');
    expect(source).toContain("'.lineage-node[data-asset-id], .lineage-variation-queue, .lineage-variation-queue-launch'");
    expect(source).toContain('if (unrelatedInteractiveTarget && !intentionalQueueTarget) return;');
    expect(source).toContain('aria-label="Close Canvas panel"');
    expect(source).toContain('<button autoFocus aria-label="Close Canvas settings"');
    expect(source).toContain('onClick={closePanel}');
    expect(source).toContain('aria-label="Canvas settings tip"');
    expect(source).toContain('aria-label="Dismiss Canvas settings hint"');
    expect(source).toContain('writeCanvasSettingsHintDismissed()');
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('.lineage-panel-backdrop');
    expect(css).toContain(".lineage-canvas-settings-trigger[aria-expanded='true']");
    expect(css).toContain('top: 18px;');
    expect(css).toContain("right: calc(min(390px, calc(100% - 24px)) + 24px);");
    expect(controls).toContain('type="radio"');
    expect(controls).toContain('role="switch"');
    expect(controls).toContain('aria-label="Maximum queued branches"');
    expect(controls).toContain('max={12}');
    expect(source).toContain('maxQueuedBranches: normalized');
    expect(controls).toContain('aria-checked={checked}');
    expect(css).toContain('@keyframes lineage-settings-panel-in');
    expect(css).toContain('@keyframes lineage-settings-hint-in');
    expect(css).toContain('@keyframes lineage-settings-sheet-in');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.lineage-setting-switch-thumb');
    expect(css).toContain('.lineage-settings-sheet-handle');
    expect(css).toContain('grid-template-rows: auto minmax(0, 1fr) auto;');
    expect(controls).toContain('className="lineage-canvas-settings-footer"');
  });
});

const snapshot = {
  active_asset_id: 'child',
  edges: [],
  fetchedAt: '2026-07-27T00:00:00.000Z',
  latest: ['child'],
  nodes: [
    { asset_id: 'root', title: 'Root', project: 'project', source: 'local', status: 'working', review_state: 'unreviewed', media_type: 'image', is_latest: false, user_selected: false },
    { asset_id: 'child', title: 'Child', project: 'project', source: 'local', status: 'working', review_state: 'unreviewed', media_type: 'image', is_latest: true, user_selected: false },
  ],
  project: 'project',
  root_asset_id: 'root',
  selected: [],
  selection: null,
  selections: [],
} as LineageSnapshot;

const job = {
  id: 'job',
  inputs: [{ asset_id: 'root' }],
  outputs: [{ imported_asset_id: 'child', output_index: 0 }],
  target_plan: {
    groups: [{
      delivery_surfaces: [{ platform: 'Instagram', surface: 'Story' }],
      grouping_mode: 'consolidated',
      guidance: [],
      height: 1920,
      id: 'group',
      parent_asset_id: 'root',
      unlocked: false,
      variant_count: 1,
      width: 1080,
    }],
    slots: [{ group_id: 'group', output_index: 0 }],
  },
} as unknown as GenerationJob;

function nodeTarget(
  nodeAssetId: string,
  origin: NodeNextOutputTargetsResponse['effective']['origin'],
  width?: number,
  height?: number,
): NodeNextOutputTargetsResponse {
  return {
    ok: true,
    project: 'project',
    root_asset_id: 'root',
    node_asset_id: nodeAssetId,
    setting: null,
    effective: {
      node_asset_id: nodeAssetId,
      origin,
      project_id: 'project',
      resolution_digest_sha256: 'digest',
      resolved_targets: width && height ? [{ delivery_surfaces: [], height, media_kind: 'static_image', width }] : [],
      root_asset_id: 'root',
      schema_version: 'lineage.node_next_output_targets.v1',
      targets: width && height ? [{ kind: 'custom', width, height }] : [],
    },
  };
}
