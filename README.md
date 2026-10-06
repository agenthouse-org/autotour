# AutoTour

AutoTour is an open-source toolkit for coding agents that turns a web application and a target user journey into modular product walkthroughs.

The intended outputs are dynamic DOM walkthroughs, rendered video, and annotated screenshots. Each walkthrough module records the application views, controllers, API endpoints, and backend components it depends on so affected modules can be re-recorded independently after a change.

## Who uses AutoTour?

Start with your role and the result you need; the agent handles the capture setup.

| You need | Start by asking | Delivery |
| --- | --- | --- |
| Marketing: a short LinkedIn clip | “Make a short LinkedIn clip of this product. Help me choose duration, framing, cursor, and motion.” | Reviewed WebM showcase; optional motion-ad for a storyboard and typography. Check organic post versus paid-ad requirements before export. |
| Product: an HTML DOM tour for Confluence | “Create an embeddable DOM tour of this journey for Confluence. Check our hosting and embed options first.” | A static HTML replay directory with module navigation, plus an embed or link plan. Hosting and Confluence publishing are separate steps. |
| Support or enablement: a visual how-to | “Document this task with annotated screenshots and a replay.” | Ordered PNGs and optional DOM replay. |
| Engineering: keep a tour current | “Check which modules changed and regenerate only those.” | Dependency-aware invalidation and selective regeneration. |

The agent starts with a brief planning conversation, asks only about missing choices, and confirms the deliverable before recording or generating any artifact. A language, file format, and product name alone are not sufficient scope; Word and other office-document requests still require the underlying journey, audience, source environment, and permitted access to be confirmed. See [role-based onboarding and commands](docs/onboarding.md), including Confluence embedding limits and optional authoring tools.

## Modular video capture

Schema-shaped walkthrough JSON can be executed directly. With `recordVideo` enabled, AutoTour uses one shared browser context and records a separate WebM for each module, preserving authentication while keeping modules independently replaceable.

```js
import { readFile } from "node:fs/promises";
import { captureJourney } from "autotour";

const journey = JSON.parse(await readFile("examples/agenthouse-dealdesk.json", "utf8"));
const result = await captureJourney({
  journey,
  outputDir: ".autotour/output/dealdesk",
  recordVideo: {
    viewport: { width: 1280, height: 720 },
    size: { width: 1280, height: 720 }
  }
});

console.log(result.videoPaths);
```

Generated videos remain under the ignored `.autotour/output/` directory by default. CI must install Playwright Chromium before capture.

Journey steps should prefer accessible role/name targets. When a page intentionally exposes duplicate controls with the same accessible name, set a zero-based `target.index` to choose one explicitly; AutoTour preserves that choice in the generated walkthrough selector as `>> nth=<index>`.

## Annotated screenshot capture

For deterministic setup, CSS/test-ID targets, scoped stability waits, expected results, narration, replay seeking, privacy controls, local preview and ignored consumer outputs, see [Reliable tours](docs/reliable-tours.md).

Set `recordScreenshots` to generate one deterministic PNG for every journey step. Role/name targets receive the configured highlight, numbered callout, and caption; navigation and other untargeted steps capture the resulting page state.

```js
const result = await captureJourney({
  journey,
  outputDir: ".autotour/output/dealdesk-screenshots",
  recordScreenshots: {
    viewport: { width: 1280, height: 720 },
    redaction: {
      selectors: ["[data-private]"],
      texts: ["Internal account name"]
    }
  }
});

console.log(result.screenshotPaths);
```

Screenshots are written under `modules/<module-id>/screenshots/<step-id>.png` and listed in each module's manifest assets in journey order. Credential environment values are included in temporary screenshot redaction and restored in the live page before the next action. Review every generated image before publication.

## DOM autoplay replay

Set `recordDom` to capture rrweb events and generate one sandboxed autoplay page per module. The generated output includes a shared local replay runtime, so the local fixture works after the source application is stopped.

```js
const result = await captureJourney({
  journey,
  outputDir: ".autotour/output/dealdesk-dom",
  recordDom: {
    viewport: { width: 1280, height: 720 },
    stepDelayMs: 500,
    presentation: {
      cursor: { visible: true, scale: 1.6, moveDurationMs: 650, clickPulse: true, clickDurationMs: 700 },
      focus: { mode: "clicks", scale: 1.25, durationMs: 650, holdMs: 2400 },
      motion: { mode: "off" },
      frame: { mode: "window", title: "Product walkthrough" },
      background: { mode: "gradient", from: "#111815", to: "#26342b" },
      padding: 48
    }
  }
});

console.log(result.domPaths);
console.log(result.domIndexPath);
```

