import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { comparePluginGuidance, inspectPluginGuidance } from './plugin-guidance.mjs';

const pluginRoot = join(dirname(dirname(fileURLToPath(import.meta.url))), 'plugins/lineage-codex-plugin');
const skillRoot = 'skills/lineage-package-operator';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'lineage-guidance-test-'));
  cpSync(join(pluginRoot, 'skills'), join(root, 'skills'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('validates safety coverage across the routed source documents', () => {
  const result = inspectPluginGuidance(pluginRoot);
  assert.deepEqual(result.failures, []);
  assert.ok(result.files.has(`${skillRoot}/references/image-generation.md`));
  assert.ok(result.files.has(`${skillRoot}/references/services-upgrades.md`));
});

test('rejects missing references and lost workflow coverage', t => {
  const root = fixture(t);
  rmSync(join(root, skillRoot, 'references/services-upgrades.md'));
  const result = inspectPluginGuidance(root);
  assert.ok(result.failures.some(message => message.includes('missing local reference')));
  assert.ok(result.failures.some(message => message.includes('missing required guidance: profile upgrade-runtime')));
});

test('an orphaned document cannot satisfy required workflow coverage', t => {
  const root = fixture(t);
  const path = join(root, skillRoot, 'SKILL.md');
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace('[Services and upgrades](references/services-upgrades.md)', 'Services and upgrades'));
  const result = inspectPluginGuidance(root);
  assert.ok(result.failures.some(message => message.includes('not reachable') && message.includes('services-upgrades.md')));
  assert.ok(result.failures.some(message => message.includes('missing required guidance: profile upgrade-runtime')));
});

test('scans supporting documents for unsafe multiline writes and stale commands', t => {
  const root = fixture(t);
  const path = join(root, skillRoot, 'references/claims.md');
  writeFileSync(path, readFileSync(path, 'utf8') + '\n```bash\n'
    + 'lineage-stable link-child \\\n  --db /tmp/example.sqlite \\\n  --confirm-write\n'
    + 'make start-local-prod\n```\n');
  const result = inspectPluginGuidance(root);
  assert.ok(result.failures.some(message => message.includes('claims.md contains a direct-database')));
  assert.ok(result.failures.some(message => message.includes('claims.md contains unsafe/stale')));
});

test('rejects references outside the packaged skill tree', t => {
  const root = fixture(t);
  const path = join(root, skillRoot, 'SKILL.md');
  writeFileSync(path, readFileSync(path, 'utf8') + '\n[External checkout](../../AGENTS.md)\n');
  assert.ok(inspectPluginGuidance(root).failures.some(message => message.includes('outside packaged skills')));
});

test('does not follow symlinked references', t => {
  const root = fixture(t);
  const path = join(root, skillRoot, 'references/services-upgrades.md');
  rmSync(path);
  symlinkSync(join(pluginRoot, skillRoot, 'references/services-upgrades.md'), path);
  assert.ok(inspectPluginGuidance(root).failures.some(message => message.includes('must not contain a symlink')));
});

test('verifies every installed skill file and rejects missing, altered, or extra files', () => {
  const { files } = inspectPluginGuidance(pluginRoot);
  const installed = new Map(files);
  assert.deepEqual(comparePluginGuidance(files, installed), []);

  const missing = `${skillRoot}/references/services-upgrades.md`;
  const altered = `${skillRoot}/references/image-generation.md`;
  const extra = `${skillRoot}/references/stale.md`;
  installed.delete(missing);
  installed.set(altered, Buffer.from('Changed provider dimensions'));
  installed.set(extra, Buffer.from('Stale operational instructions'));
  const failures = comparePluginGuidance(files, installed);
  assert.equal(failures.length, 3);
  for (const path of [missing, altered, extra]) assert.ok(failures.some(message => message.includes(path)));
});
