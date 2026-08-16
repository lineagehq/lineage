import { createHash } from 'node:crypto';
import type { SocialProviderMetric, SocialProviderPostInsights } from '../../shared/socialTypes';
import { lineageDb } from '../assetLineageDb';
import { createBufferInsightsRuntime, type BufferInsightsRuntime } from '../adapters/buffer/bufferInsightsRuntime';
import { canonicalLineageWorkspaceChannel, requireLineageWorkspaceClaimForWrite } from '../lineageClaimGuards';
import { recreateSocialAgentHandoffEvidence } from './socialAgentHandoff';
import { SocialDeliveryError } from './socialDelivery';

const metricTypes = new Set<SocialProviderMetric['type']>([
  'reactions', 'comments', 'shares', 'reposts', 'reach', 'impressions', 'views', 'clicks', 'engagementRate',
  'saves', 'follows', 'quotes', 'viewers', 'totalTimeWatched', 'likes',
  'replies', 'favorites', 'reblogs', 'retweets', 'repins', 'link_clicks', 'other',
]);
const postIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

interface ProviderPost {
  id: string;
  text: string;
  channelId: string;
  firstComment?: string;
  status: 'needs_approval' | 'scheduled' | 'sending' | 'sent' | 'error';
  externalLink?: string;
  dueAt?: string;
  sentAt?: string;
  metrics: SocialProviderMetric[];
  metricsUpdatedAt?: string;
  image: { id: string; mimeType: 'image/png' | 'image/jpeg'; altText: string; width: number; height: number; identitySha256: string };
}

interface LinkRow {
  id: string; project_id: string; variant_id: string; revision: number; preview_sha256: string;
  provider_post_id: string; channel_id: string; rendered_text_sha256: string; first_comment_sha256: string | null;
  provider_asset_sha256: string | null;
}

