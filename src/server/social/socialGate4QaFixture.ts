import { createHash } from 'node:crypto';
import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { repoRoot } from '../assetCore';
import { lineageDb, type DatabaseSync } from '../assetLineageDb';
import { assertProfileWriterLeaseHeld } from '../profileWriterLease';
import { lineageCurrentAttemptIdentityForNodeInDatabase } from '../lineageSelectionPacket';
import { BUFFER_CAPABILITY_REGISTRY_VERSION, bufferChannelCapability, canonicalBufferCapabilityJson } from '../adapters/buffer/bufferCapabilities';
import { inspectSocialImage } from './socialMedia';

const PROJECT = 'swissifier-demo';
const CHANNEL = 'fixture-linkedin-r2';
const CREDENTIAL = 'env:FIXTURE_ONLY';
const ROOT_ASSET = 'local-5748fb8ba6df';
const WORKSPACE = `${PROJECT}:lineage-workspace:${ROOT_ASSET}`;
const ITEM = '19846893-362c-46be-b5bf-c15e9bcf0b44';
const VARIANT = '58b44a51-58fc-4b2c-b813-8a12a6b6d167';
const CAMPAIGN = 'release-2-gate2-qa';
const INITIAL_ATTEMPT = `${PROJECT}:${ROOT_ASSET}:attempt:implicit`;
const INITIAL_CHECKSUM = '5748fb8ba6dffea448a0eabf2c361d95958a8b54a3ad5d8e0d499381b820b36b';
const ORGANIZATION = 'fixture-org';
const CONNECTION_CLI = 'fixture-only';
const CONNECTION_SCHEMA = 'fixture-schema';
const CONNECTION_FINGERPRINT = 'fixture-connection-r2';
const PROVIDER_FINGERPRINT = 'fixture-channel-fingerprint-r2';
const SERVICE_ID = 'fixture-linkedin-service';
const DISPLAY_NAME = 'Synthetic LinkedIn QA';
const INITIAL_SCHEDULE = '{}';
const SYNTHETIC_SCHEDULE = '{"_lineageSynthetic":"gate4-qa","paused":false,"times":["09:00"]}';
const SYNTHETIC_SCHEDULE_SHA256 = '3d9f3014db0e00b54ba924e8583a1c4e5fc1a571f5b35f4af22ce10829cb9d97';
const FIXTURE_TIME = '2026-08-13T00:00:00.000Z';
const WIDTH = 1200;
const HEIGHT = 628;

type Row = Record<string, unknown>;

export interface Gate4QaReseedReceipt {
  schema_version: 'lineage.social_gate4_qa_reseed.v1';
  profile_id: string;
  project: typeof PROJECT;
  workspace_id: string;
  item_id: string;
  variant_id: string;
  revision: number;
  channel_id: typeof CHANNEL;
  current_attempt_id: string;
  source_checksum_sha256: string;
  media: { content_type: 'image/png'; width: 1200; height: 628; size_bytes: number };
  capability_registry_version: typeof BUFFER_CAPABILITY_REGISTRY_VERSION;
  delivery_evidence_count: 0;
  preview_sha256: string;
  schedule_sha256: typeof SYNTHETIC_SCHEDULE_SHA256;
  synthetic_schedule: true;
  idempotent: boolean;
}

function fail(message: string): never { throw new Error(`Gate 4 QA reseed refused: ${message}`); }
function sha256(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex'); }
function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

let crcTable: Uint32Array | undefined;
function crc32(bytes: Buffer): number {
  crcTable ||= Uint32Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    return crc >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

/** A deterministic, text-free, single-frame RGB PNG. */
export function gate4QaPngBytes(): Buffer {
  const row = Buffer.alloc(1 + WIDTH * 3);
  row[0] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    row[1 + x * 3] = 25 + Math.floor((x * 40) / WIDTH);
    row[2 + x * 3] = 38 + Math.floor((x * 55) / WIDTH);
    row[3 + x * 3] = 70 + Math.floor((x * 75) / WIDTH);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0); ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: HEIGHT }, () => row)), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function exactOne(database: DatabaseSync, sql: string, values: Array<string | number | null>, label: string): Row {
  const rows = database.prepare(sql).all(...values) as Row[];
  if (rows.length !== 1) fail(`expected exactly one ${label}, found ${rows.length}`);
  return rows[0];
}

