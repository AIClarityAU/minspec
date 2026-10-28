---
id: SPEC-263
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the pre-publish egress guard is the credential-boundary control for drain-published agent output (same domain as SPEC-213, SPEC-226)
aspects: [egress-guard, dispatch, generated-files, no-silent-gate, exfil]
depends_on: []
relates_to: ["#2815", "#2814", "#2597", "#358", "#479", "#616", "#652", "#678", "#750", "#871", DR-008]
implements: none
implements_reason: >-
  Specify phase only. The files this spec will own (expected: scripts/lib/agent-egress.sh and
  its tests) are fixed at Plan, after Decisions D1-D3 are answered.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-263: The egress guard verifies generated template files instead of entropy-scanning their base64

> **This is a SPECIFICATION ONLY.** Written for issue #2815 (egress guard blocks every drain build
> that regenerates `ci-review-templates.ts`). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it. The change touches the
> security guard on the drain's publish path, so it is machinery: the founder reviews and merges it.

## In plain terms

Before the drain publishes an agent's branch, a guard scans every added line for secrets. One
check flags long mixed-case-plus-digit strings. The extension carries two generated files that
hold whole scripts encoded as base64, 100 characters per line. Every one of those lines looks
like a secret to that check. So any drain build that edits an embedded script, and therefore has
to regenerate the file, is blocked. Session-built PRs never meet this guard, so the defect stays
hidden until the drain tries.

Telling the guard to skip the file would open a hiding place: an agent could write base64 that
decodes to a stolen secret. This spec takes the other route. The guard rebuilds the file itself,
with a generator it trusts, from sources it has already scanned. If the bytes match, the file
holds nothing the sources did not already hold, so its base64 lines need no scan. If they do not
match, the file is scanned as it is today and the publish is blocked.

## Measured state (base 804a899d)

Read from the code at this base, not inferred:

- `scripts/lib/agent-egress.sh:69` runs `git log -p --no-color base..HEAD` with no pathspec, and
  `:77` keeps every `^+` line. No path is treated differently.
- `scripts/egress-scan.sh:107` flags any token of 32+ characters that contains `+` or `=` plus
  alphanumerics. `:119` flags a contiguous 32+ alphanumeric run that has upper, lower and digit.
  A 100-character base64 line meets one or both nearly always.
- `scripts/gen-ci-templates.mjs` owns two generated files (`GENERATED_FILES`, exported as
  `CI_TEMPLATE_OUTPUT_PATHS`): `packages/minspec/src/lib/ci-review-templates.ts` (7695 base64
  lines at this base, nearly all 107 characters with the quoting) and
  `packages/minspec/src/lib/hook-templates.ts` (123 base64 lines). The issue names only the
  first. The second has the same encoding and the same defect.
- The generator imports only `node:fs`, `node:path` and `node:url`, and its `generateAll(repoRoot)`
  reads only the registered source paths (`CI_TEMPLATE_SOURCE_PATHS`) and returns the rendered
  files. It writes nothing when used this way.
- Reproduced here: commit `f8c5b0ee` (docs-lane.yml edit plus regeneration), scanned alone the way
  the guard scans, returns rc=1 with 50 hits. All 50 are `+    '<base64>',` lines of
  `ci-review-templates.ts`. The added lines of its two other files (`.github/workflows/docs-lane.yml`,
  `packages/minspec/tests/docs-lane-hold.test.ts`), scanned alone, return rc=0.
