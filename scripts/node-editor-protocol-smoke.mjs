#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'lineage-node-editor-consumer-'));
const artifacts = join(temporaryRoot, 'artifacts');
const consumer = join(temporaryRoot, 'consumer');
mkdirSync(artifacts);
mkdirSync(consumer);

function run(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function pack(packagePath) {
  const output = JSON.parse(run('npm', ['pack', packagePath, '--pack-destination', artifacts, '--json']));
  if (!output[0]?.filename) throw new Error(`npm pack did not report an artifact for ${packagePath}`);
  return join(artifacts, output[0].filename);
}

try {
  const protocolTarball = pack(resolve(root, 'packages/node-editor-protocol'));
  const referenceTarball = pack(resolve(root, 'packages/node-editor-reference-plugin'));
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'clean-node-editor-consumer', private: true, type: 'module' }, null, 2));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', protocolTarball, referenceTarball, 'typescript@5.7.2'], consumer);
  writeFileSync(join(consumer, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { ProtocolError, validateManifest } from '@mean-weasel/lineage-node-editor-protocol';
import { runConformance } from '@mean-weasel/lineage-node-editor-protocol/conformance';
import { FakeNodeEditorHost } from '@mean-weasel/lineage-node-editor-protocol/fake-host';
import { referenceManifest, runReferenceFlow } from '@mean-weasel/lineage-node-editor-reference-plugin';

const conformance = await runConformance();
assert.equal(conformance.failed, 0);
const malformedOrigin = structuredClone(referenceManifest);
malformedOrigin.nodeEditors[0].editor.origin = 'https://editor.test.invalid/path';
assert.throws(() => validateManifest(malformedOrigin), error => error instanceof ProtocolError && error.code === 'invalid-wire-value');
const flow = runReferenceFlow(new FakeNodeEditorHost({ document: { nodes: [] } }));
assert.equal(flow.status.status, 'accepted');
assert.equal(flow.closed.closed, true);
assert.equal(JSON.stringify(flow.trace).includes('process_'), false);
console.log(JSON.stringify({ conformance: conformance.passed, flow: 'read-propose-status-close' }));
`);
  writeFileSync(join(consumer, 'type-consumer.ts'), `
import type { PluginManifest, ProxyRequest, ProxyResult } from '@mean-weasel/lineage-node-editor-protocol';
import { referenceManifest } from '@mean-weasel/lineage-node-editor-reference-plugin';
declare const manifest: PluginManifest;
declare const request: ProxyRequest;
declare const result: ProxyResult;
void [manifest, request, result, referenceManifest];
`);
  run(process.execPath, ['smoke.mjs'], consumer);
  run(join(consumer, 'node_modules/.bin/tsc'), ['--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'type-consumer.ts'], consumer);

  const installedReference = readFileSync(join(consumer, 'node_modules/@mean-weasel/lineage-node-editor-reference-plugin/src/index.js'), 'utf8');
  if (installedReference.includes('../node-editor-protocol') || installedReference.includes('/src/')) {
    throw new Error('reference plugin contains sibling-source resolution');
  }
  console.log('node editor protocol clean-consumer smoke passed');
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
