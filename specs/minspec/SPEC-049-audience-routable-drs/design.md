---
id: SPEC-049
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-049 is T3.)
# This file has no approval record of its own: only requirements.md is signed, so status
# and phases describe and never seal. requirements.md's own `phases:` is advanced
# separately; this plan does not edit requirements.md.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness
relates_to: [DR-068, DR-029, DR-056, DR-081, DR-088, SPEC-048, SPEC-022, SPEC-041, SPEC-045, SPEC-046, SPEC-109, "#2921", "#3276"]
implements: none
implements_reason: Plan document. The owned paths are listed under "Ownership" below; requirements.md keeps its `implements: none` placeholder until task 6.2 can declare them without staling the approval.
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-049 - Design: audience-routable decision records

## In plain terms

Some decisions change the product, not just the code: pricing, consent, offline use,
accessibility. Today only an architect signs those off. After this lands, a decision record
can say "this one affects the product", and then it needs a second sign-off from whoever owns
the product before it counts as accepted. Every new decision record also opens with a short
plain-words summary, and that summary is what the product owner signs. Nothing changes for
the 113 records already written.

## Grounding (read on `origin/main` at `a3a4a3e8`, 2026-10-28)

Re-read these before building; line numbers drift.

1. **The plain-language lead already exists, under another name.** The DR template
   (`packages/minspec/src/lib/adr-manager.ts:566`, `generateAdrContent`) has a
   `## In plain terms ...` section (heading text continues "what this changes for you"), placed fourth, after
   `## Costly to Refactor`. CI Rule 20 (`scripts/validate-frontmatter.ts:391`, predicate
   `scripts/lib/dr-required-sections.ts`, #2921) already **warns** on a DR without it, and the
   adopter twin is `DR_PLAIN_TERMS_RE` in `template-registry.ts:1825`. 33 of the 113 DRs carry
   the section, and in **all 33** it is the first `##` heading, so the corpus convention is
   "first", and only the template disagrees.
2. **AC-3 is already met in CI** by Rule 20. What is missing is a test that names AC-3, the
   "up top" position (FR-2), and the INDEX alignment (FR-2).
3. **Acceptance already writes an `ApprovalRecord`.** `applyStatus` in
   `packages/minspec/src/commands/adr.ts:228` gates on `assertHumanApprover`, flips
   `status:`, then writes a record to `.minspec/approvals/<DR path>.json` hashed with the
   canonical hasher. So the architect half of FR-3 is a SPEC-022 record today, and the
   business half cannot use the same sidecar file.
4. **The canonical hash covers the whole file minus `status`/`phases`**
   (`packages/shared/src/canonical.ts:14`). DR-088's strip of `implements:`/`affects:` is
   accepted but not built (`grep -c implements packages/shared/src/canonical.ts` is 0).
5. **Every sidecar consumer maps sidecar path to approvable by stripping the prefix and
   `.json`**: `approvableFor` in `scripts/approval-integrity.ts:129`, the artifact slice in
   `scripts/lib/alta-approval-only.ts:152`. `scripts/approval-provenance.py` reads `specPath`
   from the JSON and hashes that file with `spec_hash`. The docs lane admits anything under
   `.minspec/approvals/` (`.github/workflows/docs-lane.yml:100`).
6. **No audience exists in code.** `grep -rn audience packages/minspec/src scripts` returns
   nothing. SPEC-046 (plan #3289) adds a spec `audience:` field; it is not built.
7. **SPEC-048's jargon lint is planned, not built** (plan #3293): `jargon-lexicon.ts`
   (`parseLexicon`, `effectiveTerms`) and `jargon-lint.ts` (`lintLeadJargon(leadBody, terms)`,
   warnings only). FR-4 reuses those two modules and nothing else from SPEC-048.
8. `adr-manager.ts` is owned (`implements:`) by SPEC-041. `approval-store.ts` is `affects:`
   for SPEC-041, SPEC-046, SPEC-070, SPEC-096 and SPEC-140.

## Approach in one paragraph

The DR lead is the existing `## In plain terms` section, moved to the top of the template and
fed to the INDEX summary. A new pure module reads a DR's audience from one frontmatter flag,
`business-relevant`, and a deterministic keyword heuristic warns when a proposed DR looks
product-affecting but carries no flag. A business sign-off is an ordinary SPEC-022
`ApprovalRecord`, hashed exactly as the architect's acceptance record is, stored in a sibling
sidecar `.minspec/approvals/<DR path>.business.json`. Accepting a business-relevant DR is
refused unless that record is current, and a fatal CI rule refuses an `accepted`
business-relevant DR without it. The jargon advisory from SPEC-048 runs over the lead only.
Existing DRs are not touched: every new advisory reaches only `status: proposed` DRs.

## [A] The lead (FR-2, FR-5, AC-3)

- **Reuse, do not add.** The lead is the section whose `##` heading starts `In plain terms`
  (the same match Rule 20 uses). No second "Summary" section is introduced. FR-2's content
  (Context + Decision + product impact) is asked for by the template's comment prompt.
- **Template.** `generateAdrContent` moves its existing `## In plain terms ...` heading line
  first, directly under the H1, with a prompt asking for what was decided, why, and what
  changes for the product, in plain words. Move the heading line unchanged, byte for byte
  (it contains a dash character this plan does not retype), so Rule 20, its Python twin and
  the 33 existing DRs still match.
- **Lead extractor.** `extractDrLead(body)` in the new module returns the section body or
  `undefined`. It accepts any heading level Rule 20 accepts, ignores frontmatter, and stops at
  the next heading of the same or higher level.
- **Position advisory.** A `status: proposed` DR whose lead exists but is not the first `##`
  section warns ("decision record lead is not first"). Proposed only, because FR-5 rules out
  retro-fitting, and an accepted DR cannot be edited without a new decision. Missing-lead stays
  Rule 20's job: one rule, one message.
- **INDEX alignment.** `extractContextBody` (`adr-manager.ts:905`) prefers the lead when
  present, then Context, then Decision, then the first paragraph. Curated summaries are
  already preserved by the fingerprint marker (#191), so a hand-edited entry is not
  overwritten. The regenerated `docs/decisions/INDEX.md` lands in the same pull request as the
  change so the summary churn is reviewed once.
- **Rejected:** a separate `## Summary` lead section. Two plain-language sections would
  disagree, and 33 DRs already use `In plain terms` as the lead.
- **Rejected:** a missing-lead or position error. FR-5 says warn-first.

## [B] Audience and the flag (FR-1, RD-1, AC-1)

- **The flag.** `business-relevant: true | false`, top-level DR frontmatter. Absent means
  `false`. `drAudiences(frontmatter)` returns `['architect']` or `['architect', 'business']`.
  The audience is derived from the flag, never a second key, so the two cannot disagree.
- **Bad values fail closed.** Any value other than `true`/`false` (`yes`, `"true"`, `1`)
  makes `parseBusinessRelevant` return `{ ok: false, raw }`. The accept gate treats that as
  business-relevant (refuses without a business record) and CI reports it as an **error**,
  because a typo that silently skipped dual sign-off would be a silent gate (constitution
  invariant 2).
- **Heuristic (advisory).** `suggestBusinessRelevant(title, lead, decision)` matches a fixed
  keyword list at word boundaries, case-insensitively: price, pricing, billing, subscription,
  licence, license, consent, telemetry, privacy, personal data, GDPR, offline, accessibility,
  a11y, upsell, free tier, refund, terms of service. It returns the matched words. A
  `status: proposed` DR with matches and **no** `business-relevant` key warns, naming the
  words and the key to set. An explicit `business-relevant: false` silences it: the author has
  declared (RD-1). Never an error, never run on non-proposed DRs (FR-5).
- **Routing surfaces (AC-1).** A business-relevant DR without a current business record shows
  in the Decisions tree as `awaiting product sign-off` (description text and a distinct
  context value `adrNode.proposed.business`), and the business sign-off command lists it.
  Alt+A (`minspec.approveActive`, already bound) on such a DR routes to the business sign-off
  command instead of Accept; once the business record is current, Alt+A routes to Accept as
  today. That gives both sign-offs a keyboard path with no new chord.
- **Rejected:** an explicit `audience:` key on DRs. It would duplicate the flag, and the spec
  `audience:` field belongs to SPEC-046. If SPEC-046 lands a shared audience vocabulary,
  `drAudiences` maps onto it; that is a rename, not a redesign.
- **SPEC-109 note.** If the canonical frontmatter schema (SPEC-109) lands a closed key set for
  DRs, `business-relevant` must be in it. Task 2.1's test fails loudly if the key is rejected.

## [C] The business sign-off record (FR-3, RD-2, AC-2)

- **Same record, sibling file.** The business half is a SPEC-022 `ApprovalRecord` with
  `specPath` = the DR's repo-relative path, `specHash` = `canonicalSpecHash(DR file)`,
  `approvedBy` = `gitConfigEmail`, `migrated: false`, `baselineBlob: ''`, `tier` only when the
  DR declares one: exactly the fields `applyStatus` writes for the architect half. It is
  stored at `.minspec/approvals/<DR path>.business.json`. The role comes from the file name,
  never from a field in the record, which is the rule `approvableFor` already follows
  ("derived from its path, never its contents").
- **Writer.** `recordBusinessApproval(rootDir, drFilePath, email, now)` in the new module:
  `assertHumanApprover(email)` and `assertOptedIn(rootDir)` before any write (DR-056,
  SPEC-096), then hash, then write. It never touches `status:`. A business record on a DR that
  is not business-relevant is refused (nothing to sign).
- **Store change.** `approval-store.ts` gains an optional `role?: 'business'` on
  `sidecarPath`, `readRecord`, `writeRecord` and `removeRecord`, default unchanged. That is
  the smallest edit that reuses `isValidRecord`/`normalizeRecord` instead of copying them.
  `listRecords` and `listOrphanedRecords` keep working: a business sidecar's `specPath` is a
  live DR path, so it is neither malformed nor orphaned.
- **Hash scope: the whole DR, not only the lead.** FR-3 says the DR file is the approvable and
  the lead is the reviewed unit. Hashing the whole file (minus `status`/`phases`) means the
  architect's later `status: accepted` flip does not stale the business record, while any body
  edit does. **Cost, stated:** an architect editing the Rationale after the product owner signs
  must ask for a re-sign. **Rejected:** a lead-only hash. It needs a second hash function in TS
  and in `canonical.py`, and every witness (`approval-integrity.ts`,
  `approval-provenance.py`, `alta-approval-only.ts`) would need to know which function a
  sidecar used. Whole-file reuse leaves `approval-provenance.py` unchanged.
- **Accept gate.** `applyStatus` (`packages/minspec/src/commands/adr.ts:228`), on `status === 'accepted'`, after the
  approver check and before any write: if `drAudiences` includes `business` (or the flag is
  invalid) and `resolveStatus(readRecord(.., 'business'), canonicalSpecHash(file))` is not
  `approved`, throw a message naming the missing product sign-off and the command that gives
  it. The refusal leaves the DR bytes, INDEX and sidecars untouched. Placing it in
  `applyStatus` covers both Accept and Set Status -> accepted, as the approver check does.
- **Order.** Business sign-off first, then acceptance. The business record survives the
  status flip because `status` is stripped from the hash.
- **CI gate (AC-2, fatal).** New rule in `scripts/validate-frontmatter.ts`: every DR with
  `status: accepted` and `business-relevant: true` (or an invalid value) must have a business
  sidecar whose `specHash` equals the DR's canonical hash now. Missing, unreadable, or stale
  is an **error**. An exception while evaluating it is reported as a failure naming the rule,
  never swallowed (invariant 2). Corpus impact today: zero DRs carry the flag (only DR-068 and
  this spec mention the word), so main stays green.
- **Witnesses that map sidecar paths.** `approvableFor` (`approval-integrity.ts`) and the
  artifact slice in `alta-approval-only.ts` strip a trailing `.business` after `.json`, through
  one shared helper `approvableForSidecar(path) -> { approvable, role }` in the new module, so
  a business sign-off PR is judged like any approval-record PR: human actor, hash bound to the
  bytes landing, only the sidecar and its DR changed. Without this, a business sidecar maps to
  a non-existent `DR-NNN.md.business` and fails closed, visibly, which is safe but blocks the
  feature.
- **SPEC-045 ingress.** SPEC-045 (GitHub-native approval, not built) inherits this by writing
  through `recordBusinessApproval`; no ingress is built here.
- **Rejected:** a separate root such as `.minspec/approvals-business/`. `approval-integrity`
  only runs when a changed file is under `.minspec/approvals/`, so a business-only PR would
  skip the integrity check entirely: a silent gate.
- **Rejected:** a `role` field inside the record. Two sources of truth (name and field) that
  could disagree, and an edit to SPEC-041's record type.

## [D] Jargon advisory on the lead only (FR-4, AC-4)

- CI: a rule that, for each `status: proposed` DR, runs SPEC-048's
  `lintLeadJargon(extractDrLead(body), effectiveTerms(lexicon, defaultAudience))` and reports
  each finding as a warning. The body outside the lead is never passed in, so body jargon
  cannot warn (AC-4). An unreadable lexicon yields one warning saying the DR jargon advisory
  checked nothing this run (SPEC-048's `{ ok: false }` contract).
- Editor: the same findings as warning diagnostics on an open DR file, through SPEC-048's
  diagnostics mapper, scoped to the lead's line range.
- **Dependency.** Slice 5 starts only after SPEC-048's `jargon-lexicon.ts` and
  `jargon-lint.ts` are on main. A task that finds them absent stops with `DEEPER:`; it does not
  write its own lexicon (FR-4 says reuse).

## [E] Adopter parity

The adopter `validate.py` (`template-registry.ts`) carries the DR checks adopters run in CI.
The fatal AC-2 rule and the invalid-flag error get a Python twin there, beside
`DR_PLAIN_TERMS_RE`, so an adopter's CI refuses an accepted business-relevant DR without its
sign-off just as this repo's does. The advisories (heuristic, position, jargon) stay TS-only;
the editor shows them to adopters. That change is machinery and merges through the machinery
lane.

## Ownership (declared at task 6.2)

New, owned by SPEC-049:
`packages/minspec/src/lib/dr-audience.ts`, `packages/minspec/src/lib/dr-business-approval.ts`,
`packages/minspec/tests/dr-audience.test.ts`, `packages/minspec/tests/dr-business-approval.test.ts`,
`packages/minspec/tests/dr-lead.test.ts`, `packages/minspec/tests/dr-dual-acceptance-rule.test.ts`.

Edited (`affects:`): `packages/minspec/src/lib/adr-manager.ts` (SPEC-041 owns it: the PR body
says so and links SPEC-041),
`packages/minspec/src/lib/approval-store.ts`, `packages/minspec/src/commands/adr.ts`,
`packages/minspec/src/commands/approve-active.ts`, `packages/minspec/src/views/adr-tree-provider.ts`,
`packages/minspec/src/extension.ts`, `packages/minspec/package.json`,
`scripts/validate-frontmatter.ts`, `scripts/approval-integrity.ts`,
`scripts/lib/alta-approval-only.ts`, `packages/minspec/src/lib/template-registry.ts`,
`docs/decisions/INDEX.md` (regenerated).

## Risks

| Risk | Mitigation |
|---|---|
| A witness that maps sidecar paths is missed and blocks business sign-off PRs | Fails closed and visibly; task 4.2 greps every `'.minspec/approvals/'` literal and lists each one it checked in its PR body |
| INDEX regen rewrites 33 summaries | Same PR as the extractor change; curated entries keep their text (#191) |
| SPEC-048 slips | Slices 1 to 4 and 6 do not depend on it; only slice 5 waits |
| Concurrent CI rule numbering collides (SPEC-048 also adds a rule) | Take the next free number at build time; tests key on the message text, not the number |
| Solo founder signs both halves | Honest: two records, each attributed to the human who acted. Dual sign-off in team mode is the purpose; solo mode pays two Alt+A presses |
