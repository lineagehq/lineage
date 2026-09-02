// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NodeEditorSessionController } from './nodeEditorSessionController';

afterEach(() => vi.unstubAllGlobals());
describe('NodeEditorSessionController', () => {
  it('keeps the single-use launch credential out of its public snapshot', async () => {
    const responses = [
      { plugins: [{ pluginId: 'reference.editor', packageName: 'p', packageVersion: '1.0.0', displayName: 'Reference', contribution: { id: 'reference.editor', displayName: 'Reference editor', accepts: { mimeTypes: ['image/png'], maxBytes: 99 }, minimumViewport: { width: 640, height: 480 } }, protocol: { major: 1, minor: 0, features: [] }, eligible: true }] },
      { launch: { sessionId: 'session-test', launchCredential: 'secret-launch', binding: { profileId: 'p', pluginId: 'reference.editor', contributionId: 'reference.editor', sessionId: 'session-test', origin: 'http://127.0.0.1:1234', source: 'browser' }, expiresAt: Date.now() + 1000, editorUrl: 'http://127.0.0.1:1234/editor/index.html', runtimeOrigin: 'http://127.0.0.1:1234', pluginDisplayName: 'Reference editor' } },
      { ok: true },
    ];
    const requestBodies: unknown[] = [];
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => { requestBodies.push(options?.body); return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } }); });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new NodeEditorSessionController({ project: 'p', rootAssetId: 'r', nodeAssetId: 'n' });
    await controller.launch();
    expect(controller.snapshot().state).toBe('active');
    expect(JSON.stringify(controller.snapshot())).not.toContain('secret-launch');
    expect(String(requestBodies[2])).toContain('secret-launch');
  });

  it('accepts one channel only from the exact opaque frame and controller binding', async () => {
    const responses = [
      { plugins: [{ pluginId: 'reference.editor', packageName: 'p', packageVersion: '1.0.0', displayName: 'Reference', contribution: { id: 'reference.editor', displayName: 'Reference editor', accepts: { mimeTypes: ['image/png'], maxBytes: 99 }, minimumViewport: { width: 640, height: 480 } }, protocol: { major: 1, minor: 0, features: [] }, eligible: true }] },
      { launch: { sessionId: 'session-test', launchCredential: 'secret-launch', binding: { profileId: 'p', pluginId: 'reference.editor', contributionId: 'reference.editor', sessionId: 'session-test', origin: 'http://127.0.0.1:1234', source: 'browser' }, expiresAt: Date.now() + 1000, editorUrl: 'http://127.0.0.1:1234/editor/index.html', runtimeOrigin: 'http://127.0.0.1:1234', pluginDisplayName: 'Reference editor' } },
      { ok: true },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } })));
    const controller = new NodeEditorSessionController({ project: 'p', rootAssetId: 'r', nodeAssetId: 'n' });
    await controller.launch();
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const binding = 'binding_1234567890';
    const expectedWindow = iframe.contentWindow;
    iframe.src = controller.connect(iframe, binding);
    const rejected = { close: vi.fn() } as unknown as MessagePort;
    window.dispatchEvent(new MessageEvent('message', { source: expectedWindow, origin: 'null', data: { type: 'reference.editor.connect', channelBinding: 'binding_wrong_1234' }, ports: [rejected] }));
    expect(rejected.close).toHaveBeenCalledOnce();
    const accepted = { close: vi.fn(), postMessage: vi.fn(), onmessage: null } as unknown as MessagePort;
    window.dispatchEvent(new MessageEvent('message', { source: expectedWindow, origin: 'null', data: { type: 'reference.editor.connect', channelBinding: binding }, ports: [accepted] }));
    expect(accepted.postMessage).toHaveBeenCalledWith({ type: 'lineage.editor.ack', channelBinding: binding, message: 'Editor ready. Changes stay local until you save.' });
    const duplicate = { close: vi.fn() } as unknown as MessagePort;
    window.dispatchEvent(new MessageEvent('message', { source: expectedWindow, origin: 'null', data: { type: 'reference.editor.connect', channelBinding: binding }, ports: [duplicate] }));
    expect(duplicate.close).toHaveBeenCalledOnce();
    await controller.close();
    iframe.remove();
  });

  it('selects the canonical 1.3 namespace and transfers only verified bounded document bytes', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><text>source</text></svg>');
    const checksum = createHash('sha256').update(svg).digest('hex');
    const responses = [
      { plugins: [{ pluginId: 'reference.editor', packageName: 'p', packageVersion: '1.0.0', displayName: 'Reference', contribution: { id: 'reference.editor', displayName: 'Reference editor', accepts: { mimeTypes: ['image/svg+xml'], maxBytes: 999 }, minimumViewport: { width: 640, height: 480 } }, protocol: { major: 1, minor: 3, features: ['document-read', 'document-content'] }, eligible: true }] },
      { launch: { sessionId: 'session-content', launchCredential: 'secret-launch', binding: { profileId: 'p', pluginId: 'reference.editor', contributionId: 'reference.editor', sessionId: 'session-content', origin: window.location.origin, source: 'browser' }, expiresAt: Date.now() + 1000, editorUrl: 'http://127.0.0.1:1234/editor/index.html', runtimeOrigin: 'http://127.0.0.1:1234', pluginDisplayName: 'Reference editor' } },
      { ok: true },
    ];
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith('/document/content')) return new Response(svg, { status: 200, headers: { 'content-type': 'image/svg+xml', 'content-length': String(svg.length), 'x-lineage-content-sha256': checksum } });
      return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const controller = new NodeEditorSessionController({ project: 'p', rootAssetId: 'r', nodeAssetId: 'n' });
    await controller.launch();
    const iframe = document.createElement('iframe'); document.body.append(iframe);
    const binding = 'binding_content_1234';
    const expectedWindow = iframe.contentWindow;
    const connected = { close: vi.fn(), postMessage: vi.fn(), onmessage: null } as unknown as MessagePort;
    iframe.src = controller.connect(iframe, binding);
    expect(iframe.src).toContain('lineageProtocol=1.3');
    window.dispatchEvent(new MessageEvent('message', { source: expectedWindow, origin: 'null', data: { type: 'reference.editor.connect', channelBinding: binding }, ports: [{ close: vi.fn() } as unknown as MessagePort] }));
    window.dispatchEvent(new MessageEvent('message', { source: expectedWindow, origin: 'null', data: { type: 'lineage.node-editor.connect', channelBinding: binding }, ports: [connected] }));
    expect(connected.postMessage).toHaveBeenCalledWith({ type: 'lineage.node-editor.connected', channelBinding: binding, message: 'Editor ready. Changes stay local until you save.' });
    await vi.waitFor(() => expect(connected.postMessage).toHaveBeenCalledTimes(2));
    const [documentMessage, transfer] = (connected.postMessage as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(documentMessage).toMatchObject({ type: 'lineage.node-editor.document', mimeType: 'image/svg+xml', sizeBytes: svg.length, checksumSha256: checksum, payload: expect.any(ArrayBuffer) });
    expect([...new Uint8Array(documentMessage.payload)]).toEqual([...svg]);
    expect(transfer).toEqual([documentMessage.payload]);
    expect(urls.some(url => url.endsWith('/document/content'))).toBe(true);
    expect(JSON.stringify(documentMessage)).not.toMatch(/session-content|credential|url|path/i);
    iframe.remove();
  });

  it('coalesces Strict Mode launch and preserves the winning session across a synthetic release', async () => {
    const responses = [
      { plugins: [{ pluginId: 'reference.editor', packageName: 'p', packageVersion: '1.0.0', displayName: 'Reference', contribution: { id: 'reference.editor', displayName: 'Reference editor', accepts: { mimeTypes: ['image/png'], maxBytes: 99 }, minimumViewport: { width: 640, height: 480 } }, protocol: { major: 1, minor: 0, features: [] }, eligible: true }] },
      { launch: { sessionId: 'session-winner', launchCredential: 'secret-once', binding: { profileId: 'p', pluginId: 'reference.editor', contributionId: 'reference.editor', sessionId: 'session-winner', origin: 'http://127.0.0.1:1234', source: 'browser' }, expiresAt: Date.now() + 1000, editorUrl: 'http://127.0.0.1:1234/editor/index.html', runtimeOrigin: 'http://127.0.0.1:1234', pluginDisplayName: 'Reference editor' } },
      { ok: true },
      { outcome: { outcome: 'cancelled' } },
    ];
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } }); }));
    const controller = new NodeEditorSessionController({ project: 'p', rootAssetId: 'r', nodeAssetId: 'n' });
    const releaseSynthetic = controller.acquire();
    const firstLaunch = controller.launch();
    releaseSynthetic();
    const releaseWinner = controller.acquire();
    const secondLaunch = controller.launch();
    await Promise.all([firstLaunch, secondLaunch]);
    await Promise.resolve();
    expect(controller.snapshot().state).toBe('active');
    expect(urls.filter(url => url.endsWith('/sessions'))).toHaveLength(1);
    expect(urls.filter(url => url.endsWith('/exchange'))).toHaveLength(1);
    expect(urls.filter(url => url.endsWith('/close'))).toHaveLength(0);
    releaseWinner();
    await Promise.resolve();
    await vi.waitFor(() => expect(urls.filter(url => url.endsWith('/close'))).toHaveLength(1));
  });

  it('forwards only exact bounded plugin-produced bytes and confirms dirty cancellation', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const responses = [
      { plugins: [{ pluginId: 'reference.editor', packageName: 'p', packageVersion: '1.0.0', displayName: 'Reference', contribution: { id: 'reference.editor', displayName: 'Reference editor', accepts: { mimeTypes: ['image/png'], maxBytes: 99 }, minimumViewport: { width: 640, height: 480 } }, protocol: { major: 1, minor: 0, features: [] }, eligible: true }] },
      { launch: { sessionId: 'session-payload', launchCredential: 'secret-launch', binding: { profileId: 'p', pluginId: 'reference.editor', contributionId: 'reference.editor', sessionId: 'session-payload', origin: window.location.origin, source: 'browser' }, expiresAt: Date.now() + 1000, editorUrl: 'http://127.0.0.1:1234/editor/index.html', runtimeOrigin: 'http://127.0.0.1:1234', pluginDisplayName: 'Reference editor' } },
      { ok: true },
      { document: { baseAttemptId: 'attempt-1', baseChecksumSha256: '1'.repeat(64) } },
      { proposal: { proposalId: 'proposal-payload', status: 'pending' } },
      { outcome: { outcome: 'accepted', sessionId: 'session-payload', proposalId: 'proposal-payload', attemptId: 'attempt-2' } },
    ];
    const requests: Array<{ url: string; body?: BodyInit | null }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      requests.push({ url, body: options?.body });
      return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const controller = new NodeEditorSessionController({ project: 'p', rootAssetId: 'r', nodeAssetId: 'n' });
    await controller.launch();
    await controller.savePluginPayload({ type: 'reference.editor.save', summary: 'Plugin bytes', mimeType: 'image/png', payload: png.buffer });
    expect(controller.snapshot().state).toBe('accepted');
    expect(requests.find(request => request.url.endsWith('/content'))?.body).toBeInstanceOf(Uint8Array);
    expect([...requests.find(request => request.url.endsWith('/content'))!.body as Uint8Array]).toEqual([...png]);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const frame = document.createElement('iframe'); document.body.append(frame);
    const channel = { close: vi.fn(), postMessage: vi.fn(), onmessage: null } as unknown as MessagePort;
    const binding = 'binding_dirty_1234';
    const expectedWindow = frame.contentWindow;
    frame.src = controller.connect(frame, binding);
    window.dispatchEvent(new MessageEvent('message', { source: expectedWindow, origin: 'null', data: { type: 'reference.editor.connect', channelBinding: binding }, ports: [channel] }));
    channel.onmessage?.(new MessageEvent('message', { data: { type: 'reference.editor.dirty', dirty: true } }));
    await controller.cancel();
    expect(confirm).toHaveBeenCalledWith('Discard unsaved editor changes?');
    frame.remove();
  });
});
