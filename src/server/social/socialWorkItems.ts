import { createHash, randomUUID } from 'node:crypto';
import type {
  SocialCompositionMode,
  SocialEditorialState,
  SocialHashtagPlacement,
  SocialPublishMethod,
  SocialVariant,
  SocialVariantRevision,
  SocialWorkItem,
  SocialWorkItemResponse,
} from '../../shared/socialTypes';
import { getLineageSnapshot, LineageError } from '../assetLineage';
import { lineageDb, nowIso, type DatabaseSync } from '../assetLineageDb';
import { requireLineageWorkspaceClaimForWrite } from '../lineageClaimGuards';

interface WorkItemRow {
  id: string; project_id: string; root_asset_id: string; source_asset_id: string;
  source_checksum_sha256: string | null; campaign_key: string; content_post_id: string | null;
  editorial_state: 'active' | 'archived'; created_by: string; created_at: string;
  updated_at: string; archived_at: string | null;
}

interface VariantRow {
  id: string; item_id: string; project_id: string; channel_id: string;
  editorial_state: SocialEditorialState; active: number; current_revision: number;
  created_at: string; updated_at: string; archived_at: string | null;
}

interface RevisionRow {
  id: string; variant_id: string; revision: number; copy: string;
  hashtag_placement: SocialHashtagPlacement; alt_text: string | null; alt_text_reviewed: number;
  alt_text_reviewed_by: string | null; alt_text_reviewed_at: string | null;
  editorial_state: SocialEditorialState; publish_method: SocialPublishMethod;
  composition_mode: SocialCompositionMode | null; custom_scheduled_at: string | null;
  channel_fingerprint: string; revision_hash: string; created_by: string; created_at: string;
}

interface SocialMutationFields { claimToken?: string; confirmWrite: boolean; actor?: string }
export interface CreateSocialWorkItemFields extends SocialMutationFields {
  rootAssetId: string; sourceAssetId: string; campaignKey?: string; contentPostId?: string;
}
export interface AddSocialVariantFields extends SocialMutationFields { itemId: string; channelId: string }
export interface EditSocialVariantFields extends SocialMutationFields {
  variantId: string; expectedRevision: number; copy?: string; hashtags?: string[];
  hashtagPlacement?: SocialHashtagPlacement; altText?: string; altTextReviewed?: boolean;
  altTextReviewedBy?: string;
  publishMethod?: SocialPublishMethod; compositionMode?: SocialCompositionMode | null;
  customScheduledAt?: string | null; editorialState?: Exclude<SocialEditorialState, 'archived'>;
}
interface ExpectedVariantRevision { variantId: string; expectedRevision: number }
interface RemoveSocialVariantFields extends SocialMutationFields { variantId: string; expectedRevision: number }
interface ArchiveSocialWorkItemFields extends SocialMutationFields { itemId: string; expectedVariants: ExpectedVariantRevision[] }

function actor(value?: string): string {
  const normalized = value?.trim() || 'human';
  if (!normalized) throw new LineageError('Social mutation actor is required');
  return normalized;
}

function campaignKey(value?: string): string {
  const normalized = value?.trim() || 'default';
  if (normalized.length > 200) throw new LineageError('Campaign key must be at most 200 characters');
  return normalized;
}

function rootChannel(project: string, rootAssetId: string): string | undefined {
  const snapshot = getLineageSnapshot(project, rootAssetId);
  if (snapshot.root_asset_id !== rootAssetId) throw new LineageError(`Asset ${rootAssetId} is not a canonical lineage canvas root`, 400);
  return snapshot.nodes.find(node => node.asset_id === rootAssetId)?.channel;
}

function guard(project: string, rootAssetId: string, fields: SocialMutationFields, writeKind: string): void {
  requireLineageWorkspaceClaimForWrite({
    channel: rootChannel(project, rootAssetId), claimToken: fields.claimToken,
    confirmWrite: fields.confirmWrite, project, rootAssetId, writeKind,
  });
  if (!fields.confirmWrite) throw new LineageError(`${writeKind} requires confirmWrite=true`);
}