function deliveryEvidenceCount(database: DatabaseSync, project: string): number {
  const exists = (table: string) => Boolean(database.prepare("select 1 from sqlite_master where type='table' and name=?").get(table));
  if (!exists('social_delivery_operations')) return 0;
  const operationIds = database.prepare('select id from social_delivery_operations where project_id=?').all(project) as Array<{ id: string }>;
  let count = operationIds.length;
  for (const table of ['social_delivery_attempts', 'social_delivery_events', 'social_delivery_receipts', 'social_delivery_reconciliations', 'social_delivery_adoptions']) {
    if (!exists(table)) continue;
    count += Number((database.prepare(`select count(*) count from ${table} where operation_id in (select id from social_delivery_operations where project_id=?)`).get(project) as { count: number }).count);
  }
  return count;
}

function assertExactFixture(database: DatabaseSync, project: string) {
  if (project !== PROJECT) fail(`project must be ${PROJECT}`);
  if (process.env.LINEAGE_CHANNEL !== 'dev') fail('checkout-only dev channel is required');
  if (process.env.LINEAGE_PROFILE_ENVIRONMENT !== 'development') fail('a named development profile is required');
  if (!process.env.LINEAGE_PROFILE_ID) fail('a named development profile is required');
  assertProfileWriterLeaseHeld();
  const projectRow = exactOne(database, 'select id from projects where id=?', [PROJECT], 'Swissifier project');
  if (projectRow.id !== PROJECT) fail('project identity changed');
  const connection = exactOne(database, 'select * from buffer_connections where project_id=?', [PROJECT], 'fixture connection');
  if (connection.organization_id !== ORGANIZATION || connection.credential_ref !== CREDENTIAL || connection.cli_version !== CONNECTION_CLI
    || connection.schema_fingerprint !== CONNECTION_SCHEMA || connection.connection_fingerprint !== CONNECTION_FINGERPRINT
    || connection.health_state !== 'connected') fail('fixture connection markers changed');
  const channel = exactOne(database, 'select * from buffer_channels where project_id=? and channel_id=?', [PROJECT, CHANNEL], 'fixture channel');
  if (channel.service !== 'linkedin' || channel.organization_id !== ORGANIZATION || channel.service_id !== SERVICE_ID
    || channel.display_name !== DISPLAY_NAME || channel.provider_fingerprint !== PROVIDER_FINGERPRINT || channel.available !== 1
    || channel.disconnected !== 0 || channel.locked !== 0 || channel.paused !== 0 || channel.stale_at !== null) fail('fixture channel is unavailable or stale');
  if (channel.posting_schedule_json !== INITIAL_SCHEDULE && channel.posting_schedule_json !== SYNTHETIC_SCHEDULE) fail('fixture queue schedule changed');
  const variant = exactOne(database, `select variants.*, revisions.id revision_id, revisions.revision revision_number,
    revisions.channel_fingerprint, revisions.composition_mode, revisions.editorial_state revision_editorial_state,
    revisions.copy, revisions.alt_text, revisions.alt_text_reviewed, revisions.alt_text_reviewed_by, revisions.alt_text_reviewed_at
    from social_variants variants join social_variant_revisions revisions
      on revisions.variant_id=variants.id and revisions.revision=variants.current_revision
    where variants.project_id=? and variants.id=? and variants.item_id=? and variants.channel_id=? and variants.active=1 and variants.editorial_state='ready'`, [PROJECT, VARIANT, ITEM, CHANNEL], 'ready fixture variant');
  if (variant.revision_number !== 2 || variant.revision_editorial_state !== 'ready' || variant.composition_mode !== 'addToQueue' || variant.channel_fingerprint !== PROVIDER_FINGERPRINT
    || !String(variant.copy || '').trim() || !String(variant.alt_text || '').trim() || variant.alt_text_reviewed !== 1
    || !String(variant.alt_text_reviewed_by || '').trim() || !variant.alt_text_reviewed_at) fail('ready fixture revision markers changed');
  const item = exactOne(database, 'select * from social_work_items where project_id=? and id=? and editorial_state=\'active\'', [PROJECT, ITEM], 'active fixture work item');
  if (item.root_asset_id !== ROOT_ASSET || item.source_asset_id !== ROOT_ASSET || item.campaign_key !== CAMPAIGN) fail('fixture work item markers changed');
  const workspace = exactOne(database, 'select id from lineage_workspaces where project_id=? and id=? and root_asset_id=? and status=\'active\'', [PROJECT, WORKSPACE, ROOT_ASSET], 'active fixture workspace');
  const reseedAttemptId = `${PROJECT}:${ROOT_ASSET}:gate4-qa-v2`;
  const reseeded = database.prepare('select id from asset_attempts where id=?').get(reseedAttemptId) as Row | undefined;
  if (!reseeded) {
    const physical = database.prepare('select id from asset_attempts where project_id=? and node_asset_id=? and is_current=1').all(PROJECT, ROOT_ASSET) as Row[];
    if (physical.length !== 0 || item.source_checksum_sha256 !== INITIAL_CHECKSUM) fail(`current source attempt must be ${INITIAL_ATTEMPT}`);
    const source = exactOne(database, 'select checksum_sha256 from assets where project_id=? and id=?', [PROJECT, ROOT_ASSET], 'canonical source asset');
    if (source.checksum_sha256 !== INITIAL_CHECKSUM) fail('canonical source checksum changed');
  }
  const evidence = deliveryEvidenceCount(database, PROJECT);
  if (evidence !== 0) fail(`delivery evidence is nonzero (${evidence})`);
  return { channel, connection, evidence, item, variant, workspace };
}

