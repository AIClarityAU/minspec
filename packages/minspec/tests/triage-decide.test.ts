import { describe, it, expect, afterAll, vi } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import path from 'node:path';

// #1099 — this suite drives real `bash`/`triage-decide.sh` child processes per
// assertion. Under container scheduling contention a single invocation can queue
// past the 5s default testTimeout even though nothing hung, and which suite trips
// it is non-deterministic run-to-run (#1099). Raised HERE, per-file, not globally —
// a genuinely hung test elsewhere still fails fast at the default. 30s is the value
// #1099 measured all affected suites passing reliably at.
vi.setConfig({ testTimeout: 30_000 });
afterAll(() => {
  vi.resetConfig();
});

// T0 invariant test for the deterministic triage gate (scripts/triage-decide.sh).
//
// The gate BACKS the LLM triage agent's judgment: a `human_only` or T3/T4 verdict
// must NEVER become `agent-ready`, no matter what the (untrusted-input-reading)
// agent emits. It must also fail CLOSED on any garbled / missing verdict.
// Root cause it guards: triage-inbox.sh was inert in headless mode and, once fixed,
// must not let a prompt-injected "agent-ready" reach an auto-build path.
//
// The gate emits THREE tokens — "<label> <role> <hold>" (#1002). The third names the
// branch that fired, so downstream (dispatch) can refuse a held item without
// re-running an LLM: the label alone is a lossy stamp that records *that* a gate ran,
// never *what it concluded*. `--fields` prints the same decision as key=value lines
// plus the two normalised inputs (tier, human_only) the #983 verdict record carries.
//
// #1169 / DR-076 widened the OUTPUT vocabulary with one class: an auto-buildable
// T3/T4 now resolves to `agent-ready-specify` / hold `specify` — dispatchable for the
// SPECIFY PHASE ONLY. The safety property this file exists to pin is unchanged in
// kind and must be read as three separate claims:
//   1. `agent-ready` (full auto-build) is STILL reachable only from T1/T2.
//   2. `agent-ready-specify` is reachable only from T3/T4 + an affirmative decision.
//   3. `human_only` still overrides BOTH, at every tier.
// The specify class is DERIVED by the gate from `tier`; the agent never asserts it
// (the input vocabulary is untouched), so an injected issue body cannot request it.

const DECIDE = path.resolve(__dirname, '..', '..', '..', 'scripts', 'triage-decide.sh');

