import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { requireEdgeSummary } from '../shared/edgeSummary';
import { defaultProject, packageRoot, repoRoot } from './assetCore';
import { linkLineageAssets, updateLineageLayout, updateSelectedAsset } from './assetLineage';
import { lineageDb, nowIso } from './assetLineageDb';
import { archiveLineageWorkspace, createLineageWorkspace, isLineageWorkspaceError, lineageWorkspaceId, listLineageWorkspaces, updateLineageWorkspace } from './assetLineageWorkspaces';
import {
  ensureSwissifierDemoProject,
  restoreSwissifierDemoProjectDefinition,
  swissifierDemoProject,
} from './projectWorkspaces';
import { fileSha256 } from './localReview';

const demoWorkspaceTitle = 'Demo: Content iteration tree';
const demoWorkspaceNotes = 'Repeatable sample lineage for demos and onboarding. Archive it when reviewing real work.';
const demoBasePath = ['lineage-demo', '2026-06-lineage-demo'];
const swissifierManifestPath = join(packageRoot, 'fixtures', defaultProject, 'lineage', 'swissifier-rich-demo.json');
const legacyDemoSelectionPrompt = 'Demo selected winner for the next variation.';
const legacySwissifierSelectionPrompt = 'Swissifier rich demo bases selected for the next variation.';

