# Lineage–Buffer Social Publishing Design

**Date:** 2026-08-11

**Status:** Approved umbrella design, revised after independent review

## Summary

Lineage will expand its existing dry-run-only Buffer scheduling adapter into a
provider-neutral social publishing workflow rooted in the Lineage canvas.
Lineage remains the source of truth for creative intent, channel variants,
copy, hashtags, alt text, media, and schedules. Buffer is a delivery,
publishing-status, and analytics provider.

A canvas Social mark remains only a candidate marker. A deliberate promotion
creates a Social Work Item containing shared campaign intent and one or more
channel-specific variants. The canvas side panel is the primary composition
surface. A user may generate and edit AI-assisted copy, attach compact research
evidence, review accessibility text, validate every selected channel, and then
schedule directly in Buffer after one explicit external-action confirmation.

Lineage records each channel delivery independently. Partial successes remain
successful, ambiguous provider results are verified before retry, and manual
Buffer synchronization reads only posts already linked to Lineage. Synced
status, URLs, errors, drift, and metrics become visible evidence without
overwriting Lineage-owned content or automatically generating new work.

This document defines the complete product and architecture direction. Delivery
is intentionally decomposed into bounded releases so the first usable workflow
does not depend on finishing the entire integration platform.

## Goals

- Synchronize Buffer organization and channel information into each Lineage
  project.
- Promote a canvas node into a durable, provider-neutral Social Work Item.
- Compose separate caption, hashtag, accessibility, metadata, and scheduling
  variants for multiple image-capable channels.
- Support AI-assisted suggestions with human selection and editing.
- Allow future browser and search plugins to contribute cited, versioned
  research evidence.
- Publish immutable Lineage media renditions through a managed upload adapter.
- Schedule real Buffer posts directly after one explicit confirmation.
- Preserve per-channel success when sibling variants fail.
- Detect ambiguous creates and remote drift without creating duplicates or
  overwriting Lineage intent.
- Manually synchronize linked Buffer posts, published URLs, provider errors,
  and timestamped performance metrics.
- Make performance visible on the canvas while keeping branching, re-rolls,
  and new creative work human-directed.
- Keep Buffer behind a provider boundary that can support another scheduler in
  the future.

## Non-goals

- Mirroring every post in a Buffer organization.
- Treating a Social mark as permission to upload, schedule, or publish.
- Background polling, webhooks, or hidden provider reads.
- Autonomous scheduling or automatic creative generation from performance.
- Scheduling across multiple Buffer organizations from one Lineage project.
- Allowing Buffer-side edits to overwrite Lineage content.
- Supporting video, document, thread, or carousel-specific workflows in the
  initial complete image-publishing release.
- Replacing the existing content-post system as part of the first release.
- Storing credentials, private media, real presigned URLs, or complete external
  webpages in SQLite, logs, fixtures, or release artifacts.

## Product Decisions

- **Editorial authority:** Lineage owns captions, hashtags, channel selection,
  media, and timing. Buffer is a projection and delivery surface.
- **Scheduling gate:** A successful preflight is followed by one explicit
  confirmation that creates the real Buffer schedules. There is no mandatory
  Buffer-draft stage.
- **Multi-channel model:** One Social Work Item owns shared intent and separate
  channel variants.
- **Copy assistance:** AI generates channel-aware suggestions. A human selects
  or edits the final copy.
- **Research:** Browser or search plugins may provide a compact evidence packet
  containing query, provider, retrieval time, source links, extracted findings,
  and the copy revision that used them. Full webpages are not archived.
- **Inbound scope:** Lineage synchronizes only Buffer posts explicitly linked by
  external ID. Existing posts may be adopted only through a deliberate future
  link/import action.
- **Media:** Lineage creates an immutable publish rendition through a
  provider-neutral managed-upload adapter, with S3 as the first implementation.
- **Tenancy:** One Lineage project maps to one Buffer organization.
- **Partial failure:** Successful channel variants remain scheduled. Only
  variants without a verified external ID are eligible for retry.
