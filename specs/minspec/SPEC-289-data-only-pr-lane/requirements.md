---
id: SPEC-289
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - PRs from contributors who do not use MinSpec
aspects: [ai-review, docs-lane, harness, token-spend, no-silent-gate, fail-closed, config, blast-radius]
depends_on: []
relates_to: ["#2973", "#2094", "#1970", "#1847", "#575", SPEC-039, SPEC-217, SPEC-232, SPEC-033, "#2870", DR-033, DR-051, DR-066]
implements: none
implements_reason: >-
  Specify phase only. The files this spec will own (the shipped ai-review workflow template,
  a new pure classifier module, config schema) are fixed at Plan, after Decisions D1-D6 are
  answered and the FR-0 baseline is measured.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-289: Data-only pull requests are detected automatically and reviewed on a cheap lane

> **This is a SPECIFICATION ONLY.** Written for issue #2973 (founder queue item in13). Nothing
> is built until a human reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify),
> and approves it.
>
> Design rationale it rests on: DR-033 (consequence-hybrid gate: `ai-review:pass` gates merge),
> DR-051 Option 2 (the docs lane, #575), DR-066 (fail closed). No DR is minted by this spec:
> every choice below is reversible in under a day by reverting a template change (the ADR
> filter). **One exception is flagged:** if D2 picks option (b), `ai-review:pass` would start to
> attest something no model checked, which changes what DR-033's gate means; Plan must then
> write a DR before building.

## In plain terms

Founder, 2026-10-20: "Data only PRs submitted by devs who aren't aware of MinSpec should be
detected and handled like docs-lane to minimize token use from automated data updates."

In an adopter repo, somebody (a person, or a bot) opens a pull request that only refreshes data:
fixtures, CSV/JSON/YAML data files, a generated dataset. They have never heard of MinSpec, so
they will not add a label or write a spec. Today that PR goes through the full AI-review panel,
the same spend as a code change. This spec makes MinSpec recognise such a PR from its file list,
recompute that recognition on every push, and review it on a cheaper path, without ever letting
a code change ride in on it.

## Verified current state (read from code at dispatch base, 2026-10-28)

These are the facts the design rests on. Each was read from the file cited.

1. **The docs lane does not reduce AI-review spend today.** It only arms auto-merge.
   `.github/workflows/docs-lane.yml:3-7`: "the SAME required checks (lint · test · MinSpec SDD
   validation · ai-review · ready-to-merge) still gate it. Nothing is bypassed; it merely merges
   automatically once green." In `.github/workflows/ai-review.yml`, the reviewer voter always runs
   (`:676`), the architect and skeptic voters run whenever coverage is `panel` (`:690-695`), and
   coverage defaults to `panel` (`:478`). The only docs saving is the security voter, skipped when
   every changed file ends in `.md` (`:685-688`). A data file (`.json`, `.csv`) is not `.md`, so a
   data-only PR today runs all four voters.
   **Consequence for the founder's request:** "handled like docs-lane" cannot mean "cost what a
   docs PR costs", because a docs PR still costs three voters. The token saving has to be new
   behaviour. D2 asks how much.
2. **The docs lane is opt-in by label.** `docs-lane.yml:34-36`: the job runs only
   `if: contains(github.event.pull_request.labels.*.name, 'docs-lane')`. A contributor who does
   not know MinSpec never adds that label, so the docs lane's entry point cannot serve them.
   Detection here must be automatic (no label from the author).
