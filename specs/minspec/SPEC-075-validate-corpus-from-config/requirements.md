---
id: SPEC-075
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a gate that validates a corpus the project does not have is a false signpost
aspects: [harness, managed-files, gate, no-silent-gate, config, tier-0, downstream]
relates_to: [DR-037, DR-066, DR-090, SPEC-066, SPEC-068]
implements: [packages/minspec/tests/validate-py-corpus-config.test.ts]  # NEW — the T0 this spec owns
affects: [packages/minspec/src/lib/template-registry.ts, .minspec/hooks/validate.py, .minspec/config.json]  # template-registry.ts is claimed by no spec's implements:; SPEC-066 and SPEC-063 both list it under affects: only, and this spec follows that precedent (one owner per file)
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — The managed validator reads its corpora from config, so a project can extend it without editing managed code (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for #1698, which triage classified
> `T3` · `role:architect` · `hold:specify` — so the spec is the gate, not the fix.

## One-Sentence Scope

`.minspec/hooks/validate.py` must derive which document corpora it validates from
`.minspec/config.json` instead of hard-coding them, so a project can add, move, or drop a
validated corpus without editing a fully-managed file that *Refresh Harness Files* will
overwrite.

## Context

### The defect, measured

`.minspec/hooks/validate.py` is a managed-region template
(`template-registry.ts`, `name: 'validate-py'`, `outputPath: ${MINSPEC_HOOKS_DIR}/validate.py`),
so its region is rewritten byte-for-byte on every refresh. It hard-codes its corpora:

```python
# .minspec/hooks/validate.py:92
targets = all_md(root, "specs") + all_md(root, os.path.join("docs", "domain"))
# :105
is_domain = norm.startswith("docs/domain/") and norm.endswith(".md")
```

`.minspec/config.json` **already declares those paths**, and the validator never reads it:

| config key | value in this repo | read by validate.py? |
|---|---|---|
| `specsDir` | `specs` | no |
| `decisionsDir` | `docs/decisions` | no |

Measured on both copies: `validate.py` contains **0** occurrences of `config.json`, **0** of
`import json`, and **0** of `specsDir`. The shipped template (`VALIDATE_PY` in
`template-registry.ts`) is identically config-blind — same three counts are zero there.

So the extension point does not need inventing. It needs **wiring to configuration the
project already has**, which is why this is a repair rather than a new feature surface.

### Why this is invariant 2, not a preference

#1698 filed this as a silent-gate fault and that reading is correct. The failure is not
"a project cannot customise the validator". It is:

1. A project extends the validator (this repo did: it added `docs/domain`, a corpus config
   does not declare at all).
2. *Refresh Harness Files* rewrites the managed region from the template.
3. The added corpus stops being validated. **The hook still exits 0.** Nothing reports that
   a gate got narrower, because a validator that checks fewer files passes more often.

That is the shape invariant 2 names: a gate whose coverage shrinks silently. A red check is a
working gate; a gate that quietly stops looking is the defect.

### The drift this repo currently carries proves the point

The live file and its own template diverge on corpora *in both directions*, measured at
`e8dcaacb`:

- live validates `specs` + `docs/domain`; the template also carries DR-frontmatter checks
  (`DR_ID_RE`, `docs/decisions`) that the live file lacks
- so a refresh here would **remove** `docs/domain` coverage and **add** DR coverage

Neither direction is a project choice today; both are an artefact of which copy was edited
last. That drift is waived (not fixed) by the #1888 self-application gate, whose waiver for
this path names this spec's design question as the reason it is waived rather than reconciled.

### Prior art this spec must reuse, not duplicate

- **`specsDir` / `decisionsDir` already exist** in `.minspec/config.json` and are consumed
  elsewhere in the extension. This spec must not introduce a second, parallel way to name the
  specs directory.
- **DR-090 (managed prose is judged from the consumer's vantage)** governs every comment this
  change writes into the template: the docstring currently asserts
  `docs/domain/*.md must have type: domain`, which is a fact about *this* repo, not about an
  adopter. Any corpus list that becomes configurable must stop being asserted as universal
  prose in the shipped file.
- **DR-037** owns the hook-scaffolding chain this validator sits in; the config read must not
  change the hook's detection or install contract.

### Why no new DR

The decision "extend by configuration, not by an unmanaged code region" is not novel here — it
is the existing posture of every managed template (bytes held identical by construction,
behaviour parameterised by `.minspec/config.json`). This spec applies that posture to one file.
If Clarify selects an unmanaged-code-region design instead (CQ-2 below), that **would** need a
DR, because a sanctioned edit point inside a managed file is a new and hard-to-reverse public
contract.

## Functional Requirements

- **FR-1 (corpora come from config, with the current behaviour as the default).** `validate.py`
  MUST derive its validated corpora from `.minspec/config.json`. When the config is absent,
  unreadable, or declares nothing, it MUST validate exactly what it validates today, so an
  adopter who never opens the config sees no behaviour change. *Rationale: a gate that changes
  coverage on upgrade is the very fault this spec repairs; the default must be continuity.*

- **FR-2 (config parse failure fails CLOSED and visibly).** A malformed `.minspec/config.json`
  MUST cause a non-zero exit with a message naming the file and the parse error. It MUST NOT
  fall back to the default corpora silently. *Rationale: invariant 2 — the failure mode this
  spec exists to remove must not be reintroduced at the config-read step. A silent fallback
  would make a typo in the config look like a passing gate.*

- **FR-3 (Tier 0 — no new dependency, no network).** The config read MUST use only the Python
  standard library (`json`), and MUST NOT add a dependency, a subprocess, or any network call.
  *Rationale: this hook runs pre-commit on every developer machine; MinSpec's core works
  offline (invariant 1).*

- **FR-4 (declared corpora carry their own rule, not a hard-coded one).** Each configured
  corpus MUST carry the frontmatter requirement that applies to it, so a project can add a
  corpus without a code change teaching the validator what that corpus requires. The
  `specs` → `id: SPEC-NNN` and `docs/decisions` → `id: DR-NNN` rules MUST be expressible in
  the same form as any project-added rule, with no privileged built-in path.

- **FR-5 (the docstring stops asserting this repo's corpora).** The shipped file's header MUST
  describe the *mechanism* (corpora and their required frontmatter are read from
  `.minspec/config.json`) rather than listing `specs` and `docs/domain` as universal facts
  (DR-090). Any example MUST be marked as an example.

- **FR-6 (`--pre-commit` path unchanged in scope).** The staged-file path
  (`validate.py:89-90`) MUST apply the same configured rule set to staged files. A file is
  validated if and only if it falls under a configured corpus — so the two entry points can
  never disagree about what is in scope. *Rationale: a pre-commit gate that checks a different
  set than CI is two gates with one name.*

## Acceptance Criteria

- **AC-1.** With no `.minspec/config.json` present, the validator's exit code and reported
  errors are byte-identical to today's for a fixture corpus containing one valid and one
  invalid spec.
- **AC-2.** With a config declaring an additional corpus, a file in that corpus with missing
  required frontmatter causes a non-zero exit, and the message names the file.
- **AC-3.** With a config declaring a corpus the project does not have, the validator exits
  zero and does not error on the absent directory.
- **AC-4.** With a malformed config (truncated JSON), the validator exits non-zero and names
  the config file. It does NOT validate the default corpora and exit zero.
- **AC-5.** After *Refresh Harness Files* over a project whose config declares an extra
  corpus, that corpus is still validated — i.e. the #1698 scenario no longer loses coverage.
- **AC-6.** `--pre-commit` and the full-corpus run agree on scope for the same fixture: a
  staged file outside every configured corpus is skipped by both.

## Invariants

- **INV-1 (no silent narrowing).** No code path may reduce the set of validated corpora
  without a non-zero exit or an explicit configured instruction. Coverage may shrink only
  because the project said so.
- **INV-2 (managed bytes stay identical).** The file remains fully managed. This spec does NOT
  introduce an unmanaged region inside it; the extension surface is the config file, which
  refresh does not own.
- **INV-3 (offline, Tier 0).** No dependency beyond the Python standard library.
- **INV-4 (one owner per file).** This spec owns only the new test; `template-registry.ts`
  stays `affects:`, consistent with SPEC-066 and SPEC-063.

## Decisions needed (Clarify)

### CQ-1 (shape) — how the corpora are expressed in config

- **`a` — a `validatedCorpora` map of path → required frontmatter key/pattern (rec).**
  Reuses `specsDir`/`decisionsDir` as the defaults that seed it, and satisfies FR-4 with no
  privileged built-in path.
  **Cost:** it introduces a second place the specs directory can be named, so
  `specsDir: specs` plus a corpus entry for `specs` can disagree. The plan must define which
  wins and assert it in a test, or the config becomes its own drift surface — the exact class
  of fault this spec is repairing one level up.
- **`b` — reuse only the existing `specsDir`/`decisionsDir` keys, no new key.**
  Smallest change, zero new config surface.
  **Cost:** it cannot express a *third* corpus, so this repo's own `docs/domain` still has
  nowhere to live and #1698 stays open for the case that filed it.

### CQ-2 (shape, needs a DR if chosen) — an unmanaged region instead of config

- **`c` — a sanctioned unmanaged region inside `validate.py`** (e.g. a clearly marked
  project-rules block the refresh preserves).
  **Cost:** it makes an edit point inside a managed file a public contract that cannot be
  withdrawn without breaking adopters, and it reintroduces the merge problem managed regions
  exist to avoid. Recommended **against**; recorded because #1698's wording ("no sanctioned
  extension point") invites it, and rejecting it deliberately is worth more than not
  considering it.

### CQ-3 (scope) — does this spec reconcile this repo's own drift

- **`d` — no, out of scope (rec).** This spec makes the corpora configurable; setting this
  repo's config to declare `docs/domain` and `docs/decisions` is a follow-up.
  **Cost:** the #1888 waiver for `validate.py` stays open after this spec lands, so the drift
  remains visible-but-unfixed and someone must remember to close it. Mitigated by the waiver
  self-retiring: it asserts the path still drifts, so it cannot be quietly forgotten.
- **`e` — yes, reconcile in the same change.** Closes the waiver too.
  **Cost:** it couples a template change to editing this repo's own hook, and the two have
  different review stakes — a wrong template ships to every adopter.

## Test

T0 (owned by this spec): `packages/minspec/tests/validate-py-corpus-config.test.ts` — drives
the real `VALIDATE_PY` template against fixture repos, one per acceptance criterion, asserting
exit codes and messages. It must include a **control** in which the configured corpus is
absent from the fixture, so the suite cannot pass by never finding any file to validate — the
vacuous-pass shape a coverage-shrinking gate produces by construction.
