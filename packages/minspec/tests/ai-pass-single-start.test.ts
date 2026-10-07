/**
 * T0 (#2570, the gate that was missing) - `claude` is started with a prompt in exactly one
 * place, and that place is the sealed one.
 *
 * WHY THIS EXISTS. The AI pass started `claude -p` with its default tools and no working
 * directory for as long as it shipped, and every check stayed green. The only gate on
 * process starts, `SPAWN_ALLOWLIST` in invariants.test.ts, asks WHICH file may load
 * `child_process`. It never asked HOW an allowlisted file starts the binary, so an
 * unsealed start passed it. That is the asymmetry this file closes: fixing the one call
 * (tests/ai-pass-no-tools.test.ts pins what it sends) does nothing for the next one,
 * written by someone who has not read #2570.
 *
 * THE PROPERTY. Across every source file, a literal that names the binary appears only
 * as the first argument of a call, and each such call is one of two things:
 *
 *   the probe         `claude --version`, which carries no prompt
 *   the sealed start  in lib/epic-backfill.ts, with its arguments from `aiPassArgs()`,
 *                     its environment from `aiPassEnv()`, and a `cwd`
 *
 * Anything else is refused: a second start, a start elsewhere, the sealed start with a
 * part taken out, and the binary's name anywhere a start cannot be read off it (held in a
 * constant, joined into a command line, handed to a launcher). The last group is refused
 * on purpose even though it is not itself a start. A check that reads syntax can only
 * vouch for the starts it can see, so the name has to stay where it can be seen.
 *
 * WHAT IT CANNOT SEE, stated rather than left to be assumed: a name assembled at run time
 * (`'cl' + 'aude'`), or read from configuration. This guards against the honest next call
 * site, not against someone working around it.
 *
 * NOT VACUOUS BY CONSTRUCTION. A source scan passes when it finds nothing, which is also
 * what it does when it is broken. So it asserts that it found the two real starts, and
 * the second half of this file runs the same scan over planted violations of every shape
 * above and requires each to be refused.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const SRC_ROOT = path.resolve(__dirname, '..', 'src');

/** The one module allowed to hand `claude` a prompt, and the builders its start must use. */
const SEALED_MODULE = 'lib/epic-backfill.ts';
const ARGS_BUILDER = 'aiPassArgs';
const ENV_BUILDER = 'aiPassEnv';

/** A literal that names the binary: the bare name, a Windows spelling of it, or a command line that begins with it. */
const NAMES_THE_BINARY = /^\s*claude(?:\.(?:exe|cmd|bat))?(?:\s|$)/;

type Role = 'probe' | 'sealed-start' | 'unsealed-start' | 'stray-name';

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly role: Role;
  /** The source of the call, or of the literal when it is not in one. */
  readonly code: string;
  /** For a refusal: what is wrong with it. */
  readonly why: string;
}

function isCallTo(node: ts.Node | undefined, name: string): boolean {
  return node !== undefined && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
}

function property(node: ts.Node | undefined, name: string): ts.ObjectLiteralElementLike | undefined {
  if (node === undefined || !ts.isObjectLiteralExpression(node)) return undefined;
  return node.properties.find(
    p => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === name,
  );
}

/** `['--version']` and nothing else: an argument list that cannot carry a prompt. */
function isVersionOnly(node: ts.Node | undefined): boolean {
  return (
    node !== undefined &&
    ts.isArrayLiteralExpression(node) &&
    node.elements.length === 1 &&
    ts.isStringLiteralLike(node.elements[0]) &&
    node.elements[0].text === '--version'
  );
}

