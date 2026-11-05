# AutoTour live tour runtime

Encapsulated product tours for the web. Pure vanilla JS custom elements, zero production dependencies, MIT licensed.

Inspired by [bootstrap-tourist](https://github.com/IGreatlyDislikeJavascript/bootstrap-tourist) (shout-out). This is a new implementation — not a fork and not a copy of that source.

## License split

| In this package (MIT) | Not in this package (protected) |
| --- | --- |
| Tour engine, catalog, preferences, MCP | agenthouse design-system source |
| Shadow DOM chrome, `::part`, events | Geist fonts |
| Generic system-color fallback theme | COLORS.MD / Signal palette |

On an agenthouse host, `<ah-webtour>` inherits `--ah-*` from the page. OSS hosts get the generic MIT fallback or set `--ah-webtour-*` themselves.

Install with `npm install @agenthouse-org/autotour-runtime`. For bundlers, import `@agenthouse-org/autotour-runtime`; for native browsers, serve the full package `src` directory from your application. See [the migration guide](https://github.com/agenthouse-org/autotour/blob/main/docs/live-tours.md).

## Quick start

```html
<script type="module" src="./node_modules/@agenthouse-org/autotour-runtime/src/index.js"></script>

<ah-webtour id="tours" product-id="my-app" locale="en" catalog-url="/tours/manifest.json">
  <ah-webtour-help slot="help"></ah-webtour-help>
</ah-webtour>

<script type="module">
  const host = document.getElementById('tours');
  host.addEventListener('ah-webtour-complete', (e) => console.log(e.detail));
</script>
```

Register a tour in memory:

```js
host.register({
  id: 'app.overview',
  version: '1.0.0',
  autoOffer: true,
  locales: {
    en: { title: 'Overview', steps: { nav: { title: 'Nav', body: 'Use the sidebar.' } } },
  },
  steps: [{ id: 'nav', target: '#primary-nav', placement: 'right' }],
});
host.refreshHelp();
host.maybeAutoOffer();
```

## Theming

Resolution order:

1. `--ah-webtour-*` on the element or an ancestor
2. Inherited page `--ah-*` (agenthouse design system on the host)
3. Generic MIT fallbacks (`Canvas` / `CanvasText` / `LinkText`)

Public parts: `spotlight`, `cutout`, `coachmark`, `title`, `body`, `progress`, `actions`, `next`, `prev`, `skip`, `done`, `remind`, `never`, `help`, `help-item`, `offer`.

```js
const sheet = new CSSStyleSheet();
sheet.replaceSync(`:host { --ah-webtour-signal: tomato; }`);
host.adoptThemeSheet(sheet);
```

## Waiting for a target

`waitForTarget` polls until the step selector is visible. Default timeout is 2000ms. `timeout: 0` waits until the element appears (or the tour is skipped).

Use `advanceWhen` when the user must do something first (open a record, load a panel). The current coachmark stays on screen, docks to the bottom-right so the page stays usable, and Next is hidden until the selector is visible. Skip still ends the tour. Drag the card if it still covers a control. If the selector is already visible, that step is skipped.

```js
host.register({
  id: 'app.record',
  version: '1.0.0',
  locales: {
    en: {
      title: 'Record',
      steps: {
        open: { title: 'Open a record', body: 'Open a record to continue.' },
        detail: { title: 'Detail', body: 'The tour continues on the open record.' },
      },
    },
  },
  steps: [
    {
      id: 'open',
      target: '#records-nav',
      advanceWhen: { selector: '#record-editor', timeout: 0 },
    },
    { id: 'detail', target: '#record-editor' },
  ],
});
```

A string form is the same as an indefinite wait: `"advanceWhen": "#record-editor"`.

## Preferences

Statuses per tour id + version: `unseen`, `in-progress`, `completed`, `snoozed`, `never`.

Default storage: `localStorage` key `ah-webtour:<productId>` (optional `user-key` suffix). Offer actions: **Remind me** / **Do not remind me**.

## MCP authoring

```bash
AH_WEBTOUR_DIR=./tours npx ah-webtour-mcp
# or
node ./bin/ah-webtour-mcp.js ./tours
```

Tools: `webtour.list_tours`, `webtour.create_tour`, `webtour.add_step`, `webtour.update_step`, `webtour.set_locale`, `webtour.validate`, `webtour.publish`.

## Scripts

```bash
npm test
```

## Demo

From the package root (required — `src/` must be reachable):

```bash
npm run demo
```

Open `http://localhost:4173/demo/`. Do not run `serve demo` alone; that only exposes the HTML folder and `/src/index.js` will 404.
