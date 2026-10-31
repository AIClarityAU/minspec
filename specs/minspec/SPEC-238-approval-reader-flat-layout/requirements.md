---
id: SPEC-238
type: requirements
status: specifying
tier: T2
product: minspec
epic: EPIC-002  # Signpost Integrity - a false "UNSAFE to merge" verdict is a false signpost
aspects: [approvals, sidecar, adopter-layout, no-silent-gate, fail-closed]
depends_on: []
relates_to: ["#2138", "#2136", SPEC-070]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decision D1
  (where the reader lives).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-238: The approval-state reader resolves a sidecar by its own `specPath`, and separates "unreadable" from "unresolved"

> **This is a SPECIFICATION ONLY.** Written for issue #2138. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

`cos.py approvals 90 --repo AIClarityAU/voip-sms-inbox` reported `UNKNOWN ... neither
sidecar could be read` and "UNSAFE to merge". Both sidecars were readable and the true
verdict was `ADVANCES` (the PR repairs a stale approval on `main`). The reader failed, not
the file. That is a false hazard on every single-project adopter repo, whose layout
(`specs/SPEC-001-foo.md`, sidecar `.minspec/approvals/specs/SPEC-001-foo.md.json`) differs
from this monorepo's nested one.

## Root-cause diagnosis (from the issue; mechanism UNVERIFIED)

- Measured (issue #2138): the contents-API read succeeds on both refs; the tool reports
  neither readable. The spec is byte-identical on both refs; its canonical hash
  (`scripts/hooks/canonical.py:spec_hash`) equals the PR sidecar's `specHash`, not `main`'s.
- **Not measured:** the reader. `cos.py` is machine-local and unversioned (read-only mount),
  so it is not in this repo and was not read. The path-shape mechanism (fixed-segment
  stripping, or assuming a local checkout) is inference. This spec must not be implemented
  on that inference alone; Plan must first reproduce the miss (see AC-1).
- Repo-side fact: the sidecar record carries `specPath` ("repo-relative, POSIX",
  `packages/minspec/src/lib/approval.ts:62`), so the spec location is recoverable from the
  sidecar content without reconstructing it from the sidecar path.
- Conflation: one verdict, `UNKNOWN`, covers "sidecar parse failed" and "reader could not
  locate it". Both must fail closed; only the first is a property of the PR.

## Functional requirements

**FR-1. Spec path comes from the sidecar, not the sidecar path.** Given a located sidecar,
the reader takes the spec's location from the sidecar's `specPath` field and never derives
it by stripping a fixed number of path segments or by assuming a project/directory-per-spec
shape. A sidecar whose `specPath` is missing, non-string, absolute, or escapes the repo
(`..`) is rejected (FR-3), not guessed.

**FR-2. Layout-agnostic.** The reader gives the same verdict for equivalent content under
(a) nested `specs/<project>/SPEC-NNN-slug/requirements.md` and (b) flat
`specs/SPEC-NNN-slug.md`, with sidecars at the corresponding
`.minspec/approvals/specs/<specPath>.json`.

**FR-3. Two distinct failing verdicts, both fail-closed.**
- `UNREADABLE`: a sidecar file was located and fetched but could not be parsed or validated
  (bad JSON, bad `specPath`, missing `specHash`). Reported as a hazard.
- `UNRESOLVED`: the reader could not locate the sidecar or its spec (fetch error, 404,
  layout not understood). Worded as a reader limitation: names what it tried, says "check by
  hand", and does not assert the PR is unsafe.
Both still count as "no witness": neither may produce `ADVANCES`/safe, and the aggregate
line must not read "safe" while any sidecar is either. (`UNKNOWN` is retired as a verdict
name, or kept only as an alias; see D2.)

**FR-4. The aggregate line distinguishes the causes.** "At least one sidecar is UNSAFE" is
printed only for a hazard verdict. When the only failures are `UNRESOLVED`, the line says
the reader could not verify and the human should check by hand. An error is never swallowed
into a pass (constitution invariant 2).

**FR-5. Offline-by-default unaffected.** The reader's network use stays what it is today
(it already reads via the forge API by design); this spec adds no new network call and no
new consent surface (invariant 1).

## Acceptance criteria

- **AC-1 (reproduce first).** A recorded fixture of the voip-sms-inbox#90 shape (flat spec,
  flat sidecar, PR sidecar hash equals true canonical hash, `main` sidecar stale) yields
  `UNKNOWN` on the current reader and `ADVANCES` after the fix. The red run is evidence the
  mechanism is real; if it is not red, the root-cause inference above is wrong and Plan
  re-diagnoses.
