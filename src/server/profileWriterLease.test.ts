import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LineageProfileManifest, ResolvedLineageProfile } from '../shared/lineageProfileTypes';
import { lineageDb } from './assetLineageDb';
import { repoRoot } from './assetCore';
import { lineageProfileFingerprint } from './lineageProfiles';
import { acquireProfileWriterLease, getProfileWriterDelegation, inspectProfileWriterLease, profileWriterLockPath } from './profileWriterLease';
import { getLineageCodeIdentity } from './runtimeInfo';
import { lineageCliCanDelegateMutation, lineageCliRequiresWriterLease } from '../cli/lineageCli';
import { managedWriterRequestSchemaVersion, managedWriterRoute, managedWriterTimeoutMs } from './managedWriterRouting';

const scratchRoot = join(repoRoot, '.asset-scratch', 'vitest-profile-writer-lease');
const originalEnv = { ...process.env };
const childProcessStartupTimeoutMs = 30_000;
const childProcessTestTimeoutMs = 60_000;
const childSource = `
  const { acquireProfileWriterLease } = await import('./src/server/profileWriterLease.ts');
  const profile = JSON.parse(Buffer.from(process.env.TEST_PROFILE_B64, 'base64').toString('utf8'));
  try {
    const lease = acquireProfileWriterLease(profile, process.env.TEST_CHANNEL, 'service');
    process.stdout.write('ACQUIRED\\n');
    if (process.env.TEST_HOLD === '1') setInterval(() => {}, 1000);
    else { lease.release(); process.exit(0); }
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\\n');
    process.exit(23);
  }
`;

beforeEach(() => {
  process.env = { ...originalEnv };
  clearProfileEnvironment();
  rmSync(scratchRoot, { force: true, recursive: true });
  mkdirSync(scratchRoot, { recursive: true });
});

afterEach(() => {
  process.env = { ...originalEnv };
  rmSync(scratchRoot, { force: true, recursive: true });
});

