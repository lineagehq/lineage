import { useEffect, useMemo, useRef, useState } from 'react';
import type { LineageNode } from '../../shared/types';
import type {
  SocialBufferChannel,
  SocialBufferConnection,
  SocialCompositionMode,
  SocialAgentHandoff,
  SocialDeliveryPreview,
  SocialEditorialState,
  SocialHashtagPlacement,
  SocialPublishMethod,
  SocialProviderPostInsights,
  SocialValidationResponse,
  SocialVariant,
  SocialWorkItem,
  SocialWorkItemResponse,
} from '../../shared/socialTypes';
import { api, ApiError } from '../api';

type Draft = {
  altText: string;
  altTextReviewed: boolean;
  compositionMode: SocialCompositionMode;
  copy: string;
  customScheduledAt: string;
  editorialState: Exclude<SocialEditorialState, 'archived'>;
  hashtagPlacement: SocialHashtagPlacement;
  hashtags: string;
  publishMethod: SocialPublishMethod;
  reviewer: string;
};

type ConnectionResponse = { ok: true; connection: SocialBufferConnection | null };
type ChannelsResponse = { ok: true; channels: SocialBufferChannel[] };

function draftFrom(variant: SocialVariant): Draft {
  const revision = variant.revision;
  return {
    altText: revision.alt_text || '', altTextReviewed: revision.alt_text_reviewed,
    compositionMode: revision.composition_mode || 'addToQueue', copy: revision.copy,
    customScheduledAt: revision.custom_scheduled_at || '', editorialState: variant.editorial_state === 'archived' ? 'draft' : variant.editorial_state,
    hashtagPlacement: revision.hashtag_placement, hashtags: revision.hashtags.map(tag => tag.value).join('\n'),
    publishMethod: revision.publish_method, reviewer: revision.alt_text_reviewed_by || '',
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return `Conflict: ${error.message}. Refresh before trying again.`;
  return error instanceof Error ? error.message : String(error);
}

export function LineageSocialPanel({ isTransitionLocked, node, onClose, onDirtyChange, onMark, project, rootAssetId, transitionLocked = false }: {
  isTransitionLocked?: () => boolean;
  node: LineageNode;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onMark: () => Promise<void>;
  project: string;
  rootAssetId: string;
  transitionLocked?: boolean;
}) {
  const [connection, setConnection] = useState<SocialBufferConnection | null>(null);
  const [channels, setChannels] = useState<SocialBufferChannel[]>([]);
  const [item, setItem] = useState<SocialWorkItem | null>(null);
  const [campaignKey, setCampaignKey] = useState('default');
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [validation, setValidation] = useState<SocialValidationResponse | null>(null);
  const [conflictRevision, setConflictRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogReady, setCatalogReady] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const [error, setError] = useState('');
  const [interactionLockGeneration, setInteractionLockGeneration] = useState(0);
  const [deliveryPreview, setDeliveryPreview] = useState<{ identity: string; value: SocialDeliveryPreview } | null>(null);
  const [deliveryNotice, setDeliveryNotice] = useState('');
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [agentHandoff, setAgentHandoff] = useState<SocialAgentHandoff | null>(null);
  const [providerPostId, setProviderPostId] = useState('');
  const [providerInsights, setProviderInsights] = useState<SocialProviderPostInsights | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const itemRef = useRef<SocialWorkItem | null>(null);
  const selectedVariantIdRef = useRef<string | null>(null);
  const campaignKeyRef = useRef(campaignKey);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const transitionLockedRef = useRef(false);
  const requestGeneration = useRef({ catalog: 0, delivery: 0, item: 0, provider: 0, save: 0, validation: 0 });
  const deliveryInFlight = useRef(false);
  const identityGeneration = useRef(0);
  const saving = busyCount > 0;
  const beginBusy = () => setBusyCount(current => current + 1);
  const endBusy = () => setBusyCount(current => Math.max(0, current - 1));

  const activeVariants = useMemo(() => item?.variants.filter(variant => variant.active) || [], [item]);
  const selectedVariant = activeVariants.find(variant => variant.id === selectedVariantId) || null;
  const dirty = Boolean(draft && JSON.stringify(draft) !== baseline);
  const deliveryIdentity = JSON.stringify({
    project, rootAssetId, source: node.asset_id, checksum: node.checksum_sha256 || null,
    variant: selectedVariant?.id || null, revision: selectedVariant?.current_revision || null,
    revisionHash: selectedVariant?.revision.revision_hash || null, draft, baseline, catalogReady, connection, channels,
  });
  const previewCurrent = Boolean(deliveryPreview && deliveryPreview.identity === deliveryIdentity);
  const providerIdentity = `${project}:${selectedVariant?.id || ''}:${selectedVariant?.current_revision || ''}`;
  const providerIdentityRef = useRef(providerIdentity);
  providerIdentityRef.current = providerIdentity;
  draftRef.current = draft;
  itemRef.current = item;
  selectedVariantIdRef.current = selectedVariantId;
  campaignKeyRef.current = campaignKey;
  if (transitionLocked && !transitionLockedRef.current) {
    requestGeneration.current.catalog += 1;
    requestGeneration.current.item += 1;
    requestGeneration.current.save += 1;
    requestGeneration.current.delivery += 1;
    requestGeneration.current.provider += 1;
    requestGeneration.current.validation += 1;
  }
  transitionLockedRef.current = transitionLocked;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (transitionLocked) panel.setAttribute('inert', '');
    else panel.removeAttribute('inert');
  }, [transitionLocked]);
  useEffect(() => { if (transitionLocked) setLoading(false); }, [transitionLocked]);
  useEffect(() => {
    if (!transitionLocked && !isTransitionLocked?.()) setInteractionLockGeneration(0);
  }, [isTransitionLocked, transitionLocked]);

  function acceptEventTimeOwnership() {
    if (transitionLocked || isTransitionLocked?.()) {
      setInteractionLockGeneration(current => current + 1);
      return false;
    }
    setInteractionLockGeneration(0);
    return true;
  }

  async function loadCatalog(protectDraft = false, eventInitiated = false) {
    if (eventInitiated && !acceptEventTimeOwnership()) return;
    if (protectDraft && dirty && !window.confirm('Refresh channel evidence while preserving this unsaved draft?')) return;
    const generation = ++requestGeneration.current.catalog;
    identityGeneration.current += 1;
    requestGeneration.current.validation += 1;
    setValidation(null);
    setCatalogReady(false);
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ project }).toString();
      const [connectionResponse, channelsResponse] = await Promise.all([
        api<ConnectionResponse>(`/api/adapters/buffer/connection?${query}`),
        api<ChannelsResponse>(`/api/adapters/buffer/channels?${query}`),
      ]);
      if (generation !== requestGeneration.current.catalog) return;
      setConnection(connectionResponse.connection);
      setChannels(channelsResponse.channels);
      setCatalogReady(true);
    } catch (nextError) { if (generation === requestGeneration.current.catalog) setError(errorMessage(nextError)); }
    finally { if (generation === requestGeneration.current.catalog) setLoading(false); }
  }
  useEffect(() => { void loadCatalog(); }, [project]);
  function selectVariant(variant: SocialVariant) {
    if (!acceptEventTimeOwnership()) return;
    if (dirty && !window.confirm('Discard unsaved Social changes?')) return;
    requestGeneration.current.validation += 1;
    requestGeneration.current.delivery += 1;
    requestGeneration.current.provider += 1;
    identityGeneration.current += 1;
    const next = draftFrom(variant);
    deliveryInFlight.current = false;
    setDeliveryBusy(false); setDeliveryPreview(null); setAgentHandoff(null); setDeliveryNotice('');
    setProviderPostId(''); setProviderInsights(null);
    setSelectedVariantId(variant.id); setDraft(next); setBaseline(JSON.stringify(next)); setError(''); setConflictRevision(null); setValidation(null);
  }

  function acceptItem(next: SocialWorkItem) {
    requestGeneration.current.validation += 1;
    identityGeneration.current += 1;
    setItem(next);
    setValidation(null); setConflictRevision(null);
    const variant = next.variants.find(candidate => candidate.id === selectedVariantId && candidate.active)
      || next.variants.find(candidate => candidate.active) || null;
    const nextProviderIdentity = `${project}:${variant?.id || ''}:${variant?.current_revision || ''}`;
    if (nextProviderIdentity !== providerIdentityRef.current) {
      requestGeneration.current.delivery += 1;
      requestGeneration.current.provider += 1;
      deliveryInFlight.current = false;
      setDeliveryBusy(false); setDeliveryPreview(null); setAgentHandoff(null); setDeliveryNotice('');
      setProviderPostId(''); setProviderInsights(null);
    }
    if (variant) {
      const nextDraft = draftFrom(variant);
      setSelectedVariantId(variant.id); setDraft(nextDraft); setBaseline(JSON.stringify(nextDraft));
    } else { setSelectedVariantId(null); setDraft(null); setBaseline(''); }
  }

  function acceptItemPreservingNewerDraft(next: SocialWorkItem, submittedDraft: Draft | null, submittedVariantId: string | null, submittedIdentity: number) {
    const draftChangedDuringRequest = JSON.stringify(draftRef.current) !== JSON.stringify(submittedDraft)
      || selectedVariantIdRef.current !== submittedVariantId || identityGeneration.current !== submittedIdentity;
    if (!draftChangedDuringRequest) {
      acceptItem(next);
      return;
    }
    requestGeneration.current.validation += 1;
    identityGeneration.current += 1;
    setItem(next);
    setValidation(null);
    setConflictRevision(null);
  }

  async function promote() {
    if (!acceptEventTimeOwnership()) return;
    const generation = ++requestGeneration.current.item;
    const submittedIdentity = identityGeneration.current;
    const submittedCampaignKey = campaignKey;
    beginBusy(); setError('');
    try {
      const response = await api<SocialWorkItemResponse>('/api/social/items', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project, rootAssetId, sourceAssetId: node.asset_id, campaignKey, actor: 'human:canvas', confirmWrite: true }),
      });
      if (generation !== requestGeneration.current.item || submittedIdentity !== identityGeneration.current || campaignKeyRef.current !== submittedCampaignKey) return;
      acceptItem(response.item);
    } catch (nextError) { if (generation === requestGeneration.current.item) setError(errorMessage(nextError)); }
    finally { endBusy(); }
  }

  function editCampaignKey(value: string) {
    if (!acceptEventTimeOwnership()) return;
    requestGeneration.current.item += 1;
    setCampaignKey(value);
    setError('');
  }

  async function addVariant(channelId: string) {
    if (!acceptEventTimeOwnership()) return;
    if (!item) return;
    if (dirty && !window.confirm('Discard unsaved Social changes and add this channel variant?')) return;
    const generation = ++requestGeneration.current.item;
    const submittedDraft = draft ? { ...draft } : null;
    const submittedVariantId = selectedVariantId;
    const submittedIdentity = identityGeneration.current;
    beginBusy(); setError('');
    try {
      const response = await api<SocialWorkItemResponse>(`/api/social/items/${item.id}/variants`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project, channelId, actor: 'human:canvas', confirmWrite: true }),
      });
      if (generation !== requestGeneration.current.item) return;
      acceptItemPreservingNewerDraft(response.item, submittedDraft, submittedVariantId, submittedIdentity);
    } catch (nextError) { if (generation === requestGeneration.current.item) setError(errorMessage(nextError)); }
    finally { endBusy(); }
  }

  async function save(deliberateConflictRetry = false) {
    if (!acceptEventTimeOwnership()) return;
    if (!selectedVariant || !draft) return;
    if (conflictRevision !== null && !deliberateConflictRetry) return;
    const generation = ++requestGeneration.current.save;
    const submittedDraft = { ...draft };
    const submittedVariantId = selectedVariant.id;
    const submittedIdentity = identityGeneration.current;
    beginBusy(); setError('');
    try {
      const hashtags = draft.hashtags.split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
      const response = await api<SocialWorkItemResponse>(`/api/social/variants/${selectedVariant.id}/edit`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project, actor: 'human:canvas', confirmWrite: true, expectedRevision: selectedVariant.current_revision,
          copy: draft.copy, hashtags, hashtagPlacement: draft.hashtagPlacement,
          altText: draft.altText, altTextReviewed: draft.altTextReviewed,
          ...(draft.altTextReviewed ? { altTextReviewedBy: draft.reviewer } : {}),
          editorialState: draft.editorialState, publishMethod: draft.publishMethod,
          compositionMode: draft.compositionMode,
          customScheduledAt: draft.compositionMode === 'customScheduled' ? draft.customScheduledAt : '',
        }),
      });
      if (generation !== requestGeneration.current.save || selectedVariantIdRef.current !== submittedVariantId) return;
      acceptItemPreservingNewerDraft(response.item, submittedDraft, submittedVariantId, submittedIdentity);
    } catch (nextError) {
      if (generation !== requestGeneration.current.save || selectedVariantIdRef.current !== submittedVariantId) return;
      if (nextError instanceof ApiError && nextError.status === 409 && item) {
        try {
          const query = new URLSearchParams({ project }).toString();
          const latest = (await api<SocialWorkItemResponse>(`/api/social/items/${item.id}?${query}`)).item;
          const latestVariant = latest.variants.find(candidate => candidate.id === selectedVariant.id && candidate.active);
          if (generation !== requestGeneration.current.save || selectedVariantIdRef.current !== submittedVariantId) return;
          setItem(latest);
          requestGeneration.current.validation += 1;
          identityGeneration.current += 1;
          setValidation(null);
          if (latestVariant) {
            setConflictRevision(latestVariant.current_revision);
            setError(`Conflict: ${nextError.message}. Your local draft is preserved. Server revision r${latestVariant.current_revision} is now loaded for a deliberate retry.`);
          } else setError(`Conflict: ${nextError.message}. Your local draft is preserved, but this variant is no longer active.`);
        } catch (reloadError) { if (generation === requestGeneration.current.save) setError(`${errorMessage(nextError)} Latest server revision could not be loaded: ${errorMessage(reloadError)}`); }
      } else setError(errorMessage(nextError));
    }
    finally { endBusy(); }
  }

  async function runValidation() {
    if (!acceptEventTimeOwnership()) return;
    if (!item) return;
    const generation = ++requestGeneration.current.validation;
    const identity = `${item.id}:${selectedVariantId}:${JSON.stringify(draft)}`;
    beginBusy(); setError('');
    try {
      const response = await api<SocialValidationResponse>(`/api/social/items/${item.id}/preflight`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project }),
      });
      const currentIdentity = `${itemRef.current?.id || ''}:${selectedVariantIdRef.current}:${JSON.stringify(draftRef.current)}`;
      if (generation === requestGeneration.current.validation && identity === currentIdentity) setValidation(response);
    } catch (nextError) { if (generation === requestGeneration.current.validation) setError(errorMessage(nextError)); }
    finally { endBusy(); }
  }

  async function refreshItem() {
    if (!acceptEventTimeOwnership()) return;
    if (!item) return;
    if (dirty && !window.confirm('Discard unsaved changes and reload the latest Social revision?')) return;
    const generation = ++requestGeneration.current.item;
    const submittedDraft = draft ? { ...draft } : null;
    const submittedVariantId = selectedVariantId;
    const submittedIdentity = identityGeneration.current;
    beginBusy(); setError('');
    try {
      const query = new URLSearchParams({ project }).toString();
      const response = await api<SocialWorkItemResponse>(`/api/social/items/${item.id}?${query}`);
      if (generation !== requestGeneration.current.item) return;
      acceptItemPreservingNewerDraft(response.item, submittedDraft, submittedVariantId, submittedIdentity);
    } catch (nextError) { if (generation === requestGeneration.current.item) setError(errorMessage(nextError)); }
    finally { endBusy(); }
  }

  function deliveryError(error: unknown): string {
    const payload = error instanceof ApiError && error.payload && typeof error.payload === 'object' ? error.payload as Record<string, unknown> : {};
    const code = String(payload.code || payload.error || '');
    const message = error instanceof Error ? error.message : String(error);
    if (code.includes('preview_stale') || /preview changed/i.test(message)) return 'Preview stale. Nothing was sent; create a new preview.';
    if (/claim|ownership|matching token/i.test(`${code} ${message}`)) return 'Claim conflict. Nothing was sent; refresh ownership and preview again.';
    return message;
  }

  async function previewDelivery() {
    if (!acceptEventTimeOwnership() || !selectedVariant || dirty || selectedBlocked) return;
    const generation = ++requestGeneration.current.delivery;
    const identity = deliveryIdentity;
    setDeliveryBusy(true); setDeliveryNotice(''); setAgentHandoff(null);
    try {
      const value = await api<SocialDeliveryPreview>(`/api/social/variants/${selectedVariant.id}/delivery-preview`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project, expectedRevision: selectedVariant.current_revision }),
      });
      if (generation !== requestGeneration.current.delivery || identity !== deliveryIdentity) return;
      setDeliveryPreview({ identity, value });
      setDeliveryNotice('Immutable preview ready. Review the exact pins before preparing the agent brief.');
    } catch (nextError) {
      if (generation === requestGeneration.current.delivery) setDeliveryNotice(deliveryError(nextError));
    } finally { if (generation === requestGeneration.current.delivery) setDeliveryBusy(false); }
  }

  async function prepareAgentBrief() {
    if (!acceptEventTimeOwnership() || !selectedVariant || !deliveryPreview || !previewCurrent || deliveryInFlight.current) return;
    deliveryInFlight.current = true;
    const generation = ++requestGeneration.current.delivery;
    const identity = deliveryIdentity;
    setDeliveryBusy(true); setDeliveryNotice('Preparing an immutable agent brief…');
    try {
      const handoff = await api<SocialAgentHandoff>(`/api/social/variants/${selectedVariant.id}/agent-handoff`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project, expectedRevision: selectedVariant.current_revision, previewSha256: deliveryPreview.value.preview_sha256 }),
      });
      if (generation !== requestGeneration.current.delivery || identity !== deliveryIdentity) return;
      setAgentHandoff(handoff);
      setDeliveryNotice('Agent brief ready. Nothing was uploaded or scheduled. Copy it into a Codex browser session when you want the agent to operate Buffer.');
    } catch (nextError) {
      if (generation === requestGeneration.current.delivery) setDeliveryNotice(deliveryError(nextError));
    } finally {
      deliveryInFlight.current = false;
      if (generation === requestGeneration.current.delivery) setDeliveryBusy(false);
    }
  }

  async function copyAgentBrief() {
    if (!agentHandoff) return;
    try {
      await navigator.clipboard.writeText(agentHandoff.agent_brief_markdown);
      setDeliveryNotice('Agent brief copied. Nothing was uploaded or scheduled.');
    } catch {
      setDeliveryNotice('Clipboard access was unavailable. Select and copy the visible agent brief manually.');
    }
  }

  async function loadProviderInsights() {
    if (!selectedVariant || deliveryBusy || deliveryInFlight.current) return;
    deliveryInFlight.current = true;
    const generation = ++requestGeneration.current.provider;
    const identity = providerIdentity;
    setDeliveryBusy(true);
    try {
      const value = await api<{ ok: true; insights: SocialProviderPostInsights | null }>(`/api/social/variants/${selectedVariant.id}/provider-post?${new URLSearchParams({ project })}`);
      if (generation !== requestGeneration.current.provider || identity !== providerIdentityRef.current) return;
      setProviderInsights(value.insights);
      setDeliveryNotice(value.insights ? 'Loaded the latest locally recorded Buffer status and metric snapshot.' : 'No verified Buffer post is linked to this variant yet.');
    } catch (nextError) { if (generation === requestGeneration.current.provider && identity === providerIdentityRef.current) setDeliveryNotice(deliveryError(nextError)); }
    finally { if (generation === requestGeneration.current.provider) { deliveryInFlight.current = false; setDeliveryBusy(false); } }
  }

  async function linkProviderPost() {
    if (!selectedVariant || !deliveryPreview || !previewCurrent || deliveryBusy || deliveryInFlight.current || !providerPostId.trim()) return;
    deliveryInFlight.current = true;
    const generation = ++requestGeneration.current.provider;
    const identity = providerIdentity;
    setDeliveryBusy(true);
    try {
      const value = await api<SocialProviderPostInsights>(`/api/social/variants/${selectedVariant.id}/provider-post`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          project, expectedRevision: selectedVariant.current_revision, previewSha256: deliveryPreview.value.preview_sha256,
          providerPostId: providerPostId.trim(), confirmWrite: true,
        }),
      });
      if (generation !== requestGeneration.current.provider || identity !== providerIdentityRef.current) return;
      setProviderInsights(value); setDeliveryNotice('Verified and linked the exact Buffer post. No Buffer write occurred.');
    } catch (nextError) { if (generation === requestGeneration.current.provider && identity === providerIdentityRef.current) setDeliveryNotice(deliveryError(nextError)); }
    finally { if (generation === requestGeneration.current.provider) { deliveryInFlight.current = false; setDeliveryBusy(false); } }
  }

  async function syncProviderInsights() {
    if (!selectedVariant || !providerInsights || deliveryBusy || deliveryInFlight.current) return;
    deliveryInFlight.current = true;
    const generation = ++requestGeneration.current.provider;
    const identity = providerIdentity;
    setDeliveryBusy(true);
    try {
      const value = await api<SocialProviderPostInsights>(`/api/social/variants/${selectedVariant.id}/provider-post/sync`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, confirmWrite: true }),
      });
      if (generation !== requestGeneration.current.provider || identity !== providerIdentityRef.current) return;
      setProviderInsights(value); setDeliveryNotice('Read the latest Buffer status and metrics. No Buffer write occurred.');
    } catch (nextError) { if (generation === requestGeneration.current.provider && identity === providerIdentityRef.current) setDeliveryNotice(deliveryError(nextError)); }
    finally { if (generation === requestGeneration.current.provider) { deliveryInFlight.current = false; setDeliveryBusy(false); } }
  }

  function requestClose() {
    if (!acceptEventTimeOwnership()) return;
    onClose();
  }
  async function markForSocial() {
    if (!acceptEventTimeOwnership()) return;
    await onMark();
  }
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    if (!acceptEventTimeOwnership()) return;
    requestGeneration.current.validation += 1;
    identityGeneration.current += 1;
    setDraft(current => current ? { ...current, [key]: value } : current);
    setValidation(null);
  };
  const channelById = new Map(channels.map(channel => [channel.channel_id, channel]));
  const selectedChannel = selectedVariant ? channelById.get(selectedVariant.channel_id) : undefined;
  const usedChannels = new Set(activeVariants.map(variant => variant.channel_id));
  const selectedBlockReasons = selectedVariant ? [
    !connection ? 'Buffer is disconnected.' : '',
    !catalogReady ? 'Channel evidence is loading or unavailable.' : '',
    connection && connection.health_state !== 'connected' ? connection.health_state === 'credential_missing' ? 'The configured credential is unavailable.' : 'The organization does not match the verified connection.' : '',
    connection && !connection.channel_synced_at ? 'Channel catalog has not been synchronized.' : '',
    !selectedChannel ? 'This active variant channel is missing from the synchronized catalog.' : '',
    selectedChannel?.stale_at ? 'Channel evidence is stale; sync channels in Settings.' : '',
    selectedChannel?.disconnected ? 'Channel is disconnected.' : '', selectedChannel?.locked ? 'Channel is locked.' : '',
    selectedChannel?.paused ? 'Channel queue is paused.' : '', selectedChannel && !selectedChannel.available ? 'Channel is unavailable.' : '',
    selectedChannel && !selectedChannel.capability.supported ? selectedChannel.capability.reason || 'Channel service is unsupported.' : '',
    selectedChannel && !selectedChannel.capability.image_post ? 'Image composition capability is unavailable.' : '',
    selectedChannel && draft?.publishMethod === 'automatic' && !selectedChannel.capability.automatic ? 'Automatic intent is unsupported for this channel.' : '',
    selectedChannel && draft?.publishMethod === 'notification' && !selectedChannel.capability.notification ? 'Notification intent is unsupported for this channel.' : '',
    selectedChannel && draft && !selectedChannel.capability.scheduling_modes.includes(draft.compositionMode) ? `${draft.compositionMode} timing intent is unsupported for this channel.` : '',
  ].filter(Boolean) : [];
  const selectedBlocked = selectedBlockReasons.length > 0;
  const selectedReasonId = 'social-selected-variant-reasons';

  return (
    <aside aria-busy={transitionLocked || undefined} aria-disabled={transitionLocked || undefined} aria-label="Social composition" className="lineage-side lineage-social-panel" id="lineage-canvas-panel">
      {(transitionLocked || interactionLockGeneration > 0) && <p aria-live="assertive" role="status">Social composition is locked while the approved transition completes. Try the action again after it finishes.</p>}
      <div ref={panelRef}>
      <div className="lineage-side-head">
        <div><h3>Social composition</h3><p className="muted-copy">Prepare channel variants and agent briefs. Nothing here schedules or sends a post. Lineage never uploads media to Buffer.</p></div>
        <button autoFocus aria-label="Close Social composition" className="icon-button" onClick={requestClose} type="button">×</button>
      </div>
      <dl className="lineage-social-source">
        <div><dt>Source</dt><dd>{node.title} <code>{node.asset_id}</code></dd></div>
        <div><dt>Checksum</dt><dd><code>{node.checksum_sha256 || 'Not available'}</code></dd></div>
      </dl>
      {loading && <p aria-live="polite" role="status">Loading Social connection and channels…</p>}
      {error && <div className="lineage-social-alert error" role="alert"><strong>Social action needs attention</strong><p>{error}</p><div className="lineage-social-alert-actions">{item && <button disabled={saving} onClick={() => void refreshItem()} type="button">Reload work item</button>}<button onClick={() => void loadCatalog(true, true)} type="button">Refresh catalog</button></div></div>}
      {!loading && !connection && <div className="lineage-social-alert" role="status"><strong>Buffer is disconnected</strong><p>Connect this project in Settings before selecting channels.</p></div>}
      {!loading && connection && connection.health_state !== 'connected' && <div className="lineage-social-alert" role="status"><strong>Buffer connection needs attention</strong><p>{connection.health_state === 'credential_missing' ? 'The configured credential is unavailable.' : 'The organization does not match the verified connection.'}</p></div>}
      {!loading && connection && <p className="muted-copy">Organization {connection.organization_id} · {connection.channel_synced_at ? `Channels synced ${new Date(connection.channel_synced_at).toLocaleString()}` : 'Channels have not been synced'}</p>}
      <button disabled={loading} onClick={() => void loadCatalog(true, true)} type="button">Refresh channel evidence</button>
      {!node.social_mark?.active ? (
        <div className="lineage-social-step"><h4>1. Mark this source</h4><p>Marking keeps the source on this canvas and makes it eligible for a work item.</p><button disabled={saving} onClick={() => void markForSocial()} type="button">Mark for Social</button></div>
      ) : !item ? (
        <div className="lineage-social-step"><h4>1. Open a work item</h4><label>Campaign key<input maxLength={120} onChange={event => editCampaignKey(event.target.value)} value={campaignKey} /></label><button disabled={saving || !campaignKey.trim()} onClick={() => void promote()} type="button">Create or open work item</button></div>
      ) : (
        <>
          <div className="lineage-social-item"><strong>Campaign {item.campaign_key}</strong><span>Work item {item.id}</span></div>
          <section aria-labelledby="social-channels-heading"><h4 id="social-channels-heading">Channel variants</h4>
            {channels.length === 0 && <p role="status">No locally synchronized channels are available.</p>}
            <div className="lineage-social-channel-list">
              {channels.map(channel => {
                const reasons = [
                  !catalogReady ? 'Channel evidence is loading or unavailable.' : '',
                  connection?.health_state !== 'connected' ? 'Connection is not healthy.' : '',
                  !connection?.channel_synced_at ? 'Channel catalog has not been synchronized.' : '',
                  channel.stale_at ? 'Stale channel; sync in Settings.' : '', channel.disconnected ? 'Disconnected.' : '',
                  channel.locked ? 'Locked.' : '', channel.paused ? 'Queue is paused.' : '', !channel.available ? 'Unavailable.' : '',
                  !channel.capability.supported ? channel.capability.reason || 'Service is unsupported.' : '',
                  !channel.capability.image_post ? 'Image composition capability is unavailable.' : '',
                ].filter(Boolean);
                const blocked = reasons.length > 0;
                const reasonId = `social-channel-reason-${channel.channel_id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
                return <div className={`lineage-social-channel ${usedChannels.has(channel.channel_id) ? 'selected active' : ''}`} key={channel.channel_id}><span><strong>{channel.display_name}</strong><small id={reasonId}>{channel.service}{reasons.length ? ` · ${reasons.join(' ')}` : ' · Available for image composition.'}{usedChannels.has(channel.channel_id) ? ' Selected and active.' : ''}</small></span><button aria-describedby={reasonId} disabled={saving || blocked || usedChannels.has(channel.channel_id)} onClick={() => void addVariant(channel.channel_id)} type="button">{usedChannels.has(channel.channel_id) ? 'Selected' : 'Add variant'}</button></div>;
              })}
            </div>
          </section>
          {activeVariants.length > 0 && <div className="lineage-social-variant-tabs" role="group" aria-label="Choose a Social variant">{activeVariants.map(variant => <button aria-current={variant.id === selectedVariantId ? 'true' : undefined} key={variant.id} onClick={() => selectVariant(variant)} type="button">{channelById.get(variant.channel_id)?.display_name || `${variant.channel_id} (missing from synchronized catalog)`} · r{variant.current_revision}</button>)}</div>}
          {selectedVariant && draft && <form className="lineage-social-form" onSubmit={event => { event.preventDefault(); void save(); }}>
            <h4>Edit {channelById.get(selectedVariant.channel_id)?.display_name || selectedVariant.channel_id}</h4>
            {selectedBlocked && <div className="lineage-social-alert" id={selectedReasonId} role="status"><strong>This variant is inspectable but not actionable.</strong><ul>{selectedBlockReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
            <fieldset aria-describedby={selectedBlocked ? selectedReasonId : undefined} disabled={selectedBlocked} className="lineage-social-fields"><legend className="sr-only">Composition fields</legend>
            <label>Caption<textarea onChange={event => set('copy', event.target.value)} rows={5} value={draft.copy} /></label>
            <label>Ordered hashtags<textarea aria-describedby={`social-hashtag-help${selectedBlocked ? ` ${selectedReasonId}` : ''}`} onChange={event => set('hashtags', event.target.value)} rows={4} value={draft.hashtags} /></label><small id="social-hashtag-help">One per line, in the order they should appear.</small>
            <label>Hashtag placement<select onChange={event => set('hashtagPlacement', event.target.value as SocialHashtagPlacement)} value={draft.hashtagPlacement}><option value="caption">Caption</option><option value="first_comment">First comment</option></select></label>
            <label>Alt text<textarea onChange={event => { set('altText', event.target.value); set('altTextReviewed', false); set('reviewer', ''); }} rows={3} value={draft.altText} /></label>
            <label className="lineage-social-check"><input checked={draft.altTextReviewed} onChange={event => set('altTextReviewed', event.target.checked)} type="checkbox" /> Human-reviewed alt text</label>
            {draft.altTextReviewed && <label>Reviewer<input onChange={event => set('reviewer', event.target.value)} value={draft.reviewer} /></label>}
            <label>Editorial state<select onChange={event => set('editorialState', event.target.value as Draft['editorialState'])} value={draft.editorialState}><option value="draft">Draft</option><option value="needs_review">Needs review</option><option value="ready">Ready</option></select></label>
            <fieldset><legend>Publish method intent</legend><label className="lineage-social-check"><input checked={draft.publishMethod === 'automatic'} disabled={!selectedChannel?.capability.automatic} onChange={() => set('publishMethod', 'automatic')} type="radio" /> Automatic</label><label className="lineage-social-check"><input checked={draft.publishMethod === 'notification'} disabled={!selectedChannel?.capability.notification} onChange={() => set('publishMethod', 'notification')} type="radio" /> Notification</label>{selectedChannel && !selectedChannel.capability.notification && <small>Notification intent is not supported for this channel.</small>}</fieldset>
            <label>Composition timing intent<select onChange={event => set('compositionMode', event.target.value as SocialCompositionMode)} value={draft.compositionMode}><option disabled={!selectedChannel?.capability.scheduling_modes.includes('addToQueue')} value="addToQueue">Add to queue</option><option disabled={!selectedChannel?.capability.scheduling_modes.includes('customScheduled')} value="customScheduled">Custom time</option></select></label>
            {draft.compositionMode === 'addToQueue' ? <p className="muted-copy">Queue timing is only an editorial intent and may move.</p> : <label>Exact zoned time<input onChange={event => set('customScheduledAt', event.target.value)} placeholder="2026-08-15T09:30:00-07:00" value={draft.customScheduledAt} /></label>}
            </fieldset>
            {dirty && <p aria-live="polite" className="lineage-social-unsaved" role="status">Unsaved composition changes</p>}
            <button aria-describedby={selectedBlocked ? selectedReasonId : undefined} disabled={saving || !dirty || conflictRevision !== null || selectedBlocked} type="submit">Save composition revision</button>
            {conflictRevision !== null && <div className="lineage-social-conflict" role="status"><p>Local draft preserved. Latest server concurrency state: r{conflictRevision}.</p><button aria-describedby={selectedBlocked ? selectedReasonId : undefined} disabled={saving || selectedBlocked} onClick={() => void save(true)} type="button">Retry save against r{conflictRevision}</button></div>}
          </form>}
          <div className="lineage-social-validation"><button aria-describedby={selectedBlocked ? selectedReasonId : undefined} disabled={saving || dirty || selectedBlocked} onClick={() => void runValidation()} type="button">Validate composition</button>{validation && <div aria-live="polite" role="status"><strong>{validation.valid ? 'Composition is valid' : 'Composition needs attention'}</strong>{validation.issues.length > 0 && <ul>{validation.issues.map((issue, index) => <li key={`${issue.code}-${index}`}><code>{issue.field}</code>: {issue.message}</li>)}</ul>}<p>No scheduling or sending has occurred.</p></div>}</div>
          {selectedVariant && <section aria-label="Prepare Social agent handoff" className="lineage-social-delivery">
            <h4>Agent handoff</h4>
            <button disabled={saving || deliveryBusy || dirty || selectedBlocked || selectedVariant.editorial_state !== 'ready'} onClick={() => void previewDelivery()} type="button">Preview agent brief</button>
            {deliveryPreview && !previewCurrent && <p role="status">Preview invalidated by newer composition, selection, identity, connection, channel, capability, revision, or source evidence. Nothing was sent.</p>}
            {deliveryPreview && previewCurrent && <div className="lineage-social-preview">
              <dl>
                <div><dt>Revision</dt><dd>r{deliveryPreview.value.revision} · <code>{deliveryPreview.value.revision_sha256}</code></dd></div>
                <div><dt>Buffer channel</dt><dd><code>{deliveryPreview.value.channel_id}</code></dd></div>
                <div><dt>Method</dt><dd>{deliveryPreview.value.publish_method}</dd></div>
                <div><dt>Timing</dt><dd>{deliveryPreview.value.composition_mode}{deliveryPreview.value.custom_scheduled_at ? ` · ${deliveryPreview.value.custom_scheduled_at}` : ''}</dd></div>
                <div><dt>Source</dt><dd><code>{deliveryPreview.value.source_asset_id}</code> · attempt <code>{deliveryPreview.value.source_attempt_id}</code> · <code>{deliveryPreview.value.source_checksum_sha256}</code></dd></div>
                <div><dt>Capability fingerprint</dt><dd><code>{deliveryPreview.value.capability_fingerprint}</code></dd></div>
              </dl>
              <button disabled={deliveryBusy} onClick={() => void prepareAgentBrief()} type="button">Prepare agent brief</button>
              <p className="muted-copy">The brief gives a Codex browser session the exact media path, checksum, caption, channel, and timing intent. Lineage performs no Buffer write.</p>
            </div>}
            {agentHandoff && previewCurrent && <div className="lineage-social-preview">
              <p>Immutable agent handoff <code>{agentHandoff.handoff_id}</code></p>
              <label>Agent brief<textarea readOnly rows={16} value={agentHandoff.agent_brief_markdown} /></label>
              <button onClick={() => void copyAgentBrief()} type="button">Copy agent brief</button>
              <a href={agentHandoff.buffer_url} rel="noreferrer" target="_blank">Open exact Buffer channel</a>
            </div>}
            <section aria-label="Buffer read synchronization" className="lineage-social-preview">
              <h5>Buffer status and metrics</h5>
              <p className="muted-copy">After a browser agent schedules the post, paste the returned Buffer post ID. Lineage verifies the exact channel and text before linking it. These actions only read Buffer.</p>
              <label>Buffer post ID<input onChange={event => setProviderPostId(event.target.value)} value={providerPostId} /></label>
              <button disabled={deliveryBusy || !deliveryPreview || !previewCurrent || !providerPostId.trim()} onClick={() => void linkProviderPost()} type="button">Verify and link Buffer post</button>
              <button disabled={deliveryBusy} onClick={() => void loadProviderInsights()} type="button">Load linked Buffer status</button>
              {providerInsights && <div>
                <p>{providerInsights.status} · post <code>{providerInsights.provider_post_id}</code>{providerInsights.stale ? ' · metrics stale or not yet available' : ''}</p>
                {providerInsights.external_link && <a href={providerInsights.external_link} rel="noreferrer" target="_blank">Open published post</a>}
                {providerInsights.metrics_updated_at && <p>Metrics updated {new Date(providerInsights.metrics_updated_at).toLocaleString()}</p>}
                {providerInsights.metrics.length > 0 ? <dl>{providerInsights.metrics.map(metric => <div key={metric.type}><dt>{metric.name}</dt><dd>{metric.value}{metric.unit === 'percentage' ? '%' : ''}</dd></div>)}</dl> : <p>No Buffer metrics are available yet.</p>}
                <button disabled={deliveryBusy} onClick={() => void syncProviderInsights()} type="button">Sync Buffer status and metrics</button>
              </div>}
            </section>
            {deliveryNotice && <p aria-live="assertive" role="status">{deliveryNotice}</p>}
          </section>}
        </>
      )}
      </div>
    </aside>
  );
}
