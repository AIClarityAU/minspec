---
id: SPEC-097
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-001  # Explorer Epic Grouping
relates_to: [DR-013, DR-016, SPEC-011, SPEC-085, SPEC-096, "#68"]
---

# SPEC-097: Backfill `epic:<slug>` labels onto GitHub issues

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal
> spec-approval gate before any code changes.

Materializes **[#68](https://github.com/AIClarityAU/minspec/issues/68)** — epic
grouping ([DR-013](../../../docs/decisions/DR-013.md)) groups the Backlog panel by
the GitHub label `epic:<slug>`, but nothing ever writes that label: DR-013 defined
the convention, and epic backfill ([DR-016](../../../docs/decisions/DR-016.md),
[SPEC-011](../SPEC-011-epic-backfill/requirements.md)) explicitly scoped itself to
specs and ADRs only. Until something writes the label, the Backlog panel's epic
grouping has no issues to group — every issue falls into the synthetic
`(no epic)` bucket.

**Id note.** Highest `SPEC-NNN` on disk at the time of writing is `SPEC-096`
(checked against this worktree's `specs/minspec/` only — no network access from
this dispatch to check open pull requests or other worktrees, unlike the practice
SPEC-085 and SPEC-096 record). If `SPEC-097` collides with another id at review
time, renumber per the collision-gate convention in `CLAUDE.md`.

**Tier note.** Triage marked this T3/T4. The change adds one new library module,
one new command, its tests, and a handful of small extensions to existing
`backlog.ts`/`github.ts` helpers — closer to SPEC-011's original shape than to a
15+ file trace like SPEC-096. This spec treats it as T3; Plan may raise it if the
file count grows once `gh` edge cases are enumerated.

## Context

### What exists today

- **The label convention is already decided.** DR-013 §2 names `epic:<slug>` as
  the issue-side epic reference, "no new GitHub primitive... labels only." Reading
  it already works: `extractEpicSlug(labels)`
  (`packages/minspec/src/lib/backlog.ts:158-167`) pulls the slug out of an
  issue's labels, and `groupByEpic` (`epic-manager.ts:226-259`) groups any
  artifact — issues included — by the resolved epic. **Nothing writes it.**
- **SPEC-011 built the writing half for specs and ADRs only.**
  `packages/minspec/src/lib/epic-backfill.ts` ships two engines — a Tier-0
  heuristic (`proposeHeuristic`, pure file-system, `:358-410`) and a Tier-1 AI
  pass (`proposeAI`, shells `claude -p`, `:602-649`) — that both produce one
  `BackfillProposal` contract (`:86-90`), reviewed via a per-item QuickPick
  checklist (`packages/minspec/src/commands/backfill-epics.ts`) and written by
  `applyBackfill` (`epic-backfill.ts:712-776`) only on explicit approval. SPEC-011
  names issue-label backfill out of scope in its own "Out of scope" section.
- **`gh` issue writes already exist, just not for epics.** `backlog.ts` already
  shells `gh issue edit --add-label` for other label families —
  `applyWsjfToIssue` (`:391-432`), `transitionIssue` (`:441-459`), `setPriority`
  (`:465-486`) — all via `execFileAsync`, all assuming the label already exists.
  None of the three calls `gh label create` first; `epic:<slug>` is a
  per-epic label the repo cannot have pre-seeded (unlike the fixed label set
  `template-registry.ts:145-166` creates at Initialize), so this spec's apply
  step is the first writer that must create-then-add.
- **The consent precedent.** SPEC-085 made the Backlog panel's `gh` calls fire
  only on an explicit user gesture, never an ambient trigger
  (`backlog-view.ts:257-264`). This spec's command is a second, independent
  gesture — not a Backlog-panel trigger — so it does not reuse SPEC-085's
  `contactGitHub` flag, but it must hold the same property: its `gh issue list`
  / `gh issue edit` calls run only when the user invokes this command, never from
  activation or another command's side effect.

### Why the heuristic/AI split does not map cleanly onto issues

SPEC-011's heuristic engine is Tier 0 (DR-004) because it touches nothing but the
local file-system — it can run with `claude` absent and the network unreachable.
An issue-mapping engine cannot be Tier 0 in that sense: there is no local copy of
"every open issue," so even the *non-AI* mapping pass must shell `gh issue list`
first. The real split for this feature is:

1. **Candidate epics — Tier 0.** The only valid mapping targets are *already
   registered* epics (`listEpics`, `epic-manager.ts:105`) — see Decision D-2.
   No `gh`, no `claude`.
2. **Issue fetch — Tier 1 (`gh`).** Pulling the open, unlabeled issues to map is
   a local-tool delegation exactly like the Backlog panel's own fetch — required
   for either mapping pass, and gated the same way (explicit gesture only).
3. **Mapping — Tier 0 compute (token overlap) vs. Tier 1 (`claude -p`, opt-in).**
   Once the issues are fetched, the *heuristic* mapping (title/body vs. epic
   title, Jaccard overlap) is pure computation over data already in memory; the
   *AI* mapping layers `claude -p` on top, exactly mirroring SPEC-011 FR-3/FR-4.

## Functional Requirements

- **FR-1 (candidate epics, Tier 0).** The set of epics an issue can be mapped
  onto is exactly the repo's currently-registered epics (`listEpics`). No new
  `EPIC-NNN` is minted from issue evidence alone (Decision D-2's recommended
  option; every requirement below assumes it).

- **FR-2 (issue fetch, Tier 1).** A new function gathers candidate issues: open,
  not already carrying any `epic:*` label (reuse the parse in
  `extractEpicSlug`, `backlog.ts:158-167`, to filter), with number, title, URL
  and body (`gh issue list --json number,title,url,labels,body`, extending the
  field set `fetchIssues` requests today, `backlog.ts:297-320`). It MUST call
  `isGhAvailable()` first (mirrors every existing Tier-1 `gh` caller) and MUST
  run only when this command is explicitly invoked — never on activation, a
  view render, or as a side effect of an unrelated command (consent precedent,
  SPEC-085).

- **FR-3 (heuristic mapping, Tier 0 compute).** For each candidate issue, score
  Jaccard token overlap (reuse `titleTokens`/`jaccard`, `epic-backfill.ts:172,
  176`, exported for reuse rather than re-implemented) between the issue's
  title plus first non-empty body paragraph and each registered epic's title.
  Below the threshold (mirror `TOKEN_THRESHOLD = 0.3`, `epic-backfill.ts:345`)
  the issue is left unmapped — the engine declines to guess, exactly as
  `proposeHeuristic` already does for specs/ADRs (`:403-404`). No subdirectory
  signal (issues have no file path).

- **FR-4 (AI mapping, Tier 1, opt-in).** Mirrors SPEC-011 FR-3/FR-4: shell
  `claude -p` with a digest (issue number, title, first body paragraph) plus
  the registered-epic list, a strict JSON-only schema instruction, and reuse
  the existing availability check and failure classification
  (`isClaudeAvailable`, `classifyExecFailure`, `epic-backfill.ts:159, 654-671`)
  rather than re-deriving them. The prompt MUST NOT offer "propose a new epic"
  as an option (FR-1). `claude` absent, non-JSON, timeout, cancelled, or a
  non-zero exit MUST all fall back to the FR-3 heuristic proposal — never throw
  to the user, never block.

- **FR-5 (proposal contract — a sibling, not an extension).** Define
  `IssueEpicProposal { mappings: ProposedIssueMapping[]; source:
  'heuristic'|'ai' }` with `ProposedIssueMapping { issueNumber, title, url,
  epicSlug, confidence, rationale }`, in a new module (e.g.
  `epic-issue-backfill.ts`) alongside, not inside, `epic-backfill.ts`. It MUST
  NOT add a third member to `ArtifactKind` (`'spec'|'adr'`) or otherwise change
  `BackfillProposal`/`ProposedMapping` — SPEC-011 names that contract as its
  most expensive seam to change, because every consumer (`applyBackfill`,
  `setArtifactEpic`) assumes a `filePath`-addressable artifact, which an issue
  is not.

- **FR-6 (HITL review before any write).** Render a markdown preview (mirror
  `renderProposalMarkdown`, `epic-backfill.ts:789`) and reuse the proven
  per-item accept/drop QuickPick checklist
  (`packages/minspec/src/commands/backfill-epics.ts`) so a human can drop any
  mapping before applying. No `gh` write happens until this review resolves to
  an explicit approval.

- **FR-7 (apply — idempotent, Tier 1 `gh` writes).** For each approved mapping:
  1. Ensure the label exists: `gh label create epic:<slug> --force` (idempotent
     create-or-update — this is the "creating the label if absent" the issue
     asks for, and sidesteps the open question of whether `gh issue edit
     --add-label` on a missing label auto-creates it, since none of the three
     existing label writers in `backlog.ts` rely on that).
  2. `gh issue edit <number> --add-label epic:<slug>`.

  An issue that already carries an `epic:*` label is skipped by default, same
  as SPEC-011's artifact skip (`epic-backfill.ts:730` via `readArtifactEpic`,
  adapted here to "already has an `epic:` label") — no override path in v1
  (Decision D-1 keeps this command idempotent and re-runnable, not destructive).
  One issue maps to exactly one epic per run: if two mappings name the same
  issue, only the first survives, mirroring the `claimed` dedupe in
  `applyBackfill` (`epic-backfill.ts:733-737`) that exists because an LLM reply
  is free-form input and nothing else enforces it. A failed `gh label create`
  or `gh issue edit` for one issue MUST NOT abort the run and MUST be counted
  as a failure in the result, never silently dropped (constitution invariant
  2's no-silent-gate principle, applied here to a user-facing summary rather
  than a CI gate).

