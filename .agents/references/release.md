# Release and plugin installation

Read this for release preparation, publishing, or real-profile plugin installation.
The user must authorize the terminal action; existing authorization remains valid.

- Release versions are controlled only by pushing a new immutable annotated `v<package.json version>` tag for a reviewed commit already on `main`; never move or reuse a release tag, and require the tag-triggered Release workflow to fail closed unless every version lock and changelog entry matches before it publishes that exact version to npm (`latest` for stable SemVer and `next` for prerelease SemVer) and the matching GitHub Release.
- Root package, plugin package, plugin manifest, and `lineage.version` must match exactly; do not hard-code an older compatibility version in workflows or agent examples.
- A GitHub release must contain `lineage-codex-plugin-<version>.tgz` and its `.sha256` before npm publish or dist-tag mutation. The Release workflow builds, installs, attaches, and verifies these assets as one gated operation.
- Never install the plugin into the user's real Codex root during verification; use `npm run plugin:smoke`, which installs only into a temporary target.
- Do not infer activation from copied files. Use `npm run plugin:codex-smoke` before any real-profile install, then restart Codex and prove skill discovery in a brand-new task.
