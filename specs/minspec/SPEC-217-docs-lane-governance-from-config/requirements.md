---
id: SPEC-217
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - docs-lane.yml is a harness file shipped byte-for-byte to every adopter
aspects: [harness, docs-lane, governance, no-silent-gate, fail-closed, parity, config]
depends_on: [DR-029, DR-086, DR-066]  # DR-029: DR acceptance is a human act; DR-086 §2: acceptance and T3/T4 approval always stop and ask; DR-066: fail closed
relates_to: ["#1970", "#1968", "#1847", "#2078", "#2124", "#2158", SPEC-039]
implements: none
implements_reason: >-
  A defect spec. Every change lands in existing files that are lock-step copies of one
  predicate (the workflow, governance-transition.ts, governance-transition.sh, and their
  parity test). Owning any one of them from here would freeze it for every other change
  to the lane.
affects: [.github/workflows/docs-lane.yml, packages/minspec/src/lib/ci-review-templates.ts, packages/minspec/src/lib/governance-transition.ts, scripts/lib/governance-transition.sh, scripts/push-docs.sh, packages/minspec/src/lib/approval-pr.ts, packages/minspec/tests/governance-lane-eligibility.test.ts, packages/minspec/tests/approval-pr.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-217: The docs-lane governance gate reads the approvable directories from config, and fails closed when it cannot

Triggered by: #1970 (docs-lane's governance gate hardcodes `specs/` and `docs/decisions/` and
fails open for an adopter with a custom `decisionsDir`). Sibling: #1968 (another fail-open in the
same file, fixed by the EXIT trap). Rests on DR-029 (a DR is born `proposed`; acceptance is a
separate human act), DR-086 §2 (DR acceptance and T3/T4 spec approval always stop and ask) and
DR-066 (fail closed).

## In plain terms

MinSpec ships a workflow, `docs-lane.yml`, that auto-merges docs-only pull requests. It refuses
any pull request that changes a `status:` line in a DR or a spec, because accepting a DR or
approving a spec is a human act. To decide which files are DRs and specs, it uses a fixed pattern:
`^(docs/decisions/|specs/)`.

An adopter can move those directories in `.minspec/config.json` (`specsDir`, `decisionsDir`,
`epicsDir`). The workflow never reads that file. In a repo with `"decisionsDir": "docs/adr"`, a
pull request that flips `docs/adr/DR-004.md` from `proposed` to `accepted` passes the docs check
(it is under `docs/`), is never looked at by the governance check (it is not under
`docs/decisions/`), shows a green `docs-only ✓`, and auto-merges. Nobody pressed a key.

This spec makes the governance check learn the directories from the repo's own config, read from
the base branch, and refuse to arm when it cannot read them, instead of guessing.

## Verified current state (2026-10-18, branch base = origin/main at dispatch)

Every claim here was read from code, not inferred:

- The hardcoded pattern is `.github/workflows/docs-lane.yml:237` (`govern='^(docs/decisions/|specs/)'`),
  applied at `docs-lane.yml:247` (`[[ "$fname" =~ $govern ]] || continue`). Nothing in the
  workflow reads `.minspec/config.json` (grep of `.github/workflows/*.yml` for `config.json`: zero hits).
- The same literal has three more copies that are pinned byte-identical to it:
  `packages/minspec/src/lib/governance-transition.ts:48` (`GOVERNANCE_PATH_PATTERN`),
  `scripts/lib/governance-transition.sh:28` (`GOVERNANCE_PATH_RE`), and the parity test
  `packages/minspec/tests/governance-lane-eligibility.test.ts:66-95`, which pulls the `govern='…'`
  literal out of the workflow by regex. Consumers: `scripts/push-docs.sh:134` and
  `packages/minspec/src/lib/approval-pr.ts:89`.
- The workflow is shipped to adopters: `template-registry.ts:2609-2613` (`docs-lane-workflow`,
  content `DOCS_LANE_WORKFLOW` from `ci-review-templates.ts:2145`).
- Directories are configurable in two places: `.minspec/config.json` (`config.ts:45-47`, defaults
  at `config.ts:152-154`) **and** VS Code settings `minspec.specsDir` / `minspec.decisionsDir`
  (`packages/minspec/package.json:446-451`), merged over the file by `applyVSCodeOverrides`
  (`config.ts:238-254`). CI can only ever see the file.
