#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const allowedMaturity = new Set(['Available', 'Preview', 'Planned']);
const requiredDocs = [
  'index.md',
  'start-here/what-is-lineage.md',
  'start-here/installation-first-run.md',
  'start-here/first-workspace.md',
  'start-here/example-projects.md',
  'concepts/projects-workspaces-assets.md',
  'concepts/branches-vs-rerolls.md',
  'concepts/attempts-current-version.md',
  'concepts/selections-next-variations.md',
  'concepts/agent-claims-handoffs.md',
  'workflows/create-grow-lineage.md',
  'workflows/generate-import-variations.md',
  'workflows/review-approve-assets.md',
  'workflows/restore-earlier-attempt.md',
  'workflows/back-up-approved-assets.md',
  'workflows/content-batches.md',
  'workflows/continue-new-agent-session.md',
  'integrations/index.md',
  'integrations/cloud-storage.md',
  'integrations/social-scheduling.md',
  'integrations/image-generation.md',
  'operations/local-first-data.md',
  'operations/channels.md',
  'operations/profiles-database-identity.md',
  'operations/backup-recovery.md',
  'operations/troubleshooting.md',
  'reference/interface-guide.md',
  'reference/settings.md',
  'reference/cli.md',
  'reference/terminology.md',
  'reference/release-notes.md',
];

function scalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
}

export function parseFrontmatter(text, file = '<document>') {
  if (!text.startsWith('---\n')) throw new Error(`${file} is missing frontmatter`);
  const end = text.indexOf('\n---', 4);
  if (end < 0) throw new Error(`${file} has unterminated frontmatter`);
  const lines = text.slice(4, end).split('\n');
  const data = {};
  let listKey = null;
  for (const line of lines) {
    const list = line.match(/^\s+-\s+(.+)$/);
    if (list && listKey) {
      data[listKey].push(scalar(list[1]));
      continue;
    }
    const pair = line.match(/^([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/);
    if (!pair) {
      if (line.trim()) throw new Error(`${file} has unsupported frontmatter line: ${line}`);
      continue;
    }
    const [, key, raw = ''] = pair;
    if (raw.trim()) {
      data[key] = scalar(raw);
      listKey = null;
    } else {
      data[key] = [];
      listKey = key;
    }
  }
  return { body: text.slice(end + 4).trim(), data };
}

export function loadAdapterCatalog(rootDir = root) {
  const source = readFileSync(join(rootDir, 'src', 'shared', 'adapterCatalog.ts'), 'utf8');
  const match = source.match(/const adapterCatalogJson = `([\s\S]*?)`;/);
  if (!match) throw new Error('src/shared/adapterCatalog.ts is missing adapterCatalogJson');
  return JSON.parse(match[1]);
}

function markdownFiles(directory, results = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) markdownFiles(path, results);
    else if (extname(path) === '.md' || extname(path) === '.mdx') results.push(path);
  }
  return results;
}

