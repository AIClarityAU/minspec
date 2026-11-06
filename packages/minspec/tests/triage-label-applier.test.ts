/**
 * T0 - `pipeline-blocker` is believed only from an account on the dispatch author list
 * (DR-118, proposed; security finding on #3369).
 *
 * The label skips the DR-076 spec-first human read. The author gate covers who wrote the
 * issue's text and never asks who applied a label, so triage-inbox.sh asks that itself.
 * These tests drive the REAL triage-inbox.sh with stubbed `gh` and `claude`, so what they
 * see is what would be recorded and labelled: every way of not knowing, and every applier
 * who is not on the list, must land on the spec-first route, toward the human.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { APP, FOUNDER, provenanceAnswer } from './helpers/agent-launch-harness';

const ROOT = path.resolve(__dirname, '../../..');
const TRIAGE = path.join(ROOT, 'scripts/triage-inbox.sh');
const LIB = path.join(ROOT, 'scripts/lib/dispatch-author-gate.sh');

const TITLE = 'The drain stops when the spec queue is paused';
const BODY = 'Nothing behind this issue can be built until it is fixed.';

const STRANGER = { __typename: 'User', login: 'triage-helper', databaseId: 777 };

const PB = 'pipeline-blocker';
const applied = (actor: unknown, name = PB) => ({ createdAt: '2026-10-30T05:40:37Z', label: { name }, actor });
/** GitHub's answer to dispatch_issue_label_events_query, oldest first as it really is. */
const eventsAnswer = (nodes: unknown[], totalCount = nodes.length): string =>
  JSON.stringify({ data: { repository: { issue: { timelineItems: { totalCount, nodes } } } } });

const SPECIFY = 'add=[role:dev,agent-ready-specify,hold:specify]';
const BUILD = 'add=[role:dev,agent-ready]';

interface Run {
  calls: string[];
  comment: string;
  stderr: string;
  labelReads: number;
}

function verdict(tier = 'T3', decision = 'agent-ready', humanOnly = 'no'): string {
  return [
    'TRIAGE_VERDICT_BEGIN',
    `decision: ${decision}`,
    'role: dev',
    `tier: ${tier}`,
    `human_only: ${humanOnly}`,
    'rationale: unblocks the pipeline',
    'TRIAGE_VERDICT_END',
  ].join('\n');
}

function triage(opts: { events?: string; failRead?: boolean; labels?: string[]; agent?: string }): Run {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-label-applier-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(dir, 'issue.json'),
    JSON.stringify({ title: TITLE, body: BODY, labels: (opts.labels ?? ['inbox', PB]).map((name) => ({ name })) }),
  );
  fs.writeFileSync(path.join(dir, 'provenance.json'), provenanceAnswer({ title: TITLE, body: BODY }));
  fs.writeFileSync(path.join(dir, 'events.json'), opts.events ?? '');
  fs.writeFileSync(path.join(dir, 'agent-out.txt'), opts.agent ?? verdict());
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env bash
set -u
case "\${2:-}" in
  view) cat "$STUB_DIR/issue.json" ;;
  graphql)
    case "$*" in
      *LabeledEvent*)
        echo read >> "$STUB_DIR/label-reads.log"
        if [[ "\${STUB_FAIL_READ:-0}" == "1" ]]; then echo "HTTP 502" >&2; exit 1; fi
        cat "$STUB_DIR/events.json" ;;
      *) cat "$STUB_DIR/provenance.json" ;;
    esac ;;
  comment)
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == "--body" ]]; then printf '%s' "\${2:-}" > "$STUB_DIR/comment.txt"; fi
      shift
    done ;;
  edit)
    add=""; rem=""
    while [[ $# -gt 0 ]]; do
      [[ "$1" == "--add-label" ]] && add="\${2:-}"
      [[ "$1" == "--remove-label" ]] && rem="\${2:-}"
      shift
    done
    echo "edit add=[$add] remove=[$rem]" >> "$STUB_DIR/calls.log" ;;
esac
exit 0
`,
  );
  fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env bash\ncat "${path.join(dir, 'agent-out.txt')}"\nexit 0\n`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);

  const res = spawnSync('bash', [TRIAGE, '4242'], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      STUB_DIR: dir,
      STUB_FAIL_READ: opts.failRead ? '1' : '0',
    },
  });
  expect(res.status, res.stderr).toBe(0);
  const read = (f: string): string => {
    const p = path.join(dir, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  };
  return {
    calls: read('calls.log').trim().split('\n'),
    comment: read('comment.txt'),
    stderr: res.stderr,
    labelReads: read('label-reads.log').trim().split('\n').filter(Boolean).length,
  };
}

