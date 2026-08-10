#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageInfo = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const pluginManifest = JSON.parse(readFileSync(join(root, 'plugins', 'lineage-codex-plugin', '.codex-plugin', 'plugin.json'), 'utf8'));

function run(command, args, options = {}) {
  try {
    return {
      ok: true,
      value: execFileSync(command, args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options,
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      value: error.stderr?.toString().trim() || error.message,
    };
  }
}

function printResult(label, result) {
  if (result.ok) {
    console.log(`${label}: ${result.value || '(empty)'}`);
  } else {
    console.log(`${label}: unavailable (${result.value})`);
  }
}

const distTags = run('npm', ['view', packageInfo.name, 'dist-tags', '--json']);
let latest = '(missing)';
let next = '(missing)';
if (distTags.ok) {
  try {
    const parsed = JSON.parse(distTags.value);
    latest = parsed.latest || latest;
    next = parsed.next || next;
  } catch {
    distTags.ok = false;
    distTags.value = 'npm returned non-JSON dist-tags';
  }
}

console.log('Lineage release status');
console.log(`package: ${packageInfo.name}@${packageInfo.version}`);
console.log(`Codex plugin: ${pluginManifest.name}@${pluginManifest.version} for ${pluginManifest.lineage?.package}@${pluginManifest.lineage?.version}`);
if (distTags.ok) {
  console.log(`npm tags: latest=${latest} next=${next}`);
} else {
  printResult('npm tags', distTags);
}

printResult('global bootstrap lineage', run('lineage', ['--version']));
printResult('isolated runtimes', run(process.execPath, ['dist/cli/lineage-channel.js', 'status', '--json']));
printResult('checkout dev', run('npm', ['run', '--silent', 'lineage:dev', '--', '--version']));
printResult('GitHub plugin assets', run('gh', [
  'release', 'view', `v${packageInfo.version}`,
  '--repo', 'lineagehq/lineage',
  '--json', 'assets',
]));

const runs = run('gh', [
  'run',
  'list',
  '--repo',
  'lineagehq/lineage',
  '--workflow',
  'Release',
  '--limit',
  '3',
]);
printResult('recent Release workflow runs', runs);
