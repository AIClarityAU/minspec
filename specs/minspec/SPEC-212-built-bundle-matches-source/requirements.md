---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - what ships into an adopter must be what the source says
aspects: [build, provenance, harness, templates, no-silent-gate, test-coverage, tier-0, offline]
depends_on: [SPEC-060, DR-066]  # SPEC-060 owns the build stamp this reuses; DR-066 is the fail-closed rule the new gate follows
relates_to: [SPEC-135, SPEC-043, SPEC-211, "#2032", "#1905", "#1906", "#1439", "#1527", "#1549"]
implements: none
implements_reason: >-
  Ownership is deferred to Plan: the new assertion most likely lands inside an existing test
  file and an existing CI job, neither owned by a spec. To be declared before approval.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-212: The bundle that renders an adopter's files is checked against the source it claims to be built from

Issue: #2032. Related rationale: SPEC-060 (build stamp), SPEC-135 (self-installing build).

## In plain terms

A safety sentence was fixed in source (#1905/#1906: the gates fail **closed**), pinned by a
regression test (`gate-fail-direction.test.ts`), and CI stayed green - yet an adopter repo
(`scroogellm`) still received the old, inverted sentence ("fail open") because the extension
that rendered it was a bundle built 14 days before the fix. Every check reads `src/`; the
thing that reaches an adopter is `out/extension.js`. Nothing compares the two.

## Measured facts (verified in this worktree; others are from the issue and marked so)

- `out/` is **gitignored** (`.gitignore:6`), so the bundle is **not committed**. The issue's
  option `b` as worded ("fail if the committed `out/extension.js` differs") has no committed
  file to compare. The stale bundle in the issue is a *locally built / installed* artifact.
- `scripts/build-extension.sh` is the single bundler path and stamps the commit SHA into the
  bundle via `__MINSPEC_BUILD_SHA__` (`build-provenance.ts`). The stamp can already say
  *which commit* a bundle came from.
- Existing skew detection (`detectBuildSkew`, SPEC-060) speaks up **only when the open
  workspace is a MinSpec checkout**. An adopter repo (the exact case here) gets only the
  weaker "which build am I running" display (#1549) - no "you are behind" signal.
- Harness-drift detection compares project files to the templates of the *running* build, so a
  stale build reports "no drift" against its own stale output (the circularity SPEC-060 names).
  This is why the refresh was a no-op on `scroogellm/CLAUDE.md`.
- Not re-verified here (from the issue): bundle/source mtimes, and the two downstream
  `CLAUDE.md` states.

## Root cause (mechanism + missing gate)

Mechanism: the rendered-template text exists in two producers - `src/lib/template-registry.ts`
and the bundle compiled from it - and the build is a manual, unreconciled step. Missing gate:
no check asserts that the *built* artifact's rendered output equals the source's rendered
output, so a stale build is invisible to every test and to harness-drift detection.

## Functional requirements

- **FR-1 Built-artifact assertion.** A check renders the harness templates **from the built
  bundle** and asserts they equal the templates rendered from `src/` (content-level, over the
  rendered text - not a byte comparison of the bundle).
- **FR-2 Fails closed and visibly.** If the bundle is missing, unloadable, or not built from
  the checked-out commit, the check **fails** with a message naming the stale artifact and the
  rebuild command. It never passes or skips silently (constitution invariant 2).
- **FR-3 Includes the fail-direction claim.** The check demonstrably covers the #1905 sentence:
  reintroducing "fail open" in a stale bundle makes it fail (control run), per
  `gate-fail-direction.test.ts`'s both-directions pattern.
- **FR-4 Runs where the artifact is produced.** It runs in the CI job that builds the
  downloadable `.vsix`, against that very bundle, so what ships is what is asserted.
- **FR-5 Adopter-visible staleness (see DQ-2).** Whichever option is chosen, the running
  extension must not report "no drift" when its own build is older than the commit it was
  built from can be shown to be superseded - or this is explicitly deferred with a filed issue.
- **FR-6 Offline and local.** No network call, no LLM (invariant 1). Uses local `git` and the
  build only.
- **FR-7 Scoped to opt-in repos.** Nothing here changes behaviour in a repo without `.minspec/`
  (invariant 3); FR-5 runs only in an opted-in workspace.

## Acceptance criteria

1. Given a bundle built before the #1906 fix and source after it, the check fails and names the
   stale bundle (control: same check passes on a fresh build).
2. Given no bundle present, the check fails closed, not skips.
3. The check does not fail on rebuilds that differ only in timestamps, paths or ordering
   (two consecutive clean builds both pass).
4. `npm test`, `npm run lint`, `npm run validate` still pass; no new dependency.

## Invariants the change must not break

- INV-1: offline, no network (constitution 1).
- INV-2: no silent gate - a missing/errored bundle fails closed (constitution 2).
- INV-3: blast radius limited to opted-in repos (constitution 3).
- INV-4: `scripts/build-extension.sh` stays the only bundler path (#1527).

## Out of scope

- The immediate repair (rebuild + install the VSIX, re-run *MinSpec: Refresh Harness Files* on
  `scroogellm`). That is an operator act, not a spec deliverable. Do not hand-edit `CLAUDE.md`.
- Auto-installing the build (SPEC-135).

## Decisions needed (Clarify)

**DQ-1 - How to check the bundle.**
- `t` **Render-compare the built bundle against source (rec).** Content-level, deterministic,
  not brittle. Cost: only catches drift in text something renders and compares; a changed
  *behaviour* with no rendered text still travels.
- `b-rebuild` Rebuild in CI and byte-compare. Cost: brittle (timestamps/paths/ordering) and,
  because `out/` is **not committed**, there is nothing committed to compare against - it would
  reduce to comparing two fresh builds and prove nothing about the stale installed one.
- `b-stop` Not applicable: the bundle is already not committed.

**DQ-2 - Reaching the adopter.** CI (FR-4) protects the shipped `.vsix`, but the failure in
#2032 was a stale *locally installed* build in an adopter workspace.
- **(rec)** CI check only now; file a follow-up so an adopter-workspace extension can warn when
  its stamped SHA is not an ancestor of a known-newer one. Cost: the exact reported scenario
  (stale local install) stays undetected until that follow-up lands.
- Extend `detectBuildSkew` beyond MinSpec checkouts. Cost: needs a comparison reference an
  adopter does not have offline; risks warning noise (SPEC-060's reason for scoping).

**DQ-3 - Where the check lives.** Extend `gate-fail-direction.test.ts` / a new test in
`packages/minspec/tests/` run after build in the `package` CI job **(rec)**, cost: the test
needs a pre-built bundle, so it must be excluded from plain `npx vitest` or fail closed when
absent (FR-2) - which will make local test runs red until `npm run build`.
