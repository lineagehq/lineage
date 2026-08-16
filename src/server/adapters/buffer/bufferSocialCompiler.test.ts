import { describe, expect, it } from 'vitest';
import { compileBufferSingleImageRequest, type BufferSingleImageCompilation } from './bufferSocialCompiler';

const base: BufferSingleImageCompilation = {
  channelId: 'fixture-channel', service: 'instagram', copy: 'Synthetic caption', hashtags: ['proof'],
  hashtagPlacement: 'caption', publishMethod: 'automatic', compositionMode: 'addToQueue',
  imageUrl: 'https://fixture.invalid/media', altText: 'Reviewed synthetic square', width: 1080, height: 1080,
};

describe('Buffer single-image compiler', () => {
  it.each([
    ['instagram automatic queue', { ...base }, { metadata: { type: 'post', shouldShareToFeed: true }, due: false }],
    ['instagram notification queue', { ...base, publishMethod: 'notification' as const }, { metadata: { type: 'post', shouldShareToFeed: true }, due: false }],
    ['instagram notification custom', { ...base, publishMethod: 'notification' as const, compositionMode: 'customScheduled' as const, customScheduledAt: '2099-01-01T12:00:00Z' }, { metadata: { type: 'post', shouldShareToFeed: true }, due: true }],
    ['instagram automatic custom', { ...base, compositionMode: 'customScheduled' as const, customScheduledAt: '2099-01-01T12:00:00Z' }, { metadata: { type: 'post', shouldShareToFeed: true }, due: true }],
    ['linkedin automatic queue', { ...base, service: 'linkedin' as const, width: 1200, height: 628 }, { metadata: undefined, due: false }],
    ['linkedin automatic custom', { ...base, service: 'linkedin' as const, width: 1200, height: 1200, compositionMode: 'customScheduled' as const, customScheduledAt: '2099-01-01T12:00:00Z' }, { metadata: undefined, due: true }],
  ])('emits the exact %s payload', (_name, input, expectation) => {
    const request = compileBufferSingleImageRequest(input);
    expect(request).toEqual({
      channelId: input.channelId, copy: input.copy, hashtags: input.hashtags, hashtagPlacement: input.hashtagPlacement,
      publishMethod: input.publishMethod, compositionMode: input.compositionMode,
      ...(expectation.due ? { customScheduledAt: input.customScheduledAt } : {}),
      assets: [{ image: { url: input.imageUrl, metadata: { altText: input.altText, width: input.width, height: input.height } } }],
      ...(expectation.metadata ? { metadata: expectation.metadata } : {}),
    });
    expect(Object.isFrozen(request)).toBe(true); expect(Object.isFrozen(request.assets)).toBe(true);
  });

  it('rejects missing reviewed alt text and LinkedIn notification publishing', () => {
    expect(() => compileBufferSingleImageRequest({ ...base, altText: '  ' })).toThrow('Reviewed alt text');
    expect(() => compileBufferSingleImageRequest({ ...base, service: 'linkedin', publishMethod: 'notification' })).toThrow('LinkedIn notification');
  });
});
