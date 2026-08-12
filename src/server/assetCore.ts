import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createS3StorageAdapter } from './adapters/storage';
import { listLocalReviewAssets, localPreviewPath as resolveLocalPreviewPath } from './localReview';
import { syncLedgerPlacement } from './assetLedgerWorkflow';
import { appName } from '../shared/appConstants';
import type {
  AssetCatalog,
  AssetContentType,
  AssetFacets,
  DoctorReport,
  AssetLibrarySnapshot,
  GrowthAsset,
  ListAssetsOptions,
  LiveS3Object,
  MutationResponse,
  PlacementFields,
  PlacementStatus,
  PresignResponse,
  ProjectSummary,
  UploadFields,
} from '../shared/types';

function isPackageRoot(path: string): boolean {
  const packageJson = join(path, 'package.json');
  if (!existsSync(packageJson)) return false;
  try {
    const packageInfo = JSON.parse(readFileSync(packageJson, 'utf8')) as { name?: string };
    return packageInfo.name === '@mean-weasel/lineage';
  } catch {
    return false;
  }
}

function resolvePackageRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.LINEAGE_REPO_ROOT,
    resolve(moduleDir, '..'),
    resolve(moduleDir, '../..'),
    process.cwd(),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const root = candidates.find(isPackageRoot);
  if (!root) throw new Error('Unable to locate Lineage package root');
  return root;
}

export const packageRoot = resolvePackageRoot();
export let repoRoot = resolve(process.env.LINEAGE_ASSET_ROOT || packageRoot);

export function setLineageAssetRoot(path?: string): string {
  repoRoot = resolve(path || packageRoot);
  return repoRoot;
}
export const defaultProject = 'demo-project';
export const defaultProduct = process.env.LINEAGE_DEFAULT_PRODUCT || defaultProject;
const publicFallbackBucket = 'lineage-demo-assets';
const publicFallbackRegion = 'us-east-1';
const contentTypes = new Set<AssetContentType>(['image', 'video', 'gif', 'audio', 'doc', 'other']);
const baseChannels = ['linkedin', 'meta', 'tiktok', 'x-twitter', 'youtube'];
const placementStatuses = new Set<PlacementStatus>(['planned', 'scheduled', 'posted', 'skipped']);
const projectNamePattern = /^[a-z0-9][a-z0-9-]*$/;

interface CommandResult {
  stdout: string;
  stderr: string;
}

class LineageAssetError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isLineageAssetError(error: unknown): error is LineageAssetError {
  return error instanceof LineageAssetError;
}

export function cleanProject(project = defaultProject): string {
  if (!projectNamePattern.test(project)) {
    throw new LineageAssetError('Project must be lowercase kebab-case');
  }
  return project;
}

export function catalogPath(project = defaultProject): string {
  return join(repoRoot, cleanProject(project), 'assets', 'catalog.json');
}

