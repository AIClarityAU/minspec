/**
 * SPEC-038 / #460 — TS↔Python ownership-path parity (design P1, canonical-parity pattern).
 *
 * The validator's owned-path rules (`src/lib/ownership-path-rules.ts`) MUST agree with
 * the gate's (`scripts/hooks/spec-gate.py`), or a declaration the validator accepts
 * might not actually arm the gate. This test reads the gate's `_SRC_EXT_RE` pattern and
 * `_INFRA_PREFIXES` straight from its source and asserts the TS constants match
 * byte-for-byte — it fails the moment either side drifts.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  OWNED_SRC_EXT_PATTERN,
  OWNED_INFRA_PREFIXES,
  isValidOwnedPath,
} from '../src/lib/ownership-path-rules';

const testDir = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(testDir, '../../../scripts/hooks/spec-gate.py');
const gateSrc = readFileSync(GATE, 'utf-8');

/** Concatenate the `r'...'` raw-string segments of `_SRC_EXT_RE = re.compile( … )`. */
function gateSrcExtPattern(): string {
  // Anchor on the trailing `, re.I)` — the pattern itself contains `)` inside `(?:…)`,
  // so a bare first-`)` boundary would truncate the multi-line raw string.
  const block = gateSrc.match(/_SRC_EXT_RE\s*=\s*re\.compile\(([\s\S]*?),\s*re\.I\s*\)/);
  if (!block) throw new Error('could not locate _SRC_EXT_RE in spec-gate.py');
  const parts = [...block[1].matchAll(/r'([^']*)'/g)].map((m) => m[1]);
  if (parts.length === 0) throw new Error('no raw-string parts in _SRC_EXT_RE');
  return parts.join('');
}

/** The string tuple `_INFRA_PREFIXES = ( … )`. */
function gateInfraPrefixes(): string[] {
  const block = gateSrc.match(/_INFRA_PREFIXES\s*=\s*\(([\s\S]*?)\)/);
  if (!block) throw new Error('could not locate _INFRA_PREFIXES in spec-gate.py');
  return [...block[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

describe('SPEC-038 ownership-path rules ↔ spec-gate.py parity (#460)', () => {
  it('_SRC_EXT_RE pattern matches the TS mirror exactly', () => {
    expect(OWNED_SRC_EXT_PATTERN).toBe(gateSrcExtPattern());
  });

  it('_INFRA_PREFIXES matches the TS mirror exactly (same order)', () => {
    expect([...OWNED_INFRA_PREFIXES]).toEqual(gateInfraPrefixes());
  });

  describe('isValidOwnedPath mirrors the gate consider() filters', () => {
    it('accepts a repo-relative source path (existence-independent)', () => {
      expect(isValidOwnedPath('packages/minspec/src/lib/new-thing.ts')).toBe(true); // greenfield OK
      expect(isValidOwnedPath('./scripts/hooks/spec-gate.py')).toBe(true);
      expect(isValidOwnedPath('"packages/minspec/src/x.tsx"')).toBe(true); // quoted
    });
    it('rejects absolute and parent-escape paths', () => {
      expect(isValidOwnedPath('/etc/passwd.ts')).toBe(false);
      expect(isValidOwnedPath('../../x.ts')).toBe(false);
      expect(isValidOwnedPath('packages/../../x.ts')).toBe(false);
    });
    it('rejects infra-prefixed paths', () => {
      expect(isValidOwnedPath('node_modules/foo/index.js')).toBe(false);
      expect(isValidOwnedPath('dist/bundle.js')).toBe(false);
    });
    it('rejects non-source extensions and bare tokens', () => {
      expect(isValidOwnedPath('docs/README.md')).toBe(false); // .md not a source ext
      expect(isValidOwnedPath('just-a-word')).toBe(false); // no slash
      expect(isValidOwnedPath('')).toBe(false);
    });
  });
});

// #802 — BEHAVIORAL parity: constants matching isn't enough (python-side FILTER logic
// could drift while the constants stay equal). Drive the REAL gate on a case matrix and
// assert its own-decision equals isValidOwnedPath for every case. One tmp repo whose spec
// declares ALL cases; the gate's owned set is then exactly the cases consider() accepts.
describe('SPEC-038 #802 — isValidOwnedPath agrees with the real gate, case-by-case', () => {
  const gateSh = resolve(testDir, '../../../scripts/hooks/spec-gate.sh');
  const CASES = [
    'pkg/a.ts', // owned
    'pkg/sub/b.tsx', // owned
    'scripts/x.py', // owned
    '../escape.ts', // parent-escape → skipped
    'node_modules/x.js', // infra → skipped
    'dist/y.js', // infra → skipped
    'a/b.md', // wrong ext → skipped
    'bareword', // no slash → skipped
  ];
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'own-802-'));
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    mkdirSync(join(tmp, '.minspec'), { recursive: true });
    writeFileSync(join(tmp, '.minspec/config.json'), '{"version":"1"}');
    const specDir = join(tmp, 'specs/minspec/SPEC-901-parity');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, 'requirements.md'),
      [
        '---', 'id: SPEC-901', 'title: parity fixture', 'tier: T3', 'status: implementing',
        'created: 2026-07-16', `implements: [${CASES.join(', ')}]`,
        'phases:', '  specify: done', '  clarify: done', '  plan: in-progress',
        '  tasks: pending', '  implement: pending', '---', '', '## Specify', 'x', '',
      ].join('\n'),
    );
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function gateOwns(p: string): boolean {
    // Strip the kill-switch so an inherited MINSPEC_GATE_OFF=1 can't make the gate
    // fail open and turn this into a silent pass/spurious fail (#812).
    const env = { ...process.env };
    delete env.MINSPEC_GATE_OFF;
    const envelope = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(tmp, p) }, cwd: tmp });
    let out = '';
    try {
      out = execFileSync('bash', [gateSh], { input: envelope, encoding: 'utf-8', env });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      out = (err.stdout ?? '') + (err.stderr ?? '');
    }
    return out.includes('deny');
  }

  it('control: the gate is actually active (a known-owned path denies)', () => {
    // If this fails the gate is inert (kill-switch / missing python) and the matrix
    // below would be meaningless — assert liveness first.
    expect(gateOwns('pkg/a.ts')).toBe(true);
  });

  it.each(CASES)('gate own-decision == isValidOwnedPath for %s', (p) => {
    expect(gateOwns(p)).toBe(isValidOwnedPath(p));
  });
});
