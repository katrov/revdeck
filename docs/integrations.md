# Harness integrations

[English](integrations.md) | [Русский](ru/integrations.md)

revdeck has two portable layers and one adapter layer:

- **MCP** (stdio) — the `revdeck_*` tools work in any MCP-capable client.
- **CLI** — the same capabilities without MCP: `revdeck review/feedback/open/context/findings/reply/publish`.
- **`/` command** — each harness has its own; `revdeck init` creates the right file.

A full integration = MCP + skill (procedures) + command (entry point). Without MCP, the CLI and
skill remain: the agent calls commands through the shell.

## Matrix

| Harness | `/` command | What `init` writes |
|---|---|---|
| Claude Code | `/revdeck` | `.claude/commands/revdeck.md`, `.claude/skills/revdeck/SKILL.md` → `../../../.agents/skills/revdeck/SKILL.md`, `.mcp.json` |
| Cursor | `/revdeck` | `.cursor/commands/revdeck.md`, `.cursor/mcp.json` |
| Codex CLI | prompt `revdeck` | `.codex/prompts/revdeck.md`; MCP in `~/.codex/config.toml` (manually) |
| Gemini CLI | `/revdeck` | `.gemini/commands/revdeck.toml`; MCP in the Gemini settings (manually) |
| OpenCode | `/revdeck` | `.opencode/command/revdeck.md` |
| GitHub Copilot | prompt file | `.github/prompts/revdeck.prompt.md` |
| DSH | plugin (see below) | `.agents/skills/revdeck/*` (including `agents/openai.yaml`) + YAML snippet in the output |
| Universal | — | `.agents/skills/revdeck/*` (including `agents/openai.yaml`) + MCP |

Comment attachments are uploaded by the host daemon. GitLab uses project uploads and returns an
absolute URL; GitHub has no public attachment API, so the editor asks for a URL instead.

`revdeck init --adapters dsh,claude` explicitly enables the adapters you need. A repeated `init`
upgrades a command file that still matches the old generated template and leaves a customized file
alone; it does not clobber other keys in `.mcp.json`.

## Explicit scenario commands

The generated `/revdeck` command takes the mode as its first argument:

| Invocation | Scenario |
|---|---|
| `/revdeck review 442` | Someone else's MR: follow `Review.md` |
| `/revdeck feedback 442` | Your own MR: follow `Feedback.md` |
| `/revdeck open 442` | Neutral load; the context marks whether the MR is yours |

The same verbs exist in the CLI (`revdeck review 442`, `revdeck feedback 442`) and in MCP as
`revdeck_context` with `scenario=review|feedback`. `revdeck open` prints the matching next command when
the platform user and the MR author are known. The scenario is not persisted: it is an argument of the
call, not a property of the review.

The skill has one canonical copy: `.agents/skills/revdeck` (including `agents/openai.yaml` for OpenAI
harnesses). Claude gets only `.claude/skills/revdeck/SKILL.md`, a symlink to
`../../../.agents/skills/revdeck/SKILL.md`; the procedure files stay in `.agents`. On Windows and
filesystems without symlink support, that single file is a short shim pointing to `.agents`. Old copied
skill directories created by an earlier `init` are replaced when they still carry `name: revdeck`.

## MCP

```json
{
  "mcpServers": {
    "revdeck": {
      "command": "npx",
      "args": ["-y", "revdeck", "mcp"],
      "env": { "REVDECK_LANG": "en" }
    }
  }
}
```

`init` writes `npx -y revdeck mcp` into the MCP config. Publishing over MCP
requires an `approval_id`: a human issues it in the UI or in the CLI with `--yes`, and the agent
cannot obtain it.

## MCP tool permissions

By default the client asks before every MCP tool call. Revdeck tools are read-only except the draft and
publish helpers; publishing still requires a human `approval_id`, so allowing the tools does not bypass
the publish gate.

For Claude Code, add the tools to `.claude/settings.local.json` (personal) or `.claude/settings.json`
(shared):

