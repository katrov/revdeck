# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.1] - 2026-11-23

### Added

- MR list navigation: opening a preview or review from the Open MRs/PRs page adds a clickable
  breadcrumb. Returning restores the list filters and scroll position.

### Changed

- Documentation screenshots refreshed to the current UI, including the MR list, settings and review
  overview.

## [0.12.0] - 2026-11-23

### Added

- The UI now has an "Open MRs/PRs" page across registered projects with scope, project, text,
  author, target-branch and draft filters. Each row opens the read-only preview or creates a review.
- Added an interface theme switch: follow the system, force light, or force dark; the choice is
  stored in `localStorage`.
- Moved theme, language and command-reference entry points to a separate Settings page. The sidebar
  can hide the Features section; the choice is stored in `localStorage` and can be changed back in
  Settings.

### Fixed

- Review warning banners keep vertical spacing above and below the group, including the conflict
  banner, instead of sticking to the tabs.

## [0.11.0] - 2026-11-20

### Added

- Added MR/PR preview without creating a review: `POST /api/previews/open` fetches info, diff and
  threads into a 60-minute in-memory cache, the UI route `#/view/<ref>` is read-only, and the Diff tab
  is served from `/api/diff` against the preview cache. The open-review dialog has a "Preview only"
  action. Previews do not appear in the review list or quality metrics.
- Added an append-only `review_events` log and project-level quality metrics: acceptance,
  publish and rule-grounded rates, coverage completeness, time to first finding, review cycle,
  actor/event counts, and review merge/close transitions. Findings can carry an optional `rule`
  reference, and `ReviewInfo` now keeps `mergedAt`/`closedAt`.
- Review context now includes a conservative `risk` profile (`low`/`medium`/`high`, `fast`/`full`
  mode) and the UI shows a fast/full badge. The review procedure has a short fast pass for small,
  non-sensitive diffs; auth, migrations, CI, public contracts, lockfiles and large diffs force the full
  pass.
- `ReviewSummary` now carries `coverage`, `unknowns`, skipped `duplicates` and `ruleCandidates`. The
  summary card and agent context show what was actually checked and what could not be checked, so
  "no findings" is distinguishable from "not checked"; duplicates and rule gaps feed the project
  metrics.
- New findings of level `blocker` or `major` require a non-empty `body`; a title and comment alone are
  rejected as insufficient evidence. Existing findings remain re-saveable without a body.
- The Overview tab has an "Ask the agent" composer. Review-level questions are stored as
  `agentMessages`, shown in the agent context, and answered with the new `revdeck_messages` MCP tool
  (`revdeck messages <N> reply --as-agent --text ...` in the CLI). Messages are private to revdeck and are never
  published to the platform.
- Reviews now keep their merge context: `ReviewInfo.merge` carries the target branch, the diff
  base/head, and the platform merge state (`clean`, `conflict`, `behind`, `unknown` or `unavailable`).
  GitLab uses `has_conflicts`/`merge_status`/`detailed_merge_status`, GitHub uses
  `mergeable`/`mergeable_state`. The agent context and the UI show a "Branch and comparison base"
  section/banner, and the review skill requires checking it before reporting that there are no
  findings.

### Fixed

- Mergeability no longer treats GitLab non-ready statuses or GitHub `blocked`/`unstable`/`draft` as
  clean; `need_rebase` remains `behind`.
- Re-saving a legacy `blocker`/`major` finding without `body` works again; the body requirement now
  applies only to new findings.
- Quality metrics are scoped by the selected date range and sync time, and the event log no longer
  records every background heartbeat.
- Preview refresh bypasses the in-memory cache, keeps the selected file, and a failed preview no
  longer leaves the previous review on screen.
- Removed preview/review state leaks: opening a real review from preview clears the preview mode, and
  read-only previews hide the remaining thread editor and version-history remnants.

## [0.10.0] - 2026-11-19

### Added

- Threads and Findings are virtualized when a review has more than 30 items. The list measures pages
  of 10 cards and renders only the pages intersecting the scroll container plus one page of overscan;
  focused cards stay mounted, and deep links scroll to the target page. Small reviews keep the previous
  full render.

### Performance

- Opening an already-synced review no longer waits for `glab`/`gh`: `/api/state` returns the cached
  snapshot immediately and refreshes a stale one in the background, with the update delivered over
  SSE. The UI also caches the last four review states for instant switching. Snapshot reads, thread
  and finding snippets are now built once per view, and a one-entry snapshot cache avoids reparsing
  a large diff on every request. Background reloads merge into the current review instead of replacing
  it, so the Rules, Analytics and Diff tabs no longer restart their loaders on every SSE/poll tick.
- SSE now sends a named heartbeat and the UI only falls back to polling after 35 seconds without one;
  review, feature and project events reload only their own scope instead of every list, and project,
  review, feature, feature-detail and reaction lists are compared before assignment so an unchanged
  list does not re-render the sidebar or feature pages.

## [0.9.0] - 2026-11-19

### Added

- Explicit scenario entry points: `revdeck review <N|URL>` for someone else's MR and
  `revdeck feedback <N|URL>` for your own, matching `/revdeck review|feedback` in harness commands.
  `revdeck context --scenario review|feedback` and the MCP tool `revdeck_context` with
  `scenario=review|feedback` carry the same choice into the agent context; `revdeck open` stays neutral
  and prints the matching next command when the platform user and the MR author are known. Context
  marks whether the MR belongs to you and returns `scenario` / `suggestedScenario` in JSON and MCP
  structured content.
- `revdeck init` now upgrades a harness command file that still matches the previously generated
  template, so existing projects get the `review`/`feedback` router. A customized command file is left
  alone.

### Changed

- `revdeck review` is the explicit "someone else's MR" command instead of an undocumented alias of
  `revdeck context`. The context content, flags, RPC methods and stored reviews are unchanged.

## [0.8.1] - 2026-11-18

### Fixed

- `revdeck devcontainer --write` now writes `REVDECK_HOST_ROOT` as `${localWorkspaceFolder}` instead
  of a `${localEnv:HOME}`-relative path. Each developer's devcontainer tooling expands the variable
  to their own checkout, so the shared `devcontainer.json` no longer contains a user-specific path
  that breaks colleagues who clone into another folder. A Windows host path (`C:\...`) from Docker
  Desktop is passed to the daemon without POSIX normalization.

## [0.8.0] - 2026-11-18

### Changed

- Server typechecking runs on the TypeScript 7 native compiler (`typescript-7` npm alias,
  `typecheck:server`). `svelte-check` still requires TypeScript 5/6 as a peer, so the project keeps
  `typescript@6` for the UI checker; `npm run typecheck` runs both.

### Fixed

- Devcontainer path mapping: `revdeck devcontainer --write` records `REVDECK_HOST_ROOT` (the host
  working-copy path as a `${localEnv:HOME}` expression) in `containerEnv` and `remoteEnv`. The CLI and
  MCP server in the container map their worktree path to the host path before `reviews.open`,
  `reviews.remoteList` and `projects.register`, so the host daemon reads `.revdeck.yml`, rule
  documents, checks and local diff bases instead of falling back to auto-discovery. Reviews opened
  before the mapping keep the old root and must be reopened; a config root that is not visible to the
  reader now produces an actionable warning. `revdeck eject` removes the variable and the help/docs
  describe the mapping.

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