- **Post-schedule edits:** Local edits create visible drift. Updating Buffer
  requires a confirmed diff.
- **Cancellation:** Only an unsent post with a currently permitted Buffer delete
  action can be cancelled externally. A published delivery may be archived
  locally but is never represented as removed from the social network.
- **Sync cadence:** Channel and linked-post synchronization are manual only.
- **Performance:** Metrics are timestamped evidence. Users may explicitly branch
  or re-roll from a performer; metrics do not create work automatically.
- **Primary interface:** The Lineage canvas side panel is the primary composer.
  A dedicated Social workspace is a later operational view over the same data.
- **Channel scope:** The first complete scheduling release supports
  single-image posts across every connected Buffer service that exposes a
  compatible image-post capability in Lineage's versioned support matrix.
  Multi-image carousels remain deferred.
- **Notification publishing:** Notification-only post types are available only
  through an explicit per-variant choice and are never labeled automatic.
- **Scheduling modes:** Release 2 supports `customScheduled` and `addToQueue`.
  A custom schedule shows an exact zoned time. Queue scheduling shows Buffer's
  queue semantics and never promises an exact time. `shareNext` and `shareNow`
  are deferred; immediate publishing will require a separately designed,
  stronger confirmation.
- **Hashtags:** Hashtags are an ordered structured set per variant, with an
  explicit caption or first-comment placement where supported.
- **Alt text:** AI may draft alt text, but a human must review it before
  scheduling a channel that accepts image alt text.

## Architecture and Ownership

```text
Canvas node + Social mark
  -> promote to Social Work Item
     -> channel variants
        <- project Buffer channel catalog
        <- AI suggestions and research evidence
        -> human review and preflight
           -> immutable publish rendition
              -> explicit confirmation
                 -> per-variant Buffer delivery
                    -> manual linked-post sync
                       -> status, URL, errors, drift, metrics
                          -> visible canvas evidence
```

The Social mark designed in
`docs/superpowers/specs/2026-07-24-lineage-social-marks-design.md` remains a
canvas-scoped candidate marker. It never creates a content post or performs an
external action. Promotion is a separate confirmed Lineage write that creates
or opens the Social Work Item for the source canvas node.

A Social Work Item records the project, canvas root, source asset, shared
campaign intent, and workflow state. It may optionally link to an existing
`content_posts` row. The optional link avoids a disruptive migration and lets
the content-post and social-publishing workflows converge later based on actual
usage.

Each selected Buffer channel creates one independently versioned variant.
Provider-neutral services own work-item editing, revision selection, review,
preflight, and state transitions. Buffer-specific channel rules, payloads,
responses, and external identifiers stay inside the Buffer connection and
delivery boundary.

## Data Model

### Core records

| Record | Responsibility |
| --- | --- |
| `social_work_items` | Project, canvas, source node, shared campaign intent, workflow state, and optional content-post link |
| `social_variants` | Destination channel, editable copy, hashtag placement, publish method, schedule, network metadata, and current revision |
| `social_variant_revisions` | Immutable snapshots of copy, hashtags, reviewed alt text, network metadata, scheduling intent, and normalized revision hashes |
| `social_hashtags` | Ordered and normalized hashtags associated with a variant revision |
| `social_research_packets` | Query, research provider, timestamps, source links, extracted findings, and freshness |
| `social_copy_suggestions` | Generated options, model provenance, research inputs, and selected or rejected state |
| `social_publish_renditions` | Frozen asset bytes, checksum, MIME type, dimensions, upload location, and receipt |
| `social_delivery_operations` | One confirmed multi-variant scheduling command, actor, preview hash, and audit timestamps |
| `social_deliveries` | Per-variant provider post ID, projected revision, rendition, state, URL, timestamps, normalized error, and safe receipt |
| `social_delivery_attempts` | Append-only create/edit/delete attempts with request hash, timestamps, process classification, verification evidence, and supersession linkage |
| `social_sync_runs` | Manual sync scope, progress, counts, warnings, and failures |
| `social_metric_snapshots` | Delivery, normalized metric type, value, unit, provider freshness, and retrieval time |
| `buffer_connections` | Project-to-organization identity, credential reference, timezone, fingerprint, and channel-sync time |
| `buffer_channels` | Synced channel identity, service, capabilities, schedule, lock/disconnect state, and safe metadata |

