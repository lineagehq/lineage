# Lineage–Buffer Social Publishing Release 1 Implementation Plan

**Date:** 2026-08-11

**Status:** Ready for implementation

**Source design:** `docs/superpowers/specs/2026-08-11-lineage-buffer-social-publishing-design.md`

## Objective

Deliver the non-publishing foundation of the approved design. From a verified
development profile, a user can mark a canvas node for Social work, connect one
Buffer organization to the project, manually synchronize Buffer channels,
promote the node into a campaign-keyed Social Work Item, create one persistent
variant per channel, edit caption/hashtags/reviewed alt text/scheduling intent,
and validate the item in the canvas side panel, HTTP API, and CLI.

Release 1 performs no media upload and no external Buffer mutation. It never
creates, edits, deletes, queues, schedules, or publishes a Buffer post.

## Adversarial completion standard

**User-facing claim:** On a verified development profile, humans and agents can
select canvas-local Social candidates, synchronize the exact project's Buffer
channel catalog, and compose persistent channel variants with
server-authoritative validation, while Lineage makes no external social
mutation and leaks no provider credential or private media.

The three highest-risk failures are:

1. Channel synchronization invokes a Buffer mutation or silently uses a
   user-global Buffer account.
2. Marks, work items, or variants leak across projects, canvas roots, or Buffer
   organizations, or bypass an active canvas claim.
3. The UI reports saved or valid state that was not durably persisted, uses a
   stale channel, or implies that scheduling is already available.

Completion evidence must include captured-runner tests proving only Buffer
schema/channel reads, credential-fallback negative tests, project/canvas/claim
isolation tests, canvas accessibility tests, CLI/API parity, and the full public
repository gates using synthetic data only.

## Scope

Included: Social marks, exact `@bufferapp/cli` dependency, isolated Buffer
runtime, project connection identity, manual channel sync, minimal versioned
capability matrix, Social Work Items, variants, immutable revisions, ordered
hashtags, reviewed alt text, validation, canvas side panel, HTTP, and CLI.

Deferred: AI suggestions, browser research, media uploads, publish renditions,
deliveries, attempts, leases, scheduling, update/cancel, reconciliation, drift,
metrics, dedicated Social workspace, `social_work_item` claims, and multiple
active variants for the same channel.

## Execution rules

- Implement tasks in order; central schema/types/CLI/canvas changes overlap.
- Start every behavior with a focused failing test.
- Keep the existing Buffer posting adapter operational and dry-run-only.
- Use injected Buffer runners in tests. Never use production credentials.
- Do not commit credentials, real provider IDs, private media/content, real
  provider responses, presigned URLs, or local databases.
- Commit each task only after its focused verification passes.

## Operational preflight

Before Lineage operational verification, choose one checkout-only development
profile and run the required identity gate with the same launcher/profile:

```bash
npm run lineage:dev -- runtime doctor --json
npm run lineage:dev -- profile doctor --profile <development-profile> --json
npm run lineage:dev -- db info --profile <development-profile> --json
```

Confirm code root/origin/fingerprint, channel, profile/environment/database, and
service origin all agree. Stop on mismatch. For an intentional checkout change,
stop the dev service, run the documented `make repin-dev
LINEAGE_DEV_PROFILE=<development-profile>`, then repeat the gate. Unit tests use
temporary test profiles and never write to a user profile.

## Task 1: Social-mark persistence

**Create:** `src/shared/socialTypes.ts`,
`src/server/social/socialMarks.ts`,
`src/server/social/socialMarks.test.ts`.

**Modify:** `src/server/assetLineageDb.ts`, `src/server/assetLineage.ts`,
`src/shared/types.ts`.

Write tests first for unconfirmed dry-run, confirmed mark, idempotent re-mark,
audited unmark/reactivation, exact visible-canvas validation, project/root
isolation, active `lineage_workspace` claim enforcement for authored writes,
missing-media warnings, and active mark projection onto `LineageNode`. Confirm
the test fails before implementation:

```bash
npx vitest run src/server/social/socialMarks.test.ts
```

Implement `asset_social_marks` with unique `(project_id, root_asset_id,
asset_id)`, audit fields, bounded notes, and actor provenance. Reuse canonical
canvas resolution from `assetLineage`. Add `social_marked` and an active mark
summary to lineage snapshots. Return schema-versioned responses with exact
identity, safe local/checksum context, warnings, and canonical next commands.
Keep claim validation in the domain service; Task 2 only transports claim
tokens through HTTP and CLI.

Verify:

```bash
npx vitest run src/server/social/socialMarks.test.ts src/server/assetLineage.test.ts
npm run check
```

Commit: `Add canvas social mark persistence`.

## Task 2: Social marks in HTTP, CLI, and canvas

**Create:** `src/server/social/socialRoutes.ts` and test.

**Modify:** `src/server.ts`, `src/cli/lineageCli.ts` and tests,
`LineageAssetNode.tsx`, `LineageCanvas.tsx`, `LineageContextMenu.tsx`,
`LineageView.tsx`, their tests, and relevant CSS.

