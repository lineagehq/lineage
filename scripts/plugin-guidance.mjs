import { readFileSync, readdirSync } from 'node:fs';
import { dirname, posix } from 'node:path';

const entrypoint = 'skills/lineage-package-operator/SKILL.md';

// Preserve the safety coverage previously checked independently by release and
// public readiness. Procedures may live in any reachable skill reference.
const requiredGuidance = [
  'lineage-stable runtime doctor --json',
  'profile doctor --profile',
  'db info --profile',
  'LINEAGE_PROD_PROFILE',
  'LINEAGE_PREVIEW_PROFILE',
  'LINEAGE_DEV_PROFILE',
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
  'Legacy-unbound access is diagnostic/read-only',
];

const forbiddenGuidance = [
  'npm install -g @mean-weasel/lineage',
  'npx @mean-weasel/lineage',
  'make start-local-prod',
  'fall back to PID/log files',
];

export function inspectPluginGuidance(pluginRoot) {
  const files = new Map();
  const failures = [];

  function walk(directory) {
    for (const entry of readdirSync(`${pluginRoot}/${directory}`, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        failures.push(`plugin guidance must not contain a symlink: ${path}`);
      } else if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        files.set(path, readFileSync(`${pluginRoot}/${path}`));
      } else {
        failures.push(`plugin guidance contains an unsupported file: ${path}`);
      }
    }
  }

  walk('skills');
  const documents = new Map([...files]
    .filter(([path]) => /\.md$/i.test(path))
    .map(([path, content]) => [path, content.toString('utf8')]));
  const links = new Map();
  for (const [path, text] of documents) {
    const targets = [];
    // Skill references use inline Markdown links. Resolve paths relative to the
    // containing document, never to the caller's checkout or installed cache.
    for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      const href = match[1];
      if (/^https?:\/\//.test(href) || href.startsWith('#')) continue;
      const target = posix.normalize(`${dirname(path)}/${href.split('#')[0]}`);
      if (href.startsWith('/') || !target.startsWith('skills/')) {
        failures.push(`${path} links outside packaged skills: ${href}`);
      } else if (!files.has(target)) {
        failures.push(`${path} has a missing local reference: ${href}`);
      } else if (documents.has(target)) {
        targets.push(target);
      }
    }
    links.set(path, targets);

    for (const forbidden of forbiddenGuidance) {
      if (text.includes(forbidden)) failures.push(`${path} contains unsafe/stale guidance: ${forbidden}`);
    }
    const commands = text.replace(/\\\r?\n\s*/g, ' ').split('\n');
    if (commands.some(line => /^(lineage-|npm run lineage:dev)/.test(line.trim())
      && line.includes('--db') && line.includes('--confirm-write'))) {
      failures.push(`${path} contains a direct-database confirmed-write example`);
    }
  }

  const reachable = new Set();
  function visit(path) {
    if (reachable.has(path) || !documents.has(path)) return;
    reachable.add(path);
    for (const target of links.get(path)) visit(target);
  }
  if (!documents.has(entrypoint)) failures.push(`plugin operator skill is missing: ${entrypoint}`);
  visit(entrypoint);
  for (const path of documents.keys()) {
    if (!reachable.has(path)) failures.push(`plugin guidance is not reachable from SKILL.md: ${path}`);
  }
  const guidance = [...reachable].map(path => documents.get(path)).join('\n');
  for (const required of requiredGuidance) {
    if (!guidance.includes(required)) failures.push(`operator skill is missing required guidance: ${required}`);
  }
  return { files, failures };
}

export function comparePluginGuidance(sourceFiles, installedFiles) {
  const failures = [];
  for (const [path, content] of sourceFiles) {
    const installed = installedFiles.get(path);
    if (!installed || !content.equals(installed)) {
      failures.push(`installed plugin guidance differs from source: ${path}`);
    }
  }
  for (const path of installedFiles.keys()) {
    if (!sourceFiles.has(path)) failures.push(`installed plugin contains unexpected guidance: ${path}`);
  }
  return failures;
}
