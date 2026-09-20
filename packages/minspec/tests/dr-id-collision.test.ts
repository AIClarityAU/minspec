/**
 * T0 — a duplicate `DR-NNN` id must be impossible to merge, and the next free id
 * must be named at the moment of the failure (#1226).
 *
 * ROOT CAUSE this file pins. `nextAdrNumber` computes `max(existing DR-NNN) + 1`
 * against the LOCAL checkout (adr-manager.ts:103). That is correct in isolation and
 * unique only if DR creation is serialised through `main` — which concurrent
 * worktree sessions (#168, the normal mode here) break by design. Nothing then
 * rejected the duplicate: `validateDrSequence` reports a `duplicate` but only as a
 * WARN, and only for two FILES sharing a number — it never reads the frontmatter
 * `id:` at all, so a `DR-079.md` declaring `id: DR-077` was invisible to every gate.
 * Measured 2026-08-05: PR #1209 adds `docs/decisions/DR-077.md` while an accepted
 * DR-077 is already merged on `main`, and its number had already decayed twice in
 * one day while the PR sat blocked.
 *
 * The gate has two halves and they must agree on what "the id" is:
 *
 *   A. LOCAL (offline, Tier-0, in the validator) — two decision files declaring one
 *      `id:` is FATAL, and a file whose declared `id:` disagrees with its own
 *      filename is FATAL too. The second rule is not cosmetic: half B keys on
 *      FILENAMES (a PR's frontmatter is not cheaply readable across every open PR),
 *      so a file free to declare an id its name does not carry would walk straight
 *      past half B. Pinning the two representations together is what makes the
 *      cross-PR check sound.
 *
 *   B. CROSS-PR (network-fed, decided purely) — an id this PR adds must not already
 *      exist on the base branch, nor be added by another open PR.
 *
 * The decision logic for B is asserted by CALLING it, and the CLI around it by
 * running it against a stub `gh` — never by grepping the workflow YAML for its own
 * text, which passes while inert (the `specify_scope_stray` lesson).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  formatDrId,
  drNumberFromId,
  drNumberFromPath,
  declaredIdFromContent,
  checkDeclaredDrIds,
  claimedPathsFromPrFiles,
  decideDrIdCollision,
  frontmatterField,
  modifiedDecisionPaths,
  decideDrRepurposing,
  type DrFile,
  type PrFileEntry,
} from '../../../scripts/lib/dr-id-collision';
import { useShellTimeout } from './helpers/shell-timeout';

// Blocks B and C run `npx tsx <cli>` per case (npx, then tsx, then node, then a
// TypeScript compile) — the heaviest child process in this suite, against vitest's 5s
// default. Under container scheduling contention that queues past 5s with nothing hung
// (#1285's failure shape).
//
// MEASURED on this file, 2026-09-21, `vitest run --reporter=verbose` (#1899, which was
// filed because two PRs committed contradictory explanations and neither cited a number):
//
//   13 tests that spawn a subprocess   28,178ms total   mean 2,167ms   max 3,689ms
//   40 tests that do not                   131ms total
//   → 99% of this file's runtime is subprocess spawns.
//
// The two earlier explanations were not rival accounts of one variable; they answered
// different questions, and saying either alone is what made them look contradictory:
//
//   • PER-TEST TIMEOUT is governed by the cost of ONE invocation. At a 3,689ms max
//     against a 5,000ms default, a single spawning case can trip the default on its
//     own — so this file needs the raised timeout no matter how few cases it has.
//     That is why the count is NOT what licenses `useShellTimeout()` here.
//   • FILE DURATION is governed by how MANY cases spawn, near-linearly at ~2.2s each.
//     Adding a spawning case costs ~2s of wall clock; adding a pure one costs ~3ms.
//
// The `SHELL_CALL_THRESHOLD = 5` in shell-timeout-coverage.test.ts counts
// `execFileSync`/`spawnSync` CALL SITES IN SOURCE TEXT, statically — not invocations
// and not runtime. This file now has exactly 5 (block C's `runCli` added the fifth),
// so it sits AT the threshold rather than below it, and the coverage test requires the
// call below rather than merely permitting it. Removing a call site would drop it back
// under and silently make that requirement inert, which is the shape #1399 already hit.
useShellTimeout();

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'scripts', 'check-dr-id-collision.ts');
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'dr-id-collision.yml');

const DIR = 'docs/decisions';

/** A minimal, well-formed decision file. */
function dr(id: string, body = 'A decision.'): string {
  return `---\nid: ${id}\nstatus: proposed\ndate: 2026-08-05\ntitle: ${id}\n---\n\n# ${id}\n\n${body}\n`;
}

// ─── Canonicalisation ────────────────────────────────────────────────────────

