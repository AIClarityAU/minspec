/**
 * T0 — the WIRING between the approval flow and SPEC-050's PR seam (Slice 2).
 *
 * `approval-pr.test.ts` proves the seam builds the right argv and classifies every
 * failure; this file proves the CALLER actually reaches it, with the right facts,
 * and — critically — that it does NOT reach it without consent. That exact gap (a
 * well-tested seam with an untested caller) is what shipped a dead code path in
 * PR #975, which is why the repo keeps seam tests and wiring tests apart
 * (`approve-push.test.ts` / `approve-push-wiring.test.ts` is the precedent).
 *
 * Acceptance criteria covered here (AC-10 is Slice 1's, in `approval-pr.test.ts`):
 *   AC-1  `auto` opens a PR; `manual` opens none and reproduces the OLD surface
 *         byte-for-byte.
 *   AC-2  the PR carries `docs-lane` and the approval commit's subject as its
 *         title; a fixture with a non-corpus path is NEVER labelled.
 *   AC-3  the happy path shows no notification with a COMPLETING action —
 *         asserted structurally (arity, then a click-simulation that changes
 *         nothing), so a future edit cannot reintroduce a required click.
 *   AC-4  `gh-absent` / `gh-unauthenticated` / `offline` / `failed` each degrade
 *         to the manual surface with a reason, and none throws.
 *   AC-5  an already-open PR is adopted, never duplicated.
 *   AC-6  `outcome: 'pushed'` opens nothing.
 *   AC-7  `pushOnApprove: never`, and `prompt` declined, record ZERO git/gh calls.
 *   AC-8  no `checkout`/`switch`/`merge`/`rebase`/`reset` in ANY recorded argv —
 *         aggregated in an `afterEach` so it holds for tests added later too.
 *   AC-9  nothing under `.minspec/approvals/**` is written and no `status:` line
 *         is touched — asserted against a REAL temp repo, byte-for-byte.
 *   FR-8  the one-time "Always push from now on" offer: shown once, writes
 *         Global (never Workspace), then still pushes.
 *
 * The `gh`/`git` runner is ALWAYS a stub. `defaultExecRun` is mocked to hand back
 * the test's recorder and to THROW if a test forgot to install one, so a wiring
 * bug can never quietly spawn a real subprocess against a temp directory.
 *
 * FILE ALLOWLIST (SPEC-050 Slice 2): src/commands/commit-on-approve.ts,
 * src/lib/approval-pr.ts, package.json, tests/approval-pr*.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

// ─── Hoisted mutable state the mock factories read ───────────────────────────
// `vi.mock` factories are hoisted above the imports, so anything they close over
// must come from `vi.hoisted` rather than a plain `const` below.

interface RecordedCall {
  file: string;
  args: string[];
  cwd?: string;
  key: string;
}

const H = vi.hoisted(() => ({
  /** `minspec.*` settings this run sees. Absent key → the caller's default. */
  config: {} as Record<string, unknown>,
  /** What every `showInformationMessage` resolves to. */
  choice: undefined as string | undefined,
  /** Installed by `installRunner`; `defaultExecRun()` hands this back. */
  runner: undefined as
    | undefined
    | ((
        file: string,
        args: readonly string[],
        opts?: { cwd?: string },
      ) => Promise<{ stdout: string; stderr: string }>),
  info: [] as { message: string; actions: string[] }[],
  warn: [] as { message: string; actions: string[] }[],
  opened: [] as string[],
  updates: [] as { key: string; value: unknown; target: unknown }[],
  /** FR-8 F6: make the settings write reject, to prove it is swallowed. */
  updateRejects: false,
  /** INV-5 (#1224): make the vscode API throw synchronously, to prove nothing escapes. */
  vscodeThrows: false,
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, def?: unknown) => {
        if (H.vscodeThrows) throw new Error('vscode host is unavailable');
        return key in H.config ? H.config[key] : def;
      },
      update: async (key: string, value: unknown, target: unknown) => {
        if (H.updateRejects) throw new Error('settings are read-only in this test');
        H.updates.push({ key, value, target });
      },
    }),
  },
  window: {
    showInformationMessage: async (message: string, ...actions: string[]) => {
      H.info.push({ message, actions });
      return H.choice;
    },
    showWarningMessage: async (message: string, ...actions: string[]) => {
      H.warn.push({ message, actions });
      return undefined;
    },
  },
  env: {
    openExternal: async (u: unknown) => {
      H.opened.push(String(u));
      return true;
    },
  },
  Uri: { parse: (s: string) => s },
  commands: { executeCommand: async () => undefined },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
}));

