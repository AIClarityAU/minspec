---
id: SPEC-318
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — the drain's unattended queue discipline
aspects: [drain, dispatch, escalation, blockers, fail-closed, observability]
depends_on: []
relates_to: ["#3394", "#1202", "#2421", "#3326", "#2641"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  `scripts/dispatch-issue.sh` (escalation write), `scripts/drain-inbox.sh` (release pass),
  one new judge under `scripts/lib/`, and new tests. None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-318: An escalation records why it stopped, and a transient one releases itself

> **This is a SPECIFICATION ONLY.** Written for issue
> [#3394](https://github.com/AIClarityAU/minspec/issues/3394). Nothing is built until this spec is
> approved, after [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved. No decision
> record is minted: every choice here is reversible in under a day (a label write and a comment).

## In plain terms

When the dispatcher gives up on an issue it labels it `agent-escalated` + `needs-human-review` and
the issue never comes back unless a human runs `scripts/approve-issue.sh <N>` or re-triages it.
Two defects follow. (1) The reason the agent gave (`ESCALATE: ...`) lives only in the drain log
and agent log, so weeks later nobody can tell "blocked on an unmerged task" from "too hard".
(2) An escalation whose cause was a named unmerged blocker is never released when the blocker
merges. This spec: record the reason in an issue comment at the moment of labelling, and when the
reason is a named blocker, record it in the form the blocker gate already reads and let the drain
release the issue once every blocker has merged.

## Measured state (2026-10-31, from the issue; Plan re-measures)

- 164 open issues carry `agent-escalated`. Of the newest 40, 11 are SPEC-136 build tasks that
  stopped only on unmerged blockers (#3298, #3309). 28 of the 40 have no comment and no surviving
  `.agent.log`, so their reason is unrecoverable.
- Only `scripts/approve-issue.sh:274` and `scripts/triage-inbox.sh:288` remove `agent-escalated`;
  `scripts/drain-inbox.sh` never mentions it.
- The ready gate refuses `agent-escalated` / `needs-human-review` (`scripts/dispatch-ready-check.sh:688`).
- The blocker gate (#3326, `dispatch-ready-check.sh:~800`) reads `Blocked by #N` from the **issue
  body** via `scripts/open-blockers.ts`, which reuses the parser in `scripts/lib/issue-rank.ts`.
- The escalation write is at `scripts/dispatch-issue.sh:~2579`; `ESCALATE:` is detected at `:2549`
  (first line is the reason). The crash path (`:~3073`) is a separate producer (#1202).

## Functional requirements

- **FR1 — Reason comment.** At the moment `dispatch-issue.sh` sets `agent-escalated`, it posts one
  issue comment carrying the `ESCALATE:` reason line (bounded length, untrusted-text-safe: rendered
  in a code span, `@` mentions neutralised), the role and model, and a stable machine marker
  (`<!-- minspec:escalation reason-class=... -->`). One comment per escalation event; a re-run
  does not stack duplicates for the same dispatch.
- **FR2 — Fail visibly.** If the comment cannot be posted, the label write still happens (the
  escalation must not be lost) but the dispatcher logs a visible warning naming the issue and
  writes the reason to the drain log. The comment is never the only record, and its failure is
  never swallowed (constitution invariant 2).
- **FR3 — Blocker extraction.** The stop reason is classified `blocked` only when the `ESCALATE:`
  line names one or more issue numbers as unmerged blockers, matched by a deterministic parser
  (no model). Anything else classifies `other`. An ambiguous line is `other`.
- **FR4 — Gate-readable blocker record.** For a `blocked` escalation the dispatcher also records
  `Blocked by #N[, #M]` where `open-blockers.ts` will read it (see Decision 1 for where). The
  record must round-trip through the existing parser; the gate gets no second parser.
- **FR5 — Automatic release.** A drain pass finds issues wearing `agent-escalated` whose latest
  escalation comment is `reason-class=blocked`, and for which every recorded blocker is **merged
  or closed as completed**. For each it removes `agent-escalated` and `needs-human-review` and
  restores `agent-ready`, with a comment saying which blockers cleared. The next dispatch still
  passes through every existing gate.
- **FR6 — Fail closed on unknown.** If any blocker's state cannot be read (deleted, transferred,
  API error), or was closed *not planned*, the issue is not released and a visible note is logged.
  No blockers parsed means no release.
- **FR7 — Human labels win.** Release applies only to escalations this mechanism marked
  `blocked`. An issue also carrying `needs-review`, `needs-info`, `agent-quarantined`,
  `agent-crashed`, or a human-only hold is never released. Crash-path escalations (#1202) and
  `other` reasons are never auto-released.
- **FR8 — Bounded.** An issue is auto-released at most once per escalation marker; if it escalates
  again with the same blockers cleared, it stays escalated for a human (no release loop).
- **FR9 — Opt-out and scope.** Behaviour is a no-op where `.minspec/` is absent (invariant 3) and
  can be disabled with an env switch for the release pass, mirroring `MINSPEC_ESCALATE_RETRY_OFF`.
- **FR10 — Backlog.** The 164 existing escalations are not auto-released (no reason recorded).
  Whether to backfill is Decision 2.

## Acceptance criteria

- AC1: Dispatch an issue whose agent emits `ESCALATE: blocked on unmerged #3298` → the issue gets
  `agent-escalated` AND one comment containing the reason and the marker (FR1).
- AC2: Make the comment post fail → label still set, warning printed, reason in the drain log (FR2).
- AC3: Reason names #3298 → a `Blocked by #3298` line exists where `open-blockers.ts` returns 3298
  for the issue (FR4); reason "tests flaky" → no such line (FR3).
- AC4: Blocker #3298 merges → next drain pass clears both labels, restores `agent-ready`, comments
  (FR5). With one of two blockers still open → no change.
- AC5: Blocker unreadable or closed not-planned → no release, note logged (FR6).
- AC6: Issue with `needs-review`, or a crash-path escalation, or an `other` reason → never released (FR7).
- AC7: Second escalation after a release with blockers already clear → stays escalated (FR8).
- AC8: A mutation test: delete the release judge's "every blocker merged" check and AC4's
  partial-blocker case must fail.

## Invariants this must not break

1. Offline-first / no network without consent: only the dev-time dispatch scripts touch GitHub;
   nothing ships in the extension (invariant 1).
2. No silent gate: comment failure and unreadable blockers are visible; unknown blocks release (invariant 2).
3. Blast radius: inert without `.minspec/` (invariant 3).
4. The ready gate (`dispatch-ready-check.sh`) still refuses an escalated issue; release removes the
   label rather than teaching the gate to skip it.
5. #2641: escalation still replaces `agent-ready`; release is the only path that restores it.
6. The blocker parser stays single-sourced in `scripts/lib/issue-rank.ts`.
7. Untrusted text (the agent's reason) never reaches a shell or a mention unescaped.

## Out of scope

Quota-reset reconsideration (#2421); splitting crash from reasoned escalation (#1202); retry across
models (`escalate_next_action`); backfilling reasons for existing issues (Decision 2).

## Decisions needed (Clarify)

All 4 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

1. **Where does the gate-readable `Blocked by` live?** The gate reads the issue body only.
   - **(a) Edit the issue body (rec)** — append a marked `Blocked by #N` block; the gate works
     unchanged. Cost: the dispatcher rewrites a human-visible body; needs a marker so it is idempotent and removable.
   - **(b) Teach `open-blockers.ts` to also read marked escalation comments** — body stays untouched.
     Cost: widens a gate parser to untrusted comment text, and fixes the 11 SPEC-136 tasks whose
     blockers sit in comments only if comments generally become readable (broader change).

   **Recorded selection: Option (a),** edit the issue body with a marked, idempotent `Blocked by #N` block. An agent session copied this document's (rec) option; no human chose this item.
2. **Backfill of the 164 existing escalations?**
   - **(a) None (rec)** — the issue states no reason is recorded; guessing is the failure being fixed.
     Cost: the 11 SPEC-136 tasks stay stuck until someone re-triages or approves them.
   - **(b) One-off script** releasing escalations whose *drain log* reason names blockers that merged.
     Cost: logs are partial; mis-release risk, and it is one-shot code to maintain.

   **Recorded selection: Option (a),** no backfill of existing escalations. An agent session copied this document's (rec) option; no human chose this item.
3. **Release target state.** Restore `agent-ready` directly **(rec)** — cost: skips a fresh triage
   verdict made against a possibly stale body; or send back through `triage-inbox.sh`, which costs a
   triage run per release but re-validates tier and scope.

   **Recorded selection: the recommended option,** restore `agent-ready` directly. An agent session copied this document's (rec) option; no human chose this item.
4. **Who counts as "cleared"?** Merged PR / closed-completed only **(rec)**; cost: a blocker closed
   by a human as superseded needs manual release. Alternative: any close, which risks releasing on a dropped prerequisite.

   **Recorded selection: the recommended option,** merged PR or closed-completed only counts as cleared. An agent session copied this document's (rec) option; no human chose this item.
