// Review finding 3 on #3871: core rule 2 (`corpus.spec-id`) must check the same file set as the
// script's "Rule 2/5". Both run on one fixture; the files each flags for a bad `id:` must match.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCorpusRules } from '../src/corpus-rules';

const REPO = resolve(__dirname, '..', '..', '..');
const BAD = '---\nid: BAD\nstatus: specifying\n---\n\n# X\n';
const OK = '---\nid: SPEC-930\nstatus: specifying\n---\n\n# X\n';
const FILES: Record<string, string> = {
  'specs/SPEC-930-x/requirements.md': BAD,
  'specs/SPEC-930-x/design.md': BAD, // not requirements.md: still checked by both
  'specs/loose.md': BAD, // directly under specs/
  'specs/deep/er/notes.md': BAD,
  'specs/SPEC-931-y/requirements.md': OK,
};
let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'minspec-core-idparity-'));
  mkdirSync(join(root, '.minspec'), { recursive: true });
  for (const [f, c] of Object.entries(FILES)) {
    mkdirSync(join(root, dirname(f)), { recursive: true });
    writeFileSync(join(root, f), c);
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('spec id file-set parity (core vs scripts/validate-frontmatter.ts)', () => {
  it('flags exactly the same files', () => {
    const coreFiles = runCorpusRules(root).filter((f) => f.rule === 'corpus.spec-id').map((f) => f.file).sort();
    const r = spawnSync('npx', ['tsx', join(REPO, 'scripts', 'validate-frontmatter.ts')], { cwd: root, encoding: 'utf8' });
    const scriptFiles = (r.stderr + r.stdout)
      .split('\n')
      .filter((l) => l.startsWith('FAIL specs/') && l.includes('missing or invalid `id: SPEC-NNN` frontmatter'))
      .map((l) => l.slice(5).split(':')[0])
      .sort();
    expect(coreFiles).toEqual(Object.keys(FILES).filter((f) => FILES[f] === BAD).sort());
    expect(scriptFiles).toEqual(coreFiles);
  }, 60_000);
});