/**
 * Replace ONLY the process spawner in the seam; everything else — `openPullRequest`,
 * `laneLabelsFor`, `buildApprovalPrBody`, `resolveHeadSha` — stays REAL, so these
 * tests exercise the production code path and not a second implementation of it.
 */
vi.mock('../src/lib/approval-pr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/approval-pr')>();
  return {
    ...actual,
    defaultExecRun: () => {
      if (!H.runner) {
        throw new Error('TEST BUG: defaultExecRun() reached with no stub runner installed');
      }
      return H.runner;
    },
  };
});

const pushApprovalMock = vi.fn();
vi.mock('../src/lib/approve-push', () => ({
  pushApproval: (...args: unknown[]) => pushApprovalMock(...args),
}));

const commitApprovalMock = vi.fn();
vi.mock('../src/lib/approve-commit', () => ({
  commitApproval: (...args: unknown[]) => commitApprovalMock(...args),
  isUntrackedAtHead: async () => false,
}));

import {
  approvalPrMode,
  commitApprovalIfEnabled,
  pushApprovalIfEnabled,
} from '../src/commands/commit-on-approve';
import { loadPreferences, savePreferences } from '../src/lib/auto-bootstrap';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BRANCH = 'approvals/spec-050-abc1234';
const COMPARE_URL = `https://github.com/o/r/compare/approvals%2Fspec-050-abc1234?expand=1`;
const PUSHED_BRANCH = { outcome: 'pushed-branch', branch: BRANCH, compareUrl: COMPARE_URL };
const SUBJECT = 'chore(approve): SPEC-050 approved for implementation';
const SPEC_REL = 'specs/minspec/SPEC-050-silent-approval-pr/requirements.md';
const SIDECAR_REL = `.minspec/approvals/${SPEC_REL}.json`;
const DOCS_PATHS = [SPEC_REL, SIDECAR_REL];
const HEAD_SHA = 'abc1234def5678901234567890abcdef12345678';
const NEW_PR_URL = 'https://github.com/o/r/pull/7';
const EXISTING_PR_URL = 'https://github.com/o/r/pull/42';

/** The exact suffix the pre-SPEC-050 build produced — `manual` must reproduce it. */
const LEGACY_SUFFIX = ` · pushed on ${BRANCH} (open a PR)`;

const RECORD = {
  specPath: SPEC_REL,
  specHash: 'sha256:deadbeef',
  approvedAt: '2026-08-05T00:00:00.000Z',
  approvedBy: 'founder@example.test',
  tier: 'T2',
  migrated: false,
  baselineBlob: '',
};

type Resp = string | Error | (() => never);

const DEFAULT_RESPONSES: Record<string, Resp> = {
  'git rev-parse HEAD': `${HEAD_SHA}\n`,
  // INV-2 evidence (#1224 review): the label is decided from what the PR ACTUALLY
  // changes — `git diff --name-only -z origin/HEAD...<branch>` — not from the
  // approval commit's paths. The default answer is the two docs-corpus paths, so
  // the happy path labels docs-lane. Tests that need a non-docs or unresolvable
  // range override this key.
  'git diff --name-only -z': `${DOCS_PATHS.join('\0')}\0`,
  'gh pr create': `${NEW_PR_URL}\n`,
  // Unmapped `gh pr list` falls through to the empty-stdout default below, which
  // `findOpenPrForHead` reads as "no open PR" — the create path then runs.
};

let calls: RecordedCall[] = [];
let allCalls: RecordedCall[] = [];
let tmp: string;

function installRunner(map: Record<string, Resp> = {}): void {
  const table = { ...DEFAULT_RESPONSES, ...map };
  H.runner = async (file, args, opts) => {
    const key = `${file} ${args.join(' ')}`;
    const call: RecordedCall = { file, args: [...args], cwd: opts?.cwd, key };
    calls.push(call);
    allCalls.push(call);
    let val: Resp | undefined = table[key];
    if (val === undefined) val = Object.entries(table).find(([k]) => key.startsWith(k))?.[1];
    if (val === undefined) return { stdout: '', stderr: '' };
    if (val instanceof Error) throw val;
    if (typeof val === 'function') return val();
    return { stdout: val, stderr: '' };
  };
}

