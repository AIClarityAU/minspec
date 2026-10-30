// Command line entry for the headless core. Only `--version` so far; operations arrive in
// later SPEC-136 tasks.

declare const __MINSPEC_CORE_VERSION__: string | undefined;

/** The stamped build version, or `0.0.0+unstamped` when the bundle was not built by buildCore. */
export function coreVersion(): string {
  return typeof __MINSPEC_CORE_VERSION__ === 'string' ? __MINSPEC_CORE_VERSION__ : '0.0.0+unstamped';
}

export function main(argv: readonly string[]): number {
  if (argv.length === 1 && argv[0] === '--version') {
    process.stdout.write(`${coreVersion()}\n`);
    return 0;
  }
  process.stderr.write('usage: minspec-core --version\n');
  return 2;
}

process.exitCode = main(process.argv.slice(2));