describe('DR id canonicalisation — two spellings of one number are one id', () => {
  it('formats to the 3-digit padded form', () => {
    expect(formatDrId(1)).toBe('DR-001');
    expect(formatDrId(77)).toBe('DR-077');
    expect(formatDrId(1234)).toBe('DR-1234');
  });

  it('reads a number out of either spelling', () => {
    expect(drNumberFromId('DR-77')).toBe(77);
    expect(drNumberFromId('DR-077')).toBe(77);
    expect(drNumberFromId('  DR-077  ')).toBe(77);
    expect(drNumberFromId('SPEC-077')).toBeUndefined();
    expect(drNumberFromId('')).toBeUndefined();
  });

  it('reads a number out of a decision file path, and ignores non-DR files', () => {
    expect(drNumberFromPath('docs/decisions/DR-077.md')).toBe(77);
    expect(drNumberFromPath('docs/decisions/DR-077-verdict-out-of-band.md')).toBe(77);
    expect(drNumberFromPath('DR-1.md')).toBe(1);
    expect(drNumberFromPath('docs/decisions/INDEX.md')).toBeUndefined();
    expect(drNumberFromPath('docs/decisions/README.md')).toBeUndefined();
    expect(drNumberFromPath('specs/minspec/spec.md')).toBeUndefined();
  });

  it('extracts the declared frontmatter id, or undefined when there is none', () => {
    expect(declaredIdFromContent(dr('DR-077'))).toBe('DR-077');
    expect(declaredIdFromContent('# No frontmatter\n')).toBeUndefined();
    expect(declaredIdFromContent('---\nstatus: proposed\n---\n')).toBeUndefined();
    // A body line that merely looks like frontmatter must not be mistaken for it.
    expect(declaredIdFromContent('# Title\n\nid: DR-077\n')).toBeUndefined();
  });
});

// ─── A. Local, offline duplicate-id check ────────────────────────────────────

describe('A — checkDeclaredDrIds: a duplicate id is a defect, offline (#1226)', () => {
  const files = (...entries: [string, string][]): DrFile[] =>
    entries.map(([file, content]) => ({ file, content }));

  it('flags two decision files declaring the same id', () => {
    const defects = checkDeclaredDrIds(
      files(
        [`${DIR}/DR-077.md`, dr('DR-077')],
        [`${DIR}/DR-078.md`, dr('DR-078')],
      ),
    );
    expect(defects).toEqual([]);

    // Now the collision: a second file also declaring DR-077. This is the exact
    // shape #1180 and #1209 would have produced had both merged.
    const collided = checkDeclaredDrIds(
      files(
        [`${DIR}/DR-077.md`, dr('DR-077')],
        [`${DIR}/DR-077-verdict-out-of-band.md`, dr('DR-077')],
      ),
    );
    const dup = collided.filter((d) => d.kind === 'duplicate-id');
    expect(dup).toHaveLength(1);
    expect(dup[0].id).toBe('DR-077');
    expect(dup[0].files).toEqual([
      `${DIR}/DR-077-verdict-out-of-band.md`,
      `${DIR}/DR-077.md`,
    ]);
    expect(dup[0].message).toContain('DR-077');
  });

  it('catches a duplicate the FILENAME check cannot see — differing names, one declared id', () => {
    // `validateDrSequence` compares file NAMES, so these two look distinct to it.
    // The declared ids are what the register is actually keyed on.
    const defects = checkDeclaredDrIds(
      files([`${DIR}/DR-077.md`, dr('DR-077')], [`${DIR}/DR-079.md`, dr('DR-077')]),
    );
    expect(defects.some((d) => d.kind === 'duplicate-id' && d.id === 'DR-077')).toBe(true);
  });

  it('treats DR-1 and DR-001 as one id (padding is spelling, not identity)', () => {
    const defects = checkDeclaredDrIds(
      files([`${DIR}/DR-001.md`, dr('DR-001')], [`${DIR}/DR-1-early.md`, dr('DR-1')]),
    );
    expect(defects.some((d) => d.kind === 'duplicate-id' && d.id === 'DR-001')).toBe(true);
  });

  it('flags a declared id that disagrees with its own filename (the seam between A and B)', () => {
    const defects = checkDeclaredDrIds(files([`${DIR}/DR-079.md`, dr('DR-077')]));
    const mismatch = defects.filter((d) => d.kind === 'id-filename-mismatch');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0].files).toEqual([`${DIR}/DR-079.md`]);
    expect(mismatch[0].message).toContain('DR-077');
    expect(mismatch[0].message).toContain('DR-079');
  });

  it('leaves frontmatter-less and non-DR files exactly as they were — no new failures', () => {
    // Pre-MinSpec DRs carry no frontmatter (adr-manager synthesises one on demand);
    // INDEX.md and README.md are not decisions. None of these may become a defect.
    const defects = checkDeclaredDrIds(
      files(
        [`${DIR}/DR-002.md`, '# DR-002: an old decision, no frontmatter\n'],
        [`${DIR}/INDEX.md`, '# Decision Register\n\n- DR-002\n'],
        [`${DIR}/README.md`, '# Notes\n'],
        [`${DIR}/DR-003.md`, dr('DR-003')],
      ),
    );
    expect(defects).toEqual([]);
  });

  it('a frontmatter-less DR still holds its filename id against a duplicate', () => {
    const defects = checkDeclaredDrIds(
      files(
        [`${DIR}/DR-002.md`, '# DR-002: an old decision\n'],
        [`${DIR}/DR-002-take-two.md`, dr('DR-002')],
      ),
    );
    expect(defects.some((d) => d.kind === 'duplicate-id' && d.id === 'DR-002')).toBe(true);
  });

  it('is deterministic — same input, same order out', () => {
    const input = files(
      [`${DIR}/DR-005.md`, dr('DR-005')],
      [`${DIR}/DR-004.md`, dr('DR-004')],
      [`${DIR}/DR-004-b.md`, dr('DR-004')],
      [`${DIR}/DR-006.md`, dr('DR-003')],
    );
    expect(JSON.stringify(checkDeclaredDrIds(input))).toBe(
      JSON.stringify(checkDeclaredDrIds([...input].reverse())),
    );
  });

  it('the live register is clean under this rule (it must ship green)', () => {
    const decisionsDir = path.join(REPO_ROOT, DIR);
    const live = fs
      .readdirSync(decisionsDir)
      .filter((e) => e.endsWith('.md'))
      .map((e) => ({
        file: `${DIR}/${e}`,
        content: fs.readFileSync(path.join(decisionsDir, e), 'utf-8'),
      }));
    expect(live.length).toBeGreaterThan(10);
    expect(checkDeclaredDrIds(live)).toEqual([]);
  });
});

