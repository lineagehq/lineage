// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationJob } from '../../shared/generationTypes';
import type { LineageNode } from '../../shared/types';
import { LineageGenerationSheet, savedVariationPrompt } from './LineageGenerationSheet';
import { selectedNodeTargetResolutionDigest, type NodeNextOutputTargetsResponse } from './NodeNextOutputTargetsModel';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal('crypto', webcrypto);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LineageGenerationSheet persisted node-target bridge', () => {
  it('prefills one exact saved prompt or preserves distinct source prompts', () => {
    expect(savedVariationPrompt([{ ...sources[0], branch_prompt: 'Make it editorial.' }])).toBe('Make it editorial.');
    expect(savedVariationPrompt([
      { ...sources[0], branch_prompt: 'Use a red grid.' },
      { ...sources[1], branch_prompt: 'Use a blue grid.' },
    ])).toBe('For source source-a: Use a red grid.\n\nFor source source-b: Use a blue grid.');
  });
  it('resolves independent sources by their canonical aggregate digest and keeps counts job-scoped', async () => {
    const states = [
      nodeState('source-a', 'node_override', 'a'.repeat(64), 1080, 1920, 4),
      nodeState('source-b', 'canvas_default', 'b'.repeat(64), 1200, 1500),
    ];
    const expectedDigest = await selectedNodeTargetResolutionDigest(states);
    const preview = planResponse('preview-job', 6);
    const stored = planResponse('stored-job', 6);
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(states[0]))
      .mockResolvedValueOnce(response(states[1]))
      .mockResolvedValueOnce(response(preview))
      .mockResolvedValueOnce(response(stored));
    vi.stubGlobal('fetch', fetch);
    const onPlanned = vi.fn();
    await render(onPlanned);

    expect(container.textContent).toContain('Sticky next 1080×1920');
    expect(container.textContent).toContain('Inherited next 1200×1500');
    expect(container.textContent).toContain('Every source is resolved independently');
    setTextarea('Create exact static variations');
    setNumber('Variations per produced geometry', '3');

    await click('Resolve from persisted targets');
    const previewBody = JSON.parse(String(fetch.mock.calls[2][1]?.body));
    expect(previewBody).toMatchObject({
      expectedTargetResolutionDigest: expectedDigest,
      fromNodeTargets: true,
      preview: true,
      project: 'project',
      variantsPerTarget: 3,
    });
    expect(previewBody).not.toHaveProperty('targetMap');
    expect(container.textContent).toContain('6 exact outputs');

    await click('Create planned job');
    const submitBody = JSON.parse(String(fetch.mock.calls[3][1]?.body));
    expect(submitBody).toMatchObject({
      confirmWrite: true,
      expectedTargetResolutionDigest: expectedDigest,
      fromNodeTargets: true,
      variantsPerTarget: 3,
    });
    expect(onPlanned).toHaveBeenCalledWith(expect.objectContaining({ id: 'stored-job' }));
  });

  it('blocks preview until every selected source has a persisted or inherited exact geometry', async () => {
    const unresolved = nodeState('source-b', 'unresolved', 'c'.repeat(64), 0, 0);
    unresolved.effective.resolved_targets = [];
    unresolved.effective.targets = [];
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(nodeState('source-a', 'derived_child', 'a'.repeat(64), 1080, 1920)))
      .mockResolvedValueOnce(response(unresolved));
    vi.stubGlobal('fetch', fetch);
    await render(vi.fn());
    setTextarea('This must not plan');

    expect(button('Resolve from persisted targets')?.disabled).toBe(true);
    expect(container.textContent).toContain('Next targets unresolved');
    expect(container.textContent).toContain('Resolve every source before preview');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fails closed on a stale aggregate digest and reloads the authoritative source states', async () => {
    const initial = [
      nodeState('source-a', 'node_override', 'a'.repeat(64), 1080, 1920, 1),
      nodeState('source-b', 'canvas_default', 'b'.repeat(64), 1200, 1500),
    ];
    const changed = nodeState('source-a', 'node_override', 'd'.repeat(64), 1080, 1350, 2);
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(initial[0]))
      .mockResolvedValueOnce(response(initial[1]))
      .mockResolvedValueOnce(response({ message: 'Selected source target resolution changed; refresh and retry.' }, false, 409))
      .mockResolvedValueOnce(response(changed))
      .mockResolvedValueOnce(response(initial[1]));
    vi.stubGlobal('fetch', fetch);
    await render(vi.fn());
    setTextarea('Stale planning request');

    await click('Resolve from persisted targets');

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('resolution changed');
    expect(container.textContent).toContain('Sticky next 1080×1350');
    expect(button('Create planned job')?.disabled).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});

