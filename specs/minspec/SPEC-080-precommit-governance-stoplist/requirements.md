---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — DR-086 lives here; this spec is that record's stop-list made queryable, not a new methodology
aspects: [governance, autonomy, hitl, dispatch, deny-by-default, tier-0, cross-repo, silent-gate]
relates_to: [DR-086, DR-074, DR-003, SPEC-065]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-080: A queryable governance stop-list, so a commit-classifying chore has something deterministic to ask before landing a DR-086-class file

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#1736](https://github.com/AIClarityAU/minspec/issues/1736)** — filed after a
2026-08-31 near-miss: the standing "commit/sync/report on the four primary checkouts" chore
classified `.minspec/config.json`'s uncommitted `"autonomy": "act"` edit as ordinary
committable work, committed it, and opened this repo's PR #1735 (correctly blocked by AI
review) — and separately pushed the same edit directly onto an open `AIClarityAU/scroogellm`
PR branch (scroogellm#151, commit `4ecee38`; self-reverted before that PR merged, on no gate
firing at all).

## One-Sentence Scope

Give the "is this diff safe to auto-commit?" classification step — wherever it runs, in this
repo or invoked from outside it — a deterministic, schema-derived predicate for "is this path
on the DR-086-class governance stop-list" to consult, so that determination stops depending on
a model remembering DR-086 §2.6 and starts depending on a function call with a testable answer.

## Context

### What actually caught this, and what did not

- **Caught:** `auto-merge-gate.ts`'s `BOUNDARY_GOVERNANCE_PATHS` / `isBoundaryPath`
  (`scripts/auto-merge-gate.ts:646`) classifies `.minspec/config.json` HIGH blast at
  **merge time**, so the ai-review panel held PR #1735. This is DR-086's own amendment
  language working exactly as documented: *"`scripts/lib/autonomy.ts` still denies any diff
  touching `scripts/lib/autonomy.*` or `.minspec/config.json` even under `act`."*
- **Not caught, because nothing exists there at all:** the step that decided this diff was
  "real work" worth committing in the first place. That step runs **before** any PR exists.
  Per this repo's own `CLAUDE.md` (merge-funnel section), the chore in question is a prose
  habit that lives in the operator's own Claude configuration — the chief-of-staff skill —
  "outside this repository," not code this repo's tree contains or can edit.
- **No gate at all, in the sibling repo:** the same edit, sitting in
  `AIClarityAU/scroogellm`'s `.minspec/config.json` (scaffolded from the same managed-region
  schema), was pushed straight onto an *already-open* PR branch — "no fresh-PR review gate" —
  and was caught only because the session driving it recognized the pattern, not because any
  mechanism fired. scroogellm keeps its own, separate local DR register (DR-027) and has no
  `DR-086` of its own, so a check that only knows to cite *"DR-086 §2.6"* resolves to nothing
  there.

### Why "the merge gate already caught it" does not close this (constitution invariant 2)

Constitution invariant 2: no required check may hinge on a single producer that one
permission/config gap can disable — an independent second witness is required. Today there is
exactly **one** producer standing between an autonomy-setting edit and a merged PR:
`isBoundaryPath`'s `BOUNDARY_GOVERNANCE_PATHS` check, evaluated only once a PR reaches
ai-review. It fired this time. Nothing upstream of that — the decision to commit, or to push
directly onto an already-open branch — has any governance awareness, and the scroogellm half
of this same incident shows that path is not hypothetical: a direct push to an open PR branch
may not re-trigger the review that would have caught it.

### What #1736 asks for, scoped by what this repo can actually ship

The issue's suggested fix — exclude, or route to human confirmation, "any path matching
DR-086's stop-list" from the chore's classification step — assumes direct edit access to that
step. This repo does not have that access: the step is prose in the operator's own Claude
configuration, the same boundary `CLAUDE.md`'s merge-funnel section already draws for a
different chore ("the other half... lives only in the chief-of-staff skill, outside this
repository"). What this repo **can** ship, consistent with constitution invariant 3 (MinSpec's
blast radius is the project it is installed in), is:

1. one canonical, single-source definition of the governance stop-list (reusing, not
   duplicating, `BOUNDARY_GOVERNANCE_PATHS`);
