# Data sources

Use the first available method. All commands are read-only.

## Review context

1. MCP: `revdeck_context` — summary, files, rules, threads, findings, human comments.
2. CLI: `revdeck context <number or URL>` — the same in markdown; `--json` — structured.
3. If the review is not open yet: `revdeck_open` / `revdeck open <N|URL>`. Without an argument
   revdeck looks for an open review of the current branch.

## Threads and diff

- Threads: `revdeck_threads` / `revdeck threads <N> [--json]`.
- File list: `revdeck_diff` / `revdeck diff <N>`.
- File hunks: `revdeck_diff` with `file` / `revdeck diff <N> --file <path>`.
- Line numbers refer to the new file; a hunk has `newLine` and `oldLine`.

## MR description

It arrives in `revdeck_context` (`info.description`), in `revdeck open`, and in `revdeck context`.
If the description is empty, say so in the summary and do not compare it with the diff.

## Project rules

revdeck computes the effective rules: `rules.map` from `.revdeck.yml` plus auto-discovery
(`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/*`). Only documents and sections for the changed
paths make it into the context, so there is no need to read all of `docs/` and general best
practices must not be substituted for the rules.

If the context contains a "document not found" warning or a path is not matched, say so and evaluate
by the fallback rule (root `AGENTS.md`/`CONTRIBUTING.md`/README only), and write up the gap as a rule
candidate (`Rules.md`).

## Local branch without a platform

1. `git log --oneline <base>..HEAD` and `git diff <base>...HEAD` — the default base comes from
   `.revdeck.yml` (`provider.base`) or `develop`/`main`.
2. Paste the diff into the chat, or use `revdeck context` with a number if the review exists on the
   platform.

## Environment constraints

- In a container without access to the daemon socket, use `REVDECK_URL` + `REVDECK_TOKEN` (the local
  daemon's port forwarded to the host), or ask the human to run the command on the host.
- Do not install `glab`/`gh` in the sandbox and do not ask for a token: only the daemon on the host
  has access to the platform.
