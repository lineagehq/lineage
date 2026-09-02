import { useEffect, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import type { AssetReviewState, LineageNode, LineageSnapshot } from '../../shared/types';
import type { GenerationCancelResponse, GenerationJobListResponse } from '../../shared/generationTypes';
import { storageStateFor } from '../assetUi';
import { api } from '../api';
import { LineageNodeActionFooter } from './LineageNodeActionFooter';
import './LineageDetailModal.css';

const receiptOrder = { plan: 0, import: 1, error: 2 };

export function LineageDetailModal({
  node,
  canRemoveFromLineage,
  onClearAllNext,
  onClearNext,
  onClose,
  onEditOutputTargets,
  onEditNode,
  onOpenNode,
  onRemoveFromLineage,
  onReplaceNext,
  onReview,
  onSelectNext,
  onToast,
  selectedCount,
  selectionFull,
  snapshot,
}: {
  node: LineageNode;
  canRemoveFromLineage: boolean;
  onClearAllNext: () => void;
  onClearNext: () => void;
  onClose: () => void;
  onEditOutputTargets?: () => void;
  onEditNode?: (node: LineageNode) => void;
  onOpenNode: (assetId: string) => void;
  onRemoveFromLineage: (node: LineageNode) => void;
  onReplaceNext: (node: LineageNode) => void;
  onReview: (reviewState: AssetReviewState, assetId: string) => void;
  onSelectNext: (node: LineageNode) => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  selectedCount: number;
  selectionFull: boolean;
  snapshot: LineageSnapshot;
}) {
  const parents = snapshot.edges.filter(edge => edge.child_asset_id === node.asset_id)
    .map(edge => snapshot.nodes.find(item => item.asset_id === edge.parent_asset_id)).filter((item): item is LineageNode => Boolean(item));
  const children = snapshot.edges.filter(edge => edge.parent_asset_id === node.asset_id)
    .map(edge => snapshot.nodes.find(item => item.asset_id === edge.child_asset_id)).filter((item): item is LineageNode => Boolean(item));
  const storage = storageStateFor({ hasLocal: Boolean(node.local_path), hasS3: Boolean(node.s3_key) });
  const [proof, setProof] = useState<GenerationJobListResponse | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [imageExpanded, setImageExpanded] = useState(false);
  const [rerollPrompt, setRerollPrompt] = useState('');
  const [rerollBusy, setRerollBusy] = useState(false);
  const [cancelBusyId, setCancelBusyId] = useState('');
  const hasExpandablePreview = Boolean(node.preview_url && (node.media_type === 'image' || node.media_type === 'gif'));

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      assetId: node.asset_id,
      limit: '6',
      project: snapshot.project,
      rootAssetId: snapshot.root_asset_id,
    });
    setProof(null);
    setProofError(null);
    setProofLoading(true);
    api<GenerationJobListResponse>(`/api/generation/jobs?${params.toString()}`)
      .then(result => {
        if (!cancelled) setProof(result);
      })
      .catch(error => {
        if (!cancelled) setProofError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setProofLoading(false);
      });
    return () => { cancelled = true; };
  }, [node.asset_id, snapshot.project, snapshot.root_asset_id]);

  useEffect(() => {
    if (!imageExpanded) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImageExpanded(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [imageExpanded]);

  function openNode(assetId: string) {
    onOpenNode(assetId);
  }

  const targetJob = proof?.jobs.find(job => job.target_plan && (
    job.inputs.some(input => input.asset_id === node.asset_id)
    || job.outputs.some(output => output.imported_asset_id === node.asset_id)
  ));
  const targetOutput = targetJob?.outputs.find(output => output.imported_asset_id === node.asset_id);
  const targetSlot = targetOutput && targetJob?.target_plan?.slots.find(slot => slot.output_index === targetOutput.output_index);
  const inheritedGroup = targetJob?.target_plan?.groups.find(group =>
    targetSlot ? group.id === targetSlot.group_id : group.parent_asset_id === node.asset_id,
  );

  async function planReroll() {
    if (!rerollPrompt.trim() || !node.reroll_request || !inheritedGroup) return;
    setRerollBusy(true);
    try {
      const result = await api<{ job: { id: string; source_mode: string } }>('/api/generation/targets/reroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: snapshot.project,
          rootAssetId: snapshot.root_asset_id,
          targetAssetId: node.asset_id,
          prompt: rerollPrompt,
          confirmWrite: true,
        }),
      });
      onToast('ok', `Planned locked re-roll ${result.job.id}`);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setRerollBusy(false);
    }
  }

  return (
    <div className="lineage-detail-backdrop" onClick={onClose}>
      <section aria-labelledby="lineage-detail-title" aria-modal="true" className="lineage-detail-modal" onClick={event => event.stopPropagation()} role="dialog">
        <header>
          <div>
            <h3 id="lineage-detail-title">{node.title}</h3>
            <code>{node.asset_id}</code>
          </div>
          <button onClick={onClose} title="Close detail">Close</button>
        </header>
        <div className="lineage-detail-body">
          <div className="lineage-detail-preview-shell">
            <div className="lineage-detail-preview">
              {hasExpandablePreview ? (
                <img src={node.preview_url} alt={node.title} />
              ) : node.preview_url && node.media_type === 'video' ? (
                <video src={node.preview_url} controls />
              ) : (
                <div className="lineage-preview-empty">
                  <strong>{node.media_type}</strong>
                  <span>{node.s3_key ? 'Preview available from Assets when signed.' : storage.description}</span>
                </div>
              )}
              {hasExpandablePreview && (
                <button aria-label="Expand image" className="lineage-detail-expand-preview" onClick={() => setImageExpanded(true)} title="Expand image" type="button">
                  <Maximize2 aria-hidden="true" size={17} strokeWidth={2.4} />
                </button>
              )}
            </div>
          </div>
          <aside className="lineage-detail-sidebar" aria-label="Node details">
            <details className="lineage-detail-disclosure">
              <summary>
                <span>Asset details</span>
                <small>{storage.label} · {node.review_state}</small>
              </summary>
              <dl>
                <div><dt>Storage</dt><dd><span className={`storage-chip ${storage.kind}`}>{storage.label}</span></dd></div>
                <div><dt>Source</dt><dd>{node.source}</dd></div>
                <div><dt>Channel</dt><dd>{node.channel || 'none'}</dd></div>
                <div><dt>Campaign</dt><dd>{node.campaign || 'none'}</dd></div>
                <div><dt>Status</dt><dd>{node.status}</dd></div>
                <div><dt>Review</dt><dd>{node.review_state}</dd></div>
                <div><dt>Latest</dt><dd>{node.is_latest ? 'yes' : 'no'}</dd></div>
                <div><dt>Next variation</dt><dd>{node.user_selected ? 'yes' : 'no'}</dd></div>
                {(node.absolute_path || node.local_path) && <div><dt>Local path</dt><dd>{node.absolute_path || node.local_path}</dd></div>}
                {node.s3_key && <div><dt>S3 key</dt><dd>{node.s3_key}</dd></div>}
                {node.selection_note && <div><dt>Rationale</dt><dd>{node.selection_note}</dd></div>}
                {node.review_notes && <div><dt>Notes</dt><dd>{node.review_notes}</dd></div>}
              </dl>
              {onEditOutputTargets && (
                <button className="lineage-next-output-action" onClick={onEditOutputTargets} type="button">
                  Inspect or edit next output targets
                </button>
              )}
            </details>
            <details className="lineage-detail-disclosure">
              <summary>
                <span>Lineage context</span>
                <small>{parents.length || 'No'} parent · {children.length || 'No'} children</small>
              </summary>
              <section className="lineage-detail-context">
                <p>{parents.length || 'No'} parent · {children.length || 'No'} children · {node.is_latest ? 'latest leaf' : 'branch point'}</p>
                {node.user_selected && !node.is_latest && (
                  <div className="lineage-detail-warning" role="status">
                    This asset is selected for next variation but is not a latest leaf. Keep it for an intentional branch, or replace it with a newer leaf before continuing.
                  </div>
                )}
                <div className="lineage-relation-list">
                  {parents.map(parent => (
                    <button aria-label={`Open parent ${parent.title}`} className="lineage-relation-button" key={parent.asset_id} onClick={() => openNode(parent.asset_id)}>
                      <span>View parent</span>
                      <strong>{parent.title}</strong>
                    </button>
                  ))}
                  {children.map(child => (
                    <button aria-label={`Open child ${child.title}`} className="lineage-relation-button" key={child.asset_id} onClick={() => openNode(child.asset_id)}>
                      <span>View child</span>
                      <strong>{child.title}</strong>
                    </button>
                  ))}
                </div>
              </section>
            </details>
            <details className="lineage-detail-proof" data-testid="lineage-generation-proof">
              <summary>
                <span>Generation proof</span>
                <small>{proof?.jobs.length ? `${proof.jobs.length} receipt group${proof.jobs.length === 1 ? '' : 's'}` : 'Collapsed'}</small>
              </summary>
              <div className="lineage-detail-proof-content">
                {proofLoading && <p>Loading receipt proof...</p>}
                {proofError && <p className="lineage-proof-error">{proofError}</p>}
                {!proofLoading && !proofError && proof && proof.jobs.length === 0 && <p>No generation receipts for this node yet.</p>}
                {!proofLoading && !proofError && proof?.jobs.map(job => (
                  <article className="lineage-proof-job" key={job.id}>
                    <div className="lineage-proof-job-head">
                      <strong>{job.id}</strong>
                      <span>{job.status}</span>
                    </div>
                    <p>{job.prompt}</p>
                    <dl>
                      <div><dt>Receipts</dt><dd>{[...job.receipts].sort((a, b) => receiptOrder[a.receipt_type] - receiptOrder[b.receipt_type]).map(receipt => `${receipt.receipt_type}: ${receipt.status}`).join(' · ') || 'none'}</dd></div>
                      <div><dt>Parents</dt><dd>{job.inputs.map(input => input.asset_id).join(', ')}</dd></div>
                      <div><dt>Outputs</dt><dd>{job.outputs.length || 'none yet'}</dd></div>
                      <div><dt>Import state</dt><dd>{job.status === 'imported' ? 'imported and verified' : job.status}</dd></div>
                    </dl>
                    {job.source_target_resolutions && job.source_target_resolutions.length > 0 && (
                      <div className="lineage-proof-source-resolutions">
                        <strong>Frozen source target resolution</strong>
                        {job.source_target_resolutions.map(source => (
                          <dl key={source.parent_asset_id}>
                            <div><dt>Source</dt><dd>{source.parent_asset_id}</dd></div>
                            <div><dt>Origin</dt><dd>{source.origin}</dd></div>
                            <div><dt>Revision</dt><dd>{source.setting_revision ?? 'dynamic default'}</dd></div>
                            <div><dt>Resolution digest</dt><dd><code>{source.resolution_digest_sha256}</code></dd></div>
                          </dl>
                        ))}
                      </div>
                    )}
                    {job.target_plan && (
                      <div className="lineage-proof-targets">
                        {job.target_plan.groups.map(group => {
                          const isCurrentProducedGeometry = job.outputs.some(output => {
                            if (output.imported_asset_id !== node.asset_id) return false;
                            return job.target_plan?.slots.some(slot => slot.output_index === output.output_index && slot.group_id === group.id);
                          });
                          return (
                          <div className={group.unlocked ? 'unlocked' : 'locked'} key={group.id}>
                            <strong>{isCurrentProducedGeometry ? 'Current produced geometry · ' : 'Planned output geometry · '}{group.unlocked ? 'Explicitly unlocked' : `Locked ${group.width} × ${group.height} px`}</strong>
                            <span>source {group.parent_asset_id} · {group.variant_count} output{group.variant_count === 1 ? '' : 's'} · {group.grouping_mode}</span>
                            <small>{group.delivery_surfaces.map(surface => `${surface.platform} ${surface.surface}`).join(', ') || 'No destination'}</small>
                            {group.guidance.length > 0 && <small>Guidance only: {group.guidance.join(' · ')}</small>}
                          </div>
                          );
                        })}
                      </div>
                    )}
                    {job.outputs.length > 0 && (
                      <div className="lineage-proof-output-list">
                        {job.outputs.map(output => (
                          <div className="lineage-proof-output" key={output.id}>
                            <span>Output {output.output_index}</span>
                            <strong>{output.imported_asset_id}</strong>
                            <code>{output.file_path}</code>
                            <small>parent {output.parent_asset_id}</small>
                          </div>
                        ))}
                      </div>
                    )}
                    {job.status === 'planned' && (
                      <button
                        className="lineage-cancel-generation"
                        disabled={cancelBusyId === job.id}
                        onClick={() => void cancelPlannedJob(job.id)}
                        type="button"
                      >
                        Cancel planned job
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </details>
            {node.reroll_request?.status === 'pending' && inheritedGroup && !inheritedGroup.unlocked && (
              <details className="lineage-detail-proof" open>
                <summary><span>Plan locked re-roll</span><small>Dimensions inherit</small></summary>
                <div className="lineage-detail-proof-content lineage-reroll-target">
                  <label>Inherited dimensions<input aria-label="Inherited reroll dimensions" readOnly value={`${inheritedGroup.width} × ${inheritedGroup.height} px`} /></label>
                  <label>Prompt<textarea onChange={event => setRerollPrompt(event.target.value)} value={rerollPrompt} /></label>
                  <p>A re-roll must keep this asset’s immutable dimensions. For a different geometry, set this node’s durable next-output targets and use Plan outputs to create a child variation.</p>
                  {onEditOutputTargets && <button onClick={onEditOutputTargets} type="button">Edit next targets for child variation</button>}
                  <button disabled={rerollBusy || !rerollPrompt.trim()} onClick={() => void planReroll()} type="button">Plan same-geometry re-roll</button>
                </div>
              </details>
            )}
          </aside>
        </div>
        {imageExpanded && hasExpandablePreview && (
          <div aria-modal="true" className="lineage-image-lightbox" onClick={() => setImageExpanded(false)} role="dialog">
            <div className="lineage-image-lightbox-content" onClick={event => event.stopPropagation()}>
              <button onClick={() => setImageExpanded(false)} type="button">Close image</button>
              <img src={node.preview_url} alt={node.title} />
            </div>
          </div>
        )}
        <LineageNodeActionFooter
          canRemoveFromLineage={canRemoveFromLineage}
          node={node}
          onClearAllNext={onClearAllNext}
          onClearNext={onClearNext}
          onEdit={onEditNode}
          onOpenNode={openNode}
          onRemoveFromLineage={onRemoveFromLineage}
          onReplaceNext={onReplaceNext}
          onReview={onReview}
          onSelectNext={onSelectNext}
          onToast={onToast}
          selectedCount={selectedCount}
          selectionFull={selectionFull}
          snapshot={snapshot}
        />
      </section>
    </div>
  );

  async function cancelPlannedJob(jobId: string) {
    setCancelBusyId(jobId);
    try {
      const result = await api<GenerationCancelResponse>('/api/generation/targets/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: snapshot.project,
          jobId,
          confirmWrite: true,
        }),
      });
      setProof(current => current ? {
        ...current,
        jobs: current.jobs.map(job => job.id === result.job.id ? result.job : job),
      } : current);
      onToast('ok', `Cancelled planned job ${jobId}`);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setCancelBusyId('');
    }
  }
}
