---
id: SPEC-276
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a gate that checks a folder the project does not use passes silently
aspects: [harness, managed-files, gate, no-silent-gate, config, shell-tier, offline]
depends_on: []
relates_to: [SPEC-075, SPEC-218, "#2678", "#2675", "#1569", "#2684", "#1908"]
implements: none
implements_reason: >-
  Clarify answers are recorded but not ratified (D1 option a, D2 and D3 as recommended). Which
  files this spec will own is still decided at Plan; no recorded option names a new file, so
  implements stays none.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-276: The pre-commit shell tier never passes silently when a project has moved its specs or decisions folder

> **This is a SPECIFICATION ONLY.** Written for issue #2678 (the shell tier matches `specs/` and `docs/decisions/` literally). Nothing is built until a human approves it. Part of #2675 (the RCDD on values baked into managed files). The spec id was taken as highest-on-disk plus one; open pull requests are invisible from this checkout, so run the id collision gate before approving.

## The defect, measured

`minspec_shell_gate` in the shipped pre-commit hook matches `specs/*.md` and `docs/decisions/*.md` as literal `case` patterns (`packages/minspec/src/lib/template-registry.ts:1530`, `:1545`). Its own comment admits the limit (`:1563-1566`: "a project that has relocated its decisions directory is not covered"). Reproduced at `d14579d2` (issue report): with both folders moved via `.minspec/config.json`, the tier exits 0 for files with no frontmatter.

**Root cause (mechanism plus missing gate).** A managed-region template is a fixed string rendered with no project input (`template-registry.ts:977-982`), and POSIX shell cannot parse the JSON config. So the tier cannot learn the project's folders. The missing gate: nothing detects "config names folders the tier does not cover" and refuses; the tier degrades to a pass. That is a silent gate (constitution invariant 2).

**Reach.** The shell tier runs only when neither the Node validator nor a working Python interpreter is available (`template-registry.ts` tier order: node, python, shell). #1569 tracks the shell tier being unreachable where python3 exists, so today the exposure is narrow, but it is exactly the environment with the fewest other witnesses. Once SPEC-075 (validator reads its folders from config) is built, the Python tier honours relocated folders and the shell tier does not: the two tiers disagree on the same commit.

## Functional requirements

- **FR-1 Detect a relocated folder.** Before matching any staged file, the shell tier determines whether `.minspec/config.json` names a specs folder or decisions folder other than the literal defaults (`specs`, `docs/decisions`), using only POSIX shell and awk/grep/sed (no Python, no Node, no network; invariant 1).
- **FR-2 Never pass silently.** If a relocated folder is detected, or the config exists but the tier cannot determine the folders (unparseable, unreadable, key present in a shape the tier cannot read), the tier does not exit 0 on the strength of the literal patterns alone. It fails closed with a visible message on stderr naming the config key, the folder it saw, and the bypass (`MINSPEC_GATE_OFF=1`), unless FR-3 applies.
- **FR-3 Optional: honour the folders.** If Decision D1 selects option b, the tier instead matches the configured folders and enforces the same frontmatter rules as for the defaults.
- **FR-4 Default layout unchanged.** With no config, or a config naming the default folders, behaviour is byte-for-byte what it is today: same patterns, same messages, same exit codes.
- **FR-5 Tiers agree.** For any staged file and any config, the shell tier's verdict (pass/fail) is never more permissive than the Python tier's after SPEC-075 lands. A parity test pins this.
- **FR-6 Stale comment removed.** The `:1563-1566` comment is rewritten to state the new behaviour; no "known limit" prose survives that the code no longer has.
- **FR-7 Managed region stays project-independent.** The fix adds no per-project rendering to the managed region; it reads config at hook run time, so *Refresh Harness Files* output stays byte-stable across projects (the property `template-registry.ts:977-982` pins).

## Acceptance criteria

- **AC-1** Fixture project with `specsDir` and `decisionsDir` moved in config, a staged file under the moved folder with no frontmatter, Node and Python tiers forced unavailable: the hook exits non-zero (option a) or reports the missing `id:` (option b). Distinguishing test: red at base (exit 0), green at head.
- **AC-2** Same fixture with frontmatter present: option a still refuses with the visible message; option b exits 0.
- **AC-3** Malformed `.minspec/config.json`, shell tier forced: exits non-zero with a message naming the config path. Never exit 0.
- **AC-4** No config / default-folder config: existing shell-tier tests pass unchanged (FR-4).
- **AC-5** Rendered managed region is identical for two different projects (FR-7).
- **AC-6** Parity test: for a matrix of configs and staged files, shell verdict is never more permissive than the Python verdict.

## Invariants this must not break

- Constitution invariant 1: no network call; reading a local config is offline.
- Constitution invariant 2: no silent gate. The change exists to restore it; a config read failure must fail closed, not pass.
- Constitution invariant 3: blast radius is the opted-in project. The hook already lives under `.minspec/`; read config only from the repo root's `.minspec/config.json`.
- The Node and Python tiers are untouched by this spec.
- Sibling rule: the same literal-path assumption must be hunted in other managed files (#2675); this spec fixes the shell tier only and does not close the family.

## Decisions needed (Clarify)

All 3 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

- **D1 - Recorded selection: Option a,** refuse visibly when config names other folders: a bounded
  grep on `"specsDir"` / `"decisionsDir"`, then a fail-closed message.
- **D2 - Recorded selection: the recommendation,** any of `specsDir`, `decisionsDir` or
  `validatedCorpora` naming a non-default folder counts as relocated under option a, so no
  precedence rule is needed.
- **D3 - Recorded selection: the recommendation,** yes, build the refusal now, even if #1569 makes
  the shell tier rarely reached.

### D1: refuse, or read the folders?

- **a: Refuse visibly when config names other folders (rec).** Detect with a bounded grep on `"specsDir"` / `"decisionsDir"`; fail closed with a clear message. Smallest change, no JSON parsing in shell, cannot disagree with Python by being more permissive. Cost: a project with moved folders that lands in the shell tier cannot commit spec/DR changes without `MINSPEC_GATE_OFF=1` until it installs Python or Node; the gate refuses rather than checks.
- **b: Extract the folder values with grep/sed and match them.** Gives real enforcement. Cost: hand-parsing JSON in shell is fragile (escaped characters, nested or duplicated keys, comments), and a parse mistake is a new silent-gate risk, so it needs FR-2's fail-closed on any doubt, and larger test surface.
- **c: Have `Refresh Harness Files` render a sidecar file (e.g. `.minspec/hooks/folders.sh`) the hook sources.** Shell-readable source of truth. Cost: a second copy of config that can drift from `config.json`, and a new managed file to own, which widens the change beyond this issue.

### D2: key names and precedence with SPEC-075

SPEC-075 introduces `validatedCorpora`; the existing config keys are `specsDir` and `decisionsDir` (`active-spec.ts:21`, `adr-manager.ts:91`). Which does the shell tier consult, and which wins if both name the folder? Recommendation (rec): treat the presence of any of the three keys naming a non-default folder as "relocated" under option a, which needs no precedence rule. Cost: over-refuses a project whose `validatedCorpora` merely adds an extra folder and keeps the defaults; that case needs the key's value inspected, which pushes toward option b.

### D3: exit semantics vs #1569

If #1569 is fixed so the shell tier is rarely reached, is the refusal still worth building now? Recommendation (rec): yes, the tier is the last witness where it does run and the fix is small. Cost: effort spent on a path that may become near-dead.

## Out of scope

Making Python the preferred tier (#1569); other values baked into managed files (#2675 siblings); the Node and Python tiers.