interface PathIdentity { path: string; dev: number; ino: number }
interface FileIdentity extends PathIdentity { parent: PathIdentity }

function directoryIdentity(path: string): PathIdentity {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory()) fail('fixture asset directory is unsafe');
  return { path, dev: info.dev, ino: info.ino };
}

function fileIdentity(path: string, parent: PathIdentity): FileIdentity {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const descriptor = fstatSync(fd); const pathname = lstatSync(path);
    if (!descriptor.isFile() || descriptor.isSymbolicLink() || descriptor.nlink !== 1 || (descriptor.mode & 0o777) !== 0o600
      || descriptor.dev !== pathname.dev || descriptor.ino !== pathname.ino) fail('fixture asset identity changed during validation');
    return { path, dev: descriptor.dev, ino: descriptor.ino, parent };
  } finally { closeSync(fd); }
}

function assertDirectoryIdentity(identity: PathIdentity): void {
  const current = directoryIdentity(identity.path);
  if (current.dev !== identity.dev || current.ino !== identity.ino) fail('fixture asset parent identity changed before deletion');
}

function assertFileIdentity(identity: FileIdentity): void {
  assertDirectoryIdentity(identity.parent);
  const current = fileIdentity(identity.path, identity.parent);
  if (current.dev !== identity.dev || current.ino !== identity.ino) fail('fixture asset identity changed before deletion');
}

function assertLinkedFileIdentity(identity: FileIdentity, path: string, expectedLinks: number): FileIdentity {
  assertDirectoryIdentity(identity.parent);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const descriptor = fstatSync(fd); const pathname = lstatSync(path);
    if (!descriptor.isFile() || descriptor.isSymbolicLink() || descriptor.nlink !== expectedLinks
      || (descriptor.mode & 0o777) !== 0o600 || descriptor.dev !== pathname.dev || descriptor.ino !== pathname.ino
      || descriptor.dev !== identity.dev || descriptor.ino !== identity.ino) fail('fixture asset identity changed during atomic move');
    return { ...identity, path };
  } finally { closeSync(fd); }
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}

/**
 * Move a private file without ever replacing the destination. link(2) supplies
 * the atomic exclusive destination creation that rename(2) lacks in Node. The
 * source and destination are revalidated as the same two-link inode before the
 * source name is removed, and the retained name must end as a private
 * single-link file.
 */
