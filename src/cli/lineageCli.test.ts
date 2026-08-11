import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { defaultProject, repoRoot, setLineageAssetRoot } from '../server/assetCore';
import { indexLineageAssets, markLineageRerollRequest, updateSelectedAsset } from '../server/assetLineage';
import { createLineageWorkspace, lineageWorkspaceId } from '../server/assetLineageWorkspaces';
import { fileSha256 } from '../server/localReview';
import { resolveLineageProfile } from '../server/lineageProfiles';
import { acquireProfileWriterLease, type ProfileWriterLease } from '../server/profileWriterLease';
import { getLineageCodeIdentity } from '../server/runtimeInfo';
import type { ResolvedLineageProfile } from '../shared/lineageProfileTypes';
import type { LineageRuntimeInfo } from '../shared/runtimeInfoTypes';
import { parseRegistryPackageMetadata } from './lineage-channel';
import { formatAgentGraphDigest, formatLineageHelp, lineageCliCanDelegateMutation, lineageCliRequiresWriterLease, lineageServiceIdentityErrors, printDataResult, resolveStartOptions, runLineageAgentCommand, runLineageDataCommand, runLineageDbCommand, runLineageRuntimeCommand } from './lineageCli';

const originalEnv = { ...process.env };
const cliPackageAssetRoot = repoRoot;
const cliScratchDir = join(repoRoot, '.asset-scratch', 'vitest-cli');
const cliDbFile = join(cliScratchDir, 'lineage-cli.sqlite');
const fixtureRootAssetId = 'demo-meta-short-form-upload-demo-post-static';
const fixtureChildAssetId = 'demo-linkedin-ledger-catalog-shared';
let cliTestLease: ProfileWriterLease | undefined;
const cliCodeIdentity = getLineageCodeIdentity('dev');

afterEach(() => {
  cliTestLease?.release();
  cliTestLease = undefined;
  process.env = { ...originalEnv };
  setLineageAssetRoot(cliPackageAssetRoot);
});

function seedCliDb(assetRoot = cliPackageAssetRoot) {
  cliTestLease?.release();
  cliTestLease = undefined;
  rmSync(cliScratchDir, { force: true, recursive: true });
  mkdirSync(cliScratchDir, { recursive: true });
  const manifest: ResolvedLineageProfile = {
    asset_root: assetRoot,
    database_path: cliDbFile,
    environment: 'development',
    expected_runtime: { channel: 'dev', code_fingerprint: cliCodeIdentity.fingerprint, code_origin: 'checkout' },
    manifest_path: join(cliScratchDir, 'profile.json'),
    profile_fingerprint: 'e'.repeat(64),
    profile_id: 'cli-test-development',
    schema_version: 'lineage.profile.v1',
    service_origin: 'http://127.0.0.1:6198',
  };
  writeFileSync(manifest.manifest_path, `${JSON.stringify(manifest)}\n`);
  const profile = resolveLineageProfile(manifest.manifest_path);
  const database = new DatabaseSync(cliDbFile);
  database.exec('create table lineage_profile_identity (profile_id text primary key, environment text not null, profile_fingerprint text not null, bound_at text not null)');
  database.prepare('insert into lineage_profile_identity (profile_id, environment, profile_fingerprint, bound_at) values (?, ?, ?, ?)')
    .run(profile.profile_id, profile.environment, profile.profile_fingerprint, '2026-07-16T00:00:00.000Z');
  database.close();
  process.env.LINEAGE_DB = cliDbFile;
  process.env.LINEAGE_ASSET_ROOT = profile.asset_root;
  process.env.LINEAGE_CHANNEL = 'dev';
  process.env.LINEAGE_PROFILE = profile.manifest_path;
  process.env.LINEAGE_PROFILE_ENVIRONMENT = profile.environment;
  process.env.LINEAGE_PROFILE_FINGERPRINT = profile.profile_fingerprint;
  process.env.LINEAGE_PROFILE_ID = profile.profile_id;
  process.env.LINEAGE_PROFILE_MANIFEST = profile.manifest_path;
  process.env.LINEAGE_PROFILE_SERVICE_ORIGIN = profile.service_origin;
  mkdirSync(profile.asset_root, { recursive: true });
  setLineageAssetRoot(profile.asset_root);
  cliTestLease = acquireProfileWriterLease(profile, 'dev', 'cli');
  indexLineageAssets(defaultProject);
}

describe('lineage channel registry metadata', () => {
  it('accepts flat and nested npm integrity output while rejecting missing or conflicting identity', () => {
    expect(parseRegistryPackageMetadata({ version: '0.1.13', 'dist.integrity': 'sha512-flat' })).toEqual({
      integrity: 'sha512-flat',
      version: '0.1.13',
    });
    expect(parseRegistryPackageMetadata({ version: '0.1.13', dist: { integrity: 'sha512-nested' } })).toEqual({
      integrity: 'sha512-nested',
      version: '0.1.13',
    });
    expect(() => parseRegistryPackageMetadata({ version: '0.1.13' })).toThrow('exact version and integrity');
    expect(() => parseRegistryPackageMetadata({
      version: '0.1.13',
      dist: { integrity: 'sha512-nested' },
      'dist.integrity': 'sha512-flat',
    })).toThrow('conflicting integrity');
  });
});

