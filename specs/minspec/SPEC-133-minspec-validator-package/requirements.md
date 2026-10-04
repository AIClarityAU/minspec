---
id: SPEC-133
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — DR-037, the editor-independent hook design this materializes, is itself epic: EPIC-003 (docs/decisions/DR-037.md:2)
relates_to: [DR-037, DR-014, SPEC-040, SPEC-073, "#248", "#54"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3). All
# five are NEW and greenfield under this spec's Decision D1 recommendation (Option B — see
# below); choosing Option A instead would change this list materially (it would add moved
# files under packages/shared/src/ and would need to be re-specified before approval).
implements:
  - packages/validator/package.json
  - packages/validator/src/cli.ts
  - packages/validator/src/engine.ts
  - packages/validator/tests/cli.test.ts
  - .github/workflows/publish-validator.yml
# Modified, not owned — the embedded hook/CI template strings these contract requirements
# are read FROM, and the spec-validator engine this package wraps. No spec lists
# template-registry.ts under implements: today (SPEC-073 and others touch it as a sibling,
# not an owner); this spec adds no new owner claim over it.
affects:
  - packages/minspec/src/lib/template-registry.ts
  - packages/minspec/src/lib/spec-validator.ts
  - package.json
---

# SPEC-133: `@aiclarity/minspec-validator` — the published Node entry point for DR-037's git hooks

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, resolves the Clarify decisions below, and approves it through the normal
> spec-approval gate before any code changes.

