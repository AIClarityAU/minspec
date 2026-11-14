---
id: SPEC-031
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-031 is T3.)
# status and phases here carry the current phase state. requirements.md stays frozen at its
# approved hash (approval sidecar under .minspec/approvals/), so its own phases lag. This file
# has no approval record of its own: these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-010  # Reviewer Across All Approvables
relates_to: [DR-047, DR-033, DR-041, DR-063, DR-081, DR-061, SPEC-012, SPEC-038, SPEC-054, "#527", "#528", "#529", "#530", "#330", "#453", "#816"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-031 - Design: independent AI review across every approvable type

Plan for [requirements.md](requirements.md), built under the four recorded Clarify decisions
(OQ-1 to OQ-4, all resolved by the founder on 2026-07-06, OQ-2 sharpened 2026-07-17 by #793).
Citations of "today" are against `origin/main` `ebc387d0`, the commit this plan was written on.
New code is cited by symbol, because its line numbers will move. The spec's own line citations
into `ai-review.yml` (line 270, 354, 367) have rotted: the coverage default now sits in the
step `Independent review → decide combined label` (`COVERAGE="${AI_REVIEW_COVERAGE:-panel}"`).

## What Plan found that the spec did not have

1. **Much of the reviewer already exists; the gap is per-type recording and wiring.**
   - The per-type substance prompts exist for seven of the eight types in
     `scripts/roles/approvable-reviewer.md` ("Per-type substance checks (align with SPEC-031
     FR-1)"). **Issue is missing.**
   - A per-document runner exists: `scripts/review-approvable.sh` reviews one document's
     full content, pipes through `scripts/review-decide.sh`, and applies no label. Its own
     header calls it a local preview, "NOT the final #527 runner".
   - FR-9a is shipped: `shouldAwaitApproval` in `.github/scripts/ai-review-guard.js`, applied
     by the single owner, step `Enforce ai-review label integrity and reflect the merge gate`
     in `.github/workflows/ready-to-merge.yml`.
   - FR-2's bounded loop exists for PR verdicts: `scripts/remediate-pr.sh` re-dispatches a dev
     agent on `ai-review:changes`, with two independent budgets (`MINSPEC_REMEDIATE_MAX_ATTEMPTS`
     default 2) and a scope guard that skips non-automation branches. It does not read any
     per-type label.
   - **Not built:** per-type labels and status contexts (FR-3), the canonical classification
     table (FR-8), the review config (FR-6, FR-7), the ordering gate (FR-5), the Issue reviewer.
     `grep -rn "ai-review:[a-z]*:" scripts .github packages/*/src` finds no per-type label.
2. **Classification is duplicated today.** `classifyApprovablePath` in
   `packages/minspec/src/lib/approvable.ts` knows three kinds (`spec`, `adr`, `epic`);
   `detect_type` in `review-approvable.sh` knows seven display names. FR-8 asks for one table;
   this plan makes one and has the shell runner read it.
3. **Plan and design.md (DR-047 correction 3).** DR-047's 2026-08-05 note says the corpus has
   no `plan.md`, so "Plan" (high criticality) and "design.md" (low) could name one file. The
   approved spec lists them as separate types, and the existing runner already separates them
   by file (`type: plan` or `*/plan.md` maps to Plan; `type: design` or `*/design.md` maps to
   design.md). This plan keeps that file-level split: `plan.md` (the Spec Kit layout, which
   `SHARD_ID_FILE_NAMES` in `spec-layout.ts` accepts) is the high-criticality `plan` type;
   `design.md` is the low-criticality `design` type FR-6 names. MinSpec's own layout therefore
   has no `plan` files, which matches OQ-1 (auto-approve design.md in the dogfood) and the
   founder's standing preference that plan documents are never his sign-off.
4. **PR-to-main is reviewer-gated, not human-gated, in this repo (DR-047 correction 1).** The
   ruleset has no human-review rule; `ai-review` is a required check. FR-8 still records
   PR-to-main as human-gated, because that is the spec's table and an adopter may add a review
   rule. Nothing in this plan changes merge gating: `awaiting-approval` stays advisory (INV-8).
5. **Untrusted input and filesystem tools.** `review-approvable.sh` grants the reviewer
   `Read, Glob, Grep`. That is safe for a local preview over repo-authored docs, and unsafe in
   CI over a fork's document or over a public issue body: a `claude -p` Read resolves paths
   outside the working directory (the global `claude -p` rule against filesystem tools over
   untrusted input). CI and Issue reviews
   therefore run with **no tools**, exactly like `review-pr.sh` (`--tools ""`).
6. **Config must come from the base, never the head.** A pull request that edits
   `.minspec/config.json` to add `plan` or `spec` to `autoApprove`, or to narrow breadth, would
   otherwise drop its own gate. Every CI reader takes the config from the trusted base checkout
   (the workflows already check out the base for control scripts).
7. **Carry-forward would skip deferred code.** The step `Carry the last verdict forward if
   nothing reviewable changed` reuses the previous verdict when nothing reviewable changed. If
   the ordering gate deferred implementing files on the previous run, a later run where only
   the doc changed would carry a verdict that never read those files. The carry must refuse
   when the previous verdict recorded deferred files.

## Components

| Component | Where | New or changed | Requirement |
|---|---|---|---|
| Approvable type table + predicates (Tier-0) | `packages/shared/src/approvable-types.ts` | new | FR-8, FR-4 contract, FR-6, FR-7 |
| CI twin of the table + per-type pure seams | `.github/scripts/ai-review-guard.js` | changed | FR-3, FR-5, FR-6, FR-8, INV-4, INV-8 |
| Review config reader (extension side) | `packages/minspec/src/lib/config.ts` | changed | FR-6, FR-7, INV-6 |
| Dogfood config | `.minspec/config.json` | changed | FR-6 (OQ-1), FR-7 (OQ-2) |
| Issue prompt + type override + no-tools mode | `scripts/roles/approvable-reviewer.md`, `scripts/review-approvable.sh` | changed | FR-1 |
| Local per-type runner | `scripts/review-pr.sh` | changed | FR-1, FR-3, FR-7 |
| Per-type remediation | `scripts/remediate-pr.sh` | changed | FR-2 |
| CI per-type review + ordering | `.github/workflows/ai-review.yml` | changed | FR-3, FR-5 (OQ-3) |
| Merge-gate reflection | `.github/workflows/ready-to-merge.yml` | changed | INV-4, FR-6, FR-9 |
| Issue reviewer | `.github/workflows/ai-review-issue.yml` | new | FR-1 Issue, FR-3 exception (OQ-4) |
| Adopter templates | `packages/minspec/src/lib/ci-review-templates.ts` via `scripts/gen-ci-templates.mjs` | regenerated | INV-3 of the constitution (adopters get the same files) |

The FR-4 resolver change itself is out of scope (SPEC-012, #528). This plan ships the pure
predicate #528 consumes and nothing in `next-task.ts`.

## The type table (FR-8)

One table, two copies: TypeScript in `@aiclarity/shared` (Tier-0, for the extension and the
#528 resolver) and CommonJS in `ai-review-guard.js` (for CI and shell scripts, which ship to
adopters who have no `@aiclarity/shared`). A parity test requires both and compares them on a
fixed path list, so the copies cannot drift silently.

```ts
export type ReviewType =
  | 'spec' | 'plan' | 'design' | 'tasks' | 'dr' | 'constitution' | 'epic' | 'issue' | 'pr';
export type Criticality = 'high' | 'low' | 'none';
export interface ReviewTypeRow {
  readonly type: ReviewType;
  readonly label: string;          // display name the role prompt uses, e.g. 'Spec (requirements)'
  readonly criticality: Criticality;
  readonly autoApprovable: boolean; // FR-6 may lift the human gate
  readonly hasStatusContext: boolean; // false only for 'issue' (OQ-4) and 'pr' (existing ai-review)
  readonly minBreadth: 'critical-only' | '+downstream' | 'all';
}
export const REVIEW_TYPES: readonly ReviewTypeRow[];
```

| type | criticality | autoApprovable | status context | reviewed from breadth |
|---|---|---|---|---|
| spec | high | no | `ai-review/spec` | critical-only |
| plan | high | no | `ai-review/plan` | critical-only |
| dr | high | no | `ai-review/dr` | critical-only |
| constitution | high | no | `ai-review/constitution` | critical-only |
| epic | high | no | `ai-review/epic` | critical-only |
| pr | high | no | existing `ai-review` (unchanged) | critical-only |
| design | low | yes | `ai-review/design` | +downstream |
| tasks | low | yes | `ai-review/tasks` | +downstream |
| issue | none | (never gated) | none, label + comment only | all |

No slug equals `pass`, so no new context can collide with the existing `ai-review/pass`
status that SPEC-054's manifest names. A test asserts this.

Predicates (pure, both copies):

- `classifyApprovable(path, frontmatterType?)`: frontmatter `type:` wins (`requirements` to
  `spec`, `plan`, `design`, `tasks`), else by path: `docs/decisions/DR-*` to `dr`,
  `docs/epics/EPIC-*` to `epic`, `.minspec/constitution.md` to `constitution`, `requirements.md`
  or `spec.md` to `spec`, `design.md`, `tasks.md`, `plan.md` by name, else `undefined`. The
  spec, DR and epic answers agree with `classifyApprovablePath` (a test checks the overlap).
- `isHumanGated(type, autoApprove)`: `issue` never; high criticality always (INV-6: an
  `autoApprove` list that names a high type changes nothing); `design`/`tasks` unless listed.
- `isReviewedAtBreadth(type, breadth)`: compares `minBreadth` on the order
  `critical-only` < `+downstream` < `all`.
- `isHumanTaskEligible({ type, greenlit, priorStageGatesClear, humanGateOpen, autoApprove })`:
  the FR-4 / INV-4 contract, `isHumanGated && greenlit && priorStageGatesClear && humanGateOpen`.
  #528 imports it; it is unused by this spec's code beyond its test.

## The review config (FR-6, FR-7)

In `.minspec/config.json`, read by both copies:

```json
"review": { "breadth": "all", "depth": "single", "autoApprove": ["design", "tasks"] }
```

- **Defaults when the block is absent:** breadth `all`, depth `single`, `autoApprove: []`.
  Breadth `all` is the default because INV-3 makes AI review the universal floor; narrowing is
  the dev's explicit choice. `autoApprove: []` is DR-047 Decision 5's "off by default".
- **Deny by default, matching `resolveAutonomy`:** an unknown breadth or depth falls back to
  the default with a warning; `autoApprove` keeps only `design`, `tasks`, `issue` and drops
  anything else with a warning naming it (INV-6). There is no value that lifts a high gate.
- **Dogfood (this repo):** breadth `all`, depth `single`, `autoApprove: ["design", "tasks"]`
  (OQ-1, OQ-2).
- **"Per-dev" in CI.** The spec says per-dev; CI cannot read a developer's settings. Under solo
  mode (DR-075/DR-076) the repo's config is the developer's. A per-user override in a team
  profile is parked with team mode, and this is recorded as a rejected alternative below.
- **Two surfaces (FR-7).** `review.depth` governs only the doc-approvable reviewer. The CI
  PR-diff panel stays on `AI_REVIEW_COVERAGE`; no code reads one from the other, and a test
  asserts that the per-type step never reads `AI_REVIEW_COVERAGE`.

Depth `panel` on the doc surface runs `review-approvable.sh` three times, with roles
`approvable-reviewer`, `architect`, `skeptic`, and takes the worst outcome.

## Per-type recording (FR-3)

For every approvable a pull request adds or modifies, filtered by breadth:

1. Mark pending at run start: `ai-review:<type>:pending` label and `ai-review/<type>` status
   `pending` on the head SHA. Existing per-type `:pass` labels are removed in the same write
   (the same staleness rule as `Clear stale pass at run start (mark pending)`).
2. Run `review-approvable.sh <doc> --type <type> --no-tools` from the **base** checkout over
   the **head** document content, then `review-decide.sh`. Outcome mapping:
   `ai-review:pass` to `pass`; `ai-review:changes` to `changes`; an unavailable or quota result
   to `pending`. A per-type `pending` also sets the combined `ai-review:blocked` label, because
   `ai-review-retry.yml` re-runs (`gh run rerun`) only runs whose PR carries that label; the
   rerun repeats the per-type step with the rest of the workflow.
3. Aggregate per type, worst wins: `escalated` > `changes` > `pending` > `pass`
   (`aggregateTypeVerdicts`). Two specs in one PR give one `ai-review:spec:*` label.
4. Post `ai-review/<type>` (state `success` for pass, `failure` for changes or escalated,
   `pending` for pending) and set exactly one `ai-review:<type>:*` label. Every write is
   observed and fails the step visibly on error (constitution invariant 2; checked by
   `check:swallowed-gate` today and SPEC-054's linter once built).
5. Append a `### Per-type review` section to the verdict comment: per document its path, blob
   SHA, type, outcome and findings. The blob SHA keys carry-forward: a document whose blob and
   base scripts are unchanged since a recorded pass carries that pass instead of re-reviewing,
   which bounds the extra token cost to documents that changed.

Issue (OQ-4): `ai-review:issue:{pass,changes,pending}` label plus a findings comment, no
status, never `escalated` (see FR-2 below).

## Merge-gate reflection (INV-4, INV-8, FR-6, FR-9)

`decideStatus` in the guard gains an input `typeSignals: { labels, statuses }`:

- Any `ai-review:<type>:{changes,pending,escalated}` label **or** any `ai-review/<type>` status
  in `failure` or `pending` on the head makes the result `failure`, with a reason naming the
  type. Two witnesses of different mechanisms (label and commit status), so one hand-removed
  label cannot clear a red type.
- Per-type `:pass` signals are **negative-only**: they never turn a failure into success. A
  hand-added `ai-review:spec:pass` therefore grants nothing. Label provenance stays out of
  scope (#428 / #397), as the spec says.

Because every type-driven failure flows through the existing state, `shouldAwaitApproval`
already returns false for it: `awaiting-approval` can never coexist with a per-type
`:changes` (INV-8). This is the FR-9b applier for pull-request-attached documents. Every
approvable in this repo lands through a pull request (the pre-commit gate refuses commits on
`main`), so the
single owner in `ready-to-merge.yml` stays the only writer of the label and no second applier
is built.

FR-6 bites in one place: `shouldAwaitApproval` gains `onlyAutoAcceptedDocs`, computed by
`prOnlyAutoAcceptedDocs(changedFiles, config)`: true when every changed file classifies as an
approvable whose `isHumanGated` is false. Then no `awaiting-approval` is applied (not a human
turn). This gives the acceptance trio its observable: `autoApprove` off, a greenlit
design.md-only PR carries `awaiting-approval`; on, it does not; a greenlit DR PR carries it
either way. Merge gating is unchanged: required checks and the existing merge paths decide.

## FR-2 - bounded loop and human-authored fallback

`remediate-pr.sh`'s classifier treats any `ai-review:<type>:changes` like `ai-review:changes`:
the findings come from the `### Per-type review` section, and the same attempt and crash
budgets apply. Two additions:

- **Human-authored (non-automation branch, the existing scope guard):** on the first per-type
  `:changes`, set `ai-review:<type>:escalated` and `agent-escalated`, post the findings, and
  dispatch no agent. Once per head SHA.
- **Budget exhausted:** set `ai-review:<type>:escalated` and `agent-escalated` (today's path
  adds `agent-escalated`; the per-type label is new).

An Issue verdict is terminal and advisory: no loop and no escalation label, because an Issue is
never human-gated (INV-3) and an escalation would create the human task the acceptance list
forbids.

## FR-5 - ordering gate (OQ-3: CI is the enforcing copy)

The doc-to-code pairing is SPEC-038's `implements:` / `affects:` frontmatter, the same source
`owned_file_set` in `scripts/hooks/spec-gate.py` uses, matched case-insensitively like its
`owned_match`. No new convention.

`planReviewOrdering({ changedFiles, docs })` (pure, in the guard), where each doc is
`{ path, type, implements, greenlit }`:

- A changed code file in the `implements` set of a changed doc that is not greenlit in this run
  is **deferred**.
- Every other changed file is **reviewed now**, including code implementing a greenlit doc and
  code no doc claims (INV-5: never PR-wide; the #426 regression).
- A doc without `implements:` defers nothing.

In `ai-review.yml` the per-type step runs **before** `Independent review → decide combined
label`. The code reviewer then receives the diff minus deferred files, with a note listing them.
The verdict comment records `deferred: <paths>`. The merge is already blocked by the doc's own
`:changes` or `:pending` (INV-4 above), so deferral costs no new required context. When the
doc is fixed and re-pushed, carry-forward refuses (finding 7) and the deferred code is reviewed
against the now-greenlit doc. `review-pr.sh` runs the same pure function locally as preview.

## FR-1 - the Issue reviewer

`ai-review-issue.yml`, `on: issues: types: [labeled]`, runs when the added label starts with
`role:` or equals `triage` (promotion from inbox, OQ-4) and the base config's breadth is `all`.
It writes the issue body to a file, runs `review-approvable.sh <file> --type issue` (`--type
issue` implies `--no-tools`), decides, and as `minspec-sdd[bot]` sets the label and posts the
findings comment. It never writes `needs-human-review`, `awaiting-approval` or any `hold:*`.
It joins the adopter template registry so adopters get it with `ai-review.yml`.

## Invariants, and where each is held

| Invariant | Held by |
|---|---|
| INV-1 independence | every reviewer launch is a fresh `claude -p` with a role system prompt and no `--resume`/`--continue`/`--session-id`; T0 test greps both runners and both workflows |
| INV-2 advisory | no `ai-approved` literal anywhere (T0 test); the reviewer agent holds no `gh` and, in CI, no tools; per-type pass labels are negative-only in `decideStatus` |
| INV-3 superset vs subset | the table: `issue` reviewed at breadth `all`, `isHumanGated('issue', any)` false; the Issue workflow never writes a human-queue label (test) |
| INV-4 no un-greenlit human task | `decideStatus` type signals; `isHumanTaskEligible` contract for #528 |
| INV-5 ordering scoped to implementing code | `planReviewOrdering` tests, including the spec's mixed-PR acceptance case |
| INV-6 auto-approve never drops a high gate | `isHumanGated` ignores high types in `autoApprove`; config resolver drops them with a warning; CI reads config from the base only |
| INV-7 Tier-0 extension | the extension only gains a config field and a pure import; `packages/minspec/tests/invariants.test.ts` (existing) stays green |
| INV-8 one positive signal | single owner unchanged; `shouldAwaitApproval` false on any type failure (test) |

## Rejected alternatives (DR-086 section 4)

- **A separate per-type runner script** beside `review-pr.sh`: FR-1 asks for one shared seam;
  `review-pr.sh` and the workflow call the existing `review-approvable.sh` per document.
- **One TypeScript table read by CI through `tsx`:** adopters' CI has no `@aiclarity/shared`;
  a CommonJS twin plus a parity test keeps one behaviour without a build step in CI
  (`config.ts` already mirrors `scripts/lib/autonomy.ts` this way, but by comment only; this
  plan adds the test).
- **A new required `ai-review/ordering` context:** the doc's own failing type already blocks the
  merge, and a new required context needs a ruleset write the App does not have.
- **Per-type pass as a positive merge signal:** forgeable by anyone with write access.
- **A per-user config file for "per-dev":** no CI can read it; parked with team mode.
- **Tools for the CI reviewer so it can open referenced docs:** the `claude -p` rule; documents from forks and
  issues from the public are untrusted.
- **Treating design.md as Plan (high):** contradicts OQ-1 and FR-6, which name design.md.

## Risks added by this plan

| # | Risk | Mitigation |
|---|---|---|
| P1 | Token cost: one extra reviewer call per changed approvable per push (three at depth `panel`). | Blob-keyed carry-forward; breadth filter; dogfood depth `single`. |
| P2 | The two table copies drift. | Parity test over a fixed path list and the full row set. |
| P3 | `.github/workflows/**` cannot be pushed by the App (no `workflows` scope), so group 8 stalls. | Groups 1-7 land every pure seam and the local runner first; group 8 is three workflow edits and one regeneration. |
| P4 | Without tools, the CI reviewer cannot open the DR or constitution a doc cites, so it may flag missing context. | The prompt states it reviews content only; cross-reference checks remain with the local preview and with `validate`. |
| P5 | Label sprawl: 8 types times 4 states. | One prefix, `ai-review:<type>:*`, created idempotently by the workflow step that writes it. |

## Follow-ups (tracked)

- FR-4 resolver change: #528 (consumes `isHumanTaskEligible`).
- Label provenance for per-type labels: out of scope per the spec (#428 / #397).
- Retiring eager `needs-human-review`: #816 (FR-9c).
- Backfill review of existing approvables: #362.
- Per-user review config for team mode: parked with team mode (DR-075); none filed.
