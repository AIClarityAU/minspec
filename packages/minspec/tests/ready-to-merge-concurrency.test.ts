import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// #1110 / #1973: ready-to-merge is the single writer of the (sha, context)
// status, but must also be ONE RUN AT A TIME per PR — otherwise a stale run
// that finishes late overwrites a fresher verdict (green on an unreviewed head,
// or red on a reviewed one). Queueing (cancel-in-progress: false) is
// deliberate: a cancelled run that never posted leaves the required status
// pending forever, and GitHub keeps the newest pending run, so the last write
// is always the latest-started evaluation.
const WF = join(__dirname, '..', '..', '..', '.github', 'workflows', 'ready-to-merge.yml');
const yaml = readFileSync(WF, 'utf8');
const code = yaml
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');

describe('ready-to-merge workflow concurrency (#1110)', () => {
  it('serialises runs per PR number', () => {
    const m = code.match(/^concurrency:\n\s+group:\s*(.+)\n\s+cancel-in-progress:\s*(\w+)/m);
    expect(m, 'top-level concurrency block missing').not.toBeNull();
    expect(m![1]).toContain('github.event.pull_request.number');
    expect(m![1]).toContain('ready-to-merge');
  });

  it('queues rather than cancels, so the required status is always written', () => {
    const m = code.match(/^concurrency:\n\s+group:.*\n\s+cancel-in-progress:\s*(\w+)/m);
    expect(m![1]).toBe('false');
  });
});
