# Agent Notes

Use an adversarial proof standard. Before declaring work complete, state the user-facing claim, name the top three realistic failure modes, and gather evidence with commands, tests, screenshots, traces, or direct inspection.

Do not commit private media, credentials, private campaign data, real presigned URLs, customer content, or local SQLite databases.

Default feature implementation contract:

1. Keep one task aligned to one feature, one branch/worktree, and one pull request. If the objective, branch, profile, database, pull request, or operational phase changes, stop and require a new task or explicit user authorization for the expanded scope.
2. Start feature work from a freshly fetched `origin/main` in a new `codex/` worktree unless the user explicitly chooses another reviewed base. Before design or code, report an isolation receipt containing the base SHA, branch, clean status, code root, dedicated dev profile, database identity, service origin, and channel-gate result. Preserve every unrelated checkout, worktree, and user change.
3. Derive and state the smallest useful scope, explicit non-goals, and acceptance criteria from the request. Batch only genuinely blocking or irreversible product decisions into one message with recommended defaults; otherwise proceed autonomously. Do not serialize a design review into repeated one-question or one-section approval turns.
4. Implement the smallest complete vertical slice. Put speculative follow-ups in a parking lot instead of prebuilding future architecture. Use direct implementation for small, well-bounded changes; reserve heavyweight planning or GoalBuddy for cross-cutting, migration, release, or explicitly requested work.
5. During iteration, run focused tests and the smallest relevant browser journey. Before pull-request handoff, run the proportional repository gate (`npm run ci` for meaningful changes) plus only the specialized gates relevant to the touched surface. Do not rerun the entire suite after every micro-edit unless the risk justifies it.
6. Follow the user's declared terminal condition. Commit, push, open or update a pull request, monitor CI, mark ready, merge, release, or change production only when that authority is explicit. Fix CI failures only when they are in scope; separate unrelated repository failures into their own work.
7. At handoff, state the user-facing claim, the top three realistic failure modes, and the exact evidence gathered. Leave a clean receipt with worktree, branch, commit or diff state, verification results, and any deliberately deferred work.

Five-step channel gate before any operation:

1. Choose exactly one channel: `lineage-stable`, `lineage-preview`, or checkout-only `npm run lineage:dev --`.
2. Set its matching named profile; never reuse a stable profile for preview/dev.
3. Run runtime doctor, profile doctor, and `db info --profile <profile> --json` with that same launcher.
4. Confirm code root/origin/fingerprint, channel, profile/environment/fingerprint, database identity, and service origin all agree.
5. Stop on any mismatch. For an intentional checkout change, stop the dev service, run `make repin-dev LINEAGE_DEV_PROFILE=<profile>`, then repeat the gate. Repin never applies to stable/preview/package code.

Fresh-profile bootstrap exception: when the intended named profile does not
exist yet, run runtime doctor first, run the atomic `profile init --profile
<profile> --confirm-write --json`, and then immediately run runtime doctor,
profile doctor, and `db info --profile <profile> --json`. No other operational
command or write is allowed until that post-init gate passes.

Runtime channel memory:

