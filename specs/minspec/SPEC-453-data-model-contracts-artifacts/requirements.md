---
id: SPEC-453
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - Spec Kit artifact conformity (DR-055 bucket A)
aspects: [spec-kit-conformity, artifacts, validation, scaffold, templates, tier-0]
relates_to: [DR-055, DR-027, DR-004, "#684", SPEC-413]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-453: Recognise optional `data-model.md` and `contracts/` spec artifacts

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers the questions under [Decisions needed (Clarify)](#decisions-needed-clarify),
> and approves it through the normal spec-approval gate before any code changes. Requirements
> are written under each question's recommended option.

Materializes **#684** (*recognise optional data-model.md + contracts/ spec artifacts*) and
DR-055 bucket A (Spec Kit conventional conformity, accepted 2026-07-13), items A1-A3. Spec Kit
users expect `data-model.md` and `contracts/` next to a spec; MinSpec today knows only
`requirements.md`, `design.md`, `tasks.md`. `contracts/` also serves Contract-Driven
Development (define contracts before implementation). Related, not overlapping: SPEC-413 amends
the contract **frontmatter** signal; this spec adds contract **files**.

## Scope

In: two optional artifacts per spec directory (`data-model.md`, `contracts/`), their
scaffold offer, a validate-when-present check, two templates, and recognition in the spec tree
and layout providers. Out: making either required by tier (DR-055 A3 forbids it); Spec Kit's
`research.md` / `quickstart.md` (DR-055 does not adopt them in bucket A); any change to the
canonical spec hash or approval semantics beyond what Decision 3 settles; new dependencies.

## Functional requirements

- **FR-1 Recognition (layout).** For a nested spec directory `specs/<product>/SPEC-NNN-slug/`,
  a sibling `data-model.md` and a `contracts/` subdirectory are recognised as optional
  artifacts of that spec. They are not themselves specs: a `data-model.md` or any file under
  `contracts/` is never counted as a spec shard, never needs `id: SPEC-NNN` frontmatter for the
  specs-frontmatter gate, and never participates in shard-id consistency or split-layout
  coverage checks (`spec-layout.ts` `SHARD_ID_FILE_NAMES`, `spec-validator.ts`
  `validateShardIdConsistency` / `validateSplitLayoutCoverage` keep their current file sets).
- **FR-2 Recognition (tree).** The spec tree provider shows `data-model.md` and `contracts/`
  (with its files) as children of the owning spec when present, and shows nothing when absent.
  No placeholder row for a missing artifact.
- **FR-3 Scaffold offer.** Spec-artifact generation offers each artifact when relevant and
  never creates one unprompted by tier. "Relevant" is a deterministic, offline signal
  (Decision 1). Declining leaves no file and records nothing; the offer is not repeated for a
  spec that already has the artifact.
- **FR-4 Templates.** A `data-model` template (entities, fields, relationships, invariants,
  link back to the owning SPEC id) and a `contracts/README.md` seed (what a contract file is,
  accepted formats: TS/Zod types, OpenAPI, event shapes; naming; link to the owning SPEC id).
  Rendered via the existing template engine; not added to the init-time `TEMPLATE_NAMES`
  harness list (same reasoning as `DESIGN.md`, #206: a per-spec artifact is not created at init
  and must not be resurrected by refresh).
- **FR-5 Validate when present.** If `data-model.md` exists it is checked for: non-empty body,
  readable as UTF-8, and a reference to the owning spec id (Decision 2 fixes the exact rule). If
  `contracts/` exists it is checked for: contains at least one non-README file, and every file
  is readable. Findings use the existing `ValidationViolation` shape.
- **FR-6 Present-but-invalid is checked, absence is not.** Absence of either artifact is never
  a violation at any tier. Present-but-invalid (empty, unreadable, an empty `contracts/`, a
  `contracts/` that is a file rather than a directory, a `data-model.md` that is a directory) is
  reported. A path that cannot be read fails visibly as a violation, never silently skipped
  (invariant 2, no silent gate).
- **FR-7 Referenced.** The owning spec's `requirements.md` or `design.md` should link to each
  present artifact. Severity per Decision 2.
- **FR-8 Severity.** New findings are `warning` unless Decision 2 selects `error`.
- **FR-9 Opt-in boundary.** Scaffold writes only inside an existing `.minspec/` repo (invariant
  3); in a folder without the marker nothing is created and no check runs.

## Acceptance criteria

- **AC-1** A spec dir with neither artifact validates exactly as today (no new finding, any tier).
- **AC-2** A spec dir with a well-formed `data-model.md` and a `contracts/` holding one file
  and linked from `design.md` yields zero new findings.
- **AC-3** Empty `data-model.md`, or empty `contracts/`, yields one finding each, naming the path.
- **AC-4** An unreadable artifact (permission error) yields a finding, not a pass and not a crash.
- **AC-5** `data-model.md` and `contracts/*.ts` are absent from the specs-frontmatter gate's
  failure list even without `id:` frontmatter.
- **AC-6** Tree shows both when present, neither when absent; refreshing after create/delete
  updates the tree.
- **AC-7** Scaffold in a non-opted-in folder writes nothing.
- **AC-8** Declining the offer creates no file; accepting creates the template with the spec id
  filled in.
- **AC-9** The approved spec hash of an existing spec is unchanged by adding or editing either
  artifact, unless Decision 3 selects the other option.

## Invariants this change must not break

1. Offline: no network call (invariant 1); all detection is filesystem/text only.
2. No silent gate (invariant 2): unreadable or malformed present artifacts fail visibly.
3. Blast radius (invariant 3): nothing is written without the `.minspec/` opt-in marker.
4. Optional means optional: no tier, phase, or `status` transition may require either artifact.
5. Asymmetry (DR-003 phase 4): the validator tests present-but-invalid, not only missing.
6. Existing split-layout and Spec Kit layout recognition behave identically for specs lacking
   the new artifacts.

## Decisions needed (Clarify)

**Decision 1 - what makes an artifact "relevant" to offer?**
- **(rec) A: keyword/structure signal.** Offer `data-model.md` when the spec's text has a
  `## Data model`/entity-style heading or aspect `data`; offer `contracts/` when aspects include
  `api` or the spec names a cross-package boundary. Cost: heuristic, will miss some specs and
  nag a few; mitigated because declining is free and silent.
- B: always offer both for T3+. Cost: nags every spec, contradicts "never forced by tier alone"
  in spirit.
- C: command-only, never offered automatically. Cost: low discoverability, weak conformity win.

**Decision 2 - validation strictness.**
- **(rec) A: warnings; "referenced" = a link from `requirements.md`/`design.md`;
  `data-model.md` must mention the owning spec id.** Cost: warnings can be ignored.
- B: errors for present-but-invalid. Cost: a half-written draft blocks commit.

**Decision 3 - do the artifacts join the approval hash?**
- **(rec) A: no.** They are supporting material; approvals and `specHash()` stay on the spec
  files, so adding a contract never stales an approval. Cost: a contract can drift after
  approval without staling it (a human-trust gap for CDD).
- B: yes, hash `contracts/` content. Cost: changes canonicalization for every spec's tooling and
  stales approvals on any contract edit; a larger, breaking change outside bucket A.

**Decision 4 - ownership model.** `contracts/` files could be listed in `implements:` (SPEC-038
ownership). **(rec) A: allowed but not required.** Cost: no enforcement that contracts are
owned. B: forbidden. Cost: contradicts CDD use.

Recorded selection: none yet; Clarify is open and `phases.clarify` stays `pending`.

## Open items for Plan (not decisions)

Exact file list is a Plan measurement: `spec-layout.ts`, `spec-validator.ts`,
`template-registry.ts`, `spec-manager.ts`, `spec-tree-provider.ts`, plus new tests. Whether
validation runs inside `validateSpec` or as a sibling function (like `validateSplitLayoutCoverage`)
is a Plan choice; the sibling form keeps `validateSpec` pure over parsed specs.
