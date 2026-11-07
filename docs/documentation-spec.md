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
  { "kind": "pdf", "path": "product.pdf" },
  { "kind": "confluence", "siteUrl": "https://your-site.atlassian.net", "pageId": "12345" }
]
```

Set `language` on the specification (`de`, `en`, or another BCP 47 tag). HTML uses that value for `lang`, and uses the walkthrough language when the specification omits it. An HTML target with `"mode": "single-file"` embeds each screenshot as a `data:` URL in the page. `"mode": "site"` copies image files under `assets/` and links them. Ask what the viewer's content security policy allows before choosing a mode. A viewer that allows only `data:` images needs `single-file`.

Ask whether captures and documentation are local or versioned, offer ignore changes separately, then save the choices with `configure-storage`. Paths above are relative to the chosen documentation-output folder, which may be inside or outside this repository. Generate any subset from an existing walkthrough manifest:

```sh
npx autotour run-docs .autotour/documentation.json \
  --walkthrough .autotour/output/product/walkthrough.json \
  --target markdown,html --mode adapt
```

Markdown and HTML are written locally. A PDF target is printed from that same HTML page, with the same headings, figures, and captions. It adds a cover, a contents list with the page each chapter starts on, a bookmark per heading, and a running footer. The footer says “Seite n von m” when the walkthrough language is German and “Page n of m” otherwise. A video block may set `still` to an image path; the HTML and the PDF show that still with the video link. Figures stay with their captions. Confluence produces a section patch plan; applying it still requires an authenticated connected publisher and explicit authorization.

Add `--draft` when generating from an incomplete capture. A missing screenshot file then becomes a visible placeholder instead of stopping the run. Pass `--walkthrough` for that review copy; omitting it still captures first. A captured file is used either way.

When `--walkthrough` is omitted, `run-docs` prepares and captures the definition automatically. Screenshot blocks use annotated screenshot capture; replay/video blocks use DOM capture. Because the capture engine keeps recording modes separate, definitions mixing both modes require separate capture runs for now. Text chapters and planned chapters whose module or step is not in the journey are left out of that capture.

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
    "dependencies": { "views": ["ProfileSettings"], "apiEndpoints": ["PUT /api/profile"] },
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
      { "kind": "text", "text": "Select **Save profile** to apply the change." },
      { "kind": "openapi", "document": "profile.openapi.yaml", "operation": "PUT /api/profile" }
    ]
  }]
}
```

