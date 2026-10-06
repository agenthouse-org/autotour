# Documentation specification

## Content

- [Documentation specification](#documentation-specification)
- [Content](#content)
- [Author the contract](#author-the-contract)
- [Capture and publish](#capture-and-publish)
- [Maintain it](#maintain-it)

## Author the contract

Read the project configuration's optional `documentation` path, default `.autotour/documentation.json`. Start from packaged `examples/documentation.json` and its linked files, with the user's actual brief and application evidence. Ask only about missing choices. Record headings, ordered text/screenshot/tour blocks, audience, viewport, and destination. One section corresponds to one module. Use stable step IDs for screenshots and exact recorded view/dependency names; map those names to reviewed source-file globs. Do not invent source ownership to satisfy validation.

`sourceView` states which UI the screenshot describes. `target` controls a role/name highlight independently of the action. `timing` specifies before/after that action; use explicit assertions/waits to capture settled results. Captions and alt text serve different purposes. Read packaged `docs/documentation-spec.md` for the schema and examples.

## Capture and publish

Run `autotour validate-docs <spec>` to check the schema and linked files. Use `readDocumentationSpec` and `prepareDocumentationCapture` before `captureJourney`. Preparation supplies screenshot annotation settings and viewport without changing the source journey or dependencies. Merge project-specific redaction options. Keep source credentials out of the specification.

Review the resulting images and claimed UI states. Do not treat schema validity as visual approval. Once publication is authorized, use `sync-markdown --spec` with matching ordered module regions and a reviewed publish-enabled manifest. Preview with `--dry-run` or check with `--check`; preserve content outside regions. Missing assets and mismatched references are errors. A specification alone is not approval to publish.

For Confluence, read destination site/page and section heading/endHeading from the specification, then follow `connections.md` using actual live content and supported macros. `tour` blocks link approved hosted replays; embedding still needs destination support. Do not run local Markdown synchronization on a Confluence specification or invent a remote publishing command.

## Maintain it

Keep the specification, journey, and dependency map in the configured source location; commit only when requested. Ask whether generated documentation belongs in this repository or elsewhere, record its folder and Git policy, and obtain separate consent for ignore-file changes. Map changes to specification/journey files to their affected views as well as application source changes. Use `invalidate --check` for impact checks, `regenerate --spec` for selective screenshot regeneration, and `sync-markdown --spec --check` for generated Markdown freshness. Existing DOM/video regeneration remains separate. Keep published source revisions in the project's tracking record for remote verification; local change detection does not acknowledge a completed refresh.
