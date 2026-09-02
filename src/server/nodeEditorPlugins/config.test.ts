import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { repoRoot } from '../assetCore';
import { useLineageTestProfile } from '../../test/lineageTestProfile';
import { loadNodeEditorPluginConfig, nodeEditorPluginConfigPath, NodeEditorPluginConfigError } from './config';

const scratch = join(repoRoot, '.asset-scratch', 'vitest-node-editor-config');

afterEach(() => rmSync(scratch, { force: true, recursive: true }));

describe('node editor plugin config', () => {
  it('defaults the experimental feature off when the profile-scoped file is absent', () => {
    const profile = useLineageTestProfile(join(scratch, 'off.sqlite'));
    expect(loadNodeEditorPluginConfig(profile)).toEqual({ schemaVersion: 1, experimentalEnabled: false, installations: [] });
    expect(nodeEditorPluginConfigPath(profile)).toBe(join(dirname(profile.manifest_path), 'node-editor-plugins.json'));
  });

  it('loads only the selected profile config and requires owner-only permissions', () => {
    const profileA = useLineageTestProfile(join(scratch, 'a.sqlite'));
    const pathA = nodeEditorPluginConfigPath(profileA);
    const config = { schemaVersion: 1, experimentalEnabled: true, installations: [] };
    writeFileSync(pathA, JSON.stringify(config), { mode: 0o600 });
    expect(loadNodeEditorPluginConfig(profileA)).toEqual(config);

    const profileB = useLineageTestProfile(join(scratch, 'b.sqlite'));
    expect(loadNodeEditorPluginConfig(profileB).experimentalEnabled).toBe(false);
    mkdirSync(dirname(pathA), { recursive: true });
    writeFileSync(pathA, JSON.stringify(config), { mode: 0o644 });
    chmodSync(pathA, 0o644);
    expect(() => loadNodeEditorPluginConfig(profileB, { path: pathA })).toThrow(NodeEditorPluginConfigError);
  });

  it('rejects unknown fields instead of silently widening the trusted record', () => {
    const profile = useLineageTestProfile(join(scratch, 'strict.sqlite'));
    const path = nodeEditorPluginConfigPath(profile);
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, experimentalEnabled: true, installations: [], token: 'must-not-live-here' }), { mode: 0o600 });
    expect(() => loadNodeEditorPluginConfig(profile)).toThrow(/unsupported or missing fields/);
  });

  it('rejects legacy arbitrary command and argument authority', () => {
    const profile = useLineageTestProfile(join(scratch, 'authority.sqlite'));
    const path = nodeEditorPluginConfigPath(profile);
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1,
      experimentalEnabled: true,
      installations: [{
        schemaVersion: 1,
        pluginId: 'reference.editor',
        contributionId: 'reference.editor',
        packageArchivePath: '/tmp/plugin.tgz',
        packageArchiveSha256: 'a'.repeat(64),
        manifestSha256: 'b'.repeat(64),
        extractedRoot: '/tmp/plugin',
        hostSha256: 'c'.repeat(64),
        editorSha256: 'd'.repeat(64),
        command: '/bin/sh',
        args: ['-c', 'anything'],
      }],
    }), { mode: 0o600 });
    expect(() => loadNodeEditorPluginConfig(profile)).toThrow(/unsupported or missing fields/);
  });
});