function enoent(): Error {
  return Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
}
const authErr = (): Error =>
  Object.assign(new Error('exit 1'), {
    stderr: 'You are not logged into any GitHub hosts. Run gh auth login to authenticate.',
  });
const netErr = (): Error =>
  Object.assign(new Error('exit 1'), { stderr: 'fatal: could not resolve host: github.com' });
const plainErr = (): Error =>
  Object.assign(new Error('exit 1'), { stderr: 'pull request create failed: validation failed' });

const ghCalls = (): RecordedCall[] => calls.filter((c) => c.file === 'gh');
const prCreateCalls = (): RecordedCall[] =>
  calls.filter((c) => c.file === 'gh' && c.args[0] === 'pr' && c.args[1] === 'create');
const prListCalls = (): RecordedCall[] =>
  calls.filter((c) => c.file === 'gh' && c.args[0] === 'pr' && c.args[1] === 'list');

/** Value of a flag in a recorded argv (`--title` → the string after it). */
function flag(call: RecordedCall, name: string): string | undefined {
  const i = call.args.indexOf(name);
  return i >= 0 ? call.args[i + 1] : undefined;
}

/** AC-8 / INV-3 — asserted on the RECORDED argv, never by reading the source. */
const CHECKOUT_MOVING_VERBS = ['checkout', 'switch', 'merge', 'rebase', 'reset'];
function expectCheckoutNeverMoved(recorded: RecordedCall[]): void {
  const moved = recorded.filter(
    (c) => c.file === 'git' && CHECKOUT_MOVING_VERBS.some((v) => c.args.includes(v)),
  );
  expect(moved.map((c) => c.key)).toEqual([]);
}

/** Let the fire-and-forget `void showInformationMessage(...).then(...)` settle. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Recursive `path → bytes` snapshot of a whole tree (AC-9). */
function snapshot(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) snapshot(abs, base, out);
    else out[path.relative(base, abs).split(path.sep).join('/')] = fs.readFileSync(abs, 'base64');
  }
  return out;
}

function seedApprovedSpec(root: string): void {
  const doc = path.join(root, ...SPEC_REL.split('/'));
  fs.mkdirSync(path.dirname(doc), { recursive: true });
  fs.writeFileSync(doc, `---\nid: SPEC-050\nstatus: approved\ntier: T2\n---\n\n# SPEC-050\n`, 'utf-8');
  const sidecar = path.join(root, ...SIDECAR_REL.split('/'));
  fs.mkdirSync(path.dirname(sidecar), { recursive: true });
  fs.writeFileSync(sidecar, JSON.stringify(RECORD, null, 2) + '\n', 'utf-8');
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-approval-pr-'));
  H.config = {};
  H.choice = undefined;
  H.runner = undefined;
  H.info.length = 0;
  H.warn.length = 0;
  H.opened.length = 0;
  H.updates.length = 0;
  H.updateRejects = false;
  calls = [];
  pushApprovalMock.mockReset();
  pushApprovalMock.mockResolvedValue(PUSHED_BRANCH);
  commitApprovalMock.mockReset();
  commitApprovalMock.mockResolvedValue({ outcome: 'committed', paths: DOCS_PATHS });
});

afterEach(() => {
  // Aggregate guard (AC-8): holds across every scenario in this file, including
  // ones added later that forget to assert it themselves.
  expectCheckoutNeverMoved(allCalls);
  allCalls = [];
  fs.rmSync(tmp, { recursive: true, force: true });
});

// =============================================================================
// FR-1 — the setting itself
// =============================================================================

describe('approvalPrMode: setting parsing (FR-1)', () => {
  it('defaults to auto — the shipped default finishes the job', () => {
    expect(approvalPrMode()).toBe('auto');
  });

  it('accepts manual', () => {
    H.config = { approvalPr: 'manual' };
    expect(approvalPrMode()).toBe('manual');
  });

  it('falls back to auto on an unrecognised value', () => {
    // Safe to fail to the ACTIVE value here, unlike pushOnApprove: this setting
    // only chooses who opens a PR for a branch that a consented push already put
    // on the remote, so a typo can never cause an unconsented network act.
    H.config = { approvalPr: 'yolo' };
    expect(approvalPrMode()).toBe('auto');
  });
});

// =============================================================================
// AC-1 / AC-2 — auto opens the labelled PR; manual opens none
// =============================================================================

