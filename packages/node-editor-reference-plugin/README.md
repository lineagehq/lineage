# Lineage node editor reference plugin

A deliberately small conformance example that imports only public exports from `@mean-weasel/lineage-node-editor-protocol`. It demonstrates negotiation, bootstrap exchange, single-use UI launch, document read, save proposal, proposal status, and terminal close against the in-memory fake host.

The package also contains a trusted-local reference host at `src/host.js`. It is an executable-only package asset, is intentionally absent from package exports, and is launched by Lineage only after the package archive, exact `manifest.json` bytes, and exact host bytes are receipt-verified. It binds loopback HTTP for authenticated health and shutdown control. This is not an operating-system sandbox and is not a public import API.

Its self-contained editor demonstrates protocol 1.3 document ingress without direct host authority: it verifies the parent-transferred SVG bytes, applies a visible SVG DOM edit, and returns serialized SVG through the canonical `lineage.node-editor.*` proposal message. The same file retains the negotiated 1.0–1.2 `reference.editor.*` compatibility path.
