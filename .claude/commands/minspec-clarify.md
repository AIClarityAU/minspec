---
description: Resolve open questions before planning
---

<!-- >>> minspec:managed:slash-claude-clarify >>> -->
# /minspec-clarify — MinSpec Clarify Phase

Run the **Clarify** phase. Required for T4, optional for T2/T3, skipped for T1.

List concrete answerable questions blocking the plan. For each question add an answer or a follow-up task. Vague concerns belong in discussion, not here.

Update the active spec's Clarify section.

**Do not edit `phases.clarify` when you record answers.** Only approval writes it (`phasesForApproval`): on an unapproved spec, `clarify: done` moves the spec into the spec-gate's implementing band and blocks edits to the files it declares. Recorded answers live in the body. The delegated approve gate reads the body, not the field: it refuses (`clarify-open`) a spec whose "Decisions needed (Clarify)" section still lists unanswered decision items, so answer or record each one. Leave `status:` unchanged. Arguments: $ARGUMENTS
<!-- <<< minspec:managed:slash-claude-clarify <<< -->
