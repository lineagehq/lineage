import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { constants, closeSync, fstatSync, openSync } from 'node:fs';

const STATIC_IMAGE_MAX_PIXELS = 100_000_000;
const STATIC_IMAGE_MAX_BYTES = 256 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_MAX_CHUNKS = 4096;

type SupportedStaticImageFormat = 'jpeg' | 'png' | 'webp';

export interface StaticImageMetadata {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  format: SupportedStaticImageFormat;
  height: number;
  width: number;
}

class StaticImageMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaticImageMetadataError';
  }
}

const decoderScript = String.raw`
const sharp = require(process.argv[1]);
const chunks = [];
let byteLength = 0;
let oversized = false;
process.stdin.on('data', chunk => {
  byteLength += chunk.length;
  if (byteLength > 268435456) {
    oversized = true;
    chunks.length = 0;
  } else if (!oversized) chunks.push(chunk);
});
process.stdin.on('end', async () => {
if (oversized) throw new Error('encoded image exceeds the 268435456-byte safety limit');
const bytes = Buffer.concat(chunks);
(async () => {
  const image = sharp(bytes, {
    animated: true,
    failOn: 'error',
    limitInputPixels: 100000000,
    sequentialRead: true
  });
  const metadata = await image.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format)) {
    throw new Error('unsupported decoded format: ' + (metadata.format || 'unknown'));
  }
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)) {
    throw new Error('decoded dimensions are unavailable');
  }
  if (metadata.width * metadata.height > 100000000) {
    throw new Error('decoded image exceeds the 100000000-pixel safety limit');
  }
  if ((metadata.pages || 1) !== 1) {
    throw new Error('animated images are not supported');
  }
  await image.stats();
  process.stdout.write(JSON.stringify({
    format: metadata.format,
    width: metadata.width,
    height: metadata.height
  }));
})().catch(error => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
});`;

function contentType(format: SupportedStaticImageFormat): StaticImageMetadata['contentType'] {
  if (format === 'png') return 'image/png';
  if (format === 'jpeg') return 'image/jpeg';
  return 'image/webp';
}

function pngCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function rejectAnimatedPng(bytes: Buffer): void {
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return;
  let offset = PNG_SIGNATURE.length;
  let chunkCount = 0;
  let seenHeader = false;
  let seenImageData = false;
  let imageDataEnded = false;
  let seenEnd = false;
  let animationFrames: number | null = null;
  let frameControls = 0;
  let frameDataChunks = 0;
  let expectedSequence = 0;
  const invalid = (): never => { throw new StaticImageMetadataError('Unable to decode supported PNG, JPEG, or WebP bytes: invalid PNG structure'); };
  while (offset < bytes.length) {
    chunkCount += 1;
    if (chunkCount > PNG_MAX_CHUNKS || seenEnd || bytes.length - offset < 12) invalid();
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) invalid();
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(type)) invalid();
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = bytes.subarray(dataStart, dataEnd);
    if (pngCrc32(bytes.subarray(offset + 4, dataEnd)) !== bytes.readUInt32BE(dataEnd)) invalid();
    if (!seenHeader && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (seenHeader || length !== 13) invalid();
      seenHeader = true;
    } else if (type === 'acTL') {
      if (!seenHeader || seenImageData || animationFrames !== null || length !== 8) invalid();
      animationFrames = data.readUInt32BE(0);
      if (animationFrames < 1) invalid();
    } else if (type === 'fcTL') {
      if (animationFrames === null || length !== 26 || data.readUInt32BE(0) !== expectedSequence) invalid();
      expectedSequence += 1;
      frameControls += 1;
      if (data.readUInt32BE(4) < 1 || data.readUInt32BE(8) < 1) invalid();
    } else if (type === 'fdAT') {
      if (animationFrames === null || !seenImageData || frameControls < 2 || length < 5 || data.readUInt32BE(0) !== expectedSequence) invalid();
      expectedSequence += 1;
      frameDataChunks += 1;
    } else if (type === 'IDAT') {
      if (!seenHeader || imageDataEnded) invalid();
      seenImageData = true;
    } else {
      if (seenImageData && type !== 'IEND') imageDataEnded = true;
      if (type === 'IEND') {
        if (!seenImageData || length !== 0 || dataEnd + 4 !== bytes.length) invalid();
        seenEnd = true;
      }
    }
    offset = dataEnd + 4;
  }
  if (!seenHeader || !seenEnd) invalid();
  if (animationFrames !== null) {
    if (frameControls !== animationFrames || (animationFrames > 1 && frameDataChunks < 1)) invalid();
    throw new StaticImageMetadataError('Unable to decode supported PNG, JPEG, or WebP bytes: animated images are not supported');
  }
}

