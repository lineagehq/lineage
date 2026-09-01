#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const filesToScan = [
  'AGENTS.md',
  'CHANGELOG.md',
  'LICENSE',
  'Makefile',
  'README.md',
  'MANUAL_INSTALL_DOGFOOD.md',
  'eslint.config.js',
  'knip.json',
  'package.json',
  'package-lock.json',
  'playwright.config.ts',
  'tsconfig.build.json',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  '.github',
  'docs-site',
  'fixtures',
  'src',
  'e2e',
  'scripts',
  'plugins/lineage-codex-plugin',
  'packages/lineage-plugin-installer',
  'packages/node-editor-protocol',
  'packages/node-editor-reference-plugin',
  '.agents/plugins/marketplace.json',
];

const forbiddenNodeEditorAuthorityPatterns = [
  'src/server',
  'src/web',
  'src/cli',
  'better-sqlite3',
  'child_process',
  'node:net',
  'node:http',
  'document.cookie',
  'localStorage',
  'sessionStorage',
];

const privatePatterns = [
  ['bleep', '-that-shit'],
  ['debt', '-is-fun'],
  ['mean-weasel-growth', '-assets-production'],
  ['growth', '_ops'],
  ['Dopp', 'ler'],
  ['BUFFER', '_API_KEY'],
];

const legacyPatterns = [
  ['Asset', ' Studio'],
  ['Asset', 'Studio'],
  ['Growth Asset', ' Studio'],
  ['asset_studio', '.agent_handoff.v1'],
  ['studio', ':cli'],
  ['ASSET', '_STUDIO_'],
];

const forbidden = [...privatePatterns, ...legacyPatterns].map(parts => parts.join(''));

function walk(path, results = []) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === '.asset-scratch') continue;
      walk(join(path, entry), results);
    }
  } else {
    results.push(path);
  }
  return results;
}

const files = [];
for (const target of filesToScan) {
  const path = join(root, target);
  try {
    files.push(...await walk(path));
  } catch {
    // Missing optional paths are ignored here; package-smoke verifies build output.
  }
}

const hits = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of forbidden) {
    if (text.includes(pattern)) {
      hits.push(`${relative(root, file)} contains forbidden public-readiness pattern`);
    }
  }
}

function exportTargets(value, targets = []) {
  if (typeof value === 'string') targets.push(value);
  else if (value && typeof value === 'object') for (const nested of Object.values(value)) exportTargets(nested, targets);
  return targets;
}

function expandExportTarget(packageRoot, target) {
  if (!target.includes('*')) return [resolve(packageRoot, target)];
  const star = target.indexOf('*');
  const prefix = target.slice(0, star);
  const suffix = target.slice(star + 1);
  const slash = prefix.lastIndexOf('/');
  const searchRoot = resolve(packageRoot, slash >= 0 ? prefix.slice(0, slash) : '.');
  return walk(searchRoot).filter(file => {
    const candidate = `./${relative(packageRoot, file).split('\\').join('/')}`;
    return candidate.startsWith(prefix) && candidate.endsWith(suffix);
  });
}

function localImports(file) {
  const text = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const imports = [];
  const pattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  for (const match of text.matchAll(pattern)) imports.push(match[1] || match[2]);
  return imports;
}

function resolveLocalImport(file, specifier) {
  const candidate = resolve(dirname(file), specifier);
  const declarationCandidate = candidate.endsWith('.js') ? `${candidate.slice(0, -3)}.d.ts` : undefined;
  const candidates = extname(candidate)
    ? [candidate, declarationCandidate].filter(Boolean)
    : [candidate, `${candidate}.js`, `${candidate}.mjs`, `${candidate}.json`, `${candidate}.d.ts`, join(candidate, 'index.js')];
  const found = candidates.find(path => {
    try { return statSync(path).isFile(); } catch { return false; }
  });
  if (!found) throw new Error(`cannot resolve public local import ${specifier} from ${relative(root, file)}`);
  return found;
}

function publicImportClosure(packageRoot, packageJson) {
  const pending = exportTargets(packageJson.exports)
    .filter(target => target.startsWith('./'))
    .flatMap(target => expandExportTarget(packageRoot, target));
  const visited = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!['.js', '.mjs', '.cjs', '.ts'].includes(extname(file))) continue;
    for (const specifier of localImports(file)) pending.push(resolveLocalImport(file, specifier));
  }
  return visited;
}

for (const packagePath of ['packages/node-editor-protocol', 'packages/node-editor-reference-plugin']) {
  const packageRoot = join(root, packagePath);
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  for (const file of publicImportClosure(packageRoot, packageJson)) {
    const relativeFile = relative(root, file);
    const text = readFileSync(file, 'utf8');
    for (const pattern of forbiddenNodeEditorAuthorityPatterns) {
      if (text.includes(pattern)) hits.push(`${relativeFile} crosses the Phase 1 public authority boundary with ${pattern}`);
    }
  }
}

