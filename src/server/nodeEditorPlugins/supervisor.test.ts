import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import positiveFixtures from '../../../packages/node-editor-protocol/fixtures/positive.json';
import type { PluginManifest } from '../../../packages/node-editor-protocol/generated/protocol';
import { repoRoot } from '../assetCore';
import type { NodeEditorPluginConfig, NodeEditorVerifiedInstallationRecord } from '../../shared/nodeEditorPluginTypes';
import { NodeEditorPluginRegistry } from './registry';
import { NodeEditorPluginSupervisor } from './supervisor';

const scratch = join(repoRoot, '.asset-scratch', 'vitest-node-editor-supervisor');
const referenceHostPath = join(repoRoot, 'packages', 'node-editor-reference-plugin', 'src', 'host.js');
const referenceEditorPath = join(repoRoot, 'packages', 'node-editor-reference-plugin', 'editor', 'index.html');
const supervisors: NodeEditorPluginSupervisor[] = [];
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const referenceManifest = positiveFixtures[0].value as PluginManifest;

function registry(name: string): { registry: NodeEditorPluginRegistry; record: NodeEditorVerifiedInstallationRecord } {
  const root = join(scratch, name, 'extracted');
  const manifestPath = join(root, 'manifest.json');
  const hostPath = join(root, 'src', 'host.js');
  const archivePath = join(scratch, name, 'plugin.tgz');
  const manifestBytes = `${JSON.stringify(referenceManifest)}\n`;
  const hostBytes = readFileSync(referenceHostPath);
  const editorBytes = readFileSync(referenceEditorPath);
  const archiveBytes = Buffer.from(`archive-${name}`);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'editor'), { recursive: true });
  writeFileSync(manifestPath, manifestBytes);
  writeFileSync(hostPath, hostBytes);
  writeFileSync(join(root, 'editor', 'index.html'), editorBytes);
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
    editorSha256: sha256(editorBytes),
  };
  const config: NodeEditorPluginConfig = { schemaVersion: 1, experimentalEnabled: true, installations: [record] };
  return { registry: new NodeEditorPluginRegistry(config), record };
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map(supervisor => supervisor.stopAll()));
  rmSync(scratch, { force: true, recursive: true });
});

describe('node editor plugin supervisor', () => {
  it('launches one authenticated loopback host per profile and reuses it', async () => {
    const first = registry('first');
    const second = registry('second');
    const supervisorA = new NodeEditorPluginSupervisor('profile-a', first.registry, { idleTimeoutMs: 1_000, healthIntervalMs: 100 });
    const supervisorB = new NodeEditorPluginSupervisor('profile-b', second.registry, { idleTimeoutMs: 1_000, healthIntervalMs: 100 });
    supervisors.push(supervisorA, supervisorB);
    const a1 = await supervisorA.start('reference.editor');
    const a2 = await supervisorA.start('reference.editor');
    const b = await supervisorB.start('reference.editor');
    expect(a1).toEqual(a2);
    expect(a1.state).toBe('ready');
    expect(b.state).toBe('ready');
    const publicBytes = JSON.stringify({ a1, b });
    expect(publicBytes).not.toContain('Credential');
    expect(publicBytes).not.toContain('origin');
    expect(publicBytes).not.toContain('process-');
  });

  it('re-verifies installation bytes at launch and rejects post-discovery corruption', async () => {
    const fixture = registry('corrupt');
    fixture.registry.list();
    writeFileSync(fixture.record.packageArchivePath, 'changed after discovery');
    const supervisor = new NodeEditorPluginSupervisor('profile-corrupt', fixture.registry);
    supervisors.push(supervisor);
    await expect(supervisor.start('reference.editor')).rejects.toThrow(/package archive SHA-256 mismatch/);
  });

  it('observes deterministic idle shutdown and process cleanup', async () => {
    const fixture = registry('idle');
    const supervisor = new NodeEditorPluginSupervisor('profile-idle', fixture.registry, { idleTimeoutMs: 80, healthIntervalMs: 500 });
    supervisors.push(supervisor);
    await supervisor.start('reference.editor');
    await waitFor(() => supervisor.status('reference.editor').state === 'stopped');
    expect(supervisor.status('reference.editor')).toMatchObject({ state: 'stopped', reason: 'idle-shutdown' });
  });
});
