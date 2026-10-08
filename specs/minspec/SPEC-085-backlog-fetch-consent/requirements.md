---
id: SPEC-085
type: requirements
status: implementing
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - DR-004/DR-050/DR-071 (the network-consent model) live here; this is an invariant-1 defect in a shipped panel
aspects: [backlog, consent, network, gh-cli, tier-0, readme, silent-gate]
relates_to: [DR-004, DR-050, DR-071, DR-066, DR-074, "#2329", "#2247", "#2246", "#645"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2; the shipped
# `/minspec-specify` guidance). Declaring after approval would edit the bytes the canonical
# hash covers and stale the sign-off. Both files are NEW and required unconditionally: FR-7
# (the consent pin) and FR-9 (the README inventory pin) hold under every DQ answer below.
implements: [packages/minspec/tests/backlog-consent.test.ts, packages/minspec/tests/readme-network-claims.test.ts]
# Modified, not owned. No spec lists backlog-view.ts or backlog.ts under `implements:` today
# (grepped across specs/*/SPEC-*/requirements.md); they stay unowned rather than being claimed
# by a defect spec. backlog.ts is touched only if #2247's fix has not merged first (DQ-5).
affects: [packages/minspec/src/views/backlog-view.ts, packages/minspec/src/lib/backlog.ts, packages/minspec/src/extension.ts, packages/minspec/package.json, packages/minspec/tests/backlog-view.test.ts, packages/minspec/tests/invariants.test.ts]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: in-progress
---

# SPEC-085: The Backlog panel contacts GitHub only when the user asks it to

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal spec-approval
> gate before any code changes. Each question carries an agent-recorded selection under
> **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-01-ratified-only-by-approval-of-this-spec)**;
> the human answers by approving this spec with those in place, or by changing them first.
> Every requirement below is written under each decision's recommended option, so approving
> the spec as it stands accepts those recommendations and leaves no question open. Choosing
> a different option changes only the requirements that decision names.

Materializes **[#2329](https://github.com/AIClarityAU/minspec/issues/2329)** - *"the
Backlog panel runs gh against GitHub without consent, and the README says it doesn't."* It
blocks the planned Marketplace preview release: constitution invariant 1 is broken in
shipped code, and the listing text states the opposite of what the code does.

**Id note.** The five ids after `SPEC-079` are claimed by open pull requests (checked
across `origin/main`, all 232 remote branches and every open pull request on 2026-10-01),
so this is `SPEC-085`. If the id collides at review time, renumber.

## One-Sentence Scope

Make the Backlog panel start no `gh` process until the user performs an explicit gesture
that names the GitHub contact, keep its four states (not loaded, loaded, empty, failed)
visibly distinct, and make every published statement about what MinSpec does on the network
true and pinned to the code.

## Context - what the code does today (read from `origin/main` 819300ea, not inferred)

### The fetch is unconditional

- **The view exists everywhere.** `packages/minspec/package.json:301-304` contributes
  `minspecBacklog` to the Explorer with no `when` clause, and
  `packages/minspec/src/extension.ts:143-145` creates the tree view on activation with no
  condition.
- **Rendering the view runs two `gh` commands.** VS Code calls `getChildren()` to draw the
  view. With no element that goes to `getRootNodes()`
  (`packages/minspec/src/views/backlog-view.ts:163-170`), which calls `isGhAvailable()`
  (`:199`) and then `fetchIssues()` (`:208`). `isGhAvailable` is `gh auth status`
  (`packages/minspec/src/lib/github.ts:11-21`); `fetchIssues` is `gh issue list`
  (`packages/minspec/src/lib/backlog.ts:199-215`). Nothing between `:183` and `:208` reads
  a setting, a stored answer, or a flag: there is no consent check to bypass because none
  exists.
- **Four ambient triggers re-run it.** The view becoming visible
  (`extension.ts:200-202`), the window regaining focus (`:205-214`), the workspace folder
  set changing (`:222-226`), and three unrelated commands that call
  `backlogTreeProvider.refresh()` as a side effect: `minspec.createEpic` (`:374-379`),
  `minspec.acceptEpic` (`:381-386`), `minspec.backfillEpics` (`:387-392`).
  `refresh()` clears the cache and fires a change event (`backlog-view.ts:142-147`), which
  makes VS Code call `getChildren()` again, which fetches. `refreshIfStale()` only rate
  limits this to once per 30 seconds (`:153-156`); the comment at `extension.ts:203-204`
  describes that as avoiding hammering `gh`, not as consent.
- **One trigger is a real gesture.** `minspec.refreshBacklog`
  (`extension.ts:406`, palette title at `package.json:212-213`, view-title button at
  `package.json:354-358`).
- **An empty result is never cached.** `getRootNodes()` returns the cache only when
  `cachedIssues.length > 0` (`backlog-view.ts:185`). A repository with zero open issues, or
  a failed fetch (next finding), therefore re-runs both `gh` commands on every re-render,
  not just on the triggers above.

### Why DR-050's read-only exemption does not cover this

[DR-050](../../../docs/decisions/DR-050.md) lets a **read-only config probe** run without a
prior prompt (Amendment 2026-07-01): a GET of the repository's own *settings*, "initiated
to decide whether there is anything to offer", and it names `gh auth status` as a
capability probe of the same class. Each further endpoint has needed its own amendment
(2026-07-16 for secret names; 2026-08-25, still proposed, for org memberships).
`gh issue list` has never been enumerated, reads content rather than configuration, and
runs on a recurring ambient trigger, which the same record forbids outright: *"Background
or autonomous network activity - every network-triggering action requires an in-context
user gesture."* [DR-071](../../../docs/decisions/DR-071.md) (standing consent through a
named setting) does not rescue it either: its condition 4 says standing consent *"never
authorises background or ambient traffic - nothing on a timer, on startup, or on
file-watch."* A refresh on window focus is ambient traffic.

