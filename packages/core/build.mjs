// build.mjs — the one path that produces the headless core bundle (SPEC-136 FR-1, FR-13).
// One CommonJS file, platform node, no runtime dependencies. The version stamp is injected
// with esbuild `define`, like scripts/build-extension.sh, so no generated source file exists.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** `<package.json version>+<short sha>`, `-dirty` when packages/ or scripts/ are dirty. */
export function coreVersionStamp() {
  const version = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')).version;
  const sha = git(['rev-parse', '--short=8', 'HEAD']);
  if (!sha) return `${version}+unknown`;
  const dirty = git(['status', '--porcelain', '--', 'packages', 'scripts']);
  return `${version}+${sha}${dirty ? '-dirty' : ''}`;
}

/**
 * @param {{ outfile: string, metafile?: boolean | string, entry?: string, external?: string[] }} options
 *   `metafile: true` returns the metafile; a string also writes it to that path.
 */
export async function buildCore({ outfile, metafile = false, entry, external = [] }) {
  const result = await build({
    entryPoints: [entry ?? resolve(here, 'src/cli.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external,
    metafile: Boolean(metafile),
    logLevel: 'silent',
    define: { __MINSPEC_CORE_VERSION__: JSON.stringify(coreVersionStamp()) },
  });
  if (typeof metafile === 'string' && result.metafile) {
    writeFileSync(metafile, JSON.stringify(result.metafile));
  }
  return { metafile: result.metafile };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outfile = resolve(here, 'dist/minspec-core.cjs');
  await buildCore({ outfile });
  console.log(`built ${outfile}`);
}
