---
id: SPEC-185
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - guardrails a shared repo must carry (same epic as SPEC-033, whose governance check this extends)
aspects: [governance, auto-merge, rulesets, review-gate, gh-shell-out, consent, tier-0, no-silent-gate, blast-radius]
depends_on: [DR-050, DR-061]  # DR-050 is the gh-on-consent rule every read and write here rides; DR-061 is the auto-merge-keyed-on-ready-to-merge policy this offer makes portable
relates_to: [SPEC-033, SPEC-030, SPEC-024, SPEC-065, SPEC-071, DR-066, DR-071, DR-074, "#448", "#557", "#559", "#1782"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-185: Initialize offers auto-merge only together with a review gate that blocks it

**Triggered by:** [#448](https://github.com/AIClarityAU/minspec/issues/448) - "init offers to set up
auto-merge + required-review rule on repo".
**Rests on:** [DR-050](../../../docs/decisions/DR-050.md) (shelling the user's own `gh` on consent
is not a network breach of the core) and [DR-061](../../../docs/decisions/DR-061.md) (native
GitHub auto-merge keyed on the `ready-to-merge` required check).
**Extends, does not replace:** [SPEC-033](../SPEC-033-repo-governance-provisioning/requirements.md)
FR-2 and FR-3 (the governance check and the ruleset offer).

## In plain terms

Turning on GitHub auto-merge is only safe when something the repo itself enforces stops a pull
request from merging before it has been reviewed. Today MinSpec can offer to add required checks
to a ruleset, but it never looks at the repo's auto-merge switch, and it never relates the two.
This spec makes **MinSpec: Initialize SDD Structure** read both, and when the review gate is
missing, offer one action that wires the gate first, proves it is enforced, and only then turns
auto-merge on. If auto-merge is already on with no gate, it says so loudly. Nothing is written
without a click. Cost: one more repo-settings write in the core, which needs repo-admin rights the
user's `gh` may not have. Left out: the repo variable that lets agents arm auto-merge on their own
pull requests (DR-061's `autoMerge.native`). Riskiest assumption: that the review gate should be a
required status check, not a required human approval (Clarify D-1).

---

## Context

#448 observed (on the pre-rename `harvest316/minspec`; not re-measured by this spec) a
repo with `allow_auto_merge: false` and a default-branch ruleset requiring only `lint` + `test`,
with no review requirement. Flipping auto-merge on in that state would merge every pull request
the moment CI went green: nothing structural enforces the independent review.

### What exists - do not rebuild

| Piece | Where | State |
|---|---|---|
| `gh` readiness probe (installed + authenticated) | `packages/minspec/src/lib/ruleset-advisor.ts` `isGhReady` (:185) | built |
| Read the default-branch ruleset's required check contexts | `ruleset-advisor.ts` `listRequiredCheckContexts` (:663) | built - **with the two detection gaps below** |
| Decide which checks the repo can actually produce (no #559 deadlock) | `ruleset-advisor.ts` `resolveTieredRequiredChecks` (:419) - adds `ai-review` and `ready-to-merge` only when the workflow is scaffolded **and** the reviewer is configured | built |
| Reviewer-configured probe (secret NAMES only) | `ruleset-advisor.ts` `probeReviewerConfigured` (:768) | built |
| Create a ruleset / union-add missing checks, consent-gated | `ruleset-advisor.ts` `createRequiredChecksRuleset` (:523), `updateRulesetRequiredChecks` | built |
| The post-init offer this spec extends | `packages/minspec/src/commands/init.ts` `offerRulesetAdvisory` (:894) | built |
| GitHub's reason on a failed `gh api` write | `ruleset-advisor.ts` `githubReason` (:589) | built |
| The auto-merge policy in this repo | DR-061 §1: `allow_auto_merge = true`, merge fires when every required check passes, including `ready-to-merge` | accepted, live here |
| No human approval count on `main` here | SPEC-065 "What is already true": `required_approving_review_count` is `null`; the gate is six required checks | measured 2026-08-19 |

Nothing in `packages/` reads or writes `allow_auto_merge` today (a repo-wide grep for
`allow_auto_merge` / `allowAutoMerge` hits only DR-061 and two specs).

### What the review gate is, in MinSpec's own model

MinSpec does not gate merges on a GitHub "approving review". It gates them on two **required
status checks** that the scaffolded reviewer workflows post: `ai-review` (the panel verdict) and
`ready-to-merge` (green only on a provenance-verified `ai-review:pass`). DR-061 §1 keys auto-merge
on exactly these. So "the required-review rule" in #448 resolves, by default, to *"the
default-branch ruleset, actively enforced, requires `ready-to-merge` and `ai-review`, and the
reviewer is configured so those checks can actually be produced."*

Two facts shape the options, both **believed from GitHub's documented behaviour, not measured by
this spec**:

- A ruleset has no rule type that requires a *label*. A label becomes enforceable only by a
  workflow turning it into a status check, which is what `ready-to-merge.yml` already does. So
  #448's "require an `ai-review` label" option is the `ready-to-merge` check.
- GitHub does not let a pull request's author approve their own pull request. A
  `required_approving_review_count >= 1` rule on a solo repo therefore blocks every pull request
  the owner opens, unless a bypass actor is configured - and a bypass is exactly the hole #448
  set out to close.

### Two detection gaps in the code this spec reuses

Observed by reading the code; neither has a test that pins it either way.

1. **A ruleset in `evaluate` mode counts as a gate.** `listRequiredCheckContexts` skips only
   `enforcement === 'disabled'` (`ruleset-advisor.ts:680`; the same test at `:238` in
   `hasRequiredChecksRuleset`). GitHub's `evaluate` mode reports violations but blocks nothing. A
   repo whose only review ruleset is in `evaluate` mode would read as gated, and auto-merge would
   fire before review.
2. **Any branch-targeting ruleset counts as guarding the default branch.**
   `rulesetGuardsDefaultBranchChecks` accepts any `refs/heads/*` include (`:277-286`) and never
   reads `exclude`. A ruleset that targets `refs/heads/release/*`, or that excludes the default
   branch, reads as guarding it.

Both are harmless for the existing "add missing checks" offer (worst case: a missed offer). They
are not harmless here, because this spec turns "the gate is present" into "turn auto-merge on".
A detector that over-reports the gate is a silent gate in the sense of constitution invariant 2.

## Scope

### In scope

- **FR-1 - Read the pairing state (read-only, autonomous).** On init, after `gh` is ready and the
  repo resolves (the existing `offerRulesetAdvisory` preconditions), read:
  - (a) `allow_auto_merge` from `GET repos/{owner}/{repo}`;
  - (b) the **effective, enforced** rules on the default branch, from
    `GET repos/{owner}/{repo}/rules/branches/{default_branch}`, which answers for the branch
    itself instead of re-deriving targeting from each ruleset's include list (closes gap 2);
  - (c) classic branch protection, `GET repos/{owner}/{repo}/branches/{default_branch}/protection`,
    where a 404 means "no classic protection", never "unprotected" on its own;
  - (d) whether the reviewer is configured, via the existing `probeReviewerConfigured`.
  These reads egress nothing but the request itself and change nothing. They join the DR-050
  autonomous read-only-probe class only once FR-9's amendment enumerates them.

- **FR-2 - Classify into exactly one state.** A pure, offline function takes FR-1's results and
  returns one of:

  | State | Review gate | `allow_auto_merge` | What init does |
  |---|---|---|---|
  | `paired` | wired | on | silent |
  | `gated-manual` | wired | off | silent at init (Clarify D-4) |
  | `unsafe` | missing | **on** | warning offer (FR-4) |
  | `ungated` | missing | off | setup offer (FR-3) |
  | `unknown` | any read failed or unparseable | any | visible "could not check" line, no offer (FR-6) |

  **Wired** means: an **active** (not `evaluate`, not `disabled`) rule on the default branch
  requires every context in the review-gate set (Clarify D-1; default `ready-to-merge` +
  `ai-review`), **and** the reviewer is configured. A required context the repo cannot produce is
  not wired - it is the #559 permanent-pending state, which blocks every merge and belongs to
  SPEC-033; this spec reports it as `ungated` with the SPEC-033 FR-4 prerequisite checklist
  instead of a write offer.

- **FR-3 - The setup offer (`ungated`).** A non-modal offer:
  *"{repo} has no enforced review gate. Set up auto-merge behind one? MinSpec will require
  {contexts} on {branch} first, then turn auto-merge on."* Actions: set it up · not now · learn
  more. On the click, in this order, stopping at the first failure:
  1. Wire the gate: union-add the missing contexts to the existing active ruleset
     (`updateRulesetRequiredChecks`, never removing a context), or create one
     (`createRequiredChecksRuleset`) when none exists. Only an `active` ruleset is created.
  2. **Re-read** the effective branch rules (FR-1 b) and confirm the gate is wired. A 2xx on the
     write is not the confirmation; the re-read is.
  3. Only then `PATCH repos/{owner}/{repo}` with `allow_auto_merge=true`.
  4. Re-read `allow_auto_merge` and report the final state, from the re-read, in one line.
  If the reviewer is not configured, the offer is not a write offer: it shows the SPEC-033 FR-4
  prerequisite checklist as unchecked items and says auto-merge will be offered once those are
  done.

- **FR-4 - The unsafe warning (`unsafe`).** Auto-merge is on and nothing enforces review. A
  warning-level, non-modal message names that state plainly and offers, in this order:
  wire the gate (FR-3 steps 1-2, without step 3, since auto-merge is already on) · turn auto-merge
  off (`PATCH allow_auto_merge=false`, then re-read) · learn more. Not now is always available. If
  the reviewer is not configured, wiring is not offered - only turning auto-merge off.

- **FR-5 - Idempotent and quiet when done.** `paired` and `gated-manual` produce no message.
  Running init again after a successful setup produces no message and no write.

- **FR-6 - Fail visibly, never half-way.** Every failure path ends in a single visible line that
  names what was and was not changed, with GitHub's own reason (`githubReason`) where there is
  one. Specifically:
  - a read failure ⇒ state `unknown`, one "could not check auto-merge safety on {repo}: {reason}"
    line, no offer, no write;
  - a gate-write or gate re-read failure ⇒ auto-merge is **not** touched;
  - an auto-merge write failure after a successful gate write ⇒ report "gate wired, auto-merge
    still off: {reason}" (the safe half landed, which is the intended order);
  - a missing admin permission ⇒ the same lines, naming the permission.
  `gh` absent, unauthenticated, or no GitHub remote ⇒ this check adds nothing beyond what
  `offerRulesetAdvisory` already shows in those cases (it shows a docs link today); it does not
  add a second message.

- **FR-7 - One offer, not two.** When the ruleset offer in `offerRulesetAdvisory` and this
  offer would both fire, the user sees **one** message. Whether that is a merged message or this
  one replacing the other is a Plan decision, but two consecutive toasts about the same ruleset
  is not acceptable.

- **FR-8 - Standalone entry.** The same check and offers are reachable after init from the
  governance command SPEC-033 FR-2 specifies (*MinSpec: Check Repo Governance*), not from a new
  palette entry of their own (Clarify D-3).

- **FR-9 - Record the new reads in DR-050 before code ships.** Amend DR-050 to enumerate the
  three new `GET`s (FR-1 a-c) as autonomous read-only config probes and the
  `PATCH allow_auto_merge` as a consent-gated mutation, following the 2026-07-01 and 2026-07-16
  amendments' pattern. The Plan phase owns writing it; implementation does not start without it.

### Out of scope

- **`autoMerge.native` in `.minspec/config.json`** (DR-061 §1, SPEC-030) - whether MinSpec's own
  dispatch arms `gh pr merge --auto` on the pull requests it opens. This spec only turns on the
  repo's ability to auto-merge (Clarify D-5).
- **Fixing the reviewer itself, or installing its secrets or App** - SPEC-033 FR-4 surfaces those
  as an unchecked checklist; this spec reuses that list, never marks it done.
- **Org-level rulesets.** MinSpec never writes `orgs/{org}/rulesets`. An org ruleset that already
  wires the gate is read (FR-1 b returns effective rules from every source) and counts.
- **Writing classic branch protection.** Read only (FR-1 c); every write goes to a repo ruleset.
- **Drift after setup** (someone later removes the required check) - SPEC-071's drift witness.
- **Bypass actors and merge-method rules** - not read, not written (SPEC-071 also leaves them out).
- **Fixing the two detection gaps in the existing ruleset offer itself.** FR-1 b avoids them for
  this feature. Whether the existing offer should switch to the same read is a separate change
  (Follow-ups).

## Invariants

- **INV-1 - Gate before switch, always.** No code path sets `allow_auto_merge=true` unless a
  re-read in the same run has just shown the gate wired. Pinned by a test that makes every gate
  step fail in turn and asserts no auto-merge write was issued.
- **INV-2 - No write without a click.** Every `POST`, `PUT` and `PATCH` issued by this feature
  follows a user's explicit click on the offer naming that write, in that run (DR-050 condition 2;
  DR-071 standing consent does **not** apply, because the target and effect differ per repo).
- **INV-3 - Enforced means `active`.** A rule from a ruleset in `evaluate` or `disabled` mode never
  counts toward "wired". Pinned by a fixture whose only review ruleset is in `evaluate` mode, which
  must classify as `ungated` or `unsafe`, never `paired`.
- **INV-4 - Never claim a state that was not read** (constitution invariant 2; never-wrong). The
  final message is built from the re-reads, not from the write's exit code. `unknown` is a state,
  not a default to `paired`.
- **INV-5 - Never remove a protection.** Gate writes only add contexts or create a ruleset; no
  write removes a context, lowers enforcement, deletes a ruleset or adds a bypass actor. The one
  write that reduces capability - turning auto-merge **off** in FR-4 - is the safe direction.
- **INV-6 - Blast radius is the opted-in repo** (constitution invariant 3, DR-074). Every read and
  write targets only the repo resolved from the remote of the folder being initialized, which by
  definition carries `.minspec/`. No org, no other repo, no user-level setting.
- **INV-7 - Offline core stays offline** (constitution invariant 1, DR-050). All network effect is
  the user's own `gh`; MinSpec opens no socket and holds no token. The classifier (FR-2) is pure
  and runs with no `gh` at all.
- **INV-8 - No deadlock is ever created.** The gate write never requires a context the repo cannot
  produce (reuses `resolveTieredRequiredChecks`), so following the offer never leaves every pull
  request blocked forever (#559).

## Acceptance criteria

1. **`ungated`, reviewer configured.** Fixture: active ruleset requiring `lint` + `test` only,
   reviewer secrets present, `allow_auto_merge=false`. Init shows the setup offer once. Clicking it
   issues, in order: the ruleset union-add, a rules re-read, the `PATCH allow_auto_merge=true`, an
   `allow_auto_merge` re-read; the final line reports `paired`. [FR-2, FR-3, INV-1]
2. **Order under failure.** Same fixture with the ruleset write failing (403) ⇒ no `PATCH` is
   issued, the line names the 403 reason and says auto-merge was not changed. Repeat with the
   write succeeding but the re-read still missing the context ⇒ same: no `PATCH`. [INV-1, FR-6]
3. **`unsafe`.** `allow_auto_merge=true`, no review context required ⇒ a warning-level message
   offering wire-the-gate and turn-auto-merge-off. Choosing off issues one `PATCH
   allow_auto_merge=false` and reports the re-read. With the reviewer unconfigured, only the
   off option is offered. [FR-4]
4. **`evaluate` is not enforcement.** Only review ruleset in `evaluate` mode, `allow_auto_merge=true`
   ⇒ classified `unsafe`. [INV-3]
5. **Ruleset for another branch.** Only review ruleset targets `refs/heads/release/*` ⇒ the default
   branch reads ungated. [FR-1 b]
6. **Reviewer not configured.** `ungated`, reviewer secrets absent ⇒ no write is offered; the
   SPEC-033 FR-4 checklist shows as unchecked items. [FR-3, INV-8]
7. **Silent when done.** `paired` and `gated-manual` fixtures ⇒ no message, no write. Running AC-1
   twice ⇒ the second run is silent and issues no write. [FR-5]
8. **Read failure.** The repo `GET` returns non-zero ⇒ one "could not check" line, state `unknown`,
   no offer. [FR-6, INV-4]
9. **No `gh` / no remote / not a git repo.** No message from this check beyond the existing
   ruleset docs link; zero `gh api` calls in the not-a-repo case. [FR-6, INV-7]
10. **One message.** A fixture where both the existing ruleset offer and this offer qualify shows
    exactly one message. [FR-7]
11. **Every test runs offline** through the injected `CommandRunner`; no test touches the network.
    [INV-7]

## Decisions needed (Clarify)

- **D-1 - What counts as the review gate?**
  - `a` **(rec)** Required status checks `ready-to-merge` + `ai-review`, as DR-061 already uses
    here. Works on a solo repo, needs no human approver, and is what this repo runs. Cost: it is
    only as strong as the reviewer, and a repo whose reviewer is not configured cannot be offered
    auto-merge at all (FR-3 falls back to the checklist).
  - `b` A `pull_request` rule with `required_approving_review_count >= 1`. Standard GitHub, needs
    no MinSpec reviewer. Cost: on a solo repo it blocks every pull request the owner opens (an
    author cannot approve their own), which is the default MinSpec user (DR-075/DR-076 solo mode).
  - `c` Either one counts as wired; MinSpec writes `a` by default. Cost: one more branch in the
    classifier, and an approval rule with a bypass actor would read as wired unless bypass actors
    are also read - which SPEC-071 deliberately left out.
  A choice here is costly to reverse once adopters have rulesets written to the chosen shape, so
  the answer gets a DR when Clarify records it.

- **D-2 - Core, or the Execute extension?** #448 asks whether the write belongs in
  `aiclarity.agent-execute`.
  - `a` **(rec)** Core, extending `ruleset-advisor.ts`. DR-050 already places consent-gated
    ruleset writes in the core, and `createRequiredChecksRuleset` lives there today. Cost: the
    core gains one more kind of repo-settings write (`PATCH repos/{owner}/{repo}`), on a repo-admin
    permission.
  - `b` Execute extension. Keeps every repo-settings write out of the Tier-0 package. Cost: the
    existing ruleset write would then sit on the other side of the boundary from its pair, or move
    too; and the Execute extension does not exist as a package yet (DR-015).

- **D-3 - Standalone command?**
  - `a` **(rec)** No new palette entry; ride SPEC-033 FR-2's *MinSpec: Check Repo Governance*
    (FR-8). Cost: until that command is built (there is none in `packages/minspec/package.json`
    today), the only way to re-run the check is re-running init.
  - `b` A dedicated *MinSpec: Check Merge Gate* command now. Cost: a second governance entry that
    SPEC-033's command would later duplicate.

- **D-4 - Offer auto-merge when the gate is already wired but auto-merge is off (`gated-manual`)?**
  #448 says the offer surfaces only when the gate is missing.
  - `a` **(rec)** Silent at init; the standalone check (FR-8) lists it as "auto-merge available,
    off". Cost: a user who wants auto-merge has to look for it.
  - `b` Offer it at init too. Cost: nudges every gated repo toward auto-merge, which is a policy
    choice MinSpec should not push.

- **D-5 - Should the setup also turn on `autoMerge.native` in `.minspec/config.json`?**
  - `a` **(rec)** No. The repo switch lets people use `--auto`; whether MinSpec's own dispatch arms
    it on every pull request is DR-061's separate per-project policy, default off. Cost: a user who
    expected agents' pull requests to merge themselves needs a second step.
  - `b` Yes, in the same click. Cost: one click silently changes what the agent pipeline does,
    which is a second consent folded into the first.

- **D-6 - New spec, or fold into SPEC-033?** SPEC-033 FR-2/FR-3 covers the governance check and
  the ruleset offer but not `allow_auto_merge`.
  - `a` **(rec)** Keep this separate spec. SPEC-033 is `implementing`, reopened, with three
    corrections pending re-approval; adding FRs widens it further. Cost: two specs touch
    `ruleset-advisor.ts` and `init.ts`, so the Plan of whichever is second must check for overlap.
  - `b` Fold FR-1 to FR-9 into SPEC-033 and close this one. Cost: SPEC-033's re-approval grows.

## Follow-ups (tracked - DR-023)

- **DR-050 amendment** for the three reads and one write - FR-9, owned by this spec's Plan phase.
- **A DR for D-1's answer** once Clarify records it - owned by this spec's Clarify phase.
- **The existing ruleset offer's two detection gaps** (`evaluate` counted, default-branch targeting
  over-matched; `ruleset-advisor.ts:238`, `:680`, `:277-286`) affect `offerRulesetAdvisory` today,
  independent of this spec. ➡️ Needs its own issue; this dispatch could not file one (no `gh`
  access), so it is recorded here and in the PR summary for the human to file.
