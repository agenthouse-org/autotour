# Contributing

AutoTour welcomes focused issues and pull requests.

1. Use Node.js 20 or newer.
2. Install dependencies with `npm ci`.
3. Keep credentials and generated captures out of Git.
4. Run `npm run check` and `npm pack --dry-run` before opening a pull request.
5. Preserve stable walkthrough module IDs unless the module's purpose changes.

## Branches

- `main` contains release-ready code and accepts changes through pull requests from `develop`.
- `develop` is the integration branch for active work.
- Story branches start from `develop` and follow `{id}-{slug}`.

Direct local commits to `main` are blocked by the repository hook. A hosted repository must also require the `Branch policy` and `CI` checks for `main` because local hooks are advisory and can be bypassed.

## Work items

AgentHouse records stories and changes in `.agenthouse/work/`. See [docs/work-tracking.md](docs/work-tracking.md) for the workflow.

By contributing, you agree that your contribution is licensed under the MIT License.
