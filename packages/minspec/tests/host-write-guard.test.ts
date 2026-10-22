/**
 * T0 — #1816: a HOST session must not be able to write to GitHub as the founder.
 *
 * These run the hook as a PROCESS with a real JSON envelope on stdin and assert on the
 * decision it emits. A source-text assertion would go green whenever the prose survives,
 * including when the logic around it has been inverted.
 *
 * The location detector is stubbed by pointing HOME at a temp dir, because the hook
 * resolves it as `~/.claude/scripts/identity-boundary-check.sh`. Deliberately NOT an
 * env-var override in the hook itself: an override that makes the gate answer differently
 * is a bypass, and this gate's whole purpose is that it cannot be talked out of a refusal.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts')) && fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo root from ' + __dirname);
}
const HOOK = path.join(findRepoRoot(), 'scripts/hooks/host-write-guard.py');

type Stub = 'container' | 'host' | 'weird-exit' | 'hang' | 'missing' | 'not-executable';

/** Run the hook with a stubbed detector. Returns the parsed hookSpecificOutput. */
function run(command: string, stub: Stub, toolName = 'Bash') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hwg-home-'));
  try {
    if (stub !== 'missing') {
      const dir = path.join(home, '.claude', 'scripts');
      fs.mkdirSync(dir, { recursive: true });
      const body =
        stub === 'container'
          ? '#!/bin/sh\necho "IDENTITY-LOCATION [container (abc123)]"\nexit 0\n'
          : stub === 'host'
            ? '#!/bin/sh\necho "IDENTITY-LOCATION [HOST (k7, pid1=systemd)]"\nexit 1\n'
            : stub === 'hang'
              ? '#!/bin/sh\nsleep 30\n'
              : '#!/bin/sh\necho "no answer"\nexit 7\n';
      const p = path.join(dir, 'identity-boundary-check.sh');
      fs.writeFileSync(p, body);
      fs.chmodSync(p, stub === 'not-executable' ? 0o644 : 0o755);
    }
    const out = execFileSync('python3', [HOOK], {
      input: JSON.stringify({ tool_name: toolName, tool_input: { command } }),
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
      timeout: 20_000,
    });
    return JSON.parse(out).hookSpecificOutput as {
      permissionDecision: string;
      permissionDecisionReason?: string;
    };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

describe('#1816 — the container path is unchanged', () => {
  it('allows a gh write when provably in the container', () => {
    expect(run('gh issue create --title x', 'container').permissionDecision).toBe('allow');
  });

  it('allows git push when provably in the container', () => {
    expect(run('git push -u origin feat/x', 'container').permissionDecision).toBe('allow');
  });
});

describe('#1816 — a HOST session is refused', () => {
  it('denies a gh write, naming the reason', () => {
    const r = run('gh issue comment 1816 --body x', 'host');
    expect(r.permissionDecision).toBe('deny');
    expect(r.permissionDecisionReason).toMatch(/HOST/);
    expect(r.permissionDecisionReason).toMatch(/#1816/);
  });

  it('denies git push', () => {
    expect(run('git push origin main', 'host').permissionDecision).toBe('deny');
  });

  it('denies gh reached through a pipeline or subshell, not just at the start', () => {
    for (const c of ['echo hi | gh pr comment 1 --body-file -', 'x=$(gh pr view 1 --json state)', 'true && gh pr merge 1']) {
      expect(run(c, 'host').permissionDecision, c).toBe('deny');
    }
  });

  it('denies a gh call with env assignments in front', () => {
    expect(run('FOO=1 BAR=2 gh issue close 1', 'host').permissionDecision).toBe('deny');
  });

  it('ALLOWS the documented remedy — an explicit GH_TOKEN on that command', () => {
    const c = 'GH_TOKEN="$(~/.claude/scripts/gh-app-token.sh)" gh issue comment 1816 --body x';
    expect(run(c, 'host').permissionDecision).toBe('allow');
  });

  it('ALLOWS the two-step form this repo actually uses', () => {
    // `T="$(...)"; GH_TOKEN="$T" gh ...` — the token's value is not knowable from the
    // text, so the discriminant is that an identity was named at all, not where it came
    // from. The threat is the AMBIENT credential.
    const c = 'T="$(~/.claude/scripts/gh-app-token.sh)"; GH_TOKEN="$T" gh pr view 1';
    expect(run(c, 'host').permissionDecision).toBe('allow');
  });

  /**
   * Regression — the first version of this gate searched for `gh-app-token.sh` anywhere in
   * the whole command, so a bare MENTION of it allowed an ambient-credential write. Found
   * by the security reviewer on #2172. A substring is not a position: each simple command
   * is now judged on its own.
   */
  it('denies a mention of the token script that is not an assignment on that command', () => {
    for (const c of [
      'gh issue comment 1816 --body "see gh-app-token.sh"',
      'echo gh-app-token.sh; gh pr merge 1816',
      'echo gh-app-token.sh && gh issue create --title x',
      'cat gh-app-token.sh | gh pr comment 1 --body-file -',
    ]) {
      expect(run(c, 'host').permissionDecision, c).toBe('deny');
    }
  });

  it('denies `git -C <path> push` — a bare arg between git and push', () => {
    expect(run('git -C /tmp/x push origin main', 'host').permissionDecision).toBe('deny');
  });

  it('does not offer the GH_TOKEN remedy when denying git push', () => {
    // Minting GH_TOKEN does not re-route git: it authenticates through the credential
    // helper or SSH. Suggesting it would send the reader down a path that cannot work.
    const r = run('git push origin main', 'host');
    expect(r.permissionDecisionReason).toMatch(/credential helper|no in-command remedy/);
    expect(r.permissionDecisionReason).not.toMatch(/GH_TOKEN="\$\(/);
  });

  it('leaves non-GitHub commands alone', () => {
    for (const c of ['ls -la', 'npx vitest run', 'git status --short', 'git commit -m x']) {
      expect(run(c, 'host').permissionDecision, c).toBe('allow');
    }
  });

  it('does not fire on words merely CONTAINING gh', () => {
    for (const c of ['curl https://github.com/x', 'echo lighthouse', 'grep -r ghost .', './regh --help']) {
      expect(run(c, 'host').permissionDecision, c).toBe('allow');
    }
  });
});

describe('#1816 — an unestablished location fails CLOSED (constitution invariant 2)', () => {
  it('denies when the detector is missing entirely', () => {
    const r = run('gh issue create --title x', 'missing');
    expect(r.permissionDecision).toBe('deny');
    expect(r.permissionDecisionReason).toMatch(/could not be established|not installed/);
  });

  it('denies when the detector is present but not executable', () => {
    expect(run('gh issue create --title x', 'not-executable').permissionDecision).toBe('deny');
  });

  it('denies when the detector exits with an unexpected code', () => {
    const r = run('gh issue create --title x', 'weird-exit');
    expect(r.permissionDecision).toBe('deny');
    expect(r.permissionDecisionReason).toMatch(/exit 7/);
  });

  // 15s budget: the hook's own detector timeout is 5s, so this test MUST outlast it.
  // vitest's 5s default is shorter than the operation under test, which reads as a hang
  // rather than as the refusal it is measuring.
  it('denies when the detector hangs — a timeout is not a pass', () => {
    const r = run('gh issue create --title x', 'hang');
    expect(r.permissionDecision).toBe('deny');
    expect(r.permissionDecisionReason).toMatch(/timed out/);
  }, 15_000);

  it('still allows a non-GitHub command when the location is unknown', () => {
    // Fail-closed applies to the WRITE, not to every command: denying all Bash would make
    // a host session unusable for the diagnosis that tells the human to relaunch it.
    expect(run('ls -la', 'missing').permissionDecision).toBe('allow');
  });
});

describe('#1816 — envelope handling', () => {
  it('ignores tools other than Bash', () => {
    expect(run('gh issue create --title x', 'host', 'Edit').permissionDecision).toBe('allow');
  });

  it('does not wedge every call when the envelope is unreadable', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hwg-home-'));
    try {
      const out = execFileSync('python3', [HOOK], {
        input: 'not json at all',
        env: { ...process.env, HOME: home },
        encoding: 'utf8',
      });
      expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe('allow');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
