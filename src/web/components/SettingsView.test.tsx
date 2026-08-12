// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from './SettingsView';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
}

const runtimePayload = { runtime: { database: { exists: true, path: '/tmp/test.db' }, profile: { bound: true, environment: 'development', id: 'test' }, schema: { migration_keys: [] } } };
const projectEnvironment = (project: string) => `${project.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_KEY`;

function bufferSettings(project: string) {
  return { settings: [{
    adapter_type: 'scheduler', credential: { detected: true, label: `Credential reference env:${projectEnvironment(project)}`, secret_ref: `env:${projectEnvironment(project)}` },
    description: 'Composition foundation without publishing.', enabled: true, health_status: 'configured', label: 'Buffer', provider: 'buffer', safe_config: { defaultMode: 'dry-run' }, updated_at: '2026-08-12T12:00:00.000Z',
  }] };
}

function bufferStatus(project: string) {
  return {
    buffer_connection: {
      available_channel_count: 1, channel_count: 1, channel_synced_at: '2026-08-12T12:00:00.000Z', cli_version: '1.2.0', connected: true,
      credential_detected: true, credential_environment: projectEnvironment(project), disconnected_channel_count: 0, health_state: 'connected',
      organization_id: `synthetic-${project}-organization`, stale_channel_count: 0,
    },
    posting: [{ can_dry_run: true, can_post: false, configured: true, missing: [], mode: 'dry-run-only', provider: 'buffer' }], storage: [],
  };
}

async function settleReact() {
  await new Promise(resolve => window.setTimeout(resolve, 0));
}

type MutationName = 'Connect' | 'Sync channels' | 'toggle';

const mutationPairs: Array<[MutationName, MutationName]> = [
  ['Connect', 'toggle'],
  ['Sync channels', 'toggle'],
  ['toggle', 'Connect'],
  ['toggle', 'Sync channels'],
];

const mutationRaceCases = mutationPairs.flatMap(([first, second]) =>
  (['first', 'second'] as const).flatMap(settlesFirst =>
    [true, false].flatMap(firstSucceeds =>
      [true, false].map(secondSucceeds => ({ first, firstSucceeds, second, secondSucceeds, settlesFirst })))));

type AdapterName = 'cloud' | 'buffer' | 'image-generator';
const adapterPairs: Array<[AdapterName, AdapterName]> = [
  ['cloud', 'buffer'], ['buffer', 'cloud'],
  ['buffer', 'image-generator'], ['image-generator', 'buffer'],
  ['cloud', 'image-generator'], ['image-generator', 'cloud'],
];
const adapterRaceCases = adapterPairs.flatMap(([first, second]) =>
  (['first', 'second'] as const).flatMap(settlesFirst =>
    [true, false].flatMap(firstSucceeds =>
      [true, false].map(secondSucceeds => ({ first, firstSucceeds, second, secondSucceeds, settlesFirst })))));

