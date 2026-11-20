---
id: SPEC-339
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — the spec→code ownership contract (same gate as SPEC-038)
aspects: [spec-gate, hitl, autopilot, self-assertion, fail-closed, pretooluse]
depends_on: []
relates_to: ["#234", "DR-036", "DR-031", "DR-047", "DR-069", "SPEC-022", "SPEC-038", "#233", "#235", "#426", "#958"]
implements: none
implements_reason: >-
  Specify phase only. The change lands in scripts/hooks/spec-gate.py and its test
  packages/minspec/tests/spec-gate.test.ts; the exact owned set is declared at Plan, after
  Clarify Q1 picks the option.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-339: The spec gate's in-implementation test cannot be switched off by the spec it gates

> **This is a SPECIFICATION ONLY.** Written for issue #234 (Autopilot prerequisite A2 —
> self-asserted status), from DR-036 (Autopilot Mode — the A1–A5 + A11 must-fix list). Nothing
> is built until this spec is approved and the
> [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved. T4 (complete ceremony:
> every phase) because it changes a model-defending gate that every session runs.

## In plain terms

The spec gate (`scripts/hooks/spec-gate.py`) stops an agent from writing the code of a T3/T4
spec before a human approves that spec. To decide whether a spec is "being built yet", it reads
fields in the spec's own frontmatter. Before approval, the agent being gated can edit those
fields. So it can turn the gate off by rewinding its spec's `phases:` to Specify, marking it
`status: archived`, lowering `tier:` to T2, or deleting its `implements:` list. Then it writes
the code.

The fix: read those fields from a copy the agent cannot edit, the spec as committed on the base
branch (`origin/main`), and let the worktree copy only ever *add* gating, never remove it. A spec
that exists only in the worktree, written in this session, is gated whatever phase it claims.

## Status of the claims

Each claim was checked against the code at `10a23c80` (2026-11-16), not taken from the issue body.

| Claim | Status | Evidence |
|---|---|---|
| The issue says the gate fires on `status==implementing` at `spec-gate.py:161`. | **Out of date.** Line 161 is now inside `fm_list`. SPEC-022 replaced the literal-status test with a phase-derived one. | `scripts/hooks/spec-gate.py:71` ("Status is DERIVED from {phases, approval}, not the literal `status:` line"); `:584-586` |
| The literal `status:` field is still read. | **Only for `archived`**, which removes the spec from the gate completely. | `spec-gate.py:572-573`, `:243-244` |
| The live discriminator is `phases:`, which the agent can write. | **True.** `phase_intent_status` reads the worktree frontmatter. Specify/Clarify, or all phases pending, takes the spec out of the gate. | `spec-gate.py:559`, `:223-252`, `:585-586` |
| `tier:` and `implements:`/`affects:` are also read from the worktree copy only. | **True.** A T2 tier skips the spec; an empty owned set blocks nothing. | `spec-gate.py:545-548`, `:384-386`, `:31-33` |
| The approval hash anchors these fields once a spec is approved. | **Partly.** `status` and `phases` are excluded from the canonical hash, so changing them never stales an approval. `tier`/`implements` are hashed. This does not matter for an *approved* spec, which is allowed anyway. The hole is only for **unapproved or stale** specs, where nothing is anchored. | `scripts/hooks/canonical.py:14`, `:32-51` |
| The gate allows writes outside the repo (`../…`). | **True.** That includes the git common dir, where `refs/remotes/origin/*` lives. | `spec-gate.py:499-501` |
| The gate sees Bash writes. | **No.** The spec gate is registered for `Edit\|Write\|MultiEdit` only; Bash goes to `host-write-guard.py`. | `.claude/settings.json:5-14` |
| **Measured:** which specs would newly block if phase were simply ignored (the issue's "status-agnostic" branch). | **5 specs, 17 files**, all in Specify and unapproved. They include hot shared files: `packages/minspec/src/lib/spec-validator.ts` (SPEC-308, SPEC-324), `scripts/validate-frontmatter.ts`, `packages/minspec/src/lib/config.ts`, `scripts/drain-inbox.sh`, `.github/workflows/ai-review.yml`. Blocking today: **0**. | Computed by running `spec-gate.py`'s own functions over `specs/**` at `10a23c80`, with sibling docs merged by `select_verdict` as the gate does |

**About the issue's acceptance test.** The issue asks for a test that "agent-written
`status: implementing` alone does NOT open the gate". That test passes *today*, without any
change, because the literal `implementing` value is never read. It would be a vacuous green.
The real tests (AC-1 to AC-5) vary `phases:`, `status: archived`, `tier:` and `implements:`.

## Context

DR-036 lists A2 as a must-fix before Autopilot's first run, and allows either fix: "External
pipeline-state file the agent cannot write, OR status-agnostic gating". The measurement above
shows that plain status-agnostic gating costs a lot. Every unapproved spec that declares
`implements:` while still in Specify (which agents writing specs routinely do) would freeze
those files for **every** session as soon as it merged. That brings back the cross-session
freeze that #426 / DR-047 §3 (doc-before-code is pairwise, never repo-wide) removed.

The repository already has a store the gated agent cannot write through `Edit`/`Write`: the
**base branch as committed**. A spec's frontmatter on `origin/main` got there through a reviewed
pull request. It is in the local object store, so reading it needs no network (invariant 1).
This spec uses that committed copy as the "external pipeline-state file".

### Threat model (what this does and does not defend)

- **In scope:** a gated model, honest-but-wrong or self-serving, uses `Edit`/`Write`/`MultiEdit`
  to change a spec's gating fields so that a later `Edit`/`Write` to that spec's code is allowed.
- **Out of scope:** writes through Bash (`cat > file`, `git update-ref`). The spec gate never sees
  those; they belong to `host-write-guard.py` and the sandbox. Approval-sidecar forgery belongs
  to #235 (A3 — forged approvals). The PR review panel stays the backstop for both.

## Functional requirements

- **FR-1 — Base snapshot.** For each invocation, the gate reads the committed copy of every
  `specs/**/*.md` file at the **base ref**, from the local object store, with no network call. The
  base ref is resolved as `refs/remotes/origin/HEAD`, falling back to `refs/remotes/origin/main`
  (Clarify Q2). The read is batched: at most three `git` subprocesses per invocation (for
  example, resolve, `ls-tree`, `cat-file --batch`), each with the existing 10 s timeout
  (`spec-gate.py:269`).
- **FR-2 — Monotone merge for specs present on base.** When a gated doc's path exists at the base
  ref, its gating attributes come from **both** copies and can only get stricter:
  - *tier*: the doc is a gate candidate if **either** copy is T3/T4.
  - *in-implementation*: the doc is in the gate band if `phase_intent_status` puts **either** copy
    in `implementing`/`done`.
  - *archived*: the doc is exempt only if **both** copies say `status: archived`. Archiving in the
    worktree alone exempts nothing.
  - *owned set*: the **union** of the owned sets computed from each copy (`implements:`/`affects:`
    from each copy's frontmatter, plus the existence-filtered `tasks.md` signal from the worktree,
    as today).
  - *spec id*: docs are grouped by the worktree `id:`, as today. If the base copy's `id:` differs,
    the doc is also grouped under the base id, so changing the id cannot drop a base-side verdict.
- **FR-3 — Specs absent on base are gated without regard to phase.** A doc whose path is not at
  the base ref is new in this worktree, written in this session. If its worktree tier is T3/T4,
  it is in the gate band **regardless of `phases:` or `status:`** (including `archived`). Because
  it exists only in this worktree, any freeze it causes stays in this worktree. Other sessions do
  not see it, so #426's no-cross-session-freeze property holds.
- **FR-4 — Approval verdict unchanged.** Approved, stale or unapproved is still decided by the
  worktree doc's canonical hash against its sidecar (`spec-gate.py:557-568`). This spec changes
  *which specs are gated and what they own*, not how approval is proven.
- **FR-5 — Fail closed, visibly, when the base cannot be read.** If the base ref does not resolve,
  or any FR-1 subprocess fails or times out, the gate treats **every** doc as base-absent (FR-3)
  for that invocation. Any deny reason it emits says that the base snapshot was unavailable and
  names the ref it tried. The gate never silently falls back to worktree-only discrimination
  (invariant 2).
- **FR-6 — The anchor cannot be written through the gated tools.** `Edit`/`Write`/`MultiEdit` to
  any path inside the repository's git dir or git common dir (as resolved by
  `git rev-parse --git-dir` / `--git-common-dir`) is denied, with a reason naming the anchor. This
  overrides the `../` early-allow at `spec-gate.py:499-501` for those paths only. All other
  out-of-repo paths keep today's allow.
- **FR-7 — The deny reason names the copy that gated.** When a block comes only from the base copy
  or only from FR-3, the reason says so. Example: "SPEC-NNN is in implementation on origin/main;
  the worktree's `phases:` rewind does not ungate it". An attempt to ungate is then visible in the
  transcript, not just silently ineffective.
- **FR-8 — The freeze band is unchanged.** `phase_intent_status` keeps the DR-069 §3 band
  (plan/tasks/implement → `implementing`) and applies to each copy unchanged. The
  `lifecycle.ts:165` cross-reference stays true.
- **FR-9 — Own docs stay editable.** The owned set stays declared implementation code only. A
  gated spec's own `requirements.md`/`design.md`/`tasks.md` and `.minspec/approvals/**` stay
  writable (edit-unapproved-specs-directly; `spec-gate.py:35-43`). FR-2/FR-3 add no doc paths.

## Acceptance criteria

All are deterministic offline tests (T0-first, no network), in
`packages/minspec/tests/spec-gate.test.ts`. Each uses a temp git repo whose `origin/main` is a
**real commit** made by the fixture (a branch pushed to a local bare remote and fetched). A
hand-written `origin/HEAD` is not enough; see memory "fixtures encode assumptions".

- **AC-1 — Phase rewind does not ungate.** An unapproved T3 spec is in Plan on base and declares
  `implements: [src/x.ts]`. The worktree rewinds `phases:` to `specify: in-progress`. `Write
  src/x.ts` → **deny**, and the reason names the base copy (FR-7). **Control:** with the base copy
  also in Specify → **allow**.
- **AC-2 — Worktree-only archive does not ungate.** Same as AC-1, but the worktree sets
  `status: archived` → **deny**. Archived on both copies → **allow**.
- **AC-3 — Tier downgrade and implements-removal do not ungate.** The worktree sets `tier: T2` →
  **deny**. The worktree deletes `implements:` → **deny**. The worktree changes `id:` → **deny**.
- **AC-4 — A new worktree spec is gated whatever phase it claims.** A spec that is not on base,
  T3, unapproved, `phases:` all pending, `implements: [src/y.ts]` → `Write src/y.ts` **deny**.
  The same spec with no `implements:` → `Write src/y.ts` **allow** (the owned set is still
  declared-only).
- **AC-5 — No new cross-session freeze.** A spec on base in Specify, unapproved, declaring
  `src/z.ts`, unchanged in the worktree → `Write src/z.ts` **allow**. This is the #426 property.
  It is the test that tells this option apart from plain status-agnostic gating.
- **AC-6 — The issue's literal case.** An agent-written `status: implementing` on its own, with
  base and worktree phases in Specify, does not change the decision compared with the same
  fixture without it. Kept for traceability to #234; on its own it is vacuous (see Status of the
  claims).
