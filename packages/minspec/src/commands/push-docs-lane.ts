/**
 * "MinSpec: Push docs via lane" (SPEC-039) — open a docs-only PR labelled
 * `docs-lane` from inside the editor, so a maintainer lands docs keyboard-first
 * without dropping to the terminal. The TypeScript port of `scripts/push-docs.sh`,
 * carrying the same algorithm and the same never-wrong discipline as
 * `lib/approve-commit.ts`.
 *
 * NEVER-WRONG invariants (load-bearing; SPEC-039 INV-1..4):
 *   INV-1 (offline/consent, constitution #1). NO network call happens until the
 *     user both invoked the command AND confirmed the modal in {@link confirmPush}.
 *     Every pre-confirm probe (`rev-parse`, `symbolic-ref`, `remote get-url`,
 *     `status --porcelain`) is local. `push-docs.sh` fetches before gathering; we
 *     deliberately move the fetch AFTER the confirm so consent strictly precedes
 *     the wire. The corpus predicate ({@link isDocsCorpusPath}) does zero I/O.
 *   INV-2 (corpus-only). Only paths accepted by {@link isDocsCorpusPath} are ever
 *     copied/pushed — a non-docs path can never ride the lane (the workflow also
 *     re-checks server-side).
 *   INV-3 (primary untouched). Every commit happens in a throwaway worktree off
 *     `origin/main`; the primary checkout's HEAD and index are never moved. We
 *     never `checkout`/`switch`/`commit` in the primary — only read-only probes,
 *     `fetch` (updates a remote-tracking ref, not HEAD/index), and `worktree
 *     add`/`remove` (separate worktree, separate index).
 *   INV-4 (never throws). The whole body is wrapped; every failure — not a repo,
 *     detached HEAD, no origin, gh absent, gh unauthenticated, offline, hook
 *     rejection, timeout — degrades to a typed {@link PushDocsResult} surfaced as
 *     an advisory toast. The command never rejects.
 *
 * ASYNC + bounded: git/gh run off the extension-host thread (async execFile) with
 * a per-call timeout, so a slow pre-push hook or a hung network can't freeze the UI.
 *
 * SPEC-050 Slice 1 (the seam) moved the bounded git/gh runner, the error
 * classifiers, the origin-slug parser and the `gh pr create` call itself into
 * `lib/approval-pr.ts`, so the approval flow and this command share ONE
 * PR-opening path (FR-4) instead of growing a second one. That extraction is a
 * pure refactor with no behaviour change here — SPEC-039's own tests gate it
 * (SPEC-050 AC-10) and pass unedited.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveTargetFolder } from '../lib/resolve-folder';
import { isDocsCorpusPath } from '../lib/docs-corpus';
import {
  DOCS_LANE_LABEL,
  defaultExecRun,
  describeError,
  isEnoent,
  isNetworkError,
  openPullRequest,
  slugFromOriginUrl,
  type ExecRun,
} from '../lib/approval-pr';

// Re-exported so this module's PUBLIC SURFACE is unchanged by the extraction:
// `tests/push-docs-lane.test.ts` imports `slugFromOriginUrl` and `type ExecRun`
// from here, and AC-10 requires it to pass byte-unedited. `defaultExecRun` rides
// along for the same reason — the surface must not shrink either.
// NOTE: `isAuthError` is deliberately NOT imported. Its only call site was the
// `gh pr create` arm, which now lives in the seam; importing it unused would
// fail the build under `noUnusedLocals`.
export { defaultExecRun, slugFromOriginUrl };
export type { ExecRun };

/** The modal-confirm button that authorizes the (network) push. */
const CONFIRM_LABEL = 'Open docs-lane PR';
/** The success-toast button that opens the new PR in a browser. */
const OPEN_PR_LABEL = 'Open PR';

/** Outcome of a push-docs-lane attempt. Never an exception — always one of these. */
export type PushDocsOutcome =
  | 'pushed' //              a docs-lane PR was opened (prUrl set)
  | 'no-folder' //           no workspace folder resolved (or the pick was cancelled)
  | 'not-a-repo' //          the folder is not inside a git work tree
  | 'detached-head' //       HEAD is detached — refused (branch name/base would be wrong)
  | 'no-origin' //           no `origin` remote — cannot open a PR
  | 'no-docs-changes' //     no working-tree change is in the docs corpus (INV-2)
  | 'no-delta' //            docs changes are already identical to origin/main — nothing to push
  | 'cancelled' //           user dismissed the confirm or the message prompt (no network)
  | 'gh-absent' //           the `gh` CLI is not installed (ENOENT)
  | 'gh-unauthenticated' //  `gh` is installed but not logged in
  | 'offline' //             a network step could not reach GitHub
  | 'failed'; //             any other git/gh error (e.g. a hook rejected the commit)

