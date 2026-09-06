---
title: Release notes
description: Find package changes and understand how documentation freshness is reviewed for each release.
---

Package release notes live in the repository
[CHANGELOG](https://github.com/mean-weasel/lineage/blob/main/CHANGELOG.md).

Every release must review documentation impact. A central review receipt records
the exact package version and whether pages were updated or remained accurate.
The release gate rejects a missing or stale receipt. After publication, a
follow-up issue verifies representative pages, capability labels, deep links,
and mobile behavior against the deployed site.


## 0.1.36

The Codex plugin now loads runtime, service, claim, generation, and migration
guidance only for the relevant workflow. Runtime identity, data protection,
target-lock intent, and release safeguards remain in place. File-only work no
longer requires runtime setup or repeated approval for ordinary phase changes.

The release also refreshes the repository dependency audit and aligns landing,
documentation, and About links with the Lineage custom domain. Installing this
plugin does not upgrade or restart an existing Lineage service.
