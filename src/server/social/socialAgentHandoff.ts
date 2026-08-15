import { createHash } from 'node:crypto';
import type { SocialAgentHandoff } from '../../shared/socialTypes';
import { lineageDb } from '../assetLineageDb';
import { compileBufferSingleImageRequest, projectedBufferText } from '../adapters/buffer/bufferSocialCompiler';
import { compileSocialDeliveryForAgentHandoff, SocialDeliveryError } from './socialDelivery';

interface CreateInput {
  expectedRevision: number;
  previewSha256: string;
  variantId: string;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function channelDisplayName(project: string, channelId: string): string {
  const database = lineageDb();
  try {
    const row = database.prepare('select display_name from buffer_channels where project_id=? and channel_id=?')
      .get(project, channelId) as { display_name: string } | undefined;
    if (!row?.display_name?.trim()) throw new SocialDeliveryError('Buffer channel display name is unavailable', 409, 'preflight_failed');
    return row.display_name;
  } finally { database.close(); }
}

function markdown(value: Omit<SocialAgentHandoff, 'agent_brief_markdown'>): string {
  const timing = value.custom_scheduled_at
    ? `Schedule for exactly ${value.custom_scheduled_at}. Preserve the written UTC offset.`
    : 'Use the next available Buffer queue slot and report the selected time.';
  return [
    '# Lineage social publishing brief',
    '',
    `Immutable handoff: ${value.handoff_id}`,
    `Preview: ${value.preview_sha256}`,
    `Lineage project: ${value.project}`,
    `Variant/revision: ${value.variant_id} / r${value.revision}`,
    '',
    '## Buffer target',
    `- Channel: ${value.channel.display_name} (${value.channel.service}, ${value.channel.id})`,
    `- Open: ${value.buffer_url}`,
    `- Timing: ${timing}`,
    `- Publish method intent: ${value.publish_method}`,
    '',
    '## Exact media',
    `- Local file: ${value.media.local_file_path}`,
    `- Lineage reference: ${value.media.local_reference}`,
    `- SHA-256: ${value.media.checksum_sha256}`,
    `- Rendition: ${value.media.rendition_sha256}`,
    `- Geometry: ${value.media.width}x${value.media.height}; ${value.media.content_type}; ${value.media.size_bytes} bytes`,
    '',
    '## Exact post text',
    value.rendered_text,
    '',
    ...(value.first_comment ? ['## Exact first comment', value.first_comment, ''] : []),
    '## Alt text',
    value.alt_text,
    '',
    '## Agent operating contract',
    'Use an authenticated browser session at Buffer. Verify the exact channel, image checksum, caption, hashtags, alt text, and requested time before any external action.',
    'Do not use a private Buffer API, do not substitute media, and do not infer success from a click or page transition.',
    'Press Buffer’s final scheduling control exactly once only when the operator explicitly authorizes this exact immutable brief in the active session. Otherwise stop with the completed draft visible for review.',
    'After scheduling, read provider truth and return the Buffer post ID/URL, selected time, and visible status so Lineage can record and reconcile it.',
  ].join('\n');
}

function buildSocialAgentHandoff(project: string, input: CreateInput, currentTime: number): SocialAgentHandoff {
  if (!/^[a-f0-9]{64}$/.test(input.previewSha256)) throw new SocialDeliveryError('previewSha256 must be a lowercase SHA-256 digest');
  const compiled = compileSocialDeliveryForAgentHandoff(project, { variantId: input.variantId, expectedRevision: input.expectedRevision }, currentTime);
  if (compiled.preview.preview_sha256 !== input.previewSha256) throw new SocialDeliveryError('Social delivery preview changed', 409, 'preview_stale');
  const request = compileBufferSingleImageRequest({ ...compiled.requestSeed, imageUrl: 'https://lineage.invalid/agent-handoff' });
  const firstComment = compiled.requestSeed.hashtagPlacement === 'first_comment'
    ? compiled.requestSeed.hashtags.map(value => value.startsWith('#') ? value : `#${value}`).join(' ')
    : undefined;
  const base = {
    schema_version: 'lineage.social_agent_handoff.v1' as const,
    preview_sha256: compiled.preview.preview_sha256,
    project,
    variant_id: compiled.preview.variant_id,
    revision_id: compiled.preview.revision_id,
    revision: compiled.preview.revision,
    buffer_url: `https://publish.buffer.com/channels/${encodeURIComponent(compiled.preview.channel_id)}/schedule`,
    channel: {
      id: compiled.preview.channel_id,
      display_name: channelDisplayName(project, compiled.preview.channel_id),
      service: compiled.preview.service,
    },
    caption: compiled.requestSeed.copy,
    hashtags: [...compiled.requestSeed.hashtags],
    hashtag_placement: compiled.requestSeed.hashtagPlacement,
    rendered_text: projectedBufferText(request),
    ...(firstComment ? { first_comment: firstComment } : {}),
    alt_text: compiled.requestSeed.altText,
    publish_method: compiled.preview.publish_method,
    composition_mode: compiled.preview.composition_mode,
    ...(compiled.preview.custom_scheduled_at ? { custom_scheduled_at: compiled.preview.custom_scheduled_at } : {}),
    media: {
      local_file_path: compiled.media.localFilePath,
      local_reference: compiled.media.localReference,
      content_type: compiled.media.contentType,
      checksum_sha256: compiled.media.checksumSha256,
      rendition_sha256: compiled.media.renditionSha256,
      width: compiled.media.width,
      height: compiled.media.height,
      size_bytes: compiled.media.sizeBytes,
    },
    confirmation_policy: 'explicit_operator_confirmation_in_buffer' as const,
  };
  const handoffId = digest(base);
  const value = { ...base, handoff_id: handoffId };
  return { ...value, agent_brief_markdown: markdown(value) };
}

export function createSocialAgentHandoff(project: string, input: CreateInput, currentTime = Date.now()): SocialAgentHandoff {
  return buildSocialAgentHandoff(project, input, currentTime);
}

export function recreateSocialAgentHandoffEvidence(project: string, input: CreateInput): SocialAgentHandoff {
  return buildSocialAgentHandoff(project, input, Number.NEGATIVE_INFINITY);
}
