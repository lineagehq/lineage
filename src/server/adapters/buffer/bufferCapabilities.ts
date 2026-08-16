export const BUFFER_CAPABILITY_REGISTRY_VERSION = 2;

interface BufferImageGeometry { width: number; height: number }

export interface BufferChannelCapability {
  automatic: boolean;
  image_post: boolean;
  notification: boolean;
  scheduling_modes: Array<'customScheduled' | 'addToQueue'>;
  supported: boolean;
  reason: string | null;
  image: {
    formats: Array<'image/png' | 'image/jpeg'>;
    max_bytes: number;
    max_pixels: number;
    geometries: BufferImageGeometry[];
    alt_text_review_required: true;
    post_type: 'feed' | 'single_image';
    instagram_metadata: { type: 'post'; shouldShareToFeed: true } | null;
  } | null;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 100_000_000;

const registry: Record<'instagram' | 'linkedin', BufferChannelCapability> = {
  instagram: {
    automatic: true, image_post: true, notification: true,
    scheduling_modes: ['customScheduled', 'addToQueue'], supported: true, reason: null,
    image: {
      formats: ['image/png', 'image/jpeg'], max_bytes: MAX_IMAGE_BYTES, max_pixels: MAX_IMAGE_PIXELS,
      geometries: [{ width: 1080, height: 1080 }, { width: 1080, height: 1440 }],
      alt_text_review_required: true, post_type: 'feed',
      instagram_metadata: { type: 'post', shouldShareToFeed: true },
    },
  },
  linkedin: {
    automatic: true, image_post: true, notification: false,
    scheduling_modes: ['customScheduled', 'addToQueue'], supported: true, reason: null,
    image: {
      formats: ['image/png', 'image/jpeg'], max_bytes: MAX_IMAGE_BYTES, max_pixels: MAX_IMAGE_PIXELS,
      geometries: [{ width: 1200, height: 628 }, { width: 1200, height: 1200 }, { width: 720, height: 900 }],
      alt_text_review_required: true, post_type: 'single_image', instagram_metadata: null,
    },
  },
};

export function bufferChannelCapability(service: string): BufferChannelCapability {
  const normalized = service.trim().toLowerCase();
  if (normalized === 'instagram' || normalized === 'linkedin') return structuredClone(registry[normalized]);
  return { automatic: false, image_post: false, notification: false, scheduling_modes: [], supported: false, reason: `Service ${normalized || 'unknown'} is not in Buffer capability registry v2`, image: null };
}

export function canonicalBufferCapabilityJson(service: string): string {
  return JSON.stringify(bufferChannelCapability(service));
}