describe('profile writer lease', () => {
  it('lets one managed service own the profile, refuses a second, and cleans up on SIGTERM', async () => {
    const port = await availablePort();
    const profile = testProfile('development-main', 'development', `http://127.0.0.1:${port}`);
    bindProfileDatabase(profile);
    const owner = spawnService(profile, 'dev');
    await waitForLine(owner, `Lineage listening on http://127.0.0.1:${port}`);

    const reader = await collectExit(spawnCli(profile, ['agent', 'status', '--json']));
    expect(reader, reader.stderr).toMatchObject({ code: 0 });
    expect(reader.stdout).toContain('"claims": []');
    expect(inspectProfileWriterLease(profile)?.pid).toBe(owner.pid);

    const routedWriter = await collectExit(spawnCli(profile, [
      'agent', 'claim', '--scope', 'lineage_workspace', '--target', 'demo-project:lineage-workspace:root', '--agent-name', 'contender', '--json',
    ]));
    expect(routedWriter, routedWriter.stderr).toMatchObject({ code: 0 });
    expect(routedWriter.stdout).toContain('"agent_name": "contender"');
    const conflict = await collectExit(spawnCli(profile, [
      'agent', 'claim', '--scope', 'lineage_workspace', '--target', 'demo-project:lineage-workspace:root', '--agent-name', 'second', '--json',
    ]));
    expect(conflict.code).toBe(1);
    expect(JSON.parse(conflict.stderr)).toMatchObject({
      error: 'target_already_claimed',
      conflicts: [expect.objectContaining({ agent_name: 'contender' })],
    });

    const contender = spawnService(profile, 'dev');
    const rejected = await collectExit(contender);
    expect(rejected.code).toBe(1);
    expect(rejected.stderr).toContain('already has an active service writer');

    owner.kill('SIGTERM');
    const stopped = await collectExit(owner);
    expect(stopped.code).toBe(143);
    expect(existsSync(profileWriterLockPath(profile))).toBe(false);
  }, childProcessTestTimeoutMs);

  it('rejects unauthenticated, wrong-identity, protected-override, and non-allowlisted delegated requests', async () => {
    const port = await availablePort();
    const profile = testProfile('identity-owner', 'development', `http://127.0.0.1:${port}`);
    bindProfileDatabase(profile);
    const owner = spawnService(profile, 'dev');
    await waitForLine(owner, `Lineage listening on http://127.0.0.1:${port}`);
    const delegation = getProfileWriterDelegation(profile);
    const identity = {
      channel: 'dev',
      environment: profile.environment,
      profile_id: profile.profile_id,
      schema_version: managedWriterRequestSchemaVersion,
      service_origin: profile.service_origin,
    };
    const request = (body: Record<string, unknown>, token?: string) => fetch(new URL(managedWriterRoute, profile.service_origin), {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Lineage-Writer-Delegation': token } : {}),
      },
      method: 'POST',
    });

    const wrongIdentity = await request({ ...identity, args: ['claim'], command: 'agent', profile_id: 'wrong-profile' }, delegation.token);
    expect(wrongIdentity.status).toBe(409);
    const missingAuth = await request({ ...identity, args: ['claim'], command: 'agent' });
    expect(missingAuth.status).toBe(401);
    const unsupported = await request({ ...identity, args: ['status'], command: 'agent' }, delegation.token);
    expect(unsupported.status).toBe(400);
    const override = await request({ ...identity, args: ['claim', '--db', '/tmp/forbidden.sqlite'], command: 'agent' }, delegation.token);
    expect(override.status).toBe(400);

    owner.kill('SIGTERM');
    await collectExit(owner);
  }, childProcessTestTimeoutMs);

  it('fails closed without direct fallback when a live service lease has no listener', async () => {
    const port = await availablePort();
    const profile = testProfile('unavailable-service', 'development', `http://127.0.0.1:${port}`);
    bindProfileDatabase(profile);
    const before = createHash('sha256').update(readFileSync(profile.database_path)).digest('hex');
    const owner = spawnLeaseChild(profile, true, 'dev');
    await waitForLine(owner, 'ACQUIRED');

    const result = await collectExit(spawnCli(profile, [
      'agent', 'claim', '--scope', 'lineage_workspace', '--target', 'never-written', '--agent-name', 'offline', '--json',
    ]));

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('is unavailable');
    expect(result.stderr).toContain('no direct fallback was attempted');
    expect(result.stderr).toContain('outcome is unknown');
    expect(createHash('sha256').update(readFileSync(profile.database_path)).digest('hex')).toBe(before);
    expect(inspectProfileWriterLease(profile)?.pid).toBe(owner.pid);
    owner.kill('SIGKILL');
    await collectExit(owner);
  }, childProcessTestTimeoutMs);

  it('refuses a second writer in another process while the owner is alive', async () => {
    const profile = testProfile('development-main', 'development');
    const owner = spawnLeaseChild(profile, true, 'dev');
    await waitForLine(owner, 'ACQUIRED');

    const contender = spawnLeaseChild(profile, false, 'dev');
    const result = await collectExit(contender);

    expect(result.code).toBe(23);
    expect(result.stderr).toContain('already has an active service writer');
    expect(inspectProfileWriterLease(profile)?.pid).toBe(owner.pid);
    owner.kill('SIGKILL');
    await collectExit(owner);
  }, childProcessTestTimeoutMs);

  it('reclaims a lock after an owner crashes, but not while its PID is live', async () => {
    const profile = testProfile('development-main', 'development');
    const owner = spawnLeaseChild(profile, true, 'dev');
    await waitForLine(owner, 'ACQUIRED');
    expect(() => acquireProfileWriterLease(profile, 'dev')).toThrow('already has an active service writer');

    owner.kill('SIGKILL');
    await collectExit(owner);
    const replacement = acquireProfileWriterLease(profile, 'dev');

    expect(inspectProfileWriterLease(profile)).toMatchObject({ pid: process.pid, profile_id: profile.profile_id });
    replacement.release();
    expect(existsSync(profileWriterLockPath(profile))).toBe(false);
  }, childProcessTestTimeoutMs);

  it('refuses automatic recovery when lock metadata is malformed', () => {
    const profile = testProfile('development-main', 'development');
    const lockPath = profileWriterLockPath(profile);
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, 'owner.json'), '{"pid":"not-a-pid"}\n');

    expect(() => acquireProfileWriterLease(profile, 'dev')).toThrow('refusing automatic recovery');
    expect(readFileSync(join(lockPath, 'owner.json'), 'utf8')).toContain('not-a-pid');
  });

  it('does not let a former owner delete a lock whose token changed', () => {
    const profile = testProfile('development-main', 'development');
    const lease = acquireProfileWriterLease(profile, 'dev');
    const ownerPath = join(lease.lock_path, 'owner.json');
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(ownerPath, `${JSON.stringify({ ...owner, token: 'replacement-token-value' })}\n`);

    lease.release();

    expect(existsSync(lease.lock_path)).toBe(true);
  });

  it('refuses dev and preview acquisition of a production profile before creating a lock', () => {
    const profile = testProfile('production-main', 'production');

    expect(() => acquireProfileWriterLease(profile, 'dev')).toThrow('Refusing to open production profile production-main from dev code');
    expect(() => acquireProfileWriterLease(profile, 'preview')).toThrow('Refusing to open production profile production-main from preview code');
    expect(existsSync(profileWriterLockPath(profile))).toBe(false);
  });
});

