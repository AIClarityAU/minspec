---
id: SPEC-287
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - who wrote a verdict is decided by account, not by spelling
aspects: [security, provenance, ai-review, dispatch, no-silent-gate]
depends_on: []
relates_to: [DR-033, DR-054, DR-108, DR-111, "#2870", "#2686", "#2589", "#2694"]
implements: none
implements_reason: >-
  Specify phase only. The files this spec will own are named in the FR-1 inventory but are
  fixed at Plan, after the inventory is re-verified at the implementing base and Decisions
  D1-D4 are answered.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-287: Every trust check on the pipeline's bot keys on account type or id, never on the bare login

> **This is a SPECIFICATION ONLY.** Written for issue #2870 (GraphQL reports the bot as bare
> `minspec-sdd`). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
>
> Design rationale it rests on: DR-033 (consequence-hybrid gate; the `AI_REVIEW_BOT_LOGINS`
> allowlist), DR-054 (`minspec-sdd[bot]` as the shipped reviewer identity), DR-108 (delegated
> merge), DR-111 (ALT-A self-merge). No new DR: every choice below is reversible in under a
> day (the ADR filter), so none is minted.

## In plain terms

The pipeline's GitHub App comments under two spellings. REST says `minspec-sdd[bot]`, type
`Bot`. GraphQL (and therefore `gh pr view --json comments` / `gh issue view --json comments`)
says `minspec-sdd`, with no suffix. A person could register `minspec-sdd` as an ordinary user
account. Any gate that trusts a comment, label, status or check because its author's login
equals `minspec-sdd` (or equals it after stripping `[bot]`) cannot tell the App from that
person. The fix is to decide trust on what the registrant of an account does not get to choose:
the account's kind (`__typename == "Bot"` in GraphQL, `type == "Bot"` in REST) and its number
(bot user `databaseId`, or the App id on check-runs and statuses).

## Measured state (this base, `bd2d754f`)

Read from the code at this base, not inferred. Line numbers rot; the implementer re-reads each
site at their own base (FR-1).

| # | Site | API read | What it keys on | Grants or refuses? | Squattable by a user named `minspec-sdd`? |
|---|------|----------|-----------------|--------------------|-------------------------------------------|
| S1 | `scripts/lib/dispatch-author-gate.sh:58,168,190` (dispatch author gate) | GraphQL `__typename` + `databaseId` | account key `Bot:299695933` | grants | **No** - already account-keyed |
| S2 | `scripts/dispatch-ready-check.sh:424-480` (`--trusted-comment-bodies`, verdict-record reader) | `gh issue view` (GraphQL), bare comments resolved by id via S1 | S1's account list | grants | **No** - already fixed; comment at `:196-199` records why |
| S3 | `scripts/alta-self-merge.ts:195-207` (ALT-A producer check) | REST check-runs + statuses | `app.id === integrationId` and `creator.type === 'Bot'` and `creator.login === slug+'[bot]'` | grants | **No** |
| S4 | `scripts/lib/delegated-approval.ts:282` (latest AI review comment) | REST `issues/:n/comments`, `user.login` (`:365`) | exact `login === 'minspec-sdd[bot]'` (`REVIEWER_LOGIN`, `:73`) | grants (delegated approval) | Not today, *if* a user login cannot contain `[bot]` (I believe that, unverified). Keys on spelling, not type. |
| S5 | `scripts/lib/delegated-approval.ts:268,376` (AI review check-run) | REST check-runs, `app.slug` | `appSlug === 'minspec-sdd'` | grants | Not by a user (check-runs come only from Apps); keys on slug, not App id |
| S6 | `.github/scripts/ai-review-guard.js:771,819,1120,1748` (verdict reuse, re-attest, round record, pass check-run) | REST check-runs, `app.slug` | `slug` **or** `slug+'[bot]'` in `AI_REVIEW_BOT_LOGINS` | grants (merge gate) | Not by a user (Apps only); keys on slug, not App id |
| S7 | `.github/scripts/ai-review-guard.js:1420` (`decideProvenanceRevert`), fed by `ready-to-merge.yml:221` | webhook `sender.login` | login in `AI_REVIEW_BOT_LOGINS` | grants (keeps `ai-review:pass`) | Only if the allowlist holds a bare entry. Default `minspec-sdd[bot]` (`ready-to-merge.yml:166`); `parseAllowlist` (`:1397`) accepts bare user logins by design |
| S8 | `.github/scripts/ai-review-guard.js:1604`, fed by `ready-to-merge.yml:349` | REST timeline `actor.login` | login in allowlist | grants (label provenance) | Same as S7 |
| S9 | `.github/scripts/ai-review-guard.js:1666` (`ai-review/pass` status creator) | REST statuses `creator.login` | login in allowlist | grants | Same as S7 |
| S10 | `scripts/remediate-pr.sh:395-404` (`count_markers_json`, remediation budget) | `gh pr view --json comments` (GraphQL) `author.login` | login with `[bot]` stripped on **both** sides | counts toward a cap | **Yes.** A user `minspec-sdd` comment ending in the marker counts. Direction: over-count, so the cap trips early (remediation denial of service), never a false green |
| S11 | `scripts/dispatch-ready-check.sh:321-329` (`is_bot_identity`) | caller-supplied login (REST `sender.login`, `gh api user`) | `*[bot]`, `github-actions`, `minspec-sdd` | **refuses** (a bot may not mint the human approval) | A user `minspec-sdd` is refused as if a bot. Fail-safe direction |
| S12 | `.github/workflows/approve-on-label.yml:55` | webhook `sender.login` | `!endsWith('[bot]')` | refuses bots | No |
| S13 | `scripts/review-churn-report.sh:55,183,193,262` | REST check-runs `app.slug` | `slug == 'minspec-sdd'` | report only, not a gate | n/a |

