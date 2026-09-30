---
id: SPEC-076
type: design
status: specifying
product: minspec
epic: EPIC-002  # Signpost Integrity
---

# SPEC-076 — Design / Plan

> Requirements are authoritative in [requirements.md](./requirements.md). This file is the
> plan phase: the concrete contract, the build order, and the choices that were closed off.

## Shape

One new file, `scripts/next-task.ts`, invoked through one new npm script:

    "next-task": "npx tsx scripts/next-task.ts"

Mirrors `"facts": "npx tsx scripts/facts.ts"` exactly. `tsx` is already a devDependency, so
the dependency budget spend is **zero** (FR-8). Usage:

    npm run next-task                          # the working directory
    npm run next-task -- ~/code/sealbox ~/code/ColdForge

The `--` is required by npm to pass positional arguments through; the script also runs
directly as `npx tsx scripts/next-task.ts <root>...`, which is the form a supervisor
should prefer since it avoids npm's own stdout noise (see "Keeping stdout pure" below).

## Contract

The stdout document. `results` is positionally aligned with the roots as given (FR-3):

```ts
interface HeadlessSignpostReport {
  tool: 'minspec-next-task';
  contractVersion: 1;
  results: RootResult[];
}

type RootResult = RootAnswer | RootFailure;

interface RootAnswer {
  root: string;            // as given, plus `resolvedRoot` when they differ
  resolvedRoot: string;
  ok: true;
  tree: TreeState | null;  // null only when git is unavailable; `treeNote` says why
  treeNote?: string;
  task: NextTask | null;   // null = this project has nothing pending (FR-2)
  label: string;           // formatNextTaskLabel(task) - 'clear' when task is null
}

interface TreeState { head: string; dirty: boolean }

interface RootFailure {
  root: string;
  resolvedRoot: string;
  ok: false;
  error: { code: FailureCode; message: string };
}

type FailureCode =
  | 'not-a-minspec-project'   // no <root>/.minspec/ — FR-2, the measured defect
  | 'root-not-found'          // path absent or not a directory
  | 'resolver-failed';        // buildArtifactGraph/resolveNextTask threw
```

`NextTask` is imported from `packages/shared/src/next-task.ts` and re-emitted **unchanged**.
It is not reshaped, flattened or renamed, so the JSON carries `kind`, `targetId`,
`imperative`, `severityClass` and the full `evidence` object including `rule` and `refs` — the
resolver's own explanation of why, which is the part a supervisor needs in order to act.

Exit codes (FR-6): `0` all roots answered · `1` at least one failed · `2` usage error,
including the zero-resolved-roots case.

## Build order

T0 invariant tests first, then the script (T0-first, per the contract-driven pre-coding
checklist - that checklist lives in the mmo-platform register, which this repo does not
share, so it is cited by name rather than by a number that resolves to nothing here):

1. **T0 tests** — `packages/minspec/tests/headless-signpost.test.ts`, the eight cases in
   requirements.md § Test. Written, and failing, before step 2.
2. **Marker check + single root** — the FR-2 discrimination and the `RootAnswer` shape. This
   is the thinnest end-to-end slice: one root, one answer, correct refusal.
3. **N roots + per-root isolation** — the loop, ordering, and exit-code aggregation.
4. **Tree state** — FR-4's `HEAD` sha and dirty flag, degrading visibly to `tree: null`
   plus `treeNote` rather than failing the root.
5. **npm script line.**

## Decisions closed in this plan

**Import source, not the built package.** `import { resolveNextTask } from
'../packages/shared/src/next-task'` rather than from `@aiclarity/shared`. The workspace
package resolves through `main: out/index.js`, which does not exist until
`npm run build --workspace=@aiclarity/shared` has run, so importing the package would make
the reader fail on a fresh checkout for a reason that has nothing to do with the question
asked. `scripts/facts.ts:54` already sets this precedent.

**The marker check is `.minspec/` presence, not config readability.** FR-2 asks whether the
repo opted in, and DR-074 names `.minspec/` at the repo root as the opt-in marker. A repo
with `.minspec/` but a malformed `config.json` has still opted in, and `loadConfig` already
falls back to defaults for it; that is a different condition from never having opted in, and
conflating them would re-introduce the ambiguity FR-2 removes. Only the directory's existence
is tested.

**No `--json` flag, because there is no other mode.** JSON is the only output. A human-readable
mode would be a second renderer of the same answer and the beginning of the drift FR-1
forbids; `label` is already the human-readable string, produced by the extension's own
`formatNextTaskLabel`.

**No caching, no watch mode.** Both invite a stale answer, which for a never-wrong signpost is
the worst failure. Each run reads the tree.

**Keeping stdout pure (FR-5).** `npm run` prints its own banner lines to stdout, which would
break `npm run next-task | jq`. Two consequences, both deliberate: the script itself writes
only the JSON document to stdout, and the documented machine-consumption form is
`npx tsx scripts/next-task.ts <root>...` — the npm script exists for discoverability and
for a human at a terminal. The AC-5 test asserts purity against the direct `tsx` invocation,
which is the form the contract covers.

## What this plan deliberately does not do

- **No write path.** Creating or advancing anything headlessly is #1948's scope, not this
  spec's. The reader stays read-only, which is what keeps INV-3 and the G-7 editor-native
  claim intact.
- **No pipeline / full list.** `resolvePipeline` exists in the same module and returns the
  whole ordered set, but FR-5 of SPEC-012 is explicit that the signpost is one task and never
  a list. Exposing the pipeline headlessly is a separate question with its own G-4 risk.
- **No multi-root discovery.** The reader does not scan a parent directory for projects
  carrying `.minspec/`. Roots are named explicitly, so the reader never answers for a repo the
  caller did not ask about.
