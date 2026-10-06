# Optional motion-ad integration

## Content

- [Optional motion-ad integration](#optional-motion-ad-integration)
- [Content](#content)
- [Choose the route](#choose-the-route)
- [Load or install](#load-or-install)
- [Handoff and verification](#handoff-and-verification)

## Choose the route

Offer motion-ad for a marketing story, animated typography, multiple beats, or a call to action around product footage. Use AutoTour alone for a procedural tour or a restrained showcase. Confirm audience, message, destination, duration and exactness, cursor, zoom, motion, and HTML versus video delivery. Another skill's defaults must not replace the agreed brief.

## Load or install

1. Look for an available `motion-ad` skill and read its `SKILL.md`. Reuse it without downloading another copy.
2. If missing, explain that it is an optional external skill from [agenthouse-org/skills](https://github.com/agenthouse-org/skills/tree/main/marketing/motion-ad) and ask whether to install it. A request to install already supplies authorization; do not ask twice.
3. Use the host's skill installer. In Codex, read the available `skill-installer` instructions, then use its helper with `--repo agenthouse-org/skills --path marketing/motion-ad`. Resolve the helper from the installed skill location. Use a reviewed commit/ref when supplied, record the installed revision, and verify the upstream path at installation time.
4. Preserve existing installations and follow host scope and permission rules. Do not silently overwrite, install into immutable agenthouse runtime storage, or add motion-ad to AutoTour's runtime/package dependencies. If installation or discovery is unavailable, report the limitation and offer the AutoTour-only route. Check success before claiming installation.
5. Follow the installer's activation instructions. If a new turn or reload is required, tell the user before invocation. Read the actual installed instructions and referenced resources when available.

## Handoff and verification

Pass the agreed brief, verified product claims, brand sources, capture paths, viewport, sensitive-content restrictions, and output requirements to motion-ad. AutoTour manifests and source captures remain authoritative for application behavior. Follow motion-ad's composition, browser inspection, and export workflow; do not assume its page clock can seek an arbitrary AutoTour replay.

HTML and video are separate deliverables; export only when requested. Check fonts and small text at delivery resolution, inspect the complete motion for clipping and exposed replay edges, and measure the exported duration when exactness is required. Report actual artifacts and remaining limits. Installing motion-ad does not upgrade AutoTour's recorder or guarantee sharper or exact-duration AutoTour exports.
