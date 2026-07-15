---
description: Cross-check spec, plan, and tasks for consistency
---

<!-- >>> minspec:managed:slash-claude-analyze >>> -->
# /minspec-analyze — MinSpec Analyze Phase

Run the **Analyze** phase — cross-artifact consistency review before implementation.

MinSpec's native phase list ends at `implement`; treat Analyze as a review pass over the active spec:
1. Does every Plan decision trace to a Specify requirement?
2. Does every Task implement part of the Plan?
3. Are any invariants from `CLAUDE.md` at risk?
4. Is the dependency budget respected?

Output gaps and contradictions. Do not modify code. Arguments: $ARGUMENTS
<!-- <<< minspec:managed:slash-claude-analyze <<< -->