- `scripts/dispatch-issue.sh:1805` calls the guard with base `origin/main`. The planned second
  caller (#750, PR remediation) would pass a pre-remediation PR-head SHA as the base. That SHA is
  not on `main`.
- Git 2.43 with `diff.renames` unset, so `git log -p` detects renames by default.

Not reproduced here: the issue's figures for PR #2814 and the five other regeneration commits,
and the cause of the #2597 quarantine (its log is gone). I believe they follow the same mechanism,
but I have not checked them.

## Root cause (mechanism)

The guard uses one content heuristic, "a long high-entropy run is a secret". It applies it to
every added line, including lines a deterministic generator wrote from other files in the same
diff. For those lines the heuristic is always wrong. The scan has no idea of provenance: it cannot
tell "this text came from an encoder fed with scanned input" from "an agent typed this text".

The missing gate: no check proves that a generated file equals its generator's output. Without
that proof, skipping the file would be unsafe (option b in the issue). So the guard can only
false-block, and the drain cannot land a CI-correct change to an embedded script (#678 makes the
regeneration mandatory).

## Functional requirements

- **FR-1 Trusted generator only.** The guard verifies with a generator taken from a protected
  commit on `main`, read as a git object (see D3). It never runs the generator file from the
  agent's worktree or from any commit in `base..HEAD`. The guard never executes code the agent
  wrote. If the branch changes `scripts/gen-ci-templates.mjs`, the trusted generator's output will
  not match. That is the expected result: no exemption, the scan runs as it does today.
- **FR-2 The set of generated paths comes from the trusted generator.** The candidate paths are
  the trusted generator's `CI_TEMPLATE_OUTPUT_PATHS`, so both current files are covered and any
  later file is covered with no second list (#871). A path list typed into the guard does not
  meet this FR.
- **FR-3 Byte-exact verification per commit (see D1).** For every commit C in `base..HEAD` whose
  patch touches a generated path P, the guard materialises the registered sources as of C. It
  reads them as git blobs (`git show C:<path>`) into a scratch directory outside the worktree,
  runs the trusted `generateAll` over that directory, and requires that `C:P` byte-equals the
  rendered content for P. A commit that deletes P counts as verified for P only if the trusted
  generator also no longer lists P. Otherwise the deletion fails verification.
- **FR-4 Exempt only by git pathspec, only when every check passed.** The exemption for P applies
  only when FR-3 passed for P at every commit that touches it. The guard then excludes P from the
  added-lines dump with a git pathspec (`':(exclude)P'`), never by parsing `+++` headers out of
  the patch text, which agent-chosen file names could forge. The patch walk uses `--no-renames`.
  Then a file renamed into or out of P shows as a full delete plus a full add. Its content cannot
  vanish into the excluded path.
- **FR-5 Everything else is still scanned.** The exemption covers no other path, no part of the
  commit messages, and neither `.agent-summary.md` nor `.review-signals.json`. Above all, the
  added lines of the source files are still scanned in every commit, so a secret placed in a
  source is caught there (and FR-3 guarantees the generated file cannot add anything the sources
  lack).
- **FR-6 Fail closed, with a reason (invariant 2).** If verification cannot complete, the guard
  blocks and names the cause in its BLOCK output: `node` missing, the trusted generator unreadable,
  a source blob missing at C, the generator throwing, a mismatch, or scratch-dir or git failure.
  Example cause: `generated-file verification failed for P at <sha>: <cause>`. The guard does not
  silently fall back to an entropy result whose message would point at base64 lines. No new
  `|| true` touches a load-bearing signal.
- **FR-7 No side effects.** Verification writes only to a scratch directory it creates outside the
  worktree and removes on every path, in the same way the existing dumps work. It does not modify
  the worktree, the index or any ref. It runs no network call and no `npm`. The generator runs with
  its working directory set to the scratch directory.
- **FR-8 One guard for all callers.** The change lives in `agent_egress_scan`
  (`scripts/lib/agent-egress.sh`), so `dispatch-issue.sh` and the planned #750 caller get the same
  behaviour. `scripts/egress-scan.sh` stays a pure content scanner with no notion of paths.
- **FR-9 Honest header.** The HONEST SCOPE comments in both guard files are updated. They must
  state the new exemption, the condition it rests on (FR-3), and that the guard now depends on
  `node` and on the trusted generator being deterministic.

## Acceptance criteria

Each is a test in the existing egress suites (`packages/minspec/tests/egress-scan.test.ts`,
`dispatch-egress-lib-parity.test.ts`, or a new sibling). Each test builds real git history in a
temp repo, and each must be seen to fail against the current guard or a named mutant:

- **AC-1** A branch that edits `scripts/review-branch.sh` and regenerates with the trusted
  generator passes the guard (rc=0). The same history fails at this base (rc=1). This test is the
  regression proof.
- **AC-2** A branch whose generated file contains one hand-edited base64 line that decodes to a
  secret-shaped token, with sources unchanged, is blocked, and the BLOCK reason names the
  verification mismatch.
- **AC-3** A branch that adds a secret to a registered source and regenerates is blocked by the
  source's own added line (the generated file verifies and is exempt, the source is not).
- **AC-4** A branch that edits the generator and regenerates with the edited generator is not
  exempted and is blocked. It is also proven that the guard never ran the worktree's generator.
  Mutant: point the guard at the worktree copy, and this test must go red.
- **AC-5** A two-commit branch whose first commit puts a hand-edited secret blob in the generated
  file and whose second commit regenerates it clean is blocked (history is published, #358).
- **AC-6** A commit that renames a file holding a secret-shaped line onto a generated path, or off
  one, is blocked.
- **AC-7** `node` absent, the generator throwing, or a source blob missing each block, with a cause
  naming it (FR-6). None of them passes.
- **AC-8** With the exemption granted, a secret in a commit message, `.agent-summary.md` or
  `.review-signals.json` still blocks.
- **AC-9** `hook-templates.ts` regenerated from an edited `.claude/hooks/` source passes, with no
  edit to the guard's code (FR-2 covers it through the trusted generator's own list).
- **AC-10** After every run, pass or block, the worktree's `git status --porcelain` is unchanged and
  no scratch directory is left behind.

## Invariants this change must not break

- **Constitution invariant 2 (no silent gate).** Every failure to verify blocks visibly (FR-6). The
  exemption is earned by proof, never assumed.
- **Constitution invariant 1 (offline).** Verification reads local git objects only, with no
  network call.
- **Constitution invariant 3 (blast radius).** `agent-egress.sh` and `egress-scan.sh` are dev-time
  dispatch scripts and are not in the generator's shipped `SOURCES`, so adopters are unaffected.
  If Plan finds otherwise, this spec is reopened.
- **#358 / DR-008 (credential-free agent, credentialed publisher).** The parent never executes
  agent-authored code (FR-1). Every published byte is either scanned or proven equal to the trusted
  generator's output from scanned input.
- **#616 / #652 scanner behaviour.** The entropy heuristic is not loosened. Generated base64 is
  handled by provenance, not by relaxing what counts as a secret.

## Rejected alternatives

Recorded here because this repo runs in act mode (DR-086 §4) and nobody sees the choice live.

- **Path-exempt the generated files (issue option b).** Rejected. An agent could hand-edit base64
  that decodes to a secret, and the guard would let it through, which is an exfil channel. AC-2
  exists to keep it closed.
- **Route embedded-script changes to sessions only (issue option c).** Rejected. Each such change
  then needs a human-driven session (against tenet 1), and quarantines keep recurring until triage
  learns the rule. That rule would be a second prose predicate prone to drift.
- **Decode the base64 and entropy-scan the decoded text.** Rejected. A block's lines cannot be
  rebuilt from diff hunks alone, so the whole file would have to be decoded at each commit. Base
  content that has already been published would then be rescanned every time, and the parser
  would become a new attack surface for obfuscated encodings. Byte-equality against the trusted
  generator is simpler and stricter.
- **A new DR.** Not written. This is a guard change that can be reverted in under a day, so it does
  not pass the DR-359 filter. DR-008 stays the governing decision.

## Decisions needed (Clarify)

- **D1 How much history must verify.**
  - **(a) (rec)** Every commit that touches a generated path verifies (FR-3). Cost: one generator
    run per such commit, which is seconds, and some extra code to materialise sources per commit.
  - **(b)** Verify HEAD only, and exempt only those added lines that appear verbatim in HEAD's
    verified output. Cost: an agent that regenerates twice on one branch (an earlier regeneration,
    then a later source edit) is false-blocked by its own intermediate lines. That brings back the
    defect this spec closes, in a narrower form.
- **D2 Scope: both generated files, or only the one the issue names.**
  - **(a) (rec)** Both, through FR-2. Cost: `hook-templates.ts` comes into scope without being named
    in the issue. It is the same generator and the same mechanism, so the extra work is one
    acceptance test (AC-9).
  - **(b)** Only `ci-review-templates.ts`. Cost: the guard would need a hand-typed path, which goes
    against FR-2, and the hook-template drain builds stay blocked.
- **D3 Which commit the trusted generator comes from.**
  - **(a) (rec)** `git merge-base HEAD origin/main`: a commit on protected `main`, and the same
    generator the agent's branch was built on. Cost: if the merge-base is unavailable (shallow
    clone, missing ref), the guard blocks closed (FR-6). That is a false block, never a false pass.
  - **(b)** The tip of `origin/main`. Cost: if `main` changed the generator after the agent
    branched, every regeneration fails to match and is false-blocked.
  - **(c)** The parent's own checkout (`SCRIPT_DIR`). Cost: that checkout can be stale or dirty, so
    the trusted copy would be whatever happens to be on disk. Not recommended.
  - Never the caller's `base_ref`: for #750 that is a PR head that is not on `main`, and code the
    agent wrote could be run with credentials.

## Follow-ups (tracked)

- #750 (PR-remediation publish path) must call this same `agent_egress_scan`. D3's "never
  `base_ref`" rule is written for it. None new.
