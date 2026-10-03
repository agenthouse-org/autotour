# Onboarding routes

## Content

- [Onboarding routes](#onboarding-routes)
- [Content](#content)
- [Marketing clip](#marketing-clip)
- [Product tour for Confluence](#product-tour-for-confluence)
- [Documentation and maintenance](#documentation-and-maintenance)
- [Optional authoring tools](#optional-authoring-tools)

## Marketing clip

For “I am a marketing manager and need a short clip for LinkedIn,” ask about audience, one product message, organic post versus paid ad, duration and exactness, aspect ratio, quality, cursor, zoom, and motion. Reuse supplied answers. Offer a restrained AutoTour showcase or optional motion-ad for a storyboard, typography, and call to action. Verify current destination specifications before choosing export format. AutoTour produces WebM; conversion to another format requires external tooling. Review the final artifact at delivery size and measure duration; posting is a separate authorized action.

## Product tour for Confluence

For “I am a product manager and want an embeddable HTML DOM tour for Confluence,” ask about the journey, audience, Confluence Cloud versus Data Center, approved hosting, access controls, and available embed macros. Explain that this is recorded DOM playback with player controls, not a live interactive copy of the application. Capture with `recordDom` and review the root index and individual modules. Preserve the entire output directory, including runtime and assets; it is not a single portable HTML file.

Check current Confluence embed support. An approved HTTPS host and an available iframe macro can provide an embed; a pasted Smart Link does not guarantee arbitrary HTML playback. Verify frame policies, nested frames, scripts, access, dimensions, and playback as a real viewer. Do not promise that an HTML attachment will execute. If embedding is unavailable, offer a link to the hosted tour or a video/screenshots. AutoTour does not provide hosting; connected agent tools can publish to Confluence when requested. See the packaged [onboarding guide](../../../docs/onboarding.md) for sources and command boundaries.

## Documentation and maintenance

For support and enablement, confirm the task and whether PNGs, DOM replay, or both are useful. For engineering, preserve module IDs, inspect dependencies, and use invalidation and selective regeneration. Read `maintenance.md` for commands and publication rules.

## Optional authoring tools

AutoTour declares external Atlassian, GitHub, and GitLab connections; their server implementations are not shipped. Read `connections.md` for setup, Confluence section updates, Jira tracking, LinkedIn delivery, and CI. Discover available authenticated tools; a declaration alone does not mean a service is connected. Prefer browser tools for inspection and AutoTour capture APIs for recording. Optional media and hosting tools can process or publish reviewed assets when authorized.

Document each tool's actual purpose, provider, setup, permission scope, and whether it is optional. Do not add an `mcp.json` entry merely to describe tools maintainers use. Such an entry declares a plugin integration for consumers. Keep private endpoints and credentials out of the package. Missing MCPs must not prevent local capture; provide manual delivery instructions or report a specific missing capability. External publication requires user authorization, even if a connector is present.