function movePrivateFileNoReplace(
  identity: FileIdentity,
  destination: string,
  beforeLink?: () => void,
): FileIdentity {
  assertFileIdentity(identity);
  beforeLink?.();
  try { linkSync(identity.path, destination); }
  catch (error) {
    if (isAlreadyExists(error)) fail('fixture atomic move destination already exists');
    throw error;
  }
  const destinationIdentity = { ...identity, path: destination };
  try {
    assertLinkedFileIdentity(identity, identity.path, 2);
    assertLinkedFileIdentity(destinationIdentity, destination, 2);
    unlinkSync(identity.path);
    assertFileIdentity(destinationIdentity);
    return destinationIdentity;
  } catch (error) {
    // If the source name is still ours, remove only the link this function
    // created. Otherwise retain the recognizable destination for restart.
    try {
      assertLinkedFileIdentity(destinationIdentity, destination, 2);
      assertLinkedFileIdentity(identity, identity.path, 2);
      unlinkSync(destination);
      assertFileIdentity(identity);
    } catch { /* preserve substitutions and recognizable recovery state */ }
    throw error;
  }
}

function removeCreatedDirectories(directories: PathIdentity[]): void {
  for (const identity of [...directories].reverse()) {
    try {
      assertDirectoryIdentity(identity);
      rmdirSync(identity.path);
    } catch { /* preserve non-empty, substituted, or externally changed directories */ }
  }
}

function deleteOwnedFile(
  identity: FileIdentity,
  options: { beforeDelete?: () => void; beforeQuarantine?: () => void; beforeUnlink?: () => void; beforeRestore?: () => void; unlinkPath?: (path: string) => void } = {},
): void {
  options.beforeDelete?.();
  assertFileIdentity(identity);
  const pending = `${identity.path}.lineage-delete-pending`;
  const pendingIdentity = movePrivateFileNoReplace(identity, pending, options.beforeQuarantine);
  try {
    assertFileIdentity(pendingIdentity);
    options.beforeUnlink?.();
    assertFileIdentity(pendingIdentity);
    (options.unlinkPath || unlinkSync)(pending);
  } catch (error) {
    try {
      if (noFollowExists(pending)) movePrivateFileNoReplace(pendingIdentity, identity.path, options.beforeRestore);
    } catch { /* retain the recognizable pending file for fail-closed recovery */ }
    throw error;
  }
}

function removeCreatedFixturePath(file: FileIdentity | undefined, directories: PathIdentity[], hooks: Gate4QaReseedTestHooks): void {
  let cleanupFailure: unknown;
  try { hooks.beforeCleanup?.(); } catch (error) { cleanupFailure = error; }
  try {
    if (file && noFollowExists(file.path)) deleteOwnedFile(file, { unlinkPath: hooks.unlinkPath });
  } catch (error) { cleanupFailure ||= error; }
  removeCreatedDirectories(directories);
  if (cleanupFailure) throw cleanupFailure;
}