function verdict(fields: Partial<Record<'decision' | 'role' | 'tier' | 'human_only' | 'rationale', string>>): string {
  const f = { decision: 'agent-ready', role: 'dev', tier: 'T1', human_only: 'no', rationale: 'x', ...fields };
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

/** Run the gate, returning trimmed "<label> <role> <hold>" stdout even on non-zero exit. */
function decide(input: string, ...args: string[]): string {
  try {
    return execFileSync('bash', [DECIDE, ...args], { input, encoding: 'utf8' }).trim();
  } catch (e: any) {
    return String(e.stdout ?? '').trim();
  }
}

/** Run `--fields` and parse the key=value lines into an object. */
function fields(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of decide(input, '--fields').split('\n')) {
    const m = line.match(/^([a-z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// #1085 — async counterparts of decide()/fields(), used ONLY by the three tests below
// that sweep every (tier, decision, human_only) combination. Those loops each fire
// 16-60 child-process invocations per test; run through execFileSync they are issued
// one at a time, so the test's wall-clock cost is the SUM of every spawn's fork/exec
// latency. Under full-suite concurrent load that latency is not constant — #1099 raised
// this file's testTimeout to 30s from a baseline measured on lighter, mostly
// one-spawn-per-assertion suites — and the sum of 60 serial spawns is exactly what
// occasionally pushed past that budget (observed once in ~3 full-suite runs, never in
// isolation). The gate itself (triage-decide.sh) is pure — stdin in, stdout out, no
// temp files, no $PWD, no clock — so nothing here is a real correctness race; firing
// the spawns concurrently instead of serially turns the test's exposure into roughly
// the SLOWEST single spawn rather than the sum of all of them, which is what the fixed
// 30s ceiling was actually sized for.
function decideAsync(input: string, ...args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile('bash', [DECIDE, ...args], { encoding: 'utf8' }, (_err, stdout) => {
      resolve(String(stdout ?? '').trim());
    });
    child.stdin!.end(input);
  });
}

async function fieldsAsync(input: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const raw = await decideAsync(input, '--fields');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([a-z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

describe('triage-decide.sh — deterministic triage gate', () => {
  it('T1 + agent-ready (auto-buildable) → agent-ready, hold none (the only auto path)', () => {
    expect(decide(verdict({ tier: 'T1', decision: 'agent-ready' }))).toBe('agent-ready dev none');
  });

  it('T2 + agent-ready → agent-ready', () => {
    expect(decide(verdict({ tier: 'T2', decision: 'agent-ready', role: 'architect' }))).toBe('agent-ready architect none');
  });

  // The load-bearing invariant: injected/incorrect agent-ready cannot escape the gate.
  it('human_only=yes ALWAYS overrides agent-ready → needs-review, hold human', () => {
    expect(decide(verdict({ human_only: 'yes', tier: 'T1', decision: 'agent-ready' }))).toBe('needs-review dev human');
  });

  it('human_only=true (alt spelling) also overrides → needs-review', () => {
    expect(decide(verdict({ human_only: 'true', tier: 'T2', decision: 'agent-ready' }))).toBe('needs-review dev human');
  });

  // ── #1169 / DR-076: T3/T4 auto-buildable → SPECIFY-ONLY, not needs-review ──
  // Before this change both of these landed on `needs-review dev tier`, which made
  // the human read the RAW ISSUE before an agent could even write the spec — and
  // then read the SPEC anyway at the approval gate. Two human reads where DR-076
  // funds one. The gate now routes the auto-buildable ones to a specify-only
  // dispatch; the human's single read moves to the finished spec.
  it('T3 + auto-buildable → agent-ready-specify, hold specify (spec now, implement never)', () => {
    expect(decide(verdict({ tier: 'T3', decision: 'agent-ready' }))).toBe('agent-ready-specify dev specify');
  });

  it('T4 + auto-buildable → agent-ready-specify, hold specify', () => {
    expect(decide(verdict({ tier: 'T4', decision: 'agent-ready', role: 'architect' }))).toBe(
      'agent-ready-specify architect specify',
    );
  });

  it('T3/T4 still NEVER reach plain agent-ready (the implement path stays shut)', async () => {
    // #1085 — fired concurrently (decideAsync), not serially, so this test's
    // wall-clock cost is not the sum of all 16 spawns' latency. See decideAsync above.
    const checks: Promise<void>[] = [];
    for (const tier of ['T3', 'T4']) {
      for (const decision of ['agent-ready', 'agent-ready-specify', 'needs-review', 'garbage']) {
        for (const human_only of ['no', 'yes']) {
          checks.push(
            decideAsync(verdict({ tier, decision, human_only })).then((out) => {
              const [label] = out.split(' ');
              expect(label, `${tier}/${decision}/${human_only}`).not.toBe('agent-ready');
            }),
          );
        }
      }
    }
    await Promise.all(checks);
  });

  it('T3 WITHOUT an affirmative decision keeps the old tier hold (no blanket auto-specify)', () => {
    // The agent's `decision` is not decoration: if it did not judge the issue
    // auto-buildable, the specify class is not reachable either. Fail-closed —
    // exactly the pre-#1169 outcome.
    expect(decide(verdict({ tier: 'T3', decision: 'needs-review' }))).toBe('needs-review dev tier');
    expect(decide(verdict({ tier: 'T4', decision: 'ship-it-immediately' }))).toBe('needs-review dev tier');
  });

  it('human_only=yes beats the specify class too (T3/T4 human-only → needs-review, hold human)', () => {
    expect(decide(verdict({ tier: 'T3', decision: 'agent-ready', human_only: 'yes' }))).toBe(
      'needs-review dev human',
    );
    expect(decide(verdict({ tier: 'T4', decision: 'agent-ready', human_only: 'true' }))).toBe(
      'needs-review dev human',
    );
  });

  it('needs-info still wins over the specify class at T3/T4', () => {
    expect(decide(verdict({ tier: 'T3', decision: 'needs-info' }))).toBe('needs-info dev info');
  });

  // #345 — the gate documents (lines 7-9) that it "fails CLOSED: any
  // missing/garbled field downgrades to a human gate", but a MISSING
  // human_only line previously fell through to `agent-ready` for a T1/T2
  // agent-ready verdict instead of downgrading. Every other test in this
  // file supplies human_only via verdict()'s default fill, so none of them
  // exercised the field's actual absence — these two build the block by
  // hand, omitting the line entirely.
  it('MISSING human_only line fails closed to needs-review, hold human (#345)', () => {
    const noHumanOnly = [
      'TRIAGE_VERDICT_BEGIN',
      'decision: agent-ready',
      'role: dev',
      'tier: T1',
      'rationale: x',
      'TRIAGE_VERDICT_END',
    ].join('\n');
    expect(decide(noHumanOnly)).toBe('needs-review dev human');
  });

  it('MISSING human_only line at T3 still fails closed (not agent-ready-specify either)', () => {
    const noHumanOnly = [
      'TRIAGE_VERDICT_BEGIN',
      'decision: agent-ready',
      'role: architect',
      'tier: T3',
      'rationale: x',
      'TRIAGE_VERDICT_END',
    ].join('\n');
    expect(decide(noHumanOnly)).toBe('needs-review architect human');
  });

  it('garbled human_only value (neither yes/true nor no/false) also fails closed', () => {
    expect(decide(verdict({ human_only: 'maybe', tier: 'T2', decision: 'agent-ready' }))).toBe(
      'needs-review dev human',
    );
  });

  it('--fields reports human_only=unknown for a missing line, not a false no or yes', () => {
    const noHumanOnly = [
      'TRIAGE_VERDICT_BEGIN',
      'decision: agent-ready',
      'role: dev',
      'tier: T1',
      'rationale: x',
      'TRIAGE_VERDICT_END',
    ].join('\n');
    expect(fields(noHumanOnly)).toEqual({
      label: 'needs-review',
      role: 'dev',
      hold: 'human',
      tier: 'T1',
      human_only: 'unknown',
    });
  });

  it('the agent cannot ASSERT the specify class — T1/T2 + agent-ready-specify is not affirmative', () => {
    // The class is derived from TIER by the gate. An issue body that injects
    // "decision: agent-ready-specify" into a T1/T2 verdict buys nothing: it is not
    // one of the three input tokens, so it falls through to the fail-closed rule.
    expect(decide(verdict({ tier: 'T1', decision: 'agent-ready-specify' }))).toBe('needs-review dev unknown');
  });

  it('needs-info decision is preserved', () => {
    expect(decide(verdict({ decision: 'needs-info', tier: 'T2' }))).toBe('needs-info dev info');
  });

  it('unknown tier → needs-info (cannot size the work), hold unknown', () => {
    // The two axes stay unconflated: the LABEL says what the human should do
    // (supply the missing size); the HOLD says what the gate concluded (nothing).
    expect(decide(verdict({ tier: 'T9' }))).toBe('needs-info dev unknown');
  });

  it('garbled role falls back to reviewer (human-facing)', () => {
    expect(decide(verdict({ role: 'wizard', tier: 'T2', decision: 'agent-ready' }))).toBe('agent-ready reviewer none');
  });

  it('no verdict block at all → fails closed to needs-review, hold unknown', () => {
    expect(decide('the model rambled and emitted no verdict block')).toBe('needs-review reviewer unknown');
  });

  it('a decision that falls through every rule → needs-review, hold unknown', () => {
    expect(decide(verdict({ tier: 'T2', decision: 'ship-it-immediately' }))).toBe('needs-review dev unknown');
  });

  it('case-insensitive field names are honored', () => {
    const upper = 'TRIAGE_VERDICT_BEGIN\nDECISION: agent-ready\nROLE: dev\nTIER: T1\nHUMAN_ONLY: no\nRATIONALE: x\nTRIAGE_VERDICT_END';
    expect(decide(upper)).toBe('agent-ready dev none');
  });

  it('surrounding model prose does not break extraction', () => {
    const noisy = `Here is my analysis.\n\n${verdict({ tier: 'T1', decision: 'agent-ready' })}\n\nThanks!`;
    expect(decide(noisy)).toBe('agent-ready dev none');
  });

  it('label and hold are locked together — each affirmative label has exactly one hold', async () => {
    // Exhaustive sweep: whatever the agent emits, an affirmative label and its
    // matching hold must travel together or not at all. Two pairs now exist, and
    // they must never cross: `agent-ready` goes with `none` (full build) and
    // `agent-ready-specify` with `specify` (spec only). A crossed pair would let the
    // dispatcher read one authority (the label) and the gate another (the hold).
    //
    // #1085 — fired concurrently (decideAsync), not serially: this loop is 60
    // combinations, and running them one child-process at a time made the test's
    // wall-clock cost the SUM of every spawn's latency, which is exactly what
    // occasionally exceeded the shared 30s shell-test budget under full-suite load.
    // See decideAsync above.
    const checks: Promise<void>[] = [];
    for (const tier of ['T1', 'T2', 'T3', 'T4', 'T9', '']) {
      for (const decision of ['agent-ready', 'agent-ready-specify', 'needs-review', 'needs-info', 'garbage']) {
        for (const human_only of ['no', 'yes']) {
          const where = `${tier}/${decision}/${human_only}`;
          checks.push(
            decideAsync(verdict({ tier, decision, human_only })).then((out) => {
              const [label, , hold] = out.split(' ');
              expect(label === 'agent-ready', where).toBe(hold === 'none');
              expect(label === 'agent-ready-specify', where).toBe(hold === 'specify');
            }),
          );
        }
      }
    }
    await Promise.all(checks);
  });
});

describe('triage-decide.sh --fields — the projection the verdict record is built from (#983)', () => {
  it('emits the decision plus the normalised tier and human_only', () => {
    expect(fields(verdict({ tier: 'T2', decision: 'agent-ready', role: 'dev' }))).toEqual({
      label: 'agent-ready',
      role: 'dev',
      hold: 'none',
      tier: 'T2',
      human_only: 'no',
    });
  });

  it('projects the specify class into the record fields verbatim (#1169)', () => {
    // The record is what dispatch reads; if `--fields` did not carry the specify
    // class, triage would label the issue one thing and record another.
    expect(fields(verdict({ tier: 'T3', decision: 'agent-ready', role: 'architect' }))).toEqual({
      label: 'agent-ready-specify',
      role: 'architect',
      hold: 'specify',
      tier: 'T3',
      human_only: 'no',
    });
  });

  it('normalises tier casing so the record never carries raw agent text', () => {
    expect(fields(verdict({ tier: 't3' })).tier).toBe('T3');
  });

  it('normalises human_only=true → yes', () => {
    expect(fields(verdict({ human_only: 'true' })).human_only).toBe('yes');
  });

  it('an unsizable tier is reported as unknown, never guessed', () => {
    const f = fields(verdict({ tier: 'T9' }));
    expect(f.tier).toBe('unknown');
    expect(f.hold).toBe('unknown');
  });

  it('no verdict block → a complete, fail-closed field set (never a partial record)', () => {
    expect(fields('nothing useful here')).toEqual({
      label: 'needs-review',
      role: 'reviewer',
      hold: 'unknown',
      tier: 'unknown',
      human_only: 'no',
    });
  });

  it('the two projections never describe different decisions', async () => {
    // #1085 — this test's original all-synchronous form fired 2 child-process spawns
    // (decide + fields, and fields internally spawns one more) per combination × 30
    // combinations = 60 spawns, one at a time. That made the test's wall-clock cost
    // the SUM of every spawn's fork/exec latency, and under full-suite concurrent load
    // that sum occasionally exceeded the shared 30s shell-test budget (#1099) — the
    // one-off flake this fixes. The gate under test (triage-decide.sh) is pure: stdin
    // in, stdout out, no temp files, no $PWD, no clock — so the non-determinism was in
    // this harness, not the script, and the #983 invariant itself was never at risk.
    // Firing the two projections concurrently (decideAsync/fieldsAsync) turns the
    // test's exposure into roughly the slowest single spawn instead of the sum of 60.
    const checks: Promise<void>[] = [];
    for (const tier of ['T1', 'T2', 'T3', 'T4', 'T9']) {
      for (const decision of ['agent-ready', 'needs-review', 'needs-info']) {
        for (const human_only of ['no', 'yes']) {
          const v = verdict({ tier, decision, human_only });
          checks.push(
            Promise.all([decideAsync(v), fieldsAsync(v)]).then(([out, f]) => {
              const [label, role, hold] = out.split(' ');
              expect({ label, role, hold }, `${tier}/${decision}/${human_only}`).toEqual({
                label: f.label,
                role: f.role,
                hold: f.hold,
              });
            }),
          );
        }
      }
    }
    await Promise.all(checks);
  });
});
