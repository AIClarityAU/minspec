---
description: Resolve open questions before planning
---

<!-- >>> minspec:managed:slash-claude-clarify >>> -->
# /minspec-clarify — MinSpec Clarify Phase

Run the **Clarify** phase. Required for T4, optional for T2/T3, skipped for T1.

List concrete answerable questions blocking the plan. For each question add an answer or a follow-up task. Vague concerns belong in discussion, not here.

Update the active spec's Clarify section.

**When the last open question is answered or recorded (the final `Recorded selection:` line), set `phases.clarify: done` in the spec frontmatter in the same commit** (use `skipped` instead when the phase is deliberately skipped). Nothing else writes it before approval, and the approve gate refuses a T3/T4 spec whose `phases.clarify` is still `pending` as `clarify-pending`. Leave `status:` unchanged. Arguments: $ARGUMENTS
<!-- <<< minspec:managed:slash-claude-clarify <<< -->