### Invariants

- Work items, variants, operations, and deliveries use immutable IDs rather than
  mutable titles.
- Promotion permits multiple campaign uses of one canvas node but only one
  active work item per `(project_id, root_asset_id, source_asset_id,
  campaign_key)`. Missing campaign input is normalized to the explicit key
  `default` rather than SQL `null`.
- The initial releases permit only one active variant per Buffer channel within
  a work item. Reposting to the same channel requires a cloned or separately
  keyed work item, preventing an accidental duplicate from appearing as an
  ordinary variant edit.
- Editing a variant creates a new immutable revision; it does not rewrite the
  revision referenced by an existing delivery.
- A normalized revision hash covers final text, structured hashtags and
  placement, reviewed alt text, network metadata, delivery mode, schedule,
  channel identity, and source-rendition identity.
- A delivery identifies the exact variant revision and publish rendition sent
  to Buffer.
- A successful external Buffer post ID is unique within its connection and is
  never eligible for another create attempt.
- Delivery attempts are immutable. A retry creates a new attempt linked to the
  attempt it supersedes; it never rewrites timeout or verification evidence.
- Metrics are append-only snapshots rather than mutable fields on a canvas
  node.
- Provider receipts are scrubbed, size-bounded, and separated from normalized
  user-facing states and errors.
- Removing a source node from a canvas does not erase publishing history. The
  work item retains source identity and reports that its source is no longer
  present.

## Buffer Connection and Channel Catalog

Each project has at most one active Buffer connection. Secrets remain outside
SQLite and are addressed through a credential reference. The stored connection
contains only safe organization identity, timezone, code/schema compatibility,
provider fingerprint, health state, and sync timestamps.

Lineage owns the Buffer runtime used for provider operations. It installs an
exact, lockfile-pinned `@bufferapp/cli` dependency and invokes that verified
package path rather than a `PATH`-resolved global binary. The connection
fingerprint includes the CLI version and relevant command-schema hashes. A
schema mismatch fails closed until Lineage's compatibility fixtures pass and
the pinned dependency is deliberately updated.

For each invocation, Lineage resolves the project's approved credential
reference, injects `BUFFER_API_KEY` into a scrubbed child-process environment,
and passes the configured organization ID explicitly in every applicable JSON
input. Buffer configuration lookup runs against an isolated, Lineage-owned
configuration root so no repository or user-global Buffer setting can fill a
missing value. Existing `LINEAGE_SCHEDULER_*` detection is migrated into this
connection contract rather than remaining a second, independent credential
path.

Manual channel synchronization lists channels for the configured organization
and fetches detailed metadata where required. The catalog records:

- Buffer channel ID, organization ID, service, service ID, display name, and
  avatar reference;
- timezone and posting schedule;
- disconnected, locked, or paused state;
- allowed actions and automatic or notification publishing support;
- image post types, required metadata, asset constraints, and scheduling modes;
- network-specific requirements such as Pinterest board identities;
- the Buffer schema or CLI version from which capabilities were derived; and
- a Lineage capability-registry version and support-matrix entry.

Disconnected, locked, or unsupported channels remain visible in the composer
with actionable explanations. The scheduler never guesses channel IDs or moves
an ID between organizations.

Buffer channel responses are evidence, not a complete capability declaration.
Lineage therefore owns a versioned, test-backed support matrix keyed by Buffer
CLI/schema version, service, post type, and scheduling method. Release 1 ships
the minimal registry needed to render and validate synchronized channels.
Release 2 adds the tested Instagram and LinkedIn single-image compilers. Release
3 expands the matrix service by service; completion is measured against the
explicit matrix shipped by that Lineage version, not the open-ended phrase
"every image channel."