describe('pushed-branch → approval PR (AC-1, AC-2)', () => {
  beforeEach(() => {
    H.config = { pushOnApprove: 'always', approvalPr: 'auto' };
    installRunner();
  });

  it('auto opens exactly ONE PR, labelled docs-lane, titled with the commit subject', async () => {
    const { suffix, pr } = await pushApprovalIfEnabled(tmp, 'spec-050', {
      subject: SUBJECT,
      paths: DOCS_PATHS,
    });

    expect(prCreateCalls()).toHaveLength(1);
    const create = prCreateCalls()[0];
    expect(flag(create, '--head')).toBe(BRANCH);
    expect(flag(create, '--title')).toBe(SUBJECT);
    expect(create.args).toEqual(expect.arrayContaining(['--label', 'docs-lane']));
    expect(create.cwd).toBe(tmp);

    expect(pr).toEqual({ outcome: 'created', url: NEW_PR_URL });
    expect(suffix).toContain(BRANCH);
    expect(suffix).toContain(NEW_PR_URL);
    expect(suffix).toContain('PR opened');
  });

  it('the body carries artifact + tier + approver + specHash + commit SHA (FR-2 / OQ-2)', async () => {
    seedApprovedSpec(tmp);
    await pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS });

    const body = flag(prCreateCalls()[0], '--body') ?? '';
    // Anti-vacuity: these values exist ONLY in the seeded sidecar, so their
    // presence proves `readRecord` really ran against the real store.
    expect(body).toContain(SPEC_REL);
    expect(body).toContain('T2');
    expect(body).toContain('founder@example.test');
    expect(body).toContain('sha256:deadbeef');
    expect(body).toContain(HEAD_SHA);
    expect(body).not.toContain('undefined');
  });

  it('omits the provenance lines when there is no sidecar, rather than inventing them', async () => {
    // The ADR/epic accept paths write no sidecar. Degrade, never fabricate.
    await pushApprovalIfEnabled(tmp, 'dr-071', {
      subject: 'chore(accept): DR-071 -> accepted',
      paths: ['docs/decisions/DR-071.md', 'docs/decisions/INDEX.md'],
    });
    const body = flag(prCreateCalls()[0], '--body') ?? '';
    expect(body).toContain('docs/decisions/DR-071.md');
    expect(body).not.toContain('Approved by');
    expect(body).not.toContain('specHash');
    expect(body).not.toContain('undefined');
  });

  it('manual runs NO gh at all and reproduces the pre-SPEC-050 surface byte-for-byte', async () => {
    H.config = { pushOnApprove: 'always', approvalPr: 'manual' };
    H.choice = 'Open PR';

    const { suffix } = await pushApprovalIfEnabled(tmp, 'spec-050', {
      subject: SUBJECT,
      paths: DOCS_PATHS,
    });
    await flush();

    expect(ghCalls()).toHaveLength(0);
    expect(suffix).toBe(LEGACY_SUFFIX);
    expect(H.info).toHaveLength(1);
    expect(H.info[0].message).toBe(
      `Approval pushed on '${BRANCH}' (this branch is protected, so it needs a PR).`,
    );
    expect(H.info[0].actions).toEqual(['Open PR']);
    expect(H.opened).toEqual([COMPARE_URL]);
  });

  it('NEVER labels a branch whose paths are not all docs (AC-2 negative, INV-2)', async () => {
    // The non-docs path arrives through the BRANCH DIFF, which is what the label is
    // now decided from (#1224 review). Expressing it via ctx.paths would no longer
    // prove anything: the code stopped reading that set for this decision.
    installRunner({
      'git diff --name-only -z': `${SPEC_REL}\0packages/minspec/src/commands/commit-on-approve.ts\0`,
    });
    const { suffix } = await pushApprovalIfEnabled(tmp, 'spec-050', {
      subject: SUBJECT,
      paths: [SPEC_REL, 'packages/minspec/src/commands/commit-on-approve.ts'],
    });

    expect(prCreateCalls()).toHaveLength(1);
    const argv = prCreateCalls()[0].args;
    expect(argv).not.toContain('--label');
    expect(argv).not.toContain('docs-lane');
    // And it SAYS so, in BOTH artifacts a human reads — a withheld label must
    // never be a silent surprise, and the body must describe the PR that exists
    // rather than the one MinSpec would have preferred to open.
    expect(suffix).toContain('no docs-lane label');
    expect(flag(prCreateCalls()[0], '--body')).toContain('NOT labelled for the docs-lane');
  });

  it('INV-2 (#1224): a docs-only COMMIT on a branch that also changed code is NOT labelled', async () => {
    // The defect this closes. The approval commit touches only docs, so the old
    // code (which labelled from ctx.paths) said docs-lane — while the branch, cut
    // at the developer's local HEAD, really changes source too. That is a non-docs
    // PR on an auto-merge lane.
    installRunner({
      'git diff --name-only -z': `${SPEC_REL}\0packages/minspec/src/lib/spec.ts\0`,
    });
    await pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS });
    expect(prCreateCalls()[0].args).not.toContain('docs-lane');
  });

  it('INV-2 (#1224): an UNRESOLVABLE diff range fails closed — no label, PR still opened', async () => {
    // git absent, no origin/HEAD, a detached base: the range cannot be measured, so
    // docs-only is unproven. Unproven must not read as proven (invariant #2). The
    // PR is still opened — the branch is already pushed, and withholding it would
    // strand the developer — it simply goes unlabelled and says so.
    installRunner({ 'git diff --name-only -z': new Error('fatal: bad revision') });
    const { suffix } = await pushApprovalIfEnabled(tmp, 'spec-050', {
      subject: SUBJECT,
      paths: DOCS_PATHS,
    });
    expect(prCreateCalls()).toHaveLength(1);
    expect(prCreateCalls()[0].args).not.toContain('docs-lane');
    expect(suffix).toContain('no docs-lane label');
  });

  it('INV-5 (#1224): a THROWING vscode host never rejects the approval — the guard covers the early returns', async () => {
    // The defect: openApprovalPr's try opened AFTER approvalPrMode() and three
    // manualPrSurface() calls, all of which touch the vscode API. A synchronous
    // throw from any of them escaped, propagated through two unguarded awaits, and
    // broke commitApprovalIfEnabled's documented never-rejects contract — surfacing
    // as a failed APPROVAL rather than a failed PR-opening.
    H.vscodeThrows = true;
    try {
      await expect(
        pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS }),
      ).resolves.toBeDefined();
    } finally {
      H.vscodeThrows = false;
    }
  });

  it('INV-2 (#1224): an EMPTY diff is unproven, not vacuously docs-only', async () => {
    // `[].every()` is true, so an empty path list would label docs-lane by accident.
    installRunner({ 'git diff --name-only -z': '' });
    await pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS });
    expect(prCreateCalls()[0].args).not.toContain('docs-lane');
  });

  it('fails CLOSED when the committed paths were not supplied (INV-2 unproven)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { suffix } = await pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT });
      expect(ghCalls()).toHaveLength(0);
      expect(suffix).toContain(BRANCH);
      expect(suffix).toContain('open a PR');
      // Visible, not silent (constitution invariant #2).
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('the two-argument legacy call site still works and opens no PR', async () => {
    // Eleven call sites pass no context. They must keep compiling AND keep
    // degrading to the old surface rather than spawning gh against a repo whose
    // docs-only property nobody proved.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { suffix } = await pushApprovalIfEnabled(tmp, 'spec-050');
      expect(ghCalls()).toHaveLength(0);
      expect(suffix).toContain(BRANCH);
      expect(suffix).toContain('PR');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// =============================================================================
// The auto path is REACHABLE from the real caller (the PR #975 dead-path class)
// =============================================================================

describe('commitApprovalIfEnabled threads the approval context through', () => {
  it('an end-to-end approve → commit → push → PR carries the REAL commit subject', async () => {
    H.config = { commitOnApprove: true, pushOnApprove: 'always', approvalPr: 'auto' };
    installRunner();
    seedApprovedSpec(tmp);

    const { suffix } = await commitApprovalIfEnabled(
      tmp,
      DOCS_PATHS.map((p) => path.join(tmp, ...p.split('/'))),
      SUBJECT,
    );

    // Without the ctx threading this is a dead path: the PR would never open, and
    // every unit test that calls pushApprovalIfEnabled directly would still pass.
    expect(prCreateCalls()).toHaveLength(1);
    expect(flag(prCreateCalls()[0], '--title')).toBe(SUBJECT);
    expect(prCreateCalls()[0].args).toEqual(expect.arrayContaining(['--label', 'docs-lane']));
    expect(suffix).toContain(' · committed');
    expect(suffix).toContain(NEW_PR_URL);
  });
});

// =============================================================================
// AC-3 — the happy path has NO completing action
// =============================================================================

describe('AC-3: the success notification can never require a click (FR-3)', () => {
  beforeEach(() => {
    H.config = { pushOnApprove: 'always', approvalPr: 'auto' };
    installRunner();
  });

  it('structural: every notification on the auto-success path has ZERO actions', async () => {
    await pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS });
    await flush();

    expect(H.info.length).toBeGreaterThan(0); // anti-vacuity: something WAS shown
    for (const n of H.info) expect(n.actions).toEqual([]);
    expect(H.warn).toEqual([]);
    expect(H.info.some((n) => n.message.includes(NEW_PR_URL))).toBe(true);
  });

  it('structural: simulating a click on an action that must not exist changes NOTHING', async () => {
    // If a future edit reintroduces a completing action, the two runs diverge —
    // either in what was recorded, in the suffix, or by opening a browser.
    H.choice = undefined;
    const a = await pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS });
    await flush();
    const aCalls = calls.map((c) => c.key);
    const aOpened = [...H.opened];

    calls = [];
    H.info.length = 0;
    H.opened.length = 0;
    H.choice = 'Open PR';
    const b = await pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS });
    await flush();

    expect(b.suffix).toBe(a.suffix);
    expect(calls.map((c) => c.key)).toEqual(aCalls);
    expect(H.opened).toEqual(aOpened);
    expect(H.opened).toEqual([]);
  });
});

