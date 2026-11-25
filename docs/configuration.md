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
review:
  agents: 3
  roles: [correctness, architecture, tests]
context:
  sources: [docs/AppContext.md]   # application profile, not review rules
  maxBytes: 30000
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

## Personal overrides: `.revdeck.local.yml`

`revdeck` also reads `.revdeck.local.yml` (or `.revdeck.local.yaml`) next to the base config. Use it for
local roles, checks, output language or provider settings without changing the shared file. `init`
adds both local names to `.gitignore`. If the file is **tracked by git**, it came from the repository
(not from the user) and is ignored as personal overrides; a warning is shown.

Merge rules:

- objects are merged recursively;
- arrays and scalars from the local file replace the base value;
- `review.readOnly: true` in the base cannot be disabled locally (the effective value is OR);
- local file alone is allowed, but a base `.revdeck.yml` is recommended for the team;
- YAML/schema errors in the local file are reported, never silently ignored.

Rule and `context.sources` documents are read only if they are **tracked by git**, have a safe
extension (`.md`, `.mdx`, `.rst`, `.txt`, `.adoc`; profiles may also be `.yaml`, `.yml`, `.json`) and
do not match the secret deny-list (`.env*`, `.git/**`, `.npmrc`, `.revdeck.local.*`, `*.pem`, keys).
The opened file descriptor's realpath is checked inside the root, so a parent symlink swap cannot
escape the repository. In a directory without `.git` (tests, scratch dirs) the tracked check is
skipped.

```yaml
# .revdeck.local.yml — do not commit
review:
  agents: 2
  roles: [correctness, tests]
output:
  language: ru
```

## provider

| Field | Default | Meaning |
|---|---|---|
| `type` | `auto` | `auto` — inferred from the git remote; otherwise an explicit platform. `revdeck init` writes the remote platform, or `gitlab` when the host is not recognized (`--provider` overrides it) |
| `host` | from the remote | host without a scheme |
| `project` | from the remote | GitLab `group/project`, GitHub `owner/repo` |
| `base` | `develop`/`main` | base for the local diff; an open MR always uses its target branch from the platform |

For an open MR the target is taken from the MR, not from `base`. The review context shows the target
branch, the diff base/head and the platform merge status. `base` is only a fallback for reviewing a
local branch/diff without an MR.

Explicit CLI arguments (`--platform`, `--project`, `--host`) take precedence over the config, and the
config takes precedence over the git remote. This way, tampering with `.git/config` cannot redirect the
review to a different project.

## Project identity

A project is a repository. Its key is `platform:host/project`, normalized for comparison (host and
path are lower-cased; the original values are kept for display). One repository can have several
working-copy roots, but they are one project.

The key is derived from `provider` (or the git remote) and stored in the daemon registry. There is no
`kind` field: "api", "web" or "mobile" are not project types, and a project does not need them. A
review always uses the config and rules from its own working-copy root, so several roots of the same
project do not mix their rules.

```bash
revdeck projects                 # list projects, review counts and roots
revdeck projects add /path/repo  # register a project before its first review
```

In the projects home, **Add project** registers a working copy, **Edit** changes the display title
and the working-copy roots, and **Delete** removes the project and its cached reviews from revdeck.
MRs/PRs and comments on the platform are never touched by project deletion.