const referencePackageRoot = join(root, 'packages/node-editor-reference-plugin');
const referencePackageJson = JSON.parse(readFileSync(join(referencePackageRoot, 'package.json'), 'utf8'));
const declaredHost = referencePackageJson.lineage?.nodeEditorHost;
const declaredManifest = referencePackageJson.lineage?.nodeEditorManifest;
if (declaredHost !== 'src/host.js' || declaredManifest !== 'manifest.json') {
  hits.push('reference plugin must declare canonical src/host.js and manifest.json assets');
} else {
  const hostPath = join(referencePackageRoot, declaredHost);
  const publicClosure = publicImportClosure(referencePackageRoot, referencePackageJson);
  if (publicClosure.has(hostPath) || exportTargets(referencePackageJson.exports).some(target => target === `./${declaredHost}`)) {
    hits.push('reference host must not be exported or transitively imported by a public export');
  }
  const hostText = readFileSync(hostPath, 'utf8');
  const allowedHostImports = new Set(['node:crypto', 'node:fs', 'node:http', 'node:url']);
  const hostImports = [...hostText.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)].map(match => match[1]);
  for (const specifier of hostImports) {
    if (!allowedHostImports.has(specifier)) hits.push(`reference host executable imports forbidden authority ${specifier}`);
  }
  for (const pattern of ['src/server', 'src/web', 'src/cli', 'better-sqlite3', 'node:sqlite', 'child_process', 'node:net', 'document.cookie', 'localStorage', 'sessionStorage']) {
    if (hostText.includes(pattern)) hits.push(`reference host executable exceeds loopback-control authority with ${pattern}`);
  }
}

const packageInfo = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const relativePath of ['README.md', 'Makefile', 'packages/lineage-plugin-installer/README.md']) {
  const text = readFileSync(join(root, relativePath), 'utf8');
  if (/npx(?:\s+--yes)?\s+@mean-weasel\/lineage-plugin-installer(?=\s|$)/.test(text)) {
    hits.push(`${relativePath} uses an unversioned npx Lineage plugin installer command`);
  }
}
const pluginPackage = JSON.parse(readFileSync(join(root, 'plugins', 'lineage-codex-plugin', 'package.json'), 'utf8'));
const pluginManifest = JSON.parse(readFileSync(join(root, 'plugins', 'lineage-codex-plugin', '.codex-plugin', 'plugin.json'), 'utf8'));
const pluginMarketplace = JSON.parse(readFileSync(join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
if (pluginPackage.version !== packageInfo.version) hits.push('plugin package version does not match Lineage package version');
if (pluginManifest.version !== packageInfo.version || pluginManifest.lineage?.version !== packageInfo.version) {
  hits.push('plugin manifest compatibility version does not match Lineage package version');
}
if (pluginManifest.lineage?.package !== packageInfo.name) hits.push('plugin manifest package identity does not match Lineage');
const marketplaceEntry = pluginMarketplace.plugins?.find(entry => entry.name === pluginManifest.name);
if (pluginMarketplace.name !== 'lineage' || pluginMarketplace.interface?.displayName !== 'Lineage') {
  hits.push('repo plugin marketplace identity is not Lineage');
}
if (marketplaceEntry?.source?.source !== 'local' || marketplaceEntry?.source?.path !== './plugins/lineage-codex-plugin') {
  hits.push('repo plugin marketplace does not point at the checkout plugin with a root-relative local path');
}
if (marketplaceEntry?.policy?.installation !== 'INSTALLED_BY_DEFAULT'
  || marketplaceEntry?.policy?.authentication !== 'ON_INSTALL') {
  hits.push('repo plugin marketplace does not default-install with explicit authentication policy');
}
const operatorSkill = readFileSync(join(root, 'plugins', 'lineage-codex-plugin', 'skills', 'lineage-package-operator', 'SKILL.md'), 'utf8');
if (operatorSkill.split('\n').some(line => {
  const command = line.trim();
  return /^(lineage-|npm run lineage:dev)/.test(command)
    && command.includes('--db')
    && command.includes('--confirm-write');
})) hits.push('plugin operator skill contains a direct-database confirmed-write example');
for (const required of [
  'runtime doctor --json',
  'profile doctor --profile',
  'db info --profile',
  'agent heartbeat --profile',
  'agent release --profile',
  'link-child --profile',
  'profile clone --source-db',
  'profile clone-assets --source-asset-root',
  'profile repin-runtime',
  'profile upgrade-runtime',
  '--checkout-root',
  'make repin-dev',
  'make upgrade-prod',
  'lineage-stable-service',
]) {
  if (!operatorSkill.includes(required)) hits.push(`plugin operator skill is missing ${required}`);
}

if (hits.length > 0) {
  console.error(hits.join('\n'));
  process.exit(1);
}

console.log('public readiness clean');
