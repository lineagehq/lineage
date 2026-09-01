import { referenceManifest, runReferenceFlow } from '../src/index.js';
import type { FakeNodeEditorHost } from '@mean-weasel/lineage-node-editor-protocol/fake-host';

declare const host: FakeNodeEditorHost;
void referenceManifest;
void runReferenceFlow(host);
