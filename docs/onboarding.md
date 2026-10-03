# Start with the result you need

| You are | Try asking AutoTour |
| --- | --- |
| Marketing manager | “Create a 15-second LinkedIn clip. Ask about exactness, cursor, zoom, and motion.” |
| Product manager | “Create an HTML DOM tour for Confluence. Check our hosting and embed options first.” |
| Documentation owner | “Refresh Profile Settings on page 12345 and its tour; preserve everything else.” |
| Support or enablement | “Make annotated screenshots for this task.” |
| Engineer | “Check this PR for affected tours and add a pipeline check.” |

The agent plans only unresolved choices, records the real application journey, and reviews the result. [Examples and commands](guide.md) · [Agent installation](../INSTALL.md) · [CI templates](ci.md).

Confluence delivery requires a hosted replay directory and a supported embed method. See the [Cloud iframe macro](https://support.atlassian.com/confluence-cloud/docs/insert-the-iframe-macro/) and [Data Center options](https://support.atlassian.com/confluence/kb/how-to-put-an-iframe-into-confluence/). A recorded DOM tour has playback controls; it is not a live application clone.

AutoTour declares external Atlassian, GitHub, and GitLab connections without shipping their server implementation. Confluence and Jira share Atlassian. Account sign-in, host support, and live tool verification are still required. LinkedIn clips and drafts are supported; direct posting needs a verified publishing provider. No LinkedIn MCP endpoint is declared.

The shipped CLI has `init`, `doctor`, `validate`, `validate-docs`, `invalidate`, `regenerate`, and `sync-markdown`. Initial capture uses `captureJourney`; presented video uses `renderDomReplayVideo`. Define repeatable documentation in [`.autotour/documentation.json`](documentation-spec.md). Natural-language examples are skill requests, not invented slash commands. Use `autotour --help` for complete syntax. External tools handle remote publication only when requested.
