---
name: lineage-package-operator
description: Operate Lineage channels, profiles, services, and creative workflows through its CLI.
---

# Operate Lineage

Use this skill for Lineage runtime operations. File-only inspection or edits do
not need a profile or runtime gate. Use the guidance matching the code being
operated; an installed package skill does not establish checkout compatibility.

## Shared safeguards

Before operating a profile, database, or service, read
[runtime and profile identity](references/runtime-profiles.md) and complete its
matching channel/profile/database gate. That reference also covers first-profile
bootstrap and dev repinning. Never infer identity from a window title, PID,
port, PATH, or an old command. Stop on identity mismatch.

Persistent writes require a named profile pinned to verified code, the profile
writer lease, and any operation-specific `--confirm-write`. Pass `--profile` on
every operational command; never replace it with a direct `--db` write.
Legacy-unbound access is diagnostic/read-only and never authorizes writes.
Before a persistent write, confirm the profile doctor, code fingerprint,
database identity, environment, and service origin agree.

Keep stable, preview, and dev identities separate. Never point preview/dev code
at the stable database or copy a live SQLite file directly. Claims and target
locks retain their operation-specific requirements in the references below.

## Load only the relevant workflow

| Task | Reference |
| --- | --- |
| Channel selection, identity gate, first profile, dev repin | [Runtime and profiles](references/runtime-profiles.md) |
| Start, status, logs, stop, stable package upgrade | [Services and upgrades](references/services-upgrades.md) |
| Inspect state, claim, heartbeat, link a child, release | [Claims](references/claims.md) |
| Resolve targets, replace locks, plan/scaffold/import/cancel generation | [Image generation](references/image-generation.md) |
| SQLite-safe clone, legacy binding, stage referenced media | [Cloning and migration](references/cloning-migration.md) |

Continue the authorized workflow through verification and fixes within scope.
Existing explicit approval remains valid; ask when intent is missing or an
operation crosses an unauthorized data, production, or destructive boundary.

At operational handoff, rerun runtime doctor, profile doctor, and database info;
include managed status when a service is involved. Report channel, profile,
code fingerprint, database path/fingerprint, and any failed check. A managed
service is ready only when its receipt and `/api/runtime` identity agree.
