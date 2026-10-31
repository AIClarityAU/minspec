---
id: SPEC-214
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-214 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-066, DR-079, SPEC-211, "#1932", "#1688", "#1925", "#3077", "#3483"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-214 - Design: voters get the id gate's facts as numbers

Plan for [requirements.md](requirements.md). The contract is that file; this one says how to
build it, under its three recorded Clarify selections: DQ-1 option a (one shared prompt
paragraph, no role-file edits), DQ-2 option a (the facts sit outside `REVIEW_INPUT`) and
DQ-3 option a (a new step in the ai-review workflow, using the App token). This plan reopens
none of them. Citations of "today" are against `origin/main` at `e116efe1`. New code is named
by symbol, because its line numbers will move.

Nothing is built yet: on `e116efe1` no file under `scripts/` or `.github/` contains
`dr_id_facts` or `--dr-id-facts`. #1932 (the false block) is closed, but the only merged pull
request found for it is #2916, which added this spec, so the closed state is not evidence of a
fix.

## Approach in one paragraph

A pure `renderDrIdFacts` joins `decideDrIdCollision` in `scripts/lib/dr-id-collision.ts`. The
gate's `gh` reads move, unchanged, into a new `scripts/lib/dr-id-collision-io.ts` so that
`check-dr-id-collision.ts` and a new entry point, `scripts/dr-id-facts.mjs`, both use them. A
new ai-review step runs that entry point from the base checkout with Node's own type
stripping and writes a facts file. `review-branch.sh` gains `--dr-id-facts <path>`, checks
every line against the closed grammar, and places the block in the prompt after
`${REVIEW_INPUT}`. The prompt also gains the FR-4 paragraph and, when there are no valid
facts, the FR-5 sentence. The gate's workflow and verdict do not change.

## Re-measurement at e116efe1 (what changed since the spec was written)

| Spec says | Today | Effect |
|---|---|---|
| Plan note: open-PR listing is `--limit 500`, `check-dr-id-collision.ts:324` | Gone. `otherPrClaims` (lines 287-338) pages GraphQL to the end, throws after 200 pages, and falls back to REST for a pull request with over 100 files (#3077) | P-5: reuse it, no limit to copy |
| `decideDrIdCollision` around lines 340-395 | Lines 324-393 | None |
| `ai-review.yml` base checkout at line 287, carry at 336-391 | Base checkout `ref:` at line 287; carry step starts at line 332 | None |
| ai-review job has no `npm ci` | Still true | P-2 |

Also read, and not stated in the spec:

- `.github/workflows/ai-review.yml` and `scripts/review-branch.sh` are in `SOURCES` in
  `scripts/gen-ci-templates.mjs`, so they do ship to adopters and INV-5's condition is met.
  `dr-id-collision.yml`, `check-dr-id-collision.ts` and `scripts/lib/dr-id-collision.ts` are
  not in that list.
- `MACHINERY_PATH_RE` (`.github/scripts/ai-review-guard.js:1162`) matches all of `^scripts/`
  and `^\.github/`, so every build task below is review machinery.
- The workflow file runs from the pull request's merge ref while the scripts run from the
  base, so a workflow that passes a new flag to an older base script crashes every voter on
  that pull request (`unknown arg`, `review-branch.sh:69`). This is the #1925 skew the carry
  step already feature-detects for. P-10 handles it.

## Decisions

Every entry below was chosen by the planning agent on its recommendation; none is a founder
decision. Each one can be undone in under a day, and none changes an approved sentence in
requirements.md. The three DQ selections above are not in this list because the spec records
them.

- **P-1 - The renderer lives beside the decision.** `renderDrIdFacts` goes in
  `scripts/lib/dr-id-collision.ts`, as FR-2 says, and calls nothing with IO. *Rejected:* a
  plain-JS copy of the decision (a second definition, which FR-1 forbids), and converting the
  module to JS (churn in every importer for no gain once P-2 holds).
- **P-2 - The base code runs under Node's own type stripping.**
  `node --experimental-strip-types scripts/dr-id-facts.mjs`. The pure module has only erasable
  syntax; a probe importing it this way returned `[ 'DR-092' ] DR-093` on Node 22.23.3, and
  the workflow's `node-version: '22'` resolves to a release that accepts the flag (I believe,
  unverified in CI; task 8 checks it on the first real run). This avoids the install cost
  DQ-3's selection names. *Rejected:* `npm ci` (a minute on every review, for one file);
  pinned `npx tsx` (a package download with a native binary in a step holding the App token).
  If Node ever drops the flag, the step fails and the prompt says "unavailable" (FR-5): the
  failure is visible and costs no verdict.
