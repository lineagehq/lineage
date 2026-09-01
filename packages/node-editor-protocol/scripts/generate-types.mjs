#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaPath = resolve(root, 'schemas/protocol.schema.json');
const outputPath = resolve(root, 'generated/protocol.d.ts');
const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
const output = await compile(schema, 'LineageNodeEditorProtocol', {
  bannerComment: '/* Generated from schemas/protocol.schema.json. Do not edit. */',
  cwd: root,
  format: true,
  style: { singleQuote: true }
});

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== output) {
    console.error('generated/protocol.d.ts is stale; run npm run generate');
    process.exit(1);
  }
  console.log('generated declarations are byte-identical');
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
  console.log('generated/protocol.d.ts updated');
}
