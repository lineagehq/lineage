import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyChangedFiles } from './ci-paths.mjs';

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptsRoot);

test('routes landing-only changes to landing CI', () => {
  assert.deepEqual(
    classifyChangedFiles(['src/web/landing/LandingPage.tsx', 'LAUNCH_MESSAGING.md']),
    { app: false, docs: false, landing: true },
  );
});

test('routes application-only changes to application CI', () => {
  assert.deepEqual(
    classifyChangedFiles(['src/server.ts', 'README.md']),
    { app: true, docs: false, landing: false },
  );
});

test('routes shared build configuration to both suites', () => {
  assert.deepEqual(
    classifyChangedFiles(['vite.config.ts', '.github/workflows/pages.yml', 'scripts/prepare-pages.mjs']),
    { app: true, docs: true, landing: true },
  );
});

test('routes mixed application and landing changes to both suites', () => {
  assert.deepEqual(
    classifyChangedFiles(['src/server.ts', 'src/web/landing/landing.css']),
    { app: true, docs: false, landing: true },
  );
});

test('routes non-pull-request events to both suites', () => {
  assert.deepEqual(
    classifyChangedFiles(['__all__']),
    { app: true, docs: true, landing: true },
  );
});

test('does not invent work for an empty change list', () => {
  assert.deepEqual(classifyChangedFiles([]), { app: false, docs: false, landing: false });
});

test('routes documentation-only changes to docs CI', () => {
  assert.deepEqual(
    classifyChangedFiles(['docs-site/src/content/docs/concepts/agent-claims-handoffs.md']),
    { app: false, docs: true, landing: false },
  );
});

test('routes provider catalog changes to app and docs CI', () => {
  assert.deepEqual(
    classifyChangedFiles(['src/shared/adapterCatalog.ts']),
    { app: true, docs: true, landing: false },
  );
});

test('aggregate and path-specific CI all prove the combined Pages artifact', () => {
  const packageInfo = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const landingJob = workflow.match(/\n\s{2}landing:[\s\S]*?(?=\n\s{2}docs:)/)?.[0] || '';
  const docsJob = workflow.match(/\n\s{2}docs:[\s\S]*?(?=\n\s{2}app:)/)?.[0] || '';
  const pagesCheck = packageInfo.scripts['pages:check'];

  assert.match(pagesCheck, /LINEAGE_DOCS_BASE=\/docs\//);
  assert.match(pagesCheck, /LINEAGE_DOCS_SITE=https:\/\/lineage\.neonwatty\.com/);
  assert.match(pagesCheck, /LINEAGE_WEB_BASE=\//);
  assert.match(pagesCheck, /npm run pages:prepare/);
  assert.match(pagesCheck, /dist\/pages\/index\.html/);
  assert.match(pagesCheck, /dist\/pages\/docs\/index\.html/);
  assert.match(packageInfo.scripts.ci, /npm run pages:check/);
  assert.match(landingJob, /npm run pages:check/);
  assert.match(docsJob, /npm run pages:check/);
});

test('public site metadata names the custom domain as canonical', () => {
  const landing = readFileSync(join(repoRoot, 'src', 'web', 'landing', 'index.html'), 'utf8');
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
  const docsConfig = readFileSync(join(repoRoot, 'docs-site', 'astro.config.mjs'), 'utf8');
  const pagesWorkflow = readFileSync(join(repoRoot, '.github', 'workflows', 'pages.yml'), 'utf8');

  assert.match(landing, /<link rel="canonical" href="https:\/\/lineage\.neonwatty\.com\/" \/>/);
  assert.match(landing, /<meta property="og:url" content="https:\/\/lineage\.neonwatty\.com\/" \/>/);
  assert.doesNotMatch(landing, /github\.io\/lineage/);
  assert.match(readme, /https:\/\/lineage\.neonwatty\.com\//);
  assert.match(docsConfig, /https:\/\/lineage\.neonwatty\.com/);
  assert.match(pagesWorkflow, /LINEAGE_DOCS_BASE: \/docs\//);
  assert.match(pagesWorkflow, /LINEAGE_DOCS_SITE: https:\/\/lineage\.neonwatty\.com/);
  assert.match(pagesWorkflow, /LINEAGE_WEB_BASE: \//);
  assert.doesNotMatch(pagesWorkflow, /steps\.pages\.outputs\.base_path/);
});
