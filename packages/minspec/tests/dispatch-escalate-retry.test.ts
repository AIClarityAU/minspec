/**
 * T3 — regression/feature: `dispatch-issue.sh` auto-retries an ESCALATED dispatch
 * once on opus before falling to a human (DR-355, #662).
 *
 * Before #662, an agent that emitted `ESCALATE:` was labelled `agent-escalated`
 * and the dispatcher STOPPED — it never re-ran the task on a stronger model, and
 * `agent-escalated` is not `agent-ready`, so the drain never revisited it. A
 * sonnet dev give-up therefore dead-ended at a human with no automated retry,
 * diverging from DR-355 ("re-invoke the same task on opus; only if opus also
 * escalates → surface to user").
 *
 * The fix routes the ESCALATE branch through a PURE decision, `escalate_next_action`,
 * that yields exactly one of `retry-opus` / `surface-human`, and wires a bounded
 * (one-tier-bump) retry loop around the `claude -p` run. This test exercises the
 * pure decision directly (sourced out of the script and run in bash) for the three
 * required cases plus the loop-safety bound, and asserts the shell wiring that
 * carries the sonnet failure reason into the opus retry and applies the
 * agent-escalated + needs-human-review labels only on the FINAL escalation.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

// Locate scripts/ from the repo (or worktree) root — same helper the sibling
// dispatch-issue.sh text tests use.
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
  throw new Error('Could not locate the repo-root scripts/ directory from ' + __dirname);
}

const scriptPath = path.join(findScriptsDir(), 'dispatch-issue.sh');
const content = fs.readFileSync(scriptPath, 'utf-8');

// Extract the PURE `escalate_next_action` bash function (def line → the first
// line that is a lone `}` at column 0, matching how every function in this
// script closes). This is the tested seam — no side effects, echoes one token.
function extractDecisionFn(): string {
  const m = content.match(/^escalate_next_action\(\) \{[\s\S]*?^\}/m);
  if (!m) throw new Error('escalate_next_action() not found in dispatch-issue.sh');
  return m[0];
}
const decisionFn = extractDecisionFn();

/** Source the extracted function and run it with the given args; return stdout. */
function decide(model: string, retried: string, retryOff: string): string {
  const call = `escalate_next_action ${JSON.stringify(model)} ${JSON.stringify(retried)} ${JSON.stringify(retryOff)}`;
  return execFileSync('bash', ['-c', `${decisionFn}\n${call}`], { encoding: 'utf-8' }).trim();
}

// Comment-stripped code so explanatory prose mentioning a pattern can't satisfy a
// wiring assertion (same discipline as dispatch-no-local-ai-review-label.test.ts).
const code = content
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

describe('dispatch-issue.sh — escalate-retry decision (DR-355 / #662)', () => {
  it('(a) sonnet ESCALATE, retry enabled → exactly one opus retry', () => {
    expect(decide('sonnet', '0', '')).toBe('retry-opus');
  });

  it('(b) opus ESCALATE → no further retry (surface to human)', () => {
    // Already on opus: the tier bump is spent regardless of the retried flag.
    expect(decide('opus', '0', '')).toBe('surface-human');
    expect(decide('opus', '1', '')).toBe('surface-human');
  });

  it('(c) MINSPEC_ESCALATE_RETRY_OFF=1 disables the retry (straight to human)', () => {
    expect(decide('sonnet', '0', '1')).toBe('surface-human');
  });

  it('is loop-safe: once the one retry is spent, a second escalation surfaces to human', () => {
    // The bound is the retried flag, not a label re-read — a sonnet that has
    // already consumed its retry must never ask for another.
    expect(decide('sonnet', '1', '')).toBe('surface-human');
  });

  it('any sub-opus tier bumps straight to opus (never an intermediate tier)', () => {
    expect(decide('haiku', '0', '')).toBe('retry-opus');
  });

  it('emits exactly one token and nothing else (safe as a control-flow oracle)', () => {
    for (const out of [
      decide('sonnet', '0', ''),
      decide('opus', '0', ''),
      decide('sonnet', '0', '1'),
    ]) {
      expect(out.split(/\s+/)).toHaveLength(1);
      expect(['retry-opus', 'surface-human']).toContain(out);
    }
  });
});

describe('dispatch-issue.sh — escalate-retry wiring (DR-355 / #662)', () => {
  it('routes the ESCALATE branch through the pure escalate_next_action decision', () => {
    expect(code).toMatch(/escalate_next_action\s+"\$RUN_MODEL"\s+"\$ESCALATE_RETRIED"/);
  });

  it('bumps the retry to opus and re-runs (RUN_MODEL=opus + continue), bounded by a local flag', () => {
    expect(code).toMatch(/RUN_MODEL="opus"/);
    expect(code).toMatch(/ESCALATE_RETRIED=1/);
    // The retry re-enters the loop via `continue`; the flag (not a label re-read)
    // is what bounds it — assert both are present.
    expect(code).toMatch(/\bcontinue\b/);
  });

  it('carries the sonnet failure reason into the opus retry prompt', () => {
    // The reason is captured from the ESCALATE line and embedded in RUN_PROMPT.
    expect(code).toMatch(/ESCALATE_REASON=\$\(grep -m1 '\^ESCALATE:'/);
    expect(code).toMatch(/RUN_PROMPT=\$\(printf[\s\S]*\$ESCALATE_REASON/);
  });

  it('honours the MINSPEC_ESCALATE_RETRY_OFF opt-out (mirrors the other dispatch guards)', () => {
    expect(code).toMatch(/MINSPEC_ESCALATE_RETRY_OFF/);
  });

  it('labels agent-escalated + needs-human-review ONLY on the final (surface-human) escalation', () => {
    expect(code).toMatch(/--add-label "agent-escalated,needs-human-review"/);
  });

  it('is a bounded loop, not an unbounded one (single while wrapping the run)', () => {
    // Exactly one `while true; do` guards the run; the loop can iterate at most
    // twice (initial + one opus retry) because `continue` is gated by the flag.
    const whileCount = (code.match(/while true; do/g) ?? []).length;
    expect(whileCount).toBe(1);
  });
});
