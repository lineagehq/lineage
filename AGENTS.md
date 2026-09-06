# Agent Notes

Preserve unrelated checkouts, worktrees, and user changes. Do not commit private
media, credentials, private campaign data, real presigned URLs, customer
content, or local SQLite databases.

## Scope and authority

Keep one feature aligned to one branch/worktree and one pull request. Start
feature work from freshly fetched `origin/main` in a new `codex/` worktree
unless the user chooses another base or authorizes continuing existing work.
Report the base SHA, branch, code root, and initial status before design or
code. Include the dedicated dev profile, database identity, service origin,
and channel-gate result only when runtime work is involved; otherwise mark
those fields not applicable.

Derive the smallest useful scope and completion criteria from the request.
Implement a complete vertical slice; defer speculative follow-ups. Use direct
implementation for bounded work and reserve heavyweight planning or GoalBuddy
for cross-cutting, migration, release, or explicitly requested work.

Continue implementation, verification, and fixes caused by the change through
the user's stated terminal condition. Ordinary phase transitions do not require
new approval. Ask only when a proposed action expands the objective or crosses
an unauthorized profile, database, production, publication, or destructive-action
boundary. Preserve explicit authority for commit, push, PR, CI monitoring,
merge, release, and production actions; existing authorization remains valid.
Batch genuinely blocking decisions and otherwise proceed autonomously.

## Lineage runtime operations

Before operating a Lineage CLI profile, database, or service, read the checkout's
[operator skill](plugins/lineage-codex-plugin/skills/lineage-package-operator/SKILL.md)
and the references for that operation. Use its channel/profile/database gate,
including the first-profile bootstrap exception. Stop on identity mismatch.
An older installed skill must not replace guidance for this checkout's features.

File-only inspection, documentation edits, and static checks need no runtime
profile. Apply the gate before any subsequent runtime operation. Use the
repository's isolated runners for runtime tests rather than a production profile.

Keep code channel, named profile, database identity, and service identity in
agreement. Never point preview/dev at stable data, copy live SQLite files, or
use unbound profiles for writes. Persistent writes require verified runtime
pins, writer leases, and operation-specific confirmation. Managed readiness
requires the profile-scoped receipt and `/api/runtime` identity to agree; a PID
or port is insufficient. Open the browser only after exact readiness.

## Verification and handoff

Use focused tests and the relevant browser journey during iteration. Follow
[verification by changed surface](.agents/references/verification.md) for the
handoff gate. A passing `npm run ci` covers its constituent checks; do not add
duplicate specialized runs unless later edits or failures justify them.
Continue authorized local validation and in-scope fixes without repeated
approval. Separate unrelated repository failures from the requested work.

At handoff, state the user-facing result, material failure modes, and evidence
proportional to the change. Include worktree, branch, commit or diff state,
verification results, and deliberately deferred work.

For release or plugin installation work, read
[release and installation rules](.agents/references/release.md). Preserve exact
version locks, immutable release tags, checksummed artifacts, and isolated plugin
verification; real-profile installation and publication require user authority.