- **FR-8 (command).** A new command (e.g. `minspec.backfillIssueEpics`),
  contributed to the Command Palette, distinct from `minspec.backfillEpics`
  (SPEC-011's command is untouched by this spec). Flow: fetch (FR-2) → heuristic
  proposal (FR-3) → offer the AI pass if `claude` is available (FR-4) → review
  (FR-6) → apply (FR-7) → report a summary (labels created, issues tagged,
  issues skipped, issues failed).

- **FR-9 (no onboarding auto-offer in v1).** Unlike SPEC-011 FR-8, this command
  is NOT offered during `auto-bootstrap`. It runs only on explicit palette
  invocation. A repo can have hundreds of open issues (this repo has 372 at the
  time of writing); an ambient offer that runs `gh issue list` unprompted is
  exactly the shape SPEC-085 just closed for the Backlog panel. Revisit an
  onboarding offer as a follow-up once this command has run safely standalone
  (tracked, see Follow-ups).

## Decisions needed (Clarify)

Every choice below carries a recommended option and that option's cost; the
Functional Requirements above are written under the recommended option in each
case, so approving this spec as written accepts all three.

### D-1 — Which issues does one run consider?

- **Option A — every open issue with no `epic:*` label yet (rec).** Symmetric
  with SPEC-011's full-corpus sweep for specs/ADRs; one command call "catches
  up" the whole backlog. *Cost:* with 372 ready issues pending today, applying
  a full proposal is up to ~2×N `gh` calls (label-create + issue-edit per
  mapped issue) in one run — needs a visible progress indicator, a cancel path,
  and tolerance for GitHub API rate limiting on a very large backlog; FR-7's
  per-issue failure counting exists because of this.
- **Option B — scoped to a label/filter the user supplies per run.** Cheaper
  and faster per invocation. *Cost:* no one-shot "catch everything"; the user
  must remember to re-run it per slice of the backlog, and an un-scoped
  issue is silently never considered until someone picks its slice.

### D-2 — May this pass mint new epics from issue evidence?

- **Option A — no; map only onto already-registered epics (rec).** FR-1. An
  issue's title/body is a weaker signal than a whole spec or ADR (SPEC-011's
  basis for minting), so a wrong guess here mints a spurious `EPIC-NNN` from a
  one-line title. New epics stay anchored to spec/ADR backfill or the manual
  **Create Epic** command. *Cost:* an issue about work with no spec or ADR yet
  has nothing to map onto and stays unmapped until one of those exists.
