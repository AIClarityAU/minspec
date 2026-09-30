/**
 * T3 #2243 — the approval flow lands the same way in EVERY adopter repository.
 *
 * THE REPORT. Approving SPEC-003/004/005 in voip-sms-inbox ended in an `Open PR`
 * toast, a hand-made pull request with an empty body, and a manual merge
 * (voip-sms-inbox #107, #108, #109: each authored by the founder with an empty body,
 * then merged by the founder 12-18 seconds later, before any required check had
 * finished). The same act in this repository lands with no human step: MinSpec opens
 * the PR with the `docs-lane` label and the lane arms auto-merge (e.g. #2088, merged by
 * github-actions about three minutes after it opened).
 *
 * THE DIFFERING INPUT is not configuration. It is a LABEL OBJECT on the forge. This
 * repository has a `docs-lane` label; voip-sms-inbox never had one. A sidecar-only
 * re-approval is docs-lane eligible, so `openApprovalPr` asks for the label, and `gh`
 * refuses to create ANY pull request when a named label does not exist in the target
 * repository. Verified against voip-sms-inbox on 2026-09-30 with gh 2.100.0 and
 * `--dry-run`: `could not add label: 'docs-lane' not found`, exit 1, while the same
 * command naming a label that repository does have printed the PR it would open.
 * `openPullRequest` classified that refusal as a terminal `failed`, so the flow fell
 * back to the manual `Open PR` surface, and the PR the founder then made by hand
 * carried no label, so the lane never saw it and it had to be merged by hand.
 *
 * WHY NO GATE CAUGHT IT. MinSpec scaffolds the docs-lane WORKFLOW into adopter
 * repositories (template-registry `docs-lane-workflow`), and that workflow runs only on
 * a PR that carries the label. Its ai-review sibling provisions the labels IT applies
 * at the start of every run (`.github/workflows/ai-review.yml`, "Self-heal ALL label
 * objects"); nothing provisioned `docs-lane`, and the workflow cannot do it for itself
 * because it never runs without the label. The existing wiring tests stub the OUTCOME
 * of `gh pr create` directly (success, or an auth, network, missing-binary or generic
 * failure), never the repository state that decides it, so a repository without the
 * label was never modelled.
 *
 * THIS FILE models the forge instead of stubbing the outcome: a fake GitHub that
 * behaves like the real one on the three calls that matter (`pr create` refuses an
 * unknown label, `label create` refuses a duplicate, `pr list` finds nothing), and
 * runs the SAME approval against a repository that has the label and one that does
 * not. Everything between the approval and the runner is production code.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Hoisted state the mock factories read ───────────────────────────────────

const H = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
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
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, def?: unknown) => (key in H.config ? H.config[key] : def),
      update: async () => undefined,
    }),
  },
  window: {
    showInformationMessage: async (message: string, ...actions: string[]) => {
      H.info.push({ message, actions });
      return undefined;
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
 * Replace ONLY the process spawner. `openPullRequest`, `laneLabelsFor`,
 * `branchChangedPaths`, `branchDiffEntries` and the body builder all stay real, so
 * this exercises the production path rather than a second implementation of it.
 */
vi.mock('../src/lib/approval-pr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/approval-pr')>();
  return {
    ...actual,
    defaultExecRun: () => {
      if (!H.runner) throw new Error('TEST BUG: defaultExecRun() reached with no fake forge installed');
      return H.runner;
    },
  };
});

const commitApprovalMock = vi.fn();
vi.mock('../src/lib/approve-commit', () => ({
  commitApproval: (...a: unknown[]) => commitApprovalMock(...a),
  isUntrackedAtHead: async () => false,
}));

const recoverMock = vi.fn();
vi.mock('../src/lib/approval-recover', () => ({
  recoverProtectedBranchApproval: (...a: unknown[]) => recoverMock(...a),
}));

const pushApprovalMock = vi.fn();
vi.mock('../src/lib/approve-push', () => ({
  pushApproval: (...a: unknown[]) => pushApprovalMock(...a),
}));

