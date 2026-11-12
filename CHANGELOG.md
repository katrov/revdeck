# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-11-12

### Added

- Private **Note for the agent** on every finding; it is included in the CLI/MCP context and never
  published.
- Reactions on the MR/PR itself (description) in the UI, HTTP API and RPC, in addition to thread-note
  reactions. The current GitLab/GitHub user is stored with the review.
- Edit and delete own platform comments from the thread card; local line comments can also be edited and
  deleted before publishing.
- Devcontainer MCP: `revdeck devcontainer --write` adds the `REVDECK_*` env to the `revdeck` server in
  `.mcp.json` / `.cursor/mcp.json`, and a client in a devcontainer falls back to HTTP via the mounted
  `daemon.json` when the Unix socket is unavailable.

### Fixed

- The sidebar is ordered by the MR/PR update time, not by local sync time, so opening a review no longer
  reorders the list. Switching reviews keeps the active tab.

## [0.3.3] - 2026-11-12

### Fixed

- `revdeck init` installs only `.claude/skills/revdeck/SKILL.md` — a symlink to
  `.agents/skills/revdeck/SKILL.md`. The procedure files stay in `.agents`; old copied skill
  directories are replaced, and Windows gets a short shim instead of a directory copy.

## [0.3.2] - 2026-11-12

### Fixed

- The daemon resolves `glab`/`gh` outside its own `PATH` (mise/asdf shims, `~/.local/bin`, Homebrew) and
  accepts `REVDECK_GLAB`/`REVDECK_GH` overrides. `daemon install` captures the current PATH and resolved
  binary paths in the systemd unit/launchd plist. A missing CLI now returns an install/PATH hint instead
  of only `spawn glab ENOENT`; `doctor` prints the path resolved by the CLI and by the running daemon,
  so a service with an outdated PATH is visible.

## [0.3.1] - 2026-11-12

### Fixed

- GitLab upload URLs: relative `/uploads/...` links are no longer rewritten to `https://host/uploads/...`
  (GitLab expands them itself), and absolute host-only links are repaired to
  `https://host/-/project/<id>/uploads/...` using the review's project id. The UI uses the same
  project-aware base for images and videos.

## [0.3.0] - 2026-11-12

### Added

- UI: MR/PR description on the Overview; an **Open review** dialog (`o`) that opens a number or URL
  from the browser; deep links to threads, findings and diff lines with working Back/Forward; a file
  filter, per-review "viewed" checkboxes and previous/next file buttons in the diff.
- Markdown editor: paste and drag-and-drop image/video uploads, and `Ctrl/Cmd+B`, `Ctrl/Cmd+I`,
  `Ctrl/Cmd+K` formatting shortcuts.
- Mobile sidebar as an overlay with a backdrop; it is closed by default on narrow screens.

### Fixed

- Header actions wrap on mobile instead of squeezing the MR title.

## [0.2.3] - 2026-11-12

### Added

- Collapsible UI sidebar: the header button or `s` hides/shows it, and the choice is stored in
  `localStorage`.
- `rules.maxDocumentBytes` and `rules.maxTotalBytes` in `.revdeck.yml`. `0` (the new default) means no
  limit, so all rule documents are loaded; set a positive value to cap the context.

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