function clearLegacySeedSelectionPrompt(project: string, rootAssetId: string, prompt: string): void {
  const database = lineageDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(`
      update asset_selections
      set notes = null
      where project_id = ? and root_asset_id = ? and notes = ?
        and asset_id not in (
          select target_asset_id from lineage_tasks
          where project_id = ? and root_asset_id = ? and task_type = 'iterate'
            and status in ('claimed', 'in_progress')
        )
    `).run(project, rootAssetId, prompt, project, rootAssetId);
    database.prepare(`
      update lineage_tasks
      set instructions = null, updated_at = ?
      where project_id = ? and root_asset_id = ? and task_type = 'iterate'
        and status = 'pending' and instructions = ?
    `).run(nowIso(), project, rootAssetId, prompt);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

interface SwissifierManifestAsset {
  asset_id: string;
  file: string;
  title: string;
  channel: string;
  status: string;
  checksum_sha256: string;
  size_bytes: number;
  content_type: string;
  position: { x: number; y: number };
}

interface SwissifierManifestRerollAttempt {
  asset_id?: string;
  node_asset_id: string;
  file: string;
  title: string;
  prompt: string;
  generation_job_id: string;
  checksum_sha256: string;
  size_bytes: number;
  content_type: string;
  attempt_index: number;
  current?: boolean;
}

interface SwissifierManifest {
  id: string;
  title: string;
  notes: string;
  campaign: string;
  audience: string;
  media: {
    target_dir: string;
    source_env: string;
    source_hint: string;
    download?: { file: string; url: string; sha256: string; size_bytes: number };
  };
  root_asset_id: string;
  selected_asset_ids: string[];
  assets: SwissifierManifestAsset[];
  edges: Array<{ parent: string; child: string; summary: string }>;
  reroll_attempts?: SwissifierManifestRerollAttempt[];
}

const demoAssets = [
  { key: 'root', channel: 'linkedin', file: 'demo-root.svg', label: 'Initial Demo Concept', fill: '#f6fbfb', stroke: '#0b7f88' },
  { key: 'hookA', channel: 'tiktok', file: 'demo-hook-a-v01.svg', label: 'Hook A v01', fill: '#fff8e6', stroke: '#9a6a00' },
  { key: 'hookB', channel: 'linkedin', file: 'demo-workflow-v01.svg', label: 'Workflow v01', fill: '#eff7ff', stroke: '#2166a5' },
  { key: 'hookC', channel: 'linkedin', file: 'demo-founder-note-v01.svg', label: 'Founder Note v01', fill: '#f6efff', stroke: '#7653a6' },
  { key: 'hookA2', channel: 'tiktok', file: 'demo-hook-a-v02.svg', label: 'Hook A v02', fill: '#fff2cc', stroke: '#9a6a00' },
  { key: 'hookA3', channel: 'tiktok', file: 'demo-before-after-v02.svg', label: 'Before / After v02', fill: '#fff2cc', stroke: '#9a6a00' },
  { key: 'hookB2', channel: 'linkedin', file: 'demo-workflow-v02.svg', label: 'Workflow v02', fill: '#e6f3ff', stroke: '#2166a5' },
  { key: 'hookB3', channel: 'linkedin', file: 'demo-product-v02.svg', label: 'Product v02', fill: '#e6f3ff', stroke: '#2166a5' },
  { key: 'winner', channel: 'linkedin', file: 'demo-product-v03.svg', label: 'Selected Product v03', fill: '#eaf8ef', stroke: '#2e7d4f' },
  { key: 'alt', channel: 'tiktok', file: 'demo-action-v03.svg', label: 'Action v03', fill: '#fff2cc', stroke: '#9a6a00' },
] as const;

const demoEdges = [
  ['root', 'hookA'],
  ['root', 'hookB'],
  ['root', 'hookC'],
  ['hookA', 'hookA2'],
  ['hookA', 'hookA3'],
  ['hookB', 'hookB2'],
  ['hookB', 'hookB3'],
  ['hookB3', 'winner'],
  ['hookA3', 'alt'],
] as const;

const demoPositions = new Map<string, { x: number; y: number }>([
  ['root', { x: 0, y: 160 }],
  ['hookA', { x: 340, y: 0 }],
  ['hookB', { x: 340, y: 190 }],
  ['hookC', { x: 340, y: 380 }],
  ['hookA2', { x: 700, y: -80 }],
  ['hookA3', { x: 700, y: 80 }],
  ['hookB2', { x: 700, y: 230 }],
  ['hookB3', { x: 700, y: 390 }],
  ['winner', { x: 1060, y: 350 }],
  ['alt', { x: 1060, y: 80 }],
]);

function demoProjectDir(project: string): string {
  return join(repoRoot, '.asset-scratch', ...demoBasePath, project);
}

function demoRelativePath(project: string, asset: typeof demoAssets[number]): string {
  return join(...demoBasePath, project, asset.channel, asset.file);
}

function demoFilePath(project: string, asset: typeof demoAssets[number]): string {
  return join(demoProjectDir(project), asset.channel, asset.file);
}

function swissifierManifest(): SwissifierManifest {
  return JSON.parse(readFileSync(swissifierManifestPath, 'utf8')) as SwissifierManifest;
}

function projectScopedDemoAssetId(project: string, assetId: string): string {
  const database = lineageDb();
  try {
    const owner = database.prepare('select project_id from assets where id = ?')
      .get(assetId) as { project_id: string } | undefined;
    const suffix = createHash('sha256').update(`${project}\0${assetId}`).digest('hex').slice(0, 16);
    const alias = `${assetId}--${suffix}`;
    const aliasOwner = database.prepare('select project_id from assets where id = ?')
      .get(alias) as { project_id: string } | undefined;
    if (owner?.project_id === project) return assetId;
    if (aliasOwner?.project_id === project) return alias;
    if (aliasOwner && aliasOwner.project_id !== project) {
      throw new Error(`Project-scoped Swissifier asset identity collision for ${assetId}`);
    }
    return owner ? alias : assetId;
  } finally {
    database.close();
  }
}

function projectScopedSwissifierManifest(project: string, source = swissifierManifest()): SwissifierManifest {
  if (project !== swissifierDemoProject) return source;
  const assetIds = new Map(source.assets.map(asset => [
    asset.asset_id,
    projectScopedDemoAssetId(project, asset.asset_id),
  ]));
  const mapped = (assetId: string) => assetIds.get(assetId) || projectScopedDemoAssetId(project, assetId);
  return {
    ...source,
    root_asset_id: mapped(source.root_asset_id),
    selected_asset_ids: source.selected_asset_ids.map(mapped),
    assets: source.assets.map(asset => ({ ...asset, asset_id: mapped(asset.asset_id) })),
    edges: source.edges.map(edge => ({
      ...edge,
      parent: mapped(edge.parent),
      child: mapped(edge.child),
    })),
    reroll_attempts: source.reroll_attempts?.map(attempt => ({
      ...attempt,
      asset_id: projectScopedDemoAssetId(project, `local-${attempt.checksum_sha256.slice(0, 12)}`),
      node_asset_id: mapped(attempt.node_asset_id),
    })),
  };
}

export function swissifierRichDemoRootAssetId(project?: string): string {
  const manifest = swissifierManifest();
  return project ? projectScopedSwissifierManifest(project, manifest).root_asset_id : manifest.root_asset_id;
}

export function ensureSwissifierRichDemoWorkspace() {
  const project = ensureSwissifierDemoProject();
  if (!project) return null;
  const manifest = projectScopedSwissifierManifest(swissifierDemoProject);
  const existing = listLineageWorkspaces(swissifierDemoProject).workspaces
    .find(workspace => workspace.root_asset_id === manifest.root_asset_id);
  if (existing) {
    return {
      ok: true as const,
      message: `Using ${manifest.title}`,
      demo_id: manifest.id,
      root_asset_id: manifest.root_asset_id,
      workspace: existing,
      project,
      seeded: false,
    };
  }
  const database = lineageDb();
  try {
    const deleted = database.prepare(`
      select 1 from deleted_lineage_workspaces where project_id = ? and root_asset_id = ?
    `).get(swissifierDemoProject, manifest.root_asset_id);
    if (deleted) {
      return {
        ok: true as const,
        message: 'Swissifier rich demo workspace remains permanently deleted',
        demo_id: manifest.id,
        root_asset_id: manifest.root_asset_id,
        workspace: null,
        project,
        seeded: false,
        workspace_deleted: true as const,
      };
    }
  } finally {
    database.close();
  }
  const seeded = seedSwissifierRichDemoWorkspace(swissifierDemoProject, {
    activate: false,
    confirmWrite: true,
  });
  return { ...seeded, project, seeded: true };
}

export function restoreSwissifierRichDemoProject(confirmWrite: boolean) {
  if (!confirmWrite) {
    return {
      ok: true as const,
      dryRun: true as const,
      project: swissifierDemoProject,
      root_asset_id: swissifierRichDemoRootAssetId(swissifierDemoProject),
    };
  }
  restoreSwissifierDemoProjectDefinition(true);
  const restored = ensureSwissifierRichDemoWorkspace();
  if (!restored?.workspace) {
    const reason = restored && 'migration_deferred' in restored && restored.migration_deferred
      ? restored.message
      : 'Swissifier Demo restore did not produce a workspace';
    throw new Error(reason);
  }
  return {
    ...restored,
    message: 'Restored Swissifier Demo project',
  };
}

function swissifierRelativePath(manifest: SwissifierManifest, asset: SwissifierManifestAsset): string {
  return join(manifest.media.target_dir, asset.file);
}

function swissifierFilePath(manifest: SwissifierManifest, asset: SwissifierManifestAsset): string {
  return join(repoRoot, '.asset-scratch', swissifierRelativePath(manifest, asset));
}

function swissifierRerollRelativePath(manifest: SwissifierManifest, attempt: SwissifierManifestRerollAttempt): string {
  return join(manifest.media.target_dir, 'reroll-attempts', attempt.file);
}

function swissifierRerollFilePath(manifest: SwissifierManifest, attempt: SwissifierManifestRerollAttempt): string {
  return join(repoRoot, '.asset-scratch', swissifierRerollRelativePath(manifest, attempt));
}

function swissifierRerollFixturePath(attempt: SwissifierManifestRerollAttempt): string {
  return join(dirname(swissifierManifestPath), 'swissifier-rerolls', attempt.file);
}

function swissifierSourcePath(manifest: SwissifierManifest, asset: SwissifierManifestAsset, sourceDir: string): string | null {
  const direct = join(sourceDir, asset.file);
  if (existsSync(direct)) return direct;
  const nested = join(sourceDir, manifest.media.target_dir, asset.file);
  return existsSync(nested) ? nested : null;
}

function swissifierMediaState(manifest: SwissifierManifest) {
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const asset of manifest.assets) {
    const relativePath = swissifierRelativePath(manifest, asset);
    const path = swissifierFilePath(manifest, asset);
    if (!existsSync(path)) {
      missing.push(relativePath);
      continue;
    }
    if (fileSha256(path) !== asset.checksum_sha256) invalid.push(relativePath);
  }
  return { invalid, missing };
}