## Canvas Side-Panel Workflow

Selecting a Social-marked node opens the Social side panel without hiding the
creative lineage. The panel follows seven steps.

1. **Promote:** create or open the work item and show the source checksum,
   review state, storage readiness, campaign context, and optional content-post
   link.
2. **Choose channels:** select from the synchronized channel catalog. Show why
   unavailable channels cannot be selected.
3. **Compose variants:** generate several channel-aware caption and hashtag
   suggestions, optionally run cited research, edit the chosen copy, choose
   hashtag placement, and review alt text.
4. **Set delivery:** choose automatic or explicitly labeled notification
   publishing and a supported Buffer scheduling mode. `customScheduled`
   displays an exact zoned time. `addToQueue` displays the applicable Buffer
   queue and schedule but states that the eventual time may move.
5. **Preflight:** validate copy and hashtag rules, required provider metadata,
   channel schedule and posting limits, media type and dimensions, publishable
   upload, current channel health, and connection identity.
6. **Confirm schedule:** show the exact channels, text, hashtags, media
   checksum, publishing method, local times, warnings, and external mutations.
   One explicit confirmation creates the operation.
7. **Observe:** show per-variant receipts, partial failures, projected revision,
   drift, last manual sync, published URLs, and performance snapshots.

## Workflow States

Editorial and provider lifecycles are separate.

```text
Variant editorial state:
draft -> needs_review -> ready -> archived

Delivery lifecycle:
pending -> creating -> verification_required
                    -> scheduled -> sending -> published
                    -> failed
pending|scheduled -> cancelled (only when the provider action permits it)
scheduled|published -> external_missing (after manual sync evidence)
```

`verification_required` is not eligible for automatic retry. It means Buffer
may have accepted a non-idempotent create even though Lineage did not receive a
usable response. Drift, stale sync, partial completion, and attention are
computed flags rather than mutually exclusive lifecycle states. A published
delivery may therefore also be drifted, and a historical cancelled delivery
does not make the current variant cancelled.

Work-item summaries are derived from the editorial states, current delivery
lifecycles, and computed flags of their variants. A work item may be partially
scheduled or partially published. Successful siblings and historical
deliveries are never downgraded because another variant or replacement failed.

## Integration Services

The existing Buffer adapter should be replaced rather than enlarged. Its
current payload vocabulary is not the current Buffer CLI contract, and its
execution path is simulated. The replacement has six independently testable
services.

### Buffer connection service

Verifies credentials, organization identity, timezone, CLI and schema
compatibility, and safe configuration. Organization or fingerprint mismatch
fails closed.

### Channel sync service

Runs manual organization and channel reads and upserts the project catalog.
It preserves the last known channel record when a channel disappears and marks
it unavailable rather than silently deleting history.

### Media publisher

Resolves the selected local asset, validates its current bytes, freezes an
immutable publish rendition, uploads through a provider-neutral adapter,
verifies checksum and safe metadata, and returns a durable upload receipt. S3
is the first adapter, but the domain contract does not depend on S3 fields.

The first production media implementation uses an unguessable, read-only,
non-listable HTTPS object URL whose bytes are immutable. Ordinary S3 presigned
URLs are not accepted because their maximum practical lifetime may be shorter
than a future schedule and provider retry window. The object remains available
through publication plus 30 days by default. Because synchronization is manual,
an unobserved publication date results in indefinite retention rather than an
inferred cleanup deadline. A cancelled-before-send or failed unreferenced
rendition remains available for seven days. Replacements hold independent
references, and cleanup is reference-counted so one delivery cannot remove
media still used by another.

Earlier deletion is allowed only after an acceptance-tested Buffer response or
readback field proves that Buffer has ingested and no longer dereferences the
source URL. Until that proof exists, retention time is the safety boundary. The
current local-fallback S3 adapter does not satisfy this contract and must not be
reported as a production publisher.

