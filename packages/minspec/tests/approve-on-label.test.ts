/**
 * T0 — #1113: the label flip is the approval gesture again, and its provenance
 * comes from GitHub's own record rather than from the webhook payload.
 *
 * #983 stopped a hand-applied `agent-ready` from dispatching, because the label was a
 * point-in-time STAMP of a verdict nobody re-checked. What was wrong was never "a human
 * flipped a label" — it was "nothing recorded WHO flipped it, or WHAT verdict they were
 * overriding". #1113 keeps the gesture and supplies the record.
 *
 * The control these tests exist to pin is `--verify-label-event`: before minting an
 * approval naming an actor, the workflow re-asks GitHub's timeline whether that actor
 * really applied that label. It must fail CLOSED on every shape that is not a positive,
 * exact match — a different label, a different actor, an `unlabeled` event, a truncated
 * or unparseable response. "Could not tell" must never read as "verified", because the
 * thing being authorised is an agent starting work on a held issue.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// #1285: spawns real child processes per assertion — 5s default is a load metric,
// not a hang signal. Enforced by shell-timeout-coverage.test.ts.
useShellTimeout();

const SCRIPT = path.resolve(__dirname, '../../../scripts/approve-on-label.sh');
const ACTOR = 'harvest316';
const LABEL = 'agent-ready';

function verify(timeline: unknown, label = LABEL, actor = ACTOR): { ok: boolean; out: string } {
  const input = typeof timeline === 'string' ? timeline : JSON.stringify(timeline);
  try {
    return {
      ok: true,
      out: execFileSync('bash', [SCRIPT, '--verify-label-event', label, actor], {
        input,
        encoding: 'utf-8',
      }).trim(),
    };
  } catch (e: any) {
    return { ok: false, out: ((e.stdout ?? '') + (e.stderr ?? '')).toString().trim() };
  }
}

const labeled = (name: string, login: string) => ({ event: 'labeled', label: { name }, actor: { login } });

describe('approve-on-label.sh — the approval binds to a recorded human action (#1113)', () => {
  it('a matching labeled event by the actor → verified (the only go path)', () => {
    expect(verify([labeled(LABEL, ACTOR)])).toEqual({ ok: true, out: 'verified' });
  });

  it('finds the match among unrelated timeline noise', () => {
    const timeline = [
      { event: 'commented', actor: { login: 'someone' } },
      labeled('needs-review', 'minspec-sdd[bot]'),
      { event: 'cross-referenced', actor: { login: ACTOR } },
      labeled(LABEL, ACTOR),
      { event: 'renamed', actor: { login: ACTOR } },
    ];
    expect(verify(timeline).ok).toBe(true);
  });

  // ── Every near-miss must fail closed ───────────────────────────────────────
  it('an empty timeline → unverified', () => {
    const r = verify([]);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('no ');
  });

  it('a labeled event for a DIFFERENT label → unverified', () => {
    expect(verify([labeled('needs-review', ACTOR)]).ok).toBe(false);
  });

  it('a labeled event by a DIFFERENT actor → unverified (this is the forgery case)', () => {
    expect(verify([labeled(LABEL, 'someone-else')]).ok).toBe(false);
    expect(verify([labeled(LABEL, 'minspec-sdd[bot]')]).ok).toBe(false);
  });

  it('an UNLABELED event with the right label and actor → unverified', () => {
    const removed = { event: 'unlabeled', label: { name: LABEL }, actor: { login: ACTOR } };
    expect(verify([removed]).ok).toBe(false);
  });

  it('matching is exact, not substring — a superstring label does not verify', () => {
    expect(verify([labeled('agent-ready-later', ACTOR)]).ok).toBe(false);
    expect(verify([labeled(LABEL, 'harvest3160')]).ok).toBe(false);
  });

  it('events missing .label or .actor do not throw and do not verify', () => {
    expect(verify([{ event: 'labeled' }]).ok).toBe(false);
    expect(verify([{ event: 'labeled', label: { name: LABEL } }]).ok).toBe(false);
    expect(verify([{ event: 'labeled', actor: { login: ACTOR } }]).ok).toBe(false);
  });

  it('an unparseable or truncated timeline → unverified, NOT verified-by-default', () => {
    for (const bad of ['', 'not json', '{"event":', '[{"event":"labeled"']) {
      const r = verify(bad);
      expect(r.ok, `input=${JSON.stringify(bad)}`).toBe(false);
      expect(r.out, `input=${JSON.stringify(bad)}`).toContain('unverified');
    }
  });

  it('a JSON object (not an array) → unverified rather than a crash', () => {
    expect(verify({ event: 'labeled' }).ok).toBe(false);
  });

  it('an empty label or actor argument → unverified', () => {
    expect(verify([labeled(LABEL, ACTOR)], '', ACTOR).ok).toBe(false);
    expect(verify([labeled(LABEL, ACTOR)], LABEL, '').ok).toBe(false);
  });

  // ── The identity has no parameter to come through ─────────────────────────
  it('refuses to run outside GitHub Actions — there is no --approver flag at all', () => {
    let out = '';
    let threw = false;
    try {
      execFileSync('bash', [SCRIPT], {
        encoding: 'utf-8',
        env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_EVENT_PATH: '' },
      });
    } catch (e: any) {
      threw = true;
      out = ((e.stdout ?? '') + (e.stderr ?? '')).toString();
    }
    expect(threw).toBe(true);
    expect(out).toMatch(/only inside GitHub Actions/);
    // The refusal must point at the path that DOES work, not just say no.
    expect(out).toMatch(/approve-issue\.sh/);
  });

  it('inside Actions but with no event file → refuses (identity has no trusted source)', () => {
    let out = '';
    let threw = false;
    try {
      execFileSync('bash', [SCRIPT], {
        encoding: 'utf-8',
        env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: '/nonexistent/event.json' },
      });
    } catch (e: any) {
      threw = true;
      out = ((e.stdout ?? '') + (e.stderr ?? '')).toString();
    }
    expect(threw).toBe(true);
    expect(out).toMatch(/GITHUB_EVENT_PATH/);
  });

  it('exposes no flag through which a caller could name the approver', () => {
    // Strip whole-line comments FIRST. The header prose says "there is deliberately
    // NO --approver flag", and an assertion that a comment can satisfy — or, as here,
    // spuriously fail — is measuring the documentation, not the program.
    const code = execFileSync('cat', [SCRIPT], { encoding: 'utf-8' })
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');

    for (const flag of ['--approver', '--force', '--yes']) {
      expect(code, `${flag} must not be accepted`).not.toContain(flag);
    }
    // …and the identity is read from the runner's event file, and nowhere else.
    expect(code).toMatch(/sender\.login/);
    expect(code).toMatch(/GITHUB_EVENT_PATH/);
  });

  it('the comment-stripping above is not vacuous — it still sees real code', () => {
    // Guards the previous test: if the filter ever removed everything, that test would
    // pass for the wrong reason. Assert the stripped text retains the actual logic.
    const code = execFileSync('cat', [SCRIPT], { encoding: 'utf-8' })
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(code).toContain('--verify-label-event');
    expect(code).toContain('--may-approve');
    expect(code).toContain('--render-approval');
    expect(code.length).toBeGreaterThan(1500);
  });
});

/**
 * T0 — #1245: permission is established BEFORE any privilege is minted.
 *
 * The App installation token is broader than this workflow needs. Minting it and only
 * then asking whether the actor may approve hands a privileged credential to the
 * unauthorized path. Ordering is the whole control, and ordering is exactly the kind of
 * property that a later well-meaning edit silently reverses — so it is pinned here.
 *
 * Line-index assertions rather than a YAML parse: no YAML library is a dependency of this
 * package, and adding one to assert step order would cost more than it proves.
 */
