# Agent rules for revdeck

- Documentation is part of every change: update `README.md`, `README.ru.md`, `docs/` (and `docs/ru/`),
  CLI help and `CHANGELOG.md` in the same commit as the code.
- Keep the user-facing chat answer short; put detailed review results in the revdeck UI, summary,
  findings and agent notes.
- Run `npm run typecheck`, `npm test` and `npm run build` before calling a change complete.
- Do not publish releases unless the user explicitly asks.
