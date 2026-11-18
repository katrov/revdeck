# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Devcontainer path mapping: `revdeck devcontainer --write` records `REVDECK_HOST_ROOT` (the host
  working-copy path as a `${localEnv:HOME}` expression) in `containerEnv` and `remoteEnv`. The CLI and
  MCP server in the container map their worktree path to the host
  path before `reviews.open`, `reviews.remoteList` and `projects.register`, so the host daemon reads
  `.revdeck.yml`, rule documents, checks and local diff bases instead of falling back to
  auto-discovery. Reviews opened before the mapping keep the old root and must be reopened; a config
  root that is not visible to the reader now produces an actionable warning. `revdeck eject` removes
  the variable and the help/docs describe the mapping.

## [0.7.0] - 2026-11-18

### Security

- The devcontainer bridge is agent-scoped: only `read`/`draft` RPC methods are allowed; `publish.approve`,
  `publish.commit`, `checks.run`, decisions, platform writes, review removal and feature/project
  administration return `CAPABILITY`. The bridge info file contains an agent-scoped token, never the
  UI token; HTTP `/api/rpc` accepts it with read/draft only, and all UI `/api/*` endpoints reject it.
  The CLI refuses `--run --yes` and `--yes` for publish inside a devcontainer. Bridge protocol is
  now version 2.
- Rule and `context.sources` documents must be git-tracked, have a safe extension and are denied for
  local secrets (`.env*`, `.git/**`, `.npmrc`, `.revdeck.local.*`, keys). A tracked
  `.revdeck.local.yml` is ignored as a repository file. File reads verify the opened fd's realpath
  inside the repository, closing a parent-symlink TOCTOU.
- Feature note authors are set by the server: the bridge always writes `agent` notes and may change or
  delete only agent-authored notes; `notes.update` ignores server-only publication fields on the
  bridge.
- The checks confirmation in the UI shows the full argv; `revdeck checks` prints the commands before
  execution.
- Malformed Cookie headers and request targets now return `400` instead of terminating the daemon.
- Documentation (English and Russian) is updated for capabilities, bridge tokens, human-only checks,
  document policy, project management and the command reference.

### Changed

- Development dependencies: Vite 8.3.8 and Playwright Core 1.65.1. TypeScript 7.0.2 from the
  Dependabot development update is deferred: svelte-check 4.x requires TypeScript 5/6, so the bump
  would break `npm run typecheck`; it needs the dual TS6/TS7 `--tsgo` setup separately.

### Added

- `revdeck init --provider gitlab|github|auto`; generated configs now use the git-remote platform and
  fall back to `gitlab` when the host is not recognized (default for self-hosted GitLab).
- Project management in the UI: add a project from the projects home or switcher, edit its display
  title and working-copy roots, and delete a project with its cached reviews (`projects.update`,
  `projects.remove`, `/api/projects/update`, `/api/projects/remove`, `project` SSE event). Deleting
  never touches the platform.
- Command reference page (`#/help`): searchable CLI commands, examples, common flags and UI
  shortcuts with click-to-copy; reachable from the sidebar, the command palette and `h`.
- Brand assets: logo and icon variants in `docs/assets/brand`, a dark-mode README logo, a documentation index icon, UI favicon/Apple touch icons and the sidebar mark.

### Fixed

- The sidebar can be reopened from every view when it was collapsed before a review was selected;
  the floating menu button is no longer mobile-only.
- The projects header no longer leaves “Open review” on its own wrapped line: search and actions stay
  together, and the whole action group moves below the intro at narrow widths.

## [0.6.0] - 2026-11-16

### Added

- Cross-project features: human-created bundles of reviews with a Markdown brief/contract, roles and
  order (`features`, `feature_reviews`), combined read-only context, and feature UI (`#/features`,
  review badges, add-to-feature flow).
- Feature-scoped MCP sessions via `REVDECK_FEATURE`: only feature members are visible; drafts may be
  written to any member, while publishing remains per review and requires human approval.
- Feature-level contract (Markdown or OpenAPI): OpenAPI is parsed into operations, parameters,
  request bodies, responses and schemas; context marks which changed reviews mention each operation.
- Application profiles via `context.sources` / `context.maxBytes` in `.revdeck.yml`, included per
  project in the feature context.
- Feature notes/findings: stored on the feature, visible in UI/context, writable by humans and by an
  agent in a feature session (`revdeck_feature_note`); never published.
- Feature UI reorder (up/down) and delete, plus contract and notes editors.
- `revdeck_feature` MCP tool and `review-feature` prompt; `revdeck feature list|create|get|add|remove|context|update|archive|delete`.
- Capabilities and design documentation for features in English and Russian.
- Removing a tracked review that belongs to a feature is blocked until it is removed from the feature.
- Project separation: a `projects` registry with working-copy roots, a normalized
  `platform:host/project` key and a `reviews.project_key` column; existing databases are backfilled.
- Project switcher and projects home in the UI; the review queue is scoped to the selected project
  and the choice is kept in the URL and local storage.
- Project-scoped MCP server: it resolves the project from the repository root, lists only that
  project and rejects review ids/URLs from other projects. `REVDECK_ROOT` supports multi-root
  workspaces and devcontainers.
- `revdeck projects` and `revdeck projects add <path>`; `revdeck list --all` for a human-wide list.
- Project-isolation documentation (capabilities, architecture, protocol, configuration, integrations,
  threat model) in English and Russian.

### Fixed

- Config, rules and profile reads now resolve real paths and reject symlinked files or directories
  that escape the repository; all reads use `O_NOFOLLOW` for the final component.
- Feature notes written by an agent can only be updated/deleted by MCP when they were authored by an
  agent; human notes are read-only to MCP. Notes and profiles are quoted as data in feature context.
