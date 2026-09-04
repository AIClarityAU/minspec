/**
 * #1486 — the shipped `ai-review.yml` must not claim coverage it does not have.
 *
 * The machinery-path comment block in `.github/workflows/ai-review.yml` is written from
 * MinSpec's own vantage: it says the classifier line below it is "Read by
 * packages/minspec/tests/machinery-paths.test.ts", and it lists MinSpec's own gate files
 * (`.githooks/`, `template-registry.ts`, `ci-review-templates.ts`) as live gate code. All of
 * that is true HERE. The workflow is also scaffolded verbatim into every consuming repo,
 * where none of those paths exist — so the copied comment asserts a guarantee that is not
 * there. A downstream skeptic voter (AIClarityAU/scroogellm PR #135) called it correctly,
 * and it could not be fixed downstream: the file is parity-held byte-for-byte against what
 * MinSpec emits, so an edit there drifts it and the next harness refresh overwrites it.
 *
 * `localizeMachineryPathsComment` rewrites those comment lines on the way out. This suite is
 * the gate on that rewrite, and it is deliberately behavioural rather than textual: it
 * EXECUTES the extraction the workflow's own test performs and compares the two patterns
 * character-for-character, and it diffs the shipped copy against the on-disk source line by
 * line to prove nothing but `#` comments moved. A source-text assertion ("contains the word
 * inherited") would pass for a rewrite that had silently mangled the classifier.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  MANAGED_REGION_TEMPLATES,
  localizeMachineryPathsComment,
} from '../src/lib/template-registry';

const WORKFLOW = path.resolve(__dirname, '../../../.github/workflows/ai-review.yml');
const MINSPEC_ONLY_TEST_PATH = 'packages/minspec/tests/machinery-paths.test.ts';

const onDisk = (): string => fs.readFileSync(WORKFLOW, 'utf-8');

/** What a scaffolded repo actually receives (the registry entry, not the raw constant). */
const shipped = (): string =>
  MANAGED_REGION_TEMPLATES.find((t) => t.name === 'ai-review-workflow')!.content;

/**
 * Pull the machinery pattern out of the `grep -qE '<pattern>'` line that decides
 * SELF_EDIT_KIND=machinery — the same extraction machinery-paths.test.ts performs. Fails
 * loudly rather than silently matching nothing, so a restructured workflow breaks the test
 * instead of quietly making it vacuous.
 */
function machineryPattern(src: string, what: string): string {
  const lines = src.split('\n');
  const idx = lines.findIndex((l) => /SELF_EDIT_KIND=machinery/.test(l));
  expect(idx, `no SELF_EDIT_KIND=machinery line in ${what}`).toBeGreaterThan(-1);

  const guard = lines
    .slice(Math.max(0, idx - 6), idx)
    .reverse()
    .find((l) => /grep -qE/.test(l));
  expect(guard, `no grep -qE guard above SELF_EDIT_KIND=machinery in ${what}`).toBeTruthy();

  const m = /grep -qE\s+'([^']+)'/.exec(guard as string);
  expect(m, `could not extract the pattern from: ${guard}`).toBeTruthy();
  // The RAW pattern string — never round-trip through RegExp.source, which normalises `/`.
  return (m as RegExpExecArray)[1];
}

/** The comment run from the `# MACHINERY_PATHS_RE` marker to the first non-comment line. */
function machineryCommentBlock(src: string, what: string): string[] {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.trimStart().startsWith('# MACHINERY_PATHS_RE'));
  expect(start, `no # MACHINERY_PATHS_RE marker in ${what}`).toBeGreaterThan(-1);
  let end = start;
  while (end < lines.length && lines[end].trimStart().startsWith('#')) end++;
  return lines.slice(start, end);
}

describe('#1486 machinery comment — MinSpec’s own copy keeps the claim that is true here', () => {
  it('records that machinery-paths.test.ts guards the pattern', () => {
    // Acceptance criterion: the fix must not cost MinSpec the true signpost. This repo DOES
    // have that test, so its own workflow should keep saying so.
    expect(machineryCommentBlock(onDisk(), 'ai-review.yml').join('\n')).toContain(
      MINSPEC_ONLY_TEST_PATH,
    );
  });

  it('is the file the workflow test actually reads, so the claim is checkable', () => {
    // Guards against the claim outliving the test it names.
    expect(fs.existsSync(path.resolve(__dirname, 'machinery-paths.test.ts'))).toBe(true);
  });
});

