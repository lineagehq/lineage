import { createHash } from 'node:crypto';

export interface SocialRevisionDigestInput {
  channelId: string;
  copy: string;
  hashtags: Array<{ position: number; value: string }>;
  hashtagPlacement: 'caption' | 'first_comment';
  altText?: string;
  altTextReviewed: boolean;
  altTextReviewedBy?: string;
  editorialState: 'draft' | 'needs_review' | 'ready' | 'archived';
  publishMethod: 'automatic' | 'notification';
  compositionMode?: 'customScheduled' | 'addToQueue';
  customScheduledAt?: string;
  channelFingerprint: string;
}

class SocialRevisionDigestError extends Error {
  constructor() { super('Social revision digest input is invalid'); }
}

export function canonicalSocialRevisionDigest(input: SocialRevisionDigestInput): string {
  const hashtags = input.hashtags.map((tag, index) => {
    if (tag.position !== index || !Number.isInteger(tag.position)) throw new SocialRevisionDigestError();
    return tag.value;
  });
  const projection = {
    alt_text: input.altText?.trim() || null,
    alt_text_reviewed: input.altTextReviewed,
    alt_text_reviewed_by: input.altTextReviewed ? input.altTextReviewedBy?.trim() || null : null,
    channel_fingerprint: input.channelFingerprint,
    channel_id: input.channelId,
    composition_mode: input.compositionMode || null,
    copy: input.copy,
    custom_scheduled_at: input.customScheduledAt || null,
    hashtag_placement: input.hashtagPlacement,
    hashtags,
    editorial_state: input.editorialState,
    publish_method: input.publishMethod,
  };
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}
