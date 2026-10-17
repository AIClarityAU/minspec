---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - the signpost must see the queue the human actually has
relates_to: [SPEC-012, SPEC-076, SPEC-085, DR-050, DR-071, DR-070, "#1005", "#1002", "#783"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Held-Issue Visibility in the Signpost and Backlog (Requirements)

**Issue:** #1005 (signpost is blind to the needs-review backlog)
**Design rests on:** DR-070 (hold labels / `needs-review` gate; its `hold:human|tier|info|unknown` vocabulary is the one #1002 materialises). **Extends:** SPEC-012 (next-task resolver). **Constrained by:** SPEC-076 (headless signpost reader; FR-8 — no network call), SPEC-085 (backlog-fetch consent, `implementing`), DR-050 / DR-071 (network-consent model). #783 is related prior work on the same signpost surface.

## Context

The signpost (`commands/next-task.ts` → `resolveNextTask`) and the backlog view
(`views/backlog-view.ts`) group issues by lifecycle label (inbox / triaged / agent-ready / wip /
done). Neither knows `needs-review`: a grep of `packages/minspec/src/lib/backlog.ts` for
`needs-review` returns nothing. The issue reports 287 held issues, 72% of open — the human's
largest queue is invisible in the tool meant to say what to do next. Once #1002 lands, each held
issue also carries one reason label: `hold:human`, `hold:tier`, `hold:info`, `hold:unknown`.

## Scope sentence

Show how many open issues are held (`needs-review`), and — when present — how they split by
`hold:*` reason, in the backlog view and as a signpost line, using the data the backlog already
loads.

## Functional requirements

- **FR-1 Held group in backlog.** The backlog view gains a "Needs review (held)" group listing
  open issues labelled `needs-review`, with the count in the group label. An issue in it MUST NOT
  also appear in the agent-ready group (it is not dispatchable while held).
- **FR-2 Reason breakdown.** Where issues carry `hold:*` labels, the group shows sub-counts per
  reason (`human N · tier N · info N · unknown N`) and a held issue with no `hold:*` label counts
  as `unlabelled`. Absent #1002, the breakdown is simply omitted (only the total shows).
- **FR-3 Signpost line.** The signpost surfaces the held count (and breakdown) as an additional
  informational line. It MUST NOT itself trigger a network call: SPEC-076 FR-8 specifies the
  signpost reader makes none, so the line renders only from data already loaded under the
  backlog's consent model (SPEC-085, DR-050, DR-071) and shows "held count unavailable" (FR-6)
  when none is loaded. It MUST NOT change which single next task `resolveNextTask` returns
  (SPEC-012 ordering is unchanged); held issues are context, not a task.
- **FR-4 Pure core.** Counting is a pure function in `@aiclarity/shared` (no vscode, no network)
  taking a list of `{labels}` and returning `{total, byReason}`; the extension only renders it.
- **FR-5 Truthful about coverage.** `fetchIssues` defaults to `--limit 100`; with 287 held issues
  a count over 100 rows would be silently wrong. The display MUST either count over the full
  open set or say it is partial (e.g. "100+ loaded"). It MUST NOT show a truncated count as the
  total.
- **FR-6 Visible failure.** If the issue source is unavailable (no `gh`, no auth, offline), the
  held line says "held count unavailable" rather than showing 0 or hiding (constitution
  invariant 2 — a missing witness is visible, not silently zero).
- **FR-7 Non-adopters.** Nothing renders and nothing is read in a workspace without `.minspec/`
  (invariant 3).

## Acceptance criteria

- AC-1: given issues {A: needs-review+hold:tier, B: needs-review+hold:human, C: needs-review, D: agent-ready}, counter returns total 3, byReason {tier:1, human:1, unlabelled:1}.
- AC-2: backlog view renders held group with count 3 and D only under Agent-Ready.
- AC-3: `resolveNextTask` output is byte-identical with and without held issues present.
- AC-4: with 287 held issues in the source and a 100-row page, the display never states 100 as the total.
- AC-5: source failure renders "unavailable", not "0".
- AC-6: no `hold:*` labels → total only, no breakdown, no error.

## Invariants this must not break

- Invariant 1 (offline, no network without consent) — governed by DR-050 (user's own `gh` on
  explicit consent) and DR-071 (standing consent via a named setting); SPEC-085 is fixing the
  backlog's unprompted fetch. This spec adds no new network surface and must follow whatever
  consent gate SPEC-085 lands. See Decision D-1.
- Invariant 2 — FR-5/FR-6 exist to satisfy it.
- Invariant 3 — FR-7.
- SPEC-012 resolver determinism (FR-3 / AC-3).

## Decisions needed (Clarify)

**D-1 Data source — the issue says "reads local state, no network", but the labels live on GitHub.**
The only existing source is `fetchIssues`, which shells out to `gh issue list` (network, 15 s
timeout). A true local read needs a local mirror that does not exist today.
- (a) **Reuse the backlog's existing `gh` fetch (rec)** — no new network surface, one fetch feeds
  both views, and it inherits the SPEC-085 / DR-050 / DR-071 consent gate; the signpost reader
  (SPEC-076 FR-8, no network) only consumes the already-fetched result, never fetches itself. Cost: the signpost line is only as offline as the backlog view already is, which
  contradicts the issue's "Tier-0, no network" wording; the held line shows "unavailable" offline.
- (b) **Local mirror file** (e.g. `.minspec/` issue snapshot written by a dispatcher/script) — truly
  offline reads. Cost: a new producer, staleness handling, and a new artifact to keep honest;
  larger scope (likely T4).
- (c) **Both** — mirror when present, `gh` otherwise. Cost: two code paths to keep equivalent.

**D-2 Full count vs. page.** (FR-5) (a) fetch with a higher limit / count query for the held label
**(rec)** — correct total; costs a larger payload per refresh. (b) keep the page and display
"100+" — cheap; costs an uninformative number for exactly the 287 case that motivated this.

**D-3 Sequencing with #1002.** Ship the total now and the breakdown when `hold:*` labels exist
**(rec)** — useful immediately; costs a follow-up touch on the same view. Alternative: block on #1002 — one change; costs leaving the queue invisible meanwhile.

**D-4 Click-through.** Should the held group open the held issue list on GitHub, or stay read-only? Recommended: read-only in this slice (rec) — smaller; costs a dead-end for the user.

## Follow-ups (tracked)

- #1002 (hold reasons) — breakdown depends on it; none new filed.
