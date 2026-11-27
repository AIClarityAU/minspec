---
id: SPEC-256
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - Alt+A is the one-keystroke approve/accept for every approvable
aspects: [approvals, alt-a, adopter-layout, flat-layout, no-silent-gate]
depends_on: []
relates_to: ["#2519", "#2117", "#2370", "#440", SPEC-236, SPEC-238]
implements: none
implements_reason: >-
  Specify phase only. Files this spec will own are decided at Plan, after Decision D1
  (which approve path) is resolved.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-256: A flat-layout spec with a stale approval, whose literal status is terminal, has an approve path

> **This is a SPECIFICATION ONLY.** Written for issue #2519. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

In a repo using `"specsLayout": "flat"` (one `specs/SPEC-NNN-slug.md` per spec), a spec with
literal `status: done` and a stale approval cannot be re-approved from any MinSpec surface.
#2117 deliberately left "Alt+A on the focused `requirements.md`" open as the per-artifact way
to reach a terminal spec, but that path only exists for split-layout specs. Live case:
AIClarityAU/voip-sms-inbox SPEC-001 (issue #123 asks for "one Approve keystroke" nothing offers).

## Diagnosis (mechanism cited from the issue's measurements; re-verify at Plan)

Each surface's predicate, as reported in #2519 (file:line from the issue, not re-measured here
except where marked):

| Surface | Why a flat terminal-stale spec is unreachable |
|---|---|
| Palette picker | drops terminal specs: `status !== 'approved' && !isTerminalSpecStatus(s.status)` (`commands/approve.ts:257`). By design, #440. |
| Alt+A, focused file | `classifyApprovablePath` recognises a spec only by basename `requirements.md` / `spec.md` (`lib/approvable.ts:26`, `:42`). `SPEC-001-foo.md` classifies as nothing, so step 2 of `approveActive` is skipped and Alt+A falls to the recent-viewed picker and the spec backstop, both filtered. |
| Specs tree | terminal row gets `specNode.terminal`, matched by no approve when-clause (`views/spec-tree-provider.ts:229-232`); Needs Re-Approval excludes terminal specs (`:466`). |
| Signpost | silent since #2370 (`packages/shared/src/next-task.ts:770`). |

Checked here: for a split-layout focused file, `approveActive` resolves the node via `listSpecs`
and dispatches it (`approve-active.ts:271-276`); a node passed to `approveSpec` bypasses the
picker's terminal filter (`approve.ts:66`). So once a flat file is *classified*, the existing
dispatch already works; the gap is classification only.

Third consumer of the classifier (not named in the issue): `lib/approval-store.ts:249` calls
`classifyApprovablePath(rec.specPath)` on sidecar records and keeps the ones that do NOT
classify. What that list is for was not traced here; Plan must read it before changing the
classifier's contract, because a config-aware classifier changes what it returns for flat
sidecars (UNVERIFIED whether that is a defect or a fix).

Root cause (mechanism + missing gate): classification is a filename test that encodes only
the split-layout convention, and no check ties "every layout `listSpecs` can return is
reachable by a per-artifact approve path" to the claim #2117 made.

## Functional requirements

**FR-1. Focused-file Alt+A reaches every spec `listSpecs` returns.** With a spec file focused
in the editor, Alt+A resolves it to that spec and dispatches approval for any layout
(`flat`, split), regardless of the file's basename, subject to D1.