async function render(onPlanned: (job: GenerationJob) => void) {
  await act(async () => {
    root.render(<LineageGenerationSheet onClose={vi.fn()} onPlanned={onPlanned} project="project" rootAssetId="root" sources={sources} />);
    await tick();
  });
}

function button(label: string) {
  return [...container.querySelectorAll('button')].find(item => item.textContent === label) as HTMLButtonElement | undefined;
}

async function click(label: string) {
  await act(async () => {
    button(label)!.click();
    await tick();
  });
}

function setTextarea(value: string) {
  const element = container.querySelector('textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setNumber(label: string, value: string) {
  const element = [...container.querySelectorAll('label')].find(item => item.textContent?.includes(label))!.querySelector('input')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function tick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function response(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

function nodeState(
  nodeAssetId: string,
  origin: NodeNextOutputTargetsResponse['effective']['origin'],
  resolutionDigest: string,
  width: number,
  height: number,
  revision?: number,
): NodeNextOutputTargetsResponse {
  const target = { kind: 'custom' as const, width, height };
  return {
    ok: true,
    project: 'project',
    root_asset_id: 'root',
    node_asset_id: nodeAssetId,
    setting: revision ? {
      created_at: '2026-07-27T00:00:00.000Z',
      digest_sha256: `${resolutionDigest}-setting`,
      node_asset_id: nodeAssetId,
      project_id: 'project',
      provenance: { actor: 'human', origin: 'canvas' },
      revision,
      resolved_targets: [{
        delivery_surfaces: [],
        height,
        media_kind: 'static_image',
        width,
      }],
      root_asset_id: 'root',
      schema_version: 'lineage.node_next_output_targets.v1',
      targets: [target],
      updated_at: '2026-07-27T00:00:00.000Z',
    } : null,
    effective: {
      node_asset_id: nodeAssetId,
      origin,
      project_id: 'project',
      resolution_digest_sha256: resolutionDigest,
      resolved_targets: width && height ? [{
        delivery_surfaces: [],
        height,
        media_kind: 'static_image',
        width,
      }] : [],
      root_asset_id: 'root',
      schema_version: 'lineage.node_next_output_targets.v1',
      targets: width && height ? [target] : [],
      ...(revision ? { setting_revision: revision, setting_digest_sha256: `${resolutionDigest}-setting` } : {}),
    },
  };
}

function planResponse(id: string, expectedOutputCount: number) {
  return {
    ok: true,
    command: 'generate image plan',
    project: 'project',
    dryRun: id === 'preview-job',
    wouldWrite: true,
    job: {
      id,
      project_id: 'project',
      provider: 'codex-handoff',
      adapter_version: 'generation-receipts-v3',
      source_mode: 'lineage_selection',
      root_asset_id: 'root',
      prompt: 'Create exact static variations',
      expected_output_count: expectedOutputCount,
      status: 'planned',
      created_at: '2026-07-27T00:00:00.000Z',
      updated_at: '2026-07-27T00:00:00.000Z',
      inputs: [],
      outputs: [],
      receipts: [],
      handoff: {},
      target_plan: {
        digest_sha256: 'plan-digest',
        expected_output_count: expectedOutputCount,
        groups: [
          { id: 'a', parent_asset_id: 'source-a', width: 1080, height: 1920, variant_count: 3, delivery_surfaces: [], guidance: [], grouping_mode: 'consolidated', unlocked: false },
          { id: 'b', parent_asset_id: 'source-b', width: 1200, height: 1500, variant_count: 3, delivery_surfaces: [], guidance: [], grouping_mode: 'consolidated', unlocked: false },
        ],
        slots: [],
      },
    },
  };
}

const sources = ['source-a', 'source-b'].map((asset_id, index) => ({
  asset_id,
  title: `Source ${index + 1}`,
  project: 'project',
  source: 'local',
  status: 'working',
  review_state: 'unreviewed',
  media_type: 'image',
  is_latest: true,
  user_selected: true,
})) as LineageNode[];