function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

function safeTarEntryName(rawName: string): string {
  const stripped = rawName.replace(/\0.*$/, '').replace(/^\.\//, '');
  if (!stripped || stripped === '.') return '';
  if (stripped.includes('\\') || stripped.startsWith('/') || /^[A-Za-z]:/.test(stripped)) {
    throw new Error(`Unsafe Swissifier media archive path: ${rawName}`);
  }
  const normalized = posix.normalize(stripped);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    throw new Error(`Unsafe Swissifier media archive path: ${rawName}`);
  }
  return normalized;
}

function tarOctal(header: Buffer, start: number, length: number): number {
  const raw = header.toString('utf8', start, start + length).replace(/\0.*$/, '').trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) throw new Error(`Invalid Swissifier media archive size: ${raw}`);
  return Number.parseInt(raw, 8);
}

function tarName(header: Buffer): string {
  const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
  const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '');
  return prefix ? `${prefix}/${name}` : name;
}

function isAppleDoubleEntry(name: string): boolean {
  return name === '._.' || name.startsWith('._') || name.includes('/._');
}

function extractSwissifierMediaArchive(archive: Buffer, manifest: SwissifierManifest, destination: string) {
  const expected = new Map(manifest.assets.map(asset => [asset.file, asset]));
  const extracted = new Set<string>();
  const body = gunzipSync(archive);
  let offset = 0;
  while (offset + 512 <= body.length) {
    const header = body.subarray(offset, offset + 512);
    offset += 512;
    if (header.every(byte => byte === 0)) break;
    const typeflag = header.toString('utf8', 156, 157);
    const rawName = tarName(header);
    const name = safeTarEntryName(rawName);
    const size = tarOctal(header, 124, 12);
    const nextOffset = offset + Math.ceil(size / 512) * 512;
    if (nextOffset > body.length) throw new Error(`Truncated Swissifier media archive entry: ${rawName}`);
    if (!name || typeflag === '5') {
      offset = nextOffset;
      continue;
    }
    if (typeflag === 'x' || typeflag === 'g') {
      offset = nextOffset;
      continue;
    }
    if (isAppleDoubleEntry(name)) {
      offset = nextOffset;
      continue;
    }
    if (typeflag && typeflag !== '0') throw new Error(`Unsupported Swissifier media archive entry type for ${name}`);
    const directName = name.startsWith(`${manifest.media.target_dir}/`) ? name.slice(manifest.media.target_dir.length + 1) : name;
    const asset = expected.get(directName);
    if (!asset) throw new Error(`Unexpected Swissifier media archive entry: ${name}`);
    if (size !== asset.size_bytes) throw new Error(`Unexpected Swissifier media archive size for ${name}`);
    const file = body.subarray(offset, offset + size);
    const actualSha = sha256Hex(file);
    if (actualSha !== asset.checksum_sha256) throw new Error(`Checksum mismatch for Swissifier media archive entry: ${name}`);
    const target = join(destination, directName);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file);
    extracted.add(directName);
    offset = nextOffset;
  }
  const missing = manifest.assets.map(asset => asset.file).filter(file => !extracted.has(file));
  if (missing.length) throw new Error(`Swissifier media archive missing ${missing.length} expected file${missing.length === 1 ? '' : 's'}`);
  return { extracted: extracted.size };
}

