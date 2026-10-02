# Walkthrough maintenance

## Content

- [Walkthrough maintenance](#walkthrough-maintenance)
- [Content](#content)
- [Dependency mapping](#dependency-mapping)
- [Selective regeneration](#selective-regeneration)
- [Markdown synchronization](#markdown-synchronization)
- [Continuous integration](#continuous-integration)

## Dependency mapping

Maintain a reviewed dependency map connecting repository file globs to exact dependency identifiers recorded in module manifests. Run `autotour invalidate` with an explicit Git base/head or changed-file list. Do not treat `review` modules as reusable until unmapped files or stale dependency names are resolved.

## Selective regeneration

Apply a certain plan with `autotour regenerate <journey.json> --plan <plan.json> --output-dir <existing-output>`. Screenshot, DOM, and raw video modes are inferred from the existing manifest. Let AutoTour execute reusable prerequisites for browser state while preserving their checked output. Treat status `2` as a review gate and retain existing output when capture or assembly fails.

## Markdown synchronization

Use standalone matching `<!-- autotour:module=<id>:start -->` and `<!-- autotour:module=<id>:end -->` comments. Run `autotour sync-markdown` only when the walkthrough and selected modules explicitly set `publish` to `true`. Use `--check` in CI to detect stale documentation without writing or `--dry-run` to inspect proposed changes. Never edit outside managed regions or bypass marker and source-path validation.

## Continuous integration

Install Playwright Chromium, keep credentials in secret environment variables, and upload `.autotour/output` as a workflow artifact only when requested by project policy. Keep generated captures ignored unless the repository explicitly publishes reviewed artifacts.
