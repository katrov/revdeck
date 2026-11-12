# Harness integrations

[English](integrations.md) | [Русский](ru/integrations.md)

revdeck has two portable layers and one adapter layer:

- **MCP** (stdio) — the `revdeck_*` tools work in any MCP-capable client.
- **CLI** — the same capabilities without MCP: `revdeck open/context/findings/reply/publish`.
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
does not overwrite existing command files and does not clobber other keys in `.mcp.json`.

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

`--write` mounts the stable bridge `~/.local/state/revdeck/devcontainer/run` (socket) and
`~/.local/state/revdeck/devcontainer/state` (read-only `daemon.json`) and sets:

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

The daemon creates the bridge socket on startup. On the host run `revdeck daemon restart`, then rebuild
the container. Inside the container `revdeck` never starts its own daemon: if the socket is unreachable
it fails with a `DEVCONTAINER` error and a hint. `revdeck doctor` does not look for `glab`/`gh` in the
container.

If the host socket cannot be mountable (notably Docker Desktop on macOS), start the daemon with
`revdeck daemon start --host 0.0.0.0`. The container reads `daemon.json` from the mounted state and
falls back to HTTP using `host.docker.internal` and the same session token; no token is written to the
repository. `revdeck devcontainer --write` also adds the `REVDECK_*` variables to the `revdeck` MCP
server in `.mcp.json` and `.cursor/mcp.json`. Binding to `0.0.0.0` exposes the HTTP port to the network;
use it only on a trusted network.

The container user must be able to connect to the host socket (normally the same UID; the socket is
0600). To open the UI from the container, start the host daemon with `revdeck daemon start --host
0.0.0.0` and use `host.docker.internal`; otherwise open the UI on the host.

Fallbacks:

1. `REVDECK_URL=http://host.docker.internal:<port>` and `REVDECK_TOKEN=<token>` — the HTTP transport,
   with the daemon started on the host with `--host 0.0.0.0`.
2. `revdeck export <N>` on the host and `revdeck import <N>` in the container — a file bridge.

## Verification

```bash
revdeck doctor
```

Shows the binaries found, `glab`/`gh` authorization, daemon status, the paths the daemon itself
resolves for `glab`/`gh`, and the installed adapter. In a devcontainer it checks the host daemon instead
of looking for `glab`/`gh` inside.