function installPrivateFixture(bytes: Buffer, checksum: string, requireExisting = false, stage?: (name: string) => void): { absolutePath: string; createdDirectories: PathIdentity[]; createdFile?: FileIdentity; relativePath: string; existed: boolean } {
  const root = resolve(repoRoot);
  const realRoot = realpathSync(root);
  const segments = ['.asset-scratch', 'gate4-qa'];
  const createdDirectories: PathIdentity[] = [];
  let directory = root;
  const relativePath = `gate4-qa/${checksum}.png`;
  const target = join(root, '.asset-scratch', relativePath); let createdTarget = false;
  let existed = false;
  try {
    for (const segment of segments) {
      directory = join(directory, segment); let created = false;
      try { mkdirSync(directory, { mode: 0o700 }); created = true; createdDirectories.push(directoryIdentity(directory)); }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error; }
      stage?.(`directory:${segment}`);
      const info = lstatSync(directory);
      if (info.isSymbolicLink() || !info.isDirectory() || !inside(realRoot, realpathSync(directory))) fail('fixture asset directory is unsafe');
      if (segment === 'gate4-qa' && (info.mode & 0o777) !== 0o700 && !created) fail('existing fixture asset directory is not mode 0700');
    }
    if (requireExisting && !noFollowExists(target)) fail('idempotent database state is missing its fixture asset');
    const parent = directoryIdentity(directory); let fd: number;
    let createdFile: FileIdentity | undefined;
    try {
      fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600); createdTarget = true;
      createdFile = { path: target, dev: fstatSync(fd).dev, ino: fstatSync(fd).ino, parent };
      stage?.('file:created');
      try { writeSync(fd, bytes); stage?.('file:written'); fchmodSync(fd, 0o600); fsyncSync(fd); } finally { closeSync(fd); }
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
      existed = true;
    }
    fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const descriptor = fstatSync(fd); const pathname = statSync(target); const currentParent = statSync(directory);
      if (!descriptor.isFile() || descriptor.nlink !== 1 || (descriptor.mode & 0o777) !== 0o600) fail('existing fixture asset is not a private single-link regular file');
      if (descriptor.dev !== pathname.dev || descriptor.ino !== pathname.ino || parent.dev !== currentParent.dev || parent.ino !== currentParent.ino) fail('fixture asset identity changed during validation');
      if (!inside(realRoot, realpathSync(target)) || sha256(readFileSync(fd)) !== checksum) fail('existing fixture asset does not match deterministic bytes');
      stage?.('file:verified');
    } finally { closeSync(fd); }
    return { absolutePath: target, createdDirectories, createdFile, relativePath, existed };
  } catch (error) {
    let cleanupError: unknown;
    try {
      if (createdTarget) {
        const identity = fileIdentity(target, directoryIdentity(directory));
        deleteOwnedFile(identity);
      }
      removeCreatedDirectories(createdDirectories);
    } catch (cleanup) { cleanupError = cleanup; }
    if (cleanupError) throw cleanupError;
    throw error;
  }
}

interface Gate4QaReseedTestHooks {
  afterFileInstall?: () => void;
  beforeCommit?: () => void;
  beforePreview?: () => void;
  beforeValidation?: () => void;
  beforeCleanup?: () => void;
  beforeLegacyDelete?: () => void;
  beforeLegacyQuarantine?: () => void;
  beforeLegacyUnlink?: () => void;
  beforeLegacyRestore?: () => void;
  afterLegacyDelete?: () => void;
  unlinkPath?: (path: string) => void;
  fileStage?: (name: string) => void;
}

function exactPrivateFile(path: string, checksum: string): FileIdentity {
  const rootPath = resolve(repoRoot); const root = realpathSync(rootPath);
  const parentPath = resolve(path, '..'); const parentRelative = relative(rootPath, parentPath);
  if (!inside(rootPath, parentPath) || !parentRelative) fail('fixture asset directory is unsafe');
  let current = rootPath; let parent: PathIdentity | undefined;
  for (const segment of parentRelative.split(sep)) {
    current = join(current, segment); parent = directoryIdentity(current);
    if (!inside(root, realpathSync(current))) fail('fixture asset directory is unsafe');
  }
  if (!parent || (lstatSync(parent.path).mode & 0o777) !== 0o700) fail('fixture asset directory is unsafe');
  const identity = fileIdentity(path, parent);
  if (!inside(root, realpathSync(path)) || sha256(readFileSync(path)) !== checksum) fail('fixture asset does not match deterministic bytes');
  return identity;
}

