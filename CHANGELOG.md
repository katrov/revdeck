# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- Security: token scrubbing, redaction, publish sanitizer, loopback-only UI, one-time launch token,
  cookie/Origin/Host checks, CSP.
- Docs: architecture, configuration, protocol, threat model, integrations, ADR.
- Tests: diff parser, core helpers, providers with recorded responses, service with a fake provider.
