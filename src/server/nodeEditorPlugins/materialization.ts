import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Readable } from 'node:stream';
import type { NodeEditorProposalDeclaration } from '../../shared/nodeEditorPluginTypes';
import { streamProposalContent } from './contentValidation';

export type NodeEditorFaultPoint = 'after-stage-validation' | 'before-materialize' | 'after-materialize' | 'after-begin' | 'after-second-stale-check' | 'after-asset' | 'after-demote' | 'after-attempt' | 'after-provenance' | 'after-review' | 'after-terminal' | 'before-commit';
export type NodeEditorFaultInjector = (point: NodeEditorFaultPoint) => void;

export interface StagedNodeEditorContent {
  stagingPath: string;
  bytes: number;
  checksumSha256: string;
  mimeType: NodeEditorProposalDeclaration['mimeType'];
}

export interface MaterializedNodeEditorContent extends StagedNodeEditorContent {
  absolutePath: string;
  relativePath: string;
}

const inFlightStagingPaths = new Set<string>();
const inFlightObjectPathOwners = new Map<string, number>();

function acquireObjectPath(absolutePath: string): void {
  inFlightObjectPathOwners.set(absolutePath, (inFlightObjectPathOwners.get(absolutePath) ?? 0) + 1);
}

function releaseObjectPath(absolutePath: string): void {
  const owners = inFlightObjectPathOwners.get(absolutePath);
  if (owners === undefined) return;
  if (owners === 1) inFlightObjectPathOwners.delete(absolutePath);
  else inFlightObjectPathOwners.set(absolutePath, owners - 1);
}

function roots(assetRoot: string): { staging: string; objects: string } {
  const base = join(assetRoot, '.lineage', 'node-editor');
  return { staging: join(base, 'staging'), objects: join(base, 'objects', 'sha256') };
}

export async function stageNodeEditorContent(input: Readable, assetRoot: string, declaration: NodeEditorProposalDeclaration, maxBytes: number): Promise<StagedNodeEditorContent> {
  const { staging } = roots(assetRoot);
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  const stagingPath = join(staging, `${randomUUID()}.upload`);
  inFlightStagingPaths.add(stagingPath);
  try {
    const result = await streamProposalContent(input, stagingPath, declaration, maxBytes);
    return { stagingPath, bytes: result.bytes, checksumSha256: result.checksumSha256, mimeType: declaration.mimeType };
  } catch (error) {
    inFlightStagingPaths.delete(stagingPath);
    rmSync(stagingPath, { force: true });
    throw error;
  }
}

function extension(mimeType: NodeEditorProposalDeclaration['mimeType']): string {
  return mimeType === 'image/png' ? '.png' : mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/webp' ? '.webp' : '.svg';
}

export function materializeNodeEditorContent(assetRoot: string, staged: StagedNodeEditorContent, inject?: NodeEditorFaultInjector): MaterializedNodeEditorContent {
  inject?.('after-stage-validation');
  const { objects } = roots(assetRoot);
  mkdirSync(objects, { recursive: true, mode: 0o700 });
  const absolutePath = join(objects, `${staged.checksumSha256}${extension(staged.mimeType)}`);
  let objectPathAcquired = false;
  try {
    inject?.('before-materialize');
    acquireObjectPath(absolutePath);
    objectPathAcquired = true;
    if (existsSync(absolutePath)) rmSync(staged.stagingPath, { force: true });
    else {
      try { renameSync(staged.stagingPath, absolutePath); }
      catch {
        copyFileSync(staged.stagingPath, absolutePath);
        unlinkSync(staged.stagingPath);
      }
      chmodSync(absolutePath, 0o444);
    }
    inFlightStagingPaths.delete(staged.stagingPath);
    inject?.('after-materialize');
    return { ...staged, absolutePath, relativePath: relative(assetRoot, absolutePath) };
  } catch (error) {
    inFlightStagingPaths.delete(staged.stagingPath);
    if (objectPathAcquired) releaseObjectPath(absolutePath);
    throw error;
  }
}

export function discardStagedNodeEditorContent(staged: StagedNodeEditorContent): void {
  inFlightStagingPaths.delete(staged.stagingPath);
  rmSync(staged.stagingPath, { force: true });
}

export function releaseMaterializedNodeEditorContent(content: MaterializedNodeEditorContent): void {
  releaseObjectPath(content.absolutePath);
}

export function collectNodeEditorOrphans(
  assetRoot: string,
  registeredChecksums: ReadonlySet<string>,
  limit = 25,
  options: { now?: number; minimumAgeMs?: number } = {},
): { removed: string[]; remaining: number } {
  const { objects } = roots(assetRoot);
  const { staging } = roots(assetRoot);
  const cutoff = (options.now ?? Date.now()) - (options.minimumAgeMs ?? 60_000);
  const objectOrphans = existsSync(objects) ? readdirSync(objects)
    .filter(name => /^[a-f0-9]{64}\.(?:png|jpg|webp|svg)$/.test(name))
    .map(name => ({ name, path: join(objects, name) }))
    .filter(item => !registeredChecksums.has(item.name.slice(0, 64)) && !inFlightObjectPathOwners.has(item.path) && statSync(item.path).mtimeMs <= cutoff) : [];
  const stagingOrphans = existsSync(staging) ? readdirSync(staging)
    .filter(name => /^[a-f0-9-]+\.upload$/.test(name))
    .map(name => ({ name: `staging/${name}`, path: join(staging, name) }))
    .filter(item => !inFlightStagingPaths.has(item.path) && statSync(item.path).mtimeMs <= cutoff) : [];
  const orphans = [...objectOrphans, ...stagingOrphans];
  const removed = orphans.slice(0, Math.max(0, Math.min(limit, 100)));
  for (const item of removed) unlinkSync(item.path);
  return { removed: removed.map(item => item.name), remaining: orphans.length - removed.length };
}
