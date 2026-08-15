import { describe, expect, it } from 'vitest';
import { canonicalSocialRevisionDigest } from './socialRevisionDigest';

const revision = {
  channelId: 'fixture-channel',
  copy: 'Fixture copy',
  hashtags: [{ position: 0, value: 'one' }, { position: 1, value: 'two' }],
  hashtagPlacement: 'caption' as const,
  altText: 'Fixture alt text',
  altTextReviewed: true,
  altTextReviewedBy: 'human:reviewer',
  editorialState: 'ready' as const,
  publishMethod: 'automatic' as const,
  compositionMode: 'addToQueue' as const,
  channelFingerprint: 'fixture-fingerprint',
};

describe('canonical Social revision digest', () => {
  it('is deterministic and binds every revision field plus strict hashtag order', () => {
    const digest = canonicalSocialRevisionDigest(revision);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(canonicalSocialRevisionDigest({ ...revision })).toBe(digest);
    for (const changed of [
      { ...revision, channelId: 'other-channel' },
      { ...revision, copy: 'Other copy' },
      { ...revision, hashtags: [{ position: 0, value: 'two' }, { position: 1, value: 'one' }] },
      { ...revision, hashtagPlacement: 'first_comment' as const },
      { ...revision, altText: 'Other alt' },
      { ...revision, altTextReviewed: false, altTextReviewedBy: undefined },
      { ...revision, altTextReviewedBy: 'other-reviewer' },
      { ...revision, editorialState: 'needs_review' as const },
      { ...revision, publishMethod: 'notification' as const },
      { ...revision, compositionMode: 'customScheduled' as const, customScheduledAt: '2026-12-01T00:00:00Z' },
      { ...revision, channelFingerprint: 'other-fingerprint' },
    ]) expect(canonicalSocialRevisionDigest(changed)).not.toBe(digest);
  });

  it('rejects missing, duplicate, or non-contiguous hashtag positions', () => {
    for (const hashtags of [
      [{ position: 1, value: 'one' }],
      [{ position: 0, value: 'one' }, { position: 0, value: 'two' }],
      [{ position: 0, value: 'one' }, { position: 2, value: 'two' }],
    ]) expect(() => canonicalSocialRevisionDigest({ ...revision, hashtags })).toThrow('digest input is invalid');
  });
});
