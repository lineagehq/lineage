---
title: Settings reference
description: Understand safe configuration, maturity, credentials, and status for each current integration provider.
---

## Cloud storage

Amazon S3 is **Available**. Bucket and region are safe configuration. Provider
enablement and credential detection do not bypass write confirmation.

## Social scheduling

Buffer is **Preview**. Release 1 is a channel-sync and local composition
foundation. Before connecting, confirm the Release panel shows the expected
Lineage channel, named profile, and environment. The credential environment
field accepts an environment-variable name, not a token. Settings reports only
whether that variable is detected; the raw value is never stored or rendered.

**Connect** selects one Buffer organization for the current Lineage project and
stores its safe organization identity plus credential reference. **Sync
channels** is separate: it uses the pinned compatible Buffer CLI to read the
selected organization's channel catalog, then performs a confirmed local
SQLite update. Settings reports the pinned CLI version, credential detection,
selected organization, available/total/stale/disconnected channel counts, and
last successful sync.

Stale channels remain visible but unavailable until a later successful sync.
Disconnected channels also remain visible and unavailable for composition.
Missing credentials and organization mismatch are shown as normalized operator
guidance, never raw provider responses.

The legacy posting adapter remains visibly **dry-run only**. Connect, enable,
and Sync do not schedule, upload, publish, synchronize deliveries, run research,
or retrieve metrics. Live scheduling is unavailable in Release 1.

## Image generation

Codex handoff is **Available** and enabled by default. It needs no external
secret because Lineage creates handoff and import receipts rather than calling
an embedded model service.

## Experience settings

Hover previews are stored as a browser preference. Disabling them leaves
double-click details available.