```json
{
  "permissions": {
    "allow": [
      "mcp__revdeck__revdeck_list",
      "mcp__revdeck__revdeck_status",
      "mcp__revdeck__revdeck_open",
      "mcp__revdeck__revdeck_context",
      "mcp__revdeck__revdeck_threads",
      "mcp__revdeck__revdeck_diff",
      "mcp__revdeck__revdeck_rules",
      "mcp__revdeck__revdeck_notes",
      "mcp__revdeck__revdeck_feature",
      "mcp__revdeck__revdeck_feature_note",
      "mcp__revdeck__revdeck_set_summary",
      "mcp__revdeck__revdeck_draft_findings",
      "mcp__revdeck__revdeck_draft_reply",
      "mcp__revdeck__revdeck_publish_preview",
      "mcp__revdeck__revdeck_publish"
    ]
  }
}
```

A recent Claude Code also accepts `mcp__revdeck__*` as a glob, but the explicit list works across
versions. If you use the CLI instead of MCP, allow `Bash(revdeck:*)` as well.

For Cursor, create `.cursor/permissions.json` (or `~/.cursor/permissions.json`):

```json
{
  "mcpAllowlist": ["revdeck:*"]
}
```

Use `revdeck:revdeck_context`-style entries if you want to allow only individual tools. Restart or
reload the editor/agent after changing the file.

## DSH

The DSH MCP client is configured in the Cordis profile:

```yaml
- id: mcp-revdeck
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: revdeck
    transport: stdio
    command: npx
    args: ['-y', 'revdeck', 'mcp']
    env:
      REVDECK_LANG: en
```

The tools will appear as `mcp__revdeck__*`. DSH does not support MCP prompt templates, so `/revdeck`
requires a host command (`ctx.commands.register`) or a client action — that is a separate wrapper
plugin. Until then, use the skill + MCP tools: the `/` slash is not required for things to work.

## Container and devcontainer

The daemon, `glab` and `gh` stay on the host; the container only needs the revdeck CLI or MCP server.
Generate the devcontainer settings from the repository root:

```bash
revdeck devcontainer          # print the mounts and environment
revdeck devcontainer --write  # merge them into .devcontainer/devcontainer.json
```

`--write` mounts the stable bridge `~/.local/state/revdeck/devcontainer/run` (agent-scoped socket) and
`~/.local/state/revdeck/devcontainer/state` (read-only info `daemon.json`: capabilities and an agent-scoped token, no UI token) and sets:

```json
{
  "REVDECK_RUNTIME_DIR": "/run/revdeck",
  "REVDECK_STATE_DIR": "/var/lib/revdeck",
  "REVDECK_DEV_CONTAINER": "1",
  "REVDECK_UI_HOST": "host.docker.internal"
}
```

The mount sources in `devcontainer.json` use `${localEnv:HOME}${localEnv:USERPROFILE}`, never an
absolute home directory, so the shared repository file is valid for every developer. Existing mounts,
environment variables, `runArgs`, comments and foreign keys are preserved; only the two revdeck mounts
and the `REVDECK_*` keys are managed.

`REVDECK_HOST_ROOT` closes the path gap between the two sides: the daemon reads `.revdeck.yml` and rule
documents on the host, while the container sees the same worktree under `/workspaces/...`. `--write`
writes `${localWorkspaceFolder}`, which the devcontainer tooling expands to the host path of the
opened folder, so no user-specific path is committed. If the repository is a subfolder of the opened
workspace, set `REVDECK_HOST_ROOT` manually (for example `${localWorkspaceFolder}/subdir`). The CLI and
MCP server in the container map their worktree path (and paths under it) to the host path before
`reviews.open`, `reviews.remoteList` and `projects.register`. Without the mapping the review still opens
(platform calls run on the host), but the UI shows auto-discovery and a "directory is not visible"
warning instead of the project config. Reviews opened before the mapping keep the old container root;
reopen them.