### Payload compiler

Combines one immutable variant revision, rendition, and synchronized channel
capability record into the exact Buffer payload. The generated JSON is
validated against the pinned Buffer CLI schema before any external
mutation. Per-network compilers own required metadata and constraints.

### Delivery coordinator

Performs final identity checks and preflight, records the confirmed operation,
then creates each Buffer post independently. It persists a normalized attempt
state before and after each provider call, preserving partial success and exact
recovery scope.

Each active delivery operation has a renewable local lease with owner,
acquisition time, expiry, and heartbeat. An expired lease never authorizes a
new create by itself. Recovery first inspects the append-only attempts and
performs ambiguous-result verification; only then may a human release or
supersede the operation and confirm a new attempt.

### Reconciliation service

Manually fetches only deliveries with stored Buffer post IDs. It synchronizes
provider status, due and sent times, external link, errors, remote content
fingerprints, and explicitly requested metrics. It records sync progress and
can resume a project-wide paginated run after interruption.

Release 2 includes narrow provider reads required for scheduling safety and
recovery: recent-post lookup for ambiguous creates and a fresh post read before
update or cancellation to verify status and `allowedActions`. These reads write
only the associated attempt or delivery evidence. Release 4 adds the
user-facing item/project bulk synchronization, resumable pagination, drift
views, and metric collection described below.

## Scheduling and Idempotency

Scheduling uses a local write-ahead sequence:

```text
user confirms reviewed preview
  -> operation and variant attempts recorded
  -> Buffer create invoked for each eligible variant
  -> response classified
  -> external ID and safe receipt persisted
```

Buffer post creation is non-idempotent. A timeout, connection loss, or malformed
response never causes a blind retry. The attempt enters
`verification_required`, and Lineage searches recent posts within the exact
organization and channel using the projected text, schedule, creation window,
and available media evidence.

- One unique match may be adopted after Lineage records the verification
  evidence only when a durable Lineage correlation marker has been
  acceptance-tested as round-trippable through Buffer. Without that proof, even
  one candidate requires explicit human adoption.
- Zero matches permits a separately confirmed retry.
- Multiple matches require human resolution and expose candidate IDs and safe
  comparison fields.

The payload compiler sets Buffer's `source` field to a stable Lineage marker
when the pinned schema supports it, but the design does not assume that field is
readable or unique until the non-production acceptance suite proves it. Text,
schedule, channel, media, and time-window similarity are candidate evidence,
not automatic identity.

Lineage never treats an exit code alone as proof that the external mutation did
or did not occur. A successful variant must have a verified external ID.

## Updates, Drift, Cancellation, and Missing Posts

Lineage compares the current variant revision hash with the projected revision
stored on each delivery. A local edit marks the delivery drifted and presents
an exact diff. Buffer is unchanged until the user confirms an external update.

Where Buffer supports editing, the adapter compiles and validates the complete
provider edit. If the post cannot be edited and replacement is required,
creating the replacement and optionally deleting the original are separate,
explicitly described external actions. A replacement is linked to the previous
delivery so history remains navigable.

Cancellation requires confirmation and is constrained by the latest Buffer
status and `allowedActions`. For an unsent post, Lineage may invoke Buffer
deletion and retain a local delivery tombstone and provider receipt. A sent or
published delivery cannot be described as cancelled or removed from the social
network merely because a Buffer record was deleted. Until Buffer exposes and
Lineage acceptance-tests an explicit network-deletion contract, published
deliveries may only be archived locally. If a manually synchronized Buffer post
is missing, Lineage marks its delivery `external_missing` and raises the
computed `attention` flag. It never recreates the post automatically.

Remote Buffer edits are captured as drift evidence. They never replace the
Lineage revision. The user may either re-project Lineage through a confirmed
update or explicitly adopt the remote state through a future dedicated action.

## Manual Synchronization and Metrics

There is no background polling. Manual synchronization appears in three
surfaces:

