---
id: SPEC-009
type: tasks
status: implementing
product: minspec
---

# MinSpec — Registered Epics & Grouping (Tasks)

**Date:** 2026-05-30
**Design:** [design.md](design.md)

---

## T1 — Foundation: epic-manager (the contract)

- [ ] `lib/config.ts`: add `epicsDir` (default `docs/epics`), mirror `decisionsDir`.
- [ ] `lib/epic-manager.ts`: `EpicFrontmatter`/`EpicSummary`/`EpicStatus`,
      `listEpics`, `resolveEpic`, `nextEpicId`, `createEpic`, `writeEpicIndex`,
      `groupByEpic`, `NO_EPIC`. Reuse adr-manager YAML pattern + markers.
- [ ] `test/epic-manager.test.ts`: T1 contract tests (sort, id+slug resolve,
      padding, NO_EPIC bucketing).

## T2 — Frontmatter fields (additive)

- [ ] `lib/spec.ts`: `SpecFrontmatter.epic?`, parse `epic:` line.
- [ ] `lib/spec-manager.ts`: `SpecSummary.epic?` carried through.
- [ ] `lib/adr-manager.ts`: `AdrFrontmatter.epic?` + `AdrSummary.epic?` + populate.

## T3 — Explorer grouping (parallel, one file each)

- [ ] `views/spec-tree-provider.ts`: epic group layer + toggle + badge.
- [ ] `views/adr-tree-provider.ts`: epic group layer + toggle + badge.
- [ ] `views/backlog-view.ts`: `extractEpicSlug` + epic group layer + toggle.

## T4 — Create Epic command

- [ ] `commands/create-epic.ts`: prompt + createEpic + writeEpicIndex + open.
- [ ] `package.json`: command + 3 toggle commands + titlebar menus.
- [ ] `extension.ts`: register command + toggle handlers.

## T5 — Completion + scaffold + validation

- [ ] `views/frontmatter-completion.ts`: `epic:` key + value completion.
- [ ] `lib/scaffold.ts`: create `docs/epics/` + empty INDEX on init.
- [ ] validator: unresolved `epic:` ref → warning diagnostic (not block).

## T6 — Verify

- [ ] T0 invariant tests (toggle-off identical, unknown ref no-throw, markers-only).
- [ ] T2 feature tests (provider groups + badges, label resolution).
- [ ] `npm run build && npm run lint && npm test && npm run validate` green.
