/**
 * T3 — the dispatch label lifecycle closes. (#1305, #1307, #1322)
 *
 * Three defects, one theme: labels that drive dispatch were written optimistically
 * and nothing ever reconciled them, so the queue kept handing back work that was
 * already done, already crashed, or already merged.
 *
 *  #1322  Nothing injected `Closes #N`. The PR body was the agent's free-text
 *         summary, so closure depended on the model writing a GitHub keyword.
 *         #1229 wrote "Fix for #1067:" and #1230 wrote "# #1068 —" — bare refs.
 *         `closingIssuesReferences` was EMPTY on both; both issues stayed open
 *         after merge.
 *  #1305  Completion added `agent-done` but never dropped `agent-ready`, and
 *         `agent-done` countermanded nothing — so #1068 was re-claimed 44 minutes
 *         after completing, with its PR already merged.
 *  #1307  The crash path stamped `agent-escalated` WITHOUT `needs-human-review`
 *         (the DR-355 escalation path stamps both), and `agent-escalated`
 *         countermanded nothing — so #1112 crashed, was silently requeued, and
 *         crashed again. Two dispatches, zero commits, no human.
 *
 * The countermand assertions below EXECUTE the real gate rather than reading the
 * script's text, so they fail if the behaviour regresses even when the source
 * still looks right.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

function findScriptsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'scripts');
    if (fs.existsSync(candidate) && fs.existsSync(path.join(dir, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate scripts/ from ' + __dirname);
}

const SCRIPTS = findScriptsDir();
const READY_CHECK = path.join(SCRIPTS, 'dispatch-ready-check.sh');
const DISPATCH = path.join(SCRIPTS, 'dispatch-issue.sh');

/**
 * Run the real gate. Returns the refusal reason and whether it admitted the issue.
 * The gate exits non-zero to refuse, printing the reason on stdout.
 */
