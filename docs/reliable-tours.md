# Reliable tours across applications

AutoTour separates preparation, interaction, expected state, and presentation. These mechanisms apply to any browser application; selectors, safe setup actions, and test data remain application-specific.

## Capture contract

Use `module.setup` for navigation, resetting filters, choosing a fixture, and dismissing known optional popups. These are normal journey steps. For DOM output, AutoTour starts a fresh snapshot after setup and `beforeCapture`, so preparation is excluded from the delivered recording. Screenshot output also starts after setup. Raw browser video currently includes setup; trim it separately if needed.

Do not automatically dismiss arbitrary dialogs or modify production records. Explicitly identify presentation-only popups. `optional: true` skips an action only when its target is absent; it does not suppress ambiguous targets or failed actions.

Targets support exact accessible roles/names, exact text, `css=` (including data attributes), and `testid=` (the `data-testid` attribute). Programmatic equivalents are `{role, name}`, `{text}`, `{css}`, and `{testId}`. Keep selectors scoped to a stable region. Actions reject multiple matches. An explicit index remains supported for compatibility, but is not a substitute for a stable identity.

```json
{
  "id": "open-item",
  "action": "click",
  "description": "Open the selected fixture item",
  "instruction": "Open the matching item.",
  "narration": "Its details show the current processing status.",
  "selector": "css=[data-tour-target=sample-item]",
  "expect": {
    "selector": "css=[role=dialog]",
    "state": "visible",
    "count": 1,
    "stableForMs": 500,
    "timeoutMs": 10000
  },
  "pauseAfterMs": 2400
}
```

`wait.until` uses the same condition contract as `expect`: selector/target, state, exact `count`, `minimumCount`, exact `text`, `stableForMs`, and `timeoutMs`. Stability compares DOM content, text, visibility, and bounding boxes at 50 ms intervals. Scope it to the meaningful result region: clocks, live feeds, and background polling should not prevent a capture. `networkIdle: true` is opt-in and can time out on continuously polling applications. Wait for a known loader with `state: "hidden"` or `"detached"`.

Put a `selector` on a scroll step to scroll that container. Without one, scrolling targets the window. Check a meaningful result after scrolling; executing a scroll command alone does not prove new content became visible.

Screenshot annotations share these targets. They wait for fonts (bounded), finish finite animations, measure after scrolling, require stable geometry, and check the rendered highlight against the target. Movement during capture or a coordinate-space mismatch fails instead of silently returning a misplaced annotation. Captions avoid the target, but avoiding every surrounding control still needs visual review.

## Fixtures and lifecycle hooks

The JavaScript API accepts `fixtures` and `hooks` on `captureJourney` and `regenerateWalkthrough`:

```js
await captureJourney({
  journey,
  fixtures: { itemId: "tour-item-001" },
  hooks: {
    async beforeModule({ page, module, fixtures }) { /* authorized seed/auth adapter */ },
    async beforeCapture({ page, module, fixtures }) { /* final presentation preparation */ },
    async afterStep({ page, module, step, fixtures }) { /* application-specific checks */ }
  },
  recordDom: {
    autoplay: false,
    inlineEvents: false,
    presentation: { focus: { mode: "off" }, cursor: { visible: true, clickPulse: true } },
    redaction: { blockSelector: "[data-private]", maskTextSelector: "[data-mask]" }
  }
});
```

Hooks are trusted JavaScript supplied by the caller, not code evaluated from journey JSON. Fixtures are passed to hooks; AutoTour does not invent an application's database seed API. Use deterministic, authorized sample data and verify exact expected results. Keep a search/filter active through the interaction it explains.

## Replay and delivery

DOM replay records `start`, `settled`, and `end` markers for each presentation step. The settled marker follows its expected-state check and precedes the deliberate pause; the end marker follows `afterStep`. For initial navigation, the first available marker is recorded after the destination recorder initializes. Record navigation in setup when the visible journey should begin from a stable page.

The player includes instructions/narration, a seek slider, elapsed/total time, previous/next step, pause and restart. It explicitly identifies itself as recorded content. Controls retain a usable layout on narrow screens; the recorded viewport is scaled, not reflowed. The 1:1 toggle shows original-size content with scrolling when fit-to-screen text is too small. `language` on the journey sets wrapper language; a module can infer language from its captured HTML. German and English player labels are included; other language tags currently use English controls.

Click focus remains opt-in. Cursor movement defaults to recorded timing (no extra CSS lag). Autoplay remains enabled for compatibility unless `recordDom.autoplay: false`; reduced-motion viewers start paused. Render-to-video mode still starts automatically.

`inlineEvents: false` produces a small HTML player loading a single compact `events.json`, avoiding a duplicated event payload. Serve the complete output directory over HTTP:

```sh
autotour preview .autotour/output/my-tour
```

Preview binds only to loopback, selects a free port by default, and supports `--port`. It does not open a browser automatically. Hidden paths, traversal outside the served root, and non-read requests are rejected. The default inline event format remains available for portable existing workflows. Event compression, aggressive mutation/CSS deduplication, and a separate static-DOM playback engine are deferred: changing recorded events without a fidelity test could change the demonstrated behavior.

Each module gets `capture-report.json` with size, duration, event count, capture date, source module hash, and counts of possible emails/local URLs. Counts contain no matched values and are review hints, not proof of anonymization. All form inputs remain masked. DOM recording defaults to blocking `[data-autotour-private]` and masking text in `[data-autotour-mask]`; override selectors in `recordDom.redaction`. Review recorded text, attributes, URLs, screenshots and snapshots before publication. Known credential residuals still fail capture.