describe('#1486 machinery comment — the shipped copy claims no coverage it lacks', () => {
  it('names no test path from MinSpec’s own tree', () => {
    expect(shipped()).not.toContain(MINSPEC_ONLY_TEST_PATH);
    // Broader than the one sentence: no `packages/minspec/tests/…` path at all can be true
    // in a consuming repo, so none may survive into the shipped copy.
    expect(shipped()).not.toContain('packages/minspec/tests/');
  });

  it('states plainly that no local test guards the pattern', () => {
    const block = machineryCommentBlock(shipped(), 'the shipped ai-review.yml').join('\n');
    expect(block).toContain('NO LOCAL TEST GUARDS THIS PATTERN');
  });

  it('separates the universal alternations from the ones inherited from MinSpec', () => {
    const block = machineryCommentBlock(shipped(), 'the shipped ai-review.yml').join('\n');
    expect(block).toContain('UNIVERSAL');
    expect(block).toContain('INHERITED FROM MINSPEC');
    // `.github/` and `scripts/` exist in any scaffolded repo; the other three do not, and
    // the block must say which side each falls on rather than listing them as live code.
    const inherited = block.slice(block.indexOf('INHERITED FROM MINSPEC'));
    for (const p of ['.githooks/', 'template-registry.ts', 'ci-review-templates.ts']) {
      expect(inherited, `${p} is described as inherited`).toContain(p);
    }
  });

  it('carries its cross-repo issue reference with the project named (DR-053)', () => {
    // A bare `#1284` resolves to the READING repo's issue 1284 — a different, wrong item.
    const block = machineryCommentBlock(shipped(), 'the shipped ai-review.yml').join('\n');
    expect(block).toContain('MinSpec #1284');
    expect(block).not.toMatch(/\(#\d+\)/);
  });
});

describe('#1497 machinery comment — the specific quoted claims never reappear', () => {
  // #1497 re-reported this exact defect class (same provenance: AIClarityAU/scroogellm#135's
  // panel) against a scroogellm copy that predated the #1486 rewrite landing there. These
  // tests pin the three phrases #1497 quoted verbatim, so a future reword of the upstream
  // block cannot silently reintroduce one of them into the shipped copy without a test
  // failing here — the broader assertions above check the block's shape, not this wording.

  it('never claims the "LARGEST blast radius" of ci-review-templates.ts downstream', () => {
    // #1497 med finding: the upstream prose calls `ci-review-templates.ts` "the LARGEST
    // blast radius of anything here" — true only because the CI-review stack IS authored
    // here; asserting it in a consuming repo is unsubstantiated.
    expect(shipped()).not.toContain('LARGEST blast radius');
  });

  it('never cites the .githooks/ gate-history issue numbers downstream', () => {
    // #1497 low finding: the upstream `.githooks/` line cites the specific issues that made
    // it a certifying gate in MinSpec (#1041 protected-branch, #1120 workflow-file
    // protection, #1273 the PR that slipped through) — none of that history exists in a repo
    // whose hooks live elsewhere (scroogellm's are under scripts/hooks/).
    const shippedText = shipped();
    for (const issueRef of ['#1041', '#1120', '#1273']) {
      expect(shippedText, `${issueRef} present in shipped copy`).not.toContain(issueRef);
    }
    expect(shippedText).not.toContain('the review system certified a change to a gate');
  });
});

describe('#1486 machinery comment — the rewrite is comment-only', () => {
  it('leaves every non-comment line of the workflow untouched', () => {
    // The real invariant behind #564's byte-identity gate is that a consuming repo runs the
    // same CODE MinSpec does. Localization is allowed to move prose and nothing else.
    const before = onDisk().split('\n').filter((l) => !l.trimStart().startsWith('#'));
    const after = shipped().split('\n').filter((l) => !l.trimStart().startsWith('#'));
    expect(after).toEqual(before);
  });

  it('preserves the classifier pattern character-for-character', () => {
    // Executes the same extraction the workflow's own test does, on both copies. A consuming
    // repo can therefore never be running a narrower or wider machinery set than this one.
    expect(machineryPattern(shipped(), 'the shipped ai-review.yml')).toBe(
      machineryPattern(onDisk(), 'ai-review.yml'),
    );
  });

  it('keeps the YAML structurally intact (no tabs, no shifted block indent)', () => {
    const src = shipped();
    expect(src).not.toMatch(/\t/);
    // The block lives inside a `run: |` scalar — every replacement line must carry the same
    // indent as the marker it replaced, or the scalar's body breaks.
    const block = machineryCommentBlock(src, 'the shipped ai-review.yml');
    const indent = block[0].slice(0, block[0].length - block[0].trimStart().length);
    expect(indent.length).toBeGreaterThan(0);
    for (const line of block) expect(line.startsWith(indent)).toBe(true);
  });
});

describe('#1486 machinery comment — the rewrite fails closed, never silently', () => {
  // A no-op fallback would re-ship the false claim to every consuming repo — the precise
  // failure this exists to prevent — so each unexpected shape must throw.

  it('throws when the marker comment is gone', () => {
    const mangled = onDisk().replace('# MACHINERY_PATHS_RE', '# machinery paths');
    expect(() => localizeMachineryPathsComment(mangled)).toThrow(/MACHINERY_PATHS_RE/);
  });

  it('throws when the block no longer carries the claim it exists to remove', () => {
    // e.g. someone reworded the block upstream: the replacement below must be re-read
    // against it, not applied blind to prose it was never written for.
    const reworded = onDisk().replace(MINSPEC_ONLY_TEST_PATH, 'some/other/test.ts');
    expect(() => localizeMachineryPathsComment(reworded)).toThrow(/no longer mentions/);
  });

  it('throws when the claim also appears outside the block it rewrites', () => {
    // Removing the block would then leave a false claim behind, so the rewrite must refuse
    // rather than report success on a partial job.
    const withStray = onDisk().replace(
      '\njobs:',
      `\n# see ${MINSPEC_ONLY_TEST_PATH}\njobs:`,
    );
    expect(withStray).not.toBe(onDisk());
    expect(() => localizeMachineryPathsComment(withStray)).toThrow(/outside the/);
  });

  it('refuses a second application rather than nesting the replacement', () => {
    expect(() => localizeMachineryPathsComment(shipped())).toThrow(/no longer mentions/);
  });
});
