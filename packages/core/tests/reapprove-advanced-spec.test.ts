// in97 review of #3960: the core `approve` operation (CLI + MCP) must not refuse re-approval of
// a spec already at planning/implementing for a missing `implements:` - the advance the guard
// simulates never happens there. Control: new/specifying with no `implements:` is still refused.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildBundle, runCore } from './helpers';

const BODY = `## Specify
Build the thing.
- [ ] criterion one

## Plan
Steps.

## Tasks
- [ ] task a

## Implement
code.
`;

function spec(status: string): string {
  return [
    '---',
    'id: SPEC-950',
    'title: Core Reapprove Fixture',
    'type: requirements',
    'tier: T3',
    `status: ${status}`,
    'created: 2026-08-07',
    'phases:',
    '  specify: done',
    '  clarify: done',
    '  plan: pending',
    '  tasks: pending',
    '  implement: pending',
    '---',
    '',
    BODY,
  ].join('\n');
}

let work: string;
let bundle: string;
let n = 0;

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

function fixture(status: string): string {
  const dir = join(work, `repo-${n++}`);
  mkdirSync(join(dir, '.minspec'), { recursive: true });
  mkdirSync(join(dir, 'specs'), { recursive: true });
  writeFileSync(join(dir, '.minspec', 'config.json'), JSON.stringify({ version: '1', ownershipDeclaration: 'error' }));
  writeFileSync(join(dir, 'specs', 'one.md'), spec(status));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'human@example.com');
  git(dir, 'config', 'user.name', 'Fixture');
  return dir;
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'minspec-core-reapprove-'));
  bundle = await buildBundle(join(work, 'bundle'));
}, 60_000);
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('core approve: re-approving an already-advanced spec (in97)', () => {
  for (const status of ['planning', 'implementing']) {
    it(`approves an undeclared T3 at status ${status} without advancing it`, () => {
      const dir = fixture(status);
      const r = runCore(bundle, ['approve', '--root', dir, '--spec', 'specs/one.md']);
      expect(r.json.refusal, JSON.stringify(r.json)).toBeUndefined();
      expect(r.json.outcome).toBe('pass');
      const after = readFileSync(join(dir, 'specs', 'one.md'), 'utf8');
      expect(after).toContain(`status: ${status}`);
      expect(after).toContain('plan: pending');
    });
  }

  it('CONTROL: the same spec at status specifying is still refused not-ready-for-advance', () => {
    const dir = fixture('specifying');
    const r = runCore(bundle, ['approve', '--root', dir, '--spec', 'specs/one.md']);
    expect(r.json.outcome).not.toBe('pass');
    expect(JSON.stringify(r.json)).toContain('not-ready-for-advance');
  });
});