So the issue's own suggested fix ("ask before the first fetch, remember the answer in a
setting") would, for the focus and visibility triggers, need a new decision record widening
DR-071. DQ-1 puts that choice to the human.

### A failed fetch reads as "no issues" (constitution invariant 2's shape)

`fetchIssues` wraps the `gh` call and the JSON parse in one `try` whose `catch` returns
`[]` (`backlog.ts:210-221`). Not installed, logged out, offline, rate limited, timed out
(15 s, `:213`) and unparsable output all become an empty list. Consequences:

- The panel shows **"No open issues found"** (`backlog-view.ts:212-214`) for an unreadable
  source.
- The panel's own failure branch is **unreachable**: the `catch` at
  `backlog-view.ts:217-221` ("Failed to fetch issues from GitHub") can only run if
  `fetchIssues` rejects, and it never does. The test that covers it
  (`packages/minspec/tests/backlog-view.test.ts:412-420`) passes only because it mocks
  `fetchIssues` to reject, a behaviour the real function cannot produce.
- The swallow is pinned as intended behaviour by
  `packages/minspec/tests/backlog-async.test.ts:241` and `:273`.
- The two commands that share the function report the same false zero
  (`packages/minspec/src/commands/backlog.ts:47-53` and `:167-175`).

This is already tracked as **[#2247](https://github.com/AIClarityAU/minspec/issues/2247)**
and a fix exists on the unmerged branch `agent/issue-2247` (commit `460166a8`: `fetchIssues`
rejects with a classified reason, and all three callers surface it). No pull request was
open for that branch when this spec was written. This spec does not re-specify that fix; it
depends on its outcome (FR-5, DQ-5), because "consent is off" must not be one more thing
that renders as an empty list.

### The published claim is false in five places

| Where | What it says | Why it is false |
|---|---|---|
| `packages/minspec/README.md:29` | "makes **zero network calls**" | True of sockets, misleading as a lead: the same page then lists `gh` commands |
| `packages/minspec/README.md:31-37` | "Three opt-in commands ... only when you trigger them ... Nothing else in the extension contacts a network." | The Backlog view fetches unprompted (above); six other modules also reach the network through the user's own tools (below) |
| `packages/minspec/README.md:226` | Same three-command claim, FAQ | Same |
| `packages/minspec/README.md:246` | Same three-command claim, Privacy | Same |
| `packages/minspec/media/walkthrough/welcome.md:27` | "No network calls." | Same; this file ships inside the extension |
| `sites/minspec.dev/index.html:1164` | Same three-command claim, site feature card | Same |

The README's three-command list (Park Topic, Quick Triage, Refresh Backlog) omits every
other network-reaching path the code has. The authoritative inventory is the
`CHILD_PROCESS_ALLOWLIST` in `packages/minspec/tests/invariants.test.ts:115-216`. Its
network-reaching entries, with the consent each already has:

| Module (allowlist line) | Network action | Consent today |
|---|---|---|
| `lib/github.ts` (`:123`) | `gh auth status` | Capability probe; autonomous under DR-050 Amendment 2026-07-01 |
| `lib/parking-lot.ts` (`:124`) | `gh issue create` | User runs Park Topic |
| `lib/backlog.ts` (`:125`) | `gh issue list`, `gh issue view/edit/comment` | **None for the panel's list** (this spec); the edit and comment calls run from Score WSJF and Quick Triage, which the user invokes |
| `lib/epic-backfill.ts` (`:127`) | `claude -p` | Prompted (`packages/minspec/src/commands/backfill-epics.ts:273`) |
| `lib/approve-push.ts` (`:147`) | `git push` | `minspec.pushOnApprove` prompt or setting (DR-071) |
| `lib/approval-recover.ts` (`:161`) | `git fetch`, `git push` | Same setting |
| `lib/ruleset-advisor.ts` (`:173`) | `gh api` GET probes; POST/PUT | Probes autonomous on init (DR-050 amendments); writes behind a click |
| `commands/push-docs-lane.ts` (`:196`) | `git fetch`, `git push` | Modal confirmation |
| `lib/approval-pr.ts` (`:207`) | `gh pr create` | Follows a consented push |

Score Issue (WSJF) is a fourth user-invoked `gh` command that the README's list of three
leaves out (`packages/minspec/src/commands/backlog.ts:24-48`).

## Functional Requirements

- **FR-1 - No `gh` process before a gesture.** From activation until the user performs a
  Backlog gesture (FR-2), the Backlog panel MUST start no child process at all: not
  `gh issue list`, and not the `gh auth status` probe either (DQ-2). This holds for first
  render, every re-render, the view becoming visible, window focus, a workspace folder
  change, and the three sibling commands that refresh the trees
  (`extension.ts:374-392`).

- **FR-2 - The gesture names the network action.** Exactly two things count as a Backlog
  gesture: running `minspec.refreshBacklog` (palette or view-title button), and activating
  the panel's own not-loaded row (FR-3), which runs the same command. The command's
  user-visible title or tooltip, and the not-loaded row's text, MUST say that the action
  contacts GitHub through the user's own `gh` CLI. A gesture authorises one fetch; it is
  not remembered (DQ-1).

- **FR-3 - "Not loaded" is its own visible state.** Before the first gesture in a session
  the panel MUST show a single row stating that the backlog has not been loaded, that
  loading it lists this repository's issues from GitHub using `gh`, and offering the
  action. It MUST NOT show an empty tree, "No open issues found", or a loading indicator.
  It is a row inside the view, not a toast or modal (constitution principles 2 and 4:
  no rubber-stamp prompts, no nagging).

- **FR-4 - Ambient triggers re-render, they never fetch and never discard.** Once a list
  has been loaded by a gesture, the visibility, focus, folder-change and sibling-command
  triggers MUST leave the loaded list in place and MAY re-render it from memory (epic
  grouping reads local files, so a re-render after `minspec.createEpic` is still useful).
  They MUST NOT clear the list, because today clearing is what causes the next render to
  fetch (`backlog-view.ts:142-147`, `:185`). A loaded list MUST show when it was loaded,
  so a stale list is not mistaken for a current one.

- **FR-5 - Four states, never conflated.** The panel MUST render these as different,
  recognisable rows: *not loaded* (FR-3); *loaded with N issues*; *loaded, zero open
  issues*; *could not load, with the reason* (covers `gh` missing, not authenticated,
  offline, rate limited, timed out, unparsable output). A fetch that fails MUST NOT be
  shown as zero issues, and a zero-issue result MUST be cached like any other result so
  it does not trigger a re-fetch on the next render. The "could not load" half is #2247's
  defect; see DQ-5 for how this spec consumes that fix rather than duplicating it.

- **FR-6 - The other Backlog commands stay gesture-only and stay honest.**
  `minspec.scoreWsjf` and `minspec.triageIssue` already run only when invoked. They MUST
  keep doing so, and after FR-5 they MUST report a failed fetch as a failure rather than
  "No open issues found" (`packages/minspec/src/commands/backlog.ts:50-52`, `:175`).

- **FR-7 - A pinning test for consent.** `packages/minspec/tests/backlog-consent.test.ts`
  MUST drive the real `BacklogTreeProvider` with the child-process boundary stubbed (not
  with `fetchIssues` and `isGhAvailable` mocked away, which is how
  `backlog-view.test.ts:412` came to cover an unreachable branch) and assert: zero spawned
  processes across construction, `getChildren()`, `refreshIfStale()` and the provider entry
  point the ambient triggers use; exactly the expected `gh` invocations after a gesture;
  and no further invocation when an ambient trigger follows a gesture. The test MUST fail
  against today's `origin/main`.

- **FR-8 - Every published network statement is rewritten from the code.** The five
  locations in the Context table MUST be corrected. The README's "What MinSpec Does on
  Your Network" section MUST list every network-reaching feature in the inventory above,
  each with what it contacts and what triggers it, and MUST distinguish the two things the
  extension does without a prompt (the `gh auth status` capability check and the
  repository-settings probes at setup, both under DR-050) from the things that need a
  gesture or a setting. The phrases "Three opt-in commands" and "Nothing else in the
  extension contacts a network" MUST go. The true and useful claims stay: the extension
  opens no socket itself, has no telemetry, no account and no backend. The FAQ answer,
  the Privacy section, the walkthrough page and the site card MUST agree with that
  section rather than restate a shorter, different claim.

- **FR-9 - A pinning test for the README.**
  `packages/minspec/tests/readme-network-claims.test.ts` MUST hold a single declared
  inventory of network-reaching modules (module path, user-facing feature name, trigger)
  and assert both directions: every `CHILD_PROCESS_ALLOWLIST` entry is classified as
  either local-only or network-reaching in that inventory, so adding a new spawning module
  without classifying it fails; and every network-reaching feature name appears in the
  README's network section. It MUST also fail if any of the five locations contains the
  retired phrases from FR-8. This test proves the README mentions each feature; it cannot
  prove a sentence is true, and the spec says so rather than overclaim (DQ-4).

- **FR-10 - The allowlist comment tells the truth about Backlog.** The comment block at
  `packages/minspec/tests/invariants.test.ts:109-114` groups `backlog` with local tool delegation and says
  nothing about consent. It MUST state that `lib/backlog.ts` reaches the network and is
  allowlisted on the consent clause of invariant 1, reachable only from a gesture, in the
  same form the `approve-push.ts` and `push-docs-lane.ts` entries already use.

## Acceptance Criteria

- [ ] Opening a workspace and showing the Explorer, with the Backlog view visible, starts
      no `gh` process. (FR-1, FR-7)
- [ ] Alt-tabbing away and back, toggling the view, adding a workspace folder, and running
      Create Epic, Accept Epic and Backfill Epics each start no `gh` process, before and
      after a list has been loaded. (FR-1, FR-4, FR-7)
- [ ] Before any gesture the panel shows one row that names GitHub and `gh` and offers to
      load; activating it loads the list. (FR-2, FR-3)
- [ ] The Refresh Backlog title or tooltip states that it contacts GitHub. (FR-2)
- [ ] After a load, an ambient trigger leaves the same issues on screen with a
      loaded-at marker. (FR-4)
- [ ] With `gh` failing (missing binary, non-zero exit, timeout, unparsable output), the
      panel shows a could-not-load row with a reason and never "No open issues found";
      Score WSJF and Quick Triage show an error rather than a false zero. (FR-5, FR-6)
- [ ] A repository with zero open issues shows the zero-issue row and does not fetch again
      on the next render. (FR-5)
- [ ] `backlog-consent.test.ts` exists, stubs at the child-process boundary, and is shown
      to fail on the pre-fix code. (FR-7)
- [ ] None of the five listed locations contains "Three opt-in commands" or "Nothing else
      in the extension contacts a network"; the README network section names every
      network-reaching feature in the inventory. (FR-8, FR-9)
- [ ] Adding a module to `CHILD_PROCESS_ALLOWLIST` without classifying it in the inventory
      fails `readme-network-claims.test.ts`. (FR-9)
- [ ] The `lib/backlog.ts` allowlist entry carries a consent-clause comment. (FR-10)

## Invariants (must not break)

- **INV-1 - Offline core, consent before network (constitution invariant 1, DR-004,
  DR-050).** No new socket, no `http`/`https`/`fetch`/`net` import, and no new entry in
  `CHILD_PROCESS_ALLOWLIST`. The fix removes network activity; it adds none.
- **INV-2 - No silent gate (constitution invariant 2, DR-066).** "Could not read" is never
  rendered as "read, and found nothing", and no new `catch` in this work returns a
  success-shaped value.
- **INV-3 - Blast radius (constitution invariant 3, DR-074).** No setting is written, and
  nothing is stored outside the workspace. Under the recommended DQ-1 there is no stored
  consent at all. If a stored consent is ever introduced it MUST NOT be grantable by a
  committed workspace file, for the reason `workspace-consent-override-gate.test.ts`
  records for `minspec.pushOnApprove`.
- **INV-4 - No nagging (constitution principles 2 and 4).** No modal and no toast is added.
  The only new UI is one row inside the view the user is already looking at.
- **INV-5 - Activation stays cheap (constitution constraint 3).** Activation does strictly
  less work than today: two fewer process spawns.

## Clarify selections (recorded by an agent 2026-10-01; ratified only by approval of this spec)

Each decision carries a recommendation and its cost. The requirements above assume the
recommended option in every case.

DQ-1 to DQ-5 each carry a **Recorded selection** line naming the option this document
already recommended. An agent session wrote those lines on 2026-10-01, and no human chose
them. This repository runs with `"autonomy": "act"` (`.minspec/config.json:58`), under which
an agent proceeds on a stated recommendation and leaves the options it did not take on
record (DR-086 §2 and §4), which is why the options stay below with their costs. Approving a
T3 spec is the second class on that section's stop list (`scripts/lib/autonomy.ts:68-70`),
so nothing here stands in for that approval: the lines propose, and approving this spec is
what ratifies them. An approval records a canonical hash that covers this body
(`packages/minspec/src/lib/approval.ts:4-8`) and reads as stale once the hash stops matching
(`resolveStatus`, `:483-490`), so an approval of this text covers these selections and
changing one afterwards voids it. When the lines were written no approval of this spec had
landed on `main` (`status: specifying`, `clarify: pending`). A question in this section with
no **Recorded selection** line is still open.

### DQ-1 - What happens to automatic refresh?

**Recorded selection: Option A,** gesture only, nothing remembered. Option B is not taken,
so the decision record that would widen DR-071 condition 4 is not written: "Why no new DR"
below makes one necessary only under that option.

- **Option A - gesture only, nothing remembered (rec).** The panel fetches only on Refresh
  Backlog or the not-loaded row. No setting, no stored answer, no new decision record.
  This is the only option consistent with DR-050 and DR-071 as they stand, and it makes
  the README's existing sentence ("only when you trigger them") true. *Cost:* the list no
  longer updates itself when you return to the window; it shows a loaded-at time and waits
  for you. This departs from the issue's suggested fix.
- **Option B - ask once, remember in a setting, then keep refreshing on focus.** The
  issue's suggestion. *Cost:* DR-071 condition 4 forbids standing consent for ambient
  traffic, so this needs a new decision record widening it before Plan, plus a setting
  that must be scoped so a committed workspace file cannot grant it (INV-3), plus tests
  for three stored states. It also keeps `gh` running on every return to the window, at most
  once per 30 seconds, for as long as the editor is in use.
- **Option C - prompt on first render each session.** *Cost:* a recurring prompt in every
  workspace, including ones with no GitHub remote. Rejected as nagging (INV-4).

### DQ-2 - Is `gh auth status` allowed before the gesture?

**Recorded selection: Option A,** no `gh auth status` and no other child process before the
gesture.

- **Option A - no; zero processes before the gesture (rec).** One property, trivially
  testable ("no child process"), and the README can say it in one sentence. *Cost:* a user
  whose `gh` is missing or logged out finds out only after clicking, from the
  could-not-load row.
- **Option B - keep the probe.** DR-050 Amendment 2026-07-01 permits `gh auth status` as an
  autonomous capability probe, so this is allowed. *Cost:* the panel still contacts GitHub
  in every workspace on every render to decide what to draw, and the README has to explain
  an exception for a panel the user never asked to load.

### DQ-3 - How far does the wording correction reach?

**Recorded selection: Option A,** all five locations, including the site source. The
selection covers the edit to `sites/minspec.dev/index.html` in this repository and not its
deployment, which stays the separate human act listed under "Out of Scope".

- **Option A - all five locations, including the site source (rec).** One false claim in
  five copies is fixed once. *Cost:* `sites/minspec.dev/index.html` changes in the repo
  but the live site changes only when someone deploys it, which is a separate, outward
  facing human act; until then the public site keeps the old sentence. The README and
  walkthrough ship with the extension build, so they are correct at publish.
- **Option B - README and walkthrough only.** *Cost:* the site keeps contradicting the
  listing, and the copies drift again.

This spec corrects false statements only. Re-positioning the network story ("air-gapped"
to data sovereignty) is [#645](https://github.com/AIClarityAU/minspec/issues/645) under
DR-054 and stays there; the cost of keeping them apart is that the README's network
section is edited twice.

### DQ-4 - How is the README kept true afterwards?

**Recorded selection: Option A,** the inventory test tied to the spawn allowlist (FR-9).

- **Option A - an inventory test tied to the spawn allowlist (rec).** FR-9. Adding a
  network-reaching module without updating the README fails the suite. *Cost:* it is a
  text-presence check, so it proves each feature is named, not that the surrounding
  sentence is accurate; a human still reads the section at review.
- **Option B - prose rule only.** *Cost:* this is exactly how the current false claim
  survived (the changelog entry at `packages/minspec/CHANGELOG.md:37` records the wording
  as "accurate"); constitution principle 8 says to enforce rather than trust.

### DQ-5 - Sequencing against the in-flight #2247 and #2246 fixes

**Recorded selection: Option A,** build this after #2247 merges and consume its result.
Option B is not taken, so the failure handling is not re-specified here.

Both touch `backlog.ts` and `backlog-view.ts`; both have a pushed branch and no open pull
request (`agent/issue-2247` at `460166a8`, `agent/issue-2246` at `93f967a7`).

- **Option A - build this after #2247 merges, and consume its result (rec).** FR-5's
  could-not-load state is then already present and this spec adds the not-loaded state and
  the gesture gate on top. If #2247 has not merged when Plan starts, Plan adopts that
  branch's commit rather than writing a second failure classifier. *Cost:* this spec waits
  on another change, and whichever of the three lands later resolves conflicts in the same
  two files.
- **Option B - re-specify and build the failure handling here.** *Cost:* two
  implementations of one fix racing to the same lines, which is the duplicate-work shape
  the backlog check exists to prevent.

## Why no new DR

The recommended options apply DR-050 (per-action consent through an in-context gesture) and
DR-071 (what standing consent may not cover) exactly as written, and remove behaviour
rather than add any. Under the reversibility filter (can it be undone in under a day) the change is a revertable diff to one view,
one wiring block and documentation. A decision record becomes necessary only if DQ-1
resolves to Option B, because that widens DR-071 condition 4; the spec must not proceed to
Plan on Option B without it.

## Out of Scope

- **Paging past 100 issues or showing a truncation notice.** That is #2246.
- **Multi-root Backlog** (#573) and any other Backlog feature work.
- **The mutating helpers** (`applyWsjfToIssue`, `transitionIssue`, `setPriority`,
  `backlog.ts:285-387`). They return `false` on failure and run only from user-invoked
  commands; their error reporting is not changed here.
- **Setup's `gh` probes** (`packages/minspec/src/commands/init.ts:869-876`). They are covered by DR-050's
  amendments; FR-8 only requires the README to mention them.
- **Re-positioning the network story** (#645, DR-054).
- **Deploying the site.** FR-8 edits the source; publishing it is a separate human act.
- **Hiding the Backlog view in workspaces without a GitHub remote.** With no fetch before
  a gesture the view is inert there; a `when` clause is a possible later refinement, not
  part of this defect.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 section 4).

- **Following the issue's suggested fix literally (a remembered consent setting).**
  Rejected as the default, kept as DQ-1 Option B: it collides with DR-071 condition 4, and
  the simpler design satisfies the issue's actual complaint.
- **Treating `gh issue list` as a DR-050 read-only probe and changing only the README.**
  Rejected: the exemption is for configuration probes enumerated one endpoint at a time,
  and the same record forbids background network activity.
- **Claiming `backlog-view.ts` and `backlog.ts` under `implements:`.** Rejected: a defect
  spec should not become the owner of a feature it did not specify; the two new test files
  are what this spec genuinely creates.
- **Asserting consent by mocking `fetchIssues`.** Rejected: mocking above the process
  boundary is how the existing suite came to cover an unreachable branch. FR-7 stubs the
  boundary itself.

## Test plan (for the Plan phase to place)

- **T0, before implementation:** `backlog-consent.test.ts` (FR-7) and
  `readme-network-claims.test.ts` (FR-9), each shown red on current code.
- **T2:** the four-state rendering (FR-5), the loaded-at marker (FR-4), and the two
  command error paths (FR-6).
- **Existing tests that change:** `backlog-view.test.ts:352` onward (root rendering now starts
  from not-loaded) and `backlog-async.test.ts:241`, `:273` (the swallow they pin goes away
  with #2247).

## Traceability

- **Issue:** [#2329](https://github.com/AIClarityAU/minspec/issues/2329).
- **Depends on:** [#2247](https://github.com/AIClarityAU/minspec/issues/2247) (failed
  fetch shown as a false zero), DQ-5.
- **Adjacent, not absorbed:** [#2246](https://github.com/AIClarityAU/minspec/issues/2246)
  (100-issue truncation), [#573](https://github.com/AIClarityAU/minspec/issues/573)
  (multi-root), [#645](https://github.com/AIClarityAU/minspec/issues/645) (network
  positioning).
- **Governing decisions:** [DR-004](../../../docs/decisions/DR-004.md) (tiered network
  consent), [DR-050](../../../docs/decisions/DR-050.md) (gh shelling on explicit consent,
  and the read-only probe exemption this does not fall under),
  [DR-071](../../../docs/decisions/DR-071.md) (standing consent and its condition 4),
  [DR-066](../../../docs/decisions/DR-066.md) (no silent gate),
  [DR-074](../../../docs/decisions/DR-074.md) (blast radius).
- **DR for this spec:** none, by design; see "Why no new DR" for the one condition that
  would require it.