async function downloadBuffer(url: string, maxBytes: number): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Swissifier media download failed with HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new Error(`Swissifier media download is too large: ${contentLength} bytes`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error(`Swissifier media download is too large: ${buffer.length} bytes`);
  return buffer;
}

function missingDemoMedia(project: string): string[] {
  return demoAssets
    .filter(asset => !existsSync(demoFilePath(project, asset)))
    .map(asset => demoRelativePath(project, asset));
}

export function demoSeedMediaStatus(project = defaultProject) {
  const missing = missingDemoMedia(project);
  const present = demoAssets.length - missing.length;
  return {
    ok: true,
    media_root: join(repoRoot, '.asset-scratch'),
    present,
    total: demoAssets.length,
    missing,
    fixture_present: present,
    fixture_total: demoAssets.length,
    fixture_missing: missing,
  };
}

export function swissifierRichDemoMediaStatus(project = defaultProject) {
  const manifest = swissifierManifest();
  const { invalid, missing } = swissifierMediaState(manifest);
  const present = manifest.assets.length - missing.length - invalid.length;
  return {
    ok: true,
    demo_id: manifest.id,
    project,
    media_root: join(repoRoot, '.asset-scratch'),
    media_target: manifest.media.target_dir,
    download_available: Boolean(manifest.media.download),
    download_file: manifest.media.download?.file,
    download_sha256: manifest.media.download?.sha256,
    download_url: manifest.media.download?.url,
    source_env: manifest.media.source_env,
    source_hint: manifest.media.source_hint,
    present,
    total: manifest.assets.length,
    missing,
    invalid,
    fixture_present: present,
    fixture_total: manifest.assets.length,
    fixture_missing: [...missing, ...invalid],
  };
}

export async function downloadSwissifierRichDemoMedia(project = defaultProject, fields: { confirmWrite: boolean; sourceUrl?: string; expectedSha256?: string } = { confirmWrite: false }) {
  const manifest = swissifierManifest();
  const download = manifest.media.download;
  if (!download) {
    return {
      ok: true as const,
      demo_id: manifest.id,
      project,
      download_available: false,
      restored: 0,
      total: manifest.assets.length,
    };
  }
  const sourceUrl = fields.sourceUrl || download.url;
  const expectedSha256 = fields.expectedSha256 || download.sha256;
  const maxBytes = Math.max(download.size_bytes + 1024 * 1024, download.size_bytes * 1.1);
  const archive = await downloadBuffer(sourceUrl, maxBytes);
  const archiveSha256 = sha256Hex(archive);
  if (archiveSha256 !== expectedSha256) throw new Error(`Swissifier media download checksum mismatch: expected ${expectedSha256}, got ${archiveSha256}`);
  if (!fields.confirmWrite) {
    return {
      ok: true as const,
      demo_id: manifest.id,
      project,
      dryRun: true as const,
      download_available: true,
      download_file: download.file,
      download_url: sourceUrl,
      archive_sha256: archiveSha256,
      restored: 0,
      total: manifest.assets.length,
      would_restore: manifest.assets.length,
    };
  }
  const sourceDir = mkdtempSync(join(tmpdir(), 'lineage-swissifier-media-'));
  try {
    const extracted = extractSwissifierMediaArchive(archive, manifest, sourceDir);
    const restored = restoreSwissifierRichDemoMedia(project, { confirmWrite: true, sourceDir });
    return {
      ...restored,
      download_available: true,
      download_file: download.file,
      download_url: sourceUrl,
      archive_sha256: archiveSha256,
      extracted: extracted.extracted,
      media_status: swissifierRichDemoMediaStatus(project),
    };
  } finally {
    rmSync(sourceDir, { force: true, recursive: true });
  }
}

