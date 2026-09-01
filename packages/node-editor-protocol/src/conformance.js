import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { negotiateProtocol, ProtocolError, validatorsByExport } from './index.js';

const fixtureUrls = {
  positive: new URL('../fixtures/positive.json', import.meta.url),
  negative: new URL('../fixtures/negative.json', import.meta.url)
};

/** @typedef {{ name: string, validator: string, expectedCode?: string, value: Record<string, unknown> }} Fixture */

/** @returns {Promise<{ positive: Fixture[], negative: Fixture[] }>} */
export async function loadCanonicalFixtures() {
  const [positive, negative] = await Promise.all([
    readFile(fixtureUrls.positive, 'utf8'),
    readFile(fixtureUrls.negative, 'utf8')
  ]);
  return { positive: JSON.parse(positive), negative: JSON.parse(negative) };
}

/** @param {string} scenario @param {import('../generated/protocol.js').PluginManifest} manifest */
async function runFakeHostScenario(scenario, manifest) {
  const { FakeNodeEditorHost } = await import('./fake-host.js');
  let time = 100;
  const scenarioManifest = structuredClone(manifest);
  if (scenario.startsWith('scope-')) {
    scenarioManifest.nodeEditors[0].requestedCapabilities = ['document.read'];
    scenarioManifest.protocol[0].features = ['document-read'];
    scenarioManifest.protocol[0].requiredFeatures = ['document-read'];
  }
  const limits = scenario === 'resource' ? { maxDocumentBytes: 20 } : undefined;
  const host = new FakeNodeEditorHost({ document: {}, now: () => time, limits });
  const support = scenario.startsWith('scope-')
    ? [{ major: 1, minMinor: 0, maxMinor: 2, features: ['document-read'], requiredFeatures: ['document-read'] }]
    : [{ major: 1, minMinor: 0, maxMinor: 2, features: ['document-read', 'save-proposal', 'proposal-status', 'proposal-cancel', 'terminal-close'], requiredFeatures: [] }];
  host.prepare(scenarioManifest, support);
  const bootstrap = host.issueBootstrap();
  const authority = host.exchangeBootstrap({ credential: bootstrap.bootstrapCredential, source: 'process' });
  const binding = structuredClone(authority.processBinding);
  /** @param {import('../generated/protocol.js').ProxyRequest} request @param {string} [processCapability] */
  const proxy = (request, processCapability = authority.processCapability) => host.proxy({ capability: processCapability, request });
  if (scenario === 'scope-create') return proxy({ type: 'proposal.create', requestId: 'scope-create-1', binding, header: { proposalId: 'proposal-1', idempotencyKey: 'key-1', baseRevision: 1, baseChecksum: 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=' }, document: {} });
  if (scenario === 'scope-status') return proxy({ type: 'proposal.status', requestId: 'scope-status-1', binding, proposalId: 'proposal-1' });
  if (scenario === 'scope-cancel') return proxy({ type: 'proposal.cancel', requestId: 'scope-cancel-1', binding, proposalId: 'proposal-1' });
  if (scenario === 'scope-close') return proxy({ type: 'session.close', requestId: 'scope-close-1', binding });
  if (scenario.endsWith('-binding')) {
    const field = scenario.replace('-binding', '');
    if (field === 'plugin') binding.pluginId = 'wrong.plugin';
    else if (field === 'process') binding.processId = 'wrong-process';
    else if (field === 'session') binding.sessionId = 'wrong-session';
    else if (field === 'origin') binding.origin = 'https://wrong.test.invalid';
    else if (field === 'source') binding.source = 'wrong-source';
    return proxy({ type: 'document.read', requestId: 'binding-1', binding });
  }
  if (scenario === 'replay') return host.exchangeBootstrap({ credential: bootstrap.bootstrapCredential, source: 'process' });
  if (scenario === 'expiry') {
    time = 20_000;
    return proxy({ type: 'document.read', requestId: 'expired-1', binding });
  }
  if (scenario === 'revocation') {
    host.revokeProcessCapability();
    return proxy({ type: 'document.read', requestId: 'revoked-1', binding });
  }
  if (scenario === 'duplicate-request') {
    proxy({ type: 'document.read', requestId: 'duplicate-request-1', binding });
    return proxy({ type: 'document.read', requestId: 'duplicate-request-1', binding });
  }
  const read = proxy({ type: 'document.read', requestId: 'read-1', binding });
  if (read.type !== 'document.result') throw new Error(`expected document.result, received ${read.type}`);
  const header = { proposalId: 'proposal-1', idempotencyKey: 'key-1', baseRevision: read.revision, baseChecksum: read.checksum };
  if (scenario === 'resource') return proxy({ type: 'proposal.create', requestId: 'resource-1', binding, header, document: { oversized: 'this document exceeds twenty bytes' } });
  if (scenario === 'stale') return proxy({ type: 'proposal.create', requestId: 'stale-1', binding, header: { ...header, baseRevision: read.revision + 1 }, document: {} });
  const proposal = proxy({ type: 'proposal.create', requestId: 'proposal-1', binding, header, document: { edited: true } });
  if (proposal.type !== 'proposal.result') throw new Error(`expected proposal.result, received ${proposal.type}`);
  if (scenario === 'embedded-redaction') {
    const embedded = `${bootstrap.bootstrapCredential}/${authority.processCapability}/${authority.uiLaunchCredential}/${authority.processCapability}`;
    const request = { type: /** @type {const} */ ('proposal.create'), requestId: 'embedded-redaction-1', binding, header: { ...header, proposalId: 'proposal-2', idempotencyKey: 'key-2' }, document: { nested: [{ value: `https://trace.invalid/${embedded}` }] } };
    proxy(request);
    const transcript = JSON.stringify(host.getRedactedTrace());
    for (const secret of [bootstrap.bootstrapCredential, authority.processCapability, authority.uiLaunchCredential]) {
      if (transcript.includes(secret)) throw new Error('issued credential leaked into redacted trace');
      if (!request.document.nested[0].value.includes(secret)) throw new Error('redaction mutated the source request');
    }
    return proxy(request);
  }
  if (scenario === 'duplicate') return proxy({ type: 'proposal.create', requestId: 'proposal-2', binding, header, document: {} });
  if (scenario === 'proposal-terminal') {
    host.acceptProposal(proposal.proposalId);
    return proxy({ type: 'proposal.cancel', requestId: 'cancel-1', binding, proposalId: proposal.proposalId });
  }
  if (scenario === 'session-terminal') {
    proxy({ type: 'session.close', requestId: 'close-1', binding });
    return proxy({ type: 'document.read', requestId: 'read-after-close', binding });
  }
  if (scenario === 'host-accept-after-close') {
    proxy({ type: 'session.close', requestId: 'close-before-accept-1', binding });
    return host.acceptProposal(proposal.proposalId);
  }
  throw new Error(`unknown fake host scenario: ${scenario}`);
}

/** @param {{ throwOnFailure?: boolean }} [options] */
export async function runConformance(options = {}) {
  const fixtures = await loadCanonicalFixtures();
  const failures = [];
  let passed = 0;
  for (const fixture of fixtures.positive) {
    try {
      if (fixture.validator === 'negotiation') negotiateProtocol(fixture.value.host, fixture.value.plugin);
      else validatorsByExport[fixture.validator](fixture.value);
      passed += 1;
    } catch (error) {
      failures.push(`${fixture.name}: expected acceptance, received ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const fixture of fixtures.negative) {
    try {
      if (fixture.validator === 'negotiation') negotiateProtocol(fixture.value.host, fixture.value.plugin);
      else if (fixture.validator === 'manifestOrigin') {
        const manifestFixture = fixtures.positive.find(candidate => candidate.validator === 'manifest');
        if (!manifestFixture) throw new Error('canonical manifest fixture is missing');
        const manifest = /** @type {import('../generated/protocol.js').PluginManifest} */ (/** @type {unknown} */ (structuredClone(manifestFixture.value)));
        manifest.nodeEditors[0].editor.origin = String(fixture.value.origin);
        validatorsByExport.manifest(manifest);
      }
      else if (fixture.validator === 'fakeHostScenario') {
        const manifestFixture = fixtures.positive.find(candidate => candidate.validator === 'manifest');
        if (!manifestFixture) throw new Error('canonical manifest fixture is missing');
        await runFakeHostScenario(
          String(fixture.value.scenario),
          /** @type {import('../generated/protocol.js').PluginManifest} */ (/** @type {unknown} */ (manifestFixture.value))
        );
      }
      else validatorsByExport[fixture.validator](fixture.value);
      failures.push(`${fixture.name}: expected rejection`);
    } catch (error) {
      if (!(error instanceof ProtocolError) || error.code !== fixture.expectedCode) {
        failures.push(`${fixture.name}: expected ${fixture.expectedCode}, received ${error instanceof ProtocolError ? error.code : error instanceof Error ? error.name : typeof error}`);
      } else {
        passed += 1;
      }
    }
  }
  const receipt = { passed, failed: failures.length, failures, fixtureFiles: Object.values(fixtureUrls).map(url => fileURLToPath(url)) };
  if (options.throwOnFailure !== false && failures.length > 0) throw new Error(`protocol conformance failed:\n${failures.join('\n')}`);
  return receipt;
}
