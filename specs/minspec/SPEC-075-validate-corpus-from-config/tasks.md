---
id: SPEC-075
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-075 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity - a gate that validates a corpus the project does not have is a false signpost
relates_to: [DR-066, DR-090, SPEC-038, "#1698", "#2390", "#3266"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-075 - Tasks

The order below is the order of work. Each task is one pull request sized for one agent
run (T1/T2: one concern, at most three files, its own test), lands green on its own, and
names the requirement IDs it satisfies. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md).

Every backticked path in this file is a file this change edits or creates. Files it only
reads are named in prose, so the spec gate's ownership signal stays as narrow as the change.
The whole build touches three files: `packages/minspec/src/lib/template-registry.ts` (the
`VALIDATE_PY` template string only), `packages/minspec/tests/validate-py-corpus-config.test.ts`
(new, owned), and `packages/minspec/tests/shipped-ownership-gate-2250.test.ts`. This
repository's own live validator and config are NOT edited (CQ-3 `d`, tracked as #2390). A
finding that needs any other file is a `DEEPER:` stop, never an allowlist widening.

All tests drive the real rendered template through `python3` in a temp fixture repo, as the
2250 suite does, and throw rather than skip when `python3` is missing under `CI`.

## 1 - Pin today's output (no behaviour change)

- [ ] **1.1** Create `packages/minspec/tests/validate-py-corpus-config.test.ts` with the
  fixture helpers (render `validate-py` with `renderManagedFile`, write config and files,
  spawn `python3`, return exit code and stderr) and the **AC-1** case: no config, a fixture
  with one valid and one invalid spec under `specs/`, one valid and one id-less record
  under `docs/decisions/`, one domain file missing `type:`. The expected stderr is captured
  from the unchanged template and written into the test as a literal string, with the exit
  code.
  *Satisfies:* AC-1 (as the baseline every later task is held to), FR-1.
  *Done when:* the case passes against the template as it is on `main`, and changing one
  character of the literal makes it fail.

## 2 - One config read, failing closed

- [ ] **2.1** `packages/minspec/src/lib/template-registry.ts` - add `ConfigError` and
  `load_config(root)` (absent: `None`; open or parse failure, or a non-object top level:
  raise), call it first in `main()` before `staged_files`, print
  `FAIL .minspec/config.json: <reason>` and return 1 on `ConfigError`. Change
  `ownership_declaration` to take the parsed config; delete its file read, its `WARN` line
  and the "Read on the first spec" comment. `packages/minspec/tests/shipped-ownership-gate-2250.test.ts` -
  rewrite the case at :284-290 to AC-4's outcome (exit 1, stderr names the config file,
  no `WARN` line), keeping the case. Owned test - add **AC-4** (truncated JSON, full run:
  exit 1, config named, the invalid spec from the fixture NOT reported, proving the default
  corpora were not validated), **AC-7** (`--pre-commit` with nothing staged, once with
  `{ not json` and once with a directory at the config path so `open` fails: exit 1, config
  named, no line containing `default`), a top-level `[]` case, and a valid
  `ownershipDeclaration: "error"` case showing the rule still reads the dial.
  *Satisfies:* FR-2, FR-3, AC-4, AC-7, INV-3.
  *Done when:* the new cases and the rewritten 2250 case pass, 1.1 still passes, and the
  rendered template contains no `import` beyond the standard library.

## 3 - Corpora as data, seeded to today's behaviour