What this settles from the issue's "not verified here": one gate does read the bare GraphQL
name today in a trust-affecting way (S10), and it fails in the over-count direction. No
merge-granting gate at this base accepts a *user* account named `minspec-sdd` under the default
configuration. The merge-granting gates S7-S9 would, if an operator wrote the bare name into
`AI_REVIEW_BOT_LOGINS` (inferred from `parseAllowlist` + `isAuthorizedReviewer`, not exercised).
Several grant-side sites (S4-S9) key on a spelling that happens to be unsquattable rather than
on the account's kind, which is the property the issue asks for.

## Functional requirements

- **FR-1 Inventory, re-verified.** Before any change, the implementer re-runs the inventory
  above at their base: every place that decides trust from who authored a comment, label
  event, commit status, check-run or review. It records, per site, the API read, the field
  keyed on, and the direction (grants / refuses / reports). Search vocabulary must include at
  least: `login`, `author`, `user`, `sender`, `actor`, `creator`, `slug`, `minspec-sdd`,
  `[bot]`, `__typename`, `AI_REVIEW_BOT_LOGINS`, `REVIEWER_`. The final table is committed in
  the Plan (`design.md`), with names of the terms searched.
- **FR-2 Grant-side sites key on kind and number.** Every site whose answer can *grant* trust
  (keep a pass label, accept a verdict, count toward approval or merge, admit a dispatch) must
  require, for the pipeline's own bot:
  - for a comment / label event / status creator: account kind is Bot (`__typename == "Bot"`
    in GraphQL, `type == "Bot"` in REST) **and** the bot account's number matches
    (`databaseId` / `id` = the configured bot user id, today `299695933` per
    `dispatch-author-gate.sh:58`);
  - for a check-run: `app.id` equals the configured App id (as S3 already does), not only
    `app.slug`.
  A login may be carried for display and for error messages; it is never the deciding field.
- **FR-3 GraphQL readers ask for the kind.** Any reader that obtains authors through GraphQL
  or `gh … --json comments` either requests `author { __typename login ... on Bot { databaseId } }`
  or resolves the comment by id (as S2 does). A comment whose author arrives without a kind is
  not trusted.
- **FR-4 Fail closed, visibly (invariant 2).** A missing, malformed or unreadable kind/id is a
  refusal with a stated reason, never a pass and never a silent skip. Where a lookup can fail
  for network reasons, the caller distinguishes "no answer" from "answer: none" (S2's exit 75
  convention is the model).
