---
id: SPEC-227
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination; two sessions picking one spec id is that problem
aspects: [spec-id, allocation, concurrency, offline, tier-0, no-silent-gate, ci-gate, dispatch]
depends_on: [DR-004, DR-066]  # DR-004 Tier-0 (the extension makes no network call); DR-066 fail-closed gates
relates_to: [SPEC-053, SPEC-134, SPEC-135, SPEC-136, SPEC-139, SPEC-044, SPEC-073, "#2055", "#1916", "#1418", "#1226", "#2611", "#57", "#168"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). The new reader
# and its tests are owned here, as is the new cross-PR spec-id gate (script, workflow,
# tests). Modified, not owned: spec-manager.ts (nextSpecId switches to the reader; no spec
# claims the file today), facts.ts (one new subcommand), dispatch-issue.sh (owned by
# SPEC-044 / SPEC-073; the Specify prompt gains one computed line), validate-frontmatter.ts
# (Rule 18 comment points at the new gate). Exact file names are the Plan phase's to fix;
# the list below is the expected shape.
implements: [packages/shared/src/claimed-spec-ids.ts, packages/shared/tests/claimed-spec-ids.test.ts, scripts/check-spec-id-collision.ts, .github/workflows/spec-id-collision.yml, packages/minspec/tests/spec-id-cross-pr.test.ts]
affects: [packages/minspec/src/lib/spec-manager.ts, scripts/facts.ts, scripts/dispatch-issue.sh, scripts/validate-frontmatter.ts, scripts/lib/spec-id-collision.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-227: The next spec id counts ids already claimed on unmerged branches

Triggered by: [#2055](https://github.com/AIClarityAU/minspec/issues/2055) (spec-id allocator
is blind to ids claimed by unmerged branches; duplicate SPEC-066 on #1916).

## In plain terms

Every spec needs a unique number. Today the number is picked by looking only at the specs
in the current folder and adding one. Two sessions that start from the same `main` both see
the same highest number, both pick the next one, and the second pull request to merge
fails a required check for a reason that has nothing to do with its content. That is what
happened to #1916 and `main`'s SPEC-066.

This spec makes the picker look further, **without going online from the editor**: git
already keeps, on disk, a copy of every branch it has heard of. Reading those copies is a
local file read, not a network call. A second, online check runs in CI on every pull
request and names the clash minutes after the PR opens, instead of a day later at merge.

The existing duplicate-id rule in the validator (Rule 18) stays as the last backstop.

## One-Sentence Scope

Make every spec-id allocator in this repo (the extension's `nextSpecId`, and the agent
dispatch prompt that today says "the next unused number") take the highest id claimed
across the working tree, every local branch, every remote-tracking branch and every
worktree, all read offline, and add a CI gate that compares a pull request's spec ids
against `main` and every open pull request.

## Context - what the code does today (read at `origin/main` `6df91ac4`, 2026-10-19)

### Root cause

The mechanism is a lost update. `nextSpecId` (`packages/minspec/src/lib/spec-manager.ts:212-226`)
returns `max(ids in the specs directory of this working tree) + 1`. Nothing it reads can
see an id that exists only on another branch. Two branches cut from one base therefore
both compute the same id, each correctly.

The **missing gate** is at PR time. Decision-record ids have a cross-PR gate
(`.github/workflows/dr-id-collision.yml`, `scripts/check-dr-id-collision.ts`, #1226) that
compares a PR's ids against the base and every open PR and prints `Next free id`. Spec ids
have only Rule 18 (`scripts/validate-frontmatter.ts:389-430`, #1418), which reads **one
tree**. So a spec-id clash is invisible until one of the two PRs merges and the other's
merge ref suddenly contains both, which is the late, expensive red the issue describes.
`scripts/lib/spec-id-collision.ts:24-28` already records that a cross-PR check would key on
directory names and that its `mismatch` rule exists to make that sound; the cross-PR
check itself was never built.

### Who actually allocates today

- **The extension.** `createSpec` (`spec-manager.ts:356-366`) calls `nextSpecId`. No
  command calls `createSpec` (#2611), so this path has no user today, but it is the shipped
  allocator and adopters will reach it once #2611 lands.
- **The agent dispatcher.** `scripts/dispatch-issue.sh:1171-1174` tells a Specify agent to
  use "the next unused number". The agent works that out from its own worktree, which is
  the same blind read done by a model. This is the allocator that produced #1916's
  duplicate, and it runs several times a day under autonomous dispatch.
- **People and interactive sessions** pick by hand. SPEC-134, SPEC-135, SPEC-136 and
  SPEC-139 each carry an "Id note" in which the author scanned remote branches manually
  and wrote "if it collides at review time, renumber". That manual scan is the
  workaround this spec turns into code.

### Measured

Taken 2026-10-19 07:57 UTC in this worktree, with no fetch:

| Source | Highest SPEC id |
|---|---|
| `refs/remotes/origin/main` (`6df91ac4`) | SPEC-211 (next below it: SPEC-140) |
| All 487 remote-tracking refs | id 226 |
| All 487 remote-tracking + 919 local branch refs | id 226 |
| Spec directories on disk across all worktrees | id 226 |

So, right now, `nextSpecId` would hand out id 212 while ids up to 226 are already
claimed off `main`. This spec takes SPEC-227 for that reason.

Cost of the offline read, same repo, same time:

- One `git ls-tree` process per ref (1,406 refs): **6.5 s**. Not acceptable in an editor.
- One `git for-each-ref`, de-duplicated to 904 distinct tips, fed to a single
  `git cat-file --batch` reading the `specs/minspec` tree object of each: **0.056 s**.

## Functional Requirements

### The offline claimed-id reader

- **FR-1 (sources).** A reader returns the set of spec ids **claimed** in a repository,
  taken as the union of: (a) spec directories in the current working tree, including
  uncommitted ones; (b) spec directories in the tree of every ref under `refs/heads/` and
  `refs/remotes/`; (c) spec directories in the working tree of every other worktree that
  `git worktree list --porcelain` reports, when that path exists on disk. An id is
  "claimed" when a directory path segment under the configured specs directory matches
  `SPEC-<digits>`, normalised by `canonicalSpecId` (`scripts/lib/spec-id-collision.ts:54-57`)
  so `SPEC-66` and `SPEC-066` are one id.
- **FR-2 (no network).** The reader runs only local git plumbing and filesystem reads. It
  never invokes `git fetch`, `git ls-remote`, `git remote update` or any other command that
  contacts a remote, and never opens a socket (constitution invariant 1, DR-004).
- **FR-3 (directory names, not frontmatter).** The reader keys on directory names only.
  This matches what the cross-PR gate (FR-9) can read cheaply, and Rule 18's `mismatch`
  half already makes a spec's directory and its declared `id:` agree on every merged tree.
- **FR-4 (cost).** The reader reads ref trees in batch (one `for-each-ref`, one
  `cat-file --batch` or equivalent), de-duplicating identical tips, and does not spawn a
  process per ref. On the repository measured above it completes in under 1 second.
- **FR-5 (degradation is visible, never silent narrowing).** If any source in FR-1 cannot
  be read (git missing, not a git repository, a ref whose tree cannot be read, a worktree
  path that cannot be listed), the reader still returns the ids it did read **and** a list
  of what it could not read. It never presents a partial set as complete. Not a git
  repository is a normal case for an adopter and reads as "working tree only", stated.
- **FR-6 (freshness is stated).** The reader reports how fresh its remote view is: the
  modification time of `FETCH_HEAD` when present, else "never fetched". It does not
  refresh that view itself (FR-2).

### Allocators use it

- **FR-7 (extension).** `nextSpecId` returns `max(claimed ids) + 1` over the FR-1 set
  instead of over the working tree alone. Where it is shown to a person (the create-spec
  path once #2611 gives it a command), the message names the sources counted and, when
  FR-5 or FR-6 reports a gap, says so in the same message: e.g. "SPEC-227 (counted this
  folder, 1,406 branches, 6 worktrees; branch list as of last fetch 2 h ago)".
- **FR-8 (dispatch).** `scripts/dispatch-issue.sh` computes the id through the same
  reader, after the dispatcher's own fetch, and writes the concrete id into the Specify
  prompt ("use `id: SPEC-NNN`") in place of "the next unused number". It also exposes the
  computation as a headless command (expected: `npm run facts -- next-spec-id`) so a
  person or interactive session gets the same answer the dispatcher does. The dispatcher
  is dev-time machinery and already uses the network; nothing it does here ships in the
  extension.

### PR-time gate

- **FR-9 (cross-PR spec-id gate).** A CI workflow, the spec twin of
  `dr-id-collision.yml`, runs on every pull request to `main` with **no `paths:` filter**
  (an unreported required check is unsatisfiable, #560 / DR-066). It reads the spec
  directories the PR adds, the spec directories on the base, and the spec directories
  added by every other open PR, and fails when a PR adds a spec directory whose id is
  already claimed on the base or by another open PR.
- **FR-10 (which PR yields).** When two open PRs claim one id, the gate fails on the PR
  opened later (higher PR number) and passes the earlier one, so exactly one of the pair
  is told to move. A PR whose claim duplicates an id already on the base always fails.
- **FR-11 (actionable output).** The failure names the other claimant (base path, or PR
  number and path), prints `Next free id: SPEC-NNN` computed as the max across the base
  and every open PR plus one, and prints the renumber steps (rename directory, edit
  `id:`, update references). A pass prints the same `Next free id` line.
- **FR-12 (fail closed).** The gate exits non-zero on a collision **and** on any
  inability to make the comparison: `gh` missing or erroring, a payload shape it does not
  understand, or a base listing that comes back empty while the checkout holds specs
  (DR-066, constitution invariant 2). There is no path that exits 0 without a comparison.
- **FR-13 (Rule 18 stays).** The single-tree duplicate/mismatch rule in
  `validate-frontmatter.ts` is unchanged in behaviour. Its comment gains a pointer to the
  FR-9 gate as the cross-PR witness, as Rule 17's points at `dr-id-collision.yml`.

## Acceptance Criteria

- **AC-1 (FR-1, FR-7).** Fixture repo: `main` has SPEC-010; branch `a` adds SPEC-011;
  a remote-tracking ref `origin/b` adds SPEC-012; a second worktree has an uncommitted
  SPEC-013 directory. From a checkout of `main`, `nextSpecId` returns SPEC-014. With the
  three non-`main` sources removed one at a time, the answer drops accordingly (three
  red-then-green cases, one per source, so no source is untested).
- **AC-2 (FR-2).** The reader's test runs with `GIT_*` set so any remote contact fails
  (e.g. a bogus remote URL and `GIT_TERMINAL_PROMPT=0`), and a spy on the process runner
  records every git subcommand: none is `fetch`, `ls-remote`, `remote`, `pull` or `push`.
- **AC-3 (FR-4).** A fixture with 1,000 refs pointing at 500 distinct tips completes
  with a bounded number of git processes (asserted as a constant, not proportional to the
  ref count).
- **AC-4 (FR-5).** Not a git repository: returns the working-tree ids and a non-empty
  "could not read" list naming git refs. A corrupt ref: returns everything else and names
  that ref. Neither case returns an empty gap list.
- **AC-5 (FR-6).** With and without `FETCH_HEAD`, the freshness field is a timestamp and
  "never fetched" respectively.
- **AC-6 (FR-8).** The dispatch Specify prompt for a fixture issue contains a literal
  `SPEC-<digits>` equal to the `facts next-spec-id` output, and no longer contains "the
  next unused number".
- **AC-7 (FR-9, FR-10).** Gate fixtures (pure function over injected listings, as the DR
  gate's tests do): PR adds SPEC-050, base has SPEC-050 → fail. PR #20 and PR #30 both add
  SPEC-060 → #30 fails, #20 passes. PR adds no spec → pass with a `Next free id` line.
- **AC-8 (FR-12).** Injected `gh` error, unparseable payload, and empty base listing
  with a non-empty checkout each exit non-zero with a message naming which.
- **AC-9 (regression, #1916).** Replaying the #1916 shape (base with SPEC-066 at one
  path, PR adding SPEC-066 at another) fails at PR time with the base path named.

## Invariants (must not break)

- **INV-1 (offline core, constitution invariant 1).** Nothing in `packages/` contacts a
  remote. The network-aware half lives in `scripts/` and `.github/` only, as for DR ids.
- **INV-2 (no silent gate, constitution invariant 2).** The reader never narrows silently
  (FR-5); the gate never passes without a comparison (FR-12).
- **INV-3 (blast radius, constitution invariant 3).** The reader reads only the
  repository it is invoked in. The CI workflow lives in this repo's `.github/` and is not
  scaffolded into adopters by this spec.
- **INV-4 (existing ids never move).** Nothing here renumbers an existing spec. An
  approved spec's sidecar is path-keyed; renaming it strands the signature
  (`spec-id-collision.ts:117`). Allocation only affects ids not yet handed out.
- **INV-5 (Rule 18 keeps its behaviour).** Same input, same verdict.
- **INV-6 (ids only grow).** The allocator returns a number strictly above every id it
  read. It never reuses a gap, even a gap left by an abandoned branch.

## Limitations, stated plainly

- **The offline view is as fresh as the last fetch.** A branch pushed by another machine
  after this clone's last fetch is invisible to the extension. FR-6 says so; FR-9 is the
  witness that catches it, online, in CI. Two witnesses, neither sufficient alone.
- **Abandoned branches leave gaps.** A remote-tracking ref for a deleted remote branch
  survives until `git fetch --prune`, and its id stays "claimed". Gaps are harmless
  (INV-6); an id above the highest on `main` is expected, as CLAUDE.md already says for
  DR ids.
- **Two sessions allocating within the same second on one machine** before either has
  created its directory can still collide. FR-9 catches it at PR time.

## Decisions needed (Clarify)

Selections below are recorded on the option this document already marks recommended. An
agent session recorded them on 2026-10-27, acting on a standing instruction the founder gave
on 2026-10-26 to settle Clarify on recommended options (inbox item in66, relayed by the
chief-of-staff proxy). That instruction lives outside this repo and is not a consent record
(DR-108 delegated approval: a queue item cannot carry consent), so it is cited here as
context, not verified. No human chose any single item. DQ-1 and DQ-3 are left open (a
re-approval of an approved spec, and a required-check change); this section stays open, and
the spec is not ready to approve, until the founder answers.

### DQ-1 - Per-product id ranges contradict the global uniqueness gate

**Not recorded:** option (a) needs SPEC-053's text updated, and SPEC-053 is already approved
(`status: planning`, approval record committed), so it forces a re-approval; it also ends
the per-product id ranges adopters may rely on. Needs the founder's answer.

`nextSpecId(specsDir, product)` scopes the max to one product (#57, SPEC-053), so a new
product starts at SPEC-001. Rule 18 checks uniqueness **across all products**
(`validate-frontmatter.ts:406-414` reads every `requirements.md` under `specs/`). In a
two-product repo the scoped allocator therefore hands out ids the gate rejects. In this
repo the corpus is global in practice (`specs/agent-execute` holds SPEC-016 and SPEC-019,
interleaved with minspec's).

- **(a) (rec) Allocate globally; keep the `product` parameter only for attribution.**
  Matches the gate and this repo's practice. Cost: the #57 per-product ranges stop
  existing for any adopter who relied on them, and SPEC-053's text describing them needs
  an update.
- **(b) Keep per-product ranges, make Rule 18 and FR-9 per-product.** Cost: an id no
  longer identifies a spec without its product, and every id-keyed lookup (`facts
  approval`, the next-task resolver, the tree) would need the product too.

### DQ-2 - Should the editor ever refresh the remote view?

**Recorded selection: (a),** never; local refs only, with freshness stated (FR-6). An agent
session copied this document's (rec) option; no human chose this item.

- **(a) (rec) Never.** Local refs only, freshness stated (FR-6); CI is the online
  witness. Cost: an adopter who rarely fetches gets a stale view, and learns of a clash
  at PR time rather than at creation.
- **(b) Offer a consent-gated fetch at spec creation.** Cost: the first network call the
  core extension would make, needing a consent surface, a setting and an offline
  fallback; disproportionate to a clash the CI gate already catches.

### DQ-3 - Make `spec-id-collision` a required check?

**Not recorded:** option (a) makes `spec-id-collision` a required check, which is a ruleset
change. Needs the founder's answer.

The DR twin is still advisory: a workflow cannot make itself required.

- **(a) (rec) Yes, once it has run green on open PRs for a week.** Cost: one ruleset
  edit by the founder, and any outage of the check's `gh` access then blocks every merge
  until it is fixed or bypassed with `--admin`.
- **(b) Leave advisory.** Cost: it reports a clash and nothing stops the merge, which is
  how #1916's clash went unflagged until its required checks turned red.

### DQ-4 - Extend the reader to decision-record ids?

**Recorded selection: (a),** not in this spec; the reader takes a pattern parameter so a
follow-up can reuse it. An agent session copied this document's (rec) option; no human chose
this item.

`nextAdrNumber` (`packages/minspec/src/lib/adr-manager.ts:106-121`) has the identical
blindness. Its CI gate exists; its offline allocator does not see branches either.

- **(a) (rec) Not in this spec; the reader takes a pattern parameter so a follow-up can
  reuse it.** Cost: DR-id collisions keep surfacing at PR time until that follow-up.
- **(b) Do both here.** Cost: widens a T3 spec into a second allocator and a second
  command's messaging; the scope-expansion rule in CLAUDE.md applies.

## Why no new DR

Every choice here can be undone in under a day: the reader is additive, the allocator
change is one call, and the workflow is a file. The architectural constraint the design
rests on (no network from the extension) is already recorded in DR-004, and the
fail-closed rule in DR-066. DQ-3 (required check) is a ruleset setting, also reversible.

## Out of Scope

- Renumbering any existing spec, including #1916's (in flight separately, per the
  issue) and `main`'s SPEC-066 (INV-4). The issue names SPEC-073 as #1916's new id;
  `main` already holds a different SPEC-073 (dispatch-completion-requires-commit), so
  that renumber needs re-checking with the FR-8 command once it exists.
- A command that creates a spec (#2611).
- A committed id ledger (see Alternatives).
- Scaffolding the FR-9 workflow into adopter repos.

## Alternatives considered and rejected

Recorded because this spec was written under the `act` autonomy mode (DR-086 §4).

- **Scan remote heads over the network at allocation** (the issue's option 1). Rejected
  for the extension: the same remote heads are already on disk as remote-tracking refs,
  so the network call buys only the delta since the last fetch, and costs invariant 1.
  Kept for the dispatcher (FR-8), which already fetches.
- **Committed ledger of issued ids** (option 2). Rejected: every concurrent spec
  creation edits the same file, trading a rare hard clash for a frequent merge conflict,
  and the ledger can itself diverge across branches, reproducing the problem one level up.
- **Refuse creation when the id cannot be proven free** (option 3). Rejected as the
  primary fix: offline, freedom can never be proven, so it would refuse always or never.
  FR-5's stated gaps are the honest form of it.
- **Random or timestamped ids.** Rejected: breaks the sequential `SPEC-NNN` convention
  every reader, the DR-053 reference grammar and the corpus rely on.

## Test plan (for the Plan phase to place)

- Reader: real-git fixtures (temporary repos with branches, a fake remote-tracking ref
  written by `update-ref`, and a second worktree), not mocked trees, so the plumbing is
  what is tested. One red-then-green case per source (AC-1).
- Gate: pure verdict function over injected listings, plus the `gh`-failure cases, in
  the same shape as `dr-id-collision`'s tests.
- Typecheck the new test files (`tests/` sits outside the tsconfig includes).

## Traceability

- Issue: #2055. Incident: #1916 (duplicate SPEC-066).
- Gate this completes: #1418 (Rule 18, spec ids, one tree). Pattern it copies: #1226
  (`dr-id-collision`, DR ids, cross-PR).
- Rests on: DR-004 (Tier-0, offline core), DR-066 (fail-closed gates).
- Supersedes the manual "Id note" scans in SPEC-134, SPEC-135, SPEC-136, SPEC-139.