describe('A — the validator FAILS the build on it (behaviour, not a grep)', () => {
  /**
   * The repo's tsx shim. Walk up from the repo root so this resolves both in CI
   * (`npm ci` installs into the checkout) and in a git worktree, whose node_modules
   * lives in the parent clone. Not found ⇒ throw, never skip: a silently skipped
   * test is the same defect class as a silently passing gate.
   */
  function tsxBin(): string {
    let dir = REPO_ROOT;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, 'node_modules', '.bin', 'tsx');
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`could not find node_modules/.bin/tsx at or above ${REPO_ROOT}`);
  }

  /** A throwaway repo root with a .minspec config and the given decision files. */
  function fixture(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-id-validator-'));
    fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.minspec', 'config.json'),
      JSON.stringify({ decisionsDir: DIR }),
    );
    fs.mkdirSync(path.join(root, DIR), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(root, DIR, name), content);
    }
    return root;
  }

  function runValidator(root: string): { status: number; output: string } {
    try {
      const out = execFileSync(
        tsxBin(),
        [path.join(REPO_ROOT, 'scripts', 'validate-frontmatter.ts')],
        { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      return { status: 0, output: out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  }

  it('fails on a duplicate declared id — FATAL, not another warning', () => {
    // A rule asserted only by finding its own name in the validator source passes
    // while inert. FATAL matters too: a warning would join the ~110 this repo
    // already emits and be read by nobody, which is how the original gap survived.
    const root = fixture({
      'DR-001.md': dr('DR-001', 'first'),
      'DR-001-again.md': dr('DR-001', 'second'),
    });
    try {
      const r = runValidator(root);
      expect(r.status).toBe(1);
      expect(r.output).toMatch(/duplicate-id/);
      expect(r.output).toContain('DR-001');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails when a declared id disagrees with its filename', () => {
    const root = fixture({ 'DR-002.md': dr('DR-001') });
    try {
      const r = runValidator(root);
      expect(r.status).toBe(1);
      expect(r.output).toMatch(/id-filename-mismatch/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('stays green on a register with unique, well-named ids', () => {
    // The control. Without it, the two assertions above could be passing on some
    // unrelated failure that a bare fixture happens to trigger.
    const root = fixture({ 'DR-001.md': dr('DR-001'), 'DR-002.md': dr('DR-002') });
    try {
      const r = runValidator(root);
      expect(r.output).not.toMatch(/duplicate-id|id-filename-mismatch/);
      expect(r.status).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─── B. Cross-PR decision seam ───────────────────────────────────────────────

describe('B — claimedPathsFromPrFiles: only paths this PR INTRODUCES count', () => {
  const entry = (filename: string, status: string, previous?: string): PrFileEntry => ({
    filename,
    status,
    ...(previous ? { previous_filename: previous } : {}),
  });

  it('counts added, renamed and copied; ignores modified, removed and unchanged', () => {
    const paths = claimedPathsFromPrFiles(
      [
        entry(`${DIR}/DR-077.md`, 'added'),
        entry(`${DIR}/DR-079.md`, 'renamed', `${DIR}/DR-078.md`),
        entry(`${DIR}/DR-080.md`, 'copied'),
        entry(`${DIR}/DR-010.md`, 'modified'),
        entry(`${DIR}/DR-011.md`, 'removed'),
        entry(`${DIR}/DR-012.md`, 'unchanged'),
        entry(`${DIR}/INDEX.md`, 'modified'),
      ],
      DIR,
    );
    // A `modified` DR already exists on the base branch — editing it is not a claim.
    expect(paths).toEqual([`${DIR}/DR-077.md`, `${DIR}/DR-079.md`, `${DIR}/DR-080.md`]);
  });

  it('ignores everything outside the decisions dir', () => {
    const paths = claimedPathsFromPrFiles(
      [
        entry('scripts/DR-077.md', 'added'),
        entry('docs/decisions-archive/DR-077.md', 'added'),
        entry(`${DIR}/DR-077.md`, 'added'),
      ],
      DIR,
    );
    expect(paths).toEqual([`${DIR}/DR-077.md`]);
  });

  it('honours a non-default decisions dir', () => {
    expect(
      claimedPathsFromPrFiles([entry('adr/DR-077.md', 'added')], 'adr'),
    ).toEqual(['adr/DR-077.md']);
  });
});

describe('B — decideDrIdCollision: fails closed on a taken id and names the next free one', () => {
  const base = {
    decisionsDir: DIR,
    baseRef: 'main',
    basePaths: [`${DIR}/DR-076.md`, `${DIR}/DR-077.md`, `${DIR}/DR-078.md`, `${DIR}/INDEX.md`],
  };

  it('passes a PR whose id nobody else holds', () => {
    const v = decideDrIdCollision({
      ...base,
      subject: { pr: 1209, paths: [`${DIR}/DR-079.md`] },
      otherPrs: [],
    });
    expect(v.ok).toBe(true);
    expect(v.findings).toEqual([]);
    expect(v.claimed).toEqual(['DR-079']);
  });

  it('passes a PR that adds no decision at all (so the check stays satisfiable as required)', () => {
    const v = decideDrIdCollision({
      ...base,
      subject: { pr: 1251, paths: [] },
      otherPrs: [{ pr: 1209, paths: [`${DIR}/DR-077.md`] }],
    });
    expect(v.ok).toBe(true);
    expect(v.claimed).toEqual([]);
    expect(v.findings).toEqual([]);
  });

  it('fails when the id is already on the base branch — the #1209 case, verbatim', () => {
    const v = decideDrIdCollision({
      ...base,
      subject: { pr: 1209, paths: [`${DIR}/DR-077.md`] },
      otherPrs: [],
    });
    expect(v.ok).toBe(false);
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0].id).toBe('DR-077');
    expect(v.findings[0].heldBy).toBe('main');
    expect(v.findings[0].file).toBe(`${DIR}/DR-077.md`);
    // The fix must be one rename with no guesswork: max(main ∪ open PRs) + 1.
    expect(v.nextFreeId).toBe('DR-079');
    expect(v.message).toContain('DR-077');
    expect(v.message).toContain('DR-079');
  });

  it('fails when another OPEN PR claims the same id — the #1180 vs #1209 race', () => {
    const v = decideDrIdCollision({
      decisionsDir: DIR,
      baseRef: 'main',
      basePaths: [`${DIR}/DR-076.md`],
      subject: { pr: 1209, paths: [`${DIR}/DR-077.md`] },
      otherPrs: [{ pr: 1180, paths: [`${DIR}/DR-077.md`] }],
    });
    expect(v.ok).toBe(false);
    expect(v.findings.map((f) => f.heldBy)).toEqual(['PR #1180']);
    expect(v.nextFreeId).toBe('DR-078');
    expect(v.message).toContain('#1180');
  });

  it('counts EVERY open PR when computing the next free id, not just the colliding one', () => {
    // The decay case: a blocked PR must be told a number that survives the other
    // work in flight, or it renumbers straight into the next collision.
    const v = decideDrIdCollision({
      decisionsDir: DIR,
      baseRef: 'main',
      basePaths: [`${DIR}/DR-077.md`],
      subject: { pr: 1209, paths: [`${DIR}/DR-077.md`] },
      otherPrs: [
        { pr: 1225, paths: [`${DIR}/DR-078.md`] },
        { pr: 1240, paths: [`${DIR}/DR-081.md`] },
        { pr: 1241, paths: ['specs/minspec/spec.md'] },
      ],
    });
    expect(v.ok).toBe(false);
    expect(v.nextFreeId).toBe('DR-082');
  });

  it('fails when one PR claims the same id twice under two filenames', () => {
    const v = decideDrIdCollision({
      decisionsDir: DIR,
      baseRef: 'main',
      basePaths: [],
      subject: { pr: 1209, paths: [`${DIR}/DR-077.md`, `${DIR}/DR-077-take-two.md`] },
      otherPrs: [],
    });
    expect(v.ok).toBe(false);
    expect(v.findings[0].heldBy).toBe('this PR');
    expect(v.nextFreeId).toBe('DR-078');
  });

  it('treats DR-77 and DR-077 as the same claim across PRs', () => {
    const v = decideDrIdCollision({
      decisionsDir: DIR,
      baseRef: 'main',
      basePaths: [`${DIR}/DR-077.md`],
      subject: { pr: 1209, paths: [`${DIR}/DR-77-unpadded.md`] },
      otherPrs: [],
    });
    expect(v.ok).toBe(false);
    expect(v.findings[0].id).toBe('DR-077');
  });

  it('starts at DR-001 on an empty register', () => {
    const v = decideDrIdCollision({
      decisionsDir: DIR,
      baseRef: 'main',
      basePaths: [],
      subject: { pr: 1, paths: [] },
      otherPrs: [],
    });
    expect(v.ok).toBe(true);
    expect(v.nextFreeId).toBe('DR-001');
  });

  it('reports one collision once, even when the subject claims it under two filenames', () => {
    // Both of the subject's files hit the same base holder. The collision is ONE
    // fact; printing the holder line twice makes the message look like two problems.
    const v = decideDrIdCollision({
      decisionsDir: DIR,
      baseRef: 'main',
      basePaths: [`${DIR}/DR-077.md`],
      subject: { pr: 1209, paths: [`${DIR}/DR-077.md`, `${DIR}/DR-077-take-two.md`] },
      otherPrs: [],
    });
    expect(v.ok).toBe(false);
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]).toEqual({ id: 'DR-077', heldBy: 'main', file: `${DIR}/DR-077.md` });
    expect(v.message.match(/DR-077 is already claimed/g)).toHaveLength(1);
  });

  it('reports every colliding id, deterministically ordered', () => {
    const v = decideDrIdCollision({
      decisionsDir: DIR,
      baseRef: 'main',
      basePaths: [`${DIR}/DR-077.md`, `${DIR}/DR-078.md`],
      subject: { pr: 1209, paths: [`${DIR}/DR-078.md`, `${DIR}/DR-077.md`] },
      otherPrs: [],
    });
    expect(v.ok).toBe(false);
    expect(v.findings.map((f) => f.id)).toEqual(['DR-077', 'DR-078']);
  });
});

// ─── B (impure layer) — the CLI must fail CLOSED, per DR-066 ────────────────

describe('B — check-dr-id-collision.ts fails closed when its witness is missing (DR-066)', () => {
  /**
   * Run the CLI against a stub `gh`, pinned via the `DR_ID_GH_BIN` test seam so no
   * test can reach the real GitHub API (no network, no auth, no flake). The stub
   * dispatches on its argv; anything it does not anticipate exits 1, so an
   * unexpected call surfaces as a failure rather than as silent success.
   */
  function runCli(
    args: string[],
    stub: { script: string } | { bin: string },
  ): { status: number; stdout: string; stderr: string } {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-id-cli-'));
    let bin: string;
    if ('bin' in stub) {
      bin = stub.bin;
    } else {
      bin = path.join(tmp, 'gh');
      fs.writeFileSync(bin, stub.script, { mode: 0o755 });
    }
    try {
      const out = execFileSync('npx', ['tsx', CLI, ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        env: { ...process.env, DR_ID_GH_BIN: bin, GITHUB_ACTIONS: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, stdout: out, stderr: '' };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const ARGS = ['--repo', 'AIClarityAU/minspec', '--pr', '1209', '--base', 'main'];

  it('exits non-zero when gh errors — never green because it could not look', () => {
    const r = runCli(ARGS, { script: '#!/bin/sh\necho "gh: HTTP 403" >&2\nexit 1\n' });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/could not|fail|error/i);
  });

  it('exits non-zero when gh returns unparseable output', () => {
    const r = runCli(ARGS, { script: '#!/bin/sh\necho "not json"\nexit 0\n' });
    expect(r.status).not.toBe(0);
  });

  it('exits non-zero when gh is absent entirely (ENOENT carries no stderr of its own)', () => {
    // The state a fresh runner or a stripped container is in. ENOENT from
    // execFileSync has an empty `stderr`, so a naive handler would report an empty
    // reason and — if it swallowed the throw — pass. It must be a loud red.
    const r = runCli(ARGS, { bin: path.join(os.tmpdir(), 'definitely-no-such-gh-binary') });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/FAILED CLOSED/);
  });

  it('reports the collision and the next free id end-to-end against a stub gh', () => {
    // main holds DR-077 + DR-078; the subject PR adds DR-077; PR #1240 adds DR-081.
    // The `api --paginate --slurp` responses use the PAGED shape real gh emits
    // (an array of per-page arrays); `pr list --json` is flat, as real gh emits.
    const script = `#!/bin/sh
argv="$*"
case "$argv" in
  *"pulls/1209/files"*)
    echo '[[{"filename":"docs/decisions/DR-077.md","status":"added"},{"filename":"docs/decisions/INDEX.md","status":"modified"}]]' ;;
  *"pulls/1240/files"*)
    echo '[[{"filename":"docs/decisions/DR-081.md","status":"added"}]]' ;;
  *"contents/docs/decisions"*)
    echo '[[{"path":"docs/decisions/DR-077.md","type":"file"},{"path":"docs/decisions/DR-078.md","type":"file"},{"path":"docs/decisions/INDEX.md","type":"file"}]]' ;;
  *"pr list"*)
    echo '[{"number":1209},{"number":1240}]' ;;
  *) echo "unexpected gh call: $argv" >&2 ; exit 1 ;;
esac
`;
    const r = runCli(ARGS, { script });
    expect(r.status).not.toBe(0);
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toContain('DR-077');
    // max(main 078 ∪ PR#1240 081 ∪ subject 077) + 1
    expect(out).toContain('DR-082');
  });

  it('exits 0 when the PR adds no decision file at all', () => {
    const script = `#!/bin/sh
argv="$*"
case "$argv" in
  *"pulls/1209/files"*) echo '[[{"filename":"scripts/foo.ts","status":"added"}]]' ;;
  *"contents/docs/decisions"*) echo '[[{"path":"docs/decisions/DR-077.md","type":"file"}]]' ;;
  *"pr list"*) echo '[{"number":1209}]' ;;
  *) echo "unexpected gh call: $argv" >&2 ; exit 1 ;;
esac
`;
    expect(runCli(ARGS, { script }).status).toBe(0);
  });

  it('fails closed when the base listing is EMPTY but this checkout holds unclaimed DRs', () => {
    // The single-witness hole: a permission gap, a moved decisions dir or a wrong
    // --base all return "nothing here", and reading that as "every id is free" turns
    // the gate green over exactly the state it exists to reject (DR-066 clause 3).
    // The local checkout is the independent second witness — it holds 78 DRs that
    // this PR does not add, so an empty base listing is a contradiction, not a fact.
    const script = `#!/bin/sh
argv="$*"
case "$argv" in
  *"pulls/1209/files"*) echo '[[{"filename":"docs/decisions/DR-099.md","status":"added"}]]' ;;
  *"contents/docs/decisions"*) echo '[[]]' ;;
  *"pr list"*) echo '[{"number":1209}]' ;;
  *) echo "unexpected gh call: $argv" >&2 ; exit 1 ;;
esac
`;
    const r = runCli(ARGS, { script });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/FAILED CLOSED/);
  });
});

// ─── Wiring — the CI half must be reachable, not merely defined ──────────────

describe('the cross-PR half is wired into CI', () => {
  it('the workflow exists, runs the real check, and is not path-filtered into unsatisfiability', () => {
    expect(fs.existsSync(WORKFLOW)).toBe(true);
    const yaml = fs.readFileSync(WORKFLOW, 'utf-8');
    expect(yaml).toContain('scripts/check-dr-id-collision.ts');
    expect(yaml).toMatch(/on:\s*\n\s*pull_request:/);
    // A `paths:` filter would make a required check unsatisfiable on every PR that
    // touches no decision — the #560 class of silent gate (DR-066). The CLI exits 0
    // on such a PR instead, which is why it must run unconditionally.
    const onBlock = yaml.slice(yaml.indexOf('on:'), yaml.indexOf('permissions:'));
    expect(onBlock).not.toMatch(/^\s*paths(-ignore)?:/m);
  });
});

// ─── C. In-place repurposing (#1757) ─────────────────────────────────────────

/**
 * The shape half B structurally cannot see. PR #1756 wrote an entirely different
 * decision over the existing `docs/decisions/DR-088.md` — `title:`, `triggered_by:`
 * and the heading all swapped — while the original DR-088 was merged an hour earlier
 * and `status: proposed`, i.e. in force. Both this gate and the required `DR id
 * uniqueness` check passed it; the ai-review panel caught it.
 *
 * Half B filters on the paths a PR INTRODUCES, and `modified` is excluded there for
 * a good reason: a file that exists on both sides claims no number. The exclusion is
 * right for collisions and blind to replacement, so this is a separate decision over
 * a separate input, not a loosening of the first.
 *
 * Consequences differ, which is why both must exist: a claim collision yields a
 * DUPLICATE (noisy, fixed by renumbering); repurposing yields a DELETION (silent,
 * recoverable only from history).
 */

/** A decision file with an explicit provenance line, as the register writes them. */
function drWith(id: string, title: string, triggeredBy: string, body = 'A decision.'): string {
  return `---\nid: ${id}\nstatus: proposed\ndate: 2026-08-05\ntitle: ${title}\ntriggered_by: ${triggeredBy}\n---\n\n# ${id}: ${title}\n\n${body}\n`;
}

describe('C — frontmatterField: only the leading block, only a real declaration', () => {
  it('reads a field from the leading frontmatter block', () => {
    expect(frontmatterField(drWith('DR-088', 'Ownership leaves the hash', '#1481'), 'title')).toBe(
      'Ownership leaves the hash',
    );
    expect(frontmatterField(drWith('DR-088', 'T', '#1481'), 'triggered_by')).toBe('#1481');
  });

  it('ignores a body line that merely looks like a declaration', () => {
    // The reason this reads the leading block rather than grepping: a DR whose prose
    // quotes `title: something else` must not be read as declaring it.
    const content = `---\nid: DR-088\ntitle: Real\n---\n\ntitle: Not a declaration\n`;
    expect(frontmatterField(content, 'title')).toBe('Real');
  });

  it('treats an empty value and an absent field alike — both are "not declared"', () => {
    expect(frontmatterField(`---\nid: DR-088\ntitle:\n---\n`, 'title')).toBeUndefined();
    expect(frontmatterField(`---\nid: DR-088\n---\n`, 'title')).toBeUndefined();
  });

  it('returns undefined when there is no frontmatter at all (pre-MinSpec records)', () => {
    expect(frontmatterField('# DR-001\n\nAn old decision.\n', 'title')).toBeUndefined();
  });
});

describe('C — modifiedDecisionPaths: the exact complement of what half B claims', () => {
  const entries: PrFileEntry[] = [
    { filename: 'docs/decisions/DR-088.md', status: 'modified' },
    { filename: 'docs/decisions/DR-090.md', status: 'added' },
    { filename: 'docs/decisions/INDEX.md', status: 'modified' },
    { filename: 'docs/decisions/DR-091.md', status: 'removed' },
    { filename: 'scripts/foo.ts', status: 'modified' },
    { filename: 'specs/minspec/SPEC-001/spec.md', status: 'modified' },
  ];

  it('takes modified decision records and nothing else', () => {
    expect(modifiedDecisionPaths(entries, DIR)).toEqual(['docs/decisions/DR-088.md']);
  });

  it('never overlaps with the paths half B treats as claims', () => {
    // The two halves must partition the decision files a PR touches. An overlap would
    // double-report one fact; a gap is how #1757 happened in the first place.
    const claimed = claimedPathsFromPrFiles(entries, DIR);
    const modified = modifiedDecisionPaths(entries, DIR);
    expect(claimed.filter((p) => modified.includes(p))).toEqual([]);
  });

  it('ignores a removed record — deleting a DR is visible in the diff, not silent', () => {
    expect(modifiedDecisionPaths(entries, DIR)).not.toContain('docs/decisions/DR-091.md');
  });
});

describe('C — decideDrRepurposing: an amendment may change what a record SAYS, not what it IS', () => {
  const base = drWith('DR-088', 'Ownership leaves the hash', '#1481');

  it('passes a body-only edit — that is what an amendment is', () => {
    const head = drWith('DR-088', 'Ownership leaves the hash', '#1481', 'Amended 2026-09-18.');
    const v = decideDrRepurposing([{ file: 'docs/decisions/DR-088.md', base, head }]);
    expect(v.ok).toBe(true);
    expect(v.findings).toEqual([]);
  });

  it('passes a status change — a decision moving proposed → accepted is the point', () => {
    const head = base.replace('status: proposed', 'status: accepted');
    expect(decideDrRepurposing([{ file: 'docs/decisions/DR-088.md', base, head }]).ok).toBe(true);
  });

  it('FAILS the #1756 shape and quotes both sides of every swapped field', () => {
    const head = drWith('DR-088', 'The harness manifest records authorship, not disk', '#1697');
    const v = decideDrRepurposing([{ file: 'docs/decisions/DR-088.md', base, head }]);
    expect(v.ok).toBe(false);
    expect(v.findings.map((f) => f.field)).toEqual(['title', 'triggered_by']);
    // Quoting both sides IS the diagnostic: the reviewer's question is "is the record
    // under this number still the same decision?", and only before-and-after answers it.
    expect(v.message).toContain('Ownership leaves the hash');
    expect(v.message).toContain('The harness manifest records authorship, not disk');
    expect(v.message).toContain('#1481');
    expect(v.message).toContain('#1697');
  });

  it('FAILS when an identity field is REMOVED, not merely changed', () => {
    const head = `---\nid: DR-088\nstatus: proposed\n---\n\n# Something else\n`;
    const v = decideDrRepurposing([{ file: 'docs/decisions/DR-088.md', base, head }]);
    expect(v.ok).toBe(false);
    expect(v.findings.map((f) => f.field)).toEqual(['title', 'triggered_by']);
    expect(v.message).toContain('(removed)');
  });

  it('PASSES adding a field that was absent on base — a pre-MinSpec record being upgraded', () => {
    // The register holds decisions written before frontmatter existed. Adding `title:`
    // to one is a migration, not a replacement; blocking it would gate the very
    // cleanup the register wants.
    const old = '# DR-001\n\nAn old decision, no frontmatter.\n';
    const head = drWith('DR-001', 'An old decision', '#3');
    expect(decideDrRepurposing([{ file: 'docs/decisions/DR-001.md', base: old, head }]).ok).toBe(true);
  });

  it('passes an empty input, and says so rather than staying silent', () => {
    const v = decideDrRepurposing([]);
    expect(v.ok).toBe(true);
    expect(v.message).toMatch(/no existing decision record/i);
  });

  it('is deterministic: findings sort by file, then by identity-field order', () => {
    const revisions = [
      { file: 'docs/decisions/DR-090.md', base: drWith('DR-090', 'B', '#2'), head: drWith('DR-090', 'B2', '#22') },
      { file: 'docs/decisions/DR-088.md', base, head: drWith('DR-088', 'A2', '#11') },
    ];
    const once = decideDrRepurposing(revisions);
    const twice = decideDrRepurposing([...revisions].reverse());
    expect(once.findings).toEqual(twice.findings);
    expect(once.findings.map((f) => `${f.file}:${f.field}`)).toEqual([
      'docs/decisions/DR-088.md:title',
      'docs/decisions/DR-088.md:triggered_by',
      'docs/decisions/DR-090.md:title',
      'docs/decisions/DR-090.md:triggered_by',
    ]);
  });
});

describe('C — check-dr-id-collision.ts reports repurposing end-to-end (stub gh)', () => {
  /** Same seam as block B: `DR_ID_GH_BIN` pins a stub, so no test reaches GitHub. */
  function runCli(args: string[], script: string): { status: number; out: string } {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-rep-cli-'));
    const bin = path.join(tmp, 'gh');
    fs.writeFileSync(bin, script, { mode: 0o755 });
    try {
      const out = execFileSync('npx', ['tsx', CLI, ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        env: { ...process.env, DR_ID_GH_BIN: bin, GITHUB_ACTIONS: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { status: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const ARGS = ['--repo', 'AIClarityAU/minspec', '--pr', '1756', '--base', 'main'];
  const HEAD_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

  /** GitHub wraps `content` at 60 chars; the reader must tolerate that AND a flat string. */
  const b64 = (text: string, wrap = false): string => {
    const raw = Buffer.from(text, 'utf-8').toString('base64');
    return wrap ? (raw.match(/.{1,60}/g) ?? []).join('\n') : raw;
  };

  const stub = (baseContent: string | null, headContent: string | null): string => `#!/bin/sh
argv="$*"
case "$argv" in
  *".head.sha"*)                     echo '${HEAD_SHA}' ;;
  *"DR-088.md?ref=main"*)            ${baseContent === null ? "echo 'null'" : `printf '%s\\n' '${b64(baseContent, true)}'`} ;;
  *"DR-088.md?ref=${HEAD_SHA}"*)     ${headContent === null ? "echo 'null'" : `printf '%s\\n' '${b64(headContent)}'`} ;;
  *"pulls/1756/files"*)              echo '[[{"filename":"docs/decisions/DR-088.md","status":"modified"}]]' ;;
  *"contents/docs/decisions?ref="*)  echo '[[{"path":"docs/decisions/DR-088.md","type":"file"}]]' ;;
  *"pr list"*)                       echo '[{"number":1756}]' ;;
  *) echo "unexpected gh call: $argv" >&2 ; exit 1 ;;
esac
`;

  it('FAILS the #1756 shape: a different decision written over an in-force record', () => {
    const r = runCli(
      ARGS,
      stub(
        drWith('DR-088', 'Ownership leaves the hash', '#1481'),
        drWith('DR-088', 'The harness manifest records authorship, not disk', '#1697'),
      ),
    );
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('Ownership leaves the hash');
    expect(r.out).toContain('The harness manifest records authorship, not disk');
    // The id half must still PASS here — the PR claims no number. If this ever reads
    // as a collision, the two halves have started answering the same question.
    expect(r.out).toMatch(/adds no decision record|is free|are free/);
  });

  it('PASSES a body-only amendment to the same record', () => {
    const r = runCli(
      ARGS,
      stub(
        drWith('DR-088', 'Ownership leaves the hash', '#1481'),
        drWith('DR-088', 'Ownership leaves the hash', '#1481', 'Amended 2026-09-18: still in force.'),
      ),
    );
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/no existing decision record has its identity changed/i);
  });

  it('fails closed when a record comes back with no readable content', () => {
    // GitHub returns an empty/absent `content` for a file it declines to inline. That
    // is indistinguishable from an empty record, and reading either as "declares no
    // identity" would turn the check green over the exact state it rejects (DR-066).
    const r = runCli(ARGS, stub(null, drWith('DR-088', 'Anything', '#1')));
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/FAILED CLOSED/);
  });

  it('makes no content call at all on a PR that modifies no decision record', () => {
    // The cost guard. The stub exits 1 on any unanticipated call, so if the CLI
    // reached for a head sha or a file body here, this would go red.
    const script = `#!/bin/sh
argv="$*"
case "$argv" in
  *"pulls/1756/files"*)              echo '[[{"filename":"scripts/foo.ts","status":"modified"},{"filename":"docs/decisions/INDEX.md","status":"modified"}]]' ;;
  *"contents/docs/decisions?ref="*)  echo '[[{"path":"docs/decisions/DR-088.md","type":"file"}]]' ;;
  *"pr list"*)                       echo '[{"number":1756}]' ;;
  *) echo "unexpected gh call: $argv" >&2 ; exit 1 ;;
esac
`;
    expect(runCli(ARGS, script).status).toBe(0);
  });
});