export interface PushDocsResult {
  readonly outcome: PushDocsOutcome;
  /** The opened PR URL (present on 'pushed'). */
  readonly prUrl?: string;
  /** Repo-relative docs paths that were pushed/considered. */
  readonly files?: string[];
  /** The branch that was pushed (present on 'pushed'). */
  readonly branch?: string;
  /** Error detail incl. git/gh stderr (present on 'failed'/'offline'/'gh-*'). */
  readonly error?: string;
}

/** Dependencies, all optional — production uses the defaults; tests inject stubs. */
export interface PushDocsDeps {
  /** Injectable git/gh runner (defaults to a real, bounded execFile runner). */
  run?: ExecRun;
}

/** One `git status --porcelain` (v1) line: a repo-relative path plus its raw XY status. */
export interface PorcelainEntry {
  readonly path: string;
  /** The raw two-char `XY` status code (e.g. `' M'`, `'A '`, `' D'`, `'D '`, `'??'`, `'R '`). */
  readonly status: string;
}

/**
 * Parse `git status --porcelain` (v1) output into `{ path, status }` entries.
 * Splits off the two-char `XY` status (`line.slice(0, 2)`) from its trailing
 * space (`line.slice(3)`), and for a rename/copy (`old -> new`) keeps the NEW
 * path. Blank lines are dropped. Run with `-c core.quotePath=false` upstream so
 * non-ASCII paths arrive literally (no octal-escaped quoting to undo).
 */
export function parsePorcelainEntries(stdout: string): PorcelainEntry[] {
  const out: PorcelainEntry[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.length <= 3) continue; // '' or a truncated line
    const status = line.slice(0, 2);
    let p = line.slice(3);
    const arrow = p.indexOf(' -> ');
    if (arrow !== -1) p = p.slice(arrow + 4);
    if (p.length > 0) out.push({ path: p, status });
  }
  return out;
}

/** Parse `git status --porcelain` (v1) output into repo-relative paths only. */
export function parsePorcelainPaths(stdout: string): string[] {
  return parsePorcelainEntries(stdout).map((e) => e.path);
}

/**
 * True for a deletion the copy-based lane cannot represent by copying (the file
 * is gone from disk): a worktree deletion (`' D'`) or a staged deletion (`'D '`).
 * These are `git rm`'d in the lane worktree instead of copied.
 */
function isDeletionStatus(status: string): boolean {
  return status === ' D' || status === 'D ';
}

/**
 * The command: gather docs-corpus changes, confirm (consent), then open a
 * `docs-lane` PR from a throwaway worktree. Returns a typed {@link PushDocsResult}
 * (also surfaced as an advisory toast). NEVER rejects (INV-4).
 *
 * @param folderArg optional explicit workspace folder (tests / programmatic use);
 *                  omitted → resolved interactively via {@link resolveTargetFolder}.
 * @param deps      injectable git/gh runner (defaults to a real bounded runner).
 */
