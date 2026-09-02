#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'lineage-e2e-profile-'));
const profileRoot = join(temporary, 'e2e-development');
const manifestPath = join(profileRoot, 'profile.json');
const databasePath = join(profileRoot, 'lineage.sqlite');
const assetRoot = root;
const temporaryAssetRoot = join(temporary, 'assets');
const port = Number(process.env.LINEAGE_E2E_PORT || 5197);
const cli = [process.execPath, '--import', 'tsx', join(root, 'src', 'cli', 'lineage-dev.ts')];
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const shell = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const runId = createHash('sha256').update(temporary).digest('hex').slice(0, 12);

function run(args, options = {}) {
  return spawnSync(cli[0], [...cli.slice(1), ...args], {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
}

try {
  const runtimeResult = run(['runtime', 'doctor', '--json']);
  if (runtimeResult.status !== 0) throw new Error(`Dev runtime doctor failed: ${runtimeResult.stderr.trim()}`);
  const runtime = JSON.parse(runtimeResult.stdout);
  mkdirSync(temporaryAssetRoot, { recursive: true });
  mkdirSync(profileRoot, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify({
    asset_root: assetRoot,
    database_path: databasePath,
    environment: 'development',
    expected_runtime: {
      channel: 'dev',
      code_fingerprint: runtime.fingerprint,
      code_origin: runtime.origin,
    },
    profile_id: 'node-editor-app-phase3',
    schema_version: 'lineage.profile.v1',
    service_origin: `http://127.0.0.1:${port}`,
  }, null, 2)}\n`);
  new DatabaseSync(databasePath).close();
  const bindResult = run(['profile', 'bind', '--profile', manifestPath, '--confirm-write', '--json']);
  if (bindResult.status !== 0) throw new Error(`E2E profile bind failed: ${bindResult.stderr.trim()}`);
  const binding = JSON.parse(bindResult.stdout);
  const pack = spawnSync('npm', ['pack', '--json', '--pack-destination', temporary], { cwd: join(root, 'packages', 'node-editor-reference-plugin'), encoding: 'utf8' });
  if (pack.status !== 0) throw new Error(`Reference plugin pack failed: ${pack.stderr.trim()}`);
  const archivePath = join(temporary, JSON.parse(pack.stdout)[0].filename);
  const extractedRoot = join(temporary, 'reference-plugin');
  mkdirSync(extractedRoot, { recursive: true });
  const unpack = spawnSync('tar', ['-xzf', archivePath, '--strip-components=1', '-C', extractedRoot], { encoding: 'utf8' });
  if (unpack.status !== 0) throw new Error(`Reference plugin extraction failed: ${unpack.stderr.trim()}`);
  const pluginConfigPath = join(profileRoot, 'node-editor-plugins.json');
  writeFileSync(pluginConfigPath, `${JSON.stringify({ schemaVersion: 1, experimentalEnabled: true, installations: [{
    schemaVersion: 1, pluginId: 'reference.editor', contributionId: 'reference.editor', packageArchivePath: archivePath,
    packageArchiveSha256: sha256(archivePath), manifestSha256: sha256(join(extractedRoot, 'manifest.json')),
    extractedRoot, hostSha256: sha256(join(extractedRoot, 'src', 'host.js')), editorSha256: sha256(join(extractedRoot, 'editor', 'index.html')),
  }] }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(pluginConfigPath, 0o600);
  function auxiliaryProfile(name, auxiliaryPort, experimentalEnabled, ttl = {}, auxiliaryAssetRoot = assetRoot) {
    const auxiliaryRoot = join(temporary, name);
    const auxiliaryManifest = join(auxiliaryRoot, 'profile.json');
    const auxiliaryDatabase = join(auxiliaryRoot, 'lineage.sqlite');
    mkdirSync(auxiliaryRoot, { recursive: true });
    writeFileSync(auxiliaryManifest, `${JSON.stringify({
      asset_root: auxiliaryAssetRoot, database_path: auxiliaryDatabase, environment: 'development',
      expected_runtime: { channel: 'dev', code_fingerprint: runtime.fingerprint, code_origin: runtime.origin },
      profile_id: name, schema_version: 'lineage.profile.v1', service_origin: `http://127.0.0.1:${auxiliaryPort}`,
    }, null, 2)}\n`);
    new DatabaseSync(auxiliaryDatabase).close();
    const bound = run(['profile', 'bind', '--profile', auxiliaryManifest, '--confirm-write', '--json']);
    if (bound.status !== 0) throw new Error(`${name} profile bind failed: ${bound.stderr.trim()}`);
    const identity = JSON.parse(bound.stdout).identity;
    writeFileSync(join(auxiliaryRoot, 'node-editor-plugins.json'), `${JSON.stringify({ schemaVersion: 1, experimentalEnabled, installations: [{
      schemaVersion: 1, pluginId: 'reference.editor', contributionId: 'reference.editor', packageArchivePath: archivePath,
      packageArchiveSha256: sha256(archivePath), manifestSha256: sha256(join(extractedRoot, 'manifest.json')),
      extractedRoot, hostSha256: sha256(join(extractedRoot, 'src', 'host.js')), editorSha256: sha256(join(extractedRoot, 'editor', 'index.html')),
    }] }, null, 2)}\n`, { mode: 0o600 });
    const env = {
      PORT: auxiliaryPort, HOST: '127.0.0.1', LINEAGE_ASSET_ROOT: auxiliaryAssetRoot, LINEAGE_DB: auxiliaryDatabase, LINEAGE_PROFILE: auxiliaryManifest,
      LINEAGE_PROFILE_ENVIRONMENT: 'development', LINEAGE_PROFILE_FINGERPRINT: identity.profile_fingerprint,
      LINEAGE_PROFILE_ID: name, LINEAGE_PROFILE_MANIFEST: auxiliaryManifest, LINEAGE_PROFILE_ROOT: temporary,
      LINEAGE_PROFILE_SERVICE_ORIGIN: `http://127.0.0.1:${auxiliaryPort}`, ...ttl,
    };
    return { origin: `http://127.0.0.1:${auxiliaryPort}`, command: `${Object.entries(env).map(([key, value]) => `${key}=${shell(value)}`).join(' ')} npm run dev` };
  }
  const featureOff = auxiliaryProfile('node-editor-app-phase3-off', port + 1, false);
  const expiry = auxiliaryProfile('node-editor-app-phase3-expiry', port + 2, true, {
    LINEAGE_NODE_EDITOR_LAUNCH_TTL_MS: 250,
    LINEAGE_NODE_EDITOR_COOKIE_TTL_MS: 250,
  }, temporaryAssetRoot);
  const playwright = join(root, 'node_modules', '.bin', 'playwright');
  const result = spawnSync(playwright, ['test', '--config', 'playwright.config.ts', ...process.argv.slice(2)], {
    cwd: root,
    env: {
      ...process.env,
      LINEAGE_ASSET_ROOT: assetRoot,
      LINEAGE_DB: databasePath,
      LINEAGE_E2E_DB: databasePath,
      LINEAGE_PROFILE: manifestPath,
      LINEAGE_PROFILE_ENVIRONMENT: 'development',
      LINEAGE_PROFILE_FINGERPRINT: binding.identity.profile_fingerprint,
      LINEAGE_PROFILE_ID: 'node-editor-app-phase3',
      LINEAGE_PROFILE_MANIFEST: manifestPath,
      LINEAGE_PROFILE_ROOT: temporary,
      LINEAGE_PROFILE_SERVICE_ORIGIN: `http://127.0.0.1:${port}`,
      LINEAGE_E2E_FEATURE_OFF_ORIGIN: featureOff.origin,
      LINEAGE_E2E_FEATURE_OFF_COMMAND: featureOff.command,
      LINEAGE_E2E_EXPIRY_ORIGIN: expiry.origin,
      LINEAGE_E2E_EXPIRY_COMMAND: expiry.command,
      LINEAGE_E2E_RUN_ID: runId,
    },
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`e2e-profile-runner: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