- **Option B — allow issue clustering to also propose new epics.** Richer
  coverage in one pass. *Cost:* duplicates SPEC-011's new-epic path and can
  create two different proposals for the same body of work depending on which
  backfill command ran first; a wrong guess is harder to notice across
  hundreds of issues than across a few dozen specs/ADRs.

### D-3 — Does a tagged issue get a comment?

- **Option A — label only, no comment (rec).** Consistent with DR-013's
  issue-side convention being label-only, and avoids posting a bot comment
  across potentially hundreds of issues in one run. *Cost:* no in-issue trail
  of why/when an issue was grouped, unlike `applyWsjfToIssue`'s score-breakdown
  comment.
- **Option B — post a short rationale comment per tagged issue** (mirrors
  `applyWsjfToIssue`, `backlog.ts:424-429`). *Cost:* doubles the `gh` calls per
  tagged issue and can flood issue timelines on a large run (D-1 Option A makes
  this worse, not better).

## Invariants (must hold)

- **INV — DR-004 tiering.** No direct network call from the extension. `gh`
  and `claude` are Tier-1 local-tool delegations the extension shells out to;
  it makes zero outbound connections itself.
- **INV — explicit gesture only (SPEC-085 precedent).** Every `gh issue list` /
  `gh label create` / `gh issue edit` call this feature makes happens only
  because the user invoked this command. No activation path, view render, or
  other command's side effect triggers it.