3. **The docs lane's eligibility test is a path regex plus refusals.** `docs-lane.yml:100`
   (`allowed='^(specs/|docs/|skills/.*\.md$|\.minspec/approvals/|[^/]+\.md$)'`), an
   outward-facing denylist on top (`:101-`), and the governance `status:` refusal (#1847). Every
   non-zero exit revokes an earlier arming through an EXIT trap (`:47-`, #1968).
4. **The docs lane's eligibility bugs were producer drift.** #2094 / SPEC-232: one of three
   label producers skipped the eligibility check. #1970 / SPEC-217: the check hardcoded paths an
   adopter can move. Lesson carried into this spec: one predicate, recomputed by the consumer from
   the diff, never a trusted label.
5. **Both workflows ship to adopters.** `packages/minspec/src/lib/template-registry.ts:2593`
   (`ai-review-workflow`) and `:2617` (`docs-lane-workflow`). A change to the shipped ai-review
   template reaches every initialised repo on its next harness refresh.
6. **Fork PRs already spend zero tokens.** `ai-review.yml:201-203`: an empty secret (unset, or a
   fork PR) makes the guard step skip review with a NOTICE. The PR then sits without
   `ai-review:pass`, so `ready-to-merge` stays red and a human must act.

**Believed, unverified (FR-0 measures these before Plan):**

- I believe, unverified, that PRs opened by Dependabot get no Actions secrets on a
  `pull_request` trigger, so they also skip review today (zero tokens) and wait on a human.
- I believe, unverified, that PRs opened with a workflow's own `GITHUB_TOKEN` trigger no
  workflows at all, so a scheduled "refresh data" workflow that opens PRs that way gets no review
  run, no spend, and no `ready-to-merge` status.
- If both hold, the automated data-update PRs the founder has in mind may spend **nothing**
  today and cost founder time instead (a human merge). The token saving this spec targets would
  then apply only to bots that open PRs through a GitHub App or PAT, and to people. That is why
  FR-0 comes first.

## Functional requirements

**FR-0 - Measure before building.** Before Plan, record a baseline in this spec's directory
(`baseline.md`): for each author class (human member, human outside collaborator, fork,
Dependabot, Renovate or other App bot, workflow `GITHUB_TOKEN`), whether ai-review runs at all,
the voter count it runs, and the token spend per PR, taken from ai-review run logs in at least this
repo plus one adopter repo if one is available. The measured goal from #2973 is spend per
automated data-update PR, before and after; with no baseline there is no after. If the baseline
shows the target classes spend zero tokens today, Plan returns to Clarify with that number
instead of building (D6).

**FR-1 - One pure classifier.** A single pure function decides data-lane eligibility from
(a) the PR's changed-file entries, each with status (added, modified, deleted, renamed and its
old path, copied), old and new git mode, and (b) the data-lane config. It does no I/O. It returns
one of `eligible`, `refused(reason, path)`, `unproven(reason)`. Every consumer (the ai-review
voter-selection step, and any auto-merge job D3 adds) calls this one predicate, or a generated
copy pinned byte-identical to it by a parity test, the way SPEC-217 pins the docs-lane predicate.

**FR-2 - Eligible means every path is data.** A PR is `eligible` only if it changes at least one
file, and every changed path, **including the old path of a rename or copy**, matches the
adopter's data allowlist (FR-3) and matches no entry of the code denylist (FR-4).

**FR-3 - Adopter-configured allowlist, conservative default.** The allowlist is a list of path
globs in `.minspec/config.json` under a new key (name fixed at Plan; working name
`dataLane.paths`). The default is decided by D1; the recommendation is an **empty list**, which
leaves the lane off until the adopter names their data directories. Glob matching is literal: no
value is interpolated into a regex or a shell expression (SPEC-217 FR-5 and FR-6 apply here too).

**FR-4 - A code denylist that the allowlist cannot override.** Even when it matches the
allowlist, a path is refused if any of these holds:
- it is under `.github/`, `.minspec/`, `.githooks/`, `.vscode/`, or `.devcontainer/`;
- its basename is a package or build manifest or a lockfile (`package.json`, `package-lock.json`,
  `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `tsconfig*.json`, `jsconfig*.json`,
  `Cargo.toml`, `Cargo.lock`, `go.mod`, `go.sum`, `pyproject.toml`, `requirements*.txt`,
  `Gemfile*`, `composer.*`, `Dockerfile*`, `Makefile`; the full list is fixed at Plan and pinned
  by test), or matches `*.config.*`, `*rc`, `*rc.json`, `*rc.yaml`, `*rc.yml` (whether lockfiles
  may ever be data is D4);
- its name matches `*.schema.json` or `*.schema.yaml`, or it lives under a directory named
  `schema` or `schemas`;
- its new mode is executable (`100755`), a symlink (`120000`), or a submodule (`160000`), or the
  mode changed in either direction;
- its extension is a code or script extension (the list is fixed at Plan and pinned by test,
  at least `js ts mjs cjs jsx tsx py rb sh bash ps1 go rs java kt php pl lua`).

The issue's "a `.json` config read at build time" case is not fully decidable from paths. The
denylist catches the conventional names; whether to also check that no code file in the base tree
references the data path by name is D5.

**FR-5 - Recompute on every head, consumer side.** The classifier runs inside the consumer, on
the PR's current head, on every `opened`, `synchronize`, `reopened` and `ready_for_review` event.
No label, comment, or earlier verdict is trusted as evidence of eligibility. A `data-lane` label,
if D3 keeps one, is display only and is written by the consumer, never read by it.

**FR-6 - Read config at the base, not the head.** The data-lane config is read at the PR's base
commit (SPEC-217 FR-2). A PR cannot widen its own allowlist, and `.minspec/` is in the FR-4
denylist, so a PR that edits the config is refused anyway.

**FR-7 - Fail closed to the full path, visibly.** Each of these yields `unproven`, which routes
the PR to the normal full review path, never the cheap one, and prints an `::warning::` plus a
line in the review comment naming the cause: the changed-file list cannot be read or is truncated
(over the API's file-count cap); the config cannot be fetched or is not valid JSON; the key is
present but malformed; a glob fails validation. The lane never assumes eligible on a missing
witness (constitution invariant 2). Falling back to the full review is the safe direction, so
`unproven` is not a merge refusal.

**FR-8 - Losing eligibility mid-PR.** When a later push makes an eligible PR `refused` or
`unproven`, the next run takes the full path. Any cheap-lane verdict or auto-merge arming from an
earlier head is void: the existing staleness strip in `ready-to-merge.yml` (#359) already strips
`ai-review:pass` on `synchronize`, and any auto-merge D3 adds must be revoked by an EXIT trap, as
`docs-lane.yml` does (#1968).

**FR-9 - Nothing asked of the author.** An eligible PR needs no spec, no approval, no label, and
no MinSpec knowledge from its author. Authorship never widens eligibility: the classification is
by paths only. Author identity may only *narrow* what happens after classification (D3: whether
an eligible PR may auto-merge), and where it is used it keys on account type or id, never on the
login string (the bot-identity spec for #2870, SPEC-263, in flight and not yet on main).

**FR-10 - Say what was skipped.** The review comment on a cheap-lane PR states, in words, that
the PR was classified data-only, which voters did not run and why, and which paths were checked.
This follows the existing skipped-voter note (`ai-review.yml:1004-1042`), whose point is that a
reduced review must never look like a full one.

**FR-11 - Cheap path behaviour.** What the cheap path runs is D2. Whatever D2 chooses, the
independent `secret-scan` workflow, `MinSpec SDD validation`, `lint` and `test` still run
unchanged, and `ready-to-merge` still requires a verified `ai-review:pass` posted by the
allowlisted reviewer identity.

**FR-12 - Measure after.** The review comment (or run summary) records the lane taken and the
spend for that run, so the FR-0 comparison can be redone from logs after the change ships.

## Acceptance criteria

- **AC-1** Allowlist `data/**`; PR changes only `data/prices.csv` and `data/rates.json`:
  `eligible`, cheap path, comment names the lane and the skipped voters.
- **AC-2** Same allowlist; PR changes `data/prices.csv` and `src/load.ts`: `refused` naming
  `src/load.ts`, full panel.
- **AC-3** Allowlist `**/*.json`; PR changes `package.json` only: `refused` (FR-4 manifest).
- **AC-4** Allowlist `data/**`; PR renames `scripts/build.sh` to `data/build.sh`: `refused`
  (old path is not data; mode also checked).
- **AC-5** Allowlist `data/**`; PR adds `data/run` with mode `100755`: `refused` (executable).
- **AC-6** Allowlist `data/**`; PR changes `data/user.schema.json`: `refused` (schema).
- **AC-7** Allowlist `data/**`; PR changes `.github/workflows/x.yml` and `data/a.csv`: `refused`.
- **AC-8** No `dataLane` key in config (default per D1 = empty): every PR takes the full path;
  no warning is printed for the absent key, because absence is the default, not an error.
- **AC-9** Config key present but not a list of strings: `unproven`, full path, `::warning::`
  names the key.
- **AC-10** File list truncated by the API cap: `unproven`, full path, warning printed.
- **AC-11** Eligible PR, then a push adds `src/x.ts`: the next run takes the full panel; an
  earlier `ai-review:pass` is stripped on `synchronize`; any auto-merge arming is revoked.
- **AC-12** A PR that edits `.minspec/config.json` to add `src/**` to the allowlist: `refused`
  (FR-4 `.minspec/`), and the allowlist used is the base's (FR-6).
- **AC-13** A PR changing only Markdown under `docs/` is unaffected by this spec: its routing is
  byte-for-byte what it is today (the data lane and the docs lane do not overlap; see Out of scope).
- **AC-14** A parity test fails if any consumer decides data-lane eligibility other than through
  the FR-1 predicate (or its pinned generated copy). Shown red on a mutant consumer that passes a
  literal, green on the real one.
- **AC-15** The classifier is mutation-tested on the FR-4 denylist: deleting any one denylist
  entry turns at least one test red.
- **AC-16** A glob value holding regex metacharacters (`data/a+b/**`, `data/[x]/**`) matches
  literally and cannot widen the match.

## Invariants the change must not break

- **Constitution 1 (offline):** the classifier is pure and the extension gains no network call.
  All new behaviour runs in the adopter's CI, which already runs ai-review there.
- **Constitution 2 (no silent gate):** every unreadable witness routes to the full review and
  says so (FR-7); no `|| true` on the classification path; `ready-to-merge` still requires a
  verified pass from the allowlisted identity; the secret-scan workflow stays as an independent
  second witness over the data content.
- **Constitution 3 (blast radius):** behaviour changes only in repos with `.minspec/` that ran a
  harness refresh, and (with D1's recommended empty default) only after the adopter names data
  paths. A repo that does nothing sees no change.
- **DR-033:** merge stays gated on `ai-review:pass` from the allowlisted reviewer identity.
- **docs-lane:** the docs lane's corpus, refusals and EXIT-trap revocation are unchanged.
- **#359 / #397 (`ready-to-merge` staleness and provenance guards):** unchanged and still apply.

## Out of scope

- Fork PRs. Serving them would need secrets in a fork context (`pull_request_target`), a known
  hazard; they keep today's zero-spend, human-merge behaviour (fact 6).
- Mixed PRs (docs plus data). They take the full path in this version. Widening the lane to the
  union is a later change if FR-0 shows such PRs are common.
- Changing the docs lane, its label, or its eligibility rule.
- Teaching non-MinSpec contributors anything (no bot comment asking them to adopt MinSpec).
- Any implementation, in this dispatch.

## Decisions needed (Clarify)

5 of 6 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). D6 is recorded but not closed: its
selection returns the spec to Clarify with the FR-0 numbers before Plan, so it stays open until those numbers
are in. This spec is unapproved, so these answers bind nothing until a human or a covered delegation approves it.

**D1 - What is the default allowlist?**
- **(a) Empty: lane off until the adopter names data paths (rec).** Zero risk of misclassifying
  code in a repo nobody looked at. Cost: adopters get no saving until they set the key, and most
  will not know to; init could suggest it (that suggestion would be a follow-up).
- (b) A conventional default (`fixtures/**`, `testdata/**`, `data/**` with extensions `csv tsv
  json ndjson jsonl yaml yml parquet`). Cost: a repo whose `data/loader.json` drives its build gets
  a cheap review on a behavioural change, the exact case #2973 says must not count as data.

**Recorded selection: Option (a),** the default allowlist is empty; the lane is off until the adopter names data paths. An agent session copied this document's (rec) option; no human chose this item.

**D2 - What does the cheap path run?** (The token decision.)
- **(a) One reviewer voter with a data-lane prompt, other voters skipped (rec).** Roughly a
  quarter of today's four-voter spend (believed, FR-0 measures it). A model still looks at the
  data, so a data file that smuggles a secret, a prompt-injection payload aimed at downstream
  consumers, or a nonsense value is still caught some of the time. Cost: not zero; the founder
  asked to minimise.
- (b) No model at all: a deterministic data-lane verdict posted as `ai-review:pass` by the
  reviewer App, comment saying no model ran. Zero tokens. Cost: `ai-review:pass` would no longer
  mean "a model reviewed this", which changes DR-033's gate meaning and needs a DR; the only
  witness over data content becomes secret-scan.
- (c) The reviewer voter on a smaller model. Cost: adds a model-selection path to the shipped
  workflow, and a weaker model is still spend.

**Recorded selection: Option (a),** one reviewer voter with a data-lane prompt, other voters skipped. An agent session copied this document's (rec) option; no human chose this item.

**D3 - Does an eligible PR auto-merge?**
- **(a) Yes, for authors who are repo members or an App bot the adopter lists; no for everyone
  else (rec).** Gets "automated data updates" off the founder's desk, matching the docs lane. Cost:
  a new author-trust input (keyed by account id, per SPEC-263) and a second job that must carry
  the docs lane's EXIT-trap revocation.
- (b) Never: cheap review only, a human merges. Cost: every data refresh still needs a human
  keystroke, which works against tenet 1.
- (c) Yes for every author. Cost: an outside contributor's data lands with no human ever seeing
  it; not recommended.

**Recorded selection: Option (a),** an eligible PR auto-merges for repo members or an App bot the adopter lists, and not for anyone else. An agent session copied this document's (rec) option; no human chose this item.

**D4 - Can a lockfile ever be data?**
- **(a) No, never (rec).** A lockfile decides which third-party code runs; it is the supply chain,
  and the security voter exists for it. Cost: Dependabot or Renovate lockfile bumps, the most
  common "automated update", stay on the full path. (Fact-check first: they may spend zero today,
  see FR-0.)
- (b) Yes, if the adopter explicitly lists it. Cost: an adopter can switch off review of their
  supply chain with one config line.

**Recorded selection: Option (a),** a lockfile is never data. An agent session copied this document's (rec) option; no human chose this item.

**D5 - Is "not referenced by code" checked, or only path conventions?**
- **(a) Path conventions plus the FR-4 denylist only (rec).** Pure, cheap, predictable. Cost: a
  data file that code reads to decide behaviour, under an allowlisted path with an ordinary name,
  is reviewed cheaply; the adopter's allowlist is the control.
- (b) Also refuse a data path whose literal name appears in any non-data file in the base tree.
  Cost: a repo-wide scan per PR, false refusals on harmless references (a test that loads a
  fixture is code referencing data), and it still misses computed paths.

**Recorded selection: Option (a),** path conventions plus the FR-4 denylist only. An agent session copied this document's (rec) option; no human chose this item.

**D6 - If FR-0 shows the target bot PRs spend zero tokens today, what then?**
- **(a) Return to Clarify with the numbers before Plan (rec).** The founder's goal was tokens; if
  the spend is already zero, the real cost is founder merge time, which is D3's question, not D2's.
  Cost: one more round-trip before any build.
- (b) Build anyway for human-authored data PRs. Cost: may build a lane for a class that barely
  exists.

**Recorded selection: Option (a),** return to Clarify with the FR-0 numbers before Plan. An agent session copied this document's (rec) option; no human chose this item.

## Follow-ups (tracked)

None filed yet. Each Decision above resolves at Clarify; any follow-up a decision surfaces (for
example the init suggestion under D1 (a)) is materialised then, per DR-023.