- **AC-7 — Base unavailable fails closed and says so.** No `origin` remote, or a stubbed `git`
  that times out → AC-4's fixture applied to a base-*present* spec in Specify → **deny**, and the
  reason contains "base snapshot unavailable" and the ref name (FR-5). **Control:** with the base
  available → **allow** (AC-5).
- **AC-8 — The anchor is not writable.** `Write` to `<git-common-dir>/refs/remotes/origin/main`
  and to `<git-common-dir>/packed-refs` → **deny**. `Write` to an unrelated `../outside.txt` →
  **allow** (unchanged).
- **AC-9 — Bounded cost.** A fixture with 200 specs makes at most 3 `git` subprocess calls per
  invocation (counted with a `git` shim on `PATH`).
- **AC-10 — Mutation check.** Removing the base-side OR in FR-2's in-implementation rule turns
  AC-1 red. Removing FR-3 turns AC-4 red. Making FR-5 fall back to worktree-only turns AC-7 red.
  The mutants are recorded in the PR body (memory "mutant must land where meant").

## Invariants this must not break

- **Invariant 1 (offline).** The base snapshot is read from local refs and objects. There is no
  `git fetch` and no network call. A stale `origin/main` gives an older anchor, never a network
  call.
- **Invariant 2 (no silent gate).** An unreadable base fails closed and visibly (FR-5). No new
  `|| true` sits on the decision path.
