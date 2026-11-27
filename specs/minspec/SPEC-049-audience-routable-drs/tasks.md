---
id: SPEC-049
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-049 is T3.)
# This file has no approval record of its own: only requirements.md is signed, so status
# and phases describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness
relates_to: [DR-068, DR-029, SPEC-048, SPEC-022, SPEC-041, "#3276"]
implements: none
implements_reason: Task list. Owned paths are listed in design.md "Ownership"; task 6.2 declares them in requirements.md only when that no longer stales its approval.
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-049 - Tasks

The contract is [requirements.md](./requirements.md) (FR-1..FR-5, AC-1..AC-4, RD-1, RD-2).
The approach is [design.md](./design.md); section letters [A]..[E] below point into it.
Build issue: #3276.

Each numbered task is one pull request: one concern, its own test, green when it lands.
Line numbers are from `origin/main` at `a3a4a3e8`; re-read them before editing. A task that
finds the code no longer matches what it describes stops with `DEEPER:` and does not
improvise.

Every backticked path under a task is a file it edits or creates. Files it only reads are
named in prose.

## Order, and why

1. **The lead slice** - template, extractor, INDEX alignment, position advisory. No gate.
2. **The audience slice** - the flag, its parser, the heuristic. Dark: no DR carries the flag.
3. **The record slice** - the business sidecar and its writer. Nothing reads it yet.
4. **The gate slice** - accept refusal, fatal CI rule, witnesses. Safe because no DR carries
   the flag, so nothing on main is newly refused.
5. **The jargon slice** - waits for SPEC-048's `jargon-lexicon.ts` and `jargon-lint.ts` on main.
6. **The surfaces slice** - tree, Alt+A routing, adopter parity, ownership.

Tasks inside a slice may run in parallel unless a task says otherwise.

## 1 - The lead slice (FR-2, FR-5, AC-3; design [A])

- [ ] **1.1** Lead extractor. Create `packages/minspec/src/lib/dr-audience.ts` with
  `extractDrLead(content): { body: string; startLine: number; isFirstH2: boolean } | undefined`:
  frontmatter ignored, heading matched as Rule 20 matches it (`scripts/lib/dr-required-sections.ts`
  `PLAIN_TERMS_HEADING`, imported or re-exported, never copied), section ends at the next
  heading of the same or higher level. Pure, no `fs`.
  *Test:* `packages/minspec/tests/dr-lead.test.ts` - lead first; lead after Context
  (`isFirstH2: false`); no lead (`undefined`); `###` lead accepted; CRLF input; a heading
  inside a fenced code block is not a lead. Parity: for every `docs/decisions/DR-*.md` on
  disk, `extractDrLead(c) !== undefined` equals `hasPlainTermsSection(c)`.
  *Done when:* those pass and `npm run typecheck` is clean.

- [ ] **1.2** Template puts the lead first. `packages/minspec/src/lib/adr-manager.ts` -
  in `generateAdrContent` (`:566`) move the existing `## In plain terms ...` line and its
  comment to directly under the H1, heading bytes unchanged; reword the comment to ask for
  what was decided, why, and what changes for the product, in plain words, no jargon.
  `adr-manager.ts` is owned by SPEC-041: the PR body says so.
  *Test:* `packages/minspec/tests/dr-lead.test.ts` - `extractDrLead(generateAdrContent(...))`
  is defined with `isFirstH2: true`, and `hasPlainTermsSection` still returns true. Existing
  `adr-manager.test.ts` passes; update only assertions that pinned the old section order.
  *Done when:* those pass.

