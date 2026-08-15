import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readStaticImageMetadata, readStaticImageMetadataFromBytes } from './staticImageMetadata';
import { createSyntheticApng1080Square, syntheticPngCrc32 } from './testFixtures/syntheticApng';

function apngChunks(bytes: Buffer): Array<{ type: string; data: Buffer; crc: number }> {
  const chunks: Array<{ type: string; data: Buffer; crc: number }> = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const dataEnd = offset + 8 + length;
    chunks.push({ type: bytes.toString('ascii', offset + 4, offset + 8), data: bytes.subarray(offset + 8, dataEnd), crc: bytes.readUInt32BE(dataEnd) });
    offset = dataEnd + 4;
  }
  return chunks;
}

describe('static image metadata', () => {
  it.each([
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ] as const)('decodes %s from bytes even with a misleading extension', async (format, contentType) => {
    const directory = mkdtempSync(join(tmpdir(), 'lineage-static-image-'));
    const file = join(directory, `valid-${format}.video`);
    await sharp({
      create: { background: '#23574a', channels: 4, height: 19, width: 23 },
    })[format]().toFile(file);

    expect(readStaticImageMetadata(file)).toEqual({ contentType, format, height: 19, width: 23 });
    expect(readStaticImageMetadataFromBytes(readFileSync(file))).toEqual({ contentType, format, height: 19, width: 23 });
  });

  it('refuses symlink and non-file pathname inputs while descriptor bytes remain decodable', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lineage-static-image-'));
    const file = join(directory, 'valid.png'); const link = join(directory, 'link.png'); const nonFile = join(directory, 'directory.png');
    await sharp({ create: { background: '#23574a', channels: 4, height: 19, width: 23 } }).png().toFile(file);
    symlinkSync(file, link); mkdirSync(nonFile);
    expect(() => readStaticImageMetadata(link)).toThrow();
    expect(() => readStaticImageMetadata(nonFile)).toThrow('regular file');
    expect(readStaticImageMetadataFromBytes(readFileSync(file))).toMatchObject({ format: 'png', width: 23, height: 19 });
  });

  it('rejects truncated and corrupt bytes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lineage-static-image-'));
    const valid = join(directory, 'valid.png');
    const truncated = join(directory, 'truncated.png');
    const corrupt = join(directory, 'corrupt.png');
    await sharp({
      create: { background: '#23574a', channels: 4, height: 19, width: 23 },
    }).png().toFile(valid);
    const bytes = readFileSync(valid);
    writeFileSync(truncated, bytes.subarray(0, Math.floor(bytes.length / 2)));
    writeFileSync(corrupt, Buffer.from('not an image'));

    expect(() => readStaticImageMetadata(truncated)).toThrow(/Unable to decode supported PNG, JPEG, or WebP bytes/);
    expect(() => readStaticImageMetadata(corrupt)).toThrow(/Unable to decode supported PNG, JPEG, or WebP bytes/);
  });

  it('rejects an oversized sparse file before reading or decoding it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lineage-static-image-'));
    const oversized = join(directory, 'oversized.png');
    writeFileSync(oversized, '');
    truncateSync(oversized, (256 * 1024 * 1024) + 1);
    expect(() => readStaticImageMetadata(oversized)).toThrow('encoded image exceeds');
  });

  it('rejects a structurally valid deterministic two-frame 1080x1080 APNG', () => {
    const bytes = createSyntheticApng1080Square();
    const chunks = apngChunks(bytes);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.length).toBeLessThan(5 * 1024 * 1024);
    expect(chunks.map(chunk => chunk.type)).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
    for (const chunk of chunks) {
      expect(chunk.crc).toBe(syntheticPngCrc32(Buffer.concat([Buffer.from(chunk.type), chunk.data])));
    }
    const header = chunks[0].data;
    expect([header.readUInt32BE(0), header.readUInt32BE(4)]).toEqual([1080, 1080]);
    expect(chunks[1].data.readUInt32BE(0)).toBe(2);
    const controls = chunks.filter(chunk => chunk.type === 'fcTL');
    expect(controls.map(chunk => [chunk.data.readUInt32BE(4), chunk.data.readUInt32BE(8)])).toEqual([[1080, 1080], [1080, 1080]]);
    const firstFrame = inflateSync(chunks.find(chunk => chunk.type === 'IDAT')!.data);
    const secondFrame = inflateSync(chunks.find(chunk => chunk.type === 'fdAT')!.data.subarray(4));
    expect(firstFrame.length).toBe((1 + (1080 * 4)) * 1080);
    expect(secondFrame.length).toBe(firstFrame.length);
    expect(secondFrame.equals(firstFrame)).toBe(false);
    expect(() => readStaticImageMetadataFromBytes(bytes)).toThrow('animated images are not supported');
  });

  it.each([
    ['SVG', '<svg xmlns="http://www.w3.org/2000/svg" width="23" height="19"></svg>'],
    ['GIF', 'GIF89a'],
    ['video', '....ftypmp42'],
  ])('rejects unsupported %s bytes', (_label, bytes) => {
    const directory = mkdtempSync(join(tmpdir(), 'lineage-static-image-'));
    const file = join(directory, 'spoofed.png');
    writeFileSync(file, bytes);
    expect(() => readStaticImageMetadata(file)).toThrow(/supported PNG, JPEG, or WebP bytes/);
  });
});