- **INV — HITL (DR-012 ethos).** No label is created or applied before an
  explicit approval over a human-readable preview (FR-6). Nothing is silently
  mass-applied.
- **INV — idempotent, re-runnable.** Re-running the command after a prior
  apply is a no-op for every issue already carrying an `epic:*` label (FR-7).
  No duplicate labels, no issue tagged with two epics in one run.
- **INV — no silent gate on a partial failure.** A `gh` call that fails for one
  issue mid-run is visible in the final summary; it is never swallowed into a
  reported full success (FR-7).
- **INV — `BackfillProposal` (SPEC-011) is unchanged.** This spec adds a
  sibling contract and sibling command; it does not modify
  `epic-backfill.ts`'s existing types, `applyBackfill`, or
  `minspec.backfillEpics` (FR-5, FR-8).

## Acceptance Criteria

- [ ] `isGhAvailable()` is checked before any `gh` call this feature makes, and
      the command degrades to a clear "GitHub CLI not available" message rather
      than throwing (FR-2).
- [ ] The fetch excludes any issue that already carries an `epic:*` label
      (FR-2).
- [ ] The heuristic engine runs with `claude` absent and the network reachable
      only via `gh`; it never shells `claude` (FR-3).
- [ ] A proposed mapping's `epicSlug` always resolves to an existing registered
      epic — never a slug absent from `listEpics` (FR-1, FR-4).
- [ ] `claude` absent / non-JSON / timeout / non-zero exit each fall back to
      the heuristic proposal and never throw to the user (FR-4).
- [ ] No `gh label create` or `gh issue edit` call happens until the review
      step (FR-6) resolves to an explicit approval.
- [ ] `gh label create epic:<slug> --force` runs before the first
      `gh issue edit --add-label epic:<slug>` for a slug not yet seen this run
      (FR-7).
- [ ] Re-running the command after a successful apply proposes nothing for the
      issues just tagged (FR-7, idempotency invariant).
- [ ] A simulated failure on one issue's `gh issue edit` leaves every other
      approved mapping applied and is counted as a failure in the final
      summary, not silently dropped (FR-7).
- [ ] `epic-backfill.ts`'s existing exports, `BackfillProposal` shape, and
      `minspec.backfillEpics` command are byte-for-byte unchanged by this
      spec's implementation (FR-5, FR-8).
