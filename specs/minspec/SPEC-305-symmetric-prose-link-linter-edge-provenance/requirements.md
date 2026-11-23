---
id: SPEC-305
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — edge trustworthiness
aspects: [dag, edges, linter, provenance, tier-0, determinism, never-wrong]
depends_on: [SPEC-012]
relates_to: [SPEC-041, DR-019, DR-062, DR-023]
---

# MinSpec — Symmetric prose-link linter + edge provenance (Requirements)

> Materializes [#803](https://github.com/AIClarityAU/minspec/issues/803). Rests on
> [DR-019](../../../docs/decisions/DR-019.md) (deterministic DAG, no LLM in the ranking path)
> and SPEC-012 R2 (the prose-link linter + opt-in edge suggester, which that spec left
> "not yet a SPEC", line 439). No new DR is proposed: every choice here is reversible in
> under a day (see Decisions needed).

## One-Sentence Scope

Make machine edges (`depends_on`, `relates_to`, `supersedes`) auditable in **both** directions — flag an edge whose target has no textual basis in the document body (edge-without-prose), and record whether each edge was `hand`-authored or `llm-suggested` — all deterministic, offline, advisory, so a human can bulk-approve suggested edges and still find the plausible-but-wrong ones.

## Context

- **Failure class already caught.** A dangling or cyclic edge is flagged as corruption by `resolveCorruption` (`packages/shared/src/next-task.ts`, region ~263-395, per the issue; re-verify at plan time).
- **Failure class not caught.** A *plausible-but-false* edge (real target, acyclic, semantically wrong). The prose-link linter described in SPEC-012 R2 is one-directional (prose-without-edge). No linter code exists yet (I grepped `packages/` and `scripts/` for "prose-link" variants: no hit — unverified beyond that vocabulary).
- **Why it matters.** The intended flow is: opt-in LLM *suggests* edges → human *bulk-approves* after spot-checking (SPEC-012 R2, DR-019: LLM never auto-writes, never in the ranking path). Bulk-approve lets a wrong edge in.
- **Blast radius of a wrong edge — correction to the issue.** The issue says a wrong edge "only affects ordering — never approval validity". That holds for SPEC-012 alone, but [SPEC-041](../SPEC-041-cross-artifact-staleness/requirements.md) (status `implementing`) makes each `depends_on` target's hash an input to `upstream-stale`. So a false `depends_on` can spuriously mark a dependent stale and force a human re-ack. Worst case is therefore **ordering mis-floor plus a spurious re-approval prompt**, still never code or data. This raises the value of the guard and is why FR-3 below treats `depends_on` as the highest-priority edge kind.

## Functional requirements

- **FR-1 (edge-without-prose check).** For every artifact (spec, DR, epic) and every machine edge it declares (`depends_on`, `relates_to`, `supersedes`), the linter MUST check that the target id appears in the artifact's **body** (text outside frontmatter). An edge with no body reference yields a finding: `SPEC-014 depends_on SPEC-004, but the body never references SPEC-004 — spurious edge?`.
- **FR-2 (matching rule).** "Textual basis" is a deterministic token match on the target id in any form the corpus uses: bare (`SPEC-004`), cross-project/slash-joined (`MIN/SP4`, `SP4`, per DR-053), and markdown link targets whose path contains the id's slug directory. Matching is case-sensitive on the prefix, boundary-aware (`SPEC-004` must not match `SPEC-0041`), and ignores fenced code blocks only if decision D2 says so. No LLM, no network, no fuzzy matching.
- **FR-3 (severity and ordering).** Findings are **advisory warnings**, never errors (SPEC-012 FR-5 / INV-5: advisory + human-overridable). They are listed `depends_on` first (it feeds SPEC-041 staleness), then `supersedes`, then `relates_to`. Edges with `llm-suggested` provenance (FR-5) are listed before `hand` edges within a kind.
- **FR-4 (symmetric pair).** The existing/planned prose-without-edge direction (`Resolves:` / `Triggered by:` / `composes` prose with no machine edge, SPEC-012 R2) and FR-1 ship as ONE linter with two finding kinds (`missing-edge`, `spurious-edge`), sharing one id-extraction routine so the two directions cannot drift (the validator-asymmetry class).
- **FR-5 (edge provenance).** Each machine edge MUST be taggable as `hand` or `llm-suggested`, with `model` and `date` for the latter. An untagged edge is treated as `hand` (backward compatible; no corpus migration). Storage shape is decision D1.
- **FR-6 (suggester writes provenance).** When the opt-in edge suggester (SPEC-012 R2; out of scope to build here) writes an accepted edge, it MUST tag it `llm-suggested` with model and date. The suggester never auto-writes; acceptance is the human act. This spec only defines the tag contract and a validator that rejects a malformed tag.
- **FR-7 (audit view).** A deterministic query lists all `llm-suggested` edges (optionally filtered by date/model) with their FR-1 verdict, so a later audit can re-review *just* the bulk-accepted set.
- **FR-8 (drift check).** For an `llm-suggested` edge that once had a body reference and no longer does, the finding says `edge no longer supported by current prose` (distinct wording from never-supported). Hand edges get FR-1's message only. Detecting "once had" needs history: decision D3.
- **FR-9 (human override).** A deliberate edge with no prose basis can be acknowledged in a way that silences that one finding (mechanism: decision D4) without removing the edge. Silencing is per-edge, recorded in the artifact, never global.
- **FR-10 (surfacing).** Findings surface in `npm run validate`-class output and the MinSpec problems/validation surface as warnings, naming file, edge kind, target id. They never block commit or merge on their own.

## Acceptance criteria

- **AC-1.** Spec A with `depends_on: [SPEC-004]` and a body that never mentions SPEC-004 → one `spurious-edge` warning naming A, `depends_on`, SPEC-004. Adding a body mention clears it.
- **AC-2.** `SPEC-0041` in the body does not satisfy an edge to `SPEC-004` (boundary test); `SP4` slash-joined form does satisfy it when it resolves to SPEC-004.
- **AC-3.** An edge with no provenance tag is reported identically to `hand`; a `llm-suggested` edge with missing `model` or `date` fails tag validation.
- **AC-4.** Running the linter twice on identical input yields byte-identical output; it makes no network call and loads no model (DR-019).
- **AC-5.** Findings never change exit status of commit/merge gates (warning only), and never change `next-task` ordering or any approval hash.
- **AC-6.** FR-7 listing contains exactly the `llm-suggested` edges, none of the `hand` ones.
- **AC-7 (mutation).** Mutating the matcher to substring-match (dropping the boundary rule) turns AC-2 red.

## Invariants this must not break

- Constitution 1 — offline, no network call.
- DR-019 — deterministic; LLM never in ranking path or auto-write path.
- Constitution 2 (no silent gate) — the linter is advisory by design; it must not be wired as a gate with a swallowed error, and a crash in it must be visible, not a silent "no findings".
- Constitution 3 — acts only in repos with `.minspec/`.
- SPEC-041 / DR-062 — provenance and acknowledgement metadata MUST NOT enter the canonical approval hash input in a way that stales existing approvals (verify at plan time whether the chosen storage in D1 is inside the hashed bytes; SPEC-004's epic edit precedent shows frontmatter is mostly canonicalized away but `depends_on` itself is an input).
- SPEC-012 FR-5 / INV-5 — advisory and human-overridable.

## Out of scope

- Building the LLM edge suggester (SPEC-012 R2, separate work).
- Semantic judgement of whether an edge is *true*. This linter proves only absence of a textual basis; a body mention of an id does not prove the dependency is real.
- Auto-removing edges.

## Decisions needed (Clarify)

Recorded selections: each of the 6 selections below is the option this document marks recommended, copied by the runner's agent on 2026-11-13. These are not human choices and no delegation made them; the approver confirms or changes each.

- **D1 — Where provenance lives.**
  (a) **(rec)** Inline frontmatter map, e.g. `edge_provenance: { SPEC-004: {kind: llm-suggested, model: ..., date: ...} }` beside the edge lists. Travels with the artifact and shows in review diffs. Cost: touches the artifact's own file, so if frontmatter keys are hashed for approval, tagging an already-approved spec could void its approval — must be checked/excluded in canonicalization first.
  (b) Sidecar `.minspec/edge-provenance.json`. Never touches approved bytes. Cost: second source of truth that can drift from the edge lists, and a rename/removal leaves orphans.

  **Recorded selection: Option (a),** an inline frontmatter map (`edge_provenance`); the check that option names stands first: canonicalization must be checked, or the key excluded, before an approved spec is tagged. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
- **D2 — Do fenced code blocks and HTML comments count as "textual basis"?** (a) **(rec)** No: only prose counts, so an id pasted into a code sample does not launder a false edge. Cost: a legitimate reference inside a table-in-code-fence yields a false warning (mitigated by FR-9). (b) Yes: fewer false warnings, weaker guard.

  **Recorded selection: Option (a),** no, only prose counts as textual basis; fenced code and HTML comments do not. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
- **D3 — How FR-8 knows an edge "once had" prose support.** (a) **(rec)** Drop "once had" entirely: treat all unsupported `llm-suggested` edges the same as FR-1, with provenance only used for ordering/filtering. Cost: lose the nicer "drift" wording. (b) Compare against git history of the file — richer, but needs git at lint time and breaks in shallow clones/CI.

  **Recorded selection: Option (a),** drop "once had"; unsupported `llm-suggested` edges are treated the same as FR-1. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
- **D4 — Acknowledgement mechanism for FR-9.** (a) **(rec)** Per-edge `rationale` string in the provenance map (D1a), which also documents *why* a prose-less edge is intentional. Cost: ties FR-9 to D1a. (b) Inline marker comment in body such as `<!-- edge-ok: SPEC-004 -->`. Cost: invisible in rendered view and easy to rot.

  **Recorded selection: Option (a),** a per-edge `rationale` string in the provenance map. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
- **D5 — Where the linter runs.** (a) **(rec)** Inside `npm run validate` as a warning section plus the in-editor problems surface. Cost: validate output grows noisy on a corpus with many existing prose-less edges; a first run needs a baseline report. (b) Separate `npm run lint:edges`. Cost: easy to never run (install ≠ adopt).

  **Recorded selection: Option (a),** inside `npm run validate` as a warning section, plus the in-editor problems surface. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
- **D6 — Corpus baseline.** Existing specs may already carry many prose-less edges. Option (a) **(rec)** report only, no mass edit. Cost: standing warning noise until humans clear them. (b) A one-off sweep PR that adds body references or rationale. Cost: edits approved specs and stales their approvals.

  **Recorded selection: Option (a),** report only, no mass edit of the corpus. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.

## Follow-ups (tracked)

- Opt-in LLM edge suggester — SPEC-012 R2, not yet a spec (backlog: edge suggester spec, 2026-11-12).
- Plan/tasks/design for this spec — after the human resolves the decisions above.
