import type { FakeNodeEditorHost } from '@mean-weasel/lineage-node-editor-protocol/fake-host';
import type { PluginManifest, ProxyResult } from '@mean-weasel/lineage-node-editor-protocol';

export declare const referenceManifest: Readonly<PluginManifest>;
export declare const referenceHostSupport: ReadonlyArray<Readonly<Record<string, unknown>>>;
export declare function runReferenceFlow(host: FakeNodeEditorHost): {
  negotiated: Record<string, unknown>;
  ui: Record<string, unknown>;
  read: ProxyResult;
  proposal: ProxyResult;
  status: ProxyResult;
  closed: ProxyResult;
  trace: Array<Record<string, unknown>>;
};
