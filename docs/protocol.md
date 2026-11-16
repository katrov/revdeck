# Protocol

[English](protocol.md) | [Русский](ru/protocol.md)

## Transports

1. **Unix socket** (primary): `$XDG_RUNTIME_DIR/revdeck/daemon.sock`, directory 0700, socket 0600.
   JSON lines, one request/response per line.
2. **Devcontainer bridge socket**: `~/.local/state/revdeck/devcontainer/run/daemon.sock`, the same
   protocol on a stable home-based path. The daemon serves it in addition to the primary socket and
   writes a copy of `daemon.json` to `~/.local/state/revdeck/devcontainer/state/`.
3. **HTTP**: `POST /api/rpc` on loopback with a cookie session. Needed for containers where the socket
   is not forwarded (`REVDECK_URL` + `REVDECK_TOKEN`).
4. **UI HTTP**: `/api/*` and SSE `/api/events` for the browser.

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
| `projects.list` | — | registered projects with review counts and roots |
| `projects.register` | `root` | project resolved from that working copy |
| `reviews.list` | `project?` / `root?` | saved reviews, optionally scoped to one project |
| `features.list` | `project?`, `includeArchived?` | feature summaries |
| `features.get` | `feature` | feature with ordered members and roles |
| `features.create` | `title`, `brief?`, `contract?`, `reviews?` | create a human feature |
| `features.update` | `feature`, `title?`, `brief?`, `contract?`, `status?` | edit/archive a feature |
| `features.addReviews` | `feature`, `reviews[{review, role?}]` | add/update members |
| `features.removeReview` | `feature`, `review` | remove a member |
| `features.reorder` | `feature`, `reviews[]` | set member order |
| `features.delete` | `feature` | delete a feature (not its reviews) |
| `features.addNote` | `feature`, `kind?`, `level?`, `title`, `body`, `author?` | non-published feature note/finding |
| `features.updateNote` | `feature`, `note`, `kind?`, `level?`, `title?`, `body?` | update a note |
| `features.deleteNote` | `feature`, `note` | delete a note |
| `features.forReview` | `review` | features containing a review |
| `features.context` | `feature`, `maxBytes?` | combined brief + review context |
| `reviews.remoteList` | `root`, `scope`, `limit` | open reviews from the platform |
| `reviews.open` | `root`, `input`/`platform`/`project`/`host`/`branch` | review snapshot |
| `reviews.refresh` | `review` | refreshed snapshot |
| `reviews.remove` | `review` | remove the review from the local list (not the platform) |
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
| `reactions.reviewToggle` | `review`, `emoji` | reactions on the MR/PR itself |
| `comments.update` | `review`, `noteId`, `body` | edit an own platform comment |
| `comments.delete` | `review`, `noteId` | delete an own platform comment |
| `attachments.upload` | `review`, `name`, `contentType`, `data` (base64) | `name`, absolute `url`, `markdown` |
| `notes.delete` | `review`, `noteId` | `{ok}` |
| `publish.preview` | `review`, `kind`, `ids[]` | plan + warnings |
| `publish.approve` | `review`, `kind`, `ids[]`, `hash` | `approvalId`, `expiresAt` |
| `publish.commit` | `review`, `approvalId` | per-item results |
| `rules.get` | `review` | rules markdown, checks, warnings |
| `checks.run` | `review`, `allowRun`, `ids[]` | check results |
| `audit.tail` | `limit` | latest actions |

## Project scope

A project is a repository, identified by `platform:host/project`. `projects.list` returns the
registry (`key`, display fields, `roots`, review count, last activity). `reviews.list` with `project`
or `root` returns only that project's reviews; without either it returns everything (for humans and
debugging).

This filter is an API convenience, not a security boundary: the daemon serves one local user. The
isolation for agents is enforced by the MCP server, which resolves its project from the working copy
at startup, passes `project` on every list and rejects a review id/URL from another project. The MCP
tools do not accept `root` or project overrides.

## Feature scope

A feature is a human-created bundle of reviews (`features`, `feature_reviews`) with a title, brief, a
separate Markdown/OpenAPI contract, application profiles from `context.sources`, and non-published
notes/findings. `features.context` returns a Markdown document with the brief, parsed contract (or raw
Markdown), profiles, notes, an overview matrix and one section per member review, using each review's
own rules. It is read-only.

The MCP server has two scopes:

- **Project session** (default): lists reviews of one project and features that include it; a foreign
  review id/URL is rejected. `revdeck_feature` can read a feature's combined context, but review tools
  write only in the current project.
- **Feature session** (`REVDECK_FEATURE=<feature id>`): the current repository must be a member. The
  scope covers only members; review tools may write drafts to any member. Publishing remains per
  review and requires the usual human approval. Feature notes are writable only in a feature session,
  and MCP can change only notes authored by an agent.

The daemon does not enforce the MCP scope; it is a local single-user service. The MCP server is the
isolation boundary. Feature membership is the only explicit cross-project door.

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
| GET | `/api/projects` | registered projects |
| GET | `/api/reviews?project=` | review list, optionally scoped |
| POST | `/api/projects/register` | register the project of a working copy |
| GET | `/api/state?review=` | snapshot for the UI |
| GET | `/api/diff?review=&file=` | file hunks |
| GET | `/api/rules?review=` | rules |
| GET | `/api/events` | SSE: `review` |
| POST | `/api/reviews/open`, `/api/reviews/refresh` | open/refresh |
| POST | `/api/drafts`, `/api/findings`, `/api/summary`, `/api/decisions` | drafts |
| POST | `/api/notes` | `action: add/update/delete` |
| GET | `/api/reactions?review=&notes=` | reactions for comment ids |
| POST | `/api/reactions` | toggle a reaction |
| GET | `/api/review-reactions?review=` | reactions on the MR/PR |
| POST | `/api/review-reactions` | toggle a reaction on the MR/PR |
| POST | `/api/comments` | `action: update/delete` for own platform comments |
| POST | `/api/attachments` | upload an image/video and return an absolute link |
| POST | `/api/publish/preview`, `/approve`, `/commit` | publishing |
| POST | `/api/checks` | checks |
| POST | `/api/rpc` | RPC proxy for the HTTP transport |

## Versioning

`PROTOCOL_VERSION` in `src/version.ts` is checked during the handshake; the client and daemon must be
the same package version. A method mismatch returns `METHOD` with a hint to update revdeck.
