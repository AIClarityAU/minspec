/**
 * T0 — triage-inbox.sh WRITES the verdict record that dispatch-ready-check.sh
 * REQUIRES (#983), and the two agree on the wire.
 *
 * The seam tests in dispatch-ready-check.test.ts prove the record grammar
 * round-trips. They cannot prove the real WRITER still travels that path — a
 * triage-inbox.sh that stopped calling `--render-record`, or that hashed a
 * differently-composed body than the dispatcher does, would leave those tests green
 * while every issue held at dispatch. So this drives the actual script with stubbed
 * `gh`/`claude` (it holds no credentials and makes no network call) and asserts:
 *
 *   1. a verdict record is written into the triage comment;
 *   2. the RECORD is posted BEFORE the labels — so `agent-ready` never exists, even
 *      momentarily, without the verdict that authorises it;
 *   3. the record the writer produced is ACCEPTED by the reader, against the issue
 *      body composed exactly as the DISPATCHER composes it (the actual drift risk:
 *      the two scripts must hash identical bytes);
 *   4. an agent-ready verdict clears `needs-human-review` — without which a held
 *      issue would re-triage to a perfectly good verdict and then be countermanded
 *      by the leftover hold label, stranding real work;
 *   5. a human-only verdict writes a record that REFUSES at dispatch even if
 *      someone then hand-applies `agent-ready`;
 *   6. (#1169 / DR-076) an auto-buildable T3/T4 travels this path as the SPECIFY
 *      class — `agent-ready-specify` + `hold: specify` — and the reader resolves it
 *      to `ready-specify`, never to a full build.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { provenanceAnswer } from './helpers/agent-launch-harness';

const ROOT = path.resolve(__dirname, '../../..');
const TRIAGE = path.join(ROOT, 'scripts/triage-inbox.sh');
const GATE = path.join(ROOT, 'scripts/dispatch-ready-check.sh');
const DISPATCH = path.join(ROOT, 'scripts/dispatch-issue.sh');

const TITLE = 'Typo in the drain log line';
const BODY = 'The drain prints "dispatchig" instead of "dispatching". One-word fix.';

/**
 * The jq program each script uses to compose the issue text it triages / hashes.
 * Extracted from the SOURCE of both scripts so this test cannot silently drift from
 * what they actually run (the lock-step pattern used elsewhere in this suite).
 */
function bodyComposer(scriptPath: string): string {
  const src = fs.readFileSync(scriptPath, 'utf-8');
  const m = src.match(/ISSUE_BODY=\$\(echo "\$ISSUE_JSON" \| jq -r '([^']*)'\)/);
  if (!m) throw new Error(`Could not find the ISSUE_BODY jq composer in ${scriptPath}`);
  return m[1];
}

/** Emulate `X=$(echo "$json" | jq -r '<prog>')` — including bash's trailing-newline strip. */
function composeBody(prog: string, issueJson: string): string {
  return execFileSync('jq', ['-r', prog], { input: issueJson, encoding: 'utf-8' }).replace(/\n+$/, '');
}

interface TriageRun {
  /** Ordered log of the credentialed operations the script attempted. */
  calls: string[];
  /** The body of the triage comment it posted. */
  comment: string;
  stdout: string;
}

/** Drive scripts/triage-inbox.sh for one issue with stubbed `gh` and `claude`. */
function runTriage(
  verdictBlock: string,
  opts: { failBatchRemove?: boolean; labels?: string[]; rawLabels?: unknown } = {},
): TriageRun {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-triage-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);

  const issueJson = JSON.stringify({
    title: TITLE,
    body: BODY,
    labels: 'rawLabels' in opts ? opts.rawLabels : (opts.labels ?? ['inbox']).map((name) => ({ name })),
  });
  fs.writeFileSync(path.join(dir, 'issue.json'), issueJson);
  fs.writeFileSync(path.join(dir, 'agent-out.txt'), verdictBlock);
  // Triage asks GitHub who wrote this issue's text before it triages it, in a read of
  // its own, and triages only when every one of them is on the list in
  // scripts/lib/dispatch-author-gate.sh (dispatch-author-gate.test.ts covers the gate).
  // Here: opened by the founder, never edited, with the same title and body as above.
  fs.writeFileSync(path.join(dir, 'provenance.json'), provenanceAnswer({ title: TITLE, body: BODY }));
  // Who last applied each label (DR-118): the founder. triage-label-applier.test.ts covers the refusals.
  fs.writeFileSync(
    path.join(dir, 'label-events.json'),
    JSON.stringify({
      data: {
        repository: {
          issue: {
            timelineItems: {
              totalCount: 1,
              nodes: [{ label: { name: 'pipeline-blocker' }, actor: { __typename: 'User', login: 'harvest316', databaseId: 4125483 } }],
            },
          },
        },
      },
    }),
  );

  // Stub `gh`: serves the issue view, records every mutation in order, and captures
  // the comment body. Deliberately NOT a network call — the writer under test does
  // the credentialed work, so the test replaces exactly that boundary. The read of who
  // wrote the issue is answered and not logged: the log below is the order of the
  // operations triage performs on the issue, and that read is not one of them.
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env bash
set -u
sub="\${2:-}"
case "$sub" in
  view) echo "view" >> "$STUB_LOG"; cat "$STUB_DIR/issue.json" ;;
  graphql)
    case "$*" in
      *LabeledEvent*) cat "$STUB_DIR/label-events.json" ;;
      *) cat "$STUB_DIR/provenance.json" ;;
    esac ;;
  comment)
    echo "comment" >> "$STUB_LOG"
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
    echo "edit add=[$add] remove=[$rem]" >> "$STUB_LOG"
    # Emulate gh refusing a whole batch when one label name is unknown to the repo.
    if [[ "\${STUB_FAIL_BATCH_REMOVE:-0}" == "1" && "$rem" == *,* ]]; then exit 1; fi ;;
  *) echo "other" >> "$STUB_LOG" ;;
