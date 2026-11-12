---
id: SPEC-136
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-136 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - the checks are the methodology; this makes them reachable where no editor runs
relates_to: [SPEC-076, SPEC-096, SPEC-139, DR-014, DR-037, DR-066, DR-074, "#248", "#562", "#2263", "#2297", "#2702", "#2708"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-136 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
suite green, and names the requirement IDs it satisfies, the files it touches and the test
that proves it. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), which no task edits.

Every backticked path in this file is a file a task edits or creates. Files a task only
reads are named in prose. Paths not in requirements.md's `implements:`/`affects:` are
listed with their reason in design.md, *Files*.

Shared rules for every task:

- No operation holds a rule of its own (FR-2): it calls the library function named in
  design.md, *The operations*. If a needed function is private, the task exports it; it
  never copies the body.
- Tests build the bundle themselves with `buildCore` from `packages/core/build.mjs` into a
  temp directory. CI runs `npx vitest`, so nothing may rely on a `pretest` build.
- Every new check has a negative control in the same test that shows it can go red.
- Run `npx vitest run packages/core` and then the whole suite, `npm run lint`,
  `npm run typecheck` and `npm run validate` before calling a task done.
- A task that touches `template-registry.ts` or `.github/` is review machinery: its pull
  request needs a human merge.

## 1 - Decision record: MinSpec has a machine-facing command line (Costly to Refactor 2, FR-12)

- [ ] **1.1** `docs/decisions/DR-NNN.md` (number from the collision gate, scripts/check-dr-id-collision.ts,
  never from the files on disk) and `docs/decisions/INDEX.md` - record the founder's
  2026-10-13 answer quoted in requirements.md (a command line, for hooks, workflows and
  agents only; no MinSpec text tells a person to type it), how it squares with goal G-7
  and CLAUDE.md's "a VS Code extension, not a CLI", and the result-schema stability rule
  (`minspec-core/0` is unstable). Cite SPEC-136 and its build issue.
  *Done when:* `npm run validate` passes and the record carries `## In plain terms`.

## 2 - Decision record: the ZCode container boundary (BND-1 to BND-6)

- [ ] **2.1** `docs/decisions/DR-NNN.md` and `docs/decisions/INDEX.md` - record BND-1 to
  BND-6 as a founder decision that outlives this spec, quoting his 2026-10-13 words from
  requirements.md, with measurement 12 as the check that the running container matches.
  *Done when:* as 1.1.

## 3 - The package and the bundle, with the editor-free test (FR-1, FR-13, INV-5)

- [ ] **3.1** `packages/core/package.json` (`@aiclarity/minspec-core`, private, no
  `dependencies`), `packages/core/tsconfig.json`, `packages/core/build.mjs` exporting
  `buildCore({ outfile, metafile, entry? })` (esbuild, platform node, CommonJS, one file,
  `define` for the version stamp per design.md, *The result envelope*), and
  `packages/core/src/cli.ts` answering `--version` only.
- [ ] **3.2** `package.json` (root) - add `tsc --noEmit -p packages/core/tsconfig.json` to
  `typecheck`. The workspace glob `packages/*` already includes the package.
- [ ] **3.3** `packages/core/tests/no-editor-import.test.ts` - the metafile scan and the
  empty-directory run from design.md, *Testing*, with the `diagnostics.ts` control.
  *Done when:* the test is green, the control is red, and `npm run typecheck` passes.

## 4 - The operation table, the envelope and `hash` end to end (FR-5 hash, FR-8, FR-9, FR-16)

- [ ] **4.1** `packages/core/src/operations.ts` - the `Operation` type, `Effect`,
  `toolAnnotations`, `offeredAsTool`, `CoreResult`, exit-code map, `requireOptedIn`, and
  the `hash` entry calling `specHash` and `getApprovalStatus`.
- [ ] **4.2** `packages/core/src/cli.ts` - parse `<operation> [--root] [--spec]` against
  the entry's `input` schema; print one envelope as JSON on stdout; `--list` prints the
  table's names and summaries. An unknown operation or bad flag is `refused` with exit 2.
- [ ] **4.3** `packages/core/tests/operations-parity.test.ts` - `hash` equals `specHash`
  of the same file, `coreVersion` is present and stamped; and
  `packages/core/tests/boundary.test.ts` - the FR-8 case: a folder without `.minspec/` is
  refused with exit 2 and `not-a-minspec-project`, never a pass.
  *Done when:* both tests are green.

## 5 - `status` and `next` (FR-5, FR-2)

- [ ] **5.1** `packages/core/src/operations.ts` - the `status` entry (`listSpecs`,
  `getApprovalStatus`, `explicitTerminalOf`, `deriveStatus`) and the `next` entry
  (`buildArtifactGraph`, `resolveNextTask`, `formatNextTaskLabel`).
