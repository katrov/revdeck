# Protocol

[English](protocol.md) | [Русский](ru/protocol.md)

## Transports

1. **Unix socket** (primary): `$XDG_RUNTIME_DIR/revdeck/daemon.sock`, directory 0700, socket 0600.
   JSON lines, one request/response per line.
2. **HTTP**: `POST /api/rpc` on loopback with a cookie session. Needed for containers where the socket
   is not forwarded (`REVDECK_URL` + `REVDECK_TOKEN`).
3. **UI HTTP**: `/api/*` and SSE `/api/events` for the browser.

## Messages

Request:

```json
{"id": 1, "method": "reviews.get", "params": {"review": "gitlab:gitlab.com/group/project!42"}}
```

Response:

```json
{"id": 1, "result": {"review": {"id": "...", "info": {}, "threads": []}}}
```

Error:

```json
{"id": 1, "error": {"message": "...", "code": "APPROVAL", "hint": "..."}}
```

`id` is a number. A connection is considered untrusted until the first successful request:
authorization is enforced by the socket file's permissions.

## Methods

| Method | Parameters | Result |
|---|---|---|
| `ping` | — | version, protocol, pid |
| `reviews.list` | — | saved reviews |
| `reviews.remoteList` | `root`, `scope`, `limit` | open reviews from the platform |
| `reviews.open` | `root`, `input`/`platform`/`project`/`host`/`branch` | review snapshot |
| `reviews.refresh` | `review` | refreshed snapshot |
| `reviews.get` | `review`, `refresh?` | snapshot (without the full diff) |
| `diff.get` | `review`, `file` | file hunks |
| `drafts.put` | `review`, `threadId`, `patch` | draft |
| `findings.put` | `review`, `findings[]` | findings after merge |
| `findings.list` | `review` | findings |
| `summary.put` | `review`, `summary` | summary |
| `decisions.put` | `review`, `decisions` | human decisions |
| `notes.add` | `review`, `file`, `line`, `text`, `toAgent` | line comment |
| `notes.update` | `review`, `noteId`, `patch` | updated comment |
| `reactions.list` | `review`, `noteIds[]` | reactions grouped by comment id |
| `reactions.toggle` | `review`, `noteId`, `emoji` | `active`, fresh reactions |
| `notes.delete` | `review`, `noteId` | `{ok}` |
| `publish.preview` | `review`, `kind`, `ids[]` | plan + warnings |
| `publish.approve` | `review`, `kind`, `ids[]`, `hash` | `approvalId`, `expiresAt` |
| `publish.commit` | `review`, `approvalId` | per-item results |
| `rules.get` | `review` | rules markdown, checks, warnings |
| `checks.run` | `review`, `allowRun`, `ids[]` | check results |
| `audit.tail` | `limit` | latest actions |

## Approval

1. `publish.preview` builds `items` — the exact bodies, paths, lines, and resolve flags — and
   `hash = sha256(canonicalJson({reviewId, kind, items}))`.
2. The human sees the plan. `publish.approve` recomputes the plan from the same `ids`; if the hash does
   not match, it returns an error. Otherwise it creates a one-time `approval_id` with a 10-minute TTL.
3. `publish.commit` verifies that the approval has not been used and has not expired, marks it as used,
   and executes only `items`. Items that have already been posted are skipped.

The agent cannot call `publish.approve`: the MCP tool does not expose it. A human confirms in the UI or
in the CLI with `--yes`.

## HTTP API (UI)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | SPA; `?t=<token>` sets the cookie and redirects |
| GET | `/assets/*` | static build assets |
| GET | `/api/health` | liveness |
| GET | `/api/reviews` | review list |
| GET | `/api/state?review=` | snapshot for the UI |
| GET | `/api/diff?review=&file=` | file hunks |
| GET | `/api/rules?review=` | rules |
| GET | `/api/events` | SSE: `review` |
| POST | `/api/reviews/open`, `/api/reviews/refresh` | open/refresh |
| POST | `/api/drafts`, `/api/findings`, `/api/summary`, `/api/decisions` | drafts |
| POST | `/api/notes` | `action: add/update/delete` |
| GET | `/api/reactions?review=&notes=` | reactions for comment ids |
| POST | `/api/reactions` | toggle a reaction |
| POST | `/api/publish/preview`, `/approve`, `/commit` | publishing |
| POST | `/api/checks` | checks |
| POST | `/api/rpc` | RPC proxy for the HTTP transport |

## Versioning

`PROTOCOL_VERSION` in `src/version.ts` is checked during the handshake; the client and daemon must be
the same package version. A method mismatch returns `METHOD` with a hint to update revdeck.