Blocks appear in order. `stepId` selects an image; `sourceView` identifies the UI dependency. Optional `target` controls the highlight independently of the action target. `timing` selects before/after the action; when omitted, targeted steps capture before the action and untargeted steps capture after it. Add an assertion/wait step when a screenshot needs a settled save result. Captions appear on annotated captures and as italic captions under Markdown images; set `captionInImage` to false to suppress the in-image copy (on a block, or once on the specification as the default for every block; a block's value wins, and when neither is set `recordScreenshots.captionInImage` decides), or set `captionPlacement` to `above`, `below`, `left`, or `right`. Optional `viewport` sets capture dimensions.

Set `headingLevel` on a section to control its Markdown/HTML heading depth. The HTML contents list follows that depth: a section is nested under the nearest earlier section with a smaller level, so a level 1 section can group the chapters that follow it. The same HTML page has a search box. Search uses an index stored in the file, matches headings, prose, captions, and alt text, groups results under the top-level section, and links each result to its section. Typing in the box does not load another file. `targets` and the legacy `destination` form may coexist; explicit `targets` take precedence. A Markdown target is also used by `sync-markdown --spec`, so `--markdown` is optional when the spec declares one.

For a manual in more than one language, set `language` and `languageLabel` on each specification. `translations` points at the other specification, and that specification points back. Use the same `moduleId` for the same chapter: the HTML anchor is that id, so a translated heading does not change the address. Each language has its own HTML target. The page shows a language switch, and choosing another language opens that file at the current chapter. A single-file toggle is not produced, because two copies of a chapter cannot share one anchor. Step targets still use the accessible name for the language being captured.

A section `status` is `ready` when omitted. A ready chapter must name a journey module, at least one recorded dependency, and exactly one journey step for every screenshot. Those dependencies must exist on the journey module and have source-file mappings. Validation rejects unknown views, missing or ambiguous steps, duplicate sections or screenshots, and unmapped declared dependencies for ready chapters. It verifies reference consistency, not the visual truth of a claimed view. Inspect captures. Map the specification and journey files to affected views too: layout or caption changes need regeneration. The sample map shows this.

`status: "text"` is prose only. It keeps `moduleId` as its anchor, needs no journey module, and cannot contain a screenshot, tour, or video block. `status: "planned"` may name a chapter before its module or screenshot step exists. Generation draws a placeholder for a planned screenshot that has not been captured, even without `--draft`. The placeholder shows the alt text, caption, and step id. Markdown uses a blockquote, and HTML uses `<figure class="autotour-placeholder">`. `sync-markdown` still requires the captured image and does not publish that placeholder.

## OpenAPI and Swagger

An `openapi` block renders one operation from a local OpenAPI 3.x or Swagger 2.0 document into the same Markdown, HTML, PDF, and Confluence outputs. It does not call the API, and it does not embed Swagger UI. The `operation` value uses the same `METHOD /path` form already stored in `apiEndpoints`. For Swagger 2, that path includes `basePath`.

```json
{ "kind": "openapi", "document": "profile.openapi.yaml", "operation": "PUT /api/profile" }
```

`document` is a JSON or YAML file relative to the specification. Absolute paths, remote URLs, and external `$ref` links are rejected. The operation must also be listed in the section's `apiEndpoints`, and that name must be recorded on the journey module and mapped to the specification file. A change to the contract then invalidates the same module as a change to the endpoint. AutoTour renders the summary, description, parameters, request-body properties, and responses. Example values stay in the contract file so sample tokens are not copied into published documentation.

Place the contract beside the specification, for example `.autotour/profile.openapi.yaml`, and copy [profile.openapi.yaml](../examples/profile.openapi.yaml) as a starting point.

## Reader output

HTML manuals are one page with search, a contents list that marks the section being read, an image dialog, a back-to-top button and print styles. They make no network requests. Choose how the page is laid out:

| `navigation` | Layout |
| --- | --- |
| `sidebar` (default) | Contents and search stay on the left. On narrow screens they open from a menu button. |
| `topbar` | A slim bar stays at the top, with search and a contents menu. |
| `minimal` | Search and contents sit at the top. Nothing is sticky. |

Save the project's choice once with `autotour configure-presentation --navigation sidebar`; a specification or manual may override it. Search finds sections (h1 to h3) that contain every typed word. Case, accents and `ß`/`ss` do not matter, and the hits are marked.

Other settings on a specification or manual:

- `numbering: true` numbers chapters ("3", "3.1") and turns "Chapter 3" or "Section 3.1" in prose into links. Manuals number by default.
- `labels` overrides reader words for the language, for example `{ "backToTop": "↑ Top" }`. English and German are built in.
- `branding` sets `colors` (`accent`, `text`, `background`, `muted`, `surface`, `border`), `fontFamily`, `logo` and `logoAlt`.
- `images: { "format": "webp", "quality": 80 }` re-encodes screenshots in single-file HTML when WebP is smaller.
- `run-docs --draft` shows a draft banner.

### AI hints

Mark authored blocks with `origin`: `human`, `ai-generated` or `ai-modified`. Screenshots and OpenAPI blocks count as `human` unless marked otherwise. `aiDisclosure.placement` decides what readers see:

| Placement | Reader sees |
| --- | --- |
| `document` | A short note near the start and a closing section that lists AI content by chapter |
| `chapter` | A small label at each chapter heading with AI content |
| `item` | A small label under each AI block, figure or animation |
| `none` | Nothing (the author decided) |

`validate-docs` and `run-docs` warn when content is marked as AI but no placement is set, and when a placement is set but text, video or embed blocks have no `origin`.

### Embedded animations

```json
{ "kind": "embed", "path": "motion/intro.html", "still": "motion/intro.png", "label": "Product animation", "readyMessage": { "type": "autotour:ready" } }
```

The page travels inside the HTML (`iframe srcdoc`). The still image shows until the page posts the `readyMessage`, and it stays where frames are blocked, in print, in PDF and in Markdown.

### Manuals with several applications

When one product is made of several applications, write one specification per application and capture each with `run-docs`. Then combine them in a manual file ([schema](../schemas/manual.schema.json)):

```json
{
  "schemaVersion": 1,
  "id": "product-manual",
  "organisation": "by-use-case",
  "languages": [{
    "language": "en", "label": "English", "title": "User manual",
    "specs": {
      "modeller": { "spec": "modeller/documentation.en.json", "walkthrough": "output/modeller/walkthrough.json" },
      "runtime": { "spec": "runtime/documentation.en.json", "walkthrough": "output/runtime/walkthrough.json" }
    },
    "parts": { "use-case": "Part A – One process end to end" },
    "targets": [{ "kind": "html", "path": "en/manual.html", "mode": "single-file" }, { "kind": "pdf", "path": "en/manual.pdf" }]
  }],
  "contents": [
    { "part": "use-case" },
    { "spec": "modeller", "section": "model-process" },
    { "spec": "runtime", "section": "run-process" },
    { "spec": "modeller", "section": "glossary" }
  ]
}
```

`contents` orders parts and sections across specifications; `{ "spec": "modeller" }` takes all of its sections. Every language names the same specifications and part labels, and their HTML targets link to each other at the same section. Build with `autotour run-docs manual.json [--language en] [--target html] [--draft]`. Sections that the manual leaves out are reported as a warning.

### LaRecipe

```json
{ "kind": "larecipe", "path": "resources/docs", "version": "1.0", "assetsPath": "public/docs-assets", "assetsUrl": "/docs-assets" }
```

The target writes `resources/docs/1.0/<chapter>.md` per chapter (deeper sections stay on their chapter's page), an `index.md` sidebar with one group per part, and images under `public/docs-assets/1.0/`. Links use LaRecipe's `{{route}}` and `{{version}}` placeholders. Set `docs.landing` in `config/larecipe.php` to the first page that `run-docs` reports as `landing`. LaRecipe provides search and navigation.

## Validate and capture

```sh
npx autotour validate-docs .autotour/documentation.json
```

Validation checks journey `timeoutMs` and `stableForMs` with the same 120000 ms ceiling capture enforces. A value above that ceiling fails here instead of during the browser run.

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

Name modules when the manual should be recaptured without a changed-file plan:

```sh
npx autotour run-docs .autotour/documentation.json --module profile-settings
```

Repeat `--module` for each module to recapture. Earlier modules still run when a later named module needs their browser state, and their images and manifest entries stay. Modules that do not need to run stay unrun. If a named module fails, previously published images of the other modules stay in place and the manual is not written again.

See [CI examples](ci.md). This specification does not record a remote publication's approved source revision.

## Confluence and tours

Use a destination such as `{ "kind": "confluence", "siteUrl": "https://your-site.atlassian.net", "pageId": "12345" }`. Section `heading` and optional `endHeading` describe boundaries to resolve on the live page. A `{ "kind": "tour", "url": "https://your-approved-host/tour/", "label": "Watch the profile tour" }` block links a hosted replay; connected tools can select a supported Confluence embed macro.

The agent reads the validated specification, prepares a section patch, checks page versions, and preserves unrelated content. `sync-markdown` rejects Confluence destinations. Remote publication still requires authentication, hosting, supported embeds, and authorization; see [connected publishing](../skills/create-autotour/references/connections.md).