- [ ] **3.1** `packages/minspec/src/lib/template-registry.ts` - add `seed_corpora(config)`
  (three seeds from `specsDir`, `decisionsDir` and `docs/domain`, with key, pattern, label,
  exempt and role exactly as the design's seed table), path normalisation and the malformed
  checks for `specsDir`/`decisionsDir`, `corpus_for(norm, corpora)` (longest path wins,
  `.md` only, exempt basenames skipped) and `check_frontmatter`. Replace the `is_spec`,
  `is_dr` and `is_domain` branches in `main()` with one loop over `corpus_for`; run the
  ownership rule only for role `spec` and the `## In plain terms` warning only for role
  `decision`. Build the full-run targets by walking each corpus and de-duplicating.
  Owned test - add: a domain file with `type: glossary` now reads
  ``invalid `type: domain` frontmatter (got `glossary`)``; a config with
  `specsDir: "docs/specs"` validates `docs/specs/` and no longer `specs/`; `specsDir: "../x"`
  and `specsDir: 7` each exit 1 naming `specsDir`.
  *Satisfies:* FR-1, FR-4 (seeds in the generic form), INV-1.
  *Done when:* 1.1's literal still matches byte for byte, every existing validate-py suite
  (dr037-hook-scaffolds, dr-frontmatter-gate, dr-gate-shell-tier-parity,
  dr-plain-terms-gate-2921, validate-py-unreadable-fails-closed-2630, gate-fail-direction,
  pre-commit-python-tier-detection, minspec-validate-gate and the 2250 suite) passes
  unchanged, and the new cases pass.

## 4 - The validatedCorpora key

- [ ] **4.1** `packages/minspec/src/lib/template-registry.ts` - parse `validatedCorpora` in
  `load_config`'s checks and layer it over the seeds per the design's precedence rules
  (same path replaces the seed's rule and keeps its role; other paths append in config
  order; nothing removes a seed). Owned test - add **AC-2** (an extra corpus, a file in it
  missing the key: exit 1, the file named), **AC-3** (a declared corpus whose directory is
  absent: exit 0, no error mentioning it), the **vacuous-pass control** (an invalid file in an
  undeclared directory exits 0; the same file under a declared directory exits 1), the
  **CQ-1 precedence** case (`specsDir: "specs"` plus a `specs` entry with pattern `S-\d+`:
  `id: S-1` passes, `id: SPEC-1` fails, and the ownership rule still warns on a T3 spec
  past Clarify with no `implements:`), an entry that omits the seeds still has spec and DR
  checking, the `re.fullmatch` case (`pattern: "SPEC-\\d+"` rejects `SPEC-1-draft`), an
  overlapping `docs` entry where a decision record is judged once by the `docs/decisions`
  rule, and one malformed-entry case per bullet in the design's malformed list, each exit 1
  naming the key (`validatedCorpora` not an object, entry not an object, `key` missing,
  `pattern` not compiling, `label` not a string, `exempt` not a list of strings, path
  absolute, path with `..`). `validatedCorpora: {}` keeps the seeds.
  *Satisfies:* FR-2 (malformed entries), FR-4, AC-2, AC-3, INV-1, CQ-1 cost.
  *Done when:* all of the above pass and 1.1 still matches.

## 5 - Scope parity between the two entry points

- [ ] **5.1** Owned test only, plus `packages/minspec/src/lib/template-registry.ts` if a
  case fails - **AC-6**: in a git fixture with an extra corpus `docs/runbooks`, stage
  `notes/x.md` (outside every corpus, invalid frontmatter) and `docs/runbooks/y.md`
  (invalid); `--pre-commit` and the full run both report `docs/runbooks/y.md` and neither
  mentions `notes/x.md`. Then stage a file listed in a corpus's `exempt`: skipped by both.
  *Satisfies:* FR-6, AC-6.
  *Done when:* both entry points produce the same set of named files for the fixture. If
  task 3 already shares `corpus_for` and the cases pass without a template edit, the task
  is the test alone.

## 6 - Coverage survives a refresh

- [ ] **6.1** Owned test only - **AC-5**: scaffold a temp project, write a config declaring
  `docs/runbooks` with a required key, add an invalid runbook, run the extension's exported
  `refreshHarnessFiles` (scaffold.ts) over it, then run the refreshed validator: exit 1
  naming the runbook, and the config file is byte-identical before and after the refresh.
  *Satisfies:* AC-5, INV-2 (the validator stays fully managed; the extension surface is the
  config).
  *Done when:* the case passes, and a control with the runbook made valid exits 0.

## 7 - The docstring says the mechanism, not this repository's folders

- [ ] **7.1** `packages/minspec/src/lib/template-registry.ts` - rewrite the `VALIDATE_PY`
  header per the design's Docstring section: corpora and their frontmatter come from
  `specsDir`, `decisionsDir` and `validatedCorpora`; the three defaults appear only under a
  line starting `Example (the defaults):`; a config that cannot be read stops the run.
  Owned test - assert the rendered header names `validatedCorpora`, contains the
  `Example (the defaults):` marker, and contains no line outside that example asserting
  `docs/domain` or `specs/**` as a requirement.
  *Satisfies:* FR-5 (DR-090).
  *Done when:* the assertion passes and fails when the old header line
  `docs/domain/*.md must have` is restored.

## Out of this build

- Declaring this repository's `docs/domain` and `docs/decisions` corpora in its own config,
  and retiring the `validate.py` entry in `KNOWN_DRIFT`: #2390 (CQ-3 `d`).
- The refresh half of #1698 (report a replaced managed region, hold an edited one) and a
  home for cross-field rules: #2615 (CQ-2, CQ-4). #1698 stays open.
- The shell (`awk`) tier reading config: SPEC-276.
- The Node validator and `loadConfig` on a broken config: #1687 and #2001.
