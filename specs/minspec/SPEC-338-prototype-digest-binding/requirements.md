---
id: SPEC-338
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute — Autopilot Mode
aspects: [approval, staleness, gate, never-wrong, autopilot]
relates_to: [DR-036, SPEC-022, SPEC-041, DR-062, DR-012]
---

# MinSpec — Prototype digest bound into the overview (Requirements)

> Triggered by [#236](https://github.com/AIClarityAU/minspec/issues/236) — Autopilot Mode prerequisite **A4** (hash does not bind the prototype). Design rests on [DR-036](../../../docs/decisions/DR-036.md) (the A4 row of its must-fix table) and `docs/autopilot-mode-design.md` §4 (A4).

## One-Sentence Scope

Make an approved Blueprint overview read `approved` **only while its prototype is unchanged**, by carrying the prototype's content digest as literal text inside the overview bytes and recomputing that digest against the prototype on disk in **both** `npm run validate` and `scripts/hooks/spec-gate.py`.

## Context

The approval hash is `specHash(raw)` over the overview's canonical form (`packages/shared/src/canonical.ts:126`; Python twin `scripts/hooks/canonical.py`, called at `scripts/hooks/spec-gate.py:171`). `resolveStatus` compares only `record.specHash` to that hash (`packages/minspec/src/lib/approval.ts:489`). A *reference* to a separate prototype file does not change when the prototype changes, so the prototype can drift while the approval stays green and "the human approved this UX" becomes false.

Two facts shape the design (verified in code, not inferred):

1. Inlining a digest makes **overview edits** visible to the hash, but the hash alone cannot notice a prototype edit that nobody copied into the overview. Something must recompute the digest from the prototype on disk and compare it with the inlined value. That recompute is the load-bearing check; the inlining is what lets the existing approval hash carry the *approved* digest.
2. The Blueprint approval flow (`MinSpec: Approve Blueprint`) does not exist yet (`docs/autopilot-mode-design.md` §3; no code references it). This spec therefore defines the **primitive** (digest field, digest computation, freshness check, twin parity) and does not build the Blueprint command.

Two stale paths must both fail closed:

- **Path A — prototype changed, overview untouched:** inlined digest ≠ recomputed digest → freshness check reports stale.
- **Path B — prototype changed and overview re-digested (e.g. by an agent):** the overview bytes change → `specHash` ≠ `record.specHash` → `resolveStatus` returns `stale`. No new code needed for B beyond the field being inside the hashed bytes (FR-2).

## Functional requirements

- **FR-1 Literal field.** A Blueprint overview carries `prototype-digest: <64-hex sha256>` as a literal line, plus `prototype: <repo-relative path>` naming what it digests. Both live in the overview's frontmatter (see Decision D1).
- **FR-2 Inside the hash.** Neither key is in the lifecycle-strip set of `canonicalizeSpec` (only `status:` and `phases:` are stripped, `canonical.ts:60-80`). A change to either key changes `specHash`. A test pins that neither key is ever added to the strip set.
- **FR-3 Digest definition.** One pure function `prototypeDigest(path)` in `@aiclarity/shared` (Tier-0, no vscode, no network) with a byte-identical Python twin beside `canonical.py`. Directory prototypes digest a sorted list of `relpath\0sha256(content)` entries after EOL normalisation; single-file prototypes digest the normalised content. A parity test runs shared TS fixtures through both implementations.
- **FR-4 Freshness predicate.** One pure function `prototypeFreshness(overviewRaw, repoRoot)` returns `fresh | stale | unbound | unreadable`:
  - `fresh` — recomputed digest equals the inlined digest.
  - `stale` — they differ.
  - `unbound` — a Blueprint overview with no `prototype-digest`/`prototype` (fails closed; a Blueprint with no bound prototype is not approvable).
  - `unreadable` — prototype path missing or unreadable (fails closed, visibly; never treated as `fresh`).
- **FR-5 Status integration.** `approved` requires `resolveStatus === approved` **and** freshness `fresh`. Any other freshness downgrades the read to `stale` (`unbound`/`unreadable` carry a distinct reason string so the UI can say why).
- **FR-6 Two independent enforcement points.** `npm run validate` (`scripts/validate-frontmatter.ts` family) and `scripts/hooks/spec-gate.py` each recompute freshness themselves, from their own implementation of FR-3/FR-4. Neither reads a cached result from the other. A missing or erroring witness blocks, visibly (constitution invariant 2).
- **FR-7 Approve-time check.** Approving a Blueprint overview refuses (before any side effect, as `approveSpec` already orders its gates) unless freshness is `fresh`, so an approval can never be minted over a digest that is already wrong.
- **FR-8 Scope of the check.** Only overviews that declare `prototype:` or `prototype-digest:` are checked. Ordinary specs are untouched, so repos that never use Autopilot see no behaviour change (invariant 3).

## Acceptance criteria

- **AC-1** An overview fixture contains the literal line `prototype-digest: <sha256>`; a test asserts the line matches `^prototype-digest: [0-9a-f]{64}$` and that the value equals `prototypeDigest(prototype)`.
- **AC-2 (Path A)** Approve a fixture; edit one byte of the prototype; do not touch the overview. `prototypeFreshness` is `stale` and the combined status read is `stale`.
- **AC-3 (Path B)** Same, but also rewrite the inlined digest to the new value. `resolveStatus` returns `stale` (overview bytes changed).
- **AC-4** `npm run validate` fails with a message naming the overview and the reason for AC-2's fixture; passes on the fresh fixture.
- **AC-5** `spec-gate.py` denies an implement-phase edit for AC-2's fixture and allows it for the fresh fixture; a test drives the real script (as `packages/minspec/tests/spec-gate.test.ts` does), not a re-implementation.
- **AC-6** Disabling either enforcement point alone (stubbing it out) still leaves the other failing AC-2's fixture. This is the "independent second witness" proof.
- **AC-7** `unbound` and `unreadable` fixtures fail both enforcement points.
- **AC-8** TS/Python digest parity on a shared fixture set including CRLF, nested directories, and unicode filenames.
- **AC-9 (T0 chain test)** One test walks the whole chain: build prototype → inline digest → approve → mutate prototype → status `stale` → regenerate digest → status still `stale` (hash changed) → re-approve → `approved`.
- **AC-10** A repo whose specs declare neither key is byte-for-byte unaffected (no new failures across the existing corpus).

## Invariants this change must not break

- Core functionality works offline: digesting is local file reads only (invariant 1).
- No silent gate: no swallowed errors on the freshness path; `unreadable` fails closed and visibly; two independent witnesses (invariant 2).
- Blast radius is the opted-in project: checks run only for overviews that declare the keys (invariant 3, FR-8).
- Editing `status:` / `phases:` still does **not** stale an approval (`canonical.ts` strip behaviour is unchanged).
- TS and Python canonicalisation stay byte-identical (the existing twin parity test keeps passing).

## Out of scope

- The `MinSpec: Approve Blueprint` command and child-spec fan-out.
- A1/A2/A3/A5/A11 prerequisites ([#233](https://github.com/AIClarityAU/minspec/issues/233), [#234](https://github.com/AIClarityAU/minspec/issues/234), [#235](https://github.com/AIClarityAU/minspec/issues/235)).
- Generating the prototype (DesignSync) and styled fidelity.

## Decisions needed (Clarify)

Recorded selections: each of the 4 selections below is an agent pick of the option this document marks recommended, recorded on 2026-11-17 under the founder decision in queue item clarsel. Sign-off ratifies them and may change any of them.

- **D1 — Where the digest lives.**
  - **(rec) Frontmatter keys** `prototype:` + `prototype-digest:`. Parsed by the existing frontmatter reader, trivially greppable by the Python gate. Cost: frontmatter schema (`SPEC-109` canonical frontmatter) must admit two new keys, a small validator change.
  - Body line `prototype-digest: …`. Needs no schema change. Cost: needs a bespoke body regex in two languages, which is exactly the duplicate-predicate drift the repo has been bitten by.

  **Recorded selection: the recommended option,** frontmatter keys `prototype:` and `prototype-digest:`. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
- **D2 — Digest granularity for a multi-file prototype.**
  - **(rec) Sorted manifest digest** (per-file content hashes folded into one). One field, deterministic. Cost: any file change, including a whitespace-only asset, stales the approval.
  - Per-file digest lines in the overview. Pinpoints the changed file in the error. Cost: overview grows with the prototype and gets noisy diffs.

  **Recorded selection: the recommended option,** a sorted manifest digest. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
- **D3 — What to do with `unbound` when a Blueprint overview has no prototype.**
  - **(rec) Fail closed** (FR-4). Cost: the "operational / no UI only" blueprint in the design's trial step must carry a one-card prototype file rather than none.
  - Allow an explicit `prototype: none` sentinel. Cost: a new bypass value that agents could write to opt out of the binding.

  **Recorded selection: the recommended option,** fail closed (FR-4). Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
- **D4 — How "is a Blueprint overview" is detected** (FR-8 keys off the declared keys, which an agent could simply omit).
  - **(rec) Declared keys only for now**; the Blueprint approval flow (separate work) will mark overviews with a type and make `unbound` reachable. Cost: until that lands, omitting both keys skips the check.
  - Introduce `type: blueprint` in this spec. Cost: widens scope into the Blueprint feature itself.

  **Recorded selection: the recommended option,** declared keys only for now. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.

## Follow-ups (tracked)

- `MinSpec: Approve Blueprint` command (consumer of this primitive): not yet filed — per DR-036 §"What Autopilot Mode does"; to be filed with the Blueprint spec.
