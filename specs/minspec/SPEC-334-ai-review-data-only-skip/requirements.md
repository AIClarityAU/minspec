---
id: SPEC-334
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-010  # Reviewer Across All Approvables - cost of the ai-review panel on pushes that change no code
aspects: [ci, ai-review, cost, fail-closed, adopter-config]
depends_on: []
relates_to: ["#3568", "#1688", "#359", "#480", "#2982", "DR-104", "DR-097"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: one pure seam in .github/scripts/ai-review-guard.js, a step in
  .github/workflows/ai-review.yml, and the matching scaffolded templates (ci-review-templates.ts). None is built.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-334: Skip the paid ai-review panel when only declared data paths changed since the last reviewed head

Issue: #3568 (from an adopter repo). Design rests on DR-104 (an ai-review pass is carried across a push
that changes nothing the voters are given) and the 3-way check-run conclusion from #480.

## Problem

An adopter runs an unattended job that commits generated data every day (`news/items.json`,
`news/public-vendor-data.json`) to a long-lived branch behind an open promotion pull request. Each commit is
a `synchronize`, so `ai-review.yml` runs the whole panel over the whole promotion diff again, even though no
code changed. The adopter measured about 0.40M tokens for one `reviewer` voter on a 9-file diff. A
four-voter panel on a 30-file diff once a day is a large share of a weekly subscription quota. In the end
the adopter switched the reviewer off.

Two existing mechanisms do not cover this:

- **`paths-ignore`** on `pull_request` is matched against the whole pull-request diff, so a promotion PR
  that contains any code always matches (stated in the issue; I believe this is correct, unverified here).
