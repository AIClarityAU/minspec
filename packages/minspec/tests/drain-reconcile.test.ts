/**
 * T3 — the drain reconciles its label board against observable reality. (#1306, #1322)
 *
 * Every label transition in this system is written optimistically and never checked
 * again, which is how the board came to show EIGHT agents running when one was, with
 * two claims three weeks stale (#663, #627), and two issues (#1067, #1068) open and
 * queued with their work already merged.
 *
 * These tests drive the real bash out of `drain-inbox.sh` with a stubbed `gh` on
 * PATH, so they exercise the actual branching rather than asserting on source text.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn, ChildProcess } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope, never inside a hook: vitest resolves each test's timeout before
// `beforeAll` runs, so a raise from within a hook is silently inert (#1399).
useShellTimeout();

function findScriptsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const c = path.join(dir, 'scripts');
    if (fs.existsSync(c) && fs.existsSync(path.join(dir, '.git'))) return c;
    const p = path.dirname(dir);
    if (p === dir) break;
    dir = p;
  }
  throw new Error('scripts/ not found from ' + __dirname);
}

const DRAIN = path.join(findScriptsDir(), 'drain-inbox.sh');
const content = fs.readFileSync(DRAIN, 'utf-8');

/** Extract the reconciler block so it can be sourced without running the drain. */
function reconcilerBlock(): string {
  const start = content.indexOf('RECONCILE_CLAIM_STALE_SECS="${MINSPEC_RECONCILE_STALE_SECS');
  const end = content.indexOf('run_cycle() {');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      'Could not extract the reconciler block from drain-inbox.sh — markers moved. Fix ' +
        'this extractor rather than deleting the test: these reconcilers are the only ' +
        'thing that corrects a drifted label board (#1306, #1322).',
    );
  }
  return content.slice(start, end);
}