describe('lineage CLI start options', () => {
  it('shows accurate task cancel help with dry-run and override options', () => {
    const help = formatLineageHelp({ binName: 'lineage', channel: 'stable', defaultHost: 'lineage.localhost', defaultPort: 5197, displayName: 'Lineage' });

    expect(help).toContain('lineage tasks cancel --task <task-id> [--confirm-write] [--override] [--project <project>] [--db <path>] [--json]');
    expect(help).toContain('lineage selection packet [--project <project>] [--workspace <id-or-root>|--root <asset-id>]');
    expect(help).toContain('[--schema v2|v3]');
    expect(help).toContain('lineage link-child --root <asset-id> --child <asset-id> --summary "<one-or-two-words>"');
    expect(help).toContain('lineage generate image plan --prompt <text> --from-lineage-selection');
    expect(help).toContain('lineage output-targets list --media image [--json]');
    expect(help).toContain('lineage output-targets node replace');
    expect(help).toContain('--from-node-targets --expected-target-resolution-digest <sha256>');
    expect(help).toContain('lineage generate image cancel --job-id <job-id> --confirm-write');
    expect(help).toContain('--target-map <json-file>');
    expect(help).toContain('lineage generate image scaffold --job-id <job-id> [--format png|jpeg|webp] --confirm-write --profile <profile> --project <project> --json');
    expect(help).toContain('lineage generate image import --job-id <job-id> --manifest <json-file> --confirm-write');
    expect(help).toContain('lineage social list --project <project> --root <asset-id>');
    expect(help).toContain('lineage social mark --project <project> --root <asset-id> --asset <asset-id-or-exact-title> --confirm-write');
    expect(help).toContain('lineage social unmark --project <project> --root <asset-id> --asset <asset-id-or-exact-title> --confirm-write');
    expect(help).toContain('lineage db info [--db <path>] [--json]');
    expect(help).toContain('lineage runtime doctor [--json]');
    expect(help).toContain('lineage start --profile <id-or-manifest> [--open] [--json]');
    expect(help).toContain('lineage profile init --profile <new-profile-id> [--service-origin <http-origin>] --confirm-write [--json]');
    expect(help).toContain('lineage profile repin-runtime --profile <development-profile> --checkout-root <path> --confirm-write [--json]');
    expect(help).toContain('lineage profile upgrade-runtime --profile <production-profile> --confirm-write [--json]');
    expect(help).toContain('--asset-root <path>');
    expect(help).not.toContain('lineage tasks cancel --task <task-id> --confirm-write [--project <project>] [--db <path>] [--json]');
  });

  it('reports checkout dev identity and rejects checkout code as stable', () => {
    const dev = runLineageRuntimeCommand(
      { binName: 'lineage-dev', channel: 'dev', defaultHost: 'lineage-dev.localhost', defaultPort: 5198, displayName: 'Lineage Dev' },
      'doctor',
    );

    expect(dev).toMatchObject({ channel: 'dev', origin: 'checkout', root: repoRoot, verified: true });
    expect(() => runLineageRuntimeCommand(
      { binName: 'lineage', channel: 'stable', defaultHost: 'lineage.localhost', defaultPort: 5197, displayName: 'Lineage' },
      'doctor',
    )).toThrow('Checkout code may run only as dev, not stable');
  });

  it('rejects a stable start without a named profile before resolving default storage', () => {
    process.env.LINEAGE_HOME = '/tmp/lineage-home';
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.LINEAGE_DB;

    expect(() => resolveStartOptions(
      { binName: 'lineage', channel: 'stable', defaultHost: 'lineage.localhost', defaultPort: 5197, displayName: 'Lineage' },
      [],
    )).toThrow('Start requires --profile or LINEAGE_PROFILE');
  });

  it('rejects a development start without a named profile', () => {
    process.env.LINEAGE_HOME = '/tmp/lineage-dev-home';

    expect(() => resolveStartOptions(
      { binName: 'lineage-dev', channel: 'dev', defaultHost: 'lineage-dev.localhost', defaultPort: 5198, displayName: 'Lineage Dev' },
      ['--json'],
    )).toThrow('Start requires --profile or LINEAGE_PROFILE');
  });

  it('reports database runtime info without requiring a server', () => {
    seedCliDb();

    const info = runLineageDbCommand(
      { binName: 'lineage-dev', channel: 'dev', defaultHost: 'lineage-dev.localhost', defaultPort: 5198, displayName: 'Lineage Dev' },
      'info',
      ['--db', cliDbFile, '--json']
    ) as { channel: string; database: { exists: boolean; path: string; projects?: number }; version: string };

    expect(info.channel).toBe('dev');
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.database).toMatchObject({ exists: true, path: cliDbFile });
    expect(info.database.projects).toBeGreaterThanOrEqual(1);
  });

  it('uses the CLI runtime database default for db info', () => {
    process.env.LINEAGE_HOME = '/tmp/lineage-runtime-info';
    delete process.env.LINEAGE_DB;

    const info = runLineageDbCommand(
      { binName: 'lineage-dev', channel: 'dev', defaultHost: 'lineage-dev.localhost', defaultPort: 5198, displayName: 'Lineage Dev' },
      'info',
      ['--json']
    ) as { database: { path: string } };

    expect(info.database.path).toBe(join('/tmp/lineage-runtime-info', 'lineage-dev.sqlite'));
    expect((info as unknown as LineageRuntimeInfo).process).toMatchObject({ pid: process.pid, role: 'command' });
    expect((info as unknown as LineageRuntimeInfo).service).toBeUndefined();
  });

  it('rejects direct host, port, database, and asset overrides without a profile', () => {
    expect(() => resolveStartOptions(
      { binName: 'lineage', channel: 'stable', defaultHost: 'lineage.localhost', defaultPort: 5197, displayName: 'Lineage' },
      ['--host', '0.0.0.0', '--port=6123', '--db', '/tmp/custom.sqlite', '--asset-root', '/tmp/growth-ops', '--open']
    )).toThrow('Start requires --profile or LINEAGE_PROFILE');
  });

  it('requires a profile before validating requested ports', () => {
    process.env.LINEAGE_HOME = join(cliScratchDir, 'invalid-port-home');
    delete process.env.LINEAGE_DB;

    expect(() =>
      resolveStartOptions(
        { binName: 'lineage', channel: 'stable', defaultHost: 'lineage.localhost', defaultPort: 5197, displayName: 'Lineage' },
        ['--port', 'not-a-port']
      )
    ).toThrow('Start requires --profile or LINEAGE_PROFILE');

    expect(() =>
      resolveStartOptions(
        { binName: 'lineage', channel: 'stable', defaultHost: 'lineage.localhost', defaultPort: 5197, displayName: 'Lineage' },
        ['--port', '70000']
      )
    ).toThrow('Start requires --profile or LINEAGE_PROFILE');
  });

  it('requires code, profile, database, and service-instance identity before readiness', () => {
    const runtime = {
      channel: 'dev',
      code: { fingerprint: 'a'.repeat(64), verified: true },
      database: { path: '/tmp/dev.sqlite' },
      profile: { bound: true, environment: 'development', fingerprint: 'b'.repeat(64), id: 'dev-main' },
      schema: { migration_keys: [], profile_fingerprint: 'b'.repeat(64), profile_id: 'dev-main' },
      process: { pid: 124, role: 'service', started_at: '2026-07-16T00:00:00.000Z' },
      service: { instance_id: 'instance-a', launcher_pid: 123, mode: 'managed', pid: 124, started_at: '2026-07-16T00:00:00.000Z' },
    } as unknown as LineageRuntimeInfo;
    const profile = {
      database_path: '/tmp/dev.sqlite',
      environment: 'development',
      profile_fingerprint: 'b'.repeat(64),
      profile_id: 'dev-main',
    } as ResolvedLineageProfile;
    const expected = {
      channel: 'dev' as const,
      code_fingerprint: 'a'.repeat(64),
      database_path: '/tmp/dev.sqlite',
      instance_id: 'instance-a',
      launcher_pid: 123,
      profile,
    };

    expect(lineageServiceIdentityErrors(runtime, expected)).toEqual([]);
    expect(lineageServiceIdentityErrors({
      ...runtime,
      code: { ...runtime.code!, fingerprint: 'c'.repeat(64) },
      service: { ...runtime.service!, instance_id: 'wrong-instance' },
    }, expected)).toEqual(expect.arrayContaining([
      expect.stringContaining('code fingerprint'),
      expect.stringContaining('service instance'),
    ]));
  });
});

