import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BufferRuntimeError, handleBufferRuntimeServerError } from './server/adapters/buffer/bufferRuntime';
import { isSocialDeliveryError, SocialDeliveryError } from './server/social/socialDelivery';

describe('server Buffer runtime error handling', () => {
  it('uses the production handler branch and returns a normalized response without runtime details', () => {
    const sensitive = `synthetic-${createHash('sha256').update('runtime-sensitive-detail').digest('hex')}`;
    const json = vi.fn(); const status = vi.fn(() => ({ json }));
    expect(handleBufferRuntimeServerError(new BufferRuntimeError(`Buffer read failed: ${sensitive}`, 502), { status })).toBe(true);
    expect(status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith({ error: 'buffer_runtime_error', message: 'Buffer read failed' });
    expect(JSON.stringify(json.mock.calls)).not.toContain(sensitive);
    json.mockClear(); status.mockClear();
    expect(handleBufferRuntimeServerError(new BufferRuntimeError('Buffer command schema mismatch: channels list', 409), { status })).toBe(true);
    expect(json).toHaveBeenCalledWith({ error: 'buffer_runtime_error', message: 'Buffer runtime verification failed' });
    expect(handleBufferRuntimeServerError(new Error(sensitive), { status })).toBe(false);
  });
});

describe('server Social delivery error identity', () => {
  it('recognizes only the concrete typed error and preserves its safe transport fields', () => {
    const error = new SocialDeliveryError('Social delivery preview changed', 409, 'preview_stale');
    expect(isSocialDeliveryError(error)).toBe(true);
    if (!isSocialDeliveryError(error)) throw new Error('expected typed SocialDeliveryError');
    expect({ error: error.code, message: error.message, status: error.status }).toEqual({
      error: 'preview_stale', message: 'Social delivery preview changed', status: 409,
    });
    expect(isSocialDeliveryError({ code: error.code, message: error.message, status: error.status })).toBe(false);
    expect(isSocialDeliveryError(new Error(error.message))).toBe(false);
  });
});