describe('profile database writer enforcement', () => {
  it('rejects a named-profile database open without its lease and does not create the database', () => {
    const profile = testProfile('development-main', 'development');
    selectProfile(profile);

    expect(() => lineageDb()).toThrow('holding the profile writer lease');
    expect(existsSync(profile.database_path)).toBe(false);
  });

  it('opens a leased profile database with WAL and a bounded busy timeout', () => {
    const profile = testProfile('development-main', 'development');
    bindProfileDatabase(profile);
    selectProfile(profile);
    const lease = acquireProfileWriterLease(profile, 'dev');
    const database = lineageDb();

    const journal = database.prepare('pragma journal_mode').get() as { journal_mode: string };
    const timeout = database.prepare('pragma busy_timeout').get() as { timeout: number };

    expect(journal.journal_mode).toBe('wal');
    expect(timeout.timeout).toBe(5000);
    database.close();
    lease.release();
  });

  it('rejects legacy-unbound writes without creating a database', () => {
    const databasePath = join(scratchRoot, 'legacy.sqlite');
    process.env.LINEAGE_DB = databasePath;

    expect(() => lineageDb()).toThrow('legacy-unbound access is read-only');
    expect(existsSync(databasePath)).toBe(false);
  });

  it('revalidates identity from the opened SQLite handle before creating schema in a swapped database', () => {
    const profile = testProfile('development-main', 'development');
    selectProfile(profile);
    const swapped = new DatabaseSync(profile.database_path);
    swapped.exec('create table attacker_marker (value text)');
    swapped.close();
    const lease = acquireProfileWriterLease(profile, 'dev', 'cli');

    expect(() => lineageDb()).toThrow('database is not bound to Lineage profile development-main');

    const inspected = new DatabaseSync(profile.database_path, { readOnly: true });
    expect(inspected.prepare("select name from sqlite_master where type = 'table' and name = 'projects'").get()).toBeUndefined();
    expect(inspected.prepare("select name from sqlite_master where type = 'table' and name = 'attacker_marker'").get()).toBeTruthy();
    inspected.close();
    lease.release();
  });

  it('allows a named-profile read-only connection without the writer lease and enforces SQLite read-only mode', () => {
    const profile = testProfile('development-main', 'development');
    bindProfileDatabase(profile);
    selectProfile(profile);
    process.env.LINEAGE_DB_ACCESS = 'read-only';

    const database = lineageDb();

    expect(database.prepare('select profile_id from lineage_profile_identity').get()).toMatchObject({ profile_id: profile.profile_id });
    expect(() => database.exec('create table forbidden_write (id text)')).toThrow(/read-only|readonly/i);
    database.close();
    expect(existsSync(profileWriterLockPath(profile))).toBe(false);
  });

  it('rejects an unprofiled CLI mutation before creating its requested database', async () => {
    const databasePath = join(scratchRoot, 'unprofiled-cli.sqlite');
    const result = await collectExit(spawnCliUnprofiled([
      'agent', 'claim', '--scope', 'project', '--target', 'demo', '--agent-name', 'unprofiled', '--db', databasePath, '--json',
    ]));

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Persistent writes require --profile');
    expect(result.stderr).toContain('profile init --profile <id> --confirm-write');
    expect(existsSync(databasePath)).toBe(false);
  }, childProcessTestTimeoutMs);

  it('keeps an unprofiled service read-only and rejects HTTP mutations before creating a database', async () => {
    const port = await availablePort();
    const databasePath = join(scratchRoot, 'unprofiled-service.sqlite');
    const service = spawnUnprofiledService(databasePath, port);
    await waitForLine(service, `Lineage listening on http://127.0.0.1:${port}`);

    const response = await fetch(`http://127.0.0.1:${port}/api/anything`, { method: 'POST' });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'profile_required',
      message: expect.stringContaining('profile init --profile <id> --confirm-write'),
    });
    expect(existsSync(databasePath)).toBe(false);

    service.kill('SIGTERM');
    expect((await collectExit(service)).code).toBe(143);
  }, childProcessTestTimeoutMs);
});

