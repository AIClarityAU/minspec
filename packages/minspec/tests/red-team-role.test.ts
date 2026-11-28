/**
 * T1 — feature (#129): `scripts/roles/red-team.md` exists with the DR-029 §5
 * two-lens reality-check prompts and DR-030 untrusted-input framing.
 * Root cause: n/a — pure feature. Content assertions on the static role file.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function findRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts', 'roles'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('repo root not found from ' + __dirname);
}

const body = fs.readFileSync(path.join(findRoot(), 'scripts', 'roles', 'red-team.md'), 'utf-8');

describe('red-team role (#129)', () => {
  it('has the role heading', () => {
    expect(body.startsWith('# Role: Red-team')).toBe(true);
  });
  it('covers the four attack classes from the issue', () => {
    for (const s of ['Omitted risk', 'Specific-but-wrong mitigation', 'Unconsidered failure mode', 'Missing alternative']) {
      expect(body).toContain(s);
    }
  });
  it('defines both default lenses', () => {
    expect(body).toContain('Lens A — "Find the bug"');
    expect(body).toContain('Lens B — "Defend the spec"');
  });
  it('frames the document as untrusted input (DR-030)', () => {
    expect(body).toMatch(/UNTRUSTED DATA/);
  });
  it('is read-only and carries the escalation rule', () => {
    expect(body).toMatch(/Read-only/);
    expect(body).toContain('ESCALATE: <one-line reason>');
  });
});
