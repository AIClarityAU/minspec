/**
 * T0/T3 — #1264: dispatch native auto-merge (DR-061) must NOT arm on a machinery PR
 * (`.github/**`, `.githooks/**`, `scripts/**`) — dispatch is the machinery hold's
 * INDEPENDENT SECOND WITNESS.
 *
 * Root cause (found 2026-08-05 auditing #509): the withhold classifier
 * `paths_have_approvable_doc` encoded path OWNERSHIP (docs corpus, `.minspec/`,
 * publish paths) but not the MACHINERY predicate, so for a machinery PR dispatch
 * armed `gh pr merge --auto` and the merge hold relied on exactly ONE producer:
 * ai-review.yml's witness suppression (`ai-review/pass` status forced `failure`,
 * check-run `neutral`, `neutral` rejected as a witness → `ready-to-merge` red).
 * One regression, skipped run, or permission gap in that single producer and the
 * already-armed auto-merge lands a machinery change with zero human keystrokes.
 * The gate that should have rejected this state: constitution invariant 2's third
 * clause — no load-bearing gate hinges on a single producer one permission/config
 * gap can disable; provide an independent second witness. This suite pins that
 * second witness. Pre-fix red state is documented by the OLD arm-list of
 * dispatch-automerge-publish-exclusion.test.ts, which asserted `arm` for
 * `scripts/dispatch-issue.sh` and `.github/workflows/ai-review.yml`.
 *
 * Scope note: `^\.githooks/` is included here although ai-review.yml's machinery
 * regex misses it (#1284) — the witnesses need not share blind spots. The whole
 * predicate narrows to gate-critical-only in lock-step with ai-review per #509.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts')) && fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo root from ' + __dirname);
}

const root = findRepoRoot();
const scriptPath = path.join(root, 'scripts', 'dispatch-issue.sh');

/** Run the pure seam with `paths` on stdin. Returns {code, out}. */
function classify(paths: string): { code: number; out: string } {
  try {
    const out = execFileSync('bash', [scriptPath, '--paths-have-approvable-doc'], {
      input: paths,
      encoding: 'utf-8',
    });
    return { code: 0, out: out.trim() };
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '').trim() };
  }
}

describe('dispatch-issue.sh — machinery auto-merge exclusion (#1264)', () => {
  describe('HOLDS auto-merge (exit 0) — machinery paths, independently of ai-review', () => {
    for (const p of [
      // the reviewer and its guard — the exact self-reference the hold exists for
      '.github/workflows/ai-review.yml',
      '.github/scripts/ai-review-guard.js',
      '.github/workflows/ready-to-merge.yml',
      // any workflow at all: every workflow file is repo-secrets surface
      '.github/workflows/ci.yml',
      '.github/ISSUE_TEMPLATE/agent-task.yml',
      // .githooks/ — the arm ai-review's own regex misses (#1284)
      '.githooks/commit-msg',
      // scripts/, both gate-defining and (until #509 narrows) operational
      'scripts/dispatch-issue.sh',
      'scripts/drain-inbox.sh',
      'scripts/roles/dev.md',
    ]) {
      it(`holds: ${p}`, () => {
        const r = classify(p + '\n');
        expect(r.code, r.out).toBe(0);
        expect(r.out).toBe('hold');
      });
    }

    it('holds a MIXED PR (ordinary code + one machinery path)', () => {
      const r = classify('packages/minspec/src/lib/foo.ts\nscripts/lib/issue-lease.sh\n');
      expect(r.code).toBe(0);
      expect(r.out).toBe('hold');
    });
  });

  describe('NO OVER-BLOCK (exit 1) — anchored prefixes, ordinary code still arms', () => {
    for (const p of [
      'packages/minspec/src/lib/foo.ts',
      'packages/minspec/tests/foo.test.ts',
      'package.json',
      // prefix precision: the regex is anchored at ^, so these are NOT machinery
      'myscripts/foo.sh',
      'packages/minspec/scripts/build.sh',
      'src/.github/nested-lookalike.yml',
      'docs-scripts/gen.sh',
    ]) {
      it(`arms: ${p}`, () => {
        const r = classify(p + '\n');
        expect(r.code, r.out).toBe(1);
        expect(r.out).toBe('arm');
      });
    }
  });

  describe('static: the machinery mandate is a documented constant, wired at the arm site', () => {
    const content = fs.readFileSync(scriptPath, 'utf-8');

    it('defines MACHINERY_PATH_RE covering all three machinery roots', () => {
      const m = content.match(/^MACHINERY_PATH_RE='([^']+)'/m);
      expect(m, 'MACHINERY_PATH_RE not defined in dispatch-issue.sh').not.toBeNull();
      for (const arm of ['^\\.github/', '^\\.githooks/', '^scripts/']) {
        expect(m![1]).toContain(arm);
      }
    });

    it('names the second-witness rationale, not a blind regex (invariant 2)', () => {
      const idx = content.indexOf("MACHINERY_PATH_RE='");
      const preamble = content.slice(Math.max(0, idx - 1800), idx);
      expect(preamble).toMatch(/SECOND WITNESS/);
      expect(preamble).toMatch(/single producer/);
    });

    it('the withhold classifier includes the machinery mandate', () => {
      const fn = content.match(/paths_have_approvable_doc\(\) \{\n(.*)\n\}/);
      expect(fn, 'paths_have_approvable_doc() not found').not.toBeNull();
      expect(fn![1]).toMatch(/\$\{MACHINERY_PATH_RE\}/);
    });

    it('the arm site names the machinery mandate in the withhold message (never-wrong)', () => {
      const guardIdx = content.indexOf('if native_automerge_enabled; then');
      const armBlock = content.slice(guardIdx);
      expect(armBlock).toMatch(/second witness to the ai-review machinery hold \(#1264\)/);
    });

    it('mirrors ai-review.yml: every root in ITS machinery regex is covered here', () => {
      // Lock-step with the FIRST witness: if ai-review.yml's self-edit regex widens,
      // this witness must at least cover the same roots (it may cover more — #1284).
      const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'ai-review.yml'), 'utf-8');
      const m = yml.match(/grep -qE '([^']+)'/g) || [];
      const machineryLine = m.find((s) => s.includes('\\.github/'));
      expect(machineryLine, 'ai-review.yml machinery regex not found').toBeDefined();
      const mine = content.match(/^MACHINERY_PATH_RE='([^']+)'/m)![1];
      for (const probe of ['.github/workflows/x.yml', 'scripts/x.sh']) {
        expect(new RegExp(mine).test(probe), `MACHINERY_PATH_RE misses ${probe}`).toBe(true);
      }
    });
  });
});
