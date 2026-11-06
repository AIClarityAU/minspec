---
id: SPEC-048
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-048 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness
relates_to: [DR-068, SPEC-013, SPEC-006, SPEC-038, "#2921"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-048 - Tasks

**Requirements:** [requirements.md](requirements.md) · **Design:** [design.md](design.md)

The order below is the order of work; each numbered task is one pull request and one agent
run, and lands green on its own. Every task writes its failing test first and quotes the red
output in its pull request body. Section letters ([A]-[G]) point at design.md.

Every backticked path in this file is a file this change edits or creates. Files a task only
reads are named in prose, so the spec gate's ownership signal stays as narrow as the change.
Tasks 2, 7 and 8 all edit the validator, and tasks 9 and 10 both edit the extension entry
point, so each of those groups runs in sequence, never in parallel.

## 1 - The lead-zone predicate and its dial (FR-1, RD-2; design [A])

- [ ] **1.1** `packages/minspec/tests/lead-zone.test.ts` - cases: a `requirements` file whose
  first `##` is `In plain terms`, `Summary` or `One-sentence scope` (any case, with a suffix
  such as ` - what this changes for you`) passes; no lead heading gives `lead.missing`; a lead
  heading after `## Context` gives `lead.misplaced` naming `Context`; a blank or
  comment-only lead body gives `lead.empty`; `type: design`, `type: tasks`, and a typeless
  file named `design.md` or `tasks.md` are exempt; a typeless single-file spec is checked. At
  severity `'error'`: `approved: true` gives a warning, `approved: false` and `approved`
  omitted give an error. At `'warn'`: always a warning. A heading inside a fenced code block
  is not a heading.
- [ ] **1.2** `packages/minspec/src/lib/lead-zone.ts` - `LEAD_HEADINGS`, `extractLeadZone(raw)`
  returning `{ heading, body, line }` or `null`, and `checkLeadZone(spec, { approved,
  severity, fileName })`, pure, no `fs`, shaped like `checkAcceptanceCriteria` in
  spec-validator.ts.
- [ ] **1.3** `packages/minspec/src/lib/config.ts` - `leadZone?: 'warn' | 'error'` on
  `MinspecConfig`, `loadConfig` default `'warn'` when absent; a config test case in
  `packages/minspec/tests/lead-zone.test.ts` proves the default.
  *Done when:* 1.1 is green and `npm run validate` on main is unchanged (nothing calls it yet).

## 2 - The lead rule in `validateSpec` and its callers (FR-1, AC-1; design [A], [E])

- [ ] **2.1** `packages/minspec/tests/spec-validator-lead.test.ts` - `validateSpec` on a
  lead-less requirements file with config `leadZone: 'error'` and no `approvalState` returns
  a `lead.missing` error and `valid: false`; with `approvalState: 'approved'` the same
  finding is a warning and `valid` is unaffected by it; `violationsIntroducedByApproval` on
  that spec returns no `lead.*` finding (it cancels on both sides).
- [ ] **2.2** `packages/minspec/src/lib/spec-validator.ts` - a `fileName` field on
  `ValidateSpecOptions`; `validateSpec` pushes `checkLeadZone(...)` with
  `approved: approvalState === 'approved'` and the config dial.
- [ ] **2.3** `packages/minspec/src/commands/validate.ts`, `packages/minspec/src/commands/approve.ts`,
  `scripts/lib/delegated-approval.ts` - pass `fileName` (the spec's basename) at each existing
  `validateSpec` call. No other change to these files.
  *Done when:* 2.1 is green and the full suite passes unchanged at the default `'warn'`.

## 3 - The lead rule in CI (FR-1, AC-1; design [E])

- [ ] **3.1** `packages/minspec/tests/validate-lead-zone-rule.test.ts` - following the
  `dr-plain-terms-gate-2921.test.ts` shape, run `scripts/validate-frontmatter.ts` against a
  fixture root: at `leadZone: 'error'` an unapproved lead-less spec exits non-zero naming the
  file and `lead.missing`; a spec with a current approval sidecar warns and exits 0; at the
  default the unapproved one warns and exits 0.
- [ ] **3.2** `scripts/validate-frontmatter.ts` - a new numbered rule beside Rule 13 that
  globs the specs dir, reads approval with `getApprovalStatus` from approval.ts, calls
  `checkLeadZone`, and routes `error` to `fail` and `warning` to `warn`. An exception reading
  the corpus is a `warn` saying the rule validated nothing this run (Rule 20's form), never a
  bare `catch {}`.
  *Done when:* 3.1 is green and `npm run validate` on main exits 0.

## 4 - The lexicon and its writer (FR-3, RD-1, AC-3; design [B])

- [ ] **4.1** `packages/minspec/tests/jargon-lexicon.test.ts` - a missing file yields the seed
  for audience `po`; `add` extends it; a seed term in `allow` is removed (AC-3); `allow` beats
  `add`; malformed JSON and an undefined `defaultAudience` each return `{ ok: false, reason }`
  naming the file, never the seed; `addAllowedTerm` on absent, empty and populated input
  returns valid JSON with the term once (adding a present term is a no-op) and keeps
  non-ASCII characters as written.
- [ ] **4.2** `packages/minspec/src/lib/jargon-lexicon.ts` - `JARGON_SEED` (literal and pattern
  entries from design [B]), `parseLexicon(text | undefined)`, `effectiveTerms(lexicon,
  audience?)`, `addAllowedTerm(text | undefined, term)`. Pure; the caller reads and writes
  the file.
  *Done when:* 4.1 is green.

## 5 - The jargon advisory (FR-2, FR-6, AC-2; design [C])

- [ ] **5.1** `packages/minspec/tests/jargon-lint.test.ts` - each seed class (a literal word,
  `T0`-`T4`, `name()`, a path, a backticked path) is flagged once with the right line and
  column; matches are whole-word (`gateway` is not `gate`); text outside the lead and inside
  frontmatter is never scanned; every finding has severity `warning`; a clean lead returns an
  empty array. A fixture of five real `## In plain terms` leads copied from main records the
  current false-positive count in the test, so a seed change that raises it is visible.
- [ ] **5.2** `packages/minspec/src/lib/jargon-lint.ts` - `lintLeadJargon(leadBody, terms)`
  returning findings `{ term, line, column, entry }`, rule id `jargon.term`. Pure.
  *Done when:* 5.1 is green.

## 6 - The vacuity guard (FR-4, AC-4; design [D])

- [ ] **6.1** `packages/minspec/tests/lead-vacuity.test.ts` - a 7-word lead warns, an 8-word
  one with new content does not; a lead that restates the title warns `lead.vacuous`; a lead
  of only `TBD.` or `See below.` warns; a real lead from main does not; a lead with jargon is
  not checked (the caller's order, asserted through the exported `checkLeadAdvisories`).
- [ ] **6.2** `packages/minspec/src/lib/lead-vacuity.ts` - `checkLeadVacuity(leadBody, title)`
  and `checkLeadAdvisories(leadBody, title, terms)` (jargon first, vacuity only when jargon
  is empty). Pure.
  *Done when:* 6.1 is green.

## 7 - Advisories in `validateSpec` (FR-2, FR-4, FR-7; design [C], [E])

- [ ] **7.1** `packages/minspec/tests/spec-validator-lead.test.ts` - with a `lexicon` option a
  lead containing `frontmatter` yields a `jargon.term` warning and `valid` stays true; a
  vacuous jargon-free lead yields `lead.vacuous`; with no `lexicon` option no advisory runs
  and no error is raised; a `{ ok: false }` lexicon yields one `jargon.lexicon-unreadable`
  warning naming the file.
- [ ] **7.2** `packages/minspec/src/lib/spec-validator.ts` - a `lexicon` field on
  `ValidateSpecOptions`, and the advisory call after the lead check.
- [ ] **7.3** `packages/minspec/src/lib/config.ts` - `jargonAdvisory?: 'warn' | 'wide'`,
  default `'warn'`; `packages/minspec/src/commands/validate.ts` reads
  `.minspec/jargon-lexicon.json` and passes the parsed lexicon.
  *Done when:* 7.1 is green.

## 8 - Advisories in CI, without a retro-fit (FR-7; design [C], [E])

- [ ] **8.1** `packages/minspec/tests/validate-lead-zone-rule.test.ts` - an unapproved spec with
  a jargon lead warns and exits 0; an approved one is silent at `'warn'` and warns at
  `'wide'`; an unreadable lexicon gives one warning that the advisory validated nothing this
  run, and the seed is not used in its place.
- [ ] **8.2** `scripts/validate-frontmatter.ts` - extend task 3's rule to run
  `checkLeadAdvisories` per the dial; all output through `warn`.
  *Done when:* 8.1 is green and `npm run validate` on main still exits 0.

## 9 - Editor squiggles and the add-term command (FR-2, FR-3, FR-4; design [B], [E])

- [ ] **9.1** `packages/minspec/tests/lead-diagnostics.test.ts` - the pure mapper turns lead,
  jargon and vacuity findings into located diagnostics (0-based line and column, source
  `MinSpec`, warning or error as given); each jargon diagnostic carries an add-term quick fix
  for its exact term; a non-spec markdown file yields none.
- [ ] **9.2** `packages/minspec/src/lib/lead-diagnostics.ts` - `leadFindingsToDiagnostics`
  (pure) and `registerLeadDiagnostics` (the `vscode` wiring, mirroring
  `registerReferenceDiagnostics` in diagnostics.ts), with a code-action provider for the
  quick fix.
- [ ] **9.3** `packages/minspec/src/extension.ts`, `packages/minspec/package.json` - register
  the diagnostics and `minspec.addJargonTerm` ("MinSpec: Add Term to Jargon Allowlist"),
  which calls `assertOptedIn`, then `addAllowedTerm`, then writes
  `.minspec/jargon-lexicon.json`. The palette title states the quick-fix key (`Ctrl+.`).
  *Done when:* 9.1 is green and the packaged extension shows a squiggle on a seeded term in a
  lead (checked by installing the rebuilt .vsix).

## 10 - Rephrase assist (FR-5; design [F])

- [ ] **10.1** `packages/minspec/tests/lead-rephrase.test.ts` - the builder's prompt contains
  the lead text and each flagged term, and nothing from outside the lead; the module imports
  no `http`, `https`, `net`, `child_process` or `fetch` (a source scan, recorded as a guard,
  not as proof of behaviour).
- [ ] **10.2** `packages/minspec/src/lib/lead-rephrase.ts` - `buildRephrasePrompt(lead, terms)`,
  pure.
- [ ] **10.3** `packages/minspec/src/extension.ts`, `packages/minspec/package.json`,
  `packages/minspec/src/lib/lead-diagnostics.ts` - command
  `minspec.copyLeadRephrasePrompt` ("MinSpec: Copy Plain-Language Rephrase Prompt") copies
  the prompt to the clipboard and shows a toast saying it was copied; also offered as a quick
  fix on every lead finding.
  *Done when:* 10.1 is green.

## 11 - The honesty guard (FR-6, AC-5; design [C])

- [ ] **11.1** `packages/minspec/tests/lead-honesty.test.ts` - collects every message and fix
  hint the lead, jargon, vacuity and rephrase modules can produce (by driving each rule with a
  fixture that triggers it) and asserts none claims readability (`readable`, `plain enough`,
  `PO-ready`, `understand`, a check mark); runs `validateSpec` on a clean lead and asserts no
  `lead.*`/`jargon.*` entry exists at all, so there is no pass line to misread; and scans the
  package.json contributions added by tasks 9 and 10 for the same words.
  *Done when:* green, and a planted message "lead is PO-readable" in a scratch copy turns it
  red (quoted in the pull request body).

## 12 - Adopter CI twin (FR-1; design [E])

- [ ] **12.1** `packages/minspec/tests/lead-zone-python-parity.test.ts` - renders
  `.minspec/hooks/validate.py` from the template registry (the
  `dr-plain-terms-gate-2921.test.ts` way), runs it over one fixture list shared with
  task 1's cases, and asserts the same position verdict as `checkLeadZone` for each; the
  sidecar-existence grandfather is asserted as the one documented difference.
- [ ] **12.2** `packages/minspec/src/lib/template-registry.ts` - the Python position check
  beside `DR_PLAIN_TERMS_RE`, reading the `leadZone` dial from `.minspec/config.json`.
- [ ] **12.3** `.minspec/hooks/validate.py` - regenerated with `node scripts/gen-ci-templates.mjs`
  so the stale-template rule stays green.
  *Done when:* 12.1 is green. This pull request edits shipped harness machinery, so it takes
  the machinery merge path.

## 13 - Backfill the leads MinSpec's own repo would fail (FR-1; design [G] step 2)

- [ ] **13.1** Run validate with `leadZone` set to `'error'` in a scratch copy of
  `.minspec/config.json` (not committed) and record the `lead.*` errors. Skip any spec with an
  open approval pull request, and list it in the pull request body.
- [ ] **13.2** For up to 8 of the listed specs, add a plain-language `## In plain terms`
  section as the first `##` of the product-owner file, three to six sentences, no seeded
  jargon. Each file edited is named in the pull request body; only specs whose approval is
  not current may be edited. If more than 8 remain, the task is re-run until none do.
  *Done when:* the scratch validate reports zero `lead.*` errors outside the skipped list.

## 14 - Flip MinSpec's own dial (FR-1, AC-1; design [G] step 3)

- [ ] **14.1** `.minspec/config.json` - `"leadZone": "error"`, edited as text, not parsed and
  rewritten. Only after task 13 reports zero and the skipped specs have landed or been
  backfilled.
  *Done when:* `npm run validate` exits 0 on the flipped tree, and a scratch lead-less
  unapproved spec makes it exit non-zero (quoted in the pull request body).

## 15 - New repos start at the strict position (FR-1; design [G] step 4)

- [ ] **15.1** `packages/minspec/tests/lead-zone-ratchet.test.ts` - an empty specs dir seeds
  `'error'`; a corpus with one unapproved lead-less spec seeds `'warn'`; an unreadable dir
  seeds `'warn'` and logs that it could not prove the corpus clean; an existing config is
  never touched.
- [ ] **15.2** `packages/minspec/src/lib/lead-zone-ratchet.ts` - `initialLeadZone(rootDir)`,
  modelled on `initialOwnershipDeclaration` in ownership-ratchet.ts.
- [ ] **15.3** `packages/minspec/src/lib/scaffold.ts` - write the seeded value only when
  `scaffold()` creates the config, beside the `ownershipDeclaration` seed.
  *Done when:* 15.1 is green.

## After the last task

requirements.md still says `implements: none`. Replacing it with the owned files above
(`lead-zone.ts`, `jargon-lexicon.ts`, `jargon-lint.ts`, `lead-vacuity.ts`,
`lead-diagnostics.ts`, `lead-rephrase.ts`, `lead-zone-ratchet.ts` and their tests) **stales
the founder's approval today**: DR-088 takes ownership fields out of the approval hash, but
that strip is not built (no `implements` or `implements_reason` handling in
packages/shared/src, checked at `a3a4a3e8`). Until it is, the backticked paths in this file
are the spec gate's ownership signal, so no task here edits requirements.md. The declaration
is made in one edit when DR-088's strip lands, or batched with the next real requirements
change, so the re-approval is paid once.
