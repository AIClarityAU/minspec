---
id: SPEC-218
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a gate that runs at a severity the repo did not configure, and prints green, is a false signpost
aspects: [config, gate, no-silent-gate, tier-0, offline, extension-host]
relates_to: [DR-066, SPEC-038, SPEC-075, "#2001", "#1912", "#1687", "#654"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3).
# The one new file is the T0 test this spec owns. The changed source files are claimed
# by no spec's `implements:` today (grep of every `implements:` line under specs/ at
# 9b418e9d), and this spec does not claim them: config.ts and validate-frontmatter.ts are
# shared by every rule, and owning them from a hardening spec would freeze them for
# every other change.
implements: [packages/minspec/tests/config-load-diagnostics.test.ts]  # NEW
affects: [packages/minspec/src/lib/config.ts, scripts/validate-frontmatter.ts, packages/minspec/src/extension.ts, packages/minspec/tests/config.test.ts]
phases:
  specify: done
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec - A config file that cannot be read says so, instead of silently running every gate at its default (Requirements)

**What you are approving.** Today, if `.minspec/config.json` exists but cannot be read
or parsed, MinSpec quietly behaves as if the file were empty: every setting goes back
to its default, including the severity dials a repo turns up to `error`, and nothing is
printed. After this spec, the same file produces a visible diagnostic: the Node
validator (`npm run validate`, which CI and the pre-commit hook run) reports it, and
the extension shows it once without failing to start. The cost that bites depends on
CQ-1 below: under the recommended answer, a broken config file turns `npm run validate`
red until it is fixed, on every run, whatever else changed.

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by this
> document. It is the Specify-phase artifact for #2001 (a malformed `.minspec/config.json`
> silently downgrades every configured severity), which triage classified T3 (full spec
> cycle: specify, plan, tasks, implement) with `role:architect`. Four questions are open
> under [Decisions needed (Clarify)](#decisions-needed-clarify); each names a recommended
> option and its cost. Every requirement below is written under the recommended answers
> and says where it changes if a different answer is chosen.

## One-Sentence Scope

Make the extension's shared config loader report, rather than swallow, a
`.minspec/config.json` that exists but cannot be read, parsed, or used, and surface that
report on the two paths that have an output (the Node validator and the extension host),
without changing the loader's signature for its 21 existing call sites or letting
extension activation throw.

## Context - what the code does today (read at `9b418e9d`, not inferred)

1. **The swallow.** `loadConfig` (`packages/minspec/src/lib/config.ts:204-217`) returns
   `DEFAULT_CONFIG` when the file is absent (`:206-208`, correct: an absent file is the
   documented "use defaults" case) and ALSO when `readFileSync`, `JSON.parse`, or the
   merge throws (`:209-216`, a bare `catch {}`). The docstring says so outright:
   "Invalid JSON = pure defaults" (`:202`).
2. **Three shapes of "malformed" reach that catch, and one does not.**
   - Read failure (permission denied; a directory at the path): `readFileSync` throws.
   - Invalid JSON (one dropped brace): `JSON.parse` throws.
   - JSON `null`: `deepMerge` calls `Object.keys(null)` (`:172`, inside `deepMerge` at `:170`) and throws.
   - JSON that parses to a non-object - an array, a string, a number - does NOT throw:
     `Object.keys` returns indices or nothing, `deepMerge` copies junk keys or none, and
     the result is the defaults with no error raised at all (I believe this from reading
     `deepMerge` at `:170-183`; unverified by running it, and the Plan's first test
     should pin it).
3. **The severity dials it downgrades.** Three keys are FR-7 ratchets (SPEC-038) whose
   default is `warn` and whose configured `error` makes a rule fatal:
   `ownershipDeclaration` (`config.ts:60`, read by Rule 15 at
   `scripts/validate-frontmatter.ts:700`), `implementEvidence` (`config.ts:69`, Rule 22 at
   `:732`) and `statusLineAnnotation` (`config.ts:102`, Rule 23 at `:813-814`). A repo
   that set any of them to `error` silently drops to `warn` when the file is malformed.
   Rule 23's own comment names the hole and defers it here (`:808-812`).
4. **A typo is the same downgrade by another route.** A parseable file whose
   `statusLineAnnotation` is `"Error"` or `"fail"` passes through `deepMerge` unchanged,
   and Rule 23 tests `=== 'error'` (`:814`), so the rule runs at `warn`. Nothing reports
   the unrecognised token. (`autonomy` is the one key normalized today, fail-safe to
   `ask`, at `config.ts:196-198`/`:213`.) Whether this case is in scope is CQ-3.
5. **The validator also parses the file a second time.** `resolveDecisionsDir`
   (`scripts/validate-frontmatter.ts:95-110`) reads and parses `.minspec/config.json`
   itself and falls back to `docs/decisions` on a parse error with a comment, not a
   message. That is the #654 shape (two readers of one input) inside one script.
6. **The pre-commit hook trusts the validator's output shape.** `.githooks/pre-commit:394-410`
   treats a non-zero validator exit with no summary line ("validation error(s)" /
   "validation passed") as a broken validator and fails closed, and otherwise compares
   `FAIL ` lines against a HEAD baseline (`:359-389`) so only INTRODUCED failures block.
   Any new diagnostic must arrive as an ordinary `FAIL `/`WARN ` line with the summary
   printed, or it defeats both mechanisms.
7. **The hook does not run the validator for a config-only commit.** Its trigger
   (`.githooks/pre-commit:393`) fires on staged `docs/decisions/`, `specs/`,
   `docs/domain/` and `docs/epics/` Markdown only, so a commit that breaks only
   `config.json` is not validated locally; CI (`.github/workflows/ci.yml`,
   `.github/workflows/minspec-validate.yml`) is the first gate that sees it.
8. **The extension must not throw on activation.** `loadConfig` has 21 call sites in
   `packages/minspec/src` (the extension host, commands, views, lib), several on
   activation or view refresh. The issue's constraint is that it stays total: an
   unhandled throw at activation is a worse failure than a silent default.
9. **Other readers of the same file, out of this spec's reach.**
   `scripts/approval-integrity.ts:99-108` (a parse failure gives an empty allowlist, which
   DENIES), `scripts/lib/autonomy.ts:204-211` (gives `ask`), and
   `scripts/check-dr-id-collision.ts:187-200` (gives the default decisions path, on an
   advisory check) all fail toward the safe side or gate nothing. The shipped
   `.minspec/hooks/validate.py` already warns on an unreadable config
   (`packages/minspec/src/lib/template-registry.ts:1940-1955`) and SPEC-075 FR-2 moves it
   to fail closed. None is changed here; see Out of Scope.

## Contract (cross-boundary - the Plan may rename, not reshape)

```ts
// packages/minspec/src/lib/config.ts - additive; no existing export changes signature.

/** Why a present .minspec/config.json could not be used as written. */
export type ConfigLoadProblem =
  | { readonly kind: 'unreadable';    readonly path: string; readonly detail: string }
  | { readonly kind: 'unparseable';   readonly path: string; readonly detail: string }
  | { readonly kind: 'not-an-object'; readonly path: string; readonly detail: string }
  // CQ-3 option (a) only; deleted if CQ-3 resolves to (b):
  | { readonly kind: 'invalid-value'; readonly path: string; readonly key: string;
      readonly detail: string };

export interface ConfigLoadResult {
  /** Exactly what loadConfig returns for the same file (FR-2). */
  readonly config: MinspecConfig;
  /** Empty when the file is absent or fully usable. Never undefined. */
  readonly problems: readonly ConfigLoadProblem[];
}

/** Total: never throws, for any file content or filesystem state. */
export function loadConfigWithDiagnostics(rootDir: string): ConfigLoadResult;

/** Unchanged signature. Becomes `loadConfigWithDiagnostics(rootDir).config`. */
export function loadConfig(rootDir: string): MinspecConfig;
```

`path` is repo-relative (`.minspec/config.json`). `detail` is the underlying error text
(for `unparseable`, Node's `JSON.parse` message, which carries the position). This is the
issue's "return the error alongside the config", taken as a second function rather than
a changed return type, so none of the 21 call sites changes (see Alternatives).

## Functional Requirements

- **FR-1 - Classify every present-but-unusable file.** `loadConfigWithDiagnostics`
  returns one problem of kind `unreadable` when the file exists and cannot be read,
  `unparseable` when it is read and is not valid JSON, and `not-an-object` when it parses
  to anything but a plain JSON object (`null`, an array, a string, a number, a boolean).
  An absent file returns no problem: absence is the documented defaults case and stays
  silent (Context item 1).
- **FR-2 - The configuration returned does not change.** For every input, the `config`
  in the result, and therefore `loadConfig`'s return value, is the same value
  `loadConfig` returns at `9b418e9d`, with one exception if CQ-3 resolves to (a): an
  unrecognised severity token is replaced by that key's default. (That replacement is
  intended to be behaviour-neutral, since every consumer compares `=== 'error'`; I
  believe this from Context item 4, unverified for all three keys, and the Plan must
  confirm it per consumer.) Surfacing the problem is the whole change; what MinSpec
  enforces under a broken file is decided by the callers below, not by the loader.
- **FR-3 - Both loaders are total.** Neither `loadConfig` nor
  `loadConfigWithDiagnostics` throws for any file content or filesystem state, including
  a directory at the path, a permission error, invalid UTF-8, and an empty file.
- **FR-4 - The Node validator reads config once, through the diagnostic loader.**
  `scripts/validate-frontmatter.ts` calls `loadConfigWithDiagnostics` once and passes the
  resulting `config` to Rules 15, 22, 23 and the harness check, replacing its four
  separate `loadConfig` calls (`:700`, `:732`, `:813`, `:997`), and `resolveDecisionsDir`
  (`:95-110`) takes `decisionsDir` from that same result instead of parsing the file a
  second time. One read, one verdict on whether the file is usable.
- **FR-5 - The validator reports each problem visibly.** Under CQ-1 (a, rec): each
  problem is reported through the validator's existing `fail()` (a `FAIL
  .minspec/config.json: ...` line), naming the path, the kind, the detail, and the fact
  that every configured setting fell back to its default for this run, and the run exits
  non-zero. Under CQ-1 (b): the same text through `warn()`, exit status unchanged.
  Under CQ-1 (c): see that option. In every case the message names the downgrade, so a
  reader cannot mistake "configured as default" for "config unreadable, fell back to
  default" (the issue's own words).
- **FR-6 - The report does not stop the run.** The validator keeps evaluating every
  other rule after reporting a config problem and prints its normal summary line, so
  `.githooks/pre-commit`'s summary-line witness and HEAD-baseline comparison
  (Context item 6) keep working: a config already broken at HEAD is pre-existing to a
  later commit, not introduced by it.
- **FR-7 - The extension surfaces it once and keeps running.** Under CQ-2 (a, rec): the
  extension calls `loadConfigWithDiagnostics` for each workspace root at activation and
  again whenever `.minspec/config.json` changes on disk; for each problem it has not
  already shown for this file content in this session, it shows one non-modal warning
  naming the path, the kind and the downgrade. It never shows a modal and never steals
  focus. Activation completes whatever the file contains (FR-3).
- **FR-8 - Rule 23's deferral comment is retired.** The comment at
  `scripts/validate-frontmatter.ts:808-812` that names this hole and says it "is filed
  rather than patched here" is replaced by one that points at FR-5, and the
  `loadConfig` docstring's "Invalid JSON = pure defaults" (`config.ts:202`) is replaced by
  a description of the new contract. A comment that says a defect is open after it is
  closed is a false signpost.

## Acceptance Criteria

- **AC-1** For each of: invalid JSON (a dropped brace), JSON `null`, `[]`, `"error"`, `5`,
  an empty file, a directory at the path, and (where the filesystem allows it) a file
  with no read permission, `loadConfigWithDiagnostics` returns exactly one problem of the
  FR-1 kind and `loadConfig` returns a value deep-equal to `DEFAULT_CONFIG`. Neither
  throws. (The issue's third acceptance item, at the loader.)
- **AC-2** For an absent file and for this repo's own `.minspec/config.json`,
  `problems` is empty and `config` is deep-equal to `loadConfig`'s value at `9b418e9d`.
- **AC-3** A fixture repo whose `.minspec/config.json` is one brace short of
  `{"statusLineAnnotation": "error"}`, run through `npm run validate`, prints a `FAIL
  .minspec/config.json` line that names the fallback to defaults, prints its summary line,
  and exits non-zero (CQ-1 a). It never prints `Frontmatter validation passed.` with exit
  0. (The issue's first two acceptance items.) Under CQ-1 (b) this becomes: prints a
  `WARN .minspec/config.json` line naming the fallback.
- **AC-4** In the same fixture, the FAIL/WARN line from AC-3 appears even when the
  corpus has no finding for any severity rule, so the report does not depend on a rule
  happening to fire.
- **AC-5** The validator reads `.minspec/config.json` once per run (FR-4); a test that
  counts reads of that path, or the absence of any other `JSON.parse` of it in
  `scripts/validate-frontmatter.ts`, pins it.
- **AC-6** Extension activation against a workspace with a malformed config completes
  (no throw from `activate`), and the warning of FR-7 is shown once, not once per
  `loadConfig` call site.
- **AC-7** Under CQ-3 (a): a parseable file with `"statusLineAnnotation": "Error"`
  produces one `invalid-value` problem naming the key and the accepted tokens, and the
  validator reports it per FR-5.
- **AC-8** The tests vary the fixture, not just the code: at least two malformed shapes
  per kind where two exist, and a passing control (the valid file) in the same test, so a
  test cannot go green with the feature absent (the vacuous-pass lesson this repo has
  paid for).

## Invariants (must not break)

- **INV-1 (constitution invariant 1, offline).** The loader reads one local file. No
  network call is added on any path.
- **INV-2 (constitution invariant 2 / DR-066, no silent gate).** After this change, no
  run of `npm run validate` can exit 0 with no `.minspec/config.json` line printed while
  the file is present and unusable. This is the property the spec exists to establish.
- **INV-3 (constitution invariant 3, blast radius).** Only `.minspec/config.json` at the
  workspace root is read; nothing outside a repo that has `.minspec/` is touched, and an
  absent file stays silent.
- **INV-4 (extension totality).** `activate` never throws because of config content.
- **INV-5 (no signature churn).** `loadConfig`'s signature and return type are
  unchanged; all 21 call sites compile and behave as before (FR-2).
- **INV-6 (fail-safe readers stay fail-safe).** Nothing here makes
  `approval-integrity.ts` or `autonomy.ts` read config through a path that could turn a
  parse failure into a grant.

## Decisions needed (Clarify)

All 4 decisions are answered, not ratified: an agent session selected on 2026-10-25, for each, the option this document already recommended. No human chose them, and no delegation covers authoring Clarify answers. Delegation DLG-001 (DR-108) made none of these selections and covers spec approval and engineering-DR acceptance only. An agent-recorded selection carries no consent, whoever prompted it. It is ratified only by approval of this spec, the founder's or the bot's under DLG-001, and that approval may overturn it.

- **CQ-1 - What the Node validator does with a broken config.**
  **Recorded selection: Option (a),** the spec's reason is that it matches invariant 2's fail-closed rule and agrees with SPEC-075's shipped validate.py.
  - **(a) Fail: report through `fail()`, exit non-zero (rec).** Matches invariant 2's "a
    missing or errored witness fails the gate closed and visibly": the config is the
    witness for what severity three rules run at, and with it unreadable the validator
    cannot know whether the repo asked for `error`. Matches SPEC-075 FR-2/CQ-5's answer
    for the shipped `validate.py`, so this repo's two validators agree. **Cost:** a
    broken config turns every `npm run validate` red, in CI and at commit, whatever else
    changed, until the file is fixed; and it departs from the issue's own recommendation,
    which was a WARN on the CI path.
  - **(b) Warn: report through `warn()`, exit unchanged.** The issue's recommendation.
    **Cost:** the downgrade is no longer silent but still happens: a repo that configured
    `error` still has its findings pass CI while the file is broken, and a WARN line in a
    long green log is easy to miss. It satisfies the issue's acceptance text literally
    but not invariant 2's "fails the gate closed".
  - **(c) Run at the strictest severity: every ratchet runs at `error` and the problem is
    a WARN.** Guarantees the validator never enforces less than any repo could have
    asked for. **Cost:** a repo configured `warn` with a backlog of findings gets FAILs
    attributed to rules that are not the cause, which is the misattribution #1471 was
    filed against.
- **CQ-2 - How the extension shows it.**
  **Recorded selection: Option (a),** the spec recommends one non-modal warning per distinct problem per session, since an output channel line alone is effectively silent.
  - **(a) One non-modal warning per distinct problem per session, at activation and on
    change of the file (rec).** **Cost:** needs a new file watcher on
    `.minspec/config.json` and a small dedupe set keyed on file content; the extension
    has watchers for specs, DRs, approvals and epics (`extension.ts:527-635`) but none for
    config.
  - **(b) Output channel line only.** **Cost:** nobody opens an output channel they do not
    know exists, so in practice this is the silent default with a log line.
  - **(c) A status-bar item while the file is broken.** **Cost:** a persistent surface for
    a rare condition, and a new status-bar contribution to design and test.
- **CQ-3 - Whether an unrecognised severity token is in scope.**
  **Recorded selection: Option (a),** the spec's reason is that an unrecognised severity token is the same silent downgrade through the same loader, so leaving it out would make the acceptance claim true for one spelling only.
  - **(a) Yes, for the three severity keys only (rec).** A `"statusLineAnnotation":
    "Error"` is the same downgrade the issue describes (Context item 4), through the same
    loader, onto the same surface; leaving it out makes the issue's acceptance claim, "a
    repo configured `error` cannot silently enforce `warn`", true for one spelling only.
    **Cost:** widens the issue beyond "malformed file" into value validation, adds a
    problem kind to the contract, and each future severity key must be added to the list.
  - **(b) No; malformed files only.** **Cost:** the typo route stays silent, and needs its
    own issue (not filed by this dispatch, which may not file issues; the Plan or the
    approver files it if (b) is chosen).
- **CQ-4 - Whether the pre-commit hook should also fire on a staged
  `.minspec/config.json`.** Context item 7: a config-only commit is never validated
  **Recorded selection: Option (a),** the spec's reason is that CI catches it on the push and .githooks/ is machinery with its own review gate.
  locally today.
  - **(a) No, not in this spec (rec).** CI catches it on the push, and `.githooks/` is
    machinery with its own review gate. **Cost:** a broken config can be committed
    locally and is found one push later, in CI.
  - **(b) Yes: add `.minspec/config.json` to the trigger at `.githooks/pre-commit:393`.**
    **Cost:** puts a machinery-gated file in this spec's diff, so the implementing PR
    needs a human `--admin` merge instead of the ordinary lane.

## Why no new DR

Every choice here can be undone in under a day (the architect role's decision-record filter): the contract is
additive (one new function, one new type, no changed signature), and the CI severity of
a config problem (CQ-1) is one line between `fail()` and `warn()`. CQ-1's recommendation
applies an existing decision, DR-066 (no silent gate), rather than making a new one.
#1687 (what a Node validator rule does when it cannot run) expects a DR of its own for
the general rule; if that DR lands softer than CQ-1's answer, it amends FR-5.

## Out of Scope

- **The shipped `.minspec/hooks/validate.py`.** SPEC-075 FR-2 decides it (fail closed on a
  present, unreadable config).
- **`approval-integrity.ts`, `autonomy.ts`, `check-dr-id-collision.ts`.** Each parses the
  file itself (Context item 9). The first two fail toward denial, which is the safe
  direction; the third is advisory and not a required check. Routing them through the
  diagnostic loader would close the #654 duplication but is a separate change across
  machinery files.
- **Schema validation of the whole config** (unknown keys, wrong types for non-severity
  keys such as `specsDir`). Only the three severity ratchets are touched, and only under
  CQ-3 (a).
- **The general rule for validator rules that cannot run** (#1687).

## Alternatives considered and rejected

- **Change `loadConfig`'s return type to `{ config, problems }`.** The issue's first
  option as written. Rejected: 21 call sites change for a value only two of them use, and
  every future caller has to remember to destructure. A second function gives the two
  surfaces what they need and leaves the rest untouched.
- **Make `loadConfig` throw, or accept a reporter callback.** A throw breaks INV-4 at
  every call site not wrapped; a callback parameter is the same signature churn as above,
  and a lib module calling into a reporter it was handed hides where output goes.
- **Have `validate-frontmatter.ts` parse the raw file itself before calling
  `loadConfig`.** The issue's second option. Rejected: it adds a third parse of the file
  in one script (alongside `resolveDecisionsDir` and `loadConfig`), and a duplicate
  parser can drift from the real one, the #654 lesson; FR-4 removes a duplicate instead
  of adding one.
- **Leave it.** The issue's third option. Rejected: the downgrade stays invisible and
  grows with every severity key added to config.

## Test plan (for the Plan phase to place)

- `packages/minspec/tests/config-load-diagnostics.test.ts` (NEW, owned): AC-1, AC-2,
  AC-7, FR-3, with the fixture variety of AC-8.
- `packages/minspec/tests/config.test.ts` (affected): its existing invalid-JSON case
  keeps passing unchanged, which is FR-2's regression witness.
- A validator integration test (Plan to place, likely beside the existing
  `validate-frontmatter` tests): AC-3, AC-4, AC-5, run the way CI runs it (`npx vitest`,
  not `npm test`).
- An extension activation test: AC-6.

## Traceability

- Triggered by: #2001 (malformed `.minspec/config.json` silently downgrades every
  configured severity), surfaced while fixing #1912 in PR #1955.
- Rests on: DR-066 (no silent gate) and constitution invariant 2.
- Siblings: SPEC-075 (the shipped `validate.py` reads its corpora from config; decides
  the same file's failure for that script), SPEC-038 (the FR-7 severity ratchets), #1687
  (Node validator rules that cannot run).
