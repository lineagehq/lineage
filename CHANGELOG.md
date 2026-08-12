# Changelog

## Unreleased

## 0.1.35

- Redesign Canvas-to-Workspaces navigation and contextual controls so destinations and actions read clearly across desktop and mobile layouts.
- Add Canvas-scoped Discussion flags with optional notes, editing, keyboard access, CLI and API support, lifecycle cleanup, and agent-readable handoff context.
- Add independent Canvas preferences for preview actions, Discussion notes, and Branch or Re-roll prompting while keeping compact node actions visibly stateful.

## 0.1.34

- Add prompt-first Canvas actions for branches and re-rolls, preserving each exact instruction on its node and in agent-readable task, packet, brief, and generation handoffs.
- Add a unified Variation Queue that highlights every queued node, focuses the selected node beside the panel, and supports inline prompt editing, quiet removal, keyboard shortcuts, and responsive desktop and mobile layouts.
- Keep promptless work explicit so agents ask what should change, protect claimed instructions from conflicting edits, and expose workspace branch limits plus prompt-editing behavior in Canvas settings.

## 0.1.33

- Make Projects the global home and give every project a dedicated Workspaces directory with paginated card and list views, search, sorting, durable animated manual ordering, and responsive keyboard- and touch-friendly controls.
- Open projects through their workspace lists and workspaces through canonical Canvas URLs, while preserving the last valid Canvas, presentation, and contextual-panel state across project-scoped navigation.
- Add guarded project and workspace lifecycle operations with confirmed cascade deletion, stale-state protection, rollback, shared-graph preservation, and SQLite-authoritative cleanup without deleting physical media.

## 0.1.32

- Add reachability-aware branch controls to compact and portrait lineage cards so large trees can be collapsed without hiding descendants that remain connected through another visible branch.

## 0.1.31

- Replace the stacked top navigation and growing Canvas Actions menu with a full-height destination rail, contextual left panel, and full-page canvas that stay usable across desktop and mobile layouts.
- Move Canvas appearance into a polished top-right settings panel with direct card, layout, connection, minimap, and hover controls, graceful motion, responsive mobile treatment, and a first-use hint.
- Make the Lineage brand open an accessible About dialog with release and verified runtime identity, repository and documentation links, and deliberately sanitized diagnostics copying.

## 0.1.30

- Add switchable compact-node and portrait-card lineage presentations, with full-image containment for social artwork and browser-local presentation preferences.
- Add Canvas appearance controls for graph direction, edge weight, edge labels, and hover previews while preserving stable layouts, compact-node manual positions, and accessible edge editing across every orientation.
- Keep the Actions menu usable in short viewports and make rich-demo readiness truthful by completing indexing only after the refreshed graph has rendered.

## 0.1.29

- Add durable, revisioned next-output target settings for static-image lineage nodes, with human canvas-default inheritance, explicit agent/CLI overrides, same-geometry surface consolidation, and separate current-versus-future geometry in selection packets and the canvas.
- Require every node-target generation to atomically re-resolve and freeze the selected sources' exact-pixel targets before provider work, rejecting ambiguous surfaces, conflicting edits, stale digests, and transient geometry-changing re-roll bypasses.
- Initialize each imported child from only its own frozen output geometry, preserve older job snapshots after future settings change, and reject cancellation, tampering, corrupt files, and wrong dimensions without partial lineage state.

## 0.1.28

- Preserve independent canvas generation drafts across interactions and parent rerenders, and flush complete machine-readable CLI output even when receipts exceed the process stdout buffer.
- Add a provider-neutral image-generation scaffold that derives deterministic, no-clobber scratch destinations from frozen target-aware jobs for external generation and exact-size atomic import.

## 0.1.27

- Add provider-neutral static-image output targets across agents, the CLI, and the canvas, with explicit surface resolution, shared-geometry consolidation, per-source overrides, custom dimensions, and immutable variant counts.
- Enforce locked PNG, JPEG, and WebP output specifications from decoded bytes, atomically rejecting corrupt, unsupported, tampered, or wrong-dimension imports without partial lineage state.
- Keep canvas target defaults explicit and human-managed while preserving unlocked jobs, inherited re-roll dimensions, and child variations for geometry changes.

## 0.1.26

- Prevent GitHub Pages asset paths from contaminating the npm package, restore stable app rendering, and reject mismatched production asset URLs during package smoke verification.

## 0.1.25

- Keep tagged release provenance clean after documentation builds so verified stable installations accept the published package.

## 0.1.24

- Add persistent per-canvas Social marks across the UI and CLI, including agent-readable local media context, claim enforcement, and safe cleanup when a node leaves its canvas.
- Add an explicit, atomic stable-package upgrade path for stopped production profiles, with verified runtime authority, writer refusal, rollback, identity preservation, and a guarded Make workflow.

## 0.1.23