Test first:

- list/mark/unmark routes with dry-run and confirmed responses;
- claim-token transport and `lineage_workspace` claim enforcement for agent
  writes;
- `lineage social list|mark|unmark`, argument validation, writer lease,
  delegation, JSON/human output, exact ID resolution, and ambiguous-title
  failure;
- Social quick action and `S` shortcut, suppressed in editable/modal/modifier
  contexts;
- persistent badge, pending duplicate protection, and server-authoritative
  refresh; and
- no regression to Branch/Re-roll/Details/replay/dragging.

Register only the approved routes. Add CLI help/dispatch/result formatting and
managed-writer classification. Thread `onToggleSocial` through the existing
canvas callbacks and add the hover action and context-menu action. Do not create
an optimistic mark store.

Verify focused server, CLI, and component tests, then `npm run check` and
`npm run lint`. Commit: `Expose canvas social marks`.

## Task 3: Pinned, isolated Buffer runtime

**Modify:** `package.json`, `package-lock.json`.

**Create:** `src/server/adapters/buffer/bufferRuntime.ts` and test;
`bufferCapabilities.ts` and test.

Test first that Lineage:

- resolves the package-local CLI, never a `PATH` binary;
- reports the exact version and deterministic hashes for `channels list`,
  `channels get`, and `posts create` schemas;
- fails on version/schema mismatch;
- invokes `process.execPath` without a shell;
- scrubs the child environment, injects only the resolved `BUFFER_API_KEY`, and
  uses an isolated Buffer config root; and
- rejects all Buffer mutations before process invocation.

Add exact dependency `@bufferapp/cli@1.2.0` without a range. Implement a typed
runner whose Release 1 allowlist contains only `schema describe`, `channels
list`, and `channels get`. Define capability-registry version 1 with explicit
Instagram and LinkedIn single-image entries; every unlisted combination returns
an actionable unsupported result.

Verify:

```bash
npm install --save-exact @bufferapp/cli@1.2.0
npx vitest run src/server/adapters/buffer/bufferRuntime.test.ts src/server/adapters/buffer/bufferCapabilities.test.ts
npm run check
npm audit --audit-level=moderate
```

Commit: `Pin isolated Buffer CLI runtime`.

## Task 4: Buffer connection and channel synchronization

**Create:** `bufferConnection.ts`, `bufferChannelSync.ts`, `bufferRoutes.ts`, and
their tests under `src/server/adapters/buffer/`.

**Modify:** `assetLineageDb.ts`, adapter settings/status modules and tests,
`adapterSettingsTypes.ts`, and `server.ts`.

Test first:

- one project-scoped connection and no cross-project leakage;
- explicit organization ID plus credential reference, with no secret persisted;
- migration of the existing `LINEAGE_SCHEDULER_TOKEN` reference without copying
  its value;
- fingerprint of organization, pinned CLI, and schemas;
- sync requires `confirmWrite` for SQLite writes;
- `channels list/get` use the exact project organization and safe fields;
- stale channels are retained as unavailable;
- no secrets in API/errors; and
- disabled/missing/mismatched configuration causes no Buffer invocation.

Add `buffer_connections` and `buffer_channels` with project foreign keys, safe
metadata, capability version/fingerprint, and sync times. Add inspect/update and
list/sync routes under `/api/adapters/buffer`. Synchronization is a confirmed
local write plus external reads and requires no external-action confirmation.
Keep the existing dry-run posting route separate and unchanged.

Verify focused Buffer/adapter route and status tests, then check/lint. Commit:
`Add Buffer channel synchronization`.

## Task 5: Social Work Items and immutable variants

**Extend:** `src/shared/socialTypes.ts`, `socialRoutes.ts` and tests.

**Create:** `socialWorkItems.ts`, `socialValidation.ts`, and tests.

**Modify:** `assetLineageDb.ts`.

Test first:

- promotion requires an active mark on the exact visible canvas node;
- uniqueness by project/root/source/campaign key and idempotent reopen;
- distinct campaign keys permit distinct items;
- optional content-post link is project-valid but not required;
- one active variant per synchronized channel;
- editing creates immutable revisions;
- ordered hashtags and caption/first-comment placement;
- reviewed alt-text provenance;
- archive retains history;
- canvas claim enforcement for authored mutations;
- stale channel fingerprint blocks validation with a sync instruction; and
- validation never invokes Buffer or storage adapters.

Add `social_work_items`, `social_variants`, `social_variant_revisions`, and
`social_hashtags`. Normalize omitted campaign key to `default`. Hash copy,
hashtags/placement, reviewed alt text, channel, notification/automatic intent,
and `customScheduled`/`addToQueue` composition intent. Return schema-versioned
snapshots and field-addressed validation. Unknown services remain inspectable
but unsupported. Never label a valid composition scheduled or publishable.

