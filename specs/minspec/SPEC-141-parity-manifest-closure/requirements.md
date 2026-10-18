---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — a parity witness that reports green while the thing it witnesses is broken is invariant 2's shape
aspects: [ci, parity, managed-region, silent-gate, cross-repo]
relates_to: [DR-092, DR-066, DR-090, DR-003, SPEC-079, SPEC-068, SPEC-033]
---

# SPEC-141: The parity manifest must be closed over what managed files require

> **SPECIFICATION ONLY.** Nothing is built by this document. Issue:
> [#1837](https://github.com/AIClarityAU/minspec/issues/1837). Surfaced by
> `AIClarityAU/sealbox#41`. Siblings: #1834 (CI-review stack cannot update itself in one
> PR), #1817 (fleet parity red on two adopters, absent on two).

## Problem

An adopter's `minspec-ci-parity.yml` byte-compares a hand-maintained `FILES` list (12 files
as reported by the issue — not independently re-read here; the workflow is not in this
repository) against canonical. `scripts/review-branch.sh` sources
`scripts/lib/agent-context.sh` (`scripts/review-branch.sh:80`, unguarded, under
`set -euo pipefail`). If that helper is absent in an adopter, the reviewer aborts at
startup and `review-decide` fails closed to `ai-review:changes` with no verdict. If the
helper is also absent from `FILES`, parity reports **green** over that adopter: a witness
that succeeds while the thing it witnesses is broken (constitution invariant 2). Its drift
is likewise unpoliced.

## What already holds (verified, with citations)

- The **scaffold side is closed**: `agent-context-lib` is a registered managed template,
  `packages/minspec/src/lib/template-registry.ts:2649-2650`, so a refreshed adopter
  receives it.
- A **registry-side closure test exists**:
  `packages/minspec/tests/managed-script-dependencies.test.ts` asserts every literal
  `${SCRIPT_DIR}/<path>` reference in a managed script resolves to another managed
  template, and loads the scaffolded set standalone. Its header names this exact class
  (#1026 / `sealbox#32`) and says the parity list "did not name the missing file".

**The remaining gap is therefore not the registry but the parity list**: nothing binds the
adopter-side `FILES` manifest to `MANAGED_REGION_TEMPLATES`. The registry can be closed
and the manifest still omit a member (the sealbox case: the file was registered here but
the adopter's list and the adopter's tree lacked it). Source of the list: not produced by
anything in this repo (no generator found by grep for `MINSPEC_RAW` / `minspec-ci-parity`
outside specs and DRs).

## Functional requirements

- **FR-1 Manifest ⊇ managed set.** A test in this repo MUST fail when any file that a
  managed template scaffolds is absent from the manifest the parity workflow compares.
  The manifest the test reads MUST be the one actually shipped to adopters (see Decision
  DQ-1), never a copy typed into the test.
- **FR-2 Dependency closure over the manifest.** For every manifest entry that is a script,
  every statically resolvable repo-relative reference (`source`, `.`, `require`,
  `import`, `${SCRIPT_DIR}/…`) MUST itself be in the manifest. This extends
  `managed-script-dependencies.test.ts` (which checks closure against the registry) to
  closure against the *manifest*.
- **FR-3 Absence is a failure, not a skip.** Where parity runs in an adopter, a manifest
  file missing from the adopter's tree MUST fail the job visibly with the path named. A
  missing file never counts as "matches" or is skipped (invariant 2).
- **FR-4 Non-resolvable references are named, not silently passed.** A reference whose path
  is computed (e.g. `roles/${ROLE}.md`) MUST be checked to the extent knowable (the
  directory is populated, as the existing dynamic-ref test does) and the residual limit
  documented in the test header, so the gap is a stated one.
- **FR-5 Anti-vacuity.** Each new test MUST assert it found a non-zero number of
  references and anchors on known callers (`review-branch.sh` → `agent-context.sh`), so a
  broken extractor cannot go green.
- **FR-6 Mutation proof.** The change MUST be demonstrated red against a fixture where
  `scripts/lib/agent-context.sh` is removed from the manifest, and green with it present.

## Acceptance criteria

1. Removing `scripts/lib/agent-context.sh` from the shipped manifest turns FR-1 and FR-2
   tests red, naming the file and its referencing caller.
2. Deleting the helper from a scaffolded adopter tree turns the parity job red (FR-3), with
   the path in the message.
3. Adding a new managed template without adding it to the manifest turns FR-1 red.
4. Existing `managed-script-dependencies.test.ts` stays green and unmodified in intent.

## Invariants this must not break

- **Invariant 1 (offline):** tests read local files only; no network in the check.
- **Invariant 2 (no silent gate):** FR-3 is the point of the spec; no `|| true`, no
  skip-on-missing in the new check.
- **Invariant 3 (blast radius):** any change to an adopter's workflow ships only through the
  opt-in managed refresh (`.minspec/` marker), never as a direct write to a repo that did
  not opt in.
- SPEC-079's rule: the region a refresh writes must not itself fail the adopter's parity.

## Decisions needed (Clarify)

- **DQ-1 Where does the manifest live?** The parity workflow is not in this repo, so FR-1
  has nothing to read.
  - **(rec) Generate the manifest from `MANAGED_REGION_TEMPLATES`** and ship the parity
    workflow as a managed template, so the list cannot be hand-edited out of sync. Cost: it
    makes the parity workflow itself machinery that must refresh in one PR (see #1834) and
    changes what every adopter receives.
  - Keep the hand-maintained list adopter-side and add only the FR-2-style test against a
    checked-in reference copy. Cost: the reference copy is another hand-maintained list that
    can drift from adopters'.
- **DQ-2 Runtime check in adopters (FR-3) as well as the minspec-side test?**
  - **(rec) Yes — absence check in the parity job.** Cost: runs in every adopter's CI, and
    shell parsing inside embedded YAML must be right.
  - No — rely on the minspec-side tests. Cost: cannot see an adopter whose tree is missing a
    file the registry correctly ships (exactly the sealbox situation).
- **DQ-3 Scope of reference forms** (FR-2): only `${SCRIPT_DIR}` and `source`, or also
  Python `sys.path` imports and JS `require`? Recommend all three the managed set uses
  today; cost is a per-language extractor to keep honest.

## Out of scope

Fixing sealbox's missing file (done there, `sealbox#41`); #1834's single-PR self-update;
#1817's fleet-wide parity state.