- `stable` resolves npm `latest` once into an isolated, receipt-bound code root and is launched with `lineage-stable` (normally through `make start-prod`).
- `preview` resolves npm `next` into a different isolated, receipt-bound code root and is launched with `lineage-preview`.
- `dev` is checkout-only. Run it with `npm run lineage:dev -- <command>` or the `make start-dev*` targets; a published `lineage-dev` must fail closed.
- To move a stopped production profile to a newer stable package, stop its managed service, run `make upgrade-prod LINEAGE_PROD_PROFILE=<profile>`, repeat the complete identity gate, then start it again. `profile upgrade-runtime` derives its target only from the executing verified stable package and never applies to preview/dev.
- Never install `latest` and `next` into the same global npm prefix. Do not use PATH-resolved `lineage-dev` as evidence that checkout code is running.
- Run `<launcher> runtime doctor --json` before operational commands and check `code.root`, `code.fingerprint`, `code.verified`, channel, profile, and SQLite identity. Use `runtime info` only to diagnose an unverified install.
- Check `lineage-stable db info --profile <profile> --json`, `lineage-preview db info --profile <profile> --json`, or `npm run lineage:dev -- db info --profile <profile> --json` before assuming which SQLite database a CLI/app session is using.
- Persistent writes require a named profile whose `expected_runtime` pins the verified code origin and fingerprint; `legacy-unbound` CLI and service access is read-only.
- Before any write, run `profile doctor --profile <profile> --json` and confirm the profile fingerprint, code fingerprint, database identity, environment, origin, and service URL all match.
- Bind an existing database only with `profile bind --profile <profile> --confirm-write`; this is the only in-place legacy identity migration.
- Never copy a live SQLite database with `cp`, Finder, or a raw file API. Use `profile clone --source-db <source> --target-profile <non-production-profile> --confirm-write` so SQLite makes a consistent snapshot and the clone receives a fresh identity.
- Do not point preview/dev code at the stable database. A stable database may be a read-only clone source when the operation is intentional and the target is a new preview/development profile.

Local startup memory:

- Every foreground or managed start requires an explicit profile: `make start-prod LINEAGE_PROD_PROFILE=<profile>`, `make start-preview LINEAGE_PREVIEW_PROFILE=<profile>`, or `make start-dev LINEAGE_DEV_PROFILE=<profile>`.
- Persistent services use the matching `start-*-bg`, `status-*`, `logs-*`, and `stop-*` target plus the same profile variable. Preview has a complete managed lifecycle too.
- Managed start/status must verify `/api/runtime` code root/fingerprint, profile/database identity, and unique service instance. A PID, tmux session, launchd registration, or open port is never sufficient evidence.
- Browser open happens only after exact readiness. If status is nonzero, inspect the profile-scoped log and identity error; do not open the URL or assume the registered process is Lineage.
- Never use or recreate checkout-backed `start-local-prod`, shared tmux names, or an unprofiled launchd service for production.

For meaningful changes, prefer:

- `npm run ci` for the full public gate.
- `npm run public:readiness` for no-private-data and package-boundary proof.
- `npm run package:smoke` for installability proof.
- `npm run runtime:oracle` for simultaneous stable/preview/dev isolation and named negative-case proof.
- `npm run stable-upgrade:smoke` for the verified stable-package A-to-B profile transition, active-writer refusal, preserved routing/data/assets, and managed readiness.
- `npm run e2e` for browser workflow proof.
- `npm run plugin:smoke` for exact Lineage/plugin version lock, safe guidance, checksum, artifact, and atomic temporary-install proof.
- `npm run plugin:codex-smoke` for supported marketplace registration, installed/enabled state, reinstall, cleanup, and dry-run proof in an isolated temporary `HOME` and `CODEX_HOME`.

Release memory:

- Release versions are controlled only by pushing a new immutable annotated `v<package.json version>` tag for a reviewed commit already on `main`; never move or reuse a release tag, and require the tag-triggered Release workflow to fail closed unless every version lock and changelog entry matches before it publishes that exact version to npm (`latest` for stable SemVer and `next` for prerelease SemVer) and the matching GitHub Release.
- Root package, plugin package, plugin manifest, and `lineage.version` must match exactly; do not hard-code an older compatibility version in workflows or agent examples.
- A GitHub release must contain `lineage-codex-plugin-<version>.tgz` and its `.sha256` before npm publish or dist-tag mutation. The Release workflow builds, installs, attaches, and verifies these assets as one gated operation.
- Never install the plugin into the user's real Codex root during verification; use `npm run plugin:smoke`, which installs only into a temporary target.
- Do not infer activation from copied files. Use `npm run plugin:codex-smoke` before any real-profile install, then restart Codex and prove skill discovery in a brand-new task.