function readRevision(database: DatabaseSync, variantId: string, revision: number): SocialVariantRevision {
  const row = database.prepare('select * from social_variant_revisions where variant_id = ? and revision = ?')
    .get(variantId, revision) as RevisionRow | undefined;
  if (!row) throw new LineageError(`Social variant revision ${variantId}:${revision} was not found`, 404);
  const hashtags = database.prepare('select position, value from social_hashtags where revision_id = ? order by position')
    .all(row.id) as Array<{ position: number; value: string }>;
  return {
    id: row.id, variant_id: row.variant_id, revision: Number(row.revision), copy: row.copy,
    hashtags: hashtags.map(tag => ({ position: Number(tag.position), value: tag.value })),
    hashtag_placement: row.hashtag_placement, ...(row.alt_text ? { alt_text: row.alt_text } : {}),
    alt_text_reviewed: row.alt_text_reviewed === 1,
    ...(row.alt_text_reviewed_by ? { alt_text_reviewed_by: row.alt_text_reviewed_by } : {}),
    ...(row.alt_text_reviewed_at ? { alt_text_reviewed_at: row.alt_text_reviewed_at } : {}),
    editorial_state: row.editorial_state,
    publish_method: row.publish_method, ...(row.composition_mode ? { composition_mode: row.composition_mode } : {}),
    ...(row.custom_scheduled_at ? { custom_scheduled_at: row.custom_scheduled_at } : {}),
    channel_fingerprint: row.channel_fingerprint, revision_hash: row.revision_hash,
    created_by: row.created_by, created_at: row.created_at,
  };
}

function readVariant(database: DatabaseSync, row: VariantRow): SocialVariant {
  return {
    id: row.id, item_id: row.item_id, project_id: row.project_id, channel_id: row.channel_id,
    editorial_state: row.editorial_state, active: row.active === 1, current_revision: Number(row.current_revision),
    created_at: row.created_at, updated_at: row.updated_at, ...(row.archived_at ? { archived_at: row.archived_at } : {}),
    revision: readRevision(database, row.id, Number(row.current_revision)),
  };
}

function readItem(database: DatabaseSync, row: WorkItemRow): SocialWorkItem {
  const variants = database.prepare('select * from social_variants where item_id = ? order by created_at, id').all(row.id) as unknown as VariantRow[];
  return {
    id: row.id, project_id: row.project_id, root_asset_id: row.root_asset_id,
    source_asset_id: row.source_asset_id, ...(row.source_checksum_sha256 ? { source_checksum_sha256: row.source_checksum_sha256 } : {}),
    campaign_key: row.campaign_key, ...(row.content_post_id ? { content_post_id: row.content_post_id } : {}),
    editorial_state: row.editorial_state, created_by: row.created_by, created_at: row.created_at,
    updated_at: row.updated_at, ...(row.archived_at ? { archived_at: row.archived_at } : {}),
    variants: variants.map(variant => readVariant(database, variant)),
  };
}

export function getSocialWorkItem(project: string, itemId: string): SocialWorkItemResponse {
  const database = lineageDb();
  try {
    const row = database.prepare('select * from social_work_items where project_id = ? and id = ?').get(project, itemId) as WorkItemRow | undefined;
    if (!row) throw new LineageError(`Social Work Item ${itemId} was not found in project ${project}`, 404);
    return { schema_version: 'lineage.social_work_item.v1', item: readItem(database, row) };
  } finally { database.close(); }
}

