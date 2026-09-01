# Lineage node editor reference plugin

A deliberately small conformance example that imports only public exports from `@mean-weasel/lineage-node-editor-protocol`. It demonstrates negotiation, bootstrap exchange, single-use UI launch, document read, save proposal, proposal status, and terminal close against the in-memory fake host.

The package also contains a trusted-local reference host at `src/host.js`. It is an executable-only package asset, is intentionally absent from package exports, and is launched by Lineage only after the package archive, exact `manifest.json` bytes, and exact host bytes are receipt-verified. It binds loopback HTTP for authenticated health and shutdown control. This is not an operating-system sandbox and is not a public import API.
