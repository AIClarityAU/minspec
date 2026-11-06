---
id: SPEC-211
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-211 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: specifying
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-097, "#2371", "#2163", "#2901", "#1941"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-211 - Tasks

The order below is the order of work. Each task names the file it changes and what an
outside observer checks to call it done. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md). One pull request; it touches `.github/`, so it merges by
human `--admin`.

Every backticked path in this file is a file this change edits, creates or deletes. Files it
only reads are named in prose, so the spec gate's ownership signal stays as narrow as the
change.

## 1 - T0: the two gates, red before any port

- [ ] **1.1** `.github/scripts/ai-review-guard.test.js` - add the [A] helpers from the design
  (lexer, use test, `findUnusedExports`, `collectTestTitles`, `findUnresolvedCitations`,
  `EXPORT_GATE_EXEMPTIONS` with the one `parseCliVerdict` entry) and the [B] self-tests:
  a planted unused name is reported; an import-list entry and a title alone are not use; a
  call and a member access are use; a stale and an unexported exemption are reported; an
  empty export set and a `null`/`undefined`/empty source report failure; an unterminated
  string reports failure; regex-versus-division inputs lex correctly, including `(a) / b(c)`
  (division, `b(` stays code) and `if (x) /foo(/.test(s)` (regex, `foo(` removed); an invented citation
  is unresolved; a source with zero citations reports failure.
  *Done when:* every [B] case is green.
- [ ] **1.2** Same file - add the two [C] live cases.
  *Done when:* run on a tree where only 1.1 and 1.2 have landed, the export case fails
  naming exactly `selectVotersToRun`, `renderVoterRecord`, `parseVoterRecords`,
  `isStructuralVerdictBlock`, `renderVerdictBlock`, `defangProtocolTokens`, and the
  citation case fails on zero citations. The output is quoted in the pull request body as
  the red-before evidence. Do not commit 1.1 and 1.2 while 1.2 is red: CI
  (the ci.yml lint job, line 113) and `npm test` (the #871 parity test) both run the shipped
  suite, so a red commit breaks bisect and blocks any push between tasks. Record the output,
  then commit 1.1 and 1.2 in the same commit as the ports in 2.1 and 2.2, once green.

## 2 - T1: the ports, written against the unchanged guard

- [ ] **2.1** Same file - port the 32 cases of the voter-reuse vitest file (5 round-trip,
  15 `selectVotersToRun`, 12 `isStructuralVerdictBlock`) under the design's title scheme,
  with a named case for each of the seven FR-1 guard rails.
  *Done when:* all 32 pass with the guard unchanged, and a grep of every quoted `it(` title
  in the vitest file finds its prefixed counterpart in the shipped suite (so non-rail cases
  such as app-slug lower-casing are not dropped); a case that fails is a `DEEPER:` stop,
  not a guard edit (INV-1).
- [ ] **2.2** Same file - port the 13 cases of the protocol-token vitest file: the
  token-shape case, the ten (site, token) cases over the four sites, each with a literal
  title per the design, and the two `defangProtocolTokens` cases, reading siblings relative
  to the suite and failing by name on an unreadable one; plus the case asserting the ten
  literal titles cover every (site, token) pair.
  *Done when:* all 13 pass with the same title grep as 2.1, the coverage case passes, and the
  export case from 1.2 now fails on nothing. Commit 1.1 to 2.2 here, together.

## 3 - Comments and citations

- [ ] **3.1** `.github/scripts/ai-review-guard.js` - rewrite the four comments in the design
  table into the citation form. Comments only.
  *Done when:* the FR-4 grep in requirements.md prints nothing, the citation case from 1.2
  passes with at least three citations resolved, and the INV-1 esbuild comparison and
  export-name comparison are identical at the merge base and at head.

## 4 - Single copy of each case

- [ ] **4.1** Delete `packages/minspec/tests/voter-survivor-reuse.test.ts` and
  `packages/minspec/tests/review-protocol-tokens.test.ts`.
- [ ] **4.2** `docs/decisions/DR-097.md` - repoint its two citations of the deleted voter
  file to the shipped suite, keeping the `#2163 @ <sha>` addresses. No other wording.
  *Done when:* the FR-3 `git grep` in requirements.md returns only lines carrying a
  `#2163 @ <sha>` address.

## 5 - Generated copy and full verification

- [ ] **5.0** `packages/minspec/src/lib/template-registry.ts` - update the comment on the
  `ai-review-guard-test` entry to name all four sibling files the shipped suite reads
  (ai-review.yml, docs-lane.yml, scripts/review-decide.sh and scripts/review-branch.sh).
  Comment only.
  *Done when:* the comment names the four, and the managed-script-dependencies test passes.
- [ ] **5.1** Regenerate `packages/minspec/src/lib/ci-review-templates.ts` with
  `node scripts/gen-ci-templates.mjs`; never by hand.
  *Done when:* `node scripts/gen-ci-templates.mjs --check` and `npm run validate` exit 0.
- [ ] **5.2** Run the scratch-copy mutations in the acceptance criteria (dummy export,
  stripped `selectVotersToRun` calls, stale `parseCliVerdict` exemption, invented citation),
  each beside a clean control, in a directory outside the worktree; discard the copies.
  Then measure which guard constants the suite still never references, and confirm each
  protocol-relevant one is named in #1941 (`VERDICT_SCHEMA` is); the rest stay on the
  2026-10-18 backlog line.
- [ ] **5.3** `npm test`, `npm run lint`, `npm run typecheck`; the #871 parity test and the
  managed-region enumeration test pass.
- [ ] **5.4** Pull request body: the red-before output from 1.2, the rail-to-title table,
  the 32 + 13 vitest-to-shipped title mapping, the INV-1 comparison output, the mutation
  results. Set `phases.implement` to `done` in all three files of this spec only after the
  pull request's checks are green.
