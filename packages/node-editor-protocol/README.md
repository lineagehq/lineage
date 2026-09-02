# Lineage node editor protocol

Schema-first protocol artifacts for independently maintained Lineage node editor plugins. JSON Schema 2020-12 in `schemas/` is authoritative; `generated/protocol.d.ts` is deterministic generated output.

The package exposes strict validators, semantic protocol negotiation, canonical conformance fixtures, and a bounded in-memory fake host. The fake host models authority separation but is not a process supervisor or security sandbox.

Protocol 1.3 adds the `document-content` feature and the canonical `lineage.node-editor.*` browser MessageChannel namespace. A 1.3 host fetches session-authorized source bytes itself, verifies the immutable size and SHA-256 metadata, and transfers the bounded `ArrayBuffer` to the isolated editor. Editors never receive session credentials, filesystem paths, content URLs, or general fetch authority. Negotiated protocol 1.0–1.2 sessions retain their legacy bridge vocabulary.

```js
import { negotiateProtocol, validateManifest } from '@mean-weasel/lineage-node-editor-protocol';
import { FakeNodeEditorHost } from '@mean-weasel/lineage-node-editor-protocol/fake-host';
```