## Repository cleanliness

`autotour init` creates configuration only; it does not edit `.gitignore`. Before capture, ask where working artifacts and final documentation should live, whether documentation belongs in this repository or elsewhere, and whether each should be versioned. Propose `.autotour/output/` for working files, not `docs/`. Offer narrowly scoped ignore changes for local output and save consent (or refusal) explicitly. Existing rules and already tracked files are never removed or untracked automatically.

After those choices have been approved, save them (example for all-local output):

```sh
autotour configure-storage --output .autotour/output --documentation-output .autotour/output/documentation --artifacts local --documentation local --gitignore modify
```

Use `--gitignore keep` when the user declines ignore edits. Local files inside the repository may then appear as untracked; report that tradeoff. Use the user's chosen repository-relative or absolute external folder for `--documentation-output`; target paths are relative to that folder and cannot escape it. `output` stores the working folder; `storage` stores documentation output, retention, and ignore consent. `documentation` remains the source-specification path. Existing configurations without confirmed storage choices need those choices before `run-docs`, which stops before capture if they are missing. CLI overrides cannot silently select another destination.

SDK callers pass user-approved folders explicitly. Low-level capture/annotation APIs never edit ignore files by default; `manageGitignore: true` is an explicit, separately authorized opt-in. `trackOutput: true` suppresses that opt-in for capture. Documentation generation without an explicit output root stays under `.autotour/output/documentation`, not beside a manifest or in repository `docs/`.

Keep draft exports, bundles and publishing previews under the approved working folder. Move only approved final documentation/assets into the chosen delivery destination. Preserve fixtures and approved baselines. Regeneration stages/backups use `.<name>.autotour-stage-*` and `.<name>.autotour-backup-*`; include those temporary siblings in the ignore proposal when relevant. Ask before relocating earlier accidental output; never treat its presence as approval.

## Consolidated feedback and verification

## Saved first-tour review

After agreeing on the journey and saving storage consent, create a brief JSON with four non-empty strings: `audience`, `outcome`, `privacy`, and `testDataEffects`. Keep it and the journey in the approved source/work folder, without credentials. Then run:

```sh
autotour plan-tour .autotour/journey.json --brief .autotour/brief.json --mode screenshots
autotour review my-tour
```

Replace `my-tour` with the journey ID. Modes are `screenshots`, `dom`, and `video`. Planning saves a new review under the configured working folder’s `reviews/<id>/`; it never records automatically or overwrites an existing plan. Each scene needs explicit setup/navigation, unique checkpoint IDs, and an expected-state check. Open the printed loopback URL for Brief → Review scenes → Recapture → Delivery.

The saved plan, environment, privacy guidance and stated application effects require approval before capture. Inspect each checkpoint, edit instruction/narration, exclude scenes, and attest to readability, accuracy, privacy and playback. Wording changes require recapture; approvals bind to the current source and media hashes. Selective recapture preserves other media, retains old captures and clears later approvals for consistency review. Prerequisite actions may execute again: retry consent is explicit. Failures preserve the previous successful capture and return a sanitized diagnosis. Execution or storage changes require a new approved plan.

Delivery requires current approval for every included scene and writes a new, uniquely named local folder under the configured documentation destination. It never publishes. Excluding a module is not redaction of that scene’s data appearing elsewhere. Automated byte checks are not visual, privacy, playback or governance approval. Reviewer names are local attestations, not authenticated identities. Video preview plays the whole scene; DOM preview can seek checkpoints.

The review server rejects cross-site writes, stale saves and concurrent sessions. Captured media uses a separate read-only loopback origin so replay cannot access review controls. Stop with Ctrl+C. If a process crashes, confirm it has stopped before removing its `review.lock`. SDK exports are `createTourReview`, `openTourReview`, `applyReviewAction`, `tourReport`, `reviewView`, and `startTourReview`; direct SDK callers must serialize writes themselves.

Metrics track time to first approved tour, wording corrections and capture attempts. Record real viewer trials separately, with explicit task completion, unexpected-write and disclosure outcomes and a non-identifying participant alias. Synthetic dashboard/form/content tests are regression evidence, not proof of usability for every application. Trial recruitment, external publication and remote application changes require separate authorization.

## Earlier improvements

Implemented: stable target selection, scoped readiness, nested scrolling, setup/hooks/fixtures, separate instruction and narration, deliberate pauses, replay step markers and seeking, language propagation, reduced-motion-aware start, annotation alignment checks, local preview, compact/external events, privacy review counts, and consumer ignore rules.

Existing behavior retained: input masking, exact accessible selectors, explicit index selection, modular replay, optional click focus, secret checks, and selective regeneration. The parent already checked message source and module identity; it now also checks origin. A wildcard target remains necessary for opaque local-file origins.

Do not infer an annotation's origin from its color or declare a replay defect from HTML alone. Compare live capture and playback at matching checkpoints. No claim is made that the earlier green screenshot overlays came from the built-in screenshot renderer. Generic preparation supports dismissing known product tours; a user intentionally documenting that product tour can retain it.

Regression coverage: delayed/stable results, count failures, duplicate rejection, nested scrolling, CSS/test-ID targets, screenshot geometry, setup exclusion, hook execution, marker serialization, seeking, localized controls, playback completion, narrow viewport, output size, consumer ignore rules and preview request boundaries. Browser screenshots are retained under ignored `.agenthouse/evidence/generic-tour/`.
