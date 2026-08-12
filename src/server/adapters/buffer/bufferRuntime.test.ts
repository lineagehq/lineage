import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BUFFER_CLI_VERSION, BUFFER_READ_ALLOWLIST, BUFFER_SCHEMA_HASHES, createBufferReadRuntime, inspectPinnedBufferRuntime, verifyBufferSchemas, type BufferSpawn } from './bufferRuntime';

describe('pinned Buffer runtime', () => {
  it('uses the package-local CLI through Node with an isolated scrubbed environment', () => {
    const calls: Parameters<BufferSpawn>[] = [];
    const spawn: BufferSpawn = (...args) => { calls.push(args); return { status: 0, stdout: '[]' }; };
    const runtime = createBufferReadRuntime('/isolated/lineage-buffer', spawn);
    runtime.listChannels(`synthetic-${createHash('sha256').update('runtime').digest('hex')}`, 'test-only-secret');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(process.execPath);
    expect(calls[0][1][0]).toMatch(/node_modules\/@bufferapp\/cli\/built\/index\.mjs$/);
    expect(calls[0][1].slice(1, 3)).toEqual(['channels', 'list']);
    expect(calls[0][2]).toMatchObject({ shell: false, env: { BUFFER_DISABLE_UPDATE_CHECK: '1' } });
    expect(calls[0][2].env[['BUFFER', 'API', 'KEY'].join('_')]).toBe('test-only-secret');
    expect(Object.entries(calls[0][2].env).filter(([, value]) => value === 'test-only-secret')).toHaveLength(1);
    expect(calls[0][2].env.HOME).toBe(calls[0][2].env.XDG_CONFIG_HOME);
    expect(calls[0][2].env.HOME).toMatch(/lineage-buffer-runtime-.*\/home$/);
    expect(calls[0][2].env).not.toHaveProperty('PATH');
    expect(calls[0][2].env).not.toHaveProperty('LINEAGE_SCHEDULER_TOKEN');
    expect(calls[0][2].cwd).toMatch(/lineage-buffer-runtime-/);
    expect(() => calls[0][2].cwd && process.chdir(calls[0][2].cwd)).toThrow();
  });

  it('uses the real CLI config loader without discovering hostile repository, user, or Lineage configuration', () => {
    const hostile = mkdtempSync(join(tmpdir(), 'lineage-hostile-buffer-config-'));
    const hostileUser = join(hostile, 'user'); const hostileLineage = join(hostile, 'lineage-config');
    const previous = process.cwd();
    try {
      mkdirSync(join(hostile, '.buffer'), { recursive: true });
      mkdirSync(join(hostileUser, '.config', 'buffer'), { recursive: true });
      mkdirSync(join(hostileLineage, 'buffer'), { recursive: true });
      for (const path of [join(hostile, '.buffer', 'config.json'), join(hostileUser, '.config', 'buffer', 'config.json'), join(hostileLineage, 'buffer', 'config.json')]) {
        writeFileSync(path, JSON.stringify({ apiUrl: `https://${generated(path)}.invalid`, apiKey: generated(`credential-${path}`) }));
      }
      process.chdir(hostile);
      const isolatedPaths: string[] = [];
      const spawn = vi.fn<BufferSpawn>((_command, _args, options) => {
        expect(options.cwd.startsWith(hostile)).toBe(false);
        expect(readdirSync(options.cwd)).toEqual([]);
        expect(readdirSync(String(options.env.HOME))).toEqual([]);
        isolatedPaths.push(options.cwd, String(options.env.HOME));
        return spawnSync(process.execPath, [_args[0], 'config', 'get', 'apiUrl', '--output', 'json'], options);
      });
      const runtime = createBufferReadRuntime(hostileLineage, spawn);
      expect(runtime.listChannels(generated('organization'), generated('credential'))).toEqual({ source: 'default' });
      expect(runtime.getChannel(generated('channel'), generated('credential'))).toEqual({ source: 'default' });
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(new Set(isolatedPaths).size).toBe(4);
      expect(isolatedPaths.every(path => !existsSync(path))).toBe(true);
    } finally { process.chdir(previous); rmSync(hostile, { force: true, recursive: true }); }
  });

  it('pins the version and schema fingerprints, including the mutation schema used only for compatibility proof', () => {
    expect(inspectPinnedBufferRuntime()).toMatchObject({ cli_version: BUFFER_CLI_VERSION, schema_hashes: BUFFER_SCHEMA_HASHES });
    expect(() => verifyBufferSchemas('/isolated/lineage-buffer-schema')).not.toThrow();
    const spawn: BufferSpawn = (_command, args) => {
      const schema = args.slice(-2).join(' ');
      const known = schema === 'channels list' ? 'list' : schema === 'channels get' ? 'get' : 'create';
      const stdout = known;
      expect(createHash('sha256').update(stdout).digest('hex')).not.toBe(BUFFER_SCHEMA_HASHES[schema as keyof typeof BUFFER_SCHEMA_HASHES]);
      return { status: 0, stdout };
    };
    expect(() => verifyBufferSchemas('/isolated', spawn)).toThrow('schema mismatch');
  });

  it('exposes an exact read-only allowlist and rejects mutations before any runner exists', () => {
    expect(BUFFER_READ_ALLOWLIST).toEqual(['schema describe', 'channels list', 'channels get']);
    const spawn = vi.fn<BufferSpawn>();
    const runtime = createBufferReadRuntime('/isolated', spawn);
    expect(() => runtime.run('posts create', { apiKey: generated('credential') })).toThrow('mutation rejected before invocation');
    expect(() => runtime.run('posts delete', { apiKey: generated('credential') })).toThrow('mutation rejected before invocation');
    expect(spawn).not.toHaveBeenCalled();
  });
});

const generated = (scope: string) => `synthetic-${createHash('sha256').update(scope).digest('hex')}`;
