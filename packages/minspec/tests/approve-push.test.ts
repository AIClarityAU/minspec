/**
 * T0/T1 — push-on-approve (the Alt+A stranding fix).
 *
 * The defect: commit-on-approve commits but never pushes; approvals are made on
 * `main`; `main` is protected, so a plain push is REJECTED. Records therefore
 * accumulate on one machine and get recovered by hand — three duplicate recovery PRs
 * were opened for the same two records on 2026-07-27.
 *
 * Asserted here:
 *   • the OFFLINE invariant — nothing runs a git command unless a push was chosen,
 *   • a protected branch never gets a doomed direct push, and is never rewritten,
 *   • a failed push is surfaced, never reported as success, and leaves no debris,
 *   • the PR URL is only produced when it can be derived with confidence.
 *
 * Every case drives an injected git stub — no network, no repo mutation.
 */
import { describe, it, expect } from 'vitest';
import {
  decidePushPlan,
  compareUrlFor,
  approvalBranchName,
  pushApproval,
  type GitRun,
} from '../src/lib/approve-push';

const PROTECTED = ['main', 'master'];

/** A git stub that records every invocation and answers from a script. */
function stubGit(answers: Record<string, string | (() => never)>, calls: string[][] = []): {
  run: GitRun;
  calls: string[][];
} {
  const run: GitRun = async (args) => {
    calls.push([...args]);
    const key = args.join(' ');
    // Plain prefix match: a refspec like `push -u origin approvals/x:approvals/x`
    // has no space after the branch prefix, so a `prefix + ' '` rule would miss it.
    for (const [prefix, val] of Object.entries(answers)) {
      if (key.startsWith(prefix)) {
        if (typeof val === 'function') val();
        return val as string;
      }
    }
    return '';
  };
  return { run, calls };
}

function gitFails(stderr: string): () => never {
  return () => {
    const e = new Error('git failed') as Error & { stderr: string };
    e.stderr = stderr;
    throw e;
  };
}

describe('decidePushPlan: pure routing', () => {
  it('pushes the current branch when it is not protected', () => {
    const plan = decidePushPlan({ branch: 'feat/x', protectedBranches: PROTECTED, newBranchName: 'approvals/a' });
    expect(plan.kind).toBe('push-current');
  });

  it('routes a PROTECTED branch to a new branch instead of a doomed direct push', () => {
    // The whole bug: `git push origin main` is rejected by branch protection, so the
    // approval never leaves the machine.
    for (const b of PROTECTED) {
      const plan = decidePushPlan({ branch: b, protectedBranches: PROTECTED, newBranchName: 'approvals/a' });
      expect(plan.kind, b).toBe('push-new-branch');
      expect(plan.newBranch, b).toBe('approvals/a');
      expect(plan.reason, b).toContain('protected');
    }
  });

  it('skips a detached HEAD rather than guessing a target', () => {
    expect(decidePushPlan({ branch: '', protectedBranches: PROTECTED, newBranchName: 'x' }).kind).toBe('skip');
    expect(decidePushPlan({ branch: '   ', protectedBranches: PROTECTED, newBranchName: 'x' }).kind).toBe('skip');
  });

  it('treats protection as configured data, not a guess', () => {
    // `main` is only protected because it is in the list; an empty list means the
    // caller told us nothing is protected.
    expect(decidePushPlan({ branch: 'main', protectedBranches: [], newBranchName: 'x' }).kind).toBe(
      'push-current',
    );
  });
});

describe('compareUrlFor: only a URL we can derive with confidence', () => {
  it.each([
    ['git@github.com:AIClarityAU/minspec.git', 'https://github.com/AIClarityAU/minspec/compare/b?expand=1'],
    ['git@github.com:AIClarityAU/minspec', 'https://github.com/AIClarityAU/minspec/compare/b?expand=1'],
    ['https://github.com/AIClarityAU/minspec.git', 'https://github.com/AIClarityAU/minspec/compare/b?expand=1'],
    ['https://x-token@github.com/AIClarityAU/minspec.git', 'https://github.com/AIClarityAU/minspec/compare/b?expand=1'],
    ['ssh://git@github.com/AIClarityAU/minspec.git', 'https://github.com/AIClarityAU/minspec/compare/b?expand=1'],
  ])('parses %s', (remote, expected) => {
    expect(compareUrlFor(remote, 'b')).toBe(expected);
  });

  it('returns undefined rather than a wrong URL', () => {
    // A user would FOLLOW a bad link, so guessing is worse than omitting.
    expect(compareUrlFor('', 'b')).toBeUndefined();
    expect(compareUrlFor('not a url', 'b')).toBeUndefined();
    expect(compareUrlFor('https://github.com/onlyowner', 'b')).toBeUndefined();
  });

  it('encodes a slash-bearing branch name', () => {
    expect(compareUrlFor('git@github.com:o/r.git', 'approvals/x-1')).toContain('approvals%2Fx-1');
  });
});