- `loadConfig` (`config.ts:208-221`) and `scripts/validate-frontmatter.ts:95-109` both **fall back
  to defaults** on a missing or malformed config. That is the "rest of the harness" precedent, and
  it is exactly the fallback this spec must NOT copy for a gate (see FR-4).
- Epics are approvables (`approvable.ts:15`, `ApprovableKind = 'spec' | 'adr' | 'epic'`), but the
  current `govern` pattern omits `docs/epics/` even at defaults. A status change on an epic rides
  the lane in this repo today. This is a pre-existing gap of the same class; see DQ-3.
- `.minspec/config.json` is outside the docs corpus (`allowed=` admits only `.minspec/approvals/`
  under `.minspec/`), so a docs-lane pull request cannot change the config it is judged by.

## Functional requirements

**FR-1 — Derive, do not hardcode.** The governance path set used by the docs-lane status gate is
computed from the repo's `.minspec/config.json`: `specsDir` and `decisionsDir` at least, `epicsDir`
per DQ-3. The literal `^(docs/decisions/|specs/)` no longer decides the set on its own.

**FR-2 — Read the base, not the head.** The config is read at the pull request's **base** commit
(`github.event.pull_request.base.sha`), through the API or a base-ref checkout, never from the PR
head. The base is the authority the PR is merging into, and a head read would make the gate judge
a PR by a config that the PR itself supplies. (`allowed=` already refuses a PR that edits the
config, so this is defence in depth, not the only barrier.)

**FR-3 — Union with the defaults (rec, see DQ-2).** The governed set is the defaults
(`specs`, `docs/decisions`, plus `docs/epics` if DQ-3 is accepted) **plus** whatever the config
names. Moving a directory can only add governed paths, never remove one. Over-refusing costs one
human merge keystroke; under-refusing auto-merges a ratification.

**FR-4 — Fail closed on every unreadable witness.** Each of these refuses to arm, exits non-zero
(so the existing EXIT trap revokes any earlier arming), prints `::error::` naming the cause, and
posts a refusal comment. None of them falls back to the defaults:
- the config fetch fails (network, permission, rate limit);
- the file content is not valid JSON;
- a directory key is present but not a non-empty string;
- a value fails FR-5 validation.

An absent **key** in a present, valid file means the extension's default for that key
(`config.ts:152-154`). That is derivation, not fallback, because the extension itself resolves
it the same way. What an absent **file** means is DQ-1.

**FR-5 — Validate and treat values as literal paths.** Before use, each directory value is
normalised (trailing `/` stripped) and refused (FR-4) if it is empty, `.`, absolute (leading `/`),
contains a `..` segment, a backslash, or any control character including newline. These are the
same rules `resolveAndValidate` (`config.ts:228-235`) applies. Matching is a **literal prefix**
test (`"$fname"` starts with `"$dir/"`), never a regex built by interpolating the value, so a
directory name holding regex or glob metacharacters (`docs/adr.v2`, `a+b`, `[x]`) cannot widen or
break the match.

**FR-6 — No expression injection.** The config value never reaches the shell through a
`${{ … }}` expression. It is read with `jq -r` (or `gh api … -q`) into a shell variable and only
ever used quoted. The value is repository content, not a GitHub context; this requirement keeps
it that way.

**FR-7 — Show which directories were checked.** The job log prints the governed directory list
and the base SHA it was read at, every run. The `docs-only ✓` success comment names the governed
directories too, so a reader can see that the gate looked at `docs/adr/`, not only that it went
green. A gate whose scope is invisible is the silent gate this spec removes.

**FR-8 — One derivation rule, every copy.** The same rule (FR-1, FR-3, FR-5) replaces the
literal in every copy that holds it today:
- `governance-transition.ts` exports a pure function from a config-shaped object to the governed
  prefixes (Tier-0: no imports, no I/O, same posture as today). `approval-pr.ts` calls it with the
  config the extension already loaded.
- `governance-transition.sh` exposes the equivalent bash function, and `push-docs.sh` uses it with
  the local `.minspec/config.json`. A local read fails closed under the same FR-4 rules: refuse to
  label `docs-lane`, never default.
- The workflow uses the same rule.