- [ ] **5.2** `packages/core/tests/operations-parity.test.ts` - for the fixture project,
  both payloads equal the library functions' direct results; `next` agrees with what
  scripts/next-task.ts reports for the same root.
  *Done when:* green.

## 6 - `validate`, per spec (FR-2, FR-5, FR-9)

- [ ] **6.1** `packages/core/src/operations.ts` - the `validate` entry: for each spec from
  `listSpecs`, `readSpecFile` then `validateSpec` with the option assembly
  commands/validate.ts uses (`knownEpicRefs`, `approvalState`, `explicitTerminal`,
  `siblingShardFiles`, `pathExists`). An unreadable spec is an `error` finding naming the
  file. `outcome` is `fail` on any error-severity finding.
- [ ] **6.2** `packages/core/tests/operations-parity.test.ts` - findings equal
  `validateSpec`'s violations for each fixture spec; an unreadable spec makes the command
  line exit non-zero with the file in the envelope.
  *Done when:* green.

## 7 - `validate`, corpus rules (FR-3, first half)

- [ ] **7.1** Re-read each row of design.md's *corpus rules* table against
  `scripts/validate-frontmatter.ts`; fill in rule 21's row. If a row is wrong, correct the
  table in `specs/minspec/SPEC-136-headless-core/design.md` in this pull request.
- [ ] **7.2** `scripts/lib/domain-doc-rules.ts` (new) and `scripts/validate-frontmatter.ts`
  - move the inline rule 1+3+4 body into an exported function the script then calls, with
  no change in its messages or exit behaviour. Do the same for spec `id:` if 7.1 finds
  `validateSpec` does not check it.
- [ ] **7.3** `packages/core/src/operations.ts` - call every "Yes" row's function after the
  per-spec pass, at the script's severity.
- [ ] **7.4** `packages/core/tests/operations-parity.test.ts` - one fixture per "Yes" row
  that trips it; the core reports it at the script's severity.
  *Done when:* green, and `npm run validate` on this repository is unchanged in output.

## 8 - `validate` finds everything the Python validator finds (FR-3, AC "Same verdicts")

- [ ] **8.1** `packages/core/tests/operations-parity.test.ts` - render `VALIDATE_PY` from
  `template-registry.ts` into a temp fixture; plant one instance of each Python finding
  (spec `id:` missing, malformed; ownership error and warning; DR `id:` missing, malformed;
  missing `## In plain terms`; domain doc without `type: domain`; an unreadable file); run
  `python3 validate.py` and the core; every Python `FAIL`/`WARN` line has a core finding on
  the same file. A missing `python3` fails the test with a message; it never skips.
  *Done when:* green; and removing one "Yes" call from 7.3 turns it red (record the output
  in the pull request).

## 9 - Read-only and one approval path (FR-6, FR-7)

- [ ] **9.1** `packages/core/tests/read-only.test.ts` - content-hash snapshot of the whole
  fixture tree including `.git/config`, before and after each of `validate`, `hash`,
  `status`, `next`; identical. FR-7: exactly one entry has `effect: 'approval'` and it is
  named `approve` (the entry is added in task 13; until then the assertion is that no entry
  has that effect, and task 13 changes it to exactly one); a test-only table with a second
  such entry fails the check.
  *Done when:* green, control red.

## 10 - `activate` (FR-5, FR-6)

- [ ] **10.1** `packages/minspec/src/lib/scaffold.ts` - export `ensureHooksPath`; no
  behaviour change. The extension's existing callers are untouched.
- [ ] **10.2** `packages/core/src/operations.ts` - the `activate` entry, `effect:
  'git-config'`, payload `{ hooksPath, previous }`.
- [ ] **10.3** `packages/core/tests/read-only.test.ts` - on a fixture clone, `activate`
  changes only `core.hooksPath` in `git config --local --list`, and every other file
  snapshot is unchanged.
  *Done when:* green, and the scaffold tests still pass.

## 11 - The tool server (FR-10, FR-11, FR-26)

- [ ] **11.1** `packages/core/src/tool-server.ts` - newline-delimited JSON-RPC 2.0 on
  stdio: `initialize`, `ping`, `tools/list`, `tools/call`; `notifications/initialized`
  ignored; `-32601` otherwise. Tools are `OPERATIONS.filter(offeredAsTool)` with
  `toolAnnotations`. Logs to stderr only. `packages/core/src/cli.ts` - `serve` starts it.
- [ ] **11.2** `packages/core/tests/operations-parity.test.ts` - drive a full session over
  pipes: `--list` and `tools/list` name the same operations less `approve`; one call per
  operation gives a deep-equal envelope both ways; every tool has annotations and none that
  writes is `readOnlyHint: true`. Control: a test-only table entry reachable one way only
  fails the check.
  *Done when:* green, control red.