esac
exit 0
`,
  );
  // Stub `claude`: the triage agent is credential- and tool-free by design, so its
  // only contribution is the verdict text. The path is written into the stub, not read
  // from $STUB_DIR: the agent is started with an environment built from an allowlist
  // (scripts/lib/agent-context.sh), so a helper variable set here does not reach it.
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/usr/bin/env bash\ncat "${path.join(dir, 'agent-out.txt')}"\nexit 0\n`,
  );
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    STUB_DIR: dir,
    STUB_LOG: path.join(dir, 'calls.log'),
    STUB_FAIL_BATCH_REMOVE: opts.failBatchRemove ? '1' : '0',
  };
  const stdout = execFileSync('bash', [TRIAGE, '4242'], { encoding: 'utf-8', env });

  return {
    calls: fs.readFileSync(path.join(dir, 'calls.log'), 'utf-8').trim().split('\n'),
    comment: fs.readFileSync(path.join(dir, 'comment.txt'), 'utf-8'),
    stdout,
  };
}

function verdict(fields: Record<string, string> = {}): string {
  const f = { decision: 'agent-ready', role: 'dev', tier: 'T1', human_only: 'no', rationale: 'one word', ...fields };
  return [
    'TRIAGE_VERDICT_BEGIN',
    `decision: ${f.decision}`,
    `role: ${f.role}`,
    `tier: ${f.tier}`,
    `human_only: ${f.human_only}`,
    `rationale: ${f.rationale}`,
    'TRIAGE_VERDICT_END',
  ].join('\n');
}

/** Ask the gate about an issue whose comments/body are these. */
function gate(labelsCsv: string, comments: string, body: string): { ok: boolean; out: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-gate-'));
  const c = path.join(dir, 'comments');
  const b = path.join(dir, 'body');
  fs.writeFileSync(c, comments);
  fs.writeFileSync(b, body);
  try {
    return { ok: true, out: execFileSync('bash', [GATE, 'OPEN', labelsCsv, c, b], { encoding: 'utf-8' }).trim() };
  } catch (e: any) {
    return { ok: false, out: (e.stdout ?? '').toString().trim() };
  }
}

