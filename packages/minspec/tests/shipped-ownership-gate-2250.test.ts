/**
 * T3 regression — #2250: a T3 spec reached an ADOPTER's main without `implements:`.
 *
 * WHAT HAPPENED. voip-sms-inbox #110 raised SPEC-003 from T2 to T3 with a plain
 * frontmatter edit, on a spec already at `plan: done`. That one edit armed SPEC-038's
 * `ownership.implements.missing` rule (T3/T4 + plan in the build band), and the PR
 * merged green: no deterministic gate in that repo evaluates the rule at a blocking
 * severity.
 *
 * MECHANISM. The rule blocks only inside MinSpecPro, whose own dev validator
 * (`scripts/validate-frontmatter.ts` Rule 15) runs it under this repo's ratcheted
 * `ownershipDeclaration: "error"`. What MinSpec ships to an adopter never blocked it:
 *   1. the scaffolded CI + pre-commit validator, `.minspec/hooks/validate.py`, never
 *      implemented the rule at all (it checked three `id:`/`type:` fields); and
 *   2. `scaffold()` seeds FR-7's pre-backfill value, `warn`, into every new repo,
 *      including one with nothing to grandfather, and nothing ever advances it.
 * Every earlier fix in this family was verified here, where both holes are covered by
 * the dev-only validator, so each looked complete while the shipped surfaces stayed open.
 *
 * WHAT THIS PINS, on every path that can put a T3 spec into the armed state:
 *   - the shipped validator fails the voip shape, full scan AND pre-commit (A);
 *   - its verdict equals the TS rule's, over a fixture matrix and over this repo's
 *     whole spec corpus, so the two cannot drift apart again silently (B);
 *   - a fresh scaffold starts at `error` when there is nothing to grandfather, and
 *     under that config the approve command's refusal predicate, the approval-advance
 *     guard, and the shipped validator all reject the same spec (C).
 *
 * Written RED first (DR-003): every assertion that the shipped validator or the
 * seeded config rejects the spec failed before the fix.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { parseSpec } from '../src/lib/spec';
import {
  validateOwnership,
  validateSpec,
  violationsIntroducedByApproval,
} from '../src/lib/spec-validator';
import { DEFAULT_CONFIG, loadConfig, type MinspecConfig } from '../src/lib/config';
import { scaffold } from '../src/lib/scaffold';
import { MANAGED_REGION_TEMPLATES, renderManagedFile } from '../src/lib/template-registry';

const MISSING = 'ownership.implements.missing';
const INVALID = 'ownership.implements.invalid';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function python3Available(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * CI runs this suite on ubuntu, where python3 is always present. Skipping there would
 * turn every assertion below into a vacuous green, so a missing interpreter is only
 * tolerated off CI (a contributor's machine), never on the merge gate itself.
 */
const HAS_PY = python3Available();
if (!HAS_PY && process.env.CI) {
  throw new Error('python3 is required in CI: the shipped validator under test is Python.');
}

function validatePyText(): string {
  const tpl = MANAGED_REGION_TEMPLATES.find((t) => t.name === 'validate-py');
  if (!tpl) throw new Error('validate-py template missing from MANAGED_REGION_TEMPLATES');
  return renderManagedFile(tpl);
}

/** A T3/T4 spec in the shape voip SPEC-003 had after #110 unless overridden. */
function specText(o: {
  tier?: string;
  plan?: string;
  type?: string;
  extra?: string[]; // extra frontmatter lines, verbatim
  phases?: boolean; // false = no phases: block at all
}): string {
  const fm = ['---', 'id: SPEC-003', 'title: Raw capture retention', 'status: planning'];
  if (o.type !== undefined) fm.push(`type: ${o.type}`);
  fm.push(`tier: ${o.tier ?? 'T3'}`, 'epic: EPIC-001', 'created: 2026-08-16');
  fm.push(...(o.extra ?? []));
  if (o.phases !== false) {
    fm.push(
      'phases:',
      '  specify: done',
      '  clarify: done',
      `  plan: ${o.plan ?? 'done'}`,
      '  tasks: pending',
      '  implement: pending',
    );
  }
  fm.push('---');
  // Every section a T3 requires, so the only thing a fixture can be missing is the
  // ownership declaration under test.
  const body = [
    '# SPEC-003',
    '## Specify',
    '- [ ] a criterion',
    '## Plan',
    'Steps.',
    '## Tasks',
    '- [ ] T-01',
    '## Implement',
    'Code.',
  ].join('\n\n');
  return `${fm.join('\n')}\n\n${body}\n`;
}