- Feature-context `maxBytes` is now a real cap (including brief, contract, profiles, notes and review
  sections); `context.maxBytes` is an aggregate per-project profile limit.
- A review URL from another configured project is rejected when opened from the wrong checkout.
- Feature member roles can be cleared; reorder rejects duplicate ids; up/down arrows move within the
  visible project group.
- UI navigation uses `pushState` for user transitions, ignores stale feature/review requests, resets
  feature-local forms when switching features, refreshes an open feature page on SSE, and exposes the
  sidebar on mobile project/feature pages.
- Feature badges and the active sidebar row use theme variables in dark mode.

### Changed

- Consolidated the daemon-first, project-scope and feature decision records into
  `docs/capabilities.md` / `docs/ru/capabilities.md`; the `docs/adr` directories were removed.
- Replaced the retired internal monorepo example with a neutral analytics-platform example and added
  tests for every example config.
- `revdeck list` and `revdeck status` default to the current repository's project; `--all` restores the
  previous global list.
- MCP `revdeck_open`, `revdeck_context` and the review tools no longer accept a working-copy `root` or
  project overrides; cross-project access is rejected unless it is opened through an explicit feature.

## [0.5.0] - 2026-11-13

### Added

- Analytics tab and `revdeck stats <N>` with accepted/rejected/pending findings, acceptance rate and
  rejected suggestions.
- Change groups (explicit `review.groups` or automatic by file kind/module) in Overview and context.
- Optional secret scan (`review.secrets`, `revdeck scan <N>`) with masked previews only.
- Optional review version history (`review.history`, `revdeck versions <N>`, Overview timeline).
- `.revdeck.local.yml` / `.revdeck.local.yaml` personal overrides with recursive merge, local array
  replacement, gitignore entries, and read-only escalation that cannot be disabled locally.
- Expanded built-in review roles and custom roles with title, description, criteria and instructions;
  role/shard context resolves them from the project config.
- `review.readOnly`: server-side ban on drafts, findings, comments, reactions, checks and publishing,
  with a UI banner and disabled publish action.
- Run configured checks from the Rules tab with explicit confirmation and per-check output; read-only
  reviews hide the runner.
- Batch review opening: `revdeck open 345 344 556` and an array input for `revdeck_open`; each review
  keeps its own agent group.
- Multi-agent review plan in `.revdeck.yml` (`review.agents`, `review.roles`) with role catalog, role/shard
  context via `revdeck context --role --shard` and MCP `role`/`shard`, plus lead/worker instructions in
  the skill.

## [0.4.6] - 2026-11-12

### Added

- A **Close thread** button in the thread card records the resolve intent and opens the publish
  confirmation, so a thread can be closed without hunting for the checkbox.

### Fixed

- Overview thread and line-comment paths truncate inside the card and have a copy button.

### Documentation

- Clarify that `rules.sources` takes exact document paths, not glob patterns.

## [0.4.5] - 2026-11-12

### Documentation

- Document why the rule-discovery warnings appear and how to remove them, plus MCP tool allowlists for
  Claude Code and Cursor.

### Fixed

- Long paths, URLs and headers no longer overflow cards: thread and line-comment paths truncate with a
  copy button, Markdown text wraps anywhere, and tables use fixed layout.

## [0.4.4] - 2026-11-12

### Fixed

- Thread and thread-comment reactions now appear immediately after the review loads or refreshes; the
  reaction list is written through Svelte's proxied review state instead of the raw snapshot.
- Sidebar review switches no longer lose the click to a background refresh: SSE/polling reloads are
  skipped while a review is loading, so the newly selected review always wins over the old one.

### Added

- Published findings start with a severity marker (🟥 blocker, 🟧 major, 🟨 minor, 🟦 question); the UI
  badges show the matching icon and color.

## [0.4.3] - 2026-11-12

### Fixed

- Text editing is no longer reset by background refreshes: SSE/polling updates are deferred while a
  text field has focus, thread draft responses do not overwrite newer input, and the agent reply on a
  line comment is now editable.

## [0.4.2] - 2026-11-12

### Added

- Remove a review from the local sidebar (the MR/PR on the platform is untouched).
- Copy a finding's file path from the card; long paths truncate with an ellipsis.
- A loading bar for review switches and a request guard so a slow older response cannot overwrite a
  newer review.

### Fixed

- Diff rows keep their colored background across the full horizontal scroll, including long code lines.
- Agent edits (summary, findings, replies, notes) reach the open UI immediately via SSE, with a 10-second
  polling fallback when SSE is unavailable.
- Devcontainer bridge permissions: `run`/`state` are `0755`, the bridge socket `0666`, `daemon.json`
  `0644`, while the private parent stays `0700`. The loopback HTTP server accepts
  `Host: host.docker.internal`, so macOS Docker Desktop works without `--host 0.0.0.0`. Missing
  `daemon.json` permissions and HTTP `Host` errors now produce distinct hints.
- `revdeck devcontainer --write` warns when it cannot find a repository MCP config for the
  user-level one.

### Documentation

- Added an explicit project rule: documentation is part of every change (`AGENTS.md`, `CONTRIBUTING.md`).
- Skills now ask for a short chat answer and put details in the summary/findings.

## [0.4.1] - 2026-11-12

### Fixed

- `revdeck daemon start --host` now warns when a daemon is already running and does not rebind;
  use `revdeck daemon restart --host 0.0.0.0`. `revdeck daemon install --host 0.0.0.0` writes the
  binding into the systemd unit / launchd plist.

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
- Docs: architecture, configuration, protocol, threat model and integrations.
- Tests: diff parser, core helpers, providers with recorded responses, service with a fake provider.
