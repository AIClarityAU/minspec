---
id: SPEC-047
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-047 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness
relates_to: [DR-068, SPEC-045, "#1138"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-047 - Tasks

In build order. Each task fits one agent run. The plan and its decisions (D-1 to D-7) are in
[design.md](design.md); the contract is [requirements.md](requirements.md). Each *Files:* field lists
what that task edits or creates. New tests go in `packages/minspec/tests/audience-separation.test.ts`,
written before the code they cover.

## The scaffold-the-split slice (FR-5 cut-off, FR-6, AC-4) - ready to build

- [ ] **T1 - Cut-off config and helper.** Add the optional `audienceSeparation` key (`severity`,
  `grandfatherBelow`) to `MinspecConfig`, and `isGrandfathered(specId, config)` to the new module.
  *Reqs:* FR-5, D-1. *Files:* `packages/minspec/src/lib/config.ts`,
  `packages/minspec/src/lib/audience-map.ts`, `packages/minspec/tests/audience-separation.test.ts`.
  *Test:* below, at and above the cut-off; key absent; key non-numeric; unparseable id is not
  grandfathered. *Needs:* none.
- [ ] **T2 - New configs start at the right cut-off.** Add `initialAudienceGrandfather(rootDir)`
  (highest `SPEC-NNN` under the specs directory, plus one) and write it beside
  `ownershipDeclaration` where `scaffold()` creates a config. Set this repo's own value to the next
  free id at build time.
  *Reqs:* FR-5, D-1. *Files:* `packages/minspec/src/lib/audience-map.ts`,
  `packages/minspec/src/lib/scaffold.ts`, `.minspec/config.json`,
  `packages/minspec/tests/audience-separation.test.ts`.
  *Test:* empty and populated specs trees; an existing config is left alone. *Needs:* T1.
- [ ] **T3 - `design.md` scaffolder.** Add `buildDesignMdContent` and `scaffoldDesignMd`, sharing a
  frontmatter builder with the `tasks.md` pair, and `findSpecDirsMissingDesignMd`, which returns T3/T4
  split specs at or above the cut-off and nothing when the key is unset.
  *Reqs:* FR-6, FR-5, D-2. *Files:* `packages/minspec/src/lib/scaffold.ts`,
  `packages/minspec/tests/audience-separation.test.ts`.
  *Test:* never overwrites; CRLF source; `tasks.md` output byte-identical to before; T1 and T2 skipped;
  pre-rule spec skipped; the scaffolded file passes the frontmatter gate. *Needs:* T1.
- [ ] **T4 - Widen the bootstrap offer.** The existing step also fires for, reports in its signature,
  and creates, missing `design.md` files.
  *Reqs:* FR-6, AC-4, D-2. *Files:* `packages/minspec/src/lib/auto-bootstrap.ts`,
  `packages/minspec/tests/ensure-tasks-md-bootstrap.test.ts`,
  `packages/minspec/tests/audience-separation.test.ts`.
  *Test:* a new T3 `requirements.md`-only spec ends with all three files on the primary choice; no
  write without it; the skip flag holds. *Needs:* T3.
- [ ] **T5 - Prompt text.** `specify` and `plan` guidance tell a T3/T4 author to create the three files
  and put contracts and invariants in `design.md`; T1/T2 may stay single-file.
  *Reqs:* FR-3, FR-4, FR-6, AC-4, DR-068 decision 1. *Files:*
  `packages/minspec/src/lib/slash-commands.ts`, `packages/minspec/tests/audience-separation.test.ts`.
  *Test:* both rendered bodies carry the rule; the existing shim tests stay green. *Needs:* none.

## The map-and-warning slice (FR-1 to FR-5, AC-1 to AC-3, RD-2) - blocked

Nothing below starts until the founder settles RD-1's missing registry (see "Open item" in
design.md). If the answer moves the map out of `audience-map.ts`, these tasks are re-planned first.

- [ ] **T6 - The map.** `AUDIENCE_MAP` defaults (`requirements.md` to PO; `design.md`, `tasks.md` to
  engineering), merged with `audienceFiles` from config, N rows.
  *Reqs:* FR-1, D-6. *Files:* `packages/minspec/src/lib/audience-map.ts`,
  `packages/minspec/src/lib/config.ts`, `packages/minspec/tests/audience-separation.test.ts`.
  *Test:* defaults; an added role; `audiences` left unread. *Needs:* founder decision on RD-1, T1.
- [ ] **T7 - Mixed-file detector.** `findMixedAudienceContent(markdown)` per D-4 and D-5.
  *Reqs:* FR-2, D-4, D-5. *Files:* `packages/minspec/src/lib/audience-map.ts`,
  `packages/minspec/tests/audience-separation.test.ts`.
  *Test:* both headings; an `INV-` bullet; a match inside a code fence is ignored; `FR-`, `AC-` and
  `RD-` lines are not flagged; CRLF. *Needs:* founder decision on RD-1, T6.
- [ ] **T8 - The warning rule.** `validateAudienceSeparation`, called from `validateSpec` beside
  `validateOwnership`: T3/T4 only, reading `tier:` only, skipping grandfathered specs, severity from
  config with `warn` as default. It covers a split `requirements.md` and a single-file spec alike.
  *Reqs:* FR-2, FR-3, FR-4, FR-5, AC-1, AC-2, AC-3. *Files:*
  `packages/minspec/src/lib/spec-validator.ts`, `packages/minspec/src/lib/spec-layout.ts`,
  `packages/minspec/tests/audience-separation.test.ts`.
  *Test:* AC-1 warns; AC-2 silent at T1; AC-3 warning by default and a pre-rule spec unaffected;
  `error` when promoted. *Needs:* founder decision on RD-1, T7.
- [ ] **T9 - Repo gate wiring.** The corpus validator calls the same function, not a copy.
  *Reqs:* FR-5. *Files:* `scripts/validate-frontmatter.ts`,
  `packages/minspec/tests/audience-separation.test.ts`.
  *Test:* `npm run validate` adds zero warnings on the current corpus with the cut-off set, and one on
  a planted post-cut-off fixture. *Needs:* founder decision on RD-1, T2, T8.
- [ ] **T10 - CODEOWNERS render and drift.** `renderCodeownersBlock` and `codeownersDrift` per D-3,
  reported as a warning with the expected block.
  *Reqs:* FR-1, RD-2, D-3. *Files:* `packages/minspec/src/lib/audience-map.ts`,
  `scripts/validate-frontmatter.ts`, `packages/minspec/tests/audience-separation.test.ts`.
  *Test:* in sync; a missing glob; an extra audience glob; team handles ignored; missing file gives a
  visible note. *Needs:* founder decision on RD-1, T6, T9.