## 12 - The boundary harness (FR-4, FR-10, FR-12, FR-17)

- [ ] **12.1** `packages/core/tests/boundary.test.ts` - the `--require` trap from
  design.md, *Invariants*: network modules, `fetch`, non-`git` child processes,
  `listen`/`dgram`, and `fs` paths outside the root and the bundle, each recorded to the
  original stderr fd before throwing. Run every operation through the command line and a
  full tool-server session with `HOME` set to an empty temp dir. No record; `HOME` still
  empty. Controls: planted `fetch`, `spawn('gh')`, read of `/etc/hostname`, a `listen`.
- [ ] **12.2** Same file - FR-12: every `minspec-core` string `template-registry.ts`
  renders sits inside a workflow or hook template.
  *Done when:* green, each control red.

## 13 - `approve` (FR-7, FR-19, FR-20, FR-25)

- [ ] **13.1** `packages/core/src/operations.ts` - the `approve` entry, `effect:
  'approval'`, running design.md's seven steps in order; each refusal has its own code
  (`not-a-minspec-project`, `already-approved`, `terminal-status`, `incomplete`,
  `not-ready-for-advance`, `approver-denied`). No commit, no phase-advance queue.
- [ ] **13.2** `packages/core/tests/vm-approval.test.ts` - fixture repo with a human
  `user.email`: one call approves, the derived status reads approved at once, and the
  changed paths are exactly the spec file, its sidecar and the `.git` baseline blob and
  `refs/minspec/snapshots/*` ref; no path under any session, presence, heartbeat or queue
  location. A bot address is refused before any write (tree snapshot unchanged).
  `approve` is not in `tools/list`, and `tools/call` with `approve` is an error. No
  operation's `input` schema has a ref or remote argument.
- [ ] **13.3** `packages/core/tests/read-only.test.ts` - change the FR-7 assertion from
  task 9 to "exactly one, named `approve`".
  *Done when:* green, and 12.1's harness passes with `approve` added to its run.

## 14 - The validate workflow runs the core (FR-15) - machinery, human merge

- [ ] **14.1** Read #562 and #2263 first and note in the pull request what each constrains.
- [ ] **14.2** `packages/minspec/src/lib/template-registry.ts` - in the validate-workflow
  template, replace the `npx --no-install @aiclarity/minspec-validator` branch with
  `node .minspec/bin/minspec-core.cjs validate` when that file exists, placed before the
  Python branch; update the "Looked for" message. The final no-validator branch still
  exits 1. Regenerate the repository's rendered copy with its generator, never by hand.
- [ ] **14.3** The existing workflow-template tests (the ones that pin
  minspec-validate.yml's branches and its fail-closed last arm) gain a case for the new
  branch and keep the no-validator case.
  *Done when:* green and the generator's `--check` passes.

## 15 - The scaffold puts the core in an adopter's repository (FR-15, AC "Adopter CI runs it")

- [ ] **15.1** `scripts/build-extension.sh` - also build `out/minspec-core.cjs` with
  `buildCore`, carrying the same stamp; `packages/minspec/.vscodeignore` (or `files:`) keeps
  it in the vsix.
- [ ] **15.2** `packages/minspec/src/lib/scaffold.ts` - on init and refresh, write
  `.minspec/bin/minspec-core.cjs` from the extension's bundled copy when it differs, as a
  managed file the refresh owns. No network.
- [ ] **15.3** A scaffold test: a scaffolded fixture has the file, `node` runs `validate`
  on it, and the rendered workflow's branch selects it.
  *Done when:* green, and a vsix built by `npm run package` contains the file.

## 16 - The release asset (FR-14) - machinery, human merge

- [ ] **16.1** A release workflow under `.github/workflows/` that, on a version tag,
  builds the bundle with `buildCore` and attaches `minspec-core-<version>.cjs` and its
  sha256 to the GitHub release. Every `uses:` pinned by SHA; no stored credential beyond
  the workflow's own token. If the DR-103 release workflow exists by then, add this as a
  job there instead of a new file.
  *Done when:* actionlint passes and a dry run on a test tag produces both files.

## 17 - The founder's measurements (requirements.md, *To measure before Plan*)

- [ ] **17.1** Founder only, inside ZCode and on the host: measurements 1, 3, 4, 5, 6, 8,
  11 and 12. Results go into design.md under a new *Measurements* heading with the ZCode
  version. No code task waits on this; the acceptance criteria "Usable in the VM",
  "The VM cannot reach a host-built repository" and "AI review is not skipped in ZCode"
  stay open until it is done.
