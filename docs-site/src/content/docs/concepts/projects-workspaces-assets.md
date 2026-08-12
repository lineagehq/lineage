---
title: Projects, workspaces, and assets
description: Understand the three levels Lineage uses to organize creative state.
---

## What this does

- A **project** is the durable catalog and policy boundary.
- A **workspace** is a saved focus on a root and its visible lineage.
- An **asset** is a creative item with metadata, media references, attempts,
  relationships, review state, and selection state.

## How it works

One project can have many workspaces. Several workspaces can point at the same
asset without copying it. Assets form parent-child relationships for visible
variations, while attempt history stays attached to one asset identity.

Lineage reflects that hierarchy directly: Projects is the global home, each
project has a dedicated Workspaces page, and opening one workspace enters its
focused Canvas. Return to the Workspaces page to switch or manage workspaces.

## Common misunderstandings

Deleting or closing a workspace is not the same as deleting an asset. Moving
between workspaces does not change the current attempt. A project’s storage
settings do not silently apply to another profile or database.

Related: [Branches versus re-rolls](branches-vs-rerolls).