// =============================================================================
// AC-4 — every failure degrades to the manual surface, and none throws
// =============================================================================

describe('AC-4: degrade paths (FR-5, INV-5)', () => {
  const cases: [string, Error, string][] = [
    ['gh-absent', enoent(), 'not installed'],
    ['gh-unauthenticated', authErr(), 'not signed in'],
    ['offline', netErr(), 'unreachable'],
    ['failed', plainErr(), 'failed'],
  ];

  it.each(cases)('%s degrades to the manual surface with a reason', async (outcome, err, hint) => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      H.config = { pushOnApprove: 'always', approvalPr: 'auto' };
      installRunner({ 'gh pr create': err });
      H.choice = 'Open PR';

      const { suffix, pr } = await pushApprovalIfEnabled(tmp, 'spec-050', {
        subject: SUBJECT,
        paths: DOCS_PATHS,
      });
      await flush();

      expect(pr?.outcome).toBe(outcome);
      // EXACTLY the manual surface: notification + 'Open PR' + the compare URL.
      expect(H.info).toHaveLength(1);
      expect(H.info[0].actions).toEqual(['Open PR']);
      expect(H.info[0].message).toContain(BRANCH);
      expect(H.info[0].message).toContain(hint);
      expect(H.opened).toEqual([COMPARE_URL]);
      // …plus the reason, in the suffix as well as the toast.
      expect(suffix).toContain(BRANCH);
      expect(suffix).toContain('open a PR');
      expect(suffix).toContain(hint);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('a runner that throws a non-Error still resolves — never rejects (INV-5)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      H.config = { pushOnApprove: 'always', approvalPr: 'auto' };
      installRunner({
        'gh pr create': (): never => {
          throw 'boom';
        },
      });
      await expect(
        pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS }),
      ).resolves.toMatchObject({ pr: { outcome: 'failed' } });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('a PR step that throws OUTSIDE the seam still lands on the manual surface (INV-5)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      H.config = { pushOnApprove: 'always', approvalPr: 'auto' };
      // No runner installed → the mocked `defaultExecRun` throws synchronously,
      // standing in for any failure between the push and the seam call.
      H.runner = undefined;
      const { suffix } = await pushApprovalIfEnabled(tmp, 'spec-050', {
        subject: SUBJECT,
        paths: DOCS_PATHS,
      });
      expect(suffix).toContain(BRANCH);
      expect(suffix).toContain('open a PR');
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('a push that never named a branch degrades rather than sending gh a bad --head', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      H.config = { pushOnApprove: 'always', approvalPr: 'auto' };
      installRunner();
      pushApprovalMock.mockResolvedValue({ outcome: 'pushed-branch', compareUrl: COMPARE_URL });
      const { suffix } = await pushApprovalIfEnabled(tmp, 'spec-050', {
        subject: SUBJECT,
        paths: DOCS_PATHS,
      });
      expect(ghCalls()).toHaveLength(0);
      expect(suffix).toContain('open a PR');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// =============================================================================
// AC-5 — idempotency
// =============================================================================

describe('AC-5: an already-open PR is adopted, never duplicated (FR-6)', () => {
  beforeEach(() => {
    H.config = { pushOnApprove: 'always', approvalPr: 'auto' };
  });

  it('adopts the open PR and creates none', async () => {
    installRunner({ 'gh pr list': JSON.stringify([{ url: EXISTING_PR_URL }]) });

    const { suffix, pr } = await pushApprovalIfEnabled(tmp, 'spec-050', {
      subject: SUBJECT,
      paths: DOCS_PATHS,
    });

    expect(prListCalls()).toHaveLength(1);
    expect(prCreateCalls()).toHaveLength(0);
    expect(pr).toEqual({ outcome: 'adopted', url: EXISTING_PR_URL });
    expect(suffix).toContain(EXISTING_PR_URL);
    expect(suffix).toContain('already open');
  });

  it('adopts when create loses the race and gh replies "already exists"', async () => {
    installRunner({
      'gh pr create': Object.assign(new Error('exit 1'), {
        stderr: `a pull request for branch "${BRANCH}" into branch "main" already exists: ${EXISTING_PR_URL}`,
      }),
    });

    const { pr } = await pushApprovalIfEnabled(tmp, 'spec-050', {
      subject: SUBJECT,
      paths: DOCS_PATHS,
    });
    expect(pr).toEqual({ outcome: 'adopted', url: EXISTING_PR_URL });
  });
});

// =============================================================================
// AC-6 — a plain `pushed` outcome opens nothing
// =============================================================================

describe('AC-6: outcome "pushed" creates no PR (FR-7)', () => {
  it('runs no gh at all and keeps the plain suffix', async () => {
    H.config = { pushOnApprove: 'always', approvalPr: 'auto' };
    installRunner();
    pushApprovalMock.mockResolvedValue({ outcome: 'pushed', branch: 'feat/x' });

    const { suffix, pr } = await pushApprovalIfEnabled(tmp, 'spec-050', {
      subject: SUBJECT,
      paths: DOCS_PATHS,
    });

    expect(calls).toHaveLength(0);
    expect(pr).toBeUndefined();
    expect(suffix).toBe(' · pushed');
  });
});

// =============================================================================
// AC-7 — consent: no git, no gh, no network without it (INV-1)
// =============================================================================

describe('AC-7: zero calls without consent (INV-1)', () => {
  beforeEach(() => {
    installRunner();
  });

  it('pushOnApprove: never records ZERO git/gh calls', async () => {
    H.config = { pushOnApprove: 'never', approvalPr: 'auto' };
    const { suffix } = await pushApprovalIfEnabled(tmp, 'spec-050', {
      subject: SUBJECT,
      paths: DOCS_PATHS,
    });
    expect(calls).toEqual([]);
    expect(pushApprovalMock).not.toHaveBeenCalled();
    expect(H.info).toEqual([]);
    expect(suffix).toBe('');
  });

  it.each([undefined, 'Not now'])(
    'prompt + declining (%s) records ZERO git/gh calls',
    async (choice) => {
      H.config = { pushOnApprove: 'prompt', approvalPr: 'auto' };
      H.choice = choice;
      const { suffix } = await pushApprovalIfEnabled(tmp, 'spec-050', {
        subject: SUBJECT,
        paths: DOCS_PATHS,
      });
      expect(calls).toEqual([]);
      expect(pushApprovalMock).not.toHaveBeenCalled();
      expect(suffix).toBe(' · not pushed');
    },
  );

  it('AC-8: nothing in the whole file ever moved a checkout', () => {
    // The afterEach asserts this for every test; this one names it so the
    // acceptance criterion is visible in the report, not only in a hook.
    expectCheckoutNeverMoved(allCalls);
  });
});

// =============================================================================
// AC-9 — INV-4: no approval state is written anywhere on this path
// =============================================================================

describe('AC-9: the PR path writes NOTHING (INV-4)', () => {
  it('leaves every byte under the repo — sidecars and status: lines included — untouched', async () => {
    H.config = { pushOnApprove: 'always', approvalPr: 'auto' };
    installRunner();
    seedApprovedSpec(tmp);

    const before = snapshot(tmp);
    expect(Object.keys(before)).toEqual(expect.arrayContaining([SPEC_REL, SIDECAR_REL]));

    const { pr } = await pushApprovalIfEnabled(tmp, 'spec-050', {
      subject: SUBJECT,
      paths: DOCS_PATHS,
    });
    expect(pr?.outcome).toBe('created'); // anti-vacuity: the path really ran

    const after = snapshot(tmp);
    expect(after).toEqual(before);

    // Named explicitly as well as by whole-tree equality, so a future reader sees
    // WHICH properties AC-9 is about.
    const sidecars = Object.keys(after).filter((p) => p.startsWith('.minspec/approvals/'));
    expect(sidecars).toEqual(Object.keys(before).filter((p) => p.startsWith('.minspec/approvals/')));
    for (const p of sidecars) expect(after[p]).toBe(before[p]);
    expect(fs.readFileSync(path.join(tmp, ...SPEC_REL.split('/')), 'utf-8')).toContain(
      'status: approved',
    );
  });
});

// =============================================================================
// FR-8 — the one-time standing-consent offer (DR-071)
// =============================================================================

describe('FR-8: "Always push from now on" (DR-071)', () => {
  beforeEach(() => {
    H.config = { pushOnApprove: 'prompt', approvalPr: 'manual' };
    installRunner();
  });

  it('offers Push / Always / Not now the FIRST time, with Push leading', async () => {
    H.choice = 'Not now';
    await pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS });

    expect(H.info).toHaveLength(1);
    expect(H.info[0].actions).toEqual(['Push', 'Always push from now on', 'Not now']);
  });

  it('writes pushOnApprove=always to GLOBAL settings and still pushes this approval', async () => {
    H.choice = 'Always push from now on';
    const { suffix } = await pushApprovalIfEnabled(tmp, 'spec-050', {
      subject: SUBJECT,
      paths: DOCS_PATHS,
    });

    expect(H.updates).toEqual([
      { key: 'pushOnApprove', value: 'always', target: vscode.ConfigurationTarget.Global },
    ]);
    // Falling through and pushing is load-bearing: returning here would drop the
    // very approval whose prompt the user just answered yes to.
    expect(pushApprovalMock).toHaveBeenCalledTimes(1);
    expect(suffix).toContain('pushed');
  });

  it('NEVER writes the Workspace target (DR-071 corollary: it is a personal decision)', async () => {
    H.choice = 'Always push from now on';
    await pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS });
    for (const u of H.updates) {
      expect(u.target).not.toBe(vscode.ConfigurationTarget.Workspace);
      expect(u.target).not.toBe(vscode.ConfigurationTarget.WorkspaceFolder);
    }
  });

  it.each(['Push', 'Not now', 'Always push from now on', undefined])(
    'records the offer after answering %s, and never re-nags',
    async (choice) => {
      H.choice = choice;
      await pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS });
      expect(loadPreferences(tmp).answeredSignatures?.pushAlwaysOffer).toBe('offered');

      H.info.length = 0;
      H.config = { pushOnApprove: 'prompt', approvalPr: 'manual' };
      await pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS });
      expect(H.info[0].actions).toEqual(['Push', 'Not now']);
    },
  );

  it('MERGES into answeredSignatures — a sibling step’s answer is not destroyed', async () => {
    savePreferences(tmp, { answeredSignatures: { skipRefreshPrompt: 'sig-1' } });
    H.choice = 'Not now';
    await pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS });

    expect(loadPreferences(tmp).answeredSignatures).toEqual({
      skipRefreshPrompt: 'sig-1',
      pushAlwaysOffer: 'offered',
    });
  });

  it('swallows a failed preference write AND a failed settings write — the approval still pushes', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // A FILE where the root should be: `savePreferences`' mkdir throws ENOTDIR.
      const unwritable = path.join(tmp, 'not-a-dir');
      fs.writeFileSync(unwritable, 'x', 'utf-8');
      H.updateRejects = true;
      H.choice = 'Always push from now on';

      const { suffix } = await pushApprovalIfEnabled(unwritable, 'spec-050', {
        subject: SUBJECT,
        paths: DOCS_PATHS,
      });

      expect(pushApprovalMock).toHaveBeenCalledTimes(1);
      expect(suffix).toContain('pushed');
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it.each(['never', 'always'])('%s never reaches the offer and writes no preferences', async (mode) => {
    H.config = { pushOnApprove: mode, approvalPr: 'manual' };
    await pushApprovalIfEnabled(tmp, 'spec-050', { subject: SUBJECT, paths: DOCS_PATHS });

    expect(H.info.every((n) => !n.actions.includes('Always push from now on'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.minspec', 'preferences.json'))).toBe(false);
  });
});
