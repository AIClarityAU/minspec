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
function runTriage(verdictBlock: string, opts: { failBatchRemove?: boolean } = {}): TriageRun {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-triage-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);

  const issueJson = JSON.stringify({ title: TITLE, body: BODY, labels: [{ name: 'inbox' }] });
  fs.writeFileSync(path.join(dir, 'issue.json'), issueJson);
  fs.writeFileSync(path.join(dir, 'agent-out.txt'), verdictBlock);

  // Stub `gh`: serves the issue view, records every mutation in order, and captures
  // the comment body. Deliberately NOT a network call — the writer under test does
  // the credentialed work, so the test replaces exactly that boundary.
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env bash
set -u
sub="\${2:-}"
case "$sub" in
  view) echo "view" >> "$STUB_LOG"; cat "$STUB_DIR/issue.json" ;;
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
  // only contribution is the verdict text.
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/usr/bin/env bash\ncat "$STUB_DIR/agent-out.txt"\nexit 0\n`,
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
    expect(run.calls.some((c) => c.includes('add=[role:dev,needs-review]'))).toBe(true);
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
    expect(run.calls.some((c) => c.includes('add=[role:architect,agent-ready-specify]')), run.calls.join('\n')).toBe(
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
    expect(run.calls.some((c) => c.includes('add=[role:dev,needs-info]'))).toBe(true);
    expect(run.calls.find((c) => /remove=\[[^\]]+\]/.test(c))).toContain('agent-ready');
  });
});