function noFollowExists(path: string): boolean {
  try { lstatSync(path); return true; } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function finishRecognizedAtomicMove(source: string, destination: string, checksum: string): FileIdentity {
  const parent = directoryIdentity(resolve(destination, '..'));
  const sourceInfo = lstatSync(source); const destinationInfo = lstatSync(destination);
  if (sourceInfo.isSymbolicLink() || destinationInfo.isSymbolicLink() || !sourceInfo.isFile() || !destinationInfo.isFile()
    || sourceInfo.dev !== destinationInfo.dev || sourceInfo.ino !== destinationInfo.ino
    || sourceInfo.nlink !== 2 || destinationInfo.nlink !== 2
    || (sourceInfo.mode & 0o777) !== 0o600 || (destinationInfo.mode & 0o777) !== 0o600
    || sha256(readFileSync(source)) !== checksum || sha256(readFileSync(destination)) !== checksum) {
    fail('fixture atomic move recovery paths conflict');
  }
  const destinationIdentity = { path: destination, dev: destinationInfo.dev, ino: destinationInfo.ino, parent };
  unlinkSync(source);
  assertFileIdentity(destinationIdentity);
  return destinationIdentity;
}

function restoreLegacyFixture(bytes: Buffer, checksum: string): FileIdentity {
  const root = resolve(repoRoot); const realRoot = realpathSync(root);
  let directory = root;
  for (const segment of ['.lineage', 'gate4-qa']) {
    directory = join(directory, segment);
    try { mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error; }
    const info = lstatSync(directory);
    if (info.isSymbolicLink() || !info.isDirectory() || !inside(realRoot, realpathSync(directory))) fail('legacy fixture directory is unsafe');
    if (segment === 'gate4-qa' && (info.mode & 0o777) !== 0o700) fail('legacy fixture directory is not mode 0700');
  }
  const target = join(directory, `${checksum}.png`);
  if (noFollowExists(target)) return exactPrivateFile(target, checksum);
  const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  try { writeSync(fd, bytes); fchmodSync(fd, 0o600); fsyncSync(fd); } finally { closeSync(fd); }
  return exactPrivateFile(target, checksum);
}

function precommitPreview(database: DatabaseSync, fixture: ReturnType<typeof assertExactFixture>, checksum: string, bytes: Buffer): string {
  const attempt = lineageCurrentAttemptIdentityForNodeInDatabase(database, PROJECT, ROOT_ASSET, ROOT_ASSET);
  const media = inspectSocialImage({ project: PROJECT, service: 'linkedin', localReference: attempt.local_reference, localFilePath: attempt.local_file_path, expectedChecksum: checksum });
  if (media.contentType !== 'image/png' || media.width !== WIDTH || media.height !== HEIGHT || media.sizeBytes !== bytes.length) fail('post-reseed media inspection failed');
  const revisionId = String(fixture.variant.revision_id);
  const revisionHash = String((database.prepare('select revision_hash from social_variant_revisions where id=?').get(revisionId) as Row).revision_hash);
  const capability = bufferChannelCapability('linkedin');
  const identity = {
    schema_version: 'lineage.social_delivery_preview.v1', project: PROJECT, item_id: ITEM, workspace_channel: 'linkedin',
    variant_id: VARIANT, revision_id: revisionId, revision: 2, revision_sha256: revisionHash,
    root_asset_id: ROOT_ASSET, source_asset_id: ROOT_ASSET, source_attempt_id: attempt.attempt_id,
    source_checksum_sha256: checksum, source_attempt_asset_id: attempt.attempt_asset_id,
    rendition_sha256: media.renditionSha256, media_content_type: media.contentType, media_width: media.width, media_height: media.height, media_size_bytes: media.sizeBytes,
    capability_registry_version: BUFFER_CAPABILITY_REGISTRY_VERSION, service: 'linkedin', channel_id: CHANNEL,
    channel_fingerprint: PROVIDER_FINGERPRINT,
    capability_fingerprint: sha256(JSON.stringify({ registry: BUFFER_CAPABILITY_REGISTRY_VERSION, capability })),
    connection_fingerprint: CONNECTION_FINGERPRINT, publish_method: 'automatic', composition_mode: 'addToQueue',
  } as const;
  return sha256(JSON.stringify(identity));
}

export function reseedGate4QaFixture(project: string, input: { confirmWrite: boolean }, testHooks: Gate4QaReseedTestHooks = {}): Gate4QaReseedReceipt {
  if (input.confirmWrite !== true) fail('--confirm-write is required');
  const bytes = gate4QaPngBytes(); const checksum = sha256(bytes); const database = lineageDb();
  let fixture: ReturnType<typeof assertExactFixture>; let idempotent = false; let previewSha256: string;
  const attemptId = `${PROJECT}:${ROOT_ASSET}:gate4-qa-v2`; const assetId = `${PROJECT}:gate4-qa:${checksum.slice(0, 24)}`;
  const relativePath = `gate4-qa/${checksum}.png`;
  const legacyRelativePath = `.lineage/gate4-qa/${checksum}.png`;
  let createdFile: FileIdentity | undefined; let createdDirectories: PathIdentity[] = [];
  let retainCanonicalForRecovery = false;
  try {
    fixture = assertExactFixture(database, project);
    const existingAttempt = database.prepare('select * from asset_attempts where id=?').get(attemptId) as Row | undefined;
    let currentPath = '';
    if (existingAttempt) {
      const existingAsset = exactOne(database, 'select * from assets where project_id=? and id=?', [PROJECT, assetId], 'reseeded fixture asset');
      currentPath = String(existingAttempt.file_path || '');
      if (existingAttempt.project_id !== PROJECT || existingAttempt.node_asset_id !== ROOT_ASSET || existingAttempt.asset_id !== assetId
        || (currentPath !== relativePath && currentPath !== legacyRelativePath) || existingAsset.local_path !== currentPath
        || existingAttempt.checksum_sha256 !== checksum || existingAsset.checksum_sha256 !== checksum || existingAttempt.is_current !== 1
        || fixture.item.source_checksum_sha256 !== checksum || fixture.channel.capability_registry_version !== BUFFER_CAPABILITY_REGISTRY_VERSION
        || fixture.channel.capability_json !== canonicalBufferCapabilityJson('linkedin') || fixture.channel.posting_schedule_json !== SYNTHETIC_SCHEDULE) {
        fail('partial prior reseed state requires manual inspection');
      }
      idempotent = currentPath === relativePath;
    }
    const legacyPath = join(resolve(repoRoot), legacyRelativePath);
    const legacyPendingPath = `${legacyPath}.lineage-delete-pending`;
    if (noFollowExists(legacyPendingPath)) {
      if (noFollowExists(legacyPath)) finishRecognizedAtomicMove(legacyPendingPath, legacyPath, checksum);
      else movePrivateFileNoReplace(exactPrivateFile(legacyPendingPath, checksum), legacyPath, testHooks.beforeLegacyRestore);
    }
    let legacyIdentity = noFollowExists(legacyPath) ? exactPrivateFile(legacyPath, checksum) : undefined;
    const requireCanonical = Boolean(existingAttempt) && (currentPath === relativePath || !legacyIdentity);
    const file = installPrivateFixture(bytes, checksum, requireCanonical, testHooks.fileStage); createdDirectories = file.createdDirectories;
    createdFile = file.createdFile;
    testHooks.afterFileInstall?.();
    if (!idempotent && !existingAttempt) {
      const nextIndex = Number((database.prepare('select coalesce(max(attempt_index),0)+1 value from asset_attempts where project_id=? and node_asset_id=?').get(PROJECT, ROOT_ASSET) as Row).value);
      database.exec('begin immediate');
      try {
        database.prepare(`insert into assets (id, project_id, source, local_path, checksum_sha256, media_type, title, status, channel, campaign, size_bytes, content_type, created_at, updated_at, last_seen_at)
          values (?, ?, 'local', ?, ?, 'image', 'Gate 4 QA synthetic image', 'ready', 'linkedin', 'gate4-qa', ?, 'image/png', ?, ?, ?)`)
          .run(assetId, PROJECT, file.relativePath, checksum, bytes.length, FIXTURE_TIME, FIXTURE_TIME, FIXTURE_TIME);
        database.prepare('update asset_attempts set is_current=0 where project_id=? and node_asset_id=?').run(PROJECT, ROOT_ASSET);
        database.prepare(`insert into asset_attempts (id, project_id, node_asset_id, asset_id, attempt_index, source, file_path, checksum_sha256, created_at, promoted_at, is_current)
          values (?, ?, ?, ?, ?, 'reroll', ?, ?, ?, ?, 1)`).run(attemptId, PROJECT, ROOT_ASSET, assetId, nextIndex, file.relativePath, checksum, FIXTURE_TIME, FIXTURE_TIME);
        const itemUpdate = database.prepare('update social_work_items set source_checksum_sha256=? where id=? and project_id=?').run(checksum, ITEM, PROJECT);
        const channelUpdate = database.prepare('update buffer_channels set capability_registry_version=?, capability_json=?, posting_schedule_json=? where project_id=? and channel_id=?')
          .run(BUFFER_CAPABILITY_REGISTRY_VERSION, canonicalBufferCapabilityJson('linkedin'), SYNTHETIC_SCHEDULE, PROJECT, CHANNEL);
        if (Number(itemUpdate.changes) !== 1 || Number(channelUpdate.changes) !== 1) fail('exact fixture update cardinality changed');
        testHooks.beforeValidation?.(); assertExactFixture(database, PROJECT);
        testHooks.beforePreview?.(); previewSha256 = precommitPreview(database, fixture, checksum, bytes);
        testHooks.beforeCommit?.(); database.exec('commit');
      } catch (error) { try { database.exec('rollback'); } catch { /* preserve original error */ } throw error; }
    } else if (currentPath === legacyRelativePath) {
      let legacyDeleteAttempted = false; let legacyDeleted = false;
      database.exec('begin immediate');
      try {
        const assetUpdate = database.prepare('update assets set local_path=? where project_id=? and id=? and local_path=?').run(relativePath, PROJECT, assetId, legacyRelativePath);
        const attemptUpdate = database.prepare('update asset_attempts set file_path=? where project_id=? and id=? and file_path=?').run(relativePath, PROJECT, attemptId, legacyRelativePath);
        if (Number(assetUpdate.changes) !== 1 || Number(attemptUpdate.changes) !== 1) fail('legacy fixture path correction cardinality changed');
        testHooks.beforeValidation?.(); assertExactFixture(database, PROJECT);
        testHooks.beforePreview?.(); previewSha256 = precommitPreview(database, fixture, checksum, bytes);
        testHooks.beforeCommit?.();
        if (legacyIdentity) {
          legacyDeleteAttempted = true;
          deleteOwnedFile(legacyIdentity, {
            beforeDelete: testHooks.beforeLegacyDelete,
            beforeQuarantine: testHooks.beforeLegacyQuarantine,
            beforeUnlink: testHooks.beforeLegacyUnlink,
            beforeRestore: testHooks.beforeLegacyRestore,
            unlinkPath: testHooks.unlinkPath,
          });
          legacyDeleted = true;
          testHooks.afterLegacyDelete?.();
        }
        database.exec('commit');
      } catch (error) {
        try { database.exec('rollback'); } catch { /* preserve original error */ }
        const deletionCompletedBeforeError = legacyDeleteAttempted && !noFollowExists(legacyPath) && !noFollowExists(legacyPendingPath);
        if (legacyDeleted || deletionCompletedBeforeError) {
          try { legacyIdentity = restoreLegacyFixture(bytes, checksum); }
          catch { retainCanonicalForRecovery = true; }
        }
        throw error;
      }
    } else {
      testHooks.beforeValidation?.(); assertExactFixture(database, PROJECT);
      testHooks.beforePreview?.(); previewSha256 = precommitPreview(database, fixture, checksum, bytes);
      if (legacyIdentity) {
        deleteOwnedFile(legacyIdentity, {
          beforeDelete: testHooks.beforeLegacyDelete,
          beforeQuarantine: testHooks.beforeLegacyQuarantine,
          beforeUnlink: testHooks.beforeLegacyUnlink,
          beforeRestore: testHooks.beforeLegacyRestore,
          unlinkPath: testHooks.unlinkPath,
        });
        testHooks.afterLegacyDelete?.();
      }
    }
  } catch (error) {
    if (!retainCanonicalForRecovery) removeCreatedFixturePath(createdFile, createdDirectories, testHooks);
    throw error;
  }
  finally { database.close(); }
  return {
    schema_version: 'lineage.social_gate4_qa_reseed.v1', profile_id: String(process.env.LINEAGE_PROFILE_ID), project: PROJECT,
    workspace_id: WORKSPACE, item_id: ITEM, variant_id: VARIANT, revision: 2, channel_id: CHANNEL,
    current_attempt_id: attemptId, source_checksum_sha256: checksum,
    media: { content_type: 'image/png', width: WIDTH, height: HEIGHT, size_bytes: bytes.length },
    capability_registry_version: BUFFER_CAPABILITY_REGISTRY_VERSION, delivery_evidence_count: 0,
    preview_sha256: previewSha256, schedule_sha256: SYNTHETIC_SCHEDULE_SHA256, synthetic_schedule: true, idempotent,
  };
}