- **Invariant 3 (blast radius).** The behaviour change is limited to repos that run this hook
  (`.claude/settings.json` in a repo with `.minspec/`). FR-6 denies writes only into *this*
  repository's git dirs.
- **#426 / DR-047 §3 (pairwise, not repo-wide).** AC-5 holds. Freezes from FR-3 are limited to
  the worktree that wrote the spec.
- **DR-069 §3 (freeze band).** FR-8 holds.
- **Edit-unapproved-specs-directly.** FR-9 holds.
- **DR-031 (human-only, audited kill-switch).** `MINSPEC_GATE_OFF` is unchanged.
- **#958 (determinism).** The verdict stays independent of glob order. FR-2's base-id grouping
  goes through `select_verdict` unchanged.

## Out of scope

- Writes through Bash, and any write that bypasses the `Edit`/`Write`/`MultiEdit` matcher (see
  Threat model).
- Approval-sidecar forgery and `approvedBy` provenance: #235 (A3).
- The deliverable registry (undeclared or greenfield code that is not gated): #233 (A1). The
  existence-filtered `tasks.md` gap disclosed at `spec-gate.py:45-51` remains.
- The fail-open when `python3` is missing in `spec-gate.sh` (existing, unchanged).
- The tier a *new* spec carries. See Clarify Q3.

