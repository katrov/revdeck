# revdeck

[![npm](https://img.shields.io/npm/v/revdeck.svg)](https://www.npmjs.com/package/revdeck)
[![CI](https://github.com/katrov/revdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/katrov/revdeck/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/node/v/revdeck.svg)](https://nodejs.org)

**Agent-first code review for GitLab and GitHub.**

revdeck gives an agent the review context and the project's own rules, lets it write findings and
replies, and keeps publishing under human control. It runs as a local daemon with a CLI, an MCP server
and a web UI. Platform tokens stay on the host.

![revdeck UI](docs/screenshot.png)

[Русская версия](README.ru.md) · [Documentation](docs/README.md) (English and Russian)

## Why

- **Rules, not vibes.** For every changed path revdeck selects the repository documents and the exact
  sections (`AGENTS.md`, architecture, style guides, ADRs). The agent gets a deterministic, size-limited
  context instead of generic “review this PR” instructions.
- **Humans publish.** The agent writes drafts. The UI shows exactly what will be posted; publishing is
  bound to a hash of the plan and is idempotent. There is no “agent approved its own comment” path.
- **Tokens never reach the agent.** The daemon calls `glab`/`gh` on the host and scrubs platform tokens
  from child environments. A sandboxed agent only gets an RPC.
- **GitLab and GitHub.** One model: MR/PR, threads, diff, resolve, reactions, line comments, attachments.
- **Many reviews.** The daemon keeps them in SQLite; the UI is a triage queue with keyboard shortcuts.
- **Any harness.** MCP tools for MCP clients, the same capabilities over CLI, and a skill that carries
  the review procedure.

## How it works

```
agent (MCP/CLI) ──unix socket──▶ revdeck daemon ──glab/gh──▶ GitLab / GitHub
                                      │
                                SQLite + Svelte UI ◀── human
```

## Install

Requirements: Node.js ≥ 22.13 (Node 24 LTS recommended — `node:sqlite` is experimental in 22.x), `git`, and an authenticated platform CLI
(`glab auth login` or `gh auth login`). The CLI must be in the daemon's `PATH`; set `REVDECK_GLAB` or
`REVDECK_GH` to an absolute path if it lives in a mise/asdf/homebrew shim or a custom location. revdeck
never reads or stores their tokens.

```bash
# one-off
npx revdeck@latest init

# or install globally for daily use
npm install -g revdeck
revdeck init
```

In a repository:

```bash
cd /path/to/repo
revdeck init          # .revdeck.yml, skill for your harnesses, MCP config
revdeck doctor        # node, glab/gh auth, daemon, adapters
revdeck open 42       # load an MR/PR
revdeck ui            # open the local UI
```

`init` never overwrites an existing config without `--force`, and it merges `.mcp.json` instead of
replacing it. `revdeck eject` is the inverse: it removes the config, installed skills and command files,
the `revdeck` MCP entry and the local `.revdeck/` cache, leaving foreign files and other MCP servers
untouched. It only shows the plan by default; add `--yes` to apply (`--keep-config` keeps
`.revdeck.yml`). Auto-start on login: `revdeck daemon install` (systemd user unit on Linux, launchd
plist on macOS). Use a global install for this — an `npx` cache path can be evicted.

If `glab` works in the shell but the UI refresh fails with `spawn glab ENOENT`, the daemon has a
different `PATH` (systemd/launchd often do). Run `revdeck doctor`; it shows the path resolved by the
running daemon. Set `REVDECK_GLAB=/absolute/path/to/glab` (or `REVDECK_GH`), or reinstall the service
with `revdeck daemon install` so it captures the current `PATH`, then restart the daemon.

## Languages

The product is bilingual (Russian and English), and the two languages are independent:

- **Interface and CLI**: follow `--lang ru|en`, then `REVDECK_LANG`, then the system locale. The UI has
  a RU/EN switch in the sidebar and remembers your choice.
- **Review output** (findings, replies, summary): `output.language: auto | ru | en` in `.revdeck.yml`.
  `auto` follows the language of the MR description and threads, so a Russian team can review an
  English repo and still get Russian comments (or the other way round).
- **Skill**: `revdeck init --lang en` installs the English procedure; without the flag init follows
  `REVDECK_LANG`/the system locale and defaults to English.
- **Project rules** can be written in any language: revdeck reads UTF-8 documents and matches headings
  (including Cyrillic) without translation. Rules are quoted as-is.

MCP tool descriptions are English — that is the model-facing layer; prompt text follows
`REVDECK_LANG`. The daemon reads the language at startup, so restart it after changing the language
(`revdeck daemon restart`).

Documentation is available in English (`docs/`, canonical) and Russian (`docs/ru/`). English and
Russian READMEs live in this repository; translation fixes are welcome.

## Commands

| Command | What it does |
|---|---|
| `revdeck init` | config, harness adapters, MCP |
| `revdeck eject [--yes]` | remove revdeck-owned config, adapters and MCP entry |
| `revdeck devcontainer [--write]` | mount the host daemon socket/state into a devcontainer |
| `revdeck doctor` | environment, `glab`/`gh` auth, daemon, adapters |
| `revdeck list [--remote]` | tracked reviews or open ones from the platform |
| `revdeck open <N\|URL>` | load a review |
| `revdeck context <N>` | agent context: rules, files, threads, findings |
| `revdeck diff <N> [--file]` | files and hunks |
| `revdeck threads <N>` | discussions |
| `revdeck findings <N> set --file f.json` | write findings |
| `revdeck reply <N> --thread <id> --body …` | draft a reply |
| `revdeck publish <N> [--yes]` | preview or publish after confirmation |
| `revdeck notes <N> …` | line comments from the human |
| `revdeck react <N> --note <id> --emoji <name>` | toggle a reaction on a platform comment |
| `revdeck attach <N> --file <image-or-video>` | upload an attachment and print its markdown link |
| `revdeck rules [--explain <path>]` | effective rules |
| `revdeck checks <N> [--run --yes]` | project checks |
| `revdeck export/import <N>` | legacy file exchange |
| `revdeck ui [N]` | local web UI |
| `revdeck daemon <start\|stop\|restart\|status\|logs\|install\|uninstall>` | daemon lifecycle |
| `revdeck mcp` | MCP server over stdio |

Common flags: `--json`, `--root`, `--review`, `--platform`, `--project`, `--host`, `--lang ru|en`.

UI shortcuts: `1`–`5` switch tabs, `o` opens a review, `r` refreshes, `s` hides/shows the
sidebar, `p` opens publishing, `?` opens the command palette. The sidebar choice is stored in
`localStorage`.

The UI shows the MR/PR description, supports deep links to threads, findings and diff lines (with
working browser Back/Forward), and keeps a per-review "viewed" state and file filter in the diff.

## Attachments

The UI has an **Attach** button next to reply, finding and line-comment editors; the CLI equivalent is
`revdeck attach <N> --file shot.png`. The file is uploaded by the daemon on the host, and the editor
receives a markdown link with an absolute platform URL, so GitLab renders images and videos in the
original MR. Relative GitLab `/uploads/...` links are left for GitLab to expand in the project
context; absolute host-only links are repaired to `https://<host>/-/project/<id>/uploads/...` when the
GitLab project id is known.

GitLab is supported through project uploads (requires a `glab` with `--form` support). GitHub has no
public attachment API, so the button is disabled there and a link must be pasted manually. Only raster
images and videos (PNG, JPEG, GIF, WebP, AVIF, MP4, WebM, OGV, MOV) are accepted; SVG and arbitrary
files are rejected.

Comment editors have GitLab/GitHub-style **Write / Preview** tabs and a Markdown toolbar. Images and
videos from the platform host (including GitLab `/uploads/...` links and `{width=... height=...}`)
render in the preview and in thread comments; external images are shown as links and are never loaded.

## Notes for the agent

Every finding has a private **Note for the agent** field, and every thread has the same note next to the
reply. The text is included in `revdeck_context` / MCP but never published to GitLab or GitHub. Findings
also keep their decision note separately.

## Devcontainer

The daemon, `glab` and `gh` stay on the host. From the repository root:

```bash
revdeck devcontainer          # print the mounts and environment
revdeck devcontainer --write  # merge them into .devcontainer/devcontainer.json
```

The command mounts the stable host bridge `~/.local/state/revdeck/devcontainer/run` at `/run/revdeck`
(socket) and `~/.local/state/revdeck/devcontainer/state` at `/var/lib/revdeck` (read-only
`daemon.json`), and sets `REVDECK_RUNTIME_DIR`, `REVDECK_STATE_DIR`, `REVDECK_DEV_CONTAINER=1` and
`REVDECK_UI_HOST`. The JSON uses `${localEnv:HOME}${localEnv:USERPROFILE}` instead of an absolute
home path, so the same `.devcontainer/devcontainer.json` works for every developer. Comments and
foreign keys in an existing JSONC file are preserved.

The daemon creates the bridge socket on startup, so on the host run `revdeck daemon restart`, then
rebuild the container. Inside the container revdeck never starts a local daemon, so `gh`/`glab` are
never invoked there; if the host socket is missing it fails with a clear `DEVCONTAINER` error.
`revdeck doctor` is aware of this mode.

If a Unix socket cannot be mounted (for example Docker Desktop on macOS), start the host daemon with
`revdeck daemon start --host 0.0.0.0`. The container reads `daemon.json` from the mounted state and
falls back to HTTP with the same session token; `.mcp.json` / `.cursor/mcp.json` get the required
`REVDECK_*` env from `revdeck devcontainer --write`. Binding the daemon to `0.0.0.0` exposes its HTTP
port to the network, so use it only on a trusted network.

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

Tools: `revdeck_status`, `revdeck_list`, `revdeck_open`, `revdeck_context`, `revdeck_threads`,
`revdeck_diff`, `revdeck_rules`, `revdeck_draft_reply`, `revdeck_draft_findings`,
`revdeck_set_summary`, `revdeck_notes`, `revdeck_publish_preview`, `revdeck_publish`.

Publishing requires an `approval_id` that only a human can create (UI or CLI `--yes`). The MCP tool
does not create one. Prompts `review-mr` and `close-feedback` are available in clients that support
MCP prompts.

Harness matrix and slash commands: [docs/integrations.md](docs/integrations.md).

## Rules

`.revdeck.yml` at the repository root:

```yaml
version: 1
output:
  language: auto        # auto | ru | en — язык замечаний и ответов
provider:
  type: gitlab          # auto | gitlab | github
  host: gitlab.example.com
  project: group/project
  base: develop
rules:
  sources: [AGENTS.md, CONTRIBUTING.md]
  map:
    - match: "src/**"
      docs: [docs/Architecture.md, "docs/Styleguide.md#Базовый стиль"]
    - match: "src/state/**"
      docs: [docs/StateManagement.md]
  ignore: ["**/generated/**"]
  maxDocumentBytes: 0   # 0 = no limit
  maxTotalBytes: 0      # 0 = no limit
checks:
  - id: lint
    argv: [npm, run, lint]
    when: ["src/**"]
publish:
  requireApproval: true
  maxComments: 50
```

Document selectors: `docs/File.md`, `docs/File.md#Heading`, `docs/File.md#L10-L25`. Without a config,
revdeck discovers `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` and `docs/*` and warns when nothing is
found. Full schema: [docs/configuration.md](docs/configuration.md).

## Security

- The daemon listens on loopback and a unix socket (0600). The UI uses a one-time launch token, an
  `HttpOnly`/`SameSite=Strict` cookie, `Host`/`Origin` checks and CSP.
- `glab`/`gh` run without a shell, with `cwd` outside the working copy and a scrubbed environment;
  secrets are redacted from logs and errors.
- Comments are checked for GitLab quick actions, HTML, hidden/bidi characters, mass mentions and
  external images (only uploads from the platform host are allowed).
- Review text is untrusted data; agent instructions say so explicitly.

Details: [docs/threat-model.md](docs/threat-model.md). The guarantee is: the token does not cross the
sandbox boundary and is not returned over RPC. If a process can read the user's home directory, it can
read the CLI configuration — isolate the agent.

## Architecture

| Path | Contents |
|---|---|
| `src/core` | models, diff parser, rules compiler, findings, sanitizer, safe exec |
| `src/providers` | GitLab and GitHub via `glab`/`gh`, normalized |
| `src/daemon` | SQLite, service, unix-socket RPC, HTTP/SSE, approvals |
| `src/cli` | commands, `init`, `doctor`, export/import |
| `src/mcp` | MCP server over stdio |
| `ui` | Svelte 5 + Vite |
| `skills/revdeck` | review procedures (SKILL, Review, Feedback, Criteria, Rules, Sources, `agents/openai.yaml`) |

More: [docs/architecture.md](docs/architecture.md), [docs/protocol.md](docs/protocol.md),
[ADR-0001](docs/adr/0001-daemon-first.md).

## Development

```bash
npm ci
npm run typecheck     # tsc + svelte-check
npm test              # vitest
npm run build         # dist/cli.js, dist/daemon.js, dist/mcp.js, dist/ui
npm run dev:daemon    # daemon from source
npm run dev:ui        # Vite dev server (the daemon serves dist/ui)
```

Provider tests use recorded CLI responses and need no network. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Status

- Publishing uses regular comments; native drafts (GitLab draft notes, GitHub pending review) are not
  used yet, though the provider interface is ready.
- Project checks are planned by the agent; running them requires `revdeck checks --run --yes`.
- The UI opens a review from the **Open review** dialog; the working-copy root is required so the daemon
  can read `.revdeck.yml`.
- Thread resolution is in the thread card; reactions are available on thread notes and on the MR/PR
  description. Own platform comments can be edited or deleted from the thread card.
- GitHub has no public attachment API: the Attach button is disabled there; uploads work in GitLab.
- Auto-start is supported on Linux and macOS; on Windows run the daemon manually.

## License

[MIT](LICENSE)
