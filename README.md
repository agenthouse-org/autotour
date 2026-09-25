# AutoTour

AutoTour is an open-source toolkit for coding agents that turns a web application and a target user journey into modular product walkthroughs.

The intended outputs are dynamic DOM walkthroughs, rendered video, and annotated screenshots. Each walkthrough module records the application views, controllers, API endpoints, and backend components it depends on so affected modules can be re-recorded independently after a change.

> AutoTour is in its package-bootstrap phase. The CLI, plugin metadata, and walkthrough contract are usable; browser capture and rendering are not implemented yet.

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

## License

MIT
