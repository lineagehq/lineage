import { useEffect, useMemo, useRef, useState } from 'react';
import type { LineageNode } from '../../shared/types';
import { NodeEditorSessionController, type NodeEditorControllerSnapshot } from './nodeEditorSessionController';
import './NodeEditorSessionDialog.css';

export function NodeEditorSessionDialog({ node, project, rootAssetId, onClose, onAccepted }: { node: LineageNode; project: string; rootAssetId: string; onClose: () => void; onAccepted: () => Promise<void> | void }) {
  const controller = useMemo(() => new NodeEditorSessionController({ project, rootAssetId, nodeAssetId: node.asset_id }), [project, rootAssetId, node.asset_id]);
  const [snapshot, setSnapshot] = useState<NodeEditorControllerSnapshot>(controller.snapshot());
  const frame = useRef<HTMLIFrameElement>(null);
  const connectedSession = useRef('');
  const channelBinding = useMemo(() => crypto.randomUUID(), [controller]);
  useEffect(() => controller.subscribe(setSnapshot), [controller]);
  useEffect(() => { const release = controller.acquire(); void controller.launch(); return release; }, [controller]);
  useEffect(() => { if (snapshot.state === 'accepted') void onAccepted(); }, [snapshot.state, onAccepted]);
  useEffect(() => {
    if (!snapshot.launch || !frame.current || connectedSession.current === snapshot.launch.sessionId) return;
    connectedSession.current = snapshot.launch.sessionId;
    frame.current.src = controller.connect(frame.current, channelBinding);
  }, [channelBinding, controller, snapshot.launch]);
  const terminal = ['accepted', 'cancelled', 'stale', 'expired', 'failed'].includes(snapshot.state);
  async function close() {
    if (!terminal && snapshot.state === 'saving' && !confirm('An edit is still saving. Close anyway?')) return;
    if (await controller.requestClose()) onClose();
  }
  return <div className="node-editor-backdrop">
    <section aria-labelledby="node-editor-title" aria-modal="true" className="node-editor-dialog" role="dialog">
      <header><div><h2 id="node-editor-title">Edit {node.title}</h2><p role="status">{snapshot.message}</p></div><button onClick={() => void close()} type="button">Close</button></header>
      {snapshot.launch && <iframe ref={frame} sandbox="allow-scripts" title={`${snapshot.plugin?.contribution.displayName || 'Node'} editor`} />}
      {terminal && <footer>{snapshot.state === 'failed' && <button onClick={() => void controller.launch()} type="button">Retry</button>}<button onClick={() => void close()} type="button">Done</button></footer>}
    </section>
  </div>;
}
