/**
 * #3179 follow-up to the human-held stop: the pure `--decide` cases live in
 * shepherd-decide.test.ts. This file adds the two things they do not cover:
 *   1. a malformed human_held value is refused (exit 2) rather than guessed at;
 *   2. dispatch-issue.sh actually derives the flag, passes it as the 10th argument,
 *      and returns without a hand-off on `stop-human-held`.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/lib/shepherd-pr.sh');
const DISPATCH = path.resolve(__dirname, '../../../scripts/dispatch-issue.sh');

function decideArgv(humanHeld: string): string[] {
  return [SCRIPT, '--decide', 'skip-clean', 'no', 'yes', '0', '2', '0', '3600', 'yes', 'no', humanHeld];
}

describe('shepherd --decide: human_held validation (#3179)', () => {
  it('refuses a malformed human_held value rather than guessing', () => {
    const r = spawnSync('bash', decideArgv('maybe'), { encoding: 'utf-8' });
    expect(r.status).toBe(2);
    expect(r.stdout.trim()).toBe('');
  });

  it('accepts yes and no', () => {
    expect(spawnSync('bash', decideArgv('yes'), { encoding: 'utf-8' }).stdout.trim()).toBe('stop-human-held');
    expect(spawnSync('bash', decideArgv('no'), { encoding: 'utf-8' }).stdout.trim()).toBe('wait');
  });
});

describe('shepherd wiring: dispatch-issue.sh passes human_held and honours stop-human-held (#3179)', () => {
  const code = fs.readFileSync(DISPATCH, 'utf-8');
  const body = (() => {
    const start = code.indexOf('shepherd_own_pr() {');
    expect(start).toBeGreaterThan(-1);
    return code.slice(start, code.indexOf('\n}', start));
  })();

  it('derives human_held from the fetched labels and needs-human-review', () => {
    expect(body).toMatch(/human_held=no/);
    expect(body).toMatch(/\[\[ ",\$labels_csv," == \*",needs-human-review,"\* \]\] && human_held=yes/);
  });

  it('passes human_held as the 10th --decide argument', () => {
    expect(body).toMatch(/"\$checks_pending" "\$automerge_armed" "\$human_held"/);
  });

  it('stop-human-held returns without a hand-off (nothing failed)', () => {
    const start = body.indexOf('stop-human-held)');
    expect(start, 'stop-human-held arm must exist').toBeGreaterThan(-1);
    const arm = body.slice(start, body.indexOf(';;', start));
    expect(arm).toMatch(/return 0/);
    expect(arm).not.toMatch(/shepherd_hand_off/);
    expect(arm).not.toMatch(/--add-label/);
  });
});
