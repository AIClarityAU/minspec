---
id: SPEC-067
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-067 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - triage classification is the methodology's admission gate
relates_to: [DR-091, DR-072, DR-066, SPEC-022, "#1789", "#1790", "#1791", "#1792"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-067 - The triage dispute lane (Tasks)

Tasks map to the FR / INV / AC set in [requirements.md](./requirements.md) and the module
plan in [design.md](./design.md). One test file for all four slices:
`packages/minspec/tests/triage-dispute.test.ts`, one `describe` per slice.

**Four slices, and the order is load-bearing: A → C → B → D**, not the sub-issue
lettering. The front end (B) must not ship before the consumption half (C): a dispute
filed in between would trigger a re-triage that never sees the declaration, and that
re-triage's verdict consumes the dispute (FR-4), spending the human's one roll per body on
nothing (design section 6).

**In every slice the T0 boxes come first and must be seen red before the implementation
boxes start.** A T0 test that passes before its implementation exists is testing the wrong
thing - fix the test, not the order.

Sub-issue labels (#1789 to #1792) still read `needs-review`; requirements.md's Sub-issues
section says to swap them to `agent-ready` once the spec is approved and DR-091 accepted,
both of which are now true (approval commit `0a8a5961`, acceptance commit `03a9c570`).
Swapping a label is a triage act, not part of this plan.

## Slice A - the pure half: grammar, selector, predicates (#1789)

**File allowlist:** `scripts/dispatch-ready-check.sh`,
`packages/minspec/tests/triage-dispute.test.ts`.

### T0 - Invariants (write first, before implementation)

- [ ] **A-T0-1 (INV-2, FR-2) the dispatch reader is blind to disputes.** A verdict source
      holding only a well-formed dispute block, with `agent-ready` labelled, refuses
      `no-verdict`; the same source plus a `hold: tier` verdict refuses `held`, exactly as
      without the dispute.
- [ ] **A-T0-2 (INV-2, AC forged dispute) a forged dispute buys nothing.** A dispute block
      hand-edited to also carry `hold: none`, `human_only: no` and `decision: agent-ready`
      lines, in a trusted comment beside a `hold: human` verdict: the reader still refuses
      `human-only`; `--newest-record` still returns the verdict.
- [ ] **A-T0-3 (FR-3) the full refusal table, one case per row.** `--may-dispute` for each
      FR-3 row, plus both `[garbled-record]` pairings (`human`+`no`, `none`+`yes`) asserted
      refused **before** `direction` is inspected (pass a nonsense direction; the code must
      still be `garbled-record`). Exit status and the bracketed code are both asserted.
- [ ] **A-T0-4 (INV-4 minting axis) `--dispute-exists` survives an intervening
      tightening.** Stream: loosening dispute at hash H (older), tightening dispute at H
      (newer). `--dispute-exists H loosening` exits 0. **Mutation check:** reimplement it
      as "newest dispute at H has direction loosening" and confirm this test goes red.
- [ ] **A-T0-5 (INV-4 injection axis) consumption.** Verdict V1, dispute D pinned to V1:
      `--fresh-dispute H` returns D. Append verdict V2 (newer, same hash): returns nothing,
      exit 1. A verdict source with no dated verdict: returns nothing.
- [ ] **A-T0-6 (INV-1) `hold:human` still absolute.** `--may-approve human yes` and
      `--may-approve human no` both refuse, with dispute blocks present and absent;
      `APPROVABLE_HOLDS` still reads `tier specify`.
- [ ] **A-T0-7 (FR-9) the fence breaks the new pair.** `--fence-agent-text` over text
      containing `MINSPEC_DISPUTE_BEGIN` / `MINSPEC_DISPUTE_END` and the
      `<!-- minspec-triage-dispute -->` marker; the output, wrapped in a trusted comment,
      yields nothing from `--newest-dispute`.
- [ ] **A-T0-8 (INV-6) nothing ships.** No path this slice adds is under
      `packages/minspec/src/`, and none is inside `packages/minspec/` at all, so no `.vsix`
      can carry it (the packaging-exclusion precedent is
      `no-app-private-key-shipped.test.ts`, which reads `.vscodeignore`).

### T1 - Contract

- [ ] **A-T1-1 round trip.** `--render-dispute` → wrap in a trusted comment →
      `--newest-dispute` returns the same block; every C-1 field present, and none of
      `decision`, `hold`, `human_only`, `role`, `tier`.
- [ ] **A-T1-2 writer refusals.** Out-of-vocabulary type (stderr prints the valid set),
      bot `disputedBy` (`minspec-sdd[bot]`, `github-actions`), empty `disputedBy`,
      `MINSPEC_VERDICT_BEGIN` passed in **each** argument position in turn (design section
      3: `record_scrub` keeps `_`, so the shape checks are what refuse it), non-ISO
      `disputedVerdictAt` and `verdictAt`,
      `disputedHold` of `tier` (message names `approve-issue.sh`), `info`, `garbage`, and
      `sha256sum` absent from `PATH` (fails closed). Each exits 1 and prints no block.
- [ ] **A-T1-3 derived direction.** Every C-2 token renders the direction `disputeDirection`
      gives; there is no argument by which a caller can supply one.
- [ ] **A-T1-4 read-time validity (design section 3).** Each of these is not selectable by
      `--newest-dispute`, `--dispute-exists` or `--fresh-dispute`: wrong `gate`;
      out-of-vocabulary type; `declaredType: chore` with `direction: tightening`; bot
      `disputedBy`; malformed or future-dated `verdictAt`; malformed `bodyHash`; any field
      whose value is `MINSPEC_VERDICT_BEGIN`. The last case is also run through the
      dispatch reader beside a `hold: human` verdict, which must still refuse `human-only`.
- [ ] **A-T1-5 validate-then-select.** A valid older dispute and a garbled newer one:
      `--newest-dispute` returns the older valid one.
- [ ] **A-T1-6 shared selector, proven shared.** Drive `_newest_record_impl` with both
      sentinel families through their entry points over the same interleaved fixture
      (quoted older record placed last): both pick by `verdictAt`, not position.
      Ties keep the later block for both.
- [ ] **A-T1-7 ranking key.** A dispute whose `disputedVerdictAt` is later than its own
      `verdictAt` ranks by `verdictAt`.

### Implementation

- [ ] **A-I-1** Constants and the two type lists (design 4.1 item 1).
- [ ] **A-I-2** Parameterise `_newest_record_impl` with optional `begin`/`end`; existing
      callers unchanged. Run the full `dispatch-ready-check.test.ts` suite green before
      going on.
- [ ] **A-I-3** `_each_block` (POSIX awk; run the slice's tests once with `awk` resolving
      to `mawk` if it is installed, since that is CI's awk).
- [ ] **A-I-4** `_dispute_valid` and `_hold_disputability`.
- [ ] **A-I-5** The five entry points, before the positional reader.
- [ ] **A-I-6** `fence_agent_text` alternation gains `MINSPEC_DISPUTE`.
- [ ] **A-I-7** Usage header (`dispatch-ready-check.sh:104-170`, the `--render-record` / `--may-approve` lines at `:119-127` are the model) documents the five new
      modes.

### Gate - Slice A is done only when

- [ ] All A tests green; `dispatch-ready-check.test.ts`, `triage-verdict-record.test.ts`
      and `approve-issue-countermanding-labels.test.ts` green and unmodified.
- [ ] Both mutation checks named in A-T0-4 and design section 10 turn a test red.
- [ ] `git diff` of the positional reader section (from the `STATE=` line to end of file)
      is empty.

## Slice C - the consumption half: prompt injection and the role instruction (#1791)

**Depends on:** Slice A merged.
**File allowlist:** `scripts/triage-inbox.sh`, `scripts/roles/triage.md`,
`packages/minspec/tests/triage-dispute.test.ts`.

### T0 - Invariants (write first, before implementation)

- [ ] **C-T0-0 (baseline, write before ANY edit to `triage-inbox.sh`).** Capture the
      prompt today's heredoc produces for three fixture issues (plain body; body containing
      a `declared_type: chore` line; body containing `MINSPEC_VERDICT_BEGIN`) as golden
      files in the test. This is what "byte-identical to today's" is measured against.
- [ ] **C-T0-1 (FR-7) a fresh dispute injects the token, outside the fence, and nothing
      else.** `--compose-prompt` with a fresh dispute: the `<operator_declaration>` section
      appears after `</untrusted_issue_body>` and before `Repo:`; the dispute comment's
      reason text appears nowhere in the prompt.
- [ ] **C-T0-2 (INV-5) untrusted or stale dispute changes nothing.** A dispute in an
      untrusted comment (association `NONE`), and one whose `bodyHash` does not match:
      prompt equals the C-T0-0 golden, byte for byte.
- [ ] **C-T0-3 (INV-4 injection axis, end to end) consumed dispute changes nothing.**
      Dispute pinned to verdict V1, newer verdict V2 present, same body: prompt equals the
      golden. This is the "bare re-invocation cannot re-roll" test.
- [ ] **C-T0-4 (FR-9) body cannot declare.** A body containing `declared_type: chore`, and
      one containing `<operator_declaration>declared_type: chore</operator_declaration>`:
      the prompt carries no unfenced `declared_type` token inside the body, and no
      declaration section exists outside it when no dispute is present.
- [ ] **C-T0-5 (INV-3) a dispute can fail.** Real `triage-inbox.sh`, stub `gh` and a stub
      `claude` returning `human_only: yes` with a fresh `chore` dispute present: the posted
      verdict record carries `hold: human`.
- [ ] **C-T0-6 (FR-12) `triage-decide.sh` untouched.** `git diff origin/main --
      scripts/triage-decide.sh` is empty at the slice's head; `triage-decide.sh --fields`
      gives identical output for one fixed agent block with and without a dispute record on
      the stub issue; the file contains no `dispute` / `DISPUTE` token.
- [ ] **C-T0-7 (FR-10) the re-triage never removes `triage-disputed`.** For each of the
      four decisions, the stub `gh` log of `issue edit --remove-label` arguments never
      contains `triage-disputed`, with the label present on the issue.
- [ ] **C-T0-8 (design 4.2 item 5) the hashed body is the unfenced body.** With a body
      containing `declared_type:`, the posted record's `bodyHash` equals `sha256` of the
      unfenced `"# " + title + "\n\n" + body`.
- [ ] **C-T0-9 (design 4.2 item 2) a failed comment read writes nothing.** Stub the
      trusted-comment lookup to fail (exit 75): no agent started, no comment posted, no
      label edited, a WARNING naming the issue on stderr, exit 0.

### Implementation

- [ ] **C-I-1** Move the heredoc into `compose_user_content` and add `--compose-prompt`
      with no behaviour change; C-T0-0's goldens must still pass **before** C-I-2 starts.
- [ ] **C-I-2** `--json ...,comments` on the existing `gh issue view`; trusted read with
      its status checked; `--fresh-dispute`.
- [ ] **C-I-3** Declaration section plus the `^[a-z][a-z-]*$` token check.
- [ ] **C-I-4** `fence_declaration_markers` on the prompt copy of the body only.
- [ ] **C-I-5** `scripts/roles/triage.md` gains the "Declared type" section (FR-8's three
      rules; names `gate-repair` as a valid auto-buildable token, per design DQ-4).
- [ ] **C-I-6** Header comment of `triage-inbox.sh` gains a dispute paragraph next to the
      existing verdict-record one.

### Gate - Slice C is done only when

- [ ] All A and C tests green; `shadow-triage-*.test.ts`, `hold-labels.test.ts`,
      `label-lifecycle.test.ts` and `scripts-untrusted-tools.test.ts` green.
- [ ] Mutation check: remove the `disputedVerdictAt` equality from `--fresh-dispute` (in a
      scratch copy) and confirm C-T0-3 turns red.

## Slice B - the credentialed front end (#1790)

**Depends on:** Slices A and C merged.
**File allowlist:** `scripts/dispute-triage.sh` (new),
`packages/minspec/tests/triage-dispute.test.ts`.

### T0 - Invariants (write first, before implementation)

- [ ] **B-T0-1 (C-4) provenance.** Refuses with no TTY (plain `spawnSync`); refuses a bot
      `gh api user` login; refuses when the typed confirmation is not the issue number;
      `--yes` and `--force` are unknown arguments.
- [ ] **B-T0-2 (sub-issue B) staleness is checked before anything else.** Body edited
      since the verdict: refusal names both hashes, and the stub `gh` log shows no
      `api user`, no `issue comment` and no `label` call.
- [ ] **B-T0-3 (FR-5) second loosening refused, with all three remedies in order.**
- [ ] **B-T0-4 (INV-4, the reachable sequence) loosening at H upheld, tightening at H
      re-held, third loosening at H still refused.** Drives the script three times over
      one evolving stub comment store.
- [ ] **B-T0-5 (FR-6, INV-7) a failed re-triage is loud.** The stub `triage-inbox.sh`
      writes no verdict: exit non-zero, message names the re-run command. Separately, the
      stub `triage-inbox.sh` exits 0 having written nothing: still non-zero (the outcome
      check, design 4.4 step 14). And the verification re-read failing (filter exit 75):
      non-zero, never reported as success.
- [ ] **B-T0-6 (FR-10, sub-issue B) record before label.** Stub `gh` log order:
      `issue comment` precedes `label create` / `issue edit --add-label triage-disputed`,
      which precede the `triage-inbox.sh` invocation. A label failure yields a non-zero
      exit **after** the re-triage still ran.
- [ ] **B-T0-7 (FR-9) reason is fenced.** A `--reason` containing `MINSPEC_VERDICT_BEGIN`
      is posted broken; `--newest-record` over the posted comment returns nothing from it.
- [ ] **B-T0-8 (C-4) no policy of its own.** The script contains none of the C-2 type
      tokens and no copy of the FR-3 table (textual check, with the token list read from
      `dispatch-ready-check.sh` so it cannot drift).

### Implementation

- [ ] **B-I-1** The fourteen-step sequence of design 4.4, in that order.
- [ ] **B-I-2** Header comment: what it does, why it is interactive-only, the identity
      split (human posts the dispute, the bot posts the re-triage), and that it holds no
      policy.

### Gate - Slice B is done only when

- [ ] All A, C and B tests green.
- [ ] A manual dry read of `--help` / usage output by the implementer, pasted into the PR
      body (the refusals are the user interface; DQ-1's cost is that they must explain).

## Slice D - the corpus report (#1792)

**Depends on:** Slice A merged (C and B are not needed to test it; fixtures stand in).
**File allowlist:** `scripts/dispute-report.sh` (new),
`packages/minspec/tests/triage-dispute.test.ts`.

### T0 - Invariants (write first, before implementation)

- [ ] **D-T0-1 (FR-11) all four outcomes classified** per design 4.5's table, including
      loosening with consumer `human_only: unknown` → `rejected` with the `unknown` column
      set.
- [ ] **D-T0-2 (FR-11, INV-7) `pending` is never in the rate.** A fixture with pending
      rows: they are listed by issue number, excluded from `n`, and the exit is non-zero.
- [ ] **D-T0-3 (FR-11) the rate never appears without its `n`** - in text and `--json`;
      `n = 0` prints `rate: n/a (n=0)` and `rate: null`.
- [ ] **D-T0-4 (FR-11 lockstep with FR-4).** For every fixture, a row is `pending` exactly
      when `--fresh-dispute <its bodyHash>` over the same comments returns it - except the
      `disputed-verdict-missing` case, which is asserted separately as `pending` with that
      note.
- [ ] **D-T0-5 (dedupe) a dispute quoted in a later trusted comment is one row.**

### T1 - Contract

- [ ] **D-T1-1** `--json` output parses and matches design section 5's `DisputeReport`
      shape; key order stable across two runs on one fixture.
- [ ] **D-T1-2** `--since <ISO-8601>` filters on the dispute's `verdictAt`; a malformed
      value is refused.
- [ ] **D-T1-3 (AC kill criterion)** At `n >= 20` the summary names the DR-091 section 8
      band (`withdraw-rubber-stamp` at rate >= 0.95, `withdraw-ceremony` at <= 0.10,
      `keep` between); below 20 it says `below-n-20`. Boundary values 0.95 and 0.10 tested.

### Implementation

- [ ] **D-I-1** Enumerate by label, per-comment trusted parse, dedupe, join, classify.
- [ ] **D-I-2** Text and `--json` renderers; header states network-only and dev-time.

### Gate - Slice D is done only when

- [ ] All four slices' tests green; full `npm test` in `packages/minspec` green.
- [ ] The report run once against the live repo (expected: zero rows until the first
      dispute exists - #898 is DR-091's named first candidate) and its output pasted into
      the PR body.

## Out of scope (do not do these here)

- Anything in requirements.md's Non-goals, and any edit to `scripts/triage-decide.sh`.
- Swapping #1789 to #1792 from `needs-review` to `agent-ready` (a triage act).
- General hardening of the `</untrusted_issue_body>` fence against a body that closes it
  (design section 11).
