/**
 * T0/T3 — #833: dispatch native auto-merge (DR-061) must NOT arm on a PR that
 * edits a design-bearing APPROVABLE doc (spec / DR / domain / epic).
 *
 * Root cause (reproduced live 2026-07-17, PR #832): a dispatched agent on #793
 * ("resolve SPEC-031 FR-7 ↔ Clarify OQ contradiction") edited the UNAPPROVED
 * `SPEC-031/requirements.md`; ai-review passed and native auto-merge armed — the
 * PR was seconds from auto-landing an agent-chosen design resolution into main,
 * pre-empting the human's Clarify decision. The spec-gate correctly ALLOWED the
 * edit (doc-before-CODE: a spec's own docs stay editable so it can be fixed toward
 * approval); the missing gate was on the MERGE side — DR-061 arms on any
 * `ai-review:pass` with no approvable-doc exclusion, treating a code-quality verdict
 * as license to land a design decision that belongs to the human / docs-lane.
 *
 * The fix: a `paths_have_approvable_doc` classifier + an arm-site guard that
 * withholds auto-merge (labels `needs-human-review`) for approvable-doc PRs, and
 * FAILS CLOSED when the changed-file list can't be enumerated. Mirrors the machinery
 * self-edit exclusion, extended to approvables.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function findScriptsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'scripts');
    if (fs.existsSync(candidate) && fs.existsSync(path.join(dir, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo-root scripts/ directory from ' + __dirname);
}

const scriptPath = path.join(findScriptsDir(), 'dispatch-issue.sh');

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

describe('dispatch-issue.sh — approvable-doc auto-merge exclusion (#833)', () => {
  describe('HOLDS auto-merge (exit 0, "hold") when a diff touches an approvable doc', () => {
    for (const p of [
      'specs/minspec/SPEC-031-reviewer-all-approvables/requirements.md',
      'specs/minspec/SPEC-018-x/design.md',
      'specs/minspec/SPEC-018-x/tasks.md',
      'docs/decisions/DR-047.md',
      'docs/domain/reviewer.md',
      'docs/epics/EPIC-010.md',
    ]) {
      it(`holds: ${p}`, () => {
        const r = classify(p + '\n');
        expect(r.code, r.out).toBe(0);
        expect(r.out).toBe('hold');
      });
    }

    it('holds a MIXED PR (code + one spec doc) — the doc part needs a human', () => {
      const r = classify('packages/minspec/src/lib/foo.ts\nspecs/minspec/SPEC-031-x/requirements.md\n');
      expect(r.code).toBe(0);
      expect(r.out).toBe('hold');
    });
  });

  describe('ARMS auto-merge (exit 1, "arm") for code-only / non-approvable diffs', () => {
    for (const p of [
      'scripts/dispatch-issue.sh',
      'packages/minspec/src/lib/classifier.ts',
      'packages/minspec/tests/foo.test.ts',
      '.github/workflows/ai-review.yml',
      'README.md',
      'docs/decisions/INDEX.md', // generated index, not a DR entry
      'specs/minspec/SPEC-018-x/asset.png', // non-.md under specs/
    ]) {
      it(`arms: ${p}`, () => {
        const r = classify(p + '\n');
        expect(r.code, r.out).toBe(1);
        expect(r.out).toBe('arm');
      });
    }

    it('arms on an empty diff (no approvable doc present)', () => {
      const r = classify('');
      expect(r.code).toBe(1);
      expect(r.out).toBe('arm');
    });
  });

  describe('static: the arm site wires the exclusion and fails closed', () => {
    const content = fs.readFileSync(scriptPath, 'utf-8');

    it('defines the classifier and the pure seam', () => {
      expect(content).toMatch(/paths_have_approvable_doc\(\)\s*\{/);
      expect(content).toMatch(/--paths-have-approvable-doc/);
    });

    it('the auto-merge arm block consults the classifier before arming', () => {
      // The arm (`gh pr merge --auto`) must be gated behind the approvable-doc check.
      const armIdx = content.indexOf('gh pr merge "$pr_num"');
      const guardIdx = content.indexOf('paths_have_approvable_doc');
      expect(armIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeGreaterThan(-1);
      // classifier is referenced in the arm region (within the native_automerge block)
      const armBlock = content.slice(content.indexOf('if native_automerge_enabled; then', guardIdx));
      expect(armBlock).toMatch(/paths_have_approvable_doc/);
    });

    it('fails CLOSED — withholds when the changed-file list cannot be enumerated', () => {
      expect(content).toMatch(/if !\s*changed_files=\$\(gh pr diff "\$pr_num"[^\n]*--name-only/);
      expect(content).toMatch(/WITHHELD[^\n]*failing closed/);
    });

    it('a withheld PR is labeled needs-human-review', () => {
      expect(content).toMatch(/--add-label "needs-human-review"/);
    });
  });
});