export function assertProjectCatalogPathSafe(project: string): string {
  const safeProject = cleanProject(project);
  const root = realpathSync(repoRoot);
  let candidate = repoRoot;
  for (const segment of [safeProject, 'assets', 'catalog.json']) {
    candidate = join(candidate, segment);
    try {
      if (lstatSync(candidate).isSymbolicLink()) {
        throw new LineageAssetError(`Refusing symlinked project catalog path: ${candidate}`, 409);
      }
      const resolved = realpathSync(candidate);
      const fromRoot = relative(root, resolved);
      if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        throw new LineageAssetError(`Project catalog must remain inside the active asset root: ${candidate}`, 409);
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return catalogPath(safeProject);
}

export function projectCatalogDefinitionExists(project: string): boolean {
  return existsSync(catalogPath(project));
}

export function removeProjectCatalogDefinition(project: string): { path: string; removed: boolean } {
  const path = assertProjectCatalogPathSafe(project);
  if (!existsSync(path)) return { path, removed: false };
  unlinkSync(path);
  return { path, removed: true };
}

function fixtureCatalogPath(project = defaultProject): string {
  return join(packageRoot, 'fixtures', cleanProject(project), 'assets', 'catalog.json');
}

function resolvedCatalogPath(project = defaultProject): string {
  const path = catalogPath(project);
  if (existsSync(path)) return path;
  const clean = cleanProject(project);
  if (clean === defaultProject && existsSync(fixtureCatalogPath(clean))) return fixtureCatalogPath(clean);
  return path;
}

export function normalizeCatalog(catalog: Partial<AssetCatalog>, fallbackProject = defaultProject): AssetCatalog {
  const project = cleanProject(catalog.project || catalog.product || fallbackProject);
  const product = catalog.product || project;
  return {
    ...catalog,
    project,
    product,
    default_bucket: catalog.default_bucket || '',
    default_region: catalog.default_region || '',
    assets: (catalog.assets || []).map(asset => ({
      ...asset,
      source: asset.source || 'catalog',
      project: asset.project || asset.product || project,
      product: asset.product || asset.project || project,
    })),
  };
}

function fallbackS3(assetId: string, channel: string, status = 'working') {
  return {
    bucket: publicFallbackBucket,
    checksum_sha256: undefined,
    content_type: 'image/png',
    key: `products/${defaultProject}/campaigns/2026-06-public-demo/channels/${channel}/audiences/creators/statuses/${status}/types/image/assets/${assetId}/${assetId}.png`,
    region: publicFallbackRegion,
    size_bytes: 2048,
    updated_at: '2026-06-24T12:00:00.000Z',
    version_id: 'public-demo-version',
  };
}

function fallbackAsset(fields: Omit<GrowthAsset, 'audience' | 'campaign' | 'content_type' | 'cta' | 'hook' | 'product' | 'project' | 'source' | 'utm_content'> & {
  audience?: string;
  campaign?: string;
  cta?: string;
  hook?: string;
  utm_content?: string;
}): GrowthAsset {
  return {
    audience: fields.audience || 'creators',
    campaign: fields.campaign || '2026-06-public-demo',
    content_type: 'image',
    cta: fields.cta || 'Save the idea',
    hook: fields.hook || 'Public demo creative for local review.',
    product: defaultProject,
    project: defaultProject,
    source: 'catalog',
    utm_content: fields.utm_content || fields.asset_id.replace(/-/g, '_'),
    ...fields,
  };
}

function defaultFallbackCatalog(): AssetCatalog {
  return normalizeCatalog({
    assets: [
      fallbackAsset({
        asset_id: 'demo-meta-short-form-upload-demo-post-static',
        channel: 'meta',
        s3: fallbackS3('demo-meta-short-form-upload-demo-post-static', 'meta'),
        status: 'working',
        title: 'Meta short-form demo post static',
      }),
      fallbackAsset({
        asset_id: 'demo-linkedin-ledger-catalog-shared',
        channel: 'linkedin',
        hook: 'Shared ledger creative with catalog metadata.',
        s3: fallbackS3('demo-linkedin-ledger-catalog-shared', 'linkedin'),
        status: 'working',
        title: 'LinkedIn ledger catalog shared',
      }),
      fallbackAsset({
        asset_id: 'demo-linkedin-upload-demo-done-static-grounded-v2',
        channel: 'linkedin',
        placements: [{
          channel: 'linkedin',
          notes: 'Synthetic public scheduled placement.',
          scheduled_at: '2026-06-24T16:00:00-07:00',
          status: 'scheduled',
          updated_at: '2026-06-24T12:30:00.000Z',
        }],
        s3: fallbackS3('demo-linkedin-upload-demo-done-static-grounded-v2', 'linkedin', 'approved'),
        status: 'approved',
        title: 'LinkedIn upload demo scheduled static',
      }),
      fallbackAsset({
        asset_id: 'demo-tiktok-upload-demo-export-vertical',
        channel: 'tiktok',
        format: 'vertical',
        hook: 'Fast vertical demo export for content queue tests.',
        s3: fallbackS3('demo-tiktok-upload-demo-export-vertical', 'tiktok'),
        status: 'working',
        title: 'TikTok upload demo export vertical',
      }),
      fallbackAsset({
        asset_id: 'demo-youtube-short-demo-posted-cut',
        channel: 'youtube',
        placements: [{
          channel: 'youtube',
          notes: 'Synthetic public posted placement.',
          posted_at: '2026-06-25T16:00:00-07:00',
          status: 'posted',
          updated_at: '2026-06-25T17:00:00.000Z',
        }],
        s3: fallbackS3('demo-youtube-short-demo-posted-cut', 'youtube', 'published'),
        status: 'published',
        title: 'YouTube short demo posted cut',
      }),
      fallbackAsset({
        asset_id: 'demo-x-twitter-carousel-demo-working-static',
        channel: 'x-twitter',
        format: 'static',
        s3: fallbackS3('demo-x-twitter-carousel-demo-working-static', 'x-twitter'),
        status: 'working',
        title: 'X Twitter carousel demo working static',
      }),
    ],
    default_bucket: '',
    default_region: '',
    product: defaultProject,
    project: defaultProject,
  }, defaultProject);
}

function isDefaultFallbackCatalog(catalog: AssetCatalog): boolean {
  return catalog.project === defaultProject && !existsSync(catalogPath(defaultProject));
}

function fallbackPreviewDataUrl(asset: GrowthAsset): string {
  const label = `${asset.title}\n${asset.channel} / ${asset.status}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#f7f5ef"/><rect x="56" y="56" width="1088" height="563" rx="18" fill="#10201c"/><text x="96" y="145" fill="#9fe6c8" font-family="Arial, sans-serif" font-size="34" font-weight="700">Lineage public demo preview</text><text x="96" y="230" fill="#fff8e6" font-family="Arial, sans-serif" font-size="56" font-weight="700">${escapeSvgText(asset.asset_id)}</text><text x="96" y="330" fill="#d9e8df" font-family="Arial, sans-serif" font-size="34">${escapeSvgText(label)}</text><text x="96" y="500" fill="#9fb7ae" font-family="Arial, sans-serif" font-size="26">Synthetic local placeholder. No external storage requested.</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function loadCatalog(project = defaultProject): AssetCatalog {
  const path = catalogPath(project);
  if (existsSync(path)) {
    try {
      return normalizeCatalog(JSON.parse(readFileSync(path, 'utf8')) as Partial<AssetCatalog>, project);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new LineageAssetError(`Missing catalog: ${path}`, 404);
      }
      throw error;
    }
  }
  const clean = cleanProject(project);
  if (clean === defaultProject) {
    const fixturePath = fixtureCatalogPath(clean);
    if (existsSync(fixturePath)) {
      return normalizeCatalog(JSON.parse(readFileSync(fixturePath, 'utf8')) as Partial<AssetCatalog>, project);
    }
    return defaultFallbackCatalog();
  }
  throw new LineageAssetError(`Missing catalog: ${path}`, 404);
}

function saveCatalog(project: string, catalog: AssetCatalog): AssetCatalog {
  const normalized = normalizeCatalog(catalog, project);
  mkdirSync(dirname(catalogPath(project)), { recursive: true });
  writeFileSync(catalogPath(project), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

function run(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AWS_REGION: process.env.AWS_REGION || 'us-east-1',
      AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION || 'us-east-1',
    },
  });

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new LineageAssetError(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`, 502);
  }

  return { stdout: result.stdout, stderr: result.stderr };
}