/** Fixture repo: the rendered validate.py, a config, and the given spec files. */
function makeRepo(
  dir: string,
  opts: { ownershipDeclaration?: string; configRaw?: string; specs: Record<string, string> },
): void {
  fs.mkdirSync(path.join(dir, '.minspec', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.minspec', 'hooks', 'validate.py'), validatePyText());
  const config =
    opts.configRaw ??
    JSON.stringify(
      opts.ownershipDeclaration === undefined
        ? { version: '1' }
        : { version: '1', ownershipDeclaration: opts.ownershipDeclaration },
    );
  fs.writeFileSync(path.join(dir, '.minspec', 'config.json'), config);
  for (const [rel, text] of Object.entries(opts.specs)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
}

/** Exit code AND stderr on every outcome: a WARN on a passing run is part of the contract. */
function runValidatePy(dir: string, args: string[] = []): { code: number; stderr: string } {
  const r = spawnSync('python3', [path.join(dir, '.minspec', 'hooks', 'validate.py'), ...args], {
    cwd: dir,
    encoding: 'utf-8',
  });
  if (r.error) throw r.error;
  if (r.status === null) throw new Error(`validate.py killed by ${r.signal}`);
  return { code: r.status, stderr: r.stderr };
}

function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd: dir,
    stdio: 'ignore',
  });
}

type Verdict = Array<[string, string]>;

/**
 * The shipped validator's own ownership verdict for each input, from ONE python3
 * process: the rendered validate.py is imported as a module and its
 * `ownership_violations(content, declaration)` called per case.
 */
