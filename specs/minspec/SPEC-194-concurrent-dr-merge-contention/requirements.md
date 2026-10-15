---
id: SPEC-194
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a duplicate DR id or a hand-merged INDEX is a register that lies about its own decisions
aspects: [dr-index, dr-id, derived-artifact, merge-contention, concurrency, ci, no-silent-gate, blast-radius]
relates_to: [DR-003, DR-023, DR-061, DR-066, "#754", "#1226", "#366", "#220", "#168", "#1418", "#743", "#725"]
# Ownership is a Plan-phase measurement and depends on the DQ-1 answer below (the
# INDEX half changes shape completely between options). Declared now only for the
# files that every answer needs.
implements: [scripts/regen-dr-index.ts, scripts/renumber-dr.ts]
---

# SPEC-194: Two decisions in flight at once must not collide on their number or on the INDEX

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers the questions under **Decisions needed (Clarify)**, and approves it
> through the normal spec-approval gate before any code changes. No DR is minted here:
> the one irreversible choice in this area (DQ-1) is the human's, and the DR that records
> it is written once it is made (FR-9).

Materializes **[#754](https://github.com/AIClarityAU/minspec/issues/754)** - *"Concurrent
DR creation collides on numbers + INDEX.md - auto-dispatched PRs each mint max+1 and
regenerate INDEX."*

## Problem

Two pull requests that each add a decision record collide in two independent ways:

1. **Number collision.** Each branch numbers its record `max(existing) + 1` against its
   own checkout, so two branches cut from one `main` pick the same number.
2. **INDEX contention.** Each branch regenerates the managed block in
   `docs/decisions/INDEX.md` and commits it. Two such branches always conflict there, and
   a branch re-conflicts every time `main` gains another decision. A conflicting PR has no
   merge ref, so it cannot merge at all - not even by `--admin`.

Both are live: DR-095 (Context and Follow-ups) says it is DR-095 rather than DR-094
because of this, and DR-061, DR-093, DR-094 and DR-097 all cite #754.

## What already exists (verified by reading, `file:line`)

Half of the issue's missing gate (a) has shipped since #754 was filed. This spec covers
what is still missing; it does not re-specify what exists.

- **Allocation is still local `max + 1`.** `nextAdrNumber`
  (`packages/minspec/src/lib/adr-manager.ts:103-118`) scans the local decisions folder.
  It is Tier 0 and makes no network call (constitution invariant 1), so it *cannot* know
  about other branches. This spec keeps that: the extension does not change.
- **Cross-PR collision detection exists (#1226)** in `scripts/lib/dr-id-collision.ts`
  (pure logic) and `scripts/check-dr-id-collision.ts` (the `gh` IO), run by
  `.github/workflows/dr-id-collision.yml` on every PR with no `paths:` filter. It names
  the next free id: the highest across the base branch *and every open PR*, plus one
  (`dr-id-collision.ts:376-402`). The rule is symmetric: both PRs claiming one id fail,
  and the message says "Renumber all but the earliest claim" (`:205`).
- **That check is advisory.** The workflow's own header (`dr-id-collision.yml`, "REQUIRED
  MANUAL STEP") says it does not gate until `dr-id-collision` is added to `main`'s
  ruleset, and CLAUDE.md ("Decision Register") repeats that it is not in the required
  set. I did not read the live ruleset (no network on this dispatch); I believe, from
  those two in-repo statements, that it is still advisory - Plan phase must read
  `/rules/branches/main` to confirm.
- **Renumbering is manual.** The check prints the steps (`dr-id-collision.ts:402-`);
  nothing does them.
- **The INDEX is derived, but not purely from the DR files.** `regenerateDrIndex`
  (`adr-manager.ts:1153`) rebuilds the managed block from the DR files *plus* any
  human-edited summary already in INDEX.md: each entry carries
  `<!-- dr-summary:DR-NNN auto=<hash> -->`, and a summary that no longer matches its hash
  is treated as curated and kept (`adr-manager.ts`, `summaryFingerprint` and the comments
  around it, issue #191). So "throw away one side and regenerate" can lose the other
  side's curated summaries. Any automatic resolution has to merge those, not drop them.
- **`adr-manager.ts` imports no `vscode`** (checked by grep), so a script can call the
  regenerator headlessly.
- **Rule 8 is fatal** (`scripts/validate-frontmatter.ts:369-382`). Every DR must have an
  INDEX entry whose status matches, and every entry must have a DR. A branch that adds a
  DR without updating INDEX.md fails `validate`. So the issue's fix direction 1 ("don't
  commit INDEX.md per-branch") cannot be adopted as worded without changing Rule 8.
- **A sibling spec pulls the other way.** The #366 spec (on branch `agent/issue-366`, numbered 137 there,
  `specifying`, not on `main`) makes the INDEX entry *atomic with* the DR commit, adding a
  pre-commit witness and a CI witness. That increases how often INDEX.md is committed per
  branch, which is exactly the contention surface #754 wants removed. The two specs must
  agree before either is approved (DQ-1).

**Root cause (mechanism plus missing gate).**
- *Numbers:* ids are allocated optimistically on each branch, and nothing serialises
  them. The detecting gate exists but does not block a merge.
- *INDEX:* a derived file is committed on every branch. Git's three-way merge sees two
  insertions at the same place, the end of the managed block, and cannot know the file is
  derivable. There is no tool that re-derives it at the merge point, so a person resolves
  it by hand on every conflict.

## Functional requirements

### The number half

- **FR-1 (the collision gate blocks merges).** `DR id uniqueness` is a required status
  check on `main`. Until a human adds it to the ruleset, every artifact that describes
  the gate keeps saying it is advisory: the workflow header, CLAUDE.md, and this spec's
  AC-1. They must not be reworded to imply it gates before it does. Adding it is a human
  ruleset action; the repo's App token cannot edit rulesets.
- **FR-2 (id at authoring time, when it can be had).** Dev-time dispatch
  (`scripts/dispatch-issue.sh`, which already uses the network) runs the same next-free
  computation as the gate (`check-dr-id-collision.ts`, which reports a next-free id even
  for a PR that adds no decision) and puts the result in the agent prompt as the id to
  use. The id is a hint, not a reservation: two dispatches in the same second can still
  get the same id, and FR-1 catches that. If the lookup fails, the prompt says so
  ("next free id unavailable - the collision check will assign one"). It does not fall
  back to `max + 1` silently (invariant 2).
- **FR-3 (renumbering is a command, not a recipe).** `scripts/renumber-dr.ts <old> <new>`
  renames the file, rewrites its `id:` and H1, regenerates INDEX.md, and rewrites
  references to `<old>` **only in files this branch added**, compared with the merge base.
  It must **not** rewrite references in files that already exist on the base. There,
  `DR-<old>` may mean the *other* record, the one that won the number. It lists each such
  reference as `file:line` for a person to judge. It refuses to run if `<new>` already
  exists locally, and it exits non-zero (with the list) whenever any reference was left
  for a person.
- **FR-4 (Tier 0 boundary).** Nothing in FR-1 to FR-3 enters `packages/`. The extension
  keeps its offline `max + 1` as a starting draft (CLAUDE.md "Decision Register").
  Cross-branch knowledge stays in CI and dev-time `scripts/` (invariant 1).

### The INDEX half

The shape depends on DQ-1. These requirements hold under the recommended option (a), and
are restated for whichever option is chosen.

- **FR-5 (INDEX conflicts are re-derived, never hand-merged).** `scripts/regen-dr-index.ts`
  resolves a conflicted `docs/decisions/INDEX.md` by rebuilding it from the merged DR
  files, using `regenerateDrIndex`'s own rendering (one definition of the INDEX, not a
  second renderer). Curated summaries come from **both** sides' INDEX: for each DR, a
  curated summary from either side survives. If both sides curated the *same* DR
  differently, that is a real conflict. The script stops, exits non-zero, writes nothing,
  and names the DR. It never picks one side silently.
- **FR-6 (wired where merges happen locally).** The resolver is registered as a git merge
  driver for `docs/decisions/INDEX.md` through `.gitattributes` and this repo's `prepare`
  step, the same mechanism that sets `core.hooksPath`. Local merges and rebases (the
  funnel's branch updates, an agent rebasing) then never stop on INDEX.md. If the driver
  fails, git keeps the conflict: the driver leaves conflict markers and exits non-zero,
  and never writes a half-built file.
- **FR-7 (what this does not fix, said aloud).** I believe, unverified, that GitHub's
  server-side mergeability check does not run custom merge drivers. If so, a PR still
  *shows* "conflicting" until someone updates its branch locally. Plan phase measures
  this with one throwaway PR pair before relying on either reading. The spec claims to
  remove the hand-merge, not the conflict badge, unless that measurement says otherwise.
- **FR-8 (Rule 8 still holds after resolution).** After the resolver runs,
  `npm run validate` passes Rule 8 on the merge result. A resolution that cannot satisfy
  Rule 8 fails visibly. It is never committed with `DR_INDEX_GATE_OFF`.

### Recording and scope

- **FR-9 (the DR follows the answer).** Whichever DQ-1 option is chosen gets a decision
  record before implementation starts. Changing whether INDEX.md is tracked, or adding a
  merge driver, cannot be undone in under a day across every open branch (the parent-register ADR
  filter). That DR takes its number from the collision gate (FR-2), not from disk.
- **FR-10 (blast radius).** The merge driver, `prepare` wiring and scripts in this spec
  are installed in **this** repo only. Shipping any of them to adopters through
  `scaffold.ts` or the template registry is out of scope (DQ-3). If that is ever done, it
  only happens in a repo with `.minspec/` (invariant 3).

## Acceptance criteria

- **AC-1.** A PR adding `DR-N` while another open PR, or `main`, already has `DR-N` fails
  `DR id uniqueness`, and the PR cannot merge without a bypass. Shown by the ruleset
  listing the check, and by one live collision being refused (not by reading the
  workflow).
- **AC-2.** `renumber-dr.ts 104 106` on a branch that added `DR-104` renames the file,
  rewrites `id:`/H1/INDEX, and rewrites `DR-104` only in files that branch added. A
  `DR-104` mention in a file that already exists on the base is listed and left alone.
  The exit code is non-zero when anything was listed. A fixture has a base file that
  cites the *other* DR-104 and checks that the file is unchanged afterwards.
- **AC-3.** Two branches from one base, each adding one DR and regenerating INDEX.md,
  merge locally with no manual step once the driver is installed, and the result passes
  `npm run validate`. A run without the driver conflicts. That run is the control: it
  shows the fixture really does conflict.
- **AC-4.** The same pair, where both sides curated the summary of one existing DR
  differently, stops with a non-zero exit naming that DR, and INDEX.md is left with
  conflict markers. A pair where only one side curated it keeps that curation.
- **AC-5.** When the dispatch-time lookup fails (simulated `gh` error), the agent prompt
  says the id is unavailable, and it does not contain a `max + 1` number.
- **AC-6.** No file under `packages/` gains a network call, `gh` invocation, or `child_process`
  use from this work (grep plus the existing Tier 0 tests).
- **AC-7.** The FR-7 measurement is recorded in the DQ-1 DR as observed behaviour, with
  the PR numbers it was observed on.

## Invariants this must not break

1. **Offline core (invariant 1).** The extension's DR creation stays local `max + 1`. All
   cross-branch knowledge lives in CI and dev-time scripts.
2. **No silent gate (invariant 2).** The collision check blocks the merge (FR-1), or is
   described as advisory everywhere it is mentioned. The resolver and the driver fail with
   conflict markers and a non-zero exit, never with a guessed side. FR-2's lookup failure
   is said in the prompt. Two witnesses stay: the validator's offline Rule 17 (declared
   id/filename) and the CI cross-PR check.
3. **Blast radius (invariant 3).** The driver and wiring are scoped to this repo (FR-10).
4. **Rule 8 and the curated-summary contract (#191, #220)** keep their meaning. No
   resolution path drops a human-written summary.
5. **Accepted DRs are never overwritten.** No path may make a PR merge a file over an
   existing `DR-N` (the #1209 near-miss that #1226 records).

## Decisions needed (Clarify)

**DQ-1. How should the INDEX contention surface be removed?** (Decides FR-5 to FR-8, and
must be agreed with the #366 spec, which pulls the other way.)
- (a) **Keep INDEX.md tracked. Re-derive it at every local merge with a merge driver and
  resolver (FR-5 to FR-8)** **(rec)**. Smallest change, keeps Rule 8 and the #366 spec
  coherent, and keeps the register readable on GitHub. Cost: if FR-7's belief holds,
  GitHub still shows the PR as conflicting until the funnel or author runs a local branch
  update. The toil goes from hand-merging to one command, but the badge stays.
- (b) **Stop tracking INDEX.md in this repo** (gitignore it, generate it locally on
  `prepare` and in `validate`). Removes the surface entirely. Cost: the register can no
  longer be browsed on GitHub. Rule 8 and most of the #366 spec become moot. Every fresh
  worktree needs a generate step before an agent can "check INDEX.md" as CLAUDE.md and
  the dispatch prompt tell it to. The curated summaries (#191) need a new home, because
  they live only in INDEX.md today.
- (c) **Regenerate on `main` after each merge with a bot commit** (issue fix direction 1
  as worded). Cost: `main` has no bypass actor by design, so a bot cannot push there.
  This becomes a bot PR per merge, and that PR can itself conflict. Rule 8 must also be
  relaxed so branches may carry a stale INDEX. Not recommended.
- (d) **`merge=union` (git's built-in driver) on INDEX.md.** Cheapest. Cost: unverified
  whether GitHub applies it server-side. A clean union also leaves entries out of order,
  and when both sides change one entry's status, both lines survive. Rule 8 should catch
  that, but the merge itself would *succeed* with a wrong file. Not recommended.

**DQ-2. Replace sequential DR integers with date or content-derived ids** (issue fix
direction 3)?
- (a) **No - keep sequential ids, made safe by FR-1 to FR-3** **(rec)**. Cost: a
  collision is still possible and costs one renumber of the later PR.
- (b) Yes. Ends collisions by construction. Cost: a corpus-wide migration of ~105 DRs and
  every reference to them, and it collides with DR-053 v2's accepted `DR` + number
  grammar (`MIN/DR53`). That is a reversal of an accepted DR, which needs its own record.

**DQ-3. Should adopters get the INDEX merge driver too?** The extension writes INDEX.md
in every adopter repo, so a solo adopter running two branches meets the same conflict.
- (a) **Not in this spec - dev repo only, with a follow-up issue filed when this spec is
  approved** **(rec)**. Cost: adopters keep hand-merging INDEX.md until then. Solo mode
  (DR-075/DR-076) makes this rarer, not impossible.
- (b) Yes, scaffolded into `.minspec/` repos. Cost: the extension starts writing git
  config (a merge driver needs `git config`, not just a file), which is new extension
  surface and a template-registry (machinery) change.

**DQ-4. Who makes the FR-1 ruleset change?** Only a human with admin can.
- (a) **The founder, once, as a single ruleset edit, with the check named exactly
  `DR id uniqueness`** **(rec)**. Cost: a ruleset PUT replaces the whole rule set, so a
  retyped payload can drop other required checks. The edit should go through the UI or
  a read-modify-write.

## Out of scope

- The extension's `nextAdrNumber` (stays offline, invariant 1).
- Making the INDEX entry atomic with the DR commit. That is the #366 spec; this spec
  only requires the two to agree (DQ-1).
- Spec-id collisions (SPEC-NNN), which have the same root cause and their own offline
  gate (#1418, Rule 18). No cross-PR spec-id check exists today. This spec's own id was
  picked as one above the highest SPEC-NNN found across the locally fetched remote
  branches (number 193), so the fetch may be stale and the id is not guaranteed free.
