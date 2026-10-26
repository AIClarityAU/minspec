---
id: SPEC-225
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # concurrent multi-session coordination; the shared-checkout sweep rule belongs here
aspects: [approval, commit-gate, shared-checkout, no-silent-gate, enforce-dont-trust]
relates_to: [SPEC-140, SPEC-069, DR-081, DR-003, "#2041", "#1376", "#168"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-225: An approval's two halves land together, or only the safe half lands

Issue: #2041 (the approvals stop-list manufactures the unapproved-but-advanced state it exists to prevent).

## In plain terms

Approving a spec writes two things: the lifecycle fields in `specs/<spec>/requirements.md`
and a hash-locked sidecar in `.minspec/approvals/`. Agents are told "never commit a
stop-listed path", and `.minspec/approvals/` is on that list. A session tidying a dirty
checkout therefore commits the spec and leaves the sidecar behind. The spec then reads
`status: planning` with no signed record behind it. This spec replaces the path rule with
an intent rule and adds a commit gate so it does not depend on the model remembering.

## Context

**Measured in the issue** (2026-09-22, by splitting commit `f38c83ec`, which landed SPEC-066,
SPEC-067 and SPEC-070 atomically, and running the approval computation on each state; I have
not re-run this):

| State | Result |
|---|---|
| both halves committed | `validity: APPROVED` |
| sidecar landed, frontmatter stranded | `APPROVED`: canonicalization strips `status:` and `phases:`, so the signed bytes are untouched |
| frontmatter landed, sidecar stranded | `sidecar: (MISSING)`, `validity: UNAPPROVED`, while the spec reads advanced |

The third row is a lying signpost. The stop-list wording ("never commit this path") was
written to stop a mechanical sweep (`git add -A`) from pulling a human sign-off into an
unrelated commit. The intent is right; the path form steers a careful session into row three.

**Where the rule lives.** The stop-list prose is operating guidance for agents on shared
checkouts. This spec treats it as prose to be restated wherever it appears (FR-1) and the
gate (FR-2 to FR-4) as the enforcing part. Locating every copy is a plan-phase task.

## Requirements

- **FR-1 - Rule by intent.** Every statement of the approvals stop-list rule reads: never
  *mechanically sweep* an approval path into a commit; DO deliberately land a verified
  sign-off, all halves in one commit, with validity computed against current bytes first.
  Refusing to land approvals at all is as wrong as sweeping half of one.
- **FR-2 - Frontmatter without sidecar is refused.** A commit that changes the lifecycle
  fields (`status`, `phases`, and any other field canonicalization strips) of an approvable
  `requirements.md` and does not carry its matching sidecar change in the same commit is
  refused, naming the spec and the missing sidecar path.
- **FR-3 - Sidecar without frontmatter is permitted.** A commit carrying a sidecar change
  without the lifecycle change is not refused (the measured row is harmless). It is allowed
  but reported so the stranded half is visible.
- **FR-4 - Sidecar must validate.** Where both halves are present, the gate computes the
  sidecar's hash against the committed spec bytes and refuses on mismatch, so the pair is
  verified, not merely co-present.
- **FR-5 - If only one half can land, land the sidecar.** The rule text (FR-1) and the gate's
  refusal message both state this.
- **FR-6 - Fails closed and visibly.** If the gate cannot read the sidecar, the spec, or the
  base, it refuses and says why. No swallowed error, no `|| true` (constitution invariant 2).
- **FR-7 - Independent second witness.** The check runs in CI on the pull request as well as
  at commit time, so one disabled local hook does not remove it (invariant 2). It is
  advisory-first, as `approval-integrity` was (`scripts/approval-integrity.ts` header);
  making it required is a separate human act.
- **FR-8 - Bypass is named and scoped.** A single env bypass disables only this check, in the
  style of `RCDD_GATE_OFF`, and a bypass is reported, never silent.
- **FR-9 - Opt-in only.** The gate runs only where `.minspec/` exists (constitution invariant 3).

## Acceptance criteria

- AC-1: a fixture commit with a `status:` flip and no sidecar is refused with the spec path
  and the expected sidecar path named (FR-2).
- AC-2: the same commit plus its sidecar passes; the sidecar-only commit passes with a report
  (FR-3, FR-4).
- AC-3: a sidecar whose hash does not match the committed spec bytes is refused (FR-4).
- AC-4: a corrupt or unreadable sidecar refuses, never passes (FR-6).
- AC-5: a spec edit that changes only non-lifecycle body text, with an existing valid
  sidecar untouched, is out of this gate's scope (the existing hash-staleness path owns it).
- AC-6: a repo without `.minspec/` is unaffected (FR-9).
- AC-7: the restated rule contains the sweep/deliberate distinction and the sidecar-first
  clause (FR-1, FR-5).

## Invariants this must not break

- Invariant 1: no network call. The check reads git objects and files only.
- Invariant 2: no silent gate (FR-6, FR-7, FR-8).
- Invariant 3: blast radius is the opted-in project (FR-9).
- DR-081 section 5: this checks the record's pairing; it exempts nothing and weakens no
  substance gate on the approvable.

## Decisions needed (Clarify)

Selections below are recorded on the option this document already marks recommended, by an
agent session on 2026-10-27. Selected on its recommended option under the founder's standing
instruction of 2026-10-26 (inbox item in66, relayed by the chief-of-staff proxy). The
founder did not see these items one by one. Decisions 1, 2 and 5 are left open (adopter
reach, an unverified premise, and no recommendation); this section stays open, and the spec
is not ready to approve, until the founder answers.

1. **Where the commit-time gate lives.**

   **Not recorded:** Option A puts the gate in the generated adopter hook template, so it
   reaches adopter repos. Needs the founder's answer.

   - A. `.githooks/pre-commit` plus the generated adopter hook template **(rec)**: catches it
     before the commit exists. Cost: the template ships to adopters, so it widens the
     shipped surface and needs the opt-in guard in FR-9.
   - B. CI only: smaller surface, but the stranded half is sealed into branch history before
     anyone is told.
2. **Does the approval flow itself ever produce a split commit?** SPEC-140 describes
   recovery pushing from a throwaway worktree; I have not verified it always carries both
   halves. If it can split, FR-2 would block the extension's own flow, so the plan must
   check this first. Option: exempt the approval-recover commit by an explicit marker
   **(rec)**, at the cost of one more trusted path to keep honest; or fix the producer.

   **Not recorded:** evidence-incomplete: this document says it has not verified whether
   SPEC-140's recovery flow ever splits the two halves, and the plan must check that first.
   Needs the founder's answer.
3. **Which lifecycle fields count.** Use the canonicalization strip-list as the single source
   **(rec)**, which cannot drift from the hash but couples the gate to that module; or a
   fixed list (`status`, `phases`), which is simpler but can drift.

   **Recorded selection: the canonicalization strip-list,** as the single source. Selected
   on its recommended option under the founder's standing instruction of 2026-10-26 (inbox
   item in66, relayed by the chief-of-staff proxy).
4. **Required or advisory in CI.** Advisory first **(rec)**, cost: a window where a split can
   still merge; required later by a human act on the ruleset.

   **Recorded selection: advisory first,** making it required later is a separate human act
   on the ruleset. Selected on its recommended option under the founder's standing
   instruction of 2026-10-26 (inbox item in66, relayed by the chief-of-staff proxy).
5. **Scope of the commit message wording** for the project-external agent guidance: this repo
   can only change prose it holds. Whether the out-of-repo copy is updated is a human act.

   **Not recorded:** no options and no recommendation are given, and updating the
   out-of-repo copy is named a human act. Needs the founder's answer.
