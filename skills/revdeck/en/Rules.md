# Rule candidates

Review finds not only defects in the MR but also gaps in the repository rules: situations where the
agent or the reviewer had to decide at their own discretion because the documents are silent, or a
rule exists but nobody checks it. Such gaps are written up as rule candidates and handed to the
human in a separate block. A candidate is a proposal, not a rule: the review does not edit
`AGENTS.md`, guides, ADRs, or lint configs; writing up an accepted candidate is a separate task at
the human's decision.

## When a finding becomes a candidate

A candidate is needed if at least one condition holds:

1. The finding received the level **minor** or **question** only because the documents are silent,
   and the decision affects architecture, security, or compatibility (a place for dev code, the
   result format of a useCase, whether tests are mandatory, the way code is excluded from
   production).
2. The rule exists, but the same pattern occurs in the codebase many times:
   `grep -rn "<pattern>" <src> | wc -l` yields more than a few occurrences. This is a candidate not
   for a new rule but for an automated check or for an explicit decision on migration.
3. Reviewers in threads demand the same thing MR after MR, and the documents do not contain it. In
   the "findings on your own MR" scenario such requirements are collected from the processed
   threads.
4. The MR author and the reviewer disagreed, and the dispute was settled by an agreement that cannot
   be recovered from the code.
5. revdeck reported that no rule document was found for the changed path, or that the section was
   not found.

Not a candidate: a one-off typo, a matter of taste of one reviewer, a rule that already exists and is
checked by lint or types, and a rule violated once in legacy code.

## Candidate template

For each candidate:

- **observation**: `file:line` in the MR and a command with the number of occurrences in the
  codebase, if the pattern repeats;
- **why the documents are silent**: which documents from the context were read and what they contain
  near this topic;
- **wording**: one or two sentences in the style of the affected document (in the style guide — the
  rule plus "*What it decides:*"; in `AGENTS.md` — one list line; in the architecture document — a
  table row or a layer-section item);
- **placement**: per the table below;
- **check**: how the rule will be checked once adopted — ESLint (which rule or plugin), `tsc`, a
  test, a script, or review only. If the rule can be expressed as a lint rule, a short prose entry in
  the guide is enough, with a reference to the config;
- **cost of adoption**: how much existing code violates the rule and what to do with it — an
  allowlist, the `warn` level, the rule without migration, or migration as a separate task.

## Placement

The table mirrors "Placement of technical knowledge" in the root `AGENTS.md`; if they diverge,
`AGENTS.md` wins.

| What is fixed | Where |
|---|---|
| A short, permanent repository or application rule | the root or a nested `AGENTS.md` |
| A sizable rule about code, styles, naming | `docs/guides/Styleguide.md`, `docs/guides/StateManagement.md`, or the application's local guides; before the team adopts it — a section with `TODO`: such sections do not count as rules |
| A rule about layer boundaries, placement of responsibility | `<app>/docs/Architecture.md` |
| A decision with alternatives and long-term consequences | an ADR via the `create-adr` skill (status `Proposed`) |
| A repeatable procedure | `.agents/skills/<name>/SKILL.md` |
| A statically checkable rule | the application's or the root ESLint config; in the guide, a reference to the rule |

A rule that must work for all AI products is not placed in `.claude/*`, `.codex/*`, `.cursor/*`:
those are adapters (`AGENTS.md`, "Instruction sources and priority").

## Output

The "Rule candidates" block goes into the review result after the "Solution assessment"
(`Review.md`) and into the result of the "findings on your own MR" scenario (`Feedback.md`, step 8).
Candidates do not go into the findings set (`findings`): the UI does not show them, and they are not
addressed to the MR author. If there are no candidates, the block is omitted.

Once a candidate is adopted, nothing needs to change in revdeck: rules are read from documents by
the paths in `.revdeck.yml`, and a check moved into lint is no longer done manually by the review.