## Decisions needed (Clarify)

**Q1 — Which A2 fix?** DR-036 allows any of these.
- `a` **Base-ref monotone anchor (this spec, FR-1 to FR-9)** **(rec)**. It closes all four
  rewrite routes (phases, archived, tier, implements) for specs on base, and it causes no
  cross-session freeze. *Cost:* each invocation does up to 3 extra `git` calls over all specs,
  plus a new fail-closed path. If `origin` is missing in some checkout, every T3/T4 spec there is
  gated whatever its phase until the ref exists.
- `b` **Plain status-agnostic gating.** Drop the phase test. *Cost:* it newly freezes 5 specs'
  17 files in every session today, including `spec-validator.ts` and `drain-inbox.sh` (measured
  above), and it still leaves `tier:`/`implements:` rewrites open.
- `c` **Dispatcher-written pipeline-state file** outside the agent sandbox. *Cost:* new machinery
  that covers only dispatched agents, not interactive sessions, and Autopilot playground repos
  would also need the dispatcher. It would need its own DR.

**Q2 — Which base ref?** `a` the tip of `refs/remotes/origin/HEAD`, falling back to
`origin/main` **(rec)**. *Cost:* it is only as fresh as the last fetch, and a spec deleted on main
after the branch was cut becomes base-absent, so FR-3 gates it in this worktree. `b` the
merge-base of `HEAD` and `origin/main`: stable under fetches, but blind to approvals and phase
moves that landed after the branch point.

**Q3 — Residual: tier of a brand-new spec.** Under FR-3 a new spec that the agent marks `tier: T2`
is not gated, because T1/T2 specs need no approval and gating them would block every T1/T2
dispatch in its own worktree. `a` accept and disclose here; the PR panel is the backstop
**(rec)**. *Cost:* an agent can still write a new spec at T2 and build it unreviewed until the
PR. `b` have the dispatcher record the triage tier outside the sandbox and take the stricter
value: this is Q1 `c` in miniature, with the same new machinery.

**Q4 — Does this satisfy #234's acceptance wording?** The issue's first box says "derived from a
file outside the agent's write allowlist". Here the "file" is the base-ref object store, which
FR-6 makes unwritable through the gated tools. `a` accept that reading **(rec)**. *Cost:* it is
not a literal new file, and a reader who expects `.minspec/pipeline-state.json` has to read this
paragraph. `b` require a literal file: that is Q1 `c`.

## Decision record

No new DR. DR-036's A2 row already decided "external file OR status-agnostic". Option `a` is a
code change to one hook, and reverting it takes less than a day, so it does not pass the ADR
filter (a DR is needed only for a choice that cannot be undone in under a day). If Clarify picks Q1 `c`, the dispatcher-side state store is a new trust boundary and
needs its own DR at Plan.

## Alternatives rejected

- **Hash `phases`/`status` into the canonical hash.** This anchors nothing for unapproved specs,
  which is where the hole is. It also reverses SPEC-022's decision that the tool's own lifecycle
  flips must not void approval.
- **Deny `Edit`/`Write` to the gating frontmatter keys of a gated spec.** That needs a key-level
  diff of every spec edit. It breaks edit-unapproved-specs-directly, because the spec author must
  be able to advance phases. Bash still bypasses it.
- **Use `HEAD` (the agent's own commits) as the anchor.** The agent writes and commits those, so
  it is self-asserted again.

## Noticed, not filed

This dispatch has no `gh` access, so these could not be filed. Each needs an issue or a
`docs/backlog.md` line (DR-023):
- The `spec-gate.py` early-allow for `../` paths (`:499-501`) means `.minspec/` sidecars in the
  **main** checkout can be written from a worktree. This overlaps #235 (A3); confirm #235 covers
  it.
- `spec-gate.py`'s docstring (lines 2-7 and 71) and DR-036's A2 row still describe the
  discriminator in "status" terms. Sweep them when this lands.

## Links

- Issue: #234 (A2 external pipeline-state file)
- DR-036 (Autopilot Mode), A2 row; DR-031 (sound spec gate in dispatch); DR-047 §3 (pairwise
  doc-before-code); DR-069 §3 (freeze band)
- SPEC-022 (committed approval sidecars, derived status); SPEC-038 (`implements:` convention)