- **P-3 - One IO module, two callers.** `prFileEntries`, `otherPrClaims`, `basePaths`,
  `assertBaseListingPlausible`, `resolveDecisionsDirRel`, `gh` and the error classes move to
  `scripts/lib/dr-id-collision-io.ts`, bodies unchanged. It imports the pure module as
  `./dr-id-collision.ts`, an explicit extension that both `tsx` and type stripping accept.
  *Rejected:* a `--facts` mode on `check-dr-id-collision.ts` (one script serving a gate and a
  reviewer input invites an FR-6 regression); parsing the gate's printed message (it carries
  filenames, which INV-3 forbids).
- **P-4 - The entry point is `.mjs`.** Same form as `scripts/gen-ci-templates.mjs`. Node runs
  it directly. *Rejected:* a `.ts` entry, which gains nothing, since it holds only argument
  reads and one file write. Residual: an adopter whose `tsc` includes `scripts/` may report on
  the shipped `.ts` modules. Task 7 records this in the template's doc line; the workflow does
  not run `tsc`, so review is unaffected.
- **P-5 - Reuse the gate's listing, and failure means no file.** The spec's "same limit" note
  is stale (see above). `otherPrClaims` already reads every page or throws. The entry point
  writes to a temp name and renames only after `decideDrIdCollision` and `renderDrIdFacts`
  return, and exits non-zero otherwise, so a partial listing can never read as "no other pull
  requests". *Rejected:* a best-effort partial list, which is the failure the plan note warns
  about.
- **P-6 - What `open pull requests read: N` counts.** Other pull requests, after
  `decideDrIdCollision`'s own filter drops the subject, including those that add no decision.
  The #1835 fixture requires 2. *Rejected:* counting only holders, which would make the line
  useless as evidence that the read happened.
- **P-7 - No-DR output is exactly two lines.** `this pull request adds no DR id`, then
  `next free id: DR-NNN`, as FR-2's last sentence states; the `open pull requests read` line
  is not added. *Rejected:* adding it, which is one more line than that sentence names.
