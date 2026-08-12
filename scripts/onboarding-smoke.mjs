#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'lineage-onboarding-smoke-'));
const runtimeRoot = join(temporary, 'runtimes');
const shimRoot = join(temporary, 'bin');
const profileRoot = join(temporary, 'profiles');
const serviceRoot = join(temporary, 'services');
const codexHome = join(temporary, 'codex-home');
const isolatedHome = join(temporary, 'home');
const pluginDist = join(temporary, 'plugin-dist');
const channelCli = join(root, 'dist', 'cli', 'lineage-channel.js');
const packageInfo = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('LINEAGE_') && !['CODEX_HOME', 'HOST', 'PORT'].includes(key)),
);
const environment = {
  ...cleanEnvironment,
  CODEX_HOME: codexHome,
  HOME: isolatedHome,
  LINEAGE_PROFILE_ROOT: profileRoot,
  LINEAGE_RUNTIME_ROOT: runtimeRoot,
  LINEAGE_SERVICE_ROOT: serviceRoot,
  npm_config_cache: join(temporary, 'npm-cache'),
};
let installed;
let profileInitialized = false;
let managedReceipt;
let legacyManagerEnvironment;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function runJson(command, args, options = {}) {
  const result = run(command, args, options);
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} returned non-JSON output: ${result.stdout}`, { cause: error });
  }
}

function parsePack(output) {
  const parsed = JSON.parse(output);
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  assert.ok(item?.filename, 'npm pack did not return a filename');
  return item.filename;
}

function prepareCodexDriver() {
  const detected = run('codex', ['--version']);
  if (detected.status === 0) return 'real';

  const driverRoot = join(temporary, 'codex-protocol-driver');
  const driver = join(driverRoot, 'codex');
  const state = join(driverRoot, 'state.json');
  mkdirSync(driverRoot, { recursive: true });
  writeFileSync(driver, `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const statePath = process.env.LINEAGE_CODEX_PROTOCOL_STATE;
const expectedVersion = process.env.LINEAGE_CODEX_PROTOCOL_VERSION;
const args = process.argv.slice(2);
const current = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, 'utf8'))
  : { enabled: false, installed: false, marketplaceRoot: null };
const key = args.slice(0, 3).join(' ');

function finish(value, changed = false) {
  if (changed) writeFileSync(statePath, JSON.stringify(current));
  process.stdout.write(JSON.stringify(value) + '\\n');
  process.exit(0);
}