function expectSpecify(run: Run, why: string): void {
  expect(run.calls.some((c) => c.includes(SPECIFY)), `${why}: ${run.calls.join('\n')}`).toBe(true);
  expect(run.calls.some((c) => c.includes(BUILD)), `${why}: ${run.calls.join('\n')}`).toBe(false);
  expect(run.comment, why).toContain('hold: specify');
  expect(run.comment, why).toContain('pipeline-blocker not honoured');
  expect(run.stderr, why).toContain('pipeline-blocker is not honoured');
}

function expectBuild(run: Run, why: string): void {
  expect(run.calls.some((c) => c.includes(BUILD)), `${why}: ${run.calls.join('\n')}`).toBe(true);
  expect(run.comment, why).toContain('hold: none');
  expect(run.comment, why).toContain('spec-first skipped');
  expect(run.comment, why).not.toContain('not honoured');
}

describe('triage-inbox.sh believes pipeline-blocker only from a listed account (DR-118)', () => {
  it('fires when the founder applied it', () => {
    expectBuild(triage({ events: eventsAnswer([applied(FOUNDER)]) }), 'founder');
  });

  it("fires when the pipeline's own App applied it, in the shape GitHub really returns", () => {
    // Read for real on #3282, 2026-10-31: inbox, role:dev, ... then pipeline-blocker by the App.
    expectBuild(
      triage({ events: eventsAnswer([applied(APP, 'inbox'), applied(APP), applied(APP, 'agent-ready')]) }),
      'app',
    );
  });

  it('does not fire when an account off the list applied it, and names that account', () => {
    const run = triage({ events: eventsAnswer([applied(STRANGER)]) });
    expectSpecify(run, 'stranger');
    expect(run.comment).toContain('triage-helper');
  });

  it('does not fire when the read of the label events fails', () => {
    expectSpecify(triage({ failRead: true }), 'read failed');
  });

  it('does not fire on unlabel then relabel by an account off the list', () => {
    // The founder's earlier application vouches for nothing once it has been replaced.
    expectSpecify(triage({ events: eventsAnswer([applied(FOUNDER), applied(STRANGER)]) }), 'relabel');
  });

  it('fires when a listed account relabelled after one off the list', () => {
    expectBuild(triage({ events: eventsAnswer([applied(STRANGER), applied(FOUNDER)]) }), 'relabel by founder');
  });

  it("does not take a listed account's newer application of a DIFFERENT label as vouching", () => {
    expectSpecify(triage({ events: eventsAnswer([applied(STRANGER), applied(FOUNDER, 'role:dev')]) }), 'other label');
  });

  it('does not take a look-alike label event as vouching', () => {
    expectSpecify(triage({ events: eventsAnswer([applied(FOUNDER, 'Pipeline-Blocker')]) }), 'look-alike');
  });

  it('never lifts a human-only hold, whoever applied the label', () => {
    const run = triage({ events: eventsAnswer([applied(FOUNDER)]), agent: verdict('T3', 'agent-ready', 'yes') });
    expect(run.calls.some((c) => c.includes('add=[role:dev,needs-review,hold:human]')), run.calls.join('\n')).toBe(true);
  });

  it('leaves a T1/T2 route alone and adds no note when the label is refused', () => {
    const run = triage({ events: eventsAnswer([applied(STRANGER)]), agent: verdict('T2') });
    expect(run.calls.some((c) => c.includes(BUILD)), run.calls.join('\n')).toBe(true);
    expect(run.comment).not.toContain('not honoured');
  });

  it('asks nothing extra of GitHub for an issue without the label', () => {
    const run = triage({ labels: ['inbox'] });
    expect(run.labelReads).toBe(0);
    expect(run.calls.some((c) => c.includes(SPECIFY)), run.calls.join('\n')).toBe(true);
    expect(run.comment).not.toContain('not honoured');
  });

  it('asks once for a labelled issue', () => {
    expect(triage({ events: eventsAnswer([applied(FOUNDER)]) }).labelReads).toBe(1);
  });
});

