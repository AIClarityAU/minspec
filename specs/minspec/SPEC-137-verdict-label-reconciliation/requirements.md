---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a verdict record with no matching label is the pipeline's state misdescribing itself
aspects: [triage, drain, label, reconciliation, no-silent-gate, self-healing]
relates_to: [DR-003, DR-066, DR-076, SPEC-062, SPEC-073, SPEC-044]
implements: [scripts/triage-inbox.sh]
affects: [scripts/drain-inbox.sh, scripts/dispatch-ready-check.sh]
---

# MinSpec — Verdict/label reconciliation: a verdict recorded without its label must never strand an issue (Requirements)

> **SPECIFICATION ONLY.** No code is written by the dispatch that produced this. A human
> reads it, resolves **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves
> it before anything is built.

Materializes **[#1295](https://github.com/AIClarityAU/minspec/issues/1295)** — *"a verdict
recorded without its label strands the issue forever — nothing reconciles the pair."*
Related: #983 (label is a stamp of a verdict), #1169 / DR-076 (specify-only dispatch),
#1202 (indistinguishable terminal states). No DR is minted: every choice below is a
same-day-reversible change to shell scripts (DR-359 filter).

## One-Sentence Scope

Make the pair "fresh affirmative verdict record" + "its decided dispatch label" a state the
drain **detects and repairs every cycle**, and make a failed label-apply **durably queryable**,
so a transient `gh label create` / `gh issue edit` failure can no longer strand issues.

## Background (observed, with citations)

- `scripts/triage-inbox.sh` (the "PARENT applies the verdict" block) posts the verdict-record
  comment **first**, then runs `gh issue edit --add-label`. Label creation before it is
  `2>/dev/null || true` (best-effort, "Nothing passes silently").
- 16 issues (#1049 #1029 #1025 #1022 #1021 #1019 #1015 #1013 #1012 #1006 #1004 #1003 #1002
  #993 #992 #988) ended with a record `decision: agent-ready-specify` and no such label; the
  `--add-label` failed loudly (`'agent-ready-specify' not found`) — to stdout of a one-shot run
  only.
- `dispatch-ready-check.sh` then refuses `no-label` — correctly — and nothing revisits.
- Cause of the original label-create failure is **unconfirmed** (transient; not guessed here).
  The defect this spec addresses is the missing reconciliation, which converts *any* transient
  into permanent stranding.

## Root cause (mechanism + missing gate)

Mechanism: record-then-label is two non-atomic writes; a failure between them leaves a
half-applied verdict. Missing gate: nothing compares "has a fresh verdict" against "has the
matching label", so the loud per-issue failure never becomes a fleet-level signal. Per-issue
reasoning ("it fails loudly") was correct; per-fleet it was not (constitution invariant 2 —
no silent gate: a loud-to-stdout signal that nobody reads is not a visible failure).

## Functional Requirements

- **FR-1 — Detect.** A deterministic predicate classifies an open issue as *stranded* when:
  (a) it has a trusted, newest verdict record (same selection as dispatch:
  `--trusted-comment-bodies` + `--newest-record`) whose `bodyHash` matches the current body
  (fresh), (b) the record's `decision` is an affirmative dispatch decision
  (`agent-ready` / `agent-ready-specify`), and (c) the issue lacks that decision's label.
  Stale records (body edited) are NOT stranded — they need re-triage, not repair.
- **FR-2 — Reconcile.** The drain, each cycle, enumerates stranded issues and repairs each by
  applying exactly the labels the record already decided (`role:<role>`, the decision label,
  the `hold:*` label) using the same superseded-label clearing as `triage-inbox.sh`. The repair
  **reads** the verdict; it never computes a new one and never grants anything the record did
  not (no approval is minted; `approve-on-label.sh` fires only on `agent-ready`, so a repaired
  `agent-ready` decision is subject to the same existing path as a first-time apply — see D2).
- **FR-3 — Do not launder.** The repair MUST NOT override a countermanding label
  (`agent-quarantined`, `needs-human-review`, `human-only`, `agent-done`, `agent-escalated`,
  `agent-running`) or a closed state; those issues are skipped and reported, not repaired.
- **FR-4 — Durable failure marker.** When `triage-inbox.sh`'s `--add-label` fails (or a
  reconcile repair fails), the issue is labelled `needs-triage-retry` (created idempotently,
  failure of *that* write surfaced loudly on stderr and in the exit status) so a stranded issue
  is queryable without log forensics. A successful apply/repair clears the marker.
- **FR-5 — Ensure labels up front.** The dispatch-label set (`agent-ready`,
  `agent-ready-specify`, `needs-triage-retry`, and the `hold:*` reasons) is created at
  install/scaffold time and once at the start of each drain cycle, so creation can no longer
  race the add. The lazy per-verdict create stays as a fallback.
- **FR-6 — Fail closed and visible.** If the reconcile sweep cannot enumerate (API error,
  rate limit) it reports that loudly and the cycle's summary says "reconcile: NOT RUN" — an
  unrun sweep must not read as "0 stranded" (invariant 2). Counts (found / repaired / skipped /
  failed) are always printed.
- **FR-7 — Idempotent and bounded.** Repeated runs converge; a per-cycle cap and the existing
  list-limit discipline apply, and hitting the cap is reported (never silent truncation).

## Acceptance Criteria

- AC-1: Fixture issue with fresh trusted record `agent-ready-specify`, label absent → one
  sweep applies `role:*`, `agent-ready-specify`, `hold:*`; `dispatch-ready-check.sh` then passes.
- AC-2: Same fixture with body edited after the record → untouched, reported as stale.
- AC-3: Same fixture carrying `agent-quarantined` (or closed) → untouched, reported skipped.
- AC-4: Record forged by an untrusted author → ignored (not repaired).
- AC-5: Simulated `--add-label` failure in `triage-inbox.sh` → exit non-zero **and**
  `needs-triage-retry` present; next sweep repairs and removes it.
- AC-6: Simulated enumeration failure → "reconcile: NOT RUN" printed, non-zero status path
  exercised; never "0 stranded".
- AC-7: Second sweep on a repaired fleet is a no-op.
- AC-8: Tests assert on behaviour (label set after the run), not on source text.

## Invariants (must not break)

- INV-1: Verdict is never created by the repair, only read; label stays a stamp of a verdict (#983).
- INV-2: No silent gate — every failure path is visible and durable.
- INV-3: No human approval is minted by an agent; repair does not touch approval state.
- INV-4: Offline-capable core / blast radius — the sweep runs only in repos with `.minspec/`
  (constitution invariants 1 and 3); no new network calls beyond the existing `gh` use of the drain.
- INV-5: One owner per file — `triage-inbox.sh` is owned here; edits to `drain-inbox.sh` /
  `dispatch-ready-check.sh` are modifications of files owned by other specs.

## Out of scope

Diagnosing why the original label create failed (unconfirmed); changing verdict semantics;
re-triaging stale records; the already-repaired 16 issues.

## Decisions needed (Clarify)

- **D1 — Where does the sweep live?** (a) **(rec)** a step in `drain-inbox.sh` each cycle:
  reuses its enumeration, self-heals continuously; cost: couples reconcile to a drain that may
  be paused/dead (then nothing heals). (b) a separate script on the GH Actions schedule
  (SPEC-062): independent of any session; cost: a new workflow file and token surface.
- **D2 — May the sweep repair an `agent-ready` (implementation) decision, or only
  `agent-ready-specify`?** (a) **(rec)** both: the record already authorised it, and a
  half-applied `agent-ready` strands just the same; cost: the sweep becomes a second writer of
  the implement-authorising label, widening what must be audited. (b) specify-only, escalate
  `agent-ready` strandings to `needs-triage-retry` for a human; cost: leaves the most valuable
  class unhealed.
- **D3 — Marker name.** `needs-triage-retry` (as the issue suggests) vs reusing an existing
  label; the former is **(rec)** for queryability, at the cost of one more label to document.
