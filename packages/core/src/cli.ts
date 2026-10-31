// Command line entry for the headless core (SPEC-136 FR-9). `<operation> [--root <dir>] [flags]`
// is parsed against the operation's `input` schema; one envelope is printed as JSON on stdout.
import * as path from 'path';
import {
  coreVersion,
  EXIT_CODES,
  OPERATIONS,
  refusedResult,
  runOperation,
  type CoreResult,
  type Operation,
} from './operations';

export { coreVersion };

type Parsed = { args: Record<string, unknown>; root: string } | { error: string; root: string };

/** Parse `--flag value` pairs against the operation's input schema; `--root` is always allowed. */
function parseFlags(op: Operation, rest: readonly string[]): Parsed {
  const args: Record<string, unknown> = {};
  let root = process.cwd();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (!flag.startsWith('--')) return { error: `unexpected argument ${flag}`, root };
    const key = flag.slice(2);
    const value = rest[i + 1];
    if (value === undefined) return { error: `${flag} needs a value`, root };
    if (key === 'root') root = path.resolve(value);
    else if (key in op.input.properties) args[key] = value;
    else return { error: `unknown flag ${flag} for ${op.name}`, root };
  }
  for (const req of op.input.required ?? []) {
    if (!(req in args)) return { error: `${op.name} needs --${req}`, root };
  }
  return { args, root };
}

function emit(result: CoreResult): number {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return EXIT_CODES[result.outcome];
}

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 1 && argv[0] === '--version') {
    process.stdout.write(`${coreVersion()}\n`);
    return 0;
  }
  if (argv.length === 1 && argv[0] === '--list') {
    for (const op of OPERATIONS) process.stdout.write(`${op.name}\t${op.summary}\n`);
    return 0;
  }
  const [name, ...rest] = argv;
  const root = process.cwd();
  if (name === undefined) {
    return emit(refusedResult('', root, 'bad-argument', 'usage: minspec-core <operation> [--root <dir>] | --list | --version'));
  }
  const op = OPERATIONS.find((o) => o.name === name);
  if (!op) return emit(refusedResult(name, root, 'unknown-operation', `unknown operation ${name}; --list shows the table`));
  const parsed = parseFlags(op, rest);
  if ('error' in parsed) return emit(refusedResult(op.name, parsed.root, 'bad-argument', parsed.error));
  return emit(await runOperation(op, parsed.root, parsed.args));
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    process.stderr.write(`minspec-core: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 3;
  },
);