const adapterControlLabels: Record<AdapterName, string> = {
  buffer: 'Enable Buffer scheduling',
  cloud: 'Enable Amazon S3',
  'image-generator': 'Enable Codex handoff',
};

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('SettingsView', () => {
  it('keeps global settings focused on runtime and integrations without duplicating Canvas hover preferences', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => ({
      json: async () => String(input).includes('/api/runtime')
        ? { runtime: { database: { exists: true, path: '/tmp/test.db' }, profile: { bound: true, environment: 'development', id: 'test' }, schema: { migration_keys: [] } } }
        : String(input).includes('/api/adapters/status')
          ? { buffer_connection: null, posting: [], storage: [] }
          : { settings: [] },
      ok: true,
    })));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SettingsView onToast={vi.fn()} project="demo-project" />);
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Release');
    expect(container.textContent).toContain('Cloud storage');
    expect(container.textContent).toContain('Social scheduling');
    expect(container.textContent).toContain('Image generation');
    expect(container.textContent).not.toContain('Lineage experience');
    expect(container.querySelector('[aria-label="Enable lineage hover previews"]')).toBeNull();

    act(() => root.unmount());
  });

  it('shows safe Buffer compatibility and catalog status while keeping Connect separate from Sync', async () => {
    const requests: Array<{ body?: string; path: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      requests.push({ body: typeof init?.body === 'string' ? init.body : undefined, path });
      const payload = path.includes('/api/runtime')
        ? { runtime: { database: { exists: true, path: '/tmp/test.db' }, profile: { bound: true, environment: 'development', id: 'test' }, schema: { migration_keys: [] } } }
        : path.includes('/api/adapters/status')
          ? {
              buffer_connection: {
                available_channel_count: 1,
                channel_count: 2,
                channel_synced_at: '2026-08-12T12:00:00.000Z',
                cli_version: '1.2.0',
                connected: true,
                credential_detected: true,
                credential_environment: 'SYNTHETIC_BUFFER_KEY',
                disconnected_channel_count: 1,
                health_state: 'connected',
                organization_id: 'synthetic-organization',
                stale_channel_count: 1,
                provider_raw_response: 'must-never-render',
              },
              posting: [{ can_dry_run: true, can_post: false, configured: true, missing: [], mode: 'dry-run-only', provider: 'buffer' }],
              storage: [],
            }
          : path === '/api/adapters/buffer/connection' || path === '/api/adapters/buffer/channels'
            ? { ok: true }
            : {
                settings: [{
                  adapter_type: 'scheduler', credential: { detected: true, label: 'Credential reference env:SYNTHETIC_BUFFER_KEY', secret_ref: 'env:SYNTHETIC_BUFFER_KEY' },
                  description: 'Composition foundation without publishing.', enabled: true, health_status: 'configured', label: 'Buffer', provider: 'buffer', safe_config: { defaultMode: 'dry-run' }, updated_at: '2026-08-12T12:00:00.000Z',
                }],
              };
      return { json: async () => payload, ok: true } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SettingsView onToast={vi.fn()} project="demo-project" />);
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Buffer CLI 1.2.0 pinned');
    expect(container.textContent).toContain('synthetic-organization');
    expect(container.textContent).toContain('1 available / 2 synced · 1 stale · 1 disconnected');
    expect(container.textContent).toContain('dry-run only · live posting disabled');
    expect(container.textContent).toContain('Neither action schedules, uploads, or publishes anything.');
    expect(container.textContent).not.toContain('must-never-render');

    const buttons = Array.from(container.querySelectorAll('button'));
    const connectButton = buttons.find(button => button.textContent?.trim() === 'Connect');
    const syncButton = buttons.find(button => button.textContent?.trim() === 'Sync channels');
    expect(connectButton).toBeDefined();
    expect(syncButton).toBeDefined();
    await act(async () => {
      connectButton!.click();
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      syncButton!.click();
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    const connectRequest = requests.find(request => request.path === '/api/adapters/buffer/connection');
    const syncRequest = requests.find(request => request.path === '/api/adapters/buffer/channels');
    expect(JSON.parse(connectRequest?.body || '{}')).toEqual({ confirmWrite: true, credentialRef: 'env:SYNTHETIC_BUFFER_KEY', organizationId: 'synthetic-organization', project: 'demo-project' });
    expect(JSON.parse(syncRequest?.body || '{}')).toEqual({ confirmWrite: true, project: 'demo-project' });
    expect(JSON.stringify(requests)).not.toContain('must-never-render');

    act(() => root.unmount());
  });

  it('renders normalized missing-credential guidance without raw provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => ({
      json: async () => String(input).includes('/api/runtime')
        ? { runtime: { database: { exists: true, path: '/tmp/test.db' }, profile: { bound: true, environment: 'development', id: 'test' }, schema: { migration_keys: [] } } }
        : String(input).includes('/api/adapters/status')
          ? { buffer_connection: { available_channel_count: 0, channel_count: 0, channel_synced_at: null, cli_version: '1.2.0', connected: false, credential_detected: false, credential_environment: 'SYNTHETIC_BUFFER_KEY', disconnected_channel_count: 0, health_state: 'credential_missing', organization_id: 'synthetic-organization', stale_channel_count: 0, raw_error: 'private-upstream-error' }, posting: [], storage: [] }
          : { settings: [{ adapter_type: 'scheduler', credential: { detected: false, label: 'Credential reference env:SYNTHETIC_BUFFER_KEY', secret_ref: 'env:SYNTHETIC_BUFFER_KEY' }, description: 'Composition only.', enabled: true, health_status: 'dry_run_available', label: 'Buffer', provider: 'buffer', safe_config: { defaultMode: 'dry-run' }, updated_at: '' }] },
      ok: true,
    })));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SettingsView onToast={vi.fn()} project="demo-project" />);
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Credential unavailable in SYNTHETIC_BUFFER_KEY');
    expect(container.textContent).not.toContain('private-upstream-error');
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Sync channels')?.disabled).toBe(true);
    act(() => root.unmount());
  });

  it('owns all displayed and editable state across project A to B to A transitions', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const project = new URL(path, 'http://lineage.test').searchParams.get('project') || 'runtime';
      const payload = path.includes('/api/runtime') ? runtimePayload : path.includes('/api/adapters/status') ? bufferStatus(project) : bufferSettings(project);
      return { json: async () => payload, ok: true } as Response;
    }));
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    await act(async () => { root.render(<SettingsView onToast={vi.fn()} project="project-a" />); await settleReact(); });
    expect((container.querySelector('[aria-label="Buffer organization ID"]') as HTMLInputElement).value).toBe('synthetic-project-a-organization');
    expect(container.textContent).toContain('PROJECT_A_KEY');

    await act(async () => { root.render(<SettingsView onToast={vi.fn()} project="project-b" />); await settleReact(); });
    expect((container.querySelector('[aria-label="Buffer organization ID"]') as HTMLInputElement).value).toBe('synthetic-project-b-organization');
    expect(container.textContent).not.toContain('synthetic-project-a-organization');
    expect(container.textContent).not.toContain('PROJECT_A_KEY');

    await act(async () => { root.render(<SettingsView onToast={vi.fn()} project="project-a" />); await settleReact(); });
    expect((container.querySelector('[aria-label="Buffer organization ID"]') as HTMLInputElement).value).toBe('synthetic-project-a-organization');
    expect(container.textContent).not.toContain('synthetic-project-b-organization');
    act(() => root.unmount());
  });

  it('rejects delayed out-of-order refresh settlement from an earlier project', async () => {
    const delayedSettings = deferred<Response>(); const delayedStatus = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes('project-a') && path.includes('/settings')) return delayedSettings.promise;
      if (path.includes('project-a') && path.includes('/status')) return delayedStatus.promise;
      const project = new URL(path, 'http://lineage.test').searchParams.get('project') || 'runtime';
      const payload = path.includes('/api/runtime') ? runtimePayload : path.includes('/api/adapters/status') ? bufferStatus(project) : bufferSettings(project);
      return Promise.resolve({ json: async () => payload, ok: true } as Response);
    }));
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    await act(async () => { root.render(<SettingsView onToast={vi.fn()} project="project-a" />); await settleReact(); });
    await act(async () => { root.render(<SettingsView onToast={vi.fn()} project="project-b" />); await settleReact(); });
    expect(container.textContent).toContain('synthetic-project-b-organization');

    await act(async () => {
      delayedSettings.resolve({ json: async () => bufferSettings('project-a'), ok: true } as Response);
      delayedStatus.resolve({ json: async () => bufferStatus('project-a'), ok: true } as Response);
      await settleReact();
    });
    expect(container.textContent).toContain('synthetic-project-b-organization');
    expect(container.textContent).not.toContain('synthetic-project-a-organization');
    act(() => root.unmount());
  });

  it.each(['Connect', 'Sync channels'] as const)('ignores in-flight %s settlement after the selected project changes', async actionLabel => {
    const action = deferred<Response>(); const onToast = vi.fn();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === 'POST') return action.promise;
      const project = new URL(path, 'http://lineage.test').searchParams.get('project') || 'runtime';
      const payload = path.includes('/api/runtime') ? runtimePayload : path.includes('/api/adapters/status') ? bufferStatus(project) : bufferSettings(project);
      return Promise.resolve({ json: async () => payload, ok: true } as Response);
    }));
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    await act(async () => { root.render(<SettingsView onToast={onToast} project="project-a" />); await settleReact(); });
    const actionButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === actionLabel)!;
    await act(async () => { actionButton.click(); await settleReact(); });
    await act(async () => { root.render(<SettingsView onToast={onToast} project="project-b" />); await settleReact(); });
    await act(async () => { action.resolve({ json: async () => ({ ok: true }), ok: true } as Response); await settleReact(); });

    expect(container.textContent).toContain('synthetic-project-b-organization');
    expect(container.textContent).not.toContain('synthetic-project-a-organization');
    expect(onToast).not.toHaveBeenCalledWith('ok', expect.any(String));
    act(() => root.unmount());
  });

  it('clears prior-project state and presents a normalized disabled state when refresh fails', async () => {
    const onToast = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes('project-b')) return { json: async () => ({ message: 'upstream stack and private-provider-detail' }), ok: false, status: 502 } as Response;
      const project = new URL(path, 'http://lineage.test').searchParams.get('project') || 'runtime';
      const payload = path.includes('/api/runtime') ? runtimePayload : path.includes('/api/adapters/status') ? bufferStatus(project) : bufferSettings(project);
      return { json: async () => payload, ok: true } as Response;
    }));
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    await act(async () => { root.render(<SettingsView onToast={onToast} project="project-a" />); await settleReact(); });
    await act(async () => { root.render(<SettingsView onToast={onToast} project="project-b" />); await settleReact(); });

    expect(container.textContent).toContain('Settings could not be refreshed for this project.');
    expect(container.textContent).not.toContain('synthetic-project-a-organization');
    expect(container.textContent).not.toContain('private-provider-detail');
    expect(onToast).toHaveBeenLastCalledWith('error', 'Settings could not be refreshed for this project. Verify the active runtime and try again.');
    expect(Array.from(container.querySelectorAll('button')).some(button => ['Connect', 'Sync channels'].includes(button.textContent?.trim() || '') && !button.disabled)).toBe(false);
    act(() => root.unmount());
  });

  it.each(['Connect', 'Sync channels'] as const)('normalizes failed %s errors without rendering or toasting raw detail', async actionLabel => {
    const onToast = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === 'POST') return { json: async () => ({ message: 'raw-provider-payload credential-value stack-detail' }), ok: false, status: 500 } as Response;
      const project = new URL(path, 'http://lineage.test').searchParams.get('project') || 'runtime';
      const payload = path.includes('/api/runtime') ? runtimePayload : path.includes('/api/adapters/status') ? bufferStatus(project) : bufferSettings(project);
      return { json: async () => payload, ok: true } as Response;
    }));
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    await act(async () => { root.render(<SettingsView onToast={onToast} project="project-a" />); await settleReact(); });
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === actionLabel)!.click();
      await settleReact();
    });
    expect(JSON.stringify(onToast.mock.calls)).not.toContain('raw-provider-payload');
    expect(container.textContent).not.toContain('credential-value');
    expect(onToast).toHaveBeenLastCalledWith('error', actionLabel === 'Connect'
      ? 'Buffer connection could not be saved. Verify the organization and credential environment, then try again.'
      : 'Buffer channels could not be synchronized. Verify the connection and try again.');
    act(() => root.unmount());
  });

  it.each(mutationRaceCases)(
    'settles $first→$second safely when $settlesFirst settles first (success $firstSucceeds/$secondSucceeds)',
    async ({ first, firstSucceeds, second, secondSucceeds, settlesFirst }) => {
      const pending = new Map<MutationName, ReturnType<typeof deferred<Response>>>();
      const onToast = vi.fn();
      let serverEnabled = true;
      let serverOrganization = 'synthetic-project-a-organization';
      let serverChannelCount = 1;
      const settingPayload = () => ({ settings: [{
        adapter_type: 'scheduler', credential: { detected: true, label: 'Credential reference env:PROJECT_A_KEY', secret_ref: 'env:PROJECT_A_KEY' },
        description: 'Composition foundation without publishing.', enabled: serverEnabled, health_status: 'configured', label: 'Buffer', provider: 'buffer', safe_config: { defaultMode: 'dry-run' }, updated_at: '2026-08-12T12:00:00.000Z',
      }] });
      const statusPayload = () => ({
        ...bufferStatus('project-a'),
        buffer_connection: { ...bufferStatus('project-a').buffer_connection, available_channel_count: serverChannelCount, channel_count: serverChannelCount, organization_id: serverOrganization },
      });
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (init?.method === 'POST') {
          const name: MutationName = path.includes('/connection') ? 'Connect' : path.includes('/channels') ? 'Sync channels' : 'toggle';
          const request = deferred<Response>();
          pending.set(name, request);
          return request.promise;
        }
        const payload = path.includes('/api/runtime') ? runtimePayload : path.includes('/api/adapters/status') ? statusPayload() : settingPayload();
        return Promise.resolve({ json: async () => payload, ok: true } as Response);
      }));
      const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
      await act(async () => { root.render(<SettingsView onToast={onToast} project="project-a" />); await settleReact(); });

      const trigger = async (name: MutationName) => {
        if (name === 'Connect') {
          setInputValue(container.querySelector('[aria-label="Buffer organization ID"]') as HTMLInputElement, 'synthetic-connected-organization');
        }
        const control = name === 'toggle'
          ? container.querySelector('[aria-label="Enable Buffer scheduling"]') as HTMLButtonElement
          : Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === name)!;
        expect(control.disabled).toBe(false);
        await act(async () => { control.click(); await settleReact(); });
      };
      await trigger(first);
      await trigger(second);

      const settle = async (name: MutationName, succeeds: boolean) => {
        if (succeeds) {
          if (name === 'Connect') serverOrganization = 'synthetic-connected-organization';
          if (name === 'Sync channels') serverChannelCount = 2;
          if (name === 'toggle') serverEnabled = false;
        }
        const setting = settingPayload().settings[0];
        pending.get(name)!.resolve({
          json: async () => succeeds ? (name === 'toggle' ? { setting } : { ok: true }) : { message: 'raw-provider-detail credential-value stack-detail' },
          ok: succeeds,
          status: succeeds ? 200 : 500,
        } as Response);
        await settleReact();
        await settleReact();
      };
      if (settlesFirst === 'first') {
        await act(async () => { await settle(first, firstSucceeds); });
        await act(async () => { await settle(second, secondSucceeds); });
      } else {
        await act(async () => { await settle(second, secondSucceeds); });
        await act(async () => { await settle(first, firstSucceeds); });
      }

      const toggle = container.querySelector('[aria-label="Enable Buffer scheduling"]') as HTMLButtonElement;
      const connect = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Connect')!;
      const sync = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Sync channels')!;
      expect(toggle.disabled).toBe(false);
      expect(toggle.getAttribute('aria-checked')).toBe(String(serverEnabled));
      expect(connect.disabled).toBe(false);
      expect(sync.disabled).toBe(!serverEnabled);
      expect(container.querySelector('.spin')).toBeNull();
      const expectedOrganization = !firstSucceeds && !secondSucceeds && [first, second].includes('Connect')
        ? 'synthetic-connected-organization'
        : serverOrganization;
      expect((container.querySelector('[aria-label="Buffer organization ID"]') as HTMLInputElement).value).toBe(expectedOrganization);
      expect(container.textContent).toContain(`${serverChannelCount} available / ${serverChannelCount} synced`);
      expect(JSON.stringify(onToast.mock.calls)).not.toMatch(/raw-provider-detail|credential-value|stack-detail/);
      act(() => root.unmount());
    },
  );

  it.each(adapterRaceCases)(
    'owns $first→$second toggles when $settlesFirst settles first (success $firstSucceeds/$secondSucceeds)',
    async ({ first, firstSucceeds, second, secondSucceeds, settlesFirst }) => {
      const pending = new Map<AdapterName, ReturnType<typeof deferred<Response>>>();
      const onToast = vi.fn();
      const enabled: Record<AdapterName, boolean> = { buffer: true, cloud: false, 'image-generator': true };
      const settingFor = (name: AdapterName) => name === 'cloud'
        ? { adapter_type: 'cloud', credential: { detected: false, label: 'Optional local cloud CLI credential', secret_ref: null }, description: 'Cloud inspection.', enabled: enabled.cloud, health_status: 'live_disabled', label: 'Amazon S3', provider: 's3', safe_config: { bucket: '', region: '' }, updated_at: '' }
        : name === 'buffer'
          ? { adapter_type: 'scheduler', credential: { detected: true, label: 'Credential reference env:PROJECT_A_KEY', secret_ref: 'env:PROJECT_A_KEY' }, description: 'Composition only.', enabled: enabled.buffer, health_status: 'configured', label: 'Buffer', provider: 'buffer', safe_config: { defaultMode: 'dry-run' }, updated_at: '' }
          : { adapter_type: 'image_generator', credential: { detected: true, label: 'No external secret required', secret_ref: null }, description: 'Generation handoff.', enabled: enabled['image-generator'], health_status: 'configured', label: 'Codex handoff', provider: 'codex-handoff', safe_config: { receipts: 'sqlite' }, updated_at: '' };
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (init?.method === 'POST') {
          const name: AdapterName = path.includes('/cloud/') ? 'cloud' : path.includes('/scheduler/') ? 'buffer' : 'image-generator';
          const request = deferred<Response>();
          pending.set(name, request);
          return request.promise;
        }
        const payload = path.includes('/api/runtime') ? runtimePayload : path.includes('/api/adapters/status') ? bufferStatus('project-a') : { settings: [settingFor('cloud'), settingFor('buffer'), settingFor('image-generator')] };
        return Promise.resolve({ json: async () => payload, ok: true } as Response);
      }));
      const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
      await act(async () => { root.render(<SettingsView onToast={onToast} project="project-a" />); await settleReact(); });

      const trigger = async (name: AdapterName) => {
        const control = container.querySelector(`[aria-label="${adapterControlLabels[name]}"]`) as HTMLButtonElement;
        expect(control.disabled).toBe(false);
        await act(async () => { control.click(); await settleReact(); });
      };
      await trigger(first);
      await trigger(second);

      const settle = async (name: AdapterName, succeeds: boolean) => {
        if (succeeds) enabled[name] = !enabled[name];
        pending.get(name)!.resolve({
          json: async () => succeeds ? { setting: settingFor(name) } : { message: 'raw-toggle-provider-detail credential-value stack-detail' },
          ok: succeeds,
          status: succeeds ? 200 : 500,
        } as Response);
        await settleReact();
        await settleReact();
      };
      if (settlesFirst === 'first') {
        await act(async () => { await settle(first, firstSucceeds); });
        await act(async () => { await settle(second, secondSucceeds); });
      } else {
        await act(async () => { await settle(second, secondSucceeds); });
        await act(async () => { await settle(first, firstSucceeds); });
      }

      for (const name of ['cloud', 'buffer', 'image-generator'] as const) {
        const control = container.querySelector(`[aria-label="${adapterControlLabels[name]}"]`) as HTMLButtonElement;
        expect(control.disabled).toBe(false);
        expect(control.getAttribute('aria-checked')).toBe(String(enabled[name]));
      }
      expect(JSON.stringify(onToast.mock.calls)).not.toMatch(/raw-toggle-provider-detail|credential-value|stack-detail/);
      act(() => root.unmount());
    },
  );
});
