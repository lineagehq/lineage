#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readOption(name, fallback) {
  const prefix = `${name}=`;
  const inline = args.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return fallback;
}

const packageSpec = readOption('--package', '@mean-weasel/lineage@latest');
const project = 'demo-project';
const rootAsset = 'demo-meta-short-form-upload-demo-post-static';
const childAsset = 'demo-linkedin-ledger-catalog-shared';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Unable to allocate a free port'));
      });
    });
  });
}

async function waitForProjects(url) {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json();
        // Keep the release smoke compatible with the currently published package
        // (`project`) and the project-workspace API introduced by this checkout
        // (`id`). The smoke intentionally installs npm latest by default.
        if (Array.isArray(body.projects) && body.projects.some(item => (item.id || item.project) === project)) return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function postJson(url) {
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) throw new Error(`POST ${url} failed with ${response.status}`);
  return response.json();
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => server.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
}

function parseJsonOutput(output, label) {
  const trimmed = output.trim();
  const candidates = [trimmed];
  for (let index = trimmed.lastIndexOf('\n{'); index >= 0; index = trimmed.lastIndexOf('\n{', index - 1)) {
    candidates.push(trimmed.slice(index + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Node may prefix structured CLI output with process warnings.
    }
  }
  throw new Error(`${label} did not return a trailing JSON object`);
}

function runJson(command, commandArgs, options) {
  const output = execFileSync(command, commandArgs, { ...options, encoding: 'utf8' });
  return parseJsonOutput(output, commandArgs.join(' '));
}

function runExpectFailure(command, commandArgs, options) {
  try {
    execFileSync(command, commandArgs, { ...options, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    try {
      return parseJsonOutput(stderr, commandArgs.join(' '));
    } catch {
      throw new Error(`Expected JSON failure from ${commandArgs.join(' ')}, got: ${stderr.trim() || error.message}`);
    }
  }
  throw new Error(`Expected ${commandArgs.join(' ')} to fail`);
}

function assertNoToken(value, token, label) {
  const serialized = JSON.stringify(value);
  if (serialized.includes(token)) throw new Error(`${label} exposed the raw claim token`);
  if (serialized.includes('token_hash')) throw new Error(`${label} exposed token_hash`);
}

const tmpProject = mkdtempSync(join(tmpdir(), 'lineage-release-claim-smoke-'));

try {
  const channelCli = join(root, 'src', 'cli', 'lineage-channel.ts');
  const runtimeRoot = join(tmpProject, 'runtimes');
  const shimDir = join(tmpProject, 'bin');
  mkdirSync(shimDir, { recursive: true });
  const install = runJson(process.execPath, ['--import', 'tsx', channelCli,
    'install', 'stable', '--package', packageSpec,
    '--root', runtimeRoot, '--shim-dir', shimDir, '--json',
  ], { cwd: root });
  if (
    install.package_source !== 'registry'
    || install.package_spec !== packageSpec
    || typeof install.package_integrity !== 'string'
    || !install.package_integrity.startsWith('sha512-')
  ) {
    throw new Error('Release claim smoke did not install the exact registry package with an integrity receipt');
  }
  const bin = install.shim;
  const code = runJson(bin, ['runtime', 'doctor', '--json'], { cwd: tmpProject });
  if (
    !code.verified
    || code.channel !== 'stable'
    || code.origin !== 'package'
    || code.package_version !== install.package_version
    || realpathSync(code.root) !== realpathSync(install.package_root)
  ) {
    throw new Error('Release claim smoke did not resolve a verified stable package receipt');
  }
  const port = await freePort();
  const dbPath = join(tmpProject, 'claim-smoke.sqlite');
  const manifestPath = join(tmpProject, 'profile.json');
  const assetRoot = join(tmpProject, 'assets');
  mkdirSync(assetRoot, { recursive: true });
  writeFileSync(dbPath, '');
  writeFileSync(manifestPath, `${JSON.stringify({
    asset_root: assetRoot,
    database_path: dbPath,
    environment: 'production',
    expected_runtime: {
      channel: 'stable',
      code_fingerprint: code.fingerprint,
      code_origin: 'package',
    },
    profile_id: 'release-claim-smoke',
    schema_version: 'lineage.profile.v1',
    service_origin: `http://127.0.0.1:${port}`,
  }, null, 2)}\n`, { mode: 0o600 });
  runJson(bin, ['profile', 'bind', '--profile', manifestPath, '--confirm-write', '--json'], { cwd: tmpProject });
  const profileDoctor = runJson(bin, ['profile', 'doctor', '--profile', manifestPath, '--json'], { cwd: tmpProject });
  if (!profileDoctor.ok) throw new Error('Release claim smoke profile did not pass doctor after binding');
  let stdout = '';
  let stderr = '';
  const server = spawn(bin, ['start', '--profile', manifestPath, '--json'], {
    cwd: tmpProject,
    env: { ...process.env, LINEAGE_HOME: join(tmpProject, 'lineage-home') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', chunk => { stdout += chunk.toString(); });
  server.stderr?.on('data', chunk => { stderr += chunk.toString(); });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForProjects(`${baseUrl}/api/projects`);
    await postJson(`${baseUrl}/api/index/local?project=${project}`);

    const target = `${project}:lineage-workspace:${rootAsset}`;
    const created = runJson(bin, [
      'agent', 'claim',
      '--project', project,
      '--scope', 'lineage_workspace',
      '--target', target,
      '--target-title', 'Release claim smoke lineage',
      '--agent-name', 'Release claim smoke',
      '--ttl', '20m',
      '--profile', manifestPath,
      '--json',
    ], { cwd: tmpProject });
    const claimId = created.claim?.id;
    const claimSecret = created.claim_token;
    if (!claimId || !claimSecret) throw new Error('Claim creation did not return an id and creation-only token');

    const denied = runExpectFailure(bin, [
      'link-child',
      '--project', project,
      '--root', rootAsset,
      '--child', childAsset,
      '--summary', 'Claim smoke',
      '--confirm-write',
      '--profile', manifestPath,
      '--json',
    ], { cwd: tmpProject });
    if (denied.error !== 'claim_required') throw new Error(`Expected claim_required denial, got ${denied.error || '(missing)'}`);

    const linked = runJson(bin, [
      'link-child',
      '--project', project,
      '--root', rootAsset,
      '--child', childAsset,
      '--summary', 'Claim smoke',
      '--claim-token', claimSecret,
      '--confirm-write',
      '--profile', manifestPath,
      '--json',
    ], { cwd: tmpProject });
    if (linked.edge?.parent_asset_id !== rootAsset || linked.edge?.child_asset_id !== childAsset || linked.dryRun) {
      throw new Error('Claimed link-child did not write the expected edge');
    }

    const heartbeat = runJson(bin, ['agent', 'heartbeat', '--claim-token', claimSecret, '--profile', manifestPath, '--json'], { cwd: tmpProject });
    if (heartbeat.claim?.id !== claimId || heartbeat.claim?.status !== 'active') throw new Error('Heartbeat did not keep the claim active');

    const status = runJson(bin, ['agent', 'status', '--project', project, '--profile', manifestPath, '--json'], { cwd: tmpProject });
    const inspected = runJson(bin, ['agent', 'inspect', '--claim', claimId, '--project', project, '--profile', manifestPath, '--json'], { cwd: tmpProject });
    assertNoToken(status, claimSecret, 'agent status');
    assertNoToken(inspected, claimSecret, 'agent inspect');
    if (!inspected.events?.some(event => event.event_type === 'write_allowed')) throw new Error('Claim inspect did not include write_allowed history');

    const released = runJson(bin, ['agent', 'release', '--claim-token', claimSecret, '--profile', manifestPath, '--json'], { cwd: tmpProject });
    if (released.claim?.status !== 'released') throw new Error('Release did not close the claim');

    const afterRelease = runExpectFailure(bin, [
      'link-child',
      '--project', project,
      '--root', rootAsset,
      '--child', childAsset,
      '--summary', 'Claim smoke',
      '--claim-token', claimSecret,
      '--confirm-write',
      '--profile', manifestPath,
      '--json',
    ], { cwd: tmpProject });
    if (afterRelease.error !== 'claim_not_active') throw new Error(`Expected claim_not_active after release, got ${afterRelease.error || '(missing)'}`);
  } catch (error) {
    console.error(`lineage start stdout:\n${stdout.trim() || '(empty)'}`);
    console.error(`lineage start stderr:\n${stderr.trim() || '(empty)'}`);
    throw error;
  } finally {
    await stopServer(server);
  }

  console.log(`release claim smoke passed for ${packageSpec}`);
} finally {
  rmSync(tmpProject, { force: true, recursive: true });
}
