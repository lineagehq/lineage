import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, writeSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const maxBootstrapBytes = 64 * 1024;

function tokenMatches(actual, expected) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function isExactLoopbackServiceOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const loopback = hostname === '127.0.0.1' || hostname === '[::1]' || hostname === 'localhost' || hostname.endsWith('.localhost');
    return parsed.protocol === 'http:' && parsed.origin === value && parsed.pathname === '/' && !parsed.search && !parsed.hash
      && !parsed.username && !parsed.password && Boolean(parsed.port) && loopback;
  } catch {
    return false;
  }
}

export async function readOneBootstrap(fd = 3) {
  const stream = createReadStream(null, { fd, autoClose: false });
  let body = '';
  for await (const chunk of stream) {
    body += chunk.toString('utf8');
    if (body.length > maxBootstrapBytes) throw new Error('bootstrap exceeds 64 KiB');
  }
  const lines = body.split('\n').filter(line => line.trim() !== '');
  if (lines.length !== 1) throw new Error('bootstrap must be supplied exactly once');
  const payload = JSON.parse(lines[0]);
  if (!payload || typeof payload !== 'object' || Object.keys(payload).sort().join(',') !== 'bootstrap,controlCredential,idleTimeoutMs,profileId') {
    throw new Error('invalid private bootstrap envelope');
  }
  const bootstrap = payload.bootstrap;
  const bootstrapKeys = bootstrap && typeof bootstrap === 'object' ? Object.keys(bootstrap).sort().join(',') : '';
  if (bootstrapKeys !== 'bootstrapCredential,expiresAt,pluginId,processId,sessionId,type'
    || bootstrap.type !== 'bootstrap'
    || ![bootstrap.pluginId, bootstrap.processId, bootstrap.sessionId].every(value => typeof value === 'string' && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value) && value.length <= 128)
    || typeof bootstrap.bootstrapCredential !== 'string'
    || !/^[A-Za-z0-9_-]{16,256}$/.test(bootstrap.bootstrapCredential)
    || !Number.isInteger(bootstrap.expiresAt)
    || bootstrap.expiresAt < 0) {
    throw new Error('bootstrap failed Phase 1 BootstrapEnvelope validation');
  }
  if (payload.bootstrap.expiresAt <= Date.now()) throw new Error('bootstrap expired');
  if (typeof payload.profileId !== 'string' || !payload.profileId || typeof payload.controlCredential !== 'string' || payload.controlCredential.length < 16) {
    throw new Error('invalid private bootstrap binding');
  }
  if (!Number.isInteger(payload.idleTimeoutMs) || payload.idleTimeoutMs < 25 || payload.idleTimeoutMs > 300_000) {
    throw new Error('invalid idle timeout');
  }
  return payload;
}