- Make missing Codex CLI failures explain how to restore `PATH`, verify `npx` and Codex prerequisites explicitly, and gate releases on compatibility with the independently published plugin installer.
- Add a reusable Lineage showcase cover and refine its presentation without browser text-selection artifacts.
- Show absolute local paths in asset details while preserving safe relative paths in persisted lineage data.
- Add the public documentation hub, freshness checks, CI routing, and GitHub Pages deployment workflow.
- Refresh vulnerable transitive dependencies for `brace-expansion`, `postcss`, and `nanoid`.

## 0.1.22

- Harden the landing page, README, and packaged manual dogfood guide with fail-fast first-run commands that complete the post-initialization runtime, profile, database, and service identity gate.
- Isolate bootstrap dependencies from stable and preview shims so repeat and coexisting channel installs cannot clobber their launchers.
- Package and scan the manual install runbook, and make the Node.js 22.22+ requirement explicit for the independently published Codex plugin installer.
- Stabilize the rich-demo browser readiness proof so delayed workspace discovery cannot race the media download check.
- Make plugin-installer dist-tag promotion verification tolerate npm registry propagation while still failing closed on the wrong version.

## 0.1.21

- Make immutable annotated tags on reviewed `main` the sole authority for matching npm and GitHub releases, with verified plugin assets built before publication and stable/prerelease channels selected directly from SemVer.
- Harden the tag-triggered workflow against synthetic checkout refs and require GitHub credentials for the assets-first npm publication proof.

## 0.1.21-rc.3

- Pass the workflow GitHub token into npm publication so the assets-first release guard can verify the matching prerelease tarball and checksum before publishing.

## 0.1.21-rc.2

- Refresh the single pushed release tag from `origin` before validating it so GitHub Actions cannot confuse its synthetic checkout ref with the authoritative annotated tag.

## 0.1.21-rc.1

- Make a new immutable annotated release tag on reviewed `main` the sole authority for matching npm and GitHub releases, with prereleases routed to `next`, stable releases routed to `latest`, and plugin assets verified before publication.

## 0.1.20

- Generate every server and browser handoff with the verified stable, preview, or checkout-development launcher and pin it to the active profile or explicit database instead of emitting unsafe `npx` fallbacks.
- Remove the duplicate user-facing Node SQLite startup warning while preserving unrelated warnings, and fail closed when browser command generation lacks runtime identity.
- Refine landing-page carousel autoplay, poster loading, transitions, and media presentation for a smoother first visit.

## 0.1.18

- Keep managed stable/preview service control compatible with launchers generated by the immediately preceding public channel bootstrap by resolving the exact launcher through its receipt-bound channel pointer.
- Preserve explicit and current-shim launcher selection while surfacing the underlying spawn failure instead of masking it with an undefined stderr formatting error.
- Extend isolated first-user onboarding proof to simulate the legacy bootstrap contract across custom runtime and shim roots.

## 0.1.17

- Add atomic `profile init` for fresh installs, including exact runtime pinning, owner-only manifests, bound SQLite identity, no-clobber rollback, and actionable guidance when an unbound runtime attempts a write.
- Make stable and preview launcher installation, managed services, and `make install-dev` agree with the documented first-run paths while preserving strict runtime/profile/database identity checks.
- Add a version-qualified Codex plugin installer with read-only diagnostics, explicit temporary Codex-home support, exact app/plugin version locking, and rollback-safe activation.
- Prevent the app's topbar and lineage action menus from overlapping, update the vulnerable `body-parser` dependency, and continuously prove install, profile, service, seed, CLI, and plugin onboarding in an isolated end-to-end smoke test.

## 0.1.16

- Add editable one- or two-word lineage edge summaries with agent/human provenance, optimistic concurrency protection, accessible keyboard editing, and consistent labels across every graph orientation.
- Add a versioned generation-output manifest that binds each new output to its selected parent and required edge summary while preserving completion of already-planned legacy jobs.
- Upgrade the node inspector with uncropped media, Branch, Re-roll, and Details actions, focus-scoped B/R/D shortcuts, and modal-safe dismissal in place of the redundant fixed Inspecting card.

## 0.1.15

- Add a subtle root marker that makes the starting point of each lineage tree immediately recognizable.
- Add full-asset previews on node hover and keyboard focus while preserving double-click for full details and attempt history.
- Add a browser-local setting to disable hover previews, plus refresh-state safeguards that keep dismissed previews closed during background updates.

## 0.1.14

- Fix isolated channel installs against npm clients that return registry integrity as a flat `dist.integrity` field, while rejecting missing or conflicting identity metadata.
- Run promotion claim verification through an exact receipt-bound registry install, named production profile, external asset root, and managed writer.
- Supersede the `0.1.13` candidate, whose packaged channel installer cannot bootstrap registry installs with the affected npm metadata shape.

## 0.1.13