- Settings: **Sync Buffer channels**
- Canvas side panel: **Sync this item**
- CLI: synchronize one item or all linked project deliveries

Every cached provider view shows `last_synced_at` and a visible stale-state
warning after a configurable threshold. Project-wide synchronization respects
pagination and rate limits and records resumable progress.

Metrics are requested explicitly because Buffer omits them from default post
reads and refreshes them approximately daily. Each snapshot stores both
Buffer's `metricsUpdatedAt` value and Lineage's retrieval time. Stale metrics
are labeled rather than presented as current. Normalized metrics may include
reactions, comments, shares, reposts, reach, impressions, views, clicks,
engagement rate, saves, follows, and channel-specific values when available.

Canvas nodes and variants may show timestamped performance and comparisons.
Branch and re-roll actions remain explicit human choices and preserve the
delivery evidence that motivated them.

## Research and Copy Assistance

Copy assistance is layered:

1. deterministic project, brand, channel, and campaign rules;
2. synchronized channel constraints;
3. optional compact research evidence from browser or search providers;
4. AI-generated channel-aware caption, hashtag, and alt-text suggestions;
5. human selection and editing.

Research providers use a narrow contract and return evidence rather than
performing scheduling or silently rewriting final copy. A research packet
records the query, provider or plugin identity, retrieval time, source links,
short extracted findings, freshness, and safe errors. Suggestions record which
packet and model configuration influenced them.

Hashtags are normalized without the leading `#` for identity, retain deliberate
display order, and render according to the variant's placement rule. A future
project hashtag library may supply suggestions but does not force identical
sets across channels.

Generated alt text is accessibility-focused rather than promotional. It belongs
to the channel-variant revision because provider support and limits may differ.
A human review flag is required before scheduling a supporting channel. The
publish rendition freezes media bytes independently so two variants may reuse
the same rendition while carrying different reviewed alt text.

## CLI Contract

Provider-neutral commands operate on social resources:

```text
lineage social mark|unmark|list
lineage social item create|show|archive
lineage social variant add|edit|remove
lineage social suggest copy|hashtags|alt-text
lineage social research run|show
lineage social validate
lineage social schedule preview|confirm|retry
lineage social delivery diff|update|cancel
lineage social sync channels|item|project
```

Buffer configuration and inspection stay under the adapter namespace:

```text
lineage adapters buffer status
lineage adapters buffer connect
lineage adapters buffer channels
```

The exact command inventory may be grouped during implementation as long as the
domain operations and safety behavior remain intact.

Local mutations require the named Lineage profile, existing runtime and profile
identity gates, active claim enforcement where applicable, and
`--confirm-write`. Buffer mutations additionally require an explicit external
confirmation contract, exposed by the CLI as `--confirm-external`, bound to the
reviewed preview hash. Local write confirmation alone never authorizes an
external action.

JSON output is schema-versioned and contains normalized results, safe receipts,
exact IDs, and canonical recovery commands. Retry commands accept exact
delivery IDs and refuse deliveries with verified external IDs. Titles may be
used only when they resolve unambiguously within the exact project and canvas.

### Claim scope

Through Releases 1–4, every Social Work Item is anchored to its source canvas,
and that canvas workspace claim protects user-authored item, variant, rendition,
and delivery changes plus every external provider mutation. Read-only
inspection and provider-evidence reconciliation do not require a claim.
Reconciliation is serialized, appends provider observations and metrics, may
update normalized delivery lifecycle evidence, and is forbidden from changing
Lineage-owned variant revisions or editorial fields. Adopting an ambiguous
Buffer post is a human-authored identity decision and therefore does require
the canvas claim.

The dedicated Social workspace in Release 5 must add an explicit
`social_work_item` claim target and a shared conflict key with the originating
canvas. It may not create a second ownership path that bypasses an active canvas
claim. Until that claim type exists, social work without an originating canvas
is not supported.

## HTTP API Contract

The API exposes social resources and operations rather than arbitrary Buffer
commands:

