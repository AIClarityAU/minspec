---
id: SPEC-273
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a founder's sign-off must keep meaning the text he signed
aspects: [dispatch, specify-only, approval, no-silent-gate, offline]
depends_on: []
relates_to: ["#2618", "#1698", "#2615", "#2303", "#2617", "#2185", "#1169", "DR-076", "SPEC-075"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D3.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-273: A specify-only dispatch never rewrites a spec that is approved or awaiting approval

> **This is a SPECIFICATION ONLY.** Written for issue #2618. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

A Specify-only dispatch (DR-076 / #1169, "Specify phase only") tells the agent to "write, or
refresh" the spec for the issue and to update an existing spec rather than mint a second id
(`scripts/dispatch-issue.sh`, the specify-only prompt: "Write, or refresh, the spec" and "If a
spec for this issue already exists, UPDATE it"). An approval is bound to the spec's canonical
hash (`packages/minspec/src/lib/approval.ts`, `resolveStatus`: `record.specHash === currentHash`
else `stale`). So when the existing spec is one the founder has signed, or is about to sign, the
instruction rewrites the text under his signature. The dispatcher never asks which case it is in.

## Measured instance (from the issue, not re-verified here)

SPEC-075 merged as #2098 (2026-09-30). #1698 was dispatched again; the result #2303 changed
that spec by +287/-21 lines. The founder then approved the text on `main` three times
(#2311, #2344, #2385). Had #2303 merged, each approval would have read stale. #2617 had to
consolidate one text to approve once. #1698 is still open and labelled `hold:specify`, so the
next specify-only dispatch of it would update SPEC-075 in place again. Whether any other caller
or review step already catches this is **unverified**: I read the one script, not every caller.

## Root cause (mechanism + missing gate)

Mechanism: the specify-only prompt's "update, do not mint" rule has no precondition on the
existing spec's approval state. Missing gate: the dispatcher decides "spec exists" only by
leaving it to the agent; no deterministic step reads the approval sidecar
(`.minspec/approvals/<spec path>.json`) or open approval pull requests before launching.

## Requirements

- **FR-1 Find the existing spec deterministically.** Before launching a specify-only agent the
  dispatcher resolves the issue's existing spec(s) from the repo (a spec whose `relates_to`
  or body names `#N`; exact rule is Decision D1) and records the result.
- **FR-2 Classify its approval state.** For each such spec, the dispatcher computes one of:
  `none` (no sidecar), `approved` (a sidecar exists on the base branch, whether or not the hash
  currently matches), `in-flight` (an open pull request, or an uncommitted/unmerged sidecar for
  that spec path, exists), or `stale-approved` (sidecar present, hash mismatched).
- **FR-3 Refuse, visibly, when not `none`.** For `approved`, `stale-approved` or `in-flight`,
  the dispatcher does not start the agent. It exits non-zero with a message naming the spec,
  the state, and the evidence (sidecar path or PR number), and posts the same on the issue.
  It never falls through to the in-place update.
- **FR-4 Fail closed on an unreadable witness.** If the sidecar read or the open-PR query
  errors, the dispatch refuses with the error shown; it does not read "could not check" as
  "nothing in flight" (constitution invariant 2, no silent gate). The offline case is
  decided in D3.
- **FR-5 The prompt matches the gate.** The specify-only prompt states that an approved or
  in-flight spec is not to be edited, and names the two legitimate outcomes: a spec of its own
  for the remaining scope, or a human-authorised amendment (D2).
- **FR-6 Human override is explicit and logged.** A named override (an env var, in the style
  of `MINSPEC_ALLOW_STALE`) lets the founder authorise an amendment of an approved spec for
  one dispatch; it prints a loud warning and records itself in the issue comment. Not set by
  any automated path.
- **FR-7 No change for `none`.** A spec with no approval and nothing in flight is refreshed
  in place exactly as today.
- **FR-8 One shared predicate.** The approval-state check is one function reused by every
  caller (drain, direct dispatch, triage), not a copy per script.

## Acceptance criteria

- **AC-1** Issue whose spec has a committed sidecar -> dispatch refuses, no agent started,
  message cites the sidecar path. (Replays the #1698 / SPEC-075 case.)
- **AC-2** Issue whose spec has only an open approval PR (no sidecar on base) -> refuses,
  message cites the PR number.
- **AC-3** Sidecar present but hash mismatched -> refuses as `stale-approved`.
- **AC-4** Issue with no existing spec, or an existing spec with no sidecar and no open PR ->
  dispatches as today; prompt unchanged apart from FR-5 wording.
- **AC-5** Open-PR query fails -> refuses with the error text, not a silent pass.
- **AC-6** Override set -> proceeds with a warning and the override is named in the issue comment.
- **AC-7** Each refusal case has a test that fails against today's script (tests first at Implement).

## Invariants this change must not break

- Offline-first (invariant 1): the committed-sidecar check needs no network; only the open-PR
  witness does, and its absence is handled per D3, never by a silent pass.
- No silent gate (invariant 2): FR-4.
- Blast radius (invariant 3): dispatch scripts are this repo's dev tooling, not shipped to
  adopters; nothing here changes extension behaviour in an installed project.
- The DR-076 scope guard (`specify_scope_stray`) is unchanged; this is an earlier, separate gate.

## Out of scope

Resolving #1698's remaining scope (tracked as #2615 for the refresh half), and the duplicate
SPEC-076 id fault (#2185), which is the opposite error (a second id minted where one existed).

## Decisions needed (Clarify)

- **D1 How is "the issue's existing spec" found?**
  - (a) **(rec)** A spec whose frontmatter `relates_to` lists `#N`. Cheap, deterministic.
    Cost: a spec that cites the issue only in its body is missed, so the gate passes it.
  - (b) Also scan spec bodies for `#N`. Catches more. Cost: false positives on specs that
    merely mention the issue, refusing dispatches that were safe.
- **D2 What does a refusal hand the human?**
  - (a) **(rec)** The issue keeps `hold:specify`; the comment names the spec and offers two
    paths: new spec id for the remaining scope, or the FR-6 override. Cost: an issue that truly
    needs the approved spec amended waits for a human to say so.
  - (b) Auto-mint a new spec id for the remaining scope. Cost: this is the #2185 duplicate-claim
    fault on the other side; no human sees the split.
- **D3 Behaviour when the open-PR query cannot run (offline, no token)?**
  - (a) **(rec)** Refuse, naming the missing witness. Honest and fail-closed. Cost: an offline
    dispatch of any issue with an existing spec is blocked.
  - (b) Check the committed sidecar and local branches only, and warn that PRs were not checked.
    Cost: an approval in an open PR is invisible, which is the very case the issue calls out.

## Follow-ups (tracked)

None beyond #2615 and #2185 above.
