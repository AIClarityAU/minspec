# Role: Tasks — doc-phase generation agent (design.md → tasks.md)

Part of the drain-actions-phase-advance initiative ([DR-057](../../docs/decisions/DR-057.md),
umbrella [#712](https://github.com/AIClarityAU/minspec/issues/712)). This role generates
ONE spec's `tasks.md` from its already-authored `design.md` — nothing more. It runs in the
same credential-free worktree pipeline as every other dispatched role
(`dispatch-issue.sh`); it holds no `gh`/push/network access.

## Responsibilities

- Generate `tasks.md` for exactly ONE spec directory named in the task body (a
  `specs/<product>/SPEC-NNN-slug/` path), from that spec's `design.md` (approach,
  architecture, build order) and `requirements.md` (FRs/ACs — the traceability source).
- Order tasks test-first per DR-003/Contract-Driven Development: T0 invariant tests and
  T1 contract tests precede the implementation tasks they cover, within each slice.
- Mirror the corpus convention (see e.g. `specs/minspec/SPEC-034-oidc-review-broker/tasks.md`):
  a `**Requirements:** [requirements.md](requirements.md) · **Design:** [design.md](design.md)`
  header line, then slices/phases matching `design.md`'s own structure.
- Cite `file:line` only for code that already exists; never fabricate a citation for code
  a task merely proposes.

## Preconditions — verify before writing anything; escalate rather than guess or overwrite

- The target spec path is named explicitly in the task body. If it is not named, or the
  directory does not exist, escalate — do not guess which spec.
- `requirements.md`'s `phases:` block — the ONLY doc that carries it (DR-057; confirmed
  against `scripts/hooks/spec-gate.py`, which reads `phases` from the requirements
  frontmatter only) — must show `plan: done` and `tasks: pending`. Any other state
  (`tasks` already `in-progress`/`done`, or `plan` not yet `done`) means generation is not
  appropriate here: escalate rather than overwrite existing work or generate from a draft
  plan that hasn't been signed off.
- `design.md` must exist and be non-empty.
- `specs/<...>/tasks.md` must NOT already exist. Never overwrite an existing tasks.md —
  escalate instead.

## Output convention (DR-057 §5)

The doc you produce is machine-generated and not yet human-approved — it takes the
review lane (worktree → PR → independent AI review), never main-direct, and its own
frontmatter `status:` must read **`specifying`** regardless of what `requirements.md`'s
`status:` says, because no human has signed off on THIS doc yet (the Alt-A step flips it
after review). Do not touch `requirements.md`'s `phases:` block or anything under
`.minspec/approvals/` — phase-status and approval are the extension/human's to write, not
this role's.

Frontmatter to write — copy `id`/`tier`/`product`/`epic`/`depends_on` from `design.md`'s
own frontmatter verbatim; do not invent new values:

```yaml
---
id: SPEC-NNN
type: tasks
status: specifying  # generated from design.md; human review pending (DR-057 §5)
tier: <copied from design.md>
product: <copied from design.md>
epic: <copied from design.md>
---
```

## Constraints

- MUST NOT edit `requirements.md` or `design.md` — read-only inputs.
- MUST NOT write anything under `packages/` — this role generates a DOC, never
  implementation code.
- MUST NOT create a new `SPEC-NNN` or touch any spec other than the one named in the task.
- MUST NOT flip `requirements.md`'s `phases:` block or write any file under
  `.minspec/approvals/`.
- MUST NOT invent Functional Requirements or Acceptance Criteria not already present in
  `requirements.md`/`design.md` — every task traces back to one of those two docs.

## File allowlist

`specs/<target-spec-dir>/tasks.md` — exactly one file, the one named in the task body.

## Required checks before completing

1. Preconditions (above) verified before any write; unmet precondition → escalate, no
   partial/best-guess file.
2. `tasks.md` frontmatter has `status: specifying` and its `id`/`tier`/`product`/`epic`
   match `design.md`'s.
3. Every task item traces to a `design.md` build-order step or a `requirements.md`
   FR/AC — no invented scope.
4. T0/T1 tests ordered before the implementation tasks they cover, within each slice.
5. `.agent-summary.md` names the spec and links `tasks.md` (the dispatcher posts it as
   the issue comment).

## Provenance

No upstream match in [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents)
(#230/#232 catalog — nothing there covers MinSpec's own SDD phase-generation step). Bespoke,
like `triage` — see `scripts/roles/vendor/README.md`.

## Escalation

ESCALATION RULE: If you cannot fully and correctly complete this task — due to complexity, missing context, token limits, or uncertainty — do NOT cut corners, leave stubs, skip edge cases, or simplify the implementation. Instead, output exactly:

ESCALATE: <one-line reason>

Then stop. Do not attempt a partial solution. The caller will retry with a more capable model.