```text
GET|POST  /api/social/items
GET       /api/social/items/:itemId
POST      /api/social/items/:itemId/variants
POST      /api/social/items/:itemId/research
POST      /api/social/items/:itemId/preflight
POST      /api/social/items/:itemId/schedule
GET|POST  /api/social/deliveries/:deliveryId
POST      /api/social/sync
GET|POST  /api/adapters/buffer/connection
GET|POST  /api/adapters/buffer/channels
```

Mutation bodies carry explicit confirmation, actor provenance, expected
revision or preview hash, and applicable claim tokens through the established
Lineage transports. Responses return authoritative current state. They never
return provider credentials or unrestricted raw provider bodies.

## Error Handling

- Authentication, organization, connection-fingerprint, or timezone mismatch:
  stop the entire operation before media upload.
- Missing or stale channel catalog: require manual channel sync before
  scheduling.
- Invalid, locked, paused, disconnected, or unsupported channel: fail preflight
  for that variant with an actionable reason.
- Image validation or upload failure: create no Buffer mutation.
- Daily posting limit or rate limit: preserve completed siblings and record
  provider retry guidance without retrying automatically.
- Provider validation error: attach the normalized field error to the exact
  variant.
- Timeout or ambiguous create response: enter `verification_required` and
  prohibit blind retry.
- Missing linked Buffer post: mark `external_missing`; do not recreate.
- Concurrent local edit: reject a stale expected revision and return the
  authoritative variant.
- Concurrent scheduling attempt: use a unique active-operation constraint and
  return the existing unexpired operation. For an expired lease, enter recovery
  and inspect its immutable attempts before allowing release or supersession.
- Deleted or missing source asset after promotion: preserve the work item and
  block new rendition creation with a repair instruction.
- Manual sync interruption: preserve the last processed page and offer a resume
  command.

## Security and Privacy

- Credentials remain in approved external secret storage or environment
  configuration and are referenced, never copied, by project records.
- Buffer is invoked without a shell. Validated JSON is passed through protected
  temporary files or a safe process-input boundary.
- Temporary payload files have restrictive permissions and are removed after
  their retention window.
- Logs contain operation IDs and normalized states, not complete captions,
  credentials, private media, or unrestricted provider payloads.
- Publish renditions are immutable. Upload receipts record checksums and safe
  object identity.
- Upload retention follows the reference-counted 30-day post-publication and
  seven-day unreferenced defaults; media with no observed publication time is
  retained indefinitely while referenced. Earlier cleanup requires
  acceptance-tested proof that Buffer no longer needs the source URL. Cleanup
  never invalidates a scheduled post.
- Research stores short findings and links rather than full copyrighted pages.
- Fixtures, tests, documentation, packages, and releases use synthetic IDs,
  media, captions, provider responses, and URLs.

## Verification Strategy

### User-facing claim

From a verified Lineage project, a user can promote a canvas node, compose
reviewed variants for supported image channels, confirm one scheduling
operation, recover safely from partial or ambiguous Buffer failures, and
manually synchronize linked results without leaking credentials or confusing
notification delivery with automatic publishing.

### Highest-risk failure modes

1. Duplicate Buffer posts after a timeout or retry.
2. Scheduling the wrong media, channel, organization, or timezone.
3. Reporting local success when Buffer rejected, lost, or later changed a post.

### Required evidence

- Unit tests for state transitions, revision hashes, hashtag rendering,
  timezone conversion, channel capabilities, and each image-channel payload
  compiler.
- Contract tests derived from the lockfile-pinned Buffer CLI schemas so field,
  enum, or response-union drift fails visibly.
- Integration tests using injected Buffer and media runners, temporary named
  profiles and databases, and deterministic safe responses.
- Failure-injection tests for timeout, crash between provider response and local
  persistence, lost response, malformed success union, expired operation lease,
  rate limits, ambiguous recent-post matches, partial batches, disconnected
  channels, missing remote posts, and unavailable media.