- [ ] The command does not run, and makes no `gh` call, during extension
      activation, `auto-bootstrap`, or any other command's execution (FR-9,
      consent invariant).

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|------|----------------------|------------|
| 1 | Large backlog (372+ ready issues) makes one apply run slow or rate-limited | Med · Med | FR-7 counts and reports per-issue failures rather than aborting; D-1 names the scope trade-off explicitly for Plan to size a batch/progress UI |
| 2 | `gh issue edit --add-label` on a label `gh label create` has not yet made visible (propagation lag) fails spuriously | Low · Med | FR-7 creates the label first and treats any failure as a reportable per-issue failure, not a silent skip |
| 3 | AI proposal names an epic slug that does not exist (hallucination) | Low · Med | FR-1/FR-4: any AI-proposed slug not present in `listEpics` is rejected at parse, same pattern as SPEC-011's `normalizeAiProposal` validating against the known epic set |
| 4 | Ambient re-offer (e.g. a future onboarding hook) runs this against the network unprompted | Low · High | FR-9 + the explicit-gesture invariant; this spec ships with no onboarding wiring at all |
| 5 | Two mappings in one proposal name the same issue, double-tagging it | Low · Low | FR-7's one-issue-one-epic dedupe, mirroring `applyBackfill`'s existing `claimed` set |

## Out of scope

- Minting new `EPIC-NNN` registry entries from issue evidence (D-2).
- Posting a comment on a tagged issue (D-3).
- An onboarding/auto-bootstrap offer for this command (FR-9) — may follow once
  this has run safely standalone; file a follow-up issue if wanted.
- Removing an `epic:*` label, or re-tagging an issue that already carries one
  (no override path in v1, FR-7).
- Closed issues — only open issues are considered (consistent with D-1's
  "backlog" framing; closed work has no Backlog-panel grouping to benefit).
- Any change to `epic-backfill.ts`, `BackfillProposal`, or
  `minspec.backfillEpics` (FR-5).

## Why no new DR

The label convention (`epic:<slug>` on issues, "labels only, no new GitHub
primitive") was already decided in DR-013 §2, and the Tier-1 `gh`/`claude -p`
delegation pattern, HITL-before-write gate, and graceful-AI-degradation were
already decided in DR-016. This spec applies both decisions to a target
(issues) DR-013 named but SPEC-011 deferred — it does not introduce a new kind
of write, a new consent model, or a new store. The one new judgment call this
spec makes (FR-5's sibling-contract-not-extension choice) is reversible in
under a day: deleting the new module and command leaves `epic-backfill.ts` and
`minspec.backfillEpics` exactly as SPEC-011 left them. A DR would become
necessary only if D-2 is answered Option B (issue-driven epic minting), because
that creates a second path to the same registry SPEC-011's "Costly to Refactor
#3" already flags as expensive to change the allocation scheme for.

## Traceability

- **Issue:** [#68](https://github.com/AIClarityAU/minspec/issues/68).
- **Governing decisions:** [DR-013](../../../docs/decisions/DR-013.md) (the
  `epic:<slug>` label convention), [DR-016](../../../docs/decisions/DR-016.md)
  (the Tier-1 `gh`/`claude -p`, HITL-gated backfill pattern this spec reuses).
- **Specs this relates to:**
  [SPEC-011](../SPEC-011-epic-backfill/requirements.md) (the spec/ADR half this
  spec is the issue-side sibling of — explicitly out of scope there),
  [SPEC-085](../SPEC-085-backlog-fetch-consent/requirements.md) (the
  explicit-gesture consent precedent this spec's `gh` calls must also hold).
- **Follow-ups (tracked):** an onboarding offer for this command (FR-9) is
  deferred, not yet filed as a separate issue — file one if a human wants it
  pursued; `None` otherwise is also a valid answer per the Traceability
  Convention.
- **DR for this spec:** none, by design; see "Why no new DR" for the one
  condition (D-2 Option B) that would require one.
