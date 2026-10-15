---
id: SPEC-139
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-009  # Team Readiness - its Goal names "SDD artifact IDs that never collide across clones"
aspects: [ids, numbering, concurrency, merge, references, approvals, ci, tier-0, team-mode]
relates_to: [DR-075, DR-076, DR-053, DR-034, DR-104, DR-003, SPEC-022, SPEC-035, "#267", "#176", "#168", "#754", "#1226", "#1418"]
# No `implements:` yet. Which modules own the draft-token grammar and the minting step depends
# on DQ-1 (where the mint runs) and DQ-3 (what an approval made on a draft is worth); the Plan
# phase declares ownership once those are answered, before this spec is approved.
phases:
  specify: done
  clarify: pending
---

# SPEC-139: Mint DR and SPEC numbers at merge, not in the worktree

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers or ratifies the questions under
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before any design or code. Each question names a recommended
> option and what that option costs. The requirements below are written under the
> recommended options; where an answer changes a requirement, the question says which.

**Source:** [#267](https://github.com/AIClarityAU/minspec/issues/267) - "mint DR/SPEC
numbers at merge (single serialization point) - team/multi-clone collision-proof IDs".
**Design rationale:** no decision record yet. The choice of minting point is not reversible
in under a day (the parent register's ADR filter), so FR-15 requires a DR once DQ-1 is answered; it is not
written now because writing it now would record a decision nobody has made.

## One-Sentence Scope

New decision records and specs are authored under a collision-free provisional id
(`DR-DRAFT-<slug>`, `SPEC-DRAFT-<slug>`), and the canonical `DR-NNN` / `SPEC-NNN` is
assigned by one serialized minting step against `main`, which also rewrites every
reference to the provisional id, so that two clones or worktrees can never land the same
number.

## Context - what the code does today (read from this worktree's base `5f792386`, not inferred)

### Both allocators are `max(local view) + 1`

- **DR:** `nextAdrNumber` (`packages/minspec/src/lib/adr-manager.ts:105`) scans the local
  decisions directory and returns the highest `DR-NNN` filename number plus one.
- **SPEC:** `nextSpecId` (`packages/minspec/src/lib/spec-manager.ts:212`) does the same over
  the local specs tree, optionally scoped per product (#57).
- **EPIC:** `nextEpicId` (`packages/minspec/src/lib/epic-manager.ts:453`) is the same shape.
  It is not named by #267; see DQ-6.

Each is correct in isolation and unique only if creation is serialized through one view.
Concurrent worktrees (#168, the normal working mode here) and separate clones break that
by construction.

### What catches a collision after the fact

- **DR, offline:** `checkDeclaredDrIds` (`scripts/lib/dr-id-collision.ts`, half A) rejects
  two files declaring one `id:` and a file whose `id:` disagrees with its filename.
- **DR, cross-PR:** `decideDrIdCollision` (same file, half B) via
  `scripts/check-dr-id-collision.ts` and `.github/workflows/dr-id-collision.yml`, compares
  the ids a PR adds against the base branch and every open PR and names the next free id.
  It is advisory - not in `main`'s required-check set (CLAUDE.md, Decision Register).
- **SPEC, offline only:** `scripts/lib/spec-id-collision.ts` (#1418) rejects duplicate and
  mismatched spec ids in one tree. There is no cross-PR spec check.

Detection works; prevention does not exist. Every collision costs a renumber, and a
renumber decays: #1209 was renumbered twice in one day and still landed on an accepted
DR-077 (`scripts/lib/dr-id-collision.ts` header).

### Live evidence at the time of writing

Reading only branch refs already on this machine (no network), `SPEC-137` is claimed by
three different specs on three branches (`agent/issue-263` dr-followup-auto-materialize,
`cos/phone-home-1015` error-log-diagnostics, `agent/issue-259` project-goals) and
`SPEC-138` by a fourth (`agent/issue-262`). This spec took `SPEC-139` for that reason; the
id may itself already be taken on a branch this machine has not fetched. That is the
defect this spec describes, observed while writing it.

### Why #176 does not cover it

#176 (same-machine atomic allocation via `git rev-parse --git-common-dir` plus advisory
leases) serializes worktrees that share one `.git`. Separate clones, CI runners and agent
containers do not share one. As far as this worktree shows, #176 is not built: no
allocator under `packages/minspec/src/lib/` references the common dir (grep for
`git-common-dir` / `common-dir` in `adr-manager.ts` and `spec-manager.ts` returns nothing).
The issue's own premise - "solo-dev / same-machine is fully covered by #176" - is therefore
not true today. DQ-5 asks whether that changes the timing.

### Three facts that shape the design

1. **The canonical hash covers `id:`.** `specHash` (`packages/shared/src/canonical.ts:126`)
   strips only the lifecycle keys `status` and `phases`. Rewriting `id:` from a draft token
   to a number therefore changes the hash, and any approval recorded against the draft
   becomes stale (DQ-3).
2. **Approval sidecars are keyed by path.** `.minspec/approvals/<repo-relative-spec-path>.json`
   (`packages/minspec/src/lib/approval-store.ts:77`). A spec directory named
   `SPEC-DRAFT-<slug>` that is renamed to `SPEC-NNN-<slug>` moves its sidecar key.
3. **Ids are a grammar, not just a filename.** The validator requires `id: SPEC-NNN`
   (`scripts/validate-frontmatter.ts:208`), `ADR_ID_RE` is `/^DR-(\d+)/`
   (`adr-manager.ts:41`), the collision gates key on directory and file names, and the
   DR-053 reference grammar defines an approvable as code plus number. A draft token is
   outside every one of these today.

## Functional Requirements

### Provisional ids

- **FR-1 - Draft token grammar.** A provisional id is `DR-DRAFT-<slug>` or
  `SPEC-DRAFT-<slug>`, where `<slug>` is lowercase `[a-z0-9-]`, 3 to 60 characters, and
  unique within its kind across the repository. One shared pure module defines the grammar,
  parsing and formatting; every other consumer imports it rather than restating a regex.
- **FR-2 - Authoring under a draft.** When mint-at-merge is enabled (FR-12), *MinSpec:
  Create Architecture Decision Record* and spec creation write the draft token as the
  frontmatter `id:`, the filename (`DR-DRAFT-<slug>.md`) or directory
  (`SPEC-DRAFT-<slug>/`), and the heading. No number is computed. This step is offline and
  needs no coordination.
- **FR-3 - Slug collisions are local and cheap.** If the chosen slug already exists in the
  local view, creation refuses with a message naming the existing file and asks for another
  slug. Two clones that independently choose the same slug are caught by FR-9, not
  prevented; the slug is human-chosen and descriptive, so this is expected to be rare.

### The minting step

- **FR-4 - One serialized minter.** Canonical numbers are assigned by exactly one minting
  step whose input is the tip of `main` (DQ-1 decides where it runs). For each draft in the
  change it assigns `max(numbers of that kind on main) + 1`, in a deterministic order
  (by draft slug, ascending), honouring per-product spec ranges as `nextSpecId` does today.
- **FR-5 - The mint is a pure function.** Given the same `main` tip and the same drafts, the
  minter produces the same assignment and the same rewritten bytes. The computation lives in
  a pure module (no `fs`, no network, no `vscode`) so it is tested by calling it; the IO
  wrapper is separate.
- **FR-6 - Serialization must hold, or the mint must refuse.** The minter fails closed and
  visibly if it cannot prove that the `main` tip it computed against is the tip the change
  lands on. Under the recommended DQ-1 option this is structural (one minter, one queue).
  Under any option that runs inside a PR, it must re-mint on every base update, and it must
  refuse a merge path that bypasses the up-to-date requirement - CLAUDE.md records that
  machinery PRs merge by human `--admin`, which does exactly that.
- **FR-7 - Reference rewrite.** The minter rewrites every occurrence of the draft token in
  the change - frontmatter `id:`, `relates_to:` and similar lists, Markdown links
  (`DR-DRAFT-x.md` to `DR-NNN.md`), headings, prose, and INDEX entries - to the minted id,
  and renames the file or directory. Occurrences inside fenced code blocks are rewritten too
  unless they are inside a block the author marks as literal (the Plan phase names the
  marker).
- **FR-8 - The draft token stays resolvable.** The minted artifact keeps its draft token in
  frontmatter (`draft_id: DR-DRAFT-<slug>`) permanently, and every reference resolver
  (DR-053 `resolveRef`, SPEC-035 lozenges, `npm run facts`) resolves a draft token to its
  minted id. A reference written on another branch before the mint therefore still resolves
  after it, without that branch being rewritten.
- **FR-9 - Draft-slug uniqueness at the mint.** If two changes carry drafts of the same kind
  with the same slug, the second to reach the minter fails visibly naming both, rather than
  minting both under one `draft_id`.

### Gates

- **FR-10 - Drafts on a branch pass validation; drafts on `main` do not linger.** The
  validator accepts a draft token wherever it accepts a canonical id (Rule 2's `id:` check,
  the DR and spec duplicate/mismatch halves). A draft is a valid state on a branch. On
  `main`, a draft is a valid state only for as long as the recommended DQ-1 option's
  numbering pass takes; the Plan phase sets the bound and a check reports any draft older
  than it, visibly (invariant 2).
- **FR-11 - Existing collision gates keep working.** `checkDeclaredDrIds`,
  `decideDrIdCollision` and the spec-id gate treat a draft token as its own id class: two
  `DR-DRAFT-x` files collide with each other, never with a numbered DR. A numbered id added
  by hand while mint-at-merge is enabled is reported, not silently accepted (DQ-4).

### Opt-in and modes

- **FR-12 - Off by default; enabled per repo.** `.minspec/config.json` gains an
  `idAllocation` setting, `"sequential"` (today's behaviour, the default) or
  `"mint-at-merge"`. With `"sequential"` nothing in this spec changes behaviour. A repo
  without `.minspec/` is never touched (invariant 3).
- **FR-13 - The extension stays Tier-0.** Creating a draft, validating drafts and resolving
  draft references are offline. The minting step is not part of the extension; it ships as
  an opt-in CI workflow template (under the recommended DQ-1 option), the same
  dev-time-versus-product split DR-015 draws for dispatch. The extension makes no network
  call to mint (invariant 1).
- **FR-14 - Existing artifacts are not renumbered.** Every numbered DR and spec on `main`
  keeps its number. The mint applies only to artifacts created as drafts.

### Records

- **FR-15 - A decision record before Plan.** Once DQ-1 and DQ-3 are answered, a DR records
  the minting point, the approval treatment, and the rejected alternatives, carrying
  `Triggered by: #267`. Its id is taken from the collision gate (CLAUDE.md, Decision
  Register), not from the files on disk.
- **FR-16 - Documentation.** CLAUDE.md's Decision Register section and the shipped template
  equivalent describe the draft-then-mint flow for repos that enable it, and keep the
  current instructions for repos that do not.

## Acceptance Criteria

- **AC-1** Two clones of one repo, each starting from the same `main`, each create a DR as a
  draft and land it. The two DRs end with different numbers, both equal to the next free
  numbers on `main` at their mint, and no human renumbered anything. Same for specs.
- **AC-2** A draft DR referenced from a second draft spec in the same change: after the mint,
  both carry minted ids, the spec's `relates_to:` and links point to the minted DR id, and
  no draft token remains outside `draft_id:`.
- **AC-3** A branch written before the mint that references `DR-DRAFT-x` resolves that
  reference to the minted `DR-NNN` in the extension and in `npm run facts`, without editing
  that branch.
- **AC-4** With `idAllocation` absent or `"sequential"`, every existing allocator test passes
  unchanged and creation produces `max + 1` exactly as today.
- **AC-5** The minter run twice on the same `main` tip and drafts produces byte-identical
  output (FR-5), tested by calling the pure module.
- **AC-6** A merge path that bypasses the minter's serialization (FR-6) is refused with a
  visible failure naming the reason; it never lands an un-minted or wrongly-minted id
  silently. Tested with a fixture whose `main` tip moved between mint and land.
- **AC-7** Two drafts with the same slug from two changes: the second fails at the mint,
  naming both (FR-9).
- **AC-8** The extension's draft creation, validation and resolution run with networking
  disabled.
- **AC-9** Approval behaviour matches the DQ-3 answer, with a test for each case it names.

## Invariants (must not break)

1. **Offline core (constitution invariant 1).** Authoring, validating and resolving drafts
   need no network. Only the opt-in CI minter touches the forge.
2. **No silent gate (invariant 2).** A mint that cannot prove serialization fails closed and
   visibly; a draft lingering on `main` is reported; a mint error is never swallowed. The
   minter is a merge-gating producer, so it needs an independent second witness: the
   existing offline duplicate gates (FR-11) are that witness and must stay required.
3. **Blast radius (invariant 3).** Nothing changes in a repo without `.minspec/`, and nothing
   changes in an opted-in repo until it sets `idAllocation: "mint-at-merge"`.
4. **No borrowed-identity approval.** The minter is a bot. It never writes, re-signs or
   rehashes a human approval record (DQ-3).
5. **Numbers never reused, never moved.** A minted number is never reassigned; existing
   numbers are untouched (FR-14).
6. **DR-053 grammar.** Canonical references keep the v2 grammar; draft tokens are an addition
   the resolver understands, not a change to the canonical form.

## Decisions needed (Clarify)

### DQ-1 - Where does the mint run?

GitHub offers no hook that edits content at the moment of merge, so "at merge" has to be
one of these.

- **A - A numbering pass after merge (rec).** Drafts land on `main` as drafts. A single CI
  workflow on `main` (one concurrency group, so at most one runs) mints every draft on
  `main`, commits the rename and rewrite, and lands it as its own small PR. This is the only
  option that is serialized by construction: there is one minter and it reads `main`, so
  `--admin` merges, merge order and `strict` settings cannot break it.
  *Cost:* a draft is visible on `main` until the numbering PR lands, and each decision
  touches `main` twice. It needs a bot identity allowed to open and land a PR on `main`, and
  this repo's notes record that the App lacks some admin scopes - the Plan phase must verify
  the exact permission before relying on it.
- **B - A pre-merge rewrite on the PR branch.** A required check computes the mint against
  the PR's base and pushes the rewrite to the branch; `strict` up-to-date forces a re-mint
  whenever `main` moves. *Cost:* every base update pushes a commit (re-running checks;
  DR-104 may carry the review across it, unverified), and any `--admin` merge bypasses the
  up-to-date guarantee, which is how machinery PRs land here - FR-6 would have to refuse
  them.
- **C - A local "Land" command.** The extension fetches `main`, mints, rewrites and pushes.
  *Cost:* a network call from the extension (needs consent, invariant 1), and two landers
  racing still collide - it moves the race, it does not remove it.

### DQ-2 - Number ranges per kind and product

- **A - Keep today's ranges (rec).** DRs are one sequence; specs keep per-product ranges as
  `nextSpecId` does (#57). *Cost:* the minter carries the product-scoping rule, one more
  thing to keep in step with `nextSpecId`.
- **B - One global sequence for all specs.** *Cost:* changes numbering behaviour existing
  users rely on.

### DQ-3 - What is an approval made on a draft worth after the mint?

Rewriting `id:` changes the canonical hash (`canonical.ts` strips only `status`/`phases`),
and the sidecar path moves with the rename.

- **A - Approve only after the mint (rec).** Drafts cannot be approved; *Approve Spec* and
  *Accept ADR* refuse a draft with a message to land it first. This matches how specs and
  DRs are approved in this repo today - the spec PR merges at `specifying` and approval
  happens on `main`. *Cost:* in repos that approve before merging, approval waits for the
  numbering pass (under DQ-1 A, minutes).
- **B - Exclude `id:` from the canonical hash and move the sidecar at mint.** *Cost:*
  changing the hash definition changes every existing hash, so every current approval needs
  a migration, and the bot moving an approval file edges toward borrowed identity
  (invariant 4).
- **C - Treat the minted file as a new approvable.** *Cost:* the human approves the same
  content twice.

### DQ-4 - A hand-numbered artifact in a mint-at-merge repo

- **A - Report it, and allow it (rec).** The validator warns that a numbered id was added by
  hand, and the cross-PR gate still checks it. *Cost:* the old collision path stays open for
  anyone who ignores the warning.
- **B - Refuse it.** *Cost:* blocks legitimate fixes such as restoring a deleted DR at its
  original number.

### DQ-5 - Is this still "team mode, later"?

#267 parks this behind team mode on the premise that #176 covers one machine. As far as this
worktree shows #176 is not built, and the collisions observed while writing this spec
(SPEC-137 three times, SPEC-138 once) come from one machine's worktrees and agent
containers. DR-075 parks team mode; DR-076 puts team-only machinery behind a future profile.

- **A - Specify now, build when either team mode or #176 is picked up (rec).** Keep it under
  EPIC-009 Team Readiness and off the solo backlog, but record that it also solves this
  repo's own single-machine collisions, which #176 would solve more cheaply. *Cost:* the
  single-machine collisions keep costing renumbers until #176 or this lands.
- **B - Build it now for this repo.** It covers single-machine and multi-clone in one design.
  *Cost:* the most expensive fix for a problem #176 handles for one machine, and it is team
  machinery DR-075 deliberately parked.
- **C - Close in favour of #176 plus the existing detection gates.** *Cost:* separate clones
  remain uncovered, which EPIC-009's Goal names as required.

### DQ-6 - Epics too?

`nextEpicId` has the same `max + 1` shape and #267 does not name it. Adding it is scope
growth (triage rule 2).

- **A - Design the minter over a table of kinds, accept only DR and SPEC here, and track
  EPIC as a follow-up issue (rec).** *Cost:* one more issue; epics keep colliding meanwhile
  (they are created far less often).
- **B - Include EPIC in this spec.** *Cost:* widens the acceptance surface beyond what #267
  asked.

## Out of Scope

- Same-machine reservation and leases - #176.
- Renumbering existing artifacts (FR-14).
- Migrating the corpus to the DR-053 v2 grammar (#679, #681).
- Any change to approval semantics beyond what DQ-3 selects.
- Team agent dispatch (GitHub Actions for teams) - a sibling under EPIC-009, not part of this.

## Alternatives considered and rejected

- **Reserve numbers in a shared registry** (a file on `main`, an issue, a lock service).
  Needs a network write before authoring, breaks offline authoring (invariant 1), and leaks
  reservations when a draft is abandoned.
- **Non-sequential ids** (hashes, UUIDs, timestamps). Collision-free with no minter, but
  gives up the short sequential numbers the whole corpus, DR-053 grammar and human
  conversation use.
- **Detection only** (make `dr-id-collision` required and add a cross-PR spec gate). Cheaper
  and worth doing anyway, but every collision is still a manual renumber, and renumbers
  decay (#1209).

## Test plan (for the Plan phase to place)

- Pure-module tests for the draft grammar (FR-1), the mint assignment and rewrite (FR-4,
  FR-5, FR-7), and slug collision (FR-9), called directly.
- Validator tests for draft acceptance and the hand-numbered warning (FR-10, FR-11, DQ-4).
- Resolver tests for draft-to-minted resolution (FR-8, AC-3).
- A fixture where `main` moves between mint and land (AC-6), with a control showing the
  fixture really moves `main`.
- An offline test of the extension paths with networking disabled (AC-8).

## Traceability

- Issue: #267. Near-term siblings: #176 (same-machine reservation), #168 (worktree per
  session), #754 (`max + 1` collisions), #1226 (DR collision gate), #1418 (spec collision
  gate).
- Epic: EPIC-009 Team Readiness.
- Decisions: DR-075 and DR-076 (team mode parked), DR-053 (reference grammar), DR-034 and
  SPEC-022 (path-keyed committed approvals), DR-104 (review carried across a no-change push).
- Decision record for this design: to be written at FR-15.