interface SnapshotRow {
  status: ProviderPost['status']; external_link: string | null; due_at: string | null; sent_at: string | null;
  metrics_json: string; metrics_updated_at: string | null; observed_at: string;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function textDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function optionalDate(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new SocialDeliveryError(`Buffer ${field} is invalid`, 502, 'provider_response_invalid');
  return new Date(value).toISOString();
}

function normalizePost(value: unknown, expectedId: string): ProviderPost {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SocialDeliveryError('Buffer post response is invalid', 502, 'provider_response_invalid');
  const row = value as Record<string, unknown>;
  if (row.id !== expectedId || !postIdPattern.test(expectedId)) throw new SocialDeliveryError('Buffer post identity does not match', 409, 'provider_identity_mismatch');
  if (typeof row.text !== 'string' || typeof row.channelId !== 'string') throw new SocialDeliveryError('Buffer post content identity is invalid', 502, 'provider_response_invalid');
  if (row.status !== 'needs_approval' && row.status !== 'scheduled' && row.status !== 'sending' && row.status !== 'sent' && row.status !== 'error') throw new SocialDeliveryError('Buffer post status is invalid', 409, 'provider_status_invalid');
  let externalLink: string | undefined;
  if (row.externalLink !== null && row.externalLink !== undefined) {
    if (typeof row.externalLink !== 'string') throw new SocialDeliveryError('Buffer external link is invalid', 502, 'provider_response_invalid');
    let url: URL;
    try { url = new URL(row.externalLink); } catch { throw new SocialDeliveryError('Buffer external link is invalid', 502, 'provider_response_invalid'); }
    if (url.protocol !== 'https:') throw new SocialDeliveryError('Buffer external link is invalid', 502, 'provider_response_invalid');
    externalLink = url.href;
  }
  if (row.metrics !== null && row.metrics !== undefined && !Array.isArray(row.metrics)) throw new SocialDeliveryError('Buffer metrics are invalid', 502, 'provider_response_invalid');
  if (!Array.isArray(row.assets) || row.assets.length !== 1) throw new SocialDeliveryError('Buffer post must contain exactly one image', 409, 'provider_identity_mismatch');
  const rawAsset = row.assets[0];
  if (!rawAsset || typeof rawAsset !== 'object' || Array.isArray(rawAsset)) throw new SocialDeliveryError('Buffer image identity is invalid', 502, 'provider_response_invalid');
  const asset = rawAsset as Record<string, unknown>;
  const image = asset.image;
  if (asset.__typename !== 'ImageAsset' || typeof asset.id !== 'string' || !asset.id.trim()
    || (asset.mimeType !== 'image/png' && asset.mimeType !== 'image/jpeg')
    || !image || typeof image !== 'object' || Array.isArray(image)) throw new SocialDeliveryError('Buffer image identity is invalid', 409, 'provider_identity_mismatch');
  const imageFields = image as Record<string, unknown>;
  if (typeof imageFields.altText !== 'string' || !Number.isInteger(imageFields.width) || Number(imageFields.width) <= 0
    || !Number.isInteger(imageFields.height) || Number(imageFields.height) <= 0 || imageFields.isAnimated === true) throw new SocialDeliveryError('Buffer image identity is invalid', 409, 'provider_identity_mismatch');
  const normalizedImage = {
    id: asset.id, mimeType: asset.mimeType, altText: imageFields.altText,
    width: Number(imageFields.width), height: Number(imageFields.height),
  } as const;
  let firstComment: string | undefined;
  if (row.metadata !== null && row.metadata !== undefined) {
    if (typeof row.metadata !== 'object' || Array.isArray(row.metadata)) throw new SocialDeliveryError('Buffer post metadata is invalid', 502, 'provider_response_invalid');
    const raw = (row.metadata as Record<string, unknown>).firstComment;
    if (raw !== null && raw !== undefined) {
      if (typeof raw !== 'string') throw new SocialDeliveryError('Buffer first comment is invalid', 502, 'provider_response_invalid');
      firstComment = raw;
    }
  }
  const metrics = (row.metrics || []).map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new SocialDeliveryError('Buffer metric is invalid', 502, 'provider_response_invalid');
    const metric = entry as Record<string, unknown>;
    if (typeof metric.type !== 'string' || !metricTypes.has(metric.type as SocialProviderMetric['type']) || typeof metric.name !== 'string' || !metric.name.trim() || metric.name.length > 100
      || typeof metric.value !== 'number' || !Number.isFinite(metric.value) || metric.value < 0 || (metric.unit !== 'count' && metric.unit !== 'percentage')
      || (metric.unit === 'percentage' && metric.value > 100)) throw new SocialDeliveryError('Buffer metric is invalid', 502, 'provider_response_invalid');
    return { type: metric.type as SocialProviderMetric['type'], name: metric.name, value: metric.value, unit: metric.unit as SocialProviderMetric['unit'] };
  }).sort((a, b) => a.type.localeCompare(b.type));
  if (new Set(metrics.map(metric => metric.type)).size !== metrics.length) throw new SocialDeliveryError('Buffer metrics contain duplicates', 502, 'provider_response_invalid');
  return {
    id: expectedId, text: row.text, channelId: row.channelId, status: row.status, ...(firstComment !== undefined ? { firstComment } : {}), ...(externalLink ? { externalLink } : {}),
    ...(optionalDate(row.dueAt, 'dueAt') ? { dueAt: optionalDate(row.dueAt, 'dueAt') } : {}),
    ...(optionalDate(row.sentAt, 'sentAt') ? { sentAt: optionalDate(row.sentAt, 'sentAt') } : {}),
    metrics, ...(optionalDate(row.metricsUpdatedAt, 'metricsUpdatedAt') ? { metricsUpdatedAt: optionalDate(row.metricsUpdatedAt, 'metricsUpdatedAt') } : {}),
    image: { ...normalizedImage, identitySha256: digest(normalizedImage) },
  };
}

function assertHandoffImage(post: ProviderPost, handoff: ReturnType<typeof recreateSocialAgentHandoffEvidence>): void {
  if (post.image.mimeType !== handoff.media.content_type || post.image.altText !== handoff.alt_text
    || post.image.width !== handoff.media.width || post.image.height !== handoff.media.height) {
    throw new SocialDeliveryError('Buffer post image does not match the immutable Lineage brief', 409, 'provider_identity_mismatch');
  }
}

function connection(project: string): { credentialRef: string; organizationId: string } {
  const database = lineageDb();
  try {
    const row = database.prepare(`select credential_ref, organization_id, health_state from buffer_connections where project_id=?`).get(project) as unknown as { credential_ref: string; organization_id: string; health_state: string } | undefined;
    if (!row || row.health_state !== 'connected') throw new SocialDeliveryError('Buffer connection is not ready', 409, 'preflight_failed');
    return { credentialRef: row.credential_ref, organizationId: row.organization_id };
  } finally { database.close(); }
}

function readPost(runtime: BufferInsightsRuntime, project: string, postId: string): ProviderPost {
  try { runtime.verify(); return normalizePost(runtime.getPost(connection(project), postId), postId); }
  catch (error) {
    if (error instanceof SocialDeliveryError) throw error;
    throw new SocialDeliveryError('Buffer insights are unavailable', 503, 'insights_unavailable');
  }
}

function rootAssetForVariant(project: string, variantId: string): string {
  const database = lineageDb();
  try {
    const row = database.prepare(`select items.root_asset_id
      from social_variants variants
      join social_work_items items on items.project_id=variants.project_id and items.id=variants.item_id
      where variants.project_id=? and variants.id=?`).get(project, variantId) as { root_asset_id: string } | undefined;
    if (!row) throw new SocialDeliveryError('Social variant was not found', 404, 'not_found');
    return row.root_asset_id;
  } finally { database.close(); }
}