- **FR-5 Refuse-side sites may keep the login.** A site whose only effect is to *refuse* (S11,
  S12) may continue to match on spelling, including the bare `minspec-sdd`, because a false
  match there makes the gate stricter. Each such site carries a one-line comment saying so.
- **FR-6 One predicate per language.** The "is this the pipeline's bot?" test exists once per
  runtime (bash: `dispatch-author-gate.sh`; JS/TS: one exported function), and every grant-side
  site calls it. A second, hand-copied comparison is a defect. The bot user id and App id are
  read from one place per runtime.
- **FR-7 Allowlist entries for adopters.** `AI_REVIEW_BOT_LOGINS` remains the adopter-facing
  knob (DR-033, DR-054). Resolution of how a bare (non-`[bot]`) entry is treated is Decision D1.
- **FR-8 Remediation budget (S10).** The marker counter stops treating a bare-login match as the
  bot. Resolution of the exact rule is Decision D2.
- **FR-9 Regression proof.** Each grant-side site gets a test with a squatter fixture: same
  login `minspec-sdd`, kind `User` (GraphQL `__typename: "User"`, REST `type: "User"`), any id
  other than the bot's. The test must be red against the pre-change code where the site is
  squattable (S10, and S7-S9 with a bare allowlist entry) and green after. For sites already
  safe (S1-S3), a test asserting the squatter is refused is added if one does not exist.
- **FR-10 Drift guard.** A deterministic check (a test, not prose) fails when a new grant-side
  comparison of an author login to the literal `minspec-sdd` or `minspec-sdd[bot]` appears
  outside the FR-6 predicates. Scope of that check is set at Plan.
- **FR-11 Squat check (founder action).** Record, in the PR that implements this spec, whether
  the user login `minspec-sdd` is registered. Registering it is the founder's call (D3); this
  spec does not depend on it, because FR-2 makes the squat harmless.

## Acceptance criteria

- **AC-1** The FR-1 table is in `design.md`, lists every site found with API, field and
  direction, and names the search terms used.
- **AC-2** For each grant-side site, a fixture author `{login: "minspec-sdd", __typename: "User",
  databaseId: 1}` (and its REST equivalent `{login: "minspec-sdd", type: "User", id: 1}`) is
  refused, and the real bot (`Bot`, `299695933`) is accepted.
- **AC-3** A fixture author `{login: "minspec-sdd[bot]", type: "User"}` (spelling right, kind
  wrong) is refused at every grant-side site.
- **AC-4** A check-run with `app.slug == "minspec-sdd"` and an `app.id` other than the configured
  App id is refused at S5 and S6.
- **AC-5** An author with no kind field is refused with a reason that names the missing field
  (FR-4); the gate's output shows it, nothing is swallowed.
- **AC-6** S10: five squatter marker comments do not move the remediation count; five real-bot
  marker comments do.
- **AC-7** FR-10's guard is red on a planted `if (login === 'minspec-sdd')` in a grant-side file
  and green on the shipped tree.
- **AC-8** The default configuration (`AI_REVIEW_BOT_LOGINS` unset, so `minspec-sdd[bot]`) still
  passes a genuine review end to end: no change in merge behaviour for the real bot.

## Invariants this change must not break

- **Invariant 1 (offline core).** Nothing here touches the VS Code extension's Tier-0 core.
  The sites are CI workflows and dev-time `scripts/`, already networked. No new network call is
  added to `packages/minspec`; any extra GraphQL field rides an existing request.
- **Invariant 2 (no silent gate).** FR-4. Every refusal is visible; no `|| true` on a trust
  signal; no single producer: S2's id lookup stays the second witness for bare comments.
- **Invariant 3 (blast radius).** Adopter repos get the change only through the shipped
  workflows they opted into via `.minspec/`; FR-7/D1 must not break an adopter whose reviewer is
  a legitimate user account without a stated migration.
