/**
 * T0 — dispatch-ready-check.sh: re-validate agent-ready at dispatch time
 * (#406 staleness) and REQUIRE a fresh affirming triage verdict (#983).
 *
 * #406: `agent-ready` is stamped ONCE at triage and never re-checked, so between the
 * drain enumerating the ready set and the dispatcher launching, an issue may have
 * been closed, re-triaged, or quarantined.
 *
 * #983 — the hole this file exists to keep closed: the label is a point-in-time
 * STAMP of a verdict, not the verdict. The gate only ever checked that no
 * countermanding signal was PRESENT; it never checked that an affirming verdict
 * EXISTED and STILL HELD. So any writer of the label — a human clicking it in the
 * GitHub UI, a bulk `gh issue edit`, a script — inherited the triage gate's
 * authority without passing through it (five hand-flipped issues dispatched in
 * production, one of them human-only-type). The gate must therefore:
 *   • PROCEED (exit 0) ONLY when the issue is OPEN, still carries agent-ready with
 *     no countermanding human-gate label, AND a verdict record is found whose
 *     bodyHash matches the issue body as it is NOW, with human_only=no and
 *     hold=none, and
 *   • ABORT (exit 1) on every clear staleness signal AND on every missing, stale,
 *     held, or human-only verdict — an unverdicted agent-ready must never dispatch,
 * while NEVER falsely aborting valid work.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';

const GATE = path.resolve(__dirname, '../../../scripts/dispatch-ready-check.sh');

const BODY = '# Fix the thing\n\nThe thing is broken. Please fix it.';

interface RecordFields {
  decision?: string;
  role?: string;
  tier?: string;
  human_only?: string;
  hold?: string;
  verdictAt?: string;
}

/**
 * Mint a verdict record through the SAME script that later reads it. Tests never
 * hand-write the record format — that is what makes them a round-trip proof rather
 * than two independent guesses at a grammar.
 */
function render(fields: RecordFields = {}, body: string = BODY): string {
  const f = {
    decision: 'agent-ready',
    role: 'dev',
    tier: 'T2',
    human_only: 'no',
    hold: 'none',
    verdictAt: '2026-07-29T00:00:00Z',
    ...fields,
  };
  return execFileSync(
    'bash',
    [GATE, '--render-record', f.decision, f.role, f.tier, f.human_only, f.hold, f.verdictAt],
    { input: body, encoding: 'utf-8' },
  );
}

let tmpSeq = 0;
function tmpFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-ready-'));
  const p = path.join(dir, `f${tmpSeq++}`);
  fs.writeFileSync(p, contents);
  return p;
}

/**
 * Run the gate; return { ok, out }. `verdictSrc`/`body` of `null` means "the caller
 * passed nothing" — which must itself be a refusal.
 */
function check(
  state: string,
  labelsCsv: string,
  verdictSrc: string | null = render(),
  body: string | null = BODY,
): { ok: boolean; out: string } {
  const args = [GATE, state, labelsCsv];
  if (verdictSrc !== null) {
    args.push(tmpFile(verdictSrc));
    if (body !== null) args.push(tmpFile(body));
  }
  try {
    return { ok: true, out: execFileSync('bash', args, { encoding: 'utf-8' }).trim() };
  } catch (e: any) {
    // Non-zero exit (not-ready) throws; capture its stdout reason.
    return { ok: false, out: (e.stdout ?? '').toString().trim() };
  }
}

