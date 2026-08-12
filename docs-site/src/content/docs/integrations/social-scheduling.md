---
title: Social scheduling
description: Synchronize Buffer channels and compose reviewed social intent without publishing it live.
capability: social-scheduling
maturity: Preview
currentProviders:
  - Buffer
providerIds:
  - buffer
liveBehavior: disabled
---

## What this does

Release 1 maps one Lineage project to one selected Buffer organization,
synchronizes that organization's channel metadata into a local catalog, and
stores project/canvas-scoped composition intent. The pinned Buffer runtime is
restricted to schema and channel reads.

## Step-by-step workflow

1. Confirm Settings shows the intended Lineage runtime channel, named profile,
   and environment.
2. Put the Buffer credential in the active service environment. Enter only its
   environment-variable name in Settings.
3. Choose the current project's organization with **Connect**. This is a local
   connection write; it does not fetch channels.
4. Choose **Sync channels**. This performs Buffer channel reads and a confirmed
   local catalog update; it performs no Buffer mutation.
5. Inspect the selected organization, pinned CLI compatibility, channel counts,
   last sync, and stale/disconnected guidance.
6. In the Canvas Social panel, promote marked source intent and compose variants
   against available locally synchronized channels.

## Limitations and safety behavior

Stale and disconnected channels stay visible as evidence but are unavailable
for composition. A missing credential or organization mismatch blocks Sync and
is reported without raw credentials or provider responses.

Live Buffer posting is intentionally disabled. Enabling the setting, connecting
an organization, detecting credentials, synchronizing channels, or saving
composition intent does not change that boundary. The legacy posting adapter is
dry-run-only. Release 1 does not schedule, upload media, synchronize delivery
state, perform research, or retrieve metrics. No Release 1 action creates or
changes a provider post.
