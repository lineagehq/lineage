#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { comparePluginGuidance, inspectPluginGuidance } from './plugin-guidance.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const json = args.includes('--json');

function readOption(name) {
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { cwd: root, encoding: 'utf8', ...options });
}

const temporary = mkdtempSync(join(tmpdir(), 'lineage-plugin-release-'));
const requestedOut = readOption('--out-dir');
const outDir = resolve(requestedOut || join(temporary, 'dist'));
const target = join(temporary, 'installed');

try {
  const lineagePackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const pluginPackage = JSON.parse(readFileSync(join(root, 'plugins', 'lineage-codex-plugin', 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'plugins', 'lineage-codex-plugin', '.codex-plugin', 'plugin.json'), 'utf8'));
  const guidance = inspectPluginGuidance(join(root, 'plugins', 'lineage-codex-plugin'));
  const failures = [...guidance.failures];
  if (pluginPackage.version !== lineagePackage.version) failures.push(`plugin package ${pluginPackage.version} != Lineage ${lineagePackage.version}`);
  if (manifest.version !== lineagePackage.version) failures.push(`plugin manifest ${manifest.version} != Lineage ${lineagePackage.version}`);
  if (manifest.lineage?.package !== lineagePackage.name || manifest.lineage?.version !== lineagePackage.version) {
    failures.push('plugin lineage compatibility metadata does not exactly match the root package');
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));

  const packed = JSON.parse(run(process.execPath, [
    'packages/lineage-plugin-installer/scripts/pack-plugin.mjs',
    '--plugin', 'plugins/lineage-codex-plugin',
    '--version', lineagePackage.version,
    '--out-dir', outDir,
    '--json',
  ]));
  for (const path of guidance.files.keys()) {
    if (!packed.files.includes(path)) throw new Error(`plugin artifact is missing guidance: ${path}`);
  }
  const artifact = packed.artifactPath;
  const checksumFile = `${artifact}.sha256`;
  if (!existsSync(artifact) || !existsSync(checksumFile)) throw new Error('plugin pack did not produce artifact and checksum');
  const checksumText = readFileSync(checksumFile, 'utf8');
  if (!checksumText.includes(sha256(artifact))) throw new Error('plugin checksum file does not match the packed artifact');

  const installed = JSON.parse(run(process.execPath, [
    'packages/lineage-plugin-installer/bin/lineage-plugin-installer.mjs',
    'install',
    '--version', lineagePackage.version,
    '--artifact-file', artifact,
    '--checksum-file', checksumFile,
    '--target-dir', target,
    '--json',
  ]));
  const installedRoot = join(target, manifest.name);
  const installedManifest = JSON.parse(readFileSync(join(installedRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  const installedGuidance = inspectPluginGuidance(installedRoot);
  const installedFailures = [
    ...installedGuidance.failures,
    ...comparePluginGuidance(guidance.files, installedGuidance.files),
  ];
  if (installedManifest.version !== lineagePackage.version) {
    installedFailures.push('installed plugin version does not match the source');
  }
  if (installedFailures.length > 0) throw new Error(installedFailures.join('\n'));

  const result = {
    artifact: requestedOut ? artifact : packed.artifactName,
    checksum: packed.sha256,
    installed_plugin: installed.plugin,
    lineage_version: lineagePackage.version,
    ok: true,
    source_files: packed.files,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`plugin release smoke passed for Lineage ${lineagePackage.version}`);
} catch (error) {
  if (json) console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), ok: false }, null, 2));
  else console.error(`plugin-release: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
