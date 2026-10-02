---
name: create-autotour
description: Create or update a modular walkthrough and product documentation for a web application using Playwright, screenshots, DOM replay, or video. Use when a user provides an application, permitted test access, and a target journey.
license: MIT
---

# Create an AutoTour walkthrough

## Content

- [Create an AutoTour walkthrough](#create-an-autotour-walkthrough)
- [Content](#content)
- [Workflow](#workflow)
- [Output routes](#output-routes)
- [Maintenance](#maintenance)
- [Source of truth](#source-of-truth)

## Workflow

Work from the target repository root. Read `autotour.json` or `.autotour/autotour.json` when present and validate existing walkthrough manifests before changing them.

1. Confirm the application URL, target journey, permitted test account, and requested output formats. Never write passwords, tokens, cookies, or storage state into committed files.
2. Inspect the application and repository before recording. Prefer stable user-visible roles and labels for Playwright actions.
3. Divide the journey into modules at meaningful route, view, or task boundaries. Preserve existing module IDs when behavior is unchanged.
4. Record only routes, views, endpoints, controllers, and backend components supported by evidence. Mark unknown links as unknown.
5. Capture only requested outputs and keep local captures and authentication state in configured ignored paths.
6. Validate the walkthrough against `schemas/walkthrough.schema.json`. Report modules created, reused, or requiring re-recording.

## Output routes

Read [references/output-modes.md](references/output-modes.md) before capturing screenshots, raw video, presented DOM replay, or a WebM rendered from DOM. For guided focus, always choose `focus.holdMs` from the journey pacing; related clicks should pan while remaining zoomed and zoom out only after a deliberate quiet interval.

## Maintenance

Read [references/maintenance.md](references/maintenance.md) when mapping dependencies, invalidating modules, selectively regenerating output, synchronizing Markdown, or configuring CI.

## Source of truth

Treat the walkthrough manifest as the source of truth. Generated media is replaceable output. A code change should invalidate only modules whose recorded dependencies overlap the changed components.