export function restoreDemoSeedMedia(project = defaultProject, fields: { confirmWrite: boolean } = { confirmWrite: false }) {
  const missing = new Set(missingDemoMedia(project));
  if (fields.confirmWrite) {
    for (const asset of demoAssets) {
      if (missing.has(demoRelativePath(project, asset))) writeDemoFile(project, asset);
    }
  }
  return {
    ok: true as const,
    dryRun: !fields.confirmWrite,
    media_root: join(repoRoot, '.asset-scratch'),
    restored: fields.confirmWrite ? missing.size : 0,
    total: demoAssets.length,
    would_restore: fields.confirmWrite ? 0 : missing.size,
    missing: Array.from(missing),
  };
}

export function restoreSwissifierRichDemoMedia(project = defaultProject, fields: { confirmWrite: boolean; sourceDir?: string } = { confirmWrite: false }) {
  const manifest = swissifierManifest();
  const before = swissifierMediaState(manifest);
  const sourceDir = fields.sourceDir || process.env[manifest.media.source_env];
  if (!sourceDir) {
    return {
      ok: true as const,
      demo_id: manifest.id,
      project,
      dryRun: !fields.confirmWrite,
      media_root: join(repoRoot, '.asset-scratch'),
      restored: 0,
      total: manifest.assets.length,
      would_restore: 0,
      source_required: true,
      source_env: manifest.media.source_env,
      source_hint: manifest.media.source_hint,
      missing: before.missing,
      invalid: before.invalid,
      unavailable: [...before.missing, ...before.invalid],
    };
  }
  const unavailable: string[] = [];
  const copyable: Array<{ asset: SwissifierManifestAsset; source: string }> = [];
  const wanted = new Set([...before.missing, ...before.invalid]);
  for (const asset of manifest.assets) {
    const relativePath = swissifierRelativePath(manifest, asset);
    if (!wanted.has(relativePath)) continue;
    const source = swissifierSourcePath(manifest, asset, sourceDir);
    if (!source || fileSha256(source) !== asset.checksum_sha256) {
      unavailable.push(relativePath);
      continue;
    }
    copyable.push({ asset, source });
  }
  if (fields.confirmWrite) {
    for (const item of copyable) {
      const target = swissifierFilePath(manifest, item.asset);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(item.source, target);
    }
  }
  return {
    ok: true as const,
    demo_id: manifest.id,
    project,
    dryRun: !fields.confirmWrite,
    media_root: join(repoRoot, '.asset-scratch'),
    restored: fields.confirmWrite ? copyable.length : 0,
    total: manifest.assets.length,
    would_restore: fields.confirmWrite ? 0 : copyable.length,
    source_required: false,
    source_env: manifest.media.source_env,
    source_hint: manifest.media.source_hint,
    missing: before.missing,
    invalid: before.invalid,
    unavailable,
  };
}

