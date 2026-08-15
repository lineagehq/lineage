import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repoRoot, setLineageAssetRoot } from '../assetCore';
import { inspectSocialImage, type SocialImageIdentity } from './socialMedia';
import { fileSha256 } from '../localReview';
import { createSyntheticApng1080Square } from '../testFixtures/syntheticApng';

let root = '';
const originalRoot = repoRoot;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lineage-social-media-'));
  mkdirSync(join(root, 'assets'), { mode: 0o700 });
  setLineageAssetRoot(root);
});
afterEach(() => { setLineageAssetRoot(originalRoot); rmSync(root, { recursive: true, force: true }); });

async function image(name: string, width: number, height: number, format: 'png' | 'jpeg' | 'webp' = 'png'): Promise<{ path: string; reference: string }> {
  const reference = `assets/${name}.${format}`;
  const path = join(root, reference);
  await sharp({ create: { width, height, channels: 3, background: '#315c88' } })[format]().toFile(path);
  return { path, reference };
}

function inspect(source: { path: string; reference: string }, service: string): SocialImageIdentity {
  return inspectSocialImage({ project: 'fixture-project', service, localReference: source.reference, localFilePath: source.path, expectedChecksum: fileSha256(source.path) });
}

describe('owned Social media pipeline', () => {
  it.each([
    ['instagram', 1080, 1080, 'png'], ['instagram', 1080, 1080, 'jpeg'],
    ['instagram', 1080, 1440, 'png'], ['instagram', 1080, 1440, 'jpeg'],
    ['linkedin', 1200, 628, 'png'], ['linkedin', 1200, 628, 'jpeg'],
    ['linkedin', 1200, 1200, 'png'], ['linkedin', 1200, 1200, 'jpeg'],
    ['linkedin', 720, 900, 'png'], ['linkedin', 720, 900, 'jpeg'],
  ] as const)('accepts the conservative %s %sx%s %s matrix', async (service, width, height, format) => {
    const source = await image(`${service}-${width}-${height}`, width, height, format);
    const identity = inspect(source, service);
    expect(identity).toMatchObject({ contentType: format === 'jpeg' ? 'image/jpeg' : 'image/png', width, height, checksumSha256: fileSha256(source.path) });
  });

  it('accepts an owned matching absolute source and rejects traversal, symlink, and non-file sources before image decoding', async () => {
    const source = await image('owned', 1080, 1080);
    const outside = join(root, 'outside.png');
    await sharp({ create: { width: 1080, height: 1080, channels: 3, background: '#111111' } }).png().toFile(outside);
    const link = join(root, 'assets', 'link.png'); symlinkSync(outside, link);
    const directory = join(root, 'assets', 'directory.png'); mkdirSync(directory);
    const base = { project: 'fixture-project', service: 'instagram', expectedChecksum: fileSha256(source.path) };
    expect(() => inspectSocialImage({ ...base, localReference: source.path, localFilePath: source.path })).not.toThrow();
    expect(() => inspectSocialImage({ ...base, localReference: '../outside.png', localFilePath: outside })).toThrow('owned by the active asset root');
    expect(() => inspectSocialImage({ ...base, localReference: 'assets/link.png', localFilePath: link })).toThrow('symbolic link');
    expect(() => inspectSocialImage({ ...base, localReference: 'assets/directory.png', localFilePath: directory })).toThrow('regular file');
  });

  it('rejects wrong geometry, WebP, corrupt, animated, oversized, and excessive-pixel inputs', async () => {
    const wrong = await image('wrong', 1000, 1000);
    expect(() => inspect(wrong, 'instagram')).toThrow('geometry');
    const webp = await image('webp', 1080, 1080, 'webp');
    expect(() => inspect(webp, 'instagram')).toThrow('Only static PNG and JPEG');
    const corrupt = { reference: 'assets/corrupt.png', path: join(root, 'assets', 'corrupt.png') }; writeFileSync(corrupt.path, 'not-image');
    expect(() => inspect(corrupt, 'instagram')).toThrow('Unable to decode');
    const animated = { reference: 'assets/animated.gif', path: join(root, 'assets', 'animated.gif') };
    writeFileSync(animated.path, Buffer.from('47494638396101000100800000000000ffffff21f90400000000002c000000000100010000020244010021f90400000000002c00000000010001000002024401003b', 'hex'));
    expect(() => inspect(animated, 'instagram')).toThrow();
    const animatedPng = { reference: 'assets/animated.png', path: join(root, 'assets', 'animated.png') };
    writeFileSync(animatedPng.path, createSyntheticApng1080Square());
    expect(() => inspect(animatedPng, 'instagram')).toThrow('animated images are not supported');
    const oversized = { reference: 'assets/oversized.png', path: join(root, 'assets', 'oversized.png') };
    writeFileSync(oversized.path, Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(() => inspect(oversized, 'instagram')).toThrow('5 MiB');
    const excessive = await image('excessive', 10001, 10001, 'png');
    expect(() => inspect(excessive, 'instagram')).toThrow();
  }, 60_000);

});
