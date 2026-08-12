import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { fileSha256 } from './localReview';
import {
  getLineageAttempts,
  indexLineageAssets,
  linkLineageAssets,
  promoteLineageAttempt,
  recordLineageRerollAttempt,
  updateSelectedAsset,
} from './assetLineage';
import { lineageDb } from './assetLineageDb';
import { createLineageWorkspace } from './assetLineageWorkspaces';
import type { LineageSelectionPacketV2, LineageSelectionPacketV3 } from '../shared/types';
import { writeCanvasGenerationTargetDefaults } from './generationTargetDefaults';
import { writeNodeNextOutputTargetSetting } from './nodeNextOutputTargets';
import {
  canonicalLineageSelectionPacketIdentityJson,
  getLineageSelectionPacket,
  lineageSelectionPacketV2IdentityProjection,
  lineageSelectionPacketV2IdentitySha256,
  lineageSelectionPacketV3IdentityProjection,
  lineageSelectionPacketV3IdentitySha256,
  LineageSelectionPacketError,
} from './lineageSelectionPacket';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-selection-packet');
const dbFile = join(scratchDir, 'lineage-selection-packet.sqlite');
const s3Project = 'vitest-selection-packet-s3';
const s3ProjectDir = join(repoRoot, s3Project);

function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedFiles() {
  const root = join(scratchDir, 'demo-linkedin-selection-root.png');
  const child = join(scratchDir, 'demo-linkedin-selection-child.png');
  writeFileSync(root, Buffer.from('selection-packet-root'));
  writeFileSync(child, Buffer.from('selection-packet-child'));
  return {
    child,
    childId: localId(child),
    root,
    rootId: localId(root),
  };
}

function seedSelectedWorkspace() {
  const files = seedFiles();
  process.env.LINEAGE_DB = dbFile;
  indexLineageAssets(defaultProject);
  linkLineageAssets(defaultProject, { childAssetId: files.childId, confirmWrite: true, parentAssetId: files.rootId });
  updateSelectedAsset(defaultProject, {
    assetId: files.childId,
    confirmWrite: true,
    notes: 'Use this image in GrowthOps.',
    rootAssetId: files.rootId,
  });
  createLineageWorkspace(defaultProject, {
    activate: true,
    confirmWrite: true,
    notes: 'Packet test workspace',
    rootAssetId: files.rootId,
    title: 'GrowthOps packet workspace',
  });
  return files;
}

function exportV2(rootAssetId: string): LineageSelectionPacketV2 {
  return getLineageSelectionPacket(defaultProject, {
    campaign: '2026-07-launch',
    channel: 'linkedin',
    contextNotes: 'Make GrowthOps posts from selected images.',
    labels: ['launch', 'agent-ready'],
    rootAssetId,
    schema: 'v2',
  }) as LineageSelectionPacketV2;
}

function exportV3(rootAssetId: string): LineageSelectionPacketV3 {
  return getLineageSelectionPacket(defaultProject, {
    campaign: '2026-07-launch',
    channel: 'linkedin',
    contextNotes: 'Make GrowthOps posts from selected images.',
    labels: ['launch', 'agent-ready'],
    rootAssetId,
    schema: 'v3',
  }) as LineageSelectionPacketV3;
}

function seedCurrentReroll(files: ReturnType<typeof seedSelectedWorkspace>, contents = 'selection-packet-reroll') {
  const reroll = join(scratchDir, `demo-linkedin-selection-reroll-${contents}.png`);
  writeFileSync(reroll, Buffer.from(contents));
  indexLineageAssets(defaultProject);
  const rerollId = localId(reroll);
  const checksum = fileSha256(reroll);
  const result = recordLineageRerollAttempt(defaultProject, {
    assetId: rerollId,
    checksumSha256: checksum,
    confirmWrite: true,
    filePath: reroll,
    generationJobId: `job-${contents}`,
    nodeAssetId: files.childId,
    prompt: 'Clean up the selected asset.',
    rootAssetId: files.rootId,
  });
  return { attempt: result.attempt, checksum, reroll, rerollId };
}

