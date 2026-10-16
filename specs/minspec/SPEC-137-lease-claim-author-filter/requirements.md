---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness: concurrent multi-session coordination. The work-item claim lease is SPEC-044's, under this epic
aspects: [security, lease, claim, author-filter, denial-of-service, public-repo, no-silent-gate, fail-closed]
depends_on: [SPEC-044]  # SPEC-044 owns scripts/lib/issue-lease.sh and the claim lease this hardens
relates_to: [DR-067, DR-003, "#1275", "#1113", "#1127", "#1243", "#1260", "#1105", "#1222", "#1355", "#2298"]
# Ownership (SPEC-038). SPEC-044 declares issue-lease.sh in its implements:, so this spec
# MODIFIES it and does not take ownership. The trust list and its jq predicate live in
# dispatch-author-gate.sh, which this spec reuses and does not change (FR-2).
affects: [scripts/lib/issue-lease.sh, packages/minspec/tests/issue-lease-renew-release.test.ts, packages/minspec/tests/issue-lease-renew-report.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# Lease claims: read only claims written by a trusted account (Requirements)

> Triggered by **[#1275](https://github.com/AIClarityAU/minspec/issues/1275)** (bug: `lease_read_claims`
> counts claim markers from every comment, whoever wrote it). Hardens the claim lease of
> **[SPEC-044](../SPEC-044-coordinated-self-completing-sessions/requirements.md)** (coordinated
> self-completing sessions) / **[DR-067](../../../docs/decisions/DR-067.md)** (work-item claim
> lease). The same class of bug as the `minspec-shipped` marker reader, fixed in #1113 / PR #1127.
> No new decision record: every option below can be reverted in under a day (the ADR filter
> the dispatcher applies: record only choices that cannot be undone within a day).

## In plain terms

Sessions decide who is working an issue by reading "claim" comments on it. Each claim is an
HTML comment (`<!-- minspec-claim:{json} -->`) that GitHub shows as nothing. The reader
counts a claim from **anyone**. This repository is public, so any GitHub user can post a
fake claim and make every session believe the issue is taken. A person reading the thread
sees an empty comment and no reason why the issue never gets worked.

The fix: count a claim only when the comment was written by an account on the trusted list.
That list already exists, and other readers in the same file already use it.

## One-Sentence Scope

Make `lease_read_claims` (`scripts/lib/issue-lease.sh:238`) return only claims from comments
whose **author account** is on the dispatch trust list, keeping each comment's numeric `id`
as `serverOrder`, and fail closed and visibly when trust cannot be established.

## Context (measured on this branch, base `origin/main`)

- **The reader.** `lease_read_claims` (`scripts/lib/issue-lease.sh:238-247`) reads
  `gh api --paginate repos/<repo>/issues/<N>/comments` (REST), selects every comment whose
  `.body` contains `<!-- minspec-claim:`, parses the JSON, and returns
  `payload + {serverOrder: .id}`. Nothing checks who wrote the comment.
- **Every lease decision goes through it.** `lease_acquire` (:260), `lease_renew` (:304),
  `lease_verify_holds` (:342), `lease_release` (:353) and `lease_reclaim_q` (:487). A
  planted claim therefore reaches all five.
- **Three ways a planted claim causes harm.** All three come from reading the code cited
  below. None has been tried against GitHub.
  1. *Permanent stand-down.* `classify_claim` (:141-185) picks the live claim with the
     lowest `serverOrder`. A planted claim with a far-future `lastRenewed`, posted before a
     real session claims, wins against every later claim. `lease_acquire` then retracts its
     own claim and returns 1. The claim never expires. In `is_claim_live` (:111-129), a
     future `lastRenewed` gives a negative age, which is always under the TTL (:116-117). A
     `host` other than the reader's skips the pid check (:119-121). An unparseable
     `claimedAt` skips the two-hour `LEASE_ABS_MAX_SECS` ceiling, which the code says is
     deliberate (:122-127). So a single comment such as
     `{"lastRenewed":"2099-01-01T00:00:00Z","claimedAt":"x","host":"elsewhere",...}` is live
     for good.
  2. *Hijacked renewal.* `lease_renew` (:315-317) takes the **last** claim whose
     `sessionId` equals its own and PATCHes that comment. Every real claim prints its
     `sessionId` in clear text (`lease_claim_body`, :225-233), so a stranger can copy it into
     a newer comment. Renewal then PATCHes the stranger's comment, GitHub refuses the
     PATCH, the real claim stops being renewed, and it expires.
  3. *`lease_verify_holds` turns false.* The same planted claim makes the D3 re-verify
     (the check before every credentialed operation, SPEC-044) report "not held", which
     stops a shepherd while it is running.
- **Who writes real claims.** Only `lease_acquire` and `lease_renew`, through
  `lease_claim_body`. Both call `gh_bot_init` (:252, :297), and so does `lease_release`
  (:350). After that, every write goes
  through `_gh_bot_ensure`, which exits through `gh_bot_die` when no bot token can be made
  (`scripts/lib/gh-bot.sh:83-86, 514-526`). So since #1355, every real claim is written by
  the pipeline's App. The claim marker is always the **first line** of the body
  (`lease_claim_body`, :231).
- **The trust list and its predicate already exist.** `_dispatch_trusted_identities`
  (`scripts/lib/dispatch-author-gate.sh:166-171`) lists `Bot:299695933` (the App) and
  `User:4125483` (the founder). `_dispatch_gate_jq_defs` (:187) defines `listed`, which
  compares `"<__typename>:<databaseId>"` exactly against that list. The file says REST shows
  the App as `minspec-sdd[bot]` with this id (`dispatch-author-gate.sh:57-58`).
- **The shape mismatch named in the issue is real.** `--trusted-comment-bodies`
  (`scripts/dispatch-ready-check.sh:457-506`) reads the GraphQL / `gh issue view` shape
  (`.author`, `.authorAssociation`), outputs **joined bodies**, and so loses the comment
  `id`. REST gives `.user.login`, `.user.id`, `.user.type` and `.author_association`.
  It also gives the account's **kind and number** directly (`.user.type`, `.user.id`). So
  the lookup `--trusted-comment-bodies` needs for comments that arrive with only a login
  (`dispatch_identify_comments`) is not needed here. *I believe REST `user.type` uses the
  same spellings as GraphQL `__typename` (`Bot`, `User`) for these two accounts. The file
  comment cited above supports this for the App; I have not checked it for the founder
  account. The Plan phase must check it with one recorded REST response.*
- **The agent path is already closed.** PR #1260 (#1243) fences payload-bearing markers,
  including `minspec-claim`, before agent text is republished (`dispatch-ready-check.sh:362`;
  test `dispatch-ready-check.test.ts:1215-1246`). This spec covers what that leaves open: a
  stranger commenting directly.
- **Test fixtures carry the wrong App id.** `issue-lease-renew-release.test.ts:157-165`
  builds REST comments with `id: 263718419` for a `[bot]` login, not `299695933`. Under this
  fix, those fixtures' claims would be dropped as untrusted. The fixtures must change with
  the fix (AC-6), and must not loosen the filter to fit them.

## Functional Requirements

**FR-1 - Filter on the author account before parsing.** `lease_read_claims` keeps a comment
only if its author account is on the dispatch trust list. Malformed claim JSON is then
parsed only from trusted comments. A stranger's comment can therefore no longer make the
whole read fail through `fromjson`, which today is a second denial path: the read returns 1,
`enum_complete=0`, and the caller stands down.

**FR-2 - One predicate, no second copy.** The decision is made by the existing `listed`
definition, run against the existing `_dispatch_trusted_identities_json`, both sourced from
`scripts/lib/dispatch-author-gate.sh`. The REST author is mapped
`{__typename: .user.type, databaseId: .user.id, login: .user.login}` before `listed` is
applied. Do not add a new login comparison or a second list. A login is a spelling, not an
account (`dispatch-author-gate.sh:52-66`, #1222).

**FR-3 - Keep the comment id.** Each claim the reader returns still carries
`serverOrder` = the comment's REST numeric `.id`. That id is the winner key in
`classify_claim` and the PATCH/DELETE target in `lease_renew` / `lease_release`. The output
shape (a JSON array of `payload + {serverOrder}`) does not change, so no caller changes.

**FR-4 - The marker must start the body.** A trusted comment counts as a claim only if its
body **begins** with `<!-- minspec-claim:{...} -->` (leading whitespace allowed), as
`lease_claim_body` writes it. A trusted account that quotes or republishes someone else's
text (review verdicts, summaries) therefore cannot carry a claim in the middle of a body.
This adds to #1260's fence; it does not replace it. One claim per comment.

**FR-5 - Fail closed when trust cannot be established.** If the trust list cannot be built,
or the filter cannot run, `lease_read_claims` returns **non-zero** and prints nothing on
stdout. It must never return `[]`. Callers already treat non-zero as "enumeration
incomplete" (`enum_complete=0`, so `classify_claim` stands down, INV-6). An empty array
would mean "no claims", which lets a session claim an item it cannot prove is free
(constitution invariant 2: no silent gate).

**FR-6 - Say what was dropped.** When one or more comments that contain a claim marker are
dropped as untrusted, the reader prints **one line on stderr**: the count, the item number,
and the dropped authors' logins (passed through the existing `printable` jq definition,
capped as `dispatch_trusted_comments` caps them). It never prints the payload. Stdout stays
the claims array. A planted claim then leaves a visible trace in the drain log instead of an
unexplained stand-down. The line must not contain the word `FAILED`
(`issue-lease.sh:288-292`: the renew ticker counts that word).

**FR-7 - Pagination and errors are unchanged.** The read still pages to the end
(`--paginate`, slurped with `jq -s`, which fixed #2298). It is still the **only** read of the
comments endpoint in the file (the existing test at `issue-lease-renew-release.test.ts:326`
must stay green). Any `gh` or `jq` error still returns non-zero.

**FR-8 - Renew and release act only on trusted comments.** Because they read through
`lease_read_claims`, `lease_renew` and `lease_release` select by `sessionId` only among
trusted claims. A copied `sessionId` in a stranger's comment can no longer redirect a PATCH
or DELETE. No code change is needed in those two functions for this. The requirement is
that a test pins it (AC-3).

## Acceptance Criteria

- **AC-1 (stranger cannot deny).** Fixture: a `NONE`-association `User` comment with a
  live, lowest-id claim, and a later App claim by self. `classify_claim` over
  `lease_read_claims` returns `own`. Control: the same fixture with the stranger's author
  replaced by the App returns `stand-down`. This shows the filter is what changes the
  result.
- **AC-2 (malformed stranger JSON).** A stranger comment containing
  `<!-- minspec-claim:{not json} -->` does not make `lease_read_claims` fail. The same body
  from the App still makes it fail (non-zero), as today.
- **AC-3 (copied sessionId).** A stranger comment, newer than self's App claim and carrying
  self's `sessionId`: `lease_renew` PATCHes self's comment id, and `lease_release` DELETEs
  only self's id. The fake `gh` records the writes.
- **AC-4 (fail closed).** With `_dispatch_trusted_identities_json` made to print nothing,
  `lease_read_claims` exits non-zero with empty stdout, and `lease_acquire` stands down.
- **AC-5 (marker position).** An App comment whose body has the claim marker after other
  text is not counted. An App comment that begins with the marker is counted.
- **AC-6 (fixtures use the real account).** The lease test fixtures build App comments
  with `type: 'Bot', id: 299695933`. A test asserts that a `[bot]` login with any other id is
  dropped. This pins the rule that trust follows the account number, not the `[bot]` suffix.
- **AC-7 (drop line).** AC-1's fixture prints exactly one stderr line naming one dropped
  comment and the stranger's login, with no claim payload and no `FAILED`.
- **AC-8 (single read).** The existing "pages the comments endpoint exactly once" test
  stays green, unchanged.
- **AC-9 (tests that can fail).** Each of AC-1 to AC-5 is shown failing against today's
  `lease_read_claims` before the fix, or killed by a mutant that removes the author
  predicate (memory: tests can pass vacuously). Record the red run in the PR.

## Invariants (must not break)

- **Constitution 1 (offline core).** No network in Tier-0. All changes stay in the Tier-1
  `scripts/lib/issue-lease.sh`. The filter adds **no** GitHub call, because REST already
  gives the account kind and number.
- **Constitution 2 (no silent gate).** An unbuildable trust list or a filter error means
  "incomplete", never "no claims" (FR-5). Dropped claims are reported (FR-6).
- **Constitution 3 (blast radius).** Only this repo's dev-time scripts change. Nothing
  shipped to adopters changes.
- **SPEC-044 INV-6.** An incomplete or ambiguous read can never prove `own`.
- **SPEC-044 winner key.** `serverOrder` stays the REST comment id. `claimedAt` stays
  metadata only.
- **One parse.** `lease_read_claims` stays the single parse of the comments endpoint
  (#2298).
- **One trust predicate.** "Is on the list" stays defined once, in
  `dispatch-author-gate.sh`.

## Decisions needed (Clarify)

### OQ-1 - Which authors count as trusted for claims?

- **(a) The listed accounts only: the App plus the founder (rec).** The same `listed`
  predicate the agent-text gate uses. Cost: a claim written under any other collaborator
  account is ignored. Today no code path writes one (every write is the App, after #1355),
  but a future second listed operator must be added to the list before their manual claims
  count.
- (b) Listed accounts **or** association OWNER / MEMBER / COLLABORATOR, as the
  `minspec-shipped` reader does (`--trusted-comment-bodies`). Cost: anyone later given
  write access for an unrelated reason can stop sessions without anyone seeing why, which
  is exactly the risk #1105 leaves open.
- (c) The App only (`Bot:299695933`). The narrowest option. Cost: the founder cannot post
  a manual claim to hold an issue, and this needs a second, claim-specific list next to the
  dispatch list.

### OQ-2 - Where does the filter code live?

- **(a) Inline in `lease_read_claims`, sourcing `dispatch-author-gate.sh` for `listed` and
  the list (rec).** One jq program, the id kept, no new entry point. Cost: issue-lease.sh
  gains a source dependency on the author-gate library, which then loads in every process
  that sources the lease library.
- (b) A new id-preserving mode in `dispatch-ready-check.sh` (for example
  `--trusted-comments-json`), with REST mapped into it. Cost: a second public entry point to
  the trust filter, with its own exit-code contract, which every later reader must keep in
  step.
- (c) Switch `lease_read_claims` to GraphQL and reuse `dispatch_trusted_comments`, which
  also checks who edited each comment. Cost: that function reads only the newest 100
  comments (`comments(last: 100)`). That breaks FR-7's read-to-the-end rule, and so INV-6.
  Rejected unless paginated.

### OQ-3 - Should a claim whose comment was edited by someone else be dropped?

REST does not say who edited a comment. Today, only an account with write access can edit
the App's comment, and under OQ-1 (a) that account is already trusted. **Recommendation: do
not check editors here (rec).** Cost: if write access is later given to someone not on the
list, they could edit a real claim to extend it. That is the same open risk #1105 records
for the other readers. Checking editors would need option OQ-2 (c) and its GraphQL read.

## Out of Scope

- Changing `is_claim_live` / `LEASE_ABS_MAX_SECS`, or checking that a trusted claim's
  `host` and `pid` are sensible.
- The best-effort `|| return 0` in `lease_release` on a failed read (existing, deliberate).
- Other readers of comment markers outside `issue-lease.sh`. If the Plan phase finds an
  unfiltered one, it files a separate issue.
- Founder-account compromise. A listed account can still deny, as it can in every gate.

## Alternatives considered and rejected

- **Pipe through `--trusted-comment-bodies` as it is.** That outputs joined bodies and
  drops the comment id, which is the winner key and the PATCH target (FR-3).
- **Match on the login `minspec-sdd[bot]`.** A login is a spelling. The REST and GraphQL
  spellings differ, and three reviewers got this wrong in #1222.
- **Match on any `*[bot]` login (`is_bot_identity`).** That would trust
  `github-actions[bot]`, `dependabot[bot]`, and any App installed later
  (`dispatch-ready-check.sh:204-206`).
- **Sign claims with an HMAC.** The key would have to sit with every session, and the
  account filter already answers "who wrote this" without one.

## Traceability

- Issue: #1275. Same class as #1113 / PR #1127 (`minspec-shipped`). Agent path closed by
  #1243 / PR #1260. Remaining association-arm risk: #1105. Shape lesson: #1222. Bot-authored
  writes: #1355. Single-parse rule: #2298.
- Spec: SPEC-044 (owner of `issue-lease.sh`). Decision: DR-067.
