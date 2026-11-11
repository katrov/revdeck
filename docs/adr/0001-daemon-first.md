# ADR-0001: Daemon-first architecture

[English](0001-daemon-first.md) | [Русский](../ru/adr/0001-daemon-first.md)

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

The first version of revdeck ran as a process that a human started manually on the host
(`node devtools/mr-ui/server.mjs <N>`), and the agent communicated with it through `.revdeck/*.json`
files. This gave the right security boundary (the agent does not publish, and the token stays on the
host), but:

- the server died with the terminal, and the link had to be copied manually;
- file exchange caused races (file version, 409) and required syncing fields between the agent and
  the UI;
- it was impossible to have several reviews at once;
- each project required its own copy of the script and ran in one process.

What was needed: launch from a `/` command in any harness, a full-featured interface, several reviews,
GitLab and GitHub, configurable project rules, and installation into any agent project.

## Decision

We build the product around a [local daemon](../architecture.md):

- the `revdeck daemon` — a long-lived process owned by the user that holds credentials, SQLite,
  providers, RPC, HTTP/SSE, and the UI;
- the CLI and MCP are thin clients over RPC; the MCP server contains no review logic;
- the agent writes only drafts; publication requires an approval tied to the plan hash;
- the UI is a Svelte SPA served by the daemon and outlives the agent session;
- state lives in SQLite under `~/.local/state/revdeck`, not in JSON in the repository;
- the file format remains as `export`/`import` for compatibility and for sandboxes without a socket.

## Alternatives considered

1. **An MCP process per session, without a daemon.** Simpler installation, but the UI does not survive
   the session, several agents compete for state, the token ends up in the process that the agent
   launches, and the container scenario still requires a separate process on the host. Rejected.
2. **File exchange only.** Maximum compatibility, but races and manual startup remain. Kept as
   `export/import`, not as the primary path.
3. **A cloud service.** Removes installation, but requires sending code and tokens outside. Contradicts
   the "local, one person" requirement.

## Consequences

- A daemon lifecycle appears: socket, pid, logs, autostart (`daemon install`), handling of a stale
  socket. The client can start the daemon itself.
- Socket permissions are part of the security model: directory 0700, socket 0600.
- In a container, either a mounted socket or `REVDECK_URL`/`REVDECK_TOKEN` is needed; otherwise, use
  `export`/`import` and run on the host.
- One daemon serves several repositories: `root` is passed on `open`, and the config is read from that
  root.
- Client and daemon versions must match; [`PROTOCOL_VERSION`](../protocol.md) was added.
- This creates room for background sync and SSE, which improves UX compared to manually refreshing
  the page.

## Follow-up decisions

- Native drafts (GitLab draft notes, GitHub pending review) are the next step; the provider interface
  already contains `capabilities.nativeDrafts`.
- A multi-user mode is not planned; if needed, a separate ADR.
