#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

function readOption(name, fallback) {
  const prefix = `${name}=`;
  const inline = args.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return fallback;
}

function run(command, commandArgs, options = {}) {
  execFileSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });
}

function capture(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function maybeCapture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function releaseNotes(changelog, version) {
  const match = changelog.match(new RegExp(`(^|\\n)## ${version.replaceAll('.', '\\.')}\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match?.[2]?.trim();
}

const repo = readOption('--repo', process.env.GITHUB_REPOSITORY || 'lineagehq/lineage');
const channel = readOption('--channel', 'latest');
if (channel !== 'latest' && channel !== 'next') throw new Error(`Unsupported release channel: ${channel}`);
const target = readOption('--target', process.env.GITHUB_SHA || 'HEAD');
const packageInfo = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
const notes = releaseNotes(changelog, packageInfo.version);
const tag = `v${packageInfo.version}`;
const title = `Lineage ${tag}`;
const targetCommit = capture('git', ['rev-parse', '--verify', `${target}^{commit}`]);
const tempDir = mkdtempSync(join(tmpdir(), 'lineage-release-'));
process.once('exit', () => rmSync(tempDir, { force: true, recursive: true }));
const pluginOut = join(tempDir, 'lineage-plugin');
const pluginBuild = JSON.parse(capture(process.execPath, ['scripts/plugin-release.mjs', '--out-dir', pluginOut, '--json']));
const pluginArtifact = pluginBuild.artifact;
const pluginChecksum = `${pluginArtifact}.sha256`;

if (!notes) {
  console.error(`CHANGELOG.md is missing release notes for ${packageInfo.version}`);
  process.exit(1);
}

if (!dryRun && process.env.LINEAGE_RELEASE_TAG !== tag) {
  console.error(`Refusing GitHub release mutation outside the tag-triggered Release workflow: LINEAGE_RELEASE_TAG must be ${tag}`);
  process.exit(1);
}

const remoteTag = maybeCapture('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`]);
const localTag = maybeCapture('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
const release = maybeCapture('gh', ['release', 'view', tag, '--repo', repo, '--json', 'tagName']);

if (dryRun) {
  console.log(`Dry-run would sync GitHub release ${tag} for ${repo}`);
  console.log(`Target commit: ${targetCommit}`);
  console.log(`Remote tag: ${remoteTag.ok ? 'present' : 'missing'}`);
  console.log(`Local tag: ${localTag.ok ? localTag.stdout : 'missing'}`);
  console.log(`GitHub release: ${release.ok ? 'present' : 'missing'}`);
  console.log(`Plugin artifact: ${pluginArtifact}`);
  console.log(`Plugin checksum: ${pluginChecksum}`);
  console.log('Release notes:');
  console.log(notes);
  rmSync(tempDir, { force: true, recursive: true });
  process.exit(0);
}

if (remoteTag.ok) {
  run('git', ['fetch', '--tags', 'origin']);
  const fetchedTagCommit = capture('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  if (fetchedTagCommit !== targetCommit) {
    console.error(`Refusing to sync ${tag}: existing tag points to ${fetchedTagCommit}, expected ${targetCommit}`);
    process.exit(1);
  }
} else if (localTag.ok) {
  if (localTag.stdout !== targetCommit) {
    console.error(`Refusing to push ${tag}: local tag points to ${localTag.stdout}, expected ${targetCommit}`);
    process.exit(1);
  }
  run('git', ['push', 'origin', tag]);
} else {
  run('git', ['tag', '-a', tag, targetCommit, '-m', title]);
  run('git', ['push', 'origin', tag]);
}

const notesFile = join(tempDir, `${tag}.md`);
writeFileSync(notesFile, `${notes}\n`);

if (release.ok) {
  const releaseMode = channel === 'latest' ? ['--latest', '--prerelease=false'] : ['--prerelease'];
  run('gh', ['release', 'edit', tag, '--repo', repo, '--title', title, '--notes-file', notesFile, ...releaseMode]);
  console.log(`Updated GitHub release ${tag}`);
} else {
  const releaseMode = channel === 'latest' ? ['--latest'] : ['--prerelease'];
  run('gh', ['release', 'create', tag, '--repo', repo, '--title', title, '--notes-file', notesFile, ...releaseMode]);
  console.log(`Created GitHub release ${tag}`);
}

run('gh', ['release', 'upload', tag, pluginArtifact, pluginChecksum, '--repo', repo, '--clobber']);
const assets = JSON.parse(capture('gh', ['release', 'view', tag, '--repo', repo, '--json', 'assets'])).assets || [];
for (const required of [pluginArtifact.split('/').at(-1), pluginChecksum.split('/').at(-1)]) {
  if (!assets.some(asset => asset.name === required)) throw new Error(`GitHub release ${tag} is missing plugin asset ${required}`);
}
console.log(`Attached and verified ${pluginArtifact.split('/').at(-1)} and checksum`);
rmSync(tempDir, { force: true, recursive: true });
