// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineageRuntimeInfo } from '../../shared/runtimeInfoTypes';
import { buildAboutLineageDiagnostics } from '../aboutLineageDiagnostics';
import { lineageReleaseInfo } from '../releaseInfo';
import { AboutLineageDialog } from './AboutLineageDialog';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});

describe('AboutLineageDialog', () => {
  it('shows release and verified runtime identity without exposing local paths', () => {
    renderDialog();

    expect(dialog().textContent).toContain('About Lineage');
    expect(dialog().textContent).toContain(`v${lineageReleaseInfo.version}`);
    expect(dialog().textContent).toContain('development');
    expect(dialog().textContent).toContain('about-dialog-dev');
    expect(dialog().textContent).toContain('1234567890');
    expect(dialog().textContent).not.toContain('/private/');
    expect(link('GitHub repository')?.href).toBe('https://github.com/mean-weasel/lineage');
    expect(link('Documentation')?.href).toBe('https://lineage.neonwatty.com/docs/');
  });

  it('marks runtime values unavailable when identity cannot be trusted', () => {
    renderDialog({ runtimeIdentityUnavailable: true });

    expect(dialog().textContent).not.toContain('about-dialog-dev');
    expect(dialog().textContent?.match(/Unavailable/g)?.length).toBe(4);
  });

  it('copies a deliberately limited diagnostics summary', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderDialog();

    await act(async () => {
      button('Copy diagnostics')?.click();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('Profile: about-dialog-dev');
    expect(copied).toContain('Code origin: checkout');
    expect(copied).not.toContain('/private/');
    expect(copied).not.toContain('http://127.0.0.1');
    expect(button('Copied')).toBeTruthy();
  });

  it('locks scroll, traps focus, closes on Escape, and restores opener focus', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const returnFocusRef = { current: opener };
    const onClose = vi.fn(() => act(() => root.unmount()));
    renderDialog({ onClose, returnFocusRef });

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(button('Close About Lineage'));
    const first = button('Close About Lineage')!;
    const last = button('Copy diagnostics')!;
    last.focus();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' })));
    expect(document.activeElement).toBe(first);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('buildDiagnostics', () => {
  it('omits filesystem, database, asset root, and service details', () => {
    const diagnostics = buildAboutLineageDiagnostics(runtime, false);

    expect(diagnostics).toContain('Runtime channel: dev');
    expect(diagnostics).not.toContain(runtime.asset_root);
    expect(diagnostics).not.toContain(runtime.database.path);
    expect(diagnostics).not.toContain(runtime.profile.service_origin);
    expect(diagnostics).not.toContain(runtime.code?.root);
  });
});

function renderDialog(overrides: Partial<Parameters<typeof AboutLineageDialog>[0]> = {}) {
  act(() => {
    root.render(
      <AboutLineageDialog
        onClose={() => undefined}
        runtime={runtime}
        runtimeIdentityUnavailable={false}
        {...overrides}
      />
    );
  });
}

function dialog(): HTMLElement {
  return document.body.querySelector<HTMLElement>('[role="dialog"]')!;
}

function button(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
    .find(item => item.getAttribute('aria-label') === label || item.textContent === label);
}

function link(label: string): HTMLAnchorElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLAnchorElement>('a'))
    .find(item => item.textContent?.includes(label));
}

const runtime: LineageRuntimeInfo = {
  asset_root: '/private/assets',
  channel: 'dev',
  cli: { launcher: 'npm run lineage:dev --', runtime_selector: "--profile '/private/profile.json'" },
  code: {
    channel: 'dev',
    dirty: false,
    errors: [],
    fingerprint: 'fingerprint',
    git_sha: '1234567890abcdef',
    origin: 'checkout',
    package_version: '0.1.30',
    root: '/private/checkout',
    source_fingerprint: 'source-fingerprint',
    verified: true,
  },
  database: { exists: true, path: '/private/lineage.sqlite' },
  fetchedAt: '2026-07-29T00:00:00.000Z',
  package_name: '@mean-weasel/lineage',
  profile: {
    bound: true,
    environment: 'development',
    id: 'about-dialog-dev',
    service_origin: 'http://127.0.0.1:5302',
  },
  schema: {
    migration_keys: [],
    profile_environment: 'development',
    profile_id: 'about-dialog-dev',
  },
  version: '0.1.30',
};
