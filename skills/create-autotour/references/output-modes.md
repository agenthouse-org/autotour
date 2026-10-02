# Output modes

## Content

- [Output modes](#output-modes)
- [Content](#content)
- [Raw modular video](#raw-modular-video)
- [Presented DOM replay](#presented-dom-replay)
- [Presentation pacing](#presentation-pacing)
- [Annotated screenshots](#annotated-screenshots)

## Raw modular video

Execute the schema-shaped walkthrough with `captureJourney({ journey, recordVideo })`. Use a fixed viewport and one video per module so unchanged modules remain reusable. This records the live application without DOM presentation chrome.

## Presented DOM replay

Execute the same walkthrough with `captureJourney({ journey, recordDom })`. Omitted presentation options preserve the pure player. Configure `recordDom.presentation` only for requested cursor, focus, canvas, or browser-window treatment.

Use `renderDomReplayVideo` when the WebM must exactly match the presented DOM module. Verify the generated player after the source application is unavailable, reject captures containing protected values, and report remote assets that prevent a fully portable replay.

```js
recordDom: {
  viewport: { width: 1440, height: 900 },
  stepDelayMs: 650,
  presentation: {
    cursor: {
      scale: 1.8,
      moveDurationMs: 850,
      clickPulse: true,
      clickDurationMs: 800
    },
    focus: {
      mode: "clicks",
      scale: 1.25,
      durationMs: 650,
      holdMs: 2400
    },
    frame: { mode: "window", title: "Product walkthrough" },
    background: { mode: "gradient", from: "#111815", to: "#26342b" },
    padding: 44
  }
}
```

## Presentation pacing

`focus.holdMs` is quiet time after the most recent click, not total zoom duration. A new click before it expires keeps the current zoom and smoothly pans to the next target. Choose it deliberately:

- Measure or estimate the longest gap between clicks that belong to one visual sequence, including step delays and explicit waits. Set `holdMs` at least 250 ms beyond that gap.
- When timing is not yet measured, start with `2 * stepDelayMs + durationMs` and increase it after inspecting the replay.
- Prefer 2200–3200 ms for ordinary narrated product walkthroughs.
- Use 3500–4500 ms when a menu-to-page sequence includes a deliberate pause but should remain one continuous camera move.
- Avoid values below 1500 ms unless rapid zooming is explicitly requested.
- Keep `durationMs` around 500–800 ms for calm movement and use a conservative scale of 1.15–1.35.

Inspect at least one multi-click sequence. Reject output that repeatedly returns to full view between related actions, jumps instead of panning, exposes empty edges, or makes text unreadable. The cursor should render white with a black edge over both dark and light content. Honor reduced-motion behavior.

Treat pointer movement and camera movement as separate pacing choices. Use `cursor.moveDurationMs` to smooth travel between recorded positions; start around 650 ms and use 800–1000 ms for deliberate marketing walkthroughs. Use `cursor.clickDurationMs` around 650–900 ms so the expanding high-contrast click ring remains readable. Reject output where the pointer teleports, trails so far that it misses the clicked control, or the click ring disappears before a viewer can register it.

## Annotated screenshots

Execute the journey with `captureJourney({ journey, recordScreenshots })`. Use a fixed viewport and configure selectors or text rules for sensitive content. AutoTour temporarily redacts values supplied through credential environment variables. Verify every image before publication; the manifest's ordered `assets.screenshots` list can feed `autotour sync-markdown`.