describe('lineage selection packet', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    mkdirSync(scratchDir, { recursive: true });
    useLineageTestProfile(dbFile);
  });

  afterEach(() => {
    rmSync(s3ProjectDir, { force: true, recursive: true });
  });

  it('exports the active workspace selection with stable id and absolute local media path', () => {
    const files = seedSelectedWorkspace();

    const packet = getLineageSelectionPacket(defaultProject, {
      campaign: '2026-07-launch',
      channel: 'linkedin',
      contextNotes: 'Make GrowthOps posts from selected images.',
      labels: ['launch', 'agent-ready'],
    });
    const repeated = getLineageSelectionPacket(defaultProject, {
      campaign: '2026-07-launch',
      channel: 'linkedin',
      contextNotes: 'Make GrowthOps posts from selected images.',
      labels: ['launch', 'agent-ready'],
    });

    expect(packet).toMatchObject({
      kind: 'lineage.selection_packet',
      schema_version: 'lineage.selection_packet.v1',
      project: defaultProject,
      context: {
        campaign: '2026-07-launch',
        channel: 'linkedin',
        labels: ['launch', 'agent-ready'],
        notes: 'Make GrowthOps posts from selected images.',
      },
      selection: {
        asset_ids: [files.childId],
        count: 1,
        root_asset_id: files.rootId,
      },
      workspace: {
        root_asset_id: files.rootId,
        title: 'GrowthOps packet workspace',
      },
    });
    expect(packet.packet_id).toMatch(/^lineage_packet_[a-f0-9]{24}$/);
    expect(repeated.packet_id).toBe(packet.packet_id);
    expect(repeated.created_at).toBeDefined();
    expect(packet.assets).toHaveLength(1);
    expect(packet.assets[0]).toMatchObject({
      asset_id: files.childId,
      branch_prompt: 'Use this image in GrowthOps.',
      local: {
        absolute_path: files.child,
        exists: true,
      },
      media_type: 'image',
      selection_note: 'Use this image in GrowthOps.',
      storage_state: 'local_only',
    });
    expect(packet.assets[0].checksum_sha256).toBe(fileSha256(files.child));
    expect(packet.warnings).toContain('Image dimensions are unavailable for one or more selected assets.');
    expect(packet.errors).toEqual([]);
  });

  it('warns about missing selected local files and fails strict exports', () => {
    const files = seedSelectedWorkspace();
    rmSync(files.child, { force: true });

    const packet = getLineageSelectionPacket(defaultProject, { rootAssetId: files.rootId });

    expect(existsSync(files.child)).toBe(false);
    expect(packet.assets[0]).toMatchObject({
      asset_id: files.childId,
      local: {
        absolute_path: files.child,
        exists: false,
      },
      storage_state: 'local_only',
    });
    expect(packet.warnings.join('\n')).toContain(`Selected asset ${files.childId} has a local path but the file is missing`);
    expect(() => getLineageSelectionPacket(defaultProject, { rootAssetId: files.rootId, strict: true }))
      .toThrow(LineageSelectionPacketError);
  });

  it('keeps v1 as the unchanged default while v2 is explicitly opt in', () => {
    const files = seedSelectedWorkspace();

    const defaultPacket = getLineageSelectionPacket(defaultProject, { rootAssetId: files.rootId });
    const v2 = exportV2(files.rootId);

    expect(defaultPacket.schema_version).toBe('lineage.selection_packet.v1');
    expect(defaultPacket).not.toHaveProperty('identity_sha256');
    expect(defaultPacket).not.toHaveProperty('diagnostics');
    expect(v2.schema_version).toBe('lineage.selection_packet.v2');
    expect(v2.identity_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(v2.packet_id).toBe(`lineage_packet_${v2.identity_sha256.slice(0, 24)}`);
  });

  it('exports v3 with separate current geometry, effective future targets, and a selected-source digest', () => {
    const files = seedSelectedWorkspace();
    const unresolved = exportV3(files.rootId);
    expect(unresolved).toMatchObject({
      schema_version: 'lineage.selection_packet.v3',
      assets: [{
        asset_id: files.childId,
        current_geometry: null,
        next_output_targets: {
          node_asset_id: files.childId,
          origin: 'unresolved',
          resolved_targets: [],
        },
      }],
    });
    expect(unresolved.selected_source_resolution_digest_sha256).toMatch(/^[a-f0-9]{64}$/);

    const database = lineageDb();
    try {
      writeCanvasGenerationTargetDefaults(database, defaultProject, files.rootId, {
        actor: 'human',
        origin: 'canvas',
        default_variant_count: 7,
        targets: [{ kind: 'delivery_surface', surface_id: 'instagram.feed_portrait', surface_version: 1 }],
      });
    } finally {
      database.close();
    }
    const inherited = exportV3(files.rootId);
    expect(inherited.assets[0]).toMatchObject({
      current_geometry: null,
      next_output_targets: {
        origin: 'canvas_default',
        targets: [{ kind: 'delivery_surface', surface_id: 'instagram.feed_portrait', surface_version: 1 }],
        resolved_targets: [{ width: 1080, height: 1440 }],
      },
    });
    expect(inherited.assets[0].next_output_targets.targets[0]).not.toHaveProperty('variant_count');
    expect(inherited.selected_source_resolution_digest_sha256).not.toBe(unresolved.selected_source_resolution_digest_sha256);

    const overrideDatabase = lineageDb();
    try {
      writeNodeNextOutputTargetSetting(overrideDatabase, {
        projectId: defaultProject,
        rootAssetId: files.rootId,
        nodeAssetId: files.childId,
        expectedRevision: null,
        targets: [
          { kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 },
          { kind: 'delivery_surface', surface_id: 'facebook.story', surface_version: 1 },
        ],
        provenance: { actor: 'agent', origin: 'cli' },
      });
    } finally {
      overrideDatabase.close();
    }
    const overridden = exportV3(files.rootId);
    expect(overridden.assets[0].next_output_targets).toMatchObject({
      origin: 'node_override',
      setting_revision: 1,
      resolved_targets: [{
        width: 1080,
        height: 1920,
        delivery_surfaces: [{ id: 'facebook.story' }, { id: 'instagram.story' }],
      }],
    });
    expect(overridden.selected_source_resolution_digest_sha256).not.toBe(inherited.selected_source_resolution_digest_sha256);
    expect(lineageSelectionPacketV3IdentitySha256(overridden)).toBe(overridden.identity_sha256);
    expect(lineageSelectionPacketV3IdentityProjection(overridden)).not.toHaveProperty('created_at');
  });

  it('keeps v2 semantic identity stable across time, path, storage, source, format-like, and human-message envelope changes', () => {
    const files = seedSelectedWorkspace();
    const first = exportV2(files.rootId);
    const repeated = exportV2(files.rootId);
    const envelopeChanged = structuredClone(first) as LineageSelectionPacketV2 & { format?: string };
    envelopeChanged.created_at = '2099-01-01T00:00:00.000Z';
    envelopeChanged.source = { app: 'lineage', command: 'different', db_path: '/different/database.sqlite', package: '99.0.0' };
    envelopeChanged.assets[0].local.absolute_path = '/different/machine/current.png';
    envelopeChanged.assets[0].local.relative_path = 'different/current.png';
    envelopeChanged.assets[0].local.exists = false;
    envelopeChanged.assets[0].s3.key = 'different/storage/key.png';
    envelopeChanged.assets[0].storage_state = 'local_and_s3';
    envelopeChanged.assets[0].current_attempt.file_path = '/different/current-attempt.png';
    envelopeChanged.assets[0].current_attempt.generation_job_id = 'different-job';
    envelopeChanged.warnings = ['Human warning text and local paths can change.'];
    envelopeChanged.errors = ['Human error text can change.'];
    envelopeChanged.format = 'vertical-story';

    expect(repeated.identity_sha256).toBe(first.identity_sha256);
    expect(repeated.packet_id).toBe(first.packet_id);
    expect(lineageSelectionPacketV2IdentitySha256(envelopeChanged)).toBe(first.identity_sha256);
  });

  it('keeps v2 identity stable when the same current-attempt path is unavailable on another machine', () => {
    const files = seedSelectedWorkspace();
    const withLocalFile = exportV2(files.rootId);

    rmSync(files.child, { force: true });
    const withoutLocalFile = exportV2(files.rootId);

    expect(withoutLocalFile.assets[0].local.exists).toBe(false);
    expect(withoutLocalFile.warnings.join('\n')).toContain('current attempt has a local path but the file is missing');
    expect(withoutLocalFile.diagnostics).toEqual(withLocalFile.diagnostics);
    expect(withoutLocalFile.identity_sha256).toBe(withLocalFile.identity_sha256);
    expect(withoutLocalFile.packet_id).toBe(withLocalFile.packet_id);
  });

  it('binds v2 identity and selected media to the promoted current attempt, not stale visible-node metadata', () => {
    const files = seedSelectedWorkspace();
    const initial = exportV2(files.rootId);
    const reroll = seedCurrentReroll(files);

    const promotedReroll = exportV2(files.rootId);
    expect(promotedReroll.identity_sha256).not.toBe(initial.identity_sha256);
    expect(promotedReroll.assets[0]).toMatchObject({
      asset_id: files.childId,
      checksum_sha256: reroll.checksum,
      current_attempt: {
        asset_id: reroll.rerollId,
        attempt_index: 2,
        checksum_sha256: reroll.checksum,
        id: reroll.attempt.id,
      },
      local: {
        absolute_path: reroll.reroll,
        exists: true,
      },
    });
    expect(promotedReroll.assets[0].checksum_sha256).toBe(promotedReroll.assets[0].current_attempt.checksum_sha256);
    expect(promotedReroll.warnings.join('\n')).toContain('current attempt checksum is authoritative');

    const initialAttempt = getLineageAttempts(defaultProject, files.rootId, files.childId).attempts.find(attempt => attempt.source === 'initial');
    expect(initialAttempt).toBeDefined();
    promoteLineageAttempt(defaultProject, {
      attemptId: initialAttempt!.id,
      confirmWrite: true,
      nodeAssetId: files.childId,
      rootAssetId: files.rootId,
    });
    const restoredInitial = exportV2(files.rootId);
    expect(restoredInitial.identity_sha256).toBe(initial.identity_sha256);
  });

  it.each([
    ['missing', null],
    ['malformed', 'ABC123'],
  ])('rejects a %s current-attempt checksum even when catalog media has a usable checksum', (_label, checksum) => {
    const files = seedSelectedWorkspace();
    const database = lineageDb();
    database.prepare('update assets set checksum_sha256 = ? where id = ?').run(checksum, files.childId);
    database.close();

    let thrown: unknown;
    try {
      exportV2(files.rootId);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LineageSelectionPacketError);
    expect(thrown).toMatchObject({
      diagnostics: [{ asset_id: files.childId, code: 'current_attempt_invalid_checksum', severity: 'error' }],
      errors: ['current_attempt_invalid_checksum'],
    });
  });

  it('rejects v2 export when current-attempt local media changed after its checksum was recorded', () => {
    const files = seedSelectedWorkspace();
    writeFileSync(files.child, Buffer.from('mutated-after-index'));

    let thrown: unknown;
    try {
      exportV2(files.rootId);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LineageSelectionPacketError);
    expect(thrown).toMatchObject({
      diagnostics: [{ asset_id: files.childId, code: 'current_attempt_checksum_mismatch', severity: 'error' }],
      errors: ['current_attempt_checksum_mismatch'],
    });
  });

  it('rejects v2 export when S3-only current-attempt media contradicts the recorded checksum', () => {
    const recordedChecksum = 'a'.repeat(64);
    const envelopeChecksum = 'b'.repeat(64);
    mkdirSync(join(s3ProjectDir, 'assets'), { recursive: true });
    writeFileSync(join(s3ProjectDir, 'assets', 'catalog.json'), `${JSON.stringify({
      assets: ['root', 'child'].map(assetId => ({
        asset_id: assetId,
        content_type: 'image',
        product: s3Project,
        project: s3Project,
        s3: {
          bucket: 'test-bucket',
          checksum_sha256: envelopeChecksum,
          content_type: 'image/png',
          key: `${s3Project}/${assetId}.png`,
          region: 'us-east-1',
        },
        source: 'catalog',
        status: 'working',
        title: assetId,
      })),
      default_bucket: 'test-bucket',
      default_region: 'us-east-1',
      product: s3Project,
      project: s3Project,
    }, null, 2)}\n`);
    indexLineageAssets(s3Project);
    linkLineageAssets(s3Project, { childAssetId: 'child', confirmWrite: true, parentAssetId: 'root' });
    updateSelectedAsset(s3Project, { assetId: 'child', confirmWrite: true, rootAssetId: 'root' });
    createLineageWorkspace(s3Project, { activate: true, confirmWrite: true, rootAssetId: 'root' });
    const database = lineageDb();
    database.prepare('update assets set checksum_sha256 = ? where project_id = ? and id = ?')
      .run(recordedChecksum, s3Project, 'child');
    database.close();

    let thrown: unknown;
    try {
      getLineageSelectionPacket(s3Project, { rootAssetId: 'root', schema: 'v2' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LineageSelectionPacketError);
    expect(thrown).toMatchObject({
      diagnostics: [{ asset_id: 'child', code: 'current_attempt_checksum_mismatch', severity: 'error' }],
      errors: ['current_attempt_checksum_mismatch'],
    });
  });

  it('rejects v2 export when S3 current-attempt media contradicts a valid local copy', () => {
    const assetFiles = Object.fromEntries(['root', 'child'].map(assetId => {
      const file = join(s3ProjectDir, 'media', `${assetId}.png`);
      mkdirSync(join(s3ProjectDir, 'media'), { recursive: true });
      writeFileSync(file, Buffer.from(`local-${assetId}`));
      return [assetId, file];
    }));
    mkdirSync(join(s3ProjectDir, 'assets'), { recursive: true });
    writeFileSync(join(s3ProjectDir, 'assets', 'catalog.json'), `${JSON.stringify({
      assets: ['root', 'child'].map(assetId => ({
        asset_id: assetId,
        content_type: 'image',
        local: {
          absolute_path: assetFiles[assetId],
          checksum_sha256: fileSha256(assetFiles[assetId]),
          content_type: 'image/png',
        },
        product: s3Project,
        project: s3Project,
        s3: {
          bucket: 'test-bucket',
          checksum_sha256: 'b'.repeat(64),
          content_type: 'image/png',
          key: `${s3Project}/${assetId}.png`,
          region: 'us-east-1',
        },
        source: 'catalog',
        status: 'working',
        title: assetId,
      })),
      default_bucket: 'test-bucket',
      default_region: 'us-east-1',
      product: s3Project,
      project: s3Project,
    }, null, 2)}\n`);
    indexLineageAssets(s3Project);
    linkLineageAssets(s3Project, { childAssetId: 'child', confirmWrite: true, parentAssetId: 'root' });
    updateSelectedAsset(s3Project, { assetId: 'child', confirmWrite: true, rootAssetId: 'root' });
    createLineageWorkspace(s3Project, { activate: true, confirmWrite: true, rootAssetId: 'root' });

    let thrown: unknown;
    try {
      getLineageSelectionPacket(s3Project, { rootAssetId: 'root', schema: 'v2' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LineageSelectionPacketError);
    expect(thrown).toMatchObject({
      diagnostics: [{ asset_id: 'child', code: 'current_attempt_checksum_mismatch', severity: 'error' }],
      errors: ['current_attempt_checksum_mismatch'],
    });
  });

  it('rejects v2 export when no attempt row is explicitly marked current', () => {
    const files = seedSelectedWorkspace();
    seedCurrentReroll(files);
    const database = lineageDb();
    database.prepare(`
      insert into asset_attempts (
        id, project_id, node_asset_id, asset_id, attempt_index, source,
        file_path, checksum_sha256, created_at, promoted_at, is_current
      ) values (?, ?, ?, ?, 1, 'initial', ?, ?, ?, ?, 0)
    `).run(
      `${defaultProject}:${files.childId}:attempt:physical-initial-test`,
      defaultProject,
      files.childId,
      files.childId,
      files.child,
      fileSha256(files.child),
      '2026-07-14T00:00:00.000Z',
      '2026-07-14T00:00:00.000Z',
    );
    const result = database.prepare('update asset_attempts set is_current = 0 where node_asset_id = ?').run(files.childId);
    database.close();
    expect(Number(result.changes)).toBeGreaterThan(0);

    expect(() => exportV2(files.rootId)).toThrow(LineageSelectionPacketError);
    try {
      exportV2(files.rootId);
    } catch (error) {
      expect(error).toMatchObject({
        diagnostics: [{ asset_id: files.childId, code: 'current_attempt_invalid_identity', severity: 'error' }],
        errors: ['current_attempt_invalid_identity'],
      });
    }
  });

  it('changes v2 identity when ordered selection positions change', () => {
    const files = seedSelectedWorkspace();
    updateSelectedAsset(defaultProject, {
      assetIds: [files.rootId, files.childId],
      confirmWrite: true,
      rootAssetId: files.rootId,
    });
    const rootFirst = exportV2(files.rootId);
    updateSelectedAsset(defaultProject, {
      assetIds: [files.childId, files.rootId],
      confirmWrite: true,
      rootAssetId: files.rootId,
    });
    const childFirst = exportV2(files.rootId);

    expect(rootFirst.selection.asset_ids).toEqual([files.rootId, files.childId]);
    expect(childFirst.selection.asset_ids).toEqual([files.childId, files.rootId]);
    expect(childFirst.identity_sha256).not.toBe(rootFirst.identity_sha256);
  });

  it('binds stable diagnostic codes into identity while excluding human warning text', () => {
    const files = seedSelectedWorkspace();
    const packet = exportV2(files.rootId);
    const changedDiagnostic = structuredClone(packet);
    changedDiagnostic.diagnostics.push({ code: 'semantic_policy_notice', severity: 'warning' });
    const changedHumanWarning = structuredClone(packet);
    changedHumanWarning.warnings = ['Different human wording and /different/local/path.png'];

    expect(lineageSelectionPacketV2IdentitySha256(changedDiagnostic)).not.toBe(packet.identity_sha256);
    expect(lineageSelectionPacketV2IdentitySha256(changedHumanWarning)).toBe(packet.identity_sha256);
  });

  it('recomputes the fixture packet digest and id from the exact recursively sorted semantic projection', () => {
    const files = seedSelectedWorkspace();
    const packet = exportV2(files.rootId);
    const projection = lineageSelectionPacketV2IdentityProjection(packet);
    const canonicalJson = canonicalLineageSelectionPacketIdentityJson(projection);

    expect(canonicalJson).not.toContain('created_at');
    expect(canonicalJson).not.toContain(scratchDir);
    expect(canonicalJson).not.toContain('generation_job_id');
    expect(canonicalJson).not.toContain('warnings');
    expect(lineageSelectionPacketV2IdentitySha256(packet)).toBe(packet.identity_sha256);
    expect(packet.packet_id).toBe(`lineage_packet_${packet.identity_sha256.slice(0, 24)}`);
    expect(canonicalJson).toMatch(/^\{"context":.*,"diagnostics":.*,"product":.*,"project":.*,"schema_version":.*,"selection":.*,"workspace":.*\}$/);
  });
});