**FR-2. Terminal-literal specs stay out of the pickers.** The palette picker, MRU picker and
backstop keep dropping terminal specs (#440 unchanged). Only an explicit per-artifact act
(focused file, or per D1 a tree row) reaches one.

**FR-3. Never-approved terminal specs are not newly approvable via a broadened path unless
D2 says so.** The change must not silently turn "done, never approved" into an approve
target; D2 fixes the behaviour.

**FR-4. The silence explains itself.** When Alt+A skips or declines a terminal-literal spec
(including the picker paths that drop it), it says so in one message naming the spec id,
its literal status, and the per-artifact way to reach it. No silent no-op (closes the
#2370 follow-up; constitution invariant 2).

**FR-5. Multi-root and config.** Classification of a focused file uses the config of the
folder that contains it (`folderForFile`), not workspace folder `[0]`; a custom `specsDir`
is honoured.

**FR-6. Other classifier consumers keep their contract.** The recently-viewed tracker
(`lib/recent-approvables.ts:40`) and the sidecar scan (`lib/approval-store.ts:249`) either
keep a pure filename classifier or are updated deliberately with tests; none changes
behaviour as a side effect.

**FR-7. Offline.** No network call added (invariant 1). Nothing active in a repo without
`.minspec/` (invariant 3).

## Acceptance criteria

- **AC-1 (red first).** Fixture: flat layout, `specs/SPEC-001-foo.md`, literal `status: done`,
  stale sidecar. Focused-editor Alt+A currently does not dispatch `minspec.approveSpec` with
  that spec; after the fix it does and the sidecar's hash becomes current.
- **AC-2.** Same fixture in split layout behaves identically (parity across layouts).
- **AC-3.** The same spec in the palette picker and MRU picker is still absent (FR-2).
- **AC-4.** A `done` flat spec that was never approved: behaviour per D2, tested both ways.
- **AC-5.** Alt+A with only a terminal spec available shows the FR-4 message; asserts the
  text names id, status and the reach path.
- **AC-6.** A non-spec markdown file in `specs/` (no `id: SPEC-NNN` frontmatter, e.g. README)
  is not classified as a spec.
- **AC-7.** Multi-root: spec in folder `[1]` with a flat config resolves against folder `[1]`.
- **AC-8.** Recents tracker and sidecar scan: unchanged outputs for existing fixtures.

## Invariants the change must not break

- #440: terminal specs are not offered by default; this adds only an explicit path.
- #2117: Alt+A on a focused artifact is the deliberate per-artifact route.
- SPEC-236: Alt+A tree-selection resolution order is unchanged.
- Approval hash/sidecar semantics (`getApprovalStatus`) are untouched; no write path added.
- Constitution invariants 1 (offline), 2 (no silent gate), 3 (blast radius).

## Decisions needed (Clarify)

All 3 decisions are resolved: an agent session recorded each option this document already
recommended, under delegation DLG-001 (DR-108, the delegated-approval record). No human
chose them; they are ratified only by approval of this spec.

**D1. Which approve path for a terminal-stale flat spec?**

**Recorded selection: Option (a),** make focused-file classification recognise any file
`listSpecs` returns for the folder's configured `specsDir`.

- `a` **(rec)** Make focused-file classification recognise any file `listSpecs` returns for
  the folder's configured `specsDir`. Restores the path #2117 intended, for every layout, with
  no new menu surface. *Cost:* classification stops being a pure filename test; it needs the
  folder config and a listing, and touches the recents tracker and sidecar scan that share it
  (FR-6).
- `b` Tree offers re-approval on a terminal row whose approval is stale. *Cost:* partly
  reopens #440's "approve on terminal rows" and needs its own predicate (and when-clause) so a
  never-approved `done` spec gets no action.
- `c` Both. *Cost:* two surfaces to keep aligned; the repo's own lesson is duplicated
  predicates drift.

**D2. Never-approved terminal spec via the focused-file path.** (a) **(rec)** Allow: it is an
explicit per-artifact act, matching split-layout behaviour today; *cost:* one keystroke
approves a spec that skipped the gate, so FR-4 messaging should state it was never approved.
(b) Refuse with an explanation; *cost:* diverges from split layout and keeps a dead end for
specs that predate adoption.

**Recorded selection: Option (a),** allow it: an explicit per-artifact act matching
split-layout behaviour, with FR-4 messaging stating the spec was never approved.

**D3. Classifier shape.** (a) **(rec)** Keep the pure `classifyApprovablePath` and add a
config-aware resolver used only by `approveActive` step 2; *cost:* two functions to explain,
but FR-6 consumers stay untouched. (b) Make the classifier itself config-aware; *cost:* wider
blast radius and the sidecar-scan behaviour change above.

**Recorded selection: Option (a),** keep the pure `classifyApprovablePath` and add a
config-aware resolver used only by `approveActive` step 2.

## Follow-ups (tracked)

- Sidecar-scan consumer semantics (`approval-store.ts:249`): traced at Plan under this spec.
- voip-sms-inbox#123 (live SPEC-001 re-approve) unblocks when this ships; until then the
  founder cannot act from MinSpec UI.