import {
  LANE_WORKFLOW_REL,
  commitApprovalIfEnabled,
  pushApprovalIfEnabled,
} from '../src/commands/commit-on-approve';
import { MANAGED_REGION_TEMPLATES } from '../src/lib/template-registry';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SPEC_REL = 'specs/SPEC-003-raw-capture-retention.md';
const SIDECAR_REL = `.minspec/approvals/${SPEC_REL}.json`;
const SUBJECT = 'chore(approve): SPEC-003 approved for implementation';
const BRANCH = 'approvals/specs-spec-003-raw-capture-retention-20260930T112316637Z';
const APPROVAL_SHA = 'abc1234def5678901234567890abcdef12345678';
const LANE_WORKFLOW = path.join('.github', 'workflows', 'docs-lane.yml');

// ─── A fake forge: GitHub's behaviour on the calls the approval flow makes ────

interface FakePr {
  head: string;
  labels: string[];
  body: string;
  url: string;
}

interface FakeRepo {
  /** Label OBJECTS that exist in the repository — the input under test. */
  labels: Set<string>;
  prs: FakePr[];
  labelCreates: string[][];
  calls: string[];
}

function repoWith(labels: readonly string[]): FakeRepo {
  return { labels: new Set(labels), prs: [], labelCreates: [], calls: [] };
}

/** Every value of a repeatable flag in an argv (`--label a --label b` → [a, b]). */
function flagValues(args: readonly string[], name: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a === name && i + 1 < args.length) out.push(args[i + 1]);
  });
  return out;
}

function ghError(stderr: string): Error {
  return Object.assign(new Error('Command failed: gh (exit 1)'), { stderr });
}

function installForge(repo: FakeRepo): void {
  H.runner = async (file, args) => {
    const argv = [...args];
    repo.calls.push(`${file} ${argv.join(' ')}`);
    if (file === 'git') {
      // What the approval branch really changes relative to its base: a sidecar-only
      // re-approval, the exact shape of voip-sms-inbox #107/#108/#109.
      if (argv[0] === 'diff' && argv[1] === '--name-only') return { stdout: `${SIDECAR_REL}\0`, stderr: '' };
      if (argv[0] === 'rev-parse') return { stdout: `${APPROVAL_SHA}\n`, stderr: '' };
      return { stdout: '', stderr: '' };
    }
    if (argv[0] === 'pr' && argv[1] === 'list') return { stdout: '[]\n', stderr: '' };
    if (argv[0] === 'pr' && argv[1] === 'create') {
      const labels = flagValues(argv, '--label');
      // gh resolves every label to an id BEFORE it creates the pull request, and
      // refuses outright when one is missing — nothing is created.
      const missing = labels.find((l) => !repo.labels.has(l));
      if (missing !== undefined) throw ghError(`could not add label: '${missing}' not found`);
      const url = `https://github.com/o/r/pull/${100 + repo.prs.length}`;
      repo.prs.push({ head: flagValues(argv, '--head')[0], labels, body: flagValues(argv, '--body')[0], url });
      return { stdout: `${url}\n`, stderr: '' };
    }
    if (argv[0] === 'label' && argv[1] === 'create') {
      const name = argv[2];
      if (repo.labels.has(name)) {
        throw ghError(`label with name "${name}" already exists; use \`--force\` to update its color and description`);
      }
      repo.labels.add(name);
      repo.labelCreates.push(argv);
      return { stdout: '', stderr: '' };
    }
    throw new Error(`TEST BUG: the fake forge does not model \`${file} ${argv.join(' ')}\``);
  };
}

// ─── The two ways an approval reaches the PR step ─────────────────────────────

type Path = 'protected-branch recovery' | 'feature-branch push';

/**
 * Run ONE approval through the production flow. `protected-branch recovery` is the
 * path voip-sms-inbox takes (the founder approves on `main`, so the commit is refused
 * and recovered onto a branch); `feature-branch push` is the committed arm. Both end
 * in `openApprovalPr`, and both must land the same way.
 */