Materializes **[#248](https://github.com/AIClarityAU/minspec/issues/248)** — *"feat: publish
`@aiclarity/minspec-validator` npm package"* — per [DR-037](../../../docs/decisions/DR-037.md),
which designed the 3-tier editor-independent git-hook chain (Node → Python → shell) and named
this package as its Node tier.

**Issue-numbering note (bookkeeping, not a design question).** DR-037's own `## Follow-ups
(tracked)` list reads: `#246` → *"publish npm package"*, `#247` → *"scaffold pre-commit +
commit-msg hooks"*, `#248` → *"scaffold `.github/workflows/minspec-validate.yml`"*. The live
issue #248 this spec was dispatched from instead carries the npm-package title (matching
DR-037's `#246` row), and `template-registry.ts`'s own code comments cite the GH Actions
workflow as `#249` (`:1028`), not `#248`. #247 and the workflow are both already **built**
(see Context) — only the npm package itself is not. This spec specifies what issue #248's
*actual* body asked for; the stale cross-reference in DR-037 is left for a human to reconcile
(correct DR-037's table, or accept that issue numbers shifted after the DR was written) and is
not resolved by this dispatch, which may not edit DR-037.

## One-Sentence Scope

Add a new, publishable `@aiclarity/minspec-validator` npm package that wraps the real
spec/DR/RCDD validation engine already living in `packages/minspec/src/lib/` behind the exact
`--version` / (bare) / `--pre-commit` / `--commit-msg <file>` CLI contract the already-shipped
git-hook and CI-workflow templates expect, and publish it to npm on its own release cycle —
with no second, hand-maintained reimplementation of the engine.

## Context (grounded, with `file:line` evidence)

- **The consumers of this package already ship and already call it by exact flag.** DR-037's
  two other follow-ups are **built**, and both already assume `@aiclarity/minspec-validator`
  exists:
  - The scaffolded `.minspec/hooks/pre-commit` probes
    `npx --no-install @aiclarity/minspec-validator --version` and, if that succeeds, runs
    `npx --no-install @aiclarity/minspec-validator --pre-commit`
    ([`template-registry.ts:1534-1538`](../../../packages/minspec/src/lib/template-registry.ts#L1534)).
  - The scaffolded `MinSpec Validate` GitHub Actions workflow probes the same `--version`
    and, as its third-priority fallback (after `npm run validate` and
    `.minspec/hooks/validate.py`), runs the bare package with no flags
    ([`template-registry.ts:1096-1098`](../../../packages/minspec/src/lib/template-registry.ts#L1096)).
  - **The `--commit-msg <file>` flag DR-037 documents is not actually called anywhere yet.**
    The scaffolded `.minspec/hooks/commit-msg` ([`:1591`](../../../packages/minspec/src/lib/template-registry.ts#L1591))
    implements the RCDD root-cause gate (DR-003) entirely in shell — it never shells out to
    the Node/Python tiers. This package must still expose `--commit-msg <file>` (DR-037 names
    it explicitly, and a shell-only commit-msg path is a real feature gap for any adopter
    whose shell tier's pattern-match is wrong on an edge case the Node tier would catch) — see
    FR-2.
  - **The package does not exist today.** `npm run validate` (root `package.json:18`) runs
    `scripts/validate-frontmatter.ts` directly, and `packages/*` has no `validator` /
    `minspec-validator` workspace member. Both consumer call sites above only run their Node
    tier when `npx --no-install @aiclarity/minspec-validator --version` *already* resolves —
    today it never does, so every MinSpec-scaffolded repo silently runs at the reduced-fidelity
    Python or shell tier (the documented degrade path, not a bug — but it means this package's
    absence is already live-costing fidelity in every repo that ran `Initialize` after #247/#249
    shipped).
- **The real validation engine lives in `packages/minspec`, not `packages/shared` — DR-037's
  own description of "re-uses validator logic already in `packages/shared`" does not match
  the code.** `packages/shared/src/` contains `canonical.ts`, `index.ts`, `next-task.ts`,
  `project-prefix.ts`, `review-signals.ts`, `rework.ts`, `trust-model.ts` — no validator. The
  real engine is `validateSpec` in
  [`packages/minspec/src/lib/spec-validator.ts`](../../../packages/minspec/src/lib/spec-validator.ts)
  (1,512 lines), consumed today only by the VS Code `MinSpec: Check Spec` command
  ([`commands/validate.ts`](../../../packages/minspec/src/commands/validate.ts#L6), which
  imports `validateSpec` at its own `:6` and calls it at `:57`). This
  is the same unexecuted-move shape CLAUDE.md already records for the classifier
  ("Classifier engine still lives in `packages/minspec/src/lib/classifier.ts` — DR-014's move
  to here is `status: proposed`, not executed (tracked: #54)") — except no issue tracks the
  validator's equivalent gap today. `spec-validator.ts`'s own direct imports
  (`spec.ts`, `spec-vocabulary.ts`, `config.ts`, `approval.ts` — type-only, `ownership-path-rules.ts`)
  contain no `from 'vscode'` import, but nothing in the repo currently asserts that
  *transitively* (SPEC-040's import-cycle tooling checks cycles, not tier boundaries).
- **A third, hand-ported copy of the SAME engine already exists and is explicitly
  maintained as a duplicate** — exactly what issue #248 says this new package must avoid.
  The Python git-hook tier's spec/ownership checks are introduced as *"a line-for-line port
  of the MinSpec extension's `validateOwnership` and of the frontmatter readers it calls
  (`spec.ts`, `spec-vocabulary.ts`, `spec-validator.ts`, `ownership-path-rules.ts`)... MinSpec's
  test suite runs both over the same inputs... and requires identical verdicts: change the two
  together"* ([`template-registry.ts:1823-1829`](../../../packages/minspec/src/lib/template-registry.ts#L1823)).
  That duplication is accepted there only because Python cannot import TypeScript. The new
  Node package has no such excuse — it runs on the same runtime as the real engine.
- **DR-014 already draws the boundary this package must respect.** `@aiclarity/shared` is
  Tier 0 and *may* contain "pure TS... pure logic, `fs`/`path` reads of `.minspec/`"; it may
  **not** contain `vscode`, network, or process-spawn code
  ([`DR-014.md`](../../../docs/decisions/DR-014.md), "Tier → package map"). `packages/minspec`
  is Tier 0–1 and may contain extension UI/commands. Wherever the engine ends up living for
  this package to import, it must land on the Tier-0 side of that line (constitution invariant
  #1 — offline, no network).
- **The precedent for a thin, publishable workspace member already exists in-repo**, just not
  for npm: `packages/broker` is `"private": true` and deploys to Cloudflare rather than
  publishing; no current workspace member is `"private": false` with a `bin` entry. This is the
  first package in the monorepo that must actually `npm publish`.
- **Workspace mechanics.** Root `package.json:6-7` declares `"workspaces": ["packages/*"]`, so
  a new `packages/validator` directory is picked up automatically; `packages/minspec` and
  `packages/shared` are both `"private": true` today, meaning neither can be a plain
  `dependencies` entry of a package that is itself published (npm refuses to resolve a private
  package for an external installer) — this is the concrete mechanical fact behind Decision D1.
- **Root cause (mechanism + missing gate, RCDD-shaped, even though this is a feature not a
  fix).** The mechanism that produced the gap: DR-037 was written as a design decision across
  three follow-up issues, and its own prose ("re-uses validator logic already in
  `packages/shared`") assumed a shared-package extraction that was never actually done for the
  validator (mirroring the classifier's own un-executed DR-014 move, #54) — the hooks and CI
  workflow that *depend* on this package were built and shipped first, so the dependency has
  been running at reduced fidelity since, without anything flagging it. No gate currently
  checks "does the Node tier this template claims to call actually exist on npm" — that's a
  one-way silent degrade, not a failure, which is why nobody noticed. This spec does not add
  such a gate (out of scope — see Out of Scope); it is named here only to size the problem this
  package closes.

## Functional Requirements

- **FR-1 (new publishable workspace package).** Add `packages/validator/` as a new `packages/*`
  workspace member, `"name": "@aiclarity/minspec-validator"`, `"private": false` (the first
  such package in this monorepo), with a `bin` entry (`minspec-validator`) pointing at a built,
  single-file CLI bundle with **no runtime `dependencies` entry resolving to an unpublished
  private workspace package** — i.e. whatever engine code it reuses is bundled at build time
  (this repo already uses `esbuild` for the extension bundle, root `package.json`
  devDependencies), not left as an external `file:`/`workspace:` reference that would break
  for an external `npm install`.
- **FR-2 (CLI contract — exact parity with the already-shipped call sites).**
  - `minspec-validator --version` → exits `0`, prints a version string to stdout. (Required:
    this is the literal existence probe both shipped templates already run,
    `template-registry.ts:1535,1096`.)
  - `minspec-validator` (no flags) → validates the **whole working-tree corpus** (every
    `specs/**`, `docs/decisions/**` file this repo's own `scripts/validate-frontmatter.ts`
    covers, scoped to what is genuinely engine-portable — see Decision D1) from the invoking
    process's current working directory; exits non-zero on any error-severity violation. This
    is the mode the GH Actions fallback runs bare (`template-registry.ts:1098`).
  - `minspec-validator --pre-commit` → validates only the **staged** tree (`git diff --cached
    --name-only --diff-filter=ACM`, matching the Python tier's own `staged_files`
    helper, `template-registry.ts:1789-1798`, for behavioural parity); exits non-zero on any
    error-severity violation among staged files.
  - `minspec-validator --commit-msg <file>` → runs the RCDD root-cause gate (DR-003): a
    Conventional-Commit `fix:`/`fix(scope):`/`fix!:` subject whose body lacks a `Root cause:`
    line is an error. Documented by DR-037 but not called by any shipped template today (see
    Context) — implemented anyway, for CLI/API completeness and so a future hook revision can
    switch tiers without discovering a missing flag.
- **FR-3 (single engine, no reimplementation).** Every check this package runs is backed by
  the same TypeScript source `validateSpec` (`spec-validator.ts`) and its sibling modules
  already use for the VS Code command path — imported and bundled, never hand-ported. This is
  the property the Python tier explicitly could not have (cross-language) and that issue #248
  explicitly asks for here.
- **FR-4 (exit code / output convention).** Non-zero exit on any error-severity violation,
  zero exit when only warnings (or nothing) are found; violation messages go to stderr,
  informational "OK" output to stdout — matching the convention `scripts/validate-frontmatter.ts`
  already establishes for this repo's own CI-visible validator output.
- **FR-5 (independent publish cycle).** A CI workflow publishes `packages/validator` to npm on
  its own trigger (e.g. a version-tag or path-filtered release workflow), **not** coupled to
  `npm run package` (the VSIX build, `package.json:15`) or to the extension's own version
  number — DR-037's "published independently of the extension release cycle."

## Invariants (must not be broken)

- **INV-1 (no silent gate — constitution #2 / DR-066 precedent).** The same fail-closed
  reasoning the shipped CI workflow already documents for "no validator found"
  (`template-registry.ts:1032-1046`) applies inside this package too: an internal error,
  an unreadable/unparseable input, or a missing engine module must exit non-zero with a
  stated reason — never exit `0` without having actually validated.
- **INV-2 (Tier-0 / offline — constitution #1).** The built CLI makes no network call while
  validating (only `npm install`/`npx` resolution — outside this package's own code — touches
  the network). No `http`/`https`/`fetch`/`net` import is reachable from the CLI entrypoint.
- **INV-3 (single source of truth, not a second fork).** No logic inside this package may
  diverge from `spec-validator.ts`'s behaviour for the checks they share — this is the
  property the Python tier's "test suite runs both... requires identical verdicts" comment
  (`template-registry.ts:1826-1829`) already holds the Python port to, and this package has
  no excuse (same language, same process) not to hold it exactly rather than approximately.
- **INV-4 (byte-stable public CLI contract).** Once published, `--version`, `--pre-commit`,
  `--commit-msg <file>`, and the bare-invocation mode must keep working exactly as scaffolded
  — every already-shipped `.minspec/hooks/pre-commit` and `MinSpec Validate` workflow in every
  repo that already ran `Initialize` hard-codes these exact flags
  (`template-registry.ts:1534-1538,1096-1098`) and cannot be retroactively updated by a later
  package release.
- **INV-5 (blast radius — constitution #3).** The package validates only the repo whose
  working directory invoked it; it writes nothing outside that tree and activates only when
  an adopter's own git hook or CI workflow calls it — never on install, never machine-wide.

## Decisions needed (Clarify)

- **D1 — Where does the reused engine code physically live: finally execute DR-014's deferred
  shared-package move, or bundle directly from `packages/minspec` without moving it?**
  - **Option A — Execute the DR-014 move now.** Relocate `spec-validator.ts` and its
    vscode-free dependency subset (`spec.ts`, `spec-vocabulary.ts`, the relevant parts of
    `config.ts`, `ownership-path-rules.ts`) into `@aiclarity/shared`, matching DR-014's
    canonical Tier→package map, and have both the VS Code extension and this new package
    import from there. *Pro:* makes CLAUDE.md's "shared validator" description finally true;
    one engine for the extension, this CLI, and (eventually) ScroogeLLM, matching DR-014's
    original stated motivation; closes the same class of gap #54 already tracks for the
    classifier. *Con:* a real refactor of a 1,512-line module and its import graph, whose
    transitive vscode-freedom is verified here only one import-level deep, not exhaustively —
    sized closer to its own T3/T4 Plan-phase effort than a side effect of this issue; touches
    `packages/minspec` files well beyond what issue #248's text describes.
  - **Option B — Bundle directly from `packages/minspec/src/lib/*` at build time, without
    moving any file.** The new package's build step (esbuild) pulls in `spec-validator.ts`
    and its dependency subset as source, producing a self-contained CLI bundle with no
    external runtime dependency on the unpublished `packages/minspec` — reusing SPEC-040's
    import-boundary tooling (`import-cycle-check.ts`) to assert the bundled subset stays
    Tier-0-clean as a build-time check, without relocating anything. *Pro:* confined, directly
    actionable change matching issue #248's literal scope ("new entry point only"); no
    extension-side refactor risk. *Con:* perpetuates the shared-package gap — `@aiclarity/shared`
    still does not actually contain the validator, same as it still does not contain the
    classifier (#54); a future real DR-014 move touches this package's build config again.
  - **Recommendation: Option B.** Its cost is real — the gap this issue could have closed
    stays open — but closing it is a separably-reviewable architecture change in its own
    right (DR-014's original scope, and #54's open item for the sibling classifier case), and
    issue #248's own text asks only for "a new entry point... no logic duplication," which
    Option B satisfies without expanding into an extension-side refactor. Revisit alongside
    #54 if that move ever happens — at that point this package's import switches to
    `@aiclarity/shared` for free.

- **D2 — Publish straight to the `latest` npm tag once the CLI's own tests pass, or stage
  behind a prerelease tag first?**
  - **Option A — Publish `0.1.0` to `latest` as soon as FR-1 through FR-5's acceptance
    criteria pass.** *Pro:* every already-shipped `.minspec/hooks/pre-commit` and `MinSpec
    Validate` workflow's `--no-install` probe resolves against whatever `npx` would install
    *un*-pinned — i.e. `latest` — so this is the only publish shape that actually upgrades any
    already-scaffolded repo out of the reduced-fidelity degrade path without also editing
    those templates. *Con:* a contract mistake (wrong flag spelling, wrong exit code) reaches
    every adopter's pre-commit hook on day one, with less real-world exercise than a soak
    period would give.
  - **Option B — Publish to a prerelease dist-tag (`next`) first, promote to `latest` after a
    soak period.** *Pro:* lower blast radius for a day-one CLI-contract mistake. *Con:* the
    already-shipped hook/CI templates' bare `npx --no-install @aiclarity/minspec-validator`
    resolves `latest` by convention — a `next`-only publish does not get picked up by any
    existing scaffolded repo at all without a **second**, coordinated change to those
    templates (outside this package's scope), so Option B does not actually buy the staged
    rollout it looks like it buys here.
  - **Recommendation: Option A**, backed by a Plan-phase task to dry-run the built tarball
    (`npm pack`, install in a scratch directory, run every FR-2 flag against a fixture repo)
    before the real `npm publish` — the closest equivalent of a soak period available without
    Option B's unreachable-by-existing-templates problem.

## Acceptance Criteria

- **AC-1 (FR-2, literal flag parity).** Running the built CLI's `--version` exits `0`; bare
  invocation against a fixture tree with one spec missing `id: SPEC-NNN` exits non-zero;
  `--pre-commit` against a fixture with one unstaged-and-broken spec plus one staged-and-valid
  spec exits `0` (only staged files are scoped in); `--commit-msg <file>` against a `fix:`
  commit-message file with no `Root cause:` line exits non-zero. All four flags are taken
  character-for-character from the literal strings in `template-registry.ts:1534-1538,1096-1098,1591`
  (and DR-037's documented `--commit-msg <file>` form), not re-derived.
- **AC-2 (FR-3, INV-3 — single engine).** The same fixture spec, judged once through the VS
  Code `MinSpec: Check Spec` command's `validateSpec` call path and once through this
  package's `--pre-commit`/bare mode, produces an identical violation set (same messages, same
  severities) — proving the package calls the real engine rather than a second
  implementation.
- **AC-3 (FR-1, packaging self-containment).** `npm pack` on `packages/validator` produces a
  tarball whose `package.json` carries no `dependencies` entry that resolves to a `"private":
  true` workspace package; installing that tarball in a scratch directory with **no** access
  to the monorepo's other workspace packages and running each FR-2 flag against a minimal
  fixture succeeds — proving the *built artifact*, not just the source tree, is self-contained.
- **AC-4 (FR-5, independent publish).** The publish workflow (or script) added under this
  spec runs independently of `npm run package`'s workspace propagation and of any extension
  version bump — asserted by reading the workflow/script, not by executing a real
  `npm publish`.
- **AC-5 (INV-1, INV-2 — fail-closed, offline).** An unreadable/unparseable input (a spec file
  with invalid YAML frontmatter, a missing `--commit-msg` file argument) exits non-zero with a
  stated reason, never exits `0` silently; a static import-level check (extending or reusing
  `scripts/check-import-cycles.ts`'s SPEC-040 machinery) confirms no `http`/`https`/`fetch`/`net`
  import is reachable from the CLI entrypoint's bundled dependency graph.

## Out of Scope (explicitly)

- **Executing DR-014's deferred shared-package move for the validator** (Decision D1, Option A)
  — tracked as a future option, not built here; #54 remains the open item for the sibling
  classifier case and is not expanded by this spec to cover the validator too.
- **A gate that detects "a template claims a Node-tier package that isn't actually published
  yet"** — named in Context's root-cause paragraph as the missing-gate half of this gap, but
  building that gate is a separate, generalizable signpost-integrity concern (EPIC-002), not
  this package's job.
- **Wiring the scaffolded `.minspec/hooks/commit-msg` shell script to actually call
  `--commit-msg <file>`** — FR-2 requires this package to *expose* that flag; switching the
  already-shipped shell hook to call it instead of its own inline shell gate is a separate,
  template-registry.ts-owned change with its own regression risk (the shell gate is the
  always-present fallback; replacing it with a Node-tier call needs its own spec if ever
  proposed) and is not required by issue #248's text.
- **Correcting DR-037's stale Follow-ups table / issue-number cross-references** — noted above,
  left for a human; this dispatch's allowlist does not permit editing `DR-037.md`.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Under Decision D1 Option B, a transitive import inside the bundled `spec-validator.ts` dependency subset turns out to touch `vscode` or the network after all (verified here only one import-level deep) | AC-5's static import-level check runs in this package's own CI, failing the build rather than silently shipping a broken Tier-0/offline claim |
| R2 | A CLI-contract mismatch (wrong flag spelling, different exit-code convention) against the exact strings already baked into every MinSpec-scaffolded repo's `.minspec/hooks/pre-commit` and `MinSpec Validate` workflow breaks silently — those repos just keep degrading to the Python/shell tier, with no error surfaced anywhere | AC-1's fixtures are taken character-for-character from the shipped template strings (`template-registry.ts:1534-1538,1096-1098`), not re-derived from DR-037's prose alone |
| R3 | The `@aiclarity` npm scope/package name is unclaimed until the first real publish, leaving a dependency-confusion window (a third party could squat `@aiclarity/minspec-validator` in the meantime) | `--no-install` on every existing probe call site already prevents a squatted package from being silently fetched and run (`template-registry.ts:1042` already documents this reasoning); D2's recommendation to publish promptly once AC-1 through AC-5 pass shortens the window further |
| R4 | `npm pack`-level self-containment (AC-3) is new discipline for this monorepo — every other workspace package is `"private": true` and has never been checked against "does it resolve for an outside installer" | AC-3 is written as its own acceptance criterion precisely because no existing CI step already covers it; Plan should size whether a generic "no published package may depend on a private sibling" check belongs in `scripts/check-import-cycles.ts` or stays local to this package |

## Traceability

- **Issue:** [#248](https://github.com/AIClarityAU/minspec/issues/248) — "feat: publish
  `@aiclarity/minspec-validator` npm package," materialized from DR-037 per the DR-023
  follow-up convention.
- **Decision record:** [DR-037](../../../docs/decisions/DR-037.md) — names this package and
  its documented CLI surface; this spec corrects DR-037's "re-uses validator logic already in
  `packages/shared`" premise against the actual code (Context) without editing DR-037 itself.
- **Sibling decision this spec's D1 inherits from:** [DR-014](../../../docs/decisions/DR-014.md)
  — the Tier→package map and the still-open classifier-move precedent (#54).
- **Already-built DR-037 follow-ups this package must stay in lockstep with:**
  `template-registry.ts:1130-1690` (`.minspec/hooks/pre-commit`/`commit-msg` templates) and
  `template-registry.ts:1053-1104` (`MinSpec Validate` GitHub Actions workflow).
- **Tooling this spec reuses rather than reinvents:** [SPEC-040](../SPEC-040-import-boundaries/requirements.md)
  (`import-cycle-check.ts` / `scripts/check-import-cycles.ts`) for AC-5's offline/Tier-0 check.
- **Constitution:** invariant #1 (offline) grounds INV-2/AC-5; invariant #2 (no silent gate)
  grounds INV-1/AC-5; invariant #3 (blast radius) grounds INV-5.
- **No DR filed by this spec.** Per the DR-359 (parent register, mmo-platform) ADR filter, D1
  and D2 are both reversible-within-the-Plan-phase implementation choices that build on an
  already-accepted DR (DR-037); neither mints a new irreversible architectural commitment on
  its own. If D1 is later revisited toward Option A, that move is DR-014's own follow-up, not
  a new decision record.