export function createSocialWorkItem(project: string, fields: CreateSocialWorkItemFields): SocialWorkItemResponse {
  const snapshot = getLineageSnapshot(project, fields.rootAssetId);
  if (snapshot.root_asset_id !== fields.rootAssetId) throw new LineageError(`Asset ${fields.rootAssetId} is not a canonical lineage canvas root`, 400);
  const source = snapshot.nodes.find(node => node.asset_id === fields.sourceAssetId);
  if (!source) throw new LineageError(`Asset ${fields.sourceAssetId} is not visible in lineage canvas ${fields.rootAssetId}`, 404);
  guard(project, fields.rootAssetId, fields, 'social_item_create');
  const normalizedCampaign = campaignKey(fields.campaignKey);
  const database = lineageDb();
  try {
    database.exec('begin immediate');
    try {
      const mark = database.prepare(`select id from asset_social_marks where project_id=? and root_asset_id=? and asset_id=? and unmarked_at is null`)
        .get(project, fields.rootAssetId, fields.sourceAssetId);
      if (!mark) throw new LineageError('Promotion requires an active Social mark on the exact visible canvas node', 409);
      if (fields.contentPostId) {
        const post = database.prepare('select id from content_posts where project_id=? and id=?').get(project, fields.contentPostId);
        if (!post) throw new LineageError(`Content post ${fields.contentPostId} was not found in project ${project}`, 404);
      }
      const existing = database.prepare(`select * from social_work_items where project_id=? and root_asset_id=? and source_asset_id=? and campaign_key=?`)
        .get(project, fields.rootAssetId, fields.sourceAssetId, normalizedCampaign) as WorkItemRow | undefined;
      if (existing) {
        if (fields.contentPostId !== undefined && existing.content_post_id !== fields.contentPostId) {
          throw new LineageError(`Social Work Item ${existing.id} already exists with a different content-post link`, 409);
        }
        const result = { schema_version: 'lineage.social_work_item.v1' as const, item: readItem(database, existing), idempotent: true };
        database.exec('commit');
        return result;
      }
      const timestamp = nowIso(); const id = randomUUID();
      database.prepare(`insert into social_work_items (id, project_id, root_asset_id, source_asset_id, source_checksum_sha256, campaign_key, content_post_id, editorial_state, created_by, created_at, updated_at, archived_at)
        values (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, null)`)
        .run(id, project, fields.rootAssetId, fields.sourceAssetId, source.checksum_sha256 || null, normalizedCampaign, fields.contentPostId || null, actor(fields.actor), timestamp, timestamp);
      const result = getSocialWorkItemFromDatabase(database, project, id);
      database.exec('commit');
      return result;
    } catch (error) { database.exec('rollback'); throw error; }
  } finally { database.close(); }
}

function getSocialWorkItemFromDatabase(database: DatabaseSync, project: string, itemId: string): SocialWorkItemResponse {
  const row = database.prepare('select * from social_work_items where project_id=? and id=?').get(project, itemId) as WorkItemRow | undefined;
  if (!row) throw new LineageError(`Social Work Item ${itemId} was not found in project ${project}`, 404);
  return { schema_version: 'lineage.social_work_item.v1', item: readItem(database, row) };
}

function itemForMutation(project: string, itemId: string): WorkItemRow {
  const database = lineageDb();
  try {
    const row = database.prepare('select * from social_work_items where project_id=? and id=?').get(project, itemId) as WorkItemRow | undefined;
    if (!row) throw new LineageError(`Social Work Item ${itemId} was not found in project ${project}`, 404);
    return row;
  } finally { database.close(); }
}

