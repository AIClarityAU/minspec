---
id: SPEC-038
type: design
status: specifying
product: minspec
epic: EPIC-003  # SDD Core Methodology
---

# MinSpec — Required `implements:`/`affects:` spec→code ownership (Plan)

**Date:** 2026-07-14
**Status:** Plan (SDD Plan phase)
**Reads:** [requirements.md](requirements.md) — FRs, invariants, and the Clarify decisions (explicit lists no globs; ratchet; `implements:` required / `affects:` optional; keep fuzzy signal) are settled there and not re-litigated here.

## Approach

Add **one symmetric validator-rule pair** to the corpus validator and **change nothing in the gate** (FR-8). The pair mirrors the existing `ASPECT_RULES` + tier-severity shape already in `spec-validator.ts`:

- `ownership.implements.missing` — fires when a T3/T4 spec past Clarify declares neither a non-empty `implements:` nor the `implements: none` escape. **This is the missing-direction half** (INV-2 / #137).
- `ownership.implements.invalid` — fires when a present `implements:`/`affects:` entry is not a valid owned-code path. **The validity half.**

Both directions ship together so the asymmetry can never exist in-tree (AC-7).

The one real design problem is **not** the rule — it is **keeping the TS validator and the Python gate agreeing on "what is a valid owned path."** The gate (`spec-gate.py`) is Python; the validator is TypeScript. Two implementations of one predicate is exactly the drift hazard the repo already solved for Node↔Python hash agreement (`canonical-parity.test.ts`). We reuse that playbook.

## Trigger predicate

The rule applies to a spec iff **all** hold (reuse existing helpers):

- `isPrimarySpec(fm)` — a requirements artifact (already in `spec-validator.ts`).
- `TIER_RANK[tier] >= 3` — T3/T4 only (FR-6; the exact test `requiresAcceptanceCriteria` already uses).
- **past Clarify** — `phases.clarify === 'done'` (equivalently plan `in-progress`/later). Read from the parsed `phases:` block; a spec still in `specify`/`clarify` is exempt so a spec can be authored before it declares ownership.

`affects:` never triggers `missing` (Clarify OQ-3 — optional); it is only ever subject to `invalid`.

## Contracts

### Frontmatter contract
```ts
// requirements-artifact frontmatter, ownership fields
implements?: string[] | 'none';   // list of repo-relative owned code paths, or the explicit escape
affects?:    string[];            // repo-relative touched-not-owned paths (optional)
implements_reason?: string;       // REQUIRED, non-empty, iff implements === 'none' (FR-5)
```
Decision (was a plan OQ): the `implements: none` reason is a **structured sibling field** `implements_reason:`, not an inline `#` comment — a comment is invisible to the tokenizer and easy to drop; a field is greppable, reviewable, and testable. `implements: none` without a non-empty `implements_reason:` fails `ownership.implements.missing` (the escape is not free).

### Path-validity contract (the parity surface)
A token is a **valid owned-code path** iff, exactly as `spec-gate.py` already decides in `consider()`:
- repo-relative — not absolute, no `../` climbing above root, `..` in no segment;
- not under an infra prefix — `_INFRA_PREFIXES` (`node_modules/ out/ dist/ coverage/ .git/`, spec-gate.py:279);
- ends in a source extension — `_SRC_EXT_RE` (spec-gate.py:276);
- **existence is NOT required** — a not-yet-created path is valid (greenfield ownership, AC-3).

`spec-gate.py`'s constants are the **single source of truth**. The TS check mirrors them and a **parity test** (below) asserts the two never drift — we do **not** edit the gate to share a file (that would be an FR-8 gate change); we pin agreement with a test, the `canonical-parity` pattern.

### Finding shape
Reuse the existing validator `Violation` shape verbatim — `{ rule, severity, fixHint }` — so the new findings flow through `validate-frontmatter.ts` and the ext surfaces unchanged.

## Severity seam (the warn→error ratchet, FR-7)

One config key gates the flip, defaulting to the safe side:
```jsonc
// .minspec/config.json
"ownershipDeclaration": "warn"   // "warn" (default, pre-backfill) → "error" (post-backfill)
```
`ownership.implements.missing` severity = that config value; `ownership.implements.invalid` is **always `error`** (an invalid path is a defect regardless of rollout stage). The flip to `"error"` is one commit, made only once AC-8 is green.

## Files

| File | Change |
|---|---|
| `packages/minspec/src/lib/spec-validator.ts` | New `validateOwnership(fm, phases)` producing the two findings; a `isValidOwnedPath(token)` helper mirroring the gate filters; wire into `validateSpec`. |
| `packages/minspec/src/lib/…/ownership-path-rules.ts` (small) | The TS mirror of `_SRC_EXT_RE` + `_INFRA_PREFIXES`, as named exported constants (so the parity test has one TS symbol to compare). Tier-0, no imports. |
| `.minspec/config.json` | New `ownershipDeclaration` key (default `"warn"`); read by the validator. |
| `packages/minspec/tests/ownership.test.ts` | AC-1..8 + INV-2 symmetry (T0). |
| `packages/minspec/tests/ownership-path-parity.test.ts` | Shells `python3` to read `spec-gate.py`'s `_SRC_EXT_RE`/`_INFRA_PREFIXES` and asserts the TS constants match (canonical-parity pattern). |
| existing T3/T4 specs (backfill) | `implements:`/`affects:`/`implements: none` — **separate PR** (data), gated behind the `"warn"` default so it never flag-days. |

## Build order (vertical slice)

1. **T0 first (AC-7):** the symmetry test — one spec fixture fails on *missing* `implements:`, another on *invalid* — written red before the rule.
2. `isValidOwnedPath` + `ownership-path-parity.test.ts` (TS mirror agrees with the gate).
3. `validateOwnership` wired into `validateSpec`, severity from `ownershipDeclaration` (default `warn`). AC-1..6 green.
4. **Backfill PR** — declare ownership on existing T3/T4-past-Clarify specs; then AC-8 green with the rule forced to `error` in that PR's test.
5. **Flip PR** — `ownershipDeclaration: "error"` in `.minspec/config.json`.

Steps 1–3 are one PR (the rule, shipping as `warn` — inert-by-default, breaks nothing). 4 and 5 are separate, deliberately.

## Test plan

| AC / INV | Test |
|---|---|
| AC-1 missing → fail | fixture T3 spec past Clarify, no `implements:` → `ownership.implements.missing` at configured severity |
| AC-2 `none`+reason → pass | `implements: none` + `implements_reason:` → clean |
| AC-3 greenfield path → pass | declared non-existent `.ts` path → clean |
| AC-4 escaping/absolute → fail | `/etc/x`, `../../x.ts` → `ownership.implements.invalid` (error) |
| AC-5 gate arms | integration: unapproved spec + declared non-existent path → `spec-gate.py` blocks its creation (drives the real hook) |
| AC-6 T1/T2 exempt | T2 spec, no `implements:` → clean |
| AC-7 symmetry | missing AND invalid both fail (the INV-2 guard) |
| AC-8 post-backfill | whole corpus green with rule forced to `error` |
| parity | TS ext/infra constants == `spec-gate.py` constants |

## Risks

| # | Risk | Mitigation |
|---|---|---|
| P1 | **TS↔Python path-rule drift** — the validator accepts a path the gate rejects (or vice-versa), so a "valid" declaration doesn't actually arm the gate. | `ownership-path-parity.test.ts` fails CI on any divergence; constants are named symbols on both sides. |
| P2 | **"past Clarify" misread** — predicate fires on specify-phase specs (too early) or never (too late). | Unit-test the predicate across every phase-state combination; key it off `phases.clarify === 'done'`. |
| P3 | **Backfill mis-declares ownership** — a spec claims files it doesn't own → gate over-blocks. | Backfill is per-spec, reviewed; AC-5-style spot check that a declared path arms/relaxes the gate as intended. |
| P4 | **`implements: none` becomes a lazy escape hatch** — specs opt out to dodge the work. | `implements_reason:` required + non-empty; reasons are greppable for audit. |

## Open plan questions

- **PQ-1** — Exact home of `isValidOwnedPath` / the mirrored constants: a new `lib/ownership-path-rules.ts`, or fold into an existing lib module? (Leaning new small module for the parity test's single import surface.)
- **PQ-2** — Does `validateOwnership` read `phases` from the same parsed frontmatter `validateSpec` already has, or does it need the split-layout phase source? Confirm the phase block is available at that call site.

## Deferred & Follow-ups

- **Backfill** of existing specs — own PR (build-order step 4).
- **warn→error flip** — own PR (step 5).
- **Drift detection** (declared path later vanishes) — [#643](https://github.com/AIClarityAU/minspec/issues/643) / DR-056 R2.
- **Gate owns-vs-touches distinction** — the Clarify design-flag: DR-056 wants `implements` (blocks) and `affects` (advisory) to differ at the gate; today they block identically. Tracked against DR-056, not this spec.
