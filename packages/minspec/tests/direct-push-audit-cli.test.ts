/**
 * T1 — arg parsing for the #688 harden CLI (scripts/direct-push-audit.ts).
 * The network/`gh`/`git` IO in that script is a thin, untested-by-design
 * shell (same convention as audit-ruleset-integration-ids.ts) — only the
 * pure parseArgs is unit-tested here; the decision logic it calls into is
 * covered by direct-push-audit.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../../scripts/direct-push-audit';

describe('parseArgs', () => {
  it('parses owner/repo/before/after', () => {
    const args = parseArgs(['--owner', 'AIClarityAU', '--repo', 'minspec', '--before', 'aaa', '--after', 'bbb']);
    expect(args).toEqual({
      owner: 'AIClarityAU',
      repo: 'minspec',
      before: 'aaa',
      after: 'bbb',
      pusher: undefined,
      runUrl: undefined,
    });
  });

  it('parses optional pusher and run-url', () => {
    const args = parseArgs([
      '--owner', 'AIClarityAU',
      '--repo', 'minspec',
      '--before', 'aaa',
      '--after', 'bbb',
      '--pusher', 'someadmin',
      '--run-url', 'https://github.com/AIClarityAU/minspec/actions/runs/1',
    ]);
    expect(args.pusher).toBe('someadmin');
    expect(args.runUrl).toBe('https://github.com/AIClarityAU/minspec/actions/runs/1');
  });

  it('defaults all fields to empty/undefined when absent', () => {
    expect(parseArgs([])).toEqual({
      owner: '',
      repo: '',
      before: '',
      after: '',
      pusher: undefined,
      runUrl: undefined,
    });
  });
});
