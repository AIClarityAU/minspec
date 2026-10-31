---
id: SPEC-048
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-048 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness
relates_to: [DR-068, SPEC-013, SPEC-006, SPEC-047, SPEC-049, SPEC-038, DR-016, "#2921"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-048 - Design: a plain-language lead comes first, and jargon in it is flagged

Plan for [requirements.md](requirements.md), built under its two resolved decisions: RD-1 (a
shipped seed list plus a project-owned lexicon in `.minspec/`, with an add-term command) and
RD-2 (one rule for whichever file holds product-owner content). Citations of "today" are
against `origin/main` `a3a4a3e8`, the commit this plan was written on. New code is cited by
symbol, because its line numbers move.

## In plain terms

Every spec will have to open with a short section written for a product owner. If that
section is missing or is not the first one, MinSpec reports an error while the spec is still a
draft, so it is added before anyone signs the spec off. Inside that opening section, MinSpec
also underlines developer words (file paths, test tiers, git terms) as suggestions, never as
a block. A clean result only ever means "no listed words were found", never "a product owner
will understand this".

## What exists today, and what does not

Two of the three things requirements.md says this spec reuses are not built. This plan is
shaped by that, so it is stated first.

- **SPEC-013's `core-end` divider and section registry: unbuilt.** SPEC-013's own
  `implements_reason` says so, and a search of `packages/` and `scripts/` for `core-end` and
  `SECTION_REGISTRY` returns nothing. No spec on main carries the divider except as quoted
  text. So FR-1 cannot mean "above the divider" in any checkable way today.
- **SPEC-006's hollow detection: built, but for test code, not prose.**
  `packages/minspec/src/lib/test-scanner.ts:31` classifies `'stub' | 'hollow'` **test
  cases** (tautological `expect` calls). It has no notion of a vacuous paragraph. FR-4's
  "reuse" target for prose does not exist.
- **What does exist and is reused.** The DR-side twin of this rule, Rule 20 in
  `scripts/validate-frontmatter.ts:391-409` with its predicate in
  `scripts/lib/dr-required-sections.ts` (#2921), already checks that a decision record carries
  `## In plain terms`. The spec corpus already follows the convention unenforced: of the 164
  spec files that hold product-owner content on main, 121 open with `## In plain terms`,
  `## Summary` or `## One-sentence scope` (measured over `specs/**/*.md`, excluding
  `design.md`/`tasks.md` and non-`requirements` types).

## Approach in one paragraph

A new pure module finds the lead zone (the first `##` section of the product-owner file) and
reports a violation when it is missing, mis-ordered or empty. It is called from the same three
places every shared spec rule is called from today, so the rule is identical everywhere
(Goal G-6, the #654 lesson): `validateSpec` (the editor's **MinSpec: Validate** and the
approve gate), the delegated-approval caller, and the CI validator. Severity follows the
SPEC-038 FR-7 ratchet house pattern, a `leadZone: 'warn' | 'error'` config dial, plus one
grandfather that never expires: a spec whose approval is current gets a warning, never an
error, because fixing it would cost a founder re-approval. A second pure module checks the
words inside the lead against a lexicon (shipped seed, overridden by `.minspec/jargon-lexicon.json`)
and returns warnings only. A third checks the lead for emptiness. The editor shows both as
squiggles with two quick fixes (add the term to the project allowlist, copy a rephrase
prompt). The adopter CI script gets a Python twin of the position check.

## [A] The lead zone (FR-1, RD-2)

**Which files.** The rule applies to a file whose frontmatter `id:` is a `SPEC-NNN` and that is
either `type: requirements` or has no `type:` (a single-file spec). `design.md`, `tasks.md`
and every other split-layout type are exempt by type, and also by basename, because two
`design.md` files on main (SPEC-039, SPEC-050) carry no `type:` and would otherwise be read as
single-file specs. This is RD-2's "whichever file holds PO content".

**What counts as a lead.** The first `## ` heading after the frontmatter and the `#` title
must be one of `In plain terms`, `Summary`, `One-sentence scope` (case-insensitive, prefix
match, so `## In plain terms - what this changes for you` passes). The set is a named
constant, `LEAD_HEADINGS`, shaped as a registry entry so SPEC-013's FR-1 registry can absorb
it without a behaviour change when it lands. The lead body is the text up to the next heading
of level 2 or higher; it must contain at least one non-blank, non-comment line.

**Three findings, one rule id each.**

| Rule id | When | Message names |
|---|---|---|
| `lead.missing` | no lead heading anywhere in the file | the file, the accepted headings |
| `lead.misplaced` | a lead heading exists but is not the first `##` section | the heading that precedes it |
| `lead.empty` | the lead heading is first, its body is blank | the heading |

**Severity: the ratchet and the grandfather.**

- Config dial `leadZone?: 'warn' | 'error'` in `MinspecConfig`, beside `ownershipDeclaration`
  (`packages/minspec/src/lib/config.ts:31`). `loadConfig` default when the key is absent:
  `'warn'`, so no adopter goes red on upgrade (no flag day, constitution invariant 3 keeps the
  change inside repos that opted in, and the ratchet keeps it from surprising them).
- At `'error'`, a finding is an **error** unless the spec's approval is current, in which case
  it is a **warning**. Current means `getApprovalStatus(...) === 'approved'`
  (`packages/minspec/src/lib/approval.ts:499`), the same reader the Validate command already
  passes in (`packages/minspec/src/commands/validate.ts:56`).
- Omitted approval state is read as **not approved**, so it fails toward the error (invariant
  2: a missing witness never passes silently). The approve command (`approve.ts:274`) and the
  delegated-approval caller (`scripts/lib/delegated-approval.ts:575`) call `validateSpec`
  before the approval exists, so both refuse to approve a lead-less spec once the dial is
  `'error'`. That refusal is the gate: a spec cannot be signed off without its lead.
- `violationsIntroducedByApproval` (`spec-validator.ts:1126`) re-runs `validateSpec` with only
  `phases` changed; the lead finding is identical on both sides and cancels, so phase advance
  is unaffected.

**Why the grandfather.** 35 approved spec files on main lack a lead (measured at `a3a4a3e8`
with the heading set above, approval read as "sidecar exists"; the build measures it with the
real hash reader). Making them errors forces 35 founder re-approvals for a heading. Keeping
them warnings means each one gains its lead the next time it is edited for a real reason,
because the edit stales the approval and the error returns. That is tenet 1.

**Shape.** `checkLeadZone(spec, { approved, severity, fileName })` returns
`ValidationViolation | undefined`, following `checkAcceptanceCriteria`
(`spec-validator.ts:678`): exported, pure, no `fs`, called by `validateSpec` and by the CI
rule, never reimplemented.

## [B] The lexicon (FR-3, RD-1)

**Seed.** `JARGON_SEED` in the new lexicon module, the audit's recurrent terms as entries of
two kinds: literal words (`frontmatter`, `gate`, `CI`, `hash`, `rebase`, `HEAD`, `SHA`,
`worktree`, `cherry-pick`, `commit`) matched case-insensitively at word boundaries, and
patterns for the classes requirements.md names: test tiers `\bT[0-4]\b`, a call shape
`\b\w+\(\)`, a path shape (a token containing `/` with a file extension, or a backticked span
containing `/`). The seed is a constant in source, so it is deterministic and offline.

**Project file.** `.minspec/jargon-lexicon.json`:

```json
{
  "version": 1,
  "defaultAudience": "po",
  "audiences": {
    "po": { "add": ["regex"], "allow": ["CI"] }
  }
}
```

The effective list for an audience is `seed + add - allow`. `allow` wins over the seed and
over `add` (AC-3). A missing file means the seed alone for audience `po`. A file that does not
parse, or names a `defaultAudience` it does not define, yields a **visible error result**
(`{ ok: false, reason }`) that every caller surfaces as one warning line naming the file; it
never falls back to the seed silently (invariant 2). There is no per-spec audience field: the
project default applies to every spec. A per-spec override would be a new frontmatter key in
the closed-set schema, which this spec does not ask for.

**Add-term command.** `MinSpec: Add Term to Jargon Allowlist` (`minspec.addJargonTerm`)
appends a term to the default audience's `allow` list, creating the file if absent. It is
also offered as a quick fix on each jargon squiggle, which gives it the editor's existing
keyboard path (`Ctrl+.`), and the palette entry shows that keybinding. It writes only inside
`.minspec/` and only after the opt-in check (`assertOptedIn`), so it never writes in a repo
that did not opt in (invariant 3). Editing the lexicon is the team's act; MinSpec ships the
seed and the writer, never a central list (RD-1).

## [C] The jargon advisory (FR-2, FR-6, FR-7)

`lintLeadJargon(leadBody, lexicon)` returns one finding per match with its line, column,
term and lexicon entry, rule id `jargon.term`, severity **warning** always. Frontmatter is
never scanned; only the lead body from [A]. A message reads "Flagged term: `<term>`
(project jargon list)". No message, toast, status-bar item or tree label states or implies
that text is readable, plain or approved for a product owner; when there are no findings the
lint emits nothing at all, not a pass line (FR-6, AC-5).

**FR-7 ratchet.** Dial `jargonAdvisory?: 'warn' | 'wide'`, default `'warn'`. At `'warn'` the
lint runs in the editor on any open product-owner file, and in CI only on specs whose approval
is not current, so main's validate output does not gain a warning on most approved specs
(the audit found about 96% of product-owner paragraphs carry jargon) that nobody can act on
without a re-approval (no retro-fit, FR-7). At `'wide'` CI also reports approved specs. Both
are warnings. **Rejected:** an `'error'` position. FR-2 says "never a hard block" and Out of
scope rejects wording as a hard gate, so "stricter" in FR-7 is read as wider reach, never
higher severity.

## [D] The vacuity guard (FR-4)

`checkLeadVacuity(leadBody, title)` returns warning `lead.vacuous` when any one of three
deterministic tests holds:

1. **Too short to say anything:** fewer than 8 words after stripping markdown.
2. **Restates the title:** at least 80% of the lead's content words (stopwords removed) occur
   in the `#` title, and the lead adds fewer than 4 content words the title lacks.
3. **Stock filler only:** after lower-casing and stripping punctuation, every sentence is
   one of a fixed filler list (`tbd`, `todo`, `see below`, `to be written`, `as the title
   says`, `this spec describes the change`).

It is a new pure module because SPEC-006's scanner works on test code (see above). Its export
signature is the one SPEC-013 FR-9's L1 specificity layer will need, so SPEC-013 can call it
instead of building a second one. It runs only when [C] finds no jargon, matching FR-4's
"jargon-free but vacuous"; a lead with flagged terms already has a finding.

## [E] Surfaces

| Surface | Lead position [A] | Jargon [C] + vacuity [D] |
|---|---|---|
| `validateSpec` (Validate command, approve gate) | yes, ratcheted severity | yes, warnings |
| `scripts/lib/delegated-approval.ts` | yes, via `validateSpec` | via `validateSpec` |
| CI: `scripts/validate-frontmatter.ts`, new rule beside Rule 13 | yes, `fail` on error, `warn` on warning | unapproved specs only (or all at `'wide'`), `warn` |
| Editor squiggles, new `registerLeadDiagnostics` beside `registerReferenceDiagnostics` (`diagnostics.ts:202`) | yes | yes, with the two quick fixes |
| Adopter CI: the Python validator in `template-registry.ts` (beside `DR_PLAIN_TERMS_RE`, :1825/:2232) | yes, see below | no |

**Adopter twin, and its one disclosed difference.** The shipped Python validator has no
approval-hash reader. It applies the same position rule and dial, and keys the grandfather on
"an approval sidecar exists" instead of "the approval is current". A stale-approved lead-less
spec is therefore an error in the editor and a warning in adopter CI. The editor and approve
gate still refuse it, so no lead-less spec can be newly approved anywhere. A parity test runs
the TypeScript and Python checks over one fixture list and fails if their position verdicts
differ (the #2921 precedent of a TS rule with a Python twin that "must stay in step").

## [F] Rewrite assist (FR-5)

`MinSpec: Copy Plain-Language Rephrase Prompt` (`minspec.copyLeadRephrasePrompt`), also a
quick fix on any lead finding. A pure builder makes a prompt from the lead text and its
flagged terms ("Rewrite for a product owner; keep the meaning; avoid these terms: ..."), the
command copies it to the clipboard and shows a toast saying so. MinSpec makes no network call
and runs no model (invariant 1): the user pastes it into whatever assistant they already use.
That is the Tier-0 half of SPEC-014 / DR-016 delegation, and it is optional by construction.
**Rejected:** an in-extension `claude -p` call. DR-016's availability-check-plus-fallback
pattern would put a subprocess and a consent prompt into Tier 0 for a convenience feature;
DR-015 puts executing agents in the separate Tier-1 extension, which can add this later
without a change here.

## [G] Rollout in MinSpec's own repo

1. Ship [A]-[F] with `leadZone` absent from `.minspec/config.json`, so it reads `'warn'`.
   Main stays green.
2. Backfill: add a plain-language lead to each product-owner file the rule would turn red at
   `'error'` (8 by the sidecar proxy at `a3a4a3e8`: SPEC-056, 097, 204, 232, 245, 271, 272,
   276; the real list is whatever validate reports at build time). Editing an unapproved spec
   costs no approval. A spec with an open approval pull request is skipped until that pull
   request lands, because the edit would stale the hash it pins.
3. Flip `.minspec/config.json` to `"leadZone": "error"` once validate at `'error'` reports
   zero lead errors. That is AC-1 live.
4. New repos: `scaffold()` seeds `leadZone` with the computed position, as
   `packages/minspec/src/lib/ownership-ratchet.ts` does for `ownershipDeclaration` (#2250): a
   repo with no failing spec starts at `'error'`.

## Acceptance mapping

| AC | Proved by |
|---|---|
| AC-1 (FR-1) | lead-zone unit test at `'error'` + CI rule test (exit non-zero) + the step-3 flip |
| AC-2 (FR-2) | jargon-lint test: a seeded term yields one `warning`, never `error`; CI exit stays 0 |
| AC-3 (FR-3) | lexicon test: a seed term in `allow` yields no finding |
| AC-4 (FR-4) | vacuity test: a jargon-free lead that restates the title warns `lead.vacuous` |
| AC-5 (FR-6) | honesty test over every message the new modules can emit, plus a zero-findings run that emits nothing |

## Risks

| Risk | Mitigation |
|---|---|
| Flip to `'error'` before the backfill turns main red | step 3 runs only on a measured zero; the flip task's test is that measurement |
| Backfill edit stales an in-flight approval pull request | step 2 skips specs with an open approval pull request |
| Seed patterns false-positive on ordinary prose (`T1` in "phase T1"? `commit` as a verb) | warnings only; `allow` per project; the seed is tuned by its own fixture list of real leads from main |
| Python twin drifts from TypeScript | parity test over one shared fixture list |
| A lead that passes is read as "readable" | FR-6 honesty test; no pass message exists to misread |

## Out of this plan

Moving the lead check into SPEC-013's registry (SPEC-013 owns that, and [A] is shaped to be
absorbed), DR lead summaries (SPEC-049, which reuses [C]), and file separation (SPEC-047).
