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
- [Onboarding routes](#onboarding-routes)
- [Plan with the user](#plan-with-the-user)
- [Documentation specification](#documentation-specification)
- [Optional motion ads](#optional-motion-ads)
- [Output routes](#output-routes)
- [Maintenance](#maintenance)
- [Connected publishing](#connected-publishing)
- [Source of truth](#source-of-truth)

## Onboarding routes

Start with the user's job and deliverable, not API options. Read [references/onboarding.md](references/onboarding.md) for marketing clips, product tours for Confluence, documentation, and maintenance. Natural-language requests invoke this workflow; do not invent CLI or slash commands. Check destination requirements and available optional tools during planning.

## Workflow

Work from the target repository root. Read `autotour.json` or `.autotour/autotour.json` when present and validate existing walkthrough manifests before changing them.

Do not create, capture, export, or publish an artifact in response to the initial request alone. The first response is a planning turn unless the user has already supplied a complete brief and explicitly authorized execution. A request that names only a language, format, and product (for example, “create German Word documentation showing DealDesk”) is incomplete: ask what audience and task the document should serve, which DealDesk URL or environment may be inspected, and which concrete journey or sections to show. Confirm the proposed deliverable and the user's authorization before recording or generating it. Word or other office-document output is a downstream delivery format, not evidence that the walkthrough scope is settled.

1. Complete [Plan with the user](#plan-with-the-user) before recording or changing presentation settings. Confirm the application URL, target journey, permitted test account, and requested output formats. Never write passwords, tokens, cookies, or storage state into committed files.
2. Inspect the application and repository before recording. Prefer stable user-visible roles and labels for Playwright actions.
3. Divide the journey into modules at meaningful route, view, or task boundaries. Preserve existing module IDs when behavior is unchanged.
4. Record only routes, views, endpoints, controllers, and backend components supported by evidence. Mark unknown links as unknown.
5. Capture only requested outputs and keep local captures and authentication state in configured ignored paths.
6. Validate the walkthrough against `schemas/walkthrough.schema.json`. Report modules created, reused, or requiring re-recording.

## Plan with the user

Enter Plan mode when the host provides that capability. Otherwise present a short plan in chat and ask the same clarifying questions; skill text cannot itself switch a host's mode. Inspect the brief, existing configuration, and supplied examples first. Ask only about unresolved choices, in small groups, and retain answers on subsequent turns:

- Is this a procedural walkthrough, passive product showcase, or motion ad? Which audience, destination, output format, dimensions, and quality matter?
- What exact task or journey should be shown, and which application URL/environment and permitted test access should be used?
- Where should working captures/exports live? Propose `.autotour/output/`, never assume `docs/`. Where should final documentation live: this repository, another repository/folder, or an external publishing destination? Obtain exact folders for local output.
- Should captures and documentation each be versioned or kept local? For local files in a repository, offer narrowly scoped `.gitignore` changes and ask permission separately. Explain that declining ignore edits may leave artifacts visible in Git.
- What duration is wanted? Must the exported file be exact (and within what tolerance), approximately that length, or run through journey completion?
- Should the cursor be visible? Are pointer travel and click emphasis wanted?
- Should the camera zoom and follow clicks, or keep a fixed full view?
- Should there be motion animations? Choose static framing, restrained showcase drift/tilt, or a more animated ad; confirm pacing and reduced-motion behavior.

Explain proposed settings in plain language and resolve required choices before capture. If the user explicitly delegates choices, state assumptions and continue. Do not re-ask answered questions or require another confirmation of an already approved plan. Record the agreed brief in the task's existing planning record, keeping credentials out of it.

Distinguish presentation timing from encoded duration: the current `renderDomReplayVideo.durationMs` records an interval after player readiness, and its WebM can include startup overhead. Never promise an exact file duration from this option alone. When exact output is required, plan startup removal and duration verification with available media tools; disclose missing tooling before capture. Capture source detail at the agreed resolution; later re-encoding cannot restore detail lost by the recorder.

Destination and Git-policy choices must be explicit or already saved as confirmed. Save approved capture folders in `output` and delivery/Git choices in `storage` in the existing configuration using `autotour configure-storage`. The `documentation` field points to the source specification, not generated output. A sample target, existing `docs/` directory, prior accidental output, or generic request to create a tour is not destination approval. Ask before changing a saved folder or ignore policy. Never silently move/delete prior artifacts, untrack files, or remove ignore rules. In unattended runs with unresolved choices, stop before capture and report what needs approval. For SDK calls, pass the approved paths explicitly; set `manageGitignore: true` only after separate ignore-edit consent.

## Documentation specification

For an approved first-tour review, use `plan-tour <journey.json> --brief <brief.json> --mode screenshots|dom|video`, then `review <tour-id>`. The brief requires `audience`, `outcome`, `privacy`, and `testDataEffects`; save it only in an approved source/work folder. Follow the saved review workflow in [reliable tour authoring](../../docs/reliable-tours.md). Never mark scenes approved on the user's behalf merely because automated checks pass. Explain that recapture can rerun prerequisite actions and requires consent; changed wording invalidates the scene’s approval. Prepare local delivery only after current human review. Do not count synthetic fixture tests as real viewer trials or imply local preparation publishes anything.

For repeatable documentation, author or update the project-configured `documentation` file (default `.autotour/documentation.json`) after planning. Read [references/documentation-spec.md](references/documentation-spec.md). The definition may keep the journey and dependency map inline in one file, declare Markdown, HTML, and Confluence targets, and select a subset of targets for each run. Discuss whether to create or adapt an existing tree, whether HTML is a site or single file, and whether media should be annotated screenshots, rendered DOM replay, or WebM fallback. Offer prose proposals from repository evidence, but mark them for user approval. Validate references before capture; use `run-docs` to assemble complete local targets and connected publishing for Confluence. Keep dependencies evidence-based and preserve unrelated published content.

## Optional motion ads

For an ad with a storyboard, typography, transitions, or a call to action, offer the optional [agenthouse motion-ad skill](https://github.com/agenthouse-org/skills/tree/main/marketing/motion-ad). AutoTour supplies real application captures; motion-ad can compose them into the agreed ad. A simple tilted showcase can stay in AutoTour.

Read [references/motion-ad.md](references/motion-ad.md) when the user chooses this route. Reuse an installed motion-ad skill, or offer installation from `agenthouse-org/skills`, path `marketing/motion-ad`. It is optional, not a bundled dependency. Install only with user authorization and read the installed `SKILL.md` before using it.

## Output routes

Read [references/output-modes.md](references/output-modes.md) before capturing screenshots, raw video, presented DOM replay, or a WebM rendered from DOM. For guided focus, always choose `focus.holdMs` from the journey pacing; related clicks should pan while remaining zoomed and zoom out only after a deliberate quiet interval.

## Maintenance

Read [references/maintenance.md](references/maintenance.md) when mapping dependencies, invalidating modules, selectively regenerating output, synchronizing Markdown, or configuring CI.

## Connected publishing

Read [references/connections.md](references/connections.md) for Confluence section updates, Jira tracking, LinkedIn delivery, and GitHub/GitLab pipeline setup. Discover connected tools before using them. Keep external publication within the user's authorization and preserve content outside selected sections. Read [INSTALL.md](../../INSTALL.md) when installing the plugin or configuring connections.

## Source of truth

For every capture, apply [reliable tour authoring](../../docs/reliable-tours.md): establish explicit setup and deterministic fixtures, use stable scoped targets, wait for meaningful result stability, separate instruction/narration from technical description, and add deliberate reading pauses. Scroll the actual container. Prefer `recordDom.inlineEvents: false` with local preview for directory delivery. Use the configured language and check capture reports and replay checkpoints. Keep incidental outputs in the approved working folder (propose `.autotour/output/`); verify the agreed Git policy without silently changing ignore files, preserving source definitions and approved baselines. Do not automatically dismiss unknown dialogs or assume overlay ownership from appearance.

Treat the walkthrough manifest as the source of truth. Generated media is replaceable output. A code change should invalidate only modules whose recorded dependencies overlap the changed components.
