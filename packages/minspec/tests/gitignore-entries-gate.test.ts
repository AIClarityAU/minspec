/** #383: validate gate asserting committed .gitignore ⊇ MINSPEC_GITIGNORE_ENTRIES. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { missingGitignoreEntries } from '../../../scripts/lib/gitignore-entries';
import { MINSPEC_GITIGNORE_ENTRIES } from '../src/lib/scaffold';

describe('missingGitignoreEntries', () => {
  it('reports every entry absent from the drifted text (the #383 leak)', () => {
    const drifted = '.minspec/session.json\n.minspec/calibration.json\n';
    const missing = missingGitignoreEntries(drifted, MINSPEC_GITIGNORE_ENTRIES);
    expect(missing).toContain('.minspec/template-baseline.json');
    expect(missing).toContain('.minspec/generated-hashes.json');
    expect(missing).not.toContain('.minspec/session.json');
  });
  it('tolerates whitespace and CRLF', () => {
    expect(missingGitignoreEntries('  a  \r\nb\r\n', ['a', 'b'])).toEqual([]);
  });
  it('treats an empty .gitignore as missing everything', () => {
    expect(missingGitignoreEntries('', ['a'])).toEqual(['a']);
  });
  it("this repo's committed .gitignore covers every entry", () => {
    const text = readFileSync(join(__dirname, '../../../.gitignore'), 'utf8');
    expect(missingGitignoreEntries(text, MINSPEC_GITIGNORE_ENTRIES)).toEqual([]);
  });
});
