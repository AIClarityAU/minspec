# Correction: DLG-001 did not make the Clarify selections

Date: 2026-10-31. Issue: #3411 (specs citing delegation DLG-001 for agent-chosen Clarify answers).

## What is wrong

The specs listed below say their Clarify selections were recorded under delegation DLG-001, and DLG-001 made none of them.

## The correct reading

Wherever the clause "under delegation DLG-001 (DR-108, the delegated-approval record)" appears in a listed spec, read it as follows: the selections are the agent's. DLG-001 made none of them, and it covers approval only (spec approval and engineering decision record acceptance, per `.minspec/delegations.json` and DR-108 section 2). Approval of the spec is what ratifies the selections.

The rest of each sentence stays true: no human chose the selections, and they are ratified only by approval of the spec.

## Why the specs were not edited

The approval hash binds each spec's text, so an edit would void its approval. The founder chose this note instead on 2026-10-31. No spec, sidecar or approval file changed.

## Specs affected (24, measured on main at 2026-10-31)

Counted with `git grep -l 'under delegation DLG-001'` over `specs/`, excluding design documents.

- SPEC-203: Decision-shaped human summons - every call for a human says what is wrong, what to look for, what is being asked, and what the agent recommends
- SPEC-204: Found-by trailer on fix commits
- SPEC-208: Repay DR-080's duplication loan with one worktree transport, and close the copy-time gap
- SPEC-209: Every ➡️ item says who may authorise it, and a non-human consumer can read that
- SPEC-210: Witness that an adopter's git hooks are armed
- SPEC-214: ai-review voters are told which DR ids open pull requests already hold, and that choosing the id is the gate's job
- SPEC-215: Constitution mirrors leave out DRAFT entries, and say how many they left out
- SPEC-231: Dead entries in the Claude Code session registry are recognised as dead, and no consumer reads a duplicate sessionId as a conflict
- SPEC-240: `status.orphan-comment` reads the comment run on both sides of `status:`
- SPEC-241: Every docs-lane refusal has an independent second witness in `ready-to-merge`, starting with the governance status transition
- SPEC-242: The identity check reports "could not verify" as UNKNOWN, not as FAIL, and keeps the evidence
- SPEC-243: `checkout_busy()` sees plain working-tree writes and fails closed when any witness cannot be read
- SPEC-245: The issue ranker reads the tier from the trusted triage verdict, not from the ready-class label
- SPEC-246: The issue ranker says how much of its order came from real signal, so a ranker with no input data is never mistaken for a working one
- SPEC-247: Every FATAL rule in the Node validator is either shipped in validate.py or recorded as dev-only
- SPEC-248: Deleting a spec file does not release the owned set its approval signed
- SPEC-249: The spec-gate takes one spec id's verdict from its requirements doc, never from whichever sibling doc carries the strongest approval
- SPEC-250: The identity check decides reachability from what a producer handed over, not from whether it explained a failure
- SPEC-251: A DR flipped to `accepted` must carry a verified acceptance record, or the merge gate says so
- SPEC-252: A separate structural check keeps catching leaked parent-register numbers, now that #3140 fixed the prose-ref boundary
- SPEC-253: git, gh and claude are resolved in one place, and a missing git is reported
- SPEC-254: Drain dispatches do not load project CLAUDE.md and auto-memory ambiently, and a first-call size check makes a regression visible
- SPEC-256: A flat-layout spec with a stale approval, whose literal status is terminal, has an approve path
- SPEC-257: The auto-merge gate reports "armed" only from an observed PR state, and a shepherd stand-down says which of its two causes fired

SPEC-182 (The required `ai-review` check-run is always posted - red if it cannot be computed) was on the issue's list of 25. On main it no longer carries the clause: it already says DLG-001 made none of its selections and covers approval only, so it needs no correction here.

## Follow-up

The issue is #3411. The check that stops a new spec from making this claim is tracked in #3463.
