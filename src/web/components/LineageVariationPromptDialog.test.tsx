// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineageNode } from '../../shared/types';
import { LineageVariationPromptDialog, variationPromptPosition } from './LineageVariationPromptDialog';

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe('LineageVariationPromptDialog', () => {
  it('submits an exact branch prompt with agent-neutral copy', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render('branch', onSubmit);
    const textarea = container.querySelector('textarea')!;
    let queue = button('Queue without prompt');

    expect(container.textContent).not.toContain('Codex');
    expect(container.textContent).toContain('What should your agent change?');
    expect(queue.disabled).toBe(false);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Restyle with a strict Swiss grid.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    queue = button('Queue branch');
    expect(queue.disabled).toBe(false);

    await act(async () => { queue.click(); });
    expect(onSubmit).toHaveBeenCalledWith('Restyle with a strict Swiss grid.');
  });

  it('queues a genuinely promptless branch when the user leaves the field blank', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render('branch', onSubmit);
    await act(async () => { button('Queue without prompt').click(); });
    expect(onSubmit).toHaveBeenCalledWith('');
    expect(container.textContent).toContain('your agent will ask');
  });

  it('shows the saved re-roll prompt when editing a queued attempt', () => {
    render('reroll', vi.fn(), 'Keep composition; repair the headline.');
    expect(container.querySelector('textarea')?.getAttribute('value')).toBe(null);
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Keep composition; repair the headline.');
    expect(container.textContent).toContain('New attempt');
    expect(button('Queue re-roll').disabled).toBe(false);
  });
});

describe('variationPromptPosition', () => {
  it('prefers the node right edge and flips left when space is tight', () => {
    expect(variationPromptPosition({ bottom: 200, left: 100, right: 300, top: 100 }, 1200, 800).left).toBe(314);
    expect(variationPromptPosition({ bottom: 200, left: 900, right: 1100, top: 100 }, 1200, 800).left).toBe(456);
  });
});

function render(mode: 'branch' | 'reroll', onSubmit: (prompt: string) => Promise<void> | void, initialPrompt = '') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(
    <LineageVariationPromptDialog initialPrompt={initialPrompt} mode={mode} node={node} onClose={vi.fn()} onSubmit={onSubmit} />,
  ));
}

function button(label: string) {
  return [...container.querySelectorAll('button')].find(item => item.textContent === label) as HTMLButtonElement;
}

const node: LineageNode = {
  asset_id: 'poster-a',
  is_latest: true,
  media_type: 'image',
  project: 'demo-project',
  review_state: 'unreviewed',
  source: 'local',
  status: 'working',
  title: 'Swiss poster',
  user_selected: false,
};
