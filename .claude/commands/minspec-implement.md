---
description: Execute the task list against the active spec
---

<!-- >>> minspec:managed:slash-claude-implement >>> -->
# /minspec-implement — MinSpec Implement Phase

Run the **Implement** phase. Required for T3+.

Pick the next unchecked task in the active spec's Tasks section. Implement it, update the checkbox, and add a brief implementation note to the Implement section (decisions, gotchas, PR link).

Respect file allowlists, invariants, and the dependency budget. If you cannot complete a task fully, escalate per `CLAUDE.md` rather than stub. Arguments: $ARGUMENTS
<!-- <<< minspec:managed:slash-claude-implement <<< -->
