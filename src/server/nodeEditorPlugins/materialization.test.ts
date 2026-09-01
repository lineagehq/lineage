import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { repoRoot } from '../assetCore';
import { collectNodeEditorOrphans, materializeNodeEditorContent, releaseMaterializedNodeEditorContent } from './materialization';

const root = join(repoRoot, '.asset-scratch', 'vitest-node-editor-materialization');
afterEach(() => rmSync(root, { force: true, recursive: true }));

describe('node editor materialization', () => {
  it('creates an immutable content-addressed object and collects only unregistered objects', () => {
    mkdirSync(root, { recursive: true });
    const stagingPath = join(root, 'staged');
    writeFileSync(stagingPath, 'bytes');
    const checksum = 'a'.repeat(64);
    const object = materializeNodeEditorContent(root, { stagingPath, bytes: 5, checksumSha256: checksum, mimeType: 'image/png' });
    expect(object.relativePath).toContain(checksum);
    expect(existsSync(object.absolutePath)).toBe(true);
    expect(collectNodeEditorOrphans(root, new Set([checksum]), 1).removed).toEqual([]);
    expect(collectNodeEditorOrphans(root, new Set(), 1).removed).toEqual([]);
    releaseMaterializedNodeEditorContent(object);
    expect(collectNodeEditorOrphans(root, new Set(), 1, { minimumAgeMs: 0, now: Date.now() + 1 }).removed).toHaveLength(1);
    expect(existsSync(object.absolutePath)).toBe(false);
  });

  it('never collects an explicitly in-flight object even when the age fence has elapsed', () => {
    mkdirSync(root, { recursive: true });
    const stagingPath = join(root, 'staged');
    writeFileSync(stagingPath, 'bytes');
    const object = materializeNodeEditorContent(root, { stagingPath, bytes: 5, checksumSha256: 'c'.repeat(64), mimeType: 'image/png' }, point => {
      if (point === 'after-materialize') {
        expect(collectNodeEditorOrphans(root, new Set(), 10, { minimumAgeMs: 0, now: Date.now() + 86_400_000 }).removed).toEqual([]);
      }
    });
    releaseMaterializedNodeEditorContent(object);
    expect(collectNodeEditorOrphans(root, new Set(), 10, { minimumAgeMs: 0, now: Date.now() + 86_400_000 }).removed).toHaveLength(1);
  });

  it.each(['release', 'fault'] as const)('keeps an identical-checksum object leased when one of two owners exits by %s', exitKind => {
    mkdirSync(root, { recursive: true });
    const checksumSha256 = 'd'.repeat(64);
    const firstStagingPath = join(root, 'staged-first');
    writeFileSync(firstStagingPath, 'bytes');
    const remainingOwner = materializeNodeEditorContent(root, {
      stagingPath: firstStagingPath,
      bytes: 5,
      checksumSha256,
      mimeType: 'image/png',
    });
    const secondStagingPath = join(root, 'staged-second');
    writeFileSync(secondStagingPath, 'bytes');

    if (exitKind === 'release') {
      const exitingOwner = materializeNodeEditorContent(root, {
        stagingPath: secondStagingPath,
        bytes: 5,
        checksumSha256,
        mimeType: 'image/png',
      });
      releaseMaterializedNodeEditorContent(exitingOwner);
    } else {
      expect(() => materializeNodeEditorContent(root, {
        stagingPath: secondStagingPath,
        bytes: 5,
        checksumSha256,
        mimeType: 'image/png',
      }, point => {
        if (point === 'after-materialize') throw new Error('second owner fault');
      })).toThrow('second owner fault');
    }

    const afterAgeThreshold = Date.now() + 86_400_000;
    expect(collectNodeEditorOrphans(root, new Set(), 10, { minimumAgeMs: 0, now: afterAgeThreshold }).removed).toEqual([]);
    expect(existsSync(remainingOwner.absolutePath)).toBe(true);

    releaseMaterializedNodeEditorContent(remainingOwner);
    expect(collectNodeEditorOrphans(root, new Set(), 10, { minimumAgeMs: 0, now: afterAgeThreshold }).removed).toEqual([
      `${checksumSha256}.png`,
    ]);
    expect(existsSync(remainingOwner.absolutePath)).toBe(false);
  });

  it('does not release an incumbent identical-path owner when another invocation faults before acquisition', () => {
    mkdirSync(root, { recursive: true });
    const checksumSha256 = 'e'.repeat(64);
    const incumbentStagingPath = join(root, 'staged-incumbent');
    writeFileSync(incumbentStagingPath, 'bytes');
    const incumbent = materializeNodeEditorContent(root, {
      stagingPath: incumbentStagingPath,
      bytes: 5,
      checksumSha256,
      mimeType: 'image/png',
    });
    const faultingStagingPath = join(root, 'staged-faulting');
    writeFileSync(faultingStagingPath, 'bytes');

    expect(() => materializeNodeEditorContent(root, {
      stagingPath: faultingStagingPath,
      bytes: 5,
      checksumSha256,
      mimeType: 'image/png',
    }, point => {
      if (point === 'before-materialize') throw new Error('fault before acquisition');
    })).toThrow('fault before acquisition');

    const afterAgeThreshold = Date.now() + 86_400_000;
    expect(collectNodeEditorOrphans(root, new Set(), 10, { minimumAgeMs: 0, now: afterAgeThreshold }).removed).toEqual([]);
    expect(existsSync(incumbent.absolutePath)).toBe(true);

    releaseMaterializedNodeEditorContent(incumbent);
    expect(collectNodeEditorOrphans(root, new Set(), 10, { minimumAgeMs: 0, now: afterAgeThreshold }).removed).toEqual([
      `${checksumSha256}.png`,
    ]);
    expect(existsSync(incumbent.absolutePath)).toBe(false);
  });

  it('fault-injects after materialization leaving an identifiable orphan', () => {
    mkdirSync(root, { recursive: true });
    const stagingPath = join(root, 'staged');
    writeFileSync(stagingPath, 'bytes');
    expect(() => materializeNodeEditorContent(root, { stagingPath, bytes: 5, checksumSha256: 'b'.repeat(64), mimeType: 'image/png' }, point => {
      if (point === 'after-materialize') throw new Error('fault');
    })).toThrow('fault');
    expect(collectNodeEditorOrphans(root, new Set(), 10, { minimumAgeMs: 0, now: Date.now() + 1 }).removed).toHaveLength(1);
  });
});