async function approve(root: string, via: Path): Promise<string> {
  const absPaths = [path.join(root, SPEC_REL), path.join(root, SIDECAR_REL)];
  if (via === 'protected-branch recovery') {
    commitApprovalMock.mockResolvedValue({
      outcome: 'protected-branch',
      branch: { current: 'main', default: 'main' },
    });
    const r = await commitApprovalIfEnabled(root, absPaths, SUBJECT);
    return r.suffix;
  }
  const r = await pushApprovalIfEnabled(root, 'specs/SPEC-003-raw-capture-retention', {
    subject: SUBJECT,
    paths: [SPEC_REL, SIDECAR_REL],
  });
  return r.suffix;
}

/** An adopter checkout: `.minspec/`, the approved spec, and (optionally) the lane workflow. */
function makeRoot(withLaneWorkflow: boolean): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-lane-parity-'));
  fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(root, SPEC_REL), '---\nid: SPEC-003\nstatus: implementing\n---\n', 'utf-8');
  if (withLaneWorkflow) {
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(root, LANE_WORKFLOW), 'name: docs-lane\n', 'utf-8');
  }
  return root;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Did ANY notification hand the human the last step? */
function manualSurfacesShown(): string[] {
  return [...H.info, ...H.warn].filter((n) => n.actions.includes('Open PR')).map((n) => n.message);
}

let roots: string[] = [];

beforeEach(() => {
  H.config = { commitOnApprove: true, pushOnApprove: 'always' };
  H.runner = undefined;
  H.info.length = 0;
  H.warn.length = 0;
  H.opened.length = 0;
  commitApprovalMock.mockReset();
  recoverMock.mockReset().mockResolvedValue({
    outcome: 'recovered',
    branch: BRANCH,
    compareUrl: `https://github.com/o/r/compare/${encodeURIComponent(BRANCH)}?expand=1`,
    paths: [SPEC_REL, SIDECAR_REL],
    sha: APPROVAL_SHA,
  });
  pushApprovalMock.mockReset().mockResolvedValue({
    outcome: 'pushed-branch',
    branch: BRANCH,
    compareUrl: `https://github.com/o/r/compare/${encodeURIComponent(BRANCH)}?expand=1`,
  });
});

afterEach(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  roots = [];
});

function root(withLaneWorkflow = true): string {
  const r = makeRoot(withLaneWorkflow);
  roots.push(r);
  return r;
}

// =============================================================================

describe('the lane-workflow gate (#2243)', () => {
  it('checks the exact path MinSpec scaffolds the docs-lane workflow to', () => {
    // If these drift apart, the label silently stops being provisioned in scaffolded
    // repositories: the gate would look for a file the scaffolder never writes.
    const tpl = MANAGED_REGION_TEMPLATES.find((t) => t.name === 'docs-lane-workflow');
    expect(tpl, 'the docs-lane workflow is no longer a scaffolded template').toBeDefined();
    expect(tpl?.outputPath).toBe(LANE_WORKFLOW_REL);
    // …and this suite's fixtures use that same path, independently spelled.
    expect(LANE_WORKFLOW.split(path.sep).join('/')).toBe(LANE_WORKFLOW_REL);
  });
});

