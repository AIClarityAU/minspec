---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a spec must not claim implemented/implementing with no code behind it
aspects: [lifecycle, status, signpost, never-wrong, tier-0, validator]
relates_to: [SPEC-038, SPEC-064, SPEC-015, SPEC-026, SPEC-027, SPEC-031, SPEC-034, DR-003, DR-069]
implements: none
implements_reason: Specify phase only — owned validator files are declared at Plan, before approval advances the spec (SPEC-038 FR-3 note, #1489).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A spec cannot sit at `implementing`/`done` with no code behind it, nor reach Plan before Clarify (Requirements)

> Traces to **[#818](https://github.com/AIClarityAU/minspec/issues/818)**. Sibling to #692 (status-lane asymmetry) and to SPEC-064 (the `planning` status). Class: *artifact-existence ≠ feature-existence* (DR-003, SPEC-002).

## Implementation status — read this first (evidence discipline, DR-003)

The issue's **data symptoms are already repaired on `main`**. Measured at `origin/main` 5f792386:

| Issue claim | State on main (frontmatter read) |
|---|---|
| SPEC-026, SPEC-027, SPEC-034 `status: implementing`, no code | now `status: planning`, `plan: pending`/`in-progress`; SPEC-034 declares `implements: none` + reason "specified … not yet built" |
| SPEC-031 `status: specifying` | now `status: planning`; it declares `implements:` scripts that were not re-verified here |
| SPEC-015 `plan: done` while `clarify` not done | SPEC-015 carries **no `clarify` key at all**, `plan: done`, `implement: in-progress`, `status: implementing`, `implements: none` + reason |

So the lie was removed by data edits and by the `planning` status (SPEC-064 / DR-069). Per the RCDD sibling rule, a data fix is a tell that **the gate is still missing**. **A partial gate already exists** — `validateImplementEvidence` (`packages/minspec/src/lib/spec-validator.ts:1072`, #1751; wired at `scripts/validate-frontmatter.ts:~667` and in the approve gate): when `phases.implement` is `in-progress`/`done` and a declared `implements:` path is missing, it emits `implement.claimed-without-evidence`. Its three verified limits are this spec's gaps:

- **Severity is `warn` by default** (`config.implementEvidence`, `config.ts:164`) — it gates nothing today; `npm run validate` currently prints one such warning (SPEC-095).
- **The `implements: none` escape is exempt** (`spec-validator.ts:1090`) — SPEC-015 claims `implementing` with `none` and passes; `none` is satisfiable by any reason string.
- **It keys on `phases.implement`, not on the literal `status:`** — a spec at `status: implementing` whose `phases` block is absent or `implement: pending` is not evaluated (SPEC-064 D1 covers phases-vs-status; the combined state is unowned).
- **No phase-order rule exists**: SPEC-015's missing `clarify` with `plan: done` passes (no validator was found asserting ordering; grep for a phase-order rule in `packages/minspec/src/lib` found none).

## One-Sentence Scope

Tighten the existing implement-evidence rule so a spec at `implementing`/`done` cannot pass with missing owned files or an unjustified `implements: none`, flip it from `warn` to `error`, and add a phase-ordering rule (a later phase done/in-progress requires earlier required phases done).

## Functional Requirements

- **FR-1 — Extend `validateImplementEvidence` to the literal status.** The rule also fires when the literal `status:` is `implementing`/`done` (not only when `phases.implement` is), for T3/T4: every declared `implements:` path MUST exist. Reuse the one function (Goal: one rule, every surface) — no second copy.
- **FR-2 — `implements: none` at `implementing`/`done` needs a code-free classification.** A T3/T4 spec at `implementing`/`done` with `implements: none` is accepted only when it states it is code-free or modifies pre-existing files (see Decision D1 for the exact grammar); otherwise fail. Rationale: SPEC-015 built real behaviour yet declared `none`, and SPEC-034 declared `none` — one honest (no new file), one honest only because it is `planning`.
- **FR-3 — Greenfield stays legal before implementation.** `planning`/`specifying` specs MAY declare not-yet-existing paths (SPEC-038 FR-4 unchanged). FR-1 applies only from `implementing`.
- **FR-4 — Phase ordering.** For every spec with a `phases:` block, a phase that is `in-progress` or `done` requires each earlier **required-for-tier** phase to be `done` (order: specify, clarify, plan, tasks, implement; required set per tier ceremony). A missing required phase key counts as not done.
- **FR-5 — Fail visibly, never silently (invariant 2).** A spec whose frontmatter cannot be parsed, or whose `implements:` cannot be evaluated, fails the check closed with a visible error — never skipped.
- **FR-6 — Ratchet.** The new FR-1/FR-2/FR-4 findings ship at `warn`; once the corpus is clean, `implementEvidence` and the phase-order setting flip to `error` in one config change (SPEC-038 FR-7 pattern), recorded in this spec. Note the flip also arms the pre-existing SPEC-095 warning, which must be resolved first.
- **FR-7 — Repair SPEC-015.** Add the missing `clarify` phase value (or the spec's documented T3 exemption — see D2) so the corpus is green under FR-4. This is the only data edit; it happens at implement time, not in this Specify PR.
- **FR-8 — No new producer.** Does not add a second implement-evidence function and does not change the Approve command, `deriveStatus`, or the spec-gate hook; it adds validator rules only.

## Acceptance Criteria

- **AC-1** — Fixture: T3 spec `status: implementing`, `implements: [packages/x/new.ts]`, file absent → validate fails, message names `packages/x/new.ts`.
- **AC-2** — Same spec with the file present → passes.
- **AC-3** — Same spec at `status: planning` with the file absent → passes (FR-3).
- **AC-4** — T3 `implementing` with bare `implements: none` and an empty/non-code-free reason → fails (FR-2).
- **AC-5** — `plan: done`, `clarify` absent/pending → fails (FR-4); fixed by `clarify: done` → passes.
- **AC-6** — T1/T2 spec with absent `clarify` and `plan: done` passes per tier ceremony.
- **AC-7** — Malformed `implements:` value at `implementing` fails visibly, not skipped (FR-5).
- **AC-8** — Both-direction regression: a test asserts the rule rejects the false case and accepts the true case, so the asymmetry cannot return silently.
- **AC-9** — After the ratchet flip, `npm run validate` is green on the corpus at `error`.
- **AC-10** — `status: implementing` with `phases.implement: pending` and an absent owned file is flagged (FR-1 literal-status path).

## Invariants (must not be broken)

- **INV-1** — Offline, Tier 0: file-existence checks only, no network (invariant 1).
- **INV-2** — The rule is a validator rule, not a hook; it must not narrow the DR-012/DR-031 freeze-gate twins (SPEC-064 INV-3).
- **INV-3** — No silent gate: errored evaluation fails closed (invariant 2).
- **INV-4** — Applies only inside a `.minspec/`-opted-in repo (invariant 3).
- **INV-5** — Does not change approval hashing: nothing here edits hashed bytes of approved specs except the SPEC-015 data repair (which re-requires approval of SPEC-015 if its frontmatter is hashed; `status`/`phases` are stripped by canonicalization, so a `phases:` edit does not stale it).

## Decisions needed (Clarify)

- **D1 — How does FR-2 recognise an honest "owns no *new* file" at `implementing`?**
  - **Option A (rec) — require non-empty `implements_reason` plus an `affects:` list of the existing files modified.** Pro: SPEC-015-style specs (built by editing shared files) become checkable and file-armed; cost: every such spec needs backfill and reviewers must read the `affects:` list, which is still self-declared.
  - **Option B — accept any non-empty `implements_reason`.** Pro: zero backfill. Cost: exactly the loophole that let SPEC-015 pass; a lying reason still passes.
  - **Option C — forbid `none` at `implementing` for T3/T4.** Pro: strongest. Cost: false-blocks genuine policy/docs specs.
- **D2 — Phase ordering: strict or tier-aware for T3?** CLAUDE.md says T3 requires specify, plan, tasks, implement (no clarify listed), yet SPEC-038 FR-3 treats Clarify as required for T3/T4 and the repo mints `clarify: done` on T3 specs. **Option A (rec) — require clarify for T3/T4** (matches the validator's existing "past Clarify" logic and SDD FR-2); cost: SPEC-015 and any older T3 spec lacking `clarify` need a backfill, and the CLAUDE.md tier table wording is ambiguous and may need a separate fix. **Option B — treat clarify as optional for T3**; cost: SPEC-015's anomaly is then not an anomaly and FR-4 weakens.
- **D3 — Fold into SPEC-064's D1 gate or ship separately?** Both are validator rules over the same frontmatter. **Option A (rec) — separate spec, shared helper**: keeps D1 (phases-vs-status) and this (code-existence, phase order) independently approvable; cost: two rules touching one validator surface, so landing order and a shared-fixture parity test matter. **Option B — merge into SPEC-064**; cost: re-opens an already past-Clarify spec and stales its approval.
- **D4 — Flip trigger.** Recommend `warn` → `error` after the corpus is clean (FR-6); cost: the existing #1751 rule has stayed at `warn` since it shipped, so without a named trigger the flip may never happen — the spec should name an owner issue. Alternative: flip immediately and fix SPEC-095 in the same change; cost: a red `main` if any other spec is unevidenced.

## Out of Scope

- Verifying that existing owned code actually implements the spec's symbols (drift — #643 / DR-056).
- Changing the Approve command or status derivation (SPEC-064).
- Reading SPEC-031's `implements:` for truth — only existence is checked.

## Traceability

- Issue [#818](https://github.com/AIClarityAU/minspec/issues/818); [SPEC-038](../SPEC-038-spec-code-ownership/requirements.md) (declaration gate this extends); [SPEC-064](../SPEC-064-planning-lifecycle-status/requirements.md) (status model, D1); [DR-003](../../../docs/decisions/DR-003.md) (evidence discipline); [DR-069](../../../docs/decisions/DR-069.md).
- No DR needed: the rule is a reversible validator threshold (flip back to `warn` in one change).