function writeSnapshot(database: ReturnType<typeof lineageDb>, project: string, link: LinkRow, post: ProviderPost, now: string): { row: SnapshotRow; idempotent: boolean } {
  const identity = { status: post.status, externalLink: post.externalLink || null, dueAt: post.dueAt || null, sentAt: post.sentAt || null, metrics: post.metrics, metricsUpdatedAt: post.metricsUpdatedAt || null };
  const snapshotSha = digest(identity); const id = digest({ project, link: link.id, snapshotSha });
  const result = database.prepare(`insert or ignore into social_provider_post_snapshots
    (id,project_id,link_id,provider_post_id,status,external_link,due_at,sent_at,metrics_json,metrics_updated_at,snapshot_sha256,observed_at)
    values (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, project, link.id, link.provider_post_id, post.status, post.externalLink || null, post.dueAt || null, post.sentAt || null, JSON.stringify(post.metrics), post.metricsUpdatedAt || null, snapshotSha, now);
  const row = database.prepare(`select status,external_link,due_at,sent_at,metrics_json,metrics_updated_at,observed_at from social_provider_post_snapshots where project_id=? and link_id=? and snapshot_sha256=?`)
    .get(project, link.id, snapshotSha) as unknown as SnapshotRow;
  return { row, idempotent: Number(result.changes) === 0 };
}

function response(link: LinkRow, snapshot: SnapshotRow, idempotent: boolean, asOf = new Date().toISOString()): SocialProviderPostInsights {
  const metrics = JSON.parse(snapshot.metrics_json) as SocialProviderMetric[];
  const observed = Date.parse(asOf); const updated = snapshot.metrics_updated_at ? Date.parse(snapshot.metrics_updated_at) : NaN;
  return {
    schema_version: 'lineage.social_provider_post_insights.v1', link_id: link.id, provider_post_id: link.provider_post_id,
    project: link.project_id, variant_id: link.variant_id, revision: Number(link.revision), preview_sha256: link.preview_sha256, channel_id: link.channel_id,
    status: snapshot.status, ...(snapshot.external_link ? { external_link: snapshot.external_link } : {}), ...(snapshot.due_at ? { due_at: snapshot.due_at } : {}),
    ...(snapshot.sent_at ? { sent_at: snapshot.sent_at } : {}), metrics, ...(snapshot.metrics_updated_at ? { metrics_updated_at: snapshot.metrics_updated_at } : {}),
    observed_at: snapshot.observed_at, stale: !Number.isFinite(updated) || observed - updated > 36 * 60 * 60 * 1000, idempotent,
  };
}

export function linkSocialProviderPost(project: string, input: { variantId: string; expectedRevision: number; previewSha256: string; providerPostId: string; confirmWrite?: unknown; claimToken?: string }, runtime: BufferInsightsRuntime = createBufferInsightsRuntime(), now = new Date().toISOString()): SocialProviderPostInsights {
  if (input.confirmWrite !== true) throw new SocialDeliveryError('confirmWrite=true is required to link a Buffer post');
  if (!postIdPattern.test(input.providerPostId)) throw new SocialDeliveryError('providerPostId is invalid');
  if (!Number.isFinite(Date.parse(now))) throw new SocialDeliveryError('Observation time is invalid');
  const handoff = recreateSocialAgentHandoffEvidence(project, input);
  const rootAssetId = rootAssetForVariant(project, input.variantId);
  requireLineageWorkspaceClaimForWrite({
    channel: canonicalLineageWorkspaceChannel(project, rootAssetId),
    claimToken: input.claimToken,
    confirmWrite: true,
    project,
    rootAssetId,
    writeKind: 'social_provider_post_link',
  });
  const post = readPost(runtime, project, input.providerPostId);
  if (post.channelId !== handoff.channel.id || post.text !== handoff.rendered_text || (post.firstComment || undefined) !== (handoff.first_comment || undefined)) throw new SocialDeliveryError('Buffer post does not match the immutable Lineage brief', 409, 'provider_identity_mismatch');
  if (handoff.composition_mode === 'customScheduled' && post.dueAt !== new Date(handoff.custom_scheduled_at!).toISOString()) throw new SocialDeliveryError('Buffer post does not match the immutable Lineage schedule', 409, 'provider_identity_mismatch');
  assertHandoffImage(post, handoff);
  const link: LinkRow = {
    id: digest({ project, providerPostId: input.providerPostId, preview: handoff.preview_sha256 }), project_id: project, variant_id: handoff.variant_id,
    revision: handoff.revision, preview_sha256: handoff.preview_sha256, provider_post_id: input.providerPostId, channel_id: handoff.channel.id, rendered_text_sha256: textDigest(handoff.rendered_text), first_comment_sha256: handoff.first_comment ? textDigest(handoff.first_comment) : null, provider_asset_sha256: post.image.identitySha256,
  };
  const database = lineageDb();
  try {
    database.exec('begin immediate');
    const prior = database.prepare('select * from social_provider_post_links where project_id=? and provider_post_id=?').get(project, input.providerPostId) as LinkRow | undefined;
    if (prior && (prior.variant_id !== link.variant_id || prior.preview_sha256 !== link.preview_sha256 || prior.rendered_text_sha256 !== link.rendered_text_sha256 || prior.first_comment_sha256 !== link.first_comment_sha256 || (prior.provider_asset_sha256 !== null && prior.provider_asset_sha256 !== link.provider_asset_sha256))) throw new SocialDeliveryError('Buffer post is already linked to different Lineage evidence', 409, 'provider_identity_mismatch');
    if (!prior) database.prepare(`insert into social_provider_post_links (id,project_id,variant_id,revision_id,revision,preview_sha256,provider_post_id,channel_id,rendered_text_sha256,first_comment_sha256,provider_asset_sha256,created_at)
      values (?,?,?,?,?,?,?,?,?,?,?,?)`).run(link.id, project, handoff.variant_id, handoff.revision_id, handoff.revision, handoff.preview_sha256, input.providerPostId, handoff.channel.id, link.rendered_text_sha256, link.first_comment_sha256, link.provider_asset_sha256, now);
    const stored = (prior || database.prepare('select * from social_provider_post_links where id=?').get(link.id)) as LinkRow;
    const snapshot = writeSnapshot(database, project, stored, post, now);
    database.exec('commit');
    return response(stored, snapshot.row, Boolean(prior) && snapshot.idempotent, now);
  } catch (error) { try { database.exec('rollback'); } catch { /* inactive */ } throw error; }
  finally { database.close(); }
}

export function syncSocialProviderPost(project: string, variantId: string, fields: { confirmWrite?: unknown; claimToken?: string }, runtime: BufferInsightsRuntime = createBufferInsightsRuntime(), now = new Date().toISOString()): SocialProviderPostInsights {
  if (fields.confirmWrite !== true) throw new SocialDeliveryError('confirmWrite=true is required to sync Buffer insights');
  if (!Number.isFinite(Date.parse(now))) throw new SocialDeliveryError('Observation time is invalid');
  const database = lineageDb();
  try {
    const link = database.prepare(`select links.*, items.root_asset_id
      from social_provider_post_links links
      join social_variants variants on variants.project_id=links.project_id and variants.id=links.variant_id
      join social_work_items items on items.project_id=variants.project_id and items.id=variants.item_id
      where links.project_id=? and links.variant_id=? order by links.created_at desc limit 1`)
      .get(project, variantId) as (LinkRow & { root_asset_id: string }) | undefined;
    if (!link) throw new SocialDeliveryError('No verified Buffer post is linked to this variant', 404, 'not_found');
    requireLineageWorkspaceClaimForWrite({
      channel: canonicalLineageWorkspaceChannel(project, link.root_asset_id, database),
      claimToken: fields.claimToken,
      confirmWrite: true,
      project,
      rootAssetId: link.root_asset_id,
      writeKind: 'social_provider_post_sync',
    });
    const post = readPost(runtime, project, link.provider_post_id);
    if (post.channelId !== link.channel_id || textDigest(post.text) !== link.rendered_text_sha256 || (post.firstComment ? textDigest(post.firstComment) : null) !== link.first_comment_sha256 || (link.provider_asset_sha256 !== null && post.image.identitySha256 !== link.provider_asset_sha256)) throw new SocialDeliveryError('Buffer post identity changed', 409, 'provider_identity_mismatch');
    database.exec('begin immediate'); const snapshot = writeSnapshot(database, project, link, post, now); database.exec('commit');
    return response(link, snapshot.row, snapshot.idempotent, now);
  } catch (error) { try { database.exec('rollback'); } catch { /* inactive */ } throw error; }
  finally { database.close(); }
}

export function getSocialProviderPost(project: string, variantId: string): SocialProviderPostInsights | null {
  const database = lineageDb();
  try {
    const link = database.prepare('select * from social_provider_post_links where project_id=? and variant_id=? order by created_at desc limit 1').get(project, variantId) as LinkRow | undefined;
    if (!link) return null;
    const snapshot = database.prepare('select status,external_link,due_at,sent_at,metrics_json,metrics_updated_at,observed_at from social_provider_post_snapshots where project_id=? and link_id=? order by observed_at desc,id desc limit 1').get(project, link.id) as unknown as SnapshotRow;
    return response(link, snapshot, true);
  } finally { database.close(); }
}