function normalizeHashtags(values: string[]): string[] {
  const normalized = values.map(value => value.trim().replace(/^#+/, '').toLocaleLowerCase()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length) throw new LineageError('Hashtags must be unique after normalization');
  if (normalized.some(value => /\s/.test(value))) throw new LineageError('Hashtags cannot contain whitespace');
  return normalized;
}

function requireZonedTimestamp(value: string): string {
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(normalized);
  const invalid = !match || (() => {
    const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
    const hour = Number(match[4]); const minute = Number(match[5]); const second = Number(match[6] || 0);
    const offsetHour = Number(match[9] || 0); const offsetMinute = Number(match[10] || 0);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59
      || offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)
      || !Number.isFinite(Date.parse(normalized));
  })();
  if (invalid) {
    throw new LineageError('customScheduled composition intent requires an exact ISO timestamp with Z or a UTC offset');
  }
  return normalized;
}

function revisionDigest(input: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function insertRevision(database: DatabaseSync, variant: VariantRow, input: {
  copy: string; hashtags: string[]; hashtagPlacement: SocialHashtagPlacement; altText?: string;
  altTextReviewed: boolean; altTextReviewedBy?: string; altTextReviewedAt?: string; editorialState: SocialEditorialState;
  publishMethod: SocialPublishMethod; compositionMode?: SocialCompositionMode;
  customScheduledAt?: string; channelFingerprint: string; actor: string; timestamp: string;
}): number {
  if (input.altTextReviewed && (!input.altText?.trim() || !input.altTextReviewedBy?.trim())) {
    throw new LineageError('Reviewed alt text requires non-empty alt text and reviewer provenance');
  }
  if (input.compositionMode === 'customScheduled' && !input.customScheduledAt) throw new LineageError('customScheduled composition intent requires --custom-scheduled-at');
  if (input.compositionMode !== 'customScheduled' && input.customScheduledAt) throw new LineageError('custom_scheduled_at is valid only with customScheduled composition intent');
  const hashtags = normalizeHashtags(input.hashtags);
  const customScheduledAt = input.customScheduledAt ? requireZonedTimestamp(input.customScheduledAt) : undefined;
  const digestInput = {
    alt_text: input.altText?.trim() || null, alt_text_reviewed: input.altTextReviewed,
    alt_text_reviewed_by: input.altTextReviewed ? input.altTextReviewedBy?.trim() || null : null,
    channel_fingerprint: input.channelFingerprint, channel_id: variant.channel_id,
    composition_mode: input.compositionMode || null, copy: input.copy,
    custom_scheduled_at: customScheduledAt || null, hashtag_placement: input.hashtagPlacement,
    hashtags, editorial_state: input.editorialState, publish_method: input.publishMethod,
  };
  const hash = revisionDigest(digestInput);
  const current = database.prepare('select revision_hash from social_variant_revisions where variant_id=? and revision=?').get(variant.id, variant.current_revision) as { revision_hash: string } | undefined;
  if (current?.revision_hash === hash) return Number(variant.current_revision);
  const revision = Number(variant.current_revision) + 1;
  const id = randomUUID();
  database.prepare(`insert into social_variant_revisions (id, variant_id, revision, copy, hashtag_placement, alt_text, alt_text_reviewed, alt_text_reviewed_by, alt_text_reviewed_at, editorial_state, publish_method, composition_mode, custom_scheduled_at, channel_fingerprint, revision_hash, created_by, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, variant.id, revision, input.copy, input.hashtagPlacement, input.altText?.trim() || null, input.altTextReviewed ? 1 : 0,
      input.altTextReviewed ? input.altTextReviewedBy!.trim() : null, input.altTextReviewed ? input.altTextReviewedAt || input.timestamp : null,
      input.editorialState, input.publishMethod, input.compositionMode || null, customScheduledAt || null,
      input.channelFingerprint, hash, input.actor, input.timestamp);
  hashtags.forEach((value, position) => database.prepare('insert into social_hashtags (revision_id, position, value) values (?, ?, ?)').run(id, position, value));
  return revision;
}

export function addSocialVariant(project: string, fields: AddSocialVariantFields): SocialWorkItemResponse {
  const item = itemForMutation(project, fields.itemId);
  guard(project, item.root_asset_id, fields, 'social_variant_add');
  if (item.editorial_state === 'archived') throw new LineageError('Archived Social Work Items cannot be edited', 409);
  const database = lineageDb();
  try {
    database.exec('begin immediate');
    try {
      const active = database.prepare('select id from social_variants where item_id=? and channel_id=? and active=1').get(item.id, fields.channelId);
      if (active) throw new LineageError(`An active variant already exists for channel ${fields.channelId}`, 409);
      const channel = database.prepare('select provider_fingerprint from buffer_channels where project_id=? and channel_id=?').get(project, fields.channelId) as { provider_fingerprint: string } | undefined;
      if (!channel) throw new LineageError(`Channel ${fields.channelId} is not in the synchronized project channel catalog; sync channels first`, 409);
      const timestamp = nowIso(); const variantId = randomUUID();
      const variant: VariantRow = { id: variantId, item_id: item.id, project_id: project, channel_id: fields.channelId, editorial_state: 'draft', active: 1, current_revision: 0, created_at: timestamp, updated_at: timestamp, archived_at: null };
      database.prepare(`insert into social_variants (id, item_id, project_id, channel_id, editorial_state, active, current_revision, created_at, updated_at, archived_at) values (?, ?, ?, ?, 'draft', 1, 1, ?, ?, null)`)
        .run(variantId, item.id, project, fields.channelId, timestamp, timestamp);
      insertRevision(database, variant, { copy: '', hashtags: [], hashtagPlacement: 'caption', altTextReviewed: false,
        editorialState: 'draft', publishMethod: 'automatic', channelFingerprint: channel.provider_fingerprint,
        actor: actor(fields.actor), timestamp });
      database.prepare('update social_work_items set updated_at=? where id=?').run(timestamp, item.id);
      database.exec('commit');
      return getSocialWorkItemFromDatabase(database, project, item.id);
    } catch (error) { database.exec('rollback'); throw error; }
  } finally { database.close(); }
}

export function editSocialVariant(project: string, fields: EditSocialVariantFields): SocialWorkItemResponse {
  if (!Number.isInteger(fields.expectedRevision) || fields.expectedRevision < 1) {
    throw new LineageError('Social variant edit expectedRevision is required and must be a positive integer');
  }
  const database = lineageDb();
  try {
    const initialVariant = database.prepare('select * from social_variants where project_id=? and id=?').get(project, fields.variantId) as VariantRow | undefined;
    if (!initialVariant) throw new LineageError(`Social variant ${fields.variantId} was not found in project ${project}`, 404);
    const initialItem = database.prepare('select * from social_work_items where project_id=? and id=?').get(project, initialVariant.item_id) as unknown as WorkItemRow;
    guard(project, initialItem.root_asset_id, fields, 'social_variant_edit');
    database.exec('begin immediate');
    try {
      const variant = database.prepare('select * from social_variants where project_id=? and id=?').get(project, fields.variantId) as VariantRow | undefined;
      if (!variant) throw new LineageError(`Social variant ${fields.variantId} was not found in project ${project}`, 404);
      const item = database.prepare('select * from social_work_items where project_id=? and id=?').get(project, variant.item_id) as unknown as WorkItemRow;
      if (!variant.active || item.editorial_state === 'archived') throw new LineageError('Archived Social variants cannot be edited', 409);
      if (fields.expectedRevision !== Number(variant.current_revision)) {
        throw new LineageError(`Social variant revision conflict: expected ${fields.expectedRevision}, current ${variant.current_revision}`, 409);
      }
      const current = readRevision(database, variant.id, Number(variant.current_revision));
      const channel = database.prepare('select provider_fingerprint from buffer_channels where project_id=? and channel_id=?').get(project, variant.channel_id) as { provider_fingerprint: string } | undefined;
      if (!channel) throw new LineageError(`Channel ${variant.channel_id} is missing from the synchronized project channel catalog`, 409);
      const timestamp = nowIso();
      const nextAltText = fields.altText === undefined ? current.alt_text : fields.altText;
      const altTextChanged = fields.altText !== undefined && (fields.altText.trim() || undefined) !== current.alt_text;
      const nextReviewed = fields.altTextReviewed ?? (altTextChanged ? false : current.alt_text_reviewed);
      const nextReviewedBy = fields.altTextReviewedBy ?? (altTextChanged ? undefined : current.alt_text_reviewed_by);
      const reviewChanged = altTextChanged || fields.altTextReviewed !== undefined || fields.altTextReviewedBy !== undefined;
      const revision = insertRevision(database, variant, {
        copy: fields.copy ?? current.copy, hashtags: fields.hashtags ?? current.hashtags.map(tag => tag.value),
        hashtagPlacement: fields.hashtagPlacement ?? current.hashtag_placement,
        altText: nextAltText,
        altTextReviewed: nextReviewed,
        altTextReviewedBy: nextReviewedBy,
        altTextReviewedAt: nextReviewed && !reviewChanged ? current.alt_text_reviewed_at : undefined,
        editorialState: fields.editorialState ?? variant.editorial_state,
        publishMethod: fields.publishMethod ?? current.publish_method,
        compositionMode: fields.compositionMode === undefined ? current.composition_mode : fields.compositionMode || undefined,
        customScheduledAt: fields.customScheduledAt === undefined
          ? fields.compositionMode && fields.compositionMode !== 'customScheduled' ? undefined : current.custom_scheduled_at
          : fields.customScheduledAt || undefined,
        channelFingerprint: channel.provider_fingerprint, actor: actor(fields.actor), timestamp,
      });
      database.prepare('update social_variants set current_revision=?, editorial_state=?, updated_at=? where id=?')
        .run(revision, fields.editorialState ?? variant.editorial_state, timestamp, variant.id);
      database.prepare('update social_work_items set updated_at=? where id=?').run(timestamp, item.id);
      database.exec('commit');
      return getSocialWorkItemFromDatabase(database, project, item.id);
    } catch (error) { database.exec('rollback'); throw error; }
  } finally { database.close(); }
}

function appendArchivedRevision(database: DatabaseSync, variant: VariantRow, current: SocialVariantRevision, fields: SocialMutationFields, timestamp: string): number {
  return insertRevision(database, variant, {
    copy: current.copy,
    hashtags: current.hashtags.map(tag => tag.value),
    hashtagPlacement: current.hashtag_placement,
    altText: current.alt_text,
    altTextReviewed: current.alt_text_reviewed,
    altTextReviewedBy: current.alt_text_reviewed_by,
    altTextReviewedAt: current.alt_text_reviewed_at,
    editorialState: 'archived',
    publishMethod: current.publish_method,
    compositionMode: current.composition_mode,
    customScheduledAt: current.custom_scheduled_at,
    channelFingerprint: current.channel_fingerprint,
    actor: actor(fields.actor),
    timestamp,
  });
}

function assertExpectedRevision(value: number, operation: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new LineageError(`${operation} expectedRevision is required and must be a positive integer`);
  }
}

export function removeSocialVariant(project: string, fields: RemoveSocialVariantFields): SocialWorkItemResponse {
  assertExpectedRevision(fields.expectedRevision, 'Social variant remove');
  const database = lineageDb();
  try {
    const initialVariant = database.prepare('select * from social_variants where project_id=? and id=?').get(project, fields.variantId) as VariantRow | undefined;
    if (!initialVariant) throw new LineageError(`Social variant ${fields.variantId} was not found in project ${project}`, 404);
    const initialItem = database.prepare('select * from social_work_items where project_id=? and id=?').get(project, initialVariant.item_id) as unknown as WorkItemRow;
    guard(project, initialItem.root_asset_id, fields, 'social_variant_remove');
    database.exec('begin immediate');
    try {
      const variant = database.prepare('select * from social_variants where project_id=? and id=?').get(project, fields.variantId) as VariantRow | undefined;
      if (!variant) throw new LineageError(`Social variant ${fields.variantId} was not found in project ${project}`, 404);
      const item = database.prepare('select * from social_work_items where project_id=? and id=?').get(project, variant.item_id) as unknown as WorkItemRow;
      const current = readRevision(database, variant.id, Number(variant.current_revision));
      if (!variant.active) {
        if (current.editorial_state !== 'archived' || fields.expectedRevision !== Number(variant.current_revision) - 1) {
          throw new LineageError(`Social variant revision conflict: expected ${fields.expectedRevision}, current ${variant.current_revision}`, 409);
        }
        const result = { ...getSocialWorkItemFromDatabase(database, project, item.id), idempotent: true };
        database.exec('commit');
        return result;
      }
      if (fields.expectedRevision !== Number(variant.current_revision)) {
        throw new LineageError(`Social variant revision conflict: expected ${fields.expectedRevision}, current ${variant.current_revision}`, 409);
      }
      const timestamp = nowIso();
      const revision = appendArchivedRevision(database, variant, current, fields, timestamp);
      database.prepare(`update social_variants set active=0, current_revision=?, editorial_state='archived', archived_at=?, updated_at=? where id=?`)
        .run(revision, timestamp, timestamp, variant.id);
      database.prepare('update social_work_items set updated_at=? where id=?').run(timestamp, item.id);
      const result = getSocialWorkItemFromDatabase(database, project, item.id);
      database.exec('commit');
      return result;
    } catch (error) { database.exec('rollback'); throw error; }
  } finally { database.close(); }
}

function validateExpectedVariants(values: ExpectedVariantRevision[]): Map<string, number> {
  if (!Array.isArray(values)) throw new LineageError('Social item archive expectedVariants is required and must be an array');
  const expected = new Map<string, number>();
  for (const value of values) {
    if (!value || typeof value.variantId !== 'string' || !value.variantId.trim()) throw new LineageError('Every expected variant requires a variantId');
    assertExpectedRevision(value.expectedRevision, 'Social item archive variant');
    if (expected.has(value.variantId)) throw new LineageError(`Duplicate expected variant: ${value.variantId}`);
    expected.set(value.variantId, value.expectedRevision);
  }
  return expected;
}

export function archiveSocialWorkItem(project: string, fields: ArchiveSocialWorkItemFields): SocialWorkItemResponse {
  const expected = validateExpectedVariants(fields.expectedVariants);
  const item = itemForMutation(project, fields.itemId);
  guard(project, item.root_asset_id, fields, 'social_item_archive');
  const database = lineageDb();
  try {
    database.exec('begin immediate');
    try {
      const currentItem = database.prepare('select * from social_work_items where project_id=? and id=?').get(project, item.id) as WorkItemRow | undefined;
      if (!currentItem) throw new LineageError(`Social Work Item ${item.id} was not found in project ${project}`, 404);
      const active = database.prepare('select * from social_variants where item_id=? and active=1 order by id').all(item.id) as unknown as VariantRow[];
      if (currentItem.editorial_state === 'archived') {
        const archivedTogether = database.prepare(`select * from social_variants where project_id=? and item_id=? and active=0 and archived_at=? order by id`)
          .all(project, item.id, currentItem.archived_at) as unknown as VariantRow[];
        if (active.length || expected.size !== archivedTogether.length || archivedTogether.some(variant => !expected.has(variant.id))) {
          throw new LineageError('Social item archive concurrency contract is incomplete', 409);
        }
        for (const variant of archivedTogether) {
          const revision = expected.get(variant.id)!;
          if (Number(variant.current_revision) !== revision + 1 || readRevision(database, variant.id, Number(variant.current_revision)).editorial_state !== 'archived') {
            throw new LineageError(`Social item archive revision conflict for variant ${variant.id}`, 409);
          }
        }
        const result = { ...getSocialWorkItemFromDatabase(database, project, item.id), idempotent: true };
        database.exec('commit');
        return result;
      }
      if (expected.size !== active.length || active.some(variant => !expected.has(variant.id))) {
        throw new LineageError('Social item archive requires a complete concurrency contract for every active variant', 409);
      }
      for (const variant of active) {
        const wanted = expected.get(variant.id)!;
        if (wanted !== Number(variant.current_revision)) {
          throw new LineageError(`Social item archive revision conflict for variant ${variant.id}: expected ${wanted}, current ${variant.current_revision}`, 409);
        }
      }
      const timestamp = nowIso();
      for (const variant of active) {
        const current = readRevision(database, variant.id, Number(variant.current_revision));
        const revision = appendArchivedRevision(database, variant, current, fields, timestamp);
        database.prepare(`update social_variants set active=0, current_revision=?, editorial_state='archived', archived_at=?, updated_at=? where id=?`)
          .run(revision, timestamp, timestamp, variant.id);
      }
      database.prepare(`update social_work_items set editorial_state='archived', archived_at=?, updated_at=? where id=?`).run(timestamp, timestamp, item.id);
      const result = getSocialWorkItemFromDatabase(database, project, item.id);
      database.exec('commit');
      return result;
    } catch (error) { database.exec('rollback'); throw error; }
  } finally { database.close(); }
}
