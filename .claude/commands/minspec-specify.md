---
description: Start or update the Specify phase for the active MinSpec spec
---

<!-- >>> minspec:managed:slash-claude-specify >>> -->
# /minspec-specify — MinSpec Specify Phase

Run the **Specify** phase of MinSpec SDD methodology.

Read the active spec referenced in the `minspec:active-spec` block of `CLAUDE.md` / `AGENTS.md`. Open the corresponding file under the project `specs/` directory and fill in the Specify section: user-visible outcome, problem statement, constraints.

Set valid frontmatter so the SPECS pane and the approve gate read it correctly: `status:` must be one of `new`, `specifying`, `implementing`, `done`, `archived`, `superseded` (an absent or unrecognized value is silently coerced to "new" and flagged at approve), and set an explicit `tier:` (one of `T1`, `T2`, `T3`, `T4`) — a missing tier is flagged too. Getting these right here is the point: the approve gate is only a backstop, not the place to discover gaps.

Match ceremony to the spec's tier:
- T1: one sentence
- T2: short paragraph
- T3/T4: thorough but bounded

After the **Requirements** section, add a **`## Costly to Refactor`** section (read-first, placed after Requirements): a ranked list of the expensive-to-reverse commitments — contracts, cross-package boundaries, data-model/API changes — each with a one-line *why-costly* + *what to check*. `"Low — <reason>"` is valid when nothing is hard to undo. Author it last (once the requirements are stable); place it after Requirements.

Also in Zone A, after Requirements, add a **`## Acceptance Criteria`** section that defines *done*: a checkbox list where each item is one line — a **bold short outcome name**, an em-dash, a plain-language observable outcome a reader can verify, and a parenthetical trace to the `FR`/`INV` it satisfies (e.g. `- [ ] **Honest degradation** — incoherent state surfaces "state unclear", never a fabricated next step. (FR-6)`). Tier-scaled: a couple of criteria is plenty for T1/T2 — don't bloat. See the **MinSpec: Generate Example Spec** output for the canonical format.

Never violate invariants in `CLAUDE.md` or `.minspec/constitution.md`. Arguments: $ARGUMENTS
<!-- <<< minspec:managed:slash-claude-specify <<< -->
