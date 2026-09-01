import { Readable } from 'node:stream';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { repoRoot } from '../assetCore';
import { streamProposalContent } from './contentValidation';
import { sha256, tinyPng } from './testSupport';

const scratch = join(repoRoot, '.asset-scratch', 'vitest-node-editor-content');
afterEach(() => rmSync(scratch, { force: true, recursive: true }));

describe('node editor content validation', () => {
  it('streams under a hard limit with incremental digest and PNG signature validation', async () => {
    mkdirSync(scratch, { recursive: true });
    await expect(streamProposalContent(Readable.from([tinyPng.subarray(0, 4), tinyPng.subarray(4)]), join(scratch, 'valid'), {
      proposalId: 'proposal-1', idempotencyKey: 'idem-1', baseAttemptId: 'base-1', baseChecksum: 'a'.repeat(64),
      mimeType: 'image/png', sizeBytes: tinyPng.length, checksumSha256: sha256(tinyPng),
    }, 100)).resolves.toMatchObject({ bytes: tinyPng.length, checksumSha256: sha256(tinyPng) });
  });

  it('rejects the stream before writing bytes beyond the hard limit', async () => {
    mkdirSync(scratch, { recursive: true });
    await expect(streamProposalContent(Readable.from([Buffer.alloc(20)]), join(scratch, 'large'), {
      proposalId: 'proposal-1', idempotencyKey: 'idem-1', baseAttemptId: 'base-1', baseChecksum: 'a'.repeat(64),
      mimeType: 'image/png', sizeBytes: 20, checksumSha256: sha256(Buffer.alloc(20)),
    }, 10)).rejects.toMatchObject({ code: 'resource-limit' });
  });

  it('rejects signature confusion and active SVG', async () => {
    mkdirSync(scratch, { recursive: true });
    const unsafe = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(streamProposalContent(Readable.from([Buffer.from('not png')]), join(scratch, 'fake'), {
      proposalId: 'p-1', idempotencyKey: 'i-1', baseAttemptId: 'b-1', baseChecksum: 'a'.repeat(64), mimeType: 'image/png', sizeBytes: 7, checksumSha256: sha256('not png'),
    }, 100)).rejects.toMatchObject({ code: 'mime-mismatch' });
    await expect(streamProposalContent(Readable.from([unsafe]), join(scratch, 'svg'), {
      proposalId: 'p-2', idempotencyKey: 'i-2', baseAttemptId: 'b-1', baseChecksum: 'a'.repeat(64), mimeType: 'image/svg+xml', sizeBytes: unsafe.length, checksumSha256: sha256(unsafe),
    }, 1000)).rejects.toMatchObject({ code: 'unsafe-svg' });
  });
});
