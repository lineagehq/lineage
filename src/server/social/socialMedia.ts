import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { repoRoot } from '../assetCore';
import { readStaticImageMetadataFromBytes } from '../staticImageMetadata';
import { bufferChannelCapability } from '../adapters/buffer/bufferCapabilities';

export interface SocialImageIdentity {
  checksumSha256: string;
  contentType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  sizeBytes: number;
  renditionSha256: string;
}

class SocialMediaError extends Error {
  constructor(message: string, public code = 'media_preflight_failed') { super(message); }
}

function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function readOwnedBytes(reference: string, expectedPath: string): { bytes: Buffer; path: string } {
  if (!reference || (!isAbsolute(reference) && reference.split(/[\\/]/).includes('..'))) throw new SocialMediaError('Source path must be owned by the active asset root');
  const root = resolve(repoRoot);
  const candidates = isAbsolute(reference) ? [resolve(reference)] : [resolve(root, reference), resolve(root, '.asset-scratch', reference)];
  const candidate = candidates.find(path => path === resolve(expectedPath));
  if (!candidate || !inside(root, candidate)) throw new SocialMediaError('Source path escapes the active asset root');
  try {
    let cursor = root;
    for (const segment of relative(root, candidate).split(sep)) {
      cursor = join(cursor, segment);
      const info = lstatSync(cursor);
      if (info.isSymbolicLink()) throw new SocialMediaError('Source path contains a symbolic link');
    }
  } catch (error) {
    if (error instanceof SocialMediaError) throw error;
    throw new SocialMediaError('Source path is unavailable');
  }
  let fd: number;
  try { fd = openSync(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); }
  catch { throw new SocialMediaError('Source path is unavailable'); }
  try {
    const descriptor = fstatSync(fd);
    if (!descriptor.isFile()) throw new SocialMediaError('Source path is not a regular file');
    if (descriptor.size > 5 * 1024 * 1024) throw new SocialMediaError('Source image exceeds the local 5 MiB safety limit');
    const realRoot = realpathSync(root);
    const realCandidate = realpathSync(candidate);
    if (!inside(realRoot, realCandidate)) throw new SocialMediaError('Source path escapes the active asset root');
    const pathname = statSync(candidate);
    if (pathname.dev !== descriptor.dev || pathname.ino !== descriptor.ino) throw new SocialMediaError('Source path changed during validation');
    return { bytes: readFileSync(fd), path: candidate };
  } finally { closeSync(fd); }
}

function sha256(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

export function inspectSocialImage(input: { project: string; service: string; localReference: string; localFilePath: string; expectedChecksum: string }): SocialImageIdentity {
  const { bytes } = readOwnedBytes(input.localReference, input.localFilePath);
  if (bytes.length > 5 * 1024 * 1024) throw new SocialMediaError('Source image exceeds the local 5 MiB safety limit');
  const checksumSha256 = sha256(bytes);
  if (checksumSha256 !== input.expectedChecksum) throw new SocialMediaError('Source image checksum changed', 'media_checksum_mismatch');
  const metadata = readStaticImageMetadataFromBytes(bytes);
  if (metadata.contentType !== 'image/png' && metadata.contentType !== 'image/jpeg') throw new SocialMediaError('Only static PNG and JPEG images are supported');
  const capability = bufferChannelCapability(input.service);
  if (!capability.supported || !capability.image) throw new SocialMediaError('Channel does not support a single image');
  if (!capability.image.geometries.some(value => value.width === metadata.width && value.height === metadata.height)) throw new SocialMediaError('Image geometry is unsupported for this channel');
  const identity = { checksumSha256, contentType: metadata.contentType, width: metadata.width, height: metadata.height, sizeBytes: bytes.length } as const;
  return { ...identity, renditionSha256: createHash('sha256').update(JSON.stringify({ project: input.project, ...identity })).digest('hex') };
}
