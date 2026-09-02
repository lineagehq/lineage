import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Duplex } from 'node:stream';
import type { NodeEditorHostPublicStatus, VerifiedNodeEditorPlugin } from '../../shared/nodeEditorPluginTypes';
import { NodeEditorPluginRegistry } from './registry';

interface PrivateBootstrap {
  bootstrap: {
    type: 'bootstrap';
    pluginId: string;
    processId: string;
    sessionId: string;
    bootstrapCredential: string;
    expiresAt: number;
  };
  profileId: string;
  controlCredential: string;
  idleTimeoutMs: number;
  editorHtmlBase64: string;
  editorSha256: string;
}

interface RunningHost {
  child: ChildProcess;
  controlOrigin: string;
  editorOrigin: string;
  controlCredential: string;
  status: NodeEditorHostPublicStatus;
  healthTimer?: NodeJS.Timeout;
  processId: string;
  sessionId: string;
}

export interface NodeEditorSupervisorOptions {
  bootstrapTimeoutMs?: number;
  idleTimeoutMs?: number;
  healthIntervalMs?: number;
  spawnProcess?: typeof spawn;
}

export interface NodeEditorPrivateProcessAuthority {
  processCapability: string;
  expiresAt: number;
  serverOrigin?: string;
  binding: {
    profileId: string;
    pluginId: string;
    contributionId: string;
    processId: string;
    sessionId: string;
    origin: string;
    source: 'process';
  };
}

export interface PreparedNodeEditorHost {
  processId: string;
  sessionId: string;
  editorOrigin: string;
  editorUrl: string;
}

export class NodeEditorPluginSupervisor {
  readonly #profileId: string;
  readonly #registry: NodeEditorPluginRegistry;
  readonly #options: Required<NodeEditorSupervisorOptions>;
  readonly #hosts = new Map<string, RunningHost>();
  readonly #last = new Map<string, NodeEditorHostPublicStatus>();

