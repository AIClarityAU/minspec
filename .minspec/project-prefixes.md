# Project Prefixes

Short, stable prefixes that disambiguate **cross-project** references in this
workspace. Per-repo-local ids stay unprefixed — DR-027 keeps a separate SDD
register per repo, so a bare `SPEC-001` always means *this* repo's `SPEC-001`
(see [DR-053](../docs/decisions/DR-053.md)). A reference that **spans projects**
carries its target project's prefix:

- **SDD refs:** `<PREFIX>-<ID>` — e.g. `MS-SPEC-019`, `SC-DR-007`, `SB-EPIC-002`.
- **Issue / PR refs:** `<PREFIX>#<N>` — e.g. `MS#500`, `SC#26`.

To add a project, add a row. Prefixes are **UPPERCASE**, 2 letters where
possible, and must be **unique**. MinSpec's Tier-0 core reads this table
deterministically; an unknown prefix is **advisory** — the assistant suggests a
prefix and offers to edit this file — never a hard failure.

| Prefix | Project | Repo                   |
|--------|---------|------------------------|
| MS     | minspec | AIClarityAU/minspec    |
| SC     | scrooge | AIClarityAU/scroogellm |
| SB     | sealbox | AIClarityAU/sealbox    |
