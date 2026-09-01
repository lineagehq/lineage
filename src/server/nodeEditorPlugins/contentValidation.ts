import { createHash } from 'node:crypto';
import { closeSync, createWriteStream, openSync, readFileSync, readSync } from 'node:fs';
import type { Readable } from 'node:stream';
import type { NodeEditorProposalDeclaration } from '../../shared/nodeEditorPluginTypes';

class NodeEditorContentError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = 'NodeEditorContentError';
  }
}

export async function streamProposalContent(
  input: Readable,
  stagingPath: string,
  declaration: NodeEditorProposalDeclaration,
  maxBytes: number,
): Promise<{ bytes: number; checksumSha256: string }> {
  const output = createWriteStream(stagingPath, { flags: 'wx', mode: 0o600 });
  const digest = createHash('sha256');
  let bytes = 0;
  try {
    for await (const value of input) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.length;
      if (bytes > maxBytes || bytes > declaration.sizeBytes) throw new NodeEditorContentError('resource-limit', 'proposal content exceeds its hard byte limit', 413);
      digest.update(chunk);
      if (!output.write(chunk)) await new Promise<void>((resolve, reject) => {
        output.once('drain', resolve);
        output.once('error', reject);
      });
    }
    await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => error ? reject(error) : resolve()));
  } catch (error) {
    output.destroy();
    throw error;
  }
  const checksumSha256 = digest.digest('hex');
  if (bytes !== declaration.sizeBytes) throw new NodeEditorContentError('size-mismatch', `expected ${declaration.sizeBytes} bytes but received ${bytes}`);
  if (checksumSha256 !== declaration.checksumSha256) throw new NodeEditorContentError('checksum-mismatch', 'proposal content checksum does not match declaration');
  validateFileContent(stagingPath, declaration.mimeType);
  return { bytes, checksumSha256 };
}

function prefix(path: string, length = 16): Buffer {
  const fd = openSync(path, 'r');
  try {
    const bytes = Buffer.alloc(length);
    const count = readSync(fd, bytes, 0, length, 0);
    return bytes.subarray(0, count);
  } finally {
    closeSync(fd);
  }
}

function validateFileContent(path: string, mimeType: NodeEditorProposalDeclaration['mimeType']): void {
  const bytes = prefix(path);
  if (mimeType === 'image/png' && !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new NodeEditorContentError('mime-mismatch', 'PNG signature is invalid');
  }
  if (mimeType === 'image/jpeg' && !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
    throw new NodeEditorContentError('mime-mismatch', 'JPEG signature is invalid');
  }
  if (mimeType === 'image/webp' && !(bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')) {
    throw new NodeEditorContentError('mime-mismatch', 'WebP signature is invalid');
  }
  if (mimeType === 'image/svg+xml') {
    const svg = readFileSync(path, 'utf8');
    if (!/^\s*<svg(?:\s|>)/i.test(svg)) throw new NodeEditorContentError('mime-mismatch', 'SVG root is invalid');
    const active = /<!doctype|<!entity|<script|<foreignObject|\son[a-z]+\s*=|\b(?:href|src)\s*=\s*["']\s*(?!#)|javascript:|data:text\/html|@import|url\s*\(\s*["']?\s*(?!#)/i;
    if (active.test(svg)) throw new NodeEditorContentError('unsafe-svg', 'SVG contains active or external content');
  }
}
