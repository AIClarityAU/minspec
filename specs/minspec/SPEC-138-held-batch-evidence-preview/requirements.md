---
id: SPEC-138
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - one honest, checkable read of what is waiting on the human
relates_to: [DR-070, SPEC-076, SPEC-062]  # DR-070 §7 is the origin; SPEC-076 is the read-only headless-reader precedent; SPEC-062 owns the drain whose hold queue this reads
---

# Held-batch evidence preview — one read in place of N per-issue adjudications

> **Read-only.** Generates a report from data already on disk or already fetched under
> existing consent. Writes no label, comment, or issue; dispatches nothing.

Materializes **#1004** (DR-070 §7 follow-up). Related: **#783** (inflow outruns resolution),
**#1002** (machine-readable hold reason — the dependency), **#1005**.

## Problem

The hold queue (`needs-review`, `needs-info`, `agent-ready-specify`) is large (DR-070 measured
287 open, 72% of open issues). Each item costs the human a separate adjudication: open the
issue, find why it was held, guess its tier and blast radius, locate its spec/DR. DR-070's panel
concluded the real keystroke-removal lever is to cut the **per-item cost**, with none of the
safety surface of relaxing dispatch. This spec ships that lever **standalone**: it does not
change, relax, or depend on any dispatch decision.

## Functional requirements

- **FR-1 — Evidence row per held issue.** For each selected issue emit: issue number, title,
  **hold reason** (the `hold:*` token from the triage verdict record, #1002), **tier**, **owning
  spec/DR** (refs found in the body or verdict record), and a **changed-path prediction**
  (paths the issue body or verdict names; labelled a prediction, never a diff).
- **FR-2 — Honest provenance per cell.** Every cell states its source (verdict record, body
  parse, label) or renders the explicit literal `unknown`. A missing hold reason is never
  inferred or defaulted; an issue triaged before the verdict record existed shows `unknown`
  (cf. `scripts/backfill-hold-labels.sh`, which skips these rather than guess). The report
  header counts `unknown` per column so coverage is visible, not implied.
- **FR-3 — Trusted records only.** Verdict records are read through the same trusted-author
  filter the dispatcher uses (`dispatch-ready-check.sh --trusted-comment-bodies` /
  `--newest-record`); this repo is public, so an unfiltered read lets a stranger's forged
  block decide a cell (#1113).
- **FR-4 — Grouping and ordering.** Rows group by hold reason (so one adjudication rule covers
  a group), then order by existing rank (`scripts/lib/issue-rank.ts`) within a group. Order is
  deterministic: same inputs, byte-identical output.
- **FR-5 — Batch selection.** The batch is chosen by filter (hold reason, tier, label) and an
  explicit `--limit N`; the default is the whole held set, with the report stating total vs
  shown. Truncation is stated in the output, never silent.
- **FR-6 — Output surfaces.** (a) Markdown to stdout / a file for the reviewable read; (b) the
  same data as JSON for tooling. The >50-queue notification from DR-070 links to (a) rather
  than nagging without content.
- **FR-7 — Read-only and consent-bound.** No write to GitHub or the repo. Reading issues from
  the forge is a network call and needs the existing backlog-fetch consent (SPEC-085); without
  it the command reads only cached/local records and says so. It refuses outside a `.minspec/`
  project (invariant 3).
- **FR-8 — Fails visibly.** If the verdict-record reader errors, the report fails non-zero
  naming the stage; it never emits a partial table that reads as complete (invariant 2).
- **FR-9 — Independent of dispatch.** No code path here reads or writes dispatch config, and
  nothing in the report is consumed as an approval input.

## Acceptance criteria

1. Given N held issues with verdict records, the report has N rows and each FR-1 column is
   populated from the record.
2. Given a held issue with no verdict record, hold reason renders `unknown`, the header's
   unknown-count includes it, and the exit code is 0 (unknown is a reportable state).
3. Given a forged record from an untrusted author, no cell reflects it.
4. Two runs on identical input produce byte-identical output.
5. `--limit 10` on 30 held issues shows 10 rows and states "10 of 30".
6. With a forced reader failure the exit is non-zero and no table is printed as complete.
7. Run without backlog-fetch consent: no network call occurs (asserted by a test that fails
   on any fetch); output says it used local data only.
8. Run outside a `.minspec/` repo: refuses with no output file.
9. The report never contains a `hold:*` -> approval mapping; removing the command changes no
   dispatch behaviour (test: dispatch tests unchanged and green).

## Invariants this must not break

- Offline-first (1): network only under consent.
- No silent gate (2): errors fail the report visibly; `unknown` is explicit, not blank.
- Blast radius (3): inert without `.minspec/`.
- Never-wrong signpost: a changed-path *prediction* is labelled as such; it must not read as
  a guarantee of the eventual diff.

## Decisions needed (Clarify)

1. **Delivery surface.** (a) Headless script + npm script like SPEC-076 **(rec)** — usable by
   agents and CI, no editor; costs: no one-click for editor users. (b) Palette command + webview
   — nicer read, but editor-only and larger. (c) Both; most work. Recommend (a) first, (b) later.
2. **Changed-path prediction source.** (a) Parse paths named in body/verdict record **(rec)** —
   deterministic, offline; costs: empty for issues that name no paths. (b) LLM prediction — richer
   but non-deterministic, spends tokens, violates FR-4's byte-identical goal. (c) Owning-spec
   `implements:` frontmatter as fallback — deterministic but coarse.
3. **Dependency on #1002.** Ship (a) only after #1002 lands **(rec)** — costs a delay, but the
   core column is otherwise meaningless; or (b) ship now reading labels/records best-effort with
   `unknown` everywhere — usable sooner, but the first reports are mostly `unknown`.
4. **Spec id.** SPEC-138 was the next free id on `origin/main` (highest SPEC-137); open PRs are
   invisible from here, so the dispatcher/human should confirm no rival claims it.

## Out of scope

Any dispatch relaxation, auto-approval, label writes, bulk close/stale policy, and the #1005
lifecycle-label reconciliation (all separate DR-070 follow-ups).