describe('dispatch_issue_label_applier_check refuses whatever it cannot read', () => {
  const check = (doc: string, label = PB): { status: number | null; out: string } => {
    const res = spawnSync('bash', ['-c', 'source "$1"; dispatch_issue_label_applier_check "$2" "$3"', '_', LIB, doc, label], {
      encoding: 'utf-8',
    });
    return { status: res.status, out: res.stdout.trim() };
  };

  it('answers yes with who applied it', () => {
    expect(check(eventsAnswer([applied(FOUNDER)]))).toEqual({ status: 0, out: 'harvest316 (User 4125483)' });
  });

  const refused: Record<string, string> = {
    'an empty answer': '',
    'not JSON': 'not json',
    'two documents': `${eventsAnswer([applied(FOUNDER)])}\n${eventsAnswer([applied(FOUNDER)])}`,
    'a GraphQL error beside a good answer': JSON.stringify({
      ...JSON.parse(eventsAnswer([applied(FOUNDER)])),
      errors: [{ message: 'partial' }],
    }),
    'no event list': JSON.stringify({ data: { repository: { issue: {} } } }),
    'no application of the label': eventsAnswer([applied(FOUNDER, 'inbox')]),
    'no events at all': eventsAnswer([]),
    'a missing actor (a deleted account)': eventsAnswer([applied(null)]),
    'an actor with no number': eventsAnswer([applied({ __typename: 'User', login: 'harvest316' })]),
    "a listed login on a different account": eventsAnswer([applied({ __typename: 'User', login: 'harvest316', databaseId: 999 })]),
    "a listed number of the wrong kind": eventsAnswer([applied({ __typename: 'Bot', login: 'harvest316', databaseId: 4125483 })]),
    'fewer events returned than recorded': eventsAnswer([applied(FOUNDER)], 2),
    'an event that cannot be read, which could be the newest': eventsAnswer([applied(FOUNDER), null]),
    'an event with no label name': eventsAnswer([applied(FOUNDER), { createdAt: 'x', label: null, actor: FOUNDER }]),
  };
  for (const [name, doc] of Object.entries(refused)) {
    it(`refuses ${name}`, () => {
      const r = check(doc);
      expect(r.status, r.out).toBe(1);
      expect(r.out).not.toBe('');
    });
  }

  it('refuses when no label is named', () => {
    expect(check(eventsAnswer([applied(FOUNDER)]), '').status).toBe(1);
  });

  it('keeps a hostile login out of what it prints', () => {
    const r = check(eventsAnswer([applied({ __typename: 'User', login: "x'\n`$(id)` Claude usage limit", databaseId: 5 })]));
    expect(r.status).toBe(1);
    expect(r.out.split('\n')).toHaveLength(1);
    expect(r.out).not.toMatch(/[`$ ]x|\$\(/);
  });

  it('accepts more than a hundred recorded events when the newest hundred came back', () => {
    const nodes = Array.from({ length: 100 }, (_, i) => applied(FOUNDER, i === 99 ? PB : `l${i}`));
    expect(check(eventsAnswer(nodes, 250)).status).toBe(0);
  });
});