if (key === 'plugin marketplace list') {
  finish({ marketplaces: current.marketplaceRoot ? [{ name: 'lineage', root: current.marketplaceRoot }] : [] });
}
if (key === 'plugin list --available') {
  const plugin = { pluginId: 'lineage-codex-plugin@lineage', version: expectedVersion, installed: current.installed, enabled: current.enabled };
  finish({ installed: current.installed ? [plugin] : [], available: current.marketplaceRoot && !current.installed ? [plugin] : [] });
}
if (key === 'plugin marketplace add') {
  current.marketplaceRoot = resolve(args[3]);
  finish({ marketplaceName: 'lineage', installedRoot: current.marketplaceRoot }, true);
}
if (args[0] === 'plugin' && args[1] === 'add') {
  current.installed = true;
  current.enabled = true;
  finish({ pluginId: 'lineage-codex-plugin@lineage', version: expectedVersion }, true);
}
if (args[0] === 'plugin' && args[1] === 'remove') {
  current.installed = false;
  current.enabled = false;
  finish({ pluginId: 'lineage-codex-plugin@lineage' }, true);
}
if (key === 'plugin marketplace remove') {
  current.marketplaceRoot = null;
  finish({ marketplaceName: 'lineage' }, true);
}
process.stderr.write('Unexpected Codex protocol command: ' + args.join(' ') + '\\n');
process.exit(64);
`);
  chmodSync(driver, 0o755);
  environment.LINEAGE_CODEX_PROTOCOL_STATE = state;
  environment.LINEAGE_CODEX_PROTOCOL_VERSION = packageInfo.version;
  environment.PATH = `${driverRoot}${delimiter}${environment.PATH || ''}`;
  return 'protocol-harness';
}

function createCleanPackageFixture() {
  const fixture = join(temporary, 'package-fixture');
  const packed = join(temporary, 'packed');
  mkdirSync(fixture, { recursive: true });
  mkdirSync(packed, { recursive: true });
  cpSync(join(root, 'dist'), join(fixture, 'dist'), { recursive: true });
  cpSync(join(root, 'fixtures'), join(fixture, 'fixtures'), { recursive: true });
  for (const file of ['README.md', 'CHANGELOG.md', 'LICENSE', 'package.json']) cpSync(join(root, file), join(fixture, file));
  const build = {
    package_name: packageInfo.name,
    package_version: packageInfo.version,
    schema_version: 'lineage.runtime_build.v1',
    source_dirty: false,
    source_fingerprint: sha256('clean synthetic first-user onboarding package'),
    source_git_sha: run('git', ['rev-parse', 'HEAD']).stdout.trim(),
  };
  writeFileSync(join(fixture, 'dist', 'runtime-build.json'), `${JSON.stringify({
    build_fingerprint: sha256(JSON.stringify(build)),
    ...build,
  }, null, 2)}\n`);
  const pack = run('npm', ['pack', '--json', '--pack-destination', packed], { cwd: fixture });
  assert.equal(pack.status, 0, pack.stderr);
  return join(packed, parsePack(pack.stdout));
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  await new Promise(resolveClose => server.close(resolveClose));
  assert.ok(port, 'Could not reserve an onboarding port');
  return port;
}

async function requestJson(origin, path, options = {}) {
  const response = await fetch(new URL(path, `${origin}/`), {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
  });
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed with HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

try {
  for (const required of [channelCli, join(root, 'dist', 'server.js'), join(root, 'dist', 'runtime-build.json')]) {
    assert.equal(existsSync(required), true, `Missing ${required}; run npm run build first`);
  }
  mkdirSync(isolatedHome, { recursive: true });
  const tarball = createCleanPackageFixture();
  installed = runJson(process.execPath, [
    channelCli,
    'install', 'stable',
    '--root', runtimeRoot,
    '--shim-dir', shimRoot,
    '--package', tarball,
    '--allow-local-package',
    '--json',
  ]);
  const launcher = installed.shim;
  const manager = installed.service_shim;
  const legacyManager = join(installed.package_root, 'dist', 'cli', 'managed-service.js');
  legacyManagerEnvironment = {
    ...environment,
    LINEAGE_RELEASE_CHANNEL: 'stable',
    LINEAGE_RUNTIME_RECEIPT: installed.receipt_path,
  };
  delete legacyManagerEnvironment.LINEAGE_CHANNEL_LAUNCHER;
  delete legacyManagerEnvironment.LINEAGE_RUNTIME_ROOT;
  const runtime = runJson(launcher, ['runtime', 'doctor', '--json']);
  assert.equal(runtime.verified, true);
  assert.equal(runtime.channel, 'stable');
  assert.equal(runtime.origin, 'package');

  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const profileId = 'first-user-stable';
  const initialized = runJson(launcher, [
    'profile', 'init',
    '--profile', profileId,
    '--service-origin', origin,
    '--confirm-write',
    '--json',
  ]);
  profileInitialized = true;
  assert.equal(initialized.schema_version, 'lineage.profile_init.v1');
  const doctor = runJson(launcher, ['profile', 'doctor', '--profile', profileId, '--json']);
  assert.equal(doctor.ok, true);
  const database = runJson(launcher, ['db', 'info', '--profile', profileId, '--json']);
  assert.equal(database.profile.id, profileId);
  assert.equal(database.schema.profile_fingerprint, initialized.profile_fingerprint);

  const missingLauncher = run(process.execPath, [legacyManager, 'status', '--channel', 'stable', '--profile', profileId, '--launcher', join(temporary, 'missing-launcher'), '--json'], {
    env: legacyManagerEnvironment,
  });
  assert.notEqual(missingLauncher.status, 0);
  assert.match(missingLauncher.stderr, /spawnSync .* ENOENT/);
  assert.doesNotMatch(missingLauncher.stderr, /Cannot read properties of undefined/);

  const started = runJson(process.execPath, [legacyManager, 'start', '--channel', 'stable', '--profile', profileId, '--json'], {
    env: legacyManagerEnvironment,
  });
  managedReceipt = started.receipt;
  assert.equal(started.healthy, true);
  assert.equal(started.runtime.code.fingerprint, runtime.fingerprint);
  assert.equal(started.runtime.profile.id, profileId);
  const status = runJson(manager, ['status', '--channel', 'stable', '--profile', profileId, '--json']);
  assert.equal(status.healthy, true);
  assert.equal(status.runtime.service.instance_id, started.receipt.instance_id);

  const basicSeed = await requestJson(origin, '/api/lineage-workspaces/demo/seed', {
    method: 'POST',
    body: JSON.stringify({ project: 'demo-project', confirmWrite: true, activate: true }),
  });
  const basicRoot = basicSeed.workspace?.root_asset_id || basicSeed.root_asset_id;
  assert.ok(basicRoot, 'Basic seed did not return a root asset');
  const basicSnapshot = await requestJson(origin, `/api/lineage/${encodeURIComponent(basicRoot)}?project=demo-project`);
  assert.equal(basicSnapshot.nodes.length, 10);
  assert.equal(basicSnapshot.edges.length, 9);

  const rich = runJson(process.execPath, [
    join(root, 'scripts', 'qa-seed-verify.mjs'),
    '--prepare',
    '--base-url', origin,
    '--project', 'swissifier-demo',
    '--json',
  ]);
  assert.equal(rich.ok, true);
  assert.equal(rich.swissifier_media.present, 14);
  assert.equal(rich.snapshot.png_preview_urls, 14);

  const next = runJson(launcher, ['next', '--profile', profileId, '--project', 'swissifier-demo', '--root', rich.root_asset_id, '--json']);
  assert.equal(next.root_asset_id, rich.root_asset_id);
  assert.ok(next.next_asset, 'CLI next did not return an asset for the rich seed');
  const brief = runJson(launcher, ['brief', '--profile', profileId, '--project', 'swissifier-demo', '--root', rich.root_asset_id, '--json']);
  assert.equal(brief.root_asset_id, rich.root_asset_id);
  assert.ok(brief.brief?.title, 'CLI brief did not return a title');

  const packedPlugin = runJson(process.execPath, [
    join(root, 'scripts', 'plugin-release.mjs'),
    '--out-dir', pluginDist,
    '--json',
  ]);
  assert.equal(packedPlugin.ok, true);
  const artifact = packedPlugin.artifact;
  const pluginInstaller = join(root, 'packages', 'lineage-plugin-installer', 'bin', 'lineage-plugin-installer.mjs');
  const codexDriver = prepareCodexDriver();
  const plugin = runJson(process.execPath, [
    pluginInstaller,
    'install',
    '--version', packageInfo.version,
    '--artifact-file', artifact,
    '--checksum-file', `${artifact}.sha256`,
    '--codex-home', codexHome,
    '--json',
  ]);
  assert.equal(plugin.activated, true);
  assert.equal(plugin.codexHome, codexHome);
  const pluginDoctor = runJson(process.execPath, [
    pluginInstaller,
    'doctor',
    '--version', packageInfo.version,
    '--codex-home', codexHome,
    '--json',
  ]);
  assert.equal(pluginDoctor.ok, true);

  const stopped = runJson(process.execPath, [legacyManager, 'stop', '--channel', 'stable', '--profile', profileId, '--json'], {
    env: legacyManagerEnvironment,
  });
  profileInitialized = false;
  assert.equal(stopped.stopped, true);
  console.log(JSON.stringify({
    basic_seed: { edges: basicSnapshot.edges.length, nodes: basicSnapshot.nodes.length },
    cli: { brief: true, next: true },
    isolated_roots: { codex: codexHome, profile: profileRoot, runtime: runtimeRoot, service: serviceRoot },
    ok: true,
    plugin: { activated: plugin.activated, doctor: pluginDoctor.ok, driver: codexDriver, version: plugin.pluginVersion },
    rich_seed: { png: rich.snapshot.png_preview_urls, total: rich.swissifier_media.total },
    runtime: { channel: runtime.channel, fingerprint: runtime.fingerprint, origin: runtime.origin },
    service: { legacy_bootstrap_launcher_discovery: true, spawn_error_unmasked: true },
  }, null, 2));
} finally {
  if (profileInitialized && installed?.service_shim) {
    const stopped = run(installed.service_shim, ['stop', '--channel', 'stable', '--profile', 'first-user-stable', '--force', '--json']);
    if (stopped.status !== 0) {
      try {
        if (managedReceipt?.pid) process.kill(-managedReceipt.pid, 'SIGKILL');
      } catch {
        // The temporary tree is removed below; managed stop is the primary cleanup path.
      }
    }
  }
  rmSync(temporary, { force: true, recursive: true });
}
