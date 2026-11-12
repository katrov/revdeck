# Configuration

[English](configuration.md) | [Русский](ru/configuration.md)

Configuration lives in the `.revdeck.yml` (or `.revdeck.yaml`) file at the repository root. The schema
is validated with zod; an unknown field produces an error with the field path.

```yaml
version: 1
provider:
  type: auto            # auto | gitlab | github
  host: gitlab.example.com
  project: group/project
  base: develop
output:
  language: auto        # auto | ru | en — language of findings and replies
rules:
  sources: [AGENTS.md]
  map:
    - match: ["src/**", "lib/**"]
      docs: ["docs/Architecture.md", "docs/Styleguide.md#Базовый стиль"]
      note: "application code"
  ignore: ["**/generated/**"]
checks:
  - id: lint
    name: ESLint
    argv: [npm, run, lint]
    when: ["src/**"]
    consent: true
    timeoutMs: 300000
publish:
  requireApproval: true
  maxComments: 50
```

## provider

| Field | Default | Meaning |
|---|---|---|
| `type` | `auto` | `auto` — inferred from the git remote; otherwise an explicit platform |
| `host` | from the remote | host without a scheme |
| `project` | from the remote | GitLab `group/project`, GitHub `owner/repo` |
| `base` | `develop`/`main` | base for the local diff |

Explicit CLI arguments (`--platform`, `--project`, `--host`) take precedence over the config, and the
config takes precedence over the git remote. This way, tampering with `.git/config` cannot redirect the
review to a different project.

## output

- `language: auto` — findings and replies are written in the language of the MR description and
  discussions; if there is no text, English is used. `ru`/`en` pin the language explicitly.
- The language of the rules and documents does not depend on this: the agent reads them as they are and
  quotes them verbatim.
- This is the language of the **review output**, not of the CLI/UI interface. The interface is switched
  via `--lang ru|en`, `REVDECK_LANG`, or the toggle in the UI.
- `revdeck init --lang en` selects the English skill and writes `REVDECK_LANG` to the MCP config.

## rules

- `sources` — the default documents when none of the `map` rows match. Empty — auto-discovery
  (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/Architecture.md`,
  `docs/STYLEGUIDE.md`, `docs/Styleguide.md`, `docs/CONTRIBUTING.md`).
- `map` — a list of rules: `match` (a glob or an array of globs) and `docs` (an array of selectors).
  Multiple matching rows are merged.
- `ignore` — glob exclusions: a matching file is left out of rule analysis.
- `maxDocumentBytes` — per-document cap in bytes. `0` (default) means no cap; the hard read limit is
  16 MB per file.
- `maxTotalBytes` — cap for the assembled rules context and the rendered rules text. `0` (default)
  means no cap.

Loading all rules increases the prompt sent to the model: token usage, response time and the chance of
hitting the model context window. The CLI/MCP `max_bytes` option can still cap the final agent context.
If a project has very large guides, set a smaller `maxTotalBytes` (for example `327680`) or map only the
needed sections.

### Document selectors

| Selector | What is included |
|---|---|
| `docs/Architecture.md` | the entire document |
| `docs/Styleguide.md#Базовый стиль` | the section for the heading (that level and below, up to the next heading of the same level) |
| `docs/File.md#L10-L25` | a line range |
| `docs/File.md#10-25` | the same range |

A heading is normalized: case, whitespace, and punctuation do not matter. `#Слои и зависимости` and
`#layers` are different sections, while `#Слои-и-зависимости` and `#Слои и зависимости` are the same
section. If a section is not found, revdeck emits a warning and does not fall back to the whole document.

### Glob

`*` matches within one segment, `**` matches any depth, `?` matches one character, `{a,b}` is an
alternative. Examples: `src/**/*.ts`, `docs/{guides,adr}/**`, `**/*.test.ts`.

## checks

Checks are argv arrays, not shell strings. This matters: the config lives in the repository, and a shell
string would allow arbitrary code to be executed during a review.

| Field | Meaning |
|---|---|
| `id` | stable identifier |
| `name` | display name |
| `argv` | command and arguments; the executable comes first |
| `when` | glob paths: run only if the diff touched them; empty — always |
| `consent` | requires explicit confirmation (default `true`) |
| `timeoutMs` | timeout (default 300,000) |

Running: `revdeck checks <N> --run --yes`. The MCP tool only shows the plan.

## publish

- `requireApproval` — kept for backward compatibility; approval is always required when publishing is
  done by a non-interactive process.
- `maxComments` — maximum number of comments per plan (1–200).

## Environment variables

| Variable | Meaning |
|---|---|
| `REVDECK_STATE_DIR` | state directory (default `~/.local/state/revdeck`) |
| `REVDECK_RUNTIME_DIR` | socket directory (default `$XDG_RUNTIME_DIR/revdeck`) |
| `REVDECK_URL` + `REVDECK_TOKEN` | connect to the daemon over HTTP (container/port forwarding) |
| `REVDECK_DEV_CONTAINER=1` | do not start a local daemon; fail with a host-daemon hint instead |
| `REVDECK_UI_HOST` | host used by `revdeck ui` from a container (for example `host.docker.internal`) |
| `REVDECK_ROOT` | project root for the MCP server |
| `REVDECK_LANG` | CLI/MCP/daemon language: `ru` or `en` (default: system locale) |

## Validation

`revdeck config --json` shows the effective config, the path where it was found, and warnings.
`revdeck rules --explain src/app.ts` shows which documents and sections were selected for the file.
