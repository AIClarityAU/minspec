---
id: SPEC-038
type: tasks
status: specifying
product: minspec
epic: EPIC-003  # SDD Core Methodology
---

# MinSpec — Required `implements:`/`affects:` spec→code ownership (Tasks)

**Requirements:** [requirements.md](requirements.md) · **Design:** [design.md](design.md)

Order follows design.md's **Build order (vertical slice)**: Slice 1 ships the rule as an inert `warn` (breaks nothing on merge) → Slice 2 backfills existing specs → Slice 3 flips to `error`. **Slices 2 and 3 are separate PRs** (FR-7 ratchet — no flag day). **Within Slice 1, T0/T1 test tasks precede the implementation they cover (DR-003 test-first).** Each task names its file allowlist; tests are vitest under `packages/minspec/tests/`.

**Shared-checkout note:** `packages/minspec/src/lib/spec-validator.ts` is a high-churn file. Every task below that touches it is a **self-contained addition** (one new `validateOwnership` function + one call site in `validateSpec`), never a restructure — written to apply cleanly regardless of concurrent work.

---

## Slice 1 — the rule, shipped as inert `warn` (FR-1..FR-6, FR-8, INV-2, INV-3)

*Goal: the symmetric rule exists, is parity-pinned to the gate, and is live in `npm run validate` at `warn` severity — so it breaks no existing commit yet catches the next undeclared spec. One PR.*

- [ ] **(test, T0 — symmetry, write RED first)** `packages/minspec/tests/ownership.test.ts`: a T3 spec fixture past Clarify with no `implements:` → `ownership.implements.missing`; a fixture with an invalid path (`../x.ts`) → `ownership.implements.invalid`. **Both must fail**, in one test, so the asymmetry cannot exist in-tree. *(AC-7, INV-2)* — allowlist: `packages/minspec/tests/ownership.test.ts`
- [ ] **(test, T1 — parity)** `packages/minspec/tests/ownership-path-parity.test.ts`: shells `python3` to read `scripts/hooks/spec-gate.py`'s `_SRC_EXT_RE` source-extension set and `_INFRA_PREFIXES`, and asserts the TS constants (next task) are identical. Fails CI on any drift. *(design P1, canonical-parity pattern)* — allowlist: `packages/minspec/tests/ownership-path-parity.test.ts`
- [ ] **(impl)** `packages/minspec/src/lib/ownership-path-rules.ts` (new, Tier-0, no imports): named exports for the source-extension matcher and infra-prefix list mirroring the gate, plus `isValidOwnedPath(token): boolean` applying the exact `consider()` filters — repo-relative, no absolute/`..`-escape, not under an infra prefix, ends in a source extension, **existence NOT required**. *(FR-4; resolves PQ-1 — new module)* — allowlist: `packages/minspec/src/lib/ownership-path-rules.ts`
- [ ] **(impl)** `packages/minspec/src/lib/spec-validator.ts`: add `validateOwnership(fm, phases)` producing the two findings on the existing `{ rule, severity, fixHint }` shape. Trigger = `isPrimarySpec(fm) && TIER_RANK[tier] >= 3 && phases.clarify === 'done'`. `implements: none` satisfies presence **only** with a non-empty `implements_reason:` (else `missing`). Present `implements:`/`affects:` entries run through `isValidOwnedPath` → `invalid` (always `error`). Wire into `validateSpec`. *(FR-1,2,3,5,6; FR-8 — no gate edit; verify PQ-2: `phases` is available at this call site)* — allowlist: `packages/minspec/src/lib/spec-validator.ts`
- [ ] **(impl)** `.minspec/config.json`: add `"ownershipDeclaration": "warn"`; `validateOwnership` reads it for the `missing` severity (default `warn` when key absent). *(FR-7 seam)* — allowlist: `.minspec/config.json`
- [ ] **(test, T2 — feature)** `packages/minspec/tests/ownership.test.ts`: AC-1 (missing→fail), AC-2 (`none`+reason→pass), AC-2b (`none` **without** reason→fail), AC-3 (greenfield non-existent path→pass), AC-4 (absolute/escape→`invalid`), AC-6 (T1/T2 exempt), and the **phase predicate** across every `phases.clarify` state (specify/clarify/done) — P2 risk. — allowlist: `packages/minspec/tests/ownership.test.ts`
- [ ] **(test, T2 — integration, AC-5)** drive the real hook: an unapproved T3 spec declaring `implements: ["…/new-thing.ts"]` (non-existent) → `scripts/hooks/spec-gate.py` blocks **creation** of that file, proving the produced signal arms the built gate. — allowlist: `packages/minspec/tests/ownership.test.ts` (spawns the hook; no gate edit)
- [ ] **(verify)** `npm run validate` green on the current corpus (rule at `warn` → existing undeclared specs warn, do not fail); `npm test` green. Confirms Slice 1 is inert-safe to merge.

## Slice 2 — backfill existing specs (AC-8) · **separate PR**

- [ ] Enumerate every T3/T4 spec whose `phases.clarify === 'done'` and that lacks `implements:`; for each, declare `implements:`/`affects:` (or `implements: none` + reason) — **per-spec, reviewed** (P3: a wrong declaration mis-scopes the gate). — allowlist: the enumerated `specs/minspec/*/requirements.md`
- [ ] **(test, AC-8)** with `ownershipDeclaration` forced to `"error"` in the test, the whole corpus validates green. — allowlist: `packages/minspec/tests/ownership.test.ts`

## Slice 3 — flip to `error` (FR-7) · **separate PR, after Slice 2 green**

- [ ] `.minspec/config.json`: `"ownershipDeclaration": "error"`. One line; the rule now blocks. — allowlist: `.minspec/config.json`

---

**Deferred (not this spec):** drift detection when a declared path later vanishes (#643 / DR-056 R2); the gate owns-vs-touches distinction for `affects:` (DR-056 design-flag).