2. a deterministic, scriptable predicate over that definition, callable against any target
   checkout, that any classification step — in this repo or invoked from outside it — can
   consult before treating a diff as auto-committable;
3. an explicit, named follow-up for the part this repo cannot do itself: actually wiring an
   out-of-repo prose chore to call the predicate.

Treating (1)+(2) alone as "fixed" would leave exactly the prose-only-follow-up leak this
repo's own traceability convention exists to catch — hence (3) being a functional requirement
below, not an aside.

## Functional Requirements

- **FR-1 — One definition, not two.** The set of governance stop-list paths (starting with
  `.minspec/config.json`, per DR-086 §2.6 — "anything that would edit this list, or the
  autonomy setting itself") MUST be defined once and reused by both the existing merge-time
  classifier (`BOUNDARY_GOVERNANCE_PATHS` in `auto-merge-gate.ts`) and any new pre-commit
  predicate this spec adds. Never a second, independently maintained copy that can drift from
  the first the instant either changes (same discipline DR-063 established for the ai-review
  label family, restated by SPEC-079 FR-1 for the dispatch-quota classifier).

- **FR-2 — A schema-derived definition, not a DR-citing one.** The predicate must also answer
  correctly inside repos that do not carry this repo's own decision register (scroogellm's
  DR-027-mandated separate register; any future adopter with none at all). The stop-list's
  definition MUST therefore be expressible from `.minspec/config.json`'s schema/shape alone
  (e.g. "the `autonomy` key, and any other key a future amendment marks the same way") —
  never "cite DR-086 §2.6," which resolves to nothing outside this repo's own `docs/decisions/`.

- **FR-3 — A queryable predicate, callable before a commit exists.** Provide a deterministic
  CLI seam — extending `scripts/lib/autonomy.sh`'s existing pattern, or a sibling script — of
  the shape `<script> --is-stoplist-path --repo-root <path> --path <repo-relative-path>`,
  answering yes/no for one path in one target repo, runnable against any checkout a cross-repo
  chore walks (not only this one). Fails closed at every edge exactly like `readAutonomy`/
  `mayProceed` already do: an unreadable target, a missing script, or a malformed config
  answers "yes, treat as stop-list" — never "no, safe."

- **FR-4 — Second witness, not a replacement.** The new predicate supplements, and must not be
  substituted for, the existing merge-time `isBoundaryPath` / `BOUNDARY_GOVERNANCE_PATHS`
  check. A design that removes or weakens the merge-time gate on the theory that "the
  pre-commit predicate already caught it" would collapse two witnesses back into one
  (constitution invariant 2) and is explicitly out of bounds for this spec's Plan.

- **FR-5 — The wiring gap is named, not silently absorbed.** This repo's own code cannot reach
  into the operator's out-of-repo chief-of-staff skill and make it call FR-3's predicate
  (constitution invariant 3 — MinSpec's blast radius stops at its own opted-in checkout; the
  skill's own text lives outside any repo's tracked files). Plan/Tasks for this spec MUST file
  that wiring as an explicit, separate, out-of-repo follow-up — mirroring `CLAUDE.md`'s own
  `#2056` precedent for its merge-funnel's other half — rather than let FR-1–FR-4 alone be
  reported as closing #1736.

- **FR-6 — `CLAUDE.md` gains a citable pointer.** Once FR-3 ships, the next touch of
  `CLAUDE.md`'s standing-chore guidance SHOULD name the predicate by path, so a future session
  — in this repo or reading this file from any checkout — has something to *call* rather than
  a rule to *remember*. A documentation requirement, not an in-repo mechanism on its own.

## Invariants (must not break)

- **INV-1 — No silent gate (constitution invariant 2).** FR-3's predicate fails CLOSED on any
  doubt (unreadable config, missing file, unrecognised key shape) — never fails open to "not
  on the list."
- **INV-2 — Blast radius (constitution invariant 3, [DR-074](../../../docs/decisions/DR-074.md)).**
  Nothing this spec ships changes behaviour in a repo that has not opted in via `.minspec/` at
  its root; the predicate is *invoked* against a target checkout, never auto-installed into
  one as a side effect of running it.
- **INV-3 — Second witness preserved (FR-4).** Merge-time `isBoundaryPath` continues to hold
  `.minspec/config.json` HIGH independent of whether FR-3's predicate is ever wired into
  anything external — asserted, not assumed (mirrors the counterfactual test pattern
  `autonomy-setting-boundary.test.ts` already uses for the existing witness).
