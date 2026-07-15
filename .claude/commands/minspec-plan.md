---
description: Draft the technical approach for the active spec
---

<!-- >>> minspec:managed:slash-claude-plan >>> -->
# /minspec-plan — MinSpec Plan Phase

Run the **Plan** phase. Required for T2+.

Describe the technical approach, key decisions, and what is explicitly out of scope. Reference existing decisions in `docs/decisions/` rather than re-deciding.

**Design-aspect artifacts (shift-left — the approve gate checks these at T3/T4).** If the spec has any of these surfaces, include the matching artifact now so approval finds nothing missing:
- **ux** — Add a "## UX" section with a wireframe — an image (![…](…)), an ASCII layout box, or a ```mermaid``` diagram — before implementation.
- **api** — Add request/response payload shapes — a ```json``` example or a ```ts``` interface/type — under an "## API" section.
- **data** — Add the data shape — a ```sql``` DDL block, a ```mermaid erDiagram```, or a markdown table of columns.
- **architecture** — Add a ```mermaid``` diagram, a linked .puml/.drawio, or an ASCII component diagram under "## Architecture".

These are DESIGN-phase deliverables; in split-layout specs they live in `design.md`. T1 specs are exempt, T2 warns, T3/T4 block — so authoring them up front is what keeps approval clean.

Honour the dependency budget recorded in `CLAUDE.md` (0-1 for simple, 2-3 for complex). Update the Plan section of the active spec. Arguments: $ARGUMENTS
<!-- <<< minspec:managed:slash-claude-plan <<< -->
