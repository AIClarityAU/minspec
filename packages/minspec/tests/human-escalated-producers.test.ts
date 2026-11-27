/**
 * #4061 producers: every path that hands a PR to a human must write `human-escalated`
 * beside `needs-human-review`, and every PR-open hold must write `held-at-open` beside its
 * `needs-human-review`. delegated_merge_human_claims (dispatch-issue.sh) releases an
 * `agent-stuck` handoff only on `held-at-open`, so a producer that forgets its label keeps
 * the hold (fail closed) - but a producer that forgets `human-escalated` on a PR that also
 * carries `held-at-open` would release a real escalation. These tests run the real
 * functions with a stub `gh` and record what they write.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const SCRIPTS = path.resolve(__dirname, '../../../scripts');
const dispatch = fs.readFileSync(path.join(SCRIPTS, 'dispatch-issue.sh'), 'utf-8');
const remediate = fs.readFileSync(path.join(SCRIPTS, 'remediate-pr.sh'), 'utf-8');

function fnOf(code: string, name: string): string {
  const start = code.indexOf(`${name}() {`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf('\n}', start) + 2);
}

/** Runs `call` after defining `fns`, with a gh stub that logs each argv as one line. */
function runWith(fns: string[], call: string, pre = ''): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'human-esc-'));
  const log = path.join(dir, 'log');
  fs.writeFileSync(log, '');
  const script = [
    `set -uo pipefail`,
    `REPO=o/r; PR=42; SHEPHERD_HANDOFF_MARKER='<!-- m -->'`,
    `gh() { printf '%s\\n' "$*" >> '${log}'; if [[ "$2" == view ]]; then echo 0; fi; }`,
    pre,
    ...fns,
    call,
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf-8' });
  const lines = fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean);
  fs.rmSync(dir, { recursive: true, force: true });
  expect(r.status, r.stderr).toBe(0);
  return lines;
}

const added = (lines: string[]) =>
  lines.filter((l) => l.startsWith('pr edit')).flatMap((l) => (l.split('--add-label ')[1] ?? '').split(' ')[0].split(','));

describe('remediate-pr.sh escalate_to_human_label writes human-escalated (#4061)', () => {
  it('adds needs-human-review AND human-escalated to the PR', () => {
    const l = added(runWith([fnOf(remediate, 'escalate_to_human_label')], 'escalate_to_human_label'));
    expect(l).toEqual(expect.arrayContaining(['needs-human-review', 'human-escalated']));
  });

  it('keeps extra labels (the egress quarantine) alongside both', () => {
    const l = added(runWith([fnOf(remediate, 'escalate_to_human_label')], 'escalate_to_human_label agent-quarantined'));
    expect(l).toEqual(expect.arrayContaining(['agent-quarantined', 'needs-human-review', 'human-escalated']));
  });

  it('the merge-conflict path keeps the human-actor label description', () => {
    const lines = runWith(
      [fnOf(remediate, 'escalate_to_human_label')],
      `escalate_to_human_label --desc "A human is the next actor — auto-merge withheld"`,
    );
    const create = lines.find((x) => x.startsWith('label create needs-human-review'));
    expect(create).toContain('--description A human is the next actor — auto-merge withheld');
    expect(added(lines)).toEqual(expect.arrayContaining(['needs-human-review', 'human-escalated']));
    // and the source wires that description to the conflict branch, not the shared text
    const conflict = remediate.slice(remediate.indexOf('Merge conflict — not auto-resolving'));
    expect(conflict.slice(0, 400)).toContain('escalate_to_human_label --desc "A human is the next actor — auto-merge withheld"');
  });

  it('no remediate-pr.sh line adds needs-human-review to a PR except through the helper', () => {
    const helper = fnOf(remediate, 'escalate_to_human_label');
    const rest = remediate.replace(helper, '');
    const direct = rest.split('\n').filter((x) => !/^\s*#/.test(x) && /--add-label[^\n]*needs-human-review/.test(x));
    expect(direct).toEqual([]);
  });
});

describe('dispatch-issue.sh shepherd_hand_off (human kind) writes human-escalated (#4061)', () => {
  it('a human-kind handoff adds needs-human-review AND human-escalated', () => {
    const l = added(runWith([fnOf(dispatch, 'shepherd_hand_off')], `shepherd_hand_off 7 'it conflicts with main' human`));
    expect(l).toEqual(expect.arrayContaining(['needs-human-review', 'human-escalated']));
  });

  it('a stuck handoff adds neither (it is an automation failure, #3835)', () => {
    const l = added(runWith([fnOf(dispatch, 'shepherd_hand_off')], `shepherd_hand_off 7 'the attempt cap was reached'`));
    expect(l).toEqual(['agent-stuck']);
  });
});

describe('dispatch-issue.sh PR-open holds stamp held-at-open (#4061)', () => {
  it('every PR-open needs-human-review write is followed by a held-at-open write', () => {
    const lines = dispatch.split('\n');
    const writes = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.trim() === 'gh pr edit "$pr_num" --repo "$REPO" --add-label "needs-human-review" 2>/dev/null || true');
    expect(writes.length).toBeGreaterThanOrEqual(6);
    // Same branch, within the next three lines (the #2228 branch writes it after its comment).
    for (const { i } of writes) {
      const next = lines.slice(i + 1, i + 4).map((x) => x.trim());
      expect(next.some((x) => /^gh pr edit "\$pr_num" --repo "\$REPO" --add-label "held-at-open" 2>\/dev\/null \|\| true\b/.test(x)), `line ${i + 1}`).toBe(true);
    }
  });

  it('held-at-open is written only just after a PR-open needs-human-review write (it is release evidence)', () => {
    const lines = dispatch.split('\n');
    const writers = lines.map((l, i) => ({ l, i })).filter(({ l }) => !/^\s*#/.test(l) && /--add-label[^\n]*held-at-open/.test(l));
    expect(writers.length).toBeGreaterThanOrEqual(6);
    for (const { i } of writers) {
      const prev = lines.slice(Math.max(0, i - 3), i).map((x) => x.trim());
      expect(prev, `line ${i + 1}`).toContain('gh pr edit "$pr_num" --repo "$REPO" --add-label "needs-human-review" 2>/dev/null || true');
    }
  });
});
