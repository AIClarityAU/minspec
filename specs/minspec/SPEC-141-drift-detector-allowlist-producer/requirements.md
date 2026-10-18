---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # session scope / concurrent-session coordination; the allowlist is the same field SPEC-026 presence publishes
aspects: [session, scope-drift, allowlist, vacuous-green, no-silent-gate, offline, parking-lot]
depends_on: [SPEC-026]  # presence reads session.fileAllowlist; this spec changes what populates it
relates_to: ["#1920", SPEC-038, DR-003]
# Ownership declared in Specify (SPEC-038). Modified-only; no new files owned.
implements: [packages/minspec/src/lib/session.ts, packages/minspec/src/commands/session.ts, packages/minspec/src/lib/parking-lot.ts]
affects: [packages/minspec/src/extension.ts, packages/minspec/src/lib/presence.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-141: The save-time drift detector gets a real source for its allowlist (or is removed)

Issue: #1920 (bug: the save-time drift detector can never fire). SPEC ONLY - nothing here is built.

## In plain terms

When you save a file outside the scope you declared, MinSpec is meant to ask "Park as Issue / Add to Scope / Dismiss". Today that toast cannot appear through any shipped path, because the list of in-scope files it checks is always empty. This spec makes the list get filled when the session names a spec, and makes the parking fallback say why GitHub failed.

## Root cause (verified against code)

A detector shipped with no producer for its input, and no test drives it from a session made by the shipped command.

- `declareScopeCommand` calls `createSession(scope, project, sessionType)` with no allowlist (`packages/minspec/src/commands/session.ts:64` area); `createSession` defaults it with `fileAllowlist ?? []` (`packages/minspec/src/lib/session.ts:173`).
- `isFileInScope` returns true for everything when the allowlist is empty (`session.ts:93`).
- `addToScope` (`session.ts:~130`) is the only writer, reachable only from the toast's "Add to Scope" button, which needs a non-empty allowlist to appear.
- `handleFileSaveDriftCheck` (`extension.ts:~1010`) returns early when `.minspec/session.json` is absent; that file is gitignored, so it is absent on every fresh clone.
- Existing tests hand-write the allowlist, so they pass while the feature is unreachable (vacuous-green class).

Gate gap (RCDD sibling rule): the missing piece is not just data; nothing asserts that a session produced by the shipped command can ever reach the "out of scope" branch. FR-5 adds that gate.

## Functional requirements

- **FR-1 Seed from the spec's owned set.** When a session is created and `specIds` is non-empty, `fileAllowlist` is seeded with the union of each named spec's `implements:` and `affects:` frontmatter paths (the same owned-file set `scripts/hooks/spec-gate.py` computes). One shared reader, not a second parser that can drift from spec-gate's (see FR-6).
- **FR-2 Spec naming at declare time.** `declareScopeCommand` must be able to name a spec so FR-1 has input (today it never sets `specIds`; see Decision D2).
- **FR-3 Unspecced sessions stay inert, visibly.** A session with no spec keeps an empty allowlist and so no drift toast. This is stated in the declare-scope confirmation message, not left to be discovered ("drift warnings need a spec").
- **FR-4 Parking reason is surfaced.** `createGitHubIssue` no longer ends in a bare `catch { return null; }`. When parking falls back to `.minspec/parking-lot.md`, the result carries the reason class (auth, network, missing repo/`gh`, other) and the park command's confirmation shows it. The offline fallback behaviour is unchanged (invariant 1: no new network call; the reason comes from the existing `gh` attempt).
- **FR-5 Reachability test.** A test creates a session through the same function path `declareScopeCommand` uses (not a hand-written allowlist), saves a path outside the seeded set, and asserts the drift branch is taken; a second asserts an in-set path is not flagged. This test must fail on today's code.
- **FR-6 One owned-set reader.** If spec-gate.py's computation cannot be shared (Python vs TS), a test pins both to the same fixture spec and asserts identical sets, so they cannot silently diverge.
- **FR-7 Honest limits documented.** The setting/README text states the detector sees editor saves only, never agent writes through Bash.

## Acceptance criteria

- AC-1: Declaring a scope naming SPEC-X yields a session whose allowlist equals SPEC-X's `implements:` + `affects:` paths.
- AC-2: Saving a file outside that set shows the drift toast; saving one inside does not.
- AC-3: A session with no spec: no toast, and the declare confirmation says why.
- AC-4: Forcing `gh` to fail (auth, missing binary) makes the park result name the reason and the toast/message shows it; the entry is still written to `parking-lot.md`.
- AC-5: FR-5's reachability test fails on base and passes on head.

## Invariants this change must not break

1. Offline core: seeding reads local specs only; no network (constitution 1).
2. No silent gate: the park fallback no longer swallows the failure reason (constitution 2).
3. Blast radius: the session file and toast remain only for folders with `.minspec/` (constitution 3; SPEC-096 opt-in marker).
4. SPEC-026 presence: a non-empty seeded allowlist makes this session a "contender" in `presence.ts:429`; this is intended but widens FR-10 peer guards, so presence tests must cover a seeded session.

## Decisions needed (Clarify)

- **D1 - Seed vs delete.**
  - **Seed (rec):** matches the issue's recommendation and gives the detector a producer. Cost: unspecced sessions still get no detector, and agent Bash writes stay invisible.
  - Delete the detector and toast. Cost: loses a surface that may earn its place later; but dead code that looks live is a false signpost. If chosen, FR-1-3 and FR-5-7 are replaced by removal of `handleFileSaveDriftCheck`/`showDriftWarning` and their tests; FR-4 stands.
- **D2 - How a session names a spec.**
  - **Add an optional fourth step to Declare Scope: pick from specs with status not `done` (rec):** explicit. Cost: one more prompt on every declare.
  - Infer from the current branch/active spec: no extra prompt. Cost: inference can pick wrong, and a wrong allowlist produces false toasts.
- **D3 - Presence side effect (invariant 4).** Seeding makes sessions contenders in the peer-overlap guard. Accept that (rec; it is the correct data) at the cost of more guard hits, or keep a separate drift-only list at the cost of two allowlists to keep aligned.