- [ ] **1.3** INDEX summary prefers the lead. `packages/minspec/src/lib/adr-manager.ts` -
  `extractContextBody` (`:905`) returns the lead body (via `extractDrLead`) when present, then
  Context, Decision, first paragraph as today. `docs/decisions/INDEX.md` - regenerate it in the
  same PR by calling `regenerateDrIndex` (the function `applyStatus` in
  `commands/adr.ts` calls after a status change). Depends on 1.1.
  *Test:* `packages/minspec/tests/dr-index.test.ts` - a DR with both lead and Context
  summarises the lead; one with only Context is unchanged; a curated INDEX entry survives
  regeneration (the existing #191 case still passes).
  *Done when:* those pass and `npm run validate` reports no new failure.

- [ ] **1.4** Position advisory on proposed DRs. `scripts/validate-frontmatter.ts` - beside
  Rule 20, for each DR with `status: proposed` whose `extractDrLead` result has
  `isFirstH2: false`, warn `<file>: decision record lead (In plain terms) is not the first
  section (SPEC-049 FR-2).` Accepted, superseded and deprecated DRs are never checked (FR-5).
  A thrown error is reported as a warning saying the check validated nothing this run, never
  swallowed. Depends on 1.1.
  *Test:* `packages/minspec/tests/dr-lead.test.ts` - drive the predicate the rule calls, export
  it from `dr-audience.ts` as `drLeadPositionFindings(files)`: proposed + lead second warns;
  accepted + lead second does not; proposed + no lead does not (Rule 20 owns that). Plus one
  test naming AC-3: a DR without a lead is listed by `drsMissingPlainTerms`.
  *Done when:* those pass and `npm run validate` on main adds no warning for an accepted DR.

## 2 - The audience slice (FR-1, RD-1, AC-1; design [B])

- [ ] **2.1** Flag parser and audiences. `packages/minspec/src/lib/dr-audience.ts` -
  `parseBusinessRelevant(frontmatter): { ok: true; value: boolean } | { ok: false; raw: string }`
  (absent is `{ ok: true, value: false }`; only YAML booleans `true`/`false` are ok) and
  `drAudiences(frontmatter): ('architect' | 'business')[]`, returning `business` for `true` and
  for any `{ ok: false }` value (fail closed). `packages/minspec/src/lib/adr-manager.ts` -
  `AdrFrontmatter` and `AdrSummary` gain `readonly businessRelevant?: boolean | 'invalid'`,
  filled by `listAdrs` (`:1405`). Depends on 1.1 (same file).
  *Test:* `packages/minspec/tests/dr-audience.test.ts` - absent, `true`, `false`, `yes`,
  `"true"`, `1`, empty value; `drAudiences` for each; `listAdrs` over a temp register returns
  the field. If a frontmatter schema check (SPEC-109) rejects the key, this test fails: stop
  with `DEEPER:`.
  *Done when:* those pass.

- [ ] **2.2** Heuristic advisory. `packages/minspec/src/lib/dr-audience.ts` -
  `BUSINESS_KEYWORDS` (design [B] list) and `suggestBusinessRelevant(title, lead, decision):
  string[]`, word-boundary, case-insensitive, deterministic order. `scripts/validate-frontmatter.ts`
  - for each `status: proposed` DR with matches and no `business-relevant` key, warn naming
  the matched words and the key to set. Explicit `false` is silent. Never an error. Depends on 2.1.
  *Test:* `packages/minspec/tests/dr-audience.test.ts` - "pricing" in the lead matches;
  "priced" does not match "price" unless listed; `business-relevant: false` silences;
  an accepted DR never warns; output order is stable across runs.
  *Done when:* those pass and `npm run validate` on main adds no warning (no DR is proposed
  with matches and no key, or the PR lists the ones it now flags).

## 3 - The record slice (FR-3, RD-2; design [C])

- [ ] **3.1** Store role parameter. `packages/minspec/src/lib/approval-store.ts` - optional
  `role?: 'business'` on `sidecarPath`, `readRecord`, `writeRecord`, `removeRecord`; with it
  the file is `<posix-rel>.business.json`, without it nothing changes. `listRecords` and
  `listOrphanedRecords` unchanged.
  *Test:* `packages/minspec/tests/dr-business-approval.test.ts` - default path byte-identical
  to today for a spec and a DR path; `role: 'business'` path ends `.md.business.json`; a
  business record round-trips; `listOrphanedRecords` does not flag a business sidecar for a
  live DR. Existing `approval-store` and `approval` tests pass unchanged.
  *Done when:* those pass.

- [ ] **3.2** Writer. Create `packages/minspec/src/lib/dr-business-approval.ts` with
  `recordBusinessApproval(rootDir, drFilePath, email, now?)` and
  `businessApprovalStatus(rootDir, drFilePath): 'approved' | 'stale' | 'unapproved'`.
  Order: `assertHumanApprover(email)`, `assertOptedIn(rootDir)`, refuse when
  `drAudiences` lacks `business`, read once, `canonicalSpecHash`, write via
  `writeRecord(.., { role: 'business' })` with the same fields `applyStatus`
  (`packages/minspec/src/commands/adr.ts:290`) writes. Never edits the DR. Also export
  `approvableForSidecar(sidecarRel): { approvable: string; role: 'architect' | 'business' } | undefined`
  for task 4.2. Depends on 2.1, 3.1.
  *Test:* `packages/minspec/tests/dr-business-approval.test.ts` - a bot identity throws
  `ApproverDeniedError` and writes nothing; a non-opted-in folder throws and writes nothing; a
  non-business DR is refused; status is `approved` after writing, `stale` after a body edit,
  still `approved` after a `status:` flip; `approvableForSidecar` maps both suffixes and
  returns `undefined` outside `.minspec/approvals/` or for a `..` path.
  *Done when:* those pass.

## 4 - The gate slice (FR-3, AC-2; design [C])

- [ ] **4.1** Accept refuses without a current business sign-off.
  `packages/minspec/src/commands/adr.ts` - in `applyStatus`, inside the
  `status === 'accepted'` block after `assertHumanApprover` and the #3106 check, before any
  write: if `drAudiences` includes `business` and `businessApprovalStatus` is not `approved`,
  throw `<id> is product-affecting (business-relevant) and has no current product sign-off.
  Run "MinSpec: Approve Decision for Product" first.` Depends on 3.2.
  *Test:* `packages/minspec/tests/adr-command.test.ts` - business-relevant DR with no record:
  accept refused, DR bytes, INDEX and sidecars unchanged; with a stale record: refused; with a
  current record: accepted and the business record is still `approved` afterwards; a
  non-business DR accepts as before; an invalid flag value is refused like `true`; Set Status
  -> accepted is refused the same way.
  *Done when:* those pass.

- [ ] **4.2** Witnesses read business sidecars. `scripts/approval-integrity.ts` -
  `approvableFor` (`:129`) delegates to `approvableForSidecar`.
  `scripts/lib/alta-approval-only.ts` - the artifact slice (`:152`) does the same. Before
  editing, grep every `'.minspec/approvals/'` literal under `scripts/`, `.github/` and
  `packages/minspec/src/`, and list in the PR body each site checked and why it needs no
  change (e.g. `approval-provenance.py` reads `specPath` from the JSON). A business sidecar PR
  must still pass every integrity check a normal approval PR passes. Depends on 3.2.
  This touches merge-lane machinery: the PR body says so.
  *Test:* `packages/minspec/tests/approval-integrity.test.ts` - a PR changing only
  `docs/decisions/DR-X.md` and its `.business.json` with a human actor and a matching hash
  passes; a bot actor fails; a hash for other bytes fails; a business sidecar whose DR is also
  edited in a non-lifecycle way fails as the architect case does.
  `packages/minspec/tests/alta-approval-only.test.ts` - a business sidecar maps to its DR.
  *Done when:* those pass.

- [ ] **4.3** Fatal CI rule. Create `packages/minspec/tests/dr-dual-acceptance-rule.test.ts`.
  `packages/minspec/src/lib/dr-business-approval.ts` - pure
  `dualAcceptanceFailures(rootDir, drs): { file: string; reason: 'missing' | 'stale' | 'invalid-flag' | 'unreadable' }[]`.
  `scripts/validate-frontmatter.ts` - a numbered FATAL rule (next free number) calling it for
  every DR: `status: accepted` with `business-relevant: true` and no current business record
  fails; any DR with an invalid flag value fails; an exception fails the rule with a message
  naming it (invariant 2), never `catch {}`. Depends on 3.2.
  *Test:* `packages/minspec/tests/dr-dual-acceptance-rule.test.ts` - each reason fires; an
  accepted DR without the flag passes; a proposed business-relevant DR without a record passes
  (not accepted yet); run the CLI against the real register and assert exit 0 (no DR on main
  carries the flag).
  *Done when:* those pass and `npm run validate` exits 0 on the branch.

## 5 - The jargon slice (FR-4, AC-4; design [D])

Starts only when `packages/minspec/src/lib/jargon-lexicon.ts` and
`packages/minspec/src/lib/jargon-lint.ts` exist on `origin/main` (SPEC-048 tasks 4.2 and 5.2).
Absent: stop with `DEEPER: SPEC-048 jargon modules not on main`.

- [ ] **5.1** CI advisory on the lead. `packages/minspec/src/lib/dr-audience.ts` -
  `drLeadJargonFindings(content, terms)` runs `lintLeadJargon` over `extractDrLead(content).body`
  only and offsets line numbers by `startLine`. `scripts/validate-frontmatter.ts` - for each
  `status: proposed` DR, one warning per finding; an unreadable lexicon gives one warning that
  the DR jargon advisory checked nothing this run. Depends on 1.1.
  *Test:* `packages/minspec/tests/dr-lead.test.ts` - a seed term in the lead warns with the
  right line; the same term only in Rationale does not (AC-4); an accepted DR is not checked;
  an unreadable lexicon gives the single warning.
  *Done when:* those pass.

- [ ] **5.2** Editor diagnostics on the lead. `packages/minspec/src/extension.ts` - register
  the SPEC-048 lead-diagnostics mapper for DR files (`classifyApprovablePath` is `adr`), fed
  by `drLeadJargonFindings`. If SPEC-048's mapper is not exported for reuse, stop with
  `DEEPER:` rather than copying it. Depends on 5.1.
  *Test:* `packages/minspec/tests/dr-lead.test.ts` - the pure findings-to-diagnostics step
  for a DR yields warnings only inside the lead's line range.
  *Done when:* that passes and the rebuilt .vsix shows a squiggle on a lead term in a DR.

## 6 - The surfaces slice (AC-1; design [B], [E])

- [ ] **6.1** Business sign-off command, tree state, Alt+A routing.
  `packages/minspec/src/commands/adr.ts` - `approveAdrForProductCommand`: picks among
  business-relevant DRs whose `businessApprovalStatus` is not `approved`, opens the DR so the
  lead is visible, calls `recordBusinessApproval`, commits the sidecar via
  `commitApprovalIfEnabled` with message `chore(approve): <id> product sign-off`.
  `packages/minspec/package.json` - command `minspec.approveAdrForProduct`, title
  `MinSpec: Approve Decision for Product`, inline and context menu on
  `viewItem == adrNode.proposed.business`. `packages/minspec/src/extension.ts` - register it.
  `packages/minspec/src/views/adr-tree-provider.ts` - a proposed business-relevant DR without a
  current record gets context value `adrNode.proposed.business` and description
  `awaiting product sign-off`; the menus that match `adrNode.proposed` today must still match
  it (use a regex `when` clause or list both). `packages/minspec/src/commands/approve-active.ts`
  - for kind `adr`, route to `minspec.approveAdrForProduct` when the DR is business-relevant
  and its business record is not `approved`, else `minspec.acceptAdr` as today. Depends on 3.2, 4.1.
  *Test:* `packages/minspec/tests/adr-tree-provider.test.ts` - context value and description
  for the three cases (non-business, business without record, business with record).
  `packages/minspec/tests/dr-business-approval.test.ts` - the routing function exported from
  `approve-active.ts` returns the product command, then the accept command once a record
  exists (AC-1).
  *Done when:* those pass and the rebuilt .vsix shows the tree state and Alt+A routes.

- [ ] **6.2** Adopter parity and ownership. `packages/minspec/src/lib/template-registry.ts` -
  in the shipped `validate.py`, beside `DR_PLAIN_TERMS_RE` (`:1825`, `:2232`), a fatal check
  matching task 4.3: an accepted DR with `business-relevant: true`, or any DR with an invalid
  flag value, must have `.minspec/approvals/<path>.business.json` whose `specHash` equals
  `spec_hash` of the DR; unreadable is a failure, never a pass. Machinery: merges through the
  machinery lane. Then, only if `packages/shared/src/canonical.ts` strips `implements:` by now
  (DR-088 section 1 shipped), replace `implements: none` in
  `specs/minspec/SPEC-049-audience-routable-drs/requirements.md` with the owned paths from
  design.md "Ownership" and add `affects:`; otherwise leave it and add one dated line to
  `docs/backlog.md` saying the declaration waits on DR-088 section 1. Depends on 4.3.
  *Test:* `packages/minspec/tests/dr-dual-acceptance-rule.test.ts` - run the shipped
  `validate.py` through a python3 subprocess on a temp register: missing, stale and
  invalid-flag cases fail; a current record passes; a TS/Python parity table over the same
  fixtures gives the same verdicts.
  *Done when:* those pass, `npm test` is green, and every AC-1..AC-4 checkbox in
  requirements.md maps to a passing test named in this file (list them in the PR body; do not
  tick the boxes in requirements.md, which would stale its approval).
