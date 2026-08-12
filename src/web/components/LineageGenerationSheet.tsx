import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GenerationJob, GenerationPlanResponse } from '../../shared/generationTypes';
import type { LineageNode } from '../../shared/types';
import { api } from '../api';
import { NodeNextOutputTargetsEditor } from './NodeNextOutputTargets';
import {
  loadNodeNextOutputTargets,
  nodeTargetStateLabel,
  selectedNodeTargetResolutionDigest,
  type NodeNextOutputTargetsResponse,
} from './NodeNextOutputTargetsModel';
import './LineageGenerationSheet.css';

// eslint-disable-next-line react-refresh/only-export-components -- pure prompt projection shared with regression tests
export function savedVariationPrompt(sources: LineageNode[]): string {
  const prompts = sources
    .map(source => ({ assetId: source.asset_id, prompt: (source.branch_prompt || source.selection_note || '').trim() }))
    .filter(item => Boolean(item.prompt));
  if (prompts.length === 0) return '';
  if (prompts.every(item => item.prompt === prompts[0].prompt)) return prompts[0].prompt;
  return prompts.map(item => `For source ${item.assetId}: ${item.prompt}`).join('\n\n');
}

export function LineageGenerationSheet({ onClose, onPlanned, project, rootAssetId, sources }: {
  onClose: () => void;
  onPlanned?: (job: GenerationJob) => void;
  project: string;
  rootAssetId: string;
  sources: LineageNode[];
}) {
  const [states, setStates] = useState<NodeNextOutputTargetsResponse[]>([]);
  const [resolutionDigest, setResolutionDigest] = useState('');
  const [prompt, setPrompt] = useState(() => savedVariationPrompt(sources));
  const [variantsPerTarget, setVariantsPerTarget] = useState(1);
  const [preview, setPreview] = useState<GenerationPlanResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sourceIds = useMemo(() => sources.map(source => source.asset_id).join('\0'), [sources]);

  const reload = useCallback(async () => {
    const next = await Promise.all(sources.map(source =>
      loadNodeNextOutputTargets(project, rootAssetId, source.asset_id)));
    setStates(next);
    setResolutionDigest(await selectedNodeTargetResolutionDigest(next));
    setPreview(null);
    return next;
  }, [project, rootAssetId, sourceIds]);

  useEffect(() => {
    let cancelled = false;
    reload().catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [reload]);

  const unresolved = states.filter(state => state.effective.origin === 'unresolved');
  const ready = Boolean(
    prompt.trim()
    && states.length === sources.length
    && unresolved.length === 0
    && resolutionDigest
    && Number.isInteger(variantsPerTarget)
    && variantsPerTarget > 0,
  );

  async function requestPlan(previewOnly: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await api<GenerationPlanResponse>('/api/generation/targets/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project,
          prompt,
          fromNodeTargets: true,
          expectedTargetResolutionDigest: resolutionDigest,
          variantsPerTarget,
          preview: previewOnly,
          ...(previewOnly ? {} : { confirmWrite: true }),
        }),
      });
      if (previewOnly) setPreview(result);
      else {
        onPlanned?.(result.job);
        onClose();
      }
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : String(reason));
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lineage-generation-backdrop" onClick={onClose}>
      <section aria-labelledby="lineage-generation-title" aria-modal="true" className="lineage-generation-sheet" onClick={event => event.stopPropagation()} role="dialog">
        <header>
          <div>
            <h3 id="lineage-generation-title">Plan next branch</h3>
            <p>Every source is resolved independently from its sticky node setting or the current human canvas default.</p>
          </div>
          <button onClick={onClose}>Close</button>
        </header>
        <label className="lineage-generation-prompt">
          Generation prompt
          <textarea onChange={event => { setPrompt(event.target.value); setPreview(null); }} value={prompt} />
          {savedVariationPrompt(sources) && <small>Prefilled from the exact prompt saved on {sources.length === 1 ? 'this node' : 'these nodes'}.</small>}
        </label>
        <label className="lineage-source-default-count">
          Variations per produced geometry
          <input min={1} onChange={event => { setVariantsPerTarget(Number(event.target.value)); setPreview(null); }} type="number" value={variantsPerTarget} />
        </label>
        {error && <p className="output-target-error" role="alert">{error}</p>}
        {states.length !== sources.length && !error && <p>Loading persisted node targets…</p>}
        <div className="lineage-node-target-sources">
          {sources.map(source => {
            const state = states.find(item => item.node_asset_id === source.asset_id);
            if (!state) return null;
            return (
              <article className={`lineage-node-target-source origin-${state.effective.origin}`} key={source.asset_id}>
                <div>
                  <strong>{source.title}</strong>
                  <code>{source.asset_id}</code>
                  <span>{nodeTargetStateLabel(state.effective)}</span>
                </div>
                {state.effective.resolved_targets.map((target, index) => (
                  <small key={`${target.width}x${target.height}-${index}`}>
                    {target.width} × {target.height} px · {target.delivery_surfaces.map(surface => `${surface.platform} ${surface.surface}`).join(', ') || 'custom'}
                  </small>
                ))}
                <SourceTargetEditorDisclosure
                  node={source}
                  onSaved={reload}
                  project={project}
                  rootAssetId={rootAssetId}
                  unresolved={state.effective.origin === 'unresolved'}
                />
              </article>
            );
          })}
        </div>
        <p className="lineage-resolution-digest">
          <strong>Selected-source resolution</strong>
          <code>{resolutionDigest || 'loading'}</code>
        </p>
        <section aria-live="polite" className="lineage-plan-summary">
          <h4>Immutable job preview</h4>
          {!preview && <p>{unresolved.length > 0 ? 'Resolve every source before preview.' : 'Preview is required before the planned job is persisted.'}</p>}
          {preview?.job.target_plan && (
            <>
              <p><strong>{preview.job.target_plan.expected_output_count} exact output{preview.job.target_plan.expected_output_count === 1 ? '' : 's'}</strong> in {preview.job.target_plan.groups.length} produced geometr{preview.job.target_plan.groups.length === 1 ? 'y' : 'ies'}.</p>
              {preview.job.target_plan.groups.map(group => (
                <article className="is-locked" key={group.id}>
                  <strong>{group.width} × {group.height} px</strong>
                  <span>{group.parent_asset_id} · {group.variant_count} output{group.variant_count === 1 ? '' : 's'}</span>
                  <small>{group.delivery_surfaces.map(surface => `${surface.platform} ${surface.surface}`).join(', ') || 'Custom dimensions'}</small>
                </article>
              ))}
              <p className="output-target-guidance">This preview is a dry run. Create planned job rechecks the same digest and stores a new immutable snapshot.</p>
            </>
          )}
        </section>
        <footer>
          <button disabled={busy || !ready} onClick={() => void requestPlan(true)}>Resolve from persisted targets</button>
          <button className="primary-button" disabled={busy || !preview?.job.target_plan} onClick={() => void requestPlan(false)}>Create planned job</button>
        </footer>
      </section>
    </div>
  );
}

function SourceTargetEditorDisclosure({
  node,
  onSaved,
  project,
  rootAssetId,
  unresolved,
}: {
  node: LineageNode;
  onSaved: () => Promise<NodeNextOutputTargetsResponse[]>;
  project: string;
  rootAssetId: string;
  unresolved: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>{unresolved ? 'Set targets' : 'Inspect or change next targets'}</summary>
      {open && (
        <NodeNextOutputTargetsEditor
          embedded
          nodeAssetId={node.asset_id}
          nodeTitle={node.title}
          onSaved={() => { void onSaved(); }}
          project={project}
          rootAssetId={rootAssetId}
        />
      )}
    </details>
  );
}
