# Capabilities and design decisions

[English](capabilities.md) | [Русский](ru/capabilities.md)

This document is the single, current description of what revdeck can do and why the product is built
this way. It also records the decisions behind the daemon-first architecture, project scopes and
cross-project features.

## Product model

revdeck is a local, agent-first code review tool for GitLab and GitHub. One user runs one daemon on the
host; agents, the CLI and the browser UI are clients.

```text
agent (MCP/CLI) ──unix socket──▶ revdeck daemon ──glab/gh──▶ GitLab / GitHub
                                      │
                                SQLite + Svelte UI ◀── human
```

The core guarantees:

- **The human publishes.** Agents write drafts (summaries, findings, replies, line comments). A human
  approves the exact plan in the UI or CLI on the host; the daemon then posts it. The devcontainer
  bridge has no `publish.approve`/`publish.commit` (`CAPABILITY`), so an agent cannot create an approval.
- **Tokens stay on the host.** The daemon calls `glab`/`gh`; platform tokens are not passed over RPC
  and are scrubbed from child environments.
- **Project rules are explicit.** For changed paths revdeck selects repository documents and exact
  sections (`AGENTS.md`, architecture, style guides, ADRs).
- **One local database.** Reviews, projects, features, drafts, approvals and audit live in SQLite in
  the user's state directory.
- **Agent work is review-only.** Checks are planned by the agent and run by a human in the UI or the
  host CLI; the bridge denies `checks.run`. Publishing, resolving and approvals remain human actions.

## Reviews

- GitLab MR and GitHub PR are normalized into one model: ref, description, author, state, branches,
  commits, diff, threads, notes and reactions.
- Open a review by number, URL, project reference or the current branch; multiple reviews can be
  opened in one call.
- Local triage queue with cached snapshots; background sync and SSE keep the UI fresh. The UI opens a
  review from the cached snapshot immediately; a stale snapshot is refreshed in the background, so
  opening never waits for `glab`/`gh`. Background reloads merge into the current review, so tab loaders
  such as Rules, Analytics and Diff are not restarted on every SSE/poll tick. SSE heartbeats gate the
  polling fallback, and review, feature and project events reload only their own scope.
- The review header collapses on downward scroll and smoothly returns on upward scroll; section tabs
  remain visible. The same content-scroll pattern is used where a large page header is present.
- The UI has a cross-project Open MRs/PRs page with client-side scope/search/author/target/draft
  filters; it uses the existing `reviews.remoteList` per registered project and can open either the
  read-only preview or a full review. Opening from the list records the origin, so preview/review
  show a clickable breadcrumb; returning restores filters and scroll.
- Theme, interface language, command reference and Features-section visibility live on a separate
  Settings page; theme and visibility are stored locally.
- Read-only MR/PR preview: `POST /api/previews/open` fetches info, diff and threads into a short-lived in-memory
  cache; the preview route hides findings, comments, reactions and publishing, and never creates a
  review record or metrics event.
- Project-level quality metrics are computed from an append-only `review_events` log: acceptance,
  publish and rule-grounded rates, coverage completeness, time to first finding, review cycle, duplicates/rule candidates and
  actor counts. Findings may carry a `rule` reference; review events include opened/synced, summary,
  findings, decisions, publish and checks.
- Review context carries a conservative risk profile (`low`/`medium`/`high`, `fast`/`full`) derived from
  the changed paths and diff size. The summary records `coverage` and `unknowns`, so an empty findings
  list is not mistaken for a fully checked review.
- Reviews keep their merge context: target branch, diff base/head and platform mergeability
  (`clean`/`conflict`/`behind`/`unknown`/`unavailable`). Context and UI surface conflicts or a branch
  behind target before the agent draws conclusions.
- Threads and findings are virtualized above 30 cards: measured pages of 10 render only when visible,
  focused cards stay mounted, and deep links scroll to the target page.