function runAws(args: string[]): CommandResult {
  return run('aws', args);
}

export function listProjects(): ProjectSummary[] {
  const projects = readdirSync(repoRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && projectNamePattern.test(entry.name) && existsSync(catalogPath(entry.name)))
    .flatMap(entry => {
      try {
        const catalog = loadCatalog(entry.name);
        return [{ project: catalog.project, product: catalog.product, catalogPath: resolvedCatalogPath(entry.name), default_bucket: catalog.default_bucket, default_region: catalog.default_region, asset_count: catalog.assets.length }];
      } catch (error) {
        if (error instanceof LineageAssetError && error.status === 404) return [];
        throw error;
      }
    })
    .sort((a, b) => a.project.localeCompare(b.project));
  if (!projects.some(item => item.project === defaultProject)) {
    const catalog = loadCatalog(defaultProject);
    projects.push({ project: catalog.project, product: catalog.product, catalogPath: resolvedCatalogPath(defaultProject), default_bucket: catalog.default_bucket, default_region: catalog.default_region, asset_count: catalog.assets.length });
    projects.sort((a, b) => a.project.localeCompare(b.project));
  }
  return projects;
}

function assetById(catalog: AssetCatalog, assetId: string): GrowthAsset {
  const asset = catalog.assets.find(item => item.asset_id === assetId);
  if (!asset) throw new LineageAssetError(`Unknown asset: ${assetId}`, 404);
  return asset;
}

const storageAdapter = createS3StorageAdapter({
  assetById,
  cleanProject,
  createError: (message, status) => new LineageAssetError(message, status),
  defaultProject,
  loadCatalog,
  runAws,
  repoRoot,
  saveCatalog,
  supportedContentTypes: contentTypes,
});

