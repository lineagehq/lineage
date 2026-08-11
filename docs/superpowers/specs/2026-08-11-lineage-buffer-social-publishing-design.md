# Lineage–Buffer Social Publishing Design

**Date:** 2026-08-11

**Status:** Approved umbrella design

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
- **Sync cadence:** Channel and linked-post synchronization are manual only.
- **Performance:** Metrics are timestamped evidence. Users may explicitly branch
  or re-roll from a performer; metrics do not create work automatically.
- **Primary interface:** The Lineage canvas side panel is the primary composer.
  A dedicated Social workspace is a later operational view over the same data.
- **Channel scope:** The first complete scheduling release supports
  single-image posts across every connected Buffer service that exposes a
  compatible image-post capability. Multi-image carousels remain deferred.
- **Notification publishing:** Notification-only post types are available only
  through an explicit per-variant choice and are never labeled automatic.
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
| `social_sync_runs` | Manual sync scope, progress, counts, warnings, and failures |
| `social_metric_snapshots` | Delivery, normalized metric type, value, unit, provider freshness, and retrieval time |
| `buffer_connections` | Project-to-organization identity, credential reference, timezone, fingerprint, and channel-sync time |
| `buffer_channels` | Synced channel identity, service, capabilities, schedule, lock/disconnect state, and safe metadata |

### Invariants

- Work items, variants, operations, and deliveries use immutable IDs rather than
  mutable titles.
- Editing a variant creates a new immutable revision; it does not rewrite the
  revision referenced by an existing delivery.
- A normalized revision hash covers final text, structured hashtags and
  placement, reviewed alt text, network metadata, delivery mode, schedule,
  channel identity, and source-rendition identity.
- A delivery identifies the exact variant revision and publish rendition sent
  to Buffer.
- A successful external Buffer post ID is unique within its connection and is
  never eligible for another create attempt.
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

Manual channel synchronization lists channels for the configured organization
and fetches detailed metadata where required. The catalog records:

- Buffer channel ID, organization ID, service, service ID, display name, and
  avatar reference;
- timezone and posting schedule;
- disconnected, locked, or paused state;
- allowed actions and automatic or notification publishing support;
- image post types, required metadata, asset constraints, and scheduling modes;
- network-specific requirements such as Pinterest board identities;
- the Buffer schema or CLI version from which capabilities were derived.

Disconnected, locked, or unsupported channels remain visible in the composer
with actionable explanations. The scheduler never guesses channel IDs or moves
an ID between organizations.

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
   publishing and a supported Buffer scheduling mode. Display every time with
   its timezone.
5. **Preflight:** validate copy and hashtag rules, required provider metadata,
   channel schedule and posting limits, media type and dimensions, publishable
   upload, current channel health, and connection identity.
6. **Confirm schedule:** show the exact channels, text, hashtags, media
   checksum, publishing method, local times, warnings, and external mutations.
   One explicit confirmation creates the operation.
7. **Observe:** show per-variant receipts, partial failures, projected revision,
   drift, last manual sync, published URLs, and performance snapshots.

## Workflow States

Variants transition through these normalized states:

```text
draft
  -> needs_review
  -> ready
  -> scheduling
     -> scheduled
     -> failed
     -> verification_required
  -> published
  -> drifted
  -> attention
  -> cancelled
  -> archived
```

`verification_required` is not a failure eligible for automatic retry. It
means Buffer may have accepted a non-idempotent create even though Lineage did
not receive a usable response. `attention` covers provider errors, a missing
linked post, or a state that requires human resolution.

Work-item status is derived from its variants. A work item may therefore be
partially scheduled or partially published. Successful siblings are never
downgraded because another variant failed.

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

### Payload compiler

Combines one immutable variant revision, rendition, and synchronized channel
capability record into the exact Buffer payload. The generated JSON is
validated against the installed Buffer CLI schema before any external
mutation. Per-network compilers own required metadata and constraints.

### Delivery coordinator

Performs final identity checks and preflight, records the confirmed operation,
then creates each Buffer post independently. It persists a normalized attempt
state before and after each provider call, preserving partial success and exact
recovery scope.

### Reconciliation service

Manually fetches only deliveries with stored Buffer post IDs. It synchronizes
provider status, due and sent times, external link, errors, remote content
fingerprints, and explicitly requested metrics. It records sync progress and
can resume a project-wide paginated run after interruption.

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
  evidence.
- Zero matches permits a separately confirmed retry.
- Multiple matches require human resolution and expose candidate IDs and safe
  comparison fields.

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

Cancellation requires confirmation, invokes Buffer deletion, and retains a
local delivery tombstone and provider receipt. If a manually synchronized
Buffer post is missing, Lineage marks it `external_missing` under the broader
`attention` state. It never recreates the post automatically.

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
  return the existing operation.
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
- Upload retention and cleanup are configurable and occur only after Buffer has
  safely ingested or published the rendition. Cleanup never invalidates a
  scheduled post without explicit proof that the URL is no longer needed.
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
- Contract tests derived from the installed Buffer CLI schemas so field and enum
  drift fails visibly.
- Integration tests using injected Buffer and media runners, temporary named
  profiles and databases, and deterministic safe responses.
- Failure-injection tests for timeout, lost response, malformed success union,
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
  future synthetic posts, verifies external IDs and rendered content, manually
  synchronizes them, and explicitly cancels them.
- Repository gates appropriate to a meaningful release, including `npm run ci`,
  `npm run public:readiness`, `npm run package:smoke`,
  `npm run runtime:oracle`, and `npm run e2e`.

## Delivery Sequence

### Release 1: Social foundation

- Implement the approved canvas Social marks.
- Add project-scoped Buffer connection identity and manual channel sync.
- Add Social Work Items, revisions, channel variants, and the canvas side panel.
- Support manual copy, structured hashtags, reviewed alt text, and validation.
- Perform no external scheduling.

### Release 2: Safe scheduling kernel

- Add immutable publish renditions and the managed media-upload adapter.
- Add operation records, delivery receipts, preflight, confirmation, and
  recovery.
- Prove the complete flow with representative Instagram and LinkedIn variants.
- Add update, cancellation, partial-success handling, and ambiguous-result
  verification.

### Release 3: Complete single-image channel support

- Expand through the Buffer capability registry to every connected Buffer
  service that exposes a compatible single-image post capability.
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
