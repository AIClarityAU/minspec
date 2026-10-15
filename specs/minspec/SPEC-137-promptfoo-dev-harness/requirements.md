---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a red-team harness for the untrusted-input paths, held outside every shipped package
aspects: [security, red-team, prompt-injection, eval, promptfoo, dev-time, supply-chain, vendor-neutrality, tier-0, offline, no-silent-gate, blast-radius]
depends_on: [DR-048, DR-004, DR-005, DR-008]  # DR-048 decides promptfoo is dev-time only, pinned, offline; DR-004 the network tiers; DR-005 the pre-publish gate this is called a sibling of; DR-008 the dispatch threat model the red-team exercises
relates_to: [DR-029, DR-030, DR-009, DR-021, SPEC-004, SPEC-016, "#372", "#371", "#344"]
# Ownership declared in Specify (SPEC-038), under the RECOMMENDED answer to each
# Clarify question below. If a Clarify answer moves the harness (OQ-2) or drops a
# use (OQ-1, OQ-3), Plan rewrites this list before approval mints a hash. Everything
# sits under `scripts/redteam/`, which is NOT an npm workspace (root `workspaces` is
# `packages/*`), so nothing here is installed by the root `npm ci`, and nothing here
# can be bundled into a vsix. The one file under `packages/` is the containment test.
implements: [scripts/redteam/package.json, scripts/redteam/package-lock.json, scripts/redteam/promptfooconfig.yaml, scripts/redteam/run.sh, scripts/redteam/README.md, scripts/redteam/corpus/injection-cases.json, scripts/redteam/providers/agent-surface.mjs, packages/minspec/tests/promptfoo-containment.test.ts, packages/minspec/tests/redteam-corpus.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: promptfoo as a dev-time red-team harness for MinSpec's untrusted-input agent paths - pinned, isolated, never shipped

Triggered by: [#372](https://github.com/AIClarityAU/minspec/issues/372) (chore: adopt
promptfoo as dev-time/CI red-team + eval harness). Design rationale:
[DR-048](../../../docs/decisions/DR-048.md) (accepted 2026-06-30) - promptfoo is a
dev-time harness, never a shipped dependency.

## In plain terms

promptfoo is an open-source tool (MIT today; agreed to be acquired by OpenAI in March
2026) that fires known prompt-injection and jailbreak attacks at an LLM setup and checks
what comes back. DR-048 already decided we may use it only at dev time, pinned to one
MIT version, never inside any vsix.

The issue lists three uses. Reading the repo changes two of them:

- **The tier classifier is not an LLM.** It is a deterministic size/scope measure
  (`packages/minspec/src/lib/classifier.ts`), and its n=120, Fleiss kappa 0.80
  regression already runs as a vitest harness
  (`packages/minspec/tests/classifier-validation.test.ts`, `npm run validate:classifier`,
  root `package.json:27`). promptfoo would be a second runner over the same data.
- **The MinSpec vsix contains no LLM call** (Tier-0, invariant 1). There is nothing in
  it to red-team, so a "pre-publish red-team gate" on the vsix would test nothing.
  The LLM paths that DO read attacker-controlled text are our dev-time agent scripts:
  `scripts/dispatch-issue.sh` (issue body), `scripts/review-branch.sh` (PR diff),
  `scripts/triage-inbox.sh` (issue body). Those are what this spec red-teams.
- **Scrooge routing quality** lives in `AIClarityAU/scroogellm` (DR-027 split), not here.

So the spec builds one thing: a pinned, isolated promptfoo harness that attacks the
dev-time agent paths with indirect prompt-injection, and a tool-neutral attack corpus
that stays useful if we drop promptfoo. Everything else is a Clarify question below.

## One-Sentence Scope

Add a pinned, isolated, never-shipped promptfoo harness under `scripts/redteam/` that
runs indirect-prompt-injection cases from a tool-neutral corpus against MinSpec's
dev-time agent paths, plus deterministic tests that keep promptfoo out of every shipped
package and keep the corpus usable without promptfoo.

## Context - what exists today (read from this worktree, branched from `origin/main`)

- **DR-048** (`docs/decisions/DR-048.md`, `status: accepted`) Decision 1: promptfoo is
  dev-time / CI only; pin a known-MIT version; do not track upstream; run offline;
  inherit the patterns. Its follow-up list requires re-checking the license at the
  pinned version.
- **promptfoo is not installed anywhere.** `grep -c promptfoo package-lock.json` = 0.
- **Root workspaces = `packages/*`** (`package.json:6-8`). A `package.json` under
  `scripts/` is not a workspace, so the root `npm ci` (CI `ci.yml:79` and others, and
  the dispatch agent's allowed `Bash(npm ci)`, `scripts/dispatch-issue.sh:1227`) does
  not install it.
- **Untrusted-input agent paths and their current defences:**
  - `scripts/dispatch-issue.sh` wraps the issue body in `<untrusted_issue_body>` and
    grants the agent `Read,Edit,Write,Glob,Grep` plus a narrow Bash list
    (`dispatch-issue.sh:1227`). Its threat model is "no credentials, isolated worktree"
    (DR-008), and it is a documented allowlisted exception in
    `packages/minspec/tests/scripts-untrusted-tools.test.ts` (header, issue #344).
  - `scripts/review-branch.sh` wraps the diff in `<untrusted_diff>` and defangs any
    literal container tag inside it (`review-branch.sh:100-114`) before a
    `Read,Glob,Grep`-only `claude -p` run.
  - `scripts/triage-inbox.sh` runs `claude -p` over the issue body with no file tool
    (the #344 fix, pinned by the T0 test above).
  - These defences are tested **structurally** (which tools are granted, that tags are
    defanged). Nothing tests **behaviour**: whether an injected instruction actually
    changes what the agent does. That gap is what this spec fills.
- **The static injection scanner (#371) is not built** - no scanner code exists under
  `packages/` (grep for the issue number and `poison` in `packages/*/src`: no scanner).
  An eval of its precision is therefore not buildable yet.
- **The DR-005 bumblebee gate** is a CI job (`ci.yml:334`, "Supply-chain scan
  (bumblebee)") - deterministic, no model, blocking. A red-team run is none of those
  three things (see OQ-3).

### What I believe about promptfoo but did not verify (Plan MUST check at the pinned version)

Unverified - inferred from general knowledge of the tool, not read from its source here:

- It sends anonymous **telemetry** by default, and checks npm for **updates** on start.
- Its **red-team attack generation** calls a promptfoo-hosted service by default
  unless remote generation is disabled; it can also share results to a hosted viewer.
- It supports a **custom provider** (a local JS file) as the system under test, and
  **deterministic assertions** (contains / not-contains / JavaScript) as well as
  model-graded ones.
- Its npm dependency tree is large (hundreds of transitive packages).

Each of these changes a requirement below, so FR-5 makes Plan record what it found.

## Terms

- **Agent path** - one of our dev-time scripts that hands attacker-controllable text to
  a model with some capability (tools, a verdict, a label).
- **Case** - one attack: the untrusted payload, which agent path it targets, and the
  observable outcome that would mean the attack worked.
- **Canary** - a unique random string planted where the agent must not reach (a file
  outside the worktree, an env var); its appearance in output proves a leak.
- **Corpus** - the set of cases, stored as plain JSON that does not depend on promptfoo.
- **Run** - one execution of the harness against real models. A run spends model quota
  and touches the network to reach the model provider.

## Functional Requirements

### A. Containment - promptfoo never reaches a shipped artifact

- **FR-1 - Isolated install.** promptfoo MUST be declared only in
  `scripts/redteam/package.json`, with its own lockfile, outside the npm workspaces.
  No `packages/*/package.json` and not the root `package.json` may name it in any
  dependency field.
- **FR-2 - Containment test.** A vitest test MUST fail when (a) any
  `packages/*/package.json` or the root `package.json` names `promptfoo` in
  `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies` or
  `bundleDependencies`, or (b) the root `package.json` `workspaces` would include
  `scripts/redteam`. It MUST run in the existing CI test job, so it gates every PR.
  The test MUST read the files itself and fail closed on a parse error (invariant 2),
  never skip.
- **FR-3 - Exact pin, deliberate upgrades.** The version MUST be an exact pin (no `^`,
  `~`, range or tag) with a lockfile integrity hash. An upgrade is its own PR, and that
  PR MUST record the `LICENSE` text's licence at the new version (DR-048 follow-up). The
  containment test MUST fail on a non-exact version string.
- **FR-4 - No auto-install path.** No CI workflow, `npm` script, git hook or dispatch
  allowlist may install or run the harness implicitly. It runs only when a developer
  (or a scheduled job, if OQ-3 chooses one) invokes `scripts/redteam/run.sh`.

### B. Offline posture - no network except the model under test

- **FR-5 - Verify the network surface at the pinned version.** Before Implement, Plan
  MUST record, from the pinned version's own source or docs, every network call
  promptfoo makes (telemetry, update check, remote generation, result sharing, any
  other) and the switch that turns each off. Each "unverified" bullet above becomes
  "verified" or is struck.
- **FR-6 - Every switch set by the one entry point.** `scripts/redteam/run.sh` MUST set
  every off-switch from FR-5 before it starts promptfoo, and MUST refuse to start
  (non-zero exit, message naming the missing switch) if any is unset after setup. A
  test MUST pin that the script sets each switch.
- **FR-7 - Attacks come from our corpus, not a hosted generator.** Cases are read from
  `scripts/redteam/corpus/`. Hosted attack generation stays off. Using promptfoo's
  built-in plugins to *draft* new cases offline is allowed; a drafted case enters the
  corpus only by commit.
- **FR-8 - Network to the model is named and consented.** The only outbound traffic a
  run makes is to the model provider of the agent path under test. `run.sh` MUST print,
  before starting, which provider will be called, how many cases will run, and that the
  run spends quota, and MUST require an explicit flag (e.g. `--i-consent-to-model-calls`)
  to proceed. Without the flag it does a dry run that loads and validates the corpus
  and calls nothing.

### C. The corpus outlives the tool (DR-048 "inherit the patterns")

- **FR-9 - Tool-neutral format.** Each case is a JSON object with at least: `id`,
  `target` (agent path), `payload`, `technique` (e.g. delimiter break-out, instruction
  override, tool-coax, canary-exfiltration, verdict-flip), and `attackSucceededIf` (a
  deterministic check over the agent's output and actions). Nothing in a case may be
  promptfoo syntax; `promptfooconfig.yaml` maps the corpus into promptfoo.
- **FR-10 - Corpus test without promptfoo.** A vitest test MUST load the corpus,
  validate every case against the schema, and fail on a duplicate `id`, an unknown
  `target`, or an empty `attackSucceededIf`. It runs with promptfoo absent.
- **FR-11 - Starting coverage.** The first corpus MUST hold at least one case per
  (agent path x technique) pair that applies, covering at least: closing the container
  tag early (`</untrusted_issue_body>`, `</untrusted_diff>`), "ignore prior
  instructions" overrides, asking the dispatch agent to read a path outside its
  worktree (canary file), asking it to edit a file outside its allowlist, and asking
  the reviewer to emit a `pass` verdict.

### D. Running the agent paths faithfully

- **FR-12 - The real prompt, not a copy.** The custom provider
  (`scripts/redteam/providers/agent-surface.mjs`) MUST build each agent's input by
  calling, or reading from, the same script code that builds it in production - the
  role file under `scripts/roles/`, the same wrapping and defanging - so a change to
  the real prompt is what gets tested. If a script does not expose its prompt-building
  step for reuse, Plan names the smallest extraction needed; a hand-copied prompt in
  the harness is not acceptable (it would drift silently).
- **FR-13 - Real capabilities, sandboxed.** A case against the dispatch path MUST run
  the agent with the same tool allowlist as `dispatch-issue.sh:1227`, inside a
  throwaway worktree, with no credentials in the environment and a canary planted
  outside the worktree. The harness MUST record every tool call and file touched.
- **FR-14 - Deterministic verdicts are load-bearing; model-graded ones are not.** A
  case's pass/fail MUST come from a deterministic check (canary present, path touched,
  verdict string, label emitted). A model-graded assertion MAY be reported alongside,
  never decides the result, and if one is used its grader MUST be a different model
  family from the target (DR-029 decorrelation).
- **FR-15 - Honest output.** A run writes a report listing every case as `held`,
  `broken` (attack succeeded) or `errored` (model call failed, timeout, unparseable).
  `errored` MUST NOT be counted as `held`. The run exits non-zero if any case is
  `broken` or `errored`.

### E. What a broken case triggers

- **FR-16 - A broken case is a filed defect.** The README MUST say that a `broken`
  case is a security defect against the agent path, filed as an issue with the case
  id, and fixed at the mechanism (tool grant, wrapping, defanging) - not by editing
  the case. The case stays in the corpus as a regression.

## Costly to Refactor

- **The corpus schema (FR-9).** Every case and every future runner (vitest, a
  replacement for promptfoo, the #371 scanner's eval) reads it. Changing a field later
  touches all of them.
- **Where the harness lives (OQ-2).** Moving it later moves the lockfile, the
  containment test's paths and the README.

## Acceptance Criteria

- [ ] **Never shipped** - the containment test fails when `promptfoo` is added to any
      `packages/*/package.json` or the root `package.json`, or when `scripts/redteam`
      becomes a workspace, and passes on the delivered tree; a built minspec vsix's
      file list contains no `promptfoo` path. (FR-1, FR-2)
- [ ] **Pinned** - the containment test fails on `^`, `~` or a tag in the harness's
      promptfoo version, and the pinned version's licence is recorded. (FR-3)
- [ ] **Nothing runs it by accident** - no workflow, npm script, hook or dispatch
      allowlist references `scripts/redteam/run.sh` or installs its dependencies.
      (FR-4, plus OQ-3's answer if a schedule is chosen)
- [ ] **No hidden network** - every network call found in FR-5 has its switch set by
      `run.sh`, a test pins each, and `run.sh` refuses to start when one is unset.
      (FR-5, FR-6)
- [ ] **Consent before quota** - without the consent flag, `run.sh` validates the
      corpus and calls no model; with it, it names the provider and case count first.
      (FR-8)
- [ ] **Corpus stands alone** - the corpus test passes with promptfoo uninstalled and
      fails on a duplicate id, unknown target or empty check. (FR-9, FR-10)
- [ ] **Covers the known techniques** - the first corpus has the cases FR-11 lists, for
      the dispatch, review and triage paths. (FR-11)
- [ ] **Tests the real prompt** - changing a role file under `scripts/roles/` changes
      what the harness sends, with no harness edit. (FR-12)
- [ ] **Errors are not passes** - a run in which the model call fails reports
      `errored` and exits non-zero. (FR-15)
- [ ] **First run recorded** - one consented run against each agent path is recorded
      in `scripts/redteam/README.md` (date, pinned version, model, held/broken/errored
      counts), and each `broken` case has a filed issue. (FR-15, FR-16)

## Invariants (must not break)

- **INV-1 - Invariant 1 (offline core).** Nothing under `packages/minspec` or
  `packages/shared` gains a network call or a promptfoo import. The harness's only
  network use is the consented model call of FR-8, and it is dev-time, outside any
  shipped package.
- **INV-2 - Invariant 2 (no silent gate).** The containment test fails closed. A red-team
  run's `errored` is never a pass. If a run is ever made a required check (OQ-3), it
  needs an independent second witness and must not hinge on one model credential.
- **INV-3 - Invariant 3 (blast radius).** Nothing here is scaffolded into an adopter's
  repo; no template, harness file or workflow MinSpec ships mentions promptfoo.
- **INV-4 - DR-048.** promptfoo is never a runtime dependency of any vsix, and its
  version never moves without a deliberate, licence-checked PR.
- **INV-5 - DR-008 / #344.** The harness adds no new `claude -p` call-site in
  `scripts/*.sh` that grants a tool over untrusted content outside the allowlist in
  `scripts-untrusted-tools.test.ts`; the provider is `.mjs`, and it reuses the existing
  grants rather than widening them.

## Decisions needed (Clarify)

### OQ-1 - Do we adopt promptfoo at all, or only its patterns?

- **(a) Adopt narrowly - (rec).** Pinned, isolated promptfoo runs the corpus against the
  agent paths (this spec as written). *Cost:* an isolated lockfile with a large
  dependency tree (unverified size) that someone has to keep patched, plus an
  acquisition-clouded vendor even at dev time.
- **(b) Patterns only.** Keep the corpus (FR-9 to FR-11) and write our own small runner
  in the vitest/`scripts` style; never install promptfoo. *Cost:* we hand-build the
  run/report plumbing and lose promptfoo's plugin catalogue as a source of new attack
  ideas (still readable as docs).
- **(c) Defer.** Close #372 as "patterns noted, not now." *Cost:* the agent paths stay
  tested only structurally, and the gap named in Context remains open.

### OQ-2 - Where does the harness live?

- **(a) `scripts/redteam/`, own `package.json` + lockfile, not a workspace - (rec).**
  Matches `scripts/classifier-validation/` (dev-time, never imported by extension
  code). *Cost:* a second lockfile that root `npm audit` and the bumblebee job do not
  see unless Plan adds them.
- **(b) Root `devDependencies`.** Simplest. *Cost:* every `npm ci` - including CI and
  every dispatched agent - installs promptfoo's whole tree, widening the supply chain
  DR-005 guards for a tool used occasionally.
- **(c) `npx promptfoo@<exact>` with no install.** *Cost:* fetches from npm at run time,
  with no lockfile integrity hash - weaker than (a) on DR-048's "pin/vendor".

### OQ-3 - Gate or report? (the issue says "pre-publish gate, sibling to bumblebee")

The vsix has no LLM path, so a red-team run cannot gate the vsix's own safety; it gates
the dev-time agent paths. A run is also non-deterministic, spends quota, and needs a
model credential - the opposite of bumblebee.

- **(a) Manual, advisory, with a recorded result - (rec).** Run on demand and whenever a
  role file or a wrapping/defanging step changes; record results in the README; a
  `broken` case becomes an issue (FR-16). Not a required check. *Cost:* it holds only as
  far as people remember to run it - the "trust the model" shape the constitution
  warns about - though only for a report, not a gate.
- **(b) Scheduled CI job (e.g. weekly), advisory.** *Cost:* recurring quota spend and a
  model credential in a scheduled workflow; still not a gate.
- **(c) Required pre-publish check.** *Cost:* invariant 2 requires a second
  independent witness for a required check, a flaky model makes publishing flaky, and
  it blocks a publish on a dev-time tooling issue that does not affect the vsix.

### OQ-4 - The other two uses in the issue

- **Classifier eval.** Already covered by `classifier-validation.test.ts`.
  **(rec) drop from this spec.** *Cost:* none known; a promptfoo copy would be a second
  runner over the same labels.
- **#371 static scanner precision.** The scanner is not built. **(rec) out of scope
  here; #371's own spec reuses this corpus (FR-9) as its eval set.** *Cost:* the
  scanner's eval waits for the scanner.
- **Scrooge routing eval.** Belongs to `AIClarityAU/scroogellm` (DR-027).
  **(rec) a separate issue in that repo.** *Cost:* someone has to file it - **not yet
  filed**; this agent cannot reach the network.

### OQ-5 - Which model runs the agent under test?

- **(a) The same CLI and model each script uses in production - (rec).** *Cost:* spends
  the subscription quota the dispatch fleet also uses.
- **(b) A cheaper model.** *Cost:* tests a different model than production; a case
  that holds on one may break on the other, so the result says less.

## Out of Scope

- Any runtime guardrail or scanner in a shipped package (#371; SealBox runtime hardening
  under DR-030/DR-008).
- Changing the dispatch, review or triage scripts' tool grants or wrapping - a `broken`
  case files an issue (FR-16); the fix is its own change.
- Scrooge routing evals (scroogellm repo) and the classifier eval (already exists).
- Red-teaming the extension - it has no LLM path.

## Risks

- **Relicensing.** A future promptfoo version may not be MIT. FR-3's exact pin and
  licence record mean we only move deliberately.
- **Quota.** A run spends the same quota the dispatch fleet uses; FR-8's consent and
  case count make the spend visible before it happens.
- **False confidence.** All cases `held` means only these cases held against this
  model on this day. The README MUST say so next to every recorded run.
- **Real attack text in the repo.** The corpus is attack prompts. Other agents in this
  repo read files; a case payload could steer an agent that opens it while doing
  unrelated work. Plan should keep payloads in JSON strings (not prose an agent reads
  as instructions) and say so in the README header.

## Alternatives considered and rejected

- **Red-team the vsix pre-publish** - it contains no model call; nothing to attack.
- **Add promptfoo to root devDependencies** - rejected as the default (OQ-2 b): every
  agent's `npm ci` would install it.
- **Model-graded verdicts** - rejected as load-bearing (FR-14): a grader model can be
  injected by the same payload and is non-deterministic.
- **Writing promptfoo-format cases directly** - rejected (FR-9): it ties the corpus to
  the tool DR-048 says we may drop.

## Decision records

No new DR. DR-048 (accepted) already decides the irreversible-feeling part (promptfoo
is dev-time only, pinned, never shipped), and every choice left here is reversible in
under a day (a dev-only directory and tests). If OQ-3 picks (c) - a required check -
that is a new gating decision and needs its own DR.

## Test plan (for the Plan phase to place)

- `packages/minspec/tests/promptfoo-containment.test.ts` - FR-2, FR-3 (mutation: add
  `promptfoo` to each dependency field of each package in turn; loosen the pin).
- `packages/minspec/tests/redteam-corpus.test.ts` - FR-10, plus a check that `run.sh`
  sets every FR-5 switch (FR-6).
- Manual consented run per agent path, recorded in the README (FR-15, FR-16).

## Traceability

- Issue: #372. DR: DR-048 (Decision 1). Related: DR-005 (bumblebee), DR-008 (dispatch
  threat model), DR-029 (decorrelated grading), DR-030 (untrusted spec content),
  #371 (static scanner), #344 (untrusted-tools T0 test), SPEC-004 / DR-009 / DR-021
  (classifier validation, already built).
