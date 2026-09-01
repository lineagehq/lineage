# Lineage

**The shared visual workspace where humans and agents shape creative work together.**

Chat is a good interface for directing agent-driven creative work, but it is not
built to hold the state of that work. Lineage keeps every asset, path, prompt,
iteration, relationship, selection, and annotation in one local-first record:
visual enough for humans to review and direct, and precise enough for agents to
retrieve through the CLI and continue accurately.

[See the landing page](https://lineage.neonwatty.com/) ·
[Install Lineage](#first-run) ·
[Use the Codex plugin](#codex-plugin) ·
[Develop locally](#local-development)

## One creative state for humans and agents

- **Humans keep the history organized.** Review branches and attempts, compare
  results, choose the exact asset to continue from, and annotate the next move.
- **Agents keep the context behind the work.** Read the same assets, prompts,
  relationships, and decisions instead of reconstructing them from chat.
- **Context travels both ways.** Agent-created work returns to the visual record;
  human selections and annotations become precise context for the next agent
  action.

With Lineage, you can trace an asset from its origin through every branch,
selection, and campaign format; continue from any useful point without losing
earlier work; and hand a clear, durable work packet to the next human, agent, or
downstream tool.

## Built with GPT-5.6 Sol in Codex

Lineage is itself a human-agent collaboration. We use GPT-5.6 Sol in Codex
throughout the project to:

- design and implement the web app, server, CLI, and version-locked Codex plugin;
- exercise real workflows through the Codex in-app browser and Codex Chrome
  extension, alongside automated browser tests;
- shape architecture and safety boundaries for runtime channels, local data,
  agent claims, and handoffs;
- diagnose failures, review changes, write tests, and stabilize end-to-end
  behavior;
- create and refine the landing page, including its visual design, interactions,
  and supporting visual assets; and
- build and verify CI, packaging, release automation, public documentation, and
  product messaging.

Model-assisted work is held to the same proof standard as any other change. The
repository's automated gates cover unit, integration, and browser behavior;
runtime and database isolation; public-readiness checks; installability; plugin
integrity; and dependency audits.

## First Run

### Prerequisites

Before installing anything, verify the tools used by the path you choose:

```bash
node --version
npm --version
npx --version
make --version
```

Lineage requires Node.js 22.22.0 or newer and npm, including the accompanying
`npx` command used by the plugin installer. Make is required only for the
documented `make` shortcuts. A real Codex installation is optional for the app,
but required to install and activate the Codex plugin; verify that additional
prerequisite with `codex --version` in the same shell before following the
plugin step. If either command is missing, restore its executable directory on
`PATH` before installing.

On the minimum supported Node 22 line, foreground startup can print one
`ExperimentalWarning` for Node's built-in SQLite module before the healthy
`Lineage listening` line. Lineage keeps that category-specific warning visible;
it does not indicate an identity or database failure.

### Develop from a fresh clone

This is the shortest source-development path with hot reload and isolated
development data:

```bash
git clone https://github.com/mean-weasel/lineage.git
cd lineage
npm ci &&
npm run lineage:dev -- runtime doctor --json &&
npm run lineage:dev -- profile init --profile team-development --confirm-write --json &&
npm run lineage:dev -- runtime doctor --json &&
npm run lineage:dev -- profile doctor --profile team-development --json &&
npm run lineage:dev -- db info --profile team-development --json &&
npm run dev -- --profile team-development
```

Open `http://lineage-dev.localhost:5198`, expand **Demo/QA** in the Canvas
context panel, then choose **Load demo lineage** for a small graph or **Load
rich image demo** for the full media-backed example. On later runs, reuse the
same healthy profile and run only the final start command. If profile
initialization reports an existing but unhealthy profile, run the exact
`profile doctor` command it prints before changing anything.

### Using the navigation shell

Lineage opens on Projects. Choose a project to reach its dedicated Workspaces
page, where workspaces can be searched, reordered, archived, deleted, and
opened in Canvas. Project-scoped destinations appear in the left rail only
after entering a project: Workspaces, Canvas, Assets, Content batches, Review,
Backup queue, Agents, Ledger, and Settings. **Workspaces** always opens the
project directory. After you open a workspace, **Canvas** returns to that exact
workspace in the current browser tab, including its card presentation. Use the
**L** mark to return to Projects; About Lineage remains available from the
information button at the bottom of the rail.

The adjacent context panel contains the current project plus controls that
apply to the active destination. Collapse it when you want more room, then
select the active rail destination to reopen it; its desktop state is
remembered in this browser. On mobile, the rail becomes a menu button that
opens the same navigation and context as a drawer.

Canvas uses the remaining viewport without a top toolbar. A compact location
bar keeps the workspace title visible and provides a separate **Workspaces**
back action. The context panel shows that workspace's identity, node/link
count, Replay growth, Plan outputs, output defaults, and selection management.
Maintenance and Demo/QA are collapsed by default. Workspace creation and
lifecycle management live on the Workspaces page rather than in a Canvas
switcher.

Use the gear at the upper right of Canvas for presentation and graph controls:
compact or portrait cards, direction, edge weight, edge labels, hover
previews, minimap visibility, the maximum queued branches, independent Branch
and Re-roll prompt behavior, prompt editing in the variation queue, Fit graph,
Tidy tree, and Reset appearance.
Visual choices use direct option cards, while minimap, edge labels, and hover
previews use on/off switches. These appearance choices are stored in the
browser. Canvas settings, selection, and Canvas asset details share one
right-side panel, so opening one replaces the other; on mobile that panel
becomes a bottom sheet. Panel and control transitions respect the system's
reduced-motion preference. Agent handoff now flows through the direct agent/UX
bridge and the Agents view rather than a separate bottom Agent Context drawer.

Choose **Branch** or **Re-roll** on a node—or focus it and press **B** or
**R**—to queue that action. By default, Lineage first offers an exact prompt;
the two **Ask for … prompt** Canvas switches can independently make Branch or
Re-roll a one-step mark instead. Saved prompts remain visible on the node and
are included in agent-readable task and generation handoffs. Open
**Variation queue** from the context panel or press **V** to see all queued
actions in one scroll, highlight their nodes, focus an item on the unobstructed
Canvas, edit its prompt, or remove it. Blank prompts remain explicitly missing
so the agent asks what should change instead of guessing.

Nodes with descendants show a small count control beside their outgoing
connection. Select it to collapse or expand that branch. Collapse state is
view-only and session-local, nested choices are preserved, shared descendants
remain visible through any other expanded path, and growth replay temporarily
shows the complete lineage.

### Install the published channels

Use the currently published npm dist-tags when you want installed rather than
checkout code:

```bash
npm install -g @mean-weasel/lineage@latest &&
lineage-channel install stable &&
lineage-stable runtime doctor --json &&
lineage-stable profile init --profile team-production --confirm-write --json &&
lineage-stable runtime doctor --json &&
lineage-stable profile doctor --profile team-production --json &&
lineage-stable db info --profile team-production --json &&
lineage-stable start --profile team-production
```

Preview is independent and must use its own runtime root and profile:

```bash
lineage-channel install preview &&
lineage-preview runtime doctor --json &&
lineage-preview profile init --profile team-preview --confirm-write --json &&
lineage-preview runtime doctor --json &&
lineage-preview profile doctor --profile team-preview --json &&
lineage-preview db info --profile team-preview --json &&
lineage-preview start --profile team-preview
```

The version in this checkout may be ahead of npm and is not necessarily
published. The channel installer resolves `latest` or `next` at install time;
do not substitute the checkout version or install both tags into one global npm
prefix.

To add the optional Codex plugin, first choose the exact Codex home you intend
to modify, then install and doctor the matching published channel:

```bash
export CODEX_HOME="$HOME/.codex"
npx --yes @mean-weasel/lineage-plugin-installer@latest install --channel latest --codex-home "$CODEX_HOME"
npx --yes @mean-weasel/lineage-plugin-installer@latest doctor --channel latest --codex-home "$CODEX_HOME"
```

If doctor fails, it prints a version-pinned remediation command for that same
Codex home. For verification, use a temporary `--codex-home`; do not test an
installer against your real Codex profile.

Maintainers can exercise the complete published and source journeys without
touching an existing Lineage or Codex installation by following the
[hermetic manual install dogfood runbook](MANUAL_INSTALL_DOGFOOD.md).

## Package Channels

Lineage is packaged as `@mean-weasel/lineage`, but stable and preview must not
be installed into the same global npm prefix. A global `npm install -g ...@next`
would replace the files and bins used by `latest`.

Use the stable package only as a bootstrap for the channel installer, then
resolve `latest` and `next` into separate content-addressed roots:

```bash
npm install -g @mean-weasel/lineage@latest
lineage-channel install stable
lineage-channel install preview
```

By default the installer writes immutable version/integrity roots beneath
`~/Library/Application Support/Lineage/runtimes`, plus channel-qualified
launchers in npm's global executable directory (the directory already on
`PATH` for the globally installed `lineage-channel`). Every launcher is pinned
to an absolute package root and install receipt; it does not select code from
`PATH` at runtime. Use `--shim-dir <path>` to choose another launcher directory,
or `--root <path>` to keep both a custom runtime and its launchers under that
root. Lineage never edits shell startup files.

The three exact channel meanings are:

- `stable` is npm `latest`, launched as `lineage-stable` from its receipt-bound root.
- `preview` is npm `next`, launched as `lineage-preview` from a different root.
- `dev` is the current Git checkout/worktree, launched from source with
  `npm run lineage:dev -- <command>`.

Verify code identity before inspecting data or starting a service:

```bash
lineage-stable runtime doctor --json
lineage-preview runtime doctor --json
npm run lineage:dev -- runtime doctor --json
```

On a first install, initialize one new profile per channel before starting it:

```bash
lineage-stable profile init --profile team-production --confirm-write --json
lineage-preview profile init --profile team-preview --confirm-write --json
npm run lineage:dev -- profile init --profile team-development --confirm-write --json
```

Fresh-profile bootstrap exception: because profile doctor and `db info` cannot
pass before a profile and database exist, run runtime doctor first, perform the
atomic `profile init`, and then immediately run runtime doctor, profile doctor,
and `db info --profile <profile> --json`. Do not start a service or perform
another write until that post-init gate passes.

`profile init` derives the environment and exact verified code pin from the
launcher, creates owner-only media and SQLite paths, binds the new database
identity, and publishes the profile manifest only after those steps succeed.
It is fresh-only: it never adopts or overwrites an existing directory or
database. Use `profile bind` only to migrate an existing database.

`runtime doctor` fails unless channel, canonical package/checkout root, exact
version, embedded Git/build fingerprint, install receipt, and installed package
tree agree. `runtime info` prints the same identity without requiring it to pass
and is intended for repair diagnostics.

A published package still carries a `lineage-dev` migration stub so old global
links fail with checkout guidance. It never runs package code as dev.

Start each foreground runtime explicitly:

```bash
lineage-stable start --profile team-production
lineage-preview start --profile team-preview
npm run lineage:dev -- start --profile team-development
```

Stable defaults to `lineage.localhost:5197`, dev to
`lineage-dev.localhost:5198`, and preview to
`lineage-preview.localhost:5199`. A named profile owns its host, port, database,
and asset root. To choose another service origin, set it when creating the
profile:

```bash
lineage-stable profile init --profile team-production-6123 \
  --service-origin http://lineage.localhost:6123 --confirm-write --json
lineage-stable start --profile team-production-6123
```

Starts with a named profile reject conflicting `--host`, `--port`, `--db`, or
asset-root selections. Direct path selection is retained only for explicit
diagnostic, read-only access. The installed package directory remains
responsible only for bundled code, web assets, and public demo fixtures.

## Runtime Channels and SQLite

Lineage treats attested code identity and local SQLite data identity as separate,
simultaneously required concerns:

- `stable` is the isolated npm `latest` install and daily-use channel.
- `preview` is the isolated npm `next` candidate.
- `dev` is the current Git checkout/worktree and may be dirty.

Each channel must use its own code root, runtime directory, and SQLite database.
Do not point preview or dev code at the stable database. Use the profile clone
command when a realistic preview/dev dataset is needed; it reads the source
through SQLite's online backup API and gives the target a fresh non-production
identity. Direct `--db` and `LINEAGE_DB` selection is diagnostic/read-only
unless a matching named profile has been selected and its writer lease is held.

For repeatable or multi-session work, prefer a named profile over those legacy
path defaults. A profile is an immutable identity contract for one Lineage
service and its data:

```json
{
  "schema_version": "lineage.profile.v1",
  "profile_id": "team-production",
  "environment": "production",
  "expected_runtime": {
    "channel": "stable",
    "code_origin": "package",
    "code_fingerprint": "<64-character fingerprint from runtime doctor>"
  },
  "database_path": "./lineage.sqlite",
  "asset_root": "./media",
  "service_origin": "http://lineage.localhost:5197"
}
```

Named profiles live at `$LINEAGE_PROFILE_ROOT/<profile-id>/profile.json` by
default, or can be selected with an explicit manifest path. Relative database
and asset paths resolve from the manifest directory. Create a fresh profile,
then inspect it without making further changes:

```bash
lineage-stable profile init --profile team-production --confirm-write --json
lineage-stable profile doctor --profile team-production --json
lineage-stable start --profile team-production
```

Pass `--service-origin http://host:port` to `profile init` when the profile
must use a non-default local origin. Once initialized, that origin is part of
the immutable profile identity rather than a per-start override.

`LINEAGE_PROFILE` is equivalent to `--profile`. Profile commands reject direct
`--db` and `--asset-root` overrides, and a dev or preview runtime refuses to
open a production profile. Doctor also requires the existing SQLite database
to have one matching `lineage_profile_identity` binding, including the profile
manifest fingerprint. Binding is an explicit migration operation:

```bash
lineage-stable profile bind --profile team-production --confirm-write --json
```

The profile must pin the exact verified code origin and fingerprint before it
can be bound or used for writes. `profile bind` may add a fingerprint to a
matching legacy identity, but refuses a conflicting identity. An unprofiled
CLI or service is `legacy-unbound` and read-only; mutating CLI commands and HTTP
methods fail with a profile-required error instead of creating a database.
That error points new installations to `profile init`; direct database paths do
not opt a process into writes.

Checkout fingerprints intentionally change as tracked or untracked source
changes. To repin an existing development profile, first stop its managed
service, then run the guarded checkout-only workflow:

```bash
make repin-dev LINEAGE_DEV_PROFILE=team-development
```

The underlying explicit command is:

```bash
npm run lineage:dev -- profile repin-runtime \
  --profile team-development --checkout-root "$PWD" --confirm-write --json
```

Repin accepts only a verified dev checkout whose canonical root equals
`--checkout-root`, an owner-only development manifest already pinned to
dev/checkout, and an available profile writer lease. It atomically replaces
only `expected_runtime`; profile/database identity, paths, environment,
service origin, and migrations stay unchanged. Production, preview, package,
wrong-root, unsafe-manifest, unconfirmed, and active-service cases fail closed.
The command may prepare a new structurally valid development manifest before
its database and asset root are cloned.

### Upgrade a stable production profile

A stable package update and a production profile runtime pin are separate
operations. Upgrade only while the matching managed service is stopped:

```bash
make stop-prod LINEAGE_PROD_PROFILE=team-production
make upgrade-prod LINEAGE_PROD_PROFILE=team-production
make start-prod-bg LINEAGE_PROD_PROFILE=team-production
make status-prod LINEAGE_PROD_PROFILE=team-production
```

`upgrade-prod` installs the current npm `latest` into a new receipt-bound stable
root, runs stable runtime doctor, confirms `profile upgrade-runtime`, then runs
runtime doctor, profile doctor, and profile-selected `db info`. It deliberately
does not stop or restart the service for you, so the stopped interval and the
post-upgrade readiness check stay explicit.

The equivalent commands between stop and start are:

```bash
make install-prod
lineage-stable runtime doctor --json
lineage-stable profile upgrade-runtime \
  --profile team-production --confirm-write --json
lineage-stable runtime doctor --json
lineage-stable profile doctor --profile team-production --json
lineage-stable db info --profile team-production --json
```

The upgrade target comes only from the executing verified stable package.
Preview/dev/unverified code, an active writer, a downgrade, a same-version
identity change, unhealthy profile data, or unsafe manifest ownership fails
before a new pin is accepted. The operation preserves the profile fingerprint,
database and asset paths and contents, service origin, migration requirements,
and unknown manifest fields.

To create a realistic preview or development database without copying a live
SQLite file directly, define a new non-production target profile whose database
does not exist, then run:

```bash
lineage-preview profile clone --source-db /path/to/source.sqlite \
  --target-profile team-preview --confirm-write --json
npm run lineage:dev -- profile clone --source-db /path/to/source.sqlite \
  --target-profile team-development --confirm-write --json
```

Clone refuses production targets, existing target files, source/target path
reuse, unverified code, and missing confirmation. It writes a local receipt
under the target profile directory after SQLite integrity and identity checks.

When migrating a legacy installation whose production media still lives under
a development checkout, stage only database-referenced local files into the
new profile's nonexistent, dedicated asset root before binding or starting it:

```bash
lineage-stable profile clone-assets --source-asset-root /path/to/legacy/checkout \
  --target-profile team-production --confirm-write --json
```

Asset clone holds the target profile's writer lease, refuses reused or nested
roots and escaping references, reserves the target without clobbering, verifies
every copied file by SHA-256, uses owner-only permissions, and writes a compact
receipt. Missing legacy references are counted rather than silently replaced;
unreferenced checkout scratch files are not copied. Inspect that count before
binding the database. The source database and asset tree remain read-only.

A named profile has one cross-process writer lease at
`<profile-directory>/writer.lock`. The managed service holds that lease for its
lifetime, so a second service or one-shot CLI writer is refused while it is
running. A CLI data command may hold the same lease only while the service is
offline. Lineage verifies lease ownership before opening a named-profile
database for writes and configures SQLite with WAL journaling and a five-second
busy timeout. If an owner was killed, the next writer may reclaim the lock only
after the recorded PID is no longer alive; malformed or mismatched lock metadata
is left in place for manual inspection. `profile doctor` never acquires or
modifies the lease. The lease records both the immutable profile ID and manifest
fingerprint; legacy-unbound access never acquires a writer lease.

Check the active runtime before making changes:

```bash
lineage-stable db info --profile team-production --json
lineage-preview db info --profile team-preview --json
npm run lineage:dev -- db info --profile team-development --json
```

Offline `db info` reports the one-shot CLI under `process` with
`role: "command"` and omits `service`; its PID is never service-health evidence.
HTTP runtime responses from a launched app report `process.role: "service"` and
a separate `service` identity. `service.mode: "managed"` records the launch
context only—managed health still requires the profile-scoped receipt and an
exact `/api/runtime` code/profile/database/instance match.

Managed services are profile-scoped. Their receipts record the launcher PID
and start token, unique service instance, code root/fingerprint, profile and
database fingerprints, origin, and log path. Start waits for `/api/runtime` to
match every field before reporting success or opening a browser. Status exits
nonzero for a stale PID, unreachable service, current-code drift, wrong port,
or any code/profile/database/instance mismatch:

```bash
make start-prod-bg LINEAGE_PROD_PROFILE=team-production
make status-prod LINEAGE_PROD_PROFILE=team-production
make start-preview-bg LINEAGE_PREVIEW_PROFILE=team-preview
make start-dev-bg LINEAGE_DEV_PROFILE=team-development
```

Use the matching `status-*`, `logs-*`, and `stop-*` target with the same profile
variable. Stable and preview targets execute the service controller from that
channel's attested, content-addressed package root; only dev executes the
checkout controller. Stop signals only the process identity recorded for that profile.
Checkout-backed `start-local-prod` and registration-only launchd/tmux status
paths are intentionally not supported.

The app shows a persistent environment/profile badge, and Settings includes the
profile binding, code origin/root/fingerprint, channel, version, embedded Git
revision, schema markers, and SQLite path.

## Agent Claims

Mutating agent writes use target-scoped claim tokens. Read-only inspection stays
available without a claim, but confirmed writes such as lineage `link-child` and
claimed content post attach/phase actions require a matching token when a target
is already claimed.

Create a claim and copy the raw token at creation time:

```bash
lineage agent claim --project demo-project --scope lineage_workspace --target demo-project:lineage-workspace:<root-asset-id> --target-title "TikTok hook lineage" --agent-name "Codex thread 123" --ttl 20m --json
export LINEAGE_CLAIM_TOKEN='claim_abc.secret_xyz'
```

Agents can inspect the current lineage graph without a claim:

```bash
lineage agent graph --project demo-project --root <root-asset-id> --json
```

Agents can also export the current active workspace selection as a durable JSON
packet for downstream tools such as GrowthOps:

```bash
lineage selection packet --project demo-project --channel linkedin --campaign 2026-07-launch \
  --db /absolute/path/to/lineage.sqlite --asset-root /absolute/path/to/asset-repo \
  --out ./lineage-selection-packet.json --json
```

The packet is schema-versioned as `lineage.selection_packet.v1` and includes the
workspace/root binding, selected asset IDs, local media paths when known, S3 key
metadata when known, context labels/notes, warnings, and a stable `packet_id`.
Lineage only exports the packet. GrowthOps or another downstream tool remains
responsible for importing it, creating posts, checking media readiness, preparing
public URLs, scheduling, and recording placement receipts.

Version 1 remains the default for compatibility. Opt in to the current-attempt-
bound contract with `--schema v2`:

```bash
lineage selection packet --project demo-project --schema v2 \
  --out ./lineage-selection-packet-v2.json --json
```

The `lineage.selection_packet.v2` packet requires a verifiable current attempt
and lowercase SHA-256 checksum for every selected asset. Its full
`identity_sha256` and derived `packet_id` bind only the canonical semantic
selection: project/product, workspace/root, context, ordered selected assets and
their current attempts, and stable diagnostics. Timestamps, local paths, storage
details, source metadata, generation job IDs, and human-readable warning/error
text stay in the envelope but do not change v2 identity.

Use `--schema v3` before node-target-driven image generation. Version 3 retains
the verified v2 media identity and adds separate `current_geometry` and
`next_output_targets` facts for every selected node. Its
`selected_source_resolution_digest_sha256` covers the effective target
resolution for the complete ordered selection:

```bash
lineage selection packet --project demo-project --root <root-asset-id> --schema v3 --json
```

Keep the claim fresh and pass it to mutating commands:

```bash
lineage agent heartbeat --claim-token "$LINEAGE_CLAIM_TOKEN" --json
lineage link-child --project demo-project --root <root-asset-id> --child <child-asset-id> --summary "Cleaner type" --claim-token "$LINEAGE_CLAIM_TOKEN" --confirm-write --json
lineage agent release --claim-token "$LINEAGE_CLAIM_TOKEN" --json
```

`lineage link-child` creates a new visible descendant in the lineage graph. Do
not use it for re-rolls. The coordinating agent must supply `--summary` with a
one- or two-word description of the change from parent to child.

For a coordinated multi-output generation job, plan from the selected lineage
bases, copy `job.handoff.output_manifest` from the JSON response into a manifest
file, and fill every output's `file_path` and distinct one- or two-word
`edge_summary` before import:

```bash
lineage generate image plan --project demo-project --prompt "Create two variations" --from-lineage-selection --count 2 --json
lineage generate image inspect --project demo-project --job-id <job-id> --json
lineage generate image import --project demo-project --job-id <job-id> --manifest .asset-scratch/generation-output-manifest.json --confirm-write --json
```

Static-image output locks are discoverable offline; agents must resolve an
explicit delivery surface instead of guessing from a platform name:

```bash
lineage output-targets list --media image --json
lineage output-targets resolve --query "Instagram Feed portrait" --json
lineage output-targets defaults --project demo-project --root <root-asset-id> --json
lineage output-targets node get --project demo-project --root <root-asset-id> --node <node-asset-id> --json
lineage output-targets node set --project demo-project --root <root-asset-id> --node <node-asset-id> --destination instagram.story --confirm-write --json
lineage output-targets node replace --project demo-project --root <root-asset-id> --node <node-asset-id> --expected-revision <revision> --destination instagram.feed_portrait --confirm-write --json
lineage generate image plan --project demo-project --prompt "Create persisted variants" --from-lineage-selection --from-node-targets --expected-target-resolution-digest <selection-v3-digest> --variants-per-target 2 --json
lineage generate image plan --project demo-project --prompt "Create campaign variants" --from-lineage-selection --destination instagram.feed_portrait --destination instagram.story --custom-dimensions 1200x1500 --variants-per-target 2 --json
lineage generate image plan --project demo-project --prompt "Create per-source variants" --from-lineage-selection --target-map target-map.json --json
```

Platform-only resolution returns selectable surfaces. Repeated destination and
custom-dimension flags are one-source shorthand; multiple selected sources
require a complete `lineage.generation_target_map.v1` file. Use
`--separate-destination` to prevent same-sized surfaces from consolidating.
Target-aware jobs reject legacy `--count` and `--per-base-count`; variant counts
default to one per resolved group and can be set with `--variants-per-target` or
per target in the map. Defaults are read-only to agents and the CLI.

Node settings are sticky and geometry-only. `node set` refuses an existing
setting; a conflict requires the distinct `node replace` command with its exact
revision, and `node clear` also requires that revision before returning to the
current human canvas default. Plan-from-node requires the v3 selection digest
and snapshots exact pixels, origin, revision/digests, and frozen surface
metadata before provider work. Later setting changes do not mutate the job.
Use `generate image cancel --job-id <job-id> --confirm-write` to abandon a
planned job; cancelled jobs cannot import.

Newly planned selection jobs require the versioned manifest and reject mixed
`--manifest`, `--files`, or `--parent-files` input. Jobs already planned with
the legacy adapter may still finish with `--files` or `--parent-files`; those
legacy child edges remain unlabeled. Manifest retries are idempotent only while
the output mapping, original summary, and current agent provenance still match.
Asset indexing precedes the receipt transaction, so a later transactional
failure can leave an indexed asset even though outputs, edges, receipt, job
status, and selection reset roll back together.

For re-roll work, mark the target, have the agent plan/import one replacement
attempt, and cancel only when the request should be abandoned:

```bash
lineage reroll mark --project demo-project --root <root-asset-id> --target <target-asset-id> --notes "Fix distorted text" --confirm-write --json
lineage reroll list --project demo-project --root <root-asset-id> --json
lineage reroll plan --project demo-project --root <root-asset-id> --target <target-asset-id> --prompt "Regenerate with clean readable text" --json
lineage reroll import --project demo-project --job-id <job-id> --file <.asset-scratch-file> --confirm-write --json
lineage reroll cancel --project demo-project --root <root-asset-id> --target <target-asset-id> --confirm-write --json
```

`lineage reroll import` updates the target node's current attempt and should
not add a visible child edge.

Lineage task queue commands expose the same work as explicit tasks that agents
can inspect, claim, start, comment on, and cancel:

```bash
lineage tasks list --project demo-project --root <root-asset-id> --json
lineage tasks inspect --project demo-project --task <task-id> --json
lineage tasks claim --project demo-project --task <task-id> --agent-name "Task worker" --json
lineage tasks start --project demo-project --task <task-id> --claim-token "$LINEAGE_CLAIM_TOKEN" --json
lineage tasks comment --project demo-project --task <task-id> --message "Blocked on source art review." --json
lineage tasks cancel --project demo-project --task <task-id> --confirm-write --override --json
lineage tasks instructions --project demo-project --task <task-id> --instructions "Preserve palette; replace unreadable text." --json
lineage tasks override --project demo-project --task <task-id> --reason "Human is reassigning the work." --instructions "Use the updated brief." --json
```

The app-created claim-aware handoff packet includes the same token export,
heartbeat, inspect, and write commands. Raw claim tokens are not shown in the
read-only Agents view.

Use `project_channel` only for rare work that intentionally owns an entire
project/channel lane. Prefer `lineage_workspace` or `content_post` claims for
normal target-scoped agent work:

```bash
lineage agent claim --project demo-project --scope project_channel --target demo-project:channel:tiktok --channel tiktok --agent-name "Channel owner" --ttl 20m --json
```

## Codex Plugin

The versioned Codex plugin lives in `plugins/lineage-codex-plugin`. Install the
plugin that matches the resolved `@mean-weasel/lineage` package version with:

```bash
npx --yes @mean-weasel/lineage-plugin-installer@latest install --channel latest
npx --yes @mean-weasel/lineage-plugin-installer@latest doctor --channel latest
```

The explicit installer `@latest` prevents `npx` from reusing an older installed
or cached CLI. Both commands honor `CODEX_HOME`; pass `--codex-home <path>` to
make the target visible in the command and machine-readable result. `doctor` is
read-only and fails unless the selected Codex home reports the matching plugin
installed and enabled from the expected Lineage marketplace root.
On failure it distinguishes a missing or mismatched marketplace, missing or
disabled plugin, version mismatch, and invalid manifest, then prints an exact
`--version`-pinned install/reinstall command for that Codex home.

The installer verifies the plugin artifact checksum and rejects plugin manifests
whose version or `lineage.version` does not exactly match the resolved Lineage
package version. It then creates a dedicated marketplace under the active
`CODEX_HOME`, registers that marketplace with supported `codex plugin`
commands, installs the plugin, and verifies that Codex reports the exact version
as installed and enabled. Use `--target-dir <path>` for a files-only install or
`--dry-run` for a non-mutating activation plan. The plugin artifact and installer
package are released from this public repository.

Every Lineage release preflights the current operator skill, packs and checksums
the exact matching plugin, installs that artifact into a temporary Codex plugin
root, and attaches both files to the versioned GitHub release before npm publish
or dist-tag mutation is allowed. Release status reports the local version lock
and GitHub assets. The installed skill requires isolated channel launchers,
named profiles, managed service identity status, and profile-only writes.

The checkout also exposes `.agents/plugins/marketplace.json`, which points only
at the checkout plugin and marks it installed by default for new development
tasks. That repo marketplace is separate from the installer-managed marketplace
under `CODEX_HOME`; restart Codex and use a brand-new task when validating either
activation path.

## Local Development

For source development with hot reload:

```bash
npm ci
npm run lineage:dev -- profile init --profile team-development --confirm-write --json
npm run dev -- --profile team-development
```

Both source and bundled server starts require a named profile. The hot-reload
launcher doctors the profile before it binds a port, then derives the database,
asset root, host, and port exclusively from that profile. Reuse an existing
development profile by omitting the `profile init` line.

For the profile-safe CLI and managed development service, prepare the checkout
once, initialize a development profile, and start it:

```bash
make install-dev
npm run lineage:dev -- profile init --profile team-development --confirm-write --json
make start-dev LINEAGE_DEV_PROFILE=team-development
```

Managed starts are idempotent: rerunning the same `start-*-bg` command returns
success only after the existing service again matches the exact code, profile,
database, origin, and service-instance receipt. Identity conflicts and unhealthy
services remain errors. If `profile init` reports that a profile already passes
doctor, reuse it with `start --profile <id>`; if it fails doctor, run the printed
`profile doctor` command and inspect the profile directory before retrying.

`make install-dev` installs the locked dependencies and builds the bundled
server required by `lineage-dev start`; no separate build command is needed.
Run the verification gates with:

```bash
npm run ci
npm run onboarding:smoke
npm run runtime:oracle
```

`npm run dev -- --profile <development-profile>` starts the local development server from source with Vite hot reload. `npm run ci` runs the full local verification gate.
`npm run onboarding:smoke` uses only temporary runtime, profile, service, npm,
media, and Codex roots to prove the installed stable launcher, profile init and
doctor, managed app, basic and rich seeds, CLI handoff, plugin activation, and
plugin doctor as one first-user journey. It uses the real `codex` executable
when one is on `PATH`; otherwise it uses a deterministic protocol harness so
the public CI gate remains portable. Run `npm run plugin:codex-smoke` on a
machine with Codex installed for real-CLI activation, reinstallation, cleanup,
and rollback proof.
`npm run runtime:oracle` creates three temporary code roots, profiles,
databases, ports, and managed services, proves their identities are distinct
while all are live, attacks every cross-channel and stale-identity boundary,
and then cleans up.

## Command Shortcuts

The root `Makefile` provides memorable wrappers for common setup, startup, and
verification commands. Run `make` or `make help` to list the available targets.
`make install-prod` and `make install-preview` bootstrap the published
`@mean-weasel/lineage@latest` package under the isolated runtime root before
creating the channel runtime and its launchers, so they work from a fresh clone
without checkout build artifacts or overwriting an existing channel launcher.

```bash
make install-prod
make install-plugin-prod
make start-prod LINEAGE_PROD_PROFILE=team-production
make start-prod-bg LINEAGE_PROD_PROFILE=team-production
make status-prod LINEAGE_PROD_PROFILE=team-production
make check
make smoke
```

The Makefile is only a convenience layer. npm scripts, the packaged CLIs, and
GitHub release workflows remain the source of truth for build, test, and release
behavior.

## Release Checks

Use `next` for candidate builds and `latest` for the stable public channel. Check the current local, npm, and workflow state with:

```bash
npm run release:status
```

For local release validation:

```bash
npm run release:dry-run -- --tag next
npm run release:claim-smoke -- --package @mean-weasel/lineage@next
npm run release:dry-run -- --tag latest
npm run release:policy:test
```

The release script verifies package metadata, changelog version coverage, public-readiness scans, install smoke, browser smoke, audit, package contents, and the version-locked Codex plugin before publishing. The GitHub plugin artifact and checksum must exist before npm publish. GitHub Actions runs CI on pull requests and `main`; publishing is controlled by a new immutable annotated release tag.

The release tag is the public release authority:

- Merge the exact root, lockfile, plugin package, plugin manifest, `lineage.version`, and changelog version to `main` and require CI to pass.
- Create a new annotated `v<package.json version>` tag on that reviewed `main` commit and push the tag once. Never move, replace, or reuse a release tag.
- A stable SemVer tag such as `v0.2.0` creates a full GitHub Release and publishes the same npm version to `latest`.
- A prerelease SemVer tag such as `v0.2.0-rc.1` creates a GitHub prerelease and publishes the same npm version to `next`.

The tag-triggered Release workflow rejects lightweight tags, tags that do not point to a commit already on `main`, mismatched version metadata, and missing changelog sections. It builds and verifies the plugin tarball and checksum on the matching GitHub Release before publishing npm, then verifies the GitHub release mode, npm dist-tag, tag commit, and assets. To dogfood before a stable release, publish an explicit prerelease version such as `0.2.0-rc.1`; do not publish a stable version to `next` and later reinterpret the same version.

## Demo Fixture

Source checkouts and installed packages include a synthetic public demo catalog at `fixtures/demo-project/assets/catalog.json`. When `demo-project/assets/catalog.json` does not exist in the repo root, Lineage uses that fixture so the demo project can load without private storage or customer data.

If you create a real `demo-project/assets/catalog.json`, that root project catalog overrides the packaged fixture. The fixture keeps S3-shaped metadata for realistic catalog structure, but default previews are generated local SVG data URLs and do not call storage.

Lineage also includes a lightweight Swissifier rich-demo manifest at `fixtures/demo-project/lineage/swissifier-rich-demo.json`. The manifest stores only synthetic metadata, checksums, graph edges, layout positions, and selected next-variation bases. It does not include local SQLite state.

The package intentionally includes three public-safe synthetic Swissifier re-roll PNG fixtures in `fixtures/demo-project/lineage/swissifier-rerolls/`. They are the only generated PNG media committed with the rich demo, and each file is pinned in the manifest by filename, SHA-256, size, content type, prompt, and demo generation job id so public-readiness and package-smoke checks can prove the fixture is hermetic.

To hydrate the Swissifier demo with real images, expand **Demo/QA** in the
Canvas context panel and use **Download rich images**. Lineage downloads
`swissifier-rich-demo-v1.tar.gz` from the [v0.1.2 GitHub
release](https://github.com/mean-weasel/lineage/releases/tag/v0.1.2), verifies
the archive checksum, safely unpacks the PNGs into local scratch storage, and
then verifies each PNG checksum before loading the rich demo.

Future rich-demo media packs should follow the same split unless a small synthetic media exception is explicitly documented and manifest-pinned like the packaged re-roll PNGs: commit lightweight manifest changes, attach generated media archives to the GitHub release for the app version that first references them, then pin the public release URL, archive size, and SHA-256 in the manifest. If a later app release reuses an unchanged media pack, keep the manifest pointed at the original release asset instead of duplicating the archive.

For manual verification or offline restore, the expected archive checksum is:

```sh
shasum -a 256 swissifier-rich-demo-v1.tar.gz
```

`24edc5307d0932ddc8a151c6a8c1001a08c45075e3ae198082038c44519be0de`

The previous manual path remains available: unpack the media pack yourself, set `LINEAGE_SWISSIFIER_MEDIA_DIR` to that folder, then use the Demo seed menu to restore media and load Swissifier.

## Data And Privacy

Lineage stores local workspace state in a SQLite database on your machine. Public fixtures are synthetic and must not contain private names, credentials, presigned URLs, real customer content, private campaign data, or real media. Keep private catalogs and media outside public package fixtures.
