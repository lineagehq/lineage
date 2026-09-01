import { describe, expect, it } from 'vitest';
import { NodeEditorAuthorityError, NodeEditorSessionAuthority } from './sessionAuthority';

describe('node editor session authority', () => {
  it('exchanges one exact-bound launch credential into a revocable cookie', () => {
    let now = 100;
    const authority = new NodeEditorSessionAuthority({ now: () => now, launchTtlMs: 50 });
    const created = authority.create({ profileId: 'profile-a', pluginId: 'reference.editor', contributionId: 'reference.editor', origin: 'https://editor.test.invalid' });
    const binding = created.launch.binding;
    const { cookie } = authority.exchange({ sessionId: created.launch.sessionId, launchCredential: created.launch.launchCredential, binding });
    expect(authority.authorizeCookie(created.launch.sessionId, cookie, binding.origin)).toMatchObject({ profileId: 'profile-a' });
    expect(() => authority.exchange({ sessionId: created.launch.sessionId, launchCredential: created.launch.launchCredential, binding })).toThrow(NodeEditorAuthorityError);
    authority.revoke(created.launch.sessionId);
    expect(() => authority.authorizeCookie(created.launch.sessionId, cookie, binding.origin)).toThrow(/invalid/);
    now = 200;
  });

  it.each([
    ['profileId', 'profile-b'], ['pluginId', 'other.editor'], ['contributionId', 'other.editor'],
    ['sessionId', 'session-wrong'], ['origin', 'https://wrong.test.invalid'], ['source', 'process'],
  ])('rejects wrong %s binding', (key, value) => {
    const authority = new NodeEditorSessionAuthority();
    const created = authority.create({ profileId: 'profile-a', pluginId: 'reference.editor', contributionId: 'reference.editor', origin: 'https://editor.test.invalid' });
    expect(() => authority.exchange({
      sessionId: created.launch.sessionId,
      launchCredential: created.launch.launchCredential,
      binding: { ...created.launch.binding, [key]: value } as typeof created.launch.binding,
    })).toThrow(/mismatch/);
  });

  it('rejects expiry without consuming into a cookie', () => {
    let now = 100;
    const authority = new NodeEditorSessionAuthority({ now: () => now, launchTtlMs: 10 });
    const created = authority.create({ profileId: 'profile-a', pluginId: 'reference.editor', contributionId: 'reference.editor', origin: 'https://editor.test.invalid' });
    now = 111;
    expect(() => authority.exchange({ sessionId: created.launch.sessionId, launchCredential: created.launch.launchCredential, binding: created.launch.binding })).toThrow(/expired/);
  });

  it('enforces process and cookie expiry server-side while retaining terminal-only cookie proof after revocation', () => {
    let now = 100;
    const authority = new NodeEditorSessionAuthority({ now: () => now, processTtlMs: 10, cookieTtlMs: 20 });
    const created = authority.create({ profileId: 'profile-a', pluginId: 'reference.editor', contributionId: 'reference.editor', origin: 'https://editor.test.invalid' });
    const { cookie } = authority.exchange({ sessionId: created.launch.sessionId, launchCredential: created.launch.launchCredential, binding: created.launch.binding });
    authority.revoke(created.launch.sessionId);
    expect(() => authority.authorizeCookie(created.launch.sessionId, cookie, created.launch.binding.origin)).toThrow(/invalid/);
    expect(() => authority.authorizeTerminalCookie(created.launch.sessionId, cookie, created.launch.binding.origin)).not.toThrow();
    now = 111;
    expect(() => authority.authorizeProcessCapability(created.launch.sessionId, created.processCapability)).toThrow(/invalid|expired/);
    now = 121;
    expect(() => authority.authorizeTerminalCookie(created.launch.sessionId, cookie, created.launch.binding.origin)).toThrow(/expired/);

    now = 200;
    const expiring = authority.create({ profileId: 'profile-a', pluginId: 'reference.editor', contributionId: 'reference.editor', origin: 'https://editor.test.invalid' });
    now = 211;
    expect(() => authority.authorizeProcess(expiring.launch.sessionId, expiring.processCapability, expiring.processBinding)).toThrow(/expired/);
  });
});