let tmp: string;
let kids: ChildProcess[] = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-reconcile-'));
});
afterEach(() => {
  for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* already gone */ } }
  kids = [];
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * A GitHub issue-timeline event, trimmed to the fields the reconcilers actually read.
 * Fixtures must be real events, not the REDUCED verdict: a fixture that hands back
 * "yes"/"no" pre-computed fakes the very jq reduction under test, which is how the
 * per-page pagination defect (found in PR #1772's review) survived a green suite.
 */
function ev(event: string, createdAt: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { event, created_at: createdAt, ...extra };
}
/** The `labeled` event `claim_applied_at` scans for. */
function claimEvent(createdAt: string): Record<string, unknown> {
  return ev('labeled', createdAt, { label: { name: 'agent-running' } });
}

/**
 * Timeline fixture shapes:
 *   `undefined`     — `gh` produces NO output: the witness is unreadable.
 *   `Event[][]`     — one inner array per PAGE, emulated the way `gh` really behaves.
 *   `{ raw: string}`— bytes emitted verbatim, for malformed-response cases.
 */
type TimelineFixture = Record<string, unknown>[][] | { raw: string } | undefined;

/**
 * Write a stub `gh` that logs its argv and answers from a canned table.
 *
 * The timeline branch emulates the REAL `gh api --paginate` faithfully, because the
 * defect this file guards lives in that behaviour: with `--jq`, gh applies the filter
 * to EACH PAGE separately and prints one result per page (measured against
 * api.github.com: a 19-event timeline at `per_page=2` printed 10 lines); without
 * `--jq`, it prints each page's array one after another for the caller to flatten.
 */
function stubGh(responses: Record<string, string>, timeline: TimelineFixture): string {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const table = path.join(tmp, 'responses.json');
  fs.writeFileSync(table, JSON.stringify(responses), 'utf-8');
  const pages = path.join(tmp, 'timeline-pages.json');
  const raw = path.join(tmp, 'timeline-raw.txt');
  if (Array.isArray(timeline)) fs.writeFileSync(pages, JSON.stringify(timeline), 'utf-8');
  else if (timeline) fs.writeFileSync(raw, timeline.raw, 'utf-8');
  const gh = path.join(bin, 'gh');
  fs.writeFileSync(
    gh,
    `#!/usr/bin/env bash\n` +
      `printf '%s\\n' "$*" >> ${JSON.stringify(path.join(tmp, 'gh-calls.log'))}\n` +
      `if [[ "$*" == *timeline* ]]; then\n` +
      `  raw=${JSON.stringify(raw)}\n` +
      `  pages=${JSON.stringify(pages)}\n` +
      `  if [[ -f "$raw" ]]; then cat "$raw"; exit 0; fi\n` +
      `  [[ -f "$pages" ]] || exit 0\n` +   // no fixture at all = unreadable witness
      `  filter=""; prev=""\n` +
      `  for a in "$@"; do [[ "$prev" == "--jq" ]] && filter="$a"; prev="$a"; done\n` +
      `  n=$(jq 'length' "$pages"); i=0\n` +
      `  while [[ $i -lt $n ]]; do\n` +
      `    if [[ -n "$filter" ]]; then jq -c ".[$i]" "$pages" | jq -r "$filter"\n` +
      `    else jq -c ".[$i]" "$pages"; fi\n` +
      `    i=$((i+1))\n` +
      `  done\n` +
      `  exit 0\n` +
      `fi\n` +
      `key=""\n` +
      `case "$*" in\n` +
      `  *"--label agent-running"*) key=running ;;\n` +
      `  *"--label agent-done"*)    key=done ;;\n` +
      `  "pr list"*)                key=pr ;;\n` +
      `esac\n` +
      `[[ -n "$key" ]] && node -e 'const t=require(process.argv[1]);process.stdout.write(t[process.argv[2]]??"")' ${JSON.stringify(table)} "$key"\n` +
      `exit 0\n`,
    { mode: 0o755 },
  );
  return bin;
}

function runReconciler(
  fn: string,
  responses: Record<string, string>,
  timeline: TimelineFixture = undefined,
  env: Record<string, string> = {},
): string {
  const bin = stubGh(responses, timeline);
  const script = ['set -uo pipefail', 'REPO=owner/repo', reconcilerBlock(), fn].join('\n');
  return execFileSync('bash', ['-c', script], {
    encoding: 'utf-8',
    env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` },
  });
}

function ghCalls(): string {
  const f = path.join(tmp, 'gh-calls.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : '';
}

describe('#1306 — orphaned agent-running claims are released', () => {
  it('does NOT reap a claim while a dispatch for that issue is alive', () => {
    // A real process whose argv looks like the dispatcher's.
    const fake = path.join(tmp, 'dispatch-issue.sh');
    fs.writeFileSync(fake, '#!/usr/bin/env bash\nsleep 30\n', { mode: 0o755 });
    const kid = spawn('bash', [fake, '885'], { stdio: 'ignore' });
    kids.push(kid);
    execFileSync('bash', ['-c', 'sleep 0.4']); // let it appear in the process table

    // No timeline fixture: the witness is unreadable — but liveness should
    // short-circuit before the claim time is ever consulted.
    const out = runReconciler('reconcile_stale_claims', { running: '885\n' });
    expect(out).not.toContain('releasing orphaned');
    expect(ghCalls()).not.toContain('--remove-label agent-running');
  });

  it('anchors on the issue number — a live 885 does not protect claim 88', () => {
    // The prefix hazard: an unanchored `pgrep -f "dispatch-issue.sh 88"` matches the
    // process for 885 and would leave issue 88's orphaned claim in place forever.
    const fake = path.join(tmp, 'dispatch-issue.sh');
    fs.writeFileSync(fake, '#!/usr/bin/env bash\nsleep 30\n', { mode: 0o755 });
    const kid = spawn('bash', [fake, '885'], { stdio: 'ignore' });
    kids.push(kid);
    execFileSync('bash', ['-c', 'sleep 0.4']);

    const out = runReconciler('reconcile_stale_claims', { running: '88\n' }, [
      [claimEvent('2020-01-01T00:00:00Z')], // ancient → stale
    ]);
    expect(out).toContain('releasing orphaned agent-running on #88');
  });

  it('leaves a RECENT claim alone even with no live process (age witness)', () => {
    const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const out = runReconciler('reconcile_stale_claims', { running: '4242\n' }, [
      [claimEvent(nowIso)],
    ]);
    expect(out).not.toContain('releasing orphaned');
  });

  it('fails toward no-op when the claim time is unreadable', () => {
    const out = runReconciler('reconcile_stale_claims', { running: '4242\n' });
    expect(out).toContain('leaving it alone');
    expect(ghCalls()).not.toContain('--remove-label agent-running');
  });
});

describe('#1322 — an open agent-done issue is reconciled against its PR', () => {
  it('closes the issue when its branch actually merged', () => {
    const out = runReconciler('reconcile_done_issues', { done: '1068\n', pr: '1230\n' }, [
      [ev('closed', '2026-01-01T00:00:00Z')],
    ]);
    expect(out).toContain('closing #1068');
    expect(out).toContain('#1230');
    expect(ghCalls()).toContain('issue close 1068');
  });

  it('strips the stamp and surfaces when NOTHING merged — the false agent-done case', () => {
    // The valuable half: the only check anywhere that catches a completion stamp
    // whose work never landed.
    const out = runReconciler('reconcile_done_issues', { done: '999\n', pr: '' });
    expect(out).toContain('NO merged PR exists');
    const calls = ghCalls();
    expect(calls).toContain('--remove-label agent-done');
    expect(calls).toContain('--add-label needs-human-review');
    expect(calls).not.toContain('issue close 999');
  });

  it('anti-vacuity — does nothing when no issue carries agent-done', () => {
    const out = runReconciler('reconcile_done_issues', { done: '', pr: '1230\n' });
    expect(out.trim()).toBe('');
    expect(ghCalls()).not.toContain('issue close');
  });
});

describe('#1628 — the close path is symmetric about label hygiene', () => {
  it('strips agent-done after closing a merged issue, same as the no-PR branch does', () => {
    const out = runReconciler('reconcile_done_issues', { done: '1068\n', pr: '1230\n' }, [
      [ev('closed', '2026-01-01T00:00:00Z')],
    ]);
    expect(out).toContain('closing #1068');
    const calls = ghCalls();
    expect(calls).toContain('issue close 1068');
    expect(calls).toContain('issue edit 1068 --repo owner/repo --remove-label agent-done');
  });
});

describe('#1628 — a reopen after an automated close vetoes re-closing', () => {
  it('does NOT re-close an issue whose most recent reopen is after its most recent close', () => {
    // Reproduces #897: closed by the reconciler, then reopened with evidence the
    // inferred completion was wrong. The branch is still (the same) merged PR — the
    // reconciler must not re-derive "closed" from that alone once history shows a
    // human rejected it.
    const out = runReconciler('reconcile_done_issues', { done: '897\n', pr: '900\n' }, [
      [ev('closed', '2026-01-01T00:00:00Z'), ev('reopened', '2026-02-01T00:00:00Z')],
    ]);
    expect(out).toContain('skipping #897');
    expect(out).toContain('reopened after a prior automated close');
    const calls = ghCalls();
    expect(calls).not.toContain('issue close 897');
    expect(calls).not.toContain('issue edit 897');
  });

  it('DOES close when the issue was never reopened (no veto signal)', () => {
    const out = runReconciler('reconcile_done_issues', { done: '1068\n', pr: '1230\n' }, [
      [ev('closed', '2026-01-01T00:00:00Z')],
    ]);
    expect(out).toContain('closing #1068');
    expect(ghCalls()).toContain('issue close 1068');
  });

  it('the close comment states an observation, not a completion claim', () => {
    const out = runReconciler('reconcile_done_issues', { done: '1068\n', pr: '1230\n' }, [
      [ev('closed', '2026-01-01T00:00:00Z')],
    ]);
    const calls = ghCalls();
    expect(calls).toContain('a branch named for this issue');
    expect(calls).toContain('not a verification that the');
    expect(calls).not.toContain('this issue was stamped');
  });
});

describe("PR #1772 review — the reopen veto is reduced ONCE over the whole timeline, not per page", () => {
  // `gh api --paginate --jq` applies the filter to EACH PAGE separately and prints one
  // result per page (measured against api.github.com: a 19-event timeline requested at
  // `per_page=2` printed 10 lines). This comparison — the last `reopened` against the
  // last `closed` across the WHOLE history — cannot be reduced per page: the pair that
  // decides it can straddle a page boundary, and neither page sees both halves. The
  // sibling `claim_applied_at` guards its own per-page reduction with `| tail -1`; no
  // such guard can work here, because the answer is not any one page's answer.
  //
  // The issue-timeline endpoint pages at 30 events; `labeled`, `commented`,
  // `cross-referenced` and `committed` all count, so the issues most likely to carry a
  // human's reopen — the long, argued ones — are exactly the ones that span pages.

  it('sees a reopen recorded on a LATER page than the close it vetoes', () => {
    const out = runReconciler('reconcile_done_issues', { done: '897\n', pr: '900\n' }, [
      [ev('labeled', '2025-12-01T00:00:00Z'), ev('closed', '2026-01-01T00:00:00Z')],
      [ev('reopened', '2026-02-01T00:00:00Z'), ev('commented', '2026-02-01T00:05:00Z')],
    ]);
    expect(out).toContain('skipping #897');
    expect(out).toContain('reopened after a prior automated close');
    const calls = ghCalls();
    expect(calls).not.toContain('issue close 897');
    expect(calls).not.toContain('issue edit 897');
  });

  it('does NOT become a blanket veto — a close on a later page than the reopen still closes', () => {
    // Direction check. Reducing once must preserve the ORDER comparison, not just
    // detect that a `reopened` exists somewhere in the history.
    const out = runReconciler('reconcile_done_issues', { done: '1068\n', pr: '1230\n' }, [
      [ev('reopened', '2026-01-01T00:00:00Z')],
      [ev('closed', '2026-02-01T00:00:00Z')],
    ]);
    expect(out).toContain('closing #1068');
    expect(ghCalls()).toContain('issue close 1068');
  });
});

describe("PR #1772 review — an unreadable verdict fails CLOSED, and is not confused with a normal one", () => {
  // Constitution invariant 2: a witness that cannot be read is not evidence that there
  // is nothing to see. The old shape returned "not yes" for an errored fetch exactly as
  // it did for a genuine "never reopened", so an API hiccup SILENTLY re-closed an issue
  // a human had reopened — the precise failure #1628 exists to prevent.

  it('refuses to close when the timeline cannot be read at all', () => {
    const out = runReconciler('reconcile_done_issues', { done: '1068\n', pr: '1230\n' }); // no fixture → no output
    expect(out).toContain('skipping #1068');
    expect(out).toContain('could not be read');
    expect(ghCalls()).not.toContain('issue close 1068');
  });

  it('refuses to close on a response that does not reduce to a verdict', () => {
    const out = runReconciler('reconcile_done_issues', { done: '1068\n', pr: '1230\n' }, {
      raw: 'not json at all\n',
    });
    expect(out).toContain('skipping #1068');
    expect(ghCalls()).not.toContain('issue close 1068');
  });

  it('an EMPTY history is a NORMAL state, not an unknown one — the close still proceeds', () => {
    // The distinction that matters: `[]` is a readable history that simply records no
    // reopen. Failing closed on genuinely-unknown must not swallow this ordinary case,
    // or the reconciler stops reconciling anything.
    const out = runReconciler('reconcile_done_issues', { done: '1068\n', pr: '1230\n' }, [[]]);
    expect(out).toContain('closing #1068');
    expect(ghCalls()).toContain('issue close 1068');
  });

  it('keeps evaluating the REST of the board after an unreadable witness', () => {
    // "Never stop evaluating": an unreadable witness skips THAT issue and nothing
    // more — the loop must still reach every later issue on the board.
    const out = runReconciler('reconcile_done_issues', { done: '1068\n1069\n', pr: '1230\n' });
    expect(out).toContain('skipping #1068');
    expect(out).toContain('skipping #1069');
  });
});

describe('#1352 (T3) — the liveness witness actually matches a live dispatch', () => {
  // `pgrep -f` matches with ERE. The pattern shipped here was BRE-escaped, so `\+`,
  // `\(`, `\|` and `\)` were LITERAL characters in ERE and the pattern could never
  // match a real command line: `dispatch_alive_for` returned false for every input,
  // and witness 2 of the reaper was dead. A live dispatch >6h old could be reaped.
  //
  // The existing "does NOT reap a claim while a dispatch is alive" test above does
  // not catch this: with the witness dead it falls through to an unreadable timeline
  // and declines to reap for a DIFFERENT reason, so it stays green either way. This
  // drives the witness directly, through the `--dispatch-alive` seam, so it can only
  // pass when the pattern genuinely matches.
  function spawnFakeDispatch(issue: string): ChildProcess {
    const fake = path.join(tmp, 'dispatch-issue.sh');
    fs.writeFileSync(fake, '#!/usr/bin/env bash\nsleep 30\n', { mode: 0o755 });
    const kid = spawn('bash', [fake, issue], { stdio: 'ignore' });
    kids.push(kid);
    execFileSync('bash', ['-c', 'sleep 0.4']); // let it reach the process table
    return kid;
  }

  function dispatchAlive(issue: string): boolean {
    try {
      execFileSync('bash', [DRAIN, '--dispatch-alive', issue], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  it('reports ALIVE for an issue whose dispatch is running', () => {
    spawnFakeDispatch('885');
    expect(dispatchAlive('885')).toBe(true);
  });

  it('reports DEAD for an issue with no dispatch running', () => {
    spawnFakeDispatch('885');
    expect(dispatchAlive('774')).toBe(false);
  });

  it('stays anchored — a live 885 is not a live 88 (prefix hazard)', () => {
    spawnFakeDispatch('885');
    expect(dispatchAlive('88')).toBe(false);
  });
});
