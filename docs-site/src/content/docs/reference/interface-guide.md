---
title: Interface guide
description: Find the main Lineage views without treating application tabs as the documentation structure.
---

## Main views

- **Projects** is the global home for creating, organizing, and opening projects.
- **Workspaces** is the project-level directory for creating, organizing,
  archiving, deleting, and opening workspaces.
- **Canvas** displays the visual lineage graph and current attempts for one
  exact workspace.
- **Review** presents assets that need human judgment.
- **Assets** supports catalog-level inspection.
- **Agents** shows open, released, stale, and revoked claims.
- **Settings** exposes safe provider configuration and runtime information.
- **Ledger** records durable decisions and operations.
- **Content Batches** groups posts, targets, media, and handoffs.
- **Backup Queue** prepares approved assets for external storage.

Project-scoped destinations appear in the left rail after you open a project.
**Workspaces** opens the project directory, while **Canvas** returns to the
last exact workspace opened in the current browser tab. Use the **L** mark to
return to Projects. The adjacent contextual panel holds tools for the current
view; collapse it when you want the Canvas to use the full window, then select
the active rail destination to reopen it. On mobile, the menu button opens the
same destinations and contextual tools as a drawer.

Canvas identifies its exact workspace in a compact location bar with a
separate **Workspaces** back action. Workspace switching and lifecycle actions
live on the Workspaces page instead of inside Canvas.

## Lineage canvas appearance

Select the gear in the upper-right corner of the Canvas to open **Canvas
settings**. The settings appear as a right-side panel on desktop and a bottom
sheet on mobile:

- **Cards** switches between compact nodes and portrait cards. Portrait cards
  show the complete image inside a consistent social-friendly frame.
- **Direction** lays out the graph left to right, top to bottom, right to left,
  or bottom to top.
- **Edges** selects fine, standard, or bold lineage connections.
- **Edge labels** shows or hides the one- or two-word variation summaries.
- **Minimap** shows or hides the overview used to navigate larger trees.
- **Hover previews** enables or disables the full-image node preview without
  disabling the node's detail view.
- **Maximum queued branches** controls how many branch bases the workspace can
  hold at once. A disabled Branch action explains when this limit has been
  reached and points back to this setting.
- **Edit prompt when selecting a variation** opens the inline editor when you
  select a Variation Queue item. It is on by default and can be switched off
  when selection should only focus the associated node.
- **Ask for Branch prompt** opens the prompt editor before a card is marked for
  Branch. Switch it off to mark Branch immediately with **B** or the action
  button; a prompt can still be added later.
- **Ask for Re-roll prompt** independently does the same for Re-roll and **R**.

Canvas appearance choices are remembered in the current browser. Use **Fit
graph** to frame the current tree, **Tidy tree** to restore automatic spacing,
or **Reset appearance** to return all Canvas settings to their defaults.

## Variation queue and prompts

Choose **Branch** or **Re-roll** on a node, or focus that node and press **B**
or **R**, to mark the action. Both actions open their prompt editor by default.
Their independent Canvas switches can disable that step so either action marks
immediately without a prompt. You can add or edit the prompt later from the
node preview or Variation Queue. When a prompt is missing, Lineage tells the
agent to ask before generating instead of inventing an instruction.

Open **Variation queue** from the Canvas contextual panel, or press **V**, to
review every queued branch and re-roll in one scroll. Opening it closes any
other Canvas side panel and highlights all participating nodes. Selecting a
queue item focuses its node on the unobstructed Canvas; with the default
setting enabled, it also opens that item's inline prompt editor. Each item can
be edited, shown on the Canvas, or removed. Removing an item quietly removes
its saved prompt as well.

Branch and re-roll prompts remain distinct even when both actions target the
same node. Once an agent has claimed or started the corresponding task, its
prompt is locked in the Canvas so the visible instruction cannot diverge from
the work in progress.

## Collapsing branches

Cards with descendants show a count control beside their outgoing connection.
Select the minus control to collapse that branch and the plus control to reveal
it again. The count describes how many cards that action will hide or reveal.

Collapse choices apply only to the current Canvas session and never change the
stored lineage. Nested collapse choices are preserved when an ancestor is
closed and reopened. If a descendant is also connected through another
expanded branch, it stays visible through that path. Growth replay temporarily
shows the complete tree and restores the previous collapse choices when replay
closes.

## About Lineage

Select the information button at the bottom of the destination rail, or the
Lineage name in the mobile drawer, to open **About Lineage**. The **L** brand
mark returns to Projects. The dialog shows the app version, release and runtime
channels, environment, profile, and revision when verified. It also links to
the repository and documentation.

**Copy diagnostics** copies only this limited identity summary. It does not
include local filesystem paths, the SQLite database path, the asset root, or
the service URL.

Use workflow documentation to decide what to do; use this guide only to locate
the relevant surface.
