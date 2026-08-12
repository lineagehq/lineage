import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentClaimSummary, LineageNode } from '../../shared/types';
import { LineageContextMenu } from './LineageContextMenu';

function flattenText(node: ReactNode): string {
  if (!node || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  const element = node as ReactElement<{ children?: ReactNode }>;
  return flattenText(element.props?.children);
}

function collectButtons(node: ReactNode): ReactElement[] {
  if (!node || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(collectButtons);
  const element = node as ReactElement<{ children?: ReactNode }>;
  const children = collectButtons(element.props?.children);
  return element.type === 'button' ? [element, ...children] : children;
}

const node = {
  asset_id: 'asset-1',
  is_latest: true,
  media_type: 'image',
  project: 'demo-project',
  review_state: 'unreviewed',
  source: 'local',
  status: 'planned',
  title: 'Variation A',
  user_selected: false,
} satisfies LineageNode;

const staleClaim = {
  agent_kind: 'codex',
  agent_name: 'Codex thread 123',
  created_at: '2026-06-26T00:00:00.000Z',
  derived_state: 'stale',
  expires_at: '2026-06-26T00:20:00.000Z',
  heartbeat_age_seconds: 960,
  heartbeat_at: '2026-06-26T00:00:12.000Z',
  id: 'claim_lineage',
  project: 'demo-project',
  scope_type: 'lineage_workspace',
  status: 'active',
  target_id: 'demo-project:lineage-workspace:root-asset',
} satisfies AgentClaimSummary;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LineageContextMenu', () => {
  it('offers use for next variation when the node is not selected', () => {
    const menu = LineageContextMenu(baseProps(node));

    expect(flattenText(menu)).toContain('Use for next variation');
  });

  it('offers remove from next variation when the node is selected', () => {
    const menu = LineageContextMenu(baseProps({ ...node, user_selected: true }));

    expect(flattenText(menu)).toContain('Remove from next variation');
  });

  it('shows selection full when the node is not selected and the cap is reached', () => {
    const menu = LineageContextMenu(baseProps(node, [], { selectionFull: true }));
    const selection = collectButtons(menu).find(button => flattenText(button) === 'Selection full');

    expect(selection?.props.disabled).toBe(true);
  });

  it('offers explicit replace and clear-all actions when another asset is selected', () => {
    const events: string[] = [];
    const menu = LineageContextMenu(baseProps(node, events, { selectedCount: 2, selectionFull: true }));
    const replace = collectButtons(menu).find(button => flattenText(button) === 'Replace selection');
    const clearAll = collectButtons(menu).find(button => flattenText(button) === 'Clear all next variation');

    replace?.props.onClick();
    clearAll?.props.onClick();

    expect(events).toEqual(['replace', 'close', 'clear-all', 'close']);
  });

  it('offers use-only and stale warning when a selected node is not latest', () => {
    const events: string[] = [];
    const menu = LineageContextMenu(baseProps({ ...node, is_latest: false, user_selected: true }, events, { selectedCount: 2 }));
    const useOnly = collectButtons(menu).find(button => flattenText(button) === 'Use only this for next variation');

    useOnly?.props.onClick();

    expect(flattenText(menu)).toContain('Selected but not latest');
    expect(events).toEqual(['replace', 'close']);
  });

  it('routes review actions and closes after selection', () => {
    const events: string[] = [];
    const menu = LineageContextMenu(baseProps(node, events));
    const reject = collectButtons(menu).find(button => flattenText(button) === 'Reject');

    reject?.props.onClick();

    expect(events).toEqual(['review:rejected', 'close']);
  });

  it('offers mark for re-roll separately from next variation selection', () => {
    const events: string[] = [];
    const menu = LineageContextMenu(baseProps(node, events));
    const reroll = collectButtons(menu).find(button => flattenText(button) === 'Mark for re-roll');

    reroll?.props.onClick();

    expect(flattenText(menu)).toContain('Use for next variation');
    expect(events).toEqual(['mark-reroll', 'close']);
  });

  it('offers clear re-roll request for pending re-roll nodes', () => {
    const events: string[] = [];
    const menu = LineageContextMenu(baseProps({
      ...node,
      reroll_request: {
        id: 'reroll-1',
        project_id: 'demo-project',
        root_asset_id: 'root-asset',
        node_asset_id: 'asset-1',
        status: 'pending',
        requested_by: 'human',
        created_at: '2026-07-07T00:00:00.000Z',
      },
    }, events));
    const clear = collectButtons(menu).find(button => flattenText(button) === 'Clear re-roll request');

    clear?.props.onClick();

    expect(events).toEqual(['clear-reroll', 'close']);
  });

  it('keeps re-roll, next variation, and review actions distinct', () => {
    const menu = LineageContextMenu(baseProps(node));
    const labels = collectButtons(menu).map(flattenText);

    expect(labels).toContain('Mark for re-roll');
    expect(labels).toContain('Use for next variation');
    expect(labels).toContain('Needs revision');
  });

  it('opens Social composition without changing the independent marker', () => {
    const events: string[] = [];
    const unmarkedMenu = LineageContextMenu(baseProps(node, events));
    collectButtons(unmarkedMenu).find(button => flattenText(button) === 'Open Social composition')?.props.onClick();
    const markedMenu = LineageContextMenu(baseProps({
      ...node,
      social_mark: {
        active: true,
        asset_id: node.asset_id,
        id: 'social-1',
        marked_at: '2026-07-25T00:00:00.000Z',
        marked_by: 'human:owner',
        project_id: node.project,
        root_asset_id: 'root-asset',
        updated_at: '2026-07-25T00:00:00.000Z',
      },
    }, events));
    collectButtons(markedMenu).find(button => flattenText(button) === 'Open Social composition')?.props.onClick();

    expect(events).toEqual(['toggle-social', 'close', 'toggle-social', 'close']);
  });

  it('keeps the context menu open when a protected Social transition is rejected', () => {
    const events: string[] = [];
    const menu = LineageContextMenu({ ...baseProps(node, events), onToggleSocial: () => false });
    collectButtons(menu).find(button => flattenText(button) === 'Open Social composition')?.props.onClick();
    expect(events).toEqual([]);
  });

  it('routes remove from lineage and closes after confirmation path starts', () => {
    const events: string[] = [];
    const menu = LineageContextMenu(baseProps(node, events));
    const remove = collectButtons(menu).find(button => flattenText(button) === 'Remove from lineage');

    remove?.props.onClick();

    expect(events).toEqual(['remove-lineage', 'close']);
  });

  it('disables remove from lineage for the root node', () => {
    const menu = LineageContextMenu(baseProps(node, [], { canRemoveFromLineage: false }));
    const remove = collectButtons(menu).find(button => flattenText(button) === 'Root cannot be removed');

    expect(remove?.props.disabled).toBe(true);
  });

  it('requires explicit confirmation before lineage claim release, transfer, and revoke controls run', () => {
    const events: string[] = [];
    const confirm = vi.fn(() => true);
    const prompt = vi.fn(() => 'handoff owner');
    vi.stubGlobal('window', { confirm, prompt });
    const menu = LineageContextMenu({
      ...baseProps(node, events),
      claims: [staleClaim],
      onClaimControl: (action, claim, body) => events.push(`${action}:${claim.id}:${body.reason || body.toAgentName}`),
    });

    collectButtons(menu).find(button => flattenText(button) === 'Release stale claim')?.props.onClick();
    collectButtons(menu).find(button => flattenText(button) === 'Transfer claim')?.props.onClick();
    collectButtons(menu).find(button => flattenText(button) === 'Revoke claim')?.props.onClick();

    expect(confirm).toHaveBeenCalledTimes(3);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      'release-stale:claim_lineage:Released stale lineage_workspace claim claim_lineage from the lineage context menu.',
      'transfer:claim_lineage:Transferred from lineage context menu.',
      'revoke:claim_lineage:handoff owner',
    ]);
  });
});

function baseProps(
  nextNode: LineageNode,
  events: string[] = [],
  options: { canRemoveFromLineage?: boolean; selectedCount?: number; selectionFull?: boolean } = {}
) {
  return {
    canRemoveFromLineage: options.canRemoveFromLineage ?? true,
    node: nextNode,
    onClearAllNext: () => events.push('clear-all'),
    onClearNext: () => events.push('clear'),
    onClearReroll: () => events.push('clear-reroll'),
    onClose: () => events.push('close'),
    onMarkReroll: () => events.push('mark-reroll'),
    onOpenDetail: () => events.push('detail'),
    onRemoveFromLineage: () => events.push('remove-lineage'),
    onReplaceNext: () => events.push('replace'),
    onReview: (reviewState: string) => events.push(`review:${reviewState}`),
    onSelectNext: () => events.push('select'),
    onToggleSocial: () => events.push('toggle-social'),
    position: { x: 20, y: 20 },
    selectedCount: options.selectedCount ?? (nextNode.user_selected ? 1 : 0),
    selectionFull: options.selectionFull ?? false,
  };
}