- **P-8 - The grammar check is bash, and the block is rebuilt from the lines that passed.**
  A `while read` loop with `[[ =~ ]]` in `review-branch.sh`, accepting exactly these four
  shapes:
  `^DR-[0-9]{3,}: (free|held by base|held by PR #[0-9]+|duplicated within this PR)$`,
  `^next free id: DR-[0-9]{3,}$`, `^open pull requests read: [0-9]+$`,
  `^this pull request adds no DR id$`. The first failure drops the whole file. An empty,
  missing or unreadable file takes the same path. Because the block is rebuilt from the
  values `read` returned, no raw byte of the file reaches the prompt. *Rejected:* `grep`
  (binary-file handling differs, and a local ugrep has differed from CI's GNU grep before); a
  function in `ai-review-guard.js` (a node start in every voter, and a new export for the
  SPEC-211 export gate). This leaves two statements of the grammar, so task 4 has a parity
  test feeding every renderer shape through the real script. `ai-review-guard.js`, listed
  under `affects:`, needs no edit under this plan.
- **P-9 - The producer files stay out of `PANEL_KEY_PATHS`.** A carried pass is not voided by
  an edit to them. This follows DQ-2's selection: id allocation is not what the voter decides,
  and the id gate re-runs on every push. *Rejected:* adding them, which would void every carry
  on any edit to the gate's own library. `review-branch.sh` is already keyed, so the grammar
  and the paragraph are covered.
- **P-10 - The workflow guards against base skew and never costs a review.** The new step
  sits after the carry step, runs only when `steps.carry.outputs.carry != 'yes'` (a carried
  verdict starts no voter, so the API reads would be wasted), has `continue-on-error: true`
  and `timeout-minutes: 3` (the IO's rate-limit wait is up to 5 minutes per call and should
  not hold a review), and sets output `path` only when the entry point exited 0. `run_voter`
  adds `--dr-id-facts "$DR_ID_FACTS_FILE"` only when that path is set and the base's
  `scripts/review-branch.sh` contains the flag. The token follows the carry step's pattern:
  moved to a local, unset from the environment, handed to one process. *Rejected:* failing
  the job, which FR-5 forbids; running before the carry step, which spends the API calls
  every time.
- **P-11 - The producer ships in the managed stack.** The two `scripts/lib/` modules and the
  entry point join `SOURCES`, because INV-5 says a repo with no `docs/decisions/` renders
  "adds no DR id", and only a shipped producer can render anything. In that repo
  `basePaths` returns an empty list on a 404, which gives the two-line output. *Rejected:*
  shipping nothing and letting adopters fall through to "unavailable", which contradicts
  INV-5's sentence. The file test in P-10 still stands for an adopter on an older scaffold.
- **P-12 - The FR-4 paragraph is one fixed text in every repo.** It names `dr-id-collision`
  even in an adopter repo that does not have that check, because FR-4 says one paragraph,
  written once. *Rejected:* making the paragraph conditional on the workflow file's presence,
  which departs from that sentence. The residual, that adopters have no cross-PR id gate, is
  tracked in #3483 (adopters lack the id gate).
- **P-13 - One acceptance line is read through the prompt, not `--print-input`.** The
  malformed-file criterion says a control run with `--print-input` includes the valid lines.
  Under DQ-2's selection and FR-7, `--print-input` excludes the block in every case, and the
  criterion's own parenthesis anticipates that for the sentence. So: `--print-input` is
  asserted to hold no line from the file on both runs, the stderr rejection line is asserted
  on the malformed run, and "includes them" and the unavailable sentence are asserted on the
  prompt captured by a stub `claude` on `PATH`, the method
  `review-branch-verdict-beats-quota.test.ts` already uses. *Rejected:* a new `--print-prompt`
  flag (a second output path to keep honest, for a test only) and putting the block in the
  hashed input (reverses DQ-2's selection).

## The contract pieces

**`renderDrIdFacts(input: DrIdCollisionInput, verdict: DrIdCollisionVerdict): string`**
returns newline-terminated text. For each id in `verdict.claimed`, the first finding for that
id decides the line: no finding gives `free`; `heldBy === input.baseRef` gives `held by base`;
`heldBy === 'this PR'` gives `duplicated within this PR`; `heldBy` of the form `PR #N` gives
`held by PR #N`. It throws on any other `heldBy`, so the closed grammar cannot be widened by
accident. It never reads `finding.file`. Git refnames cannot contain a space, so a base ref
cannot spell `PR #N`.

**`review-branch.sh`.** Header usage lines gain the flag. `--dr-id-facts` without a value exits
1, as `--role` does (a caller bug); a value naming an absent or bad file never stops the
review (FR-5). The defang `sed` gains a third expression for `dr_id_facts`. Validation runs
after the empty-diff exit and before `--print-input`, so the stderr line appears in both modes.
The prompt order is `${REVIEW_INPUT}`, then the block or the sentence, then `Base:` / `Head:`.
The comment above `REVIEW_INPUT` gains FR-7's statement.

The block tag is FR-3's text exactly. The FR-5 sentence is exactly:

> DR id reservation data is unavailable for this review.

The FR-4 paragraph, placed after the `<approval_provenance>` paragraph, is exactly:

> DR id allocation (which number a new decision record takes) is decided by the
> `dr-id-collision` check, which can see open pull requests that you cannot. An id higher than
> the highest `DR-NNN` in this checkout is not a finding. Do not ask for a renumber. Where the
> `<dr_id_facts>` block says an id is held, you may cite that line as information, but blocking
> on it is that check's job. A duplicate you can see within this checkout plus the diff, meaning
> two files that declare one id, is still a legitimate finding.

**`scripts/dr-id-facts.mjs`** takes `--repo`, `--pr`, `--base`, `--out`, as the gate does plus
the output path. It reads the same inputs in the same order as the gate's `main()`, and prints
nothing from any pull request to stdout or stderr beyond the error text the IO module already
produces for the Actions log.

## Files

Paths outside requirements.md's `affects:`, and why:

| Path | Why |
|---|---|
| `scripts/lib/dr-id-collision-io.ts` (new) | P-3, the shared reads |
| `scripts/dr-id-facts.mjs` (new) | P-4, the entry point |
| `scripts/gen-ci-templates.mjs`, `packages/minspec/src/lib/template-registry.ts`, `packages/minspec/src/lib/ci-review-templates.ts`, `packages/minspec/tests/managed-region-templates.test.ts` | P-11; the embedded copy must track `review-branch.sh` and the workflow, or `npm run validate` fails |
| New tests under `packages/minspec/tests/` | See tasks.md |

## Landing order and who pushes

Tasks 1 to 7 land before task 8. Task 8 edits `.github/workflows/ai-review.yml`, and the App
cannot push workflow content to this repo; the agent writes, tests and commits it, then hands
the founder the patch to push. That is the standing rule for the review stack, not a new human
gate from this spec, and it asks him for no decision. Between tasks 5 and 8, every review prints
the FR-5 sentence and the FR-4 paragraph, which FR-5 allows: the prose half works without the
facts.

## Dependency budget

Zero new dependencies.

## Out of scope

As requirements.md lists. Also: whether adopters should receive the id gate itself (#3483).
