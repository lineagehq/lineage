import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runConformance } from '../src/conformance.js';
import { negotiateProtocol, ProtocolError, validateManifest } from '../src/index.js';

const positive = JSON.parse(await readFile(new URL('../fixtures/positive.json', import.meta.url), 'utf8'));
const manifest = positive.find(fixture => fixture.validator === 'manifest').value;

test('canonical fixtures pass and adversarial fixtures fail', async () => {
  const receipt = await runConformance();
  assert.equal(receipt.failed, 0);
  assert.ok(receipt.passed >= 18);
});

test('negotiation is deterministic under advertisement order permutations', () => {
  const host = [
    { major: 1, minMinor: 0, maxMinor: 4, features: ['document-read', 'terminal-close'], requiredFeatures: [] },
    { major: 2, minMinor: 0, maxMinor: 1, features: ['document-read'], requiredFeatures: [] }
  ];
  const plugin = [
    { major: 2, minMinor: 0, maxMinor: 2, features: ['document-read'], requiredFeatures: [] },
    { major: 1, minMinor: 2, maxMinor: 3, features: ['terminal-close', 'document-read'], requiredFeatures: [] }
  ];
  assert.deepEqual(negotiateProtocol(host, plugin), negotiateProtocol([...host].reverse(), [...plugin].reverse()));
  assert.deepEqual(negotiateProtocol(host, plugin), { major: 2, minor: 1, features: ['document-read'] });
});

test('manifest validates package semver independently of protocol versions', () => {
  assert.equal(validateManifest(manifest), manifest);
  assert.throws(() => validateManifest({ ...manifest, packageVersion: '01.0.0' }), ProtocolError);
});

test('editor launch origin is an exact canonical serialized HTTP(S) origin', () => {
  for (const origin of [
    'ftp://editor.test.invalid',
    'https://user@editor.test.invalid',
    'https://editor.test.invalid/path',
    'https://editor.test.invalid?mode=edit',
    'https://editor.test.invalid#editor'
  ]) {
    const candidate = structuredClone(manifest);
    candidate.nodeEditors[0].editor.origin = origin;
    assert.throws(() => validateManifest(candidate), error => error instanceof ProtocolError && error.code === 'invalid-wire-value');
  }
});
