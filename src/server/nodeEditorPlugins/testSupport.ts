import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import positiveFixtures from '../../../packages/node-editor-protocol/fixtures/positive.json';
import type { PluginManifest, ProcessBinding, ProxyRequest } from '../../../packages/node-editor-protocol/generated/protocol';
import type { NodeEditorPluginConfig } from '../../shared/nodeEditorPluginTypes';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { repoRoot } from '../assetCore';
import { lineageDb } from '../assetLineageDb';
import { NodeEditorPluginRegistry } from './registry';
import { NodeEditorPluginSupervisor } from './supervisor';
import { NodeEditorSessionService } from './sessionService';

const manifest = positiveFixtures[0].value as PluginManifest;
const referenceHostPath = join(repoRoot, 'packages', 'node-editor-reference-plugin', 'src', 'host.js');
export const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

export function createNodeEditorTestContext(
  name: string,
  inject?: ConstructorParameters<typeof NodeEditorSessionService>[0]['inject'],
  options: { manifest?: PluginManifest; maxProtocolBytes?: number; authority?: ConstructorParameters<typeof NodeEditorSessionService>[0]['authority'] } = {},
) {
  const selectedManifest = options.manifest ?? manifest;
  const root = join(repoRoot, '.asset-scratch', `vitest-node-editor-${name}`);
  rmSync(root, { force: true, recursive: true });
  const profile = useLineageTestProfile(join(root, 'lineage.sqlite'), { assetRoot: join(root, 'asset-root') });
  const extractedRoot = join(root, 'plugin');
  const manifestBytes = `${JSON.stringify(selectedManifest)}\n`;
  const hostBytes = readFileSync(referenceHostPath);
  const archiveBytes = Buffer.from(`archive-${name}`);
  mkdirSync(join(extractedRoot, 'src'), { recursive: true });
  writeFileSync(join(extractedRoot, 'manifest.json'), manifestBytes);
  writeFileSync(join(extractedRoot, 'src', 'host.js'), hostBytes);
  writeFileSync(join(root, 'plugin.tgz'), archiveBytes);
  const config: NodeEditorPluginConfig = {
    schemaVersion: 1,
    experimentalEnabled: true,
    installations: [{
      schemaVersion: 1,
      pluginId: selectedManifest.pluginId,
      contributionId: selectedManifest.nodeEditors[0].id,
      packageArchivePath: join(root, 'plugin.tgz'),
      packageArchiveSha256: sha256(archiveBytes),
      manifestSha256: sha256(manifestBytes),
      extractedRoot,
      hostSha256: sha256(hostBytes),
    }],
  };
  const database = lineageDb();
  const timestamp = '2026-09-01T00:00:00.000Z';
  try {
    database.prepare('insert into projects (id, product, created_at, updated_at) values (?, ?, ?, ?)').run('test-project', 'test-project', timestamp, timestamp);
    for (const [id, checksum] of [['root-asset', '1'.repeat(64)], ['node-asset', '2'.repeat(64)]]) {
      database.prepare(`insert into assets (id, project_id, source, local_path, checksum_sha256, media_type, title, status, created_at, updated_at, last_seen_at)
        values (?, 'test-project', 'local', ?, ?, 'image', ?, 'working', ?, ?, ?)`)
        .run(id, `${id}.png`, checksum, id, timestamp, timestamp, timestamp);
    }
    database.prepare("insert into asset_edges (id, project_id, parent_asset_id, child_asset_id, relation_type, created_at) values ('edge-1', 'test-project', 'root-asset', 'node-asset', 'derived_from', ?)").run(timestamp);
    database.prepare("insert into asset_reviews (asset_id, review_state, reviewed_at, notes, updated_at) values ('node-asset', 'approved', ?, 'preserve me', ?)").run(timestamp, timestamp);
  } finally { database.close(); }
  const registry = new NodeEditorPluginRegistry(config);
  const supervisor = new NodeEditorPluginSupervisor(profile.profile_id, registry, { idleTimeoutMs: 10_000, healthIntervalMs: 500 });
  const service = new NodeEditorSessionService({ profile, registry, supervisor, inject, maxProtocolBytes: options.maxProtocolBytes, authority: options.authority });
  return { root, profile, config, registry, supervisor, service };
}

export function processRequest(service: NodeEditorSessionService, sessionId: string, type: 'document.read' | 'proposal.create' | 'proposal.status' | 'proposal.cancel' | 'session.close', extra: Record<string, unknown> = {}): { capability: string; request: ProxyRequest } {
  const authority = service.processAuthorityForTest(sessionId);
  const binding: ProcessBinding = {
    pluginId: authority.processBinding.pluginId,
    processId: authority.processBinding.processId,
    sessionId,
    origin: authority.processBinding.origin,
    source: 'process',
  };
  return { capability: authority.processCapability, request: { type, requestId: `${type.replace('.', '-')}-1`, binding, ...extra } as ProxyRequest };
}

export function forbiddenStateSnapshot(): Record<string, unknown> {
  const database = lineageDb();
  try {
    return Object.fromEntries(['asset_edges', 'agent_claims', 'lineage_tasks', 'asset_reroll_requests'].map(table => [table, database.prepare(`select * from ${table} order by 1`).all()]));
  } finally { database.close(); }
}
