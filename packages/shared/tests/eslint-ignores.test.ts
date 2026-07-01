import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// T3 regression (harvest316/minspec#257): `eslint .` OOM-crashed (exit 134,
// "Aborted (core dumped)") after the vscode integration tests downloaded a full
// VS Code editor (multi-hundred-MB minified bundles) into
// packages/minspec/.vscode-test/. ESLint flat config does NOT read .gitignore,
// so with no `ignores` entry it enumerates/reads every file under the project,
// including those bundles, exhausting memory. The gate that should have caught
// it is the flat-config global `ignores` array — absent for build/download
// artifacts. This test asserts that gate exists and matches the offending dir.

async function loadConfig(): Promise<Array<Record<string, unknown>>> {
  const configUrl = new URL('../../../eslint.config.mjs', import.meta.url);
  const mod = await import(fileURLToPath(configUrl));
  return mod.default as Array<Record<string, unknown>>;
}

function globalIgnores(config: Array<Record<string, unknown>>): string[] {
  // A flat-config object with ONLY an `ignores` key is a global ignore.
  return config
    .filter((c) => Array.isArray(c.ignores) && Object.keys(c).length === 1)
    .flatMap((c) => c.ignores as string[]);
}

describe('eslint.config.mjs ignores (regression #257)', () => {
  it('globally ignores the downloaded .vscode-test editor dir', async () => {
    const ignores = globalIgnores(await loadConfig());
    expect(ignores).toContain('**/.vscode-test/**');
  });

  it('ignores build/download artifact dirs but no real source dir', async () => {
    const ignores = globalIgnores(await loadConfig());
    expect(ignores).toContain('**/out/**');
    expect(ignores).toContain('**/dist/**');
    // never exclude real source / tests / scripts
    for (const pat of ignores) {
      expect(pat).not.toMatch(/(^|\/)src(\/|$)/);
      expect(pat).not.toMatch(/(^|\/)tests(\/|$)/);
      expect(pat).not.toMatch(/(^|\/)scripts(\/|$)/);
    }
  });
});