export function readStaticImageMetadataFromBytes(bytes: Buffer): StaticImageMetadata {
  if (bytes.length > STATIC_IMAGE_MAX_BYTES) {
    throw new StaticImageMetadataError(`Unable to decode static image: encoded image exceeds the ${STATIC_IMAGE_MAX_BYTES}-byte safety limit`);
  }
  rejectAnimatedPng(bytes);
  const sharpModule = createRequire(import.meta.url).resolve('sharp');
  const result = spawnSync(process.execPath, ['-e', decoderScript, sharpModule], {
    encoding: 'utf8',
    input: bytes,
    maxBuffer: 16 * 1024,
    timeout: 30_000,
  });
  if (result.error) {
    throw new StaticImageMetadataError(`Unable to decode static image: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `decoder exited with status ${result.status ?? 'unknown'}`;
    throw new StaticImageMetadataError(`Unable to decode supported PNG, JPEG, or WebP bytes: ${detail}`);
  }
  try {
    const decoded = JSON.parse(result.stdout) as { format?: unknown; width?: unknown; height?: unknown };
    if (
      (decoded.format !== 'png' && decoded.format !== 'jpeg' && decoded.format !== 'webp')
      || !Number.isInteger(decoded.width)
      || !Number.isInteger(decoded.height)
    ) {
      throw new Error('decoder returned invalid metadata');
    }
    const width = Number(decoded.width);
    const height = Number(decoded.height);
    if (width * height > STATIC_IMAGE_MAX_PIXELS) {
      throw new Error(`decoded image exceeds the ${STATIC_IMAGE_MAX_PIXELS}-pixel safety limit`);
    }
    return { contentType: contentType(decoded.format), format: decoded.format, height, width };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new StaticImageMetadataError(`Unable to decode static image metadata: ${detail}`);
  }
}

export function readStaticImageMetadata(filePath: string): StaticImageMetadata {
  const fd = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) throw new StaticImageMetadataError('Unable to decode static image: source is not a regular file');
    if (stats.size > STATIC_IMAGE_MAX_BYTES) {
      throw new StaticImageMetadataError(`Unable to decode static image: encoded image exceeds the ${STATIC_IMAGE_MAX_BYTES}-byte safety limit`);
    }
    const sharpModule = createRequire(import.meta.url).resolve('sharp');
    const result = spawnSync(process.execPath, ['-e', decoderScript, sharpModule], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024,
      stdio: [fd, 'pipe', 'pipe'],
      timeout: 30_000,
    });
    if (result.error) throw new StaticImageMetadataError(`Unable to decode static image: ${result.error.message}`);
    if (result.status !== 0) {
      const detail = result.stderr.trim() || `decoder exited with status ${result.status ?? 'unknown'}`;
      throw new StaticImageMetadataError(`Unable to decode supported PNG, JPEG, or WebP bytes: ${detail}`);
    }
    try {
      const decoded = JSON.parse(result.stdout) as { format?: unknown; width?: unknown; height?: unknown };
      if ((decoded.format !== 'png' && decoded.format !== 'jpeg' && decoded.format !== 'webp') || !Number.isInteger(decoded.width) || !Number.isInteger(decoded.height)) {
        throw new Error('decoder returned invalid metadata');
      }
      const width = Number(decoded.width); const height = Number(decoded.height);
      if (width * height > STATIC_IMAGE_MAX_PIXELS) throw new Error(`decoded image exceeds the ${STATIC_IMAGE_MAX_PIXELS}-pixel safety limit`);
      return { contentType: contentType(decoded.format), format: decoded.format, height, width };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new StaticImageMetadataError(`Unable to decode static image metadata: ${detail}`);
    }
  } finally { closeSync(fd); }
}
