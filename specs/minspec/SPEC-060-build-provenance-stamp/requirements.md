---
id: SPEC-060
type: requirements
# 🔒 Once approved, hash-locked: approved bytes recorded in the per-file sidecar
# .minspec/approvals/specs/minspec/SPEC-060-build-provenance-stamp/requirements.md.json (.specHash).
# `status`/`phases` are tool-written lifecycle mirrors (canonical.ts strips them from the hash);
# never hand-write either. Read the sidecar, never this prose, for the current state.
status: planning
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
aspects: [provenance, build, packaging, signpost, dogfood, status-bar]
relates_to: [SPEC-037, SPEC-050, DR-069, DR-003]
implements: [packages/minspec/src/lib/build-provenance.ts, packages/minspec/tests/build-provenance.test.ts, scripts/build-extension.sh]
implements_reason: >-
  Updated 2026-08-13: FR-1/FR-3/FR-6 shipped in #1477 and DO create owned source, so the
  earlier `none` no longer holds. The three paths above are new files this spec owns.

  MECHANISM DIVERGENCE, recorded rather than quietly absorbed: this spec assumed a
  generated `out/build-info.json` build ARTIFACT. What shipped instead injects the commit
  with esbuild `--define`, so the stamp is a literal in the bundle and there is NO
  generated file at all. That is deliberate - a generated provenance file can itself go
  stale or be regenerated out of step with the bundle it describes, which is precisely the
  failure class this spec exists to eliminate. A stamp that cannot outlive its build is
  strictly stronger than one that can.

  Deliberately NOT declared under `affects:`: `extension.ts`, `invariants.test.ts` and
  `package.json`, all of which #1477 modifies. `affects:` arms the spec-gate exactly as
  `implements:` does (`scripts/hooks/spec-gate.py:349-351` loops both), so declaring shared
  core files here would freeze them for every agent session the moment this approval goes
  stale - the SPEC-053 blast-radius problem (#1474). The modified files are recorded in
  #1477 instead, where they cannot gate unrelated work.

  Still unbuilt: FR-2 (surface on demand), FR-4 (version-bump gate), FR-5 (reviewer
  guidance). This declaration covers the shipped slice only.
affects:
  - packages/minspec/package.json
  - packages/minspec/src/lib/spec.ts
  - packages/minspec/src/lib/lifecycle.ts
  - scripts/dispatch-issue.sh
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# MinSpec — Stamp and surface build provenance, so a stale installed build can't be mistaken for a forged approval (Requirements)

> Materializes **[#1019](https://github.com/AIClarityAU/minspec/issues/1019)**
> (role:dev, dispatched Specify-only per DR-076/#1169 tier gate). Root-caused while
> shepherding **[#996](https://github.com/AIClarityAU/minspec/pull/996)**, where the
> [#886](https://github.com/AIClarityAU/minspec/issues/886) /
> [DR-069](../../../docs/decisions/DR-069.md) `planning`-status fix (commit `1e8f204`,
> `2026-07-26T10:01:51Z`) was correct in source but **absent from the running build**
> (`aiclarity.minspec-0.1.22`, bundled `2026-07-26T03:21:34+10:00`, ~17h earlier),
> so a genuine human approval was misread as a forged one. Related but distinct:
> [#957](https://github.com/AIClarityAU/minspec/issues/957) (phaseless residual),
> [#1007](https://github.com/AIClarityAU/minspec/issues/1007) (reviewers get no
> *authorship* signal — a separate half of the same PR#996 incident).

## One-Sentence Scope

Every packaged MinSpec build must carry an answerable, tamper-evident "which
commit is this" provenance stamp — surfaced to the user on demand and to the
dogfood workspace proactively when the installed build is behind `HEAD` — and any
behaviour-changing fix must bump the version so the version string keeps meaning
as a signal, so that a status/phases mismatch a reviewer sees in the wild is never
again indistinguishable between "stale build" and "forged approval."

## Context

Grounded in the current code, with `file:line` evidence.

### The version string is the only provenance a running extension exposes today, and it did not move across the fix

`packages/minspec/package.json:5` carries `"version": "0.1.26"` at the time of
writing this spec — a single semver field, VS Code's only built-in "which build"
signal. The #1019 incident: `0.1.21 → 0.1.22` landed in `b9e3422`, **before** the
`#886` fix; the fix itself (`1e8f204`, `2026-07-26T10:01:51Z`, *"fix(#886):
'planning' lifecycle status"*, [#900](https://github.com/AIClarityAU/minspec/pull/900))
landed **without a second bump**. Nothing in the build/package pipeline enforces or
even checks that a merged fix commit is followed by a version bump before the next
package.

### The build pipeline has no step that embeds commit identity

`packages/minspec/package.json:618-633` — the packaging chain is
`prepackage` (`supply-chain:check`) → `package` (`build:prod && vsce package
--no-dependencies`) → `build:prod`
(`esbuild src/extension.ts --bundle --outfile=out/extension.js … --minify
--sourcemap=external`). No step reads `git rev-parse HEAD`, no step writes a
build-timestamp or SHA into the bundle, and `out/extension.js` (the artifact
actually installed and run) carries no marker distinguishing one `0.1.22` build
from another. `simple-git` is already a runtime dependency
(`packages/minspec/package.json:637`) but is not invoked at build time for this.

### Nothing reads or surfaces provenance at runtime

`activate()` (`packages/minspec/src/extension.ts:60`) reads
`context.extension?.packageJSON` today only to resolve a keybinding
(`resolveNextTaskKeybinding`, `extension.ts:224`) — the extension's own manifest
version is already in hand at activation, but nothing reads or displays a commit
SHA (there is none to read), nothing compares it against the open workspace's
`HEAD`, and there is no *About MinSpec* command, status-bar item, or activation-log
line naming the running build. A user or reviewer has no in-product way to answer
"which commit is this install".

### This repo is the exceptional case where "installed build vs. source" is always comparable

Every other MinSpec install runs against a workspace that is *not* the extension's
own source. This repo (`AIClarityAU/minspec`) dogfoods — the open workspace **is**
the extension's source tree, so "installed build's stamped SHA" and "workspace
`HEAD`" are always meaningfully comparable, and a divergence is actionable ("you're
running a build older than this checkout — rebuild") in a way it structurally
cannot be for a consumer install. The fix should exploit that, not generalize
past it.

### Consequence already observed: a stale-build artifact was read as a forgery

[PR #996](https://github.com/AIClarityAU/minspec/pull/996) — independent reviewers
saw `status: specifying → implementing` with the `phases:` block unmoved and
concluded (correctly, against **current source**) that the genuine
`advanceSpecToImplementing` would derive and write `planning` and advance phases,
so the diff must be forged. The actual mechanism was the installed `0.1.22` build
predating the `1e8f204` fix by ~9 hours of wall-clock landing time while carrying
an unchanged version string. This is the concrete cost of the missing gate: a full
review cycle, and a false forgery accusation against a legitimate human approval.

## Functional Requirements

- **FR-1 (embed commit provenance at package time).** The `package` script
  (`packages/minspec/package.json:627`) MUST embed the build's git SHA and a UTC
  build timestamp into the packaged artifact (e.g. via an esbuild `--define` into
  `out/extension.js`, or a generated `out/build-info.json` shipped in the `.vsix`)
  before `vsce package` runs. *Rationale: #1019 fix (1) — "which build is running"
  must be answerable from the artifact itself, not inferred from version + wall
  clock.*
- **FR-2 (surface provenance to the user on demand).** The stamped SHA + build
  timestamp MUST be readable from within VS Code without leaving the editor —
  status-bar tooltip, an *About MinSpec* command, and/or the activation log (exact
  surface is a Clarify decision, see below). *Rationale: #1019 fix (1), surfaced.*
- **FR-3 (warn on stale build, dogfood workspace only).** When the open workspace
  is detected as the extension's own source tree (this repo) AND that workspace's
  `HEAD` is ahead of the running build's stamped SHA, MinSpec MUST surface a
  non-blocking notification naming the gap (e.g. "installed MinSpec predates this
  checkout by N commits — rebuild") rather than staying silent. It MUST NOT fire
  for a normal consumer workspace, where source and install are never expected to
  match. *Rationale: #1019 fix (2); scoped to the one case where the comparison is
  meaningful.*
- **FR-4 (version-bump gate on behaviour-changing fixes).** A CI or pre-package
  check MUST catch a merged `fix:`/`fix(#N):` commit (per the RCDD `Root cause:`
  commit-msg convention already gated by `.githooks/commit-msg`) that is not
  followed by a `packages/minspec/package.json` version bump before the next
  package/release, and fail visibly rather than allow a silent same-version
  re-release. *Rationale: #1019 fix (3) — keep the version string meaningful as a
  provenance signal; constitution invariant #2 (no silent gate).*
- **FR-5 (reviewer-facing attribution).** Once FR-1–FR-3 exist, review guidance
  (AI-review panel prompt and/or human-facing docs) MUST name "stale installed
  build" as a checked, ruled-in-or-out explanation for a status/phases mismatch
  before concluding forgery — pointing at the provenance surface from FR-2 rather
  than re-deriving the mismatch from source alone. *Rationale: #1019 fix (4); closes
  the actual PR#996 misattribution.*
- **FR-6 (Tier-0 / offline, DR-069-safe).** All new checks (SHA embedding, staleness
  comparison, version-bump gate) run fully offline against local git state and the
  packaged artifact — no network call, no dependency on GitHub API reachability.
  MUST NOT alter `deriveStatus`, the `planning` status, or any other DR-069
  lifecycle semantics — this spec is about *knowing which build wrote a signpost*,
  never about changing what a signpost says. *Rationale: constitution invariant #1;
  keep this spec's blast radius separate from DR-069's.*

## Acceptance Criteria

- **AC-1 (FR-1).** A `.vsix` produced by `npm run package` contains a build-info
  artifact (embedded define or `out/build-info.json`) with a non-empty git SHA
  matching `git rev-parse HEAD` at package time, and a UTC build timestamp.
- **AC-2 (FR-1, dirty tree).** Packaging from a dirty working tree either embeds a
  `dirty`/`+N` marker alongside the SHA, or the `prepackage` step refuses loudly —
  the artifact never silently claims a clean-tree SHA it doesn't match. (Which of
  the two is a Clarify decision, see DQ-2.)
- **AC-3 (FR-2).** With the built extension running in the Extension Development
  Host, the chosen surface (status-bar tooltip / *About MinSpec* command /
  activation log — per DQ-1) displays the SHA and build timestamp from AC-1,
  human-readably, without opening any file.
- **AC-4 (FR-3, fires).** With a workspace whose root matches the extension's own
  `repository.url` (`packages/minspec/package.json:16`) and a fixture `HEAD` several
  commits ahead of a fixture build-info SHA, activation surfaces the stale-build
  notification exactly once per session (not once per command invocation).
- **AC-5 (FR-3, scoped).** The same fixture build-info SHA, opened against a
  workspace whose root does **not** match the extension's own repository (a normal
  consumer project), produces **no** stale-build notification.
- **AC-6 (FR-4).** A fixture commit sequence — a `fix(#N): …` commit with a valid
  `Root cause:` body, followed by a `package`/release step with `package.json`
  version unchanged since the prior release — is caught and fails the gate
  visibly (non-zero exit / blocking CI check), not silently.
- **AC-7 (FR-4, negative).** The same fixture, but with the version bumped between
  the fix commit and the package step, passes the gate.
- **AC-8 (FR-6).** The new build-info/staleness code makes zero network calls
  (verifiable by test harness asserting no `fetch`/`https` import in the new
  modules) and does not modify `deriveStatus` (`packages/minspec/src/lib/lifecycle.ts`)
  or `advanceSpecToImplementing` (`packages/minspec/src/lib/spec.ts`).
- **AC-9 (FR-5).** The AI-review panel's prompt/instructions (wherever they live —
  Plan will locate the exact file) are updated to reference the FR-2 provenance
  surface as a required check before a status/phases mismatch is called forgery;
  asserted by a grep/text fixture over the prompt content, not by an LLM run.

## Invariants

- **INV-1 (no silent gate — constitution #2).** A missing or unverifiable build
  stamp, and a caught-but-unbumped-version release, both fail visibly and closed —
  never `|| true`'d, never a best-effort log line nobody reads.
- **INV-2 (Tier-0 / offline — constitution #1).** No FR here calls the network
  (not even to fetch commit metadata GitHub already has) — all provenance is
  computed from local `git` state at package time and compared against the
  already-embedded stamp at runtime.
- **INV-3 (scoped blast radius — constitution #3).** The dogfood stale-build nudge
  (FR-3) fires only inside `.minspec/`-marked, self-matching workspaces (this repo);
  it must never activate, warn, or otherwise change behaviour for a consumer
  project that installed MinSpec but isn't MinSpec's own source.
- **INV-4 (does not touch DR-069 semantics).** No change here alters what
  `deriveStatus` computes or what `planning`/`implementing`/`done` mean — this spec
  is purely about attributing an *existing* signpost to the build that wrote it.
- **INV-5 (stamp is evidence, not identity).** The build stamp answers "which
  commit produced this artifact," not "who approved this spec" — it must not be
  conflated with, or substituted for, the separate approver-identity work
  ([#1007](https://github.com/AIClarityAU/minspec/issues/1007),
  [SPEC-037](../SPEC-037-approver-identity/requirements.md)). FR-5's reviewer
  guidance names both as distinct checks.

## Decisions needed (Clarify)

Genuine forks a human must pick before Plan; each changes what ships or how much
surface this spec touches, so none is guessed here.

- **DQ-1 — Which surface(s) carry the provenance display (FR-2)?**
  - **Option A — status-bar tooltip only.** Cheapest; hover-only, easy to miss.
  - **Option B — dedicated `MinSpec: About MinSpec` command (recommended default).**
    Discoverable via Command Palette like every other MinSpec action in this repo's
    own conventions table; can show SHA, build time, version, and (if FR-3 fires)
    the staleness gap in one panel.
  - **Option C — both B and an activation-log line**, for headless/CI visibility
    (e.g. agent-dispatched sessions where no human opens a command palette).
  - *Trade-off:* B is the minimum that makes provenance genuinely discoverable; C
    adds negligible cost and helps the agent-dispatch paths (`scripts/dispatch-issue.sh`)
    where no interactive UI is present. A alone under-delivers FR-2's "on demand"
    bar.

- **DQ-2 — Dirty-tree packaging: embed a dirty marker, or refuse to package?**
  - **Option A — embed `<sha>-dirty` (or `+N` ahead) and proceed.** Matches common
    practice (`git describe --dirty`); never blocks a working packaging flow.
  - **Option B — `prepackage` refuses on a dirty tree, forcing commit-then-package.**
    Strongest guarantee (every shipped `.vsix` traces to a real commit exactly),
    but breaks any workflow that packages from a dirty tree deliberately (rare here
    — `prepackage` already runs `supply-chain:check`, so adding a cleanliness check
    is a small marginal step).
  - *Recommendation to confirm:* A, since a dirty-marker still answers "is this
    exactly `HEAD`" truthfully and is less disruptive; flag if Plan disagrees.

- **DQ-3 — Where does the FR-4 version-bump gate run: CI check, pre-package script,
  or both?**
  - **Option A — CI-only** (a GitHub Actions job on PR/push scanning merged `fix:`
    commits since the last version bump). Catches it before merge; needs the repo's
    CI to have commit-range visibility.
  - **Option B — local `prepackage` check** (blocks `npm run package` if unbumped
    fix commits exist since the last tag/version). Catches it at release time,
    works offline, but is bypassable by whoever runs `package` without the hook.
  - **Option C — both (recommended default),** CI as the load-bearing gate (per
    constitution invariant #2's "independent second witness" language — a single
    local script one config gap can skip is not enough on its own), local check as
    fast local feedback.
  - *Trade-off:* CI-only satisfies the "no single disable-able witness" bar most
    cleanly; local-only is the weaker single-witness case invariant #2 explicitly
    warns against for a *required* gate. C is the safe default but is more
    implementation surface for Plan to size.

- **DQ-4 — Does FR-3's "dogfood workspace" self-match use `repository.url` string
  compare (`package.json:16` vs. `git remote get-url origin`), or a more robust
  signal (e.g. presence of `packages/minspec/package.json` at a matching relative
  path)?** A URL-string compare is simplest but breaks under a fork/mirror remote;
  a path-shape check is more robust but slightly fuzzier. *Recommendation to
  confirm:* URL compare with a path-shape fallback; Plan to size the exact logic.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Embedding a build-time `--define` into `out/extension.js` could leak build-machine paths or env if done carelessly. | Only SHA + ISO timestamp + dirty flag are embedded; no absolute paths, env vars, or usernames (constitution invariant #1's offline/no-exfiltration spirit). |
| R2 | FR-3's staleness nudge, if mis-scoped, could fire in a consumer's normal workspace and read as a confusing, irrelevant warning. | INV-3 + DQ-4 scope the self-match check tightly to this repo; AC-5 is a required negative test. |
| R3 | FR-4's version-bump gate could false-positive on non-behaviour-changing `fix:` commits (e.g. a comment-only RCDD fix) and become a nuisance a developer routes around. | Clarify/Plan to define what counts as "behaviour-changing" precisely (likely: any `fix:` touching `packages/*/src/**`, excluding `*.md`/comments-only diffs) so the gate doesn't over-fire and invite bypass. |
| R4 | A CI-only gate (DQ-3 Option A) can be skipped if CI permissions lapse, recreating exactly the single-witness hole constitution invariant #2 warns against. | DQ-3's recommended default is CI **and** local, giving the required-gate an independent second witness. |

## Out of Scope

- **Changing `deriveStatus`, `planning`, or any DR-069 lifecycle semantics** — this
  spec attributes signposts to builds, it does not change what a signpost says
  (INV-4).
- **Approver-identity / authorship provenance** — that is
  [#1007](https://github.com/AIClarityAU/minspec/issues/1007) /
  [SPEC-037](../SPEC-037-approver-identity/requirements.md)'s territory (INV-5);
  this spec's "provenance" is strictly build-identity.
- **Auto-rebuild or auto-reinstall of a stale build** — FR-3 is a notification
  only; the human still runs the rebuild/reinstall themselves (no auto-mutation of
  the installed extension).
- **Retroactive remediation of the specific SPEC-042 incident** (rebuild +
  reinstall + re-run *MinSpec: Approve Spec*) — that is an operational step for the
  human to perform once, not a feature this spec builds.
- **Consumer-workspace build-freshness checks** — out of scope by construction
  (INV-3); only this repo's dogfood case is addressed.

## Traceability

- **Issue:** [#1019](https://github.com/AIClarityAU/minspec/issues/1019) — installed
  build carried no fix-level provenance; ran without the #886 fix; wrote a false
  `implementing` status; misread as forgery on PR#996.
- **Triggering fix (the one that was stale at runtime):**
  [#886](https://github.com/AIClarityAU/minspec/issues/886) /
  [DR-069](../../../docs/decisions/DR-069.md), commit `1e8f204`.
- **Blocked PR:** [#996](https://github.com/AIClarityAU/minspec/pull/996).
- **Sibling half of the same incident (authorship, not build identity):**
  [#1007](https://github.com/AIClarityAU/minspec/issues/1007).
- **Adjacent, not blocking, per SPEC-050:**
  [SPEC-050 §Traceability](../SPEC-050-silent-approval-pr/requirements.md) already
  notes #1019 as adjacent to its own docs-lane commit-on-approve work.
- **Build pipeline referenced:** `packages/minspec/package.json:618-633`
  (`build:prod`, `package`, `supply-chain:check`).
- **Activation entry point referenced:** `packages/minspec/src/extension.ts:60,224`.
- **Method:** RCDD (mechanism + missing gate, not a restatement of the bad state) —
  filed by the same discipline as [DR-003](../../../docs/decisions/DR-003.md).
