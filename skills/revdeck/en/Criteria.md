# Criteria and verification procedures

The criterion for evaluating code is the repository's canonical documents, not general best
practices. This file does not restate rules and does not introduce new ones: it defines which
documents are mandatory for which paths and how to mechanically verify code against them. Take the
wording of a rule and the section reference from the document itself. Where the document is silent,
the finding gets the level minor or question (section 12), not an invented rule.

revdeck computes the documents for specific paths: `rules.map` from `.revdeck.yml` and
auto-discovery (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/*`). The ready-made list with
sections arrives in the context (`rules.markdown`). Do not pick rules from memory and do not read all
of `docs/` instead of that list.

## 1. Change map

Before choosing criteria, record for each file from the diff:

- the project/package/module the file belongs to;
- the file class: application code, state/stores, styles, tests, generated code, build or tooling
  config, documentation, AI-product config (`.agents`, `.claude`, `.codex`, `.cursor`), CI;
- the layer by path (section 3) and the status: new file, changed, legacy zone; mark a path whose
  layer the document does not describe;
- for a monorepo — the workspace and the application boundaries;
- whether the rules contain a document for the path; if not, that is a reason for a rule candidate
  (section 2).

Present the map to the human as a single table or list before the checks begin: it determines which
documents to read and shows what the review took into account.

## 2. Mandatory documents by path

The source is `rules` from the context. For each changed path revdeck has already selected:

- documents from `rules.map` (glob → documents with an optional section `#Heading` or `#L10-L20`);
- or `rules.sources` if no row matched;
- or auto-discovered documents if the config is empty.

Procedure:

1. Read each document in full if no section is specified, and only the specified section if one is
   specified.
2. If a document is not found or a path is not matched, say so in the final output and evaluate by
   the fallback rule: root `AGENTS.md`/`CONTRIBUTING.md`/README. The absence of a rule is no reason
   to invent your own; it is a rule candidate (`Rules.md`).
3. Read layer documents (architecture, style guide, ADR, package README) to the extent needed for
   the affected sections. If a rule does not apply to the changed code (legacy outside the scope of
   application), do not raise a finding (Migration rule, section 12).
4. Configs (`webpack`, `tsconfig`, `.eslintrc`, `jest.config`, `.husky`, CI) often have no normative
   document: check them against section 6 and against what the project actually uses.
5. For `.agents/**`, `.claude/**`, `.codex/**`, `.cursor/**`, `devtools/**`, and `.devcontainer/**`
   the sections of the root `AGENTS.md` about maintaining configs and adapters are mandatory;
   adapter parity is section 9.

## 3. Layers and dependency direction

Run this for every changed or new file inside layered zones. The source of prohibitions is
project-specific: a layer table in the architecture document, a list of allowed dependencies, or
explicit prohibitions.

Procedure:

1. Determine the file's layer by path and by the project document. A path that is not in the table
   does not count as a layer: findings about the direction of its dependencies may only be
   **question**; defects such as an import cycle (item 6) are evaluated by scenario regardless of
   layer.
2. If the document defines only a chain (`features → useCase → state/api`), check that chain instead
   of building a matrix.
3. List all imports of the file that lead into another layer. First gather absolute imports and
   compare the first segment with the actual directory structure; resolve relative `../` to a layer
   manually:
   ```bash
   grep -nE "from '[^.@][^']*'" <file>          # absolute imports
   grep -nE "from '@/" <file>                    # aliases
   grep -nE "import\('|^import '|jest\.mock\('" <file>   # dynamic, side-effect, mocks
   ```
   An import from the legacy zone is not forbidden, but note it in the map if the document does not
   allow it.
4. For each import, check the "file layer → import layer" pair against the document. A forbidden
   pair in a new file or in added lines is **major**, with a reference to the document; the same
   pair in unchanged lines — do not raise it, but mention it in the solution assessment if the MR
   extends the module. The prevalence of a violation does not lower the level: the rule applies to
   new code.
5. Access to state from the UI: the project document determines whether the store may be read
   directly, only through selectors, or only through hooks. A violation in added lines is **major**.
6. Module public API: importing into someone else's module while bypassing `index.ts`/barrel — per
   the project document; consider a directory with its own `index.ts` to be a module.
7. An import cycle closed by a new import (A → B → A): check
   `grep -rn "from '<path to A>'" <path to B>`. A cycle is a **blocker** only if it is proven to
   break initialization (stores, `undefined` at import time); otherwise **question**.

## 4. Placement and responsibility

For each new or substantially changed module, answer whether it landed in the right layer. The
source is the sections of the architecture document and the state guide on areas of responsibility.

Look for incorrect placement:

- network calls, `await`, or a business condition in a store/selector;
- navigation, DOM, and modals in a store;
- local state for data needed by other parts of the application;
- a presentation-layer component importing a store or business logic;
- a hook with the `use` prefix that has no React hooks;
- a responsibility that the document assigns to another layer.

The finding comes with a reference to a section of the document. If the document is silent, it is
**minor** or **question**.

## 5. Reuse and precedents

The project document (usually "Change principles" in `AGENTS.md`) forbids new abstractions and
dependencies when existing means solve the task. The search is performed before evaluating the code
on its merits:

1. For each new function, hook, component, and utility, look for a counterpart by name and key calls:
   ```bash
   grep -rln "<key call or name>" <src> --include=*.ts --include=*.tsx | grep -v node_modules
   ```
   For components, start with the project's UI package. A counterpart that was found but not used
   and not extended is **major**, with the path to the counterpart.
2. Code that repeats an existing function of the same layer (`grep -rn "<distinctive line>"`) is
   **major**, with a proposal to extract a shared function; duplication across different layers is a
   **question** about where the shared code belongs. For styles — the reuse rule from the style
   guide.
3. Find a neighboring module of the same layer with a similar task and compare the structure,
   naming, and error handling. A divergence from a stable precedent without a reason is **minor** if
   the guide is silent, and **major** if the precedent is fixed in the guide. A precedent that itself
   violates the guide does not justify new code.
4. A new dependency: check that the project has no dependency with the same function, that the
   version is consistent with the lock file, and that workspace links are not replaced with
   versions. A dependency without justification is **major** per "Change principles".

## 6. Calling code and impact

1. For each changed exported symbol (function, type, prop, action, selector), find all usages:
   ```bash
   grep -rn "\b<Symbol>\b" <src> --include=*.ts --include=*.tsx | grep -v node_modules
   ```
   Check that a change in the signature, in the semantics of `null`/`undefined`, in the argument
   order, or in the data format does not break any usage. A broken call that `tsc` will not catch is
   a **blocker**.
2. Changes in shared packages affect consumers: find them by package name (including `package.json`,
   storybook, and other applications) and check usages there, not only in the application from the
   description.
3. Changed stores: find subscriptions (`reaction`/`autorun`/`when`), `computed`, and persist
   locations. Changing the shape of persisted data without migration is a **blocker** if it is
   proven that the stored state breaks hydration; otherwise a **question** about what will happen to
   the already stored state.
4. Changed event handlers/network layer: check all subscribers for the same event type.
5. Feature flags: verify new behavior behind a flag in both states; a flag in product code that
   bypasses the configuration is a finding per the document.
6. Module resolution configs: a new alias/path must be consistent in every place where the project
   resolves imports (`tsconfig`, the bundler, the test runner). A mismatch is a **blocker** if it
   breaks the build/types/tests; otherwise **major** or **question** if there is no normative
   requirement.

## 7. ADRs and architectural decisions

1. Collect ADR headings and statuses: `grep -E '^# |^-\s+Статус:' docs/adr/*.md` (or the path
   accepted in the project). If the MR's domain matches the topic of an ADR in status `Accepted` or
   `Proposed`, read the ADR in full and check that the diff does not contradict the decision and its
   "Consequences". A contradiction of an `Accepted` ADR without a new ADR is a **blocker**; a
   contradiction of a `Proposed` ADR is a **question**, and **major** if the decision is already
   implemented and the MR diverges from the implementation.
2. Whether a new ADR is needed — per the project document about ADRs (usually the `create-adr`
   skill). If the decision falls under the criteria and no ADR was added, that is **major**, with a
   reference to the document.
3. Check a new ADR in the diff against the project template: structure, status, links, and a unique
   number (`ls docs/adr | cut -d- -f1-2 | sort | uniq -d`).

## 8. Tests

The requirement for tests comes from the project documents. If there is no normative requirement, a
missing test is not a rule violation. Procedure:

1. Where tests live: `*.spec.ts(x)`, `*.test.ts(x)` next to the code, in the module's `test/` or
   `__tests__/`; the runner and aliases come from the project config. If the project has no
   automated tests, do not raise findings about their absence.
2. A new useCase, action, selector, utility, or changed logic branch without a test is a **question**
   to the author, with a reference to a precedent: the nearest `*.spec.*` in the same layer. For a
   bugfix, ask which test reproduced the defect.
3. `test.skip`, `.only`, a test without assertions, a stub instead of a test — **major** if a
   scenario of a false result is shown; without a scenario — **question**. A test that would not have
   failed on the code before the fix — **question**.
4. Changed test configs and mocks — impact on existing tests (section 6).

## 9. Documentation and AI-product configs

1. Documentation in the diff is checked against "Placement of technical knowledge" and "Repository
   constraints" in the root `AGENTS.md`: language, the nearest canonical source, absence of
   duplicates (`grep -rn "<key phrase>" docs AGENTS.md */AGENTS.md */docs`), the role of TSDoc.
2. A new or changed skill in `.agents/skills/`: a tracked adapter in every format for which the
   repository already has an adapter directory (`.claude/skills`, `.codex/skills`, `.cursor/skills`).
   A missing adapter is **major** per the section about instruction sources; a `description`
   mismatch between the adapter and the skill is **minor**. Skill content is a procedure, not rules.
   Skill actions against live systems (staging environments, accounts, credentials in a tracked
   file) are **question**; **blocker** only for production access and tokens.
3. Changes to security restrictions in one of the `.claude`, `.codex`, `.cursor` configs: check for
   equivalent changes in the others and in the container documentation, if it describes the
   mechanism.
4. Changes in `AGENTS.md`: a permanent rule goes into `AGENTS.md`; a sizable one into
   `docs/guides/*` with a reference; a procedure into `.agents/skills`. A placement violation is
   **major**.

## 10. Correctness and security

This is a list of places to look for defects, not rules: a **blocker** or **major** requires a proven
"input — result" scenario; without it the item remains **minor** or **question**. Verify against the
code, not against the MR description:

- async: unhandled promises, races on repeated calls, a stale response overwriting a newer one,
  missing cancellation on unmount or argument change;
- state: subscriptions without dispose, state mutation outside an action, extra/missing observers,
  computed functions on hot paths;
- React/UI: effect dependencies, an effect instead of a computation during render, leaked handlers
  and timers;
- types: `any`, `@ts-ignore`, casts and `!` that hide a real `undefined`;
- API contracts: how the project represents an error (`Response<T>`, exception, `Result`) and what
  the code does with an undefined payload on error;
- i18n: a new key without entries in the locales breaks the check; a string literal instead of a key
  — per the precedent of neighboring components;
- security: secrets and tokens in code and configs; building HTML from data; `window.open`/
  `location.assign` with external data; IPC without validating the sender and arguments; external
  URLs in images that reach viewers;
- dev-only code: whether it ends up in the production build and vice versa; the documents may not
  define a single way — compare with precedents, a new mechanism is a **question**;
- performance: subscribing to the whole store for 1–2 fields, unstable references in props; anything
  else — only with a measurement or a reproducible scenario.

## 11. Solution assessment

Besides the list of findings, the review gives an assessment of the solution as a whole. It does not
turn into findings without `file:line`, but is output as a separate block of the result and answers
the questions:

1. Does the MR solve the stated task in the way the architecture provides, and in the layers where
   this code belongs.
2. Which alternatives were available in the existing code, and why the chosen option is better or
   worse. If an alternative is clearly better under the rules, that is a **major** finding; if it is
   debatable — **question**.
3. What will get harder with future changes: a new duplication point, an implicit link between
   layers, growth of the legacy zone, a new dependency.
4. What is done well and should be kept during follow-up work.
5. Whether an ADR is needed (section 7) and whether the documentation is sufficiently updated.

## 12. Level calibration

- **blocker** — a behavior defect or regression with a proven scenario, data loss or corruption, a
  vulnerability, broken calling code, broken lint/types/build/existing tests (with command output or
  a line reference), a contradiction of an `Accepted` ADR, a violation of "Repository constraints" in
  the root `AGENTS.md`. It cannot be merged without a fix.
- **major** — a new violation of a rule from the mandatory documents of section 2 in new or changed
  code (layer, access to state, style, naming, placement of knowledge, adapters), an unused
  counterpart or duplicated code of the same layer, a placeholder test, unrelated changes, a mismatch
  between the description and the diff that changes the meaning of the MR. Fix before the merge or
  reject with justification.
- **minor** — a preference where the documents are silent, wording, typos, a divergence from a
  precedent without a rule, unproven inefficiency. The author may choose not to fix it.
- **question** — an author's claim that cannot be verified against the code, an unclear intent, an
  alternative with no advantage under the rules, a missing test, a thread finding not confirmed by
  the code, an import from a path that is not described as a layer.

A violation in unchanged lines of legacy code gets no level: it is not a finding on the MR. If the MR
adds code next to such a violation and repeats it, that is a new violation — **major**, with a note
that only the added code needs to be fixed. The prevalence of a violation in the codebase does not
lower the level: guides under "Scope of application" apply to new code.