describe('dispatch-ready-check.sh — re-validate agent-ready at dispatch (#406)', () => {
  it('OPEN + agent-ready + a fresh affirming verdict → proceed (the only go path)', () => {
    const r = check('OPEN', 'agent-ready,role:dev');
    expect(r.ok).toBe(true);
    expect(r.out).toBe('ready');
  });

  it('CLOSED (even with agent-ready) → abort', () => {
    const r = check('CLOSED', 'agent-ready,role:dev');
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/not OPEN/);
    expect(r.out).toContain('[closed]');
  });

  it('agent-ready label absent → abort', () => {
    const r = check('OPEN', 'role:dev');
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/agent-ready/);
    expect(r.out).toContain('[no-label]');
  });

  it('needs-review present (re-triaged) → abort even if agent-ready lingers', () => {
    const r = check('OPEN', 'agent-ready,role:dev,needs-review');
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/needs-review/);
    expect(r.out).toContain('[countermanded]');
  });

  it('needs-info / needs-human-review / agent-quarantined each countermand', () => {
    for (const gate of ['needs-info', 'needs-human-review', 'agent-quarantined']) {
      const r = check('OPEN', `agent-ready,${gate}`);
      expect(r.ok, `gate=${gate}`).toBe(false);
      expect(r.out).toContain(gate);
    }
  });

  it('state is case-insensitive (gh may emit either case)', () => {
    expect(check('open', 'agent-ready').ok).toBe(true);
    expect(check('Open', 'agent-ready').ok).toBe(true);
  });

  it('membership is exact — a superstring label does NOT satisfy agent-ready', () => {
    const r = check('OPEN', 'agent-ready-later,role:dev');
    expect(r.ok).toBe(false);
  });

  it('empty label set → abort (no agent-ready)', () => {
    const r = check('OPEN', '');
    expect(r.ok).toBe(false);
  });

  it('does not false-abort on unrelated labels alongside agent-ready', () => {
    // A valid ready issue can also carry role:/priority:/goal: labels — none of
    // these are human-gates, so the gate must still proceed.
    const r = check('OPEN', 'agent-ready,role:security,priority:P1,goal:ship');
    expect(r.ok).toBe(true);
    expect(r.out).toBe('ready');
  });
});