function svg(label: string, fill: string, stroke: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <rect width="1200" height="675" rx="42" fill="${fill}"/>
  <rect x="60" y="60" width="1080" height="555" rx="34" fill="#ffffff" stroke="${stroke}" stroke-width="12"/>
  <text x="600" y="310" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="68" font-weight="800" fill="#1f2a33">${label}</text>
  <text x="600" y="390" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700" fill="${stroke}">Lineage demo lineage</text>
</svg>
`;
}

function assetIdFor(asset: typeof demoAssets[number]): string {
  return `local-${createHash('sha256').update(svg(asset.label, asset.fill, asset.stroke)).digest('hex').slice(0, 12)}`;
}

function demoAssetIds(): Record<string, string> {
  return Object.fromEntries(demoAssets.map(asset => [asset.key, assetIdFor(asset)]));
}

function writeDemoFile(project: string, asset: typeof demoAssets[number]): void {
  const path = demoFilePath(project, asset);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, svg(asset.label, asset.fill, asset.stroke));
}

function writeDemoFiles(project: string): Record<string, string> {
  const ids = demoAssetIds();
  for (const asset of demoAssets) writeDemoFile(project, asset);
  return ids;
}

function swissifierRerollAsset(attempt: SwissifierManifestRerollAttempt) {
  const source = swissifierRerollFixturePath(attempt);
  if (!existsSync(source)) throw new Error(`Missing Swissifier re-roll fixture media: ${attempt.file}`);
  const body = readFileSync(source);
  if (body.length !== attempt.size_bytes) throw new Error(`Unexpected Swissifier re-roll fixture size for ${attempt.file}`);
  const checksumSha256 = sha256Hex(body);
  if (checksumSha256 !== attempt.checksum_sha256) throw new Error(`Checksum mismatch for Swissifier re-roll fixture: ${attempt.file}`);
  const sourceAssetId = `local-${checksumSha256.slice(0, 12)}`;
  return {
    assetId: attempt.asset_id || sourceAssetId,
    checksumSha256,
    sizeBytes: body.length,
  };
}

function writeSwissifierRerollFiles(manifest: SwissifierManifest) {
  for (const attempt of manifest.reroll_attempts || []) {
    swissifierRerollAsset(attempt);
    const target = swissifierRerollFilePath(manifest, attempt);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(swissifierRerollFixturePath(attempt), target);
  }
}

function upsertDemoAssets(project: string, ids: Record<string, string>) {
  const database = lineageDb();
  const timestamp = nowIso();
  try {
    database.prepare(`
      insert into projects (id, product, catalog_path, created_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set product = excluded.product, updated_at = excluded.updated_at
    `).run(project, project, join(repoRoot, project, 'assets', 'catalog.json'), timestamp, timestamp);
    const assetStatement = database.prepare(`
      insert into assets (
        id, project_id, source, local_path, s3_key, checksum_sha256, media_type, title, status,
        channel, campaign, audience, size_bytes, content_type, created_at, updated_at, last_seen_at
      ) values (?, ?, 'local', ?, null, ?, 'image', ?, 'planned', ?, '2026-06-lineage-demo', 'demo', ?, 'image/svg+xml', ?, ?, ?)
      on conflict(id) do update set
        project_id = excluded.project_id, source = excluded.source, local_path = excluded.local_path, checksum_sha256 = excluded.checksum_sha256,
        media_type = excluded.media_type, title = excluded.title, status = excluded.status, channel = excluded.channel,
        campaign = excluded.campaign, audience = excluded.audience, size_bytes = excluded.size_bytes,
        content_type = excluded.content_type, updated_at = excluded.updated_at, last_seen_at = excluded.last_seen_at
    `);
    const reviewStatement = database.prepare(`
      insert into asset_reviews (asset_id, review_state, updated_at)
      values (?, 'unreviewed', ?)
      on conflict(asset_id) do nothing
    `);
    for (const asset of demoAssets) {
      const body = svg(asset.label, asset.fill, asset.stroke);
      assetStatement.run(
        ids[asset.key],
        project,
        demoRelativePath(project, asset),
        createHash('sha256').update(body).digest('hex'),
        asset.label,
        asset.channel,
        Buffer.byteLength(body),
        timestamp,
        timestamp,
        timestamp
      );
      reviewStatement.run(ids[asset.key], timestamp);
    }
  } finally {
    database.close();
  }
  return { catalog: 0, local: demoAssets.length, total: demoAssets.length };
}

function upsertSwissifierAssets(project: string, manifest: SwissifierManifest) {
  const database = lineageDb();
  const timestamp = nowIso();
  try {
    database.prepare(`
      insert into projects (id, product, catalog_path, created_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set product = excluded.product, updated_at = excluded.updated_at
    `).run(project, project, join(repoRoot, project, 'assets', 'catalog.json'), timestamp, timestamp);
    const assetStatement = database.prepare(`
      insert into assets (
        id, project_id, source, local_path, s3_key, checksum_sha256, media_type, title, status,
        channel, campaign, audience, size_bytes, content_type, created_at, updated_at, last_seen_at
      ) values (?, ?, 'local', ?, null, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        project_id = excluded.project_id, source = excluded.source, local_path = excluded.local_path, checksum_sha256 = excluded.checksum_sha256,
        media_type = excluded.media_type, title = excluded.title, status = excluded.status, channel = excluded.channel,
        campaign = excluded.campaign, audience = excluded.audience, size_bytes = excluded.size_bytes,
        content_type = excluded.content_type, updated_at = excluded.updated_at, last_seen_at = excluded.last_seen_at
    `);
    const reviewStatement = database.prepare(`
      insert into asset_reviews (asset_id, review_state, updated_at)
      values (?, 'unreviewed', ?)
      on conflict(asset_id) do nothing
    `);
    for (const asset of manifest.assets) {
      assetStatement.run(
        asset.asset_id,
        project,
        swissifierRelativePath(manifest, asset),
        asset.checksum_sha256,
        asset.title,
        asset.status,
        asset.channel,
        manifest.campaign,
        manifest.audience,
        asset.size_bytes,
        asset.content_type,
        timestamp,
        timestamp,
        timestamp
      );
      reviewStatement.run(asset.asset_id, timestamp);
    }
    for (const attempt of manifest.reroll_attempts || []) {
      const generated = swissifierRerollAsset(attempt);
      assetStatement.run(
        generated.assetId,
        project,
        swissifierRerollRelativePath(manifest, attempt),
        generated.checksumSha256,
        attempt.title,
        'planned',
        'local',
        manifest.campaign,
        manifest.audience,
        generated.sizeBytes,
        attempt.content_type,
        timestamp,
        timestamp,
        timestamp
      );
      reviewStatement.run(generated.assetId, timestamp);
    }
  } finally {
    database.close();
  }
  const attemptCount = manifest.reroll_attempts?.length || 0;
  return { catalog: 0, local: manifest.assets.length + attemptCount, total: manifest.assets.length + attemptCount };
}

function upsertSwissifierRerollAttempts(project: string, manifest: SwissifierManifest) {
  const attempts = manifest.reroll_attempts || [];
  if (attempts.length === 0) return { total: 0 };
  const database = lineageDb();
  const timestamp = nowIso();
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      const nodes = new Set(attempts.map(attempt => attempt.node_asset_id));
      for (const nodeAssetId of nodes) {
        database.prepare('update asset_attempts set is_current = 0 where project_id = ? and node_asset_id = ?').run(project, nodeAssetId);
      }
      const statement = database.prepare(`
        insert into asset_attempts (
          id, project_id, node_asset_id, asset_id, attempt_index, source, prompt, generation_job_id,
          file_path, checksum_sha256, created_at, promoted_at, is_current
        ) values (?, ?, ?, ?, ?, 'reroll', ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          asset_id = excluded.asset_id,
          source = excluded.source,
          prompt = excluded.prompt,
          generation_job_id = excluded.generation_job_id,
          file_path = excluded.file_path,
          checksum_sha256 = excluded.checksum_sha256,
          promoted_at = excluded.promoted_at,
          is_current = excluded.is_current
      `);
      for (const attempt of attempts) {
        const generated = swissifierRerollAsset(attempt);
        statement.run(
          `${project}:${attempt.node_asset_id}:attempt:${attempt.attempt_index}`,
          project,
          attempt.node_asset_id,
          generated.assetId,
          attempt.attempt_index,
          attempt.prompt,
          attempt.generation_job_id,
          swissifierRerollRelativePath(manifest, attempt),
          generated.checksumSha256,
          timestamp,
          timestamp,
          attempt.current ? 1 : 0
        );
      }
      for (const nodeAssetId of nodes) {
        const currentCount = database.prepare('select count(*) count from asset_attempts where project_id = ? and node_asset_id = ? and is_current = 1').get(project, nodeAssetId) as { count: number };
        if (currentCount.count === 0) {
          database.prepare(`
            update asset_attempts
            set is_current = 1, promoted_at = ?
            where id = (
              select id from asset_attempts
              where project_id = ? and node_asset_id = ?
              order by attempt_index desc
              limit 1
            )
          `).run(timestamp, project, nodeAssetId);
        }
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
  return { total: attempts.length };
}

function backfillSwissifierEdgeSummaries(project: string, manifest: SwissifierManifest): void {
  const database = lineageDb();
  const timestamp = nowIso();
  try {
    const statement = database.prepare(`
      update asset_edges
      set summary = ?, summary_created_by = 'system', summary_updated_by = 'system', summary_updated_at = ?
      where project_id = ? and parent_asset_id = ? and child_asset_id = ? and relation_type = 'derived_from'
        and summary is null and summary_created_by is null and summary_updated_by is null and summary_updated_at is null
    `);
    for (const edge of manifest.edges) {
      statement.run(requireEdgeSummary(edge.summary), timestamp, project, edge.parent, edge.child);
    }
  } finally {
    database.close();
  }
}

export function seedDemoLineageWorkspace(project: string, fields: { activate?: boolean; confirmWrite: boolean }) {
  const ids = fields.confirmWrite ? writeDemoFiles(project) : demoAssetIds();
  const rootAssetId = ids.root;
  if (!fields.confirmWrite) {
    return {
      ok: true as const,
      dryRun: true as const,
      root_asset_id: rootAssetId,
      workspace_id: lineageWorkspaceId(project, rootAssetId),
      files_dir: demoProjectDir(project),
    };
  }
  const summary = upsertDemoAssets(project, ids);
  for (const [parent, child] of demoEdges) {
    linkLineageAssets(project, { parentAssetId: ids[parent], childAssetId: ids[child], confirmWrite: true });
  }
  clearLegacySeedSelectionPrompt(project, rootAssetId, legacyDemoSelectionPrompt);
  updateSelectedAsset(project, {
    assetId: ids.winner,
    confirmWrite: true,
    rootAssetId,
  });
  updateLineageLayout(project, {
    confirmWrite: true,
    rootAssetId,
    positions: [...demoPositions].map(([key, position]) => ({ assetId: ids[key], ...position })),
  });
  const workspace = createLineageWorkspace(project, {
    activate: fields.activate !== false,
    confirmWrite: true,
    createdBy: 'system',
    notes: demoWorkspaceNotes,
    rootAssetId,
    title: demoWorkspaceTitle,
  }).workspace;
  return {
    ok: true as const,
    message: `Seeded ${demoWorkspaceTitle}`,
    files_dir: demoProjectDir(project),
    root_asset_id: rootAssetId,
    selected_asset_id: ids.winner,
    summary,
    workspace,
  };
}

export function seedSwissifierRichDemoWorkspace(project: string, fields: { activate?: boolean; confirmWrite: boolean }) {
  const manifest = projectScopedSwissifierManifest(project);
  if (!fields.confirmWrite) {
    return {
      ok: true as const,
      dryRun: true as const,
      demo_id: manifest.id,
      root_asset_id: manifest.root_asset_id,
      workspace_id: lineageWorkspaceId(project, manifest.root_asset_id),
      media_status: swissifierRichDemoMediaStatus(project),
    };
  }
  writeSwissifierRerollFiles(manifest);
  const summary = upsertSwissifierAssets(project, manifest);
  for (const edge of manifest.edges) {
    linkLineageAssets(project, { parentAssetId: edge.parent, childAssetId: edge.child, confirmWrite: true });
  }
  backfillSwissifierEdgeSummaries(project, manifest);
  const reroll_attempts = upsertSwissifierRerollAttempts(project, manifest);
  let workspace = createLineageWorkspace(project, {
    activate: fields.activate !== false,
    confirmWrite: true,
    createdBy: 'system',
    notes: manifest.notes,
    rootAssetId: manifest.root_asset_id,
    title: manifest.title,
  }).workspace;
  if (workspace && (workspace.max_queued_branches ?? 3) < manifest.selected_asset_ids.length) {
    workspace = updateLineageWorkspace(project, workspace.id, {
      confirmWrite: true,
      maxQueuedBranches: manifest.selected_asset_ids.length,
    }).workspace;
  }
  clearLegacySeedSelectionPrompt(project, manifest.root_asset_id, legacySwissifierSelectionPrompt);
  updateSelectedAsset(project, {
    assetIds: manifest.selected_asset_ids,
    confirmWrite: true,
    maxSelections: manifest.selected_asset_ids.length,
    rootAssetId: manifest.root_asset_id,
  });
  updateLineageLayout(project, {
    confirmWrite: true,
    rootAssetId: manifest.root_asset_id,
    positions: manifest.assets.map(asset => ({ assetId: asset.asset_id, ...asset.position })),
  });
  return {
    ok: true as const,
    message: `Seeded ${manifest.title}`,
    demo_id: manifest.id,
    media_status: swissifierRichDemoMediaStatus(project),
    root_asset_id: manifest.root_asset_id,
    selected_asset_ids: manifest.selected_asset_ids,
    reroll_attempts,
    summary,
    workspace,
  };
}

export function archiveDemoLineageWorkspace(project: string, confirmWrite: boolean) {
  const ids = demoAssetIds();
  const rootAssetId = ids.root;
  let archived;
  try {
    archived = archiveLineageWorkspace(project, lineageWorkspaceId(project, rootAssetId), confirmWrite);
  } catch (error) {
    if (!isLineageWorkspaceError(error) || error.status !== 404) throw error;
    archived = { ok: true as const, message: 'No demo lineage workspace exists yet', workspace: null };
  }
  if (confirmWrite) rmSync(demoProjectDir(project), { force: true, recursive: true });
  return {
    ok: true as const,
    message: confirmWrite ? `Archived ${demoWorkspaceTitle}` : `Would archive ${demoWorkspaceTitle}`,
    files_dir: demoProjectDir(project),
    root_asset_id: rootAssetId,
    archived,
  };
}
