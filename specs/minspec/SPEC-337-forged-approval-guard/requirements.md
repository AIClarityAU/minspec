---
id: SPEC-337
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-007  # Agent Execute - Autopilot Mode (DR-036) lives here; this is its must-fix prerequisite A3
aspects: [approval, provenance, gate-integrity, fail-closed, pretooluse, autopilot, security, tier-0]
depends_on: []
relates_to: ["#235", "DR-036", "DR-012", "DR-034", "DR-056", "DR-081", "DR-108", "SPEC-022", "SPEC-069", "#233", "#234"]
implements: none
implements_reason: >-
  Specify phase only (DR-076 / #1169 dispatch for a T3/T4 issue). Which files this spec owns
  is decided at Plan, after Clarify picks the field shape (Q1), when the deny is active (Q2),
  how wide the protected set is (Q3) and whether it ships to adopters now (Q4).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-337: An approval record an agent wrote is not an approval — A3 (forged approvals) guard

Triggered by: [#235](https://github.com/AIClarityAU/minspec/issues/235) — Autopilot Mode
prerequisite A3 (forged approvals), from
[DR-036 (Autopilot Mode — approve once, agents fly the build)](../../../docs/decisions/DR-036.md)
§ "Must-fix prerequisites".

## Why

Autopilot Mode lets agents run phases unattended after one human approval. Everything
downstream trusts "is this spec approved?", and today that answer comes from a JSON file
an agent can write with ordinary tools. A record an agent wrote with a matching hash
resolves to `approved` exactly like one the human made. Autopilot is unsafe until a
forged record is refused.

## Current state (verified 2026-11-16, at base `10a23c80`)

#235 was written against an older approval store. Two of its four steps are already done,
and one of its field names is already taken. This spec is written against the code as it is
now.

| #235 asks for | Today | Evidence |
|---|---|---|
| `approvedBy: human \| blueprint` | **Name already taken.** `approvedBy` is the approver's `git config user.email` (FR-2 of SPEC-022 (attributed approvals)). An agent or bot email is refused on the extension's approve path (DR-056 (agent-proof approver identity)) | `packages/minspec/src/lib/approval.ts:61-70` (record shape), `:478-481` (`assertHumanApprover`), `:534` (called by `approveSpec`) |
| `derivedFrom: <blueprintHash>` | Absent. No Blueprint approval exists in the extension: `grep -ril blueprint packages/minspec/src` returns nothing | grep, this checkout |
| Commit `approvals.json` | **Already done another way.** The single gitignored `approvals.json` was retired. Approvals now live in committed, per-spec sidecar files under `.minspec/approvals/**` (DR-034 (committed path-keyed approvals), SPEC-022). DR-036's own decision table records this | `.gitignore:110-116`; `packages/minspec/src/lib/approval-store.ts:4`; DR-036 "Open decisions" row 1 |
| `spec-gate.py` rejects unverifiable provenance | **Not done.** The gate reads any sidecar whose `specHash` is a string and does not check who wrote it. Its own docstring says writes to `.minspec/` are "always allowed" | `scripts/hooks/spec-gate.py:283-301` (`read_record`), `:40` |
| `resolveStatus` | Compares hashes only. It does not look at provenance | `packages/minspec/src/lib/approval.ts:489-496` |
| PreToolUse deny on `.minspec/config.json` + role prompts | **Not done.** The PreToolUse hooks for Edit/Write/MultiEdit are `spec-gate.sh` and `marker-guard.mjs`. Neither protects these paths | `.claude/settings.json:3-17` |
| Provenance in CI | **Partly built, not wired.** DR-108 (delegated approval) added optional `actor` / `basis` / `act` / `author` / `verdictBy` fields, judged by `scripts/lib/approval-actor.ts`. `scripts/approval-integrity.ts` judges approval PRs. A repo-wide `git grep -l approval-integrity` finds no workflow that runs it. The CI workflow is owned by SPEC-069 (approval-record deterministic witness), which is at `status: planning` | `scripts/lib/approval-actor.ts:1-45`; `scripts/approval-integrity.ts:1-27`; SPEC-069 frontmatter `implements:` |
| Adopter repos get a PreToolUse gate | **No.** The shipped extension writes no PreToolUse hook. `spec-gate.py` is dev-time tooling in this repo only. `PreToolUse` appears once under `packages/minspec/src`, in a comment (`ownership-path-rules.ts:4`) | grep, this checkout |

**Why the gap matters, concretely.** `.minspec/config.json` holds `approvers`, the allowlist
of approver identities (`packages/minspec/src/lib/config.ts:80-97`). `.minspec/delegations.json`
holds the delegations that let `minspec-sdd[bot]` record an approval (DR-108). An agent that
can edit either file can authorise itself. An agent that can write
`.minspec/approvals/<path>.json` does not need to: the local gate never checks who wrote it.

## Threat model and honest limits

**The adversary** is an agent in an autonomous loop. It has Claude Code's Edit, Write,
MultiEdit and Bash tools, and the session's git identity, and it wants a spec to read as
approved without a human act. Its motive is usually not malice. It is "unblock myself": the
same pressure that produced #1816 (agent writes under the founder's account) and DR-056.

**What this spec closes:**
1. The tool path: Edit, Write or MultiEdit on an approval sidecar or a gate-config file.
2. The record path: a sidecar whose provenance does not verify is not counted as approved.

**What it does not close, stated so the control is not read as stronger than it is.** This is
the same disclosure `host-write-guard.py:24-33` makes about its own limits.
- **A Bash write** (`echo … > .minspec/approvals/…`, a script, `python -c`) gets past any
  PreToolUse path matcher. A text-matching Bash guard catches only the honest path, and it
  would also block legitimate `git add` / `git commit` of a founder's approval (Clarify Q5).
- **A forged founder record.** An agent that writes a record carrying the founder's email
  and no `basis` is, byte for byte, a legacy founder record. Nothing offline and local can
  tell the two apart. The independent second witness is CI: SPEC-069's approval-record
  check, which reads who authored and merged the change. That is why FR-6 makes this spec
  depend on that witness and does not claim to replace it (constitution invariant 2: no
  required check hinges on a single producer).

## Functional requirements

**FR-1 — Every approval record states its basis, from a closed set.** The record shape gains
a provenance basis with exactly three forms:
- `founder`: a human approved in the editor. This is the default when the field is absent,
  so every existing sidecar stays valid (DR-108's back-compat rule,
  `scripts/lib/approval-actor.ts:13-16`).
- `delegation:<id>`: the existing DR-108 form, unchanged.
- `blueprint:<blueprintHash>`: a child spec approved because a human approved the Blueprint
  it was generated from. `<blueprintHash>` is the canonical hash of that approved Blueprint.

The field name and encoding are Clarify Q1. Whatever the name, the existing `approvedBy`
field keeps its current meaning (the approver's email) and is never reused for this
enumeration. The extension's *Approve Spec* writes `founder` explicitly from now on.

**FR-2 — One verification predicate, in TypeScript and Python, with tests that compare them.**
`verifyProvenance(record, context) → verified | {unverified, reason}` returns `verified` only
when:
- `founder` (explicit or absent): `approvedBy` passes `checkApprover` (the agent denylist
  plus `MINSPEC_AGENT_IDENTITIES`, `approval.ts:474-481`). If `config.approvers` is set,
  `approvedBy` must also be in it.
- `delegation:<id>`: the local gate cannot check the network witnesses this form needs (the
  CI review run and the comment, `scripts/lib/delegated-approval.ts:12-26`). Locally the
  record is `verified` only if it also passes `checkApprovalActor`'s offline rules: a bot
  actor, a named delegation that exists, author ≠ actor. Otherwise it is
  `unverified: delegation-unwitnessed-locally`. CI does the full check (FR-6).
- `blueprint:<h>`: a Blueprint approval record exists in the store with `basis: founder` that
  verifies under this same predicate, its canonical hash equals `<h>`, and it is not stale.
  Until a Blueprint approval exists in MinSpec (it does not today), every `blueprint:` record
  is `unverified: no-blueprint-approval`. The gate fails closed and never treats an unknown
  form as approved.
- Anything else, including a missing `approvedBy`, an unknown basis form, a non-string field,
  or unparseable JSON: `unverified`, with a reason that names the field.

The Python copy used by `spec-gate.py` and the TypeScript copy used by the extension must
agree on a shared fixture table. Duplicated predicates drift (memory `f-enfo-dont`), so a
parity test is required, not optional.

**FR-3 — `resolveStatus` and `spec-gate.py` count only verified records.** A record that
fails FR-2 resolves to a new status, `unverified`, which is distinct from `unapproved` and
`stale`:
- `spec-gate.py`: the gate denies exactly as it does for `unapproved`, and its deny reason
  names the provenance failure, e.g. `SPEC-NNN (approval record unverified: approvedBy is an
  agent identity)`. "Not approved" and "approved by something that can't approve" are
  different repairs.
- Extension: the spec tree and the validator show `unverified` with the reason. It is never
  shown as approved. Derived status cannot advance past `specifying` on an unverified
  record.
- An error while running the predicate is treated as `unverified` (fail-closed, invariant 2).
  Unlike today's `read_record` fallback (`spec-gate.py:292-301`), it is never "no record,
  carry on".

**FR-4 — A PreToolUse hook denies agent Edit/Write/MultiEdit on the protected set.** A new
hook on the `Edit|Write|MultiEdit` matcher denies any call whose target, resolved to a
repo-relative POSIX path after `..` and symlinks are resolved, is in the protected set. The
deny reason names the file and says the human can edit it in the editor.
- Minimum set (from #235): `.minspec/config.json`, `scripts/roles/*.md`.
- Recommended additions, which are Clarify Q3: `.minspec/approvals/**`,
  `.minspec/delegations.json`, and the hook's own wiring (`.claude/settings.json`,
  `.claude/settings.local.json`, `scripts/hooks/spec-gate.*`, and the new hook file).
- The extension writes approvals through Node `fs`, not through a Claude Code tool call, so
  the human *Approve Spec* path is unaffected by construction. The Plan phase must confirm
  this with a test, not assume it.
- If the hook cannot read its envelope or resolve the path, it denies. It never allows.
- The `spec-gate.sh` kill switch (`MINSPEC_GATE_OFF`) does not turn this hook off. If it
  needs a bypass, it gets its own launcher-set variable, so an agent cannot reach it from
  inside the session (Q2).

**FR-5 — When the deny is active.** This is Clarify Q2. Whatever is chosen, the activation
signal must be something the agent cannot set from inside its own session. An agent's Bash
`export` does not reach the hook process (I believe so; unverified, and Plan must test it).
A value in `.minspec/config.json` is safe only once FR-4 protects that file.

**FR-6 — CI is the second witness, and this spec does not claim to be it.** SPEC-069's
approval-record check runs `checkApprover` / `checkApprovalActor` on every PR that touches
`.minspec/approvals/**`, and it is extended to apply FR-2's predicate, including the
`blueprint:` arm. SPEC-069 owns that workflow file. This spec adds the predicate it calls and
a requirement on it. If SPEC-069 is not merged when this spec reaches Implement, this spec's
Implement phase files an issue to wire it and cites that issue. It does not quietly claim
the A3 attack is closed.

**FR-7 — The T0 regression test from #235.** A test writes a sidecar the way an agent would.
The hash is correct, `approvedAt` is fake, and either `approvedBy` is
`minspec-sdd[bot]@users.noreply.github.com` or `basis` is `blueprint:<hash of nothing
approved>`. The test asserts:
(a) `resolveStatus` returns `unverified`;
(b) `spec-gate.py` denies an Edit to that spec's declared implementation file, with the
    provenance reason;
(c) the same fixture with a verified founder record is allowed.
Each case runs both ways, on the faulted record and on the clean one. A test that only checks
the deny passes even when everything is denied (memory `f-test-can-pass`).

## Acceptance criteria

- **AC-1** The `ApprovalRecord` type and the on-disk reader carry the FR-1 basis. Legacy
  sidecars with no basis read as `founder` and still resolve `approved` when their
  `approvedBy` passes `checkApprover`. A test runs over every sidecar committed in this repo
  and checks that none flips to `unverified` merely because the field is absent.
- **AC-2** "Commit approvals" (#235 step 2) is satisfied by the existing committed
  `.minspec/approvals/**` tree (DR-034). The legacy `.minspec/approvals.json` stays
  gitignored, and **no** status reader takes it as an approval source. A test asserts this.
- **AC-3** `spec-gate.py` denies on an unverified record and names the provenance reason
  (FR-3). Its docstring no longer says writes to `.minspec/` are "always allowed" without
  qualification (stale-comment sweep).
- **AC-4** The FR-4 hook denies Edit, Write and MultiEdit on each protected path, including
  through `../` traversal and through a symlink. It allows a path next to a protected one
  (e.g. `.minspec/config.json.bak`, `scripts/roles/README` if not `.md`). It denies on a
  malformed envelope.
- **AC-5** The FR-7 test exists, fails when the FR-3 check is removed (mutation run recorded
  in the PR), and passes with it in place.
- **AC-6** The FR-2 parity test runs the TS and Python predicates over one shared fixture
  table and fails on any disagreement.
- **AC-7** The "Threat model and honest limits" section above is copied into the hook's and
  the predicate's module docstrings. A reader of the code sees the Bash residual without
  opening this spec.

## Invariants this change must not break

- **Invariant 1 (offline):** the predicate, the gate and the hook make no network call. The
  `delegation:` arm's network witnesses stay in CI (FR-2).
- **Invariant 2 (no silent gate):** every parse or predicate error denies and says why. No
  `|| true`, and no "malformed means no record, continue". CI is an independent second
  witness (FR-6).
- **Invariant 3 (blast radius):** nothing here writes a harness file (`.claude/settings.json`)
  into a repo that has not opted in with `.minspec/`. Whether the hook ships to adopter
  playground repos at all is Clarify Q4.
- **DR-012 / SPEC-022 hash lock:** canonicalisation is untouched. The basis lives in the
  sidecar, not in the spec, so adding it never stales an approval.
- **DR-108 delegated approval** keeps working. `delegated-approval.ts --write` runs through
  Bash and Node `fs` and must not be blocked. A test is required.
- **DR-047 (pairwise doc-before-code):** a spec's own docs stay editable. This spec adds
  protected paths; it never freezes `specs/**`.
- **Human approval UX:** the human's *Approve Spec* flow gains no prompt, step or modal.

## Decisions needed (Clarify)

**Q1 — Name and shape of the provenance field.**
- **a (rec)** Reuse DR-108's existing optional `basis` field and add a third form,
  `blueprint:<hash>`. Absent means `founder`. It is one field with one vocabulary, already
  read by `approval-actor.ts`. *Cost:* the blueprint hash is packed inside a string, so
  readers parse `kind:value`, which `delegation:<id>` already requires.
- b Use #235's literal shape: a new `provenance: human | blueprint` plus `derivedFrom`.
  *Cost:* it overlaps with `basis`, giving two fields that can disagree, and it cannot be
  named `approvedBy` because that name is taken.

**Q2 — When the FR-4 deny is active.**
- **a (rec)** Only when the session's launcher sets `MINSPEC_AUTOPILOT=1` (the dispatcher and
  any Autopilot loop). Interactive sessions and this repo's dev agents, which legitimately
  edit `scripts/roles/**` and `scripts/hooks/**` as their product, are untouched. *Cost:* a
  loop started without the variable is unguarded. That is fail-open on launcher
  misconfiguration, mitigated only by FR-3, which still applies everywhere.
- b Always, in every session in an opted-in repo. *Cost:* in this repo every role-prompt and
  hook change becomes a human-only edit, which works against tenet 1.
- c When `.minspec/config.json` has `autopilot: true`. *Cost:* in this repo, the same as (b)
  once set. Its only advantage over (a) is that it lives in a file.

**Q3 — How wide the protected set is.**
- **a (rec)** #235's two paths, plus `.minspec/approvals/**`, `.minspec/delegations.json`, and
  the hook wiring (`.claude/settings*.json`, `scripts/hooks/spec-gate.*`, the new hook).
  Without these, an agent can edit around the gate: grant itself a delegation, or remove the
  hook. *Cost:* this widens #235's scope (triage rule 2 asks to confirm), and in Autopilot
  sessions an agent can no longer fix the hook wiring itself.
- b Only #235's two paths. *Cost:* the self-delegation and unhook routes stay open, so A3 is
  closed in name only.

**Q4 — Where it ships.**
- **a (rec)** Build it in this repo's dev-time hooks (`scripts/hooks/`, `.claude/settings.json`)
  and the extension's predicate and status now. Shipping the hook to adopter playground repos
  is a follow-up tied to Autopilot Mode itself, which does not exist yet: no Blueprint, no
  loop. *Cost:* the first SourceBridge trial needs that follow-up before it runs, so A3 is
  not "done" for DR-036 until it lands.
- b Ship the hook scaffold to adopters in this spec. *Cost:* it writes `.claude/settings.json`
  in other repos (invariant 3, opt-in-gated), and the design must be made for a Blueprint
  flow that has not been specified.

**Q5 — A Bash text guard on approval-path writes.**
- **a (rec)** No. State the Bash residual (done above) and rely on CI (FR-6). *Cost:* an agent
  that writes the file from Bash still produces a local "approved" until CI sees the PR.
- b Yes, `host-write-guard.py`-style. *Cost:* it catches only honest commands, false-blocks
  `git add` / `git commit` of real founder approvals, and has to be maintained.

## Out of scope

- The Blueprint approval itself (`MinSpec: Approve Blueprint`, DR-036). This spec only
  defines how a record cites one, and refuses every such record until one exists.
- A1 (deliverable registry, #233), A2 (external pipeline-state file, #234), and A4
  (prototype digest inline in overview, #236).
- Wiring the SPEC-069 CI workflow (owned by SPEC-069).

## Follow-ups (tracked)

- Shipping the FR-4 hook to adopter playground repos depends on Q4. If Q4=a, Clarify files
  the issue and cites it here before Plan starts.
- The CI second witness is SPEC-069 (approval-record deterministic witness).
