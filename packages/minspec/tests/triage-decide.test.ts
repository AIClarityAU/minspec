import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

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

  it('T3 never auto-builds → needs-review, hold tier', () => {
    expect(decide(verdict({ tier: 'T3', decision: 'agent-ready' }))).toBe('needs-review dev tier');
  });

  it('T4 never auto-builds → needs-review, hold tier', () => {
    expect(decide(verdict({ tier: 'T4', decision: 'agent-ready' }))).toBe('needs-review dev tier');
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

  it('`none` is the ONLY hold that ever accompanies agent-ready', () => {
    // Exhaustive sweep: whatever the agent emits, an affirmative label and an
    // affirmative hold must travel together or not at all.
    for (const tier of ['T1', 'T2', 'T3', 'T4', 'T9', '']) {
      for (const decision of ['agent-ready', 'needs-review', 'needs-info', 'garbage']) {
        for (const human_only of ['no', 'yes']) {
          const [label, , hold] = decide(verdict({ tier, decision, human_only })).split(' ');
          expect(label === 'agent-ready', `${tier}/${decision}/${human_only}`).toBe(hold === 'none');
        }
      }
    }
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

  it('the two projections never describe different decisions', () => {
    for (const tier of ['T1', 'T2', 'T3', 'T4', 'T9']) {
      for (const decision of ['agent-ready', 'needs-review', 'needs-info']) {
        for (const human_only of ['no', 'yes']) {
          const v = verdict({ tier, decision, human_only });
          const [label, role, hold] = decide(v).split(' ');
          const f = fields(v);
          expect({ label, role, hold }, `${tier}/${decision}/${human_only}`).toEqual({
            label: f.label,
            role: f.role,
            hold: f.hold,
          });
        }
      }
    }
  });
});
