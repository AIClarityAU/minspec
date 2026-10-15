---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - un-materialized DR follow-ups are invisible to the next-task DAG
aspects: [decision-records, follow-ups, auto-create, consent, offline, idempotent, no-silent-gate]
depends_on: [DR-040, DR-023]  # DR-040 is the accepted decision this spec implements; DR-023 owns the section it acts on
relates_to: [DR-019, DR-004, DR-059, "#263", "#87"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: DR follow-ups file themselves - missing issues are created on DR save, no gate and no friction

Implements issue #263 under DR-040 (accepted). Hardens DR-023 (follow-ups must be tracked)
without adding a blocking gate. Supersedes the soft-warning step of #87.

## In plain terms

When you save a decision record, every bullet under `## Follow-ups (tracked)` that points
at nothing gets a GitHub issue filed for it, and the new `#N` is written back into the
bullet. You see a filled-in section; nothing blocks and nothing prompts. A bullet whose
ref is written but does not resolve is a mistake we cannot guess at, so it is reported,
never "fixed" by filing something.

## Scope

In: scanning the `## Follow-ups (tracked)` section of `docs/decisions/DR-*.md`, classifying
bullets, filing issues for the un-materialized ones, writing refs back, idempotency, and
the CI backstop. Out: any other section (`## Consequences`, prose), commit-message
deferrals (DR-059), LLM polishing of issue text, trackers other than GitHub.

## Functional requirements

- **FR-1 Classify each bullet.** Within `## Follow-ups (tracked)` only, every top-level
  bullet is exactly one of: *materialized* (carries a ref that resolves), *dangling*
  (carries a ref that does not resolve), *un-materialized* (carries no ref), or *none*
  (the section is the explicit `None`). The classifier is a pure function of DR text plus
  a resolver result, so it is testable without network.
- **FR-2 Auto-create for un-materialized bullets.** For each un-materialized bullet, file
  one GitHub issue from the bullet text (title: first sentence, trimmed; body: full bullet
  plus a link back to the DR and DR-040) and write `[#N](url) -` in front of the bullet,
  in place. Nothing else in the file is touched.
- **FR-3 Dangling refs are surfaced, never filed.** A bullet with a ref that does not
  resolve (deleted or mistyped `#N`, `SPEC-NNN` not in the index) yields a visible
  diagnostic naming DR, line and ref. No issue is created for it (DR-040 section 2).
- **FR-4 Scope is the curated section.** No other part of the DR is scanned or edited
  (DR-040 section 3). Nested sub-bullets belong to their parent bullet and are not
  filed separately.
- **FR-5 `None` is a no-op.** No issue, no warning (DR-040 section 4).
- **FR-6 Idempotent.** Re-saving never files a second issue for the same bullet. A bullet
  that already has a written-back ref is skipped; if the write-back failed after filing,
  the next run finds the earlier issue by a stable marker (hash of DR id + normalized
  bullet text) embedded in the issue body and reuses it instead of filing again (DR-040
  R1). Matching is by bullet identity, not position.
- **FR-7 Failure is visible, never silent.** If filing fails (no `gh`, no auth, offline,
  rate limit) the bullet is left untouched and a visible diagnostic says so. A failed
  run must not look like a clean run (constitution invariant 2).
- **FR-8 Two surfaces, one engine.** The editor save path and the CI backstop call the
  same classifier and the same filer. The editor path is the convenience; CI is the
  authoritative check that no un-materialized bullet reaches main. CI reports without
  filing unless the Clarify decision below says otherwise.
- **FR-9 Visible in the diff.** The only side effect on the working tree is the
  written-back ref; the human sees it before committing (DR-040 R2).
- **FR-10 Repo scope.** Issues are filed only in the repository the DR lives in, resolved
  from the workspace's own git remote - never a repo named by DR content.

## Acceptance criteria

- AC-1 (FR-1,FR-2): a DR with one bullet lacking a ref, saved with a stubbed filer,
  results in one filer call and the bullet rewritten with the returned `#N`.
- AC-2 (FR-3): a bullet citing `#999999` that the resolver reports missing produces one
  diagnostic and zero filer calls.
- AC-3 (FR-4): an un-ref'd bullet under `## Consequences` produces zero filer calls.
- AC-4 (FR-5): a section containing only `None` produces zero calls and zero diagnostics.
- AC-5 (FR-6): saving the same DR twice yields one filer call; a simulated write-back
  failure followed by a re-save reuses the marked issue rather than filing a second.
- AC-6 (FR-7): with the filer throwing, the DR bytes are unchanged and a diagnostic is
  emitted.
- AC-7 (FR-8): the editor path and the CI path produce identical classifications for the
  same DR text (parity test).
- AC-8 (FR-10): the repo argument passed to the filer equals the workspace remote, not
  text found in the DR.

## Invariants the change must not break

- INV-1 Offline core (constitution 1). Classification and write-back are offline; only the
  filing step touches the network, and only under the consent resolved in Clarify Q1.
- INV-2 No silent gate (constitution 2). Failure to file, to resolve, or to write back is
  reported; a run that could not evaluate never reads as "all materialized".
- INV-3 Blast radius (constitution 3). Active only where `.minspec/` exists at the repo
  root; touches only `docs/decisions/` DRs of that repo.
- INV-4 No new blocking gate: nothing here may reject a save or a commit (DR-040).

## Decisions needed (Clarify)

**Q1 - Consent for the outward network call (conflicts with invariant 1).** DR-040 says
"no prompt", but constitution invariant 1 forbids network calls "without explicit user
consent", and DR-040 itself calls issue-filing on save an outward side effect.
- (a) **One-time opt-in setting** (e.g. `minspec.followUps.autoCreate`, default off),
  asked once via the existing one-time-consent pattern, silent afterwards. **(rec)** Keeps
  invariant 1 intact and costs one prompt per machine; until opted in, the feature is a
  surfaced warning, so adopters who never opt in get DR-023's old behaviour.
- (b) Default on, no consent. Zero friction, but breaks invariant 1; would need a DR
  amending the constitution - rejected.
- (c) Per-save confirmation toast. Honest, but is the friction DR-040 rejects.

**Q2 - Does CI file issues or only report?** CI-side filing needs a token with
issue-write and would commit nothing back (a CI job cannot edit the author's branch
safely).
- (a) **Report only, as an advisory (non-required) check** (rec): matches DR-040's "no
  gate"; a failing required check would be the second blocking gate DR-040 rejected. Cost:
  a PR can still merge with an un-materialized bullet if the author never saved in the
  editor.
- (b) CI files and pushes the ref back. Closes the hole, but needs write tokens and a
  bot commit onto PR branches - larger blast radius, and DR-040's "single DR approval"
  surface gets an unattended writer.

**Q3 - Issue quality.** Title = first sentence of the bullet, labels = `inbox`?
- (a) **Title and body from bullet, label `inbox`** (rec): lets existing triage pick it
  up; cost: floods triage if an author lists many items.
- (b) No label; cost: invisible to the triage queue, defeating the DAG goal (DR-019).

**Q4 - Where does the "save" hook live?** The extension's save handler
(`packages/minspec/src/extension.ts`) fits the editor path; headless/agent sessions have
no editor. Options: extension-only (rec; matches DR-040 "editor path is convenience")
with the CI report as the backstop for headless authors, or additionally a command
`MinSpec: Materialize DR follow-ups`. Cost of extension-only: agent-authored DRs rely on
CI. The command is cheap and recommended as a follow-up, not part of this spec.

## Follow-ups (tracked)

- #263 - this spec's implementation issue.
- #87 - original DR-023 materialization (template section, soft validator warning).