  constructor(profileId: string, registry: NodeEditorPluginRegistry, options: NodeEditorSupervisorOptions = {}) {
    this.#profileId = profileId;
    this.#registry = registry;
    this.#options = {
      bootstrapTimeoutMs: options.bootstrapTimeoutMs ?? 5_000,
      idleTimeoutMs: options.idleTimeoutMs ?? 30_000,
      healthIntervalMs: options.healthIntervalMs ?? 1_000,
      spawnProcess: options.spawnProcess ?? spawn,
    };
  }

  async start(contributionId: string): Promise<NodeEditorHostPublicStatus> {
    const existing = this.#hosts.get(contributionId);
    if (existing && existing.status.state === 'ready' && existing.child.exitCode === null) return { ...existing.status };
    const plugin = this.#registry.get(contributionId); // Re-verifies exact receipt bytes for every launch.
    const running = await this.#launch(plugin);
    this.#hosts.set(contributionId, running);
    this.#last.set(contributionId, running.status);
    return { ...running.status };
  }

  status(contributionId: string): NodeEditorHostPublicStatus {
    const active = this.#hosts.get(contributionId);
    return { ...(active?.status ?? this.#last.get(contributionId) ?? { contributionId, state: 'stopped' }) };
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#hosts.keys()].map(id => this.#stop(id)));
  }

  async deliverProcessAuthority(contributionId: string, authority: NodeEditorPrivateProcessAuthority): Promise<void> {
    let running = this.#hosts.get(contributionId);
    if (running && (running.processId !== authority.binding.processId || running.sessionId !== authority.binding.sessionId)) {
      await this.#stop(contributionId);
      running = undefined;
    }
    if (!running) {
      const plugin = this.#registry.get(contributionId);
      running = await this.#launch(plugin, authority.binding);
      this.#hosts.set(contributionId, running);
      this.#last.set(contributionId, running.status);
    }
    const response = await fetch(`${running.controlOrigin}/authority`, {
      body: JSON.stringify(authority),
      headers: { authorization: `Bearer ${running.controlCredential}`, 'content-type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) throw new Error(`reference host rejected process authority (${response.status})`);
  }

  async prepareSession(contributionId: string): Promise<PreparedNodeEditorHost> {
    const prior = this.#hosts.get(contributionId);
    if (prior) await this.#stop(contributionId);
    const plugin = this.#registry.get(contributionId);
    const running = await this.#launch(plugin);
    this.#hosts.set(contributionId, running);
    this.#last.set(contributionId, running.status);
    return {
      processId: running.processId,
      sessionId: running.sessionId,
      editorOrigin: running.editorOrigin,
      editorUrl: `${running.editorOrigin}/${plugin.contribution.editor.entrypoint}`,
    };
  }

  async #launch(plugin: VerifiedNodeEditorPlugin, identity?: { processId: string; sessionId: string }): Promise<RunningHost> {
    const installation = plugin.installation;
    const child = this.#options.spawnProcess(process.execPath, [plugin.hostPath], {
      cwd: installation.extractedRoot,
      env: {},
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    });
    const contributionId = plugin.contribution.id;
    const startedAt = new Date().toISOString();
    const bootstrapPipe = child.stdio[3] as Duplex | null;
    if (!bootstrapPipe) {
      child.kill();
      throw new Error('reference host did not receive an inherited bootstrap pipe');
    }
    const processId = identity?.processId ?? `process-${randomBytes(12).toString('hex')}`;
    const sessionId = identity?.sessionId ?? `session-${randomBytes(12).toString('hex')}`;
    const editorBytes = readFileSync(plugin.editorPath);
    if (createHash('sha256').update(editorBytes).digest('hex') !== plugin.installation.editorSha256) {
      child.kill();
      throw new Error('exact editor-byte SHA-256 mismatch before launch');
    }
    const payload: PrivateBootstrap = {
      bootstrap: {
        type: 'bootstrap',
        pluginId: plugin.manifest.pluginId,
        processId,
        sessionId,
        bootstrapCredential: randomBytes(24).toString('base64url'),
        expiresAt: Date.now() + this.#options.bootstrapTimeoutMs,
      },
      profileId: this.#profileId,
      controlCredential: randomBytes(32).toString('base64url'),
      idleTimeoutMs: this.#options.idleTimeoutMs,
      editorHtmlBase64: editorBytes.toString('base64'),
      editorSha256: plugin.installation.editorSha256,
    };
    const readyPromise = this.#readReady(bootstrapPipe, child);
    bootstrapPipe.end(`${JSON.stringify(payload)}\n`);
    let ready: { type: string; controlOrigin: string; editorOrigin: string; pluginId: string; profileId: string };
    try {
      ready = await readyPromise;
      if (ready.type !== 'host.ready' || ready.pluginId !== plugin.manifest.pluginId || ready.profileId !== this.#profileId) {
        throw new Error('reference host readiness binding mismatch');
      }
      if (ready.controlOrigin === ready.editorOrigin) throw new Error('reference host control and editor origins must be distinct');
      const response = await this.#controlFetch(ready.controlOrigin, payload.controlCredential, '/health');
      if (!response.ok) throw new Error(`reference host health check failed (${response.status})`);
    } catch (error) {
      child.kill();
      throw error;
    }
    const running: RunningHost = {
      child,
      controlOrigin: ready.controlOrigin,
      editorOrigin: ready.editorOrigin,
      controlCredential: payload.controlCredential,
      status: { contributionId, state: 'ready', startedAt },
      processId,
      sessionId,
    };
    child.once('exit', (code, signal) => {
      if (running.healthTimer) clearInterval(running.healthTimer);
      const stopped: NodeEditorHostPublicStatus = {
        contributionId,
        state: code === 0 || signal === 'SIGTERM' ? 'stopped' : 'failed',
        startedAt,
        stoppedAt: new Date().toISOString(),
        reason: code === 0 ? 'idle-shutdown' : signal ? `signal-${signal}` : `exit-${code}`,
      };
      running.status = stopped;
      this.#last.set(contributionId, stopped);
      if (this.#hosts.get(contributionId) === running) this.#hosts.delete(contributionId);
    });
    running.healthTimer = setInterval(() => {
      void this.#controlFetch(running.controlOrigin, running.controlCredential, '/health').then(response => {
        if (!response.ok) child.kill();
      }).catch(() => child.kill());
    }, this.#options.healthIntervalMs);
    running.healthTimer.unref();
    return running;
  }

  #readReady(pipe: Duplex, child: ChildProcess): Promise<{ type: string; controlOrigin: string; editorOrigin: string; pluginId: string; profileId: string }> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const timeout = setTimeout(() => reject(new Error('reference host bootstrap timed out')), this.#options.bootstrapTimeoutMs);
      const fail = (error: Error) => { clearTimeout(timeout); reject(error); };
      child.once('error', fail);
      child.once('exit', code => fail(new Error(`reference host exited before readiness (${code})`)));
      pipe.on('data', chunk => {
        buffer += chunk.toString('utf8');
        if (buffer.length > 64 * 1024) return fail(new Error('reference host readiness exceeded 64 KiB'));
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        try {
          const value = JSON.parse(buffer.slice(0, newline)) as { type: string; controlOrigin: string; editorOrigin: string; pluginId: string; profileId: string };
          clearTimeout(timeout);
          resolve(value);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
      pipe.once('error', fail);
    });
  }

  #controlFetch(origin: string, credential: string, path: string): Promise<Response> {
    return fetch(`${origin}${path}`, { headers: { authorization: `Bearer ${credential}` } });
  }

  async #stop(contributionId: string): Promise<void> {
    const running = this.#hosts.get(contributionId);
    if (!running) return;
    if (running.healthTimer) clearInterval(running.healthTimer);
    const exited = running.child.exitCode === null ? new Promise<void>(resolve => running.child.once('exit', () => resolve())) : Promise.resolve();
    try {
      await fetch(`${running.controlOrigin}/shutdown`, {
        headers: { authorization: `Bearer ${running.controlCredential}` },
        method: 'POST',
      });
    } catch {
      running.child.kill('SIGTERM');
    }
    await Promise.race([exited, new Promise<void>(resolve => setTimeout(resolve, 1_000))]);
    if (this.#hosts.get(contributionId) === running) this.#hosts.delete(contributionId);
  }
}
