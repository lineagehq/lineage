import type { NodeEditorBrowserLaunch, NodeEditorPluginSummary, NodeEditorTerminalOutcome } from '../../shared/nodeEditorPluginTypes';

type NodeEditorUiState = 'discovering' | 'ineligible' | 'launching' | 'active' | 'saving' | 'accepted' | 'cancelled' | 'stale' | 'expired' | 'failed' | 'closed';
export interface NodeEditorControllerSnapshot { state: NodeEditorUiState; message: string; dirty?: boolean; plugin?: NodeEditorPluginSummary; launch?: Omit<NodeEditorBrowserLaunch, 'launchCredential'>; outcome?: NodeEditorTerminalOutcome }

async function json<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(value.message || `Node editor request failed (${response.status})`);
  return value;
}

export class NodeEditorSessionController {
  #snapshot: NodeEditorControllerSnapshot = { state: 'discovering', message: 'Finding compatible editors…' };
  #listeners = new Set<(snapshot: NodeEditorControllerSnapshot) => void>();
  #sessionId = '';
  #channel?: MessagePort;
  #removeHandshakeListener?: () => void;
  #launchPromise?: Promise<void>;
  #lifecycleEpoch = 0;
  #lifecycleOwners = 0;
  #releaseSequence = 0;
  constructor(readonly target: { project: string; rootAssetId: string; nodeAssetId: string }) {}
  snapshot() { return this.#snapshot; }
  subscribe(listener: (snapshot: NodeEditorControllerSnapshot) => void) { this.#listeners.add(listener); listener(this.#snapshot); return () => { this.#listeners.delete(listener); }; }
  #set(value: NodeEditorControllerSnapshot) { this.#snapshot = value; for (const listener of this.#listeners) listener(value); this.#channel?.postMessage({ type: 'lineage.editor.state', message: value.message }); }

  acquire(): () => void {
    this.#lifecycleOwners += 1;
    this.#releaseSequence += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#lifecycleOwners -= 1;
      const release = ++this.#releaseSequence;
      queueMicrotask(() => {
        if (this.#lifecycleOwners === 0 && this.#releaseSequence === release) void this.close();
      });
    };
  }

  launch(): Promise<void> {
    if (this.#launchPromise) return this.#launchPromise;
    if (['active', 'launching', 'saving'].includes(this.#snapshot.state)) return Promise.resolve();
    const operation = this.#launchOnce();
    this.#launchPromise = operation;
    void operation.finally(() => { if (this.#launchPromise === operation) this.#launchPromise = undefined; });
    return operation;
  }

  async #launchOnce(): Promise<void> {
    const lifecycleEpoch = this.#lifecycleEpoch;
    try {
      const query = new URLSearchParams(this.target);
      const discovery = await json<{ plugins: NodeEditorPluginSummary[] }>(await fetch(`/api/node-editor-plugins?${query}`));
      if (lifecycleEpoch !== this.#lifecycleEpoch) return;
      const plugin = discovery.plugins.find(candidate => candidate.eligible !== false);
      if (!plugin) { this.#set({ state: 'ineligible', message: 'No compatible editor is available for this current asset.' }); return; }
      this.#set({ state: 'launching', message: `Starting ${plugin.contribution.displayName}…`, plugin });
      const created = await json<{ launch: NodeEditorBrowserLaunch }>(await fetch(`/api/node-editor-plugins/${encodeURIComponent(plugin.contribution.id)}/sessions`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.target),
      }));
      const { launchCredential, ...publicLaunch } = created.launch;
      const sessionId = created.launch.sessionId;
      await json(await fetch(`/api/node-editor-plugins/sessions/${encodeURIComponent(sessionId)}/exchange`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          launchCredential, profileId: created.launch.binding.profileId, pluginId: created.launch.binding.pluginId,
          contributionId: created.launch.binding.contributionId, source: 'browser',
        }),
      }));
      if (lifecycleEpoch !== this.#lifecycleEpoch) {
        await fetch(`/api/node-editor-plugins/sessions/${encodeURIComponent(sessionId)}/close`, { method: 'POST' }).catch(() => undefined);
        return;
      }
      this.#sessionId = sessionId;
      this.#set({ state: 'active', message: 'Editor ready. Changes stay local until you save.', plugin, launch: publicLaunch });
    } catch (error) {
      if (lifecycleEpoch !== this.#lifecycleEpoch) return;
      const message = error instanceof Error ? error.message : String(error);
      this.#set({ state: /expired/i.test(message) ? 'expired' : 'failed', message });
    }
  }

  connect(frame: HTMLIFrameElement, channelBinding: string): string {
    const launch = this.#snapshot.launch;
    if (!launch || !frame.contentWindow || new URL(launch.editorUrl).origin !== launch.runtimeOrigin || !/^[A-Za-z0-9_-]{16,128}$/.test(channelBinding)) throw new Error('editor runtime origin mismatch');
    if (this.#channel) throw new Error('editor channel already connected');
    this.#removeHandshakeListener?.();
    const expectedWindow = frame.contentWindow;
    const receiveCandidate = (event: MessageEvent) => {
      const candidate = event.ports[0];
      if (event.source !== expectedWindow || event.origin !== 'null' || event.data?.type !== 'reference.editor.connect' || event.data.channelBinding !== channelBinding || event.ports.length !== 1 || new URL(frame.src).origin !== launch.runtimeOrigin) {
        for (const port of event.ports) port.close();
        return;
      }
      if (this.#channel) {
        candidate.close();
        return;
      }
      this.#channel = candidate;
      this.#channel.onmessage = event => {
        if (event.data?.type === 'reference.editor.dirty' && event.data.dirty === true && Object.keys(event.data).length === 2) this.#set({ ...this.#snapshot, dirty: true });
        if (event.data?.type === 'reference.editor.save') void this.savePluginPayload(event.data);
        if (event.data?.type === 'reference.editor.cancel') void this.cancel();
      };
      this.#channel.postMessage({ type: 'lineage.editor.ack', channelBinding, message: this.#snapshot.message });
    };
    window.addEventListener('message', receiveCandidate);
    this.#removeHandshakeListener = () => window.removeEventListener('message', receiveCandidate);
    const editorUrl = new URL(launch.editorUrl);
    editorUrl.hash = new URLSearchParams({ lineageParentOrigin: window.location.origin, lineageChannelBinding: channelBinding }).toString();
    return editorUrl.toString();
  }

  async savePluginPayload(input: unknown): Promise<void> {
    if (this.#snapshot.state !== 'active') return;
    if (!input || typeof input !== 'object') { this.#set({ ...this.#snapshot, state: 'failed', message: 'Editor payload is invalid.' }); return; }
    const message = input as Record<string, unknown>;
    const keys = Object.keys(message).sort().join(',');
    const editSummary = typeof message.summary === 'string' ? message.summary.trim() : '';
    const mimeType = typeof message.mimeType === 'string' ? message.mimeType : '';
    const payload = message.payload;
    const maximumBytes = Math.min(this.#snapshot.plugin?.contribution.accepts.maxBytes ?? 0, 16 * 1024 * 1024);
    if (keys !== 'mimeType,payload,summary,type' || message.type !== 'reference.editor.save' || !(payload instanceof ArrayBuffer) || payload.byteLength < 8 || payload.byteLength > maximumBytes || !this.#snapshot.plugin?.contribution.accepts.mimeTypes.includes(mimeType as never) || editSummary.length < 1 || editSummary.length > 2048) {
      this.#set({ ...this.#snapshot, state: 'failed', message: 'Editor payload is invalid.' });
      return;
    }
    const bytes = new Uint8Array(payload);
    if (mimeType === 'image/png' && ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) {
      this.#set({ ...this.#snapshot, state: 'failed', message: 'Editor payload signature is invalid.' });
      return;
    }
    this.#set({ ...this.#snapshot, state: 'saving', message: 'Validating and saving…' });
    try {
      const documentResult = await json<{ document: { baseAttemptId: string; baseChecksumSha256: string } }>(await fetch(`/api/node-editor-plugins/sessions/${this.#sessionId}/document`));
      const checksumSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      const suffix = this.#sessionId.slice(-16);
      const proposalId = `proposal-${suffix}`;
      await json(await fetch(`/api/node-editor-plugins/sessions/${this.#sessionId}/proposals`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proposalId, idempotencyKey: `idem-${suffix}`, ...documentResult.document, mimeType, sizeBytes: bytes.length, checksumSha256, editSummary }),
      }));
      const uploaded = await json<{ outcome: NodeEditorTerminalOutcome }>(await fetch(`/api/node-editor-plugins/sessions/${this.#sessionId}/proposals/${proposalId}/content`, { method: 'PUT', body: bytes }));
      const state = uploaded.outcome.outcome === 'accepted' ? 'accepted' : uploaded.outcome.outcome === 'stale' ? 'stale' : 'cancelled';
      this.#set({ ...this.#snapshot, state, dirty: false, message: state === 'accepted' ? 'Edit accepted and added to attempt history.' : state === 'stale' ? 'The current attempt changed. Reopen the editor to continue.' : 'Edit cancelled.', outcome: uploaded.outcome });
    } catch (error) { this.#set({ ...this.#snapshot, state: 'failed', message: error instanceof Error ? error.message : String(error) }); }
  }

  async cancel(): Promise<void> {
    if (this.#snapshot.dirty && !window.confirm('Discard unsaved editor changes?')) return;
    try {
      const result = await json<{ outcome: NodeEditorTerminalOutcome }>(await fetch(`/api/node-editor-plugins/sessions/${this.#sessionId}/cancel`, { method: 'POST' }));
      this.#set({ ...this.#snapshot, state: 'cancelled', dirty: false, message: 'Edit cancelled. No asset was changed.', outcome: result.outcome });
    } catch (error) { this.#set({ ...this.#snapshot, state: 'failed', message: error instanceof Error ? error.message : String(error) }); }
  }

  async close(): Promise<void> {
    this.#lifecycleEpoch += 1;
    const sessionId = this.#sessionId;
    this.#sessionId = '';
    if (sessionId && !['accepted', 'cancelled', 'stale', 'closed'].includes(this.#snapshot.state)) await fetch(`/api/node-editor-plugins/sessions/${sessionId}/close`, { method: 'POST' }).catch(() => undefined);
    this.#channel?.close();
    this.#channel = undefined;
    this.#removeHandshakeListener?.();
    this.#removeHandshakeListener = undefined;
    this.#set({ ...this.#snapshot, state: 'closed', message: 'Editor closed.' });
  }

  async requestClose(): Promise<boolean> {
    if (this.#snapshot.dirty && !window.confirm('Discard unsaved editor changes?')) return false;
    await this.close();
    return true;
  }
}