describe('approve-on-label.yml — permission before privilege (#1245)', () => {
  const WF = path.resolve(__dirname, '../../../.github/workflows/approve-on-label.yml');
  const wf = (): string => fs.readFileSync(WF, 'utf-8');
  const lineOf = (needle: string): number => {
    const i = wf().split('\n').findIndex((l) => l.includes(needle));
    if (i < 0) throw new Error(`workflow has no line containing ${JSON.stringify(needle)}`);
    return i;
  };

  it('the permission check runs BEFORE the App token is minted', () => {
    expect(lineOf('id: perm')).toBeLessThan(lineOf('create-github-app-token'));
  });

  it('the mint is gated on the permission verdict, not merely ordered after it', () => {
    // Ordering alone would still mint for an unauthorized actor — the step has to be
    // skipped, not just sequenced.
    const lines = wf().split('\n');
    const mintIdx = lineOf('create-github-app-token');
    const guard = lines.slice(Math.max(0, mintIdx - 4), mintIdx).join('\n');
    expect(guard).toMatch(/if:\s*steps\.perm\.outputs\.authorized != 'false'/);
  });

  /**
   * THREE outcomes, not two (PR #1258 architect, blocking).
   *
   * `GET /collaborators/{user}/permission` is a privileged read, and the default token's
   * ability to make it is not something to assume — the pre-existing check deliberately
   * used the broader App token. Collapsing "the check failed" into "the actor is denied"
   * would let one 403 silently lock out every maintainer and bounce them with a
   * `permission: none` message that is simply untrue: an errored witness reported as a
   * verdict, which is constitution invariant 2 exactly.
   */
  it('an errored check yields `unknown` — never a denial', () => {
    const body = wf();
    expect(body).toContain('authorized=unknown');
    // The failure branch must NOT emit a permission value that reads as a real answer.
    expect(body).not.toMatch(/authorized=false[\s\S]{0,200}could not read/);
  });

  it('an errored check still mints and defers to the authoritative App-token check', () => {
    // `!= 'false'` — true OR unknown proceed. A `== 'true'` gate would skip the mint on
    // an errored check and strand the run with no decision at all.
    const lines = wf().split('\n');
    for (const anchor of ['create-github-app-token', 'run: bash scripts/approve-on-label.sh']) {
      const i = lines.findIndex((l) => l.includes(anchor));
      const block = lines.slice(Math.max(0, i - 6), i).join('\n');
      expect(block, anchor).toMatch(/authorized != 'false'/);
      expect(block, anchor).not.toMatch(/authorized == 'true'/);
    }
  });

  it('the errored case is VISIBLE, not silent', () => {
    // DR-066: a gate that cannot run must say so. A swallowed 403 that quietly changes
    // behaviour is the silent gate this repo's invariant 2 forbids.
    expect(wf()).toMatch(/::warning title=Early permission check could not run/);
  });

  it('only a DEFINITIVE deny bounces the label', () => {
    const lines = wf().split('\n');
    const i = lines.findIndex((l) => l.includes('Remove the label and explain'));
    const block = lines.slice(i, i + 4).join('\n');
    expect(block).toMatch(/authorized == 'false'/);
  });

  it('the approve step is gated too, so it can never run without the mint', () => {
    const lines = wf().split('\n');
    const runIdx = lineOf('run: bash scripts/approve-on-label.sh');
    const block = lines.slice(Math.max(0, runIdx - 6), runIdx).join('\n');
    expect(block).toMatch(/if:\s*steps\.perm\.outputs\.authorized != 'false'/);
  });

  it('the unauthorized path still bounces — the fix must not cost the #1113 UX', () => {
    // A hard failure before the mint would have been simpler and worse: `agent-ready`
    // left standing with no explanation. The bounce is the point of the feature.
    expect(wf()).toMatch(/if:\s*steps\.perm\.outputs\.authorized == 'false'/);
    expect(wf()).toMatch(/--remove-label agent-ready/);
  });

  it('the bounce uses the DEFAULT token, never the App token', () => {
    const lines = wf().split('\n');
    const bounceIdx = lines.findIndex((l) => l.includes('Remove the label and explain'));
    const block = lines.slice(bounceIdx, bounceIdx + 12).join('\n');
    expect(block).toContain('secrets.GITHUB_TOKEN');
    expect(block).not.toContain('steps.app.outputs.token');
  });

  it('every event field reaches the shell via env:, never inside a run: body', () => {
    // The safe pattern IS `KEY: ${{ github.event.x }}` under `env:` — the first version of
    // this test flagged those and failed on correct code. The invariant is about WHERE the
    // interpolation sits: an `env:` mapping or an expression context (`if:`, `group:`) is
    // fine; anywhere else means the value is being pasted into a shell command.
    const offenders = wf()
      .split('\n')
      .filter((l) => l.includes('${{ github.event.'))
      .filter((l) => !/^\s+[A-Za-z_][A-Za-z0-9_]*:\s*\$\{\{/.test(l))   // env: / with: mapping
      .filter((l) => !/^\s*(if|group):/.test(l))                          // expression context
      .filter((l) => !/^\s+github\.event\./.test(l));                    // continuation of a multiline if:
    expect(offenders, `event field outside env:/expression → ${offenders.join(' | ')}`).toEqual([]);
  });

  it('…and that check is not vacuous — the workflow does use event fields', () => {
    expect(wf().split('\n').filter((l) => l.includes('${{ github.event.')).length).toBeGreaterThan(2);
  });
});
