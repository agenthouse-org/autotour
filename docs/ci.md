# Documentation checks in CI

AutoTour already maps changed files to recorded module dependencies. `invalidate --check` makes that plan a freshness gate: 0 = all reusable, 2 = regeneration or review needed, 1 = an error. Normal `invalidate` keeps returning 0 for a valid regeneration plan. This detects impact on captured behavior, not arbitrary semantic changes to prose.

Commit the reviewed manifest and dependency map at stable project paths (examples below use `.autotour/walkthrough.json` and `.autotour/dependency-map.json`). Raw captures may remain ignored. Match dependency names exactly; unmapped files or stale names require review. Have the base ref available locally. No browser or MCP connection is needed for this check.

When adopting the [documentation specification](documentation-spec.md), also run `autotour validate-docs .autotour/documentation.json`. Use `sync-markdown ... --spec .autotour/documentation.json --check` to compare the declared layout and selected assets to the managed Markdown. Include specification/journey changes in source mappings so layout edits are tracked.

## GitHub pull requests

Add this job to the application's workflow, using its existing pinned checkout/setup actions and Node.js 20+ installation. Check out the PR head with full history (`fetch-depth: 0`), not only the synthetic merge commit. Run `npm ci` first; `autotour` must be a locked project dependency.

```yaml
autotour-docs:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v7
      with:
        ref: ${{ github.event.pull_request.head.sha }}
        fetch-depth: 0
    - uses: actions/setup-node@v7
      with:
        node-version: 22
        cache: npm
    - run: npm ci
    - name: Check documentation impact
      env:
        AUTOTOUR_BASE: ${{ github.event.pull_request.base.sha }}
      run: >-
        npx --no-install autotour invalidate .autotour/walkthrough.json
        --map .autotour/dependency-map.json --base "$AUTOTOUR_BASE"
        --head HEAD --check --output .autotour/output/plan.json
```

Use this in a `pull_request` workflow with read-only repository permissions. Do not run privileged capture or publishing jobs on untrusted fork code. Save `plan.json` with your existing artifact step under `if: always()` when its contents are suitable for the audience.

## GitLab merge requests

Merge into the application's `.gitlab-ci.yml`; keep its existing stages and jobs:

```yaml
autotour-docs:
  image: node:22
  variables:
    GIT_DEPTH: "0"
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  script:
    - npm ci
    - >-
      npx --no-install autotour invalidate .autotour/walkthrough.json
      --map .autotour/dependency-map.json --base "$CI_MERGE_REQUEST_DIFF_BASE_SHA"
      --head "$CI_COMMIT_SHA" --check --output .autotour/output/plan.json
  artifacts:
    when: always
    paths:
      - .autotour/output/plan.json
```

The job fails on status 2 and retains the impact plan. A missing/unavailable base is an error; fetch it or fix runner checkout configuration rather than assuming no changes.

## Refresh affected documentation

```sh
npx autotour regenerate .autotour/journey.json --plan .autotour/output/plan.json --output-dir .autotour/output/capture
npx autotour sync-markdown .autotour/output/capture/walkthrough.json --markdown docs/profile.md --assets-dir docs/assets/autotour --dry-run
```

Review regenerated output, then synchronize approved Markdown regions. Add `sync-markdown ... --check` to CI to detect stale images/links relative to the reviewed manifest. Regeneration requires Chromium and permitted application access. Keep unknown mappings in review. A subsequent invalidate check on the same source range still reports impact: it does not track a refresh acknowledgement. Teams can keep the impact job advisory while reviewing regenerated assets, or compare against their recorded last-captured source revision. Do not suppress status 2 indiscriminately.

Confluence freshness needs an additional comparison of the remote page's managed section against the published tour revision; the local checks do not query Confluence. Jira can track the resulting task, and GitHub/GitLab connectors can prepare PR/MR changes, when requested.
