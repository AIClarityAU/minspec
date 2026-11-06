---
id: SPEC-075
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-075 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity - a gate that validates a corpus the project does not have is a false signpost
relates_to: [DR-037, DR-066, DR-090, DR-086, SPEC-038, SPEC-066, SPEC-276, "#1698", "#2390", "#2391", "#2615", "#3266"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-075 - Design: the shipped validator reads its corpora from config

Plan for [requirements.md](requirements.md), built under its five recorded Clarify
selections (CQ-1 `a` a `validatedCorpora` map, CQ-2 no unmanaged region, CQ-3 `d` this
repository's own copy left to #2390, CQ-4 `f` no cross-field rules, CQ-5 `h` one read and
one outcome). Citations of "today" are against `origin/main` `91c103d1`, the commit this
plan was written on. New code is cited by symbol, because its line numbers move.

## Approach in one paragraph

All behaviour lives in `VALIDATE_PY`, the shipped template string in
`packages/minspec/src/lib/template-registry.ts`. The script reads `.minspec/config.json`
exactly once, at the top of `main()`, before it decides which files are in scope. A config
that exists and cannot be opened or parsed, or that parses into something the script cannot
interpret, ends the run with exit 1 and one `FAIL .minspec/config.json: ...` line (FR-2,
CQ-5). From the parsed config the script builds one list of corpora: three seeds that
reproduce today's hard-coded checks, then the project's `validatedCorpora` entries layered
on top. One membership function, `corpus_for`, decides for both entry points whether a file
is in scope and which rule applies, so the full run and `--pre-commit` cannot disagree
(FR-6). The three per-kind branches in `main()` (`is_spec`, `is_dr`, `is_domain`) collapse
into one generic frontmatter check; the two rules that are not frontmatter-shape rules (the
SPEC-038 ownership rule and the `## In plain terms` warning) stay attached to the corpus at
`specsDir` and the corpus at `decisionsDir` respectively.

## The config contract

```json
{
  "specsDir": "specs",
  "decisionsDir": "docs/decisions",
  "validatedCorpora": {
    "docs/runbooks": { "key": "type", "pattern": "runbook", "label": "runbook" },
    "docs/domain":   { "key": "type", "pattern": "domain|glossary" }
  }
}
```

Each `validatedCorpora` entry maps a repo-relative directory to one object:

| field | required | meaning |
|---|---|---|
| `key` | yes | the frontmatter key every `.md` under the directory must carry |
| `pattern` | yes | a Python regular expression the cleaned value must match in full (`re.fullmatch`) |
| `label` | no | how messages show the requirement (`missing \`<key>: <label>\` frontmatter`); defaults to the pattern |
| `exempt` | no | a list of file basenames under the directory that are not checked |

`re.fullmatch` rather than `re.match`: an unanchored pattern such as `SPEC-\d+` must not
accept `SPEC-1-draft`. A project cannot weaken a check by forgetting a `$`.

### Seeds: today's behaviour expressed in the same form (FR-1, FR-4)

`seed_corpora(config)` returns, in this order (today's walk order, so output order is
unchanged):

| seed path | key | pattern | label | exempt | extra rule attached |
|---|---|---|---|---|---|
| `specsDir`, default `specs` | `id` | `SPEC-\d+` | `SPEC-NNN` | none | SPEC-038 ownership (role `spec`) |
| `decisionsDir`, default `docs/decisions` | `id` | `DR-\d+` | `DR-NNN` | `INDEX.md`, `README.md` | `## In plain terms` warning (role `decision`) |
| `docs/domain` | `type` | `domain` | `domain` | none | none |

They are plain data in the same shape as a project entry, which is what FR-4's "no
privileged built-in path" asks for: the only thing a seed has that an entry does not is its
role, and a role is a property of the path, not of the rule (see precedence below).

### Precedence: which wins when two names point at one directory (CQ-1 cost)

The recorded CQ-1 selection costs "a second place the specs directory can be named". The
rule this plan fixes, and asserts in a test:

1. **`specsDir` and `decisionsDir` say where the role corpora are.** The seeds are built from
   them, so moving `specsDir` moves both the frontmatter rule and the ownership rule with it.
2. **A `validatedCorpora` entry whose normalised path equals a seed's path replaces that
   seed's rule** (`key`, `pattern`, `label`, `exempt`). The seed's role stays, because it
   belongs to the path. An entry is the more specific statement, made by the project about
   that one directory; `specsDir` names a location and says nothing about the id format.
3. **Any other entry is added** after the seeds, in the order the config lists it.
4. **No entry removes a seed.** Coverage cannot shrink by omission: a project that writes a
   `validatedCorpora` map with one extra folder keeps all three seeds (INV-1). A seed whose
   directory does not exist validates nothing and is not an error (AC-3).
5. **Overlap resolves to the longest matching path.** A file under both `docs` and
   `docs/decisions` is judged once, by `docs/decisions`'s rule. The full run de-duplicates
   its targets, so a file is never reported twice.

Paths are normalised before comparison: backslashes to `/`, a leading `./` and trailing `/`
removed. A path that is empty, `.`, absolute, or contains a `..` segment is malformed (the
same `escapes_repo` test the ownership rule already uses).

### What counts as malformed (FR-2's "for Plan", bounded by INV-1)

Each of these exits 1 with `FAIL .minspec/config.json: <reason>` and validates nothing:

- the file exists and `open` or `json.load` raises (`OSError`, `ValueError`, which covers
  `UnicodeDecodeError` and `json.JSONDecodeError`);
- the top level is not a JSON object;
- `specsDir` or `decisionsDir` is present and is not a non-empty string, or is a malformed
  path;
- `validatedCorpora` is present and is not an object;
- an entry is not an object; its `key` is missing, not a string, or empty; its `pattern` is
  missing, not a string, or does not compile; `label` is present and not a string; `exempt`
  is present and not a list of strings; its path is malformed.

Every reason names the offending key, for example
`FAIL .minspec/config.json: validatedCorpora["docs/x"].pattern does not compile (unbalanced parenthesis at position 3)`.
An unknown field inside an entry is ignored, as unknown top-level keys already are; it
cannot narrow coverage, so INV-1 does not reach it. `validatedCorpora: {}` "declares no
corpora" and keeps the seeds (FR-1).

Not malformed, deliberately: an absent config (FR-1, today's defaults for every rule, as
`ownership_declaration` already treats it), and a configured directory that does not exist
(AC-3).

## The one config read (FR-2, CQ-5, AC-7)

Today the config is read lazily inside the loop by `ownership_declaration(root)`
(template-registry.ts:1943-1960), which prints a `WARN` and carries on at `warn` when the file
does not parse (:1953-1958), and is called only on the first spec (:2162-2164). This plan:

- adds `load_config(root)`: returns `None` when the file is absent, the parsed object when it
  is usable, and raises `ConfigError(reason)` otherwise, with every check in the list above
  made inside it;
- calls it as the first statement of `main()` after `repo_root()`, before `staged_files`, so
  a commit that stages nothing still fails on a broken config (AC-7);
- changes `ownership_declaration` to take the already-parsed config (or `None`) and read
  `ownershipDeclaration` from it; it no longer opens the file, and its `WARN` line and the
  "Read on the first spec" comment (:2162-2163) are removed. A non-string or unknown value
  keeps today's meaning (`warn`), since SPEC-038 FR-7 defines only `error` as the ratchet.

`ConfigError` is caught in `main()` only, so there is exactly one place the outcome is
decided. The exit code is 1, the same code every other FAIL in the script uses.

## The generic frontmatter check

One function replaces the three per-kind blocks:

```text
check_frontmatter(norm, fm, corpus) -> list of FAIL lines
  value = clean_frontmatter_value(fm.get(corpus.key, ""))
  if not value:                         "missing `<key>: <label>` frontmatter"
  elif not fullmatch(pattern, value):   "invalid `<key>: <label>` frontmatter (got `<value>`)"
```

With the seeds above, the spec and decision messages are byte-identical to today's (AC-1).
One message changes: a domain file whose `type:` is present but wrong now reads
`invalid \`type: domain\` frontmatter (got \`x\`)` instead of today's
`missing \`type: domain\` frontmatter`. Today's text calls a present value missing, which is
a false signpost; the exit code and the set of failing files do not change, and no existing
test pins that case (searched: `pre-commit-python-tier-detection.test.ts:138` and
`dr037-hook-scaffolds.test.ts:563` both omit the key, so they still read "missing"). A test
in the owned file pins the new text.

## Scope parity (FR-6, AC-6)

`corpus_for(norm, corpora)` returns the longest-path corpus whose directory is a prefix of
`norm`, the file ends in `.md`, and its basename is not in that corpus's `exempt`; else
`None`. The full run builds its target list by walking each corpus directory with the
existing `all_md` and keeping only files `corpus_for` assigns to that same corpus (so an
overlap is walked twice but checked once). `--pre-commit` keeps `staged_files` and filters
by `corpus_for`. The two entry points therefore share one predicate, not two copies of it.

## Docstring (FR-5, DR-090)

The header stops listing `specs`, `docs/decisions` and `docs/domain` as facts about the
reader's repository. It says: the folders checked and the frontmatter each requires come
from `.minspec/config.json` (`specsDir`, `decisionsDir`, `validatedCorpora`); with none set,
three defaults apply, shown under a line beginning `Example (the defaults):`; a config that
exists but cannot be read stops the run. The ownership-rule, unreadable-file and
staged-listing paragraphs stay, since they describe the script's mechanism, not a corpus.

## What Plan found that the spec did not know

Checked against `91c103d1`:

1. **Line numbers moved.** The spec cites the corpus list at `template-registry.ts:2127-2131`
   and the config read at `:1927-1944`; today they are `:2149-2153` and `:1943-1960`. The
   behaviour cited is unchanged.
2. **A non-default `specsDir` widens coverage on upgrade.** FR-1 says a config that declares
   no corpora keeps "exactly what it validates today". For every project whose `specsDir`
   and `decisionsDir` are absent or at their defaults that holds byte-for-byte. A project
   that relocated `specsDir` is validated today at `specs/` (likely empty, so vacuously
   green) and will be validated at its declared folder after this change. This plan seeds
   from `specsDir`/`decisionsDir`, as CQ-1 `a`'s text says ("reuses `specsDir`/`decisionsDir`
   as the defaults that seed it"), and treats the widening as the fix the spec exists for,
   not a regression: INV-1 forbids narrowing, not widening. Rejected: seeding from literal
   `specs`/`docs/decisions` regardless of config, which keeps the drift between the config
   and the validator that "Why this is invariant 2" names as the defect.
3. **The shell tier does not read config.** The scaffolded `pre-commit` hook falls back to an
   `awk` gate when `python3` is absent, and that gate hard-codes `specs/*.md` and
   `docs/decisions/*.md`. It is outside this spec's file set and is the subject of SPEC-276
   (shell tier refuses relocated folders). Not changed here.
4. **`MinspecConfig` gains no `validatedCorpora` field.** The key has one reader, the shipped
   Python script; `packages/minspec/src/lib/config.ts` is not in this spec's `affects:` and
   nothing in the extension reads the key. `loadConfig` already carries keys it does not
   type, without reading them. Adding the field is left to whichever spec first reads it from TypeScript (the Node
   validator side is #2390 and #1687's territory).
5. **This repository's own files are not touched.** `.minspec/hooks/validate.py` and
   `.minspec/config.json` are under `affects:`, but CQ-3's recorded selection `d` puts
   declaring this repository's corpora in #2390. The `KNOWN_DRIFT` waiver for
   `validate.py` in `managed-region-self-application.test.ts:74-75` stays, and keeps
   asserting the drift, so it cannot be forgotten.

## Rejected alternatives (DR-086 section 4)

| Question | Built as | Rejected, and why |
|---|---|---|
| `validatedCorpora` replaces the seeds when present | Layered on top; no removal | A project adding one folder would silently drop spec and DR checking, the exact narrowing INV-1 forbids |
| An explicit `false` entry to drop a seed | Not offered | New surface with no current need; an absent folder already costs nothing (AC-3). Can be added later without breaking any config |
| `re.match` / `re.search` for `pattern` | `re.fullmatch` | An unanchored project pattern would pass prefixes and substrings; fail-closed by default |
| Keep `ownership_declaration` reading the file itself | One read in `main()` | Two reads with two failure rules is what CQ-5 `h` removes |
| Exit 2 for a config failure, 1 for a document failure | Exit 1 for both | Every caller (pre-commit hook, `minspec-validate.yml`) tests non-zero only; a second code adds a contract nobody reads |

## Testing

The T0 file this spec owns, `packages/minspec/tests/validate-py-corpus-config.test.ts`,
renders the real template with `renderManagedFile` (as `shipped-ownership-gate-2250.test.ts`
does) into a temp fixture repo and spawns `python3`, failing in CI when `python3` is absent
rather than skipping (the same guard that file uses). One `describe` per acceptance
criterion, plus:

- **the vacuous-pass control** the spec's Test section requires: a config declaring a corpus
  whose directory is absent, alongside an invalid file placed in an undeclared directory, must
  exit 0; the same invalid file moved under a declared directory must exit 1. A suite that
  never finds a file cannot pass both;
- **the CQ-1 precedence case:** `specsDir: "specs"` plus an entry for `specs` with a
  different pattern; the entry's pattern decides, and the ownership rule still fires;
- **the malformed-entry cases**, one per bullet above, each asserting exit 1 and the key
  named in stderr;
- **AC-1 pinned literally:** the expected stderr for the no-config fixture is captured from
  the unchanged template in the first task and written into the test as a string, so every
  later task is held to it.

`shipped-ownership-gate-2250.test.ts:284-290` is rewritten to AC-4's outcome (exit 1, the
config named, no `WARN` line), not deleted (requirements.md, Test).
