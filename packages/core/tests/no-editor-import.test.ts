// SPEC-136 FR-1, FR-13: the core bundle imports no editor module and runs with
// nothing around it. Control: an entry that reaches diagnostics.ts (which imports vscode)
// must be reported by the same scan, so the scan is proven able to go red.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCore } from '../build.mjs';

type Meta = { inputs: Record<string, { imports: { path: string; kind: string; external?: boolean }[] }> };

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
let work: string;

function editorImports(metafile: Meta | undefined): string[] {
  const hits: string[] = [];
  for (const [input, info] of Object.entries(metafile?.inputs ?? {})) {
    for (const imp of info.imports) {
      if (imp.path === 'vscode' || imp.path.startsWith('vscode/')) hits.push(`${input} -> ${imp.path}`);
    }
  }
  return hits;
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'minspec-core-noeditor-'));
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('core bundle is editor-free (FR-1, FR-13)', () => {
  it('no input of the bundle imports vscode', async () => {
    const { metafile } = await buildCore({
      outfile: join(work, 'real', 'minspec-core.cjs'),
      metafile: true,
      external: ['vscode'],
    });
    expect(Object.keys(metafile?.inputs ?? {}).length).toBeGreaterThan(0);
    expect(editorImports(metafile)).toEqual([]);
  });

  it('control: an entry reaching diagnostics.ts is reported', async () => {
    const entry = join(work, 'control-entry.ts');
    const diagnostics = join(repoRoot, 'packages/minspec/src/lib/diagnostics.ts');
    writeFileSync(entry, `import ${JSON.stringify(diagnostics)};\n`);
    const { metafile } = await buildCore({
      outfile: join(work, 'control', 'out.cjs'),
      metafile: true,
      entry,
      external: ['vscode'],
    });
    const hits = editorImports(metafile);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.join('\n')).toContain('diagnostics.ts');
  });

  it('the single output file runs --version alone in an empty directory', async () => {
    const built = join(work, 'solo', 'built');
    await buildCore({ outfile: join(built, 'minspec-core.cjs'), metafile: false });
    const empty = join(work, 'solo', 'empty');
    mkdirSync(empty, { recursive: true });
    copyFileSync(join(built, 'minspec-core.cjs'), join(empty, 'minspec-core.cjs'));
    expect(readdirSync(empty)).toEqual(['minspec-core.cjs']);
    const out = execFileSync(process.execPath, ['minspec-core.cjs', '--version'], {
      cwd: empty,
      encoding: 'utf8',
    });
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+\+\S+$/);
    expect(out.trim()).not.toContain('unstamped');
  });
});
