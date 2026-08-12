// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderedCollection } from './OrderedCollection';

let container: HTMLDivElement;
let root: Root;

describe('OrderedCollection', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('uses the same item order in card and list presentations', () => {
    render('cards');
    expect(labels()).toEqual(['Alpha', 'Beta', 'Gamma']);

    render('list');
    expect(labels()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('supports keyboard pickup, cross-page targeting, drop, and announcements', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render('list', onMove, { page: 2, pageSize: 3, total: 9 });
    const handle = button('Reorder Alpha');

    act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    act(() => button('Reorder Alpha').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    await act(async () => {
      button('Reorder Alpha').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });

    expect(onMove).toHaveBeenCalledWith('a', 0);
    expect(container.textContent).toContain('Alpha dropped at position 1 of 9');
  });

  it('cancels keyboard reordering without writing', () => {
    const onMove = vi.fn();
    render('cards', onMove);
    const handle = button('Reorder Beta');

    act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    act(() => button('Reorder Beta').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    expect(labels()).toEqual(['Beta', 'Alpha', 'Gamma']);

    act(() => button('Reorder Beta').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(labels()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(onMove).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Cancelled moving Beta');
  });

  it('disables all handles with a visible explanation when order is ambiguous', () => {
    render('cards', vi.fn(), { reorderEnabled: false, reorderDisabledReason: 'Clear search to reorder.' });

    expect(button('Reorder Alpha').disabled).toBe(true);
    expect(container.textContent).toContain('Clear search to reorder.');
  });

  it('offers bounded touch-friendly move controls without making the card itself draggable', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render('cards', onMove, { page: 2, pageSize: 3, total: 9 });

    await act(async () => {
      button('Move Alpha earlier').click();
      await Promise.resolve();
    });
    expect(onMove).toHaveBeenCalledWith('a', 2);
    expect(container.textContent).toContain('Alpha dropped at position 3 of 9');
    expect(container.querySelector('[draggable="true"]')).toBeNull();
  });

  it('announces a stale mobile move failure and restores the source order', async () => {
    const onMove = vi.fn().mockRejectedValue(new Error('Collection changed; refresh and try again.'));
    render('cards', onMove);

    await act(async () => {
      button('Move Beta earlier').click();
      await settle();
    });

    expect(labels()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(container.textContent).toContain('Beta was not moved. Collection changed; refresh and try again.');
  });

  it('keeps the optimistic order in place until the reorder request finishes', async () => {
    let resolveMove!: () => void;
    const onMove = vi.fn(() => new Promise<void>(resolve => {
      resolveMove = resolve;
    }));
    render('list', onMove);
    const handle = button('Reorder Beta');

    act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    act(() => button('Reorder Beta').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    expect(labels()).toEqual(['Beta', 'Alpha', 'Gamma']);

    await act(async () => {
      button('Reorder Beta').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    expect(labels()).toEqual(['Beta', 'Alpha', 'Gamma']);

    await act(async () => {
      resolveMove();
      await Promise.resolve();
    });
  });

  it('opens from the item surface without hijacking its accessible controls', () => {
    const onOpen = vi.fn();
    render('list', vi.fn(), { onOpen });
    const alpha = container.querySelector<HTMLElement>('[data-ordered-id="a"]')!;

    act(() => alpha.querySelector<HTMLElement>('[data-label]')!.click());
    expect(onOpen).toHaveBeenCalledWith(items[0]);

    act(() => button('Reorder Alpha').click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(alpha.tabIndex).toBe(-1);
    expect(alpha.getAttribute('role')).toBe('listitem');
  });

  it('resyncs to a different collection while an earlier reorder is pending', async () => {
    let resolveMove!: () => void;
    const onMove = vi.fn(() => new Promise<void>(resolve => {
      resolveMove = resolve;
    }));
    render('list', onMove);
    const handle = button('Reorder Beta');
    act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    act(() => button('Reorder Beta').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    act(() => button('Reorder Beta').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));

    render('list', onMove, {
      items: [
        { id: 'x', label: 'Xray' },
        { id: 'y', label: 'Yankee' },
      ],
      total: 2,
    });
    expect(labels()).toEqual(['Xray', 'Yankee']);

    await act(async () => {
      resolveMove();
      await Promise.resolve();
    });
  });

  it('describes the complete keyboard reorder contract from every enabled handle', () => {
    render('cards');
    const handle = button('Reorder Alpha');
    const description = document.getElementById(handle.getAttribute('aria-describedby') || '');

    expect(handle.getAttribute('aria-keyshortcuts')).toContain('Home');
    expect(description?.textContent).toContain('Space or Enter to pick up');
    expect(description?.textContent).toContain('Escape to cancel');
  });
});

function render(
  presentation: 'cards' | 'list',
  onMove = vi.fn(),
  overrides: Partial<React.ComponentProps<typeof OrderedCollection<Item>>> = {}
) {
  act(() => {
    root.render(
      <OrderedCollection
        ariaLabel="Test items"
        empty="Empty"
        itemId={item => item.id}
        itemLabel={item => item.label}
        items={items}
        onMove={onMove}
        page={1}
        pageSize={3}
        presentation={presentation}
        renderItem={item => <span data-label>{item.label}</span>}
        reorderEnabled
        total={3}
        {...overrides}
      />
    );
  });
}

function labels() {
  return Array.from(container.querySelectorAll('[data-label]')).map(item => item.textContent);
}

function button(label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(item => item.getAttribute('aria-label') === label)!;
}

async function settle() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

interface Item {
  id: string;
  label: string;
}

const items: Item[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
];
