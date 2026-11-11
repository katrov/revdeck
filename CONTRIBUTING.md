# Contributing to revdeck

Thanks for taking the time to contribute. revdeck is a small, dependency-light project: a review
procedure, a local daemon, platform providers, an MCP server, a CLI and a Svelte UI.

## Good first issues

- A new `Provider` (Bitbucket, Forgejo, Azure DevOps).
- A harness adapter (Gemini, Zed, JetBrains, a DSH host command).
- Native drafts for GitLab/GitHub.
- English translations of `docs/` and `skills/`.
- UI: reactions panel, review opening dialog, virtualized diff.

## Setup

```bash
git clone https://github.com/katrov/revdeck.git
cd revdeck
npm ci
npm run typecheck    # tsc + svelte-check
npm test
npm run build
```

For manual testing, `npm run dev:daemon` starts the daemon from source; `npm run dev:ui` starts Vite.
The daemon serves the built UI from `dist/ui`, so run `npm run build:ui` before checking the full app.

`glab`/`gh` are optional for development: provider tests use recorded CLI responses. To test against a
real platform, authenticate the CLI and run `revdeck doctor`.

## Project layout

| Path | Responsibility |
|---|---|
| `src/core` | Pure functions: diff parser, config, rules, findings, sanitizer, redaction, exec |
| `src/providers` | Platform-specific code; the only place that knows GitLab/GitHub JSON |
| `src/daemon` | SQLite store, review service, approvals, RPC, HTTP/SSE |
| `src/cli` | Commands and installers |
| `src/mcp` | MCP tools and prompts |
| `ui` | Svelte 5 SPA |
| `skills/revdeck` | Review procedures shipped to user projects |

Rules of thumb:

- Keep `src/core` free of network and platform assumptions.
- A provider returns normalized types from `src/core/types.ts`; no UI or CLI concerns.
- Publishing must stay approval-gated: never add a path that posts without an `approval_id`.
- Untrusted text (comments, diff, MR description) never becomes an instruction or a shell command.

## Adding a provider

1. Implement `Provider` from `src/providers/provider.ts`.
2. Add a branch to `createProvider`.
3. Add fixture-based tests in `tests/providers.test.ts` using a fake `Runner`.
4. Document platform quirks (resolve, drafts, line comments) in `docs/architecture.md`.

## Adding a harness adapter

Add a `SPECS` entry in `src/cli/init.ts` with the skill target, MCP config path or command file, then
document it in `docs/integrations.md`. `init` must never overwrite files it does not own.

## Translations

- UI strings live next to their components: `t('русский', 'English')` in `ui/src/lib/i18n.svelte.ts`'s
  `t` helper. Keep both languages in the same edit.
- CLI strings use `tr('русский', 'English')` from `src/core/locale.ts`.
- The skill has two human-maintained packs: `skills/revdeck/ru/` and `skills/revdeck/en/`. They must
  keep the same structure and semantics; do not machine-translate the review procedure.
- Tests that assert message text should pin the locale with `setLocale('ru')` or be language-agnostic.
- Docs: `docs/` is English and canonical, `docs/ru/` is Russian. Keep headings, commands, code blocks
  and file paths identical between the two; translate prose only.

## Pull requests

- One logical change per PR; include tests for behavior changes.
- `npm run typecheck`, `npm test` and `npm run build` must pass.
- Do not commit secrets, `.env` files, tokens, or generated `dist/` artifacts.
- UI changes: include a screenshot and check light/dark themes.
- Commits: imperative mood, short subject, explain the *why* in the body. Conventional Commits
  prefixes (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`) are welcome but not required.
- By contributing you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Release (maintainers)

```bash
npm version minor
git push --follow-tags
```

The `release` workflow publishes to npm with provenance and creates a GitHub release. The version in
`src/version.ts` must match `package.json`. `prepublishOnly` re-runs build, typecheck and tests.

## Security

Please do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
