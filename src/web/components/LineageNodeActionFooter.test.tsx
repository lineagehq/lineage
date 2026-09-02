// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LineageNodeActionFooter } from './LineageNodeActionFooter';
it('offers the same Edit action through the shared footer seam', () => {
  const node = { asset_id:'n', project:'p', source:'local', title:'Node', media_type:'image', status:'working', review_state:'unreviewed', is_latest:true, user_selected:false } as const;
  const onEdit = vi.fn(); const container = document.createElement('div'); const root = createRoot(container);
  const noop = () => {};
  act(() => root.render(<LineageNodeActionFooter canRemoveFromLineage node={node} onClearAllNext={noop} onClearNext={noop} onEdit={onEdit} onOpenNode={noop} onRemoveFromLineage={noop} onReplaceNext={noop} onReview={noop} onSelectNext={noop} onToast={noop} selectedCount={0} selectionFull={false} snapshot={{ project:'p',root_asset_id:'n',active_asset_id:'n',selected:[],selection:null,selections:[],latest:['n'],nodes:[node],edges:[],fetchedAt:'' }} />));
  act(() => (Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Edit') as HTMLButtonElement).click());
  expect(onEdit).toHaveBeenCalledWith(node); act(() => root.unmount());
});