describe('triage-inbox.sh writes the verdict record dispatch requires (#983)', () => {
  let dispatchBody: string;

  beforeAll(() => {
    // The bytes the DISPATCHER will hash — composed by its own jq program, not a
    // convenient re-spelling of it.
    dispatchBody = composeBody(
      bodyComposer(DISPATCH),
      JSON.stringify({ title: TITLE, body: BODY, labels: [] }),
    );
  });

  it('the writer and the dispatcher compose the hashed text identically (lock-step)', () => {
    // If these two ever diverge, EVERY issue would go stale the instant it was
    // triaged — a gate that refuses valid work, which is worse than the hole.
    expect(bodyComposer(TRIAGE)).toBe(bodyComposer(DISPATCH));
  });

  it('posts a verdict record, and posts it BEFORE the labels', () => {
    const run = runTriage(verdict());
    expect(run.comment).toContain('MINSPEC_VERDICT_BEGIN');
    expect(run.comment).toContain('gate: minspec-triage-verdict/1');
    expect(run.comment).toMatch(/bodyHash: sha256:[0-9a-f]{64}/);

    // Ordering is the invariant: view → comment (record) → edit (labels).
    expect(run.calls[0]).toBe('view');
    expect(run.calls[1]).toBe('comment');
    expect(run.calls.indexOf('comment')).toBeLessThan(run.calls.findIndex((c) => c.startsWith('edit')));
  });

  it('the record it wrote is ACCEPTED by the gate against the dispatcher-composed body', () => {
    const run = runTriage(verdict({ tier: 'T2' }));
    const r = gate('agent-ready,role:dev', run.comment, dispatchBody);
    expect(r.ok, r.out).toBe(true);
    expect(r.out).toBe('ready');
  });

  it('an agent-ready verdict clears needs-human-review (so a re-triage un-holds the issue)', () => {
    const run = runTriage(verdict());
    const add = run.calls.find((c) => c.includes('add=[role:dev,agent-ready]'));
    expect(add, run.calls.join('\n')).toBeTruthy();
    const removed = run.calls.find((c) => /remove=\[[^\]]+\]/.test(c));
    expect(removed).toContain('needs-human-review');
    expect(removed).toContain('needs-review');
    expect(removed).toContain('needs-info');
    expect(removed).toContain('inbox');
  });

  it('editing the issue after triage invalidates the record it wrote', () => {
    const run = runTriage(verdict());
    const r = gate('agent-ready', run.comment, dispatchBody + '\n\nEDIT: also rename the function.');
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[stale-verdict]');
  });

  it('a human-only verdict refuses at dispatch even if agent-ready is hand-applied afterwards', () => {
    // The production failure, reproduced end-to-end: the triage gate said human-only,
    // someone clicked agent-ready anyway, and the old dispatcher built it.
    const run = runTriage(verdict({ human_only: 'yes', decision: 'agent-ready' }));
    // #1002 appends the hold REASON to the same --add-label call: `needs-review` alone
    // no longer says WHY, which is the whole defect that issue closes.
    expect(run.calls.some((c) => c.includes('add=[role:dev,needs-review,hold:human]'))).toBe(true);
    const r = gate('agent-ready,role:dev', run.comment, dispatchBody);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[human-only]');
  });

  it('a T3 the agent did NOT call auto-buildable refuses at dispatch, hand-applied label or not', () => {
    const run = runTriage(verdict({ tier: 'T3', decision: 'needs-review' }));
    const r = gate('agent-ready,role:dev', run.comment, dispatchBody);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[held]');
  });

  // ── #1169 / DR-076: the specify class travels the REAL writer path ──────────
  it('an auto-buildable T3 is labelled and recorded as SPECIFY-ONLY, never as a full build', () => {
    const run = runTriage(verdict({ tier: 'T3', decision: 'agent-ready', role: 'architect' }));
    // The label the writer actually applied…
    expect(run.calls.some((c) => c.includes('add=[role:architect,agent-ready-specify,hold:specify]')), run.calls.join('\n')).toBe(
      true,
    );
    // …and the record it minted, read back by the gate that dispatch consults.
    const r = gate('agent-ready-specify,role:architect', run.comment, dispatchBody);
    expect(r.ok).toBe(true);
    expect(r.out).toBe('ready-specify');
    expect(run.comment).toContain('hold: specify');
    expect(run.comment).toContain('decision: agent-ready-specify');
  });

  it('the specify verdict clears plain agent-ready (the two ready classes never co-exist)', () => {
    const run = runTriage(verdict({ tier: 'T3', decision: 'agent-ready' }));
    const removed = run.calls.find((c) => /remove=\[[^\]]+\]/.test(c));
    expect(removed).toContain('agent-ready');
    expect(removed).toContain('needs-human-review');
    expect(removed).toContain('inbox');
  });

  it('a T1 verdict still clears any stale agent-ready-specify', () => {
    const run = runTriage(verdict());
    const removed = run.calls.find((c) => /remove=\[[^\]]+\]/.test(c));
    expect(removed).toContain('agent-ready-specify');
  });

  it('a rejected BATCH label removal falls back to one-at-a-time, so inbox still clears', () => {
    // `gh` resolves label names against the repo and fails the WHOLE request if one
    // is unknown there — which would leave every superseded label in place, `inbox`
    // included, and re-triage this issue on every drain cycle forever.
    const run = runTriage(verdict(), { failBatchRemove: true });
    const singles = run.calls.filter((c) => /remove=\[[^,\]]+\]$/.test(c));
    expect(singles.some((c) => c.includes('remove=[inbox]'))).toBe(true);
    expect(singles.some((c) => c.includes('remove=[needs-human-review]'))).toBe(true);
  });

  it('a needs-info verdict clears agent-ready rather than leaving a contradiction', () => {
    const run = runTriage(verdict({ decision: 'needs-info' }));
    expect(run.calls.some((c) => c.includes('add=[role:dev,needs-info,hold:info]'))).toBe(true);
    expect(run.calls.find((c) => /remove=\[[^\]]+\]/.test(c))).toContain('agent-ready');
  });
});

