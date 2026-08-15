import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveBufferCredential } from './bufferConnection';
import { BUFFER_CLI_VERSION, type BufferSpawn } from './bufferRuntime';

const BUFFER_INSIGHTS_SCHEMA_HASHES = {
  'posts get': '41260868dbf914c4de0742084cf2cede669f12a94148541b30c9b74b64b42cec',
  'posts list': 'd4fb49f7f8959c8b9c28d214a7bdae115e3a5079970a4a7c17512d6450d36fa7',
} as const;

class BufferInsightsRuntimeError extends Error {
  constructor(message: string, public code = 'buffer_insights_failed') { super(message); }
}

interface BufferInsightsConnection { credentialRef: string; organizationId: string }
export interface BufferInsightsRuntime {
  verify(): void;
  getPost(connection: BufferInsightsConnection, postId: string): unknown;
  listSentPosts(connection: BufferInsightsConnection, channelId: string): unknown;
}

function metadata(): { cliPath: string; version: string } {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('@bufferapp/cli/package.json');
  const manifest = require(packagePath) as { bin: { buffer: string }; version: string };
  return { cliPath: join(dirname(packagePath), manifest.bin.buffer), version: manifest.version };
}

function isolated<T>(operation: (cwd: string, home: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'lineage-buffer-insights-'));
  const cwd = join(root, 'cwd'); const home = join(root, 'home');
  mkdirSync(cwd, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  try { return operation(cwd, home); }
  finally { rmSync(root, { force: true, recursive: true }); }
}

function cleanEnvironment(apiKey: string, home: string): NodeJS.ProcessEnv {
  return { [['BUFFER', 'API', 'KEY'].join('_')]: apiKey, BUFFER_DISABLE_UPDATE_CHECK: '1', HOME: home, NO_COLOR: '1', XDG_CONFIG_HOME: home };
}

function execute(spawn: BufferSpawn, apiKey: string, args: string[]): unknown {
  const packageMetadata = metadata();
  if (packageMetadata.version !== BUFFER_CLI_VERSION) throw new BufferInsightsRuntimeError('Pinned Buffer CLI version mismatch', 'runtime_mismatch');
  const result = isolated((cwd, home) => spawn(process.execPath, [packageMetadata.cliPath, ...args], { cwd, env: cleanEnvironment(apiKey, home), encoding: 'utf8', shell: false }));
  if (result.error || result.status !== 0) throw new BufferInsightsRuntimeError('Buffer insights read failed');
  try { return JSON.parse(String(result.stdout || 'null')); }
  catch { throw new BufferInsightsRuntimeError('Buffer insights returned invalid JSON'); }
}

function credential(connection: BufferInsightsConnection, env: NodeJS.ProcessEnv): string {
  const value = resolveBufferCredential(connection.credentialRef, env);
  if (!value) throw new BufferInsightsRuntimeError('Buffer credential is unavailable', 'credential_missing');
  return value;
}

const postFields = 'id,text,status,createdAt,updatedAt,dueAt,sentAt,channelId,externalLink,metadata.firstComment,metrics.{type,name,value,unit},metricsUpdatedAt';

export function createBufferInsightsRuntime(options: { env?: NodeJS.ProcessEnv; spawn?: BufferSpawn } = {}): BufferInsightsRuntime {
  const spawn = options.spawn || spawnSync; const env = options.env || process.env;
  return {
    verify() {
      const packageMetadata = metadata();
      if (packageMetadata.version !== BUFFER_CLI_VERSION) throw new BufferInsightsRuntimeError('Pinned Buffer CLI version mismatch', 'runtime_mismatch');
      for (const [command, expected] of Object.entries(BUFFER_INSIGHTS_SCHEMA_HASHES)) {
        const result = isolated((cwd, home) => spawn(process.execPath, [packageMetadata.cliPath, 'schema', 'describe', ...command.split(' ')], { cwd, env: cleanEnvironment('schema-only', home), encoding: 'utf8', shell: false }));
        if (result.status !== 0 || createHash('sha256').update(String(result.stdout || '')).digest('hex') !== expected) throw new BufferInsightsRuntimeError('Buffer insights schema mismatch', 'runtime_mismatch');
      }
    },
    getPost(connection, postId) {
      return execute(spawn, credential(connection, env), ['posts', 'get', '--id', postId, '--fields', postFields, '--output', 'json', '--quiet']);
    },
    listSentPosts(connection, channelId) {
      return execute(spawn, credential(connection, env), ['posts', 'list', '--json', JSON.stringify({ organizationId: connection.organizationId, filter: { status: ['sent'], channelIds: [channelId] }, sort: [{ field: 'dueAt', direction: 'desc' }] }), '--fields', `items.{${postFields}},pageInfo`, '--limit', '25', '--output', 'json', '--quiet']);
    },
  };
}
