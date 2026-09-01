import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NodeEditorSessionBinding, NodeEditorSessionLaunch } from '../../shared/nodeEditorPluginTypes';

export class NodeEditorAuthorityError extends Error {
  constructor(public code: string, message: string, public status = 401) {
    super(message);
    this.name = 'NodeEditorAuthorityError';
  }
}

interface AuthorityRecord {
  binding: NodeEditorSessionBinding;
  launchHash: Buffer;
  launchExpiresAt: number;
  launchUsed: boolean;
  processHash: Buffer;
  processExpiresAt: number;
  cookieHash?: Buffer;
  cookieExpiresAt?: number;
  revoked: boolean;
}

export interface CreatedNodeEditorAuthority {
  launch: NodeEditorSessionLaunch;
  processCapability: string;
  processExpiresAt: number;
  processBinding: Omit<NodeEditorSessionBinding, 'source'> & { source: 'process' };
}

function token(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function equalHash(value: string, expected?: Buffer): boolean {
  if (!expected) return false;
  const actual = hash(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class NodeEditorSessionAuthority {
  readonly #records = new Map<string, AuthorityRecord>();
  readonly #now: () => number;
  readonly #launchTtlMs: number;
  readonly #processTtlMs: number;
  readonly #cookieTtlMs: number;

  constructor(options: { now?: () => number; launchTtlMs?: number; processTtlMs?: number; cookieTtlMs?: number } = {}) {
    this.#now = options.now ?? Date.now;
    this.#launchTtlMs = options.launchTtlMs ?? 30_000;
    this.#processTtlMs = options.processTtlMs ?? 300_000;
    this.#cookieTtlMs = options.cookieTtlMs ?? 300_000;
  }

  create(input: Omit<NodeEditorSessionBinding, 'processId' | 'sessionId' | 'source'>): CreatedNodeEditorAuthority {
    const sessionId = `session-${randomBytes(12).toString('hex')}`;
    const processId = `process-${randomBytes(12).toString('hex')}`;
    const launchCredential = token(24);
    const processCapability = token(32);
    const expiresAt = this.#now() + this.#launchTtlMs;
    const binding: NodeEditorSessionBinding = { ...input, processId, sessionId, source: 'browser' };
    const processExpiresAt = this.#now() + this.#processTtlMs;
    this.#records.set(sessionId, {
      binding,
      launchHash: hash(launchCredential),
      launchExpiresAt: expiresAt,
      launchUsed: false,
      processHash: hash(processCapability),
      processExpiresAt,
      revoked: false,
    });
    return {
      launch: {
        sessionId,
        launchCredential,
        binding: { profileId: binding.profileId, pluginId: binding.pluginId, contributionId: binding.contributionId, sessionId, origin: binding.origin, source: 'browser' },
        expiresAt,
      },
      processCapability,
      processExpiresAt,
      processBinding: { ...binding, source: 'process' },
    };
  }

  exchange(input: { sessionId: string; launchCredential: string; binding: Omit<NodeEditorSessionBinding, 'processId'> }): { cookie: string; expiresAt: number } {
    const record = this.#records.get(input.sessionId);
    if (!record || record.revoked) throw new NodeEditorAuthorityError('authority-denied', 'unknown or revoked session');
    if (record.launchUsed || !equalHash(input.launchCredential, record.launchHash)) throw new NodeEditorAuthorityError('capability-replayed', 'launch credential is invalid or already consumed');
    if (this.#now() > record.launchExpiresAt) throw new NodeEditorAuthorityError('capability-expired', 'launch credential expired');
    const expected = record.binding;
    if (input.binding.sessionId !== expected.sessionId) throw new NodeEditorAuthorityError('session-binding-mismatch', 'launch session binding mismatch');
    if (input.binding.profileId !== expected.profileId) throw new NodeEditorAuthorityError('profile-binding-mismatch', 'launch profile binding mismatch');
    if (input.binding.pluginId !== expected.pluginId || input.binding.contributionId !== expected.contributionId) throw new NodeEditorAuthorityError('plugin-binding-mismatch', 'launch plugin binding mismatch');
    if (input.binding.origin !== expected.origin) throw new NodeEditorAuthorityError('origin-binding-mismatch', 'launch origin binding mismatch');
    if (input.binding.source !== expected.source) throw new NodeEditorAuthorityError('source-binding-mismatch', 'launch source binding mismatch');
    const cookie = token(32);
    record.launchUsed = true;
    record.cookieHash = hash(cookie);
    record.cookieExpiresAt = this.#now() + this.#cookieTtlMs;
    return { cookie, expiresAt: record.cookieExpiresAt };
  }

  authorizeCookie(sessionId: string, cookie: string, origin: string): NodeEditorSessionBinding {
    const record = this.#records.get(sessionId);
    if (!record || record.revoked || !equalHash(cookie, record.cookieHash)) throw new NodeEditorAuthorityError('authority-denied', 'session cookie is invalid');
    if (!record.cookieExpiresAt || this.#now() >= record.cookieExpiresAt) throw new NodeEditorAuthorityError('capability-expired', 'session cookie expired');
    if (origin !== record.binding.origin) throw new NodeEditorAuthorityError('origin-binding-mismatch', 'session cookie origin mismatch');
    return record.binding;
  }

  authorizeProcess(sessionId: string, capability: string, binding: CreatedNodeEditorAuthority['processBinding']): void {
    const record = this.#records.get(sessionId);
    if (!record || record.revoked || !equalHash(capability, record.processHash)) throw new NodeEditorAuthorityError('authority-denied', 'process capability is invalid');
    if (this.#now() >= record.processExpiresAt) throw new NodeEditorAuthorityError('capability-expired', 'process capability expired');
    const expected = { ...record.binding, source: 'process' as const };
    for (const key of ['profileId', 'pluginId', 'contributionId', 'processId', 'sessionId', 'origin', 'source'] as const) {
      if (binding[key] !== expected[key]) throw new NodeEditorAuthorityError(`${key}-binding-mismatch`, `process ${key} binding mismatch`);
    }
  }

  authorizeProcessCapability(sessionId: string, capability: string): void {
    const record = this.#records.get(sessionId);
    if (!record || record.revoked || !equalHash(capability, record.processHash)) throw new NodeEditorAuthorityError('authority-denied', 'process capability is invalid');
    if (this.#now() >= record.processExpiresAt) throw new NodeEditorAuthorityError('capability-expired', 'process capability expired');
  }

  authorizeTerminalCookie(sessionId: string, cookie: string, origin: string): void {
    const record = this.#records.get(sessionId);
    if (!record || !equalHash(cookie, record.cookieHash)) throw new NodeEditorAuthorityError('authority-denied', 'terminal retry cookie is invalid');
    if (!record.cookieExpiresAt || this.#now() >= record.cookieExpiresAt) throw new NodeEditorAuthorityError('capability-expired', 'terminal retry cookie expired');
    if (origin !== record.binding.origin) throw new NodeEditorAuthorityError('origin-binding-mismatch', 'terminal retry origin mismatch');
  }

  revoke(sessionId: string): void {
    const record = this.#records.get(sessionId);
    if (!record) return;
    record.revoked = true;
  }

  isRevoked(sessionId: string): boolean {
    return this.#records.get(sessionId)?.revoked ?? true;
  }
}
