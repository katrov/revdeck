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
- A multi-user server. The model is one user, several reviews, and a
  [daemon on the host](adr/0001-daemon-first.md).

## Components

```text
agent (MCP/CLI) ──▶ revdeck daemon ──glab/gh──▶ GitLab/GitHub
                         │
                   SQLite + UI ◀── human
```

- `src/core` — pure functions and models: unified diff parser, rules, finding fingerprints,
  [publication sanitizer](threat-model.md), secret redaction, safe process execution.
- `src/providers` — the only place that knows about platforms. `Provider` normalizes MR/PR, diff,
  threads, replies, resolution, and comment creation.
- `src/daemon/service.ts` — orchestrator: review refresh, drafts, decisions, publication plan,
  approval, idempotent writes, background sync.
- `src/daemon/store.ts` — SQLite (`node:sqlite`): reviews, diff/thread snapshot, drafts, findings,
  decisions, comments, approvals, audit.
- `src/daemon/rpc.ts` — [JSON-RPC](protocol.md) over a Unix socket (0600) for the CLI and MCP.
- `src/daemon/bridge.ts` — an additional RPC socket in a stable home-based directory for devcontainers.
- `src/daemon/http.ts` — UI and `/api/*`, SSE events, cookie session with a one-time token.
- `src/cli` — commands, `init`, `doctor`, export/import of the old file format.
- `src/mcp` — MCP server: tools and prompts, a thin wrapper over RPC.
- `ui` — Svelte 5 SPA, built into `dist/ui`.

## Data flow

1. `revdeck open 42` → RPC `reviews.open` with the working copy `root`.
2. The daemon determines the platform/host/project (arguments → config → git remote), creates a
   provider, reads the MR, diff, and threads, and saves a snapshot and synthetic drafts.
3. The agent requests `revdeck_context`: the daemon assembles effective rules (documents and sections
   for changed paths), snippets, threads, and findings.
4. The agent writes drafts (`drafts.put`, `findings.put`, `summary.put`, `notes.update`).
5. A human in the UI calls `publish.preview` → sees the exact plan and hash → `publish.approve` →
   `publish.commit`. The daemon executes only the items included in the approved plan.
6. Background sync every 2 minutes refreshes open reviews and broadcasts SSE events to the UI.

## Data model

- `ReviewRef` — platform, host, project, number. `reviewId` — `platform:host/project!number`.
- `DiffFile`/`Hunk`/`DiffLine` — line numbers in the old and new versions; a finding's `line` always
  refers to the new file.
- `Thread`/`Note` — shared discussion model.
- `Finding` — a review finding with `id`, `fingerprint`, severity, file/line, text, and status
  (`draft`, `accepted`, `rejected`, `published`, `fixed`, `stale`).
- `Approval` — a one-time id tied to `hash = sha256(canonicalJson({reviewId, kind, items}))`,
  with a 10-minute TTL.

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
- **Checks**: `checks` with argv, no shell; run only on explicit confirmation.

## Performance

- The diff is parsed on the server; the UI receives files as a list and hunks one file at a time.
- Review state does not contain the full diff; SSE reports changes and the UI refetches the state.
- Snippets for threads and findings are computed on the server and size-limited.
- Rule context size is controlled by `rules.maxDocumentBytes` and `rules.maxTotalBytes` (`0` =
  unlimited); MCP context can additionally be capped by the `max_bytes` parameter.