export async function pushDocsLaneCommand(
  folderArg?: string,
  deps: PushDocsDeps = {},
): Promise<PushDocsResult> {
  const run = deps.run ?? defaultExecRun();
  try {
    const folder = folderArg ?? (await resolveTargetFolder());
    // resolveTargetFolder already toasts the zero-folder case and returns
    // undefined for a cancelled pick — either way, nothing more to say.
    if (!folder) return { outcome: 'no-folder' };

    // ── Local probes (no network — INV-1) ──────────────────────────────────────
    // 1. Repo guard.
    try {
      const inside = (await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: folder })).stdout.trim();
      if (inside !== 'true') return await surface({ outcome: 'not-a-repo' });
    } catch (err) {
      if (isEnoent(err)) return await surface({ outcome: 'failed', error: 'git executable not found' });
      return await surface({ outcome: 'not-a-repo' });
    }

    // 2. Detached-HEAD guard — a docs-lane branch off a detached HEAD would carry
    //    a misleading base/name; refuse (never a false success).
    try {
      const ref = (await run('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: folder })).stdout.trim();
      if (!ref) return await surface({ outcome: 'detached-head' });
    } catch {
      return await surface({ outcome: 'detached-head' });
    }

    // 3. Repo root (the CLI's `$root`) — all copy/status ops are relative to it.
    let root: string;
    try {
      root = (await run('git', ['rev-parse', '--show-toplevel'], { cwd: folder })).stdout.trim();
    } catch (err) {
      return await surface({ outcome: 'failed', error: describeError(err) });
    }
    if (!root) return await surface({ outcome: 'not-a-repo' });

    // 4. Origin remote must exist to open a PR (local config read — no network).
    let slug: string | undefined;
    try {
      const originUrl = (await run('git', ['remote', 'get-url', 'origin'], { cwd: root })).stdout.trim();
      if (!originUrl) return await surface({ outcome: 'no-origin' });
      slug = slugFromOriginUrl(originUrl);
    } catch {
      return await surface({ outcome: 'no-origin' });
    }

    // 5. Short HEAD sha for the branch name (local).
    let shortSha: string;
    try {
      shortSha = (await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: root })).stdout.trim();
    } catch (err) {
      return await surface({ outcome: 'failed', error: describeError(err) });
    }

    // 6. Gather working-tree changes limited to the docs corpus (local — INV-2).
    //    core.quotePath=false so non-ASCII paths come through literally. Split
    //    into adds/modifies (present on disk — copied into the worktree) and
    //    deletions (gone from disk — `git rm`'d there instead, since a deleted
    //    path has nothing to copy but is still a representable docs-lane change).
    let files: string[];
    let addFiles: string[];
    let deletedFiles: string[];
    try {
      const status = (
        await run('git', ['-c', 'core.quotePath=false', 'status', '--porcelain'], { cwd: root })
      ).stdout;
      const docs = parsePorcelainEntries(status).filter((e) => isDocsCorpusPath(e.path));
      deletedFiles = docs.filter((e) => isDeletionStatus(e.status)).map((e) => e.path);
      addFiles = docs
        .filter((e) => !isDeletionStatus(e.status))
        .map((e) => e.path)
        .filter((f) => {
          try {
            return fs.existsSync(path.join(root, f));
          } catch {
            return false;
          }
        });
      files = [...addFiles, ...deletedFiles];
    } catch (err) {
      return await surface({ outcome: 'failed', error: describeError(err) });
    }
    if (files.length === 0) return await surface({ outcome: 'no-docs-changes' });

    // ── Consent gate (FR-3 / INV-1) — the last step before ANY network ─────────
    const confirmed = await confirmPush(files);
    if (!confirmed) return await surface({ outcome: 'cancelled' });

    const n = files.length;
    const message = await promptMessage(n);
    if (message === undefined) return await surface({ outcome: 'cancelled' });

    // ── Network (all consented) ────────────────────────────────────────────────
    // Pre-flight gh so a missing/unauthenticated CLI fails BEFORE any git mutation,
    // leaving nothing to clean up. Distinct outcomes per SPEC-039 FR-6.
    try {
      await run('gh', ['auth', 'status'], { cwd: root });
    } catch (err) {
      if (isEnoent(err)) return await surface({ outcome: 'gh-absent' });
      const msg = describeError(err);
      if (isNetworkError(msg)) return await surface({ outcome: 'offline', error: msg });
      return await surface({ outcome: 'gh-unauthenticated', error: msg });
    }

    // Refresh origin/main so the worktree branches off the current tip.
    try {
      await run('git', ['fetch', 'origin', 'main'], { cwd: root });
    } catch (err) {
      const msg = describeError(err);
      return await surface({ outcome: isNetworkError(msg) ? 'offline' : 'failed', error: msg });
    }

    const branch = `docs-lane/${shortSha}-${n}`;
    // A fresh, unique temp dir; git creates the `wt` child worktree inside it.
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-docs-lane-'));
    const wt = path.join(tmpBase, 'wt');
    try {
      // Worktree off origin/main — never touches the primary HEAD/index (INV-3).
      try {
        await run('git', ['worktree', 'add', '-q', '-b', branch, wt, 'origin/main'], { cwd: root });
      } catch (err) {
        return await surface({ outcome: 'failed', error: describeError(err) });
      }

      // Copy each add/modify docs file from the primary working tree into the worktree.
      for (const f of addFiles) {
        const dst = path.join(wt, f);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(root, f), dst);
      }

      // Stage EXACTLY these paths (literal pathspecs via the runner env) — never a
      // blanket `add -A`, so nothing incidental is ever committed (INV-2).
      if (addFiles.length > 0) {
        try {
          await run('git', ['add', '--', ...addFiles], { cwd: wt });
        } catch (err) {
          return await surface({ outcome: 'failed', error: describeError(err) });
        }
      }

      // `git rm` the deletions — there's nothing on disk to copy. `--ignore-unmatch`
      // keeps an already-absent-on-origin/main path (e.g. added then deleted before
      // ever landing) a no-op instead of a hard failure.
      if (deletedFiles.length > 0) {
        try {
          await run('git', ['rm', '-q', '--ignore-unmatch', '--', ...deletedFiles], { cwd: wt });
        } catch (err) {
          return await surface({ outcome: 'failed', error: describeError(err) });
        }
      }

      // Nothing differs from origin/main → already-pushed docs; report, don't
      // create an empty commit. `diff --cached --quiet` rejects when there IS a delta.
      let hasDelta = false;
      try {
        await run('git', ['diff', '--cached', '--quiet'], { cwd: wt });
      } catch {
        hasDelta = true;
      }
      if (!hasDelta) return await surface({ outcome: 'no-delta', files });

      try {
        // DR_INDEX_GATE_OFF=1 (NOT --no-verify): the ephemeral worktree has no
        // node_modules / built @aiclarity/shared, so ONLY `.githooks/pre-commit`'s
        // `npm run validate` step crashes on module load (a require error). That step
        // has this dedicated kill-switch, and it is the exactly-right scope: the same
        // `npm run validate` is re-run and REQUIRED on the docs-lane PR by `ci.yml`'s
        // `lint` job. Using the targeted env instead of `--no-verify` KEEPS the two
        // pure-bash gates active (both run fine without node_modules): the DR-029
        // born-`proposed` gate — load-bearing, since the lane pushes
        // `docs/decisions/DR-*.md` — and the commit-msg RCDD gate. No invariant hole.
        await run('git', ['commit', '-m', message], { cwd: wt, env: { DR_INDEX_GATE_OFF: '1' } });
      } catch (err) {
        // A live hook rejection — DR-029 born-`proposed` on a bad new DR, or commit-msg
        // RCDD on a `fix:` subject (both still run; only the deps-crashing validate step
        // is skipped via DR_INDEX_GATE_OFF) — or a plain git error. Surface it.
        return await surface({ outcome: 'failed', error: describeError(err) });
      }

      try {
        await run('git', ['push', '-q', '-u', 'origin', branch], { cwd: wt });
      } catch (err) {
        const msg = describeError(err);
        return await surface({ outcome: isNetworkError(msg) ? 'offline' : 'failed', error: msg });
      }

      // Open the PR. Run in the worktree so gh can infer the repo from origin;
      // pass --repo when we could parse the slug (belt and braces).
      const body =
        'Docs-only change via the **docs-lane** (auto-merges once green; ai-review still runs). Files:\n' +
        files.map((f) => `- \`${f}\``).join('\n');
      // The ONE `gh pr create` in the codebase (SPEC-050 FR-4). The argv it
      // builds for these inputs is byte-identical to the literal array this call
      // replaced, and its ENOENT → auth → network → failed classification is the
      // same arm moved verbatim — so this is a pure rewire, not a behaviour
      // change (AC-10). `adoptExisting` is left at its `false` default on
      // purpose: this command never probed `gh pr list`, and adding that call
      // here would BE a behaviour change.
      const pr = await openPullRequest({
        run,
        cwd: wt,
        slug,
        base: 'main',
        head: branch,
        title: message,
        body,
        labels: [DOCS_LANE_LABEL],
      });
      // 'adopted' is unreachable with adoptExisting:false, but is handled rather
      // than assumed away — a success is a success, and an unhandled member of
      // the union would fall through to the failure surface and report a PR that
      // does exist as one that does not.
      if (pr.outcome === 'created' || pr.outcome === 'adopted') {
        return await surface({ outcome: 'pushed', prUrl: pr.url, files, branch });
      }
      return await surface({ outcome: pr.outcome, error: pr.error });
    } finally {
      // Remove the worktree and its temp dir — best-effort, never throws (INV-4).
      try {
        await run('git', ['worktree', 'remove', '--force', wt], { cwd: root });
      } catch {
        // ignore — pruned below / rm handles a partial add
      }
      try {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      } catch {
        // ignore — leftover temp dir is harmless
      }
    }
  } catch (err) {
    // INV-4 backstop: anything unexpected still degrades to a typed advisory.
    return await surface({ outcome: 'failed', error: describeError(err) });
  }
}

