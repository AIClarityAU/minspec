---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - an edge the resolver and approval validity read must be one a human can trust
aspects: [linter, depends-on, provenance, tier-0, offline, deterministic, no-silent-gate]
depends_on: [SPEC-012]
relates_to: [SPEC-041, SPEC-054, DR-019, DR-062, "#803", "#804"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec - Symmetric prose-link linter and edge provenance (Requirements)

> Resolves [#803](https://github.com/AIClarityAU/minspec/issues/803). Precondition named by [SPEC-041](../SPEC-041-cross-artifact-staleness/requirements.md) (risk R1) for trusting bulk-approved `depends_on` edges. Builds on [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) R2 (the prose-link linter and opt-in edge suggester) and [DR-019](../../../docs/decisions/DR-019.md) (determinism: the LLM never auto-writes and is never in the ranking path). Specify phase only - nothing here is built.

## One-Sentence Scope

Make the prose-link check **two-directional** - flag a machine edge (`depends_on` / `relates_to` / `supersedes`) whose target id appears nowhere in the artifact's body, as well as prose with no edge - and record **who or what authored each edge** (`hand` or `llm-suggested`, with model and date) so a bulk-accepted set can be re-reviewed on its own - all deterministic, offline, advisory.

## Context

- **Dangling and cyclic edges are already caught.** `resolveCorruption` flags them as top gate-violations ([next-task.ts:263-395](../../../packages/shared/src/next-task.ts#L263)); this spec does not touch that.
- **A plausible-but-false edge is not caught.** The target exists, the graph is acyclic, the meaning is wrong. SPEC-012's mitigation for R2 ("prose-link linter flags `Resolves:`/`Triggered by:`/`composes` prose with no matching edge", [requirements.md:346](../SPEC-012-next-task-resolver/requirements.md)) only looks one way: prose without an edge. It never looks at an edge without prose. At the time of writing I found no implementation of even the one-way linter under `packages/` or `scripts/` (grep for `prose-link` / `proseLink`, no hits; unverified beyond that grep) - so this spec specifies the whole linter, both directions, rather than adding a second direction to an existing one.
- **Why it matters now.** The intended authoring flow is: an opt-in LLM suggests edges, a human bulk-approves after spot-checking a few. SPEC-041 will make `depends_on` an input to approval validity (`upstream-stale`), so a false edge there raises a false re-approval demand. Blast radius stays small (ordering plus one re-ack keystroke, never data or code), but a wrong edge must be findable.

**Core gap (one sentence):** nothing checks that an edge is supported by the document that declares it, and nothing records which edges a human wrote versus which an LLM proposed, so a bulk-accepted mistake looks identical to a hand-authored fact.

## Functional Requirements

- **FR-1 - Edge-without-prose check.** For each artifact, for each `depends_on`, `relates_to` and `supersedes` target, the linter reports a finding when the target's id has no textual basis in the artifact's body (everything after the frontmatter). Message shape: `SPEC-014 depends_on SPEC-004, but the body never references SPEC-004 - spurious edge?`.
- **FR-2 - What counts as a textual basis.** A reference to the target id in any form the repo's reference grammar accepts: bare (`SPEC-004`), linked (`[SPEC-004](...)`), path (`.../SPEC-004-slug/...`), and the cross-project and paragraph forms of DR-053 (`MIN/SP4`, `SP4/FR3`) once resolvable via `@aiclarity/shared`'s `project-prefix` module. Matching is on the resolved id, not a substring (`SPEC-004` must not be satisfied by `SPEC-0041`). Fenced code blocks count as text (an example reference is still a reference); frontmatter does not (the edge itself is not its own basis).
- **FR-3 - Prose-without-edge check (the existing one-way direction).** Prose of the form `Resolves:`, `Triggered by:`, `composes`, `supersedes`, `depends on` that names an artifact id with no matching machine edge is reported, so both directions ship as one linter with one finding shape.
- **FR-4 - Deterministic, Tier-0.** No LLM, no network (constitution invariant 1). Same input bytes give the same findings in the same order (sorted by artifact id, then edge kind, then target).
- **FR-5 - Advisory, not blocking.** A finding never changes an approval state, never blocks a commit or merge, and never alters resolver ordering. It is surfaced (see FR-9). This follows from the blast-radius argument above and keeps the linter out of the approval path.
- **FR-6 - Edge provenance record.** Each edge carries an origin: `hand`, or `llm-suggested` with `model` and `date`. An edge with no record is read as `hand` only if the record store has never been written for that artifact; see Decisions needed D-1 for where the record lives and how an unrecorded edge is read.
- **FR-7 - Provenance is written only by acceptance.** When a human accepts an LLM-suggested edge, the acceptance writes the edge and its `llm-suggested` origin together, atomically (one write). The suggester itself never writes either (DR-019).
- **FR-8 - Provenance survives hand edits and is never silently upgraded.** Re-saving an artifact does not turn `llm-suggested` into `hand`. A human may promote an edge to `hand` only by an explicit action (Decisions needed D-2), which records the promotion.
- **FR-9 - Re-review view.** A single listing shows every `llm-suggested` edge, and for each whether the FR-1 check currently passes ("no longer supported by current prose" is the drift signal). Edges that fail FR-1 sort first. Where it appears (palette command, tree group, or both) is a Plan-phase UI choice; the data contract is this requirement.
- **FR-10 - Fails visibly.** If the body cannot be read or the edge list cannot be parsed, the linter reports that artifact as unchecked with the reason. It never reports it clean (constitution invariant 2 - no silent gate).
- **FR-11 - Opt-in only.** The linter runs only inside a repo with `.minspec/` at its root (constitution invariant 3).

## Acceptance Criteria

- **AC-1.** An artifact with `depends_on: [SPEC-004]` whose body never mentions SPEC-004 yields exactly one FR-1 finding naming both ids.
- **AC-2.** The same artifact with a body line `see SPEC-004` yields none. With only `SPEC-0041` in the body it still yields one finding.
- **AC-3.** A reference appearing only inside the frontmatter does not satisfy FR-1.
- **AC-4.** Prose `Triggered by: #12` / `Resolves: SPEC-009` with no matching edge yields an FR-3 finding.
- **AC-5.** Two runs on identical input produce byte-identical output; no network call is made (test with network disabled).
- **AC-6.** Accepting a batch of suggested edges writes `llm-suggested` + model + date for each; a later hand edit to the artifact leaves those origins unchanged.
- **AC-7.** The re-review view lists only `llm-suggested` edges, failing ones first.
- **AC-8.** An unreadable or unparseable artifact appears as `unchecked: <reason>`, never as clean.
- **AC-9.** Findings do not change any `resolveStatus` result or resolver ordering (assert before/after equality).
- **AC-10.** Adding or changing provenance does not, by itself, void an existing approval (see D-1; this must hold under whichever option is chosen).

## Invariants (must not break)

- **INV-1 - Determinism (DR-019).** The LLM is never in the check, the ranking path, or the write path.
- **INV-2 - Advisory (FR-5).** No finding gates anything.
- **INV-3 - No silent gate.** Unreadable input is reported, not passed.
- **INV-4 - Offline and opt-in.** No network; no behaviour change outside a `.minspec/` repo.
- **INV-5 - Human-overridable.** A flagged edge can be kept as-is with one action; the linter never removes an edge.
- **INV-6 - Approval hashes are not perturbed.** Whatever stores provenance must not make an existing approved artifact read stale (AC-10).

## Decisions needed (Clarify)

- **D-1 - Where does provenance live?**
  - **(a) Sidecar** (e.g. a committed JSON beside the approvals store), keyed by artifact id + edge kind + target. **(rec)** Cannot interact with an artifact's content hash, so INV-6 holds by construction. Cost: a second file to keep in step with frontmatter; an edge deleted by hand leaves an orphan record the linter must prune.
  - **(b) Inline in frontmatter** (e.g. a parallel `edge_origin:` map). One file, travels with the artifact. Cost: if the approval canonicalization does not strip it, adding provenance stales every approved artifact it is written to; I believe `status:` is stripped but have not checked whether a new key would be - the Plan phase must verify before this option is viable.
  - Related: how an edge with no record is read. Reading it as `hand` is simplest but makes every pre-existing edge unaudited-hand; reading it as `unknown` is honest but gives the re-review view a large unlabeled set.
- **D-2 - Promotion to `hand`.** Options: (a) none - an `llm-suggested` edge stays so forever and the view has a "reviewed" mark instead **(rec)**, keeps the audit trail intact, costs one extra field; (b) promotion flips the origin to `hand` and records who/when, simpler, but erases the evidence a later audit wants.
- **D-3 - `relates_to` strictness.** `relates_to` is advisory (SPEC-041), so a missing textual basis is weaker evidence of error. Options: report at the same severity **(rec)**, one rule is easier to explain and the issue asks for all three kinds; or report `relates_to` at a lower "info" level to cut noise. Cost of the rec: more findings on loosely-related edges.
- **D-4 - Body-less artifacts.** For artifacts whose body is only a stub, every edge would be flagged. Options: flag anyway (rec - a stub with edges and no prose is itself the thing to look at) at the cost of noise during Specify; or skip artifacts with `status: specifying` and an empty body.
- **D-5 - Where findings surface.** CLI-free per the repo rule (palette only). Options: extend the existing validator output (`npm run validate` path; one place, but it is a gate surface, so FR-5 must be proven by test) or a separate palette command and tree decoration. Recommend the separate surface **(rec)** to keep advisory findings visibly apart from gating ones, at the cost of one more thing to discover.

## Out of Scope

- The opt-in LLM edge suggester itself (SPEC-012 R2 owns it); this spec only consumes its acceptance event.
- Using provenance as an input to approval validity or ordering.
- Corpus-wide edge sweep ([#804](https://github.com/AIClarityAU/minspec/issues/804)) and `upstream-stale` ([SPEC-041](../SPEC-041-cross-artifact-staleness/requirements.md)).
- Semantic judgement of whether prose truly *justifies* an edge - the check is textual presence only, and says so in its message.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Textual presence is a weak proxy: an incidental mention satisfies FR-1 for a false edge. | Stated limit in the finding text and Out of Scope; this is a floor, not a proof. Provenance + re-review (FR-9) covers what the text check cannot. |
| R2 | Reference-grammar drift: DR-053 v2 forms are accepted but not yet shipped; the linter could miss a valid form and false-flag. | FR-2 resolves via the shared `project-prefix` module and accepts v1 and v2; AC-2 pins boundaries. |
| R3 | Provenance store out of step with frontmatter (D-1a orphans). | Linter prunes/reports orphans; test in Plan. |

## Decision records

None required by this spec. D-1 is reversible inside a day only before any provenance is committed; if it is chosen as a committed on-disk format, file a DR then (DR-359 filter).

## Traceability

Issue [#803](https://github.com/AIClarityAU/minspec/issues/803) - [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) R2 - [SPEC-041](../SPEC-041-cross-artifact-staleness/requirements.md) R1 - [DR-019](../../../docs/decisions/DR-019.md) - [DR-062](../../../docs/decisions/DR-062.md).
