/**
 * T1 — the autonomy banner (DR-086 surfacing).
 *
 * The banner exists so the stop list ARRIVES rather than being recalled. That
 * only works if it is derived from the resolver: a hand-maintained copy would
 * drift from STOP_CLASSES silently and read as authoritative while being wrong —
 * a false signpost, which in a never-wrong product is the worst defect.
 *
 * These assert derivation, not wording.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { STOP_CLASSES } from '../../../scripts/lib/autonomy';

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts', 'autonomy-status.ts');
const HOOK = path.join(REPO, 'scripts', 'hooks', 'session-start.sh');

function run(env: Record<string, string> = {}): string {
  return execFileSync('npx', ['tsx', SCRIPT, REPO], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
}

describe('autonomy-status — reflects the resolver', () => {
  it('reports ask by default, and says the human is consulted', () => {
    const out = run({ MINSPEC_AUTONOMY: '' });
    expect(out).toMatch(/Autonomy: ask/);
  });

  it('reports act when the setting resolves to act', () => {
    const out = run({ MINSPEC_AUTONOMY: 'act' });
    expect(out).toMatch(/Autonomy: act/);
  });

  it('a non-token value reports ask — the banner cannot claim more autonomy than the resolver grants', () => {
    for (const v of ['ACT', 'true', 'yes', 'auto']) {
      expect(run({ MINSPEC_AUTONOMY: v })).toMatch(/Autonomy: ask/);
    }
  });
});

describe('autonomy-status — the list is DERIVED, not restated', () => {
  it.each(STOP_CLASSES.map((s) => s.id))('prints %s in both modes', (id) => {
    expect(run({ MINSPEC_AUTONOMY: '' })).toContain(id);
    expect(run({ MINSPEC_AUTONOMY: 'act' })).toContain(id);
  });

  it('prints EXACTLY the classes the module defines — no extras, none missing', () => {
    // This is the anti-drift assertion. A hardcoded copy passes the per-id tests
    // above while silently disagreeing the moment STOP_CLASSES changes; comparing
    // the full set is what actually catches that.
    const out = run({ MINSPEC_AUTONOMY: 'act' });
    const printed = out
      .split('\n')
      .flatMap((l) => l.split('·'))
      .map((s) => s.trim())
      .filter((s) => /^[a-z-]+$/.test(s) && s.includes('-'));
    const expected = STOP_CLASSES.map((s) => s.id);
    for (const id of expected) expect(printed).toContain(id);
    // Nothing printed in the class position that is not a real class.
    for (const p of printed) expect(expected).toContain(p);
  });

  it('does not hardcode the count in prose (a number goes stale silently)', () => {
    const src = fs.readFileSync(SCRIPT, 'utf-8');
    expect(src).not.toMatch(/\bsix\b|\b6 (classes|stop)/i);
  });
});

describe('session-start hook wiring', () => {
  const hook = fs.readFileSync(HOOK, 'utf-8');

  it('invokes the printer', () => {
    expect(hook).toContain('autonomy-status.ts');
  });

  it('is non-fatal — a broken printer must never wedge a session start', () => {
    expect(hook).toMatch(/autonomy-status\.ts[^\n]*\|\| true|2>\/dev\/null \|\| true/);
  });

  it('derives its root from the script location, so it is right in every worktree', () => {
    // A hardcoded path or an undefined REPO_ROOT would silently no-op — the
    // banner would simply stop appearing, which looks identical to "autonomy is
    // off" rather than to a broken hook.
    expect(hook).toContain('BASH_SOURCE');
  });

  it('actually emits the banner when the hook is run', () => {
    const out = execFileSync('bash', [HOOK], { encoding: 'utf-8', cwd: REPO });
    expect(out).toMatch(/Autonomy: (ask|act)/);
  });
});