// ── pipeline-blocker skips spec-first (DR-118, proposed; founder decision 2026-10-30,
// queue item pb1030; triggered by #3282) ──
// The spec-writing queue can be paused, and an issue that unblocks the pipeline itself
// must not wait behind it. Exactly ONE label opts out of the specify class, and only the
// specify class: every human gate (human_only, a declined T3/T4, needs-info) still holds.
// The DECISION lives in triage-decide.sh (pinned in triage-decide.test.ts); these tests
// pin that triage-inbox.sh feeds the issue's labels in and records the gate's output.
describe('triage-inbox.sh routes a pipeline-blocker straight to build (pb1030)', () => {
  let dispatchBody: string;
  beforeAll(() => {
    dispatchBody = composeBody(bodyComposer(DISPATCH), JSON.stringify({ title: TITLE, body: BODY, labels: [] }));
  });

  it('an auto-buildable T3 labelled pipeline-blocker is recorded as a FULL build', () => {
    const run = runTriage(verdict({ tier: 'T3', decision: 'agent-ready' }), {
      labels: ['role:dev', 'agent-ready-specify', 'hold:specify', 'pipeline-blocker'],
    });
    expect(run.calls.some((c) => c.includes('add=[role:dev,agent-ready]')), run.calls.join('\n')).toBe(true);
    expect(run.comment).toContain('hold: none');
    expect(run.comment).toContain('decision: agent-ready');
    expect(run.comment).toContain('pipeline-blocker');
    const removed = run.calls.find((c) => /remove=\[[^\]]+\]/.test(c)) ?? '';
    expect(removed).toContain('agent-ready-specify');
    expect(removed).toContain('hold:specify');
    const r = gate('agent-ready,role:dev,pipeline-blocker', run.comment, dispatchBody);
    expect(r.ok, r.out).toBe(true);
    expect(r.out).toBe('ready');
  });

  it('only the exact label counts: a look-alike label keeps the specify route', () => {
    for (const label of ['pipeline-blocker-candidate', 'blocker', 'Pipeline-Blocker', 'pipeline blocker']) {
      const run = runTriage(verdict({ tier: 'T3', decision: 'agent-ready' }), { labels: ['inbox', label] });
      expect(
        run.calls.some((c) => c.includes('add=[role:dev,agent-ready-specify,hold:specify]')),
        `${label}: ${run.calls.join('\n')}`,
      ).toBe(true);
      expect(run.comment).toContain('hold: specify');
    }
  }, 30_000); // several real triage-inbox.sh runs in one test (#1099: 30s under load)

  it('pipeline-blocker never lifts a human-only hold', () => {
    const run = runTriage(verdict({ tier: 'T3', decision: 'agent-ready', human_only: 'yes' }), {
      labels: ['inbox', 'pipeline-blocker'],
    });
    expect(run.calls.some((c) => c.includes('add=[role:dev,needs-review,hold:human]'))).toBe(true);
  });

  it('pipeline-blocker never lifts a T3 the agent declined, nor a needs-info', () => {
    const declined = runTriage(verdict({ tier: 'T4', decision: 'needs-review' }), { labels: ['inbox', 'pipeline-blocker'] });
    expect(declined.calls.some((c) => c.includes('add=[role:dev,needs-review,hold:tier]'))).toBe(true);
    const info = runTriage(verdict({ tier: 'T3', decision: 'needs-info' }), { labels: ['inbox', 'pipeline-blocker'] });
    expect(info.calls.some((c) => c.includes('add=[role:dev,needs-info,hold:info]'))).toBe(true);
  });

  it('a label list that does not name pipeline-blocker in .name fails closed to the specify route', () => {
    // (A label list jq cannot read at all passes no --label: the gate test pins that
    // "no label input" keeps the specify route.)
    for (const rawLabels of [[], [{ nom: 'pipeline-blocker' }], [{ name: null }]]) {
      const run = runTriage(verdict({ tier: 'T3', decision: 'agent-ready' }), { rawLabels });
      expect(
        run.calls.some((c) => c.includes('add=[role:dev,agent-ready-specify,hold:specify]')),
        `${JSON.stringify(rawLabels)}: ${run.calls.join('\n')}`,
      ).toBe(true);
      expect(run.comment).toContain('hold: specify');
    }
  }, 30_000); // several real triage-inbox.sh runs in one test (#1099: 30s under load)

  it('a T1/T2 pipeline-blocker is unchanged (already a full build)', () => {
    const run = runTriage(verdict({ tier: 'T2' }), { labels: ['inbox', 'pipeline-blocker'] });
    expect(run.calls.some((c) => c.includes('add=[role:dev,agent-ready]'))).toBe(true);
    expect(run.comment).toContain('hold: none');
  });
});
