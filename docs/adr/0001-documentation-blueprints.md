# ADR 0001: Documentation blueprints and where they are stored

- Status: proposed
- Date: 2026-11-06
- Work item: ST-30
- Deciders: maintainer (pending review)

## Context

Every documentation specification is written from scratch today. The section outline, audience,
targets and look are decided again for each walkthrough, and some presentation is fixed in code
(the PDF header and footer in `src/documentation/generate.js`, the release-notes HTML in
`src/release-notes/render.js`). Teams that document several applications want the same document
shape and look everywhere, and want to keep that shape either in the application repository or in
one place shared by several repositories.

0.7.0 adds a manual file (section order across specifications, parts, labels, languages), branding
settings (colours, fonts, logo, title) and navigation flavours. Those are the settings a reusable
shape has to fill in. The 0.7.0 plan also keeps brand values and per-manual content out of autotour:
they belong to the consuming projects.

Forces:

- Output must stay reproducible. Regeneration and invalidation depend on knowing exactly which inputs
  produced a document.
- Specifications are schema-validated with Ajv. A second, looser input format would weaken that.
- Shared presentation files come from outside the repository and end up in HTML that people open, so
  they are a script-injection path.
- autotour runs offline in CI and in air-gapped environments.

## Decision

1. **Split structure from presentation.**
   - A **blueprint** (`blueprint.json`) describes content structure: audience, language, targets,
     sections with a heading, purpose, required or optional flag, and how a section maps to journey
     modules (one fixed section, or one per module). It may name a default theme.
   - A **theme** (`theme.json` plus CSS and asset files) describes presentation: branding values from
     0.7.0, CSS for HTML and PDF, PDF header and footer, navigation flavour.

   Each has its own JSON Schema and `schemaVersion`. A documentation specification references a
   blueprint and optionally a different theme. Values in the specification override the blueprint.

2. **Declarative only.** Blueprints use a fixed list of placeholders (`{{product}}`, `{{version}}`,
   `{{date}}`, `{{language}}`, `{{module.title}}`, `{{module.id}}`). There are no loops,
   conditionals, partials or helpers. An unknown placeholder fails validation.

3. **Themes are CSS and assets only.** Validation rejects `<script>`, event-handler attributes,
   `javascript:` URLs, `@import` and any remote URL. Assets are local files referenced by relative
   path and embedded at build time.

4. **Lookup order**, first match wins, and the build reports which one was used:
   1. the repository: `.autotour/blueprints/<name>/` and `.autotour/themes/<name>/`
   2. a central source configured in `.autotour/project.json` under `blueprints.sources`: a Git
      repository (`url`, `ref`, `path`) or, for tests and monorepos, a local directory
   3. built-in defaults shipped with autotour

5. **Pin central blueprints.** The first use of a central blueprint records the resolved commit and a
   SHA-256 of the blueprint directory in `.autotour/blueprints.lock.json`. Builds use the locked
   version and fail if the content hash does not match. `blueprint update` is the only command that
   moves a lock entry. The lockfile is committed. A floating ref is never used at build time.

6. **Blueprint versions are inputs for invalidation.** The resolved blueprint and theme hashes are
   recorded with each generated document, so a lockfile change marks every document built from that
   blueprint as stale through the existing `invalidate` flow.

7. **No server and no remote writes.** The central location is an ordinary Git repository that teams
   review with pull requests. autotour reads from it and can `vendor` a pinned copy into the
   repository for offline builds. It never pushes or opens pull requests there.

## Alternatives considered

- **One combined template file (structure and look together).** Simpler to explain, but a team that
  wants the corporate look with a different outline would have to fork the whole file. Rejected.
- **A general template engine (Handlebars, Nunjucks, Liquid).** Flexible, but logic in templates
  cannot be schema-validated and makes output depend on template code. Also a larger attack surface
  for shared files. Rejected. If a real need for conditionals appears, add a declarative field.
- **Floating references (`main` or `latest`) for central blueprints.** Always current, but a change in
  the central repository would silently change every project's output and bypass review. Rejected in
  favour of an explicit lockfile update.
- **An npm package as the central source.** Gets versioning and integrity for free and fits the Node
  toolchain, but needs a publishing pipeline that documentation authors often don't own. Deferred:
  the source interface allows adding it later.
- **A hosted template registry or service.** Discovery and access control, but more infrastructure to
  run and a network dependency in CI. Rejected for now.
- **Confluence page templates as a source.** Matches teams that author in Confluence, but they are
  presentation-oriented storage format without the module mapping. Out of scope.

## Consequences

Positive:

- New documentation starts from a reviewed shape; several repositories can share one.
- Changes to a shared blueprint are explicit, reviewable lockfile diffs and show up in `invalidate`.
- The fixed presentation in code (PDF header and footer, release-notes HTML) gets a place to move to,
  with built-in defaults that keep current output unchanged.

Negative and risks:

- Two more schemas to version and migrate. Mitigation: their own `schemaVersion`, and validation that
  refuses a newer version than the installed autotour.
- Git fetching adds a network step and credentials handling. Mitigation: reuse the user's Git
  configuration, never store credentials, and support `vendor` for offline builds.
- Content hashing of a directory must be stable across platforms (line endings, file order, modes).
  Mitigation: hash a sorted list of normalised relative paths and file contents only.
- A central blueprint can still contain misleading text. Signing (reusing agenthouse signing) is a
  possible follow-up and is not part of this decision.

## Follow-up

- Decide the release (proposed 0.8.0, after the 0.7.0 manual file and branding settings).
- Move the PDF header and footer and the release-notes HTML (ST-29) to built-in themes.
- Revisit npm sources and blueprint signing when a second team adopts central blueprints.