describe('CLI writer classification', () => {
  it('allows slow imports while bounding ordinary delegated writes', () => {
    expect(managedWriterTimeoutMs('reroll', ['import', '--job-id', 'job'])).toBe(300_000);
    expect(managedWriterTimeoutMs('generate', ['image', 'import', '--job-id', 'job'])).toBe(300_000);
    expect(managedWriterTimeoutMs('agent', ['claim'])).toBe(30_000);
  });

  it('keeps read commands concurrent while requiring leases for mutations', () => {
    expect(lineageCliRequiresWriterLease('db', ['info'])).toBe(false);
    expect(lineageCliRequiresWriterLease('next', ['--root', 'root'])).toBe(false);
    expect(lineageCliRequiresWriterLease('selection', ['packet'])).toBe(false);
    expect(lineageCliRequiresWriterLease('output-targets', ['node', 'get'])).toBe(false);
    expect(lineageCliRequiresWriterLease('generate', ['image', 'inspect'])).toBe(false);
    expect(lineageCliRequiresWriterLease('reroll', ['list'])).toBe(false);
    expect(lineageCliRequiresWriterLease('tasks', ['inspect'])).toBe(false);
    expect(lineageCliRequiresWriterLease('agent', ['status'])).toBe(false);
    expect(lineageCliRequiresWriterLease('link-child', ['--confirm-write'])).toBe(true);
    expect(lineageCliRequiresWriterLease('generate', ['image', 'plan'])).toBe(true);
    expect(lineageCliRequiresWriterLease('generate', ['image', 'import'])).toBe(true);
    expect(lineageCliRequiresWriterLease('generate', ['image', 'cancel'])).toBe(true);
    expect(lineageCliRequiresWriterLease('output-targets', ['node', 'set'])).toBe(true);
    expect(lineageCliRequiresWriterLease('output-targets', ['node', 'replace'])).toBe(true);
    expect(lineageCliRequiresWriterLease('output-targets', ['node', 'clear'])).toBe(true);
    expect(lineageCliRequiresWriterLease('reroll', ['mark'])).toBe(true);
    expect(lineageCliRequiresWriterLease('tasks', ['claim'])).toBe(true);
    expect(lineageCliRequiresWriterLease('agent', ['claim'])).toBe(true);
  });

  it('allowlists every current delegated mutator and rejects reads or unknown writes', () => {
    for (const [command, args] of [
      ['link-child', ['--confirm-write']],
      ['generate', ['image', 'plan']], ['generate', ['image', 'import']], ['generate', ['image', 'cancel']],
      ['output-targets', ['node', 'set']], ['output-targets', ['node', 'replace']], ['output-targets', ['node', 'clear']],
      ['reroll', ['mark']], ['reroll', ['cancel']], ['reroll', ['plan']], ['reroll', ['import']],
      ['tasks', ['claim']], ['tasks', ['start']], ['tasks', ['comment']], ['tasks', ['cancel']], ['tasks', ['override']], ['tasks', ['instructions']],
      ['agent', ['claim']], ['agent', ['heartbeat']], ['agent', ['release']], ['agent', ['revoke']], ['agent', ['transfer']],
    ] as Array<[string, string[]]>) {
      expect(lineageCliCanDelegateMutation(command, args), `${command} ${args.join(' ')}`).toBe(true);
    }
    expect(lineageCliCanDelegateMutation('agent', ['status'])).toBe(false);
    expect(lineageCliCanDelegateMutation('generate', ['image', 'inspect'])).toBe(false);
    expect(lineageCliCanDelegateMutation('output-targets', ['node', 'get'])).toBe(false);
    expect(lineageCliCanDelegateMutation('tasks', ['unknown-write'])).toBe(false);
    expect(lineageCliCanDelegateMutation('unknown', ['write'])).toBe(false);
  });
});