/**
 * Modal confirmation (FR-3): surface the exact file list AND that this opens a PR
 * (a network action) before any wire traffic. Returns true only when the user
 * clicked {@link CONFIRM_LABEL}. Non-modal cancel (Escape / dismiss) → false.
 */
async function confirmPush(files: string[]): Promise<boolean> {
  const detail =
    files.map((f) => `• ${f}`).join('\n') +
    '\n\nThis opens a pull request on GitHub (a network action).';
  const choice = await vscode.window.showWarningMessage(
    `MinSpec: push ${files.length} docs file(s) via the docs-lane?`,
    { modal: true, detail },
    CONFIRM_LABEL,
  );
  return choice === CONFIRM_LABEL;
}

/**
 * Prompt for the commit/PR message, pre-filled with the FR-4 default. Returns the
 * message, or undefined when the user cancelled (Escape) — which the caller treats
 * as 'cancelled' with no network. A provided blank falls back to the default.
 */
async function promptMessage(n: number): Promise<string | undefined> {
  const fallback = `docs: update ${n} file(s) via docs-lane`;
  const value = await vscode.window.showInputBox({
    prompt: 'Commit / PR message',
    value: fallback,
    ignoreFocusOut: true,
  });
  if (value === undefined) return undefined;
  return value.trim() || fallback;
}