describe('lineage CLI handoff commands', () => {
  it('returns the next lineage base from the packaged CLI contract', () => {
    seedCliDb();

    const result = runLineageDataCommand('next', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { next_asset?: { asset_id: string } | null; root_asset_id: string };

    expect(result.root_asset_id).toBe(fixtureRootAssetId);
    expect(result.next_asset?.asset_id).toBe(fixtureRootAssetId);
  });

  it('inspects an indexed asset and supports the legacy doubled lineage namespace', () => {
    seedCliDb();

    const inspected = runLineageDataCommand('inspect', [
      '--project', defaultProject,
      '--asset-id', fixtureRootAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { active_asset_id: string; nodes: Array<{ asset_id: string }> };
    const legacyNext = runLineageDataCommand('next', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { root_asset_id: string };

    expect(inspected.active_asset_id).toBe(fixtureRootAssetId);
    expect(inspected.nodes.map(node => node.asset_id)).toContain(fixtureRootAssetId);
    expect(legacyNext.root_asset_id).toBe(fixtureRootAssetId);
  });

  it('returns a lineage graph snapshot from the agent CLI namespace', () => {
    seedCliDb();

    const graph = runLineageAgentCommand('graph', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { active_asset_id: string; edges: unknown[]; nodes: Array<{ asset_id: string }>; root_asset_id: string };

    expect(graph.root_asset_id).toBe(fixtureRootAssetId);
    expect(graph.active_asset_id).toBe(fixtureRootAssetId);
    expect(graph.nodes.map(node => node.asset_id)).toContain(fixtureRootAssetId);
    expect(Array.isArray(graph.edges)).toBe(true);
  });

  it('exports a durable active lineage selection packet from the CLI contract', () => {
    seedCliDb();
    updateSelectedAsset(defaultProject, {
      assetId: fixtureRootAssetId,
      confirmWrite: true,
      notes: 'Use this catalog image for GrowthOps.',
      rootAssetId: fixtureRootAssetId,
    });
    const out = join(cliScratchDir, 'selection-packet.json');

    const packet = runLineageDataCommand('selection', [
      'packet',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--db', cliDbFile,
      '--channel', 'linkedin',
      '--campaign', '2026-07-launch',
      '--context-notes', 'Create GrowthOps posts from selected images.',
      '--label', 'launch',
      '--label', 'agent-ready',
      '--out', out,
      '--json',
    ]) as {
      assets: Array<{ asset_id: string; s3: { key?: string }; selection_note?: string; storage_state: string }>;
      context: { labels: string[]; notes?: string };
      packet_id: string;
      schema_version: string;
      selection: { asset_ids: string[]; count: number };
      workspace: { root_asset_id: string };
    };

    const saved = JSON.parse(readFileSync(out, 'utf8')) as typeof packet;
    expect(packet.schema_version).toBe('lineage.selection_packet.v1');
    expect(packet.packet_id).toMatch(/^lineage_packet_[a-f0-9]{24}$/);
    expect(saved.packet_id).toBe(packet.packet_id);
    expect(packet.workspace.root_asset_id).toBe(fixtureRootAssetId);
    expect(packet.selection).toMatchObject({ asset_ids: [fixtureRootAssetId], count: 1 });
    expect(packet.context.labels).toEqual(['launch', 'agent-ready']);
    expect(packet.context.notes).toBe('Create GrowthOps posts from selected images.');
    expect(packet.assets[0]).toMatchObject({
      asset_id: fixtureRootAssetId,
      selection_note: 'Use this catalog image for GrowthOps.',
      storage_state: 's3_backed',
    });
    expect(packet.assets[0].s3.key).toContain(fixtureRootAssetId);
  });

  it('exports versioned packets only when explicitly selected and rejects unsupported packet schemas', () => {
    seedCliDb();
    const localFile = join(cliScratchDir, 'v2-cli-selection.png');
    writeFileSync(localFile, Buffer.from('v2-cli-selection'));
    indexLineageAssets(defaultProject);
    const localAssetId = `local-${fileSha256(localFile).slice(0, 12)}`;
    updateSelectedAsset(defaultProject, {
      assetId: localAssetId,
      confirmWrite: true,
      rootAssetId: localAssetId,
    });

    const packet = runLineageDataCommand('selection', [
      'packet',
      '--project', defaultProject,
      '--root', localAssetId,
      '--db', cliDbFile,
      '--schema', 'v2',
      '--json',
    ]) as { identity_sha256: string; packet_id: string; schema_version: string };

    expect(packet.schema_version).toBe('lineage.selection_packet.v2');
    expect(packet.identity_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(packet.packet_id).toBe(`lineage_packet_${packet.identity_sha256.slice(0, 24)}`);
    const v3 = runLineageDataCommand('selection', [
      'packet',
      '--project', defaultProject,
      '--root', localAssetId,
      '--db', cliDbFile,
      '--schema', 'v3',
      '--json',
    ]) as { identity_sha256: string; schema_version: string; selected_source_resolution_digest_sha256: string };
    expect(v3.schema_version).toBe('lineage.selection_packet.v3');
    expect(v3.identity_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(v3.selected_source_resolution_digest_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => runLineageDataCommand('selection', [
      'packet',
      '--project', defaultProject,
      '--root', localAssetId,
      '--db', cliDbFile,
      '--schema', 'v1',
    ])).toThrow('Unsupported selection packet schema: v1');
  });

  it('formats a readable agent graph digest for non-json CLI output', () => {
    const output = formatAgentGraphDigest({
      active_asset_id: 'root',
      edges: [{ parent_asset_id: 'root', child_asset_id: 'child' }],
      latest: ['child'],
      nodes: [
        { asset_id: 'root', title: 'Swissifier root' },
        { asset_id: 'child', is_latest: true, title: 'Swissifier child' },
      ],
      root_asset_id: 'root',
      selected: ['child'],
    });

    expect(output).toContain('Lineage graph: Swissifier root');
    expect(output).toContain('Root: root');
    expect(output).toContain('Active: Swissifier root (root)');
    expect(output).toContain('Nodes: 2  Edges: 1');
    expect(output).toContain('Next variation:\n- Swissifier child (child)');
    expect(output).toContain('Latest leaves:\n- Swissifier child (child)');
    expect(output).toContain('Edges:\n- Swissifier root (root) -> Swissifier child (child)');
  });

  it('requires a root for agent graph snapshots', () => {
    seedCliDb();

    expect(() =>
      runLineageAgentCommand('graph', [
        '--project', defaultProject,
        '--db', cliDbFile,
        '--json',
      ])
    ).toThrow('lineage agent graph requires --root');
  });

  it('dry-runs link-child and rejects unknown children before writing', () => {
    seedCliDb();

    const dryRun = runLineageDataCommand('link-child', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--child', fixtureChildAssetId,
      '--summary', '  Cleaner\n type  ',
      '--db', cliDbFile,
      '--json',
    ]) as { dryRun?: boolean; edge?: { child_asset_id: string; parent_asset_id: string; summary?: string; summary_created_by?: string; summary_updated_by?: string } };

    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.edge).toMatchObject({
      child_asset_id: fixtureChildAssetId,
      parent_asset_id: fixtureRootAssetId,
      summary: 'Cleaner type',
      summary_created_by: 'agent',
      summary_updated_by: 'agent',
    });
    expect(() =>
      runLineageDataCommand('link-child', [
        '--project', defaultProject,
        '--root', fixtureRootAssetId,
        '--child', 'missing-child',
        '--summary', 'Cleaner type',
        '--db', cliDbFile,
        '--json',
      ])
    ).toThrow('Unknown indexed asset: missing-child');
  });

  it('rejects missing and invalid agent edge summaries before link-child writes', () => {
    seedCliDb();
    const rowCount = () => {
      const database = new DatabaseSync(cliDbFile);
      const count = Number((database.prepare('select count(*) as count from asset_edges').get() as { count: number }).count);
      database.close();
      return count;
    };
    const before = rowCount();

    expect(() => runLineageDataCommand('link-child', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--child', fixtureChildAssetId,
      '--db', cliDbFile,
      '--confirm-write',
      '--json',
    ])).toThrow('Edge summary is required');
    expect(() => runLineageDataCommand('link-child', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--child', fixtureChildAssetId,
      '--summary', '   ',
      '--db', cliDbFile,
      '--confirm-write',
      '--json',
    ])).toThrow('Edge summary is required');
    expect(() => runLineageDataCommand('link-child', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--child', fixtureChildAssetId,
      '--summary', 'Much cleaner type',
      '--db', cliDbFile,
      '--confirm-write',
      '--json',
    ])).toThrow('Edge summary must contain at most 2 words');

    expect(rowCount()).toBe(before);
  });

  it('requires a matching claim token for confirmed link-child writes', () => {
    seedCliDb();

    expect(() =>
      runLineageDataCommand('link-child', [
        '--project', defaultProject,
        '--root', fixtureRootAssetId,
        '--child', fixtureChildAssetId,
        '--summary', 'Cleaner type',
        '--db', cliDbFile,
        '--confirm-write',
        '--json',
      ])
    ).toThrow('Mutating agent write requires a matching claim token');

    const claimed = runLineageAgentCommand('claim', [
      '--project', defaultProject,
      '--scope', 'lineage_workspace',
      '--target', lineageWorkspaceId(defaultProject, fixtureRootAssetId),
      '--target-title', 'CLI test lineage',
      '--agent-name', 'CLI test agent',
      '--db', cliDbFile,
      '--json',
    ]) as { claim_token: string };
    const linked = runLineageDataCommand('link-child', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--child', fixtureChildAssetId,
      '--summary', 'Cleaner type',
      '--db', cliDbFile,
      '--claim-token', claimed.claim_token,
      '--confirm-write',
      '--json',
    ]) as { child_asset_id: string; edge?: { child_asset_id: string; summary?: string; summary_created_by?: string; summary_updated_by?: string; summary_updated_at?: string }; message?: string };

    expect(linked.child_asset_id).toBe(fixtureChildAssetId);
    expect(linked.edge?.child_asset_id).toBe(fixtureChildAssetId);
    expect(linked.edge).toMatchObject({
      summary: 'Cleaner type',
      summary_created_by: 'agent',
      summary_updated_by: 'agent',
    });
    expect(linked.edge?.summary_updated_at).toBeTruthy();
    expect(linked.message).toContain('Linked');
  });

  it('warns and blocks link-child when the selected parent has a pending re-roll', () => {
    seedCliDb();
    markLineageRerollRequest(defaultProject, {
      rootAssetId: fixtureRootAssetId,
      nodeAssetId: fixtureRootAssetId,
      notes: 'Fix distorted headline',
      requestedBy: 'human',
      confirmWrite: true,
    });

    const dryRun = runLineageDataCommand('link-child', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--child', fixtureChildAssetId,
      '--summary', 'Cleaner type',
      '--db', cliDbFile,
      '--json',
    ]) as { dryRun?: boolean; warning?: string };

    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.warning).toContain('Pending re-roll exists');
    expect(dryRun.warning).toContain('link-child would create a visible child variation');

    expect(() =>
      runLineageDataCommand('link-child', [
        '--project', defaultProject,
        '--root', fixtureRootAssetId,
        '--child', fixtureChildAssetId,
        '--summary', 'Cleaner type',
        '--db', cliDbFile,
        '--confirm-write',
        '--json',
      ])
    ).toThrow('link-child creates a visible child variation edge');
  });

  it('prints link-child warnings in non-json output', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (value?: unknown) => logs.push(String(value));
    try {
      printDataResult('link-child', {
        dryRun: true,
        edge: { child_asset_id: 'local-child', parent_asset_id: 'local-parent' },
        warning: 'Pending re-roll exists for local-parent. Use reroll plan/import.',
      }, false);
    } finally {
      console.log = originalLog;
    }

    expect(logs).toEqual([
      'Dry run: Link local-child from local-parent',
      'Warning: Pending re-roll exists for local-parent. Use reroll plan/import.',
    ]);
  });

  it('plans, inspects, and imports a structured generation manifest through the packaged CLI contract', () => {
    seedCliDb();
    createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      createdBy: 'agent',
      rootAssetId: fixtureRootAssetId,
      title: 'CLI generation workspace',
    });
    updateSelectedAsset(defaultProject, {
      assetId: fixtureRootAssetId,
      confirmWrite: true,
      rootAssetId: fixtureRootAssetId,
    });

    const planned = runLineageDataCommand('generate', [
      'image', 'plan',
      '--project', defaultProject,
      '--prompt', 'Create one CLI manifest variation.',
      '--from-lineage-selection',
      '--count', '1',
      '--json',
    ]) as { job: { handoff: { import_command: string; output_manifest?: { outputs: Array<Record<string, unknown>> } }; id: string; status: string } };
    expect(planned.job).toMatchObject({ status: 'planned' });
    expect(planned.job.handoff.import_command).toContain('--manifest');

    const outputFile = join(cliScratchDir, 'generation-cli-output.png');
    const manifestFile = join(cliScratchDir, 'generation-cli-manifest.json');
    writeFileSync(outputFile, 'generation-cli-output');
    writeFileSync(manifestFile, `${JSON.stringify({
      ...planned.job.handoff.output_manifest,
      outputs: planned.job.handoff.output_manifest?.outputs.map(output => ({
        ...output,
        edge_summary: 'Cleaner type',
        file_path: outputFile,
      })),
    })}\n`);

    const imported = runLineageDataCommand('generate', [
      'image', 'import',
      '--project', defaultProject,
      '--job-id', planned.job.id,
      '--manifest', manifestFile,
      '--confirm-write',
      '--json',
    ]) as { imported: Array<{ edge_summary?: string }>; job: { status: string } };
    expect(imported.job.status).toBe('imported');
    expect(imported.imported.map(output => output.edge_summary)).toEqual(['Cleaner type']);

    const inspected = runLineageDataCommand('generate', [
      'image', 'inspect',
      '--project', defaultProject,
      '--job-id', planned.job.id,
      '--json',
    ]) as { job: { outputs: Array<{ edge_summary?: string }> } };
    expect(inspected.job.outputs[0].edge_summary).toBe('Cleaner type');
    expect(() => runLineageDataCommand('generate', [
      'image', 'import',
      '--project', defaultProject,
      '--job-id', planned.job.id,
      '--manifest', manifestFile,
      '--files', outputFile,
      '--confirm-write',
    ])).toThrow('Use --manifest or legacy --files/--parent-files, not both');
  });

  it('emits a complete persisted generation job larger than 65,536 bytes from an actual CLI subprocess', () => {
    seedCliDb();
    createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      createdBy: 'agent',
      rootAssetId: fixtureRootAssetId,
      title: 'Large CLI output workspace',
    });
    updateSelectedAsset(defaultProject, {
      assetId: fixtureRootAssetId,
      confirmWrite: true,
      rootAssetId: fixtureRootAssetId,
    });
    const planned = runLineageDataCommand('generate', [
      'image', 'plan',
      '--project', defaultProject,
      '--prompt', 'large-json-output-'.repeat(6_000),
      '--from-lineage-selection',
      '--count', '1',
      '--json',
    ]) as { job: { id: string } };
    const persisted = runLineageDataCommand('generate', [
      'image', 'inspect',
      '--project', defaultProject,
      '--job-id', planned.job.id,
      '--json',
    ]);

    const subprocess = spawnSync(process.execPath, [
      '--import', 'tsx',
      'src/cli/lineage-dev.ts',
      'generate', 'image', 'inspect',
      '--project', defaultProject,
      '--job-id', planned.job.id,
      '--profile', join(cliScratchDir, 'profile.json'),
      '--json',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env },
      maxBuffer: 16 * 1024 * 1024,
    });

    expect(subprocess.status, subprocess.stderr).toBe(0);
    expect(Buffer.byteLength(subprocess.stdout)).toBeGreaterThan(65_536);
    expect(JSON.parse(subprocess.stdout)).toEqual(persisted);
  });

  it('discovers targets and persists a target-aware shorthand plan for canvas parity', () => {
    seedCliDb();
    createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      createdBy: 'agent',
      rootAssetId: fixtureRootAssetId,
      title: 'CLI target-aware workspace',
    });
    updateSelectedAsset(defaultProject, {
      assetId: fixtureRootAssetId,
      confirmWrite: true,
      rootAssetId: fixtureRootAssetId,
    });

    expect(runLineageDataCommand('output-targets', ['list', '--media', 'image', '--json'])).toMatchObject({
      schema_version: 'lineage.output_target_registry.v1',
    });
    expect(runLineageDataCommand('output-targets', ['resolve', '--query', 'Instagram', '--json'])).toMatchObject({
      status: 'ambiguous',
      choices: expect.arrayContaining([expect.objectContaining({ surface_id: 'instagram.story', width: 1080, height: 1920 })]),
    });
    expect(runLineageDataCommand('output-targets', [
      'defaults', '--project', defaultProject, '--root', fixtureRootAssetId, '--json',
    ])).toMatchObject({ defaults: null, read_only: true });

    const planned = runLineageDataCommand('generate', [
      'image', 'plan',
      '--project', defaultProject,
      '--prompt', 'Create locked CLI variants.',
      '--from-lineage-selection',
      '--destination', 'instagram.story',
      '--destination', 'facebook.story',
      '--separate-destination', 'facebook.story',
      '--custom-dimensions', '1200x1500',
      '--variants-per-target', '2',
      '--json',
    ]) as { job: { adapter_version: string; handoff: { schema_version: string; output_manifest?: { schema_version: string } }; id: string; target_plan?: { expected_output_count: number; groups: unknown[] } } };
    expect(planned.job).toMatchObject({
      adapter_version: 'generation-receipts-v3',
      handoff: {
        schema_version: 'lineage.generation_handoff.v3',
        output_manifest: { schema_version: 'lineage.generation_output_manifest.v2' },
      },
      target_plan: { expected_output_count: 6 },
    });
    const inspected = runLineageDataCommand('generate', [
      'image', 'inspect', '--project', defaultProject, '--job-id', planned.job.id, '--json',
    ]) as typeof planned;
    expect(inspected.job.target_plan).toEqual(planned.job.target_plan);
    expect(() => runLineageDataCommand('generate', [
      'image', 'plan',
      '--project', defaultProject,
      '--prompt', 'Reject ambiguous target.',
      '--from-lineage-selection',
      '--destination', 'Instagram',
      '--json',
    ])).toThrow('requires an explicit delivery surface');
    expect(() => runLineageDataCommand('generate', [
      'image', 'plan',
      '--project', defaultProject,
      '--prompt', 'Reject legacy count.',
      '--from-lineage-selection',
      '--destination', 'instagram.story',
      '--count', '1',
      '--json',
    ])).toThrow('does not accept legacy --count');

    const malformedTargetMap = join(cliScratchDir, 'malformed-target-map.json');
    writeFileSync(malformedTargetMap, JSON.stringify({
      schema_version: 'lineage.generation_target_map.v1',
      sources: [{
        asset_id: fixtureRootAssetId,
        targets: [{ kind: 'custom', width: 1200, height: 1500, inferred_platform: 'Pinterest' }],
      }],
    }));
    expect(() => runLineageDataCommand('generate', [
      'image', 'plan',
      '--project', defaultProject,
      '--prompt', 'Reject future-looking target fields.',
      '--from-lineage-selection',
      '--target-map', malformedTargetMap,
      '--json',
    ])).toThrow('Custom target contains unknown field: inferred_platform');
  });

  it('bridges v3 selection intent through explicit node mutations, planning, inspect, and cancellation', () => {
    seedCliDb();
    const localFile = join(cliScratchDir, 'node-target-v3.png');
    writeFileSync(localFile, Buffer.from('node-target-v3'));
    indexLineageAssets(defaultProject);
    const nodeId = `local-${fileSha256(localFile).slice(0, 12)}`;
    createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      createdBy: 'agent',
      rootAssetId: nodeId,
      title: 'CLI node-target workspace',
    });
    updateSelectedAsset(defaultProject, {
      assetId: nodeId,
      confirmWrite: true,
      rootAssetId: nodeId,
    });
    expect(runLineageDataCommand('output-targets', [
      'node', 'get', '--project', defaultProject, '--root', nodeId,
      '--node', nodeId, '--json',
    ])).toMatchObject({ setting: null, effective: { origin: 'unresolved' } });
    expect(() => runLineageDataCommand('output-targets', [
      'node', 'set', '--project', defaultProject, '--root', nodeId,
      '--node', nodeId, '--destination', 'Instagram', '--confirm-write',
    ])).toThrow(/requires an explicit delivery surface/i);

    const set = runLineageDataCommand('output-targets', [
      'node', 'set', '--project', defaultProject, '--root', nodeId,
      '--node', nodeId,
      '--destination', 'instagram.story',
      '--destination', 'facebook.story',
      '--custom-dimensions', '1200x628',
      '--confirm-write', '--json',
    ]) as { setting: { revision: number }; effective: { resolved_targets: Array<{ height: number; width: number }> } };
    expect(set.setting.revision).toBe(1);
    expect(set.effective.resolved_targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ width: 1080, height: 1920 }),
      expect.objectContaining({ width: 1200, height: 628 }),
    ]));
    expect(() => runLineageDataCommand('output-targets', [
      'node', 'set', '--project', defaultProject, '--root', nodeId,
      '--node', nodeId, '--custom-dimensions', '1080x1080', '--confirm-write',
    ])).toThrow(/revision conflict/i);
    expect(() => runLineageDataCommand('output-targets', [
      'node', 'replace', '--project', defaultProject, '--root', nodeId,
      '--node', nodeId, '--expected-revision', '1',
      '--custom-dimensions', '1080x1080', '--force', '--confirm-write',
    ])).toThrow(/do not support --force/i);
    expect(() => runLineageDataCommand('output-targets', [
      'node', 'replace', '--project', defaultProject, '--root', nodeId,
      '--node', nodeId, '--expected-revision', '1',
      '--custom-dimensions', '1080x1080', '--variants-per-target', '3', '--confirm-write',
    ])).toThrow(/job-time options/i);

    const packet = runLineageDataCommand('selection', [
      'packet', '--project', defaultProject, '--root', nodeId,
      '--schema', 'v3', '--json',
    ]) as {
      assets: Array<{ current_geometry: unknown; next_output_targets: { setting_revision: number } }>;
      schema_version: string;
      selected_source_resolution_digest_sha256: string;
    };
    expect(packet).toMatchObject({
      schema_version: 'lineage.selection_packet.v3',
      assets: [{ current_geometry: null, next_output_targets: { setting_revision: 1 } }],
    });
    const planned = runLineageDataCommand('generate', [
      'image', 'plan', '--project', defaultProject,
      '--prompt', 'Use the exact persisted next-output targets.',
      '--from-lineage-selection', '--from-node-targets',
      '--expected-target-resolution-digest', packet.selected_source_resolution_digest_sha256,
      '--variants-per-target', '2', '--json',
    ]) as {
      job: {
        expected_output_count: number;
        id: string;
        source_target_resolutions: unknown[];
        status: string;
      };
    };
    expect(planned.job).toMatchObject({
      expected_output_count: 4,
      source_target_resolutions: [{ setting_revision: 1 }],
      status: 'planned',
    });
    expect(() => runLineageDataCommand('generate', [
      'image', 'plan', '--project', defaultProject,
      '--prompt', 'Refuse missing packet digest.',
      '--from-lineage-selection', '--from-node-targets',
    ])).toThrow(/requires --expected-target-resolution-digest/i);

    const replaced = runLineageDataCommand('output-targets', [
      'node', 'replace', '--project', defaultProject, '--root', nodeId,
      '--node', nodeId, '--expected-revision', '1',
      '--custom-dimensions', '1080x1080', '--confirm-write', '--json',
    ]) as { setting: { revision: number } };
    expect(replaced.setting.revision).toBe(2);
    const inspected = runLineageDataCommand('generate', [
      'image', 'inspect', '--project', defaultProject, '--job-id', planned.job.id, '--json',
    ]) as typeof planned;
    expect(inspected.job.source_target_resolutions).toEqual(planned.job.source_target_resolutions);
    expect(runLineageDataCommand('generate', [
      'image', 'cancel', '--project', defaultProject, '--job-id', planned.job.id,
      '--confirm-write', '--json',
    ])).toMatchObject({ job: { status: 'cancelled' } });
    expect(runLineageDataCommand('output-targets', [
      'node', 'clear', '--project', defaultProject, '--root', nodeId,
      '--node', nodeId, '--expected-revision', '2',
      '--confirm-write', '--json',
    ])).toMatchObject({ cleared: true, effective: { origin: 'unresolved' } });
  });

  it('scaffolds frozen target-aware slots without placeholders or clobbering', () => {
    seedCliDb(join(cliScratchDir, 'scaffold-assets'));
    createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      createdBy: 'agent',
      rootAssetId: fixtureRootAssetId,
      title: 'CLI scaffold workspace',
    });
    updateSelectedAsset(defaultProject, {
      assetId: fixtureRootAssetId,
      confirmWrite: true,
      rootAssetId: fixtureRootAssetId,
    });
    const planned = runLineageDataCommand('generate', [
      'image', 'plan',
      '--project', defaultProject,
      '--prompt', 'Create two frozen scaffold slots.',
      '--from-lineage-selection',
      '--custom-dimensions', '23x19',
      '--variants-per-target', '2',
      '--json',
    ]) as { job: { handoff: { output_manifest: { outputs: Array<Record<string, unknown>> } }; id: string } };
    const frozen = structuredClone(planned.job.handoff.output_manifest);
    const scaffold = runLineageDataCommand('generate', [
      'image', 'scaffold',
      '--project', defaultProject,
      '--job-id', planned.job.id,
      '--format', 'webp',
      '--confirm-write',
      '--json',
    ]) as {
      manifest_path: string;
      outputs: Array<{
        absolute_path: string;
        file_path: string;
        height: number;
        output_index: number;
        output_spec_digest: string;
        target_group_id: string;
        variant_index: number;
        width: number;
      }>;
    };

    expect(scaffold.outputs).toEqual([
      expect.objectContaining({ file_path: `.asset-scratch/generation/${planned.job.id}/output-000.webp`, height: 19, output_index: 0, variant_index: 0, width: 23 }),
      expect.objectContaining({ file_path: `.asset-scratch/generation/${planned.job.id}/output-001.webp`, height: 19, output_index: 1, variant_index: 1, width: 23 }),
    ]);
    expect(scaffold.outputs.every(output => output.target_group_id && output.output_spec_digest.length === 64)).toBe(true);
    expect(scaffold.outputs.every(output => !existsSync(output.absolute_path))).toBe(true);
    const written = JSON.parse(readFileSync(scaffold.manifest_path, 'utf8')) as typeof frozen;
    expect(written.outputs.map(output => ({ ...output, file_path: '' }))).toEqual(frozen.outputs);
    expect(written.outputs.every(output => output.edge_summary === '')).toBe(true);
    expect(() => runLineageDataCommand('generate', [
      'image', 'scaffold',
      '--project', defaultProject,
      '--job-id', planned.job.id,
      '--format', 'webp',
      '--confirm-write',
      '--json',
    ])).toThrow('Generation scaffold already exists');
  });

  it('imports an exact scaffold raster and atomically rejects a wrong-size scaffold batch', async () => {
    seedCliDb(join(cliScratchDir, 'scaffold-import-assets'));
    createLineageWorkspace(defaultProject, {
      activate: true,
      confirmWrite: true,
      createdBy: 'agent',
      rootAssetId: fixtureRootAssetId,
      title: 'CLI scaffold import workspace',
    });
    updateSelectedAsset(defaultProject, {
      assetId: fixtureRootAssetId,
      confirmWrite: true,
      rootAssetId: fixtureRootAssetId,
    });
    const plan = (prompt: string, variants: number) => runLineageDataCommand('generate', [
      'image', 'plan',
      '--project', defaultProject,
      '--prompt', prompt,
      '--from-lineage-selection',
      '--custom-dimensions', '23x19',
      '--variants-per-target', String(variants),
      '--json',
    ]) as { job: { id: string } };
    const scaffold = (jobId: string) => runLineageDataCommand('generate', [
      'image', 'scaffold',
      '--project', defaultProject,
      '--job-id', jobId,
      '--format', 'png',
      '--confirm-write',
      '--json',
    ]) as { manifest_path: string; outputs: Array<{ absolute_path: string }> };
    const fillSummaries = (manifestPath: string) => {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { outputs: Array<{ edge_summary: string }> };
      manifest.outputs.forEach((output, index) => {
        output.edge_summary = index === 0 ? 'Exact image' : 'Second image';
      });
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    };

    const exactPlan = plan('Import one exact scaffold raster.', 1);
    const exactScaffold = scaffold(exactPlan.job.id);
    await sharp({ create: { background: '#8a2be2', channels: 4, height: 19, width: 23 } })
      .png()
      .toFile(exactScaffold.outputs[0].absolute_path);
    fillSummaries(exactScaffold.manifest_path);
    const imported = runLineageDataCommand('generate', [
      'image', 'import',
      '--project', defaultProject,
      '--job-id', exactPlan.job.id,
      '--manifest', exactScaffold.manifest_path,
      '--confirm-write',
      '--json',
    ]) as { imported: unknown[]; job: { status: string } };
    expect(imported).toMatchObject({ job: { status: 'imported' } });
    expect(imported.imported).toHaveLength(1);

    updateSelectedAsset(defaultProject, {
      assetId: fixtureRootAssetId,
      confirmWrite: true,
      rootAssetId: fixtureRootAssetId,
    });
    const wrongPlan = plan('Reject a mixed-size scaffold batch.', 2);
    const wrongScaffold = scaffold(wrongPlan.job.id);
    await sharp({ create: { background: '#173f5f', channels: 4, height: 19, width: 23 } })
      .png()
      .toFile(wrongScaffold.outputs[0].absolute_path);
    await sharp({ create: { background: '#ed553b', channels: 4, height: 19, width: 24 } })
      .png()
      .toFile(wrongScaffold.outputs[1].absolute_path);
    fillSummaries(wrongScaffold.manifest_path);
    const rejectedAssetIds = wrongScaffold.outputs.map(output => `local-${fileSha256(output.absolute_path).slice(0, 12)}`);
    const rejectedState = () => {
      const database = new DatabaseSync(cliDbFile);
      try {
        return {
          assets: (database.prepare('select count(*) as count from assets where id in (?, ?)').get(...rejectedAssetIds) as { count: number }).count,
          edges: (database.prepare('select count(*) as count from asset_edges where child_asset_id in (?, ?)').get(...rejectedAssetIds) as { count: number }).count,
          outputSpecs: (database.prepare('select count(*) as count from asset_output_specs where generation_job_id = ?').get(wrongPlan.job.id) as { count: number }).count,
          outputs: (database.prepare('select count(*) as count from generation_job_outputs where job_id = ?').get(wrongPlan.job.id) as { count: number }).count,
        };
      } finally {
        database.close();
      }
    };
    const beforeRejectedImport = rejectedState();
    expect(() => runLineageDataCommand('generate', [
      'image', 'import',
      '--project', defaultProject,
      '--job-id', wrongPlan.job.id,
      '--manifest', wrongScaffold.manifest_path,
      '--confirm-write',
      '--json',
    ])).toThrow(/requires 23x19 pixels, decoded 24x19/);
    const rejected = runLineageDataCommand('generate', [
      'image', 'inspect',
      '--project', defaultProject,
      '--job-id', wrongPlan.job.id,
      '--json',
    ]) as { job: { outputs: unknown[]; status: string } };
    expect(rejected.job).toMatchObject({ outputs: [], status: 'planned' });
    expect(rejectedState()).toEqual(beforeRejectedImport);
    expect(beforeRejectedImport).toMatchObject({ outputSpecs: 0, outputs: 0 });
  });

  it('requires safe confirmed profile-bound scaffold arguments and supported formats', () => {
    seedCliDb();
    expect(() => runLineageDataCommand('generate', [
      'image', 'scaffold', '--project', defaultProject, '--job-id', '../escape', '--confirm-write',
    ])).toThrow('safe identifier');
    expect(() => runLineageDataCommand('generate', [
      'image', 'scaffold', '--project', defaultProject, '--job-id', 'safe-job', '--format', 'jpg', '--confirm-write',
    ])).toThrow('--format must be png, jpeg, or webp');
    expect(() => runLineageDataCommand('generate', [
      'image', 'scaffold', '--project', defaultProject, '--job-id', 'safe-job',
    ])).toThrow('requires --confirm-write');
    delete process.env.LINEAGE_PROFILE_ID;
    expect(() => runLineageDataCommand('generate', [
      'image', 'scaffold', '--project', defaultProject, '--job-id', 'safe-job', '--confirm-write',
    ])).toThrow('requires a named --profile');
  });

  it('lists, plans, and imports re-roll targets from the packaged CLI contract', () => {
    seedCliDb();
    markLineageRerollRequest(defaultProject, {
      rootAssetId: fixtureRootAssetId,
      nodeAssetId: fixtureRootAssetId,
      notes: 'Fix broken text',
      requestedBy: 'human',
      confirmWrite: true,
    });

    const listed = runLineageDataCommand('reroll', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { requests?: Array<{ node_asset_id: string }> };
    expect(listed.requests?.map(request => request.node_asset_id)).toEqual([fixtureRootAssetId]);

    const planned = runLineageDataCommand('reroll', [
      'plan',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--prompt', 'Regenerate with clean readable text.',
      '--json',
    ]) as { job?: { id: string; source_mode: string } };
    expect(planned.job).toMatchObject({ source_mode: 'lineage_reroll' });

    mkdirSync(cliScratchDir, { recursive: true });
    const outputFile = join(cliScratchDir, 'reroll-cli-output.png');
    writeFileSync(outputFile, 'reroll-cli-output');
    const imported = runLineageDataCommand('reroll', [
      'import',
      '--project', defaultProject,
      '--job-id', planned.job?.id || '',
      '--file', outputFile,
      '--confirm-write',
      '--json',
    ]) as { imported?: Array<{ parent_asset_id: string }>; job?: { status: string } };

    expect(imported.job?.status).toBe('imported');
    expect(imported.imported?.[0].parent_asset_id).toBe(fixtureRootAssetId);
  });

  it('marks and cancels re-roll targets from the packaged CLI contract', () => {
    seedCliDb();

    const dryMarked = runLineageDataCommand('reroll', [
      'mark',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--notes', 'Fix distorted headline',
      '--json',
    ]) as { dryRun?: boolean; request?: { node_asset_id: string; requested_by: string } };
    expect(dryMarked).toMatchObject({
      dryRun: true,
      request: {
        node_asset_id: fixtureRootAssetId,
        requested_by: 'agent',
      },
    });

    const emptyList = runLineageDataCommand('reroll', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { requests?: Array<{ node_asset_id: string }> };
    expect(emptyList.requests).toEqual([]);

    const marked = runLineageDataCommand('reroll', [
      'mark',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--notes', 'Fix distorted headline',
      '--confirm-write',
      '--json',
    ]) as { request?: { node_asset_id: string; notes?: string; requested_by: string; status: string } };
    expect(marked.request).toMatchObject({
      node_asset_id: fixtureRootAssetId,
      notes: 'Fix distorted headline',
      requested_by: 'agent',
      status: 'pending',
    });

    const listed = runLineageDataCommand('reroll', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { requests?: Array<{ node_asset_id: string; notes?: string }> };
    expect(listed.requests).toHaveLength(1);
    expect(listed.requests?.[0]).toMatchObject({ node_asset_id: fixtureRootAssetId, notes: 'Fix distorted headline' });

    const dryCancelled = runLineageDataCommand('reroll', [
      'cancel',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--json',
    ]) as { dryRun?: boolean; request?: { status: string } };
    expect(dryCancelled).toMatchObject({ dryRun: true, request: { status: 'cancelled' } });

    const stillListed = runLineageDataCommand('reroll', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { requests?: Array<{ node_asset_id: string }> };
    expect(stillListed.requests?.map(request => request.node_asset_id)).toEqual([fixtureRootAssetId]);

    const cancelled = runLineageDataCommand('reroll', [
      'cancel',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--confirm-write',
      '--json',
    ]) as { request?: { node_asset_id: string; status: string } };
    expect(cancelled.request).toMatchObject({ node_asset_id: fixtureRootAssetId, status: 'cancelled' });

    const finalList = runLineageDataCommand('reroll', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { requests?: Array<{ node_asset_id: string }> };
    expect(finalList.requests).toEqual([]);
  });

  it('marks, lists, and unmarks social candidates from the packaged CLI contract', () => {
    seedCliDb();

    expect(() => runLineageDataCommand('social', [
      'list',
      '--root', fixtureRootAssetId,
      '--json',
    ])).toThrow('lineage social list requires --project');

    const dryRun = runLineageDataCommand('social', [
      'mark',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--asset', fixtureRootAssetId,
      '--actor', 'agent:cli',
      '--notes', 'Prepare channel copy',
      '--json',
    ]) as { active: boolean; dryRun?: boolean; schema_version?: string };
    expect(dryRun).toMatchObject({ active: true, dryRun: true, ok: true, schema_version: 'lineage.social_mark_mutation.v1' });

    const empty = runLineageDataCommand('social', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { marks: unknown[] };
    expect(empty.marks).toEqual([]);

    const marked = runLineageDataCommand('social', [
      'mark',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--asset', fixtureRootAssetId,
      '--actor', 'agent:cli',
      '--notes', 'Prepare channel copy',
      '--confirm-write',
      '--json',
    ]) as { schema_version?: string };
    expect(marked.schema_version).toBe('lineage.social_mark_mutation.v1');
    const listed = runLineageDataCommand('social', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { marks: Array<{ asset_id: string; marked_by: string; notes?: string }> };
    expect(listed.marks).toEqual([
      expect.objectContaining({
        asset_id: fixtureRootAssetId,
        marked_by: 'agent:cli',
        notes: 'Prepare channel copy',
      }),
    ]);

    const unmarked = runLineageDataCommand('social', [
      'unmark',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--asset', fixtureRootAssetId,
      '--actor', 'agent:cli',
      '--confirm-write',
      '--json',
    ]) as { schema_version?: string };
    expect(unmarked.schema_version).toBe('lineage.social_mark_mutation.v1');
    const finalList = runLineageDataCommand('social', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { marks: unknown[] };
    expect(finalList.marks).toEqual([]);
  });

  it('treats only social mark and unmark as managed writer mutations', () => {
    expect(lineageCliRequiresWriterLease('social', ['list'])).toBe(false);
    expect(lineageCliRequiresWriterLease('social', ['mark'])).toBe(true);
    expect(lineageCliRequiresWriterLease('social', ['unmark'])).toBe(true);
    expect(lineageCliCanDelegateMutation('social', ['list'])).toBe(false);
    expect(lineageCliCanDelegateMutation('social', ['mark'])).toBe(true);
    expect(lineageCliCanDelegateMutation('social', ['unmark'])).toBe(true);
  });

  it('manages lineage task queue commands from the packaged CLI contract', () => {
    seedCliDb();
    const marked = runLineageDataCommand('reroll', [
      'mark',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--notes', 'Fix distorted task text',
      '--confirm-write',
      '--json',
    ]) as { task?: { id: string; status: string; task_type: string } };
    const taskId = marked.task?.id || '';

    const listed = runLineageDataCommand('tasks', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { tasks: Array<{ id: string; status: string; task_type: string }> };
    expect(listed.tasks.map(task => ({ id: task.id, status: task.status, task_type: task.task_type }))).toEqual([
      { id: taskId, status: 'pending', task_type: 'reroll' },
    ]);

    const instructed = runLineageDataCommand('tasks', [
      'instructions',
      '--project', defaultProject,
      '--task', taskId,
      '--instructions', 'Preserve the palette while replacing unreadable text.',
      '--json',
    ]) as { events: Array<{ event_type: string }>; task: { instructions?: string; status: string } };
    expect(instructed.task.instructions).toBe('Preserve the palette while replacing unreadable text.');
    expect(instructed.events.map(event => event.event_type)).toContain('instructions_updated');

    const inspected = runLineageDataCommand('tasks', [
      'inspect',
      '--project', defaultProject,
      '--task', taskId,
      '--json',
    ]) as { events: Array<{ event_type: string }>; task: { id: string; status: string; task_type: string } };
    expect(inspected.task).toMatchObject({ id: taskId, status: 'pending', task_type: 'reroll' });
    expect(inspected.events.map(event => event.event_type)).toContain('created');

    const claimed = runLineageDataCommand('tasks', [
      'claim',
      '--project', defaultProject,
      '--task', taskId,
      '--agent-name', 'CLI task worker',
      '--json',
    ]) as { claim_token: string; task: { status: string } };
    expect(claimed.claim_token).toMatch(/^claim_[a-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(claimed.task.status).toBe('claimed');

    const started = runLineageDataCommand('tasks', [
      'start',
      '--project', defaultProject,
      '--task', taskId,
      '--claim-token', claimed.claim_token,
      '--json',
    ]) as { events: Array<{ event_type: string }>; task: { status: string } };
    expect(started.task.status).toBe('in_progress');
    expect(JSON.stringify(started)).not.toContain(claimed.claim_token);

    const commented = runLineageDataCommand('tasks', [
      'comment',
      '--project', defaultProject,
      '--task', taskId,
      '--message', 'Comment from the CLI contract test.',
      '--json',
    ]) as { events: Array<{ event_type: string; message?: string }>; task: { status: string } };
    expect(commented.events.map(event => event.event_type)).toContain('comment_added');
    expect(commented.events.find(event => event.event_type === 'comment_added')?.message).toBe('Comment from the CLI contract test.');

    const dryCancelled = runLineageDataCommand('tasks', [
      'cancel',
      '--project', defaultProject,
      '--task', taskId,
      '--override',
      '--json',
    ]) as { dryRun?: boolean; task: { status: string } };
    expect(dryCancelled).toMatchObject({ dryRun: true, task: { status: 'cancelled' } });

    const cancelled = runLineageDataCommand('tasks', [
      'cancel',
      '--project', defaultProject,
      '--task', taskId,
      '--confirm-write',
      '--override',
      '--json',
    ]) as { events: Array<{ event_type: string }>; task: { status: string } };
    expect(cancelled.task.status).toBe('cancelled');
    expect(cancelled.events.map(event => event.event_type)).toContain('cancelled');

    expect(() => runLineageDataCommand('tasks', ['list', '--project', defaultProject, '--json'])).toThrow('lineage tasks list requires --root');
    expect(() => runLineageDataCommand('tasks', ['inspect', '--project', defaultProject, '--json'])).toThrow('lineage tasks inspect requires --task');
    expect(() => runLineageDataCommand('tasks', ['claim', '--project', defaultProject, '--task', taskId, '--json'])).toThrow('lineage tasks claim requires --agent-name');
    expect(() => runLineageDataCommand('tasks', ['start', '--project', defaultProject, '--task', taskId, '--json'])).toThrow('lineage tasks start requires --claim-token');
    expect(() => runLineageDataCommand('tasks', ['comment', '--project', defaultProject, '--task', taskId, '--json'])).toThrow('lineage tasks comment requires --message');
    expect(() => runLineageDataCommand('tasks', ['cancel', '--project', defaultProject, '--json'])).toThrow('lineage tasks cancel requires --task');
    expect(() => runLineageDataCommand('tasks', ['override', '--project', defaultProject, '--json'])).toThrow('lineage tasks override requires --task');
    expect(() => runLineageDataCommand('tasks', ['override', '--project', defaultProject, '--task', taskId, '--json'])).toThrow('lineage tasks override requires --reason');
    expect(() => runLineageDataCommand('tasks', ['instructions', '--project', defaultProject, '--task', taskId, '--json'])).toThrow('lineage tasks instructions requires --instructions');
  });

  it('overrides an active lineage task from the CLI back to pending with updated instructions', () => {
    seedCliDb();
    const marked = runLineageDataCommand('reroll', [
      'mark',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--notes', 'Original task instructions',
      '--confirm-write',
      '--json',
    ]) as { task?: { id: string } };
    const taskId = marked.task?.id || '';

    const claimed = runLineageDataCommand('tasks', [
      'claim',
      '--project', defaultProject,
      '--task', taskId,
      '--agent-name', 'CLI override worker',
      '--json',
    ]) as { claim_token: string };
    runLineageDataCommand('tasks', [
      'start',
      '--project', defaultProject,
      '--task', taskId,
      '--claim-token', claimed.claim_token,
      '--json',
    ]);

    const overridden = runLineageDataCommand('tasks', [
      'override',
      '--project', defaultProject,
      '--task', taskId,
      '--reason', 'Human is reassigning this task.',
      '--instructions', 'Use the updated override instructions.',
      '--json',
    ]) as { events: Array<{ event_type: string }>; task: { instructions?: string; status: string } };

    expect(overridden.task).toMatchObject({
      instructions: 'Use the updated override instructions.',
      status: 'pending',
    });
    expect(overridden.events.map(event => event.event_type)).toContain('human_override');
  });

  it('prints readable task queue results in non-json output', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (value?: unknown) => logs.push(String(value));
    try {
      printDataResult('tasks', {
        tasks: [
          { id: 'task-1', status: 'pending', task_type: 'reroll', target_asset_id: 'asset-1' },
          { id: 'task-2', status: 'in_progress', task_type: 'iterate', target_asset_id: 'asset-2' },
        ],
      }, false);
      printDataResult('tasks', {
        task: { id: 'task-1', status: 'claimed', task_type: 'reroll', target_asset_id: 'asset-1' },
        events: [{ event_type: 'created' }, { event_type: 'claimed' }],
        claim_token: 'claim_task.secret_123',
      }, false);
    } finally {
      console.log = originalLog;
    }

    expect(logs).toEqual([
      '2 lineage task(s)',
      'task-1 reroll pending asset-1',
      'task-2 iterate in_progress asset-2',
      'task-1 reroll claimed asset-1',
      'Token: claim_task.secret_123',
      'Events: created, claimed',
    ]);
  });

  it('keeps package docs aligned with claim-aware mutating command contracts', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    const operator = readFileSync(join(repoRoot, 'plugins/lineage-codex-plugin/skills/lineage-package-operator/SKILL.md'), 'utf8');

    expect(readme).toContain('lineage agent claim --project demo-project --scope lineage_workspace');
    expect(readme).toContain('lineage link-child --project demo-project --root <root-asset-id> --child <child-asset-id> --summary "Cleaner type" --claim-token "$LINEAGE_CLAIM_TOKEN" --confirm-write --json');
    expect(operator).toContain('Pass `--profile` on every operational command');
    expect(operator).toContain('lineage-stable agent claim --profile "$LINEAGE_PROD_PROFILE"');
    expect(operator).toContain('Heartbeat while working');
    expect(operator).toContain('`link-child` only for a visible child variation');
    expect(operator).toContain('`--summary` describing the change from parent to child');
    expect(readme).toContain('lineage reroll mark --project demo-project --root <root-asset-id> --target <target-asset-id> --notes "Fix distorted text" --confirm-write --json');
    expect(readme).toContain('lineage reroll cancel --project demo-project --root <root-asset-id> --target <target-asset-id> --confirm-write --json');
    expect(operator).toContain('`reroll mark`');
    expect(operator).toContain('Never replace `--profile` with a direct `--db` write');
    expect(operator).not.toContain('--db /absolute/path/to/lineage.sqlite');
    expect(readme).toContain('`lineage link-child` creates a new visible descendant');
    expect(readme).toContain('one- or two-word description of the change from parent to child');
    expect(readme).toContain('`lineage reroll import` updates the target node');
    expect(operator).toContain('Use `reroll mark`, `reroll');
    expect(readme).toContain('Use `project_channel` only for rare work');
    expect(operator).toContain('Persistent writes require the profile writer lease');
  });

  it('keeps the documented managed development setup build-complete', () => {
    const makefile = readFileSync(join(repoRoot, 'Makefile'), 'utf8');
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    const installDev = makefile.match(/^install-dev:\n((?:\t.*\n)+)/m)?.[1] || '';

    expect(installDev).toContain('\tnpm ci\n');
    expect(installDev).toContain('\tnpm run build\n');
    expect(installDev.indexOf('npm ci')).toBeLessThan(installDev.indexOf('npm run build'));
    expect(readme).toContain('make install-dev');
    expect(readme).toContain('make start-dev LINEAGE_DEV_PROFILE=team-development');
    expect(readme).toContain('no separate build command is needed');
  });

  it('bootstraps published Make installs without checkout build artifacts', () => {
    const makefile = readFileSync(join(repoRoot, 'Makefile'), 'utf8');
    const installProd = makefile.match(/^install-prod:\n((?:\t.*\n)+)/m)?.[1] || '';

    expect(makefile).toContain('LINEAGE_BOOTSTRAP_PREFIX ?= $(LINEAGE_RUNTIME_ROOT)/bootstrap');
    expect(makefile).toContain('LINEAGE_CHANNEL_CLI ?= $(LINEAGE_BOOTSTRAP_PREFIX)/bin/lineage-channel');
    expect(installProd).toContain('npm install --global --prefix "$(LINEAGE_BOOTSTRAP_PREFIX)" $(LINEAGE_PACKAGE)@$(PROD_TAG)');
    expect(installProd).toContain('"$(LINEAGE_CHANNEL_CLI)" install stable');
    expect(installProd).toContain('--root "$(LINEAGE_RUNTIME_ROOT)"');
    expect(installProd).toContain('--shim-dir "$(LINEAGE_USER_BIN)"');
    expect(installProd).not.toContain('node dist/cli/lineage-channel.js');
    expect(makefile).not.toContain('LINEAGE_CHANNEL_CLI ?= node dist/cli/lineage-channel.js');
  });

  it('uses the stable registry bootstrap for isolated preview Make installs', () => {
    const makefile = readFileSync(join(repoRoot, 'Makefile'), 'utf8');
    const installPreview = makefile.match(/^install-preview:\n((?:\t.*\n)+)/m)?.[1] || '';

    expect(installPreview).toContain('npm install --global --prefix "$(LINEAGE_BOOTSTRAP_PREFIX)" $(LINEAGE_PACKAGE)@$(PROD_TAG)');
    expect(installPreview).toContain('"$(LINEAGE_CHANNEL_CLI)" install preview');
    expect(installPreview).toContain('--root "$(LINEAGE_RUNTIME_ROOT)"');
    expect(installPreview).toContain('--shim-dir "$(LINEAGE_USER_BIN)"');
    expect(installPreview).toContain('--package $(LINEAGE_PACKAGE)@$(PREVIEW_TAG)');
    expect(installPreview).not.toContain('node dist/cli/lineage-channel.js');
  });

  it('documents the one-time fresh-profile bootstrap exception consistently', () => {
    const agents = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8');
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    const operator = readFileSync(join(repoRoot, 'plugins/lineage-codex-plugin/skills/lineage-package-operator/SKILL.md'), 'utf8');

    for (const text of [agents, readme, operator]) {
      expect(text).toContain('Fresh-profile bootstrap exception');
      expect(text).toContain('runtime doctor');
      expect(text).toContain('profile init');
      expect(text).toContain('profile doctor');
      expect(text).toContain('db info');
    }
    expect(readme).toContain([
      'npm ci &&',
      'npm run lineage:dev -- runtime doctor --json &&',
      'npm run lineage:dev -- profile init --profile team-development --confirm-write --json &&',
      'npm run lineage:dev -- runtime doctor --json &&',
      'npm run lineage:dev -- profile doctor --profile team-development --json &&',
      'npm run lineage:dev -- db info --profile team-development --json &&',
      'npm run dev -- --profile team-development',
    ].join('\n'));
    expect(readme).toContain([
      'lineage-stable runtime doctor --json &&',
      'lineage-stable profile init --profile team-production --confirm-write --json &&',
      'lineage-stable runtime doctor --json &&',
      'lineage-stable profile doctor --profile team-production --json &&',
      'lineage-stable db info --profile team-production --json &&',
      'lineage-stable start --profile team-production',
    ].join('\n'));
    expect(readme).toContain([
      'lineage-preview runtime doctor --json &&',
      'lineage-preview profile init --profile team-preview --confirm-write --json &&',
      'lineage-preview runtime doctor --json &&',
      'lineage-preview profile doctor --profile team-preview --json &&',
      'lineage-preview db info --profile team-preview --json &&',
      'lineage-preview start --profile team-preview',
    ].join('\n'));
  });

  it('ships a hermetic manual install dogfood runbook', () => {
    const runbookPath = join(repoRoot, 'MANUAL_INSTALL_DOGFOOD.md');
    expect(existsSync(runbookPath)).toBe(true);
    if (!existsSync(runbookPath)) return;

    const runbook = readFileSync(runbookPath, 'utf8');
    const packageInfo = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { files?: string[] };
    expect(packageInfo.files).toContain('MANUAL_INSTALL_DOGFOOD.md');
    for (const required of [
      'mktemp -d',
      'LINEAGE_RUNTIME_ROOT',
      'LINEAGE_PROFILE_ROOT',
      'LINEAGE_SERVICE_ROOT',
      '--codex-home',
      'runtime doctor',
      'profile doctor',
      'db info',
      'lineage-stable-service stop',
      'run_lineage_dev_dogfood npm run lineage:dev -- profile init',
      'Refusing unexpected cleanup target',
    ]) {
      expect(runbook).toContain(required);
    }
    expect(runbook).toContain([
      '  --json',
      'run_lineage_dev_dogfood npm run lineage:dev -- runtime doctor --json',
      'run_lineage_dev_dogfood npm run lineage:dev -- profile doctor',
    ].join('\n'));
  });

  it('declares the plugin installer minimum Node version', () => {
    const pluginInstaller = JSON.parse(readFileSync(join(repoRoot, 'packages', 'lineage-plugin-installer', 'package.json'), 'utf8')) as {
      engines?: { node?: string };
    };

    expect(pluginInstaller.engines?.node).toBe('>=22.22.0');
  });
});
