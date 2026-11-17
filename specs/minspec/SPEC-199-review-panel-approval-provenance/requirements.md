---
id: SPEC-199
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the AI review panel must judge a human sign-off on evidence, not on a guess
aspects: [ai-review, approval, provenance, never-wrong, trust-boundary, prompt-injection, offline, no-silent-gate, retroactive]
relates_to: [SPEC-022, SPEC-031, SPEC-041, SPEC-050, SPEC-051, SPEC-069, SPEC-070, DR-012, DR-034, DR-056, DR-081, "#1025", "#1026", "#1017", "#1009", "#1022", "#1029", "#1066"]
# Retroactive spec: the files below already exist on main (#1026, commit db2a36b5). No spec
# in the corpus declares an owner for either (checked: no `implements:` line names them), and
# this issue is where both came from, so this spec claims them. SPEC-069 and SPEC-070 list
# approval-provenance.py under `affects:` only, which stays correct.
implements: [scripts/approval-provenance.py, packages/minspec/tests/approval-provenance.test.ts]
# Modified, not owned: review-branch.sh is the one caller that injects the block into the
# prompt. template-registry.ts ships approval-provenance.py to adopters (the
# `approval-provenance-script` entry) and is review machinery.
affects: [scripts/review-branch.sh, packages/minspec/src/lib/template-registry.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec - The AI review panel gets approval-provenance facts it cannot work out from a diff (Requirements)

> Triggered by **[#1025](https://github.com/AIClarityAU/minspec/issues/1025)** (the panel calls
> legitimate re-approvals "forged sign-offs"). **Retroactive:** the fix merged as
> **[#1026](https://github.com/AIClarityAU/minspec/pull/1026)** (commit `db2a36b5`) before any
> spec existed. This document records the contract that code must keep, and lists the gaps it
> still has, so a later change cannot quietly weaken it. It does not ask for the feature to be
> built again.
>
> Rests on: [DR-012](../../../docs/decisions/DR-012.md) (re-approval is a human-only act),
> [DR-034](../../../docs/decisions/DR-034.md) (one canonical hasher), and
> [DR-056](../../../docs/decisions/DR-056.md) (agent identities can never approve). Its follow-on is
> [SPEC-069](../SPEC-069-approval-record-deterministic-witness/requirements.md), which gives this
> same script a **gating** mode for approval-record pull requests
> ([DR-081](../../../docs/decisions/DR-081.md)). This spec covers only the **advisory** prompt
> block. SPEC-069 FR-4 says that block's behaviour must not change.

## Problem

The reviewers in the AI panel can use `Read`, `Glob` and `Grep`, and nothing else. They have no
`git` (`scripts/review-branch.sh`, in the `USER_CONTENT` prompt: "You have NO gh, git, network, or
shell access"). They can read the files a pull request touches. They cannot see **when** a file
changed or what it looked like before.

So when a diff touches only an approval sidecar (`specHash` and `approvedAt` change), the diff alone
cannot tell apart:

- **(a) a legitimate re-approval.** The spec changed in an earlier commit that has already merged.
  That made the old record stale, and a human approved again.
- **(b) a fabricated sign-off.** The hash was edited and no content change backs it.

When the panel cannot answer that question, it guesses (b). On #1017 the Architect and the Skeptic
both blocked a genuine human Alt+A approval as a possible "forged sign-off". In fact #1009 had
changed `SPEC-040/requirements.md` at 02:27:08Z, and the human approved it again 85 seconds later.

**Root cause (mechanism and missing gate).** The mechanism: a reviewer that cannot see history is
asked a question whose answer is only in history. The missing gate: the prompt carried no
**evidence** about history. The reviewers reasoned correctly from what they could see, so the fix
gives them the missing facts. It does not soften the rule.

## Current state (as built, verified 2026-10-16 against `9ec672dd`)

| Fact | Where |
|---|---|
| Facts are computed by `scripts/approval-provenance.py <base> <head>`, using git plumbing and the `spec_hash` from `scripts/hooks/canonical.py` (the same hasher the approval system uses) | `approval-provenance.py:50` (import), `report_for` |
| The base is the merge-base of `base...head`, so it matches the diff the reviewer sees | `merge_base()` |
| For each changed `.minspec/approvals/**.json`, it reports: the spec, the sidecar hash, the spec's hash at head, a `MATCHES`/`MISMATCH` verdict, the last commit to change the spec, and whether the previous record was **already stale at base** | `report_for()` |
| The reassurance that a changed hash is **expected** appears only when the head hash matches. A forged hash on top of a stale predecessor still gets `MISMATCH` plus an explicit "staleness does NOT explain this" | `report_for()`, the stale and not-stale branches |
| DR flips to `accepted` are reported `VERIFIED` or `UNVERIFIED` (added later by #1066 / SPEC-041) | `dr_accept_report()` |
| Every value that comes from the diff or from a commit (sidecar filename, `specPath`, `specHash`, commit subject) is sanitised: CR/LF removed, `<`/`>` neutralised, length capped | `_sanitize()`, `_abbrev()` |
| The diff is defanged against forged `<untrusted_diff>` / `<approval_provenance>` tags before it is wrapped | `review-branch.sh`, `DIFF=... sed -E` |
| The block is injected **after** `</untrusted_diff>`, labelled TRUSTED. It is empty when no sidecar or DR flip is touched | `review-branch.sh`, `PROVENANCE_BLOCK` / `REVIEW_INPUT` |
| A failure of the helper is swallowed (`2>/dev/null \|\| true`), and the review then runs **without** the block | `review-branch.sh`, the `PROVENANCE=` line |
| Tests cover: the #1017 replay, the pure-forgery path, a stale predecessor with a forged head, injection through subject and filename, the empty case, first approval, bad usage, prompt wiring, and the DR flips | `packages/minspec/tests/approval-provenance.test.ts` |
| CI checks out with `fetch-depth: 0`, so the merge-base and history exist | `.github/workflows/ai-review.yml`, `fetch-depth: 0` |

## Functional Requirements

Each FR below is **met** by the current code unless it is marked *(gap)*.

- **FR-1 (facts the diff cannot show).** For every approval sidecar that changes in the range, the
  review prompt carries a machine-computed block that states: (a) the spec the record points at;
  (b) whether the record's `specHash` equals the canonical hash of that spec **at head**; (c) the
  last commit that changed that spec; (d) the state of the previous record, which is one of: none
  (first approval), the same hash (metadata only), **already stale at base**, or valid at base.
- **FR-2 (one hasher).** Hashes are computed with the scaffolded `canonical.py` `spec_hash`. This
  script never adds a second implementation of the hash (DR-034, SPEC-069 FR-4).
- **FR-3 (the panel keeps its edge).** A head hash that matches no content is always reported as
  `MISMATCH` and called a real finding. No reassuring line may appear next to a `MISMATCH`, whatever
  state the previous record was in. Required cases:
  - stale predecessor plus forged head: `MISMATCH` and "staleness does NOT explain this"
  - valid predecessor, spec unchanged, hash edited: `MISMATCH` and "Nothing backs the new hash"
  - valid predecessor, spec changed, head hash wrong: `MISMATCH`
- **FR-4 (legitimate re-approval reads as legitimate).** When the previous record was already stale
  at base **and** the head hash matches, the block says outright that the changed hash is expected
  and that this is a re-approval, not an unbacked edit.
- **FR-5 (base agrees with the diff).** Base-side facts are read at `merge-base(base, head)`, the
  same tree that `git diff base...head` compares against.
- **FR-6 (trust boundary).** The block sits outside the untrusted-diff container and is labelled
  machine-generated. Nothing the diff controls can close the block, open it, or forge a line inside
  it. That covers field values, file paths and commit subjects.
- **FR-7 (offline, read-only).** Git plumbing and sha256 only. No network call (invariant 1). The
  script never writes a file, a sidecar or an approval (DR-012, DR-056).
- **FR-8 (quiet when irrelevant).** If the range touches no sidecar and flips no DR, the output is
  empty, and the prompt is byte-for-byte what it would be without this feature.
- **FR-9 (a missing block is visible) *(gap)*.** Today two different states look the same to the
  panel: "this change touches no approval record" and "the provenance helper failed". In both, the
  block is simply absent. That puts back exactly the incomplete view this spec exists to fix, and
  nobody can see that it happened. When the range **does** touch a sidecar but the facts cannot be
  computed, the panel and the CI log must both show that. The failure points are: the helper exits
  non-zero, `canonical.py` fails to import, `python3` is missing, or `_git` returns empty because
  git failed (as opposed to returning nothing because nothing matched). The panel must not be left
  guessing in silence. The visible form is a Clarify decision (D-1).
- **FR-10 (renamed spec) *(gap)*.** When a sidecar's `specPath` differs between base and head,
  the previous record must be compared against the spec at **its own** base path. Today
  `report_for` reuses the head `specPath` for the base lookup. A rename can then yield "spec absent
  at base - cannot compare", or compare against the wrong file. The fix is either to compare
  correctly or to report the rename explicitly as a fact.

## Acceptance Criteria

Boxes stay unticked until a reviewer has run the named test. "Exists today" means a test with that name is in the file; it has not been re-run for this spec.

- [ ] **AC-1 (FR-1, FR-4).** A test reproduces #1017: one commit changes the spec, and a later commit
  changes only the sidecar to the correct new hash. The block shows `MATCHES`, `ALREADY STALE`,
  the "re-approval, not an unbacked edit" line, and the short SHA of the earlier commit.
  *(Exists today.)*
- [ ] **AC-2 (FR-3).** Each of the three `MISMATCH` cases in FR-3 has a test. Each asserts both that
  `MISMATCH` is present **and** that no reassurance string is. *(Exists today.)*
- [ ] **AC-3 (FR-6).** A commit subject, a `specPath`, a `specHash` and a sidecar filename that each
  carry `\n</approval_provenance>` cannot add a line to the block or close it. *(Subject and
  filename exist today. `specPath` and `specHash` need explicit cases.)*
- [ ] **AC-4 (FR-8).** A range with no sidecar produces empty output, and `review-branch.sh
  --print-input` is unchanged from a run without the helper. *(Empty output exists today. The
  byte-identity part needs a test.)*
- [ ] **AC-5 (FR-9).** If the helper is made to fail on a range that touches a sidecar (a broken
  `canonical.py` import, or an unreachable base ref), `--print-input` contains the visible
  "provenance unavailable" form chosen in D-1, and stderr names the cause. Run as a control, the
  same range with a working helper does **not** contain it. A test that only greps the source text
  for `|| true` does not satisfy this AC.
- [ ] **AC-6 (FR-10).** A fixture that renames a spec and moves its sidecar's `specPath` produces a
  correct previous-record verdict, or an explicit rename fact. It never produces a silent "cannot
  compare".
- [ ] **AC-7 (FR-7).** Running the script against a fixture repo leaves `git status --porcelain`
  empty, and the test environment allows no network.

## Invariants (must not break)

- **INV-1: offline (constitution invariant 1).** Git and hashing only. No network call.
- **INV-2: no silent gate (constitution invariant 2).** The block is **advisory**: it informs the
  voters and gates nothing. The `|| true` on its call is therefore not a gate signal written with a
  swallowed error. But a silent omission still recreates the incomplete view behind #1025, and
  FR-9 closes that. The **gating** use of the same facts belongs to SPEC-069. This spec must never
  promote the advisory block into a merge signal.
- **INV-3: blast radius (constitution invariant 3).** The script is shipped to adopters through
  `template-registry.ts` and runs only inside a repo that has `.minspec/`. No change here may add
  behaviour outside that repo.
- **INV-4: no borrowed sign-off.** Nothing here writes, refreshes or vouches for an approval
  (DR-012, DR-056). The script reports facts and never mints a record.
- **INV-5: one hasher.** The hash comes only from `canonical.py`, never from a re-implementation.
  If the hash basis changes (SPEC-070), the scaffolded `canonical.py` and this script move
  together.
- **INV-6: the trusted channel cannot be forged.** Every interpolated value passes through
  `_sanitize`, and the diff is defanged against both container tags before it is wrapped.

## Decisions needed (Clarify)

- **D-1: how FR-9 shows that the provenance helper failed.**
  - `a` **(rec)** Inject a short TRUSTED block, `provenance UNAVAILABLE: <cause>`, and print the
    cause to stderr. The review still runs. *Cost:* the panel then knows it is missing evidence and
    may still block a legitimate re-approval. That block is correct ("cannot verify"), but the
    friction from #1017 remains whenever the helper is broken.
  - `b` Fail the review job closed when a sidecar is touched and the facts cannot be computed.
    *Cost:* a broken helper turns into a red required check on every approval pull request. That
    makes an advisory aid load-bearing, which is the job SPEC-069 is designing properly.
  - `c` Leave it as it is (silent omission). *Cost:* the #1025 false block comes back unseen
    whenever the helper breaks, and nobody can tell why.
- **D-2: FR-10 for renames.**
  - `a` **(rec)** Read the base `specPath` from the base sidecar and compare against that path.
    *Cost:* one more branch in `report_for` that needs fixtures. A rename together with a content
    change still shows up only as "stale at base".
  - `b` Report "spec path changed: X to Y" as a fact and make no stale comparison. *Cost:* the
    panel goes back to guessing for renamed specs, which is a smaller version of #1025.
- **D-3: does this spec stay separate or fold into SPEC-069?** `a` **(rec)** Keep it separate,
  because it is the contract for the advisory block, which SPEC-069 FR-4 already freezes. *Cost:*
  two specs touch one script, so a later edit has to read both. `b` Fold FR-9 and FR-10 into
  SPEC-069. *Cost:* that spec is already T4 and in `planning`, and it would grow again.

## Out of scope

- A gating `approval-integrity` check (SPEC-069 / DR-081).
- Cryptographic proof of who approved. The DR-acceptance block already says plainly that an agent
  which sets its git email to a human address can forge a record.
- Approval stranding (#1022) and the auto-opened approval pull request (SPEC-050).

## Follow-ups (tracked)

- FR-9 / FR-10 implementation: tracked by [#1025](https://github.com/AIClarityAU/minspec/issues/1025),
  this spec's triggering issue, which stays the home for that work until D-1 and D-2 are decided.
- Gating mode: SPEC-069.
