import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * Invariant (RCDD / DR-003 Phase 4): no tracked file may match this repo's own
 * ignore rules.
 *
 * Git does not apply .gitignore to a path already in the index. So a rule written
 * for a file that was committed first is a NO-OP that reads exactly like a working
 * one — `.gitignore` says the file is excluded, `git status` agrees it is clean,
 * and nothing anywhere reports the contradiction.
 *
 * Two live instances, both fixed in the commit that adds this test:
 *
 *  - `.minspec/generated-hashes.json` — machine-local merge-refresh drift state that
 *    the scaffold itself says "must be gitignored, never committed"
 *    (MINSPEC_GITIGNORE_ENTRIES, scaffold.ts). It was tracked, so every harness
 *    refresh rewrote it, it surfaced as modified, and the extension's commit offer
 *    swept it onto whatever branch HEAD was on. In AIClarityAU/sealbox that produced
 *    four separate "re-commit the manifests" commits, and on a ruleset-protected
 *    `main` each one is unpushable — the recurring stranded-commit loop.
 *  - `.claude/settings.json` — the opposite resolution: shared project config that
 *    SHOULD be tracked, silently matched by the broad `.claude/*` rule.
 *
 * The contradiction is the defect; either resolution (untrack it, or carve it out
 * with a `!` negation) clears it. What must never persist is the state where a rule
 * appears to be doing something and is not.
 *
 * NOTE ON `--no-index`: plain `git check-ignore` deliberately SKIPS tracked paths,
 * which is precisely why this class hides. The check is only meaningful with
 * `--no-index`, which asks "would these rules ignore this path" independent of the
 * index. A version of this test without that flag passes vacuously.
 */

const repoRoot = path.resolve(__dirname, '../../..');

function git(args: string[], input?: string) {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', input });
}

describe('no tracked file is matched by this repo\'s own ignore rules', () => {
  const tracked = git(['ls-files']).stdout ?? '';

  it('is running against a real checkout (guard against a vacuous pass)', () => {
    // If `git ls-files` returned nothing — wrong cwd, no git, not a repo — the
    // assertion below would pass while checking zero files.
    expect(tracked.split('\n').filter(Boolean).length).toBeGreaterThan(100);
    expect(tracked).toMatch(/package\.json/);
  });

  it('reports no tracked-but-ignored path', () => {
    // exit 0 = at least one match, 1 = no matches, >1 = error.
    const res = git(['check-ignore', '--stdin', '--no-index'], tracked);
    const offenders = (res.stdout ?? '').split('\n').filter(Boolean);
    expect(res.status, `git check-ignore failed: ${res.stderr}`).toBeLessThan(2);
    expect(
      offenders,
      'These files are tracked AND matched by .gitignore, so their ignore rules do ' +
        'nothing. Either `git rm --cached <path>` (if it is machine-local state), or ' +
        'add a `!<path>` negation after the rule that catches it (if it belongs in git):\n' +
        offenders.map((f) => `  - ${f}`).join('\n'),
    ).toEqual([]);
  });

  it('keeps the two files that motivated this gate on the correct side', () => {
    const trackedSet = new Set(tracked.split('\n').filter(Boolean));
    // Machine-local: rebuilt by the extension on every generate/refresh.
    expect(trackedSet.has('.minspec/generated-hashes.json')).toBe(false);
    expect(trackedSet.has('.minspec/template-baseline.json')).toBe(false);
    // Shared: the team and CI must receive the same hook wiring.
    expect(trackedSet.has('.claude/settings.json')).toBe(true);
  });
});