function headingIds(text) {
  const ids = new Set();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    ids.add(match[1]
      .toLowerCase()
      .replace(/[`*_~]/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-'));
  }
  return ids;
}

function resolveDocTarget(sourceFile, rawTarget, docsRoot) {
  const [pathPart, anchor] = rawTarget.split('#');
  let targetFile = sourceFile;
  if (pathPart) {
    const clean = pathPart.startsWith('/docs/')
      ? pathPart.slice('/docs/'.length)
      : pathPart.startsWith('/') ? pathPart.slice(1) : pathPart;
    const base = pathPart.startsWith('/') ? join(docsRoot, clean) : resolve(dirname(sourceFile), clean);
    const candidates = extname(base) ? [base] : [`${base}.md`, join(base, 'index.md')];
    targetFile = candidates.find(existsSync);
  }
  return { anchor, targetFile };
}

function validateLinks(file, text, docsRoot, errors) {
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim();
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    const resolved = resolveDocTarget(file, target, docsRoot);
    if (!resolved.targetFile || !existsSync(resolved.targetFile)) {
      errors.push(`${relative(docsRoot, file)} links to missing ${target}`);
      continue;
    }
    if (resolved.anchor && !headingIds(readFileSync(resolved.targetFile, 'utf8')).has(resolved.anchor)) {
      errors.push(`${relative(docsRoot, file)} links to missing anchor ${target}`);
    }
  }
}

export function validateDocumentation({
  rootDir = root,
  required = requiredDocs,
  releaseVersion = process.env.LINEAGE_DOCS_RELEASE_VERSION,
} = {}) {
  const errors = [];
  const docsRoot = join(rootDir, 'docs-site', 'src', 'content', 'docs');
  if (!existsSync(docsRoot)) return { errors: ['docs-site/src/content/docs is missing'], files: 0 };
  const files = markdownFiles(docsRoot);
  if (files.some(file => file.endsWith('.mdx'))) errors.push('MDX is not allowed in the initial documentation hub');
  for (const requiredFile of required) {
    if (!existsSync(join(docsRoot, requiredFile))) errors.push(`Missing navigation page: ${requiredFile}`);
  }

  const catalog = loadAdapterCatalog(rootDir);
  const capabilityPages = new Map();
  for (const file of files.filter(path => path.endsWith('.md'))) {
    const relativeFile = relative(docsRoot, file);
    let parsed;
    try {
      parsed = parseFrontmatter(readFileSync(file, 'utf8'), relativeFile);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (typeof parsed.data.title !== 'string' || !parsed.data.title.trim()) errors.push(`${relativeFile} is missing title`);
    if (typeof parsed.data.description !== 'string' || !parsed.data.description.trim()) errors.push(`${relativeFile} is missing description`);
    if (parsed.data.maturity && !allowedMaturity.has(parsed.data.maturity)) errors.push(`${relativeFile} has unknown maturity ${parsed.data.maturity}`);
    if (parsed.data.capability) capabilityPages.set(parsed.data.capability, { ...parsed, file, relativeFile });
    validateLinks(file, parsed.body, docsRoot, errors);
  }

  for (const entry of catalog) {
    const page = capabilityPages.get(entry.capabilityId);
    if (!page) {
      errors.push(`Missing capability page for ${entry.capabilityId}`);
      continue;
    }
    if (page.relativeFile !== `${entry.docsSlug}.md`) errors.push(`${entry.capabilityId} docsSlug does not match catalog`);
    if (page.data.maturity !== entry.maturity) errors.push(`${entry.capabilityId} maturity does not match catalog`);
    if (!Array.isArray(page.data.providerIds) || !page.data.providerIds.includes(entry.providerId)) {
      errors.push(`${entry.capabilityId} omits provider id ${entry.providerId}`);
    }
    if (!Array.isArray(page.data.currentProviders) || !page.data.currentProviders.includes(entry.providerLabel)) {
      errors.push(`${entry.capabilityId} omits provider label ${entry.providerLabel}`);
    }
    if (page.data.liveBehavior !== entry.liveBehavior) errors.push(`${entry.capabilityId} liveBehavior does not match catalog`);
  }

  const overviewPath = join(docsRoot, 'integrations', 'index.md');
  if (existsSync(overviewPath)) {
    const overview = parseFrontmatter(readFileSync(overviewPath, 'utf8'), 'integrations/index.md').data;
    for (const entry of catalog) {
      if (!Array.isArray(overview.providerIds) || !overview.providerIds.includes(entry.providerId)) {
        errors.push(`Integration overview omits ${entry.providerId}`);
      }
    }
  }

  const reviewPath = join(rootDir, 'docs-site', 'docs-review.json');
  if (!existsSync(reviewPath)) {
    errors.push('docs-site/docs-review.json is missing');
  } else {
    try {
      const review = JSON.parse(readFileSync(reviewPath, 'utf8'));
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(review.reviewedFor || '')) errors.push('docs review has invalid reviewedFor');
      if (!['updated', 'no-changes'].includes(review.result)) errors.push('docs review has invalid result');
      if (!Array.isArray(review.areas) || review.areas.length === 0) errors.push('docs review has no reviewed areas');
      if (releaseVersion && review.reviewedFor !== releaseVersion) {
        errors.push(`docs review ${review.reviewedFor} does not match required release ${releaseVersion}`);
      }
    } catch {
      errors.push('docs-site/docs-review.json is invalid JSON');
    }
  }
  return { errors, files: files.length };
}

function run() {
  const result = validateDocumentation();
  if (result.errors.length > 0) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`documentation validation clean (${result.files} Markdown pages)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
