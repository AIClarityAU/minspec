---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a pin is only safe while someone bumps it under review
aspects: [supply-chain, ci, pins, review-gate, no-silent-gate, blast-radius, dev-infra]
depends_on: [DR-005]  # DR-005 (pre-publish supply-chain gate) is where the "bumping the pin is a manual, reviewed step" rule and the four-surface bumblebee drift test come from
relates_to: [DR-061, DR-103, DR-097, "#658", "#627", "#850", "#866", "#1506", "#1867"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Pinned tool dependencies are checked for newer upstream versions on a schedule and bumped only through a reviewed pull request

Triggered by: #658 (recurring pinned-dependency update task). Design rests on DR-005
(Pre-Publish Supply-Chain Inventory Gate) - specifically its rule that "bumping the pin is a
manual, reviewed step - not automatic" - and on the merge-hold facts recorded in DR-061
(native auto-merge on `ai-review:pass`) and DR-103 (the App holds no `workflows` permission).

> **Specify phase only.** Nothing here is built. Every "the checker does X" below is a
> requirement, not a description of existing code.

## In plain terms

The repo pins the tools its CI and scripts run - the bumblebee scanner, the Claude Code CLI
the AI reviewer uses, GitHub Actions - so an upstream compromise cannot slip in silently. But
a pin nobody bumps goes stale: old scanner, missed fixes, an AI reviewer two versions behind.
This spec adds a scheduled check that, for every pin, looks upstream for something newer,
and when there is, opens one pull request per pin with the bump and the upstream changelog
link. Nothing merges by itself: every bump waits for a human, and the security-sensitive ones
(the scanner, anything running with a write token) also wait for a security review. It also
tidies the GitHub Actions pins, which today mix full commit SHAs and moving `@v4`/`@v5` tags,
sometimes for the same action.

Cost: a few pull requests a month to read and merge by hand, and the checker itself is one
more scheduled job that can break - and when it breaks it must say so, not go quiet.
Left out: npm `dependencies`/`devDependencies` (already pinned by `package-lock.json` and
covered by `npm audit` per DR-005), and anything in an adopter's repo.

## Current state (audited 2026-10-16 against `5f792386`, not the 2026-07-12 audit in #658)

The issue's audit has partly rotted; the spec is written against what is on the branch base
now. Each line cites the file it was read from.

| Pin | Where | State now |
|---|---|---|
| bumblebee scanner (`cmd/bumblebee`) | `scripts/check-supply-chain.sh:39`, `scripts/fetch-bumblebee-catalogs.sh`, `.github/workflows/ci.yml:345`, `.github/workflows/supply-chain-daily.yml:36` | Pinned to main SHA `4a02b80…` (DR-005 2026-07-26 amendment), **not** `v0.1.2` as #658 says. Four surfaces kept equal by `packages/minspec/tests/fetch-bumblebee-catalogs.test.ts`. DR-005 says to revert to a `vX` tag once upstream releases one that reads catalog schema 0.2.0. |
| Claude Code CLI | `.github/workflows/ai-review.yml:301` (`npm install -g @anthropic-ai/claude-code@2.1.201`) | Exact-version pin, still `2.1.201` - stale per #658. |
| Go toolchain | `.github/workflows/ci.yml:356`, `.github/workflows/supply-chain-daily.yml:50` (`go-version: 'stable'`) | **Floating**, not pinned. The hardcoded `GO_BIN` path #658 cites is gone: `check-supply-chain.sh` now resolves a toolchain (`resolve_go_bin`, #1506/#1867). |
| GitHub Actions | `.github/workflows/*.yml` | Mixed. SHA-pinned: `actions/create-github-app-token` (3), `actions/checkout` (4, at **two different** SHAs), `actions/setup-node` (2). Moving tag: `actions/checkout@v5` (12), `actions/setup-node@v4` (8), `actions/upload-artifact@v4` (3), `actions/setup-go@v5` (2), `actions/github-script@v7` (1), `JamesIves/github-pages-deploy-action@v4` (1). |

(Counts are from `grep -rhoE "uses: [^ ]+" .github/workflows | sort | uniq -c` on that commit;
the plan must re-run it, because pins move.)

## Constraints the design must work inside (observed, not chosen here)

- **C1 - The App cannot push workflow files.** DR-103:287-289: the App's `workflows`
  permission was removed on 2026-09-11, so GitHub refuses an App push that changes
  `.github/workflows/**`. Three of the four pin families above live, wholly or partly, in
  workflow files. A checker that runs as the App and edits workflow files will fail on push.
- **C2 - Machinery PRs already need the founder.** A PR touching `.github/**` or `scripts/**`
  gets `needs-human-review` + `machinery-review-required`, and `ready-to-merge` stays red, so
  merging is a human `--admin` act (DR-061, `ai-review.yml`). Every bump PR in scope touches
  one of those paths. That is the "requires review before merge" #658 asks for, today - but
  it holds by **path**, not by the PR being a bump (see FR-6).
- **C3 - Dev-time only.** This is CI/repo infrastructure for this monorepo. It is not shipped
  in the `.vsix`, not scaffolded into adopters, and adds nothing to the extension's runtime.

## Functional requirements

### Inventory

- **FR-1 - One machine-readable pin inventory.** Every pinned executable tool dependency in
  scope is declared once, in a single inventory file, with: a stable name; the upstream source
  to query (git repo tags / npm package / Actions repo); the pin form allowed (`tag`, `sha`,
  `exact-version`); the current pinned value; every file surface where the value appears; and
  a `security` class (`sensitive` | `standard`). The inventory's path and format are a Plan
  decision; it must not live under `.github/workflows/` (C1).
- **FR-2 - Drift gate across surfaces, generalised.** A test asserts, for every inventory
  entry, that each listed surface carries exactly the inventory's value, and that no
  in-scope pin exists on disk without an inventory entry (an unlisted `uses:` or an
  unlisted `npm install -g …@` in a workflow fails the test, naming file:line). This
  generalises the bumblebee-only four-surface test in `fetch-bumblebee-catalogs.test.ts`
  rather than adding a parallel one; that test's existing assertions keep passing.
- **FR-3 - Allowed pin forms are enforced.** The drift test rejects a moving ref - a branch
  name, `@latest`, `'stable'`, a bare major tag like `@v4` - for any entry whose allowed form
  is `sha` or `exact-version`. Whether bare-major Actions tags and `go-version: 'stable'` stay
  permitted is Clarify **D3**/**D4**.

### Scheduled check

- **FR-4 - Scheduled upstream check.** A scheduled job (cadence: Clarify **D2**), also
  runnable on demand, reads the inventory and, per entry, queries the upstream source for
  the newest candidate newer than the pin. For a `sha`-form entry pinned to a branch commit
  (bumblebee today), the candidate is a **released tag** that satisfies the entry's stated
  revert condition (DR-005: "reads 0.2.0"), not a newer branch SHA - unless Clarify **D5**
  says otherwise.
- **FR-5 - One PR (or one issue) per pin, idempotent.** For each entry with a candidate, the
  job opens one change proposal bumping every surface of that entry together (so FR-2 stays
  green on the proposal), titled with the pin name, old value and new value, and whose body
  carries the upstream release/changelog link and the candidate's publish date. A re-run while
  a proposal for the same entry is open updates that proposal instead of opening a second.
  The proposal channel - a PR, or an issue carrying the exact diff for a human to push - is
  Clarify **D1**, forced by C1.
- **FR-6 - Never auto-merge, by property not by path.** A bump proposal is never auto-merge
  eligible. The hold must not rest only on the path coincidence in C2: the proposal carries
  an explicit marker (e.g. a `pin-bump` label) that the merge gate treats as a human hold,
  so a future pin that lives outside `.github/`/`scripts/` (say an exact npm pin in a
  `package.json`) is still held.
- **FR-7 - Security review gate for `sensitive` entries.** A proposal for a `security:
  sensitive` entry (at minimum: the bumblebee scanner and osvcatalog; any action or CLI that
  runs in a job holding a write-scoped token or a secret) additionally carries a
  `needs-security-review` marker and links the bumblebee security-review issue referenced in
  #658, and is not mergeable until that marker is cleared by a human.
- **FR-8 - Release-age cooldown.** A candidate younger than a minimum age (Clarify **D6**) is
  not proposed yet; the job reports it as "candidate held for cooldown until <date>". This is
  the defence against a hijacked-publisher release being bumped in within hours of upload.
- **FR-9 - Fails visibly (constitution invariant 2).** If the job cannot query an upstream,
  cannot parse the inventory, or cannot open/update a proposal, the run ends red and names
  the entry and the failing step. No `|| true` on any step whose outcome decides whether a
  proposal is opened. A per-entry failure must not stop the other entries from being checked,
  and must still turn the overall run red. "No newer version" and "could not check" are
  distinct outcomes in the run summary.
- **FR-10 - Independent witness that the job is alive.** A job that silently stops being
  scheduled (disabled workflow, broken cron, revoked token) produces no red run at all. A
  second signal - e.g. the drift test or the daily supply-chain job asserting the inventory's
  `last_checked` stamp is younger than N days - turns red when the checker has not run.
  Mechanism is a Plan decision; the requirement is that the checker's own silence is caught
  by something that is not the checker.

### One-off normalisation (part of this spec, ships before the scheduled job)

- **FR-11 - Normalise GitHub Actions pins.** Every `uses:` reference in
  `.github/workflows/**` is rewritten to the form Clarify **D3** chooses, with a trailing
  `# vX.Y.Z` comment on SHA pins so a reader and the checker can see the human version. The
  same action is pinned to the same value in every workflow (today `actions/checkout` sits at
  `@v5` and two different SHAs). This edit is a founder push (C1).
- **FR-12 - Bring the stale Claude Code CLI pin current** as the first bump, through the same
  reviewed path the checker will use, so the path is exercised once by hand before it is
  automated.

## Acceptance criteria

- **AC-1** - The inventory lists every pin in the Current-state table (or the Plan's
  re-audited version of it); deleting any one surface's value or adding an unlisted `uses:`
  makes the drift test fail naming file:line (FR-1, FR-2).
- **AC-2** - With a `uses: actions/checkout@v5` reintroduced into a workflow after FR-11, the
  drift test fails (FR-3, under D3 = SHA).
- **AC-3** - Given a fixture upstream with a newer tag older than the cooldown, one run opens
  exactly one proposal bumping every surface of that entry; a second run opens none and
  updates the first (FR-5).
- **AC-4** - Given a fixture upstream whose newest tag is younger than the cooldown, no
  proposal is opened and the run summary names the held candidate and its release date (FR-8).
- **AC-5** - A bump proposal for a `sensitive` entry carries the hold marker and the
  security-review marker, and the merge gate refuses it while either is present, including
  when the changed file is outside `.github/`/`scripts/` (FR-6, FR-7). The test must vary the
  path - a fixture whose only changed path is under `.github/` would pass vacuously via C2.
- **AC-6** - Given one unreachable upstream among three entries, the other two are still
  checked and the run ends red naming the unreachable one (FR-9).
- **AC-7** - With the checker not run for longer than the staleness window, the independent
  witness goes red (FR-10).
- **AC-8** - The existing `fetch-bumblebee-catalogs.test.ts` assertions still pass.

## Invariants this change must not break

- **Constitution invariant 1 (offline core).** The checker queries upstream registries; it
  runs only in this repo's CI, never in the extension, and adds no network call to anything
  shipped (C3).
- **Constitution invariant 2 (no silent gate).** FR-9 and FR-10 exist for this. The drift
  test is a required check and fails closed on an unparseable inventory.
- **Constitution invariant 3 (blast radius).** Nothing here is scaffolded into adopters or
  added to templates; every file touched is this repo's own `.github/`, `scripts/` or test
  tree.
- **DR-005: no floating executed binary in a token-scoped job (#850).** The checker proposes
  pins; it never runs a candidate version itself, and never writes a moving ref.
- **DR-005: gate script stays network-free.** `check-supply-chain.sh` gains no upstream query;
  the check lives in the separate scheduled job.
- **No auto-merge of a version change** (#658, DR-005 "manual, reviewed step").
- **The App's `workflows` permission stays removed** (DR-103, founder decision 2026-09-11).
  Any option under D1 that would need it re-granted is out.

## Decisions needed (Clarify)

- **D1 - How does a bump to a workflow file get proposed, given the App cannot push one
  (C1)?**
  - `a` **Dependabot for the `github-actions` ecosystem + the custom checker for the rest
    (rec).** Dependabot is GitHub-native, already able to edit workflow files without our App
    holding `workflows`, natively writes `@<sha> # vX.Y.Z` pins, and supports a cooldown. The
    custom checker covers what Dependabot cannot parse: the Go `@<ref>` install in scripts,
    `npm install -g …@x` in a `run:` line, and the bumblebee revert-to-tag rule. *Cost:* two
    producers instead of one, `dependabot[bot]` becomes a PR author on this repo (DR-072
    deliberately does not trust it for verdicts, which stays true), and FR-6's hold marker must
    be applied to its PRs by config or a labeller.
  - `b` Custom checker only, opening an **issue** carrying the exact diff when a surface is a
    workflow file, and a PR otherwise. *Cost:* every workflow bump is a manual founder push.
  - `c` Move version values out of workflow files into a non-workflow file the workflows read
    at run time, so the App can open every bump as a PR. *Cost:* indirection in every
    workflow, and `uses:` refs cannot be read from a file at all - Actions pins would still
    need `a` or `b`.
  - `d` Renovate (regex managers cover every pin form). *Cost:* a third-party App installed
    with write access to the repo - a wider trust grant than the problem needs.
- **D2 - Cadence.** `a` weekly **(rec)**, low PR noise; *cost:* a security fix can wait up to
  a week plus the cooldown. `b` daily, alongside `supply-chain-daily.yml`; *cost:* more runs
  and more chances to see a release inside its cooldown window repeatedly.
- **D3 - Actions pin form.** `a` full SHA + version comment for **every** action **(rec)** -
  one rule, no per-action judgement, and it is what Dependabot keeps current under D1-`a`;
  *cost:* every action bump is a reviewed PR, including trivial first-party ones. `b` SHA only
  for actions in jobs holding a secret or write token, `@vN` elsewhere (#658's wording); *cost:*
  the drift test must know which jobs are privileged, and that classification itself drifts.
- **D4 - Go toolchain.** Today `go-version: 'stable'` floats in the two jobs that build and run
  the pinned scanner. `a` pin an exact `go-version` and bring it under the checker **(rec)** -
  the scanner build becomes reproducible; *cost:* one more pin to bump, and Go's toolchain is
  already checksum-verified so the safety gain is modest. `b` leave `stable` and record it in
  the inventory as an accepted floating entry; *cost:* a compromised or broken Go release
  reaches the token-scoped CI job unreviewed.
- **D5 - bumblebee while it sits on a main SHA.** `a` propose only a released tag that
  satisfies DR-005's revert condition **(rec)** - matches DR-005 as written; *cost:* fixes on
  upstream main are invisible until upstream cuts a release. `b` also propose newer main SHAs;
  *cost:* every upstream commit becomes a security-review PR, and a SHA carries no release
  ceremony (DR-005 accepted that once, deliberately, not as a standing cadence).
- **D6 - Cooldown length.** `a` 7 days **(rec)** - long enough that most hijacked-release
  takedowns (the npm worm cases DR-005 cites) happen first; *cost:* a genuine security fix
  waits a week unless a human bumps by hand. `b` 3 days; *cost:* narrower takedown window.
  Either way a human may bump inside the window manually; the cooldown binds the checker only.
- **D7 - DR or not.** The choices above are each revertible in under a day (delete a config
  file, change a ref form), so by the under-a-day ADR filter (parent-register rule, cited in the architect role) this spec records them here rather than
  in a new DR. If D1 lands on `a` or `d` (a new bot author on the repo), the Plan should
  reconsider: adding a PR-authoring bot is a trust-boundary change. **(rec)** no DR now;
  *cost:* the Dependabot trust decision would live in a spec, which is less discoverable than
  the register.

## Out of scope

- npm `dependencies` / `devDependencies` and `package-lock.json` (DR-005: lockfile + `npm audit`).
- The cross-repo mmo-platform bumblebee consumers (tracked as mmo-platform#21 per DR-005).
- The bumblebee security review itself (#658 names it as a separate issue; this spec only
  gates on it, FR-7).
- Any adopter-facing pinning feature in the extension.
