/**
 * T3 regression — the scaffolded gates fail CLOSED on their own internal errors, and the
 * CLAUDE.md template says so.
 *
 * WHY THIS EXISTS. `CLAUDE_MD_TEMPLATE`'s "Bypassing" section shipped the sentence "The
 * hooks fail open on their own internal errors, so a bug in the tooling never blocks a
 * legitimate commit." Measured against the hooks the same template renders, that is the
 * inverse of what happens: `set -u`, a propagated validator exit status, and no top-level
 * handler around `main()` mean a crash in the tooling REFUSES the commit. The prose told a
 * reader that an unexplained refusal could not be the gate's fault and that silence was the
 * only failure mode — and a fail-open gate is what constitution invariant 2 forbids, so the
 * sentence also described a product that would be in breach if it were true.
 *
 * WHY IT SURVIVED. Two producers of one fact with nothing reconciling them: the hook
 * templates and the prose that describes them. Every existing test read one or the other.
 *
 * WHAT THIS PINS, in both directions:
 *   - BEHAVIOUR: render the hooks, inject a bug into the validator, and assert the hook
 *     refuses — with a control run proving the injection is the only variable. If someone
 *     makes the gates fail open, this fails.
 *   - PROSE: the template must not re-assert fail-open. If someone reverts the wording,
 *     this fails.
 * A text assertion alone would go green on a gate that had stopped working; the behaviour
 * assertion alone would go green on prose that lied about it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

import { MANAGED_REGION_TEMPLATES, renderManagedFile, TEMPLATES } from '../src/lib/template-registry';
import { parseSections } from '../src/lib/merge-refresh';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const byPath = (p: string) => MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === p)!;
const PRE_COMMIT = '.minspec/hooks/pre-commit';
const VALIDATE_PY = '.minspec/hooks/validate.py';

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function write(rel: string, body: string, mode?: number): void {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  if (mode !== undefined) fs.chmodSync(p, mode);
}

/** Invoke the scaffolded hook exactly as git would: cwd = repo, index already staged. */
function runHook(): { code: number; err: string } {
  const r = spawnSync('bash', [path.join(repo, PRE_COMMIT)], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env },
  });
  return { code: r.status ?? -1, err: r.stderr ?? '' };
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-fail-direction-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
  write('README.md', 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  // A feature branch, so the protected-branch guard is not the thing under test.
  git('checkout', '-q', '-b', 'feature');
  write(PRE_COMMIT, renderManagedFile(byPath(PRE_COMMIT)), 0o755);
  write(VALIDATE_PY, renderManagedFile(byPath(VALIDATE_PY)), 0o755);
  // Something benign staged: no spec, no DR, no secret — nothing a gate should object to.
  write('README.md', 'seed\nan ordinary line\n');
  git('add', 'README.md');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('scaffolded gates fail closed on their own internal errors', () => {
  it('ALLOWS the benign staged change (control — the injection below is the only variable)', () => {
    const { code, err } = runHook();
    expect(err).not.toMatch(/Traceback/);
    expect(code).toBe(0);
  });

  it('REFUSES the same change once the validator itself raises', () => {
    const p = path.join(repo, VALIDATE_PY);
    const src = fs.readFileSync(p, 'utf-8');
    // Depends on the python3 tier being the one that fires: the temp repo sits in
    // os.tmpdir() with no node_modules ancestry, so `npx --no-install` cannot resolve the
    // Node validator and the hook falls through to python. If that ever changes, the
    // stderr assertion below fails loudly rather than passing for the wrong reason — the
    // failure mode is a false red, not a false green.
    const marker = 'def main():\n';
    expect(src).toContain(marker);
    fs.writeFileSync(
      p,
      src.replace(marker, `${marker}    raise RuntimeError("injected tooling bug")\n`),
    );

    const { code, err } = runHook();
    // Assert the injected bug is what fired, not some unrelated refusal — a mutant that
    // lands somewhere else would make this test pass for the wrong reason.
    expect(err).toMatch(/injected tooling bug/);
    // The point: a bug in the tooling refuses the commit. It does NOT wave it through.
    expect(code).not.toBe(0);
  });

  it('REFUSES when the shell gate hits an unset variable under `set -u`', () => {
    const p = path.join(repo, PRE_COMMIT);
    const src = fs.readFileSync(p, 'utf-8');
    // Injected immediately after `set -u`, so it aborts before any validator tier is
    // selected — this is the shell body's own failure, not a validator's.
    const anchor = 'set -u\n';
    expect(src).toContain(anchor);
    fs.writeFileSync(p, src.replace(anchor, `${anchor}echo "$minspec_injected_unset_variable"\n`));

    const { code, err } = runHook();
    expect(err).toMatch(/minspec_injected_unset_variable/);
    expect(code).not.toBe(0);
  });
});

describe('the CLAUDE.md template describes that direction truthfully', () => {
  const bypassing = (): string => {
    const section = parseSections(TEMPLATES['CLAUDE.md']).find(
      (s) => s.heading === 'Pre-Commit Checks',
    );
    expect(section, 'CLAUDE.md template must still carry a Pre-Commit Checks section').toBeTruthy();
    return section!.body;
  };

  it('never claims the hooks fail open on their own internal errors', () => {
    expect(bypassing()).not.toMatch(/fail open on their own internal errors/);
    expect(bypassing()).not.toMatch(/a bug in the tooling never blocks a/);
  });

  it('states the fail-closed direction the hooks actually implement', () => {
    expect(bypassing()).toMatch(/fail \*\*closed\*\* on their own internal errors/);
  });

  /**
   * The first draft of this fix replaced one false claim with another: it called the
   * commit-msg missing-message-file case "the one deliberate fail-open". The same hooks
   * carry at least two more — the branch guard stands aside when the default branch cannot
   * be determined, and gitleaks is skipped when absent — so the absolute was false and a
   * reviewer caught it. The distinction that IS true is by condition, not by count, and the
   * prose has to keep both halves or it collapses back into the original error.
   */
  it('keeps the fail-open direction too, and scopes it to a missing prerequisite', () => {
    const body = bypassing();
    expect(body).toMatch(/fail open/);
    expect(body).toMatch(/prerequisite/i);
    // No absolute: the count of deliberate fail-opens is not one, and claiming a count
    // is what made the first draft wrong.
    expect(body).not.toMatch(/[Tt]he one deliberate fail-open/);
  });
});
