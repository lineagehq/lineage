import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('reference package carries the exact canonical manifest', () => {
  const exactManifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(exactManifest.pluginId, 'reference.editor');
  assert.equal(exactManifest.packageName, '@mean-weasel/lineage-node-editor-reference-plugin');
  assert.equal(exactManifest.nodeEditors.length, 1);
  assert.equal(exactManifest.nodeEditors[0].id, 'reference.editor');
});