function readyCheck(labelsCsv: string): { ok: boolean; reason: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'label-lifecycle-'));
  const verdict = path.join(dir, 'verdict');
  const body = path.join(dir, 'body');
  // A verdict record the gate will accept is not needed for these cases: the
  // countermand check runs BEFORE the verdict check, so a refusal here proves the
  // label countermanded rather than the verdict being absent. The assertions below
  // therefore pin the REASON string, not merely the exit code.
  fs.writeFileSync(verdict, '', 'utf-8');
  fs.writeFileSync(body, 'issue body', 'utf-8');
  try {
    const out = execFileSync('bash', [READY_CHECK, 'open', labelsCsv, verdict, body], {
      encoding: 'utf-8',
    });
    return { ok: true, reason: out.trim() };
  } catch (e: unknown) {
    const err = e as { stdout?: string };
    return { ok: false, reason: String(err.stdout ?? '').trim() };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('agent-done and agent-escalated countermand a stale agent-ready', () => {
  it('#1305 — a COMPLETED issue is not dispatchable even if agent-ready lingers', () => {
    const { ok, reason } = readyCheck('agent-ready,agent-done,role:dev');
    expect(ok).toBe(false);
    expect(reason).toContain('countermanded');
    expect(reason).toContain('agent-done');
  });

  it('#1307 — a CRASHED/ESCALATED issue is not dispatchable either', () => {
    const { ok, reason } = readyCheck('agent-ready,agent-escalated,role:dev');
    expect(ok).toBe(false);
    expect(reason).toContain('countermanded');
    expect(reason).toContain('agent-escalated');
  });

  it('the pre-existing countermanding labels still countermand (no regression)', () => {
    for (const gate of ['needs-review', 'needs-info', 'needs-human-review', 'agent-quarantined']) {
      const { ok, reason } = readyCheck(`agent-ready,${gate}`);
      expect(ok, `${gate} must countermand`).toBe(false);
      expect(reason).toContain(gate);
    }
  });

  it('anti-vacuity — a plain agent-ready issue is NOT refused for countermanding', () => {
    // It may still be refused later (no verdict record), but never as `countermanded`.
    // Without this, a gate that refused everything would pass every test above.
    const { reason } = readyCheck('agent-ready,role:dev');
    expect(reason).not.toContain('countermanded');
  });
});

describe('#1322 — the PR body carries a deterministic Closes trailer', () => {
  // Extract the parent-side trailer logic and run it, rather than trusting that the
  // source "looks right". The agent's summary is untrusted free text, so the trailer
  // must be appended by this block regardless of what the agent wrote.
  const content = fs.readFileSync(DISPATCH, 'utf-8');

  function trailerBlock(): string {
    const start = content.indexOf('      if ! grep -qiE "(clos(e|es|ed)');
    if (start < 0) {
      throw new Error(
        'Could not find the #1322 Closes-trailer block in dispatch-issue.sh. Fix this ' +
          'extractor rather than deleting the test — without the trailer, every merged ' +
          'agent PR leaves its issue open and queued.',
      );
    }
    const end = content.indexOf('fi', content.indexOf('BODY=$(printf', start));
    return content.slice(start, end + 2);
  }

  function compose(agentSummary: string, issue: string): string {
    const script = ['set -euo pipefail', `ISSUE=${issue}`, `BODY=${JSON.stringify(agentSummary)}`, trailerBlock(), 'printf "%s" "$BODY"'].join('\n');
    return execFileSync('bash', ['-c', script], { encoding: 'utf-8' });
  }

  it('appends Closes #N when the agent wrote only a bare reference', () => {
    // The exact shape that shipped #1067 and #1068 unclosed.
    const out = compose('# Fix for #1067: facts status coerced DR status', '1067');
    expect(out).toContain('Closes #1067');
  });

  it('appends Closes #N when the agent mentioned no issue at all', () => {
    const out = compose('Did some work.', '885');
    expect(out).toContain('Closes #885');
  });

  it('does not double the trailer when the agent already closed the issue', () => {
    const out = compose('Fixes #1068 properly.', '1068');
    expect(out.match(/Closes #1068/g) ?? []).toHaveLength(0);
    // The agent's own keyword is left intact — GitHub already actions it.
    expect(out).toContain('Fixes #1068');
  });

  it('still adds its own trailer when the agent closed a DIFFERENT issue', () => {
    // "Closes #999" must not be read as satisfying the trailer for #1068.
    const out = compose('Closes #999 as a side effect.', '1068');
    expect(out).toContain('Closes #1068');
  });
});

describe('#1305/#1307 — completion and crash label writes actually execute', () => {
  // The first draft of this suite substring-matched the script source. That passed
  // while BOTH commands were dead: the comments had been placed between
  // `gh issue edit ... \\` and its continuation, so the backslash-newline spliced the
  // comment on and commented out the rest of the command. `bash -n` passed, the
  // orphaned `--remove-label` line became a swallowed "command not found", and the
  // whole fix was inert. The AI reviewer caught it; these assertions could not.
  //
  // So: EXECUTE the statement with a stub `gh` on PATH and assert the flags it
  // actually received. A spliced comment means gh is never invoked at all, which
  // fails loudly here.
  const content = fs.readFileSync(DISPATCH, 'utf-8');

  /** The label-write statement = the line carrying `marker` plus the line before it. */
  function labelWriteStatement(marker: string): string {
    const lines = content.split('\n');
    const i = lines.findIndex((l) => l.includes(marker));
    if (i < 1) throw new Error(`could not find the label write for ${marker}`);
    return lines[i - 1] + '\n' + lines[i];
  }

  function runLabelWrite(marker: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'label-write-'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(dir, 'gh.log');
    fs.writeFileSync(
      path.join(bin, 'gh'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );
    const script = ['set -uo pipefail', 'ISSUE=4242', 'REPO=owner/repo', labelWriteStatement(marker)].join('\n');
    try {
      execFileSync('bash', ['-c', script], {
        encoding: 'utf-8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      return fs.existsSync(log) ? fs.readFileSync(log, 'utf-8') : '';
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('the completion write really runs, and really drops agent-ready', () => {
    const call = runLabelWrite('--add-label "agent-done"');
    expect(call, 'gh was never invoked — the command is dead').not.toBe('');
    expect(call).toContain('issue edit 4242');
    expect(call).toContain('--remove-label agent-running,agent-ready');
    expect(call).toContain('--add-label agent-done');
  });

  it('the crash write really runs, and raises needs-human-review', () => {
    // Marker must include the agent-ready removal: the DR-355 escalation path a few
    // hundred lines earlier also ends in `--add-label "agent-escalated,needs-human-review"`,
    // and matching that one instead would silently test the wrong statement.
    const call = runLabelWrite(
      '--remove-label "agent-running,agent-ready" --add-label "agent-escalated,needs-human-review"',
    );
    expect(call, 'gh was never invoked — the command is dead').not.toBe('');
    expect(call).toContain('issue edit 4242');
    expect(call).toContain('--remove-label agent-running,agent-ready');
    expect(call).toContain('needs-human-review');
  });
});