- **INV-4 — Offline core (constitution invariant 1, DR-004).** The predicate makes no network
  call; it reads local files only, matching `readAutonomy`'s existing shape.
- **INV-5 — DR-086 §2.6 unweakened.** Nothing here narrows what DR-086 §2.6 already stops on;
  FR-2's schema-derived reframing must be a superset-safe restatement of §2.6, never a loophole
  that admits a path §2.6 already covers.

## Acceptance Criteria

- [ ] **One producer, two consumers.** `BOUNDARY_GOVERNANCE_PATHS` and the new predicate read
      from the same exported definition; a test fails if a path is added to one without the
      other. (FR-1)
- [ ] **Scroogellm-shaped case passes.** The predicate, given a target repo with no
      `docs/decisions/DR-086.md` at all, still correctly flags `.minspec/config.json`'s
      `autonomy` key. (FR-2)
- [ ] **CLI seam exists and fails closed.** Missing `--repo-root`, an unreadable config, or a
      target with no `.minspec/` directory all answer "stop-list: yes" (exit reflecting
      deny), never "no." (FR-3, INV-1)
- [ ] **Merge-time gate is unchanged and still tested.** `autonomy-setting-boundary.test.ts` (or
      its successor) still asserts the merge-time witness holds `.minspec/config.json` HIGH
      with the new predicate absent from the call path entirely. (FR-4, INV-3)
- [ ] **Wiring follow-up is filed, not implied.** The Plan/Tasks artifacts for this spec link a
      concrete, separate tracking item for connecting an out-of-repo chore to the new
      predicate — its absence is a defect in this spec's own completion, not an acceptable gap.
      (FR-5)
- [ ] **No new network call.** Nothing added by this spec appears in `invariants.test.ts`'s
      network/child-process allowlist without a corresponding DR. (INV-4)

## Decisions needed (Clarify)

- **DQ-1 — Where does the new predicate live, and does it ship to adopters?** Two live shapes:
  - **(A) minspec-repo-local dev tool** (`scripts/lib/*`, never scaffolded elsewhere).
    Cheapest to build, but then scroogellm's own checkout has nothing local to call — a
    cross-repo chore would have to special-case "always ask minspec's checkout regardless of
    which repo I'm classifying," a topology assumption this spec should not bake in silently.
  - **(B) a managed-region script MinSpec scaffolds into every `.minspec/`-initialised repo**,
    so scroogellm's (and any future adopter's) own checkout carries its own copy. Correct
    per-repo availability, but is new scaffolding scope — the same class of decision SPEC-079
    DQ-2 flagged as needing its own DR before Plan, being a first-time ownership claim over
    something every current repo would newly receive.
  - *Recommendation:* **(B), gated behind a DR before Plan.** The measured incident is
    cross-repo by construction (minspec **and** scroogellm both carried the same edit); (A)
    structurally cannot serve the case that motivated this spec. *Cost:* the same
    migration/scaffolding cost class SPEC-079 priced for its own managed-region addition — every
    current adopter's checkout needs the new file on its next refresh.

- **DQ-2 — Exact contents of the stop-list beyond `.minspec/config.json`.** The issue's
  phrasing ("whatever else DR-086 §6 enumerates") does not quite parse: DR-086 §2 enumerates
  stop **classes** (irreversible acts, T3/T4 approval, spend, evidence-incomplete, genuine
  ties), not a path list; only §2.6 names one concrete file. *Recommendation:* scope FR-1/FR-3
  to `.minspec/config.json` only for this spec — the one file the measured incident actually
  touched — and treat any broader path enumeration (e.g. `docs/decisions/*.md` status flips)
  as a separate follow-up once a second concrete near-miss motivates it, rather than
  speculative scope no incident has yet justified (CLAUDE.md triage rule 2 — "also support X"
  tacked onto an in-scope request needs its own confirmation). *Cost:* a future near-miss on a
  different file repeats this filing cycle instead of being pre-empted now.

