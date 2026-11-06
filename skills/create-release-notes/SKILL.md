---
name: create-release-notes
description: Create reviewed release notes for a Git commit range from an AutoTour walkthrough, with before/after screenshots of affected modules and sections for developers, product owners, and product managers. Use when a developer, PO, or PM asks for release notes, a changelog, or "what changed for users" between two versions.
license: MIT
---

# Create release notes with AutoTour

## Content

- [Create release notes with AutoTour](#create-release-notes-with-autotour)
- [Content](#content)
- [Plan with the user](#plan-with-the-user)
- [Draft](#draft)
- [Write the audience sections](#write-the-audience-sections)
- [Review and approval](#review-and-approval)
- [Rules](#rules)

## Plan with the user

Work from the target repository root. Before running anything, confirm:

1. **Range**: the base ref (usually the previous release tag) and the head ref (default `HEAD`).
2. **Inputs**: the walkthrough manifest and dependency map. These are usually `.autotour/output/walkthrough.json` and `.autotour/dependency-map.json`. If there is no dependency map, say that every commit will be listed as having no user-visible change, and offer to create a map first with the `create-autotour` skill.
3. **Audiences**: which sections the user wants: developer, product owner (PO), product manager (PM), or all three.
4. **Images**: the folder that holds the current captures (`--assets-dir`, which defaults to the walkthrough's folder). Also an optional folder holding the previous release's captures (`--baseline-dir`). Without a baseline folder, AutoTour reads each "before" image from Git at the base ref when the captures are versioned.
5. **Output**: a folder below an ignored path, for example `.autotour/output/release-notes/<version>`.

Do not capture, publish, tag, or change versions. Release notes are a draft until a person approves them.

## Draft

```sh
autotour release-notes <walkthrough.json> --map <dependency-map.json> \
  --base <ref> --head <ref> --output <folder> \
  [--assets-dir <folder>] [--baseline-dir <folder>] [--work-dir .agenthouse/work]
```

The command starts no browser and writes only inside `--output`. It writes:

- `release-notes.json`: the structured draft, valid against `schemas/release-notes.schema.json`.
- `release-notes.md` and `release-notes.html`: generated from the JSON. Never edit them by hand.
- `images/before/…` and `images/after/…`: copies of the screenshots of affected modules.

How to read the draft:

- `commits[]` lists every commit in `base..head`. `modules` holds the modules that commit affects, using the same rules as `autotour invalidate`. `workItems` holds the work records that the commit message names by ticket id (for example `ST-12`) or by a `Work-Item: <id>` trailer.
- `modules[].status` is the net result for the whole range: `regenerate` (changed), `review` (cannot be ruled out because the range has unmapped files or stale mappings), or `reusable`. A commit can name a module whose net status is not `regenerate`, for example when a later commit undid the change.
- `noVisibleChange` lists commits that affect no module. These commits are never dropped.
- An image with `before: null` is shown as "no previous capture".

## Write the audience sections

Edit only `audiences` in `release-notes.json`. Each entry is `{ "text": "...", "refs": ["..."] }`. Every ref must be a commit SHA (7 or more characters, unique in the range), a module id, or a work-item id from the draft. Then re-render:

```sh
autotour release-notes render <folder>
```

`render` rejects any entry that refers to something outside the draft. Fix the entry. Don't add the fact some other way.

- **pm**: the outcome for customers and users, in plain language. Lead with the work-item outcomes and the changed modules. Leave out internal tooling.
- **po**: which work items or stories this range delivers, each with its id. Mention modules that still need review.
- **developer**: the changed modules, the commits behind them, unmapped files, and anything listed under "No user-visible change detected" that a developer should know.

Write only what the draft supports. If a commit subject is unclear, ask the user. Don't guess what the change does. Leave out customer names, credentials, internal hostnames, and data from screenshots unless the user confirms that the notes are internal.

## Review and approval

Show the user the HTML or Markdown, and list:

- the modules with status `review` and the unmapped files that caused them
- images labelled "no previous capture" or "missing capture"
- commits under "No user-visible change detected" that look user-facing

Approval is the user's act. Run the approval only after the user has said in this conversation that they approve, and use their name:

```sh
autotour release-notes approve <folder> --by "<name>" [--accept-review]
```

While any module has status `review`, the approval needs `--accept-review`. Pass it only after the user has checked those modules. The accepted modules are recorded with the approval. In CI, `autotour release-notes … --check` exits with status 2 while any module needs review.

Changing the content after approval returns the notes to draft on the next `render`.

## Rules

- No browser, no capture, no publishing, no tagging, no version changes from this skill.
- Never write anything outside the chosen output folder, except for edits to `audiences` in `release-notes.json`.
- Never approve on the user's behalf.
- To publish the notes, hand them to the destination the user names (for example a Confluence page or a GitHub release) as a separate step that the user confirms.
