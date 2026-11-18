---
id: SPEC-066
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-066 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity - a shipped file asserting a false fact is a false signpost
relates_to: [DR-090, "#1108", "#1098", "#1486", "#3263"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-066 - Tasks

The order below is the order of work. Each task is one agent run: one concern, a few files,
its own test, and green on landing, so no task leaves a red required check on `main`. The
plan is [design.md](design.md); the contract is [requirements.md](requirements.md).

Every backticked path in this file is a file this change edits or creates. Files it only
reads (the scaffold module, the tool detector, the generator script, the
machinery-comment-localization and managed-script-dependencies suites) are named in prose,
so the spec gate's ownership signal stays as narrow as the change.

Common to every task that edits a shipped source (tasks 4 to 7): re-run the generator
(node scripts/gen-ci-templates.mjs) in the same commit, which rewrites
`packages/minspec/src/lib/ci-review-templates.ts`, and confirm `npm run validate` is green
(its staleness check fails a stale embed). Those tasks edit files under scripts and
.github/workflows, so their pull requests take the machinery merge path.

## 1 - T2: the extractor, synthetic cases only

- [ ] **1.1** `packages/minspec/src/lib/prose-vantage.ts` (new, owned) - `extractProseRefs`
  and its prose-block splitter for `hash` (comment runs and Python triple-quoted blocks),
  `slash` (line and block comments) and `html` (Markdown paragraphs); the token grammar,
  URL and bare-`.md` rejection, placeholder skip, and 1-based line numbers over the shipped
  bytes, per the design's module section. No `fs`, no `vscode` import.
  Satisfies FR-2, FR-3, FR-5, INV-4.
  Test: `packages/minspec/tests/managed-prose-vantage.test.ts` (new, owned) - a
  `describe('extractProseRefs')` block with one synthetic case per comment style, one for a
  Python docstring path, one each for a qualified path, a bare `.py` name, a bare `.md` name
  (not a ref), a URL (not a ref), and each FR-5 placeholder form (`NNN`, `${...}`, `<...>`,
  `roles/X.md`), plus a line-number case with a preamble line before the block.
  *Done when:* those cases pass, and the module has no import other than a type import.

## 2 - T1: foreign detection and attribution, both directions

- [ ] **2.1** `packages/minspec/src/lib/prose-vantage.ts` - `unattributedForeignRefs`, the
  exported attribution pattern constant (exactly `minspec(?:'s own)? repo`, case-insensitive,
  per the design's OQ-1 row), qualified-path membership and bare-name basename matching
  against the passed `universal` set. Satisfies FR-3, FR-4 (the matching half), FR-6.
  Test: same suite - a `describe('unattributedForeignRefs')` block: the INV-3 positive
  control (an unattributed foreign ref is returned; the same block with "in the minspec repo"
  added returns nothing; the pattern matches "minspec's own repo" and does not match
  "upstream"), a qualified path present in `universal` passes, a bare name whose basename is
  in `universal` passes, and attribution in a different block of the same file does not
  cover the ref.
  *Done when:* those cases pass; deleting the membership check fails the reject case
  (record the mutation result in the pull request body, AC-2).

## 3 - T2: `localize` moves onto the registry

- [ ] **3.1** `packages/minspec/src/lib/template-registry.ts` - add the optional `localize`
  field to `ManagedRegionTemplate` with the contract's doc comment; add the `applyLocalize`
  normaliser and apply it where the CI review stack array is defined; change the ai-review
  entry to raw `content: AI_REVIEW_WORKFLOW` plus `localize: localizeMachineryPathsComment`
  (the function itself unchanged). Satisfies FR-7, FR-8.
- [ ] **3.2** `packages/minspec/tests/managed-region-templates.test.ts` - drop `localize`
  from `CI_STACK` and read `tpl.localize` from the registry entry in the byte-identity
  comparison; add the two AC-5 assertions from the design (every hook changes today's source
  and throws on an empty string; the ai-review entry carries a hook). Satisfies AC-5.
  *Done when:* this suite, the machinery-comment-localization suite and the
  managed-script-dependencies suite all pass unedited apart from this file; and, as a
  recorded mutation, deleting the `localize` line from the ai-review entry fails this suite.

## 4 - T1: the canonical hasher's docstring

- [ ] **4.1** `scripts/hooks/canonical.py` - rewrite the module docstring so the Node twin,
  the spec-gate hook and the corpus-parity test are named as the minspec repo's, and the
  "Keep the two in lockstep ... or INV-2 fails" sentence no longer implies a guard in the
  receiving repo. Docstring only; no code line changes. Satisfies FR-9 (AC-4 row 1).
  Test: same vantage suite - an AC-4 case for the canonical-hasher template:
  `unattributedForeignRefs` over its `renderManagedFile` output, against the scaffolded
  universal set built by the design's `beforeAll`, is empty. The `beforeAll` (temp dir, six
  tool marker files, `generateHarnessFiles`, walk) and its anti-vacuity assertion land here,
  in the suite, as its first live use. Satisfies FR-4 (the derivation half).
  *Done when:* the AC-4 case passes, the scaffold-and-load case in the
  managed-script-dependencies suite still passes (the module still imports), and the
  generated embed is fresh.

## 5 - T2: the four role files' provenance blocks

- [ ] **5.1** `scripts/roles/reviewer.md`, `scripts/roles/security.md`,
  `scripts/roles/architect.md`, `scripts/roles/skeptic.md` - in each Provenance section,
  attribute the vendored-base paths, the lock file and the sync script to the minspec repo
  (attribution, not `localize`, per FR-9's default). Locate each block by its "Provenance"
  heading, not by the line numbers in AC-4, which have moved (design finding 1). Satisfies
  FR-9 (AC-4 rows 2 to 5).
  Test: same suite - one AC-4 case per role template, as in 4.1.
  *Done when:* the four cases pass and the generated embed is fresh.

## 6 - T1: agent-context and docs-lane claims

- [ ] **6.1** `scripts/lib/agent-context.sh` - every "Enforced by
  packages/minspec/tests/..." comment (two today) states that the test is the minspec repo's,
  so it no longer claims a test the adopter has. Comment lines only.
- [ ] **6.2** `.github/workflows/docs-lane.yml` - the "kept byte-identical to ..." comment
  attributes the paired file and the lock-step pin to the minspec repo. Comment lines only.
  Satisfies FR-9 (AC-4 rows 6 and 7).
  Test: same suite - one AC-4 case for each of the two templates.
  *Done when:* both cases pass, the generated embed is fresh, and the docs-lane suites and
  the agent-context suites pass unedited.

## 7 - T1: the vantage rule ships to the reviewers

- [ ] **7.1** `scripts/roles/skeptic.md`, `scripts/roles/architect.md` - add the vantage rule
  as a checklist item: a managed file's prose may name only files the receiving repo has, or
  must say the file is the minspec repo's; a claim with no path token is the voter's to
  catch, because the gate cannot (FR-11's residual). Satisfies FR-10.
  Test: same suite - a case asserting both shipped role templates contain the rule's
  sentence, and the AC-4 cases for those two files still pass (the new text names no
  unattributed foreign file).
  *Done when:* those pass and the generated embed is fresh.

## 8 - T2: the live gate

- [ ] **8.1** `packages/minspec/tests/managed-prose-vantage.test.ts` - the suite header
  stating FR-11's limit; the INV-2 anti-vacuity cases (refs found inside the canonical
  hasher's docstring and in the reviewer role) placed before any pass/fail case; and the
  live gate, `it.each` over every registry entry, failing with `name:line token` per finding.
  Satisfies FR-1, FR-11, INV-1, INV-2, INV-5, AC-1, AC-2, AC-3.
  *Done when:*
  - green on the branch tip;
  - run against a checkout of cdd0820b's sources with this suite and the module copied in,
    it fails with at least seven findings covering every AC-4 row; the output is quoted in
    the pull request body as AC-1's red-before evidence;
  - AC-3, recorded: a scratch registry entry whose prose names an unscaffolded sibling
    fails naming that template, line and token (not committed);
  - `npm test`, `npm run lint` and `npm run validate` are green (AC-6, AC-7).

  If the live gate reports a finding in a managed file outside requirements.md's allowlist,
  output `DEEPER:` naming the files, file one `inbox` issue listing every such finding, and
  stop without landing 8.1: the allowlist is part of the approved requirements, and neither
  a wider edit nor an exception list (FR-6, INV-6) is open to this task.
