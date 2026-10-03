# AutoTour setup for agents

## 1. Inspect before installing

Read the target repository's `AGENTS.md` and existing AutoTour configuration. Identify the user's goal: clip, DOM tour, screenshots, or documentation maintenance. Reuse an existing installation. Do not install every external connection for a local capture.

## 2. Install the package

In the target application project, with Node.js 20 or newer:

```sh
npm install autotour
npx playwright install chromium
npx autotour doctor
npx autotour init
```

Before an npm release is available, use a reviewed checkout of this repository: run `npm ci` here, then install its absolute path in the target project with `npm install /absolute/path/to/autotour`. Do not assume an unreleased npm version exists. `init` must not overwrite existing configuration; use `--force` only when replacement is intended.

## 3. Load the plugin workflow

Install this repository through the host's supported local/Git plugin flow, or load `skills/create-autotour/SKILL.md` directly. The canonical package has root `plugin.json`, `skills/`, and `mcp.json`; `.codex-plugin`, `.claude-plugin`, and `.cursor` contain compatibility metadata. Verify the skill appears before claiming activation; follow any host-required reload/new-turn instructions.

Start with: “Create a short LinkedIn clip,” “Create a Confluence DOM tour,” or “Check whether this PR changes documented behavior.” Plan with the user before capture. Keep credentials in environment variables and outputs under ignored `.autotour/output/` paths.

## 4. Connect the requested services

| Service | Connection | First verification |
| --- | --- | --- |
| Confluence + Jira | Atlassian MCP at `https://mcp.atlassian.com/v2/mcp` | Read the requested page or issue after user sign-in |
| GitHub | Existing GitHub app mapping or `https://api.githubcopilot.com/mcp/` | Read the requested repository |
| GitLab.com | `https://gitlab.com/api/v4/mcp` | Authenticate and read the requested project |
| GitLab Self-Managed | Verified instance URL + `/api/v4/mcp` | Check instance availability, access settings, and authentication |
| LinkedIn | User-selected publishing provider, if available | Verify actual upload/post tools and account; otherwise deliver files and draft copy |

`mcp.json` declares remote endpoints without shipping server code. `.app.json` offers optional registered Atlassian/GitHub mappings for personal/workspace OpenAI installs. Hosts vary in support: reuse an existing mapping or direct MCP connection, not both copies of one service. Portable clients may attempt every declared endpoint; disable unused servers through the host settings. GitLab defaults to GitLab.com; configure the verified instance before authentication for self-managed users. No LinkedIn endpoint is invented.

For public OpenAI directory submission, prepare a separate package that omits `.app.json` and `apps` fields, retaining the portable MCP configuration as required by the submission workflow. Ordinary local/workspace installation uses the checked-in mapping. Connection declarations do not prove successful authentication or grant publishing permission.

Sources: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [Atlassian setup](https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/), [GitHub MCP](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md), [GitLab MCP](https://docs.gitlab.com/user/model_context_protocol/mcp_server/).

## 5. Verify and hand off

Author `.autotour/documentation.json` for repeatable documentation layout. Start from `examples/documentation.json` and its linked journey/map examples; see `docs/documentation-spec.md`. Run `autotour validate-docs` before capture. Use `prepareDocumentationCapture` for screenshots and `sync-markdown --spec` for section layout.

Validate the journey, capture requested outputs through `captureJourney`, and inspect them. For repository maintenance, use `invalidate --check` and `sync-markdown --check`; see [CI examples](docs/ci.md). For remote updates, read `skills/create-autotour/references/connections.md` and prepare a section diff before publication. Report created artifacts, connected versus unconnected services, and remaining gaps. Never claim a live integration passed without exercising it.

Optional motion ads: reuse an installed `motion-ad`, or use the host's skill installer for `agenthouse-org/skills`, path `marketing/motion-ad`, when authorized. Read its installed instructions before composing or exporting.
