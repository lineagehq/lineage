import { describe, expect, it } from 'vitest';
import { BUFFER_CAPABILITY_REGISTRY_VERSION, bufferChannelCapability } from './bufferCapabilities';

describe('Buffer capability registry', () => {
  it('supports only the explicit v2 single-image entries and explains every unknown service', () => {
    expect(BUFFER_CAPABILITY_REGISTRY_VERSION).toBe(2);
    expect(bufferChannelCapability('instagram')).toMatchObject({ supported: true, image_post: true, notification: true, image: { geometries: [{ width: 1080, height: 1080 }, { width: 1080, height: 1440 }], instagram_metadata: { type: 'post', shouldShareToFeed: true } } });
    expect(bufferChannelCapability('linkedin')).toMatchObject({ supported: true, image_post: true, notification: false, image: { geometries: [{ width: 1200, height: 628 }, { width: 1200, height: 1200 }, { width: 720, height: 900 }], instagram_metadata: null } });
    expect(bufferChannelCapability('future-network')).toMatchObject({ supported: false, image_post: false, reason: expect.stringContaining('not in Buffer capability registry v2') });
  });
});