The UI and agent scope are described in [architecture.md](architecture.md) and
[capabilities](capabilities.md#project-scopes).

## Features and contracts

Features are not `.revdeck.yml` settings: they are local daemon records created by a human in the UI
or CLI. A feature has a title, a Markdown **brief**, a separate **contract** (Markdown or OpenAPI) and
an ordered set of reviews. Put the task goal, non-goals, rollout order and acceptance criteria into the
brief; put the API/event contract into the contract field. OpenAPI is parsed into operations and
schemas, and the feature context marks which changed reviews mention each path. Each member review
keeps its own `.revdeck.yml` and rules; the brief and contract never override them.

Application profiles are background documents, not review criteria. Declare them per repository:

```yaml
context:
  sources: [docs/AppContext.md, docs/API.md]
  maxBytes: 30000
```

`maxBytes` is the aggregate limit for the project profile; `0` uses the feature-context budget. The
feature context itself is capped by `revdeck feature context --max-bytes` (or the MCP `max_bytes`).
Profile and note text is quoted and treated as data, not instructions.

Feature notes/findings are stored on the feature and are never published. Publishing remains per
review.

```bash
revdeck feature create "Checkout v2" --brief brief.md --contract openapi.yaml \
  <review-id> <review-id>
revdeck feature context ft-a1b2c3
revdeck feature note ft-a1b2c3 --title "Contract gap" --body "Client is missing a header" --kind finding --level major
```

To start a feature-scoped agent session, run the MCP server from a repository that is a feature
member with `REVDECK_FEATURE=<feature id>`. Project rules are still read from each member's own root.

## output

- `language: auto` — findings and replies are written in the language of the MR description and
  discussions; if there is no text, English is used. `ru`/`en` pin the language explicitly.
- The language of the rules and documents does not depend on this: the agent reads them as they are and
  quotes them verbatim.
- This is the language of the **review output**, not of the CLI/UI interface. The interface is switched
  via `--lang ru|en`, `REVDECK_LANG`, or the toggle in the UI.
- `revdeck init --lang en` selects the English skill and writes `REVDECK_LANG` to the MCP config.

## review

The review can be split between independent agents. The daemon stores the final result; spawning is done
by the harness (Claude Code subagents, DSH workflow, or another orchestrator).

```yaml
review:
  agents: 3
  roles: [correctness, architecture, tests]
```

| Field | Default | Meaning |
|---|---|---|
| `agents` | `3` | number of independent reviewers, 1–8 |
| `roles` | correctness, architecture, tests | roles for the reviewers; a shorter list is repeated to reach `agents` |

Available roles:

| Role | Focus | Criteria.md |
|---|---|---|
| `correctness` | logic, edge cases, errors, async and state | §6, §10 |
| `architecture` | layers, responsibility, coupling, precedents, ADRs | §3–§5, §7 |
| `tests` | coverage, assertions, missing cases, flakiness | §8 |
| `security` | authorization, validation, secrets, injections, shell | §10 |
| `performance` | complexity, N+1, allocations, blocking work | §10 |
| `compatibility` | public API, migrations, config and backward compatibility | §6, §7 |
| `docs` | documentation, configs, CHANGELOG and AI instructions | §9 |
| `concurrency` | races, locks, idempotency, retries, cancellation | §10 |
| `ux` | UI states, accessibility, errors, narrow screens | §9, §10 |
| `data` | schemas, migrations, storage | §3, §10 |
| `api` | public contracts, versioning, client compatibility | §6, §7 |
| `dependencies` | versions, licenses, supply chain | §3, §10 |
| `observability` | logs, metrics, traces, diagnostics | §9, §10 |
| `build` | CI, build, packaging, reproducibility | §8, §9 |
| `privacy` | PII, personal data, logs and leaks | §9, §10 |
| `general` | full review across all sections | §1–§12 |

Custom roles live in `review.customRoles`; `roles` may reference built-ins or those keys:

```yaml
review:
  roles: [correctness, accessibility]
  customRoles:
    accessibility:
      title: "Accessibility"
      description: "Keyboard navigation, ARIA, focus and contrast."
      criteria: ["9", "10"]
      focus: "a11y and keyboard"
      instructions: |
        Report only accessibility problems; do not repeat general architecture findings.
```

Custom ids cannot override a built-in role. `review.readOnly: true` disables all writes and publishing
for that review (the UI shows a banner, the daemon rejects mutations).

Several MRs can be opened at once with `revdeck open 345 344 556` (or an array in `revdeck_open`); run
a separate group per review and do not merge findings across MRs.

`revdeck context <N> --role <role> --shard i/N` renders a worker context with only its files (and threads
for those files), plus a reminder not to write findings. The MCP tool accepts the same `role` and `shard`
arguments. The lead agent should collect the workers' JSON, deduplicate by `file:line:title`, and only
then call `revdeck_set_summary` / `revdeck_draft_findings`.

## rules

- `sources` — exact document paths (optional `#section`), not glob patterns. Use `map.match` to select
  documents by changed path. The default documents when none of the `map` rows match. Empty — auto-discovery
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

### Why warnings appear

The UI shows a **Warnings** block when `review.errors` contains messages from config loading:

- `.revdeck.yml not found: rules come from auto-discovered documents` — there is no
  `.revdeck.yml`/`.revdeck.yaml` at the repository root. `revdeck init` creates one; without a config,
  the defaults are used and the rule documents are auto-discovered.
- `no rule documents found: the review will rely on the code only` — after loading the config, both
  `rules.sources` and `rules.map` are empty, and none of the auto-discovered files exist. The list is
  `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/Architecture.md`,
  `docs/STYLEGUIDE.md`, `docs/Styleguide.md`, `docs/CONTRIBUTING.md`.

To remove both warnings, add `.revdeck.yml` and either list existing documents or add one of the
auto-discovered files:

```yaml
version: 1
rules:
  sources:
    - AGENTS.md
    - docs/Architecture.md
```

If `rules.sources`/`rules.map` are set, auto-discovery is disabled; a missing explicit document then
produces its own warning instead. Empty `sources: []` keeps auto-discovery enabled.

### Change groups

```yaml
review:
  groups:
    - id: auth
      title: "Authorization"
      match: ["src/auth/**", "src/security/**"]
```

Explicit groups are applied first; other files are grouped by kind (docs, tests, config, styles,
generated) and by top-level module. Groups are shown in Overview and in the agent context.

### Secret scan

Off by default:

```yaml
review:
  secrets:
    enabled: true
    scan: diff          # diff | files | both
    includeTests: false
    allowlist: ["test/fixtures/**", "rule:generic-secret"]
```

The scanner looks for AWS/GitHub/GitLab/Stripe/OpenAI keys, private keys and generic secret
assignments. Only a masked preview is returned; raw values are never stored in the review or sent to the
agent. `revdeck scan <N>` returns the same list.

### Version history

```yaml
review:
  history:
    enabled: true
    keep: 20
```

Each refresh with a changed head/diff stores a version (head/base SHA, diff hash, counts and review
snapshot). `revdeck versions <N>` lists them; Overview shows the timeline. Versions are pruned to `keep`.

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

Checks are argv arrays that execute code on the host. The repository controls them, so they are
human-only: the devcontainer bridge denies `checks.run`, and the CLI refuses `--run` inside a
container. `argv: ["sh","-c","…"]` is still an argv array and executes arbitrary code — read the full
command before confirming.

| Field | Meaning |
|---|---|
| `id` | stable identifier |
| `name` | display name |
| `argv` | command and arguments; the executable comes first |
| `when` | glob paths: run only if the diff touched them; empty — always |
| `consent` | deprecated and ignored: checks always require a human UI/host-CLI run |
| `timeoutMs` | timeout (default 300,000) |

Running: a human uses **Run matching** in the Rules tab (the dialog shows the full argv) or
`revdeck checks <N> --run --yes` on the host; `revdeck checks` prints the commands first. Read-only
reviews disable the runner. The agent can only show the plan; the bridge returns `CAPABILITY` for
`checks.run`. Host checks are not sandboxed yet.

## publish

- `requireApproval` — kept for backward compatibility; approval is always required when publishing is
  done by a non-interactive process.
- `maxComments` — maximum number of comments per plan (1–200).

## Environment variables

| Variable | Meaning |
|---|---|
| `REVDECK_STATE_DIR` | state directory (default `~/.local/state/revdeck`) |
| `REVDECK_RUNTIME_DIR` | socket directory (default `$XDG_RUNTIME_DIR/revdeck`) |
| `REVDECK_URL` + `REVDECK_TOKEN` | connect to the daemon over HTTP (container/port forwarding); the token is agent-scoped, not the UI token |
| `REVDECK_DEV_CONTAINER=1` | do not start a local daemon; fail with a host-daemon hint instead |
| `REVDECK_HOST_ROOT` | host path of the worktree mounted into a devcontainer; `revdeck devcontainer --write` sets `${localWorkspaceFolder}`, and the container client maps its root to it before RPC |
| `REVDECK_UI_HOST` | host used by `revdeck ui` from a container (for example `host.docker.internal`) |
| `REVDECK_ROOT` | project root for the MCP server |
| `REVDECK_FEATURE` | feature id for a feature-scoped MCP session; the current project must be a member |
| `REVDECK_LANG` | CLI/MCP/daemon language: `ru` or `en` (default: system locale) |
| `REVDECK_UPDATE_CHECK=0` | disable the UI update notice; the daemon still reports the current version |
| `REVDECK_GLAB` | absolute path to `glab` when the daemon PATH does not contain it |
| `REVDECK_GH` | absolute path to `gh` when the daemon PATH does not contain it |

## Validation

`revdeck config --json` shows the effective config, the path where it was found, and warnings.
`revdeck rules --explain src/app.ts` shows which documents and sections were selected for the file.

## Example configurations

Runnable examples live in [examples](../examples/): `simple.yml`, `monorepo.yml` and
`analytics-platform.yml`. The test suite parses every example, checks its path map and checks, and
verifies that each example selects at least one check for a changed source file.
