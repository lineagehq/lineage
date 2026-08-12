import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export const BUFFER_CLI_VERSION = '1.2.0';
export const BUFFER_SCHEMA_HASHES = {
  'channels get': '4512f76c60bec8918d2445cf7ab3572f94cd086c2172cc2e8c3921d3a1f6ed18',
  'channels list': '406042d0a042ce9f37fbd3520ec7c7b6b38cbc72ab15828cf5fa3354fb7ccfc1',
  'posts create': '84620a0118971022f41a21000fef3aba5874a3a7029c695068857ab11677ff4d',
} as const;
export const BUFFER_READ_ALLOWLIST = ['schema describe', 'channels list', 'channels get'] as const;
const bufferCredentialEnvironmentKey = ['BUFFER', 'API', 'KEY'].join('_');

export class BufferRuntimeError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function isBufferRuntimeError(error: unknown): error is BufferRuntimeError { return error instanceof BufferRuntimeError; }
function bufferRuntimeErrorResponse(error: BufferRuntimeError): { status: number; body: { error: 'buffer_runtime_error'; message: string } } {
  const verificationFailure = /version|schema|fingerprint/i.test(error.message);
  return { status: error.status, body: { error: 'buffer_runtime_error', message: verificationFailure ? 'Buffer runtime verification failed' : 'Buffer read failed' } };
}
export function handleBufferRuntimeServerError(error: unknown, response: { status(code: number): { json(body: unknown): unknown } }): boolean {
  if (!isBufferRuntimeError(error)) return false;
  const normalized = bufferRuntimeErrorResponse(error);
  response.status(normalized.status).json(normalized.body);
  return true;
}

interface SpawnResult { status: number | null; stdout?: string | Buffer; stderr?: string | Buffer; error?: Error }
export type BufferSpawn = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; encoding: 'utf8'; shell: false }) => SpawnResult;
export interface BufferRuntimeEvidence { cli_path: string; cli_version: string; schema_fingerprint: string; schema_hashes: typeof BUFFER_SCHEMA_HASHES }

function packageMetadata(): { cliPath: string; version: string } {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('@bufferapp/cli/package.json');
  const manifest = require(packagePath) as { bin: { buffer: string }; version: string };
  return { cliPath: join(dirname(packagePath), manifest.bin.buffer), version: manifest.version };
}

function cleanEnvironment(apiKey: string, isolatedHome: string): NodeJS.ProcessEnv {
  return {
    [bufferCredentialEnvironmentKey]: apiKey,
    BUFFER_DISABLE_UPDATE_CHECK: '1',
    HOME: isolatedHome,
    NO_COLOR: '1',
    XDG_CONFIG_HOME: isolatedHome,
  };
}

function withIsolatedInvocation<T>(operation: (isolation: { cwd: string; home: string }) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'lineage-buffer-runtime-'));
  const cwd = join(root, 'cwd');
  const home = join(root, 'home');
  mkdirSync(cwd, { mode: 0o700 });
  mkdirSync(home, { mode: 0o700 });
  try { return operation({ cwd, home }); }
  finally { rmSync(root, { force: true, recursive: true }); }
}

function execute(args: string[], apiKey: string, spawn: BufferSpawn): unknown {
  const metadata = packageMetadata();
  if (metadata.version !== BUFFER_CLI_VERSION) throw new BufferRuntimeError('Pinned Buffer CLI version mismatch');
  const result = withIsolatedInvocation(({ cwd, home }) => spawn(process.execPath, [metadata.cliPath, ...args], { cwd, env: cleanEnvironment(apiKey, home), encoding: 'utf8', shell: false }));
  if (result.error || result.status !== 0) throw new BufferRuntimeError('Buffer read failed');
  try { return JSON.parse(String(result.stdout || 'null')); }
  catch { throw new BufferRuntimeError('Buffer returned invalid JSON'); }
}

export function inspectPinnedBufferRuntime(): { cli_path: string; cli_version: string; schema_hashes: typeof BUFFER_SCHEMA_HASHES } {
  const metadata = packageMetadata();
  if (metadata.version !== BUFFER_CLI_VERSION) throw new BufferRuntimeError('Pinned Buffer CLI version mismatch');
  return { cli_path: metadata.cliPath, cli_version: metadata.version, schema_hashes: BUFFER_SCHEMA_HASHES };
}

export function verifyBufferSchemas(_configRoot: string, spawn: BufferSpawn = spawnSync): void {
  for (const [schema, expected] of Object.entries(BUFFER_SCHEMA_HASHES)) {
    const result = withIsolatedInvocation(({ cwd, home }) => spawn(process.execPath, [packageMetadata().cliPath, 'schema', 'describe', ...schema.split(' ')], { cwd, env: cleanEnvironment('schema-only', home), encoding: 'utf8', shell: false }));
    if (result.status !== 0 || createHash('sha256').update(String(result.stdout || '')).digest('hex') !== expected) {
      throw new BufferRuntimeError(`Buffer command schema mismatch: ${schema}`);
    }
  }
}

export interface BufferReadRuntime {
  verify(): BufferRuntimeEvidence;
  run(command: string, input: { apiKey: string; channelId?: string; organizationId?: string }): unknown;
  listChannels(organizationId: string, apiKey: string): unknown;
  getChannel(channelId: string, apiKey: string): unknown;
}

export function createBufferReadRuntime(configRoot: string, spawn: BufferSpawn = spawnSync): BufferReadRuntime {
  const runtime: BufferReadRuntime = {
    verify: () => {
      const inspected = inspectPinnedBufferRuntime();
      verifyBufferSchemas(configRoot, spawn);
      return { ...inspected, schema_fingerprint: createHash('sha256').update(JSON.stringify(BUFFER_SCHEMA_HASHES)).digest('hex') };
    },
    run: (command, input) => {
      assertBufferReadCommand(command);
      if (command === 'channels list') return execute(['channels', 'list', '--organization-id', input.organizationId || '', '--fields', 'id,organizationId,service,serviceId,displayName,name,avatar,timezone,postingSchedule.day,postingSchedule.times,postingSchedule.paused,allowedActions,isDisconnected,isLocked,isQueuePaused,metadata.__typename,metadata.defaultToReminders', '--output', 'json', '--quiet'], input.apiKey, spawn);
      if (command === 'channels get') return execute(['channels', 'get', '--id', input.channelId || '', '--fields', 'id,organizationId,service,serviceId,displayName,name,avatar,timezone,postingSchedule.day,postingSchedule.times,postingSchedule.paused,allowedActions,isDisconnected,isLocked,isQueuePaused,metadata.__typename,metadata.defaultToReminders', '--output', 'json', '--quiet'], input.apiKey, spawn);
      throw new BufferRuntimeError('Schema inspection is reserved for runtime verification');
    },
    listChannels: (organizationId, apiKey) => runtime.run('channels list', { apiKey, organizationId }),
    getChannel: (channelId, apiKey) => runtime.run('channels get', { apiKey, channelId }),
  };
  return runtime;
}

function assertBufferReadCommand(command: string): void {
  if (!(BUFFER_READ_ALLOWLIST as readonly string[]).includes(command)) throw new BufferRuntimeError('Buffer mutation rejected before invocation');
}
