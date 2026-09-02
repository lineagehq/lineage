import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('editor is self-contained and activates only an exactly acknowledged bounded-retry MessageChannel', async () => {
  const html = await readFile(new URL('../editor/index.html', import.meta.url), 'utf8');
  assert.match(html, /new MessageChannel\(\)/);
  assert.match(html, /maxConnectAttempts = 20/);
  assert.match(html, /connectAttempts >= maxConnectAttempts/);
  assert.match(html, /parent\.postMessage\(\{ type: 'reference\.editor\.connect', channelBinding \}, parentOrigin/);
  assert.match(html, /message\.data\?\.type === 'lineage\.editor\.ack' && message\.data\.channelBinding === channelBinding/);
  assert.match(html, /if \(!channel/);
  assert.match(html, /reference\.editor\.dirty/);
  assert.match(html, /reference\.editor\.save[^\n]+mimeType: 'image\/png'[^\n]+payload: bytes\.buffer/);
  assert.match(html, /\[bytes\.buffer\]/);
  assert.match(html, /maximumPayloadBytes = 1024 \* 1024/);
  assert.doesNotMatch(html, /localStorage|sessionStorage|document\.cookie|launchCredential|processCapability|controlCredential/);
  assert.doesNotMatch(html, /postMessage\([^\n]+['"]\*['"]/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
});
