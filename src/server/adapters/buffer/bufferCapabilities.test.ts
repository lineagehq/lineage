import { describe, expect, it } from 'vitest';
import { BUFFER_CAPABILITY_REGISTRY_VERSION, bufferChannelCapability } from './bufferCapabilities';

describe('Buffer capability registry', () => {
  it('supports only the explicit v1 image entries and explains every unknown service', () => {
    expect(BUFFER_CAPABILITY_REGISTRY_VERSION).toBe(1);
    expect(bufferChannelCapability('instagram')).toMatchObject({ supported: true, image_post: true, notification: true });
    expect(bufferChannelCapability('linkedin')).toMatchObject({ supported: true, image_post: true, notification: false });
    expect(bufferChannelCapability('future-network')).toMatchObject({ supported: false, image_post: false, reason: expect.stringContaining('not in Buffer capability registry v1') });
  });
});
