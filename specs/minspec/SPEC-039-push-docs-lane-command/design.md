---
id: SPEC-039
title: "Push docs via lane" — design
status: implementing
tier: T2
epic: EPIC-009  # Team Readiness — docs-lane push ergonomics (grain a of #575/#781)
---

# SPEC-039 — Design

## Modules
- `packages/minspec/src/lib/docs-corpus.ts` — **Tier-0, pure, vscode-free.**
  `export const DOCS_CORPUS = [...]` + `export function isDocsCorpusPath(rel: string): boolean`.
  Corpus regex mirrors the workflow: `^(specs/|docs/|\.minspec/approvals/|[^/]+\.md$)`.
  No fs, no git, no vscode — unit-testable in isolation (INV-2).
- `packages/minspec/src/commands/push-docs-lane.ts` — the command handler (network by
  nature — lives in commands/, not the Tier-0 lib). Ports `scripts/push-docs.sh` into TS
  using async `execFile` (promisified) with a 30s timeout per git/gh call, mirroring
  `approve-commit.ts`. Flow: resolve repo root → `git status --porcelain` → filter via
  `isDocsCorpusPath` → none ⇒ info toast + return → `showWarningMessage` modal confirm
  listing files + "This opens a pull request (network)." → temp worktree off `origin/main`
  (`git worktree add -b docs-lane/<sha>-<n> <tmp> origin/main`) → copy each file → commit
  with GIT_LITERAL_PATHSPECS + explicit paths → push → `gh pr create --label docs-lane`
  → `git worktree remove --force` in finally → success toast w/ PR url (open button).
  Every step wrapped; failures return a typed outcome surfaced as an advisory. Detect
  `gh` absent (ENOENT) and gh-not-authed (nonzero `gh auth status`) distinctly.

## Wiring
- Register `minspec.pushDocsLane` in `extension.ts` (match how existing commands register).
- `package.json`: add the command to `contributes.commands` (title "MinSpec: Push docs
  via lane"), a `contributes.keybindings` chord that does NOT clash with existing minspec
  keybindings (inspect them first; pick a free chord, document it in the command title
  tooltip is not possible — palette shows the keybinding automatically).

## Tests
- `packages/minspec/tests/docs-corpus.test.ts` — INV-2: corpus accepts specs/**, docs/**,
  .minspec/approvals/**, top-level *.md; rejects packages/**, src/**, .github/**, nested
  non-doc *.md (e.g. `packages/x/y.md`? decide: top-level only — `[^/]+\.md$` means no
  slash, so nested .md is rejected — test that).
- `packages/minspec/tests/push-docs-lane.test.ts` — the "no docs changes ⇒ info toast, no
  network, no git mutation" path with vscode + execFile mocked (INV-1/INV-4). Assert gh is
  never spawned when there are no docs changes and when the user cancels the confirm.
