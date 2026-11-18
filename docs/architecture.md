# Architecture

[English](architecture.md) | [Русский](ru/architecture.md)

## Goals

1. The agent receives review context and project rules deterministically, without manual files and
   without access to platform tokens.
2. Publishing to GitLab/GitHub happens only after human approval and is idempotent.
3. One tool works in any harness: MCP for agent clients, the CLI as the universal layer, and a web UI
   for humans.
4. Project rules are [configured](configuration.md), not hardcoded in the prompt.

## Non-goals

- Replacing GitLab/GitHub's native diff viewer. The UI is optimized for triage and approval.
- Built-in static analysis. Checks are delegated to the project's linter, types, and tests.
- A multi-user server. The model is one user, several repositories and reviews, and a
  [daemon on the host](capabilities.md#daemon-first).

## Components

```text
agent (MCP/CLI) ──▶ revdeck daemon ──glab/gh──▶ GitLab/GitHub
                         │
                   SQLite + UI ◀── human
```

- `src/core` — pure functions and models: project identity and keys, unified diff parser, rules, finding fingerprints,
  [publication sanitizer](threat-model.md), secret redaction, safe process execution.
- `src/providers` — the only place that knows about platforms. `Provider` normalizes MR/PR, diff,
  threads, replies, resolution, and comment creation.
- `src/daemon/service.ts` — orchestrator: review refresh, drafts, decisions, publication plan,
  approval, idempotent writes, background sync.
- `src/daemon/store.ts` — SQLite (`node:sqlite`): projects and their roots, reviews, diff/thread snapshot,
  drafts, findings, decisions, comments, approvals, audit.
- `src/daemon/rpc.ts` — [JSON-RPC](protocol.md) over a Unix socket (0600) for the CLI and MCP.
- `src/daemon/bridge.ts` — an additional agent-scoped RPC socket in a stable home-based directory for devcontainers (no publish/checks/admin, no UI token).
- `src/daemon/http.ts` — UI and `/api/*`, SSE events, cookie session with a launch token (not mounted into containers).
- `src/cli` — commands, `init`, `doctor`, export/import of the old file format.
- `src/mcp` — MCP server: tools and prompts, a thin wrapper over RPC.
- `ui` — Svelte 5 SPA, built into `dist/ui`.

## Data flow

1. `revdeck open 42` → RPC `reviews.open` with the working copy `root`; the project is resolved from the config/remote and registered.
2. The daemon determines the platform/host/project (arguments → config → git remote), creates a
   provider, reads the MR, diff, and threads, and saves a snapshot and synthetic drafts.
3. The agent requests `revdeck_context`: the daemon assembles effective rules (documents and sections
   for changed paths), snippets, threads, and findings.
4. The agent writes drafts (`drafts.put`, `findings.put`, `summary.put`, `notes.update`).
5. A human in the UI or host CLI calls `publish.preview` → sees the exact plan and hash →
   `publish.approve` → `publish.commit`. The bridge has no approve/commit (`CAPABILITY`); the daemon
   executes only the items included in the approved plan.
6. Background sync every 2 minutes refreshes open reviews and broadcasts SSE events to the UI.

## Data model

- `Project` — a repository: `key = platform:host/project` (normalized for comparison), display values,
  and one or more working-copy roots. Reviews carry the same `projectKey`.
- `Feature` — an explicit bundle of reviews with a brief, contract and notes; `FeatureReview` adds a
  role and order; `FeatureNote` holds non-published cross-project notes/findings.
- `ReviewRef` — platform, host, project, number. `reviewId` — `platform:host/project!number`.
- `DiffFile`/`Hunk`/`DiffLine` — line numbers in the old and new versions; a finding's `line` always
  refers to the new file.
- `Thread`/`Note` — shared discussion model.
- `Finding` — a review finding with `id`, `fingerprint`, severity, file/line, text, and status
  (`draft`, `accepted`, `rejected`, `published`, `fixed`, `stale`).
- `Approval` — a one-time id tied to `hash = sha256(canonicalJson({reviewId, kind, items}))`,
  with a 10-minute TTL.

## Projects and isolation

One daemon serves several repositories. A **project** is one repository, identified by
`platform:host/project`; a review stores its project key and its own working-copy root. The daemon
registry (`projects`, `project_roots`) is populated when a review is opened or when a project is
registered explicitly (`revdeck projects add <path>`).

- The UI selects one project at a time: a switcher, a projects home, and a review queue scoped to the
  selection. The selection is kept in the URL and in local storage. The projects home registers a
  working copy, edits the display title and roots, and deletes a project with its cached reviews;
  project deletion never calls the platform.
- The MCP server is the isolation point. It resolves its project from `REVDECK_ROOT` (or the current
  directory), lists only that project, and rejects review ids/URLs from other projects. The agent gets
  no `root` or project overrides.
- `reviews.list` accepts `project` or `root`; this is a filter for the UI/CLI, not a security boundary.
  One daemon and one database remain; a process with access to the user's home can read the database.
- Cross-project work is not implicit. A human-created feature links reviews from several projects; a
  foreign review is rejected outside it. See [capabilities](capabilities.md#project-scopes) and [Features](#features).

## Features

A **feature** is a human-created bundle of reviews across projects. It is not a project and not a
permanent project link: projects appear in it only while at least one of their reviews is a member.
The `features` table holds the title, Markdown brief, a separate Markdown/OpenAPI contract, status
and human/agent feature notes; `feature_reviews` holds membership, a free-form role and order. Several
reviews from one project are allowed. OpenAPI contracts are parsed into operations and schemas, and
the context marks which changed reviews mention each operation. Application profiles are background
documents declared in `context.sources` of each repository (`context.maxBytes` caps them).

- The UI and CLI create/edit features; MCP exposes read-only discovery/context and, in a feature session,
  `revdeck_feature_note` for agent-authored notes (never published).
- A **project session** sees features that include its project, may read the combined context, and
  writes only in its project.
- A **feature session** is explicit (`REVDECK_FEATURE=<id>`): the current repository must be a member,
  the scope covers only members, and drafts may be written to any member. Publishing remains per
  review and requires human approval.
- The combined context contains the brief, the contract (parsed OpenAPI or raw Markdown), application
  profiles, feature notes, an overview matrix and one section per review with its own project rules.
  Rules are never merged. The budget is split across reviews.
- There is no feature-level publish. Findings and summaries belong to reviews; feature notes/findings
  are a non-published cross-project scratchpad. The feature aggregates reviews for navigation. See
  [capabilities](capabilities.md#features).

## Idempotency and concurrency

- Draft and finding writes go through a single process; SQLite in WAL mode.
- Publication marks the approval as used before execution. Items that have already been posted
  (matching `posted`, `published`) are skipped. A failure of one item does not cancel the others and
  is recorded in the draft/finding.
- The plan hash protects against agent edits between the moment the plan is shown to the human and
  publication: text changed → hash mismatch → approval rejected.
- `findings.put` — replaces the set while preserving `id` and decision; findings that disappear are
  marked `stale` rather than deleted.

## Extension

- **New platform**: implement `Provider` and add a branch in `createProvider`; nothing else changes.
- **New harness**: `revdeck init --adapters <name>` writes the MCP config or command file and links the
  canonical `.agents/skills/revdeck` skill.
  Harnesses without MCP use the CLI.
- **Rules**: `rules.map`/`rules.sources` in `.revdeck.yml`; rule packs can be distributed as a regular
  configuration file.
- **Checks**: `checks` with argv; the agent only plans, a human runs them in the UI or host CLI;
  the bridge denies `checks.run`.

## Performance

- The diff is parsed on the server; the UI receives files as a list and hunks one file at a time.
- Review state does not contain the full diff; SSE reports changes and the UI refetches the state.
- Snippets for threads and findings are computed on the server and size-limited.
- Rule context size is controlled by `rules.maxDocumentBytes` and `rules.maxTotalBytes` (`0` =
  unlimited); MCP context can additionally be capped by the `max_bytes` parameter.