describe.each<Path>(['protected-branch recovery', 'feature-branch push'])(
  'approval parity across adopter repos — via %s (#2243)',
  (via) => {
    it('a repo WITHOUT the docs-lane label gets the same landed PR as one that has it', async () => {
      const outcomes: Array<{ labels: string[]; bodyIsMinSpecs: boolean; manual: string[]; opened: boolean }> = [];

      for (const labels of [['docs-lane'], [] as string[]]) {
        H.info.length = 0;
        H.warn.length = 0;
        const repo = repoWith(labels);
        installForge(repo);
        const suffix = await approve(root(), via);
        await flush();

        expect(repo.prs, `repo labels [${labels.join(',')}]: MinSpec must open the PR itself`).toHaveLength(1);
        outcomes.push({
          labels: repo.prs[0].labels,
          // The generated provenance body is how a MinSpec-opened PR differs from the
          // empty-bodied one the founder had to make by hand from the compare page.
          bodyIsMinSpecs: repo.prs[0].body.startsWith('MinSpec approval record'),
          manual: manualSurfacesShown(),
          opened: suffix.includes('PR opened') && suffix.includes(repo.prs[0].url),
        });
      }

      const [withLabel, withoutLabel] = outcomes;
      expect(withLabel).toEqual({ labels: ['docs-lane'], bodyIsMinSpecs: true, manual: [], opened: true });
      // THE PARITY PROPERTY: the repo that lacked the label lands identically — the PR
      // rides the lane (so it auto-merges), and nobody was handed an `Open PR` click.
      expect(withoutLabel).toEqual(withLabel);
    });

    it('creates the missing label exactly once, as the label this repo carries, and never again', async () => {
      const repo = repoWith([]);
      installForge(repo);
      const r = root();

      await approve(r, via);
      await approve(r, via);

      expect(repo.labelCreates).toHaveLength(1);
      const argv = repo.labelCreates[0];
      expect(argv.slice(0, 3)).toEqual(['label', 'create', 'docs-lane']);
      expect(flagValues(argv, '--color')).toEqual(['0e8a16']);
      expect(flagValues(argv, '--description')).toEqual([
        'Docs-only PR — docs-lane workflow auto-merges once checks pass',
      ]);
      // `--force` would silently rewrite a label a maintainer had customised.
      expect(argv).not.toContain('--force');
      expect(repo.prs.map((p) => p.labels)).toEqual([['docs-lane'], ['docs-lane']]);
    });

    it('the suffix says the label was created, once — a forge write is never silent', async () => {
      const repo = repoWith([]);
      installForge(repo);
      const r = root();

      const first = await approve(r, via);
      const second = await approve(r, via);

      expect(first).toMatch(/created the missing docs-lane label/);
      expect(second).not.toMatch(/docs-lane label/);
    });

    it('a repo that already has the label is never asked to create one', async () => {
      const repo = repoWith(['docs-lane']);
      installForge(repo);
      await approve(root(), via);
      expect(repo.calls.filter((c) => c.startsWith('gh label'))).toEqual([]);
      expect(repo.labelCreates).toEqual([]);
    });

    it('a repo WITHOUT the lane workflow gets no label created — nothing there would consume it', async () => {
      // Invariant 3's other edge: the label exists only to trigger the docs-lane
      // workflow. Creating it in a checkout that never installed that workflow would be
      // a forge write with no purpose, so the flow degrades exactly as it did before,
      // and now says WHY instead of "opening the PR failed".
      const repo = repoWith([]);
      installForge(repo);
      const suffix = await approve(root(false), via);
      await flush();

      expect(repo.calls.filter((c) => c.startsWith('gh label'))).toEqual([]);
      expect(repo.prs).toEqual([]);
      expect(suffix).toContain(`pushed on ${BRANCH}`);
      expect(suffix).toMatch(/docs-lane' label does not exist in this repository/);
    });

    it('a label MinSpec cannot create degrades to the old surface, naming the missing label', async () => {
      const repo = repoWith([]);
      installForge(repo);
      const forge = H.runner!;
      // A contributor without permission to create labels: gh answers 403.
      H.runner = async (file, args, opts) => {
        if (file === 'gh' && args[0] === 'label') {
          repo.calls.push(`${file} ${args.join(' ')}`);
          throw ghError('HTTP 403: Resource not accessible by integration');
        }
        return forge(file, args, opts);
      };
      const suffix = await approve(root(), via);
      await flush();

      expect(repo.prs).toEqual([]);
      expect(repo.calls.filter((c) => c.startsWith('gh pr create'))).toHaveLength(1);
      expect(suffix).toMatch(/docs-lane' label does not exist in this repository and could not be created/);
      // The approval itself is committed and pushed either way — never reported as lost.
      expect(suffix).toContain(`pushed on ${BRANCH}`);
      expect(suffix).not.toContain('NOT committed');
    });
  },
);
