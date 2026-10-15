---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — the frontmatter a spec carries and the gate that checks it says true things
relates_to: [SPEC-022, SPEC-042, SPEC-054, DR-012, DR-034, "#974", "#1510", "#971"]
---

# SPEC-137: A spec's approval-location notice must name the file that holds its record, and a gate must check it

Issue: [#974](https://github.com/AIClarityAU/minspec/issues/974). Design rests on DR-034 (path-keyed
sidecar store, SPEC-022) and DR-012 (hash lock). **Specify only — no code is authorised by this document.**

## In plain terms

Eleven spec files still say their approval is recorded in `.minspec/approvals.json[SPEC-NNN]`. It is not:
approvals live in one committed sidecar per spec. Two reviewers on #971 trusted the notice and concluded
the store did not exist. New specs already get a correct notice; the old ones are wrong, and nothing
checks a notice against reality. Cost: correcting an existing notice is a hashed edit, so it stales that
spec's approval and each needs a re-approve. Riskiest assumption: the founder accepts 10 re-approvals
(or the cheaper option below).

## Verified current state (checked against the tree, not the issue text)

- **The emitter exists** — `hashLockReminder` (`packages/minspec/src/lib/approval-store.ts:51`), called only
  from `createSpec` (`spec-manager.ts:339`), shipped by #1510. Issue item 2 is therefore already done
  for NEW specs; what remains is the existing copies.
- **11 files / 10 spec directories** still contain `approvals.json[` (`grep -rl 'approvals.json\[' specs`).
  The issue's "12+" and its list are non-exhaustive; the grep is the authority.
- **The legacy `.minspec/approvals.json` is gitignored and was never tracked** (`approval-store.ts:30-34`,
  `.gitignore:92`; SPEC-042 header says the same). The issue's "it does exist, 16 records" holds only on
  one machine; in a checkout it is absent. So FR-4's "migrate or freeze" is moot for the repo: there is
  nothing tracked to migrate.
- **A full-line `#` comment in frontmatter is hashed**; only `status` and `phases` are stripped
  (`approval-store.ts:36-46`). Correcting the notice in an approved spec voids its approval (DR-012).
- 37 spec files total mention `approvals.json`; many are prose describing the legacy store, not a
  pointer, and are out of scope unless the gate (FR-3) flags them.

## Functional requirements

- **FR-1 — Correct the pointer.** Each spec file whose lock notice names `.minspec/approvals.json[...]`
  is changed to the text `hashLockReminder(<its own path>)` would emit, or the path-agnostic form (see
  Decision D-1). The exact file list is computed by the FR-3 gate, not hand-maintained.
- **FR-2 — One source of wording.** The notice wording stays defined once, in `hashLockReminder`; FR-1
  copies are byte-for-byte what it returns (no third wording). The next store move changes that function
  and the FR-3 gate lists every spec to refresh.
- **FR-3 — Gate.** The spec validator reports, per spec file, any frontmatter lock notice that names an
  approval location not holding that spec's record: (a) a `.minspec/approvals.json` pointer, or
  (b) a sidecar path that does not equal `sidecarPath(<spec path>)`. Severity: warning initially so the
  11 existing files do not fail every PR before they are fixed; promoted to error once the corpus is
  clean (`npm run validate` then fails closed).
- **FR-4 — Fail visibly.** An unreadable spec or unresolvable path in the gate is reported as a finding,
  never skipped (constitution invariant 2).
- **FR-5 — Legacy store.** No migration. Record, in the spec/DR text only where the notice is explained,
  that `.minspec/approvals.json` is a gitignored, untracked, frozen legacy artefact and never a record.

## Acceptance criteria

- AC-1: after the change, `grep -rl 'approvals.json\[' specs` returns nothing.
- AC-2: a fixture spec whose notice names `.minspec/approvals.json[SPEC-X]` produces a gate finding; one
  naming its own correct sidecar produces none; one naming a *different spec's* sidecar produces one.
- AC-3: `hashLockReminder(p)` output passes the gate for `p` (round-trip test, so the emitter and checker
  cannot drift apart).
- AC-4: for each touched approved spec, `status` reflects honest lifecycle after the edit (set to
  `specifying` until re-approved, per the stale-approval rule) and no approval is forged or hand-edited.
- AC-5: the gate emits no finding on specs with no lock notice (older/stub specs are not newly failed).

## Invariants this must not break

- INV-1 Offline: the gate reads local files only (invariant 1).
- INV-2 No silent gate: FR-4; no `|| true`; a missing witness is a finding (invariant 2).
- INV-3 Never hand-write a sidecar or `status` to paper over a stale hash (DR-012).
- INV-4 Existing approved bytes change only through a deliberate re-approve; the change must not be
  made as a bulk rewrite that quietly stales approvals nobody then re-signs.
- INV-5 Blast radius: the gate runs only where `.minspec/` exists (invariant 3).

## Decisions needed (Clarify)

- **D-1 — Pointer text.** (a) **(rec)** Exact `hashLockReminder` output per file: unambiguous, a reader
  can click it; cost: it names a path, so it rots again if sidecars move (the gate then catches it).
  (b) Path-agnostic wording ("this spec's approval record, see the approvals dir"): never rots; cost: the
  signpost is vaguer and the gate has little to compare.
- **D-2 — How to pay the re-approval cost.** Editing the comment stales 10 approved specs.
  (a) **(rec)** Fix all 11 files in one PR and re-approve in a batch; cost: ten sign-offs for a comment
  change, and the founder must read them. (b) Teach `canonicalizeSpec` to strip the lock-notice comment
  from the hash so this and future notice edits are free; cost: changes the hash definition, which stales
  EVERY approval once (worse now) and weakens "any edit voids" — a DR-worthy, one-way decision.
  (c) Leave the old copies and rely on the gate warning only; cost: the false signpost that caused #971
  stays in 11 files.
- **D-3 — Gate severity timing.** Warning now, error after cleanup **(rec)**, cost: a warning can be
  ignored for a while; vs error immediately, cost: red on every PR until D-2 is paid.

## Follow-ups (tracked)

None beyond this spec: #974 (this), #1510 (emitter, shipped, retrofit half = FR-1).
