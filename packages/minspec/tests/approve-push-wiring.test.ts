/**
 * T0 — the WIRING between the approve flow and the push seam.
 *
 * approve-push.test.ts proves the seam decides correctly; this proves the caller
 * actually reaches it, and — critically — that it does NOT reach it without consent.
 * That gap (a well-tested seam with an untested caller) is exactly what shipped a
 * dead code path in PR #975, so it gets its own coverage here.
 *
 * The consent rule under test is constitution invariant #1: no network call without
 * explicit user consent. Dismissing the prompt must send nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let CONFIG: Record<string, unknown> = {};
let NOTIF_CHOICE: string | undefined;
const shownMessages: string[] = [];
const openedUrls: string[] = [];

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, def?: unknown) => (key in CONFIG ? CONFIG[key] : def),
    }),
  },
  window: {
    showInformationMessage: vi.fn(async (msg: string) => {
      shownMessages.push(msg);
      return NOTIF_CHOICE;
    }),
  },
  env: { openExternal: vi.fn(async (u: string) => openedUrls.push(String(u))) },
  Uri: { parse: (s: string) => s },
}));

const pushApprovalMock = vi.fn();
vi.mock('../src/lib/approve-push', () => ({
  pushApproval: (...args: unknown[]) => pushApprovalMock(...args),
}));

import { pushApprovalIfEnabled, pushOnApproveMode } from '../src/commands/commit-on-approve';

beforeEach(() => {
  CONFIG = {};
  NOTIF_CHOICE = undefined;
  shownMessages.length = 0;
  openedUrls.length = 0;
  pushApprovalMock.mockReset();
  pushApprovalMock.mockResolvedValue({ outcome: 'pushed', branch: 'feat/x' });
});

describe('pushOnApproveMode: setting parsing', () => {
  it('defaults to prompt — the shipped default never pushes unasked', () => {
    expect(pushOnApproveMode()).toBe('prompt');
  });

  it.each(['never', 'always', 'prompt'])('accepts %s', (mode) => {
    CONFIG = { pushOnApprove: mode };
    expect(pushOnApproveMode()).toBe(mode);
  });

  it('falls back to prompt on an unrecognised value rather than pushing', () => {
    CONFIG = { pushOnApprove: 'yolo' };
    expect(pushOnApproveMode()).toBe('prompt');
  });
});

describe('pushApprovalIfEnabled: consent (constitution invariant #1)', () => {
  it('never mode makes NO git call at all', async () => {
    CONFIG = { pushOnApprove: 'never' };
    const { suffix } = await pushApprovalIfEnabled('/repo', 'spec-042');
    expect(pushApprovalMock).not.toHaveBeenCalled();
    expect(shownMessages).toHaveLength(0);
    expect(suffix).toBe('');
  });

  it('prompt mode does NOT push when the user dismisses', async () => {
    // The whole point of the default: dismissing must send nothing.
    CONFIG = { pushOnApprove: 'prompt' };
    NOTIF_CHOICE = undefined;
    const { suffix } = await pushApprovalIfEnabled('/repo', 'spec-042');
    expect(pushApprovalMock).not.toHaveBeenCalled();
    expect(suffix).toBe(' · not pushed');
  });

  it('prompt mode does NOT push when the user picks "Not now"', async () => {
    CONFIG = { pushOnApprove: 'prompt' };
    NOTIF_CHOICE = 'Not now';
    await pushApprovalIfEnabled('/repo', 'spec-042');
    expect(pushApprovalMock).not.toHaveBeenCalled();
  });

  it('prompt mode pushes once the user clicks Push — the click IS the consent', async () => {
    CONFIG = { pushOnApprove: 'prompt' };
    NOTIF_CHOICE = 'Push';
    const { suffix } = await pushApprovalIfEnabled('/repo', 'spec-042');
    expect(pushApprovalMock).toHaveBeenCalledTimes(1);
    expect(suffix).toBe(' · pushed');
  });

  it('always mode pushes with no prompt — the setting is the consent', async () => {
    CONFIG = { pushOnApprove: 'always' };
    await pushApprovalIfEnabled('/repo', 'spec-042');
    expect(pushApprovalMock).toHaveBeenCalledTimes(1);
    expect(shownMessages).toHaveLength(0);
  });

  it('passes the configured protected branches through to the seam', async () => {
    CONFIG = { pushOnApprove: 'always', protectedBranches: ['trunk'] };
    await pushApprovalIfEnabled('/repo', 'spec-042');
    expect(pushApprovalMock.mock.calls[0][1]).toMatchObject({ protectedBranches: ['trunk'] });
  });

  it('defaults protected branches to main/master/trunk when unset', async () => {
    // `trunk` joined the default in #1054: the generated pre-commit hook already
    // carried it while the extension side stopped at main/master, so a repo whose
    // default branch is `trunk` was blocked at commit time but got no warning from
    // the commit offer and a rejected direct push from approve. protected-branches-
    // alignment.test.ts pins all three guards to this one list.
    CONFIG = { pushOnApprove: 'always' };
    await pushApprovalIfEnabled('/repo', 'spec-042');
    expect(pushApprovalMock.mock.calls[0][1]).toMatchObject({
      protectedBranches: ['main', 'master', 'trunk'],
    });
  });
});

describe('pushApprovalIfEnabled: outcomes are reported honestly', () => {
  beforeEach(() => {
    CONFIG = { pushOnApprove: 'always' };
  });

  it('a protected-branch push names the branch and points at the PR', async () => {
    pushApprovalMock.mockResolvedValue({
      outcome: 'pushed-branch',
      branch: 'approvals/spec-042-x',
      compareUrl: 'https://github.com/o/r/compare/approvals%2Fspec-042-x?expand=1',
    });
    const { suffix } = await pushApprovalIfEnabled('/repo', 'spec-042');
    expect(suffix).toContain('approvals/spec-042-x');
    expect(suffix).toContain('PR');
  });

  it('a FAILED push is surfaced, never reported as pushed', async () => {
    // The record is still local-only; hiding that would be the false signpost this
    // project treats as its worst defect.
    pushApprovalMock.mockResolvedValue({ outcome: 'failed', error: 'remote rejected' });
    const { suffix } = await pushApprovalIfEnabled('/repo', 'spec-042');
    expect(suffix).toContain('failed');
    expect(suffix).toContain('local only');
    expect(suffix).not.toContain(' · pushed');
  });

  it('stays silent when there was nothing to push', async () => {
    pushApprovalMock.mockResolvedValue({ outcome: 'not-a-repo' });
    expect((await pushApprovalIfEnabled('/repo', 's')).suffix).toBe('');
    pushApprovalMock.mockResolvedValue({ outcome: 'skipped' });
    expect((await pushApprovalIfEnabled('/repo', 's')).suffix).toBe('');
  });

  it('never throws, even if the seam rejects — the approval toast must survive', async () => {
    // The first version of this test was named "never throws" while asserting
    // `.rejects` — the name claimed an invariant its own body disproved, and the
    // wiring had no guard backing it. Now the guarantee is LOCAL (try/catch in
    // pushApprovalIfEnabled), so the name and the assertion finally agree.
    pushApprovalMock.mockRejectedValue(new Error('boom'));
    const { suffix } = await pushApprovalIfEnabled('/repo', 's');
    expect(suffix).toContain('failed');
    expect(suffix).toContain('local only');
  });
});
