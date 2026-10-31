---
id: SPEC-292
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - one place an agent and a reviewer read "what is allowed here"
aspects: [harness, scaffold, dispatch, ai-review, trust-boundary, no-silent-gate, offline, token-cost]
depends_on: []
relates_to: ["#2985", "#912", "#2225", "SPEC-254", "DR-011", "DR-015", "DR-074", "DR-079", "DR-106", "DR-109"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D6.
phases:
  specify: in-progress
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-292: One repo-level policy file that every agent prompt and every AI review loads, and that points rather than copies

> **This is a SPECIFICATION ONLY.** Written for issue #2985 (queue item cl1, from the
> 2026-10-20 competitive-landscape research). Nothing is built until a human reads it,
> resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

An agent working in this repo, and the AI review panel judging its pull request, should be
reading the same rulebook. Today they are not. Each surface reads a different subset of
CLAUDE.md, AGENTS.md, the constitution, the decision records and the role files, and most of
that reading is a prose instruction ("Read CLAUDE.md") that the model may or may not follow.
This spec adds one small file per MinSpec repo that lists where the rules live, and has the
dispatch prompt and the review prompt load it deterministically - so "what is allowed here"
is one thing to read and one thing to check against.

## Current state (observed, with citations)

Checked on this branch's base, 2026-10-28:

- **Dispatch.** The role file goes in as the system prompt
  (`scripts/dispatch-issue.sh:1180`, `--system-prompt-file "$ROLE_FILE"`). The rules reach the
  agent only through prose in the user prompt: "Read CLAUDE.md for invariants"
  (`scripts/dispatch-issue.sh:1368`) and "Read CLAUDE.md for invariants. Read AGENTS.md for
  task intake rules." (`scripts/dispatch-issue.sh:1432`). Nothing checks the agent did so.
- **Review.** Each voter's system prompt is its role file only
  (`scripts/review-branch.sh:298`, `:317`). The user content is the defanged diff plus an
  optional approval-provenance block (`scripts/review-branch.sh:152-182`). No policy, no
  constitution, no DR index is loaded. A voter holds `Read`/`Glob`/`Grep` and may open
  CLAUDE.md on its own initiative, which is model-trusted, not a load.
- **Trust boundary in CI.** The ai-review workflow checks out the BASE commit, so every script
  and role file it runs is the base version and a pull request cannot rewrite its own judge
  (`.github/workflows/ai-review.yml:276-287`). A file read from the working directory in that
  job is therefore base content. A local run of `review-branch.sh` from a dispatch worktree is
  NOT on the base: its working directory is the head.
