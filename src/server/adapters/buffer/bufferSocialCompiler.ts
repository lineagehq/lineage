import type { SocialCompositionMode, SocialPublishMethod } from '../../../shared/socialTypes';

export type BufferSingleImageRequest = Readonly<{
  channelId: string;
  copy: string;
  hashtags: readonly string[];
  hashtagPlacement: 'caption' | 'first_comment';
  publishMethod: SocialPublishMethod;
  compositionMode: SocialCompositionMode;
  customScheduledAt?: string;
  assets: readonly Readonly<{ image: Readonly<{ url: string; metadata: Readonly<{ altText: string; width: number; height: number }> }> }>[];
  metadata?: Readonly<{ type: 'post'; shouldShareToFeed: true }>;
}>;

export interface BufferSingleImageCompilation {
  channelId: string;
  service: 'instagram' | 'linkedin';
  copy: string;
  hashtags: readonly string[];
  hashtagPlacement: 'caption' | 'first_comment';
  publishMethod: SocialPublishMethod;
  compositionMode: SocialCompositionMode;
  customScheduledAt?: string;
  imageUrl: string;
  altText: string;
  width: number;
  height: number;
}

export function compileBufferSingleImageRequest(input: BufferSingleImageCompilation): BufferSingleImageRequest {
  if (!input.altText.trim()) throw new Error('Reviewed alt text is required');
  if (input.service === 'linkedin' && input.publishMethod !== 'automatic') throw new Error('LinkedIn notification publishing is unsupported');
  return Object.freeze({
    channelId: input.channelId,
    copy: input.copy,
    hashtags: Object.freeze([...input.hashtags]),
    hashtagPlacement: input.hashtagPlacement,
    publishMethod: input.publishMethod,
    compositionMode: input.compositionMode,
    ...(input.customScheduledAt ? { customScheduledAt: input.customScheduledAt } : {}),
    assets: Object.freeze([{ image: Object.freeze({
      url: input.imageUrl,
      metadata: Object.freeze({ altText: input.altText, width: input.width, height: input.height }),
    }) }]),
    ...(input.service === 'instagram' ? { metadata: Object.freeze({ type: 'post' as const, shouldShareToFeed: true as const }) } : {}),
  });
}

export function projectedBufferText(request: BufferSingleImageRequest): string {
  const hashtags = request.hashtags.map(value => value.startsWith('#') ? value : `#${value}`);
  return request.hashtagPlacement === 'caption'
    ? [request.copy.trim(), hashtags.join(' ')].filter(Boolean).join('\n\n')
    : request.copy.trim();
}
