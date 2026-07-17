---
id: SPEC-038
type: requirements
# 🔒 Once approved, hash-locked: approved bytes recorded in .minspec/approvals.json[SPEC-038].specHash. ANY edit voids approval (hash → stale) — re-run "MinSpec: Approve Spec". DR-012.
status: implementing
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — the spec→code ownership contract
aspects: [traceability, validation, governance, tier-0, spec-gate]
relates_to: [DR-012, DR-031, DR-056, SPEC-004, DR-003]
implements: [packages/minspec/src/lib/ownership-path-rules.ts, packages/minspec/tests/ownership.test.ts, packages/minspec/tests/ownership-path-parity.test.ts]
phases:
  specify: done   # draft merged via PR #769, 2026-07-14
  clarify: done   # OQ-1..5 confirmed by Paul Harvey 2026-07-14 (see Clarify)
  plan: done   # design.md merged #772; PQ-1/PQ-2 both resolved at Tasks 2026-07-14 (see design.md)
  tasks: done   # tasks.md merged PR #774, 2026-07-14
  implement: in-progress   # Slice 1 (rule ships as warn) built 2026-07-16; backfill + flip pending
---

# MinSpec — Required `implements:`/`affects:` spec→code ownership declaration (Requirements)

> Traces to **[#460](https://github.com/AIClarityAU/minspec/issues/460)** (P2, role:architect). First step of the code-safety track ([malleability audit](https://github.com/AIClarityAU/minspec/issues/689) → #742). Seeds the spec→code edges DR-056 unifies.

## One-Sentence Scope

Every T3/T4 spec that has passed Clarify must declare the code it owns via `implements:` / `affects:` frontmatter, and the corpus validator must **fail when that declaration is absent** — turning the spec-gate's already-built structured signal from a capability nothing produces into an enforced contract.

## Context

The **PreToolUse spec-gate** (`scripts/hooks/spec-gate.py`) — the local HITL approval gate (DR-012) with dispatch-soundness (DR-031), whose enforcement decision is DR-362 (parent register, mmo-platform) — blocks Edit/Write to the impl files an unapproved T3/T4 implementation-phase spec *owns*. Per #426 / PR #436 the owned set comes from two signals:

1. **Structured** — an `implements:` / `affects:` frontmatter path list. Blocks edits **and creation** of the declared paths, existence-independent (so it can guard greenfield files).
2. **Fuzzy** — backtick code-span paths in the spec's own `tasks.md`, kept behind an existence filter so prose tokens never widen the block set — which by construction **cannot block creation of a not-yet-existing file**.

**The gap (malleability audit, 2026-07-13):** *no spec in the corpus declares `implements:`/`affects:` yet.* The gate reads a signal nothing writes, so it "owns nothing and blocks nothing" for undeclared code, and the fuzzy fallback can't guard greenfield paths. The gate is built; the **producer of its precise signal is missing.**

This is the project's recurring **validator-asymmetry class** ([#137](https://github.com/AIClarityAU/minspec/issues/137)): the validator checks that references which are *present* resolve, but never that a *required* declaration is *missing* — the exact shape that stranded SPEC-004's missing `epic:` (DR-003). Closing it here means adding the **missing-direction** check, symmetrically.

`implements:` is also the first and cheapest **spec→code edge type** in DR-056's unified graph: this spec is the seed that makes file→spec lookup, an armed spec-gate, and status-honesty (a spec claiming `implementing` with zero declared code becomes detectable) all possible from one line of frontmatter.

## Functional Requirements

- **FR-1 — `implements:` frontmatter.** A spec MAY declare `implements:` as a list of repo-relative code paths its implementation creates and owns. Entries are **explicit file paths, not glob patterns** (resolved OQ-1/OQ-5): the gate matches exact case-insensitive path membership and drops any token not ending in a source extension, so a `foo/**` glob would silently never match. A spec owning many files enumerates them; directory/glob ownership would be a separate gate-matcher change, out of scope.
- **FR-2 — `affects:` frontmatter.** A spec MAY declare `affects:` as a list of repo-relative paths it modifies but does **not** own (shared/edited surfaces), distinct from `implements:` so ownership stays unambiguous. `affects:` is **optional** — only `implements:` gates FR-3 (resolved OQ-3). *Design note:* the gate today blocks `affects:` paths **identically** to `implements:` (both creation-blocking), so `affects:` is not a lighter enforcement signal; its distinct value is as an `affects`-vs-`implements` **edge type** in DR-056's graph. Requiring both would double over-block risk for no enforcement gain — hence optional, and DR-056 should eventually make the gate distinguish *owns* from *touches*.
- **FR-3 — Required for T3/T4 past Clarify.** The corpus validator MUST **fail** (error, not warn) when a spec is tier T3 or T4 **and** its Clarify phase is done (plan `in-progress` or later) **and** it declares neither a non-empty `implements:` nor the explicit escape (FR-5). The check asserts the declaration **exists** — it is the missing-direction half of the asymmetry, not a check that listed paths resolve.
- **FR-4 — Validity of what is present (the other half of symmetry).** When `implements:`/`affects:` are present, each entry MUST be a repo-relative path that does not escape the repo root (no absolute paths, no `../` climbing above root). A declared path that does **not yet exist** is allowed (greenfield ownership is the point). A malformed/escaping path fails.
- **FR-5 — `implements: none` escape.** A spec that genuinely owns no code (policy/docs-only specs) satisfies FR-3 with an explicit `implements: none` plus a one-line reason, mirroring DR-023's "None is a valid explicit answer". This keeps the requirement satisfiable for non-code specs and makes "owns nothing" an on-purpose, reviewable statement rather than an omission.
- **FR-6 — Scoped to T3/T4.** T1/T2 specs are exempt (their mechanical blast radius does not warrant declared ownership). The rule reads `tier:` and the Clarify phase state only.
- **FR-7 — Staged introduction (no corpus-wide breakage).** The rule ships as a **warning first**; the existing T3/T4-past-Clarify specs are backfilled with real declarations (or `implements: none`); only then does it flip to **error**. The flip is a single config/threshold change, recorded when backfill is complete — a grandfather ratchet, never a flag day (rollout path confirmed, OQ-2).
- **FR-8 — No spec-gate change.** This spec produces and validates the signal; the spec-gate (`spec-gate.py`) already consumes it. The boundary is explicit: enforcement is built, production is not.

## Costly to Refactor

- The **frontmatter key names** `implements:` / `affects:` and the `none` escape grammar. Once specs declare them and both the gate and DR-056's edges consume them, a rename is a corpus-wide migration. The names are already fixed by #426/PR#436's gate — this spec keeps them; do not re-bikeshed at Clarify.
- **Cheap to reverse (and now resolved at Clarify):** the warn→error timing (FR-7 ratchet), `implements:`-only gating (`affects:` optional), and explicit-lists-not-globs.

## Acceptance Criteria

- **AC-1** — A new T3 spec advanced to plan `in-progress` with no `implements:` and no escape fails `npm run validate`, with a message naming the fix.
- **AC-2** — The same spec with `implements: none` + a reason passes.
- **AC-3** — `implements: ["packages/minspec/src/lib/new-thing.ts"]` where the file does not exist yet **passes** (greenfield ownership allowed — FR-4).
- **AC-4** — `implements:` containing an absolute path or one that climbs above the repo root **fails** (FR-4).
- **AC-5** — Regression / integration: for an unapproved T3 spec that declares `implements: ["…/new-thing.ts"]`, the spec-gate blocks **creation** of that not-yet-existing file — proving the produced signal actually arms the built gate.
- **AC-6** — A T1/T2 spec with no `implements:` passes (FR-6 scope).
- **AC-7** — Symmetry regression (the #137 lesson): a test asserts the validator fails on *missing* `implements:` AND fails on *invalid* `implements:` — both directions, so the asymmetry cannot silently return.
- **AC-8** — After backfill, every pre-existing T3/T4-past-Clarify spec carries `implements:`/`affects:` or `implements: none`, and `npm run validate` is green with the rule at **error**.

## Out of Scope

- **Drift detection** — verifying a declared `implements:` path still exists / still hosts the implementing symbol after a refactor. That is DR-056 R2 / [#643](https://github.com/AIClarityAU/minspec/issues/643), a follow-on.
- **Code→spec reverse edges, paragraph edges, the unified graph** — DR-056's later steps.
- **Any change to spec-gate.py** — its consumption of the signal is built (#426/PR#436).
- **Auto-deriving `implements:` from tasks.md or git history** — declarations are human-authored/reviewed; auto-derivation is a possible later convenience, not this spec.

## Clarify

Specify-phase Open Questions, resolved — **confirmed by Paul Harvey 2026-07-14**. Resolutions are grounded in the gate matcher's actual behaviour (`scripts/hooks/spec-gate.py`: exact case-insensitive path membership, no globs, source-extension filter, `implements:`/`affects:` blocked identically).

- **OQ-1 → explicit file lists, not globs.** The gate matches exact paths and drops any token not ending in a source extension, so a `foo/**` glob silently never matches. Globs would need a separate gate-matcher change. *(Folded into FR-1.)*
- **OQ-2 → warn → backfill → error ratchet.** Flipping to error before backfill breaks every existing T3/T4 spec's `validate` (R1); grandfather the corpus, block regression. *(FR-7.)*
- **OQ-3 → `implements:` required, `affects:` optional.** The gate blocks both identically, so forcing both only doubles over-block risk; `affects:` earns its keep as a DR-056 edge type, not a second gate requirement. *(FR-2.)* **Design flag for DR-056:** the gate should eventually distinguish *owns* (`implements`) from *touches* (`affects`).
- **OQ-4 → keep the fuzzy tasks.md signal, for now.** It is existence-filtered (low false-positive) and catches files a spec builds but forgot to declare — a real net during backfill while `implements:` coverage is partial. Revisit retiring it only after AC-8 proves coverage.
- **OQ-5 → enumerate files, no directory globs.** Same gate constraint as OQ-1; large-spec maintenance cost is accepted. Directory/glob ownership is a possible later gate feature, not this spec.

## Invariants

- **INV-1 (constitution #1 — offline).** The rule is pure frontmatter + filesystem path validation; no network. Runs in the Tier-0 validator.
- **INV-2 (symmetry — #137).** The validator MUST check **both** that a required `implements:` is present AND that a present one is valid. Adding only the presence check (or only the validity check) re-creates the asymmetry this spec exists to close; AC-7 guards it.
- **INV-3 (Tier-0 purity).** Validation logic stays in the validator with no `vscode`/network imports; any shared types live in `@aiclarity/shared`.
- **INV-4 (no gate scope-creep).** This spec must not modify spec-gate enforcement behaviour; it only supplies and validates the declaration the gate reads (FR-8).

## Risks & Mitigations

| # | Risk | L·I | Mitigation |
|---|---|---|---|
| R1 | Flipping to **error** before backfill breaks every existing spec's `validate`, blocking all commits. | High·High | FR-7 warn→backfill→error ratchet; error only after AC-8 is green. |
| R2 | `implements:` **rots** as code moves (declared path vanishes after a refactor). | High·Med | Out of scope here; the drift gate #643 / DR-056 R2 is the tracked follow-on. FR-4 deliberately allows non-existent paths so greenfield works — drift is a *separate* check. |
| R3 | **Over-declaration** — a spec claims files it doesn't own, so the gate over-blocks other work. | Med·Med | Human review of the declaration at approval; the gate's existence filter and `affects:` (non-owning) split reduce blast. |
| R4 | Requirement is **unsatisfiable** for legitimately code-less specs. | Med·Med | FR-5 `implements: none` + reason. |
| R5 | Backfill declarations authored carelessly (wrong files) silently mis-scope the gate for many specs at once. | Med·Med | Backfill is per-spec, reviewed; AC-5-style spot checks that a declared path actually arms/relaxes the gate as intended. |

## Dependencies

- **DR-012** (HITL content-hash spec gate) + **DR-031** (spec-gate soundness in dispatch) + **#426 / PR #436** — the local spec-gate that consumes `implements:`/`affects:`; already built (enforcement per DR-362 — parent register, mmo-platform). This spec feeds it.
- **[#137](https://github.com/AIClarityAU/minspec/issues/137)** — the symmetric-validator primitive; INV-2/AC-7 are an instance of it.
- **DR-056** — this spec is the seed edge type of the unified graph; it proceeds **standalone** and does not require DR-056/DR-053 acceptance.
- **SPEC-004 / DR-003** — the original missing-`epic:` asymmetry this rule generalises.
- Related, non-blocking: **#742** (every-approvable-doc DAG nodes), **#643** (drift gate), **#630** (design/tasks approval sidecars).