- **DQ-3 — Does this need its own DR?** Shipping a new cross-repo predicate/scaffolding entry
  point that every `.minspec/`-initialised checkout would newly carry is the DR-359 ADR
  filter's shape (hard to reverse in a day once adopters' checkouts carry it).
  *Recommendation:* **yes, required before Plan, if and only if DQ-1 resolves to (B).** Not
  required if (A). Mirrors SPEC-079 DQ-2's conditional pattern exactly, for the same reason.

- **DQ-4 — Fold with `minspec#1614`?** DR-086's own unresolved follow-up
  (*"make the enumerated stop list an ENFORCED artifact rather than prose"*) is the general
  form of what this spec proposes for one file and one moment. *Recommendation:* **keep this
  spec narrower and cross-linked, do not fold.** `#1614` is about the autonomy axis's
  `mayProceed` stop classes at **decision time** (an agent weighing whether to act on its own
  recommendation); this spec is about a **different** moment — a chore that never calls
  `mayProceed` at all, because it isn't reasoning about autonomy, it's mechanically diffing
  against `origin/<branch>`. Related, not the same defect; folding would block a fix for a
  measured, dated near-miss on a much larger, unscoped item with no deadline pressure of its
  own. *Cost:* two related gaps close on two schedules rather than one.

## Out of Scope

- **Editing the chief-of-staff skill itself.** Lives outside this repository's tree; FR-5
  names the gap instead of attempting to close it from here.
- **Writing scroogellm-side code.** A different repository; if DQ-1 resolves to (B), this spec
  ships the scaffolding definition *from* this repo — landing it *into* scroogellm is that
  repo's own next-refresh event, not a deliverable of this PR.
- **Resolving `minspec#1614`'s broader scope.** Related per DQ-4, not absorbed.
- **Any extension/UI surface for the predicate.** Script/CLI only, per FR-3 — no webview, no
  command palette entry.

## Alternatives considered and rejected

Recorded because this dispatch ran under autonomy `act` (DR-086 §4 — the human is not seeing
these live, so this record is the only review path for what was rejected and why):

- **Treating PR #1735's block as sufficient and closing #1736 with no spec.** Rejected —
  single producer, constitution invariant 2; the scroogellm half of the same incident shows
  the single producer is not even always reachable.
- **Specifying the fix as a direct edit to the chief-of-staff skill.** Rejected — that skill's
  text is not in this repository's tree; constitution invariant 3 and `CLAUDE.md`'s own
  merge-funnel precedent both draw this exact boundary already, for a different chore.
- **Enumerating a broad stop-list now (all of DR-086 §2, not just §2.6).** Rejected (DQ-2) — no
  measured incident motivates the other five classes at the commit-classification layer yet.
- **Folding into `minspec#1614`.** Rejected (DQ-4) — different moment, different defect, no
  shared deadline.

## Traceability

- **Issue:** [#1736](https://github.com/AIClarityAU/minspec/issues/1736) — this spec's origin.
- **DR this predicate encodes:** [DR-086](../../../docs/decisions/DR-086.md) §2.6 ("anything
  that would edit this list, or the autonomy setting itself"), and its Amendment A (the
  concrete `autonomy: act` setting the near-miss edited).
- **Existing single witness, unchanged by this spec:** `scripts/auto-merge-gate.ts:646`
  (`BOUNDARY_GOVERNANCE_PATHS`).
- **Related, not absorbed:** `minspec#1614` — DR-086's own broader "enforce the stop list,
  don't trust the model" follow-up (DQ-4).
- **Blast radius:** [DR-074](../../../docs/decisions/DR-074.md) (constitution invariant 3).
- **Autonomy resolver, still open:** [SPEC-065](../SPEC-065-solo-mode-ceremony-cut/requirements.md)
  — `autonomy` remains absent from `MinspecConfig`/`DEFAULT_CONFIG`
  (`packages/minspec/src/lib/config.ts`), tracked separately as `minspec#1795`; this spec does
  not depend on that landing first, since FR-2/FR-3 read `.minspec/config.json` directly, the
  same way `readAutonomy` already does.
- **Sibling near-miss, self-corrected, no gate fired:** `AIClarityAU/scroogellm#151` (commit
  `4ecee38`) — the evidence for FR-2 (a DR-citing definition would not have helped there).
- **DR for this spec:** none yet, by design — DQ-3 states the exact condition (DQ-1 resolving
  to Option B) under which one becomes required before Plan completes.