- Canvas component and browser tests covering promotion, variant composition,
  research evidence, validation, confirmation summaries, partial states, drift,
  manual synchronization, and performance evidence.
- CLI and HTTP parity tests proving that UI, CLI, and agents use the same domain
  services and safety rules.
- Privacy tests proving that API keys, real organization identities, private
  media, real presigned URLs, captions, and provider payloads do not enter
  public artifacts.
- A dedicated non-production Buffer organization acceptance run that schedules
  future synthetic posts, verifies external IDs, correlation-marker behavior,
  media availability, and rendered content, manually synchronizes them, and
  explicitly cancels the still-unsent posts.
- Repository gates appropriate to a meaningful release, including `npm run ci`,
  `npm run public:readiness`, `npm run package:smoke`,
  `npm run runtime:oracle`, and `npm run e2e`.

## Delivery Sequence

### Release 1: Social foundation

- Implement the approved canvas Social marks.
- Pin the supported `@bufferapp/cli` runtime, isolate project credentials, and
  add project-scoped Buffer connection identity and manual channel sync.
- Add the minimal versioned support matrix and capability registry needed to
  display and validate synchronized channels.
- Add Social Work Items, revisions, channel variants, and the canvas side panel.
- Support manual copy, structured hashtags, reviewed alt text, and validation.
- Perform no external scheduling.

### Release 2: Safe scheduling kernel

- Add immutable publish renditions and the managed media-upload adapter.
- Add operation leases, append-only delivery attempts, delivery receipts,
  preflight, confirmation, and recovery.
- Prove the complete flow with representative Instagram and LinkedIn variants.
- Support only `customScheduled` and `addToQueue`, with their different timing
  semantics visible throughout the UI and receipts.
- Add update, unsent cancellation, partial-success handling, human-confirmed
  ambiguous-result adoption, and expired-operation recovery.
- Include targeted `posts list` and `posts get` safety reads for ambiguous-create
  recovery and fresh update/cancellation authorization. Do not expose bulk
  synchronization or metrics yet.

### Release 3: Complete single-image channel support

- Expand through the Buffer capability registry to every connected Buffer
  service listed as supported in that Lineage version's tested single-image
  matrix.
- Add network-specific metadata such as Pinterest boards, Instagram post types,
  first comments, notification publishing, image constraints, and channel
  schedules.
- Keep unsupported combinations visible with actionable explanations.
- Treat this milestone as the first complete image-scheduling release.

### Release 4: Reconciliation and performance

- Add manual item and project synchronization.
- Synchronize linked status, errors, dates, URLs, remote drift, and missing
  posts.
- Add append-only metric snapshots and canvas performance evidence.
- Provide explicit branch and re-roll actions from performance views.

### Release 5: Assisted research and operations

- Add browser and search provider contracts and evidence packets.
- Add brand voice, campaign briefs, reusable hashtag libraries, and policy
  checks.
- Add the dedicated Social workspace for queue and batch operations over the
  same underlying model.

Each release receives its own approved implementation plan. A release must not
silently pull behavior from a later release merely because the schema anticipates
it.

## Future Directions

- `shareNext` queue promotion and `shareNow` immediate publishing, with
  separately reviewed risk and confirmation semantics.
- Deliberate adoption and linking of existing Buffer posts.
- Additional social scheduling providers using the same delivery boundary.
- Approval chains and role-based external-action authorization.
- Campaign tagging, UTM generation, and reusable channel templates.
- Optimal-time suggestions based on synchronized channel schedules and trusted
  historical performance.
- Explicit experiments comparing copy or creative variants.
- Licensing, consent, and media-expiry policy checks before scheduling.
- Webhook-based reconciliation if Buffer exposes a stable, verifiable contract
  and the product later chooses automatic inbound updates.
- Video, carousel, document, and thread-specific work-item extensions.
- Research-provider quality scoring and freshness policies.

These directions must reuse the approved authority, revision, receipt, and
confirmation boundaries rather than bypassing them.