Serve the output directory as static files and open its root `index.html` for continuous playback across modules. Individual module players remain available under `modules/<module-id>/dom/index.html` so one changed module can be replaced independently. DOM capture adds a 500 ms presentation delay after each step by default; set `stepDelayMs` to tune it or `0` to preserve raw execution timing. Presentation profiles are optional: `pure` preserves the standard player, `background` adds a canvas, and `window` adds browser-like chrome. Cursor scale, click pulse, and click focus remain disabled or neutral unless configured. Form values are masked, loaded images are embedded for offline replay, captured scripts remain disabled inside rrweb's sandbox, and generated assets include the rrweb MIT notice. Remote fonts, unloaded lazy media, canvas content, and cross-origin iframes are not yet guaranteed to work offline; broader asset harvesting is a later slice.

Render the exact presented DOM module to WebM when a static video deliverable is needed:

```js
import { renderDomReplayVideo } from "autotour";

await renderDomReplayVideo({
  playerPath: result.domPaths["sign-in"],
  outputPath: ".autotour/output/sign-in.webm",
  size: { width: 1440, height: 900 },
  durationMs: 10000
});
```

For product ads and social clips, set `presentation.motion.mode` to `showcase`. The browser frame can use bounded perspective, X/Y tilt, scale, drift, and duration while the gradient canvas remains fixed. `renderDomReplayVideo.durationMs` captures a fixed presentation interval instead of waiting for replay completion; the WebM container can include a brief startup interval. See the [AutoTour guide](docs/guide.md#capture-an-existing-journey) for a complete example.

## Dependency-aware invalidation

Map repository files to the dependency names stored in walkthrough modules, then ask AutoTour which modules need regeneration:

```json
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "profile-page",
      "files": ["src/profile/**"],
      "dependencies": {
        "views": ["ProfileSettings"],
        "apiEndpoints": ["GET /api/profile", "PUT /api/profile"]
      }
    }
  ]
}
```

```sh
autotour invalidate .autotour/output/walkthrough.json \
  --map .autotour/dependency-map.json \
  --base origin/develop \
  --head HEAD \
  --output .autotour/output/invalidation-plan.json
```

Use repeated `--changed-file <path>` options instead of `--base` for coding-agent or webhook integrations that already know the changed paths. The command exits with status `2` when unmapped files or stale dependency names require human review. A fully mapped change returns `0`, even when modules need regeneration, because the plan itself is a successful result.

Add `--check` to fail CI with status `2` when tracked modules need regeneration as well. See [GitHub and GitLab pipeline examples](docs/ci.md). This reports source impact; it does not acknowledge a refresh or compare remote Confluence content.

## Selective regeneration

Apply an invalidation plan to an existing screenshot, DOM, or video output directory:

```sh
autotour regenerate .autotour/journey.json \
  --plan .autotour/output/invalidation-plan.json \
  --output-dir .autotour/output/capture
```

AutoTour infers the output mode from the existing `walkthrough.json`. It executes earlier modules when they are needed to establish authentication or application state, but replaces files only for modules classified `regenerate`. Reusable module assets and manifest entries are preserved. Plans containing `review` classifications exit with status `2` before a browser is launched.

Regeneration happens in a sibling staging directory. The assembled walkthrough is schema-validated before AutoTour swaps it into place; capture or validation failure leaves the previous output intact. A plan containing no affected modules is a successful no-op.

## Markdown screenshot synchronization

Define [`.autotour/documentation.json`](docs/documentation-spec.md) for section headings, ordered text, selected screenshot steps, UI views, captions, highlight targets, and dependencies. `autotour validate-docs` validates linked journeys/maps; `prepareDocumentationCapture` applies capture instructions; `sync-markdown --spec` renders the layout. A complete example is in `examples/documentation.json`.

AutoTour can refresh screenshot references inside explicit managed regions while preserving the surrounding documentation:

```markdown
<!-- autotour:module=update-profile:start -->
![Previous screenshot](./old-profile.png)
<!-- autotour:module=update-profile:end -->
```

Both the walkthrough and selected module must set `publish` to `true`. Synchronization resolves screenshot sources relative to the walkthrough manifest, copies them into stable walkthrough/module folders, and writes links relative to the Markdown file:

```sh
autotour sync-markdown .autotour/output/profile/walkthrough.json \
  --markdown docs/profile.md \
  --assets-dir docs/assets/autotour
```

Use `--dry-run` to preview machine-readable changes without writing. Use `--check` in CI; it also performs no writes and exits with status `2` when the Markdown or copied assets are stale. Invalid, nested, duplicate, unknown, unpublished, or unpaired markers and unsafe source paths fail before the Markdown file is changed.

## Full documentation runs

The documentation definition can declare multiple targets and keep the journey and dependency map inline:

```json
"targets": [
  { "kind": "markdown", "path": "docs/product.md" },
  { "kind": "html", "path": "site/index.html", "mode": "site" },
  { "kind": "confluence", "siteUrl": "https://example.atlassian.net", "pageId": "12345" }
]
```

Run any subset after capturing or regenerating the walkthrough, or omit `--walkthrough` to let AutoTour capture the definition automatically:

First ask where artifacts and documentation should live (this repository or elsewhere), whether each should be versioned, and whether to modify `.gitignore`. Save those answers with `configure-storage`. For example, **only after approval** for local output and ignore edits:

```sh
autotour configure-storage --output .autotour/output --documentation-output .autotour/output/documentation --artifacts local --documentation local --gitignore modify
autotour run-docs .autotour/documentation.json \
  --target markdown,html --mode create
```

Automatic capture selects screenshot recording for screenshot blocks and DOM replay for video/replay blocks. Mixed capture modes still use separate capture runs and an explicit walkthrough manifest.

The command creates complete local Markdown or HTML output, copies referenced screenshots, and writes a Confluence section plan for connected publication. `--mode adapt` is available when updating an existing documentation tree. The planning skill discusses targets, prose approval, HTML layout, and screenshot/DOM/WebM media choices before producing the definition.

> AutoTour is in active development. The package supports annotated modular screenshots, raw WebM video, presented DOM autoplay with optional WebM rendering, dependency-aware invalidation, selective screenshot/DOM/video regeneration, and managed Markdown screenshot synchronization; portable remote-asset harvesting, screenshot presentation profiles, and hosted publishing remain future slices.

## Install

AutoTour requires Node.js 20 or newer.

```sh
npm install --global autotour
autotour doctor
```

Until the first npm release, install directly from a checkout:

```sh
npm install
npm link
autotour --help
```

The repository is also a portable Agent Plugin. Its root `plugin.json` and `skills/` directory are canonical; `.codex-plugin`, `.claude-plugin`, and `.cursor` provide host compatibility.

For an end-to-end walkthrough from journey authoring through local review and CI, read the [AutoTour guide](docs/guide.md).

Agents should follow [INSTALL.md](INSTALL.md) for installation, connection setup, and verification. AutoTour declares external Atlassian (Confluence/Jira), GitHub, and GitLab tools without shipping their servers. LinkedIn delivery prepares clips and copy; direct posting requires a verified publishing provider.

## Start a project

```sh
autotour init
```

This creates `.autotour/autotour.json`. Authentication values are read from environment variables and must not be committed:

```sh
AUTOTOUR_USERNAME=test-user@example.com
AUTOTOUR_PASSWORD=replace-me
```

Walkthrough manifests follow [schemas/walkthrough.schema.json](schemas/walkthrough.schema.json). Validate one with:

```sh
autotour validate path/to/walkthrough.json
```

## Repository layout

- `skills/create-autotour/` teaches compatible coding agents the recording workflow.
- `schemas/` contains versioned JSON contracts for projects and walkthroughs.
- `bin/` and `src/` contain the CLI and public package API.
- `examples/` contains publish-safe sample manifests.
- `.autotour/output/`, `.autotour/auth/`, and `.autotour/cache/` are local and ignored.

## Security

Use dedicated, least-privilege test accounts. Keep passwords, tokens, cookies, browser storage state, and private captures outside Git. Review generated screenshots and DOM snapshots for personal or confidential data before publishing them.

## Development

```sh
npm install
npm run check
npm pack --dry-run
```

Active development is integrated on `develop`; `main` is reserved for release-ready changes. Product stories, acceptance criteria, and implementation evidence are managed as versioned AgentHouse records under `.agenthouse/work/`. See [docs/work-tracking.md](docs/work-tracking.md).

## License

MIT
