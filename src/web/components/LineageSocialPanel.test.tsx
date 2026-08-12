// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineageNode } from '../../shared/types';
import type { SocialVariant, SocialWorkItem } from '../../shared/socialTypes';
import { ApiError, api } from '../api';
import { LineageSocialPanel } from './LineageSocialPanel';

vi.mock('../api', () => ({ ApiError: class ApiError extends Error { constructor(message: string, public status: number, public payload?: unknown) { super(message); } }, api: vi.fn() }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root?.unmount()); root = null; container?.remove(); container = null; vi.clearAllMocks(); });
const node: LineageNode = { asset_id: 'asset-1', checksum_sha256: 'abc123', is_latest: true, media_type: 'image', project: 'demo', review_state: 'approved', source: 'local', status: 'working', title: 'Source image', user_selected: false, social_mark: { active: true, asset_id: 'asset-1', id: 'mark-1', marked_at: '2026-08-12T00:00:00Z', marked_by: 'human', project_id: 'demo', root_asset_id: 'root-1', updated_at: '2026-08-12T00:00:00Z' } };
const channel = { channel_id: 'channel-1', service: 'instagram', display_name: 'Studio Instagram', timezone: 'America/Phoenix', disconnected: false, locked: false, paused: false, available: true, capability: { automatic: true, image_post: true, notification: true, scheduling_modes: ['customScheduled', 'addToQueue'], supported: true, reason: null }, synced_at: '2026-08-12T00:00:00Z', stale_at: null } as const;
function variant(revision = 1, copy = ''): SocialVariant { return { id: 'variant-1', item_id: 'item-1', project_id: 'demo', channel_id: 'channel-1', editorial_state: 'draft', active: true, current_revision: revision, created_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z', revision: { id: `revision-${revision}`, variant_id: 'variant-1', revision, copy, hashtags: [], hashtag_placement: 'caption', alt_text_reviewed: false, editorial_state: 'draft', publish_method: 'automatic', channel_fingerprint: 'fingerprint', revision_hash: `hash-${revision}`, created_by: 'human', created_at: '2026-08-12T00:00:00Z' } }; }
function persistedVariant(): SocialVariant { const value = variant(4, 'Persisted caption'); return { ...value, editorial_state: 'needs_review', revision: { ...value.revision, hashtags: [{ position: 0, value: 'first' }, { position: 1, value: 'second' }], hashtag_placement: 'first_comment', alt_text: 'Reviewed description', alt_text_reviewed: true, alt_text_reviewed_by: 'Editor', alt_text_reviewed_at: '2026-08-12T01:00:00Z', editorial_state: 'needs_review', publish_method: 'notification', composition_mode: 'customScheduled', custom_scheduled_at: '2026-08-15T09:30:00-07:00' } }; }
function item(variants: SocialVariant[] = []): SocialWorkItem { return { id: 'item-1', project_id: 'demo', root_asset_id: 'root-1', source_asset_id: 'asset-1', campaign_key: 'default', editorial_state: 'active', created_by: 'human', created_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z', variants }; }
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; }); return { promise, reject, resolve }; }

describe('LineageSocialPanel', () => {
  it('freezes editing and invalidates pending panel work while a transition transaction is locked', async () => {
    const promoted = deferred<{ schema_version: 'lineage.social_work_item.v1'; item: SocialWorkItem }>();
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.includes('/connection?')) return Promise.resolve({ ok: true, connection: { project: 'demo', organization_id: 'org-1', health_state: 'connected', channel_synced_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' } });
      if (path.includes('/channels?')) return Promise.resolve({ ok: true, channels: [channel] });
      if (path === '/api/social/items') return promoted.promise;
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    const render = (locked: boolean) => act(() => root!.render(createElement(LineageSocialPanel, { node, onClose: vi.fn(), onMark: vi.fn(), project: 'demo', rootAssetId: 'root-1', transitionLocked: locked })));
    render(false); await flush();
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Create or open work item')!.click());
    render(true); await flush();
    const panel = container.querySelector('[aria-label="Social composition"]')!;
    expect(panel.querySelector('[inert]')).not.toBeNull();
    expect(panel.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toContain('locked while the approved transition completes');
    await act(async () => promoted.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant()]) }));
    expect(container.textContent).not.toContain('Work item item-1');
    render(false); await flush();
    expect(panel.querySelector('[inert]')).toBeNull();
    expect(container.textContent).toContain('Open a work item');
  });

  it('keeps a newer campaign edit when a deferred promote response completes', async () => {
    const promoted = deferred<{ schema_version: 'lineage.social_work_item.v1'; item: SocialWorkItem }>();
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.includes('/connection?')) return Promise.resolve({ ok: true, connection: { project: 'demo', organization_id: 'org-1', health_state: 'connected', channel_synced_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' } });
      if (path.includes('/channels?')) return Promise.resolve({ ok: true, channels: [channel] });
      if (path === '/api/social/items') return promoted.promise;
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageSocialPanel, { node, onClose: vi.fn(), onMark: vi.fn(), project: 'demo', rootAssetId: 'root-1' })));
    await flush();
    const campaign = [...container.querySelectorAll('label')].find(label => label.textContent?.includes('Campaign key'))!.querySelector('input')!;
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Create or open work item')!.click());
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campaign, 'newer-campaign'); campaign.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => promoted.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant()]) }));
    expect(campaign.value).toBe('newer-campaign');
    expect(container.textContent).not.toContain('Work item item-1');
    expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Create or open work item')?.disabled).toBe(false);
  });

  it('invalidates catalog evidence immediately and keeps actions suspended after refresh failure', async () => {
    const refreshConnection = deferred<never>();
    const refreshChannels = deferred<never>();
    let catalogRound = 0;
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.includes('/connection?')) {
        catalogRound += 1;
        return catalogRound === 1 ? Promise.resolve({ ok: true, connection: { project: 'demo', organization_id: 'org-1', health_state: 'connected', channel_synced_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' } }) : refreshConnection.promise;
      }
      if (path.includes('/channels?')) return catalogRound === 1 ? Promise.resolve({ ok: true, channels: [channel] }) : refreshChannels.promise;
      if (path === '/api/social/items') return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant()]) });
      if (path === '/api/social/items/item-1/preflight') return Promise.resolve({ schema_version: 'lineage.social_validation.v1', item_id: 'item-1', valid: true, scheduled: false, issues: [] });
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageSocialPanel, { node, onClose: vi.fn(), onMark: vi.fn(), project: 'demo', rootAssetId: 'root-1' })));
    await flush();
    const click = (text: string) => act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === text)!.click());
    click('Create or open work item'); await flush(); click('Validate composition'); await flush();
    expect(container.textContent).toContain('Composition is valid');
    click('Refresh channel evidence'); await flush();
    expect(container.textContent).not.toContain('Composition is valid');
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.matches(':disabled')).toBe(true);
    expect(container.textContent).toContain('Channel evidence is loading or unavailable.');
    await act(async () => refreshConnection.reject(new Error('Catalog refresh failed')));
    await flush();
    expect(container.textContent).toContain('Catalog refresh failed');
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.matches(':disabled')).toBe(true);
    expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Refresh channel evidence')?.disabled).toBe(false);
    refreshChannels.reject(new Error('superseded channel failure'));
  });

  it('composes and persists a server-authoritative revision without any delivery affordance', async () => {
    const apiMock = vi.mocked(api);
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path.startsWith('/api/adapters/buffer/connection?')) return Promise.resolve({ ok: true, connection: { project: 'demo', organization_id: 'org-1', health_state: 'connected', channel_synced_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' } });
      if (path.startsWith('/api/adapters/buffer/channels?')) return Promise.resolve({ ok: true, channels: [channel, { ...channel, channel_id: 'stale', display_name: 'Old channel', available: false, paused: true, capability: { ...channel.capability, image_post: false }, stale_at: '2026-08-11T00:00:00Z' }] });
      if (path === '/api/social/items') return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item() });
      if (path === '/api/social/items/item-1/variants') return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant()]) });
      if (path === '/api/social/variants/variant-1/edit') {
        const body = JSON.parse(String(options?.body));
        expect(body).toMatchObject({ expectedRevision: 1, copy: 'A considered caption', hashtags: ['first', 'second'], hashtagPlacement: 'first_comment', altTextReviewed: true, altTextReviewedBy: 'Editor', editorialState: 'needs_review', publishMethod: 'notification', compositionMode: 'customScheduled', customScheduledAt: '2026-08-15T09:30:00-07:00' });
        return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant(2, body.copy)]) });
      }
      if (path === '/api/social/items/item-1/preflight') return Promise.resolve({ schema_version: 'lineage.social_validation.v1', item_id: 'item-1', valid: true, scheduled: false, issues: [] });
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageSocialPanel, { node, onClose: vi.fn(), onMark: vi.fn(), project: 'demo', rootAssetId: 'root-1' })));
    await flush();
    expect(container.textContent).toContain('Nothing here schedules or sends a post.');
    const click = (text: string) => act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === text)!.click());
    click('Create or open work item'); await flush();
    expect(container.textContent).toContain('Stale channel; sync in Settings.');
    expect(container.textContent).toContain('Queue is paused.');
    expect(container.textContent).toContain('Image composition capability is unavailable.');
    expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Add variant' && button.disabled)).toBeTruthy();
    click('Add variant'); await flush();
    const field = (label: string) => [...container!.querySelectorAll('label')].find(element => element.textContent?.includes(label))!.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')!;
    const change = (label: string, value: string) => { const input = field(label); act(() => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('change', { bubbles: true })); }); };
    change('Caption', 'A considered caption'); change('Ordered hashtags', 'first\nsecond'); change('Hashtag placement', 'first_comment'); change('Alt text', 'A clear scene description');
    act(() => { const checkbox = field('Human-reviewed alt text') as HTMLInputElement; checkbox.click(); });
    change('Reviewer', 'Editor'); change('Editorial state', 'needs_review');
    act(() => { const notification = [...container!.querySelectorAll<HTMLInputElement>('input[type="radio"]')][1]; notification.click(); });
    change('Composition timing intent', 'customScheduled'); change('Exact zoned time', '2026-08-15T09:30:00-07:00');
    expect(container.textContent).toContain('Unsaved composition changes');
    click('Save composition revision'); await flush(); expect(container.textContent).toContain('r2');
    click('Validate composition'); await flush(); expect(container.textContent).toContain('Composition is valid'); expect(container.textContent).toContain('No scheduling or sending has occurred.');
    change('Caption', 'Validation must now be stale');
    expect(container.textContent).not.toContain('Composition is valid');
    expect(container.textContent?.toLowerCase()).not.toContain('publish now');
  });

  it('reports disconnected and conflict states accessibly', async () => {
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.includes('/connection?')) return Promise.resolve({ ok: true, connection: null });
      if (path.includes('/channels?')) return Promise.resolve({ ok: true, channels: [] });
      return Promise.reject(new ApiError('revision changed', 409, {}));
    });
    const markedWithNoItem = node;
    const onClose = vi.fn(); vi.spyOn(window, 'confirm').mockReturnValue(false);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageSocialPanel, { node: markedWithNoItem, onClose, onMark: vi.fn(), project: 'demo', rootAssetId: 'root-1' })));
    await flush();
    expect(container.textContent).toContain('Buffer is disconnected');
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Create or open work item')!.click()); await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Conflict: revision changed');
  });

  it('preserves the local draft while loading a newer conflict revision and requires deliberate retry', async () => {
    let editCalls = 0;
    let catalogCalls = 0;
    vi.mocked(api).mockImplementation((path: string, options?: RequestInit) => {
      if (path.includes('/connection?')) { catalogCalls += 1; return Promise.resolve({ ok: true, connection: { project: 'demo', organization_id: 'org-1', health_state: 'connected', channel_synced_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' } }); }
      if (path.includes('/channels?')) return Promise.resolve({ ok: true, channels: [channel] });
      if (path === '/api/social/items') return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant(1, 'Server caption')]) });
      if (path.startsWith('/api/social/items/item-1?')) return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant(editCalls + 1, 'Another editor')]) });
      if (path === '/api/social/variants/variant-1/edit') {
        editCalls += 1;
        const body = JSON.parse(String(options?.body));
        if (editCalls <= 2) return Promise.reject(new ApiError(`expected ${editCalls}, current ${editCalls + 1}`, 409, {}));
        expect(body.expectedRevision).toBe(3);
        expect(body.copy).toBe('My local draft');
        return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant(4, body.copy)]) });
      }
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageSocialPanel, { node, onClose: vi.fn(), onMark: vi.fn(), project: 'demo', rootAssetId: 'root-1' })));
    await flush();
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Create or open work item')!.click()); await flush();
    const caption = [...container.querySelectorAll('label')].find(label => label.textContent?.includes('Caption'))!.querySelector('textarea')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(caption, 'My local draft'); caption.dispatchEvent(new Event('change', { bubbles: true })); });
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Save composition revision')!.click()); await flush();
    expect(caption.value).toBe('My local draft');
    expect(container.textContent).toContain('Latest server concurrency state: r2');
    expect(container.textContent).toContain('Retry save against r2');
    expect(editCalls).toBe(1);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Refresh catalog')!.click());
    expect(catalogCalls).toBe(1); expect(caption.value).toBe('My local draft');
    confirm.mockReturnValue(true);
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Refresh catalog')!.click()); await flush();
    expect(catalogCalls).toBe(2); expect(caption.value).toBe('My local draft');
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Retry save against r2')!.click()); await flush();
    expect(editCalls).toBe(2);
    expect(container.textContent).toContain('Retry save against r3');
    expect(caption.value).toBe('My local draft');
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Retry save against r3')!.click()); await flush();
    expect(editCalls).toBe(3); expect(container.textContent).toContain('r4');
  });

  it('guards dirty add-variant transitions and keeps newer edits ahead of late save and validation responses', async () => {
    const saveResponse = deferred<{ schema_version: 'lineage.social_work_item.v1'; item: SocialWorkItem }>();
    const addResponse = deferred<{ schema_version: 'lineage.social_work_item.v1'; item: SocialWorkItem }>();
    const validationResponse = deferred<{ schema_version: 'lineage.social_validation.v1'; item_id: string; valid: boolean; scheduled: false; issues: [] }>();
    const secondChannel = { ...channel, channel_id: 'channel-2', display_name: 'Second channel' };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    let addCalls = 0;
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.includes('/connection?')) return Promise.resolve({ ok: true, connection: { project: 'demo', organization_id: 'org-1', health_state: 'connected', channel_synced_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' } });
      if (path.includes('/channels?')) return Promise.resolve({ ok: true, channels: [channel, secondChannel] });
      if (path === '/api/social/items') return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant(1, 'Original')]) });
      if (path === '/api/social/items/item-1/variants') { addCalls += 1; return addResponse.promise; }
      if (path === '/api/social/variants/variant-1/edit') return saveResponse.promise;
      if (path === '/api/social/items/item-1/preflight') return validationResponse.promise;
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageSocialPanel, { node, onClose: vi.fn(), onMark: vi.fn(), project: 'demo', rootAssetId: 'root-1' })));
    await flush(); act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Create or open work item')!.click()); await flush();
    const caption = [...container.querySelectorAll('label')].find(label => label.textContent?.includes('Caption'))!.querySelector('textarea')!;
    const changeCaption = (value: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(caption, value); caption.dispatchEvent(new Event('change', { bubbles: true })); });
    changeCaption('Protected draft');
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Add variant')!.click());
    expect(addCalls).toBe(0); expect(caption.value).toBe('Protected draft');
    confirm.mockReturnValue(true);
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Save composition revision')!.click());
    changeCaption('Newer while saving');
    await act(async () => saveResponse.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant(2, 'Protected draft')]) }));
    expect(caption.value).toBe('Newer while saving'); expect(container.textContent).toContain('Unsaved composition changes');
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Add variant')!.click());
    changeCaption('Newer while adding');
    await act(async () => addResponse.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant(1, 'Original'), { ...variant(), id: 'variant-2', channel_id: 'channel-2' }]) }));
    expect(addCalls).toBe(1); expect(caption.value).toBe('Newer while adding'); expect(container.textContent).toContain('Unsaved composition changes');
    changeCaption('Guard selection'); confirm.mockReturnValue(false);
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent?.startsWith('Second channel ·'))!.click());
    expect(caption.value).toBe('Guard selection');
    confirm.mockReturnValue(true);
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent?.startsWith('Second channel ·'))!.click());
    expect(caption.value).toBe('');
  });

  it('does not restore obsolete validation and blocks an invalid existing variant with associated reasons', async () => {
    const validationResponse = deferred<{ schema_version: 'lineage.social_validation.v1'; item_id: string; valid: boolean; scheduled: false; issues: [] }>();
    const blockedChannel = { ...channel, available: false, disconnected: true, locked: true, paused: true, stale_at: '2026-08-11T00:00:00Z', capability: { ...channel.capability, supported: false, image_post: false, automatic: false, scheduling_modes: [] as never[], reason: 'Unsupported service.' } };
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.includes('/connection?')) return Promise.resolve({ ok: true, connection: { project: 'demo', organization_id: 'org-1', health_state: 'connected', channel_synced_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' } });
      if (path.includes('/channels?')) return Promise.resolve({ ok: true, channels: [channel] });
      if (path === '/api/social/items') return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant(1, 'Original')]) });
      if (path === '/api/social/items/item-1/preflight') return validationResponse.promise;
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageSocialPanel, { node, onClose: vi.fn(), onMark: vi.fn(), project: 'demo', rootAssetId: 'root-1' })));
    await flush(); act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Create or open work item')!.click()); await flush();
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Validate composition')!.click());
    const caption = [...container.querySelectorAll('label')].find(label => label.textContent?.includes('Caption'))!.querySelector('textarea')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(caption, 'Newer draft'); caption.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => validationResponse.resolve({ schema_version: 'lineage.social_validation.v1', item_id: 'item-1', valid: true, scheduled: false, issues: [] }));
    expect(container.textContent).not.toContain('Composition is valid');
    expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Save composition revision')?.disabled).toBe(false);

    vi.mocked(api).mockImplementation((path: string) => {
      if (path.includes('/connection?')) return Promise.resolve({ ok: true, connection: { project: 'demo', organization_id: 'org-1', health_state: 'connected', channel_synced_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' } });
      if (path.includes('/channels?')) return Promise.resolve({ ok: true, channels: [blockedChannel] });
      if (path === '/api/social/items') return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant(1, 'Original')]) });
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    act(() => root!.render(createElement(LineageSocialPanel, { key: 'blocked', node, onClose: vi.fn(), onMark: vi.fn(), project: 'demo', rootAssetId: 'root-1' })));
    await flush(); act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Create or open work item')!.click()); await flush();
    const reasons = container.querySelector('#social-selected-variant-reasons')!;
    expect(reasons.textContent).toContain('Channel evidence is stale'); expect(reasons.textContent).toContain('Channel is disconnected'); expect(reasons.textContent).toContain('Image composition capability is unavailable');
    expect(container.querySelector<HTMLTextAreaElement>('textarea')!.matches(':disabled')).toBe(true);
    const save = [...container.querySelectorAll('button')].find(button => button.textContent === 'Save composition revision')!;
    expect(save.disabled).toBe(true); expect(save.getAttribute('aria-describedby')).toBe('social-selected-variant-reasons');
  });

  it('clears busy state and suppresses stale validation errors after identity invalidation and unmount', async () => {
    const validationError = deferred<never>();
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.includes('/connection?')) return Promise.resolve({ ok: true, connection: { project: 'demo', organization_id: 'org-1', health_state: 'connected', channel_synced_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' } });
      if (path.includes('/channels?')) return Promise.resolve({ ok: true, channels: [channel] });
      if (path === '/api/social/items') return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant(1, 'Original')]) });
      if (path === '/api/social/items/item-1/preflight') return validationError.promise;
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageSocialPanel, { node, onClose: vi.fn(), onMark: vi.fn(), project: 'demo', rootAssetId: 'root-1' })));
    await flush(); act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Create or open work item')!.click()); await flush();
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Validate composition')!.click());
    const caption = container.querySelector('textarea')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(caption, 'Invalidate request'); caption.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => validationError.reject(new Error('Validation failed late')));
    await flush();
    expect(container.textContent).not.toContain('Validation failed late');
    expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Save composition revision')?.disabled).toBe(false);
    act(() => root!.unmount()); root = null;
  });

  it('invalidates validation and clears busy state after variant and catalog identity changes', async () => {
    const firstValidation = deferred<{ schema_version: 'lineage.social_validation.v1'; item_id: string; valid: boolean; scheduled: false; issues: [] }>();
    const secondValidation = deferred<{ schema_version: 'lineage.social_validation.v1'; item_id: string; valid: boolean; scheduled: false; issues: [] }>();
    let validationCall = 0;
    const secondChannel = { ...channel, channel_id: 'channel-2', display_name: 'Second channel' };
    const secondVariant = { ...variant(), id: 'variant-2', channel_id: 'channel-2' };
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.includes('/connection?')) return Promise.resolve({ ok: true, connection: { project: 'demo', organization_id: 'org-1', health_state: 'connected', channel_synced_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' } });
      if (path.includes('/channels?')) return Promise.resolve({ ok: true, channels: [channel, secondChannel] });
      if (path === '/api/social/items') return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant(1, 'First'), secondVariant]) });
      if (path === '/api/social/items/item-1/preflight') return (++validationCall === 1 ? firstValidation : secondValidation).promise;
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    const render = (project = 'demo') => act(() => root!.render(createElement(LineageSocialPanel, { node, onClose: vi.fn(), onMark: vi.fn(), project, rootAssetId: 'root-1' })));
    render(); await flush(); act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Create or open work item')!.click()); await flush();
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Validate composition')!.click());
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent?.startsWith('Second channel ·'))!.click());
    await act(async () => firstValidation.resolve({ schema_version: 'lineage.social_validation.v1', item_id: 'item-1', valid: true, scheduled: false, issues: [] }));
    expect(container.textContent).not.toContain('Composition is valid');
    expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Validate composition')?.disabled).toBe(false);
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Validate composition')!.click());
    render('demo-2'); await flush();
    await act(async () => secondValidation.resolve({ schema_version: 'lineage.social_validation.v1', item_id: 'item-1', valid: true, scheduled: false, issues: [] }));
    expect(container.textContent).not.toContain('Composition is valid');
    expect(container.textContent).not.toContain('Loading Social connection and channels');
  });

  it('preserves intervening edits, selection, baseline dirtiness, and parent signal after deferred reload', async () => {
    const reloadResponse = deferred<{ schema_version: 'lineage.social_work_item.v1'; item: SocialWorkItem }>();
    const onDirtyChange = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.includes('/connection?')) return Promise.resolve({ ok: true, connection: { project: 'demo', organization_id: 'org-1', health_state: 'connected', channel_synced_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' } });
      if (path.includes('/channels?')) return Promise.resolve({ ok: true, channels: [channel] });
      if (path === '/api/social/items') return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant(1, 'Original')]) });
      if (path === '/api/social/variants/variant-1/edit') return Promise.reject(new Error('Temporary save failure'));
      if (path.startsWith('/api/social/items/item-1?')) return reloadResponse.promise;
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root!.render(createElement(LineageSocialPanel, { node, onClose: vi.fn(), onDirtyChange, onMark: vi.fn(), project: 'demo', rootAssetId: 'root-1' })));
    await flush(); act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Create or open work item')!.click()); await flush();
    const caption = container.querySelector('textarea')!;
    const changeCaption = (value: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(caption, value); caption.dispatchEvent(new Event('change', { bubbles: true })); });
    changeCaption('Draft before reload');
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Save composition revision')!.click()); await flush();
    act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Reload work item')!.click());
    changeCaption('Newer during reload');
    await act(async () => reloadResponse.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([variant(2, 'Server reload')]) }));
    expect(caption.value).toBe('Newer during reload');
    expect(container.querySelector('[aria-current="true"]')?.textContent).toContain('r2');
    expect(container.textContent).toContain('Unsaved composition changes');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('rehydrates every persisted composition field after close and reopen', async () => {
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.includes('/connection?')) return Promise.resolve({ ok: true, connection: { project: 'demo', organization_id: 'org-1', health_state: 'connected', channel_synced_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' } });
      if (path.includes('/channels?')) return Promise.resolve({ ok: true, channels: [channel] });
      if (path === '/api/social/items') return Promise.resolve({ schema_version: 'lineage.social_work_item.v1', item: item([persistedVariant()]), idempotent: true });
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    const renderPanel = (key: string) => act(() => root!.render(createElement(LineageSocialPanel, { key, node, onClose: vi.fn(), onMark: vi.fn(), project: 'demo', rootAssetId: 'root-1' })));
    renderPanel('first'); await flush(); act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Create or open work item')!.click()); await flush();
    renderPanel('reopened'); await flush(); act(() => [...container!.querySelectorAll('button')].find(button => button.textContent === 'Create or open work item')!.click()); await flush();
    const inputs = [...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')];
    expect(inputs.some(input => input.value === 'Persisted caption')).toBe(true);
    expect(inputs.some(input => input.value === 'first\nsecond')).toBe(true);
    expect(inputs.some(input => input.value === 'first_comment')).toBe(true);
    expect(inputs.some(input => input.value === 'Reviewed description')).toBe(true);
    expect(inputs.some(input => input.value === 'Editor')).toBe(true);
    expect(inputs.some(input => input.value === 'needs_review')).toBe(true);
    expect(inputs.some(input => input.value === 'customScheduled')).toBe(true);
    expect(inputs.some(input => input.value === '2026-08-15T09:30:00-07:00')).toBe(true);
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(input => input.checked)?.parentElement?.textContent).toContain('Notification');
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
  });
});
