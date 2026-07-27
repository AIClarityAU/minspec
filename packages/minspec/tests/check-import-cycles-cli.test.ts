/**
 * SPEC-040 FR-2 / AC-4 — the cycle gate as CI actually runs it.
 *
 * `import-cycle-check.test.ts` covers the library; this covers the runner around it,
 * `scripts/check-import-cycles.ts`, which until now had no test at all. That gap
 * mattered because AC-4 is a claim about the GATE, not the graph: "introducing a
 * runtime cycle fails the CI cycle gate". Only a spawned process can witness that.
 * Flip the runner's `return 1` to `return 0` and every library assertion still
 * passes while the gate waves a cyclic tree through — a regression `npm test` could
 * not see.
 *
 * So each case here builds a throwaway repo-shaped tree
 * (`<root>/packages/minspec/src/**` — the layout the runner derives from cwd), spawns
 * the real script with cwd pointed at it, and asserts on exit code and output. The
 * branches under test are the runner's own: the missing-root guard, the
 * minimum-module floor, unresolved-import warnings, cycle reporting, and the crash
 * handler. Three of those exist purely to keep a green result honest (DR-066 — no
 * silent gate: a gate fails visibly, never best-effort), and a gate's failure paths
 * are exactly the code that never runs in the happy case, so nothing but a test
 * keeps them working.
 *
 * Each case spawns `npx tsx`, which costs a couple of seconds; the per-test timeouts
 * are sized for that, not for the work itself.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'check-import-cycles.ts');

/**
 * Acyclic modules to pad a fixture with, enough to clear the runner's
 * MIN_SCANNED_MODULES floor (50). Any case expecting a verdict OTHER than the floor
 * failure has to clear the floor first, or it would pass for the wrong reason.
 */
const FILLER_MODULES = 60;

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

/** A registered-for-cleanup temp directory, standing in for a repo root. */
function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-cycle-cli-'));
  tempRoots.push(root);
  return root;
}

/**
 * Materialise a repo-shaped tree: `files` are written under
 * `<root>/packages/minspec/src/`, which is where the runner looks. Returns the root,
 * to be handed to the child as its cwd.
 */
function srcTree(files: Record<string, string>): string {
  const root = tempRoot();
  const srcRoot = path.join(root, 'packages', 'minspec', 'src');
  fs.mkdirSync(srcRoot, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const absolute = path.join(srcRoot, ...rel.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf-8');
  }
  return root;
}

/** `filler-000 → filler-001 → …`: a long acyclic chain, so the padding is real edges. */
function filler(): Record<string, string> {
  const name = (i: number): string => `filler-${String(i).padStart(3, '0')}`;
  const out: Record<string, string> = {};
  for (let i = 0; i < FILLER_MODULES; i++) {
    out[`lib/${name(i)}.ts`] =
      i === 0
        ? 'export const step0 = 0;\n'
        : `import { step${i - 1} } from './${name(i - 1)}';\n` +
          `export const step${i} = step${i - 1} + 1;\n`;
  }
  return out;
}

interface GateResult {
  status: number | null;
  /** stdout and stderr together — the runner writes passes to one and failures to the other. */
  output: string;
}

function runGate(cwd: string): GateResult {
  const result = spawnSync('npx', ['tsx', SCRIPT], { cwd, encoding: 'utf-8' });
  // A spawn that never started is not a gate verdict. Rethrow rather than let it
  // read as a null exit code the assertions might squint at.
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

describe('scripts/check-import-cycles.ts — the gate CI runs (AC-4)', () => {
  it('exits 1 on a genuine runtime cycle and names its members', () => {
    const root = srcTree({
      ...filler(),
      'lib/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'lib/b.ts': "import { a } from './a';\nexport const b = a;\n",
    });

    const { status, output } = runGate(root);

    expect(status).toBe(1);
    // The chain closes back onto its first member, so the loop is readable whole.
    expect(output).toContain('FAIL runtime import cycle: lib/a.ts -> lib/b.ts -> lib/a.ts');
    expect(output).toContain('1 runtime import cycle(s) in packages/minspec/src');
    expect(output).not.toContain('Import cycle check passed');
  }, 60000);

  it('exits 0 on a clean tree, reporting what it scanned', () => {
    const { status, output } = runGate(srcTree(filler()));

    expect(status).toBe(0);
    expect(output).toContain(
      `Import cycle check passed — ${FILLER_MODULES} modules scanned, 0 runtime import cycles.`,
    );
  }, 60000);

  it('exits non-zero on an EMPTY src root — never a green pass on an unread tree', () => {
    // The breach this floor closes: before it, this exact tree printed
    // "0 modules scanned, 0 runtime import cycles" and exited 0.
    const { status, output } = runGate(srcTree({}));

    expect(status).toBe(1);
    expect(output).toContain('0 module(s) scanned, below the floor of 50');
    expect(output).not.toContain('Import cycle check passed');
  }, 60000);

  it('exits non-zero below the floor, not merely on emptiness', () => {
    // Three modules is a plausible shape for a half-broken walk or a moved package —
    // green on it would be the same silent pass as green on nothing.
    const { status, output } = runGate(
      srcTree({
        'lib/a.ts': 'export const a = 1;\n',
        'lib/b.ts': "import { a } from './a';\nexport const b = a;\n",
        'lib/c.ts': "import { b } from './b';\nexport const c = b;\n",
      }),
    );

    expect(status).toBe(1);
    expect(output).toContain('3 module(s) scanned, below the floor of 50');
    expect(output).toContain('proves nothing about it');
    expect(output).not.toContain('Import cycle check passed');
  }, 60000);

  it('exits non-zero on a MISSING src root, saying where to run it from', () => {
    const { status, output } = runGate(tempRoot());

    expect(status).toBe(1);
    expect(output).toContain(
      'FAIL packages/minspec/src: source root not found — run this from the repo root.',
    );
    expect(output).not.toContain('Import cycle check passed');
  }, 60000);

  it('warns about an unresolved relative import but still passes — it is a blind spot, not a cycle', () => {
    const root = srcTree({
      ...filler(),
      'lib/dangling.ts': "import { x } from './missing';\nexport const d = x;\n",
    });

    const { status, output } = runGate(root);

    expect(output).toContain('WARN lib/dangling.ts:1: unresolved relative import "./missing"');
    // Deliberate: the compiler already fails on a genuinely broken import, so the
    // gate reports rather than rejects. The zero-unresolved assertion over the real
    // tree in import-cycle-check.test.ts is what makes a resolver regression fail.
    expect(status).toBe(0);
    expect(output).toContain('Import cycle check passed');
  }, 60000);

  it('exits non-zero when the scan itself throws — a crashed gate never reports a pass', () => {
    // `packages/minspec/src` as a FILE clears existsSync and then makes the
    // directory walk throw ENOTDIR: a scan that threw has proved nothing, so the
    // crash handler must surface it and fail rather than fall through (DR-066).
    const root = tempRoot();
    fs.mkdirSync(path.join(root, 'packages', 'minspec'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages', 'minspec', 'src'), 'not a directory\n', 'utf-8');

    const { status, output } = runGate(root);

    expect(status).toBe(1);
    expect(output).toContain('FAIL import-cycle check crashed — the gate did not run:');
    expect(output).not.toContain('Import cycle check passed');
  }, 60000);
});