- **Adopter repos.** "MinSpec: Initialize SDD Structure" (`packages/minspec/package.json:68-69`;
  there is no `minspec init` shell command - the issue's wording means this palette command)
  scaffolds CLAUDE.md, AGENTS.md and `.minspec/constitution.md`
  (`packages/minspec/src/lib/template-registry.ts:72-75`) and the CI review stack, including
  `review-branch.sh` and the four voter role files
  (`packages/minspec/src/lib/ci-review-templates.ts:2454`, `:4278-4418`). `dispatch-issue.sh`
  is dev-time machinery of this monorepo and is not scaffolded (DR-015). In an adopter repo the
  only "agent prompt" MinSpec influences is the harness file the user's own agent reads
  ambiently (CLAUDE.md / AGENTS.md).
- **Existing copies.** CLAUDE.md and AGENTS.md each already restate the constitution's
  invariant lead sentences (`AGENTS.md` "Key Invariants"; `CLAUDE.md` "Invariants"). Sizes on
  this repo: constitution 9,749 bytes, CLAUDE.md 20,420, AGENTS.md 10,454, `.cursorrules` 6,087.

**Root-cause framing (for the reviewer, not a fix claim).** The gap is two mechanisms: rules
reach agents by *prose instruction* rather than by *load*, and the review prompt has *no*
policy input at all. The missing gate is any test that asserts what a prompt actually
contains.

## Functional requirements

- **FR-1 One file, fixed path.** Each MinSpec-managed repo has exactly one policy file at the
  path chosen in D1. "MinSpec: Initialize SDD Structure" scaffolds it; harness refresh keeps
  its MinSpec-managed section current inside DR-011 markers and never touches text outside the
  markers.
- **FR-2 Points, does not copy.** The managed section is an index of the authoritative
  sources - the constitution, the DR index, the human-owned / never-auto-merge path classes,
  the required gates - each named by repo-relative path with a one-line statement of what it
  governs. It MUST NOT restate the text of any constitution invariant or principle. Whether a
  repo-local rule section is allowed is D2.
- **FR-3 No-duplication gate.** A deterministic, offline check (run by `npm run validate` in
  this repo and by the scaffolded validator in adopters) fails, visibly and with the offending
  line, when the policy file contains a constitution invariant's lead sentence or an
  equivalent verbatim span. The overlap rule (exact lead sentence, or an n-word shingle
  threshold) is fixed at Plan; it must catch a pasted invariant and must not fire on a
  path-plus-one-line pointer.
- **FR-4 Review loads it, from the trusted base.** `review-branch.sh` embeds the policy file's
  content in every voter's prompt as a separate block labelled trusted and repository-supplied,
  distinct from `<untrusted_diff>`. The content is read from the BASE ref (`git show
  <base>:<path>` or equivalent), never from the head or the working tree, so a pull request
  that edits the policy is reviewed against the old policy. Whether pointed-to files are also
  inlined is D3.
- **FR-5 Dispatch loads it.** Every agent prompt in scope (D4) embeds the policy file content
  directly in the prompt, replacing the "Read CLAUDE.md for invariants" instruction as the
  carrier of the rules. The on-demand read stays available (SPEC-254 FR-5 keeps CLAUDE.md out
  of the ambient load; this spec does not undo that).
- **FR-6 A test proves both load.** A test assembles the review prompt and the dispatch prompt
  against a fixture policy file carrying a unique sentinel and asserts the sentinel is present
  in each. Removing the load (a mutant) turns the test red. A second test changes the policy on
  the head only and asserts the review prompt carries the base sentinel, not the head one. The
  test reads the assembled prompt (for review, through a print mode alongside the existing
  `--print-input`, `scripts/review-branch.sh:19-25`), never a grep of script source text.
- **FR-7 Missing or unreadable policy never passes silently.** If the policy file is absent
  or unreadable at the base, the review either fails closed or proceeds with a visible notice
  in the posted verdict, per D6. It never silently reviews without it. Same for dispatch: a
  missing file is logged and surfaced, never an empty block with no trace.
- **FR-8 Adopter parity.** The scaffolded copy of `review-branch.sh` is regenerated
  (`scripts/gen-ci-templates.mjs`) so adopters get FR-4 and FR-7. In adopter repos the
  CLAUDE.md and AGENTS.md managed sections gain one pointer line to the policy file, so a
  user's own agent reaches it from the file it already reads.
- **FR-9 Size ceiling.** The policy file content that FR-4/FR-5 embed has a byte ceiling
  checked by the FR-3 validator; over the ceiling fails visibly. Rationale: the review cost
  multiplies by voters times pushes (DR-109), so a growing policy file is a growing tax.
- **FR-10 Human-owned.** The policy file is in the never-auto-merge set, so an agent cannot
  weaken the rules it is judged by and self-merge. With D1 (a) this is already true (all of
  `.minspec/` is withheld, `scripts/dispatch-issue.sh:370-375`); with D1 (b) or (c) the file
  must be added explicitly.
- **FR-11 Adopting decision record.** At Plan, once D1-D3 are resolved, a decision record
  names the file, its path and its content rule (the issue requires the file be "named in the
  decision record that adopts it"). It is a scaffolded path in every adopter repo, which cannot
  be undone in under a day. Its number is taken from the DR collision gate at that time.

## Invariants (must not break)

- **Offline core (constitution invariant 1).** Scaffolding, refresh, the FR-3 check and the
  prompt assembly make no network call.
- **No silent gate (invariant 2).** The FR-3 gate, the FR-9 ceiling and FR-7 all fail visibly;
  no load is written with a swallowed error. FR-6 is the second witness that the load
  happens.
- **Blast radius (invariant 3).** The file is written only into a repo that opted in
  (`.minspec/` present); no machine-wide or user-level file is touched.
- **Review trust boundary.** The untrusted diff still cannot change what judges it: the policy
  comes from the base, and the policy block is separate from and never inside
  `<untrusted_diff>`. The existing delimiter defanging (`scripts/review-branch.sh:100-115`)
  extends to the new block's tag.
- **DR-079 verdict contract** unchanged: voters still return the schema object.
- **Subscription billing** unchanged; no `ANTHROPIC_API_KEY` requirement added.

## Acceptance criteria

- **AC-1** A fresh "MinSpec: Initialize SDD Structure" on an empty repo writes the policy file
  at the D1 path, and its managed section passes FR-3.
- **AC-2** Pasting a constitution invariant lead sentence into the policy file makes
  `npm run validate` fail and name the line; a pointer line does not.
- **AC-3** The FR-6 tests pass, and fail under the remove-the-load mutant for each of review
  and dispatch.
- **AC-4** A pull request that edits only the policy file is reviewed with the base policy in
  the prompt (FR-6 second test).
- **AC-5** Deleting the policy file produces the D6 outcome, visibly, in the review output.
- **AC-6** A policy file over the FR-9 ceiling fails validation visibly.
- **AC-7** `ci-stack-portability` stays green: the scaffolded `review-branch.sh` is
  byte-identical to the repo's own.

## Decisions needed (Clarify)

All 6 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

**D1 - Which file is the policy file?**
- **(a) (rec) A new `.minspec/policy.md`.** Sits under the opt-in marker, is already in the
  never-auto-merge set (FR-10 free), and starts empty of copied text, so FR-2 holds from day
  one. Cost: it is not a cross-tool convention, so other agents find it only through the FR-8
  pointer lines; it adds one more file to a set the issue complains is already spread out.
- (b) Designate the existing `AGENTS.md`. A cross-tool convention many agents already read,
  and already scaffolded. Cost: AGENTS.md today copies the invariant lead sentences and the
  tier guide, so it fails FR-2 until rewritten, and it is a shared harness file users edit
  freely, which makes a strict content gate on it intrusive.
- (c) A new top-level `POLICY.md`. Visible at the root. Cost: outside `.minspec/`, so FR-10
  needs a new withhold entry, and the name invites confusion with a security policy.

**Recorded selection: Option (a),** a new `.minspec/policy.md`. An agent session copied this document's (rec) option; no human chose this item.

**D2 - Pointer-only, or pointer plus repo-local rules?**
- **(a) (rec) Pointer index plus an optional "rules that live nowhere else" section**, with the
  rule that any one rule lives in exactly one file. Cost: it creates one more place a rule can
  live, and FR-3 then needs to check that section against the constitution too.
- (b) Pointer-only. Strictest reading of "points, does not copy". Cost: a rule with no other
  natural home (for example a path class) has to go into the constitution or a DR first.

**Recorded selection: Option (a),** a pointer index plus an optional "rules that live nowhere else" section. An agent session copied this document's (rec) option; no human chose this item.

**D3 - Does the review also inline what the policy points to?**
- **(a) (rec) Inline the policy file and the constitution; list DRs by index only.** The
  constitution is about 9.7 KB, roughly 2.5K tokens per voter per review (inferred from byte
  size, unmeasured). Cost: that is multiplied by up to four voters on every reviewed push; the
  share of the weekly budget is not yet measured and Plan must measure it before build, per
  DR-106's 2% tie-break.
- (b) Inline the policy file only; voters `Read` the rest on demand. Cheapest. Cost: the
  constitution reaches the voter by model choice again - the exact prose-not-load gap this spec
  closes.

**Recorded selection: Option (a),** inline the policy file and the constitution; list DRs by index only. An agent session copied this document's (rec) option; no human chose this item.

**D4 - Which prompts are "every agent prompt"?**
- **(a) (rec) `dispatch-issue.sh` (all phases), `remediate-pr.sh`, `review-branch.sh` and
  `review-approvable.sh`.** These are the surfaces that produce or judge changes. Cost: four
  call sites to keep in step, which is why FR-6 tests each.
- (b) Only dispatch and `review-branch.sh`, as the issue's draft acceptance names. Cost:
  remediation and approvable review keep reading a different subset.
- Triage is excluded in both: it classifies an untrusted issue and produces no change.

**Recorded selection: Option (a),** `dispatch-issue.sh` (all phases), `remediate-pr.sh`, `review-branch.sh` and `review-approvable.sh`. An agent session copied this document's (rec) option; no human chose this item.

**D5 - Do the existing copies in CLAUDE.md / AGENTS.md get collapsed to a pointer?**
- **(a) (rec) Not in this spec.** Out of the issue's scope (scope-expansion rule); file it as a
  follow-up at Plan. Cost: until then the invariant lead sentences live in three files (the
  constitution plus two mirrors), which is the duplication the issue dislikes, though the
  mirrors are generated, not hand-copied.
- (b) Fold it in. Cost: widens a T3 spec into a harness-template rewrite across every adopter.

**Recorded selection: Option (a),** not in this spec; the collapse of the existing copies is a follow-up at Plan. An agent session copied this document's (rec) option; no human chose this item.

**D6 - Missing policy file at review time.**
- **(a) (rec) Fail closed (`changes`) once the repo's harness manifest records the file as
  scaffolded; visible notice and proceed in a repo that predates it.** Cost: an adopter who
  deletes the file blocks their own merges until they restore it.
- (b) Always visible notice and proceed. Cost: a deleted policy is a silently weaker review
  that only the notice line reveals.

**Recorded selection: Option (a),** fail closed (`changes`) once the harness manifest records the file as scaffolded; a visible notice and proceed in a repo that predates it. An agent session copied this document's (rec) option; no human chose this item.

## Alternatives rejected

- **Load CLAUDE.md into the review prompt instead.** It is 20 KB of mixed operational prose
  (session protocol, reply keys, merge funnel); most is irrelevant to judging a diff, and it
  is exactly the size SPEC-254 is removing from dispatch.
- **Keep the prose "Read X" instructions and add more of them.** Prose cannot be tested to
  have happened; FR-6 needs a load.
- **Read the policy from the working tree in review.** Correct in CI by accident (base
  checkout) and wrong for local runs from a head worktree; FR-4 reads the base ref explicitly.

## Follow-ups (tracked)

- None filed by this Specify pass. D5 (a) and the D3 budget measurement each become a tracked
  item at Plan, once the human has chosen.
