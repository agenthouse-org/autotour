# AutoTour guide

## Content

- [AutoTour guide](#autotour-guide)
- [Content](#content)
- [Choose an output](#choose-an-output)
- [Install and initialize](#install-and-initialize)
- [Describe the journey](#describe-the-journey)
- [Capture and review](#capture-and-review)
- [Showcase video](#showcase-video)
- [Keep captures modular](#keep-captures-modular)
- [Run in CI](#run-in-ci)
- [Security checklist](#security-checklist)

## Choose an output

Start with the deliverable, because each mode serves a different job:

| Need | Mode | Result |
| --- | --- | --- |
| An interactive walkthrough that works without the source application | `recordDom` | Offline autoplay HTML per module |
| A polished clip matching the DOM presentation | `renderDomReplayVideo` | Presented WebM |
| A recording of the live browser | `recordVideo` | Raw WebM per module |
| Documentation images with numbered callouts | `recordScreenshots` | Annotated PNGs per step |

Use multiple modes only when the same journey genuinely needs multiple deliverables. Keep generated output under `.autotour/output/` until it has been reviewed for publication.

## Install and initialize

AutoTour requires Node.js 20 or newer and Playwright Chromium.

```sh
npm install autotour
npx playwright install chromium
npx autotour init
```

`autotour init` creates `.autotour/autotour.json`. Keep credentials in environment variables, never in the project configuration or journey JSON.

## Describe the journey

A journey has stable modules, and each module has observable steps. Split modules at route, view, or user-task boundaries so a changed feature can be recaptured independently.

```json
{
  "schemaVersion": 1,
  "id": "services-overview",
  "title": "Services overview",
  "target": {
    "baseUrl": "https://example.com",
    "goal": "Show prospective customers the services page."
  },
  "publish": false,
  "outputs": ["dom"],
  "modules": [
    {
      "id": "services-hero",
      "title": "Services hero",
      "route": "/services/",
      "publish": false,
      "steps": [
        {
          "id": "open-services",
          "action": "goto",
          "description": "Open the services page.",
          "path": "/services/"
        },
        {
          "id": "hold-services",
          "action": "wait",
          "description": "Hold on the services introduction.",
          "durationMs": 10000
        }
      ],
      "dependencies": {},
      "assets": {}
    }
  ]
}
```

Prefer accessible role/name targets for clicks and assertions. Use a zero-based `target.index` only when duplicate controls are intentional. Validate the journey before capture:

```sh
npx autotour validate .autotour/services-overview.json
```

## Capture and review

Call `captureJourney` from a project script or coding agent. This example creates an offline DOM replay with a fake browser window:

```js
import { readFile } from "node:fs/promises";
import { captureJourney } from "autotour";

const journey = JSON.parse(await readFile(".autotour/services-overview.json", "utf8"));
const result = await captureJourney({
  journey,
  outputDir: ".autotour/output/services-overview",
  recordDom: {
    viewport: { width: 1440, height: 900 },
    stepDelayMs: 500,
    presentation: {
      frame: { mode: "window", title: "Services" },
      background: { mode: "gradient", from: "#111815", to: "#26342b" },
      cursor: { visible: false },
      padding: 52
    }
  }
});

console.log(result.domIndexPath);
```

Review the root autoplay page and every individual module. Check pacing, clipping, cursor visibility, click emphasis, secrets, personal information, missing images, remote fonts, canvas content, and cross-origin frames. A successful capture is not publication approval.

## Showcase video

For an ad or launch clip, add slow 3D motion to the browser frame and render a fixed interval:

```js
import { renderDomReplayVideo } from "autotour";

// Add this inside recordDom.presentation.
const motion = {
  mode: "showcase",
  perspective: 1400,
  rotateX: 4,
  rotateY: -8,
  driftX: 24,
  driftY: -14,
  scale: 0.92,
  durationMs: 10000
};

await renderDomReplayVideo({
  playerPath: result.domPaths["services-hero"],
  outputPath: ".autotour/output/services-overview/services-showcase.webm",
  size: { width: 1440, height: 900 },
  durationMs: 10000
});
```

Use one restrained move, conservative tilt, and enough padding to keep the fake window inside the canvas. Inspect the first, middle, and last frames as well as the complete video. Reduced-motion playback uses a static tilted composition.

`durationMs` measures the presentation interval after the local player starts. Playwright video can include a short page-startup interval in the WebM container, so inspect the encoded duration when an ad platform requires a tight runtime and calibrate the interval for that artifact.

## Keep captures modular

Record dependencies observed during capture and map repository files to those dependency names in `.autotour/dependency-map.json`. Then generate an invalidation plan:

```sh
npx autotour invalidate .autotour/output/services-overview/walkthrough.json \
  --map .autotour/dependency-map.json \
  --base origin/develop \
  --head HEAD \
  --output .autotour/output/invalidation-plan.json
```

Apply a certain plan with `autotour regenerate`. AutoTour executes prerequisite modules for browser state but replaces assets only for modules classified `regenerate`. Status `2` means review is required; do not silently recapture or publish uncertain modules.

## Run in CI

A capture job should install dependencies and Chromium, provide test credentials through CI secrets, validate or capture the journey, and upload `.autotour/output` only when policy permits. Use `autotour sync-markdown --check` when published documentation contains managed screenshot regions. Keep authentication state, local captures, caches, and generated reports ignored.

## Security checklist

- Use a dedicated least-privilege test account.
- Keep passwords, tokens, cookies, and storage state out of Git and logs.
- Redact sensitive selectors and text in screenshots.
- Review every generated DOM snapshot, image, and video before publication.
- Keep `publish` false until the journey and each selected module are intentionally approved.