/** Every literal in one source file that names the binary, and what it is doing there. */
function scanSource(file: string, text: string): Finding[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, /* setParentNodes */ true);
  const findings: Finding[] = [];
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const oneLine = (node: ts.Node): string => node.getText(source).replace(/\s+/g, ' ').slice(0, 160);

  const classify = (literal: ts.Node): void => {
    const call = literal.parent;
    if (!ts.isCallExpression(call) || call.arguments[0] !== literal) {
      findings.push({
        file, line: lineOf(literal), role: 'stray-name', code: oneLine(literal.parent),
        why: 'the name is not the first argument of a call, so what it starts cannot be checked',
      });
      return;
    }
    const [, args, options] = call.arguments;
    if (isVersionOnly(args)) {
      findings.push({ file, line: lineOf(call), role: 'probe', code: oneLine(call), why: '' });
      return;
    }
    const problems: string[] = [];
    if (file !== SEALED_MODULE) problems.push(`only ${SEALED_MODULE} may start it with a prompt`);
    if (!isCallTo(args, ARGS_BUILDER)) problems.push(`its arguments do not come from ${ARGS_BUILDER}()`);
    const env = property(options, 'env');
    if (env === undefined || !ts.isPropertyAssignment(env) || !isCallTo(env.initializer, ENV_BUILDER)) {
      problems.push(`its env does not come from ${ENV_BUILDER}()`);
    }
    if (property(options, 'cwd') === undefined) problems.push('it sets no cwd');
    findings.push({
      file, line: lineOf(call), code: oneLine(call),
      role: problems.length === 0 ? 'sealed-start' : 'unsealed-start',
      why: problems.join('; '),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && NAMES_THE_BINARY.test(node.text)) classify(node);
    else if (ts.isTemplateExpression(node) && NAMES_THE_BINARY.test(node.head.text)) classify(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

const refused = (findings: readonly Finding[]): Finding[] =>
  findings.filter(f => f.role === 'unsealed-start' || f.role === 'stray-name');

const describeFinding = (f: Finding): string => `${f.file}:${f.line}: ${f.code}  <- ${f.why}`;

/** Every .ts file under src, with no directory skipped: the property is about all of it. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const relSrc = (file: string): string => path.relative(SRC_ROOT, file).split(path.sep).join('/');

// ─── The source tree ──────────────────────────────────────────────────────────

describe('#2570 - `claude` is started with a prompt in exactly one, sealed, place', () => {
  const files = sourceFiles(SRC_ROOT);
  const findings = files.flatMap(file => scanSource(relSrc(file), fs.readFileSync(file, 'utf-8')));

  it('reads the whole source tree rather than an empty list', () => {
    const names = files.map(relSrc);
    expect(names.length).toBeGreaterThanOrEqual(100);
    expect(names).toContain(SEALED_MODULE);
    expect(names).toContain('commands/backfill-epics.ts');
    expect(names).toContain('extension.ts');
  });

  it('finds the two starts that exist, so a clean result is not a blind one', () => {
    const probes = findings.filter(f => f.role === 'probe');
    const sealed = findings.filter(f => f.role === 'sealed-start');

    expect(probes.map(f => f.file)).toEqual([SEALED_MODULE]);
    expect(sealed.map(f => f.file)).toEqual([SEALED_MODULE]);
  });

  it('nothing else starts it, and nothing else names it', () => {
    expect(
      refused(findings).map(describeFinding),
      'A prompt reaches `claude` only through the sealed start in lib/epic-backfill.ts (#2570). ' +
        'Route the new call through it; do not copy it, and do not start the binary by another name.',
    ).toEqual([]);
  });
});

// ─── The scan catches what it is for ──────────────────────────────────────────

describe('the scan refuses every shape of unsealed start', () => {
  const SEALED_CALL =
    "await execFileAsync('claude', aiPassArgs(prompt), { cwd: workDir, timeout, env: aiPassEnv(), signal });";

  it.each<{ shape: string; file: string; source: string; role: Role; why: RegExp }>([
    {
      shape: 'a direct start in another module',
      file: 'lib/other.ts',
      source: "execFile('claude', ['-p', prompt], callback);",
      role: 'unsealed-start', why: /only lib\/epic-backfill\.ts may start it/,
    },
    {
      shape: 'a second, plainer start in the sealed module (the retry that undoes the fix)',
      file: SEALED_MODULE,
      source: "await execFileAsync('claude', ['-p', prompt], { timeout });",
      role: 'unsealed-start', why: /arguments do not come from aiPassArgs\(\)/,
    },
    {
      shape: 'the sealed start with its directory taken out',
      file: SEALED_MODULE,
      source: "await execFileAsync('claude', aiPassArgs(prompt), { timeout, env: aiPassEnv() });",
      role: 'unsealed-start', why: /sets no cwd/,
    },
    {
      shape: 'the sealed start with the plain environment',
      file: SEALED_MODULE,
      source: "await execFileAsync('claude', aiPassArgs(prompt), { cwd: workDir, env: { ...process.env } });",
      role: 'unsealed-start', why: /env does not come from aiPassEnv\(\)/,
    },
    {
      shape: 'the sealed start with hand-written arguments',
      file: SEALED_MODULE,
      source: "await execFileAsync('claude', ['-p', prompt, '--tools', ''], { cwd: workDir, env: aiPassEnv() });",
      role: 'unsealed-start', why: /arguments do not come from aiPassArgs\(\)/,
    },
    {
      shape: 'the sealed start copied into another module',
      file: 'commands/other.ts',
      source: SEALED_CALL,
      role: 'unsealed-start', why: /only lib\/epic-backfill\.ts may start it/,
    },
    {
      shape: "a prompt behind the probe's switch",
      file: SEALED_MODULE,
      source: "await execFileAsync('claude', ['--version', '-p', prompt], { timeout });",
      role: 'unsealed-start', why: /arguments do not come from aiPassArgs\(\)/,
    },
    {
      shape: 'spawn instead of execFile',
      file: 'lib/other.ts',
      source: "spawn('claude', ['--print', prompt]);",
      role: 'unsealed-start', why: /only lib\/epic-backfill\.ts/,
    },
    {
      shape: 'a shell command line',
      file: 'lib/other.ts',
      source: "execSync('claude -p \"summarise this\"');",
      role: 'unsealed-start', why: /only lib\/epic-backfill\.ts/,
    },
    {
      shape: 'a template command line',
      file: 'lib/other.ts',
      source: 'exec(`claude -p ${prompt}`, callback);',
      role: 'unsealed-start', why: /only lib\/epic-backfill\.ts/,
    },
    {
      shape: 'the Windows spelling',
      file: 'lib/other.ts',
      source: "execFile('claude.exe', ['-p', prompt], callback);",
      role: 'unsealed-start', why: /only lib\/epic-backfill\.ts/,
    },
    {
      shape: 'the name held in a constant',
      file: 'lib/other.ts',
      source: "const BIN = 'claude';\nexecFile(BIN, ['-p', prompt], callback);",
      role: 'stray-name', why: /not the first argument of a call/,
    },
    {
      shape: 'the name handed to a launcher',
      file: 'lib/other.ts',
      source: "spawn('npx', ['claude', '-p', prompt]);",
      role: 'stray-name', why: /not the first argument of a call/,
    },
    {
      shape: 'the name joined into a command line',
      file: 'lib/other.ts',
      source: "exec('claude ' + args.join(' '), callback);",
      role: 'stray-name', why: /not the first argument of a call/,
    },
  ])('refuses $shape', ({ file, source, role, why }) => {
    const found = refused(scanSource(file, source));

    expect(found).toHaveLength(1);
    expect(found[0].role).toBe(role);
    expect(found[0].why).toMatch(why);
    // The line it reports is the line the violation is on.
    expect(source.split('\n')[found[0].line - 1]).toContain('claude');
  });

  it('accepts the probe', () => {
    const findings = scanSource(
      SEALED_MODULE,
      "await execFileAsync('claude', ['--version'], { timeout: 5000, env: { ...process.env } });",
    );

    expect(findings.map(f => f.role)).toEqual(['probe']);
  });

  it('accepts the sealed start, in the sealed module only', () => {
    expect(scanSource(SEALED_MODULE, SEALED_CALL).map(f => f.role)).toEqual(['sealed-start']);
  });

  it('is not set off by prose that mentions the binary', () => {
    const findings = scanSource(
      'lib/other.ts',
      [
        '// starts `claude -p` when the user asks for the AI pass',
        "const absent = { reason: 'claude-absent', detail: 'could not run `claude` (Claude Code is not on PATH)' };",
        "const ask = 'MinSpec: Claude Code detected. (Runs `claude -p` locally.)';",
        "const dir = path.join(home, '.claude');",
      ].join('\n'),
    );

    expect(findings).toEqual([]);
  });
});