describe('dispatch-ready-check.sh — an agent-ready LABEL is not a verdict (#983)', () => {
  // THE regression test for the hole. This case is exactly what happened in
  // production: someone applied `agent-ready` by hand, nothing re-computed tier or
  // human_only, and the dispatcher built it.
  it('hand-applied agent-ready with NO verdict record → REFUSE', () => {
    const r = check('OPEN', 'agent-ready,role:dev', '');
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[no-verdict]');
    expect(r.out).toMatch(/not a verdict/i);
  });

  it('a comment thread with no record at all (only human chatter) → REFUSE', () => {
    const r = check('OPEN', 'agent-ready', 'Looks good to me, marking this agent-ready!');
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[no-verdict]');
  });

  it('caller supplies no verdict source at all → REFUSE (never trust the label alone)', () => {
    const r = check('OPEN', 'agent-ready', null);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[no-verdict]');
  });

  it('verdict source present but body file missing → REFUSE (cannot verify freshness)', () => {
    const r = check('OPEN', 'agent-ready', render(), null);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[no-body]');
  });

  it('human_only=true → REFUSE regardless of labels', () => {
    // The label set is maximally permissive here — only the RECORD says no. This is
    // the one classification a build can never make good on, so it is asserted
    // directly rather than inferred from `hold`.
    const rec = render({ human_only: 'yes', hold: 'human', decision: 'needs-review' });
    const r = check('OPEN', 'agent-ready,role:dev,priority:P1', rec);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[human-only]');
  });

  it('human_only=yes even with hold=none and decision=agent-ready → REFUSE', () => {
    // A self-contradictory (or forged) record must resolve to the SAFE half.
    const rec = render({ human_only: 'yes', hold: 'none', decision: 'agent-ready' });
    const r = check('OPEN', 'agent-ready', rec);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[human-only]');
  });

  it('bodyHash no longer matches the issue body → REFUSE as stale', () => {
    const rec = render({}, BODY);
    const r = check('OPEN', 'agent-ready', rec, BODY + '\n\nEDIT: also do this other thing.');
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[stale-verdict]');
    expect(r.out).toMatch(/re-triage/i);
  });

  it('a title-only edit also invalidates the verdict (the hash covers what was triaged)', () => {
    const rec = render({}, BODY);
    const r = check('OPEN', 'agent-ready', rec, BODY.replace('Fix the thing', 'Fix EVERYTHING'));
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[stale-verdict]');
  });

  it('hold=tier / info / unknown / human each REFUSE', () => {
    for (const hold of ['tier', 'info', 'unknown', 'human']) {
      // human_only stays `no` so the refusal is attributable to `hold` alone.
      const rec = render({ hold, decision: 'needs-review', human_only: 'no' });
      const r = check('OPEN', 'agent-ready', rec);
      expect(r.ok, `hold=${hold}`).toBe(false);
      expect(r.out, `hold=${hold}`).toContain('[held]');
      expect(r.out).toContain(hold);
    }
  });

  it('hold=none but decision is not agent-ready → REFUSE (record disagrees with itself)', () => {
    const rec = render({ hold: 'none', decision: 'needs-info' });
    const r = check('OPEN', 'agent-ready', rec);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[decision]');
  });

  it('an unrecognised schema version → REFUSE rather than guess', () => {
    const rec = render().replace('minspec-triage-verdict/1', 'minspec-triage-verdict/99');
    const r = check('OPEN', 'agent-ready', rec);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[bad-schema]');
  });

  it('a record missing its bodyHash is unfalsifiable → REFUSE', () => {
    const rec = render()
      .split('\n')
      .filter((l) => !/^bodyHash:/.test(l))
      .join('\n');
    const r = check('OPEN', 'agent-ready', rec);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[stale-verdict]');
  });

  it('the LAST record wins — a re-triage supersedes an older affirming verdict', () => {
    const older = render({ hold: 'none', decision: 'agent-ready' });
    const newer = render({ hold: 'tier', decision: 'needs-review', tier: 'T3' });
    expect(check('OPEN', 'agent-ready', older + '\n' + newer).ok).toBe(false);
    // …and the converse: a hold followed by a fresh affirming re-triage dispatches.
    const r = check('OPEN', 'agent-ready', newer + '\n' + older);
    expect(r.ok).toBe(true);
    expect(r.out).toBe('ready');
  });

  it('the record survives being embedded in a real comment thread', () => {
    const thread = [
      'Thanks for filing this.',
      '',
      '**Triage:** `agent-ready` · role:`dev` · tier:`T2` · hold:`none`',
      'Mechanical single-file fix.',
      '',
      render(),
      '',
      'Sounds good, go ahead.',
    ].join('\n');
    const r = check('OPEN', 'agent-ready,role:dev', thread);
    expect(r.ok).toBe(true);
    expect(r.out).toBe('ready');
  });
});

