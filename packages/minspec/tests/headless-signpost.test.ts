/**
 * SPEC-076 — Headless signpost reader (T0 invariant tests).
 *
 * These are the invariant tests named in SPEC-076 § Test, written before the
 * implementation per the CDD pre-coding checklist (DR-359).
 *
 * The load-bearing one is AC-1 + AC-2 TOGETHER. Measured before this spec existed:
 * `buildArtifactGraph('/tmp')` returns an empty graph and `resolveNextTask` returns
 * `null` for it — byte-identical to the answer for a real MinSpec project that simply
 * has nothing pending. A supervisor reading the second as the first concludes "that
 * project is clear" about a repo MinSpec was never installed in. Asserting either case
 * alone does NOT catch that; the discrimination is the requirement (constitution
 * invariant 2 — a missing witness must fail closed and visibly).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildArtifactGraph } from '../src/lib/artifact-graph';
import { resolveNextTask } from '../../shared/src/next-task';

// `__dirname` rather than `import.meta.url`: the root tsconfig targets CommonJS, where
// import.meta is a type error (TS1470). Matches dispatch-ready-check.test.ts, the closest
// analogue - a test that shells out to a script under scripts/.
const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'next-task.ts');

/** Run the headless reader as a real subprocess — the form the contract covers. */
function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('npx', ['tsx', SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: { ...process.env },
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

let tmpRoot: string;
/** Has `.minspec/` but no specs → a real MinSpec project with nothing pending. */
let optedInEmpty: string;
/** No `.minspec/` at all → never opted in. */
let notMinspec: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-headless-'));
  optedInEmpty = path.join(tmpRoot, 'opted-in');
  notMinspec = path.join(tmpRoot, 'plain-dir');
  fs.mkdirSync(path.join(optedInEmpty, '.minspec'), { recursive: true });
  fs.mkdirSync(notMinspec, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('SPEC-076 headless signpost reader', () => {
  it('AC-1/AC-2 (INV-2): tells "not a MinSpec project" apart from "nothing pending"', () => {
    const r = run([notMinspec, optedInEmpty]);
    const report = JSON.parse(r.stdout);
    expect(report.results).toHaveLength(2);

    // AC-1 — no `.minspec/` is a NAMED FAILURE, never an answer.
    const refused = report.results[0];
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe('not-a-minspec-project');
    expect(refused).not.toHaveProperty('task');
    expect(r.stderr).toContain(notMinspec);

    // AC-2 — `.minspec/` present but nothing pending IS an answer, and it is null.
    const answered = report.results[1];
    expect(answered.ok).toBe(true);
    expect(answered.task).toBeNull();

    // The whole point: the two outcomes are not the same shape.
    expect(refused.ok).not.toBe(answered.ok);
    // A failing root makes the run fail (FR-6).
    expect(r.status).toBe(1);
  }, 120_000);

  it('AC-2/FR-6: an opted-in project with nothing pending alone exits 0', () => {
    const r = run([optedInEmpty]);
    const report = JSON.parse(r.stdout);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].ok).toBe(true);
    expect(report.results[0].task).toBeNull();
    expect(r.status).toBe(0);
  }, 120_000);

  it('AC-3 (FR-3): every requested root appears once, in order, and one failure does not suppress the others', () => {
    const r = run([REPO_ROOT, notMinspec, optedInEmpty]);
    const report = JSON.parse(r.stdout);
    expect(report.results).toHaveLength(3);
    expect(report.results.map((x: { ok: boolean }) => x.ok)).toEqual([true, false, true]);
    // The real project still answered despite the bad root sitting between the two.
    expect(report.results[0].task).not.toBeNull();
    expect(r.status).toBe(1);
  }, 120_000);

  it('AC-5 (FR-5): stdout is nothing but JSON, and the failure reaches stderr too', () => {
    const r = run([notMinspec]);
    expect(r.stdout.trim().startsWith('{')).toBe(true);
    expect(r.stdout.trim().endsWith('}')).toBe(true);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    // Visible in BOTH places, never only in the structured output.
    expect(JSON.parse(r.stdout).results[0].error.code).toBe('not-a-minspec-project');
    expect(r.stderr).toMatch(/not-a-minspec-project|not a MinSpec project/i);
  }, 120_000);

  it('AC-6 (FR-7): two runs over the same tree produce byte-identical stdout', () => {
    const a = run([optedInEmpty, notMinspec]);
    const b = run([optedInEmpty, notMinspec]);
    expect(a.stdout).toBe(b.stdout);
    expect(a.stdout.length).toBeGreaterThan(0);
    // No embedded wall clock is what makes that true.
    expect(a.stdout).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  }, 180_000);

  it('AC-7 (FR-4): a successful result reports the working-tree state it measured', () => {
    const r = run([REPO_ROOT]);
    const result = JSON.parse(r.stdout).results[0];
    expect(result.ok).toBe(true);
    expect(result.tree).not.toBeNull();
    expect(typeof result.tree.head).toBe('string');
    expect(result.tree.head.length).toBeGreaterThan(0);
    expect(typeof result.tree.dirty).toBe('boolean');
  }, 120_000);

  it('AC-8 (FR-1): the headless answer equals the in-process resolver for the same root', () => {
    const r = run([REPO_ROOT]);
    const headless = JSON.parse(r.stdout).results[0].task;
    const inProcess = resolveNextTask(buildArtifactGraph(REPO_ROOT));
    if (inProcess === null) {
      expect(headless).toBeNull();
    } else {
      expect(headless).not.toBeNull();
      expect(headless.kind).toBe(inProcess.kind);
      expect(headless.targetId).toBe(inProcess.targetId);
      expect(headless.severityClass).toBe(inProcess.severityClass);
    }
  }, 120_000);

  // T3 regression (FR-5). The first version of this reader ended with
  // `process.exit(main(...))`, which discards a stdout write that is still buffered:
  // once the document exceeds the 64KB pipe buffer, `process.stdout.write` to a pipe
  // completes ASYNCHRONOUSLY and `process.exit` does not drain it. Measured: a 200-root
  // run produced exactly 65536 bytes of truncated, unparseable JSON.
  //
  // AC-5 above did not catch it, and the reason is worth stating: it asserted the RIGHT
  // property on the WRONG axis. It only ever ran a two-root document of a few KB, so it
  // varied the code under test but never the OUTPUT SIZE. This test varies size, which is
  // the axis the defect lived on.
  it('FR-5 regression: a document larger than the pipe buffer is not truncated', () => {
    const manyRoots = Array.from({ length: 200 }, () => REPO_ROOT);
    const r = run(manyRoots);
    expect(r.stdout.length).toBeGreaterThan(65_536);
    const report = JSON.parse(r.stdout);
    expect(report.results).toHaveLength(200);
    expect(r.status).toBe(0);
  }, 300_000);

  it('AC-4 (INV-4): the reader delegates ranking and holds no second implementation', () => {
    const src = fs.readFileSync(SCRIPT, 'utf-8');
    // It must get its answer from the canonical pair.
    expect(src).toMatch(/resolveNextTask/);
    expect(src).toMatch(/buildArtifactGraph/);
    expect(src).toMatch(/packages\/shared\/src\/next-task|\.\.\/packages\/shared\/src\/next-task/);
    // And it must not re-derive the order. These are the resolver's own severity
    // classes; their presence here would mean the precedence logic had been copied.
    for (const severityLiteral of ['gate-violation', 'blocked-ready', 'promote-parent']) {
      expect(src).not.toContain(`'${severityLiteral}'`);
      expect(src).not.toContain(`"${severityLiteral}"`);
    }
    // No local ordering of candidate tasks.
    expect(src).not.toMatch(/\.sort\s*\(/);
  });

  it('INV-5: nothing the reader imports pulls in vscode, transitively', () => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    const queue: string[] = [SCRIPT];

    const resolveLocal = (from: string, spec: string): string | null => {
      const base = path.resolve(path.dirname(from), spec);
      for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      }
      return null;
    };

    while (queue.length > 0) {
      const file = queue.shift() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = fs.readFileSync(file, 'utf-8');
      const re =
        /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const spec = m[1] ?? m[2] ?? m[3];
        if (spec === 'vscode') {
          offenders.push(path.relative(REPO_ROOT, file));
          continue;
        }
        if (!spec.startsWith('.')) continue;
        const next = resolveLocal(file, spec);
        if (next !== null) queue.push(next);
      }
    }

    expect(offenders).toEqual([]);
    // A closure of one file would mean the walk silently failed to follow anything,
    // so the green above would prove nothing (a control on the measurement itself).
    expect(seen.size).toBeGreaterThan(5);
  });
});