function uniqueSorted<T extends string>(values: Array<T | undefined>): T[] {
  return Array.from(new Set(values.filter(Boolean) as T[])).sort();
}

function facetsFor(assets: GrowthAsset[]): AssetFacets {
  return {
    audiences: uniqueSorted(assets.map(asset => asset.audience)),
    campaigns: uniqueSorted(assets.map(asset => asset.campaign)),
    channels: uniqueSorted([...baseChannels, ...assets.map(asset => asset.channel)]),
    contentTypes: uniqueSorted(assets.map(asset => asset.content_type)),
    placementStatuses: uniqueSorted(assets.flatMap(asset => asset.placements?.map(placement => placement.status) || [])),
    statuses: uniqueSorted(assets.map(asset => asset.status)),
    totalSizeBytes: assets.reduce((sum, asset) => sum + (asset.s3?.size_bytes || 0), 0),
  };
}

function filteredAssets(assets: GrowthAsset[], options: ListAssetsOptions): GrowthAsset[] {
  const query = options.query?.trim().toLowerCase();
  return assets.filter(asset => {
    if (options.status && options.status !== 'all' && asset.status !== options.status) return false;
    if (options.channel && options.channel !== 'all' && asset.channel !== options.channel) return false;
    if (options.type && options.type !== 'all' && asset.content_type !== options.type) return false;
    if (options.placementStatus === 'not-posted' && asset.placements?.some(placement => placement.status === 'posted')) return false;
    if (options.placementStatus && !['all', 'not-posted'].includes(options.placementStatus) && !asset.placements?.some(placement => placement.status === options.placementStatus)) return false;
    if (options.campaign && options.campaign !== 'all' && asset.campaign !== options.campaign) return false;
    if (options.audience && options.audience !== 'all' && asset.audience !== options.audience) return false;
    if (!query) return true;
    return [asset.asset_id, asset.title, asset.campaign, asset.channel, asset.audience, asset.hook, asset.cta]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}

export function listAssets(project = defaultProject, options: ListAssetsOptions = {}): AssetLibrarySnapshot {
  const catalog = loadCatalog(project);
  const pageSize = Math.min(Math.max(Number(options.pageSize || 10), 1), 100);
  const page = Math.max(Number(options.page || 1), 1);
  const localAssets = listLocalReviewAssets(repoRoot, catalog.project, catalog);
  const source = options.source || 'catalog';
  const sourceAssets = source === 'local' ? localAssets : source === 'all' ? [...localAssets, ...catalog.assets] : catalog.assets;
  const filtered = filteredAssets(sourceAssets, options);
  const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1);
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageAssets = filtered.slice(start, start + pageSize);
  let liveObjects: LiveS3Object[] = [];
  let error: string | undefined;
  if (options.includeLive && !isDefaultFallbackCatalog(catalog)) {
    try {
      liveObjects = storageAdapter.listLiveObjects(catalog);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    catalog: { project: catalog.project, product: catalog.product, default_bucket: catalog.default_bucket, default_region: catalog.default_region, asset_count: catalog.assets.length },
    assets: pageAssets,
    facets: facetsFor(catalog.assets),
    pagination: { page: safePage, pageSize, total: filtered.length, totalPages },
    liveObjects,
    orphanObjects: liveObjects.filter(object => !object.cataloged),
    identity: options.includeLive && !isDefaultFallbackCatalog(catalog) ? storageAdapter.getIdentity() : undefined,
    fetchedAt: new Date().toISOString(),
    error,
  };
}

export function inspectAsset(project: string, assetId: string): GrowthAsset {
  return assetById(loadCatalog(project), assetId);
}

export function validateProject(project = defaultProject): ProjectSummary {
  const catalog = loadCatalog(project);
  return { project: catalog.project, product: catalog.product, catalogPath: resolvedCatalogPath(project), default_bucket: catalog.default_bucket, default_region: catalog.default_region, asset_count: catalog.assets.length };
}

export function doctorProject(project = defaultProject, options: { includeLive?: boolean } = {}): DoctorReport {
  const summary = validateProject(project);
  let liveCheck: DoctorReport['liveCheck'] = 'skipped';
  let liveError: string | undefined;
  if (options.includeLive && isDefaultFallbackCatalog(loadCatalog(project))) {
    liveCheck = 'skipped';
    liveError = `${appName} public fallback uses local catalog data only.`;
  } else if (options.includeLive) {
    try {
      storageAdapter.listLiveObjects(loadCatalog(project));
      liveCheck = 'ok';
    } catch (error) {
      liveCheck = 'error';
      liveError = error instanceof Error ? error.message : String(error);
    }
  }
  return { catalogExists: true, deleteEnabled: process.env.LINEAGE_ENABLE_CLOUD_DELETE === 'true', project: summary, liveCheck, liveError };
}

export function pullAsset(project: string, assetId: string, out = '.asset-scratch'): MutationResponse {
  return storageAdapter.pullAsset(project, assetId, out);
}

function placementFromFields(fields: PlacementFields) {
  if (!fields.channel) throw new LineageAssetError('Placement requires channel');
  if (!placementStatuses.has(fields.status)) throw new LineageAssetError(`Unsupported placement status: ${fields.status}`);
  const now = new Date().toISOString();
  return {
    channel: fields.channel,
    status: fields.status,
    ...(fields.scheduledAt ? { scheduled_at: fields.scheduledAt } : {}),
    ...(fields.postedAt ? { posted_at: fields.postedAt } : {}),
    ...(fields.url ? { url: fields.url } : {}),
    ...(fields.notes ? { notes: fields.notes } : {}),
    updated_at: now,
  };
}

export function previewPlacement(project: string, fields: PlacementFields) {
  const asset = inspectAsset(project, fields.assetId);
  return { asset_id: asset.asset_id, placement: placementFromFields(fields) };
}

export function updatePlacement(project: string, fields: PlacementFields): MutationResponse {
  if (!fields.confirmWrite) throw new LineageAssetError('Placement updates require confirmWrite=true');
  const catalog = loadCatalog(project);
  const asset = assetById(catalog, fields.assetId);
  const placement = placementFromFields(fields);
  const existing = asset.placements?.findIndex(item => item.channel === placement.channel);
  if (existing !== undefined && existing >= 0) asset.placements![existing] = placement;
  else asset.placements = [...(asset.placements || []), placement];
  saveCatalog(project, catalog);
  syncLedgerPlacement(project, asset.asset_id, placement);
  return { ok: true, message: `Marked ${asset.asset_id} ${placement.status} for ${placement.channel}`, catalog };
}

export function presignAsset(project: string, assetId: string, expiresIn = 900): PresignResponse {
  const catalog = loadCatalog(project);
  if (isDefaultFallbackCatalog(catalog)) {
    const asset = assetById(catalog, assetId);
    return { assetId: asset.asset_id, expiresIn, url: fallbackPreviewDataUrl(asset) };
  }
  return storageAdapter.presignAsset(project, assetId, expiresIn);
}

export function localPreviewPath(relativePath: string): string {
  try {
    return resolveLocalPreviewPath(repoRoot, relativePath);
  } catch (error) {
    throw new LineageAssetError(error instanceof Error ? error.message : 'Unknown local review asset', 404);
  }
}

export function promoteAsset(project: string, assetId: string, confirmWrite: boolean): MutationResponse {
  return storageAdapter.promoteAsset(project, assetId, confirmWrite);
}

export function archiveAsset(project: string, assetId: string, confirmArchive: boolean): MutationResponse {
  if (!confirmArchive) throw new LineageAssetError('Archive requires confirmArchive=true');
  const catalog = loadCatalog(project);
  const asset = assetById(catalog, assetId);
  asset.status = 'archived';
  saveCatalog(project, catalog);
  return { ok: true, message: `Archived ${assetId}`, catalog };
}

export function uploadAsset(file: string, fields: UploadFields): MutationResponse {
  return storageAdapter.uploadAsset(file, fields);
}

export function deleteObjectGuarded(project: string, assetId: string, confirmation: string): MutationResponse {
  return storageAdapter.deleteObjectGuarded(project, assetId, confirmation);
}

export function ensureUploadDir(): string {
  const dir = join(repoRoot, '.asset-scratch', 'studio-uploads');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

export function cleanupUploadedTemp(file?: string): void {
  if (!file) return;
  const uploadRoot = ensureUploadDir();
  const resolved = resolve(file);
  if (resolved.startsWith(`${uploadRoot}/`) && existsSync(resolved)) {
    unlinkSync(resolved);
  }
}
