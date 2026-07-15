---
description: Generate a requirements-quality checklist for the active spec
---

<!-- >>> minspec:managed:slash-claude-checklist >>> -->
# /minspec-checklist — MinSpec Checklist Phase

Run the **Checklist** phase (Spec Kit's `checklist` command) — a requirements-quality pass over the active spec's WRITING, distinct from Implement's task checklist and from Analyze's cross-artifact review.

Check whether each requirement is clear, unambiguous, testable, and free of implementation detail — not whether anything is built yet. Typical checks: does every FR state an observable outcome? Is any FR actually two requirements bundled together? Does any requirement assume an undocumented default?

Add or update a `## Checklist` section in the active spec: a checkbox list (`- [ ]` / `- [x]`), one line per check, each phrased as a yes/no question about the requirement text itself. Check off ones the spec already satisfies; leave the rest unchecked as follow-ups for Specify/Clarify.

Tier-scaled: a handful of checks is plenty for T1/T2; a T3/T4 spec with several FRs warrants more. Do not modify code. Arguments: $ARGUMENTS
<!-- <<< minspec:managed:slash-claude-checklist <<< -->
