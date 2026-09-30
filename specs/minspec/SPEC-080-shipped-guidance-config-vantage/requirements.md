---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — shipped guidance that states this repo's ratcheted config as universal fact is a false signpost an agent reasons from
aspects: [managed-files, harness, slash-commands, prose, config, gate, tier-0]
relates_to: [DR-090, DR-053, DR-074, DR-003, SPEC-066, SPEC-038]
# Ownership is declared now, in Specify, following SPEC-038 FR-3 and SPEC-066/SPEC-079. A
# declaration added after approval edits the hashed frontmatter and stales the sign-off.
# Only the file that exists under EVERY answer to "Decisions needed" below is claimed:
# FR-1's gate test. Whether `prose-vantage.ts` (SPEC-066's, not yet built) or
# `spec-validator.ts` are touched depends on DQ-1/DQ-4, so they are left unclaimed here.
implements: [packages/minspec/tests/shipped-guidance-vantage.test.ts]
# The source of the slash-command guidance. FR-5 repairs at least one sentence in it under
# every DQ outcome (the aspect-severity absolute), so it is modified in all branches. SPEC
# ownership of the file sits elsewhere, so it goes under affects:.
affects: [packages/minspec/src/lib/slash-commands.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-080: Shipped guidance must be true under every config MinSpec gives an adopter

> **This is a SPECIFICATION ONLY.** The dispatch that produced it created no code, script
> or test. A human reads this spec and resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**. Nothing is built until the
> spec has passed the normal spec-approval gate.

Materializes **[#1522](https://github.com/AIClarityAU/minspec/issues/1522)**. No gate
asserts that shipped guidance strings hold under the adopter's configuration, so this
repo's ratcheted `.minspec/config.json` ships as universal fact. Surfaced by
[#1491](https://github.com/AIClarityAU/minspec/pull/1491). Related: #1489, #1323.

## One-Sentence Scope

Add a deterministic, offline gate over the guidance text MinSpec writes into other repos
(the slash-command shims first). It must fail when that text states a config-gated
consequence as unconditional, or cites an id local to this repo without attribution. The
spec also repairs the instances the gate finds today.

## Context

### What the issue reports, re-verified against `HEAD` (`a4f6d8b7`)

- **The surface is shipped, managed, and read by agents as instructions.**
  `FRONTMATTER_GUIDANCE` (`packages/minspec/src/lib/slash-commands.ts:79-98`) is inlined
  into the `specify` body (`:130`). `buildClaudeShim` (`:190`) and `buildCursorShim`
  (`:223`) render it. Since #241 the two shims have been **managed-region templates**
  (`template-registry.ts:2088-2111`). Every *Refresh Harness Files* therefore rewrites them
  in every adopter, and an adopter cannot fix a false sentence locally (DR-090 §Context:
  "a false sentence in a managed file cannot be corrected downstream").
- **The severity is gated by config.** `spec-validator.ts:820` emits
  `config.ownershipDeclaration === 'error' ? 'error' : 'warning'`. `DEFAULT_CONFIG` sets
  `'warn'` (`config.ts:117`). `loadConfig` returns `DEFAULT_CONFIG` when the file is absent
  (`config.ts:142-143`) or unparseable (`:149-150`), and fills in `'warn'` for a config that
  lacks the key (deepMerge, `:148`).
- **This repo is on the stricter setting.** `.minspec/config.json:57` sets
  `"ownershipDeclaration": "error"`. The issue cites `:54`; the file has moved since.
- **Today's text already carries the issue's "cheapest honest mitigation".**
  `slash-commands.ts:94-96` reads: "Until the declaration exists the spec-gate stays
  un-armed for this spec's own files, in every repo; where `ownershipDeclaration` is set to
  `error` the approval is refused outright as well." The specific instance is fixed. **No
  test stops the next one**, which is the defect this spec addresses. A search of
  `tests/slash-commands.test.ts` and `tests/slash-command-shims.test.ts` for
  `ownershipDeclaration`, `DEFAULT_CONFIG`, and bare-id patterns found no assertion on the
  truth of the shipped prose.

### Correction to the issue's premise: `DEFAULT_CONFIG` is not the adopter's config

The issue asks for guidance that is true "under `DEFAULT_CONFIG`", on the grounds that
`scaffold.ts` writes `DEFAULT_CONFIG` into a fresh repo verbatim. **That stopped being true
in #2250.** `scaffold.ts:322-330` now seeds
`ownershipDeclaration: initialOwnershipDeclaration(rootDir)`
(`ownership-ratchet.ts:59-79`). It returns `'error'` for a repo with no `specs/` directory
or no undeclared specs, and `'warn'` only when an existing spec would fail. So the value
really varies with the repo:

| How the adopter got its config | `ownershipDeclaration` in effect |
|---|---|
| Fresh init, zero or clean specs (the common new-install case) | `error` (seeded) |
| Fresh init over a corpus with undeclared T3/T4 specs | `warn` (seeded, grandfathered) |
| Unreadable `specs/` at init | `warn` (seeded, with console warning) |
| No `.minspec/config.json`, unparseable JSON, or key absent | `warn` (`loadConfig` default) |
| Hand-set by the adopter | either |

**Why this changes the requirement.** A gate that checks only against `DEFAULT_CONFIG`
would pass the *mirror-image* false claim. "A missing `implements:` is only a warning" is
true under `DEFAULT_CONFIG`, and false in every freshly installed repo that has no specs.
The vantage has to be **every value MinSpec itself can put in effect** (FR-2). DQ-2 asks
whether to go further and cover every value the schema admits.

### It is a class, not one sentence: two more candidates found while writing this spec

Neither was listed in the issue. Both need confirming at Plan. The code reading behind each
is cited, but no test was run.

1. **`ASPECT_ARTIFACT_GUIDANCE` says "T1 specs are exempt, T2 warns, T3/T4 block"**
   (`slash-commands.ts:112`). `spec-validator.ts:1048` softens a *detected-only* (undeclared)
   aspect from `error` to `warning` even at T3/T4. The absolute holds for declared aspects
   only. This one depends on a condition, not on config. It is the same shape of claim:
   an unqualified "block".
2. **The `clarify` body says "Required for T4, optional for T2/T3"** (`:142`). `plan` and
   `tasks` say similar things (`:149`, `:157`). These match `DEFAULT_CONFIG.phaseMappings`
   (`config.ts:110-115`), but `phaseMappings` can be configured per repo. Whether that
   makes them false is exactly DQ-2.

### Relationship to SPEC-066 / DR-090: this spec fills DR-090's stated residual

[DR-090](../../../docs/decisions/DR-090.md) §1 (accepted 2026-09-20) already sets the
standard: "every factual claim in a managed file's shipped bytes must hold in every repo
that receives them". Its gate, as specified in
[SPEC-066](../SPEC-066-managed-prose-vantage/requirements.md) FR-3, detects only **path
tokens**. DR-090 §Consequences names the gap: "a claim with no path token is not
detected". SPEC-066 FR-11 forbids any artifact from describing that gate as closing the
class.

Both halves of #1522 fall inside that residual:

- a config-gated consequence stated as absolute ("refused at the approval keystroke")
  names no path;
- a bare `SPEC-038` or `(#1489)` is an id, not a path. SPEC-066 FR-3's grammar excludes it.

**This spec needs no new DR for the standard,** because DR-090 §1 is the standard. It adds
two detectors for token classes DR-090 left undetected. DQ-3 sets out the one condition
under which a DR *is* needed.

### Why the blast radius exceeds a code comment

Constitution invariant 3 ([DR-074](../../../docs/decisions/DR-074.md)) limits MinSpec to
the repo it is installed in. A false mechanism claim shipped into that repo's
`.claude/commands/` becomes an instruction the adopter's coding agent acts on. #1489
records three agents drawing the same wrong inference from one ambiguous shipped sentence.
One of those specs was approved through the gap and turned `main` red (#1323).

### How much is shipped today (measured roughly)

A line count taken for this spec, using the ad-hoc regex
`(SPEC|DR|EPIC)-[0-9]+|(^|[ (])#[0-9]{2,}`, over the **on-disk sources** of the 23 literal
`outputPath:` entries in `template-registry.ts`. The count is of matching **lines**, not
tokens. It covers code lines as well as prose, and reads the files before any `localize`
rewrite. The totals: `ai-review.yml` 79, `ai-review-guard.js` 73, its test 59,
`review-branch.sh` 25, `docs-lane.yml` 24, `ready-to-merge.yml` 22, and 13 more lines
across the four role files and `canonical.py`. **This is a rough measure, not what the gate
will report.** It still shows that a bare-id rule applied to the whole managed set on day
one would fail on hundreds of lines. That is the reason for DQ-4.

## Functional Requirements

- **FR-1: One offline gate over the shipped guidance bytes.** A vitest suite
  (`packages/minspec/tests/shipped-guidance-vantage.test.ts`) reads the **rendered** shim
  bytes. For the Claude shims that is `buildClaudeShim(cmd)` for every entry of
  `SPEC_KIT_COMMANDS`; for Cursor it is `buildCursorShim()`. It also reads the
  `buildAgentsSlashCommandSection()` block. It never reads the TypeScript source text, for
  the same reason as SPEC-066 FR-1: the adopter receives the rendered output, not the source.
  Wider surfaces are DQ-4. The suite makes no network call and needs no credentials.

- **FR-2: Config vantage means every value MinSpec can put in effect.** For each config key
  the shipped guidance names or depends on, the gate defines the domain as the set of values
  MinSpec's own code paths can make effective. That is the `DEFAULT_CONFIG` value, plus every
  value `scaffold()` can seed, plus the `loadConfig` fallback. **The domain is derived from
  those code paths, not written as a hand-kept list.** For `ownershipDeclaration`, calling
  `initialOwnershipDeclaration` on a fixture repo with no specs and on one with an
  undeclared spec yields `{warn, error}`. That is the same "derived, never enumerated"
  discipline as DR-090 §3 and SPEC-066 FR-4. A claim passes only if it holds for **every**
  value in the domain. DQ-2 decides whether values admitted by the schema but never written
  by MinSpec count as well.

- **FR-3: Binding each gated-consequence claim to the mechanism, not to wording.** Each
  shipped sentence that claims a gate consequence gets a behavioural assertion.
  "Consequence" here means refused, rejected, blocked, fails, errors, or un-armed. The
  assertion runs the real mechanism under each value from FR-2 and checks that the
  sentence's stated outcome occurs. For ownership that means
  `validateSpec`/`violationsIntroducedByApproval` under both values. For the aspect claim it
  means `validateSpec` on a declared and on a detected-only aspect at each tier. The binding
  is by stable anchor (exact form decided at Plan), so rewording a sentence cannot silently
  detach it from its proof. **This FR, not FR-4, is what actually establishes truth.** FR-4
  only detects new unproven claims.

- **FR-4: A tripwire for unbound absolutes.** A consequence verb (FR-3's set, all
  inflections, closed list kept in the test) that appears in the rendered guidance must meet
  one of two conditions. Either the sentence carries an FR-3 binding, or the same sentence
  names the config key or condition it depends on (for example "where `ownershipDeclaration`
  is set to `error`"). Anything else fails with the sentence quoted and both repairs named.
  **There is no allowlist, pragma, or exception table.** This follows DR-090 §3 and SPEC-066
  FR-6: the cheapest way to go green must also be the fix. The test's header states the
  limit plainly: the tripwire is textual and can be dodged by wording, so it detects and
  does not prove (see INV-4).

- **FR-5: Ids local to this repo are attributed or qualified.** A token in the rendered
  guidance matching `SPEC-\d+`, `DR-\d+`, `EPIC-\d+`, or a bare issue/PR reference `#\d+`
  fails, unless its paragraph attributes it. Attribution uses the SPEC-066 FR-6 pattern
  (`minspec(?:'s own)? repo`, case-insensitive) or a cross-project qualifier (DQ-5). A
  placeholder (`SPEC-NNN`, `DR-NNN`) is not an id and is skipped (SPEC-066 FR-5). Rationale:
  `nextSpecId` is local, so a bare `SPEC-038` in an adopter's repo points at an unrelated
  spec of theirs, or at nothing. DR-053 also requires a cross-project reference to carry the
  target project's code.

- **FR-6: Instances the gate finds today are repaired in the same change.** The gate lands
  green by repairing every sentence it flags, never by loosening FR-4 or FR-5. The expected
  known set is the aspect-severity absolute at `slash-commands.ts:112` (Context candidate
  1), plus whatever DQ-2 makes of the phase "Required for" lines (candidate 2). The default
  repair is the issue's own shape: **state the consequence that holds under every config
  first, then the config-dependent one, naming the key.**

- **FR-7: A proof that the gate has teeth, run in both directions.** For each of FR-3, FR-4
  and FR-5 the suite carries a mutation fixture that re-injects a known-false sentence into a
  **copy** of the rendered guidance, and asserts the gate fails. The FR-4/FR-3 fixture uses
  #1491's original "a spec without the declaration is refused at the approval keystroke";
  the FR-5 fixture uses "SPEC-038 (#1489)". Each also asserts that the repaired sentence
  passes. A gate is only credited once both directions are shown. This is the answer to the
  vacuous-guard history the issue cites (#1399).

## Invariants (must not break)

- **INV-1: Offline core (constitution invariant 1).** The gate and any config-aware
  rendering chosen in DQ-1 make no network call. The id rule (FR-5) never resolves an id
  against GitHub.
- **INV-2: No silent gate (constitution invariant 2, DR-066).** The suite fails visibly and
  closed. If it cannot render a surface (a builder throws) or cannot derive the FR-2 domain
  (the ratchet fixture fails), the result is red with the reason, never a skipped check or a
  vacuous pass over an empty set. An empty surface or an empty domain is itself a failure.
- **INV-3: Blast radius (constitution invariant 3, DR-074).** Nothing this spec ships adds a
  behaviour to an adopter's repo beyond changing the words of guidance MinSpec already
  manages there. The gate runs only in this repo's test suite.
- **INV-4: No overclaim (DR-003, SPEC-066 FR-11).** No artifact, including the PR, commit,
  test header, or this spec's future `status:`, may say this spec makes shipped guidance
  "true". It proves the claims bound under FR-3 and detects unbound absolutes and ids under
  FR-4 and FR-5. A false claim written without a consequence verb or id is still
  undetected.
- **INV-5: The existing single-source links stay intact.** `FRONTMATTER_GUIDANCE` keeps
  importing `SPEC_STATUSES`, and `ASPECT_ARTIFACT_GUIDANCE` keeps deriving from
  `ASPECT_GUIDANCE` (`slash-commands.ts:74-78`, `:100-106`). A repair must not replace a
  derived value with a literal.
- **INV-6: DR-090 / SPEC-066 are extended, not re-decided.** This spec leaves SPEC-066's
  path-token rule, its attribution pattern, and its no-allowlist rule unchanged.

## Acceptance Criteria

- [ ] **Gate exists and is offline**: `shipped-guidance-vantage.test.ts` runs under
  `npx vitest` with the network disabled and reads rendered shim bytes. (FR-1, INV-1)
- [ ] **Domain is derived**: the `ownershipDeclaration` domain the test uses comes from
  calling the ratchet and loader, and a test asserts it equals `{warn, error}`. Removing
  either code path turns the suite red, not green. (FR-2, INV-2)
- [ ] **#1491's original sentence fails**: re-injected into a copy of the `specify` shim,
  "refused at the approval keystroke" is rejected, and the message names
  `ownershipDeclaration`. (FR-4, FR-7)
- [ ] **Today's repaired ownership sentence passes and is bound**: `slash-commands.ts:94-96`
  passes. Its two halves are checked against `validateSpec` under `warn` and under `error`.
  (FR-3)
- [ ] **Bare ids fail, attributed ids pass**: "SPEC-038 (#1489)" fails; the same text with
  an attribution or a DQ-5 qualifier passes; `SPEC-NNN` is skipped. (FR-5, FR-7)
- [ ] **Known instances repaired**: the aspect-severity sentence at
  `slash-commands.ts:112` no longer says T3/T4 unconditionally "block" when a detected-only
  aspect only warns. It carries an FR-3 binding. (FR-6)
- [ ] **No escape hatch**: the suite has no allowlist, pragma, or per-string skip. The only
  skips are the placeholder grammar and the attribution/qualifier rules. (FR-4, FR-5)
- [ ] **Limit stated**: the test header and the implementing PR both state the INV-4
  residual in plain words. (INV-4)

## Costly to Refactor

1. **Choosing config-aware rendering (DQ-1 Option C).** *Why costly:* rendered shims become
   a function of the adopter's config and ship into their repos, so a config edit leaves the
   harness stale until the next refresh. That is a new staleness class, and the drift
   baseline would need a config input. It cannot be undone in under a day once it has
   shipped. *What to check:* whether the managed-region drift check keys on content alone
   (`template-registry.ts`) before choosing it. Also, a DR is required (DQ-3).
2. **The FR-5 qualifier grammar (DQ-5).** *Why costly:* whichever form ships is written into
   every adopter's harness. Changing it later means another refresh everywhere, and a
   sweep here. *What to check:* whether DR-053 v2's `/` grammar (#679) will ship before this
   spec is implemented.
3. **Widening the surface (DQ-4).** *Why costly:* the rough count finds bare ids on hundreds
   of lines across the managed set. Widening means a large repair sweep across files owned
   by other specs, or a ratchet baseline. *What to check:* whether SPEC-066 is built first,
   since it touches the same files.
4. Everything else is **low**. It is one test file plus wording edits in one module, and can
   be reverted in minutes.

## Decisions needed (Clarify)

- **DQ-1: What mechanism establishes truth?** The issue offers three options; a fourth is
  added here.
  - **A. Textual tripwire only** (the issue's recommendation, FR-4 alone). *Cost:* it detects
    and does not prove. A sentence that avoids the verb list and is equally false passes. This
    is the vacuous-guard shape the issue itself flags (#1399).
  - **B. Snapshot of the rendered guidance.** *Cost:* it catches drift, not falsehood. A
    reviewer still has to know the default, and that is the step that failed on #1491.
  - **C. Config-aware rendering.** The shim says what the reader's own config does.
    *Cost:* the widest change, a new staleness class (Costly-to-Refactor 1), and a DR.
    It also cannot help the reader of a Cursor rules file that was generated before their
    config changed.
  - **D. Behavioural binding plus tripwire, i.e. FR-3 plus FR-4 (rec).** Known consequence
    claims are proved against the real validator under every value in the domain. The
    tripwire forces every new consequence claim either to acquire a proof or to name its
    config qualifier. *Cost:* each consequence sentence needs its own small behavioural
    test and an anchor to bind it, which is more per-claim work than A. The tripwire half is
    still dodgeable by wording, as INV-4 states. The FRs above are written for D. Choosing A
    drops FR-3 and FR-7's binding half; choosing C adds a DR and a rendering FR.

- **DQ-2: What does "every config" cover?**
  - **(rec) Every value MinSpec itself can put in effect**: the default, the scaffold seeds,
    and the loader fallback (FR-2 as written). *Cost:* an adopter who hand-customises
    `phaseMappings` still reads "Required for T4" in the `clarify` shim, which may be false
    for them. The guidance describes MinSpec's behaviour as shipped, not every possible
    configuration.
  - **Every value the schema admits.** *Cost:* nearly every phase sentence becomes
    conditional ("by default, …"), which makes the guidance longer and vaguer. Candidate 2
    in Context would need rewording across four command bodies.

- **DQ-3: Does this spec need its own DR?** **(rec) Not unless DQ-1 = C.** DR-090 §1 already
  states the standard, and this spec adds detectors under it. *Cost of skipping:* the
  config-vantage refinement (FR-2, "reachable values, not `DEFAULT_CONFIG`") exists only in
  this spec, not in the register. If DQ-1 = C, a DR is mandatory before Plan, because
  config-dependent shipped files cannot be undone in under a day. No DR number has been
  minted by this dispatch.

- **DQ-4: How far does the surface reach?**
  - **(rec) The slash-command guidance only (FR-1 as written)**: the surface the issue names,
    written by one module. *Cost:* role files, workflows and `canonical.py` keep their bare
    ids (the rough count finds hundreds of lines) until a follow-up widens the gate. That
    follow-up is **not yet filed**. Filing it is part of accepting this answer, so it does
    not become a follow-up that exists only in prose.
  - **Every managed template's prose, reusing SPEC-066's comment and docstring extractor.**
    *Cost:* it depends on SPEC-066 being built, which is at `status: planning` with no code.
    It also needs either a sweep across files owned by other specs, or a baseline that
    shrinks over time. A baseline is the exception table that DR-090 §3 rules out.

- **DQ-5: What makes a cross-project id qualified?**
  - **(rec) Attribution prose ("the minspec repo's SPEC-038") or a full
    `AIClarityAU/minspec#N` reference**, both true today. *Cost:* wordier than a code prefix.
  - **DR-053's project code (`MIN/SP38`)**. *Cost:* the v2 grammar is accepted but not
    shipped (#679, #681), and the `project-prefix` module still emits the v1 dash form. The
    adopter's agent has no prefix table naming `MIN` unless the adopter set one up.

## Out of Scope

- **An LLM "is every sentence true everywhere?" voter.** Non-deterministic on a blocking
  path; DR-090 §Consequences reserves that for its own record.
- **Building SPEC-066's path-token gate.** It is referenced, not absorbed.
- **Rewording managed files outside the slash-command surface**, unless DQ-4 widens it.
- **Changing the `ownershipDeclaration` default or the #2250 ratchet.** This spec describes
  the mechanism and does not change it.

## Alternatives considered and rejected

- **Taking the issue's "true under `DEFAULT_CONFIG`" literally.** Rejected, because since
  #2250 it is not the adopter's config (Context table). It would pass the mirror-image
  false claim "only a warning".
- **Folding into SPEC-066.** Rejected. SPEC-066 is past Specify (`planning`), its FR-11
  explicitly leaves this residual open, and re-opening an approved-track spec would stale
  its approval.
- **An allowlist for legitimate absolutes.** Rejected under DR-090 §3: silencing the gate
  would cost less than fixing the sentence.

## Traceability

- **Issue:** [#1522](https://github.com/AIClarityAU/minspec/issues/1522), surfaced by
  #1491 (two ai-review voters blocked it on this claim). Related: #1489, #1323, #1399.
- **Standard this spec applies:** [DR-090](../../../docs/decisions/DR-090.md) §1, accepted.
- **Sibling gate for path tokens:** [SPEC-066](../SPEC-066-managed-prose-vantage/requirements.md).
- **Mechanism described:** SPEC-038 FR-7 ratchet; `ownership-ratchet.ts` (#2250).
- **Cross-project refs:** [DR-053](../../../docs/decisions/DR-053.md).
- **Blast radius:** [DR-074](../../../docs/decisions/DR-074.md). **Evidence bar:**
  [DR-003](../../../docs/decisions/DR-003.md).
- **DR for this spec:** none, deliberately. DQ-3 states the condition that would require one.

## Follow-ups (tracked)

- **#1522**: closed by this spec's implementation.
- **The DQ-4 widening issue** is **not yet filed**. If DQ-4 resolves to the recommended
  answer, the Clarify pass files it and writes its number here, before approval. This
  dispatch had no permission to file issues.