- **Verdict carry (#1688, DR-104)** skips the voters only when the reviewable input hash is byte-identical
  to the previous head's (`.github/scripts/ai-review-guard.js:831-920`, `planVerdictCarry` at `:1337`). A
  data commit changes the three-dot diff, so the hash differs and the full panel runs.

### A correction to the issue's suggested shape

The issue suggests posting the `ai-review` check-run as **`neutral`** so that "ready-to-merge then reads the
PR as unreviewed". In a default adopter that is a merge bypass:

- GitHub treats `neutral` as **passing** a required check (`ai-review-guard.js:1997-2000`, and the #480 note
  at `.github/workflows/ai-review.yml:1055`).
- `ai-review` is the default required check that MinSpec advises, and `ready-to-merge` is deliberately
  **left out** of the default (`packages/minspec/src/lib/ruleset-advisor.ts:73`, `:479-481`).

So a `neutral` skip would let an unreviewed head merge on `ai-review` alone. The codebase already has a
merge-blocking "not reviewed, not a verdict" conclusion: `action_required`, used for a quota-blocked round
(`ai-review-guard.js:2007-2014`). This spec uses that conclusion (FR-6). Decision 1 below asks the human to
confirm it.

## Functional requirements

### Configuration

- **FR-1** The adopter declares data paths in the repository or organisation **variable**
  `AI_REVIEW_DATA_PATHS`, a regular expression matched against repo-relative paths. When it is unset or
  empty, behaviour is exactly as today: no skip is ever evaluated, and the run log says so in one line.
- **FR-2** The value is read only from `vars.AI_REVIEW_DATA_PATHS`, which needs admin rights to change. It is
  never read from any file in the pull request or the head commit, so a pull request cannot widen its own
  skip.
- **FR-3** A pattern that does not compile, or the matcher erroring, turns the skip off for that run and
  emits a visible `::warning` naming the variable. The full panel then runs. A bad pattern never fails the
  run and never skips a review silently.
- **FR-4** A path that matches the machinery predicate (the same `is_machinery` / `MACHINERY_PATHS_RE`
  definition the workflow already uses, not a second copy) is **never** data, whatever the pattern says.
  The same holds for any path under `specs/` or `docs/decisions/`, because a change there changes the
  approval facts in the reviewable input (`ai-review-guard.js:859-862`).

### Deciding the skip

- **FR-5** On `synchronize` the voters are skipped only when all of the following hold. If any one fails,
  the full panel runs (fail toward reviewing).
  1. Verdict carry declined (`steps.carry.outputs.carry != 'yes'`). A carry always wins, because it is a
     stronger result: a real pass on byte-identical input.
  2. `github.run_attempt` is 1. A re-run always reviews, the same escape hatch as DR-104.
  3. An **anchor** exists: the newest commit in the pull request's commit list that has a completed,
     allowlisted `ai-review` round recording a pass (see FR-7 and Decision 3). The anchor is never the
     previous push. If it were, a data push that cancelled an in-flight code review (`cancel-in-progress`,
     `ai-review.yml:188-190`) would hide that code.
  4. The anchor is an ancestor of the head. A force-push that rewrote history fails this test.
  5. `git diff --name-only --no-renames <anchor> <head>` succeeds, returns at least one path, and every path
     it returns matches FR-1 and is not excluded by FR-4. `--no-renames` reports both the old and the new
     path of a rename, so code renamed into a data directory is not skipped.
- **FR-6** On `opened` / `reopened` there is no anchor. The skip applies only when every path in the
  three-dot `base...head` change set passes the FR-5 item 5 test (the issue's rule). Item 2 still applies.
- **FR-7** The anchor search reads check-runs from the GitHub API with the App token, in the same way the
  carry step reads them. It uses the same allowlist (`AI_REVIEW_BOT_LOGINS`) and the same
  whole-listing rule (`wholeCheckRunListing`), and it **excludes** rounds that this feature posted (FR-8).
  The search is bounded: it walks the pull request's commits newest-first and stops after a fixed number of
  commits (the Plan sets the number). Running out of commits, any API error, or an unreadable response
  means no anchor, so the full panel runs.
- **FR-8** All decision logic (parsing, the anchor choice, path matching, and the title and summary text)
  lives in **one tested pure seam** in `ai-review-guard.js`, alongside `planVerdictCarry`. The workflow step
  only gathers raw text and passes it to the seam without reading it, which is the #1688 pattern. A base
  guard that predates the seam is detected, and the full panel runs.

### What a skip posts

- **FR-9** A skip **never produces a pass**. It posts a fresh `ai-review` check-run on the head with
  conclusion **`action_required`** (pending Decision 1). The title is
  `AI review: data only since <anchor-short-sha> - not reviewed`, and the summary lists the matched paths
  (capped) and says how to get a review: re-run the workflow.
- **FR-10** A skip applies no verdict label (`ai-review:pass`, `:changes`, `:blocked`) and no
  `ai-review/pass` commit status. The existing #359 staleness strip runs **unchanged**, so a pass on an
  older head is still removed by a push.
- **FR-11** The check-run carries a machine-readable marker (for example `data-skip:v1 anchor=<sha>`) so that
  FR-7 and the carry step can tell a skip apart from a voter round. A skip round is never an anchor, and it
  is never a carry source (`planVerdictCarry` already carries only a recorded pass,
  `ai-review-guard.js:879-884`. The Plan must show that a skip round can never parse as one).
- **FR-12** `ai-review-retry.yml` does not re-run a skipped round. It selects PRs by the `ai-review:blocked`
  label (`ai-review-retry.yml:65`), and FR-10 never applies that label. A test pins this so that no daily
  data push turns into a paid auto-retry.
- **FR-13** The skip writes one run-log line in every case, stating the decision and why (no anchor,
  carry won, path X is not data, pattern invalid, and so on), in the same way as the carry step's
  `ai-review verdict carry:` line.

### Distribution

- **FR-14** The change ships to adopters through the scaffolded templates (`ci-review-templates.ts`
  verbatim bodies for `ai-review.yml` and `ai-review-guard.js`), with the setting documented next to
  `AI_REVIEW_COVERAGE`. It is a no-op until an adopter sets the variable.

## Acceptance criteria

- **AC-1** With `AI_REVIEW_DATA_PATHS` unset, no voter-path behaviour changes. The existing ai-review guard
  and workflow-glue test suites pass unmodified. (FR-1)
- **AC-2** Seam test: an anchor exists, and anchor..head touches only `news/items.json` with pattern
  `^news/.*\.json$`. The result is skip=yes, conclusion `action_required`, the title names the anchor, and
  no label is applied. (FR-5, FR-9, FR-10)
- **AC-3** Seam test: anchor..head touches `news/items.json` and `src/a.ts`. The result is skip=no and the
  reason names `src/a.ts`. (FR-5.5)
- **AC-4** Cancel scenario: H0 has a pass, H1 is a code push whose round was cancelled, and H2 is a data
  push. The anchor is H0, the change set includes H1's code, and the result is skip=no. (FR-5.3)
- **AC-5** A pattern of `.*` with a change to `.github/workflows/x.yml` or `specs/a.md` gives skip=no. (FR-4)
- **AC-6** An invalid pattern (for example `(`) gives skip=no and a `::warning` that names
  `AI_REVIEW_DATA_PATHS`, and the run is not red because of it. (FR-3)
- **AC-7** `run_attempt` = 2 on a data-only push runs the full panel. (FR-5.2)
- **AC-8** A skip round on H2 followed by a data push H3 anchors on H0, not H2. (FR-11)
- **AC-9** The anchor is not an ancestor of the head (force-push), so the result is skip=no. (FR-5.4)
- **AC-10** An empty API response, an unparseable one, or a partial page (count mismatch) gives skip=no.
  (FR-7)
- **AC-11** A test asserts that `ai-review-retry.yml` selects only `ai-review:blocked`, and that the skip
  path never writes that label. (FR-12)
- **AC-12** A mutation check: flipping the skip conclusion to `neutral` or `success` makes at least one test
  fail. This guards the "never a pass" property, which tests could otherwise pass vacuously.

## Invariants the change must not break

1. **Offline core (constitution 1).** The extension makes no new network call. All API reads happen in the
   adopter's CI with its own App token.
2. **No silent gate (constitution 2).** A skip is visible on the PR (check-run title) and in the log. A
   failure in the skip logic runs the full panel and never passes silently. The skip step must not swallow
   its own failure into a pass. Like carry, it fails **toward reviewing**: `continue-on-error`, with
   `skip=no` written on every path except the one skip path.
3. **Blast radius (constitution 3).** Nothing changes in a repo that has not set the variable, and nothing
   ships to a repo without `.minspec/`.
4. **Never a false green.** A skip can never satisfy a required `ai-review` check or `ready-to-merge`. Only a
   voter round (or a DR-104 carry of one) produces `success`.
5. **Machinery stays human-gated (#480).** FR-4 means the data pattern can never exempt a machinery path.

## Out of scope (separate items; the issue raised them alongside)

- **Carrying an earlier pass forward across a data-only push** (the issue's "optional follow-up"). That
  would make declared data merge unreviewed, which is a different trust decision from DR-104's
  "byte-identical input". It would need its own DR.
- **Related finding 1: Refresh Harness Files overwrites a local edit inside a `minspec:managed` block without
  notice.** This is a separate harness-refresh defect, near SPEC-058. Not yet filed: this dispatch cannot
  run `gh` or edit `docs/backlog.md`, so filing it is listed in the agent summary.
- **Related finding 2: the job token persists in `.git/config` while the voters hold `Read`, and `redact()`
  does not scrub `gh[pousr]_` tokens.** `actions/checkout` at `ai-review.yml:284` sets no
  `persist-credentials`, and `redact()` scrubs only the inference token and `sk-ant-*`
  (`ai-review.yml:497-513`). This is a security item that belongs with #2982, not here. It must be filed as
  its own issue. This dispatch has no `gh` access, so filing it is listed in the Your turn block of the
  agent summary.

Neither finding is acted on in this spec (CLAUDE.md triage rule 1).

## Decisions needed (Clarify)

1. **What conclusion a skip posts.**
   - (a) **`action_required` (rec)**. It blocks a required `ai-review` check, which keeps invariant 4, and
     it already means "not reviewed, re-run to review" in this codebase. Cost: a PR whose head is a skip
     cannot merge until someone re-runs the workflow, so the promotion PR (and any data-only PR) pays for
     one full round at merge time. That is still one round instead of one a day.
   - (b) `neutral`, as the issue suggests. Cost: in a default adopter, where `ai-review` is required and
     `ready-to-merge` is not, the declared regex becomes a merge exemption, and an anchor bug would let code
     merge unreviewed.
   - (c) Post no check-run, so the check stays pending. Cost: "Expected - waiting for status" with no
     reason shown, which goes against the visible-failure rule.
2. **Pattern syntax.**
   - (a) **A JavaScript regular expression, evaluated by the guard (rec).** One matcher in one tested place.
     Cost: it is not strictly the POSIX ERE the issue names (`[[:digit:]]` is not supported), so the
     documentation must say "JavaScript regex".
   - (b) A newline-separated glob list (gitignore style). It is more familiar for paths, but it needs a glob
     engine in the guard, or a dependency, and its semantics differ from `paths-ignore`.
3. **Which rounds can anchor.**
   - (a) **Only a recorded pass (rec).** It reuses the existing `review-round:v1` record, which is written
     only for a pass (`ai-review-guard.js:922-925`), so no new record format is needed. Cost: a PR sitting
     on `ai-review:changes` still pays the full panel on every data push until it is fixed.
   - (b) A pass or a voter-completed `changes` round. That also saves on blocked PRs, but needs a new
     record on `changes` rounds, and so a format change to the round record.

## Decision record

None minted. Every choice here is reversible in under a day: unset the variable, or revert one workflow
step and one guard function. Nothing is persisted that a revert would strand. If Decision 1 lands on (b)
`neutral`, that makes a merge exemption and does need a DR, which would amend DR-104's scope.
