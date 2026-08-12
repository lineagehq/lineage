import { FileArchive, FileText, Image, Play } from 'lucide-react';
import type { GrowthAsset, PlacementStatus } from '../shared/types';

export type StatusFilter = 'all' | GrowthAsset['status'];
export type PlacementFilter = 'all' | PlacementStatus | 'not-posted';
export type SourceFilter = 'local' | 'catalog' | 'all';
export type StudioView = 'review' | 'ledger' | 'content' | 'backup' | 'assets' | 'agents' | 'lineage' | 'settings';

export interface Toast {
  type: 'ok' | 'error';
  message: string;
}

export const statusFilters: StatusFilter[] = ['all', 'working', 'approved', 'published', 'archived', 'planned'];
export const placementFilters: PlacementFilter[] = ['all', 'planned', 'scheduled', 'posted', 'skipped', 'not-posted'];
export const sourceFilters: SourceFilter[] = ['local', 'catalog', 'all'];
export const contentTypes: GrowthAsset['content_type'][] = ['image', 'video', 'gif', 'audio', 'doc', 'other'];

const previewableTypes = new Set<GrowthAsset['content_type']>(['image', 'video', 'gif']);
type StorageStateKind = 'local-only' | 's3-backed' | 'local-s3' | 'catalog-record';

export function storageStateFor(parts: { hasLocal?: boolean; hasS3?: boolean }) {
  const kind: StorageStateKind = parts.hasLocal && parts.hasS3 ? 'local-s3' : parts.hasLocal ? 'local-only' : parts.hasS3 ? 's3-backed' : 'catalog-record';
  const copy = {
    'catalog-record': ['catalog only', 'Catalog metadata exists, but no S3 object is recorded yet.'],
    'local-only': ['local only', 'Only in local review. Back up when this is a keeper.'],
    'local-s3': ['local + S3', 'Local file and S3 object are both known.'],
    's3-backed': ['S3 backed', 'Cataloged with an S3 object.'],
  } satisfies Record<StorageStateKind, [string, string]>;
  return { description: copy[kind][1], kind, label: copy[kind][0] };
}

export function assetStorageState(asset: GrowthAsset) {
  return storageStateFor({ hasLocal: Boolean(asset.local?.relative_path), hasS3: Boolean(asset.s3?.key) });
}

export function contentIcon(type: GrowthAsset['content_type']) {
  if (type === 'image' || type === 'gif') return Image;
  if (type === 'video') return Play;
  if (type === 'doc') return FileText;
  return FileArchive;
}

export function selectedOrFirst(assets: GrowthAsset[], selectedId: string | null): GrowthAsset | undefined {
  return assets.find(asset => asset.asset_id === selectedId) || assets[0];
}

export function canPreview(asset?: GrowthAsset): asset is GrowthAsset {
  return Boolean((asset?.s3?.key || asset?.local?.relative_path) && previewableTypes.has(asset.content_type));
}

export function assetSize(asset: GrowthAsset): number | undefined {
  return asset.s3?.size_bytes || asset.local?.size_bytes;
}

export function assetUpdatedAt(asset: GrowthAsset): string | undefined {
  return asset.s3?.updated_at || asset.local?.updated_at;
}

export function placementSummary(asset: GrowthAsset): string {
  const latest = asset.placements?.at(-1);
  return latest ? `${latest.channel}: ${latest.status}` : 'not posted';
}