/**
 * Fold an outcome into its advisory toast and return it unchanged. The ONLY place
 * that talks to the user, so every path produces exactly one (or zero) messages.
 * Info for the benign outcomes, warning for the degrade cases; 'cancelled' and
 * 'no-folder' are silent (the user cancelled, or resolveTargetFolder already spoke).
 */
async function surface(result: PushDocsResult): Promise<PushDocsResult> {
  const { outcome } = result;
  switch (outcome) {
    case 'pushed': {
      const choice = await vscode.window.showInformationMessage(
        `MinSpec: opened docs-lane PR — ${result.prUrl}`,
        OPEN_PR_LABEL,
      );
      if (choice === OPEN_PR_LABEL && result.prUrl) {
        void vscode.env.openExternal(vscode.Uri.parse(result.prUrl));
      }
      break;
    }
    case 'no-docs-changes':
      void vscode.window.showInformationMessage('MinSpec: no docs changes to push.');
      break;
    case 'no-delta':
      void vscode.window.showInformationMessage(
        'MinSpec: docs already match origin/main — nothing to push.',
      );
      break;
    case 'not-a-repo':
      void vscode.window.showWarningMessage('MinSpec: not a git repository — nothing to push.');
      break;
    case 'detached-head':
      void vscode.window.showWarningMessage(
        'MinSpec: detached HEAD — switch to a branch to push docs via the lane.',
      );
      break;
    case 'no-origin':
      void vscode.window.showWarningMessage(
        "MinSpec: no 'origin' remote — cannot open a docs-lane PR.",
      );
      break;
    case 'gh-absent':
      void vscode.window.showWarningMessage(
        'MinSpec: GitHub CLI (gh) not found — install it to open a docs-lane PR.',
      );
      break;
    case 'gh-unauthenticated':
      void vscode.window.showWarningMessage(
        "MinSpec: GitHub CLI not authenticated — run 'gh auth login', then retry.",
      );
      break;
    case 'offline':
      void vscode.window.showWarningMessage(
        'MinSpec: network unavailable — could not reach GitHub. Try again when online.',
      );
      break;
    case 'failed':
      if (result.error) console.warn(`MinSpec: push-docs-lane failed — ${result.error}`);
      void vscode.window.showWarningMessage(
        `MinSpec: could not open docs-lane PR — ${(result.error ?? 'git/gh error').split('\n')[0]} (see console).`,
      );
      break;
    // 'cancelled' | 'no-folder' — intentionally silent.
    default:
      break;
  }
  return result;
}
