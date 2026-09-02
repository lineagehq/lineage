// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NodeEditorSessionDialog } from './NodeEditorSessionDialog';

const connect = vi.fn((_frame: HTMLIFrameElement, binding: string) => `http://127.0.0.1:1/editor/index.html#lineageChannelBinding=${binding}`);
vi.mock('./nodeEditorSessionController', () => ({ NodeEditorSessionController: class { snapshot(){ return { state:'active', message:'ready', launch:{ sessionId:'session-test', editorUrl:'http://127.0.0.1:1/editor/index.html', runtimeOrigin:'http://127.0.0.1:1' } }; } subscribe(listener: (value: unknown) => void){ listener(this.snapshot()); return () => {}; } acquire(){ return () => {}; } launch(){} close(){} requestClose(){ return true; } connect(frame: HTMLIFrameElement, binding: string){ return connect(frame, binding); } } }));
it('uses an opaque script-only iframe sandbox', () => {
  const container = document.createElement('div'); const root = createRoot(container);
  act(() => root.render(<NodeEditorSessionDialog node={{ asset_id:'n', project:'p', source:'local', title:'Node', media_type:'image', status:'working', review_state:'unreviewed', is_latest:true, user_selected:false }} project="p" rootAssetId="r" onClose={() => {}} onAccepted={() => {}} />));
  expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
  expect(container.querySelector('iframe')?.src).toContain('#lineageChannelBinding=');
  expect(connect).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