export async function runReferenceHost({ bootstrapFd = 3 } = {}) {
  const payload = await readOneBootstrap(bootstrapFd);
  // Consuming the inherited stream is the only bootstrap exchange. The bootstrap credential is never used as control authority.
  const { bootstrap, controlCredential, idleTimeoutMs, profileId } = payload;
  let idleTimer;
  let closing = false;
  let processAuthority;
  let terminalObservation;
  const runEditJourney = async authority => {
    if (!authority.serverOrigin) return;
    const binding = authority.binding;
    const wireBinding = { pluginId: binding.pluginId, processId: binding.processId, sessionId: binding.sessionId, origin: binding.origin, source: 'process' };
    const protocol = async body => {
      const response = await fetch(`${authority.serverOrigin}/api/node-editor-plugins/sessions/${binding.sessionId}/protocol`, {
        method: 'POST', headers: { authorization: `Bearer ${authority.processCapability}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`protocol request failed (${response.status})`);
      return response.json();
    };
    const read = await protocol({ type: 'document.read', requestId: 'reference-read', binding: wireBinding });
    if (read.type !== 'document.result') throw new Error(`document.read failed: ${read.code || read.type}`);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const checksumSha256 = createHash('sha256').update(bytes).digest('hex');
    const proposalId = `proposal-${binding.sessionId.slice(-24)}`;
    const created = await protocol({
      type: 'proposal.create', requestId: 'reference-proposal', binding: wireBinding,
      header: { proposalId, idempotencyKey: `idem-${binding.sessionId.slice(-24)}`, baseRevision: read.revision, baseChecksum: read.checksum },
      document: { baseAttemptId: read.document.baseAttemptId, mimeType: 'image/png', sizeBytes: bytes.length, checksumSha256, editSummary: 'Reference process streamed edit' },
    });
    if (created.type !== 'proposal.result' || created.status !== 'pending') throw new Error(`proposal.create failed: ${created.code || created.type}`);
    const upload = await fetch(`${authority.serverOrigin}/api/node-editor-plugins/sessions/${binding.sessionId}/proposals/${proposalId}/content`, {
      method: 'PUT', headers: { authorization: `Bearer ${authority.processCapability}`, 'content-type': 'application/octet-stream' }, body: bytes,
    });
    if (!upload.ok) throw new Error(`proposal upload failed (${upload.status})`);
    const result = await upload.json();
    if (!['accepted', 'stale'].includes(result?.outcome?.outcome)) throw new Error('terminal outcome was not observed');
    terminalObservation = result.outcome;
  };
  const server = createServer((request, response) => {
    const presented = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
    if (!tokenMatches(presented, controlCredential)) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end('{"error":"authority_denied"}\n');
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(`${JSON.stringify({ ok: true, pluginId: bootstrap.pluginId, profileId, terminalObservation })}\n`);
      return;
    }
    if (request.method === 'POST' && request.url === '/authority') {
      if (processAuthority) {
        response.writeHead(409, { 'content-type': 'application/json' });
        response.end('{"error":"capability_replayed"}\n');
        return;
      }
      let body = '';
      request.on('data', chunk => {
        body += chunk.toString('utf8');
        if (body.length > 32 * 1024) request.destroy(new Error('authority payload exceeds 32 KiB'));
      });
      request.on('end', () => {
        try {
          const authority = JSON.parse(body);
          const binding = authority?.binding;
          const authorityKeys = authority && typeof authority === 'object' ? Object.keys(authority).sort().join(',') : '';
          if (!['binding,expiresAt,processCapability', 'binding,expiresAt,processCapability,serverOrigin'].includes(authorityKeys)
            || typeof authority.processCapability !== 'string' || authority.processCapability.length < 16
            || binding?.profileId !== profileId || binding?.pluginId !== bootstrap.pluginId
            || binding?.processId !== bootstrap.processId || binding?.sessionId !== bootstrap.sessionId
            || !Number.isInteger(authority.expiresAt) || authority.expiresAt <= Date.now()
            || (authority.serverOrigin !== undefined && !isExactLoopbackServiceOrigin(authority.serverOrigin))
            || binding?.source !== 'process') throw new Error('invalid process authority binding');
          processAuthority = authority;
          response.writeHead(204);
          response.end();
          void new Promise(resolve => setTimeout(resolve, 50)).then(() => runEditJourney(authority))
            .catch(error => { terminalObservation = { outcome: 'error', message: error.message }; });
        } catch {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end('{"error":"invalid_authority"}\n');
        }
      });
      return;
    }
    if (request.method === 'POST' && request.url === '/shutdown') {
      closing = true;
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end('{"ok":true}\n');
      setImmediate(() => server.close());
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"not_found"}\n');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('reference host did not bind a TCP port');
  const origin = `http://127.0.0.1:${address.port}`;
  writeSync(bootstrapFd, `${JSON.stringify({ type: 'host.ready', origin, pluginId: bootstrap.pluginId, profileId })}\n`);
  idleTimer = setTimeout(() => {
    closing = true;
    server.close();
  }, idleTimeoutMs);
  idleTimer.unref();
  await new Promise((resolve, reject) => {
    server.once('close', resolve);
    server.once('error', reject);
  });
  if (idleTimer) clearTimeout(idleTimer);
  return { reason: closing ? 'shutdown' : 'closed' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReferenceHost().then(() => process.exit(0)).catch(error => {
    process.stderr.write(`reference host failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
