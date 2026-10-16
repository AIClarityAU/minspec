---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the spec-gate's ownership signal must not freeze unrelated maintenance
aspects: [spec-gate, ownership, governance, tier-0, offline, no-silent-gate]
depends_on: [SPEC-038]  # SPEC-038 owns the structured/fuzzy ownership contract this narrows
relates_to: [DR-047, DR-056, SPEC-029, "#1297", "#714", "#460", "#426"]
# Declared in Specify (SPEC-038). The gate and its parity mirror are both changed;
# the parity test pins that they stay byte-identical. spec-gate.py is review machinery,
# so the change needs a human merge.
implements: [scripts/hooks/spec-gate.py, packages/minspec/src/lib/ownership-path-rules.ts, packages/minspec/tests/spec-gate.test.ts, packages/minspec/tests/ownership-path-parity.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Spec-gate fuzzy signal must not freeze manifest / version files

Issue: #1297 (extension reinstall needs a version bump, but the spec-gate can freeze
`packages/minspec/package.json`). No DR exists yet; none is needed unless the Clarify answer
below picks an option that cannot be undone in under a day.

**Scope sentence.** Stop an unapproved spec's *prose* mention of a manifest file from blocking
edits to that file, without weakening the gate for files a spec genuinely declares.

## Problem (observed, with citations)

- The reinstall flow needs a version bump of `packages/minspec/package.json` (a same-version
  swap can activate to an empty state - 2026-07-25 incident).
- On 2026-10-16 a bump `0.1.26` to `0.1.27` was denied: "Unapproved T3/T4 spec(s) in
  implementation: SPEC-029 (not approved)."
- SPEC-029's structured `implements:` names only `approval-diff.ts` and its test. The block
  came from the FUZZY signal: `declared_impl_files` (`scripts/hooks/spec-gate.py:326`) reads every backtick
  code span in the spec's `tasks.md` and, via `consider(..., require_exists=True)`
  (`spec-gate.py:361`), adds any that resolves to a real file. `tasks.md:232` and `:237`
  contain `packages/minspec/package.json`, so it entered SPEC-029's owned set.
- SPEC-029 is unapproved only because #714 revoked agent-attributed approvals; it is the last
  straggler. The root cause is the mechanism (a prose mention of a shared, load-bearing file
  counts as ownership) plus a missing gate on how wide that signal may reach - not the stale
  approval, which is a transient.
- The gate is behaving as designed (module docstring, `spec-gate.py:26-31`). This spec is about
  the collision of the fuzzy signal with files that every spec mentions and nobody owns.

## Functional requirements

- **FR-1.** The FUZZY (prose `tasks.md`) signal MUST NOT add a *manifest or version file* to a
  spec's owned set. Manifest set (closed list, defined once): any file named `package.json`,
  `package-lock.json`, `tsconfig*.json`, or `.vscode/*.json`. (Exact list confirmed in Clarify.)
- **FR-2.** The STRUCTURED signal (`implements:`/`affects:`) is unchanged: a manifest file a
  spec genuinely declares there still blocks, including when it does not yet exist.
- **FR-3.** All other fuzzy behaviour is unchanged: existence filter, `/` requirement, source
  extension, infra-prefix and parent-escape rejection.
- **FR-4.** The exclusion is a TypeScript/Python mirrored constant pair, pinned by
  `ownership-path-parity.test.ts` exactly as `OWNED_SRC_EXT_PATTERN` and
  `OWNED_INFRA_PREFIXES` are, so the validator and the gate cannot disagree.
- **FR-5.** The validator's `isValidOwnedPath` is NOT narrowed: a manifest file stays a valid
  structured declaration (FR-2). Only the fuzzy read in the gate is narrowed.
- **FR-6 (no silent gate, INV-2).** When a fuzzy token is dropped under FR-1 the gate does
  not deny on it, and a denial elsewhere is unaffected. The drop is a documented, disclosed
  narrowing in the module docstring "HONEST SCOPE" paragraph (it lists what the gate no longer
  covers), not a swallowed error.
- **FR-7.** No network call, no new dependency (INV-1).

## Acceptance criteria

- **AC-1.** Fixture: unapproved `implementing` spec whose `tasks.md` backticks an existing
  `packages/x/package.json`, with no structured declaration. An edit to that file is allowed.
- **AC-2.** Same fixture but `implements: [packages/x/package.json]`. The edit is denied.
- **AC-3.** Same fixture with `affects: [packages/x/package.json]` and the file absent: a
  `Write` creating it is denied.
- **AC-4.** A non-manifest source file mentioned only in `tasks.md` and existing is still
  denied (regression guard for FR-3).
- **AC-5.** Parity test fails if only one of the Python/TypeScript manifest lists is edited.
- **AC-6.** Against the live repo state: with SPEC-029 still unapproved, a version bump of
  `packages/minspec/package.json` passes the gate.

## Invariants this must not break

- INV-1: offline, no network.
- INV-2: no silent gate - narrowing is disclosed in the docstring and pinned by AC-2/AC-3, so
  genuinely declared manifests still fail closed.
- INV-3: blast radius - the gate change ships only to repos with `.minspec/`; no behaviour
  change elsewhere.
- DR-047 section 3: doc-before-code stays pairwise to the code a spec explicitly declares.
- SPEC-038: structured declaration stays the primary, creation-blocking signal.

## Decisions needed (Clarify)

1. **Which fix.** Options from #1297:
   - **(A, rec) Exclude manifest/version files from the fuzzy owned set** (this spec's
     draft). Cost: a spec that describes its work only in prose and edits `package.json`
     is no longer gated on that file - widens the already-disclosed fuzzy gap slightly.
   - (B) Decouple reinstall from the bump (a package script that stamps the vsix version
     without editing tracked source). Cost: larger change in `scripts/`/build, does not
     fix the underlying collision for other manifest edits (dependency adds), and the
     build-stamp can drift from the committed version.
   - (C) Leave as-is and keep the re-approval worklist at zero. Cost: the recovery path for
     every extension bug stays hostage to any one stale approval; this recurs after any
     future mass revocation.
2. **Manifest list breadth.** Only `package.json`, or the closed list in FR-1? Recommend the
   closed list; cost: a spec that really does own a `tsconfig.json` must now declare it
   structurally (which the validator already requires of T3/T4 specs).
3. **Data hygiene in the same PR?** Remove the two prose mentions from SPEC-029
   `tasks.md` as a stopgap. Recommend NO: editing an unapproved spec is allowed but
   treats the instance, not the gate (RCDD); and SPEC-029 is not this issue's scope.