The daemon creates the bridge socket on startup. On the host run `revdeck daemon restart`, then rebuild
the container. Inside the container `revdeck` never starts its own daemon: if the socket is unreachable
it fails with a `DEVCONTAINER` error and a hint. `revdeck doctor` does not look for `glab`/`gh` in the
container.

On macOS with Docker Desktop the host Unix socket is not proxied. The bridge is agent-scoped: it allows
`read`/`draft` only, and its `daemon.json` contains no UI token. The UI is opened on the host; the
container uses the mounted socket. If the socket is not reachable, set `REVDECK_URL` +
`REVDECK_TOKEN` from the user's environment (an agent-scoped token); there is no automatic HTTP
fallback with the UI token.

On Linux, if the socket is not reachable, the same `REVDECK_URL` + `REVDECK_TOKEN` path applies. Do not
expose the UI token to the container; `--host 0.0.0.0` is for a browser on another trusted machine,
not for giving the agent more rights.

`revdeck devcontainer --write` adds the `REVDECK_*` variables to the `revdeck` MCP server in `.mcp.json`
and `.cursor/mcp.json` inside the repository. `REVDECK_HOST_ROOT` is the exception: `${localEnv:...}`
and `${localWorkspaceFolder}` are expanded only in `devcontainer.json`, so it is set in
`containerEnv`/`remoteEnv` and inherited by the MCP server. A user-level MCP configuration outside the
repository needs the same variables manually (with an absolute `REVDECK_HOST_ROOT`), otherwise it may
start a second daemon in the container.

The container user must be able to connect to the host bridge socket (the bridge socket is `0666`
inside the mounted directory `0755`; its methods are limited by the `read`/`draft` capability). The UI
is opened on the host with `revdeck ui`; the UI token is not passed to the container.

Fallbacks:

1. `REVDECK_URL=http://host.docker.internal:<port>` and `REVDECK_TOKEN=<agent-scoped-token>` — the
   HTTP transport, with the daemon started on the host with `--host 0.0.0.0`; the token is
   agent-scoped and must not be the UI token.
2. `revdeck export <N>` on the host and `revdeck import <N>` in the container — a file bridge.

## Several projects and devcontainers

Each repository is its own project. A `.mcp.json` (or `.cursor/mcp.json`) inside the repository pins
the MCP server to that repository; the server resolves the project from its root and lists only that
project's reviews. With one devcontainer per repository, each container mounts the same host daemon
bridge and stays scoped to its own working copy.

For a multi-root workspace with several repositories, add one MCP server entry per project with an
explicit `REVDECK_ROOT` and a unique server name. The server does not accept a `root` or project
override from the agent, so one session cannot open another project's review. `revdeck projects`
lists the registry; `revdeck projects add <path>` registers a repository before its first review.

Cross-project work goes through an explicit feature (above); outside a feature a foreign review is
rejected with a hint to open a separate session. See [capabilities](capabilities.md#features).

## Feature sessions

A project session is scoped to one repository. To let one agent review a feature that spans several
projects, start the MCP server from a repository that is a feature member with:

```bash
REVDECK_FEATURE=ft-a1b2c3 revdeck mcp
```

In an MCP config this is the `REVDECK_FEATURE` value in the `revdeck` server's `env`. The server
validates that the current project is a member and expands the scope only to the feature's reviews. Drafts may be written to any member; publishing still needs a separate human approval for
each review. Feature membership is created by the human in the UI or CLI, never by the agent.

In a devcontainer the same rule applies: the container's repository must be a feature member, and the
server talks to the host daemon over the same bridge. The combined context is review data plus the
declared `context.sources` profile files from member checkouts; symlinked paths outside a member root
are rejected. Arbitrary source trees of other repositories are not read.

## Verification

```bash
revdeck doctor
```

Shows the binaries found, `glab`/`gh` authorization, daemon status, the paths the daemon itself
resolves for `glab`/`gh`, and the installed adapter. In a devcontainer it checks the host daemon instead
of looking for `glab`/`gh` inside.
