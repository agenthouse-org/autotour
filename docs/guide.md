# AutoTour guide

Tell your agent what you need; agree on duration, cursor, zoom, motion, and quality before capture. Agents start with [INSTALL.md](../INSTALL.md).

| Goal | Example request | Output |
| --- | --- | --- |
| LinkedIn clip | “Make a 15-second product clip, no cursor, restrained motion. Prepare post copy.” | Reviewed WebM + draft; optional motion-ad |
| Confluence tour | “Show how to update a profile. Embed the DOM tour in page 12345.” | Hosted replay + supported embed/link |
| Product documentation | “Refresh only Profile Settings on that page; preserve other sections.” | Reviewed section patch via connected Confluence tools |
| Jira follow-up | “Add the affected modules and documentation links to PROJ-42.” | Requested issue update via Atlassian |
| CI check | “Add documentation impact checks to our GitHub or GitLab pipeline.” | Change plan and CI job |
| Visual how-to | “Capture this task with numbered screenshots.” | Annotated PNGs |

## Local setup

```sh
npm install autotour
npx playwright install chromium
npx autotour init
npx autotour doctor
```

For an unreleased checkout, follow [INSTALL.md](../INSTALL.md). Keep test credentials in environment variables and captures in ignored `.autotour/output/` paths.

## Capture an existing journey

Save as a project `.mjs` file and run with Node.js:

```js
import { readFile } from "node:fs/promises";
import { captureJourney, renderDomReplayVideo } from "autotour";

const journey = JSON.parse(await readFile(".autotour/journey.json", "utf8"));
const result = await captureJourney({
  journey,
  outputDir: ".autotour/output/product",
  recordDom: {
    viewport: { width: 1440, height: 900 },
    presentation: {
      cursor: { visible: false },
      frame: { mode: "window", title: "Product" },
      background: { mode: "gradient", from: "#111815", to: "#26342b" },
      padding: 60,
      motion: { mode: "showcase", rotateX: 4, rotateY: -6, scale: 0.9, durationMs: 15000 }
    }
  }
});
console.log(result.domIndexPath); // Root HTML tour; retain the entire output directory.

// Only when a video is requested; choose the intended module ID.
await renderDomReplayVideo({
  playerPath: result.domPaths[journey.modules[0].id],
  outputPath: ".autotour/output/product/clip.webm",
  durationMs: 15000
});
```

Use `recordScreenshots: { viewport: { width: 1440, height: 900 } }` for PNGs, or `recordVideo: { size: { width: 1440, height: 900 } }` for raw browser video. Start from [sample journeys](../examples/agenthouse-dealdesk.json), then validate:

```sh
npx autotour validate .autotour/journey.json
```

Inspect playback, small text, cropping, cursor, and sensitive data. `durationMs` sets the recording interval after readiness; WebM may include startup overhead. Exact duration requires trimming and measurement. Multiple modules remain separate video files. Remote fonts, lazy media, canvas, and cross-origin frames may need additional review.

## Publish to the requested destination

For Confluence, host the complete HTML replay directory on an approved HTTPS service, then use an available embed macro or a normal link. HTML attachments alone do not guarantee playback. For LinkedIn, check organic versus paid-ad requirements and use an authenticated publishing provider when available; otherwise deliver the clip and post draft. See [connection setup and limits](../INSTALL.md#4-connect-the-requested-services).

Connected publishing updates only the agreed page sections or issue fields, checks for concurrent changes, and verifies the result. Installation does not authorize publication. AutoTour ships connection declarations and agent workflows; no remote publisher CLI is added.

## Detect changes and refresh

Define layout, screenshot selection, captions, and UI dependencies in [`.autotour/documentation.json`](documentation-spec.md). Validate with `autotour validate-docs`; use `sync-markdown --spec` to render the agreed layout inside managed sections.

```sh
npx autotour invalidate .autotour/walkthrough.json --map .autotour/dependency-map.json --base origin/main --head HEAD --check --output .autotour/output/plan.json
npx autotour regenerate .autotour/journey.json --plan .autotour/output/plan.json --output-dir .autotour/output/capture
npx autotour sync-markdown .autotour/output/capture/walkthrough.json --markdown docs/profile.md --assets-dir docs/assets/autotour --check
```

`invalidate --check`: 0 = reusable, 2 = affected or needs review, 1 = error. Regeneration replaces affected modules and preserves others; inspect results before publication. `sync-markdown --check` detects stale managed screenshot regions without writing. [GitHub and GitLab CI examples](ci.md) explain setup and the difference between change impact and an acknowledged refresh.

For detailed presentation options, read [output modes](../skills/create-autotour/references/output-modes.md). For section-preserving remote updates, read [connected publishing](../skills/create-autotour/references/connections.md).
