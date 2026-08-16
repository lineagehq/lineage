import { describe, expect, it, vi } from 'vitest';
import { createBufferInsightsRuntime } from './bufferInsightsRuntime';
import type { BufferSpawn } from './bufferRuntime';

describe('Buffer insights runtime', () => {
  it('uses only pinned read commands with isolated credential transport', () => {
    const credentialKey = ['BUFFER', 'API', 'KEY'].join('_');
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    const spawn: BufferSpawn = vi.fn((_command, args, options) => {
      calls.push({ args, env: options.env });
      return { status: 0, stdout: JSON.stringify({ id: 'post-1' }) };
    });
    const runtime = createBufferInsightsRuntime({ env: { [credentialKey]: 'secret-insights-key' }, spawn });
    runtime.getPost({ credentialRef: `env:${credentialKey}`, organizationId: 'org-1' }, 'post-1');
    runtime.listSentPosts({ credentialRef: `env:${credentialKey}`, organizationId: 'org-1' }, 'channel-1');
    expect(calls).toHaveLength(2);
    expect(calls.map(call => call.args.slice(1, 3))).toEqual([['posts', 'get'], ['posts', 'list']]);
    expect(calls.every(call => call.args.join(' ').includes('assets.{__typename,id,type,mimeType,source,image.{altText,width,height,isAnimated}}'))).toBe(true);
    expect(calls.flatMap(call => call.args).join(' ')).not.toContain('secret-insights-key');
    expect(calls.every(call => call.env[credentialKey] === 'secret-insights-key' && call.env.HOME === call.env.XDG_CONFIG_HOME)).toBe(true);
  });

  it('fails closed on schema drift and redacts invocation failures', () => {
    const credentialKey = ['BUFFER', 'API', 'KEY'].join('_');
    const drift: BufferSpawn = vi.fn(() => ({ status: 0, stdout: '{}' }));
    expect(() => createBufferInsightsRuntime({ spawn: drift }).verify()).toThrow('schema mismatch');
    const failed: BufferSpawn = vi.fn(() => ({ status: 1, stderr: 'secret provider response' }));
    expect(() => createBufferInsightsRuntime({ env: { [credentialKey]: 'secret' }, spawn: failed }).getPost({ credentialRef: `env:${credentialKey}`, organizationId: 'org' }, 'post')).toThrow('Buffer insights read failed');
  });

  it('verifies the exact pinned local posts schemas', () => {
    expect(() => createBufferInsightsRuntime().verify()).not.toThrow();
  });
});