- **Existing refusals stay.** `is_bot_identity` keeps refusing a bot as approver (S11); the
  human-keystroke gates (`approve-issue.sh`, `approve-on-label.sh`) keep refusing any `[bot]`.
- **No borrowed identity.** Nothing in this change mints, or lets the pipeline mint, an approval
  under the founder's identity.

## Decisions needed (Clarify)

3 of 4 decisions are answered, not ratified: an agent session selected, for D1, D2 and D4, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). D3 is not answered: it asks
the founder to register a GitHub login, which only a human can do, so it stays open for him. This spec is
unapproved, so the three recorded answers bind nothing until a human or a covered delegation approves it.

- **D1 - Bare entries in `AI_REVIEW_BOT_LOGINS`.** The variable accepts user logins on purpose
  (`ai-review-guard.js:1396`), so an adopter can run a reviewer as a machine user.
  - **(a) (rec)** Keep the variable. An entry ending in `[bot]` matches only an actor whose kind
    is Bot; a bare entry matches only an actor whose kind is User, and a bare entry equal to an
    App slug in use is warned about in the gate output. Cost: the real fix for the slug/user
    confusion still rests on the operator not writing the wrong form; it narrows, not closes.
  - (b) Add `AI_REVIEW_APP_IDS` (numeric) and make it authoritative when set, logins only as a
    fallback. Cost: a second knob adopters must learn; two sources of truth until the login form
    is retired.
  - (c) Reject bare entries outright. Cost: breaks any adopter running a user-account reviewer
    (invariant 3 concern); none is known in this repo, unverified for adopters.
  **Recorded selection: Option (a),** keep the variable; a `[bot]` entry matches only a Bot-kind actor and a bare entry only a User-kind actor. An agent session copied this document's (rec) option; no human chose this item.
- **D2 - Remediation budget counter (S10).**
  - **(a) (rec)** Add `__typename` to the comment read and count only Bot-kind authors for
    `[bot]` allowlist entries (and User-kind for bare ones). Cost: one more field on an existing
    `gh pr view` read; the counter's fail-soft-to-0 behaviour on parse error must be re-examined,
    because 0 is the un-bounding direction.
  - (b) Leave it; over-count only delays remediation. Cost: a squatter can stall the
    remediation loop on any PR by posting markers; that stall is silent today.
  **Recorded selection: Option (a),** add `__typename` to the comment read and count only Bot-kind authors for `[bot]` entries. An agent session copied this document's (rec) option; no human chose this item.
- **D3 - Register the `minspec-sdd` user login (founder action).** Whether it is free was not
  checked: this dispatch may make no network call.
  - **(a) (rec)** Check; if free, register it as a held machine account with 2FA and no
    repository access. Cost: one more account to secure, and GitHub's account terms on machine
    accounts apply.
  - (b) Do nothing; rely on FR-2. Cost: the bare name stays available to anyone, harmless to
    gates after this spec ships but still a confusion vector in human-read comment threads.
- **D4 - S4/S5/S6 already-unsquattable spellings.** `minspec-sdd[bot]` cannot be a user login
  and an App slug cannot be a user's check-run (both believed true, unverified).
  - **(a) (rec)** Convert them anyway (FR-2), so the property is "keyed on kind/id" everywhere
    and FR-10 can be a simple rule. Cost: touches the merge gate (`ai-review-guard.js`), which is
    machinery and needs founder `--admin` merge.
  - (b) Leave them, document why each is safe. Cost: FR-10's guard must carry exceptions, and
    the next reader has to redo the reasoning.
  **Recorded selection: Option (a),** convert S4/S5/S6 anyway (FR-2), so the property is keyed on kind or id everywhere. An agent session copied this document's (rec) option; no human chose this item.

## Out of scope

- #2589 (the review verdict is trusted by an identity every agent session can obtain) - a
  separate problem: the bot is genuine but too many sessions hold its token. This spec only
  stops a *different* account passing as the bot.
- #2694 (`github-actions[bot]` issues refused) - unchanged; S1's list stays as is.
- Renaming the App or changing its slug.

## Follow-ups (tracked)

- D3 registration, if chosen: founder action, recorded in the implementing PR (FR-11).
- None other.