- Unified diff with per-file hunks, line numbers in old/new versions, changed-file filters and
  viewed-state per review. Files are grouped into a collapsible folder tree that can be hidden or
  resized, and hidden unchanged lines around hunks expand in place (10 lines at a time or all at
  once); the full file is served from the local commit or the platform raw API.
- Threads: read, reply, resolve, react; line comments from the human; reactions on MR/PR and notes.
- Edit and delete your own platform comments.
- Attachments: upload raster images and videos to GitLab project uploads and insert a markdown link;
  GitHub attachments are not supported by its public API.
- Review summary, findings with severity (`blocker`/`major`/`minor`/`question`), stable finding ids,
  decisions (`accept`/`reject`/`discuss`), private agent notes and publish status.
- Multi-agent review roles and shards (`review.agents`, `review.roles`, custom roles); the daemon
  stores the lead's merged result.
- Analytics: accepted/rejected/pending findings, acceptance rate, threads, drafts, rejected
  suggestions.
- Optional secret scan with masked previews only.
- Optional review version history by head/base SHA.
- Change groups: explicit or derived by file kind/module.
- Project checks: argv, path scoping; the agent only plans, a human runs them in the UI or host CLI with the full command shown.
- Read-only reviews: drafts, findings, comments, reactions, checks and publishing are disabled.
- Export/import of the legacy file format.

## Agent interfaces

- **MCP server** over stdio with tools for status, list, open, context, threads, diff, rules, draft
  replies, draft findings, summary, line notes, review messages to the agent, feature context/notes,
  publish preview and publish.
- **CLI** with the same capabilities for harnesses without MCP.
- **Explicit scenario entry points**: `revdeck review` / `revdeck feedback` and `/revdeck review|feedback`
  fix "someone else's MR" or "your own MR" before the agent starts. `revdeck_context` takes
  `scenario=review|feedback`; `revdeck open` stays neutral and suggests the matching command. Context
  carries `scenario` and `suggestedScenario` and marks whether the MR belongs to the current user.
- **Skill** (`skills/revdeck`) carrying the review procedure, criteria, feedback workflow and
  cross-project feature workflow.
- MCP prompts `review-mr`, `close-feedback` and `review-feature`; they mirror the `review`, `feedback`
  and feature commands.
- Context is deterministic and size-limited: summary, changed files, effective rules, threads,
  findings, drafts and next actions.
- The agent cannot publish, resolve threads, approve/merge or call platform CLIs directly.
- Publication requires an approval bound to a hash of the exact plan; `publish.commit` is idempotent
  and skips already-posted items.

## Projects

A project is a repository, not a "frontend" or "backend" kind.

- Stable key `platform:host/project`, normalized for comparison; display values are kept separately.
- Project registry and working-copy roots (`projects`, `project_roots`); one project can have several
  clones/worktrees.
- Reviews carry `projectKey`; the UI, HTTP API and CLI can filter by project or working-copy root.
- `revdeck projects` lists projects, roots and review counts; `revdeck projects add <path>` registers a
  project before its first review.
- The UI has a project switcher and a projects home; only the selected project's reviews are shown.
  The selection is stored in the URL and local storage. The projects home can add a project, edit its
  display title and working-copy roots, and delete the project with its cached reviews. Deletion never
  touches MRs/PRs or comments on the platform.
- An MCP server is scoped to the repository it runs in: status/list/open only see that project, and a
  review id or URL from another project is rejected. `REVDECK_ROOT` supports multi-root workspaces.
- Devcontainers mount a stable bridge to the host daemon; the container never starts its own daemon.
- Cross-project work is possible only through an explicit feature.

## Features

A feature is a human-created bundle of reviews from one or more projects. It is not a project and not
a permanent project link; a project appears in a feature while at least one of its reviews is a member.

- Title, Markdown brief (goal, non-goals, rollout order, acceptance criteria), separate Markdown or
  OpenAPI contract, status (`open`/`archived`).
- Ordered reviews with free-form roles (`api`, `ui`, `worker`, `mobile`); several reviews from one
  project are allowed.
