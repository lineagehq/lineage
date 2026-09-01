import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const hostPath = fileURLToPath(new URL('../src/host.js', import.meta.url));

function bootstrap(overrides = {}) {
  return {
    bootstrap: {
      type: 'bootstrap',
      pluginId: 'reference.editor',
      processId: 'process-reference-test',
      sessionId: 'session-reference-test',
      bootstrapCredential: 'bootstrap_reference_test_credential',
      expiresAt: Date.now() + 5_000,
    },
    profileId: 'profile-reference-test',
    controlCredential: 'control_reference_test_credential',
    idleTimeoutMs: 250,
    ...overrides,
  };
}

async function launch(payload = bootstrap()) {
  const child = spawn(process.execPath, [hostPath], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  const pipe = child.stdio[3];
  const ready = new Promise((resolveReady, reject) => {
    let output = '';
    pipe.on('data', chunk => {
      output += chunk.toString('utf8');
      const newline = output.indexOf('\n');
      if (newline >= 0) resolveReady(JSON.parse(output.slice(0, newline)));
    });
    child.once('error', reject);
  });
  pipe.end(`${JSON.stringify(payload)}\n`);
  return { child, ready: await ready };
}

test('reference host binds loopback, authenticates control, and shuts down when idle', async () => {
  const payload = bootstrap();
  const { child, ready } = await launch(payload);
  assert.match(ready.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const denied = await fetch(`${ready.origin}/health`);
  assert.equal(denied.status, 401);
  const health = await fetch(`${ready.origin}/health`, { headers: { authorization: `Bearer ${payload.controlCredential}` } });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, pluginId: 'reference.editor', profileId: 'profile-reference-test' });
  const processAuthority = {
    processCapability: 'process_capability_reference_test',
    expiresAt: Date.now() + 5_000,
    binding: { profileId: 'profile-reference-test', pluginId: 'reference.editor', contributionId: 'reference.editor', processId: payload.bootstrap.processId, sessionId: payload.bootstrap.sessionId, origin: 'https://editor.test.invalid', source: 'process' }
  };
  const authority = await fetch(`${ready.origin}/authority`, {
    body: JSON.stringify(processAuthority), headers: { authorization: `Bearer ${payload.controlCredential}`, 'content-type': 'application/json' }, method: 'POST'
  });
  assert.equal(authority.status, 204);
  const replay = await fetch(`${ready.origin}/authority`, {
    body: JSON.stringify(processAuthority), headers: { authorization: `Bearer ${payload.controlCredential}`, 'content-type': 'application/json' }, method: 'POST'
  });
  assert.equal(replay.status, 409);
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
});

test('reference host rejects bootstrap replay on the inherited descriptor', async () => {
  const payload = bootstrap({ idleTimeoutMs: 1_000 });
  const child = spawn(process.execPath, [hostPath], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  child.stdio[3].end(`${JSON.stringify(payload)}\n${JSON.stringify(payload)}\n`);
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
});

test('reference host rejects expired bootstrap before binding', async () => {
  const child = spawn(process.execPath, [hostPath], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  child.stdio[3].end(`${JSON.stringify(bootstrap({ bootstrap: { ...bootstrap().bootstrap, expiresAt: Date.now() - 1 } }))}\n`);
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
});

test('reference host rejects an edit authority not bound to its exact bootstrap process and session', async () => {
  const payload = bootstrap({ idleTimeoutMs: 1_000 });
  const { child, ready } = await launch(payload);
  const response = await fetch(`${ready.origin}/authority`, {
    method: 'POST', headers: { authorization: `Bearer ${payload.controlCredential}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      processCapability: 'process_capability_reference_test', expiresAt: Date.now() + 5_000,
      binding: { profileId: payload.profileId, pluginId: payload.bootstrap.pluginId, contributionId: 'reference.editor', processId: 'process-wrong', sessionId: payload.bootstrap.sessionId, origin: 'https://editor.test.invalid', source: 'process' },
    }),
  });
  assert.equal(response.status, 400);
  child.kill('SIGTERM');
  await once(child, 'exit');
});

test('reference host accepts exact branded localhost origins and rejects lookalike non-loopback hosts', async () => {
  for (const [serverOrigin, expectedStatus] of [['http://lineage-dev.localhost:45678', 204], ['http://lineage-dev.localhost.evil:45678', 400]]) {
    const payload = bootstrap({ idleTimeoutMs: 1_000 });
    const { child, ready } = await launch(payload);
    const response = await fetch(`${ready.origin}/authority`, {
      method: 'POST', headers: { authorization: `Bearer ${payload.controlCredential}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        processCapability: 'process_capability_reference_test', expiresAt: Date.now() + 5_000, serverOrigin,
        binding: { profileId: payload.profileId, pluginId: payload.bootstrap.pluginId, contributionId: 'reference.editor', processId: payload.bootstrap.processId, sessionId: payload.bootstrap.sessionId, origin: 'https://editor.test.invalid', source: 'process' },
      }),
    });
    assert.equal(response.status, expectedStatus);
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
});