function testProfile(
  profileId: string,
  environment: ResolvedLineageProfile['environment'],
  serviceOrigin = 'http://lineage-test.localhost:5199'
): ResolvedLineageProfile {
  const profileRoot = join(scratchRoot, profileId);
  mkdirSync(join(profileRoot, 'media'), { recursive: true });
  const channel = environment === 'production' ? 'stable' : environment === 'preview' ? 'preview' : 'dev';
  const code = getLineageCodeIdentity(channel);
  const manifest: LineageProfileManifest = {
    asset_root: join(profileRoot, 'media'),
    database_path: join(profileRoot, 'lineage.sqlite'),
    environment,
    expected_runtime: {
      channel,
      code_fingerprint: code.fingerprint,
      code_origin: code.origin === 'package' ? 'package' as const : 'checkout' as const,
    },
    profile_id: profileId,
    schema_version: 'lineage.profile.v1',
    service_origin: serviceOrigin,
  };
  const profile: ResolvedLineageProfile = {
    ...manifest,
    manifest_path: join(profileRoot, 'profile.json'),
    profile_fingerprint: lineageProfileFingerprint(manifest),
  };
  writeFileSync(profile.manifest_path, `${JSON.stringify(profile)}\n`);
  return profile;
}

function bindProfileDatabase(profile: ResolvedLineageProfile): void {
  const database = new DatabaseSync(profile.database_path);
  database.exec('create table lineage_profile_identity (profile_id text primary key, environment text not null, profile_fingerprint text not null, bound_at text not null)');
  database.prepare('insert into lineage_profile_identity (profile_id, environment, profile_fingerprint, bound_at) values (?, ?, ?, ?)')
    .run(profile.profile_id, profile.environment, profile.profile_fingerprint, '2026-07-14T00:00:00.000Z');
  database.close();
}

function selectProfile(profile: ResolvedLineageProfile): void {
  process.env.LINEAGE_PROFILE = profile.manifest_path;
  process.env.LINEAGE_PROFILE_ID = profile.profile_id;
  process.env.LINEAGE_PROFILE_ENVIRONMENT = profile.environment;
  process.env.LINEAGE_PROFILE_FINGERPRINT = profile.profile_fingerprint;
  process.env.LINEAGE_PROFILE_MANIFEST = profile.manifest_path;
  process.env.LINEAGE_DB = profile.database_path;
}

