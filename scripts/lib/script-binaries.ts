/**
 * script-binaries.ts — pure decision logic for the "every package.json script binary is
 * declared" gate (#979).
 *
 * Root cause it guards: `npx tsx ...` resolves over the network when `tsx` is not a declared
 * dependency, so a gate can run on whatever version the registry serves (or fail air-gapped,
 * against constitution invariant 1) while `npm ci` and lint stay green. Nothing asserted that
 * the executable a script names comes from a declared package.
 *
 * `findUndeclaredBinaries` is IO-free: the caller supplies the set of binary names provided by
 * declared packages. `checkRepoScriptBinaries` is the one IO entry point, shared by the CLI
 * (scripts/check-script-binaries.ts) and the merge-blocking T0 test so the two cannot drift.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Shell builtins / tools that ship with the platform or npm itself, never declared. */
export const PLATFORM_BINARIES: ReadonlySet<string> = new Set([
  'node', 'npm', 'npx', 'bash', 'sh', 'git', 'echo', 'cd', 'test', '[', 'exit', 'true', 'false',
  'rm', 'mkdir', 'cp', 'mv', 'cat', 'env',
]);

export interface UndeclaredBinary {
  readonly script: string;
  readonly binary: string;
  readonly command: string;
}

const SEGMENT_SPLIT = /&&|\|\||;|\|/;
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Leading executable of one command segment, or null when it is not a bare tool name. */
export function leadingBinary(segment: string): string | null {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && ENV_ASSIGN.test(tokens[i])) i++;
  if (tokens[i] === 'npx') {
    i++;
    while (i < tokens.length && tokens[i].startsWith('-')) i++;
    // `npx` here is the very thing being checked: the tool it names must be declared.
  }
  const tok = tokens[i];
  if (!tok) return null;
  if (/^[./$"'`(]/.test(tok)) return null; // path, variable, quoted, subshell — not a tool name
  return tok;
}

export function findUndeclaredBinaries(
  scripts: Readonly<Record<string, string>>,
  declaredBins: ReadonlySet<string>,
): UndeclaredBinary[] {
  const out: UndeclaredBinary[] = [];
  for (const [script, command] of Object.entries(scripts)) {
    for (const segment of command.split(SEGMENT_SPLIT)) {
      const binary = leadingBinary(segment);
      if (binary === null) continue;
      // `npx tsx` and bare `tsx` must both be declared; `npx` itself is platform.
      if (PLATFORM_BINARIES.has(binary) || declaredBins.has(binary)) continue;
      out.push({ script, binary, command });
    }
  }
  return out;
}

export interface RepoScriptBinariesResult {
  /** Problems that make the check fail; empty = every script binary resolves. */
  readonly errors: readonly string[];
  readonly scriptCount: number;
  readonly binaryCount: number;
}

const readJson = (p: string): Record<string, unknown> => JSON.parse(readFileSync(p, 'utf-8'));

/**
 * Reads `<root>/package.json` and the installed declared packages under `<root>/node_modules`.
 * Fail closed: a missing package.json or an uninstalled declared package is an ERROR, never a
 * silent pass — removing `tsx` from devDependencies while `npx tsx` stays in a script is
 * reported as an undeclared binary, and a declared-but-uninstalled package as not installed.
 */
export function checkRepoScriptBinaries(root: string): RepoScriptBinariesResult {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) {
    return { errors: [`check-script-binaries: ${pkgPath} not found`], scriptCount: 0, binaryCount: 0 };
  }
  const pkg = readJson(pkgPath) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const scripts = pkg.scripts ?? {};
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const bins = new Set<string>();
  const missing: string[] = [];
  for (const name of declared) {
    const p = join(root, 'node_modules', name, 'package.json');
    if (!existsSync(p)) {
      missing.push(name);
      continue;
    }
    const bin = readJson(p).bin;
    if (typeof bin === 'string') bins.add(name.split('/').pop() as string);
    else if (bin && typeof bin === 'object') Object.keys(bin).forEach((b) => bins.add(b));
  }
  if (missing.length > 0) {
    return {
      errors: [`check-script-binaries: declared packages not installed (run npm ci): ${missing.join(', ')}`],
      scriptCount: Object.keys(scripts).length,
      binaryCount: bins.size,
    };
  }
  const errors = findUndeclaredBinaries(scripts, bins).map(
    (b) => `script "${b.script}" runs "${b.binary}", which no declared dependency provides: ${b.command}`,
  );
  return { errors, scriptCount: Object.keys(scripts).length, binaryCount: bins.size };
}
