/**
 * T0 - scripts/lib/ready-witness.sh (#4078).
 *
 * Agent-side readers key on a `ready-to-merge` success posted by GitHub Actions, the one
 * writer an agent session's builder-App token cannot impersonate. Pinned here: only the
 * newest `ready-to-merge` status decides, it must be `success` AND created by
 * `github-actions[bot]`, a newer status from anyone else voids it, and unreadable input
 * is `error`, never `no` or `yes`.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const LIB = path.resolve(__dirname, '../../../scripts/lib/ready-witness.sh');

const decide = (input: string): string =>
  execFileSync('bash', ['-c', `source "${LIB}"; ready_witness_from_statuses`], {
    input,
    encoding: 'utf-8',
  }).trim();

const st = (state: string, login: string, at: string, context = 'ready-to-merge') => ({
  context,
  state,
  created_at: at,
  creator: { login },
});

describe('ready_witness_from_statuses (#4078)', () => {
  it('a success from github-actions[bot] is a witness', () => {
    expect(decide(JSON.stringify([st('success', 'github-actions[bot]', '2026-11-26T01:00:00Z')]))).toBe('yes');
  });

  it('a success posted by the builder App is NOT a witness', () => {
    expect(decide(JSON.stringify([st('success', 'minspec-sdd[bot]', '2026-11-26T01:00:00Z')]))).toBe('no');
  });

  it('a newer builder status voids an older Actions success (fail closed, not skipped over)', () => {
    const statuses = [
      st('success', 'minspec-sdd[bot]', '2026-11-26T02:00:00Z'),
      st('success', 'github-actions[bot]', '2026-11-26T01:00:00Z'),
    ];
    expect(decide(JSON.stringify(statuses))).toBe('no');
  });

  it('the newest Actions status decides: a later failure supersedes an earlier success', () => {
    const statuses = [
      st('failure', 'github-actions[bot]', '2026-11-26T02:00:00Z'),
      st('success', 'github-actions[bot]', '2026-11-26T01:00:00Z'),
    ];
    expect(decide(JSON.stringify(statuses))).toBe('no');
  });

  it('order-independent: the same statuses listed oldest-first give the same answer', () => {
    const statuses = [
      st('success', 'github-actions[bot]', '2026-11-26T01:00:00Z'),
      st('failure', 'github-actions[bot]', '2026-11-26T02:00:00Z'),
    ];
    expect(decide(JSON.stringify(statuses))).toBe('no');
    expect(decide(JSON.stringify(statuses.reverse()))).toBe('no');
  });

  it('other contexts (ai-review/pass) are not read as the gate', () => {
    expect(decide(JSON.stringify([st('success', 'github-actions[bot]', '2026-11-26T01:00:00Z', 'ai-review/pass')]))).toBe('no');
  });

  it('no statuses at all is no', () => {
    expect(decide('[]')).toBe('no');
  });

  it('paginated output (arrays back to back) is read as one list', () => {
    const page1 = JSON.stringify([st('success', 'minspec-sdd[bot]', '2026-11-26T03:00:00Z')]);
    const page2 = JSON.stringify([st('success', 'github-actions[bot]', '2026-11-26T01:00:00Z')]);
    expect(decide(`${page1}\n${page2}`)).toBe('no');
    expect(decide(`${page2}\n[]`)).toBe('yes');
  });

  it('unparseable input is error, never yes or no', () => {
    expect(decide('not json')).toBe('error');
  });

  it('ready_to_merge_witnessed refuses a malformed sha without calling gh', () => {
    const out = execFileSync('/usr/bin/bash', ['-c', `source "${LIB}"; ready_to_merge_witnessed o/r not-a-sha`], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: '/nonexistent' },
    }).trim();
    expect(out).toBe('error');
  });
});
