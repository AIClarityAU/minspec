---
id: SPEC-342
type: requirements
status: specifying
tier: T3
product: agent-execute
epic: EPIC-007  # Agent Execute Extension
aspects: [autopilot, spec-gate, deliverables, no-silent-gate]
relates_to: [DR-036, DR-012, DR-031, SPEC-038]
affects: [scripts/hooks/spec-gate.py]  # gains a third ownership signal (deliverable_paths)
implements: [scripts/hooks/spec-gate.py, scripts/validate-frontmatter.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-342: Deliverable registry — the spec-gate guards a spec's declared output paths

> **SPECIFICATION ONLY.** Written for [#233](https://github.com/AIClarityAU/minspec/issues/233)
> (Autopilot Mode prerequisite A1, [DR-036](../../../docs/decisions/DR-036.md)). Nothing is built until a human
> resolves [Decisions needed (Clarify)](#decisions-needed-clarify) and approves it.

## One-Sentence Scope

A spec may declare `deliverable_paths:` (the files/directories its work *produces*), the spec-gate refuses writes to those paths unless the owning spec is approved-and-fresh, and Autopilot Mode refuses to start while any declared deliverable path is ungated.

## Context

Autopilot attack A1 (DR-036): "the bypass-proof gate guards the empty set". For config-is-the-product repos (rulesets, intake configs, ICP lists) the deliverable is **data**, not source code.

**Correction to the issue text (verified against `scripts/hooks/spec-gate.py`, not the prose).** The issue cites an allowlist at `spec-gate.py:120-121`; that allowlist no longer exists. Today the gate has no path allowlist. It denies a write only when the target is in the *owned set* of a gated unapproved/stale spec (`owned_match`, main()), where the owned set comes from `implements:`/`affects:` (structured) plus existence-filtered backtick paths in `tasks.md` (fuzzy) (`owned_file_set`). The A1 hole survives in three narrower forms, each of which this spec must close:

1. **Extension filter.** `consider()` drops any token not ending in `_SRC_EXT_RE` (`ts|js|py|sh|json|css|html|sql|ya?ml|toml|…`). `.md`, `.csv`, `.txt`, `.xlsx`, `.ics`, extension-less files are never ownable, so a prose/CSV deliverable (an ICP list, a comparison-sheet template) cannot be gated.
2. **No directories/globs.** Entries must be explicit files (SPEC-038 FR-1); a generated tree (`config/rulesets/`) cannot be declared without enumerating files that do not exist yet.
3. **Phase scoping.** A spec is gated only when its phases put it in plan/tasks/implement (`phase_intent_status`). A spec still `specifying` owns nothing, yet Autopilot writes deliverables from generated specs.

`implements:` also answers a different question (code the spec's *implementation* creates) and is subject to SPEC-038's required-declaration contract. Overloading it with data deliverables would blur that edge type, so a separate key is specified (see Clarify D-1).

## Functional Requirements

- **FR-1 — `deliverable_paths:` frontmatter.** A spec MAY declare `deliverable_paths:` — a list (inline or block form, same parser as `implements:`) of repo-relative **files or directory prefixes** (trailing `/`) it generates. No extension restriction: any extension, or none, is valid. Absolute paths, `..` segments and infra prefixes (`node_modules/`, `out/`, `dist/`, `coverage/`, `.git/`) are rejected by the validator (FR-7), matching the gate's existing exclusions.
- **FR-2 — Gate enforcement.** `spec-gate.py` adds `deliverable_paths` as a third signal in the owned set. A Write/Edit/MultiEdit whose target equals a declared file, or lies under a declared directory prefix (case-insensitive, as `owned_match`), is **denied** unless the declaring spec's approval verdict is `approved` (fresh). `unapproved` and `stale` both deny, with the existing reason wording naming the spec.
- **FR-3 — No phase exemption for deliverables.** Unlike `implements:`, a deliverable path is guarded whenever the declaring spec is **not approved-and-fresh**, regardless of `phases` position (closes hole 3). Explicit terminal status (`archived`) still releases it. The spec's *own* docs and `.minspec/` approval writes remain always writable (unchanged — otherwise the spec could never be approved).
- **FR-4 — Fail closed.** If the approval store cannot be resolved (no readable git checkout) and the target is in any declared deliverable set, deny (same posture as the existing `canon_resolved` guard). A malformed `deliverable_paths:` value that parses to nothing is a validator error (FR-7), never a silent empty set.
- **FR-5 — Ownership conflicts.** If one path is declared by two specs, it is guarded by **each**: it is writable only when every declaring spec is approved-and-fresh. (Strictest-wins; no silent shadowing.)
- **FR-6 — Autopilot startup check (fail fast).** Before the Autopilot loop's first iteration the runner enumerates the repo's deliverable surface and **refuses to start** (non-zero exit, a visible message naming the offenders) if either:
  (a) a path the repo's product config declares as generated output is covered by **no** spec's `deliverable_paths:`, or
  (b) the spec-gate hook is not installed/armed for the repo (a registry the gate does not read guards nothing).
  The refusal is loud and never best-effort (invariant 2); there is no flag that downgrades it to a warning in Autopilot.
- **FR-7 — Corpus validator.** `npm run validate` fails when `deliverable_paths:` is present but empty/unparseable, contains a rejected path (FR-1), or names a path that is simultaneously in `specs/`, `.minspec/approvals/`, or the spec's own directory (a deliverable must never alias the approval store or the spec being approved).
- **FR-8 — Opt-in blast radius.** The signal is inert in any spec without the key; repos without `.minspec/` are untouched (constitution invariant 3). No network calls (invariant 1).

## Acceptance Criteria

- **AC-1** (maps to issue A1-a): a spec with `deliverable_paths: [config/rulesets/]` validates; the same key with `../x` or empty fails validate (FR-1, FR-7).
- **AC-2** (issue A1-b): with SPEC-X unapproved, Write to `config/rulesets/a.yaml` and to `config/icp.csv` (non-source extension) and a *new* file under the declared directory are all denied; after approval they are allowed; after editing SPEC-X post-approval (stale) they are denied again.
- **AC-3**: a `specifying`-phase spec's deliverable path is denied while unapproved (FR-3); `archived` releases it.
- **AC-4**: a path declared by SPEC-A (approved) and SPEC-B (unapproved) is denied, reason names SPEC-B (FR-5).
- **AC-5**: edits to the unapproved spec's own `requirements.md` and `.minspec/approvals/**` remain allowed.
- **AC-6** (issue A1-c): Autopilot start on a fixture repo with one uncovered generated-output path, and separately with the gate hook absent, exits non-zero naming the path / the missing hook; with full coverage it proceeds.
- **AC-7**: a repo with no `.minspec/` and a spec lacking the key behave exactly as before (regression: existing spec-gate tests unchanged).
- **AC-8**: an unresolvable approval store with a deliverable-path target denies (FR-4).

## Invariants this change must not break

1. Offline; no network (constitution 1).
2. No silent gate (constitution 2): FR-4/FR-6 fail closed and visibly; the registry has an independent second witness — the startup check re-derives coverage rather than trusting the gate alone.
3. Blast radius = opted-in project (constitution 3): inert without `.minspec/` / without the key.
4. Existing `implements:`/`affects:` semantics (SPEC-038) and the "spec's own docs always editable" rule are unchanged.
5. Enforce, don't trust: the Autopilot refusal is code, not a prompt rule.

## Out of scope

A2 external pipeline-state file (#234), A3 forged-approval guard (#235), A4 prototype digest (#236), A5 severity seam (#237), A11 git-identity guard (#238). Glob patterns beyond directory prefixes. Distinguishing "owns" from "touches" in the gate (DR-056).

## Decisions needed (Clarify)

Recorded selections: each of the 4 selections below is an agent pick of the option this document marks recommended, recorded on 2026-11-17 under the founder decision in queue item clarsel. Sign-off ratifies them and may change any of them.

- **D-1 — New key vs reuse `implements:`.**
  - **(rec) New `deliverable_paths:` key** (as the issue specifies): keeps SPEC-038's code-ownership edge pure and lets deliverables skip the source-extension filter and phase scoping. Cost: a second ownership list for authors to maintain and a third signal in the gate to keep in parity with the TypeScript ownership rules (`ownership-path-rules.ts` parity test).
  - Reuse `implements:` with relaxed rules: one list, but loosens a gate that is currently precision-tuned for code, risking over-blocking source edits.

  **Recorded selection: the recommended option,** a new `deliverable_paths:` key. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
- **D-2 — Directory prefixes allowed?**
  - **(rec) Yes, trailing-`/` prefixes only**: generated trees cannot enumerate unborn files. Cost: a coarse prefix can over-block (e.g. `config/` freezes unrelated config); mitigated by FR-7 rejecting the repo root and approval store, but authors must declare narrowly.
  - Explicit files only: precise, but unguardable for generated sets — leaves A1 open for Autopilot.

  **Recorded selection: the recommended option,** yes, trailing-`/` prefixes only. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
- **D-3 — How does the startup check learn "paths the product generates" (FR-6a)?** The source of truth is undefined today.
  - **(rec) A repo-level `.minspec/config.json` list of generated-output roots** the runner diffs against the registry. Cost: one more config key that must be kept honest, and a human-authored list can under-declare (the check proves coverage of what is listed, not completeness).
  - Infer from a dry-run write log: catches under-declaration, but requires running the generator before the gate exists and is nondeterministic.

  **Recorded selection: the recommended option,** a repo-level `.minspec/config.json` list of generated-output roots. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
- **D-4 — Strictness on stale approval for deliverables:** (rec) identical to code (stale denies). Cost: any spec wording edit re-locks deliverable writes until re-approval, which Autopilot must handle by pausing at `human-needed` (DR-036).

  **Recorded selection: the recommended option,** identical to code (stale denies). Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.

## Follow-ups (tracked)

- Plan/tasks/implementation: this issue #233 after approval of this spec.
- Sibling prerequisites: #234, #235, #236, #237, #238 (DR-036).