function clearProfileEnvironment(): void {
  for (const key of [
    'LINEAGE_PROFILE',
    'LINEAGE_PROFILE_ID',
    'LINEAGE_PROFILE_ENVIRONMENT',
    'LINEAGE_PROFILE_FINGERPRINT',
    'LINEAGE_PROFILE_MANIFEST',
    'LINEAGE_WRITER_LEASE_TOKEN',
    'LINEAGE_WRITER_LOCK_PATH',
    'LINEAGE_DB',
    'LINEAGE_DB_ACCESS',
  ]) delete process.env[key];
}

function spawnLeaseChild(profile: ResolvedLineageProfile, hold: boolean, channel: 'stable' | 'preview' | 'dev'): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childSource], {
    cwd: repoRoot,
    env: {
      ...originalEnv,
      TEST_CHANNEL: channel,
      TEST_HOLD: hold ? '1' : '0',
      TEST_PROFILE_B64: Buffer.from(JSON.stringify(profile)).toString('base64'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function spawnService(profile: ResolvedLineageProfile, channel: 'stable' | 'preview' | 'dev'): ChildProcess {
  const origin = new URL(profile.service_origin);
  return spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: repoRoot,
    env: {
      ...originalEnv,
      HOST: origin.hostname,
      LINEAGE_ASSET_ROOT: profile.asset_root,
      LINEAGE_CHANNEL: channel,
      LINEAGE_DB: profile.database_path,
      LINEAGE_PROFILE: profile.manifest_path,
      LINEAGE_PROFILE_ENVIRONMENT: profile.environment,
      LINEAGE_PROFILE_FINGERPRINT: profile.profile_fingerprint,
      LINEAGE_PROFILE_ID: profile.profile_id,
      LINEAGE_PROFILE_MANIFEST: profile.manifest_path,
      LINEAGE_PROFILE_SERVICE_ORIGIN: profile.service_origin,
      NODE_ENV: 'production',
      PORT: origin.port,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function spawnCli(profile: ResolvedLineageProfile, args: string[]): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', 'src/cli/lineage-dev.ts', ...args, '--profile', profile.manifest_path], {
    cwd: repoRoot,
    env: { ...originalEnv, NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function spawnCliUnprofiled(args: string[]): ChildProcess {
  const env: NodeJS.ProcessEnv = { ...originalEnv };
  for (const key of ['LINEAGE_PROFILE', 'LINEAGE_PROFILE_ID', 'LINEAGE_PROFILE_ENVIRONMENT', 'LINEAGE_PROFILE_FINGERPRINT', 'LINEAGE_PROFILE_MANIFEST']) delete env[key];
  return spawn(process.execPath, ['--import', 'tsx', 'src/cli/lineage-dev.ts', ...args], {
    cwd: repoRoot,
    env: { ...env, NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function spawnUnprofiledService(databasePath: string, port: number): ChildProcess {
  const env: NodeJS.ProcessEnv = {
    ...originalEnv,
    HOST: '127.0.0.1',
    LINEAGE_CHANNEL: 'dev',
    LINEAGE_ALLOW_UNBOUND_DIAGNOSTIC: '1',
    LINEAGE_DB: databasePath,
    NODE_ENV: 'production',
    PORT: String(port),
  };
  for (const key of ['LINEAGE_PROFILE', 'LINEAGE_PROFILE_ID', 'LINEAGE_PROFILE_ENVIRONMENT', 'LINEAGE_PROFILE_FINGERPRINT', 'LINEAGE_PROFILE_MANIFEST']) delete env[key];
  return spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function availablePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a test port');
  const { port } = address;
  probe.close();
  await once(probe, 'close');
  return port;
}

function waitForLine(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out waiting for child output: ${expected}`));
    }, childProcessStartupTimeoutMs);
    child.stdout?.on('data', chunk => {
      if (!String(chunk).includes(expected)) return;
      clearTimeout(timer);
      resolve();
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Child exited with ${code} before emitting ${expected}`));
    });
  });
}

function collectExit(child: ChildProcess): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.once('exit', code => resolve({ code, stderr, stdout }));
  });
}