describe('approvalBranchName', () => {
  const NOW = new Date('2026-07-27T02:28:33.407Z');

  it('is deterministic and namespaced', () => {
    expect(approvalBranchName('SPEC-042 requirements', NOW)).toBe('approvals/spec-042-requirements-20260727T022833Z');
  });

  it('sanitises anything unsafe for a ref name', () => {
    const n = approvalBranchName('weird//..name~^:?*[', NOW);
    expect(n).toMatch(/^approvals\/[a-z0-9-]+-\d{8}T\d{6}Z$/);
  });

  it('never produces an empty slug', () => {
    expect(approvalBranchName('///', NOW)).toContain('approvals/record-');
  });
});

describe('pushApproval: protected-branch path (the stranding fix)', () => {
  const base = { 'rev-parse --is-inside-work-tree': 'true\n', 'rev-parse --abbrev-ref HEAD': 'main\n' };

  it('creates a branch at HEAD and pushes it — never pushes main, never switches branch', async () => {
    const { run, calls } = stubGit({
      ...base,
      'remote get-url origin': 'git@github.com:AIClarityAU/minspec.git\n',
    });
    const res = await pushApproval('/repo', { protectedBranches: PROTECTED, slug: 'spec-042', now: new Date('2026-07-27T02:28:33.407Z') }, run);

    expect(res.outcome).toBe('pushed-branch');
    expect(res.branch).toBe('approvals/spec-042-20260727T022833Z');
    expect(res.compareUrl).toContain('/compare/');

    const flat = calls.map((c) => c.join(' '));
    // Branch created AT HEAD — the checkout is never moved (rule #8: a shared
    // checkout must not be switched under another session).
    expect(flat).toContain('branch approvals/spec-042-20260727T022833Z HEAD');
    expect(flat.some((c) => c.startsWith('push -u origin approvals/'))).toBe(true);
    // The doomed push that caused the whole bug must never be attempted.
    expect(flat).not.toContain('push -u origin main');
    expect(flat.some((c) => c.startsWith('checkout') || c.startsWith('switch'))).toBe(false);
    expect(flat.some((c) => c.startsWith('reset'))).toBe(false);
  });

  it('surfaces a push failure and cleans up the half-made branch', async () => {
    const { run, calls } = stubGit({
      ...base,
      'push -u origin approvals/': gitFails('remote rejected'),
    });
    const res = await pushApproval('/repo', { protectedBranches: PROTECTED, slug: 's', now: new Date() }, run);

    expect(res.outcome).toBe('failed');
    expect(res.error).toContain('remote rejected');
    // No debris: a local branch left behind would linger in every branch listing.
    expect(calls.map((c) => c.join(' ')).some((c) => c.startsWith('branch -D approvals/'))).toBe(true);
  });

  it('still reports success when only the compare URL cannot be derived', async () => {
    const { run } = stubGit({ ...base, 'remote get-url origin': gitFails('no origin') });
    const res = await pushApproval('/repo', { protectedBranches: PROTECTED, slug: 's', now: new Date() }, run);
    // The push SUCCEEDED — degrading the toast is right; downgrading the outcome
    // would under-report a record that is safely on the remote.
    expect(res.outcome).toBe('pushed-branch');
    expect(res.compareUrl).toBeUndefined();
  });
});

describe('pushApproval: ordinary branch + failure honesty', () => {
  it('pushes a normal branch directly', async () => {
    const { run, calls } = stubGit({
      'rev-parse --is-inside-work-tree': 'true\n',
      'rev-parse --abbrev-ref HEAD': 'feat/x\n',
    });
    const res = await pushApproval('/repo', { protectedBranches: PROTECTED, slug: 's' }, run);
    expect(res.outcome).toBe('pushed');
    expect(calls.map((c) => c.join(' '))).toContain('push -u origin feat/x');
  });

  it('reports a failed push instead of claiming success', async () => {
    const { run } = stubGit({
      'rev-parse --is-inside-work-tree': 'true\n',
      'rev-parse --abbrev-ref HEAD': 'feat/x\n',
      'push': gitFails('network is unreachable'),
    });
    const res = await pushApproval('/repo', { protectedBranches: PROTECTED, slug: 's' }, run);
    expect(res.outcome).toBe('failed');
    expect(res.error).toContain('network is unreachable');
  });

  it('detects a detached HEAD and does nothing', async () => {
    const { run, calls } = stubGit({
      'rev-parse --is-inside-work-tree': 'true\n',
      'rev-parse --abbrev-ref HEAD': 'HEAD\n',
    });
    const res = await pushApproval('/repo', { protectedBranches: PROTECTED, slug: 's' }, run);
    expect(res.outcome).toBe('skipped');
    expect(calls.map((c) => c.join(' ')).some((c) => c.startsWith('push'))).toBe(false);
  });

  it('is a no-op outside a repo', async () => {
    const { run, calls } = stubGit({ 'rev-parse --is-inside-work-tree': 'false\n' });
    const res = await pushApproval('/repo', { protectedBranches: PROTECTED, slug: 's' }, run);
    expect(res.outcome).toBe('not-a-repo');
    expect(calls.map((c) => c.join(' ')).some((c) => c.startsWith('push'))).toBe(false);
  });

  it('never throws — a push failure must reach the caller as a result', async () => {
    const { run } = stubGit({ 'rev-parse --is-inside-work-tree': gitFails('boom') });
    await expect(pushApproval('/repo', { protectedBranches: PROTECTED, slug: 's' }, run)).resolves.toBeTruthy();
  });
});