- Isolate stable, preview, and checkout-only development code into attested channel-specific roots with runtime doctor and tamper detection.
- Require fingerprint-bound named profiles, opened-handle SQLite identity checks, one managed writer, consistent database clones, and referenced-asset-only migration receipts for persistent writes.
- Ship profile-aware managed service lifecycles, a three-runtime adversarial coexistence oracle, and an atomic version-locked Codex plugin release/install path.

## 0.1.12

- Add named runtime profiles that bind environment, SQLite, media root, service origin, and expected runtime identity without allowing silent path drift.
- Enforce a single cross-process writer lease per profile and route profile-bound mutations through the authenticated managed service while keeping inspections read-only.
- Add opt-in `lineage.selection_packet.v2` exports whose stable semantic identity binds ordered selections to their current attempts and checksums for durable GrowthOps handoff receipts.

## 0.1.11

- Add `--asset-root` / `LINEAGE_ASSET_ROOT` so installed Lineage packages can use external project catalogs and local media independently from the SQLite path.
- Show the active asset root in CLI startup, `db info`, and Settings alongside the active SQLite identity.
- Extend the packed-tarball smoke to prove an unrelated npm consumer can start Lineage and export a real external-project selection packet.

## 0.1.10

- Fix `lineage db info` so installed CLI checks use the same stable/dev runtime SQLite defaults as `lineage start`.

## 0.1.9

- Add runtime identity diagnostics in Settings so operators can see the active channel, version, Git SHA when available, SQLite path, and database counts.
- Add `lineage db info` for CLI and agent checks before touching a local Lineage database.
- Document the stable, preview, and dev channel data policy, keeping explicit database overrides available with `--db` and `LINEAGE_DB`.
- Add browser coverage to ensure Settings keeps surfacing the active runtime and SQLite identity.

## 0.1.8

- Add durable selection packet export so agents can hand selected Lineage assets to GrowthOps without scraping UI state or copying local paths.
- Add Agent OS adoption guidance for Lineage agents and operators.
- Improve popover media previews, node actions, and image expansion controls for faster asset inspection.
- Clean up the Lineage shell navigation, toolbar, and side-panel layout for a more focused workspace.

## 0.1.7

- Add a claim-aware lineage task queue for per-image iteration and re-roll work, including task instructions, comments, cancellation, and human override controls.
- Add visible agent/task state in the lineage canvas and side panel so humans can see when a task is pending, locked, or actively claimed.
- Add QA seed guardrails that distinguish basic SVG placeholder media from the Swissifier rich PNG demo seed.
- Add deterministic rich-seed verification and browser coverage to fail when QA is pointed at the wrong seed or invisible placeholder previews.

## 0.1.6

- Add per-image re-roll attempt history with stack inspection, previous-attempt selection, and promotion back to the current/top attempt.
- Add CLI and agent-facing re-roll commands for marking, listing, planning, importing, and cancelling one job per target image.
- Package public-safe Swissifier re-roll PNG fixtures and manifest metadata so the demo canvas shows multi-attempt nodes out of the box.
- Harden project switching, lineage workspace fallback, and backend attempt invariants around re-roll histories.

## 0.1.5

- Add graph orientation controls for lineage views and CLI flows, including browser coverage for orientation behavior.
- Improve agent claim visibility with workspace/content occupancy badges, claim lifecycle controls, and release claim smoke coverage.
- Harden lineage claim enforcement for explicit child workspaces and `project_channel` claims so scoped claims cannot authorize broader writes.
- Make local startup helpers durable with tmux-backed Makefile commands.

## 0.1.4

- Implement target-scoped agent claims for lineage and content-post agent writes, including claim lifecycle CLI/API commands, heartbeat/release/revoke/transfer controls, and token-redacted read APIs.
- Add claim-aware handoff packets, workspace/content occupancy badges, and a read-only Agents view so humans can see active, idle, stale, and closed claims without exposing raw tokens.
- Enforce matching claim tokens for claimed lineage/content mutations and document the `LINEAGE_CLAIM_TOKEN` operator flow, including rare `project_channel` ownership.

## 0.1.3

- Add a managed Swissifier rich-demo media download flow that verifies the release archive and restored PNG checksums before loading the demo.
- Add durable local startup helpers and default Lineage CLI hosts for `lineage.localhost` and `lineage-dev.localhost`.
- Ship the lightweight Swissifier fixture manifest while keeping generated demo media outside git and package contents.

## 0.1.2

- Fix packaged Lineage handoff commands so copied `next`, `inspect`, and `link-child` commands run through the published package.
- Add packaged CLI regression coverage for custom SQLite database handoffs.

## 0.1.1

- Fix first-run demo lineage loading and catalog-root lineage workspace creation.
- Add visible release version/channel metadata in Settings.
- Keep the New lineage modal actions reachable at default viewport heights.

## 0.1.0

- Initial public extraction of Lineage as a local-first creative lineage workspace.
