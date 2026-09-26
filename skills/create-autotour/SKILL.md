---
name: create-autotour
description: Create or update a modular walkthrough and product documentation for a web application using Playwright, screenshots, DOM replay, or video. Use when a user provides an application, test credentials, and a target journey.
license: MIT
---

# Create an AutoTour walkthrough

Work from the target repository root. Read `autotour.json` or `.autotour/autotour.json` when present and validate existing walkthrough manifests before changing them.

1. Confirm the application URL, target journey, permitted test account, and requested output formats. Never write passwords, tokens, cookies, or storage state into committed files.
2. Inspect the application and repository before recording. Prefer stable user-visible roles and labels for Playwright actions.
3. Divide the journey into modules at meaningful route, view, or task boundaries. Preserve existing module IDs when behavior is unchanged.
4. For each module, record the routes, UI views, network endpoints, controllers, and backend components that evidence can support. Mark unknown links as unknown; do not guess.
5. Capture only the requested outputs. Put local captures and authentication state in ignored paths configured by AutoTour.
6. Validate the walkthrough JSON against `schemas/walkthrough.schema.json` and report which modules were created, reused, or need re-recording.

For raw modular video, execute the schema-shaped walkthrough with `captureJourney({ journey, recordVideo })`. Use a fixed viewport and create one video per module so unchanged modules remain reusable. In CI, install Playwright Chromium, keep credentials in secret environment variables, and upload `.autotour/output` as a workflow artifact only when requested by project policy.

Treat the walkthrough manifest as the source of truth. Generated media is replaceable output. A code change should invalidate only modules whose recorded dependencies overlap the changed components.
