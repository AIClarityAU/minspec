/**
 * script-binaries.ts — pure decision logic for the "every package.json script binary is
 * declared" gate (#979).
 *
 * Root cause it guards: `npx tsx ...` resolves over the network when `tsx` is not a declared
 * dependency, so a gate can run on whatever version the registry serves (or fail air-gapped,
 * against constitution invariant 1) while `npm ci` and lint stay green. Nothing asserted that
 * the executable a script names comes from a declared package.
 *
 * IO-free: the caller supplies the set of binary names provided by declared packages.
 */

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
