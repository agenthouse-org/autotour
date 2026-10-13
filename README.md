# AutoTour

**Turn a web app and a user journey into modular product walkthroughs.**

[![Release](https://img.shields.io/github/v/release/agenthouse-org/autotour?display_name=tag&sort=semver&logo=github)](https://github.com/agenthouse-org/autotour/releases)
[![npm version](https://img.shields.io/npm/v/autotour?logo=npm)](https://www.npmjs.com/package/autotour)
[![CI](https://github.com/agenthouse-org/autotour/actions/workflows/ci.yml/badge.svg)](https://github.com/agenthouse-org/autotour/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/agenthouse-org/autotour)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2020-339933?logo=node.js&logoColor=white)](package.json)

<p align="center">
  <video autoplay muted loop playsinline controls poster="docs/assets/agenthouse-homepage-reveal.png" width="100%">
    <source src="docs/assets/agenthouse-homepage-reveal.webm" type="video/webm">
    <a href="docs/assets/agenthouse-homepage-reveal.webm">Watch the AutoTour demo</a>
  </video>
</p>

AutoTour is an open-source toolkit for coding agents that captures reliable, reviewable product documentation from real browser journeys. Create annotated screenshots, DOM replays, modular videos, and dependency-aware refresh plans without recapturing everything after every UI change.

> **Status:** AutoTour is actively developed. The current package supports modular screenshots, raw WebM video, DOM autoplay replays, dependency-aware invalidation, selective regeneration, and managed Markdown screenshot synchronization.

## Why AutoTour?

- **One journey, multiple outputs** — produce screenshots, HTML replays, or video from the same schema-shaped source.
- **Modular by design** — replace only the walkthrough module affected by a code change.
- **Agent-friendly** — accessible role/name targets, validation, local review, and clear CLI workflows.
- **Safe to publish** — generated output is local by default, credentials stay in environment variables, and sensitive content can be redacted before capture.

## Quick start

```sh
npm install --global autotour
autotour init
autotour doctor
```

AutoTour requires Node.js 20 or newer and Chromium for browser capture. For a checkout, contributor setup, or connected services, see [INSTALL.md](INSTALL.md).

## A small example

Define a journey once, then choose the output you need:

```js
import { readFile } from "node:fs/promises";
import { captureJourney } from "autotour";

const journey = JSON.parse(
  await readFile("examples/agenthouse-dealdesk.json", "utf8")
);

const result = await captureJourney({
  journey,
  outputDir: ".autotour/output/dealdesk",
  recordScreenshots: {
    viewport: { width: 1280, height: 720 },
    redaction: { selectors: ["[data-private]"] }
  }
});

console.log(result.screenshotPaths);
```

The same `captureJourney` call can create DOM replays or videos by replacing `recordScreenshots` with `recordDom` or `recordVideo`. See the [complete capture guide](docs/guide.md#capture-an-existing-journey) and [sample journeys](examples/).

## Choose an output

| Output | Best for | Entry point |
| --- | --- | --- |
| Annotated screenshots | Support articles and visual how-tos | `recordScreenshots` |
| DOM replay | Embeddable, interactive product tours | `recordDom` |
| Modular WebM | Product demos and social clips | `recordVideo` or `renderDomReplayVideo` |
| Markdown synchronization | Keeping selected documentation images current | `sync-markdown --spec` |

Every output is written below the ignored `.autotour/output/` directory by default. Review generated media for correctness and sensitive data before publication.

## Keep walkthroughs current

Map source files to the views, API endpoints, and backend components a module depends on. AutoTour can then identify the smallest set of modules that need to be regenerated:

```sh
autotour invalidate .autotour/output/walkthrough.json \
  --map .autotour/dependency-map.json \
  --base origin/main \
  --head HEAD \
  --output .autotour/output/invalidation-plan.json

autotour regenerate .autotour/journey.json \
  --plan .autotour/output/invalidation-plan.json \
  --output-dir .autotour/output/capture
```

Use `--check` in CI to fail when tracked modules are stale. See the [CI examples](docs/ci.md) and [reliable tours guide](docs/reliable-tours.md).

## Documentation

- [Getting started and end-to-end guide](docs/guide.md)
- [Role-based onboarding and commands](docs/onboarding.md)
- [Reliable tours](docs/reliable-tours.md)
- [Documentation specification](docs/documentation-spec.md)
- [Output modes](skills/create-autotour/references/output-modes.md)
- [Contributing](CONTRIBUTING.md)

## Repository layout

- `src/` and `bin/` — public package API and CLI
- `schemas/` — versioned project, journey, walkthrough, and documentation contracts
- `examples/` — publish-safe sample manifests
- `skills/create-autotour/` — agent workflow and authoring guidance
- `docs/` — detailed usage, CI, and publishing guidance

## Security

Use dedicated, least-privilege test accounts. Keep passwords, tokens, cookies, browser storage, and private captures out of Git. Inspect generated screenshots, DOM snapshots, and videos for personal or confidential data before publishing them.

## Development

```sh
npm install
npm run check
npm pack --dry-run
```

Active development is integrated on `develop`; `main` is reserved for release-ready changes.

## License

AutoTour is available under the [MIT License](LICENSE).