- **OpenAPI contract:** parsed into operations, parameters, request bodies, responses and schemas. The
  feature context marks which changed reviews mention each operation path.
- **Application profiles:** `context.sources` / `context.maxBytes` in each repository; included once
  per project as background, never as review criteria.
- **Feature notes/findings:** cross-project notes stored on the feature, visible in the UI and context.
  They are never published. Humans write them in the UI/CLI; an agent may write them only in a feature
  session through `revdeck_feature_note`, and may change/delete only notes authored by an agent.
  Note and profile text is treated as data, not instructions.
- **Project session:** sees its project and features that include it; may read the combined feature
  context, but writes drafts only in its own project.
- **Feature session:** started explicitly with `REVDECK_FEATURE=<id>`. The current repository must be a
  member; the scope covers only members. Drafts may be written to any member. Publishing remains per
  review and requires human approval. Feature notes may be written.
- Feature membership is revalidated on tool calls: removing the current project/review revokes access.
- Combined context contains the brief, parsed contract or raw Markdown, application profiles, feature
  notes, an overview matrix and one section per review with its own project rules. Rules are never
  merged; the budget is split across reviews.
- UI: feature list, feature page with project groups, roles, contract, notes, context preview, agent
  command, archive, delete, reorder and add-review flows.
- CLI: `revdeck feature list|create|get|add|remove|reorder|notes|note|note-delete|context|update|archive|delete`.
- MCP: `revdeck_feature` (read-only list/get/context/notes) and `revdeck_feature_note` (feature session
  only, never published).
- Removing a tracked review that belongs to a feature is blocked until it is removed from the feature.
- There is no feature-level publish; findings and summaries belong to their reviews.

## User interface

- Local Svelte 5 SPA served by the daemon with a launch token (rotated with the daemon) and cookie session.
- Project switcher, projects home (add/edit/delete project), feature list and feature page.
- Review tabs: Overview, Threads, Findings, Diff, Rules, Analytics.
- Keyboard shortcuts (`1`–`5`, `o`, `r`, `s`, `p`, `?`, `h`), command palette, deep links to threads,
  findings and diff lines with browser Back/Forward.
- Command reference page (`#/help`): searchable CLI usage, common flags and UI shortcuts, with
  click-to-copy commands. Reachable from the sidebar and by `h`.
- Markdown preview, attachment button, reactions, line comments, publish dialog with exact plan.
- Russian and English interface; language is independent from the language of review output.
- Settings choose the theme, interface language, Features visibility and auto-refresh interval
  (off/10/30/60 min, default 10 min). Auto-refresh runs the same forced refresh as the header button while a review or
  preview is open; ticks are skipped in background tabs, while typing and with open dialogs, and the
  countdown restarts after any manual refresh.
- Responsive sidebar and mobile backdrop; dark/light theme via CSS variables.

## Security and trust

- Unix socket with `0700` directory and `0600` socket; loopback UI only; `Host`/`Origin` checks,
  `HttpOnly` `SameSite=Strict` cookie, CSP.
- The devcontainer bridge is agent-scoped (`read`/`draft`): `publish.*`, `checks.run`, decisions,
  platform writes and feature/project administration return `CAPABILITY`. The UI token is not mounted
  into the container.
- Rule and profile documents must be git-tracked, have a safe extension and are denied for local
  secrets (`.env*`, `.git/config`, `.npmrc`, `.revdeck.local.*`, keys); reads verify the opened fd's
  realpath to close symlink TOCTOU.
- Platform CLI calls without a shell, outside the working copy, with a scrubbed environment; secrets
  redacted in logs and errors.
- MR text, comments and diff are untrusted data; the skill and context say so.
- Comment sanitizer blocks HTML, control/bidi characters, GitLab quick actions and mass mentions;
  external images are links, not loads.
- Approvals are random, single-use, TTL-bound and tied to the review and plan hash.
- Project and feature scopes are **context isolation**, not a security boundary: one daemon and one
  database remain. The bridge limits writes, but read methods still see the local database; a process
  with access to the user's home can read it.
