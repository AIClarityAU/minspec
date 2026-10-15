---
id: SPEC-192
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - DR-032's internal-ref egress rule lives here; this keeps it true under the DR-053 v2 grammar
aspects: [output-hygiene, internal-refs, egress-gate, references, grammar, tier-0, offline, no-silent-gate]
depends_on: [SPEC-021, DR-032, DR-053]  # SPEC-021 owns the egress gate this widens; DR-032 the rule; DR-053 v2 the grammar the gate must learn
relates_to: [SPEC-035, "#683", "#679", "#681", "#669", "#225"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Both files are NEW
# and needed under every Clarify answer below: the one Tier-0 predicate that says "this text
# carries a MinSpec-internal ref" (FR-1 to FR-9) and the test that pins its positive and
# negative corpus (AC-1 to AC-9).
implements: [packages/shared/src/internal-ref-egress.ts, packages/shared/tests/internal-ref-egress.test.ts]
# Modified, not owned. project-prefix.ts is #679's (the grammar this predicate consumes, FR-7);
# scaffold.ts carries the `(#225)` literal that DQ-1's recommended option turns into a finding
# (FR-11). SPEC-021's render test and static scan (its FR-2/FR-3) are not on disk yet, so they
# are not listed; they adopt this predicate when they are built (FR-10).
affects: [packages/shared/src/project-prefix.ts, packages/minspec/src/lib/scaffold.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-192: The internal-ref egress gate learns the DR-053 v2 grammar

> **SPECIFICATION ONLY.** The dispatch that produced this built nothing. A human reads it,
> answers or accepts the [Decisions needed (Clarify)](#decisions-needed-clarify), and
> approves it through the normal spec-approval gate before any code changes. Every
> requirement below is written under each decision's **recommended** option, so approving
> the spec as it stands accepts those recommendations.

**Date:** 2026-10-16
**Triggered by:** [#683](https://github.com/AIClarityAU/minspec/issues/683) — *"teach the
DR-032/SPEC-021 egress guard the v2 ref grammar or internal refs leak to user output"*,
surfaced by the DR-053 v2 design review (DR-053 §Consequences, Risk R4).
**Decision basis:** [DR-032](../../../docs/decisions/DR-032.md) (no internal ref in
user-facing output — the rule), [DR-053](../../../docs/decisions/DR-053.md) v2 §1–§4 (the
grammar). No new DR: every choice here is a gate predicate, reversible in under a day; the
costly-to-refactor grammar itself is DR-053's and #679's (see
[Resolved by the author](#resolved-by-the-author)).
**Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md)

---

## One-sentence scope

The SPEC-021 gate that keeps MinSpec's own internal references out of user-facing output
must recognise every reference form DR-053 v2 introduces, from the same grammar the resolver
uses, so that a v2-form internal ref cannot reach a user's project or screen.

---

## Context — and two corrections to the issue's premise

DR-053 v1 called itself orthogonal to the DR-032 egress rule. The v2 review found it is not:
the egress gate is a reference detector of the same class as SPEC-035's lozenge detector, and
it knows only one pattern, `(DR|SPEC|EPIC)-\d+` (SPEC-021 INV-1, FR-2, FR-3). Every v2 form —
`SP19`, `DR53`, `MIN/SP19`, `SP19/FR3`, `SCR#204` — fails that pattern. Once MinSpec's
emitted strings or its corpus adopt v2 (#681), an internal ref in the new form passes the
gate and lands in a user's file, where it reads as a reference into the **user's** register
(DR-032's collision case: the user's register numbers its decisions too).

Two things in the issue are stated more strongly than the code supports, and the requirements
below are written against the code:

1. **There is no "stripper".** DR-032 Decision 3–4 chose a *build-time gate* (a render test
   over every emit surface plus a static scan of the files it cannot render) and explicitly
   rejected runtime scanning or rewriting. Nothing removes refs from output at run time;
   the gate makes a leak un-committable. This spec widens the gate's *predicate*; it adds
   no runtime stripping.
2. **The gate is specified, not built.** SPEC-021 is `status: implementing` with its gate
   unchecked. A search of `packages/` and `scripts/` for the gate's vocabulary — the string
   `dr-ok`, a literal `DR|SPEC|EPIC` alternation, `output-provenance` — finds nothing.
   (`scripts/egress-scan.sh` and `egress-scan.test.ts` share the word "egress" but are the
   #358 secret/exfil scanner for agent dispatch, an unrelated gate.) The SPEC-021 FR-1b leak
   is still live: `packages/minspec/src/lib/scaffold.ts:165` writes `spec approval (DR-035).`
   into every scaffolded `tasks.md`. So this spec specifies the predicate that SPEC-021's gate
   will use; it cannot "update" a detector that does not yet exist (FR-10).

A third finding sits on the v1 side and bears on DQ-1: the v1 pattern does not cover issue
refs at all, and an internal issue ref already reaches user output. The same scaffolded
`tasks.md` body opens with `MinSpec scaffolded this tasks.md (#225).`
(`scaffold.ts:162`); `#225` is MinSpec's issue, and in the user's repo it links to the
user's own issue #225. `template-registry.ts:2493` (`MinSpec #1284`) and `:2540` (`(#1486)`)
carry issue numbers in template strings too — I believe at least the first is written into
an adopter's workflow file, unverified which surface each reaches; the Plan measures it.

---

## Invariants

**INV-1 (T0) — no internal ref in user-facing output, either grammar.** No user-facing
surface MinSpec produces contains a MinSpec-internal reference in v1 form (SPEC-021 INV-1)
**or** in any DR-053 v2 form this spec lists. "User-facing surface" keeps SPEC-021 INV-1's
definition and exemptions (MinSpec's own `docs/`, `specs/`, README, CHANGELOG, notices are
exempt; SPEC-021 OQ-2).

**INV-2 — one grammar, no private copy.** The predicate holds no copy of the reference
vocabulary (approvable codes, paragraph type codes, project-code shape, issue forms). It
consumes the vocabulary `@aiclarity/shared` exports (#679's deliverable), the same source the
resolver and SPEC-035's detector read, so the three cannot drift. A second hand-maintained
list kept equal by a test is the drift this issue exists to prevent.

**INV-3 — over-detect, never under-detect, relative to the lozenge detector.** For egress a
false negative is a leak into a user's project and a false positive is a blocked commit with a
per-line `dr-ok` remedy. Every token SPEC-035's detector admits as a reference, this predicate
flags. The converse need not hold.

**INV-4 — no silent gate (constitution invariant 2).** If the grammar the predicate consumes
is missing, fails to import, or is empty, the gate fails closed and says so; it never passes
because it had nothing to match. Suppression stays per-line `dr-ok` (SPEC-021 FR-3); there is
no global off-switch, no per-file blanket exemption beyond SPEC-021's allowlist, and no
"v1-only" fallback mode.

**INV-5 — Tier-0 and offline (constitution invariant 1).** The predicate is a pure function:
no `fs`, no `vscode`, no network, no LLM. It runs in MinSpec's own test suite over MinSpec's
own emit surfaces and ships nothing into an adopter's repo (constitution invariant 3).

**INV-6 — the gate leads, the grammar follows.** No MinSpec emit surface adopts a v2 form,
and the #681 corpus migration does not run, before this predicate detects v2 on `main`
(DR-053 R4: "before migration").

---

## Functional requirements

Recommended Clarify options assumed throughout; the DQ each one depends on is named.

### FR-1: v1 forms stay detected (dual-read)

The predicate flags every form SPEC-021 already forbids — `DR-<d>`, `SPEC-<d>`, `EPIC-<d>` —
including inside a v1 cross-project token (`MS-SPEC-019`), the interim chimera
(`MIN-SPEC-019`, DR-053 R3) and an `@namespace` form (`SPEC-100@scroogellm`). Old and new
forms coexist in user output indefinitely, so neither grammar may be dropped.

### FR-2: v2 bare approvables

The predicate flags `SP<n>`, `DR<n>`, `EP<n>` (DR-053 §2: no dash, no leading zero) as whole
tokens, so `SP19` and `DR53` are flagged and `SP19x`, `ASP19`, `UTF8` are not. Leading-zero
variants (`SP019`) are flagged too: a malformed internal ref is still internal.

### FR-3: v2 project-qualified and paragraph-qualified refs

The predicate flags, as one finding each:

- `PRJ/APPR` — any 3-uppercase-letter project code, **known or unknown** to
  `.minspec/project-prefixes.md` (`MIN/SP19`, `XYZ/DR4`). An unknown code is advisory to the
  resolver (DR-053 §5) but is still an internal ref to the egress gate.
- `APPR/PARA` and `PRJ/APPR/PARA` — every DR-053 §3 paragraph type code, matched
  longest-first (`NFR` before `FR`, `RD` before `R`), plus the named forms `INV-<slug>` and
  `G-<n>` (`SP19/INV-live-status-deterministic`, `MIN/SP19/G-3`).
- The opt-in sigil `[[FR3]]` (DR-053 §4) — an explicit request to treat the bare code as a
  reference, so the gate treats it as one.
- `PRJ/PR<n>/RF<m>` — the PR-scoped review-finding handle (DR-053 §3 `RF` row). (DQ-5)

Bare paragraph codes with no approvable segment (`FR3`, `R1`, `M1`, `G-7`) are **not**
flagged. (DQ-2)

### FR-4: issue and pull-request refs

The predicate flags `PRJ#<n>` (v2 `SCR#204`, v1 `MS#500`) and the bare intra-project form
`#<n>`, with token boundaries that skip markdown headings (`## 1.`), hex colours (`#fff`,
`#1a2b3c`), URL fragments (`page#section`) and a number inside a word. (DQ-1)

### FR-5: case

v2 forms are matched in canonical uppercase only (DR-053 §1: MinSpec renders uppercase).
`min/sp19` and `lib/sp1.ts` are not flagged. (DQ-6)

### FR-6: placeholders pass

The literal placeholder tokens pass: v1 `DR-NNN`, `SPEC-NNN`, `EPIC-NNN` (SPEC-021 INV-1),
and the v2 equivalents `SPNNN`, `DRNNN`, `EPNNN`, `PRJ/SPNNN`, `SPNNN/FRNNN`, `#NNN`,
`PRJ#NNN`. A placeholder is the digit run replaced by `NNN`; the literal project placeholder is
`PRJ`. (DQ-4)

### FR-7: the grammar comes from `@aiclarity/shared` (#679 contract)

The predicate reads the reference vocabulary from `@aiclarity/shared`. That is a requirement
on #679's export, recorded here so #679 can satisfy it:

- **Enumerable vocabulary.** The approvable codes, paragraph type codes (all 22 DR-053 §3
  rows, not the 13 in #679's body — the gap SPEC-035 design D1 already flags), the
  project-code shape and the issue forms are exported as data the predicate can build a
  scanner from. Private regexes (today's `project-prefix.ts:86-90`) do not satisfy this.
- **Unknown prefixes resolve non-null.** A well-formed token with an unknown project code
  returns a non-null `unknown-prefix` result, as v1's `resolveRef` already does, so a
  resolver-as-acceptor scanner (SPEC-035 design D1) does not drop it.
- **Rejected codes stay inert.** `IS<n>` (DR-053 §2 rejected it) is not in the vocabulary.

If #679 lands without an enumerable vocabulary, this spec's v2 half is blocked on it rather
than built against a private copy (INV-2). (DQ-3)

### FR-8: superset of the lozenge detector

A property test asserts that every span SPEC-035's `detectRefs()` admits, over the same
corpus, is also flagged by this predicate (INV-3). Until SPEC-035's detector exists the test
asserts against the FR-1 to FR-4 fixture corpus alone, and says in its name that the
cross-detector half is pending.

### FR-9: actionable findings

Each finding names the matched token, its form (v1, v2 approvable, v2 qualified, issue,
sigil), and its position, so the gate's failure message can name the surface, line and token —
enough to strip it, rewrite it as a full URL (DR-032 Risk 3), or mark it `dr-ok` without
re-running anything.

### FR-10: SPEC-021's gate uses this predicate

SPEC-021's FR-2 render test and FR-3 static scan call this predicate instead of the literal
`/\b(DR|SPEC|EPIC)-\d+\b/`. Whichever lands second wires them: if SPEC-021's gate is built
first, this spec swaps its predicate; if this predicate lands first, SPEC-021's gate is built
on it. `dr-ok`, the allowlist and the emit-surface list are SPEC-021's and are unchanged.

### FR-11: the tree passes on landing

When the wider predicate is first wired into the gate, every newly flagged literal on `main`
is resolved in the same change — stripped, rewritten as a full GitHub URL, or marked `dr-ok`
with a one-clause reason — and the gate passes clean. The Plan measures the list before the
work starts; the known members today are the `(#225)` in `scaffold.ts:162` and the two
`template-registry.ts` issue literals (`:2493`, `:2540`), subject to whether each reaches a
user-facing surface.

---

## Contract (sketch — the Plan may rename, not reshape)

```ts
// packages/shared/src/internal-ref-egress.ts - Tier-0. No fs, no vscode, no network, no LLM.
// Holds token boundaries only; the vocabulary is imported from project-prefix (INV-2, FR-7).

export type InternalRefForm =
  | 'v1'            // DR-12, SPEC-021, MS-SPEC-019, MIN-SPEC-019, SPEC-100@scroogellm
  | 'v2-approvable' // SP19, DR53, EP2
  | 'v2-qualified'  // MIN/SP19, SP19/FR3, MIN/SP19/INV-slug, MIN/PR451/RF3
  | 'issue'         // #500, SCR#204, MS#500
  | 'sigil';        // [[FR3]]

export interface InternalRefFinding {
  token: string;        // exact matched text
  form: InternalRefForm;
  index: number;        // 0-based offset into the input
  line: number;         // 1-based line number
}

/** Every MinSpec-internal ref in `text`; placeholders (FR-6) are never returned.
 *  Throws (never returns []) if the imported vocabulary is empty or missing (INV-4). */
export function findInternalRefs(text: string): InternalRefFinding[];
```

---

## Acceptance criteria

- [ ] **AC-1 v1 dual-read.** `DR-12`, `SPEC-021`, `EPIC-002`, `MS-SPEC-019`, `MIN-SPEC-019`,
      `SPEC-100@scroogellm` are each flagged with form `v1`. *(FR-1, INV-1)*
- [ ] **AC-2 v2 approvables.** `SP19`, `DR53`, `EP2`, `SP019` are flagged; `SP19x`, `ASP19`,
      `UTF8`, `IS500` are not. *(FR-2, FR-7)*
- [ ] **AC-3 v2 qualified.** `MIN/SP19`, `XYZ/DR4` (unknown code), `SP19/FR3`,
      `MIN/SP19/NFR2` (one finding, not `FR2`), `SP13/RD1` (not `R`), `SP19/INV-live-status`,
      `MIN/SP19/G-3`, `MIN/PR451/RF3`, `[[FR3]]` are each one finding. *(FR-3)*
- [ ] **AC-4 issue refs.** `#225`, `SCR#204`, `MS#500` are flagged; `## 1. Heading`, `#fff`,
      `#1a2b3c`, `docs/page#section`, `issue#` with no digits are not. *(FR-4)*
- [ ] **AC-5 prose and paths do not fire.** `FR3`, `R1`, `Apple M1`, `G-7`, `MIN` alone,
      `fly into SEA`, `2026/07/12`, `UTF-8`, `SHA-256`, `ISO-8601`, `src/lib/sp1.ts`,
      `min/sp19`, `https://example.com/a/b` produce no finding. *(FR-3, FR-5, DR-053 §4)*
- [ ] **AC-6 placeholders pass.** `DR-NNN`, `SPEC-NNN`, `EPIC-NNN`, `SPNNN`, `DRNNN`,
      `EPNNN`, `PRJ/SPNNN`, `SPNNN/FRNNN`, `#NNN`, `PRJ#NNN` produce no finding. *(FR-6)*
- [ ] **AC-7 fails closed.** With the imported vocabulary stubbed empty, `findInternalRefs`
      throws and the gate reports the reason; it does not return `[]`. *(INV-4)*
- [ ] **AC-8 gate bites, v2.** Injecting `SP19`, `MIN/SP19/FR3` or `SCR#204` into any
      SPEC-021-registered emit surface makes the SPEC-021 gate fail; removing it makes it pass
      — proving the wider predicate is wired, not just unit-tested. *(FR-10, INV-1)*
- [ ] **AC-9 superset.** The FR-8 property test passes, and fails if a span the lozenge
      detector admits is removed from the predicate's vocabulary. *(FR-8, INV-3)*
- [ ] **AC-10 tree clean.** The gate with the wider predicate passes on `main`; every
      newly flagged literal is resolved per FR-11 and listed in the PR. *(FR-11)*
- [ ] **AC-11 single source.** `internal-ref-egress.ts` contains no literal list of
      approvable or paragraph codes (a T0 source assertion paired with AC-9, which proves the
      behaviour, so the source check is not the only witness). *(INV-2)*

---

## Decisions needed (Clarify)

Each carries a recommendation **(rec)** and that option's main cost. The requirements above
assume every recommendation.

**DQ-1 — Are bare issue refs (`#225`) in scope?** The issue lists only `SCR#204`; the v1 gate
covers no issue form at all, and a bare internal `#225` is already emitted (Context).
- **(a) Flag `#<n>` and `PRJ#<n>` (rec).** Cost: every issue literal in emitted strings
  becomes a finding on day one (three known, the Plan measures the rest), each needing a
  strip, a full URL, or a `dr-ok`; and the boundary rules in FR-4 must be right or markdown
  output false-fires.
- **(b) Flag `PRJ#<n>` only.** Cost: the live `#225` leak stays, and links to the user's own
  issue #225 — the exact collision DR-032 exists to prevent, on the axis the v1 gate never
  covered.

**DQ-2 — Are bare paragraph codes (`FR3`, `R1`, `G-7`) flagged?**
- **(a) No — only paragraph codes attached to an approvable, matching DR-053 §4 (rec).**
  Cost: a bare internal `FR3` copied into an emitted string slips through; it is unresolvable
  noise in the user's file but cannot point into a specific document of theirs.
- **(b) Yes, in emit surfaces only.** Cost: MinSpec's own templates and walkthrough teach the
  grammar with bare codes, and DR-053 measured `R1`×51 and `M1`×82 in prose; every one needs a
  `dr-ok` or a placeholder, a standing tax on every template edit.

**DQ-3 — Wait for #679, or ship a private copy now?**
- **(a) Consume #679's exported vocabulary; the v2 half waits for #679 (rec).** Cost: until
  #679 lands, nothing detects v2, so INV-6 must hold by ordering — no v2 in emit surfaces, no
  #681 migration — and that ordering is prose until this gate exists.
- **(b) A private v2 regex in the predicate now, a parity test later.** Cost: a second
  grammar kept equal to the first only by a test, the drift the issue names; and #679's own
  vocabulary is not settled (13 codes in its body against DR-053's 22).

**DQ-4 — What are the v2 placeholder forms?**
- **(a) Digit run replaced by `NNN`, project as `PRJ`: `SPNNN`, `PRJ/SPNNN`, `#NNN` (rec).**
  Cost: `SPNNN` reads awkwardly, and `PRJ` is not a real project code a reader will
  recognise as a placeholder without being told.
- **(b) v1 placeholders only; v2 example forms in emitted text need `dr-ok`.** Cost: any
  emitted text that teaches the v2 grammar (walkthrough, templates) carries a `dr-ok` on every
  example line.

**DQ-5 — Does `PR<n>` count, given DR-053 §2 rejected `PR` codes but §3's `RF` row uses
`MIN/PR451/RF3`?**
- **(a) Flag `PR<n>` only in the `…/PR<n>/RF<m>` shape (rec).** Cost: the egress grammar
  carries a code DR-053 itself is inconsistent about; #679 must reconcile it, and this gate
  follows.
- **(b) Ignore `PR` until DR-053 is reconciled.** Cost: review-finding handles (#465) that
  reach an emitted string leak.

**DQ-6 — Case-sensitive or case-insensitive?** DR-053 §1 accepts lowercase input and renders
uppercase.
- **(a) Uppercase only (rec).** Cost: a hand-typed lowercase `min/sp19` in an emitted string
  slips through; it relies on MinSpec's emitted strings being canonical, which a reviewer — not
  a gate — checks.
- **(b) Case-insensitive.** Cost: path false positives on any three-letter directory followed
  by an approvable-shaped name (`lib/sp1.ts`, `src/dr2/`), each needing a `dr-ok`.

---

## Resolved by the author

Recorded under the session's `act` autonomy so a reader can review them; approval of this spec
ratifies them.

- **RD-1 — A new spec, not an amendment to SPEC-021.** SPEC-021 is approved (sidecar at
  `.minspec/approvals/specs/minspec/SPEC-021-dr-ref-isolation/requirements.md.json`); editing
  it voids that approval for a change that only widens its predicate. *Rejected: amend
  SPEC-021.* Cost: re-approval of a spec whose other FRs are unchanged.
- **RD-2 — No new DR.** The predicate and its options are reversible in under a day (a test
  predicate and a few emitted strings). The costly choice — one shared grammar module — is
  already DR-053 §4/Costly-to-refactor plus #679's scope; this spec states a requirement on it
  (FR-7), not a new decision. *Rejected: a DR for "share one grammar module".* Cost: none
  found; it would duplicate DR-053.
- **RD-3 — Over-detect relative to SPEC-035 (INV-3).** The two detectors share a vocabulary
  but not a tolerance: a lozenge false positive is visual noise, an egress false negative is a
  leak. *Rejected: reuse SPEC-035's detector unchanged.* Cost: two scanners over one
  vocabulary, which INV-2 and AC-9 keep honest.

---

## Out of scope

- **Building SPEC-021's gate itself** (its FR-2 render test and FR-3 static scan) and its
  FR-1b strip — SPEC-021's. FR-10 says how the two meet.
- **Runtime stripping or rewriting of output** — rejected by DR-032 Decision 4.
- **The `project-prefix` v2 module** (#679), **corpus migration** (#681), **lozenge rendering**
  (SPEC-035). This spec places one requirement on #679 (FR-7) and does not build it.
- **MinSpec's own repo docs/specs/site** — exempt per SPEC-021 OQ-2.

---

## Dependencies and ordering

- **#679 (hard predecessor for the v2 half, under DQ-3 (a)).** The v1 issue-ref half (FR-4
  under DQ-1 (a)) and FR-1 do not need it.
- **SPEC-021's gate** — FR-10; either order works.
- **#681 must not start before this lands** (INV-6); the same holds for any change that puts a
  v2 form into an emit surface.

---

## Traceability

- **Issue:** [#683](https://github.com/AIClarityAU/minspec/issues/683)
- **Decisions:** [DR-032](../../../docs/decisions/DR-032.md) (the rule),
  [DR-053](../../../docs/decisions/DR-053.md) v2 (the grammar; §Consequences and R4 name this
  follow-up)
- **Specs:** [SPEC-021](../SPEC-021-dr-ref-isolation/requirements.md) (the gate),
  [SPEC-035](../SPEC-035-approvable-ref-lozenges/requirements.md) (the sibling detector)
- **Sibling issues:** #679 (module v2), #681 (migration), #669 (SPEC-021 FR-1b leak), #225
  (origin of the scaffolded `tasks.md` body)
- **Next phases (T3 — full spec cycle):** clarify → plan → tasks → implement, after approval.