Verify focused social tests and `npm run check`. Commit: `Add social work item
composition model`.

## Task 6: Release 1 composition CLI

**Modify:** `lineageCli.ts`, `lineageCli.test.ts`, and profile/lease tests.

Implement only:

```text
lineage adapters buffer status
lineage adapters buffer connect --organization-id <id> --credential-ref <ref> --confirm-write
lineage adapters buffer channels
lineage adapters buffer sync-channels --confirm-write
lineage social item create --root <id> --asset <id> [--campaign-key <key>] --confirm-write
lineage social item show --item <id>
lineage social variant add --item <id> --channel-id <id> --confirm-write
lineage social variant edit --variant <id> [copy/hashtag/alt/schedule fields] --confirm-write
lineage social variant remove --variant <id> --confirm-write
lineage social validate --item <id>
```

Test every required option and enum, named-profile policy, reader/writer-lease
classification, managed delegation exactly once, claim transport,
schema-versioned output, and credential redaction. Do not advertise schedule,
retry, delivery, research, suggestion, sync-item, metrics, or
`--confirm-external` yet.

Verify CLI tests, check, and lint. Commit: `Add social composition CLI`.

## Task 7: Canvas Social side panel

**Create:** `LineageSocialPanel.tsx`, its test, and CSS.

**Modify:** `LineageView.tsx`, `LineageCanvas.tsx`, `LineageAssetNode.tsx`,
`LineageContextMenu.tsx`, their tests, and shared side-panel CSS.

Test first that:

- Social opens the panel while the source node remains visible;
- unmarked nodes offer marking before promotion;
- promotion creates/opens the campaign-keyed item;
- channels show stale/disconnected/unsupported reasons;
- duplicate active channel variants are blocked;
- caption, ordered hashtags, placement, reviewed alt text, and intent save as
  server-authoritative revisions;
- validation identifies relevant fields;
- custom time is exact/zoned while queue timing says it may move;
- notification is distinct from automatic;
- no action says scheduled or published;
- loading/empty/stale/error/claim-conflict states are accessible; and
- reopening/refreshing persists state without breaking viewport fit, replay,
  details, Branch, Re-roll, or Next variation.

Reuse the responsive `lineage-side` container with explicit panel mode
`next_variation|social`; do not mount competing sidebars. Keep API behavior in
focused hooks/helpers if the panel grows. Show source identity/checksum, campaign
key, connection/sync age, variants/revisions, and validation. Add no AI,
research, upload, payload-preview, or schedule controls.

Verify focused component tests, check, and lint. Commit: `Add canvas social
composition panel`.

## Task 8: Settings and honest operator guidance

**Modify:** `SettingsView.tsx` and test, README and released integration docs as
needed. Update `CHANGELOG.md` only during actual release preparation.

Test that Settings shows pinned compatibility, credential detection,
organization, channel count, last sync, and safe errors; distinguishes Connect
from Sync; never renders secrets/raw responses; and keeps the legacy posting
adapter visibly dry-run-only. Documentation must label Release 1 as channel-sync
and composition foundation with live scheduling deferred to Release 2.

Verify Settings/adapter tests, check, lint, and `npm run public:readiness`.
Stage only files actually changed. Commit: `Document Buffer composition
foundation`.

## Task 9: End-to-end boundary proof

Add a synthetic integration workflow that:

1. creates two canvases containing the same asset;
2. marks only one canvas;
3. configures a synthetic project Buffer connection;
4. synchronizes injected Instagram and LinkedIn channels;
5. promotes campaign `launch`;
6. creates/revises one variant per channel;
7. validates hashtags, reviewed alt text, custom versus queue timing, and
   notification labeling;
8. proves other canvas/project isolation;
9. proves an active canvas claim blocks unauthorized edits; and
10. asserts every captured Buffer call is a schema/channel read.

After repeating the development profile gate, exercise the same workflow in the
browser against a non-production profile using synthetic fixtures or a dedicated
test Buffer organization. Capture screenshots/traces of the Social badge,
channel picker, two variants, validation, and honest non-publishing state. Prove
that no Buffer post appears.

Run the meaningful-change gates:

```bash
npm run ci
npm run public:readiness
npm run package:smoke
npm run runtime:oracle
npm run e2e
```

If an unrelated pre-existing gate fails, record command, exit code, evidence,
and focused passing proof. Never weaken a Release 1 safety assertion.

Before completion, restate the claim and three failure modes, attach direct
evidence to each, inspect the staged diff for private data and unrelated user
changes, and request independent code review focused on mutation absence,
credential isolation, tenancy, claims, and honest UI state.

## Expected commit sequence

```text
Add canvas social mark persistence
Expose canvas social marks
Pin isolated Buffer CLI runtime
Add Buffer channel synchronization
Add social work item composition model
Add social composition CLI
Add canvas social composition panel
Document Buffer composition foundation
```

Do not combine Release 2 scheduling behavior into this implementation.
