import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import positiveFixtures from '../../../packages/node-editor-protocol/fixtures/positive.json';
import type { PluginManifest } from '../../../packages/node-editor-protocol/generated/protocol';
import { repoRoot } from '../assetCore';
import type { NodeEditorPluginConfig, NodeEditorVerifiedInstallationRecord } from '../../shared/nodeEditorPluginTypes';
import { NodeEditorPluginRegistry, NodeEditorPluginVerificationError, publicNodeEditorPluginSummary } from './registry';

const scratch = join(repoRoot, '.asset-scratch', 'vitest-node-editor-registry');
const referenceHostPath = join(repoRoot, 'packages', 'node-editor-reference-plugin', 'src', 'host.js');
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const referenceManifest = positiveFixtures[0].value as PluginManifest;

function fixture(): { config: NodeEditorPluginConfig; record: NodeEditorVerifiedInstallationRecord } {
  const root = join(scratch, 'extracted');
  const manifestPath = join(root, 'manifest.json');
  const hostPath = join(root, 'src', 'host.js');
  const archivePath = join(scratch, 'plugin.tgz');
  const manifestBytes = `${JSON.stringify(referenceManifest, null, 2)}\n`;
  const hostBytes = readFileSync(referenceHostPath);
  const archiveBytes = Buffer.from('exact reference package archive bytes');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(manifestPath, manifestBytes);
  writeFileSync(hostPath, hostBytes);
  writeFileSync(archivePath, archiveBytes);
  const record: NodeEditorVerifiedInstallationRecord = {
    schemaVersion: 1,
    pluginId: referenceManifest.pluginId,
    contributionId: referenceManifest.nodeEditors[0].id,
    packageArchivePath: archivePath,
    packageArchiveSha256: sha256(archiveBytes),
    manifestSha256: sha256(manifestBytes),
    extractedRoot: root,
    hostSha256: sha256(hostBytes),
  };
  return { record, config: { schemaVersion: 1, experimentalEnabled: true, installations: [record] } };
}

afterEach(() => rmSync(scratch, { force: true, recursive: true }));

describe('node editor plugin registry', () => {
  it('discovers a compatible plugin only after verifying both exact byte digests', () => {
    const { config } = fixture();
    const summary = publicNodeEditorPluginSummary(new NodeEditorPluginRegistry(config).list()[0]);
    expect(summary).toMatchObject({
      pluginId: 'reference.editor',
      packageName: '@mean-weasel/lineage-node-editor-reference-plugin',
      contribution: { id: 'reference.editor' },
      protocol: { major: 1, minor: 2 },
    });
    expect(JSON.stringify(summary)).not.toContain('packageArchivePath');
    expect(JSON.stringify(summary)).not.toContain('command');
  });

  it('rejects package archive corruption', () => {
    const { config, record } = fixture();
    writeFileSync(record.packageArchivePath, Buffer.concat([readFileSync(record.packageArchivePath), Buffer.from('corrupt')]));
    expect(() => new NodeEditorPluginRegistry(config).list()).toThrow(NodeEditorPluginVerificationError);
  });

  it('rejects semantically equivalent manifest reserialization because received bytes changed', () => {
    const { config, record } = fixture();
    const manifestPath = join(record.extractedRoot, 'manifest.json');
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, JSON.stringify(parsed));
    expect(() => new NodeEditorPluginRegistry(config).get(record.contributionId)).toThrow(/exact manifest-byte SHA-256 mismatch/);
  });

  it('rejects host executable corruption after discovery', () => {
    const { config, record } = fixture();
    new NodeEditorPluginRegistry(config).list();
    writeFileSync(join(record.extractedRoot, 'src', 'host.js'), 'corrupted executable bytes');
    expect(() => new NodeEditorPluginRegistry(config).get(record.contributionId)).toThrow(/exact host-executable SHA-256 mismatch/);
  });
});
