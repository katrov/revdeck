# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] - 2026-11-12

### Added

- Markdown editor for thread replies, findings and line comments: Write/Preview tabs, a formatting
  toolbar, attachment upload, and rendered images/videos. GitLab `/uploads/...` links and
  `{width=... height=...}` attributes are supported; external images stay links and are not loaded.

## [0.2.1] - 2026-11-12

### Fixed

- `revdeck devcontainer --write` no longer writes absolute host paths into the shared
  `devcontainer.json`: mounts use `${localEnv:HOME}${localEnv:USERPROFILE}` and a stable
  `~/.local/state/revdeck/devcontainer/{run,state}` bridge. The daemon listens on a second RPC socket
  there for containers. Comments and formatting in an existing JSONC file are preserved.

## [0.2.0] - 2026-11-12

### Added

- Reactions on platform comments: thread cards in the UI, `revdeck react --note <id> --emoji <name>`,
  and the `reactions.list` / `reactions.toggle` RPC methods. Existing reactions and the current user's
  choice are shown for GitLab and GitHub.
- `revdeck eject`: removes the config, installed skills and command files, the `revdeck` MCP entry and
  the local cache from a repository. It is preview-only without `--yes` and leaves foreign files and
  other MCP servers intact.
- Attachments for comments: the UI **Attach** button and `revdeck attach` upload images and videos
  through the host daemon. GitLab project uploads return absolute URLs, relative `/uploads/` links are
  normalized to the platform host during publish, and the sanitizer allows images only from that host.
  Only raster images and videos with matching extension, MIME and file signature are accepted.
- Devcontainer support: `revdeck devcontainer --write` mounts the host runtime and state directories,
  sets `REVDECK_*` variables and marks the container, so revdeck reuses the host daemon and never runs
  `gh`/`glab` inside. `revdeck doctor` checks the host daemon in this mode; `revdeck daemon start
  --host` exposes the HTTP UI, and `revdeck eject` removes the generated mounts/env.

### Fixed

- `revdeck init` keeps one canonical skill in `.agents/skills/revdeck` (now including
  `agents/openai.yaml`) and links `.claude/skills/revdeck` to it instead of copying the procedure files.
  A copy is used only on platforms without symlink support.

## [0.1.0] - 2026-11-11

First public release.

### Added

- Daemon-first architecture: local daemon over a unix socket, SQLite state, multiple reviews.
- Providers for GitLab and GitHub via `glab`/`gh`: MR/PR info, unified diff, threads, replies,
  resolve, reactions, line comments, general comments.
- Approval-gated, idempotent publishing: preview → plan hash → approve → commit.
- CLI: `init`, `doctor`, `daemon`, `list`, `open`, `context`, `diff`, `threads`, `summary`,
  `findings`, `reply`, `notes`, `publish`, `rules`, `checks`, `export`, `import`, `ui`, `mcp`.
- MCP server with 13 tools, `review-mr` and `close-feedback` prompts.
- Svelte 5 UI: review queue, summary, threads with autosave, findings triage, virtualized-free diff
  with line comments, rules, publish dialog, command palette, SSE updates.
- Configurable per-project rules: path → document/section mapping, auto-discovery, checks.
- Harness adapters for Claude Code, Cursor, Codex, Gemini CLI, OpenCode, Copilot and DSH (MCP).
- Bilingual product: Russian and English UI with a switch, localized CLI/MCP/context, and separate
  Russian/English skill packs selected by `revdeck init --lang`.
- `output.language: auto | ru | en` for review output, independent of the interface language.
- English documentation as the canonical set under `docs/`, with Russian translations under `docs/ru/`.
- Security: token scrubbing, redaction, publish sanitizer, loopback-only UI, one-time launch token,
  cookie/Origin/Host checks, CSP.
- Docs: architecture, configuration, protocol, threat model, integrations, ADR.
- Tests: diff parser, core helpers, providers with recorded responses, service with a fake provider.
