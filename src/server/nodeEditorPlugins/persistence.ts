import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type { NodeEditorTerminalOutcome, NodeEditorVerifiedInstallationRecord } from '../../shared/nodeEditorPluginTypes';
import { assertNodeEditorTargetInTransaction, getCurrentLineageAttemptIdentityInTransaction } from '../assetLineage';
import { lineageDb, nowIso, type DatabaseSync } from '../assetLineageDb';
import { releaseMaterializedNodeEditorContent, type MaterializedNodeEditorContent, type NodeEditorFaultInjector } from './materialization';

export interface NodeEditorAcceptanceInput {
  sessionId: string;
  proposalId: string;
  idempotencyKey: string;
  project: string;
  rootAssetId: string;
  nodeAssetId: string;
  baseAttemptId: string;
  baseChecksumSha256: string;
  pluginId: string;
  contributionId: string;
  pluginPackageName: string;
  pluginPackageVersion: string;
  protocol: { major: number; minor: number; features: string[]; capabilities: string[] };
  editSummary: string;
  installation: NodeEditorVerifiedInstallationRecord;
  content: MaterializedNodeEditorContent;
  inject?: NodeEditorFaultInjector;
}

function parseTerminal(row?: { result_json?: string }): NodeEditorTerminalOutcome | undefined {
  return row?.result_json ? JSON.parse(row.result_json) as NodeEditorTerminalOutcome : undefined;
}

export function getNodeEditorTerminal(sessionId: string): NodeEditorTerminalOutcome | undefined {
  const database = lineageDb();
  try {
    return parseTerminal(database.prepare('select result_json from node_editor_terminal_results where session_id = ?').get(sessionId) as { result_json?: string } | undefined);
  } finally {
    database.close();
  }
}

export interface NodeEditorBase {
  attemptId: string;
  checksumSha256: string;
  mimeType: string;
  sizeBytes: number;
  filePath?: string;
}

export interface NodeEditorBaseContent extends Omit<NodeEditorBase, 'filePath'> {
  bytes: Buffer;
}

export function getNodeEditorBase(project: string, rootAssetId: string, nodeAssetId: string): NodeEditorBase {
  const database = lineageDb();
  try {
    assertNodeEditorTargetInTransaction(database, project, rootAssetId, nodeAssetId);
    const identity = getCurrentLineageAttemptIdentityInTransaction(database, project, nodeAssetId);
    const row = database.prepare(`
      select coalesce(current_asset.content_type, node.content_type, 'application/octet-stream') mime_type,
             coalesce(current_asset.size_bytes, node.size_bytes, 0) size_bytes,
             coalesce(current_attempt.file_path, current_asset.local_path, node.local_path) file_path
      from assets node
      left join asset_attempts current_attempt on current_attempt.project_id = node.project_id
        and current_attempt.node_asset_id = node.id and current_attempt.is_current = 1
      left join assets current_asset on current_asset.project_id = current_attempt.project_id
        and current_asset.id = current_attempt.asset_id
      where node.project_id = ? and node.id = ?
    `).get(project, nodeAssetId) as { mime_type: string; size_bytes: number; file_path?: string };
    return { ...identity, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), ...(row.file_path ? { filePath: row.file_path } : {}) };
  } finally {
    database.close();
  }
}

function contentError(code: string, message: string, status = 409): Error {
  return Object.assign(new Error(message), { code, status });
}

function pathIsInside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function resolveNodeEditorContentPath(assetRoot: string, reference: string): string {
  const root = realpathSync(assetRoot);
  const candidates = isAbsolute(reference)
    ? [resolve(reference)]
    : reference === '.asset-scratch' || reference.startsWith(`.asset-scratch${sep}`) || reference === '.lineage' || reference.startsWith(`.lineage${sep}`)
      ? [resolve(assetRoot, reference)]
      : [resolve(assetRoot, reference), resolve(assetRoot, '.asset-scratch', reference)];
  const candidate = candidates.find(existsSync);
  if (!candidate) throw contentError('document-content-unavailable', 'current asset content is unavailable', 404);
  if (lstatSync(candidate).isSymbolicLink()) throw contentError('document-content-invalid', 'current asset content must not be a symbolic link');
  const canonical = realpathSync(candidate);
  if (!pathIsInside(root, canonical)) throw contentError('document-content-invalid', 'current asset content must remain inside the active asset root');
  return canonical;
}