- **AC-2.** Flat fixture: `specs/SPEC-001-foo.md` + `.minspec/approvals/specs/SPEC-001-foo.md.json`
  gives the same verdicts as the nested equivalent for: advances, unchanged, regresses
  (hash mismatch), stale-on-main.
- **AC-3.** Sidecar present with invalid JSON -> `UNREADABLE`. Sidecar 404 / spec 404 /
  unrecognised path -> `UNRESOLVED`. Neither is ever reported as safe.
- **AC-4.** `specPath` of `../x`, `/etc/x`, empty, or absent -> `UNREADABLE` (not read).
- **AC-5.** Aggregate output for an all-`UNRESOLVED` run contains the "reader limitation /
  check by hand" wording and not the bare "UNSAFE" claim; an `UNREADABLE` run still does.
- **AC-6.** A control case: a genuinely mismatching hash still reports the unsafe verdict
  (the fix does not turn a real hazard into a pass).

## Invariants this change must not break

- Fail-closed: no verdict path turns an unreadable or unlocatable witness into a pass
  (constitution invariant 2, no silent gate).
- No new network call, no behaviour change in a repo without `.minspec/` (invariants 1, 3).
- The hash is computed by the existing canonical function; no second hashing implementation
  is introduced (a duplicate predicate would drift).

## Decisions needed (Clarify)

All 2 decisions are answered, not ratified: an agent session selected, for each, the option this
document already recommended. No human chose them, and no delegation covers authoring Clarify
answers. Delegation DLG-001 (DR-108) made none of these selections and covers spec approval and
engineering-DR acceptance only. An agent-recorded selection carries no consent, whoever prompted
it. It is ratified only by approval of this spec, the founder's or the bot's under DLG-001, and
that approval may overturn it.

**D1. Where does the fix live?** The reader (`cos.py`) is machine-local and unversioned, so
a spec here cannot change it directly.

**Recorded selection: Option (a),** land a versioned reader inside this repo that reuses
`canonical.py:spec_hash`, with the fixtures of AC-1..6 as its tests, and have `cos.py`
delegate to it.

- (a) **(rec)** Land a versioned reader inside this repo (e.g. under `scripts/`) that reuses
  `canonical.py:spec_hash`, with the fixtures of AC-1..6 as its tests, and have `cos.py`
  delegate to it. Cost: a new maintained surface, and `cos.py` still needs a one-time manual
  change on the host that this repo cannot make.
- (b) Keep this spec as a requirements contract only and file the change against the host
  tool's owner. Cost: nothing in this repo can verify the fix; the finding stays unenforced.

**D2. Verdict naming.** (a) **(rec)** Rename to `UNREADABLE` / `UNRESOLVED` and drop
`UNKNOWN`. Cost: any consumer parsing the literal `UNKNOWN` breaks (loudly, which is
fail-closed). (b) Keep `UNKNOWN` as an umbrella with a sub-reason. Cost: a consumer that
matches only the umbrella still cannot tell the two apart, which is the defect.

**Recorded selection: Option (a),** rename to `UNREADABLE` / `UNRESOLVED` and drop
`UNKNOWN`.

## Follow-ups (tracked)

- Sibling machine-local-tool finding with the same home problem: #2136 (issue).
- Other machine-local consumers of the sidecar layout were not inspected: backlog: audit
  `~/.claude/scripts/` readers for the nested-layout assumption.