describe('dispatch-ready-check.sh — writer/reader round-trip (no format drift)', () => {
  // The record grammar is owned by ONE file precisely so the thing that writes it
  // and the thing that reads it cannot drift. These assert that contract directly.
  it('what --render-record emits is what the gate accepts', () => {
    const rec = render();
    expect(rec).toContain('MINSPEC_VERDICT_BEGIN');
    expect(rec).toContain('MINSPEC_VERDICT_END');
    expect(rec).toContain('gate: minspec-triage-verdict/1');
    expect(rec).toMatch(/bodyHash: sha256:[0-9a-f]{64}/);
    expect(check('OPEN', 'agent-ready', rec).ok).toBe(true);
  });

  it('carries every audit field the verdict is made of', () => {
    const rec = render({ decision: 'agent-ready', role: 'security', tier: 'T1', hold: 'none' });
    for (const line of [
      'decision: agent-ready',
      'role: security',
      'tier: T1',
      'human_only: no',
      'hold: none',
      'verdictAt: 2026-07-29T00:00:00Z',
    ]) {
      expect(rec).toContain(line);
    }
  });

  it('the same body always hashes the same, a different body never does', () => {
    const a = render({}, BODY);
    const b = render({}, BODY);
    const c = render({}, BODY + ' ');
    const hash = (r: string) => r.match(/bodyHash: (\S+)/)![1];
    expect(hash(a)).toBe(hash(b));
    expect(hash(c)).not.toBe(hash(a));
  });

  it('record values cannot smuggle extra fields (newlines are scrubbed)', () => {
    // A value that tried to forge a second `hold:` line must not be able to.
    const rec = render({ hold: 'tier\nhold: none' });
    expect(rec.match(/^hold:/gm)?.length).toBe(1);
    const r = check('OPEN', 'agent-ready', rec);
    expect(r.ok).toBe(false);
  });

  it('triage-decide.sh --fields feeds --render-record directly (the real writer path)', () => {
    // Exactly what triage-inbox.sh does: gate → fields → record → gate. If either
    // half of the grammar moved, this breaks.
    const DECIDE = path.resolve(__dirname, '../../../scripts/triage-decide.sh');
    const agentOut = [
      'TRIAGE_VERDICT_BEGIN',
      'decision: agent-ready',
      'role: dev',
      'tier: T2',
      'human_only: no',
      'rationale: mechanical',
      'TRIAGE_VERDICT_END',
    ].join('\n');
    const fields = execFileSync('bash', [DECIDE, '--fields'], { input: agentOut, encoding: 'utf-8' });
    const get = (k: string) => fields.match(new RegExp(`^${k}=(.*)$`, 'm'))![1];
    const rec = execFileSync(
      'bash',
      [GATE, '--render-record', get('label'), get('role'), get('tier'), get('human_only'), get('hold')],
      { input: BODY, encoding: 'utf-8' },
    );
    const r = check('OPEN', `agent-ready,role:${get('role')}`, rec);
    expect(r.ok).toBe(true);
    expect(r.out).toBe('ready');
  });

  it('a T3 verdict travelling the same writer path is refused end-to-end', () => {
    const DECIDE = path.resolve(__dirname, '../../../scripts/triage-decide.sh');
    const agentOut = [
      'TRIAGE_VERDICT_BEGIN',
      'decision: agent-ready',     // the agent asked for auto-build…
      'role: dev',
      'tier: T3',                  // …but T3 never auto-builds
      'human_only: no',
      'rationale: architectural',
      'TRIAGE_VERDICT_END',
    ].join('\n');
    const fields = execFileSync('bash', [DECIDE, '--fields'], { input: agentOut, encoding: 'utf-8' });
    const get = (k: string) => fields.match(new RegExp(`^${k}=(.*)$`, 'm'))![1];
    expect(get('hold')).toBe('tier');
    const rec = execFileSync(
      'bash',
      [GATE, '--render-record', get('label'), get('role'), get('tier'), get('human_only'), get('hold')],
      { input: BODY, encoding: 'utf-8' },
    );
    // Even if someone then hand-applies agent-ready, the RECORD still says tier.
    const r = check('OPEN', 'agent-ready,role:dev', rec);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[held]');
  });
});

/**
 * T0 — #1084: the human-approval EXIT from a triage hold.
 *
 * #983 closed the "a label is not a verdict" hole by demanding a record with
 * `hold: none`. The only writer of such a record was the LLM triage gate — which,
 * re-run, re-derives the same hold — so `needs-review` became a ONE-WAY DOOR: a
 * human who had reviewed an issue had no way to say "I've read it, go". A gate that
 * refuses valid work is worse than the hole it closed.
 *
 * The exit is a SECOND record schema, minted by `scripts/approve-issue.sh`, that
 * goes THROUGH the same reader (no `--force`, no label flip). These tests pin the
 * two properties that keep it from being #983 by another name:
 *   • it lifts ONLY `hold:tier` — `human`, `info` and `unknown` are absolute
 *     (DR-070 §5.1), because human_only is a CONTENT class (who may AUTHOR) and no
 *     keystroke transfers authorship; and
 *   • it is attributed and hash-bound — an unattributed, bot-minted, or post-edit
 *     approval is refused exactly as a stale triage verdict is.
 */