- Hard isolation would require a separate daemon/state directory under another user/container; that is
  outside the current model and breaks cross-project review.

## Configuration

`.revdeck.yml` (or `.revdeck.yaml`) at the repository root, with personal `.revdeck.local.yml`
overrides:

- `version`, `provider` (`type`, `host`, `project`, `base`), `output.language`.
- `review`: agents, roles, custom roles, groups, secrets, history, readOnly.
- `context`: application-profile sources and `maxBytes`.
- `rules`: sources, path map, ignore, document/total limits.
- `checks`: id, name, argv, path conditions, consent, timeout.
- `publish`: approval requirement, max comments.

Explicit CLI arguments override config, config overrides the git remote; this prevents redirecting a
review by tampering with `.git/config`. The schema is validated by zod and unknown fields fail with a
path.

## Operations

- `revdeck init`: config, skill, harness adapters and MCP config; idempotent, never overwrites foreign
  keys.
- `revdeck eject`: inverse operation; plan by default, `--yes` to apply, `--keep-config` to keep the
  config.
- `revdeck doctor`: Node, git, `glab`/`gh` auth, daemon, adapters; knows about devcontainers.
- Daemon lifecycle: start/stop/restart/status/logs/install/uninstall; systemd user unit on Linux,
  launchd on macOS.
- Devcontainer bridge: stable socket/state mounts; host-side `glab`/`gh`; no daemon in the container.
- HTTP transport for containers where the socket is not forwarded (`REVDECK_URL`, `REVDECK_TOKEN`).
- Export/import for sandboxes without a socket.
- Linux and macOS autostart; Windows runs manually.

## Architecture decisions

### Daemon-first

A long-lived user-owned daemon holds credentials, SQLite, providers, RPC, HTTP/SSE and the UI. CLI and
MCP are thin clients. The alternative — an MCP process per session without a daemon — was rejected
because the UI would not survive the session, agents would compete for state, tokens would end up in
the agent process and containers would still need a host process. File exchange remains only as
`export`/`import`.

Consequences: daemon lifecycle, socket permissions, a bridge for containers, version-matched clients,
background sync and SSE. One daemon serves several repositories; `root` is passed on open and config is
read from that root. A devcontainer client passes the host worktree path (`REVDECK_HOST_ROOT`) instead
of the container mount path, so the host daemon reads the project config and rules.

### Project scopes

A project is a repository. The key is `platform:host/project`; reviews carry it and the daemon keeps a
registry with working-copy roots. The UI and CLI are project-scoped; the MCP server is scoped to the
repository it runs in. A per-project daemon/database was rejected: it breaks cross-project review,
adds ports/services/backups and is still not a security boundary against the same user.

Consequences: migration/backfill, project-scoped MCP errors, multi-root workspace configuration, and
explicit context-only isolation.

### Explicit features

Because projects are isolated, cross-project work needs an explicit human-created feature. The feature
is the only door: membership is chosen per task; project sessions read the combined context but write
only in their project; a feature session may write across members, with per-review publishing. A
permanent project link or automatic cross-project discovery was rejected because it leaks contexts into
unrelated tasks.

Consequences: feature notes are non-published, contracts and profiles are human-provided, feature
sessions are explicit, and removing membership revokes access on the next tool call.

## Non-goals and limitations

- Replacing the native GitLab/GitHub diff viewer; the UI is for triage and approval.
- Built-in static analysis; checks are delegated to the project's tools.
- A multi-user server or role-based authorization.
- Hard security isolation between projects; see the caveat above.
- Native draft notes/pending reviews (providers are ready, publishing uses regular comments).
- GitHub attachment upload via public API.
- Automatic OpenAPI-based static validation of client code: the contract is parsed and given to the
  agent; the agent validates the implementation.
- Feature-level publishing or automatically publishing a whole feature.
- Source checkout of other repositories in a feature context: only review data, profiles and contracts.
