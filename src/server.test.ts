import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BufferRuntimeError, handleBufferRuntimeServerError } from './server/adapters/buffer/bufferRuntime';

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