**FR-9 — Behaviour parity, not string parity.** The parity test stops extracting a `govern='…'`
literal (there will not be one). It runs a shared fixture matrix of configs (defaults, a custom
`decisionsDir`, a custom `specsDir`, a trailing slash, a metacharacter name, each invalid value
from FR-5) through the TS function, the bash function, and the workflow's own extracted snippet
under real bash, and asserts they agree on every (config, path) pair. A source-text assertion
alone would go green on an inverted condition (#2078 already established this).

**FR-10 — The shipped template follows.** `DOCS_LANE_WORKFLOW` in `ci-review-templates.ts` is
regenerated from the changed workflow through the existing generator, never hand-edited, so
adopters receive the fix through the normal harness refresh.

**FR-11 — The corpus stays as it is (rec, see DQ-4).** `allowed=` and its lock-step siblings
(`docs-corpus.ts`, `docs-corpus.sh`, `push-docs.sh`'s `CORPUS`) are not derived from config in
this change.

## Acceptance criteria

- **AC-1 (the reported scenario).** In a repo whose base-branch config has
  `"decisionsDir": "docs/adr"`, a docs-lane PR that changes `status: proposed` to
  `status: accepted` in `docs/adr/DR-004.md` is refused, auto-merge is not armed, any earlier
  arming is revoked, and the refusal comment names `docs/adr/DR-004.md`.
- **AC-2 (defaults unchanged).** In this repo, which uses the defaults, every case in
  `governance-lane-eligibility.test.ts`'s current matrix gives the same verdict as before.
- **AC-3 (union).** With `"decisionsDir": "docs/adr"`, a status transition in
  `docs/decisions/DR-001.md` is still refused (FR-3).
- **AC-4 (fail closed).** Each FR-4 case (fetch error, invalid JSON, `"decisionsDir": 42`,
  `"decisionsDir": ""`, `"../x"`, `"/abs"`, `"a\nb"`) produces a red job, no arming, an
  `::error::` line naming the cause, and a refusal comment. None of them reports `docs-only ✓`.
- **AC-5 (literal match).** With `"decisionsDir": "docs/adr.v2"`, a status change in
  `docs/adrXv2/DR-1.md` is **not** treated as governed, and one in `docs/adr.v2/DR-1.md` is.
- **AC-6 (base, not head).** A test or fixture demonstrates that the config is read at
  `base.sha`. A head-side config differing from base does not change the governed set.
- **AC-7 (visibility).** The job log and the success comment both list the governed directories.
- **AC-8 (parity).** The FR-9 matrix passes for all three implementations, and a deliberate
  mutation of one copy (for example dropping the union) turns it red.
- **AC-9 (shipped).** The template-parity check for `docs-lane-workflow` passes, which means the
  shipped template equals the workflow.

## Invariants this change must not break

- **Constitution invariant 1 (offline core).** `governance-transition.ts` stays Tier-0 and pure.
  Only the workflow, which already makes `gh api` calls, does network reads.
- **Constitution invariant 2 (no silent gate).** No new witness read is swallowed (`|| true`,
  `< <(…)`, a default on error). This is the reason for FR-4. The existing EXIT-trap property
  (#1968), that every non-zero exit revokes an earlier arming, must hold for the new exits
  without per-site calls.
- **Constitution invariant 3 (blast radius).** The workflow reads only the repo's own
  `.minspec/config.json`. Nothing is read from, or written to, outside the repo.
- **SPEC-039 INV-2.** The docs corpus stays byte-identical across its four enforcers (FR-11).
- **Status-line predicate unchanged.** `^[+-]([*_>|-]+ ?)?[*_]*[Ss]tatus:` and its
  floor-not-census caveats (#2124) are out of scope. This spec changes which **files** the
  predicate is applied to, not what it matches.
- **Absent-patch and undecodable-patch branches** (`docs-lane.yml:248-261`) keep treating an
  unknown witness as a transition.
- **Workflow permissions** do not widen. Reading `contents` at the base needs only the
  `contents` scope the job already holds.

## Decisions needed (Clarify)

Selections below are recorded on the option this document already marks recommended. An
agent session recorded them on 2026-10-27, acting on a standing instruction the founder gave
on 2026-10-26 to settle Clarify on recommended options (inbox item in66, relayed by the
chief-of-staff proxy). That instruction lives outside this repo and is not a consent record
(DR-108 delegated approval: a queue item cannot carry consent), so it is cited here as
context, not verified. No human chose any single item. DQ-3 is left open (its recommendation
is evidence-incomplete by this document's own note); this section stays open, and the spec
is not ready to approve, until the founder answers.

**DQ-1 — `.minspec/` present but `config.json` absent.** The extension treats this as "all
defaults" (`config.ts:210-212`).

**Recorded selection: `a`,** fail closed: refuse to arm and say why. An agent session copied
this document's (rec) option; no human chose this item.

- `a` **(rec)** Fail closed: refuse to arm and say why. *Cost:* a repo initialised without a
  config file (hand-built, or an older init) loses the lane until it commits one, which is one
  visible red per PR.
- `b` Use defaults, matching the extension. *Cost:* if the adopter set custom directories only
  in VS Code settings (DQ-5), this is precisely the #1970 hole again, reached by a different
  path.

**DQ-2 — Union with defaults, or configured directories only.**

**Recorded selection: `a`,** union with defaults (FR-3). An agent session copied this
document's (rec) option; no human chose this item.

- `a` **(rec)** Union (FR-3). *Cost:* an adopter whose `docs/decisions/` is an ordinary, non-DR
  folder gets over-refusals there. Those are fail-safe but noisy.
- `b` Configured only. *Cost:* a repo that moved `decisionsDir` but left old DRs in
  `docs/decisions/` loses governance on those files without any signal.

**DQ-3 — Govern `epicsDir` too.** Epics are approvables (`approvable.ts:15`) and are not
governed even at defaults today. That gap exists in this repo now, not only for adopters.

**Not recorded:** the recommendation is evidence-incomplete by this document's own note:
whether an epic `status:` change is a human act has not been decided, and the search for one
was partial. It also moves epic status edits in this repo from the docs lane to a human
merge. Needs the founder's answer.

- `a` **(rec)** Include `epicsDir` (default `docs/epics`) in this change. *Cost:* it changes
  behaviour for this repo: an epic `status:` edit, for example `active` to `done`, now needs a
  human merge. It also widens the scope of a defect fix. Whether an epic status change is a human
  act the way DR acceptance is has not been decided anywhere I found (unverified: I searched
  DR-029 and DR-086 references only).
- `b` Leave epics out and file a separate issue. *Cost:* the known gap stays open, and the "three
  directories" the issue names are only two-thirds derived.

**DQ-4 — Derive `allowed` from config in the same change (the issue's recommendation).**

**Recorded selection: `a`,** keep `allowed` hardcoded (FR-11) and track derivation
separately. An agent session copied this document's (rec) option; no human chose this item.

- `a` **(rec)** No: keep `allowed` hardcoded (FR-11) and track it separately. A mismatch there
  fails **closed**: a spec under a non-default `specsDir` is refused from the lane, loudly.
  Deriving it turns a config value into a knob that widens the **auto-merge** corpus. For
  example, `"decisionsDir": "packages/minspec/src"` would let source code auto-merge. The lane
  would then need markdown-only and outward-denylist constraints on derived arms, which is a
  SPEC-039 amendment across four lock-step enforcers. *Cost:* the issue's drift concern stands,
  because the three directories are encoded twice. Today that drift can only over-refuse.
- `b` Yes, with derived arms restricted to `*.md` and still subject to `outward`. *Cost:* a
  larger change to the lane's most security-critical regex. It also adds a fail-open risk this
  spec does not otherwise create, because a validation bug there admits code instead of refusing
  docs.

**DQ-5 — Directories set only in VS Code settings.** `minspec.specsDir` and
`minspec.decisionsDir` override the file inside the editor (`applyVSCodeOverrides`), and CI can
never see them. For such an adopter the extension and the lane disagree about where DRs live.

**Recorded selection: `a`,** document that `.minspec/config.json` is the only source CI
honours, with a follow-up for the extension warning. An agent session copied this document's
(rec) option; no human chose this item.

- `a` **(rec)** In this spec, document that `.minspec/config.json` is the only source CI honours.
  File a follow-up so the extension warns when a workspace setting differs from the file.
  *Cost:* until that follow-up ships, an editor-settings-only adopter is still exposed. The gap is
  documented, not closed.
- `b` Pull the warning into this spec. *Cost:* scope expansion into extension UI on a defect fix
  (CLAUDE.md triage rule 2).

## Out of scope

- The status-line predicate and its known uncovered forms (#2124).
- Changing the docs corpus (`allowed=`), unless DQ-4 `b` is chosen.
- `specsLayout: spec-kit`, which changes the shape inside `specsDir` (`config.ts:33`), not its
  root, so prefix matching is unaffected.

## Follow-ups (tracked)

- DQ-5 `a` follow-up: an issue to be filed at Clarify if `a` is chosen. It is not filed from this
  dispatch, because the specify-only mandate forbids `gh`.
- DQ-3 `b` and DQ-4 `a` each carry the same obligation if chosen.
