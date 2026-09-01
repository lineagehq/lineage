# Lineage node editor protocol

Schema-first protocol artifacts for independently maintained Lineage node editor plugins. JSON Schema 2020-12 in `schemas/` is authoritative; `generated/protocol.d.ts` is deterministic generated output.

The package exposes strict validators, semantic protocol negotiation, canonical conformance fixtures, and a bounded in-memory fake host. The fake host models authority separation but is not a process supervisor or security sandbox.

```js
import { negotiateProtocol, validateManifest } from '@mean-weasel/lineage-node-editor-protocol';
import { FakeNodeEditorHost } from '@mean-weasel/lineage-node-editor-protocol/fake-host';
```
