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

## DOM autoplay replay

Set `recordDom` to capture rrweb events and generate one sandboxed autoplay page per module. The generated output includes a shared local replay runtime, so the local fixture works after the source application is stopped.

```js
const result = await captureJourney({
  journey,
  outputDir: ".autotour/output/dealdesk-dom",
  recordDom: {
    viewport: { width: 1280, height: 720 }
  }
});

console.log(result.domPaths);
```

Serve the output directory as static files and open a module's `dom/index.html`. Form values are masked, captured scripts remain disabled inside rrweb's sandbox, and generated assets include the rrweb MIT notice. Remote fonts, images, canvas content, and cross-origin iframes are not yet guaranteed to work offline; asset harvesting is a later slice.

> AutoTour is in active development. The package supports modular screenshots, raw WebM video, and DOM autoplay capture; dependency-based invalidation, portable remote-asset harvesting, and polished publishing remain future slices.

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
