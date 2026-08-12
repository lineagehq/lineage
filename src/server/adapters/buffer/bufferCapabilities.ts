export const BUFFER_CAPABILITY_REGISTRY_VERSION = 1;

export interface BufferChannelCapability {
  automatic: boolean;
  image_post: boolean;
  notification: boolean;
  scheduling_modes: Array<'customScheduled' | 'addToQueue'>;
  supported: boolean;
  reason: string | null;
}

const supported = new Set(['instagram', 'linkedin']);

export function bufferChannelCapability(service: string): BufferChannelCapability {
  const normalized = service.trim().toLowerCase();
  if (!supported.has(normalized)) return { automatic: false, image_post: false, notification: false, scheduling_modes: [], supported: false, reason: `Service ${normalized || 'unknown'} is not in Buffer capability registry v1` };
  return { automatic: true, image_post: true, notification: normalized === 'instagram', scheduling_modes: ['customScheduled', 'addToQueue'], supported: true, reason: null };
}
