---
title: Troubleshooting
description: Diagnose runtime identity, missing claims, provider limits, and public-site build failures.
---

## Agents appears empty

Open claims show only bounded active mutations. Switch to **Closed** or **All**
to see released claim history. Read-only agent inspection may never create a
claim.

## The service will not open

Run runtime doctor, profile doctor, and database info with the same launcher and
profile. A PID or open port is not proof of Lineage identity.

## Buffer will not post live

This is expected. Release 1 is a channel-sync and local composition foundation;
the legacy posting adapter remains dry-run-only. Connect, Sync channels, and the
Canvas Social panel perform no scheduling, upload, publication, delivery sync,
research, or metrics retrieval. Live scheduling is unavailable in Release 1.

## Buffer channels will not synchronize

In Settings, first verify the Release channel, named profile, and environment.
Then inspect the normalized Buffer status:

- **Credential unavailable:** set the named environment variable in the active
  Lineage service environment and restart that exact profile service.
- **Organization mismatch:** reconnect the current project to the intended
  organization, then sync again. Never reuse channel IDs across organizations.
- **Never synced:** Connect and Sync channels are separate; run Sync channels
  after a healthy connection.
- **Stale or disconnected:** the channel remains visible but unavailable. A
  successful later sync may clear stale state; a provider-disconnected channel
  stays unavailable.

Do not paste tokens or real provider identifiers into screenshots, logs, issue
reports, examples, or documentation.

## Documentation fails to deploy

Run `npm run docs:check`, `npm run build:web`, and
`npm run pages:prepare`. The assembler fails when landing or documentation
output is missing or when an existing web `docs` directory would collide.

## A provider page fails validation

Compare its capability, provider ID, maturity, and live-behavior frontmatter
with `src/shared/adapterCatalog.ts`.
