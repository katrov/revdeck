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
| Claude Code | `/revdeck` | `.claude/commands/revdeck.md`, `.claude/skills/revdeck` → `../../.agents/skills/revdeck`, `.mcp.json` |
| Cursor | `/revdeck` | `.cursor/commands/revdeck.md`, `.cursor/mcp.json` |
| Codex CLI | prompt `revdeck` | `.codex/prompts/revdeck.md`; MCP in `~/.codex/config.toml` (manually) |
| Gemini CLI | `/revdeck` | `.gemini/commands/revdeck.toml`; MCP in the Gemini settings (manually) |
| OpenCode | `/revdeck` | `.opencode/command/revdeck.md` |
| GitHub Copilot | prompt file | `.github/prompts/revdeck.prompt.md` |
| DSH | plugin (see below) | `.agents/skills/revdeck/*` (including `agents/openai.yaml`) + YAML snippet in the output |
| Universal | — | `.agents/skills/revdeck/*` (including `agents/openai.yaml`) + MCP |

`revdeck init --adapters dsh,claude` explicitly enables the adapters you need. A repeated `init`
does not overwrite existing command files and does not clobber other keys in `.mcp.json`.

The skill has one canonical copy: `.agents/skills/revdeck` (including `agents/openai.yaml` for OpenAI
harnesses). Harnesses that keep skills under their own directory get a link to it — `.claude/skills/revdeck`
is a symlink to `../../.agents/skills/revdeck`, with a copy fallback on Windows and on filesystems without
symlink support. Old copies created by an earlier `init` are replaced when they still carry
`name: revdeck`.

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

## Container

The daemon runs on the host, the agent in a container. Options in decreasing order of convenience:

1. Mount `$XDG_RUNTIME_DIR/revdeck` into the container at the same path — the socket works as is.
2. `REVDECK_URL=http://host.docker.internal:<port>` and `REVDECK_TOKEN=<token>` — the HTTP transport.
   The port and token are printed by `revdeck daemon start` (or in `daemon.json` in the state
   directory).
3. `revdeck export <N>` on the host and `revdeck import <N>` in the container — a file bridge.

## Verification

```bash
revdeck doctor
```

Shows the binaries found, `glab`/`gh` authorization, daemon status and the installed adapter.