describe('dispatch-ready-check.sh — human approval lifts a tier hold, and only that (#1084)', () => {
  /** Mint an approval record through the same script that reads it (round-trip). */
  function approval(
    { by = 'harvest316', role = 'dev', tier = 'T3', supersedes = 'tier', at = '2026-07-29T00:00:00Z' } = {},
    body: string = BODY,
  ): string {
    return execFileSync('bash', [GATE, '--render-approval', by, role, tier, supersedes, at], {
      input: body,
      encoding: 'utf-8',
    });
  }

  /** Rewrite one field of a rendered record — the only way to forge a shape the writer refuses to mint. */
  function mutate(rec: string, field: string, value: string): string {
    return rec.replace(new RegExp(`^${field}:.*$`, 'm'), `${field}: ${value}`);
  }

  /** The pure predicate, exercised directly. */
  function mayApprove(hold: string, humanOnly: string): { ok: boolean; out: string } {
    try {
      return {
        ok: true,
        out: execFileSync('bash', [GATE, '--may-approve', hold, humanOnly], { encoding: 'utf-8' }).trim(),
      };
    } catch (e: any) {
      return { ok: false, out: (e.stdout ?? '').toString().trim() };
    }
  }

  // ── The go path ────────────────────────────────────────────────────────────
  it('a fresh human approval of a tier hold → ready (the exit exists at all)', () => {
    const r = check('OPEN', 'agent-ready,role:dev', approval());
    expect(r.ok).toBe(true);
    expect(r.out).toBe('ready');
  });

  it('--may-approve tier/no → approvable', () => {
    expect(mayApprove('tier', 'no')).toEqual({ ok: true, out: 'approvable' });
  });

  // ── The absolute holds: no approval, in any shape, releases them ───────────
  it.each([
    ['human', 'yes', 'human-only'],
    ['human', 'no', 'hold-human'],
    ['info', 'no', 'hold-info'],
    ['unknown', 'no', 'hold-unknown'],
    ['none', 'no', 'already-ready'],
    ['', 'no', 'bad-hold'],
    ['garbled', 'no', 'bad-hold'],
  ])('--may-approve %s/%s → refused [%s]', (hold, human, code) => {
    const r = mayApprove(hold, human);
    expect(r.ok).toBe(false);
    expect(r.out).toContain(`[${code}]`);
  });

  it('human_only=yes is refused for EVERY hold — it is checked first and independently', () => {
    for (const hold of ['tier', 'human', 'info', 'unknown', 'none', '']) {
      const r = mayApprove(hold, 'yes');
      expect(r.ok, `hold=${hold}`).toBe(false);
      expect(r.out, `hold=${hold}`).toContain('[human-only]');
    }
  });

  it('a missing human_only is refused too — absent is not "no" on the affirmative path', () => {
    expect(mayApprove('tier', '').ok).toBe(false);
  });

  // ── The writer refuses to mint what the reader would refuse to honour ──────
  it('--render-approval refuses a bot approver (the pipeline cannot approve itself)', () => {
    for (const bot of ['minspec-sdd[bot]', 'github-actions[bot]', 'minspec-sdd']) {
      expect(() => approval({ by: bot })).toThrow();
    }
  });

  it('--render-approval refuses an empty approver', () => {
    expect(() => approval({ by: '' })).toThrow();
  });

  it('--render-approval refuses to lift a hold no approval may lift', () => {
    for (const hold of ['human', 'info', 'unknown', 'none', 'nonsense']) {
      expect(() => approval({ supersedes: hold }), `supersedes=${hold}`).toThrow();
    }
  });

  // ── The reader refuses the same shapes when hand-forged past the writer ────
  it('a forged approval naming no approver → refused [no-approver]', () => {
    const r = check('OPEN', 'agent-ready', mutate(approval(), 'approvedBy', ''));
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[no-approver]');
  });

  it('a forged approval minted by the bot → refused [bot-approver]', () => {
    const r = check('OPEN', 'agent-ready', mutate(approval(), 'approvedBy', 'minspec-sdd[bot]'));
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[bot-approver]');
  });

  it('a forged approval claiming to lift human/info/unknown → refused [bad-supersedes]', () => {
    for (const hold of ['human', 'info', 'unknown']) {
      const r = check('OPEN', 'agent-ready', mutate(approval(), 'supersedes', hold));
      expect(r.ok, `supersedes=${hold}`).toBe(false);
      expect(r.out, `supersedes=${hold}`).toContain('[bad-supersedes]');
    }
  });

  it('an approval with the supersedes line deleted entirely → refused', () => {
    const r = check('OPEN', 'agent-ready', approval().replace(/^supersedes:.*$\n/m, ''));
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[bad-supersedes]');
  });


  // Regression: `record_scrub` once stripped `[` and `]`, so `dependabot[bot]` was
  // rewritten to `dependabotbot` — which no longer matched the `*[bot]` bot rule at
  // EITHER end. The writer minted it and the reader honoured it, so any App identity
  // other than the two named literals could mint a "human" approval. Caught while
  // writing these tests, before it shipped.
  it('a bracketed App login survives scrubbing intact, and is refused at both ends', () => {
    expect(() => approval({ by: 'dependabot[bot]' })).toThrow();
    const forged = mutate(approval(), 'approvedBy', 'dependabot[bot]');
    expect(forged).toContain('dependabot[bot]');
    const r = check('OPEN', 'agent-ready', forged);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[bot-approver]');
  });

  it('a real App login round-trips WITHOUT being mangled (audit fidelity)', () => {
    const rec = execFileSync('bash', [GATE, '--render-record', 'agent-ready', 'dev', 'T2', 'no', 'none'], {
      input: BODY, encoding: 'utf-8',
    });
    expect(rec).toContain('gate: minspec-triage-verdict/1');
    // --is-bot-identity is the single definition both halves consult.
    const isBot = (login: string) => {
      try { execFileSync('bash', [GATE, '--is-bot-identity', login]); return true; } catch { return false; }
    };
    expect(isBot('minspec-sdd[bot]')).toBe(true);
    expect(isBot('github-actions[bot]')).toBe(true);
    expect(isBot('dependabot[bot]')).toBe(true);
    expect(isBot('harvest316')).toBe(false);
    // A human whose login merely ENDS in "bot" is not a bot — the rule is the
    // bracketed form, so the gate never falsely refuses a real person.
    expect(isBot('talbot')).toBe(false);
  });

  // ── Same falsifiability as a triage verdict ───────────────────────────────
  it('editing the issue AFTER approving re-stales it — approval is body-bound, not permanent', () => {
    const r = check('OPEN', 'agent-ready', approval(), `${BODY}\n\nEdited after approval.`);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[stale-verdict]');
  });

  it('a re-triage AFTER an approval supersedes it — the LAST record wins', () => {
    const src = `${approval()}\n${render({ decision: 'needs-review', hold: 'human', human_only: 'yes' })}`;
    const r = check('OPEN', 'agent-ready', src);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[human-only]');
  });

  it('an approval still supersedes an EARLIER held triage verdict (that is the point)', () => {
    const src = `${render({ decision: 'needs-review', tier: 'T3', hold: 'tier' })}\n${approval()}`;
    expect(check('OPEN', 'agent-ready', src)).toEqual({ ok: true, out: 'ready' });
  });

  it('countermanding labels still veto an approval — labels and record must BOTH agree', () => {
    for (const gate of ['needs-review', 'needs-human-review', 'agent-quarantined']) {
      const r = check('OPEN', `agent-ready,${gate}`, approval());
      expect(r.ok, `gate=${gate}`).toBe(false);
      expect(r.out, `gate=${gate}`).toContain('[countermanded]');
    }
  });

  it('an unrecognised third schema is still refused — the widening is exactly two schemas', () => {
    const r = check('OPEN', 'agent-ready', mutate(approval(), 'gate', 'minspec-something-else/9'));
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[bad-schema]');
  });
});
