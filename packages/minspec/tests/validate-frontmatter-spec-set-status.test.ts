/**
 * SPEC-212 task 3.3 (#972) - Rule 27 of `scripts/validate-frontmatter.ts`, the
 * commit/CI surface of the spec-set literal status-agreement rule (FR-5: same lens
 * everywhere). The extension command and this rule call the same pair of functions,
 * `readSpecSetStatusFiles` + `validateSpecSetStatusAgreement`; these cases prove the
 * script actually runs them, prints the finding, and stays non-fatal (DQ-3: warning).
 *
 * Subprocess rather than import, for the reason the Rule 19 suite gives: the script has
 * top-level side effects including `process.exit(1)`, which would kill the worker.
 * Harness shape follows validate-frontmatter-annotation-skip.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'validate-frontmatter.ts');
// Absolute tsx, not `npx`: the fixture cwd is a tmpdir outside the repo, and npx resolves
// by walking up from cwd, so it could try to FETCH tsx (offline invariant).
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

const SET_DIR = 'SPEC-900-probe';
const SET_REL = `specs/minspec/${SET_DIR}`;
const RULE_PREFIX = `WARN spec-set-status ${SET_REL}:`;

function fm(type: string, status: string, extra = ''): string {
  return `---\nid: SPEC-900\ntype: ${type}\n${extra}status: ${status}\nproduct: minspec\n---\n\n# Probe ${type}\n`;
}

/** Write one spec-set: requirements.md, design.md, tasks.md with the given statuses. */
function writeSet(dir: string, statuses: { requirements: string; design: string; tasks: string }): string {
  const setDir = path.join(dir, 'specs', 'minspec', SET_DIR);
  fs.mkdirSync(setDir, { recursive: true });
  fs.writeFileSync(path.join(setDir, 'requirements.md'), fm('requirements', statuses.requirements, 'tier: T1\n'), 'utf-8');
  fs.writeFileSync(path.join(setDir, 'design.md'), fm('design', statuses.design), 'utf-8');
  fs.writeFileSync(path.join(setDir, 'tasks.md'), fm('tasks', statuses.tasks), 'utf-8');
  return setDir;
}

function runValidate(cwd: string): { status: number | null; output: string } {
  const r = spawnSync(TSX_BIN, [SCRIPT_PATH], { cwd, encoding: 'utf-8' });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

function ruleLines(output: string): string[] {
  return output.split('\n').filter((l) => l.includes('spec-set-status'));
}

function withTmp(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-spec-set-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('SPEC-212 Rule 27 - spec-set status agreement on the npm run validate path', () => {
  it('a lagging set prints one WARN naming design.md, and the run still exits 0', () => {
    withTmp((dir) => {
      writeSet(dir, { requirements: 'implementing', design: 'specifying', tasks: 'implementing' });
      const { status, output } = runValidate(dir);
      const lines = ruleLines(output);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(RULE_PREFIX);
      expect(lines[0]).toContain('design.md');
      expect(lines[0]).toContain('implementing');
      expect(lines[0]).toContain('specifying');
      // Warning-only (DQ-3): never gates.
      expect(status).toBe(0);
    });
  }, 60_000);

  it('an agreeing set prints no spec-set-status line, and its control flips to one warning', () => {
    withTmp((dir) => {
      const setDir = writeSet(dir, { requirements: 'planning', design: 'planning', tasks: 'planning' });
      const agreeing = runValidate(dir);
      expect(ruleLines(agreeing.output)).toEqual([]);
      expect(agreeing.status).toBe(0);

      // Control: the same fixture with design.md edited to lag. Without this, "no line"
      // above could pass because the rule never ran at all.
      fs.writeFileSync(path.join(setDir, 'design.md'), fm('design', 'specifying'), 'utf-8');
      const lagging = runValidate(dir);
      const lines = ruleLines(lagging.output);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(RULE_PREFIX);
      expect(lines[0]).toContain('design.md');
      expect(lagging.status).toBe(0);
    });
  }, 60_000);

  it('an unreadable sibling prints an unreadable line rather than nothing', () => {
    withTmp((dir) => {
      const setDir = writeSet(dir, { requirements: 'planning', design: 'planning', tasks: 'planning' });
      const design = path.join(setDir, 'design.md');
      fs.rmSync(design);
      fs.symlinkSync('/nonexistent/nowhere.md', design);
      // Prove the fault took, so the case cannot pass vacuously.
      expect(() => fs.readFileSync(design, 'utf-8')).toThrow();
      const { output } = runValidate(dir);
      const lines = ruleLines(output).filter((l) => l.includes(RULE_PREFIX));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('design.md');
      expect(lines[0]).toMatch(/cannot read/i);
      // The exit code here is not Rule 27's: FATAL rules elsewhere in the script fail
      // closed on the same unreadable file (invariant 2). Rule 27 itself only warns.
      expect(output.split('\n').filter((l) => l.startsWith('FAIL') && l.includes("Cannot read design.md's status"))).toEqual([]);
    });
  }, 60_000);
});