function pythonVerdicts(
  dir: string,
  cases: ReadonlyArray<{ content: string; declaration: string }>,
): Verdict[] {
  const script = path.join(dir, 'validate_under_test.py');
  fs.writeFileSync(script, validatePyText());
  const driver = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("validate_under_test", ${JSON.stringify(script)})`,
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'cases = json.loads(sys.stdin.read())',
    'print(json.dumps([[[r, s] for (r, s, _m) in mod.ownership_violations(c["content"], c["declaration"])] for c in cases]))',
  ].join('\n');
  const out = execFileSync('python3', ['-c', driver], {
    input: JSON.stringify(cases),
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out) as Verdict[];
}

function tsVerdict(content: string, declaration: string): Verdict {
  const config: MinspecConfig = {
    ...DEFAULT_CONFIG,
    ownershipDeclaration: declaration as MinspecConfig['ownershipDeclaration'],
  };
  return validateOwnership(parseSpec(content), config).map((v) => [v.rule, v.severity]);
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-2250-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── A. The shipped validator (CI + pre-commit in every repo without npm validate) ──
describe.skipIf(!HAS_PY)('#2250 A — the shipped validate.py rejects a T3 spec without implements:', () => {
  const SPEC = 'specs/SPEC-003-raw-capture-retention.md';

  it('fails the exact voip shape (T3, plan: done, no implements:) under ownershipDeclaration "error"', () => {
    makeRepo(tmp, { ownershipDeclaration: 'error', specs: { [SPEC]: specText({}) } });
    const r = runValidatePy(tmp);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`FAIL ${SPEC}`);
    expect(r.stderr).toContain('implements:');
  });

  it('the tier raise alone flips the verdict: the same spec passes at T2 and fails at T3', () => {
    makeRepo(tmp, { ownershipDeclaration: 'error', specs: { [SPEC]: specText({ tier: 'T2' }) } });
    expect(runValidatePy(tmp).code).toBe(0);
    fs.writeFileSync(path.join(tmp, SPEC), specText({ tier: 'T3' }));
    expect(runValidatePy(tmp).code).toBe(1);
  });

  it('pre-commit: a STAGED tier raise is refused before it can be committed', () => {
    makeRepo(tmp, { ownershipDeclaration: 'error', specs: { [SPEC]: specText({ tier: 'T2' }) } });
    git(tmp, 'init', '-q');
    git(tmp, 'add', '-A');
    git(tmp, 'commit', '-q', '-m', 'base');
    fs.writeFileSync(path.join(tmp, SPEC), specText({ tier: 'T3' }));
    git(tmp, 'add', SPEC);
    const r = runValidatePy(tmp, ['--pre-commit']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`FAIL ${SPEC}`);
  });

  it.each([
    ['absent', []],
    ['an empty key', ['implements:']],
    ['an empty list', ['implements: []']],
    ['an empty string', ['implements: ""']],
    ['only a non-source path', ['implements: [docs/notes.md]']],
    ['the none escape without a reason', ['implements: none']],
  ])('treats implements: %s as missing', (_label, extra) => {
    makeRepo(tmp, { ownershipDeclaration: 'error', specs: { [SPEC]: specText({ extra }) } });
    expect(runValidatePy(tmp).code).toBe(1);
  });

  it.each([
    ['an inline list', ['implements: [apps/inbox/src/retention.ts]']],
    ['a block list', ['implements:', '  - apps/inbox/src/retention.ts', '  - apps/inbox/test/unit/retention.test.ts']],
    ['the none escape with a reason', ['implements: none', 'implements_reason: prose-only convention']],
  ])('accepts implements: as %s', (_label, extra) => {
    makeRepo(tmp, { ownershipDeclaration: 'error', specs: { [SPEC]: specText({ extra }) } });
    const r = runValidatePy(tmp);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
  });

  it('keeps SPEC-038 scope: T2, pre-build-band, and non-primary files are not armed', () => {
    makeRepo(tmp, {
      ownershipDeclaration: 'error',
      specs: {
        'specs/SPEC-010-t2.md': specText({ tier: 'T2' }),
        'specs/SPEC-011-specifying.md': specText({ plan: 'pending' }),
        'specs/spec-012/design.md': specText({ type: 'design' }),
      },
    });
    const r = runValidatePy(tmp);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
  });

  it('under "warn" it does not block, but it is not silent either', () => {
    makeRepo(tmp, { ownershipDeclaration: 'warn', specs: { [SPEC]: specText({}) } });
    const r = runValidatePy(tmp);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(`WARN ${SPEC}`);
    expect(r.stderr).toContain('ownershipDeclaration');
  });

  it('a missing ownershipDeclaration key reads as the shipped default, warn (loadConfig parity)', () => {
    makeRepo(tmp, { specs: { [SPEC]: specText({}) } });
    const r = runValidatePy(tmp);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(`WARN ${SPEC}`);
  });

  it('an unreadable config degrades to warn VISIBLY, as loadConfig does silently', () => {
    makeRepo(tmp, { configRaw: '{ not json', specs: { [SPEC]: specText({}) } });
    const r = runValidatePy(tmp);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('.minspec/config.json');
    expect(r.stderr).toContain(`WARN ${SPEC}`);
  });

  it('an escaping owned path fails whatever the configured severity', () => {
    makeRepo(tmp, {
      ownershipDeclaration: 'warn',
      specs: { [SPEC]: specText({ extra: ['implements: [apps/inbox/src/retention.ts]', 'affects: [../outside.ts]'] }) },
    });
    const r = runValidatePy(tmp);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('../outside.ts');
  });
});

// ─── B. Parity: the shipped twin and the TS rule give the same verdict ───────────
describe.skipIf(!HAS_PY)('#2250 B — validate.py ownership verdict equals validateOwnership', () => {
  const MATRIX: Array<[string, string]> = [
    ['voip shape', specText({})],
    ['plan in-progress', specText({ plan: 'in-progress' })],
    ['plan pending', specText({ plan: 'pending' })],
    ['T2 in build band', specText({ tier: 'T2' })],
    ['T4', specText({ tier: 'T4' })],
    ['tier with inline comment', specText({ tier: 'T3  # raised in #110' })],
    ['plan with inline comment', specText({}).replace('  plan: done', '  plan: done   # merged')],
    ['unknown tier coerces to T2', specText({ tier: 'T9' })],
    ['type requirements', specText({ type: 'requirements' })],
    ['type design', specText({ type: 'design' })],
    ['type tasks', specText({ type: 'tasks' })],
    ['no phases block (the #1441 hole)', specText({ phases: false })],
    ['no frontmatter', '# nothing here\n'],
    ['CRLF line endings', specText({}).replace(/\n/g, '\r\n')],
    ['inline valid', specText({ extra: ['implements: [apps/inbox/src/retention.ts]'] })],
    ['inline comma list', specText({ extra: ['implements: apps/a.ts, apps/b.ts'] })],
    ['block valid', specText({ extra: ['implements:', '  - apps/a.ts', '', '  - "apps/b.ts"  # quoted'] })],
    ['block then other key', specText({ extra: ['implements:', '  - apps/a.ts', 'affects:', '  - apps/c.ts'] })],
    ['empty key', specText({ extra: ['implements:'] })],
    ['empty list', specText({ extra: ['implements: []'] })],
    ['empty string', specText({ extra: ['implements: ""'] })],
    ['comment-only value', specText({ extra: ['implements: # decided at Plan'] })],
    ['bareword', specText({ extra: ['implements: [retention.ts]'] })],
    ['infra prefix', specText({ extra: ['implements: [node_modules/x/index.ts]'] })],
    ['wrong extension', specText({ extra: ['implements: [docs/notes.md]'] })],
    ['none + reason', specText({ extra: ['implements: none', 'implements_reason: policy only'] })],
    ['NONE + reason', specText({ extra: ['implements: NONE', 'implements_reason: policy only'] })],
    ['none, no reason', specText({ extra: ['implements: none'] })],
    ['none, empty reason', specText({ extra: ['implements: none', 'implements_reason:'] })],
    ['escaping implements', specText({ extra: ['implements: [../evil.ts]'] })],
    ['absolute implements', specText({ extra: ['implements: [/etc/x.ts]'] })],
    ['escaping affects', specText({ extra: ['implements: [apps/a.ts]', 'affects: [apps/../../x.ts]'] })],
    ['dot-slash + backslash', specText({ extra: ['implements: [./apps\\inbox\\src\\a.ts]'] })],
    ['top-level plan key only', specText({ phases: false, extra: ['plan: done'] })],
  ];

  it.each(['error', 'warn'])('matches over the fixture matrix at %s', (declaration) => {
    const py = pythonVerdicts(
      tmp,
      MATRIX.map(([, content]) => ({ content, declaration })),
    );
    const mismatches = MATRIX.flatMap(([label, content], i) => {
      const ts = tsVerdict(content, declaration);
      return JSON.stringify(ts) === JSON.stringify(py[i])
        ? []
        : [`${label}: ts=${JSON.stringify(ts)} py=${JSON.stringify(py[i])}`];
    });
    expect(mismatches).toEqual([]);
    // Anti-vacuity: the matrix must exercise both rules at both severities it can reach.
    const seen = new Set(py.flat().map(([r, s]) => `${r}:${s}`));
    expect(seen).toContain(`${MISSING}:${declaration === 'error' ? 'error' : 'warning'}`);
    expect(seen).toContain(`${INVALID}:error`);
  });

  it.each(['error', 'warn'])("matches on every spec in this repo's own corpus at %s", (declaration) => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.md')) files.push(full);
      }
    };
    walk(path.join(REPO_ROOT, 'specs'));
    expect(files.length).toBeGreaterThan(50);
    const contents = files.map((f) => fs.readFileSync(f, 'utf-8'));
    const py = pythonVerdicts(tmp, contents.map((content) => ({ content, declaration })));
    const mismatches = files.flatMap((f, i) => {
      const ts = tsVerdict(contents[i], declaration);
      return JSON.stringify(ts) === JSON.stringify(py[i])
        ? []
        : [`${path.relative(REPO_ROOT, f)}: ts=${JSON.stringify(ts)} py=${JSON.stringify(py[i])}`];
    });
    expect(mismatches).toEqual([]);
    // Anti-vacuity: the corpus must reach the rule's decision on real declarations.
    const armed = contents.filter((c) => {
      const p = parseSpec(c);
      return /^(T3|T4)$/.test(p.frontmatter.tier) && ['in-progress', 'done'].includes(p.frontmatter.phases.plan);
    });
    expect(armed.length).toBeGreaterThan(10);
  });

  it('owned-path rules are interpolated from the TS source of truth, not retyped', async () => {
    const { OWNED_SRC_EXT_PATTERN, OWNED_INFRA_PREFIXES } = await import('../src/lib/ownership-path-rules');
    const text = validatePyText();
    expect(text).toContain(`re.compile(r"${OWNED_SRC_EXT_PATTERN}", re.IGNORECASE)`);
    for (const prefix of OWNED_INFRA_PREFIXES) expect(text).toContain(JSON.stringify(prefix));
  });
});

// ─── C. A new repo starts ratcheted, and every path then rejects the same spec ─────
describe('#2250 C — a fresh scaffold starts at "error" when there is nothing to grandfather', () => {
  const readSeeded = (dir: string): unknown =>
    JSON.parse(fs.readFileSync(path.join(dir, '.minspec', 'config.json'), 'utf-8')).ownershipDeclaration;

  it('an empty repo is seeded with ownershipDeclaration "error"', () => {
    scaffold(tmp);
    expect(readSeeded(tmp)).toBe('error');
  });

  it('a repo whose specs already declare ownership is seeded with "error"', () => {
    fs.mkdirSync(path.join(tmp, 'specs'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'specs', 'SPEC-003-x.md'),
      specText({ extra: ['implements: [apps/inbox/src/retention.ts]'] }),
    );
    scaffold(tmp);
    expect(readSeeded(tmp)).toBe('error');
  });

  it('a repo with an armed, undeclared spec is grandfathered at "warn" (FR-7: no flag day)', () => {
    fs.mkdirSync(path.join(tmp, 'specs', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'specs', 'nested', 'SPEC-003-x.md'), specText({}));
    scaffold(tmp);
    expect(readSeeded(tmp)).toBe('warn');
  });

  it('an unreadable specs tree seeds the pre-#2250 "warn", and says so', () => {
    // `specs` as a FILE: it exists, but cannot be listed.
    fs.writeFileSync(path.join(tmp, 'specs'), 'not a directory');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      scaffold(tmp);
      expect(readSeeded(tmp)).toBe('warn');
      expect(warn.mock.calls.flat().join(' ')).toContain('ownershipDeclaration');
    } finally {
      warn.mockRestore();
    }
  });

  it('never rewrites an existing config (the ratchet is the adopter\'s once it exists)', () => {
    fs.mkdirSync(path.join(tmp, '.minspec'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.minspec', 'config.json'),
      JSON.stringify({ version: '1', ownershipDeclaration: 'warn' }),
    );
    scaffold(tmp);
    expect(readSeeded(tmp)).toBe('warn');
  });

  it('under the seeded config every path rejects a T3 spec without implements:', () => {
    scaffold(tmp);
    const config = loadConfig(tmp);

    // Approve command (commands/approve.ts): refuses when validateSpec is not complete.
    // The declared twin is complete, so the refusal is caused by the missing
    // declaration and nothing else in the fixture.
    const armed = parseSpec(specText({}));
    const result = validateSpec(armed, config);
    expect(result.complete).toBe(false);
    expect(result.violations.find((v) => v.rule === MISSING)?.severity).toBe('error');
    const declared = parseSpec(specText({ extra: ['implements: [apps/inbox/src/retention.ts]'] }));
    expect(validateSpec(declared, config).complete).toBe(true);

    // Authoring -> approval: a T3 spec still in Specify is refused at the advance.
    const drafted = parseSpec(specText({ plan: 'pending' }));
    expect(validateSpec(drafted, config).violations.map((v) => v.rule)).not.toContain(MISSING);
    expect(violationsIntroducedByApproval(drafted, config).map((v) => v.rule)).toContain(MISSING);

    // Commit and CI: the shipped validator, against the seeded config on disk.
    if (HAS_PY) {
      fs.mkdirSync(path.join(tmp, '.minspec', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.minspec', 'hooks', 'validate.py'), validatePyText());
      fs.mkdirSync(path.join(tmp, 'specs'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'specs', 'SPEC-003-x.md'), specText({}));
      expect(runValidatePy(tmp).code).toBe(1);
    }
  });
});
