# Connected publishing

## Content

- [Connected publishing](#connected-publishing)
- [Content](#content)
- [Connect only what the task needs](#connect-only-what-the-task-needs)
- [Confluence managed sections](#confluence-managed-sections)
- [Jira follow-up](#jira-follow-up)
- [LinkedIn delivery](#linkedin-delivery)
- [GitHub and GitLab pipelines](#github-and-gitlab-pipelines)

## Connect only what the task needs

The plugin declares external services, not connector implementations. Read the installation guide and discover actual tools and permissions. Reuse existing authenticated connections instead of creating duplicates. Atlassian serves Confluence and Jira; GitHub and GitLab serve repository and CI work. Users complete sign-in. For GitLab Self-Managed, use the user's verified instance endpoint rather than GitLab.com. Local capture and CI checks work without MCP authentication. Do not interpret installation as permission to publish.

## Confluence managed sections

Example: “Refresh the Profile Settings section on page 12345 and its embedded AutoTour; preserve the rest.”

1. Read the requested page through the connected service. Resolve site, page ID, current version, supported content format, and a unique section boundary. Ask if the heading is duplicated or boundaries are unclear. Agree which modules map to which sections. Persist non-secret mappings in the project's existing tracking/configuration document; do not add unsupported fields to the walkthrough schema.
   Use the project's validated documentation specification when present: its destination identifies the site/page, section heading/endHeading identify proposed boundaries, and ordered blocks define the requested text, screenshot steps, captions, and hosted tour links. Confirm boundaries against the live page; never assume heading text uniquely identifies a section.
2. Capture or regenerate affected modules and review artifacts. Obtain an approved hosted HTTPS tour URL; preserve all runtime/module assets. Check available embed macros and host framing rules. If an embed is unsupported, propose a normal link or screenshots. Uploading HTML alone does not create a playable tour.
3. Read the connector's content-format guidance. Prepare a before/after section patch and a complete proposed page body if the tool updates whole pages. Preserve all unrelated nodes, macros, links, attachments, title, and metadata. Do not rely on HTML comments as durable Confluence markers: prefer supported stable nodes/macros, or a uniquely identified heading with an explicit end boundary. Validate unchanged content structurally.
4. Show the concrete section diff and publishing target. Use existing authorization if it covers this update; otherwise obtain authorization now. Re-read immediately before writing. If version or relevant content changed, rebuild and review the patch. Use optimistic version checks when supported. Never perform a blind full-page overwrite; if the tool cannot protect concurrent edits, retain the draft and explain the missing capability.
5. Apply once, then fetch and verify the section and unrelated content. Test playback in Confluence as a viewer when possible. Record page version, tour revision/URL, module mapping, and verification. Keep the pre-update version for recovery; do not automatically revert intervening edits.

This is an agent workflow using external tools, not a new `autotour publish-confluence` command or a built-in remote adapter.

## Jira follow-up

Example: “Add the documentation refresh plan to PROJ-42.” Read the issue and confirm it belongs to the intended project. Link affected modules, change reasons, draft/page URLs, and unresolved review findings. Update only requested fields or add the requested comment; preserve other issue data. Do not create issues, comment, assign, or transition status unless requested. A successful technical check does not approve documentation publication or close a ticket.

## LinkedIn delivery

Example: “Prepare a 15-second product clip and LinkedIn post draft.” Agree on organic versus paid placement, exactness, dimensions, quality, and visual settings. Create the reviewed clip and draft copy. No verified LinkedIn publishing MCP is declared by AutoTour. Discover a user-selected connected publishing provider before attempting upload; marketing analytics or prospect-search tools are not publishing tools. If unavailable, provide the file and copy for manual upload. Publishing requires the intended account/page and user authorization; do not use scraping or pretend an upload succeeded. Follow current LinkedIn specifications.

## GitHub and GitLab pipelines

Example: “Add an AutoTour documentation freshness check to our pull-request pipeline.” Inspect the existing workflow, package manager, tracked manifest and dependency map before editing. Use the examples in `docs/ci.md`; adapt paths and base/head refs. CI runs the CLI directly without conversational MCP tools or OAuth. The connectors help inspect repositories, propose PR/MR changes, and read results.

`invalidate --check` returns 2 when modules need regeneration or mappings require review, 0 when all are reusable, and 1 for invalid inputs/process errors. Without `--check`, a certain regeneration plan still returns 0. Save the JSON plan even on status 2. Unknown files and stale mappings must stay review findings; do not weaken coverage to turn CI green. `sync-markdown --check` separately compares reviewed captures to managed Markdown regions. Neither check proves a remote Confluence section is current: compare its recorded published revision and content through the connected service.

When asked to refresh, run selective regeneration, inspect the new artifacts, update only managed documentation, and propose the repository changes for review. Jira comments, Confluence updates, PR/MR creation, and pipeline deployment remain separate authorized actions. Do not put private captures or credentials into public CI artifacts or execute privileged capture against untrusted fork changes.
