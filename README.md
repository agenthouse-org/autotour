# AutoTour

AutoTour is an open-source toolkit for coding agents that turns a web application and a target user journey into modular product walkthroughs.

The intended outputs are dynamic DOM walkthroughs, rendered video, and annotated screenshots. Each walkthrough module records the application views, controllers, API endpoints, and backend components it depends on so affected modules can be re-recorded independently after a change.

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

## Annotated screenshot capture

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
    stepDelayMs: 500
  }
});

console.log(result.domPaths);
console.log(result.domIndexPath);
```

Serve the output directory as static files and open its root `index.html` for continuous playback across modules. Individual module players remain available under `modules/<module-id>/dom/index.html` so one changed module can be replaced independently. DOM capture adds a 500 ms presentation delay after each step by default; set `stepDelayMs` to tune it or `0` to preserve raw execution timing. Form values are masked, captured scripts remain disabled inside rrweb's sandbox, and generated assets include the rrweb MIT notice. Remote fonts, images, canvas content, and cross-origin iframes are not yet guaranteed to work offline; asset harvesting is a later slice.

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

> AutoTour is in active development. The package supports annotated modular screenshots, raw WebM video, DOM autoplay capture, dependency-aware invalidation, selective screenshot/DOM/video regeneration, and managed Markdown screenshot synchronization; portable remote-asset harvesting, presentation profiles, and hosted publishing remain future slices.

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