export function readNodeEditorBaseContent(
  assetRoot: string,
  project: string,
  rootAssetId: string,
  nodeAssetId: string,
  expected: { attemptId: string; checksumSha256: string; maxBytes: number },
): NodeEditorBaseContent {
  const base = getNodeEditorBase(project, rootAssetId, nodeAssetId);
  if (base.attemptId !== expected.attemptId || base.checksumSha256 !== expected.checksumSha256) {
    throw contentError('stale-base', 'current asset changed after the editor session started');
  }
  if (!base.filePath || !/^[a-f0-9]{64}$/.test(base.checksumSha256) || base.sizeBytes < 1 || base.sizeBytes > expected.maxBytes) {
    throw contentError('document-content-invalid', 'current asset content metadata is invalid');
  }
  const path = resolveNodeEditorContentPath(assetRoot, base.filePath);
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size !== base.sizeBytes || stat.size > expected.maxBytes) {
      throw contentError('document-content-invalid', 'current asset content size does not match its immutable metadata');
    }
    const bytes = readFileSync(fd);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== base.sizeBytes || checksum !== base.checksumSha256) {
      throw contentError('document-content-invalid', 'current asset content checksum does not match its immutable metadata');
    }
    return { attemptId: base.attemptId, checksumSha256: checksum, mimeType: base.mimeType, sizeBytes: bytes.length, bytes };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function insertTerminal(database: DatabaseSync, input: NodeEditorAcceptanceInput, outcome: NodeEditorTerminalOutcome): void {
  database.prepare(`
    insert into node_editor_terminal_results (
      session_id, project_id, node_asset_id, proposal_id, idempotency_key, outcome, code,
      asset_id, attempt_id, checksum_sha256, result_json, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.sessionId, input.project, input.nodeAssetId, input.proposalId, input.idempotencyKey, outcome.outcome,
    outcome.outcome === 'accepted' ? null : outcome.code,
    outcome.outcome === 'accepted' ? outcome.assetId : null,
    outcome.outcome === 'accepted' ? outcome.attemptId : null,
    outcome.outcome === 'accepted' ? outcome.checksumSha256 : null,
    JSON.stringify(outcome), nowIso(),
  );
}

export function recordNodeEditorStale(input: NodeEditorAcceptanceInput): NodeEditorTerminalOutcome {
  const prior = getNodeEditorTerminal(input.sessionId);
  if (prior) return prior;
  const database = lineageDb();
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      const existing = parseTerminal(database.prepare('select result_json from node_editor_terminal_results where session_id = ?').get(input.sessionId) as { result_json?: string } | undefined);
      if (existing) { database.exec('COMMIT'); return existing; }
      const outcome: NodeEditorTerminalOutcome = { outcome: 'stale', sessionId: input.sessionId, proposalId: input.proposalId, code: 'stale-base' };
      insertTerminal(database, input, outcome);
      database.exec('COMMIT');
      return outcome;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

export function recordNodeEditorCancelled(input: Omit<NodeEditorAcceptanceInput, 'content'>): NodeEditorTerminalOutcome {
  const prior = getNodeEditorTerminal(input.sessionId);
  if (prior) return prior;
  const database = lineageDb();
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      const existing = parseTerminal(database.prepare('select result_json from node_editor_terminal_results where session_id = ?').get(input.sessionId) as { result_json?: string } | undefined);
      if (existing) { database.exec('COMMIT'); return existing; }
      const outcome: NodeEditorTerminalOutcome = { outcome: 'cancelled', sessionId: input.sessionId, proposalId: input.proposalId, code: 'cancelled' };
      insertTerminal(database, { ...input, content: undefined as never }, outcome);
      database.exec('COMMIT');
      return outcome;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

export function acceptNodeEditorResult(input: NodeEditorAcceptanceInput): NodeEditorTerminalOutcome {
  const prior = getNodeEditorTerminal(input.sessionId);
  if (prior) {
    releaseMaterializedNodeEditorContent(input.content);
    return prior;
  }
  const database = lineageDb();
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      input.inject?.('after-begin');
      const existing = parseTerminal(database.prepare('select result_json from node_editor_terminal_results where session_id = ?').get(input.sessionId) as { result_json?: string } | undefined);
      if (existing) { database.exec('COMMIT'); return existing; }
      assertNodeEditorTargetInTransaction(database, input.project, input.rootAssetId, input.nodeAssetId);
      const current = getCurrentLineageAttemptIdentityInTransaction(database, input.project, input.nodeAssetId);
      if (current.attemptId !== input.baseAttemptId || current.checksumSha256 !== input.baseChecksumSha256) {
        const stale: NodeEditorTerminalOutcome = { outcome: 'stale', sessionId: input.sessionId, proposalId: input.proposalId, code: 'stale-base' };
        insertTerminal(database, input, stale);
        database.exec('COMMIT');
        return stale;
      }
      input.inject?.('after-second-stale-check');
      const timestamp = nowIso();
      const projectDigest = createHash('sha256').update(input.project).digest('hex').slice(0, 12);
      const assetId = `editor-${projectDigest}-${input.content.checksumSha256.slice(0, 32)}`;
      database.prepare(`
        insert into assets (
          id, project_id, source, local_path, s3_key, checksum_sha256, media_type, title, status,
          channel, campaign, audience, size_bytes, content_type, created_at, updated_at, last_seen_at
        ) values (?, ?, 'local', ?, null, ?, 'image', ?, 'working', null, null, null, ?, ?, ?, ?, ?)
        on conflict(id) do update set last_seen_at = excluded.last_seen_at
      `).run(assetId, input.project, input.content.relativePath, input.content.checksumSha256, basename(input.content.relativePath), input.content.bytes, input.content.mimeType, timestamp, timestamp, timestamp);
      input.inject?.('after-asset');
      database.prepare('update asset_attempts set is_current = 0 where project_id = ? and node_asset_id = ?').run(input.project, input.nodeAssetId);
      input.inject?.('after-demote');
      const maximum = database.prepare('select max(attempt_index) max_index from asset_attempts where project_id = ? and node_asset_id = ?').get(input.project, input.nodeAssetId) as { max_index?: number };
      const attemptIndex = Number(maximum.max_index || 1) + 1;
      const attemptId = `${input.project}:${input.nodeAssetId}:attempt:${attemptIndex}`;
      database.prepare(`
        insert into asset_attempts (
          id, project_id, node_asset_id, asset_id, attempt_index, source, prompt, generation_job_id,
          file_path, checksum_sha256, created_at, promoted_at, is_current
        ) values (?, ?, ?, ?, ?, 'editor', null, null, ?, ?, ?, ?, 1)
      `).run(attemptId, input.project, input.nodeAssetId, assetId, attemptIndex, input.content.relativePath, input.content.checksumSha256, timestamp, timestamp);
      input.inject?.('after-attempt');
      database.prepare(`
        insert into node_editor_attempt_provenance (
          attempt_id, session_id, project_id, node_asset_id, plugin_id, contribution_id,
          plugin_package_name, plugin_package_version, protocol_major, protocol_minor,
          protocol_features_json, capabilities_json, package_archive_sha256, manifest_sha256, host_sha256,
          base_attempt_id, base_checksum_sha256, result_checksum_sha256, result_mime_type,
          result_size_bytes, edit_summary_json, accepted_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(attemptId, input.sessionId, input.project, input.nodeAssetId, input.pluginId, input.contributionId,
        input.pluginPackageName, input.pluginPackageVersion, input.protocol.major, input.protocol.minor,
        JSON.stringify(input.protocol.features), JSON.stringify(input.protocol.capabilities),
        input.installation.packageArchiveSha256, input.installation.manifestSha256, input.installation.hostSha256,
        input.baseAttemptId, input.baseChecksumSha256, input.content.checksumSha256, input.content.mimeType,
        input.content.bytes, JSON.stringify({ summary: input.editSummary }), timestamp);
      input.inject?.('after-provenance');
      database.prepare(`
        insert into asset_reviews (asset_id, review_state, reviewed_at, ignored_at, notes, updated_at)
        values (?, 'unreviewed', ?, null, null, ?)
        on conflict(asset_id) do update set
          review_state = excluded.review_state, reviewed_at = excluded.reviewed_at,
          ignored_at = excluded.ignored_at, updated_at = excluded.updated_at
      `).run(input.nodeAssetId, timestamp, timestamp);
      input.inject?.('after-review');
      const outcome: NodeEditorTerminalOutcome = { outcome: 'accepted', sessionId: input.sessionId, proposalId: input.proposalId, assetId, attemptId, checksumSha256: input.content.checksumSha256 };
      insertTerminal(database, input, outcome);
      input.inject?.('after-terminal');
      input.inject?.('before-commit');
      database.exec('COMMIT');
      return outcome;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
    releaseMaterializedNodeEditorContent(input.content);
  }
}

export function registeredNodeEditorChecksums(): Set<string> {
  const database = lineageDb();
  try {
    return new Set((database.prepare("select checksum_sha256 from assets where local_path like '%.lineage/node-editor/objects/sha256/%' or local_path like '.lineage/node-editor/objects/sha256/%'").all() as Array<{ checksum_sha256: string }>).map(row => row.checksum_sha256));
  } finally {
    database.close();
  }
}
