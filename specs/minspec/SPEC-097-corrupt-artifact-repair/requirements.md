---
id: SPEC-097
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-005  # Auto Structure Repair — SPEC-005's own epic; this is its explicitly out-of-scope corrupt-artifact half
relates_to: [SPEC-005, DR-006, DR-004, "#39", "SCR/IS4"]
implements: none
implements_reason: >-
  Specification only — this dispatch is Specify-phase, authorised by the T3 triage gate
  (DR-076/#1169), and writes no source. Nothing in `packages/minspec/src/lib/config.ts`,
  `constitution.ts`, `auto-bootstrap.ts`, or `preferences.ts` has a corrupt-artifact
  detector or repair path today — verified: `loadConfig` (config.ts:179-192) catches a
  JSON.parse failure and silently returns `DEFAULT_CONFIG` with no signal anywhere else;
  `parseConstitution` (constitution.ts:128-139) never throws and degrades a garbled file
  to `EMPTY_CONSTITUTION` the same way; there is no `.bak`-writing code anywhere under
  `packages/minspec/src`; and `BOOTSTRAP_STEPS` (auto-bootstrap.ts:597) has no step whose
  `shouldRun` inspects file *validity* rather than *existence*. No plan.md/tasks.md exists
  yet, so no new module path is decided — this spec declares owned files at
  implementation, per the SPEC-034/SPEC-005 precedent.
affects:
  - packages/minspec/src/lib/config.ts
  - packages/minspec/src/lib/constitution.ts
  - packages/minspec/src/lib/auto-bootstrap.ts
  - packages/minspec/src/lib/preferences.ts
  - packages/minspec/src/lib/scaffold.ts
---

# MinSpec — Corrupt `.minspec` Artifact Repair (Requirements)

**Date:** 2026-10-02
**Status:** Specifying (SDD Specify phase — nothing built)
**Decision:** [DR-006](../../../docs/decisions/DR-006.md) (offer model, origin of the
out-of-scope line this spec fills), parent spec [SPEC-005](../SPEC-005-auto-structure-repair/requirements.md)
**Triggered by:** [#39](https://github.com/AIClarityAU/minspec/issues/39) — parked out of
SPEC-005 review, 2026-05-30

> **SPECIFICATION ONLY.** This file is the Specify-phase deliverable for #39. A human
> reads it, resolves the two items under **Decisions needed (Clarify)**, and approves it
> through the normal spec-approval gate before Plan/Tasks/Implement begin.

**Id note.** `SPEC-096` is the highest id on this worktree's disk as of 2026-10-02. This
dispatch has no network access (Tier-0 constraint on this agent run, not on MinSpec
itself) and so could not run `scripts/lib/spec-id-collision.ts`'s sibling check against
open pull requests or other local worktrees the way SPEC-096 itself documents doing. If
`SPEC-097` collides with another in-flight id at review time, renumber per the
collision-gate convention (CLAUDE.md "Decision Register").

**Tier note.** The predicted tier from triage was T3/T4 (full ceremony required either
way for this dispatch). Scope below touches five existing library files plus new test
files and (likely) one new small backup-helper module — comparable to SPEC-005's own
footprint, well under the 15-file/500-line T4 marker the classifier uses
(`packages/minspec/src/lib/git-analyzer.ts:34-50`). This spec sets **T3**; the tier is an
upward-only floor and Plan may raise it if the file count grows.

## One-Sentence Scope

Teach the existing detect-and-offer system (DR-006 / SPEC-005) to recognise `.minspec/config.json`
and `.minspec/constitution.md` as broken when they are **present but unparsable or
malformed** — not just when they are missing — and, only on explicit user acceptance,
back up the broken file before replacing it with the same canonical content a missing
file would get.

## Context

SPEC-005 closed two gaps in the original DR-006 auto-bootstrap: shallow "does `.minspec/`
exist" detection, and activation-only (not reactive) checking. Both describe *missing*
artifacts. SPEC-005's own "Alternatives Considered" names the corrupt case explicitly and
defers it:

> "Repairing corrupt (not just missing) artifacts — deferred, not chosen now: invalid
> `config.json` / malformed constitution repair is parked (addendum 'Not in scope')."

That gap is live today, verified in the current code:

- **`loadConfig`** (`packages/minspec/src/lib/config.ts:176-192`): "Invalid JSON = pure
  defaults" — a `try { JSON.parse(...) } catch { return DEFAULT_CONFIG }` with no signal
  to the user that their file didn't parse. Worse, **`setCoverageMinimum`**
  (`config.ts:232-249`) hits the *same* catch, sets `parsed = {}`, and then
  `writeFileSync`s that empty object back over the original file — on a config.json that
  fails to parse, the next coverage-threshold write silently discards every other key the
  file held, with no backup. This is the concrete, already-shipped instance of the
  invariant #39's Considerations names ("must never silently discard user content",
  SCR/IS4 — [`harvest316/scroogellm#4`](https://github.com/harvest316/scroogellm/issues/4)):
  it is not hypothetical risk, it is a present code path.
- **`parseConstitution`** (`packages/minspec/src/lib/constitution.ts:128-139`): never
  throws. A garbled, truncated, or heading-renamed `constitution.md` degrades to
  `EMPTY_CONSTITUTION` (zero invariants/principles/constraints) exactly like an absent
  file would read to any caller that only checks "are there items" — silently, with no
  distinction from "this project genuinely has none."
- **`BOOTSTRAP_STEPS`** (`auto-bootstrap.ts:597`): every existing step's `shouldRun`
  tests *presence* (`isMinspecInitialized`, hash/drift comparisons). None tests
  *validity* of a present file's content.

The offer model this spec reuses, unchanged, is DR-006's: a dismissible toast
(`[Fix] / [Not now] / [Don't ask again]`) plus the `minspec.autoBootstrap.enabled` master
toggle. No new consent surface, no silent-apply setting — SPEC-005's FR-3 language
("MUST NOT auto-write without a user action") applies here unchanged, and this spec adds
nothing that weakens it.

## Requirements

- **FR-1 (corrupt detection — config.json).** A new, pure detector MUST report
  `.minspec/config.json` as *corrupt* (distinct from *missing*) when the file exists and
  either: (a) its content fails `JSON.parse`, or (b) it parses to a value whose root is
  not a plain object (array, string, number, boolean, or `null`). This detector is
  separate from `loadConfig`'s runtime fallback — it MUST NOT change `loadConfig`'s
  existing "invalid JSON → `DEFAULT_CONFIG`" behavior, which stays as the safe runtime
  default regardless of whether a repair offer was ever shown or accepted. Deeper,
  per-key schema validation is **Decisions needed, Clarify-1**.
- **FR-2 (corrupt detection — constitution.md).** A new, pure detector MUST report
  `.minspec/constitution.md` as *corrupt* when the file exists, is non-empty after
  trimming, and `parseConstitution(content)` yields zero total items across
  `invariants`, `principles`, and `constraints`. The exact heuristic boundary (this
  zero-items rule vs. a missing-canonical-heading rule) is **Decisions needed,
  Clarify-2**.
- **FR-3 (reuse the existing detection cadence).** Both detectors run wherever
  SPEC-005's missing-artifact detection already runs: once at activation and on the
  existing debounced `.minspec/**` watcher (SPEC-005 FR-2) — no new watcher, no polling
  loop.
- **FR-4 (new BootstrapStep entries, own dismissal keys).** Each corrupt detector
  surfaces through its own entry in `BOOTSTRAP_STEPS`, with its own `skipPrefKey`
  (e.g. `skipConfigRepairPrompt`, `skipConstitutionRepairPrompt`), independent of the
  missing-artifact steps' keys — dismissing "repair corrupt config.json" MUST NOT
  suppress "create missing config.json" or vice versa, since the two predicates
  (present-but-invalid vs. absent) are mutually exclusive by construction (FR-1/FR-2
  only fire when the file exists) but their dismissals are not related, SPEC-005 FR-5's
  precedent notwithstanding.
- **FR-5 (offer text names the backup).** The toast message for a corrupt-artifact step
  MUST state that a backup will be kept (e.g. "...; the current file will be saved as
  `config.json.bak` first") — not a generic "Fix" label — so acceptance is informed
  consent about losing the file's current (broken) content, per the "no silent gate"
  sibling concern (constitution invariant 2) applied to a one-shot file operation rather
  than a CI gate.
- **FR-6 (backup before any write).** Accepting `[Fix]` MUST copy the corrupt file
  byte-for-byte to a backup path *before* any write to the original path. If that backup
  write fails for any reason (permissions, disk full), repair MUST abort before touching
  the original file and surface the failure visibly (e.g. an error toast) — never a
  partial state where the original is altered and no backup exists.
- **FR-7 (never clobber an existing backup).** If the chosen backup path already exists
  (e.g. a prior repair ran, or the user has their own `config.json.bak`), repair MUST NOT
  overwrite it. It picks a non-colliding name instead (e.g. a timestamp suffix) so no
  prior backup is ever silently discarded.
- **FR-8 (repair = the canonical default, after backup).** After the backup lands,
  repair overwrites the corrupt file with the same canonical content the *missing*-file
  path (`scaffold()` / the template engine) would write for that file — i.e. a
  corrupt-then-repaired file and a missing-then-created file end up byte-identical. This
  is a full reset, not a field-level merge; see Clarify-1 for the alternative and its
  cost.
- **FR-9 (consent reuse).** Honors the existing per-check `preferences.json` dismissals
  and `minspec.autoBootstrap.enabled` master toggle (SPEC-005 FR-5) — no new consent
  surface beyond the new per-check keys in FR-4.
- **FR-10 (Tier 0).** Detection and repair are pure file-system; zero AI calls, zero
  network calls (DR-004, constitution invariant 1) — same guarantee SPEC-005 FR carries
  for the missing-artifact path, extended to corrupt-artifact handling.

## Non-goals

- Repairing any artifact other than `.minspec/config.json` and `.minspec/constitution.md`
  — the issue scopes to these two by name; other harness outputs stay under SPEC-005's
  existing missing-only model until a separate issue asks otherwise.
- Repairing `.minspec/preferences.json` itself — out of scope; a corrupt preferences
  store falls back the same way `loadConfig` does today (not addressed here).
- Any form of field-level salvage/merge for a schema-failing-but-parseable config.json in
  v1 — Clarify-1's recommended option explicitly defers this.

## Costly to Refactor (Zone A)

1. **The corrupt/missing predicate boundary (FR-1, FR-2).** Once shipped, "what counts as
   corrupt" becomes the de-facto contract the same way SPEC-005's "required artifact set"
   did (SPEC-005 Costly #1). Loosening or tightening either heuristic later reclassifies
   files that were previously silent (no offer) into "corrupt" (an offer appears) for
   projects that never changed — a retroactive surprise, same shape as SPEC-005's
   Costly-#1 risk.
2. **The backup-naming scheme (FR-7).** Whatever collision-avoidance naming repair picks
   when `.bak` already exists becomes a user-visible filesystem contract the moment one
   adopter hits it twice. Changing it later orphans backups made under the old scheme.
3. **FR-8's full-reset-not-merge choice.** If Clarify-1 is later reopened in favor of
   field-level salvage, the "corrupt → byte-identical-to-missing" guarantee FR-8 states
   no longer holds, and anything that started depending on it (tests, docs, user
   expectation) breaks.

## Invariants (must hold)

- **INV — Tier 0 (DR-004 / constitution invariant 1):** detection + repair are pure
  file-system; no AI, no network.
- **INV — offer, never silent (DR-006, SPEC-005 FR-3 extended):** no corrupt-artifact
  write happens without the user acting on the toast; `[Not now]` and `[Don't ask again]`
  never write.
- **INV — no silent discard (issue #39's named concern, SCR/IS4):** a backup of the
  pre-repair content exists on disk, under a name that was not already taken, before any
  overwrite of the original (FR-6, FR-7).
- **INV — user override wins (DR-006):** every offer dismissible per-check; master
  toggle exits the whole detect-and-offer system including these two new steps.

## Decisions needed (Clarify)

**Clarify-1 — How strictly should "schema-failing" config.json be defined, and what does
repair do with a file that parses but is wrong-shaped?**

- **Option A — narrow corruption, full-reset repair (rec).** "Corrupt" means only
  "fails `JSON.parse`" or "root is not an object" (FR-1 as written above). A config.json
  that parses fine but has a badly-typed known key (e.g. `specsDir: 42`) is NOT flagged —
  it stays exactly as permissively handled as it is today (`deepMerge` against
  `DEFAULT_CONFIG`, `normalizeAutonomy`'s deny-by-default coercion). Repair, when it does
  fire, is always a full backup + overwrite with `DEFAULT_CONFIG` (FR-8).
  **Cost:** a config.json with one bad key gets no repair offer at all; the user only
  discovers it when the setting it drives misbehaves — the same silent gap that exists
  today, just not widened. Smallest blast radius and reuses nothing new to validate
  per-key shape.
- **Option B — full schema validation, field-level salvage repair.** Validate every known
  `MinspecConfig` key's type; any mismatch counts as corrupt. Repair backs up, then keeps
  every key that validates and resets only the ones that don't.
  **Cost:** materially more code (a schema table plus a per-key salvage merge) and a new,
  unresolved sub-question this issue doesn't answer — what happens to an *unknown* key
  the user added (a setting from a newer MinSpec, or a typo they'd want to keep)? Treating
  "additive, never discard" strictly argues for keeping unknown keys too, which argues
  against a reset-shaped repair at all for this case.

**Clarify-2 — What heuristic decides `constitution.md` is "corrupt" rather than
genuinely, legitimately empty?**

- **Option A — zero-items heuristic (rec).** File exists, non-empty after trim, and
  `parseConstitution` returns zero total items across all three sections (FR-2 as
  written). Reuses the shipped parser untouched, no new parsing code.
  **Cost:** a constitution that is intentionally sparse — say, a project with real
  Constraints but genuinely zero Invariants and zero Principles yet — is a false
  positive and gets an unwanted repair offer. (No corpus example of this today, but
  nothing requires all three sections be non-empty.)
- **Option B — missing-canonical-heading heuristic.** Corrupt only when *none* of
  `## Invariants`, `## Principles`, `## Constraints` (case-insensitive) is found as a
  heading at all, regardless of item counts under whichever headings do exist.
  **Cost:** misses the failure mode this issue is actually about — a bad merge or
  truncated write that keeps the headings but loses or garbles the body text under them,
  which is exactly what Option A's zero-items check catches and this option does not.
  Weaker detection, fewer false positives.

Approving this spec with no changes accepts the **(rec)** option on both.

## Acceptance Criteria (Zone A)

- [ ] A `.minspec/config.json` containing invalid JSON, or whose parsed root is not an
      object, is reported *corrupt* (not *missing*, not silently defaulted-with-no-signal)
      by the new detector (FR-1).
- [ ] A non-empty `.minspec/constitution.md` that parses to zero invariants, zero
      principles, and zero constraints is reported *corrupt* by the new detector (FR-2).
- [ ] Both new checks run at activation and on the existing debounced `.minspec/**`
      watcher, with no new watcher registered (FR-3).
- [ ] Dismissing the corrupt-config offer (`[Don't ask again]`) does not suppress the
      missing-config offer, and vice versa — distinct `skipPrefKey`s verified by test
      (FR-4).
- [ ] The corrupt-artifact toast's message text names the backup file it will create
      before any `[Fix]` action is wired to a write (FR-5).
- [ ] Accepting `[Fix]` on a corrupt file always produces a backup file on disk *before*
      the original path's mtime/content changes (FR-6) — verified by making the backup
      write throw and asserting the original file is byte-unchanged.
- [ ] Repairing the same corrupt file twice (or seeding an existing `config.json.bak`
      first) never overwrites the earlier backup — the second backup lands under a
      different name (FR-7).
- [ ] Post-repair, a previously-corrupt `config.json` is byte-identical to what a
      *missing* `config.json` would get from the existing scaffold path, and likewise for
      `constitution.md` (FR-8).
- [ ] A prior `[Don't ask again]` dismissal and `minspec.autoBootstrap.enabled = false`
      each suppress both new offers, same as every existing step (FR-9).
- [ ] Detection and repair perform zero AI/network calls — verifiable by code path, pure
      `fs` only (FR-10 / INV Tier 0).

## Assumptions

- `scaffold()` / the template engine already have canonical, deterministic "what should
  this file contain" output for `config.json` and `constitution.md` that FR-8 can reuse
  as the repair target — this spec does not invent new canonical content, only a new
  path to writing it.
- The existing toast primitive (`[Fix] / [Not now] / [Don't ask again]`, DR-006) can carry
  per-step custom message text (FR-5) without a new UI component — true today per
  `BootstrapStep.message` being a free-form string (`auto-bootstrap.ts:533`).
- No other code path currently depends on `loadConfig`'s silent-default behavior
  *changing* — FR-1 is explicit that this spec adds a parallel detector, not a change to
  `loadConfig` itself, specifically to avoid that risk.

## Test-thought

Verified by driving the real file system, not mocks: write a hand-corrupted
`config.json` (truncated JSON, and a valid-JSON-but-non-object case) and a
hand-corrupted `constitution.md` (headings present, bodies replaced with garbage so
`parseConstitution` returns zero items); assert each is detected as *corrupt* and not
*missing* (FR-1/FR-2); accept `[Fix]` and assert backup-then-overwrite ordering by making
the backup step throw and checking the original is untouched (FR-6); seed a pre-existing
`.bak` and assert it survives a second repair (FR-7); diff the post-repair file against
what `scaffold()` produces for a missing file on a clean fixture (FR-8).

## Consequences

**Positive:**

- Closes the exact gap SPEC-005 named and deferred — "corrupt (not just missing)" — using
  the same offer model and watcher infrastructure, no new UX pattern for the user to
  learn.
- Removes a real, already-shipped silent-discard path: `setCoverageMinimum` writing
  `{}`-plus-new-key over an unparsable `config.json` with no backup becomes, after this
  spec, a state the user was already offered (and could have accepted or declined) a
  backed-up repair for.

**Negative:**

- Two more activation-time detectors and two more toast steps add a small steady-state
  cost (SPEC-005's R2 toast-storm risk pattern repeats for config/constitution checks and
  needs the same debounce/dedupe discipline).
- FR-8's full-reset repair (Clarify-1 Option A) means a config.json with a merely
  wrong-typed key gets no help here — users with that narrower failure mode still see
  nothing, same as today.

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | **Backup write fails but original is already changed.** A crash or error between backup and overwrite destroys the only copy of the user's (broken but possibly partially-recoverable) content with no backup. | Low · High | FR-6: backup write MUST complete and be verified before the original path is touched at all; abort-and-surface on backup failure. |
| R2 | **Constitution false positive (Clarify-2 Option A).** A legitimately sparse constitution gets an unwanted repair offer. | Low · Low | Offer-only, dismissible (`[Not now]`/`[Don't ask again]`, FR-9); worst case is one extra toast, never a forced write. |
| R3 | **Backup-name collision silently clobbers a prior backup.** Two repairs (or a user's own `.bak` file) collide on one filename. | Med · High (data loss) | FR-7: non-colliding name required; named Costly-to-Refactor #2 so the scheme is chosen deliberately, not organically. |
| R4 | **Toast-storm from two new steps compounding SPEC-005's existing three.** | Med · Med | Reuses SPEC-005's debounce/dedupe-vs-activation machinery (FR-3) rather than adding a parallel timer. |
| R5 | **Scope creep into per-key salvage during Plan.** Clarify-1's Option B is more thorough and tempting to build "properly." | Med · Low | This spec's FR-8 and Clarify-1's recorded recommendation are the gate; Plan should not silently upgrade to Option B without reopening Clarify. |

## Failure-Modes / Edge-Cases

1. **Backup collision (FR-7).** `<name>.bak` already exists at repair time (prior repair,
   or a user's own file) — repair must pick a different name, never overwrite it.
2. **Crash between backup and overwrite (FR-6/R1).** Process killed after the backup
   lands but before the canonical content is written — the original is still corrupt;
   detection must keep offering repair (idempotent retry), not treat the file as already
   fixed.
3. **Missing/corrupt mutual exclusivity.** A file cannot be simultaneously absent
   (SPEC-005's detector) and present-with-bad-content (this spec's detector) — the two
   step sets must never both fire for the same file at once; tested directly.
4. **Dismiss-then-recorrupt.** User dismisses the corrupt-constitution offer
   (`[Don't ask again]`), later edits make it corrupt again for an unrelated reason —
   dismissal persists per SPEC-005's existing consent-reuse precedent (FR-9); accepted
   residual, consistent with the shipped behavior for missing artifacts.
5. **Constitution sparse-but-valid (Clarify-2 R2).** Zero items in one section is valid;
   zero items in *all three* is the chosen corrupt signal — a one-section edge case is
   explicitly out of FR-2's trigger condition.

## Test / Verification Strategy

| FR | Tier | Assertion sketch |
|---|---|---|
| FR-1 | T0 | Invariant: truncated-JSON and valid-JSON-non-object config.json both report *corrupt*; well-formed config.json (even with odd values) does not. |
| FR-2 | T0 | Invariant: constitution.md with real headings but zero parsed items reports *corrupt*; a well-formed sparse constitution with at least one item in any section does not. |
| FR-3 | T2 | Corrupting a file mid-session fires the debounced watcher path (reuse of SPEC-005's FR-2 test harness) with no new timer registered. |
| FR-4 | T0 | Dismissing one new step's `skipPrefKey` leaves the other new step's and all SPEC-005 steps' `shouldRun` unaffected. |
| FR-5 | T0 | Each new step's `message` string contains the literal backup filename it will use. |
| FR-6 | T0 | Invariant: force the backup write to throw; assert the original file's bytes are unchanged and no overwrite occurred. |
| FR-7 | T0 | Invariant: pre-seed a `.bak` file with known content; run repair; assert the pre-seeded file is byte-unchanged and a second, differently-named backup now exists. |
| FR-8 | T0 | Invariant: repaired corrupt file's bytes equal the bytes `scaffold()` writes for the same file when it was missing on a clean fixture. |
| FR-9 | T2 | With dismissal recorded or `autoBootstrap.enabled=false`, neither new offer surfaces. |
| FR-10 | T0 | Invariant: no `http`/`https`/`fetch` import reachable from either new detector or the repair path. |

## Alternatives Considered

- **Silent auto-repair on detection.** Rejected outright — contradicts DR-006's offer
  model and the issue's own Considerations ("Offer-model only (DR-006), never silent").
- **Field-level salvage as the only repair strategy (no full-reset option).** Considered
  and deferred to Clarify-1 Option B rather than adopted directly — more code, and an
  unresolved unknown-key question this issue doesn't settle; the full-reset option (A) is
  simpler and ships first.
- **A standalone CLI/lint command instead of extension-activation detection.** Rejected —
  MinSpec is a VS Code extension, not a CLI (CLAUDE.md "Commands and locations"); a
  separate validator command would also break the "fix whenever needed, no extra step to
  remember" promise DR-006 and SPEC-005 already established for the missing-artifact
  case, reintroducing exactly the discovery problem DR-006 was written to remove.
- **Reusing the SAME `skipPrefKey` as the corresponding missing-artifact step.** Rejected
  (FR-4) — collapsing the two would let a "don't ask about missing config" dismissal also
  silently suppress a later, unrelated "this config.json is now corrupt" offer, which is
  a worse failure mode than one extra preference key.
