# Define how your documentation looks

Keep the definition in the configured source location. Ask where final documentation belongs before generation; repository `docs/` is not a default:

```text
.autotour/autotour.json       project configuration
.autotour/documentation.json section layout, journeys, dependencies, targets
.autotour/output/            proposed working folder, subject to user choice
```

`autotour init` points new configuration at `.autotour/documentation.json`; it does not invent a brief or journey. Existing configuration remains compatible. Agents author the specification after planning with the user. A definition can reference separate journey/map files for compatibility or include them inline for a single-file project contract.

Targets can be declared together and selected per run:

```json
"targets": [
  { "kind": "markdown", "path": "product.md" },
  { "kind": "html", "path": "site/index.html", "mode": "single-file" },
  { "kind": "confluence", "siteUrl": "https://your-site.atlassian.net", "pageId": "12345" }
]
```

Ask whether captures and documentation are local or versioned, offer ignore changes separately, then save the choices with `configure-storage`. Paths above are relative to the chosen documentation-output folder, which may be inside or outside this repository. Generate any subset from an existing walkthrough manifest:

```sh
npx autotour run-docs .autotour/documentation.json \
  --walkthrough .autotour/output/product/walkthrough.json \
  --target markdown,html --mode adapt
```

Markdown and HTML are written locally. Confluence produces a section patch plan; applying it still requires an authenticated connected publisher and explicit authorization.

When `--walkthrough` is omitted, `run-docs` prepares and captures the definition automatically. Screenshot blocks use annotated screenshot capture; replay/video blocks use DOM capture. Because the capture engine keeps recording modes separate, definitions mixing both modes require separate capture runs for now.

## Example: screenshot XYZ based on UI Y

Start from [documentation.json](../examples/documentation.json), its [journey](../examples/documentation-journey.json), and its [dependency map](../examples/documentation-dependencies.json). Copy them into `.autotour/`, update linked filenames, application URL, and source-file patterns.

```json
{
  "schemaVersion": 1,
  "walkthroughId": "profile-documentation",
  "journey": "journey.json",
  "dependencyMap": "dependency-map.json",
  "destination": { "kind": "markdown", "path": "../docs/product.md" },
  "sections": [{
    "moduleId": "profile-settings",
    "heading": "Profile Settings",
    "dependencies": { "views": ["ProfileSettings"] },
    "blocks": [
      { "kind": "text", "text": "Enter your new display name." },
      {
        "kind": "screenshot",
        "stepId": "fill-display-name",
        "sourceView": "ProfileSettings",
        "timing": "after",
        "target": { "role": "textbox", "name": "Display name" },
        "alt": "Profile Settings with the display name field highlighted",
        "caption": "Your new display name is ready to save."
      },
      { "kind": "text", "text": "Select **Save profile** to apply the change." }
    ]
  }]
}
```

Blocks appear in order. `stepId` selects an image; `sourceView` identifies the UI dependency. Optional `target` controls the highlight independently of the action target. `timing` selects before/after the action; add an assertion/wait step when a screenshot needs a settled save result. Captions appear on annotated captures and under Markdown images. Optional `viewport` sets capture dimensions.

Dependencies must exist on the journey module and have source-file mappings. Validation rejects unknown views, missing/ambiguous steps, duplicate sections/screenshots, and unmapped declared dependencies. It verifies reference consistency, not the visual truth of a claimed view. Inspect captures. Map the specification and journey files to affected views too: layout/caption changes need regeneration. The sample map shows this.

## Validate and capture

```sh
npx autotour validate-docs .autotour/documentation.json
```

Paths resolve relative to the specification. Source files stay separate; preparation does not rewrite the journey or invent dependency evidence.

```js
import { readDocumentationSpec, prepareDocumentationCapture, captureJourney } from "autotour";
const definition = await readDocumentationSpec(".autotour/documentation.json");
const prepared = await prepareDocumentationCapture(definition);
const capture = await captureJourney({ ...prepared, outputDir: ".autotour/output/product" });
console.log(capture.screenshotPaths);
```

Capture includes prerequisite steps; publication selects only specified images. Keep credentials in environment variables; pass project redaction options through `recordScreenshots`. DOM/video remain separate capture runs.

## Synchronize the layout

Add one region per section, in specification order:

```markdown
Hand-written introduction.
<!-- autotour:module=profile-settings:start -->
<!-- autotour:module=profile-settings:end -->
Hand-written ending.
```

After inspecting and approving the capture, set the captured walkthrough and selected modules' `publish` flags to `true`. Preview:

```sh
npx autotour sync-markdown .autotour/output/product/walkthrough.json --spec .autotour/documentation.json --markdown docs/product.md --assets-dir docs/assets/autotour --dry-run
```

Remove `--dry-run` to apply; replace it with `--check` for a read-only CI gate (2 = stale, 0 = current). AutoTour writes headings, ordered text, selected images and captions only inside managed regions. Missing images/mismatched regions fail before publication. Repeated synchronization is idempotent. Without `--spec`, the original all-screenshots behavior is preserved.

Retain the specification for selective **screenshot** regeneration:

```sh
npx autotour regenerate .autotour/journey.json --spec .autotour/documentation.json --plan .autotour/output/plan.json --output-dir .autotour/output/product
```

See [CI examples](ci.md). This specification does not record a remote publication's approved source revision.

## Confluence and tours

Use a destination such as `{ "kind": "confluence", "siteUrl": "https://your-site.atlassian.net", "pageId": "12345" }`. Section `heading` and optional `endHeading` describe boundaries to resolve on the live page. A `{ "kind": "tour", "url": "https://your-approved-host/tour/", "label": "Watch the profile tour" }` block links a hosted replay; connected tools can select a supported Confluence embed macro.

The agent reads the validated specification, prepares a section patch, checks page versions, and preserves unrelated content. `sync-markdown` rejects Confluence destinations. Remote publication still requires authentication, hosting, supported embeds, and authorization; see [connected publishing](../skills/create-autotour/references/connections.md).
