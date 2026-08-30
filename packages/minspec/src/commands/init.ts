import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  scaffold,
  generateHarnessFiles,
  refreshHarnessFiles,
  rescaffoldManagedRegionFile,
  untrackedNoticeMessage,
  type ManagedRegionWarning,
} from '../lib/scaffold';
import { TEMPLATE_NAMES, TEMPLATE_OUTPUT_PATHS, MANAGED_REGION_TEMPLATES } from '../lib/template-registry';
import { CLAUDE_SETTINGS_PATH } from '../lib/claude-settings';
import { resolveTargetFolder, workspaceFolderLabel } from '../lib/resolve-folder';
import { setCoverageMinimum, DEFAULT_COVERAGE_MINIMUM } from '../lib/config';
import { getRepoFromRemote } from '../lib/github';
import {
  resolveRemotes,
  renameToOriginCandidate,
  githubSlugFromUrl,
  type RemoteResolution,
} from '../lib/git-remotes';
import {
  type CommandRunner,
  RULESET_DOCS_URL,
  REPO_CREATE_DOCS_URL,
  DEFAULT_REQUIRED_CHECK_CONTEXTS,
  createRequiredChecksRuleset,
  defaultCommandRunner,
  probeGhReadiness,
  resolveCheckContexts,
  listRequiredCheckContexts,
  probeReviewerConfigured,
  updateRulesetRequiredChecks,
  resolveTieredRequiredChecks,
  detectCodeChecks,
  classifyForbidden,
  AI_REVIEW_CHECK,
  READY_TO_MERGE_CHECK,
  probeOwnerCandidates,
  createGitHubRepo,
  isSafeRepoSegment,
  checkRepoSegment,
  describeRepoSegmentRejection,
  MAX_REPO_SEGMENT_LENGTH,
  type GhReadiness,
  type ForbiddenShape,
  type RepoOwnerCandidate,
  type CreateRepoResult,
  type CreateRepoFailure,
  type OwnerProbe,
} from '../lib/ruleset-advisor';

// SPEC-025 FR-6's advisory is NOT emitted from here (#1546). It has exactly one
// producer, `surfaceConstitutionProposeNudge` in extension.ts, which carries the
// offer-to-fix actions and honours the per-workspace "Don't ask again" flag.
//
// The emitter that used to live here was a bare, actionless toast that could not read
// that flag — it took only a folder path, never an ExtensionContext — so it reinstated
// a dismissed nudge on every init and refresh. It was also guaranteed-true noise:
// init has just written the constitution from a template, so "no human-authored rules
// yet" cannot be false at that instant, and the message landed in the middle of the
// other init toasts carrying no information and no way to act.

// ---------------------------------------------------------------------------
// Post-init "what to commit" hint + offer (#222)
// ---------------------------------------------------------------------------

/** Dedicated commit message for the scaffolded SDD structure. */
export const SCAFFOLD_COMMIT_MESSAGE = 'chore: scaffold MinSpec SDD structure';

/**
 * Dedicated commit message for a harness *refresh*. Distinct from
 * {@link SCAFFOLD_COMMIT_MESSAGE} so a refresh commit reads as what it is and
 * matches the existing `chore: refresh MinSpec harness …` history convention.
 * Used when the commit offer is reached from `initRefreshCommand` rather than
 * `initCommand` — closing the init-offers-but-refresh-strands asymmetry.
 */
export const REFRESH_COMMIT_MESSAGE = 'chore: refresh MinSpec harness files';

/** Toast action label that triggers the dedicated scaffold/refresh commit. */
const COMMIT_ACTION = 'Commit them';
/** Offered instead of {@link COMMIT_ACTION} when HEAD is the default branch. */
const BRANCH_COMMIT_ACTION = 'Commit on a new branch';
/** Escape hatch for a project whose default branch accepts direct commits. */
const COMMIT_ANYWAY_ACTION = 'Commit here anyway';

/**
 * Paths MinSpec init/refresh is responsible for writing. These are pathspecs
 * (relative to the project root) that `git add` can stage directly.
 *
 * Every entry is a single FILE, never a directory (#607). A directory
 * pathspec like `.minspec` or `.claude/commands` stages EVERYTHING under it —
 * including genuinely user-authored content MinSpec never wrote, e.g. a WIP
 * spec draft under `.minspec/specs/`. On the refresh path (which runs
 * repeatedly against active, long-lived projects, not just a fresh scaffold)
 * that sweeps unrelated dirty content into the `chore: refresh MinSpec harness
 * files` commit. Listing each managed output file individually preserves the
 * "commit only what MinSpec touched" property regardless of what else happens
 * to be dirty alongside it.
 *
 * The managed files MinSpec DOES author but that do not come from the template
 * registry — `.minspec/config.json` (scaffold() writes it and setCoverageMinimum
 * persists the coverage choice into it; CI/vitest read it) and the epic registry's
 * marker-bounded `docs/epics/INDEX.md` (writeEpicIndex, at the DEFAULT `epicsDir`
 * a fresh init uses; a custom `epicsDir` is rarer and the existsSync filter simply
 * skips the miss) — are listed here EXPLICITLY (as files), so they ride the
 * scaffold commit without sweeping a directory. Omitting them left MinSpec-written,
 * non-gitignored files untracked after "Commit them" (#610).
 *
 * The harness output paths come from the template registry: the
 * section-merge templates (CLAUDE.md, AGENTS.md, .cursorrules,
 * .minspec/constitution.md) plus the managed-region templates (CI workflow,
 * git hooks, and the tool-gated Spec Kit slash-command shims), and
 * `.gitignore` (init/refresh append the ephemeral-state entries).
 */
const SCAFFOLD_PATHSPECS: readonly string[] = [
  '.gitignore',
  // scaffold()-authored, non-template, non-gitignored managed files (#610).
  '.minspec/config.json',
  'docs/epics/INDEX.md',
  // Section-merge harness files rendered at the project root / .minspec.
  ...TEMPLATE_NAMES.map((name) => TEMPLATE_OUTPUT_PATHS[name]),
  // Managed-region templates — each its own file, never the containing
  // directory, so an unrelated file a user placed alongside them (e.g. a
  // hand-written .claude/commands/my-own-command.md) is never swept in.
  ...MANAGED_REGION_TEMPLATES.map((tpl) => tpl.outputPath),
  // The hook REGISTRATION, not just the hook (#1301). Scaffolding
  // `.claude/hooks/session-title.{sh,py}` is only half the job — a Claude Code
  // hook does nothing until it is listed under the event that fires it, and that
  // listing is the `UserPromptSubmit` entry init/refresh merges into
  // `.claude/settings.json` (claude-settings.ts, #1093 / DR-073). Omitting it
  // here shipped a commit containing a present-but-INERT hook and left the
  // registration dirty with no further prompt.
  //
  // "MinSpec does not own this file" is true but is not a reason to exclude it:
  // CLAUDE.md, AGENTS.md and .cursorrules are equally user-authored and
  // section-merged, and all three are staged. Ownership is handled by HOW the
  // file is written (additive, idempotent, never-clobbers — DR-073), not by
  // declining to commit what MinSpec just wrote into it.
  CLAUDE_SETTINGS_PATH,
  // DELIBERATELY ABSENT: .minspec/generated-hashes.json and
  // .minspec/template-baseline.json. An earlier revision of this list included
  // them, on the theory that a refresh commit was partial without the manifests
  // it rewrites. That theory was built on a broken observation — the manifests
  // appeared dirty after every refresh because both repos TRACKED them, despite
  // MINSPEC_GITIGNORE_ENTRIES declaring them machine-local and both .gitignores
  // listing them. Git does not apply .gitignore to an already-indexed path, so
  // those rules were inert (#1103, AIClarityAU/sealbox#33).
  //
  // Correctly ignored, they are never dirty and there is nothing to sweep up.
  // They are per-machine derived state: committing them makes one developer's
  // refresh look like drift on every other clone.
];

/**
 * Of the paths MinSpec scaffolds, the subset that actually exists on disk in
 * `folder`. Pure (no git, no toast) so it is unit-testable and so we never ask
 * git to stage a pathspec that isn't there.
 */
export function collectScaffoldPaths(folder: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rel of SCAFFOLD_PATHSPECS) {
    if (seen.has(rel)) continue;
    if (fs.existsSync(path.join(folder, rel))) {
      seen.add(rel);
      out.push(rel);
    }
  }
  return out;
}

/**
 * Of the paths MinSpec scaffolds/refreshes, the subset that is CURRENTLY
 * uncommitted (#758). Distinct from {@link collectScaffoldPaths}, which only
 * asks "does this managed file exist on disk" — a file can exist and already
 * be committed (nothing to offer). This is what a recoverable "harness
 * uncommitted" affordance (status bar, re-invokable command) polls, since the
 * one-shot toast from {@link offerScaffoldCommit} is easy to miss and leaves
 * no trace once dismissed.
 *
 * Best-effort and silent on any failure (not a repo, no committer, git
 * error) — returns `[]`, mirroring {@link offerScaffoldCommit}'s own guards.
 */
export async function collectDirtyScaffoldPaths(
  folder: string,
  deps: OfferScaffoldCommitDeps = {},
): Promise<string[]> {
  if (!fs.existsSync(path.join(folder, '.git'))) return [];
  const paths = collectScaffoldPaths(folder);
  if (paths.length === 0) return [];
  try {
    const make = deps.makeCommitter ?? defaultCommitter;
    const committer = await make(folder);
    if (!(await committer.isRepo())) return [];
    return await committer.dirty(paths);
  } catch {
    return [];
  }
}

/**
 * The minimal git surface the commit-offer needs. Defined as an interface so
 * tests can inject a stub instead of shelling out to a real repository.
 */
export interface ScaffoldCommitter {
  /** Whether `folder` is inside a git working tree. */
  isRepo(): Promise<boolean>;
  /**
   * Stage the given pathspecs, skipping any git ignores. Callers pass the
   * managed set verbatim; whether a given manifest is tracked differs per
   * project, and one ignored path must never fail the whole commit.
   */
  add(paths: readonly string[]): Promise<void>;
  /** Create a single commit with `message` (staged content only). */
  commit(message: string): Promise<void>;
  /**
   * The branch this commit would land on, and the repo's default branch — or
   * `null` when either cannot be determined (detached HEAD, no origin/HEAD).
   *
   * Committing onto a push-protected default branch produces a commit that can
   * never be pushed, and the failure does not surface until `git push`, by
   * which point the work is already in branch history. The offer needs to know
   * the destination BEFORE it writes, not after.
   *
   * Optional so an existing stub committer stays valid: a committer that does
   * not implement it is treated as "destination unknown", which preserves the
   * previous behaviour exactly rather than blocking on missing information.
   */
  branchInfo?(): Promise<{ current: string; default: string } | null>;
  /** Create and switch to `name`, so the commit lands somewhere pushable. */
  createBranch?(name: string): Promise<void>;
  /**
   * Whether a local branch called `name` already exists.
   *
   * {@link createBranch} is create-only (`git checkout -b`), so handing it a
   * taken name is a hard error, not a fallback. Refresh is a RECURRING
   * operation and its branch name was a CONSTANT, so the first refresh in a
   * repo created the branch, its PR merged, the local ref survived (merged
   * branches are not auto-deleted; a deleted remote only marks the local ref
   * `[gone]`), and every later refresh collided — the offer dead-ended with
   * the tree still dirty and no alternative name (#1298).
   *
   * Optional for the same reason `branchInfo` is: a committer that does not
   * implement it is treated as "cannot tell", and cannot-tell falls through to
   * the base name, which is exactly the previous behaviour.
   */
  branchExists?(name: string): Promise<boolean>;
  /**
   * Of `paths`, which currently show uncommitted changes (staged, unstaged, or
   * untracked) per `git status`. Used to decide whether the recoverable commit
   * offer (#758) has anything to do — a scaffolded path that's already
   * committed (or was never dirty) is not reported.
   */
  dirty(paths: readonly string[]): Promise<string[]>;
}

/**
 * Branch names treated as "probably the default" when `origin/HEAD` is absent.
 *
 * Reads the SAME `minspec.protectedBranches` setting commit-on-approve consumes, so
 * a user who renames their default branch configures it once and every guard agrees.
 * The generated pre-commit hook reads the git-config twin of that key
 * (template-registry.ts, `guard_candidates`) and falls back to the same three names.
 *
 * All three now agree on `['main','master','trunk']`. They did not before: the
 * package.json default was `['main','master']` while the hook's fallback carried
 * `trunk`, so in a VS Code host `get()` returned the package.json default and `trunk`
 * protection existed ONLY in the hook — a repo defaulting to `trunk` was guarded at
 * commit time but never warned by this offer. Aligned in package.json rather than by
 * dropping `trunk` here: a false negative silently reinstates the stranding bug,
 * while a false positive only offers a branch the user can decline.
 *
 * Outside a VS Code host (tests, Tier-0 callers) `getConfiguration` is unavailable,
 * so fall back to the same literal list.
 */
function conventionalDefaultBranches(): string[] {
  try {
    return vscode.workspace
      .getConfiguration('minspec')
      .get<string[]>('protectedBranches', ['main', 'master', 'trunk']);
  } catch {
    return ['main', 'master', 'trunk'];
  }
}

/**
 * Default committer — wraps simple-git, lazily imported to keep init lean.
 *
 * Exported for tests: every other test in this area injects a stub, which meant the
 * real `add()` ignore-filter and `branchInfo()` resolution had no execution coverage
 * at all. That is the exact shape of the #1057 fault, where a guard shipped inert
 * because its fixture manufactured an `origin/HEAD` the real repos did not have.
 */
export async function defaultCommitter(folder: string): Promise<ScaffoldCommitter> {
  const { simpleGit } = await import('simple-git');
  const git = simpleGit(folder);
  return {
    async isRepo() {
      try {
        return (await git.revparse(['--is-inside-work-tree'])).trim() === 'true';
      } catch {
        return false;
      }
    },
    async add(paths) {
      // Drop ignored paths before staging. `git add` errors on an explicitly
      // named ignored pathspec, which would fail the entire commit over a file
      // the project deliberately does not track.
      let stageable = [...paths];
      try {
        const ignored = new Set(await git.checkIgnore([...paths]));
        if (ignored.size > 0) stageable = stageable.filter((p) => !ignored.has(p));
      } catch {
        // checkIgnore is an optimisation, not a gate — if it cannot run, fall
        // through and let git decide.
      }
      if (stageable.length === 0) return;
      await git.add(stageable);
    },
    async commit(message) {
      await git.commit(message);
    },
    async branchInfo() {
      try {
        const current = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
        if (!current || current === 'HEAD') return null; // detached — no branch to strand
        // origin/HEAD is a LOCAL ref written by clone / remote set-head, so this
        // stays offline and never contacts the forge (Tier-0).
        let def = '';
        try {
          const ref = (await git.revparse(['--abbrev-ref', 'origin/HEAD'])).trim();
          const parsed = ref.replace(/^origin\//, '');
          if (parsed && parsed !== 'origin') def = parsed;
        } catch {
          // Not populated in every clone — fall through to the name fallback.
        }

        // origin/HEAD is absent more often than it looks: it was missing in both
        // repos this guard was built for, which made the equivalent hook-side
        // check inert. Fall back to conventional names, but only when an origin
        // remote exists — a repo with nothing to push to cannot have a
        // push-protected branch, so a local-only project is never flagged.
        if (!def) {
          let hasOrigin = false;
          try {
            hasOrigin = Boolean((await git.getConfig('remote.origin.url')).value);
          } catch {
            hasOrigin = false;
          }
          if (!hasOrigin) return null;
          if (!conventionalDefaultBranches().includes(current)) return null;
          def = current;
        }
        return { current, default: def };
      } catch {
        // Unknown destination fails OPEN: the offer behaves exactly as it did
        // before rather than blocking a repo we cannot reason about.
        return null;
      }
    },
    async createBranch(name) {
      await git.checkout(['-b', name]);
    },
    async branchExists(name) {
      try {
        // `--verify --quiet` prints the sha and exits 0 when the ref resolves,
        // and exits 1 with no output when it does not. simple-git surfaces the
        // non-zero exit as a throw, so both outcomes are covered.
        const sha = await git.raw(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
        return sha.trim().length > 0;
      } catch {
        // A ref that cannot be resolved is the ordinary "does not exist" case.
        // Any other git failure lands here too, and reporting "free" is the
        // safe read: the caller then tries the base name and, if that really is
        // taken, `createBranch` fails exactly as it did before this probe
        // existed. Guessing "taken" would instead push every repo onto a
        // suffixed branch it never needed.
        return false;
      }
    },
    async dirty(paths) {
      if (paths.length === 0) return [];
      try {
        const status = await git.status(['--', ...paths]);
        return status.files.map((f) => f.path);
      } catch {
        // Best-effort: an unreadable status means we can't prove anything is
        // dirty, so report nothing rather than throw.
        return [];
      }
    },
  };
}

/** Dependencies for {@link offerScaffoldCommit}, injectable for tests. */
export interface OfferScaffoldCommitDeps {
  /** Build the git committer for the folder. */
  makeCommitter?: (folder: string) => Promise<ScaffoldCommitter>;
  /**
   * Which write-path is offering the commit. `'scaffold'` (default, from
   * `initCommand`) vs `'refresh'` (from `initRefreshCommand`) — selects the
   * toast wording and the dedicated commit message ({@link SCAFFOLD_COMMIT_MESSAGE}
   * vs {@link REFRESH_COMMIT_MESSAGE}). Everything else (pathspecs, staging,
   * best-effort handling) is identical, so init and refresh can never again
   * diverge on WHETHER they offer to commit — only on the label.
   */
  variant?: 'scaffold' | 'refresh';
  /**
   * `YYYY-MM-DD` used to disambiguate a taken branch name. Injectable purely so
   * tests can assert the exact branch created without depending on the clock.
   */
  today?: string;
}

/**
 * After init, surface a NON-MODAL toast that summarizes the scaffolded files
 * and OFFERS to commit them in a single dedicated commit (#222). Accept →
 * stages exactly the scaffolded paths and makes ONE commit. Decline / dismiss
 * → no-op. Keyboard-friendly (a plain notification action) and best-effort:
 * any failure is surfaced as a warning but never breaks the init result.
 *
 * Skips silently when the folder is not a git repository (nothing to commit
 * into) or when no scaffolded paths exist on disk.
 */
export async function offerScaffoldCommit(
  folder: string,
  deps: OfferScaffoldCommitDeps = {},
): Promise<void> {
  // Cheap guard: no `.git` → not a repo → nothing to offer. Avoids shelling out
  // to git at all (and keeps non-repo init flows toast-free).
  if (!fs.existsSync(path.join(folder, '.git'))) return;

  const paths = collectScaffoldPaths(folder);
  if (paths.length === 0) return;

  let committer: ScaffoldCommitter;
  try {
    const make = deps.makeCommitter ?? defaultCommitter;
    committer = await make(folder);
    if (!(await committer.isRepo())) return;
  } catch {
    // If we can't even build/probe the committer, stay silent — the offer is
    // advisory and must never break init.
    return;
  }

  const refresh = deps.variant === 'refresh';
  const verb = refresh ? 'refreshed' : 'scaffolded';
  const commitMessage = refresh ? REFRESH_COMMIT_MESSAGE : SCAFFOLD_COMMIT_MESSAGE;
  const committedNoun = refresh ? 'the refreshed harness files' : 'the scaffolded SDD structure';

  const summary = paths.join(', ');

  // Where would this commit land? A default branch is normally push-protected,
  // so committing there produces a commit that can never be pushed — and the
  // user does not find out until `git push`, by which time the work is in
  // branch history and needs branch surgery to recover. Offer a branch instead
  // of quietly writing somewhere unpushable.
  const branch = await safeBranchInfo(committer);
  const onDefaultBranch = branch !== null && branch.current === branch.default;

  if (onDefaultBranch) {
    const choice = await vscode.window.showWarningMessage(
      `MinSpec ${verb}: ${summary}. You are on '${branch.current}', this project's default branch — ` +
        'a commit there usually cannot be pushed. Commit on a new branch instead?',
      BRANCH_COMMIT_ACTION,
      COMMIT_ANYWAY_ACTION,
    );
    if (choice === BRANCH_COMMIT_ACTION) {
      // Resolve to a name that is FREE before creating it. `createBranch` is
      // create-only, so a taken name is a hard failure with the tree left dirty
      // and nothing else offered (#1298).
      const name = await safeUniqueBranchName(
        committer,
        harnessBranchName(refresh),
        deps.today ?? todayStamp(),
      );
      try {
        if (!committer.createBranch) throw new Error('committer cannot create branches');
        await committer.createBranch(name);
      } catch (err) {
        vscode.window.showWarningMessage(
          `MinSpec: could not create branch '${name}' — ${describeError(err)}. ` +
            `Nothing was committed; the ${verb} files are still in your working tree.`,
        );
        return;
      }
      await commitOrWarn(committer, paths, commitMessage, `${committedNoun} on '${name}'`);
      return;
    }
    if (choice !== COMMIT_ANYWAY_ACTION) return; // decline / dismiss → no-op
    // Fall through: the user explicitly chose to commit here anyway, which is
    // correct for a project whose default branch is not protected.
  } else {
    const choice = await vscode.window.showInformationMessage(
      `MinSpec ${verb}: ${summary}. Commit them now in a dedicated commit?`,
      COMMIT_ACTION,
    );
    if (choice !== COMMIT_ACTION) return; // decline / dismiss → no-op
  }

  await commitOrWarn(committer, paths, commitMessage, committedNoun);
}

/** `branchInfo()` is advisory — a committer that cannot answer must not break the offer. */
async function safeBranchInfo(
  committer: ScaffoldCommitter,
): Promise<{ current: string; default: string } | null> {
  try {
    return (await committer.branchInfo?.()) ?? null;
  } catch {
    return null;
  }
}

/**
 * How many numbered candidates {@link uniqueBranchName} will try after the
 * dated one. A bound, not a budget: reaching it means something is wrong with
 * the repo (or the probe), and looping forever would hang the offer.
 */
const MAX_BRANCH_SUFFIX = 50;

/** Today as `YYYY-MM-DD`, the disambiguating suffix's date component. */
export function todayStamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The first branch name in the `base` family that `exists` reports as free.
 *
 * `base` → `base-YYYY-MM-DD` → `base-YYYY-MM-DD-2` … The base name is tried
 * FIRST so the common case (a repo refreshing for the first time, or one that
 * pruned its merged branches) still gets the plain, predictable name and no
 * gratuitous suffix churn. The dated form matches the naming these repos
 * already use by hand (`chore/harness-refresh-2026-07-16`) and says when the
 * refresh happened, which the constant name never could.
 *
 * Pure apart from the injected `exists` probe, so the walk is unit-testable
 * without a git repository.
 *
 * @throws when every candidate up to {@link MAX_BRANCH_SUFFIX} is taken,
 * rather than returning a name it knows is unusable. The wrapper turns that
 * into the base name, whose creation then fails LOUDLY with git's own
 * "already exists" — a visible failure, never a silent reuse of a taken ref.
 */
export async function uniqueBranchName(
  base: string,
  exists: (name: string) => Promise<boolean>,
  today: string,
): Promise<string> {
  if (!(await exists(base))) return base;
  const dated = `${base}-${today}`;
  if (!(await exists(dated))) return dated;
  for (let n = 2; n <= MAX_BRANCH_SUFFIX; n += 1) {
    const candidate = `${dated}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(
    `'${base}' and every candidate through '${dated}-${MAX_BRANCH_SUFFIX}' already exist`,
  );
}

/**
 * {@link uniqueBranchName} against a committer whose `branchExists` is optional
 * and best-effort.
 *
 * A committer that cannot probe (older stub, or a git error) yields the base
 * name unchanged — the pre-#1298 behaviour exactly. Failing back to the base
 * name rather than to a suffixed one matters: an unnecessary suffix would
 * scatter branches across every repo that never had a collision, whereas the
 * base name at worst reproduces the original error, which is already reported.
 */
async function safeUniqueBranchName(
  committer: ScaffoldCommitter,
  base: string,
  today: string,
): Promise<string> {
  const probe = committer.branchExists?.bind(committer);
  if (!probe) return base;
  try {
    return await uniqueBranchName(base, probe, today);
  } catch {
    return base;
  }
}

/** Branch name for harness output moved off the default branch. */
export function harnessBranchName(refresh: boolean): string {
  return refresh ? 'chore/minspec-harness-refresh' : 'chore/minspec-scaffold';
}

/** Stage + commit, reporting either outcome. Never throws. */
async function commitOrWarn(
  committer: ScaffoldCommitter,
  paths: readonly string[],
  message: string,
  committedNoun: string,
): Promise<void> {
  try {
    await committer.add(paths);
    await committer.commit(message);
    vscode.window.showInformationMessage(`MinSpec: committed ${committedNoun} ("${message}").`);
  } catch (err) {
    vscode.window.showWarningMessage(
      `MinSpec: could not commit the scaffolded files — ${describeError(err)}. ` +
        'They remain staged/unstaged for you to commit manually.',
    );
  }
}

/**
 * Re-invokable recovery for a MISSED {@link offerScaffoldCommit} toast (#758).
 * The toast fires once, on the init/refresh write-path, and is trivially
 * dismissed or auto-collapsed into the notification center — after that there
 * was previously no way back to it, so the scaffolded/refreshed managed
 * output (which is derived + coupled across several files) could sit dirty
 * indefinitely with no further prompt. This command re-runs the SAME offer
 * (`variant: 'refresh'`, since it's reachable independent of which write-path
 * produced the dirty state) whenever there is something to commit, and says so
 * plainly when there is nothing outstanding — never a silent no-op that reads
 * as "did this do anything?".
 */
export async function commitHarnessRefreshCommand(
  folderArg?: string,
  deps?: OfferScaffoldCommitDeps,
): Promise<void> {
  const folder = folderArg ?? (await resolveTargetFolder());
  if (!folder) return;

  const dirty = await collectDirtyScaffoldPaths(folder, deps);
  if (dirty.length === 0) {
    vscode.window.showInformationMessage(
      'MinSpec: no uncommitted harness/scaffold output to commit.',
    );
    return;
  }

  await offerScaffoldCommit(folder, { ...deps, variant: 'refresh' });
}

// ---------------------------------------------------------------------------
// Post-init branch-ruleset advisory (#356)
// ---------------------------------------------------------------------------

/**
 * Toast action: open a GitHub docs page (the zero-network-path fallback).
 *
 * WHICH page is the caller's to say — {@link linkRulesetDocs} takes it, defaulting
 * to {@link RULESET_DOCS_URL} and overridden with {@link REPO_CREATE_DOCS_URL}
 * everywhere the user has no repository yet. The label stays deliberately generic
 * for that reason: it is one button pointing at whichever page answers the toast
 * it sits on.
 */
const RULESET_DOCS_ACTION = 'View GitHub docs';
/**
 * Create-offer action: WRITE the ruleset via the user's `gh` (the MUTATING
 * action). This click IS the consent for the mutation (DR-050 Amendment
 * 2026-07-01) — the create fires only when the user picks it.
 */
const RULESET_CREATE_ACTION = 'Create ruleset';
/**
 * Add-offer action: WRITE the missing required checks into an EXISTING ruleset
 * (the sealbox case — a ruleset that predates the ai-review/ready-to-merge
 * checks). Like {@link RULESET_CREATE_ACTION}, this click IS the consent for the
 * mutation.
 */
const RULESET_ADD_ACTION = 'Add checks';
/**
 * Repo-create-offer action: create the GitHub repository itself and wire it as
 * this project's `origin` (the MUTATING action, #1694). This click IS the
 * consent for the mutation (DR-050 Amendment 2026-08-25) — nothing creates a
 * repository autonomously.
 */
const REPO_CREATE_ACTION = 'Create GitHub repo';
/**
 * Create-FAILURE action: re-open the name box and try again, keeping the owner
 * and visibility already chosen.
 *
 * The failure this path hits most is a name collision — the box is seeded with the
 * folder's basename and does no existence check — and "re-run the whole command"
 * is not a remedy for a name the user can fix in one keystroke. Each retry is a
 * fresh explicit click, so it is consent per mutation exactly as
 * {@link REPO_CREATE_ACTION} is.
 */
const REPO_RETRY_ACTION = 'Try another name';

// ---------------------------------------------------------------------------
// WHICH COMMAND THE USER ACTUALLY RAN (third correctness review, 2026-08-28)
// ---------------------------------------------------------------------------
//
// `offerRulesetAdvisory` has TWO entry points — `initCommand` and
// `initRefreshCommand`, the latter also reachable from the auto-bootstrap drift
// prompt — and its copy named only the first. A user who arrived from
// "MinSpec: Refresh Harness Files" was repeatedly told to "re-run MinSpec:
// Initialize SDD Structure", which is a different command from the one they used
// and, on a project that is already initialised, not the one they would reach for.
//
// So the invoking command's title is THREADED THROUGH ({@link
// RulesetAdvisoryDeps.invokedBy}) rather than hardcoded, and the fallback names
// BOTH — because a default that names one of two entry points is wrong half the
// time, which is the defect this replaces.

/** Palette title of the command that scaffolds a project. MUST match package.json. */
const INIT_COMMAND_TITLE = 'MinSpec: Initialize SDD Structure';
/** Palette title of the harness-refresh command — the OTHER entry point. MUST match package.json. */
const REFRESH_COMMAND_TITLE = 'MinSpec: Refresh Harness Files';

/**
 * Name the command the user should re-run, from the one they actually ran.
 *
 * `undefined` — a caller that did not say, which today means a test or a future
 * third entry point — falls back to naming BOTH commands. That is longer and it
 * is TRUE, which is the trade this makes deliberately: silently guessing one of
 * two entry points is how the sentence came to be wrong for half of them, and a
 * fallback that can be wrong is worse than one that is wordy.
 */
function reRunPhrase(invokedBy: string | undefined): string {
  return invokedBy ?? `${INIT_COMMAND_TITLE} or ${REFRESH_COMMAND_TITLE}`;
}
/**
 * How many creates ONE offer may issue. Every attempt is separately consented, so
 * the cap is not a consent bound — it is a liveness bound: a toast that always
 * offers the same button can be answered forever, and an advisory that never
 * finishes is a hung init.
 */
const MAX_REPO_CREATE_ATTEMPTS = 3;

// THE CREATE OFFER HAS NO SUPPRESSION FLAG, DELIBERATELY (third correctness
// review, 2026-08-28). One briefly existed — `minspec.repoCreateDeclined`, in git
// config, on the rename advisory's idiom — so that "Not now" would stop asking. It
// was deleted, because that one addition caused three defects at once:
//
//   - the decline was PERMANENT, TOTAL and SILENT. After one click the branch
//     rendered nothing at all: not the offer, and not the zero-network docs link
//     it always had. A button labelled "Not now" promised a later ask that never
//     came, nothing named the flag, and the only way back —
//     `git config --unset minspec.repoCreateDeclined` — could not be learned from
//     inside the product;
//   - the READ was machine-wide while the WRITE was repo-local. `git -C <folder>
//     config --get <key>` with no `--local` also reads global and system config, so
//     one stray value in a user's `~/.gitconfig` disabled the offer in EVERY
//     repository on the machine — a value MinSpec could neither produce nor clear.
//     That is the blast-radius question constitution invariant 3 exists for;
//   - the shipped prose said the flag "travels with the repository". A `git config
//     --local` value is never transferred by `git clone` (measured: exit 1 in the
//     clone), so the sentence was simply false.
//
// Re-offering on each init is the pre-#1694 behaviour, and it is what this branch
// does. If the nag is worth solving, it is its own issue and its own design — not
// a rider on the create offer, and not a flag whose absence is the only state a
// user can reach without a shell.

/** Offer action: decline — make no `gh` write. Shared by all three offers. */
const RULESET_DECLINE_ACTION = 'Not now';
/** Offer action: open the docs instead of writing anything. Shared by all three offers. */
const RULESET_LEARN_MORE_ACTION = 'Learn more';

/**
 * Pattern a resolved `owner/repo` slug MUST match before it is interpolated into
 * a `gh api repos/{owner}/{repo}/...` path. Defense-in-depth: `getRepoFromRemote`
 * already extracts these from a `github.com[:/]<owner>/<repo>` match (so they
 * cannot today contain a slash or path-traversal segment), but asserting the
 * charset locally — right where the value reaches `gh` — keeps the safety
 * property co-located with its use rather than relying on a distant regex.
 */
const REPO_SLUG_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * VS Code setting id for the configurable required-status-check contexts the
 * created ruleset enforces. Read at create time; unset → the default
 * ({@link DEFAULT_REQUIRED_CHECK_CONTEXTS}). Users add e.g. `build` or the
 * opt-in `ready-to-merge` here without a code change.
 */
const REQUIRED_CHECKS_SETTING = 'minspec.ruleset.requiredChecks';

// ---------------------------------------------------------------------------
// Misnamed-remote detection + rename offer (#1545)
// ---------------------------------------------------------------------------

/** Toast action: rename the sole remote to the conventional `origin`. */
const RENAME_REMOTE_ACTION = 'Rename to origin';
/** Toast action: leave the remote alone (and stop asking). */
const KEEP_REMOTE_ACTION = 'Keep as is';

/** workspaceState-free suppression: a git config flag, so it travels with the repo. */
const RENAME_DECLINED_CONFIG = 'minspec.remoteRenameDeclined';

/** Dependencies for {@link offerRemoteRenameAdvisory}, injectable for tests. */
export interface RemoteRenameDeps {
  run?: CommandRunner;
  isRepo?: (folder: string) => boolean;
}

/**
 * Detect a remote that isn't called `origin` and offer to rename it (#1545).
 *
 * `origin` is a convention, not a rule — `git clone` picks it, and a user who runs
 * `git remote add <project-name> <url>` never gets one. Nothing in git cares. But
 * essentially every tool reading "the remote" hardcodes the name, MinSpec included:
 * before this, such a repo was told to add a remote it already had, and its
 * protected-branch guard went silently inert.
 *
 * The resolver ({@link resolveRemotes}) fixes MinSpec's own reads. This offer fixes
 * the REPO, which is strictly more valuable: it repairs every other tool at the same
 * time, and it reaches the places a TypeScript resolver cannot — the scaffolded shell
 * hook, `git push` without arguments, and every downstream script that will ever
 * assume the conventional name.
 *
 * Deliberately narrow, and consent-gated:
 *   - fires ONLY for exactly one remote, pointing at github.com, not already `origin`
 *     ({@link renameToOriginCandidate}). Several remotes, or a non-GitHub one, is
 *     left strictly alone — an offer there is a prompt to break something;
 *   - the rename is the ONLY mutation, and it happens only on an explicit click;
 *   - "Keep as is" records a per-repo git-config flag so the offer never nags again.
 *
 * `git remote rename` is safe and reversible: it rewrites the `remote.<name>.*`
 * config keys and the tracking refspec, and local branches keep their upstreams.
 *
 * Best-effort throughout — any failure is swallowed and never affects init.
 */
export async function offerRemoteRenameAdvisory(
  folder: string,
  deps: RemoteRenameDeps = {},
): Promise<void> {
  const run = deps.run ?? defaultCommandRunner;
  const isRepo = deps.isRepo ?? ((f: string) => fs.existsSync(path.join(f, '.git')));
  if (!isRepo(folder)) return;

  try {
    const declined = await run('git', ['-C', folder, 'config', '--get', RENAME_DECLINED_CONFIG]);
    if (declined.code === 0 && declined.stdout.trim() === 'true') return;

    const state = await resolveRemotes(run, folder);
    const candidate = renameToOriginCandidate(state);
    if (!candidate) return;

    const choice = await vscode.window.showInformationMessage(
      `MinSpec: this repo's only remote is named '${candidate.name}', not 'origin'. ` +
        'Most git tooling — including MinSpec\'s protected-branch guard and the branch-ruleset ' +
        'advisory — looks for a remote called \'origin\', and quietly does nothing without one. ' +
        'Rename it?',
      RENAME_REMOTE_ACTION,
      KEEP_REMOTE_ACTION,
    );

    if (choice === RENAME_REMOTE_ACTION) {
      const renamed = await run('git', ['-C', folder, 'remote', 'rename', candidate.name, 'origin']);
      if (renamed.code === 0) {
        vscode.window.showInformationMessage(
          `MinSpec: renamed remote '${candidate.name}' to 'origin'.`,
        );
      } else {
        // Report the real reason rather than a generic failure — the usual cause is
        // an `origin` that already exists, which the user can act on.
        vscode.window.showWarningMessage(
          `MinSpec: could not rename '${candidate.name}' to 'origin' — ` +
            `${(renamed.stderr || renamed.stdout).trim() || 'git reported no detail'}.`,
        );
      }
    } else if (choice === KEEP_REMOTE_ACTION) {
      await run('git', ['-C', folder, 'config', RENAME_DECLINED_CONFIG, 'true']);
    }
  } catch {
    // best-effort — advisory only; never let it break init.
  }
}

/** Dependencies for {@link offerRulesetAdvisory}, injectable for tests. */
export interface RulesetAdvisoryDeps {
  /** Command runner used for all `gh` invocations. */
  run?: CommandRunner;
  /** Resolve `owner/repo` from the folder's git remote. */
  resolveRepo?: (folder: string) => Promise<string | null>;
  /** Open an external URL (defaults to VS Code's opener). */
  openExternal?: (url: string) => void;
  /**
   * Whether `folder` is a git working tree. Defaults to a cheap `.git`
   * existence check — same guard {@link offerScaffoldCommit} uses to stay
   * toast-free (and gh-free) on non-repo init flows.
   */
  isRepo?: (folder: string) => boolean;
  /**
   * The status-check contexts the CREATED ruleset should require. Defaults to
   * reading the `minspec.ruleset.requiredChecks` setting (see
   * {@link resolveRequiredChecks}); falls back to
   * {@link DEFAULT_REQUIRED_CHECK_CONTEXTS} when unset/malformed. Injectable so
   * tests can assert the configured set is honoured without touching VS Code
   * config.
   */
  requiredChecks?: readonly string[];
  /**
   * Palette title of the command that invoked this advisory, so copy telling the
   * user to re-run something names the command they actually used.
   *
   * Supplied by {@link initCommand} ({@link INIT_COMMAND_TITLE}) and
   * {@link initRefreshCommand} ({@link REFRESH_COMMAND_TITLE}); each sets it AFTER
   * spreading the caller's deps, so it cannot be spoofed into naming the other
   * one. Omitted → {@link reRunPhrase} names both, which is true from either.
   */
  invokedBy?: string;

  // ── repo-create offer (#1694) — injectable so the WHOLE flow is driveable
  //    with no VS Code and no real `gh`. Each defaults to the production path,
  //    exactly as `run` / `resolveRepo` / `openExternal` above do.

  /**
   * Classify what this project's git remotes actually say, for the ONE decision
   * {@link resolveRepo}'s `string | null` cannot carry: is there genuinely no
   * remote, or did resolution decline/fail? Defaults to
   * {@link classifyRemoteDestination}. Only `{ kind: 'none' }` may reach the
   * create offer — see {@link RemoteDestination}.
   */
  classifyRemotes?: (folder: string) => Promise<RemoteDestination>;
  /**
   * Read the accounts a new repository could be created under. Defaults to
   * {@link probeOwnerCandidates}, whose autonomous account read is BRANCH-SCOPED
   * by its caller: it is invoked only from {@link offerRepoCreation}, which is
   * itself reachable only when `gh` is ready AND the remotes classify as
   * {@link RemoteDestination} `none`. That bound is a condition of DR-050's
   * 2026-08-25 amendment, not hardening.
   *
   * Answers with the rows AND `orgsRead` — whether the memberships read completed
   * — because a one-row answer has two causes and the offer must not render the
   * failed one as the empty one.
   */
  probeOwners?: (run: CommandRunner) => Promise<OwnerProbe>;
  /**
   * Create the repository and wire it as `origin`. Defaults to
   * {@link createGitHubRepo}. MUTATION — only ever called after the user's
   * explicit {@link REPO_CREATE_ACTION} click.
   */
  createRepo?: (
    folder: string,
    owner: string | null,
    name: string,
    visibility: 'private' | 'public',
    run: CommandRunner,
  ) => Promise<CreateRepoResult>;
  /**
   * Choose the new repository's visibility. Defaults to a VS Code QuickPick
   * offering private FIRST (so the pre-selected option is the safe one) and
   * public second. `undefined` = the user escaped → create nothing.
   */
  pickVisibility?: () => Promise<'private' | 'public' | undefined>;
  /**
   * Choose which account owns the new repository, from the pre-ranked list
   * {@link probeOwnerCandidates} returns (`candidates[0]` IS the default pick).
   * Defaults to a VS Code QuickPick. `undefined` = escaped → create nothing.
   */
  pickOwner?: (
    candidates: readonly RepoOwnerCandidate[],
  ) => Promise<RepoOwnerCandidate | undefined>;
  /**
   * Ask for the repository name, seeded with the folder's basename. Defaults to
   * a VS Code InputBox validated with {@link isSafeRepoSegment} — the SAME rule
   * {@link createGitHubRepo} re-asserts at the CLI boundary, so the box cannot
   * accept a value the create would then refuse. `undefined` = escaped.
   */
  promptRepoName?: (defaultName: string) => Promise<string | undefined>;
}

/**
 * Resolve the required-status-check contexts for the created ruleset from the
 * `minspec.ruleset.requiredChecks` setting, falling back to
 * {@link DEFAULT_REQUIRED_CHECK_CONTEXTS} when the setting is unset, not an
 * array, or empty. The final normalisation (dedupe / trim / non-empty fallback)
 * is done by {@link resolveCheckContexts} in the pure lib, so an unset setting
 * and a blank one both land on the default. Best-effort: any config read failure
 * degrades to the default.
 */
export function resolveRequiredChecks(): string[] {
  let configured: unknown;
  try {
    configured = vscode.workspace
      .getConfiguration()
      .get<unknown>(REQUIRED_CHECKS_SETTING);
  } catch {
    configured = undefined;
  }
  return resolveCheckContexts(
    Array.isArray(configured) ? (configured as readonly string[]) : undefined,
  );
}

/**
 * Probe the repo + resolve the FULL producible required-check set for it (#564 /
 * SPEC-033 FR-3). Never requires a check the repo cannot yet produce (the #559
 * deadlock): Tier-A (`ai-review`/`ready-to-merge`) only when their workflow files
 * are scaffolded AND ALL the reviewer secrets are configured; Tier-B (`lint`/`test`/
 * `build`) only when `package.json` has a runnable script; plus the user's
 * `minspec.ruleset.requiredChecks` extras.
 *
 * Network posture (Tier-0): the fs reads are local; the reviewer-secret-NAMES
 * probe ({@link probeReviewerConfigured}) is an AUTONOMOUS read-only GET of the
 * repo's OWN Actions-secret NAMES (never values) — the same read-only-config
 * class as the rulesets probe, egressing nothing. It runs here in the detection
 * path with NO consent toast in front of it, on the same basis as
 * {@link hasRequiredChecksRuleset}. This autonomy is authorised by DR-050
 * (Amendment 2026-07-16), which extends the read-only-config-probe carve-out to
 * the `actions/secrets` NAMES read (materialising the founder's decision on #796).
 */
async function resolveWantedChecks(
  folder: string,
  owner: string,
  repo: string,
  run: CommandRunner,
): Promise<string[]> {
  const hasWorkflow = (file: string): boolean =>
    fs.existsSync(path.join(folder, '.github', 'workflows', file));
  let scripts: Record<string, unknown> | null = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
    scripts = pkg && typeof pkg === 'object' ? ((pkg as { scripts?: Record<string, unknown> }).scripts ?? null) : null;
  } catch {
    scripts = null;
  }
  const reviewerConfigured = await probeReviewerConfigured(owner, repo, run);
  return resolveTieredRequiredChecks({
    aiReviewWorkflowScaffolded: hasWorkflow('ai-review.yml'),
    readyToMergeWorkflowScaffolded: hasWorkflow('ready-to-merge.yml'),
    reviewerConfigured,
    codeChecks: detectCodeChecks(scripts),
    userChecks: resolveRequiredChecks(),
  });
}

/**
 * Explain a failed ruleset create/update WITHOUT asserting a cause we have not
 * established.
 *
 * This previously rendered every 403 as "your gh token lacks repo-admin scope".
 * Observed in a real project: a token carrying full `repo` scope, failing because
 * rulesets are unavailable on a private repository on the free plan —
 *
 *     Upgrade to GitHub Pro or make this repository public to enable this feature.
 *
 * The message was confidently wrong, and worse than a vague one: it named a remedy
 * (re-authenticate) that could not possibly work, so acting on it costs time and
 * teaches the user the tool's diagnoses are unreliable.
 *
 * Order matters. The plan limit is checked FIRST because it is a 403 too, and the
 * permission wording would otherwise swallow it. Beyond that we quote GitHub's own
 * `message` rather than paraphrase it, and fall back to a deliberately non-committal
 * phrase when GitHub said nothing quotable — an unexplained failure is an honest
 * report; an invented explanation is not.
 *
 * ...AND THE 403 ARM IS NO LONGER ONE SENTENCE FOR FOUR SHAPES (fifth correctness
 * review, 2026-08-29). `forbidden` is a bool computed from FOUR distinct regexes,
 * and this arm named ONE speculative cause for all of them — "your gh token may
 * lack repo-admin scope" — which is the same defect the paragraph above records
 * being fixed, surviving one level down because the SHAPE was discarded on the way
 * here. Two of the four say something specific: `must have admin` is about the
 * ACCOUNT's role, `resource not accessible` about the TOKEN's permissions, and
 * they send the user to different places. `classifyForbidden` carries the shape,
 * so the arm can say which was observed and the bare 403 can stop guessing
 * altogether — it now names a CHECK ("check that the account can administer this
 * repository") rather than a CAUSE.
 *
 * This arm is reached only when GitHub returned nothing quotable at all; whenever
 * it did, its own words win. `detail` is the raw stdout/stderr both outcome
 * shapes already carry, so nothing new is plumbed to get here.
 */
function describeRulesetFailure(outcome: {
  forbidden: boolean;
  planLimited: boolean;
  reason: string | null;
  detail?: string;
}): string {
  if (outcome.planLimited) {
    return (
      outcome.reason ??
      'rulesets are not available for this repository — private repositories need a paid plan'
    );
  }
  if (outcome.reason) return `GitHub said: ${outcome.reason}`;
  if (outcome.forbidden) return describeForbiddenShape(classifyForbidden(outcome.detail ?? ''));
  return 'the request failed';
}

/**
 * ONE SENTENCE PER FORBIDDEN SHAPE, each asserting only what that shape observed.
 *
 * THE STATUS CODE IS A CLAIM (sixth correctness review, 2026-08-30). `status-403`
 * and the bare word "forbidden" shared one arm, and its sentence said
 * "(HTTP 403)" for both — so `{"error":"Forbidden"}`, which carries no status
 * code anywhere, was reported as a 403 nobody had seen.
 *
 * `null` HAS AN ARM TOO, and it is not the same observation as either. It is
 * reachable because {@link CreateRulesetOutcome} computes `forbidden` from
 * `stdout + stderr` and carries `detail = stderr || stdout` — so a refusal
 * printed only on stdout, alongside anything at all on stderr, is a state where
 * the refusal was established from output this sentence is not reading. Saying
 * "(HTTP 403)" there would be quoting a string that does not contain it.
 */
function describeForbiddenShape(shape: ForbiddenShape | null): string {
  switch (shape) {
    case 'not-admin':
      return (
        'the request was refused — GitHub said the caller must be an admin of this ' +
        'repository, and the account `gh` is signed in as is not'
      );
    case 'resource-not-accessible':
      return (
        'the request was refused — GitHub said this resource is not accessible to the ' +
        'token `gh` is using, so it may not change this repository\'s settings'
      );
    case 'status-403':
      // NAMES A CHECK, NOT A CAUSE. A bare 403 with nothing quotable beside it
      // establishes only that the request was refused; which of scope, role or
      // policy did it is exactly what was not observed.
      return (
        'the request was refused (HTTP 403) and GitHub gave no reason MinSpec could ' +
        'quote — check that the account `gh` is signed in as can administer this repository'
      );
    case 'refusal-unstated':
      // The refusal is in words and the status code is NOT, so the status code is
      // not stated back. Everything else this sentence can offer is unchanged.
      return (
        'the request was refused and GitHub gave no reason MinSpec could quote — check ' +
        'that the account `gh` is signed in as can administer this repository'
      );
    case null:
      // A refusal established from output this sentence does not carry. Name that,
      // and the one command that shows what the account may actually do.
      return (
        'the request was refused, and the output MinSpec could quote carries no reason ' +
        'for it — check that the account `gh` is signed in as can administer this repository'
      );
    default: {
      // EXHAUSTIVENESS. A shape added to {@link ForbiddenShape} without a sentence
      // of its own narrows to something other than `never` and fails typecheck,
      // rather than inheriting a sentence about a 403 it may never have seen.
      const _unhandled: never = shape;
      void _unhandled;
      return 'the request was refused and MinSpec could not establish why';
    }
  }
}

/**
 * Name the ONE thing that is wrong with `gh`, and the ONE command that fixes it.
 *
 * ONE MESSAGE PER REJECTION REASON (fifth correctness review, 2026-08-29). The
 * probe behind this used to answer with a boolean, and the single sentence read
 * "Install/authenticate the `gh` CLI to let MinSpec offer to create one" — a
 * compound instruction of which exactly half applies in each case. A user who has
 * `gh` and is merely signed out was told to install what they already have, and a
 * user with no `gh` at all was told to authenticate a binary that is not there.
 * Neither sentence was false; both made the reader work out which half was theirs,
 * from information MinSpec had already observed and thrown away.
 *
 * `ready` is not a rejection and has no sentence — it is a compile error to ask
 * for one, which is the point of taking {@link GhReadiness} rather than a bool.
 */
function describeGhUnready(readiness: Exclude<GhReadiness, 'ready'>): string {
  switch (readiness) {
    case 'not-installed':
      return 'Install the `gh` CLI to let MinSpec offer to create one';
    case 'not-signed-in':
      return 'Sign in with `gh auth login` to let MinSpec offer to create one';
    default: {
      // EXHAUSTIVENESS: a readiness state added without copy of its own fails
      // typecheck here rather than borrowing a sentence about a different one.
      const _unhandled: never = readiness;
      void _unhandled;
      return 'Set up the `gh` CLI to let MinSpec offer to create one';
    }
  }
}

/**
 * Show an info toast linking the GitHub docs, with a one-click open action.
 *
 * `url` DEFAULTS to the rulesets page and is overridden on the create-repo path
 * ({@link REPO_CREATE_DOCS_URL}), because "Learn more" has to answer the question
 * the toast in front of it asked: a user who has no repository does not need a
 * page about configuring rulesets on one. Every other caller HAS a repository,
 * so the default is right for all of them.
 */
async function linkRulesetDocs(
  message: string,
  openExternal: (url: string) => void,
  url: string = RULESET_DOCS_URL,
): Promise<void> {
  const choice = await vscode.window.showInformationMessage(message, RULESET_DOCS_ACTION);
  if (choice === RULESET_DOCS_ACTION) openExternal(url);
}

// ---------------------------------------------------------------------------
// "No GitHub repo yet" — the create offer (#1694, DR-050 Amendment 2026-08-25)
// ---------------------------------------------------------------------------
//
// BRANCH BOUND FIRST. Nothing in this section may run until
// {@link classifyRemoteDestination} has POSITIVELY established that the project
// has no git remote at all — that bound is a condition of the amendment, not
// hardening, and it is why {@link RemoteDestination} exists.

/**
 * What this project's remotes actually say — the states a `string | null` slug
 * CANNOT distinguish, and the reason this type exists.
 *
 * `getRepoFromRemote` answers "which GitHub repo is this?" with `owner/repo` or
 * `null`, and that `null` covers at least four situations. Three of them have a
 * perfectly real remote:
 *
 *   - several remotes, none named `origin`, naming DIFFERENT GitHub repos —
 *     `githubSlug` REFUSES to guess and returns null (git-remotes.ts `ambiguous`);
 *   - a resolved remote that is not a usable github.com repo — including an
 *     `origin` on another host while some OTHER remote is on github.com, because
 *     a resolved remote wins outright and the others are never consulted;
 *   - the `git config` read itself failing, which `resolveRemotes` reports as
 *     `{ kind: 'none' }` — the same value a repo with no remotes at all produces.
 *
 * Offering to CREATE a repository in any of those is wrong twice over: it is a
 * false statement to a user who has a remote, and DR-050's 2026-08-25 amendment
 * makes "a repo that already has a remote never triggers it" a LOAD-BEARING bound
 * on the account probe rather than a nicety — the probe is authorised only in the
 * branch where the answer changes what is offered. git-remotes.ts's own header
 * warns against exactly this collapse ("there are no remotes" is NOT the same
 * state as "there are remotes but I cannot pick one"); this type is that warning
 * applied at the one call site that acts on the difference.
 */
export type RemoteDestination =
  /** POSITIVELY established: zero remotes are configured. The ONLY create-offer state. */
  | { kind: 'none' }
  /** A remote resolved; it just is not a github.com repo MinSpec can address. */
  | { kind: 'other-remote' }
  /**
   * Several remotes and no way to choose. A refusal to guess, never an absence.
   *
   * `githubRepos` is how many DISTINCT GitHub repositories those remotes name,
   * and it is carried because the state is reached for two opposite reasons:
   * `githubSlug` declines whenever `slugs.size !== 1`, which includes ZERO (a
   * GitLab + Bitbucket checkout) as well as two-or-more. Without the count, the
   * sentence has to pick one of those and assert it — which is how a checkout
   * with no GitHub remote at all came to be told its remotes "name different
   * GitHub repositories" (correctness review 2026-08-28).
   */
  | { kind: 'ambiguous'; githubRepos: number }
  /**
   * `git remote` NAMED remotes, and reading their URLs SUCCEEDED and found none.
   *
   * SPLIT OUT OF `unreadable` (fifth correctness review, 2026-08-29), which was
   * one sentence for two causes and false for this one. Reproduced against real
   * git with a hand-edited `.git/config` carrying `[remote "foo"]` with a `fetch`
   * line and an EMPTY `url`:
   *
   *     git remote                                -> code=0  out="foo\n"
   *     git config --get-regexp ^remote\..*\.url$ -> code=0  out="remote.foo.url \n"
   *
   * BOTH reads exited 0. `parseRemoteConfig` drops the blank URL, `resolveRemotes`
   * answers `none`, the confirming `git remote` prints a name — and the copy said
   * "could not read this project's git remotes", asserting a failure that did not
   * happen. A remote with a `fetch` line and no `url` key at all lands here too.
   *
   * `remotes` is how many `git remote` named, so the sentence counts what it saw
   * instead of assuming one — the same reason `ambiguous` carries `githubRepos`.
   */
  | { kind: 'remote-without-url'; remotes: number }
  /**
   * `git remote` NAMED remotes, and the read that would have given their URLs
   * FAILED. The listing worked; the URL read did not.
   *
   * The other half of the split. It is a different observation from
   * `remote-without-url` (there we know there are no URLs; here we know nothing
   * about them) and from `unreadable` (there not even the names were readable),
   * and the sentence names the read that actually failed.
   */
  | { kind: 'remote-url-unreadable'; remotes: number }
  /**
   * The remote LISTING did not complete. We established NOTHING — assume nothing.
   *
   * Narrower than it was: it no longer covers a project whose remotes were listed
   * perfectly well. Only a failed/throwing `git remote` reaches it.
   */
  | { kind: 'unreadable' };

/**
 * Every {@link RemoteDestination} EXCEPT `none` — i.e. the states MinSpec cannot
 * address and must explain, which is exactly {@link describeUnusableRemote}'s
 * domain.
 *
 * Stated as a type rather than left to a comment, so the function's parameter
 * says what it is for. `none` is not an unusable remote at all: it is the ONE
 * state that gets the create offer, and a `describeUnusableRemote({kind:'none'})`
 * call is now a compile error rather than a sentence claiming a git read failed
 * about a project whose zero remotes were positively observed.
 */
export type UnusableRemote = Exclude<RemoteDestination, { kind: 'none' }>;

/**
 * Classify `folder`'s remotes, treating a FAILED read as its own state.
 *
 * `resolveRemotes` deliberately folds an errored `git config` into `{ kind:
 * 'none' }` — for its own callers that is right, since "no remote information
 * available" and "no remotes" are equally a non-answer. Here they are NOT
 * equivalent: one may offer to create a repository and the other may not. So
 * `none` is not taken on trust; it is CONFIRMED with an independent witness,
 * `git remote`, which lists remote names and exits 0 printing nothing when there
 * are none. Exit 0 with empty output is a positive observation of zero remotes;
 * anything else (non-zero exit, a name printed, a spawn rejection) leaves the
 * question open and yields `unreadable`, which fails CLOSED to the docs link.
 *
 * The asymmetric case is deliberate: `git remote` naming a remote that has no
 * usable `.url` does NOT yield `none`. A remote we cannot describe is still a
 * remote, and the bound is on remotes existing, not on their being usable.
 *
 * ...BUT IT IS NOT `unreadable` EITHER (fifth correctness review, 2026-08-29).
 * That arm asserted a git read had failed, and in the common shape of this state
 * both reads exit 0 — `git remote` prints the name, `git config --get-regexp`
 * prints the key with a blank value, and `parseRemoteConfig` simply drops it. So
 * once names ARE listed, ONE more local read settles which of the two happened:
 * a URL read that answered (`remote-without-url`, no URLs exist) versus one that
 * failed (`remote-url-unreadable`, we know nothing about them). Two observations,
 * two kinds, two sentences — the branch set is now as fine as the predicate.
 *
 * That third read is issued ONLY in the names-were-listed branch, so the ordinary
 * "no remotes at all" path still costs exactly two.
 *
 * Tier-0: two or three local `git` reads through the injected runner. No network.
 * Never throws — every failure is a classification, not an exception.
 */
async function classifyRemoteDestination(
  folder: string,
  run: CommandRunner,
): Promise<RemoteDestination> {
  let state: RemoteResolution;
  try {
    state = await resolveRemotes(run, folder);
  } catch {
    return { kind: 'unreadable' };
  }
  if (state.kind === 'ambiguous') {
    // COUNT what was seen rather than leave the sentence to assume it. `state.all`
    // is right here; deriving "they disagree about GitHub" from the mere fact that
    // resolution declined is the inference that produced a false sentence.
    const slugs = new Set<string>();
    for (const remote of state.all) {
      const slug = githubSlugFromUrl(remote.url);
      if (slug) slugs.add(slug);
    }
    return { kind: 'ambiguous', githubRepos: slugs.size };
  }
  // `resolved` reaches here only because the caller could not turn it into a
  // usable slug — a non-github.com host, or a github URL whose slug fails the
  // charset assertion. Either way a remote demonstrably EXISTS.
  if (state.kind === 'resolved') return { kind: 'other-remote' };

  try {
    const listed = await run('git', ['-C', folder, 'remote']);
    // The LISTING failed: not even the names are known. This is the only state
    // that earns "could not read this project's git remotes".
    if (listed.code !== 0) return { kind: 'unreadable' };
    const names = listed.stdout.split('\n').filter((line) => line.trim() !== '');
    // Exit 0 printing nothing IS the positive observation of zero remotes — the
    // one state that may be offered a repository.
    if (names.length === 0) return { kind: 'none' };

    // Names exist while `resolveRemotes` produced nothing, so no URL was usable.
    // WHY there was none is a second question, and `resolveRemotes` cannot answer
    // it: it folds a failed `git config` read and a successful one that found no
    // usable URL into the same `none`. Ask directly, and report what came back.
    //
    // `git config --get-regexp` exits 1 printing nothing when NO key matches —
    // that is an answer, not a failure, and it is the exact shape a remote with a
    // `fetch` line and no `url` key produces. A hard failure exits non-zero WITH
    // something on stderr.
    const urls = await run('git', ['-C', folder, 'config', '--get-regexp', '^remote\\..*\\.url$']);
    const urlReadAnswered = urls.code === 0 || urls.stderr.trim() === '';
    return urlReadAnswered
      ? { kind: 'remote-without-url', remotes: names.length }
      : { kind: 'remote-url-unreadable', remotes: names.length };
  } catch {
    return { kind: 'unreadable' };
  }
}

/**
 * The zero-network docs-link sentence for a project MinSpec cannot address — one
 * per OBSERVATION, each asserting ONLY what that observation established.
 *
 * The single sentence these replaced ("this project has no GitHub repo") was
 * false in three of the four states: a project with several disagreeing remotes,
 * or an `origin` on another host, or a git read that failed, all have — or may
 * have — a GitHub repo. MinSpec knew only that its resolver declined to answer,
 * and said something much stronger. A never-wrong product cannot narrate an
 * inference as an observation, so each branch says what it saw.
 *
 * EXHAUSTIVE BY TYPE (correctness review 2026-08-28). The `default:` arm this
 * used to end on returned the `unreadable` copy, so any kind added to
 * {@link RemoteDestination} later would silently render "could not read this
 * project's git remotes" — a specific claim about a specific failed read — for a
 * state that may have read its remotes perfectly well. `unreadable` now has an
 * arm of its own and the fall-through is `never`-typed, so the union and the copy
 * fail together at compile time; at runtime the unreachable arm answers with the
 * only thing true of every state, because the caller swallows exceptions and a
 * throw would make the toast disappear entirely.
 *
 * `ambiguous` NEEDED THREE SENTENCES, NOT ONE (correctness review 2026-08-28),
 * which is why {@link RemoteDestination} carries `githubRepos`. The one sentence
 * it had ("they name different GitHub repositories") was itself the same defect a
 * level down: the state is reached whenever `githubSlug` declines, and it declines
 * on ZERO GitHub remotes as readily as on two — so a GitLab + Bitbucket checkout
 * was told a GitHub fact nobody had observed, and handed a remedy ("name the right
 * one `origin`") that only reaches `other-remote` next run.
 */
function describeUnusableRemote(destination: UnusableRemote): string {
  switch (destination.kind) {
    case 'other-remote':
      return (
        "MinSpec: this project's git remote does not name a GitHub repository MinSpec " +
        'can use. Add a GitHub remote, then create a branch ruleset — see the GitHub docs.'
      );
    case 'ambiguous':
      // THREE sentences, because `slugs.size !== 1` is reached from both ends and
      // the remedy differs. Naming a GitLab remote `origin` does not make it a
      // GitHub repository — it just arrives at `other-remote` next run — so the
      // zero-GitHub case must be told to ADD one, not to rename one.
      if (destination.githubRepos >= 2) {
        return (
          'MinSpec: this project has several git remotes, none of them named `origin`, ' +
          'and they name different GitHub repositories — so MinSpec will not guess which ' +
          'one to protect. Name the right one `origin`, then create a branch ruleset — ' +
          'see the GitHub docs.'
        );
      }
      if (destination.githubRepos === 0) {
        return (
          'MinSpec: this project has several git remotes, none of them named `origin`, ' +
          'and none of them names a GitHub repository — so there is nothing here MinSpec ' +
          'can protect. Add a GitHub remote named `origin`, then create a branch ruleset — ' +
          'see the GitHub docs.'
        );
      }
      // Unreachable through the shipped resolver (a single GitHub slug resolves
      // rather than declining), so it states the little it knows and nothing more.
      return (
        'MinSpec: this project has several git remotes and none of them is named ' +
        '`origin`, so MinSpec cannot tell which GitHub repository to protect. Name the ' +
        'right one `origin`, then create a branch ruleset — see the GitHub docs.'
      );
    case 'remote-without-url': {
      // BOTH READS SUCCEEDED, so this may not borrow a sentence about a failed
      // one — the defect that split this kind out of `unreadable`. What was
      // observed: `git remote` named them, and the URL read answered with no
      // usable URL for any of them.
      const noun = destination.remotes === 1 ? 'git remote' : 'git remotes';
      return (
        `MinSpec: this project has ${destination.remotes} ${noun}, but none of them has a ` +
        'URL MinSpec can use, so it cannot tell which GitHub repository (if any) this is. ' +
        'Give the remote a URL with `git remote set-url`, then create a branch ruleset — ' +
        'see the GitHub docs.'
      );
    }
    case 'remote-url-unreadable': {
      // The names were read; the URLs were not. Naming the read that FAILED is
      // the whole difference between this sentence and the two either side of it.
      const noun = destination.remotes === 1 ? 'git remote' : 'git remotes';
      return (
        `MinSpec: this project has ${destination.remotes} ${noun}, but MinSpec could not ` +
        'read their URLs, so it cannot tell which GitHub repository (if any) this is. Check ' +
        "`git config --get-regexp '^remote\\..*\\.url$'`, then create a branch ruleset — see " +
        'the GitHub docs.'
      );
    }
    case 'unreadable':
      // An EXPLICIT arm, not the fall-through it used to be — and NARROWER than
      // it was. This sentence makes a real claim (the git read failed) and only
      // this state observed it: `git remote` itself did not answer, so not even
      // the remotes' NAMES are known. A project whose names listed fine has its
      // own two kinds above.
      return (
        "MinSpec: could not read this project's git remotes, so it cannot tell which " +
        'GitHub repository (if any) this is. Check `git remote -v`, then create a branch ' +
        'ruleset — see the GitHub docs.'
      );
    default: {
      // EXHAUSTIVENESS, both halves.
      //
      // COMPILE TIME: a kind added to `RemoteDestination` without copy of its own
      // narrows to something other than `never` here and fails `npm run
      // typecheck`, so the union and the sentences fail together. That is the
      // whole point — the arm below used to be `default:` returning the
      // `unreadable` copy, which meant a new state silently inherited a sentence
      // asserting a git read had failed, with no compile error anywhere.
      //
      // RUNTIME: it still answers, because this advisory's caller swallows
      // exceptions and a throw here would make the whole toast vanish. What it
      // answers is the most non-committal true thing available: MinSpec could not
      // determine which repository to protect. That claims nothing about WHY,
      // which is the only honest thing to say about a state this function has
      // never been taught.
      const _unhandled: never = destination;
      void _unhandled;
      return (
        'MinSpec: could not determine which GitHub repository (if any) this project ' +
        'should protect. Check `git remote -v`, then create a branch ruleset — see the ' +
        'GitHub docs.'
      );
    }
  }
}

/**
 * Seed value for the repository-name box: the workspace folder's own name,
 * coerced into something GitHub and `gh` will both accept.
 *
 * Runs of characters outside the segment charset collapse to a single `-`, and a
 * leading `-`/`.` is stripped (a name starting with `-` would be read by `gh` as a
 * flag; one that is only dots is traversal wearing a legal charset). Returns `''`
 * when nothing usable survives, so the box opens empty and the user types a name
 * rather than being handed a pre-filled value that cannot work.
 */
function defaultRepoName(folder: string): string {
  const base = path
    .basename(folder)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '');
  return isSafeRepoSegment(base) ? base : '';
}

// HONESTY BOUND, at the strings it binds. An org appears in the picker because
// the user's OWN membership role there is `admin`. That is a proxy for "you could
// create a repository here" — it is NOT, and must never be rendered as, evidence
// that the MinSpec App is set up in that org. A Tier-0 extension cannot establish
// that at all: with a `gh` OAuth token GET /user/installations answers 403 and
// /orgs/{org}/installation answers 401 (measured 2026-08-25, recorded in the
// amendment). Copy claiming otherwise would be false, which is the one defect
// class this product cannot ship. The T0 suite holds a deny-list over the
// rendered strings, because prose enforcing prose is the failure mode
// `.minspec/constitution.md` names.

/**
 * Name ONE owner candidate in the UI.
 *
 * An org candidate carries its login, because `/user/memberships/orgs` reported
 * it. The personal account carries `null` — MinSpec never reads the user's login,
 * because `gh repo create <name>` with no owner prefix already creates under the
 * signed-in account, and DR-050's 2026-08-25 amendment enumerates exactly one
 * account endpoint. So the personal row is named by what it IS rather than by a
 * login MinSpec would have to make an unenumerated read to learn.
 */
function ownerLabel(candidate: RepoOwnerCandidate): string {
  return candidate.login ?? 'Your personal account';
}

/**
 * Describe ONE owner candidate for the picker, in installability terms only.
 *
 * "your membership role is owner, so you can create repositories here" is a
 * restatement of the `role: admin` we actually read. Anything stronger — "MinSpec
 * is set up here", "the App is set up here" — would assert something never
 * observed. See the HONESTY BOUND above.
 */
function describeOwnerCandidate(candidate: RepoOwnerCandidate): string {
  if (candidate.kind === 'user') return 'The account your `gh` CLI is signed in as';
  return candidate.canAdminister
    ? 'Organisation — your membership role is owner, so you can create repositories here'
    : 'Organisation — your membership role is member, so creating here may be refused';
}

/**
 * Default visibility picker: private FIRST, so the pre-selected row is the one
 * that cannot leak anything. A repository created public by an accidental Enter
 * is not undoable in the way that matters — the code was public for a while.
 *
 * ...AND THE PRIVATE ROW DISCLOSES WHAT IT COSTS (correctness review 2026-08-28).
 * MinSpec's own `isPlanLimited` (lib/ruleset-advisor.ts) exists because GitHub refuses a ruleset on a
 * PRIVATE repository on the free plan with a 403 whose body is `Upgrade to GitHub
 * Pro or make this repository public to enable this feature.` So the default this
 * picker recommends is the one that makes the very next thing MinSpec offers —
 * branch protection — unavailable to a solo user on GitHub Free, and the whole
 * reason the create offer exists is to reach it. Nothing here lied: the failure
 * was reported honestly when it arrived ({@link describeRulesetFailure}). It was
 * simply predictable from a signal already computed in this codebase, and walking
 * a user into a predictable dead end without a word is a choice, not an accident.
 *
 * The disclosure does NOT flip the default. Private stays first and stays
 * recommended: leaking a repository is unrecoverable and a plan limit is not, so
 * the safe default is still the right one — the user just gets to see the
 * trade-off at the moment they make it rather than one click later.
 */
async function pickRepoVisibility(): Promise<'private' | 'public' | undefined> {
  const items = [
    {
      label: 'Private',
      description:
        'Only you and the people you invite can see it (recommended). Note: branch ' +
        'rulesets on a private repository need a paid GitHub plan.',
      value: 'private' as const,
    },
    {
      label: 'Public',
      description: 'Anyone on GitHub can see it. Branch rulesets work on the free plan.',
      value: 'public' as const,
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Visibility for the new repository',
    ignoreFocusOut: true,
  });
  return picked?.value;
}

/**
 * Default owner picker. The list arrives PRE-RANKED from
 * {@link probeOwnerCandidates} and is offered in that order, so the row VS Code
 * pre-selects is the default pick — the ranking rule lives in one place and the
 * UI cannot re-derive it differently.
 */
async function pickRepoOwner(
  candidates: readonly RepoOwnerCandidate[],
): Promise<RepoOwnerCandidate | undefined> {
  const items = candidates.map((candidate) => ({
    label: ownerLabel(candidate),
    description: describeOwnerCandidate(candidate),
    candidate,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Which account should own the new repository?',
    ignoreFocusOut: true,
  });
  return picked?.candidate;
}

/**
 * Turn a rejected segment into the sentence a user reads — capitalised and
 * terminated, from the shared clause.
 *
 * Exists so the name box's validator and the guard's warning toast render the
 * SAME explanation rather than two copies of a literal, which is how the box came
 * to permit in prose the very characters it had just rejected.
 */
function repoSegmentReason(
  rejection: Parameters<typeof describeRepoSegmentRejection>[0],
  subject?: Parameters<typeof describeRepoSegmentRejection>[1],
): string {
  const clause = describeRepoSegmentRejection(rejection, subject);
  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`;
}

/**
 * Default repository-name box, validated with the SAME predicate
 * {@link createGitHubRepo} re-asserts at the CLI boundary — one rule, not two
 * copies that can drift, so the box can never accept a name the create refuses.
 *
 * ...AND IT NOW EXPLAINS THE RULE IT APPLIED (fifth correctness review,
 * 2026-08-29). The shared PREDICATE was never the problem; the EXPLANATION was a
 * third artifact matching neither side of it. One sentence answered five distinct
 * rejections and was false for three, captured from this very validator:
 *
 *     ""            -> "Use letters, numbers, dots, dashes or underscores…"
 *     "-lead"       -> same message (letters + a dash only; the message permits both)
 *     ".."          -> same message (dots only; the message permits dots)
 *     "a" x101      -> same message (letters only; the cap is never mentioned)
 *     "has space"   -> same message (the one case it was true of)
 *
 * The fix is not five literals here: it is that {@link checkRepoSegment} reports
 * WHICH rule fired, so this validator derives the sentence rather than guessing
 * it. The box still accepts exactly what the CLI boundary accepts, because
 * `undefined` is returned on exactly `null`.
 */
async function promptRepoNameInput(defaultName: string): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    prompt: 'Name for the new GitHub repository',
    value: defaultName,
    ignoreFocusOut: true,
    validateInput: (input: string) => {
      const rejection = checkRepoSegment(input.trim());
      return rejection === null ? undefined : repoSegmentReason(rejection);
    },
  });
  return value?.trim();
}

/**
 * Name the destination the offer will default to — or `null` when MinSpec cannot
 * name it.
 *
 * THREE OUTCOMES, ONE PER THING MinSpec CAN ACTUALLY SPELL (fifth correctness
 * review, 2026-08-29). This was a two-armed ternary over `login === null`, which
 * left two states with no arm of their own and both of them rendered something
 * false:
 *
 *   - NO USABLE BASENAME. `defaultRepoName` answers `''` when nothing survives
 *     sanitising (`/ws/---`), and the copy interpolated `'<name>'` — printing its
 *     own placeholder token to the user, verbatim: "Default: <name> under your
 *     personal account".
 *   - A DEFAULT LOGIN THAT FAILS THE CHARSET GUARD. `probeOwnerCandidates`
 *     filters logins, but the probe is INJECTABLE and this sentence applied no
 *     guard of its own — so `acme/evil` was rendered as `acme/evil/my-app`, a
 *     destination that does not exist, one step before the same value is REFUSED
 *     at the CLI boundary. Naming a value we are about to refuse is the
 *     copy-contradicts-behaviour defect one scale down.
 *
 * `null` is not a degradation: the caller drops the "Default: …" clause entirely
 * and still promises the steps it will open. Saying less is what honesty costs
 * here, and it costs nothing else.
 *
 * The personal account is named by what it IS rather than by a login, because
 * MinSpec never reads one — `gh repo create <name>` with no owner prefix creates
 * under whichever account `gh` is signed in as.
 */
function describeCreateDestination(login: string | null, suggestedName: string): string | null {
  // An unspellable login is the only state with NOTHING to say: the ACCOUNT is
  // always nameable when the login passes (or when there is none, because the
  // personal account is named by what it is), and a missing suggested name costs
  // only the name half of the phrase.
  if (login !== null && !isSafeRepoSegment(login)) return null;
  const account = login === null ? 'your personal account' : login;
  if (!suggestedName) return login === null ? account : `a repository under ${account}`;
  return login === null ? `${suggestedName} under ${account}` : `${account}/${suggestedName}`;
}

/**
 * Offer to CREATE the GitHub repository this project does not have (#1694), wire
 * it as `origin`, and say what was created plus the one step that makes branch
 * protection possible: the first push.
 *
 * This replaces a dead end. The advisory used to answer "no GitHub remote" with
 * "add a GitHub remote, then create a branch ruleset — see the GitHub docs": it
 * named the obstacle and handed over a docs page, inside an extension that
 * already mutates GitHub config on a click.
 *
 * NETWORK POSTURE (DR-050 Amendment 2026-08-25), and why each half is where it is:
 *   - the owner probe ({@link probeOwnerCandidates}) is a READ of the user's own
 *     account, runs AUTONOMOUSLY with no toast in front of it, and is
 *     BRANCH-SCOPED: this function is the probe's only caller, and it is reached
 *     only when `gh` is ready AND {@link classifyRemoteDestination} POSITIVELY
 *     established that this project has no remote at all. A project that has a
 *     remote — the overwhelming majority — never triggers it, and neither does a
 *     project whose remotes MinSpec merely failed to resolve, which is a
 *     different state and not this one.
 *   - it is ONE endpoint, `/user/memberships/orgs`, the only one the amendment
 *     enumerates. The personal account needs no read: `gh repo create <name>`
 *     with no owner prefix creates under whichever account `gh` is signed in as.
 *   - the result is used to populate the picker and then DISCARDED. It is not
 *     written to settings, workspace state, a cache, or `.minspec/`.
 *   - the CREATE is a MUTATION and fires only on the explicit
 *     {@link REPO_CREATE_ACTION} click, exactly as the ruleset create is gated.
 *   All three bounds are conditions of the amendment, not optional hardening.
 *
 * FAIL-SAFE at every step, and each degradation lands somewhere the user can still
 * act:
 *   - the memberships read FAILS (the common case — a token without `read:org`,
 *     but equally a rate limit or malformed output) → the full offer, simply
 *     unable to name an org — AND THE OFFER SAYS SO. `orgsRead: false` is not the
 *     same answer as "you belong to no organisations", and rendering it as such
 *     removed the destination the user was reaching for without telling them
 *     anything had been read at all (correctness review 2026-08-28). Naming the
 *     failed read breaks no bound of the amendment: the no-persistence rule is
 *     about the org LIST, which a failed read never produced.
 *   - the probe returns NOTHING AT ALL → the zero-network docs link. The shipped
 *     probe cannot do this (the personal account needs no successful read), so
 *     this covers an injected probe only: we still never render a button we
 *     already know has nowhere to create.
 *   - any picker escaped → nothing is created, silently. Escape means "never mind",
 *     and it is the ONE quiet exit: a REFUSAL by the charset guard, or any throw
 *     after the consent click, gets a warning instead. A consented mutation that
 *     ends in silence is a silent gate (constitution invariant 2), and it looked
 *     exactly like Escape from the user's side (third correctness review,
 *     2026-08-28).
 *   - the create FAILS → a remedy that MATCHES the reason quoted beside it, and a
 *     retry into the name box ({@link REPO_RETRY_ACTION}) ONLY where a new name
 *     could change the outcome. "Create it on GitHub yourself" is a contradiction
 *     when the reason is "Name already exists on this account", and it is a false
 *     premise when nothing established that the create did not happen — see
 *     {@link CreateRepoResult}. The mirror of that rule is that `not-attempted`
 *     gets no retry at all: nothing ran, and what refused it is the rule the name
 *     box already applies — see {@link offerCreateRetry}.
 *   - the create SUCCEEDS but `gh` printed nothing nameable → say the repository
 *     was created, do NOT invent a slug.
 *   - the create SUCCEEDS → say what was created and stop at the PUSH. It does not
 *     send the user back for branch protection, because that re-run walks into an
 *     unsatisfiable ruleset (#1711) — see {@link announceRepoCreated}.
 *
 * IT DOES NOT FALL THROUGH INTO THE RULESET OFFER, and that is the point of its
 * `void` return. The repository this creates is EMPTY — the create deliberately
 * carries no `--push` — so it has no commits, no refs, no workflow files and no
 * runs. See {@link offerRulesetAdvisory}'s no-remote branch for why a ruleset
 * offered now would be a deadlock rather than a convenience.
 */
async function offerRepoCreation(
  folder: string,
  run: CommandRunner,
  openExternal: (url: string) => void,
  deps: RulesetAdvisoryDeps,
): Promise<void> {
  const probeOwners = deps.probeOwners ?? probeOwnerCandidates;
  const createRepo = deps.createRepo ?? createGitHubRepo;
  const pickVisibility = deps.pickVisibility ?? pickRepoVisibility;
  const pickOwner = deps.pickOwner ?? pickRepoOwner;
  const promptName = deps.promptRepoName ?? promptRepoNameInput;

  // AUTONOMOUS, BRANCH-SCOPED, NON-PERSISTING account read. Its whole purpose is
  // that the offer below can NAME the destination up front, instead of asking
  // where the repo should go only after the user has committed to the flow.
  const probe = await probeOwners(run);
  const candidates = probe.candidates;
  if (candidates.length === 0) {
    // NO `gh auth login` HERE (correctness review 2026-08-28). This line is
    // downstream of {@link probeGhReadiness}, which required `gh auth status` to exit 0
    // — so `gh` IS authenticated, and advising the user to log in contradicts
    // the check made moments earlier. What is actually true is narrower: `gh`
    // works, and MinSpec found no account to offer as a destination. The remedy
    // has to be the one that fits that, and the docs link goes to the page about
    // CREATING a repository rather than about rulesets on one.
    // IT STOPS AT THE `origin` WIRE-UP, and does not say "then re-run MinSpec"
    // (fifth correctness review, 2026-08-29). That instruction is the same one
    // {@link announceRepoCreated} deleted, in the same trap: the step before it
    // ADDS AN `origin`, so on the re-run the remote resolves, the ruleset offer
    // fires, and it asks for Tier-B checks inferred from the LOCAL `package.json`
    // that a freshly-created repository cannot report — #559's permanent-pending
    // deadlock, which #1711 owns. A sentence that routes a user into a known
    // deadlock is worse than one that stops early.
    await linkRulesetDocs(
      'MinSpec: this project has no git remote, so nothing links it to a GitHub ' +
        'repository — and although `gh` is signed in, MinSpec could not identify an ' +
        'account to create one under. Create the repository on GitHub yourself and add ' +
        "it as this project's `origin` remote — see the GitHub docs.",
      openExternal,
      REPO_CREATE_DOCS_URL,
    );
    return;
  }

  const suggestedName = defaultRepoName(folder);
  // What the toast promises must match what the flow actually opens. A single
  // candidate means the owner picker is SKIPPED below, so promising a choice of
  // owner there would be a small lie told at the moment the user decides.
  const willPickOwner = candidates.length > 1;
  // ...AND IN THE ORDER IT OPENS THEM (fifth correctness review, 2026-08-29).
  // This said "the owner, name and visibility"; the flow asks visibility, then
  // owner, then name. A promise the user checks against the very next screen is
  // the one place a wrong order is noticed immediately.
  const steps = willPickOwner ? 'the visibility, owner and name' : 'the visibility and name';
  const destination = describeCreateDestination(candidates[0].login, suggestedName);
  // NAME THE DESTINATION ONLY WHEN THERE IS ONE TO NAME. `null` means MinSpec
  // cannot spell it (no usable basename to suggest, or a default candidate whose
  // login fails the charset guard) — and a sentence built around a value it
  // cannot spell rendered its own placeholder, verbatim, to the user.
  const defaults =
    destination === null
      ? `It will be private unless you choose otherwise — you pick ${steps} next.`
      : `Default: ${destination}, private — you pick ${steps} next.`;
  // A FAILED org read is disclosed, never rendered as an empty one. The user who
  // owns `acme` but whose token lacks `read:org` — or who has a `GITHUB_TOKEN`
  // inherited from the environment, which `gh` prefers — would otherwise be shown
  // a personal-account-only offer indistinguishable from having no orgs at all.
  //
  // NO `gh auth refresh` HERE (third correctness review, 2026-08-28). This clause
  // used to end "`gh auth refresh -s read:org` restores that choice", stated
  // unconditionally — and `probeOwnerCandidates`'s own comments enumerate at least
  // four causes it cannot restore (an unauthed `gh`, a rate limit, malformed
  // output, and a token that simply lacks the scope), plus a fifth measured against
  // gh 2.98.0:
  //
  //     $ GITHUB_TOKEN=... gh auth refresh -h github.com -s read:org
  //     The value of the GITHUB_TOKEN environment variable is being used for
  //     authentication. To refresh credentials stored in GitHub CLI, first clear
  //     the value from the environment.
  //
  // That is the remedy-contradicts-reason defect {@link offerCreateRetry} already
  // fixed for name collisions, re-introduced in new copy: a command the user is
  // told to run that their situation makes inert.
  //
  // What replaces it is DERIVED FROM AN OBSERVATION THIS CODE ALREADY MADE.
  // `probeGhReadiness` exited 0 on `gh auth status` moments ago, so that one command is
  // known to answer here — and it reports both the token SOURCE (which exposes an
  // inherited `GITHUB_TOKEN`) and its scopes (which exposes a missing `read:org`).
  // It is a diagnostic, not a fix, and that is the honest shape: MinSpec has not
  // established which cause fired, so it names the one command that says.
  const orgsNote = probe.orgsRead
    ? ''
    : ' MinSpec could not read your organisations, so only your personal account is ' +
      'offered. `gh auth status` reports which token `gh` is using and what scopes it ' +
      'carries — a token without `read:org`, or a `GITHUB_TOKEN` set in your environment ' +
      '(which `gh` prefers over its stored credentials), both produce this.';
  const choice = await vscode.window.showInformationMessage(
    'MinSpec: this project has no git remote, so nothing links it to a GitHub ' +
      'repository. Create one so CI status checks and branch protection can be set up? ' +
      defaults +
      orgsNote,
    REPO_CREATE_ACTION,
    RULESET_DECLINE_ACTION,
    RULESET_LEARN_MORE_ACTION,
  );
  if (choice === RULESET_LEARN_MORE_ACTION) {
    // The page about CREATING a repository, not about rulesets on one: this
    // toast fired precisely because there is no repository yet.
    openExternal(REPO_CREATE_DOCS_URL);
    return;
  }
  // "Not now", a dismissal, or anything unrecognised: create NOTHING, record
  // NOTHING, say nothing more. Only the explicit action above is consent, and a
  // decline is NOT remembered — see the comment above `RULESET_DECLINE_ACTION` for
  // why the suppression flag that used to live here was deleted rather than fixed.
  if (choice !== REPO_CREATE_ACTION) return;

  // ── PAST THIS LINE THE USER HAS CONSENTED TO A MUTATION ────────────────────
  //
  // ...so nothing below may end in silence (third correctness review,
  // 2026-08-28). Two guard returns and this advisory's outer `catch {}` each
  // aborted a flow the user had explicitly asked for with no message at all,
  // which from the user's side is indistinguishable from having pressed Escape.
  // A swallowed error after a consented mutation is a silent gate, which
  // constitution invariant 2 forbids.
  //
  // The guards are unreachable through the shipped picker (the probe filters org
  // logins, and the name box runs `isSafeRepoSegment` as its validator) — but the
  // outer swallow is LIVE: any throw out of `showQuickPick`/`showInputBox`
  // mid-flow left a user who clicked "Create GitHub repo" with total silence.
  //
  // ESCAPE STAYS SILENT, deliberately. Dismissing a picker is an ANSWER —
  // "never mind" — and reporting it as a failure would turn the ordinary way out
  // of the flow into an error message. What must speak is a REFUSAL or a THROW:
  // something the user did not choose and cannot see.
  try {
    const visibility = await pickVisibility();
    if (!visibility) return;

    // A single candidate is not a choice — skip the picker rather than staging a
    // one-row menu whose only outcome the toast already named. `willPickOwner`
    // above is the SAME condition, so the copy and the behaviour cannot drift.
    const owner = willPickOwner ? await pickOwner(candidates) : candidates[0];
    if (!owner) return;
    // `null` is the personal account (create with no owner prefix) and is valid;
    // any other unusable value is not, and must never be silently rewritten INTO
    // the personal account — that would retarget the create somewhere the user did
    // not choose. Refuse instead, and SAY that it refused.
    const ownerRejection = owner.login === null ? null : checkRepoSegment(owner.login);
    if (ownerRejection !== null) {
      // NAMES THE RULE THAT FIRED, from the same predicate the CLI boundary uses
      // — not a generic "cannot hand to gh", which leaves the user guessing which
      // of five rules they broke.
      vscode.window.showWarningMessage(
        `MinSpec: ${JSON.stringify(owner.login)} is not an account name MinSpec can safely ` +
          `hand to \`gh\`, so nothing was created — ${describeRepoSegmentRejection(ownerRejection, 'account name')}. ` +
          "Create the repository on GitHub yourself and add it as this project's `origin` remote.",
      );
      return;
    }

    // The NAME is the only thing a failed create is worth re-asking for: the owner
    // and visibility were chosen once and are carried into every attempt, so a
    // collision costs one keystroke rather than the whole command.
    let seed = suggestedName;
    for (let attempt = 1; attempt <= MAX_REPO_CREATE_ATTEMPTS; attempt++) {
      const name = await promptName(seed);
      // `undefined` is the box being dismissed — an answer, and silent. Anything
      // else that fails the charset rule is a REFUSAL, and refusals speak.
      if (name === undefined) return;
      const nameRejection = checkRepoSegment(name);
      if (nameRejection !== null) {
        // The SECOND copy of the false literal lived here — the same sentence the
        // name box printed for all five rejections, repeated. Derived now, from
        // the one predicate, so the two surfaces cannot say different things and
        // neither can permit what it just rejected.
        vscode.window.showWarningMessage(
          `MinSpec: ${JSON.stringify(name)} is not a repository name MinSpec can safely hand ` +
            `to \`gh\`, so nothing was created. ${repoSegmentReason(nameRejection)}`,
        );
        return;
      }

      const result = await createRepo(folder, owner.login, name, visibility, run);
      if (result.ok) {
        announceRepoCreated(result, name, visibility);
        return;
      }

      const retry = await offerCreateRetry(
        result,
        openExternal,
        attempt < MAX_REPO_CREATE_ATTEMPTS,
        deps.invokedBy,
        owner.login,
      );
      if (!retry) return;
      // WHAT TO SEED DEPENDS ON WHAT FAILED (fifth correctness review,
      // 2026-08-29). This always seeded the name just attempted, which is right
      // for a collision and wrong for the other failure that retries:
      // `unconfirmed` exists precisely because the repository MAY ALREADY EXIST
      // under exactly that name — `gh repo create --source` creates through the
      // API and only then wires the remote — so handing it back steers the user
      // into the collision the failed attempt may itself have created.
      seed = result.failure === 'unconfirmed' ? nudgeRepoName(name) : name;
    }
  } catch (err) {
    // The one place this advisory's blanket `catch {}` is NOT good enough. It
    // still catches (the init must never fail because of an advisory), but a
    // consented mutation gets a sentence first, and the sentence claims nothing
    // about whether a repository exists — a throw can land on either side of the
    // `gh repo create`, and this code did not observe which.
    vscode.window.showWarningMessage(
      `MinSpec: the repository-create flow stopped before it could report a result — ` +
        `${describeError(err)}. Check your repositories on GitHub before trying again.`,
    );
  }
}

/**
 * Say what was CREATED, claiming only the halves that were observed.
 *
 * Two separate claims live in one sentence, and they used to be one: "created X"
 * and "set it as this project's `origin` remote". {@link CreateRepoResult} now
 * carries them apart — `remoteWired` is a local `git remote get-url origin` read,
 * not an inference from an exit code — so the second half is stated only when it
 * is true, and its absence is reported with the command that settles it.
 *
 * THE NEXT STEP IS THE PUSH, AND NOTHING BEYOND IT (third correctness review,
 * 2026-08-28). This used to end "push your first commit, then re-run MinSpec:
 * Initialize SDD Structure to set up branch protection", and that instruction
 * routed the user straight into a pre-existing deadlock. On that re-run the
 * remote resolves, the ruleset offer fires, and it asks for `MinSpec SDD
 * validation + lint + test + build` — of which only the first is reported by
 * anything MinSpec scaffolds, because the Tier-B checks are inferred from the
 * LOCAL `package.json` scripts rather than from what the repository can actually
 * report. Accepting pends every PR forever, which is #559's deadlock class.
 *
 * That inference is NOT this change's to fix — it is pre-existing, it is
 * load-bearing for every other caller of `resolveWantedChecks`, and #1711 owns
 * it. What IS this change's to fix is that it was handing the user an
 * instruction to walk into it. So the sentence stops at the push: that is the
 * true, minimal next step for a repository with no commits, and it is the only
 * one this code can promise today. When #1711 lands, the re-run advice can come
 * back — and this comment is the coupling, so that it comes back deliberately
 * rather than by accident.
 *
 * `requestedName` is the fallback name: `ok: true` with no slug means the
 * repository exists and MinSpec declines to name it (the personal-account path
 * with unrecognised `gh` output), and the slug is re-checked against
 * {@link REPO_SLUG_RE} rather than trusted, on the way back as well as in.
 */
function announceRepoCreated(
  result: CreateRepoResult,
  requestedName: string,
  visibility: 'private' | 'public',
): void {
  const named = result.slug && REPO_SLUG_RE.test(result.slug) ? result.slug : requestedName;
  const wired = result.remoteWired
    ? " and set it as this project's `origin` remote"
    : " — but MinSpec could not confirm it is this project's `origin` remote, so check `git remote -v`";
  vscode.window.showInformationMessage(
    `MinSpec: created ${named} (${visibility})${wired}. It has no commits yet — push your ` +
      'first commit when you are ready.',
  );
}

/**
 * A DIFFERENT name from the one just attempted, seeded into the retry box.
 *
 * Only the `unconfirmed` path uses it, and only because that path's entire
 * premise is that a repository may already exist under the attempted name. A
 * trailing `-<n>` is incremented, otherwise `-2` is appended; the base is trimmed
 * so the result stays inside {@link MAX_REPO_SEGMENT_LENGTH}, and anything that
 * still fails the segment rules falls back to the original — a suggestion the
 * create would refuse is worse than a repeated one.
 *
 * It is a SUGGESTION in an editable box, never a claim: MinSpec has not
 * established that this name is free either, and the toast beside it says so.
 */
function nudgeRepoName(name: string): string {
  const numbered = /^(.*?)-(\d+)$/.exec(name);
  const base = numbered ? numbered[1] : name;
  const suffix = `-${numbered ? Number(numbered[2]) + 1 : 2}`;
  const room = MAX_REPO_SEGMENT_LENGTH - suffix.length;
  const candidate = `${base.length > room ? base.slice(0, room) : base}${suffix}`;
  return isSafeRepoSegment(candidate) ? candidate : name;
}

/**
 * Can a NEW NAME change this outcome? The retry button is offered on exactly the
 * failures where it can, and withheld on the rest.
 *
 * EXHAUSTIVE OVER {@link CreateRepoFailure}, deliberately, rather than the
 * `!== 'not-attempted'` it used to be. That negation made "offer the retry" the
 * DEFAULT, so every failure shape that had no member of its own inherited a
 * remedy nobody had judged applicable to it — which is how a member-only org
 * refusal and a SAML block each fired three identical `gh repo create` calls.
 * Stated positively, a new failure member defaults to withholding the retry and
 * fails typecheck until someone decides, which is the direction a mutation should
 * fail.
 */
function retryCanChangeOutcome(failure: CreateRepoFailure | undefined): boolean {
  switch (failure) {
    // GitHub named the name as the problem. A different one is the whole remedy.
    case 'name-taken':
      return true;
    // Nothing established WHY, or even whether the repository exists — a
    // different name is one of the two things the toast tells the user to try.
    case 'unconfirmed':
      return true;
    // The local guard refused; the name box applies that same rule, so it cannot
    // produce a name the guard would accept that it has not already accepted.
    case 'not-attempted':
      return false;
    // Every refusal is about WHERE the repository would go, not what it is
    // called — and each is listed separately rather than grouped, so a member
    // added to {@link CreateRepoFailure} cannot inherit a retry decision by
    // sharing an arm with one that happens to look like it.
    case 'refused-policy':
      return false;
    case 'refused-sso':
      // Least name-shaped of the three: no name, and no ROLE either, changes a
      // token's SSO authorisation.
      return false;
    case 'refused-permission':
      return false;
    // The plan is about the account and the visibility. A name cannot touch it.
    case 'plan-limited':
      return false;
    default:
      // Includes `undefined` (a success reaching here would be a bug) and any
      // member added later: withhold, because a retry offered on a failure nobody
      // has classified is a mutation fired on a guess.
      return false;
  }
}

/**
 * Report a failed create with a remedy that MATCHES the reason quoted beside it,
 * and offer the way back into the name box.
 *
 * ONE MESSAGE PER REJECTION REASON, NOT PER OUTCOME TYPE (fifth correctness
 * review, 2026-08-29). This had three arms while {@link CreateRepoFailure} now
 * has five members, and the third arm was a catch-all whose sentence AND whose
 * retry button were both wrong for the shapes that fell into it. Reproduced with
 * a member-only org picked and the create failing:
 *
 *   | scripted stderr                                   | creates | retry offered |
 *   |---------------------------------------------------|---------|---------------|
 *   | acme has repository creation disabled for members  |    3    | twice         |
 *   | Resource protected by organization SAML (HTTP 403) |    3    | twice         |
 *
 * Identical argv, three times, at a destination GitHub had already said it would
 * not accept — and the owner picker had PREDICTED it one step earlier ("your
 * membership role is member, so creating here may be refused"). The arms below
 * are now one per member, and {@link retryCanChangeOutcome} decides the button
 * from the same union rather than from a negation.
 *
 * WHERE "re-run" SURVIVES, AND WHY IT DOES NOT ELSEWHERE. #1711's coupling is not
 * about the word: it is that a re-run walks into an unsatisfiable ruleset ONLY
 * when the step before it told the user to ADD AN `origin`. The name-collision
 * remedy did exactly that and no longer says it. A refusal or a plan limit added
 * nothing to this project, so re-running re-opens THIS offer — where a different
 * owner or visibility is chosen — which is the only remedy that can work.
 *
 * @param canRetry whether another attempt remains — the button is withheld rather
 *   than offered-and-ignored, so the toast never dangles an action the flow will
 *   not honour.
 * @param invokedBy the palette title of the command the user actually ran, so the
 *   re-run advice names it rather than always naming init ({@link reRunPhrase}).
 * @param owner the account the create targeted (`null` = personal), so a refusal
 *   can name the destination the user would have to change. Re-checked with
 *   {@link isSafeRepoSegment} before it is rendered: this is the one value in the
 *   sentence that came from a picker.
 * @returns whether the user asked to try another name.
 */
async function offerCreateRetry(
  result: CreateRepoResult,
  openExternal: (url: string) => void,
  canRetry: boolean,
  invokedBy: string | undefined,
  owner: string | null,
): Promise<boolean> {
  const message = describeCreateFailure(result, invokedBy, owner);
  const actions =
    canRetry && retryCanChangeOutcome(result.failure)
      ? [REPO_RETRY_ACTION, RULESET_DOCS_ACTION]
      : [RULESET_DOCS_ACTION];
  const choice = await vscode.window.showInformationMessage(message, ...actions);
  // Still the create flow, still no repository — so still the page about creating
  // one. A user whose create just failed has no repository to configure a ruleset on.
  if (choice === RULESET_DOCS_ACTION) openExternal(REPO_CREATE_DOCS_URL);
  return choice === REPO_RETRY_ACTION;
}

/**
 * WHERE the create was aimed — THREE states, not the two a
 * `owner !== null && isSafeRepoSegment(owner)` ternary can express.
 *
 * That ternary is why a refusal on the user's OWN account read "Ask an owner of
 * that account for repository-creation rights" (sixth correctness review,
 * 2026-08-30): the personal account (`login: null`, the value the personal
 * picker row deliberately carries) and a login the guard refuses collapsed into
 * one arm, and the sentence built on it is advice to ask yourself for permission
 * you already hold. Two observations, two states — plus the org, which is the
 * only one that has an owner to ask at all.
 */
type CreateDestination =
  /** `owner === null` — `gh` creates under whichever account it is signed in as. */
  | { kind: 'personal' }
  /** A named account that passes the same guard the create applies. */
  | { kind: 'account'; login: string }
  /**
   * A login MinSpec will not spell. Unreachable through the shipped picker (the
   * flow refuses such a login before the create runs), so this exists to keep the
   * sentence honest rather than to serve a live path.
   */
  | { kind: 'unnameable' };

/** {@link CreateDestination} for an owner, using the SAME guard the create applies. */
function classifyCreateDestination(owner: string | null): CreateDestination {
  if (owner === null) return { kind: 'personal' };
  return isSafeRepoSegment(owner) ? { kind: 'account', login: owner } : { kind: 'unnameable' };
}

/** Name the destination in a sentence — one phrase per state, never a placeholder. */
function nameCreateDestination(destination: CreateDestination): string {
  switch (destination.kind) {
    case 'personal':
      // Named by what it IS. MinSpec never reads the user's login (DR-050's
      // 2026-08-25 amendment enumerates one account endpoint and it is not that
      // one), so there is no name to print and none is needed.
      return 'your personal account';
    case 'account':
      return `\`${destination.login}\``;
    case 'unnameable':
      return 'that account';
    default: {
      const _unhandled: never = destination;
      void _unhandled;
      return 'that account';
    }
  }
}

/**
 * WHO could lift a destination refusal, and how — one remedy per destination,
 * because the personal account has no owner to ask.
 *
 * The org arm is the sentence that shipped. The personal arm replaces it with the
 * only thing that can actually change on an account the user already owns: the
 * TOKEN. `gh auth status` is named rather than guessed at, because
 * {@link probeGhReadiness} exited 0 on that exact command moments earlier, so it
 * is known to answer here — the same evidence the failed-org-read note is built
 * on, and the reason neither prescribes `gh auth refresh`.
 */
function askAboutDestination(
  destination: CreateDestination,
  invokedBy: string | undefined,
): string {
  switch (destination.kind) {
    case 'personal':
      return (
        'Check which token `gh` is using and what scopes it carries with `gh auth status`, or ' +
        `re-run ${reRunPhrase(invokedBy)} and pick a different account`
      );
    case 'account':
      return (
        `Ask an owner of \`${destination.login}\` for repository-creation rights, or re-run ` +
        `${reRunPhrase(invokedBy)} and pick a different account`
      );
    case 'unnameable':
      // Nothing to name, so nobody to name asking. The one remedy that survives
      // is the one that does not depend on spelling the destination.
      return `Re-run ${reRunPhrase(invokedBy)} and pick a different account`;
    default: {
      const _unhandled: never = destination;
      void _unhandled;
      return `Re-run ${reRunPhrase(invokedBy)} and pick a different account`;
    }
  }
}

/**
 * The sentence for ONE failure member — GitHub's own words, plus the remedy that
 * member's cause actually admits.
 *
 * Split out of {@link offerCreateRetry} so the arms and the union sit side by
 * side and the `never`-typed default couples them: a member added to
 * {@link CreateRepoFailure} without a sentence of its own fails `npm run
 * typecheck` rather than silently inheriting the catch-all's — which is precisely
 * how three shapes came to be told to try another name.
 */
function describeCreateFailure(
  result: CreateRepoResult,
  invokedBy: string | undefined,
  owner: string | null,
): string {
  const reason = result.error ?? 'gh reported no detail';
  // The one value here that came from a picker rather than from `gh`. THREE
  // destinations, not two — see {@link classifyCreateDestination}.
  const destination = classifyCreateDestination(owner);
  const where = nameCreateDestination(destination);

  switch (result.failure) {
    case 'name-taken':
      // NO "re-run" (see the note above): the step it follows adds an `origin`,
      // which is what makes the next run's ruleset offer unsatisfiable (#1711).
      return (
        `MinSpec: GitHub refused that name (${reason}). Pick a different one — or, if that ` +
        "repository is already yours, add it as this project's `origin` remote."
      );

    case 'not-attempted':
      return (
        `MinSpec: did not run the create (${reason}), so nothing was created — the guard ` +
        'refused before any command ran. The name box applies that same rule, so trying ' +
        'another name cannot change it. Create the repository on GitHub yourself and add it ' +
        "as this project's `origin` remote — see the GitHub docs."
      );

    case 'refused-policy':
      // An ORG POLICY, stated in words. Somebody CAN lift it, and the sentence
      // names who. The remedy is the DESTINATION, which this flow only re-asks
      // on a re-run: the retry loop carries the owner and visibility forward.
      return (
        `MinSpec: GitHub refused to create a repository under ${where} (${reason}). That is a ` +
        'policy on the destination, not a problem with the name — a different name cannot ' +
        `change it. ${askAboutDestination(destination, invokedBy)} — see the GitHub docs.`
      );

    case 'refused-sso':
      // NOT A PERMISSION PROBLEM, and this is the whole reason it is its own
      // member: no role and no grant lifts a SAML block. The thing that has to
      // change is the TOKEN's authorisation for that organisation's SSO, so the
      // sentence must not send the user to ask an owner for rights instead.
      return (
        `MinSpec: GitHub refused to create a repository under ${where} on single sign-on ` +
        `grounds (${reason}). A different name cannot change that, and neither can a ` +
        "permission grant: the token `gh` is using has to be authorised for the single " +
        'sign-on GitHub named. Authorise it in your GitHub account settings, or re-run ' +
        `${reRunPhrase(invokedBy)} and pick a different account — see the GitHub docs.`
      );

    case 'refused-permission':
      // WHICH of policy, role or scope refused is exactly what was NOT observed,
      // so this arm claims none of them — it names the destination it was aimed
      // at and the two things that can still change.
      return (
        `MinSpec: GitHub refused to create a repository under ${where} (${reason}). A different ` +
        'name cannot change that — the refusal is about where the repository would go, not ' +
        `what it is called. ${askAboutDestination(destination, invokedBy)} — see the GitHub docs.`
      );

    case 'plan-limited':
      // A 403 too, and told apart from the `refused-*` members on purpose: sending
      // this user to ask an admin for permission they already have is the same
      // remedy-contradicts-reason defect one level up (`describeRulesetFailure`).
      //
      // IT NO LONGER RULES OUT A DIFFERENT ACCOUNT (sixth correctness review,
      // 2026-08-30). It used to open "Neither a different name nor a different
      // account changes that", and only the first half is true: a plan is a
      // property OF AN ACCOUNT — `Upgrade to GitHub Pro to create private
      // repositories` is a limit on the one that was picked — so creating under
      // an org on a paid plan is exactly what lifts it, and the owner picker is
      // one re-run away. Ruling out the remedy most likely to work is the same
      // unestablished-claim defect as prescribing one that cannot.
      return (
        `MinSpec: GitHub refused to create a repository under ${where} on plan grounds ` +
        `(${reason}). A different name cannot change that — the limit is on the account and the ` +
        `visibility, not the name. Create it public instead, upgrade the plan on ${where}, or ` +
        `re-run ${reRunPhrase(invokedBy)} and pick an account whose plan allows it — see the ` +
        'GitHub docs.'
      );

    case 'unconfirmed':
      return (
        `MinSpec: could not confirm the repository was created (${reason}) — a create that ` +
        'fails AFTER the repository exists looks the same from here. Check your repositories ' +
        "on GitHub first, then either add it as this project's `origin` remote or try " +
        'another name — see the GitHub docs.'
      );

    case undefined:
      // A SUCCESS ARRIVING AT A FAILURE TOAST — a bug in this file, not a state
      // GitHub reported. It gets an arm of its own so the guard below can be
      // real: `result.failure` is `CreateRepoFailure | undefined`, and while
      // `undefined` fell through to `default` the assignment there needed an
      // `as never` cast, which succeeds for EVERY type and made the whole
      // exhaustiveness check unable to fail (sixth correctness review,
      // 2026-08-30). The comment beside it promised the opposite, which is what
      // made the inertness invisible.
      return (
        `MinSpec: the create did not complete (${reason}), and MinSpec did not establish ` +
        'whether the repository exists. Check your repositories on GitHub — see the GitHub docs.'
      );

    default: {
      // EXHAUSTIVENESS, both halves, AND UNCAST. Compile time: a member added to
      // {@link CreateRepoFailure} without a sentence of its own narrows to
      // something other than `never` and fails `npm run typecheck`, so the union
      // and the copy fail together — that is the coupling, and it only exists
      // because nothing casts here. Runtime: it says the only thing true of every
      // failure, because a throw would take the whole toast with it.
      const _unhandled: never = result.failure;
      void _unhandled;
      return (
        `MinSpec: the create did not complete (${reason}), and MinSpec did not establish ` +
        'whether the repository exists. Check your repositories on GitHub — see the GitHub docs.'
      );
    }
  }
}

/**
 * NON-BLOCKING post-init advisory (#356, reworked per DR-050 Amendment
 * 2026-07-01): nudge the user toward a branch ruleset that requires CI status
 * checks on the default branch — but only surface a toast when there is
 * something for the user to DO.
 *
 * Network discipline (Tier-0 boundary, per DR-050 Amendments 2026-07-01,
 * 2026-07-16 and 2026-08-25): the READ-ONLY PROBES run AUTONOMOUSLY; only the
 * MUTATING writes are consent-gated.
 *   - not a git repo → return (zero process, zero toast).
 *   - `gh` missing/unauthed → info toast linking the docs. Zero `gh api`. Done.
 *   - `gh` ready + NO usable GitHub slug → CLASSIFY the remotes first
 *     ({@link classifyRemoteDestination}), because `resolveRepo`'s `null` collapses
 *     four different states and only one of them may be offered a repository:
 *       - remotes that DISAGREE, a remote on ANOTHER HOST, a slug failing
 *         {@link REPO_SLUG_RE}, or a git read that FAILED → the zero-network docs
 *         link it always had, with a sentence stating what was actually observed
 *         ({@link describeUnusableRemote}). Zero `gh api`, and NO account read:
 *         DR-050's amendment authorises that read only where no remote exists.
 *       - POSITIVELY no remotes at all → the CREATE-REPO OFFER (#1694, DR-050
 *         Amendment 2026-08-25), replacing what used to be a dead end:
 *           - AUTONOMOUS account read ({@link probeOwnerCandidates}) — ONE
 *             endpoint, `/user/memberships/orgs` — to name the destination up
 *             front. BRANCH-SCOPED: this is the ONLY branch it runs in, and its
 *             result is discarded, never persisted. Zero `gh api repos/`.
 *           - exactly ONE toast: [Create GitHub repo] [Not now] [Learn more].
 *               - "Create GitHub repo" → visibility (private first), owner (only
 *                 when there is more than one, which is what the toast says),
 *                 name, then `gh repo create` (this click IS the consent for the
 *                 mutation), which also wires `origin`. Success → say what was
 *                 created and that it has no commits yet, and STOP — the new
 *                 repository is EMPTY, so the ruleset offer below must not run
 *                 against it (see that branch's comment for the #559 deadlock
 *                 this avoids, and {@link announceRepoCreated} for why the toast
 *                 no longer sends the user back for it). Failure → GitHub's own
 *                 message with a remedy that matches it, and a retry into the
 *                 name box only where a new name could actually change the
 *                 outcome.
 *               - "Not now" / dismissal (Escape) → nothing created, nothing
 *                 recorded, nothing suppressed. The offer returns next init; see
 *                 the comment above {@link RULESET_DECLINE_ACTION} for why the
 *                 suppression flag that used to live here was deleted.
 *               - "Learn more"       → open the docs on CREATING A REPOSITORY
 *                 ({@link REPO_CREATE_DOCS_URL}), not the rulesets page: this
 *                 branch fired because there is no repository to configure.
 *           - the account probe yielding NOTHING → the zero-network docs link
 *             (also the repository-creation page). We never offer a button we
 *             already know has nowhere to create, and the sentence never advises
 *             `gh auth login` — `probeGhReadiness` just established `gh` is signed in.
 *   - `gh` ready + repo resolves → AUTO-PROBE (read-only `gh api .../rulesets`
 *     GET of the repo's OWN settings, no consent toast):
 *       - a qualifying ruleset ALREADY EXISTS → SILENT. No toast at all.
 *       - NONE found → exactly ONE toast offering to create one:
 *         [Create ruleset] [Not now] [Learn more].
 *           - "Create ruleset" → POST via gh (this click IS the consent for the
 *             mutation). success → toast; 403/error → docs link.
 *           - "Not now"/dismiss → nothing.
 *           - "Learn more"     → open the rulesets docs.
 *
 * Why the probes are autonomous: `probeGhReadiness`, `hasRequiredChecksRuleset` /
 * `listRequiredCheckContexts`, and the reviewer-secret-NAMES probe
 * ({@link probeReviewerConfigured}, via {@link resolveWantedChecks}) are a
 * read-only capability probe + GETs of the repo's OWN configuration — they
 * egress no user artifacts, spec content, secret VALUES, or telemetry (the same
 * class as MinSpec shelling `git fetch`). Per DR-050 they need no prior consent
 * toast: the rulesets read under Amendment 2026-07-01, and the `actions/secrets`
 * NAMES read under Amendment 2026-07-16 (materialising the founder's decision on
 * #796).
 *
 * {@link probeOwnerCandidates} (#1694) is the one probe whose subject is the
 * user's ACCOUNT rather than a repo's config, which is why its Amendment
 * (2026-08-25) attaches its bounds as CONDITIONS rather than hardening: it is
 * BRANCH-SCOPED — issued only where {@link classifyRemoteDestination} positively
 * established that there are NO remotes, so neither a project that has one nor a
 * project whose remotes merely failed to resolve ever triggers it — it is ONE
 * enumerated endpoint, and it is NON-PERSISTING, consumed to populate the picker
 * and then dropped. It reads `role`/`state` on the user's own memberships and
 * nothing else; it does not read the user's login, because the personal account
 * is created under by omitting the owner prefix. What it does NOT establish is
 * where the MinSpec App is set up: a Tier-0 extension cannot, so `role: admin` is
 * rendered as installability, never as detection.
 *
 * Only the three WRITES — the repo create, the ruleset CREATE and the ruleset
 * ADD — mutate anything, so those are the actions gated on an explicit click.
 *
 * The created ruleset's required checks come from
 * {@link resolveRequiredChecks} (the `minspec.ruleset.requiredChecks` setting,
 * default {@link DEFAULT_REQUIRED_CHECK_CONTEXTS}); `deps.requiredChecks`
 * overrides it for tests.
 *
 * Best-effort: any failure is swallowed (at worst the docs link), and never
 * affects the init result.
 */
export async function offerRulesetAdvisory(
  folder: string,
  deps: RulesetAdvisoryDeps = {},
): Promise<void> {
  const run = deps.run ?? defaultCommandRunner;
  const resolveRepo = deps.resolveRepo ?? getRepoFromRemote;
  const classifyRemotes =
    deps.classifyRemotes ?? ((f: string) => classifyRemoteDestination(f, run));
  const openExternal = deps.openExternal ?? ((url: string) => vscode.env.openExternal(vscode.Uri.parse(url)));
  const isRepo = deps.isRepo ?? ((f: string) => fs.existsSync(path.join(f, '.git')));

  // Cheap guard: not a git repo → no remote, no ruleset to advise about. Return
  // before probing gh at all (mirrors offerScaffoldCommit) so non-repo init
  // flows stay both toast-free AND zero-process.
  if (!isRepo(folder)) return;

  try {
    // gh unavailable/unauthed → zero-network docs link. Done — but SAY WHICH,
    // because the two remedies are different commands and the sentence used to
    // hand over both (see {@link describeGhUnready}).
    const readiness = await probeGhReadiness(run);
    if (readiness !== 'ready') {
      await linkRulesetDocs(
        'MinSpec: protect your default branch with a ruleset that requires CI ' +
          `(${DEFAULT_REQUIRED_CHECK_CONTEXTS.join(', ')}) status checks. ` +
          `${describeGhUnready(readiness)}, or see the GitHub docs.`,
        openExternal,
      );
      return;
    }

    const repo = await resolveRepo(folder);

    // NO USABLE GITHUB SLUG — but that is FOUR states, not one, and only ONE of
    // them may be offered a new repository (#1694).
    //
    // `resolveRepo` answers with `owner/repo` or `null`, and that `null` covers
    // "no remotes", "remotes that disagree", "a remote on another host", and "the
    // git read failed" alike — see {@link RemoteDestination}, and git-remotes.ts's
    // header, which exists to warn against exactly this collapse. Keying the
    // create offer on the `null` would offer to create a repository to users who
    // HAVE one, and would fire the account probe in branches DR-050's 2026-08-25
    // amendment does not authorise: "a repo that already has a remote never
    // triggers it" is a load-bearing bound on that read, not a nicety.
    //
    // So: classify first, offer only for a POSITIVELY established `none`, and let
    // every other state keep the zero-network docs link it always had — with a
    // sentence that states what MinSpec actually observed.
    //
    // A slug that resolved but FAILED the charset assertion needs no classifying:
    // resolution produced something, so a remote exists. That assertion is
    // defense-in-depth — the slug is about to be interpolated into a `gh api
    // repos/{owner}/{repo}/...` path — and nothing repo-scoped runs until a slug
    // PASSES it.
    if (!repo || !REPO_SLUG_RE.test(repo)) {
      const destination: RemoteDestination = repo
        ? { kind: 'other-remote' }
        : await classifyRemotes(folder);
      if (destination.kind !== 'none') {
        await linkRulesetDocs(describeUnusableRemote(destination), openExternal);
        return;
      }
      await offerRepoCreation(folder, run, openExternal, deps);
      // AND STOP — do NOT fall through into the ruleset offer below (correctness
      // review 2026-08-28).
      //
      // Whatever `offerRepoCreation` just created, it created EMPTY: the create
      // deliberately carries no `--push`, so the new repository has zero commits,
      // zero refs, zero workflow files and has never run a job. The offer below
      // derives its required checks from `resolveWantedChecks`, whose Tier-B
      // producibility test reads the LOCAL `package.json` scripts and LOCAL
      // `.github/workflows/*.yml`. That local-tree proxy is sound for a CLONE of a
      // repository that already runs CI, and simply false for one just created
      // empty — and this branch is the only path in MinSpec that creates one.
      //
      // Accepting the offer would POST a ruleset requiring contexts nothing can
      // report: with required status checks on the default branch, the user's very
      // FIRST push is blocked, and every PR after it pends forever. That is #559's
      // permanent-pending deadlock, re-opened at the one moment MinSpec knows for
      // certain that no check is producible. `probeReviewerConfigured` correctly
      // kept the Tier-A checks out, because it is remote-aware; the Tier-B ones
      // came from the local tree and bypassed that guard entirely.
      //
      // So the honest stop is here, not a wider `resolveWantedChecks` (that guard
      // is load-bearing for every other caller).
      //
      // AND THE SUCCESS TOAST STOPS AT THE PUSH, for the same reason one level up
      // (third correctness review, 2026-08-28). Stopping the fall-through guards
      // exactly ONE invocation; it does nothing about the NEXT one, and the toast
      // used to send the user there ("push your first commit, then re-run MinSpec:
      // Initialize SDD Structure to set up branch protection"). On that re-run the
      // Tier-B checks are still inferred from the local `package.json` and the
      // offer is still unsatisfiable — the same deadlock, reached one command
      // later. The local-tree inference is pre-existing and #1711 owns it; see
      // {@link announceRepoCreated} for the copy that no longer walks into it.
      return;
    }
    const [owner, name] = repo.split('/');

    // The WANTED producible check set. `deps.requiredChecks` overrides (tests /
    // explicit set); else probe the repo + resolve the tiered set (#564) so we
    // only ever require checks the repo can actually PRODUCE (no #559 deadlock).
    const wanted = deps.requiredChecks
      ? [...deps.requiredChecks]
      : await resolveWantedChecks(folder, owner, name, run);

    // AUTO-PROBE (read-only config GET) — runs autonomously, NO consent toast.
    // A GET of the repo's OWN rulesets egresses no user data (same class as
    // `git fetch`); per DR-050 no prior opt-in is required. SYMMETRIC (#564 /
    // SPEC-033 FR-3): we compare WHICH checks the ruleset requires to `wanted`,
    // not merely "does a ruleset exist" — the sealbox asymmetry where a ruleset
    // requiring only `MinSpec SDD validation` read as "configured" and never
    // gained ai-review/ready-to-merge. Fully satisfied ⇒ SILENT.
    const existing = await listRequiredCheckContexts(owner, name, run);
    const have = new Set(existing?.contexts ?? []);
    const missing = wanted.filter((c) => !have.has(c));
    if (missing.length === 0) return;

    if (!existing) {
      // No ruleset at all → offer to CREATE with the full wanted set. The click
      // IS the consent for the mutation (DR-050).
      const choice = await vscode.window.showInformationMessage(
        `MinSpec: ${repo} has no branch ruleset requiring CI checks ` +
          `(${wanted.join(' + ')}) on its default branch. Create one?`,
        RULESET_CREATE_ACTION,
        RULESET_DECLINE_ACTION,
        RULESET_LEARN_MORE_ACTION,
      );
      if (choice === RULESET_CREATE_ACTION) {
        const outcome = await createRequiredChecksRuleset(owner, name, run, wanted);
        if (outcome.created) {
          vscode.window.showInformationMessage(
            `MinSpec: created a ruleset requiring ${wanted.join(' + ')} on ${repo}'s default branch.`,
          );
          return;
        }
        const why = describeRulesetFailure(outcome);
        await linkRulesetDocs(
          `MinSpec: could not create the ruleset (${why}). Create it manually — see the GitHub docs.`,
          openExternal,
        );
        return;
      }
      if (choice === RULESET_LEARN_MORE_ACTION) openExternal(RULESET_DOCS_URL);
      return;
    }

    // A ruleset EXISTS but is MISSING required checks (the sealbox case) → offer
    // to ADD them so PRs can't merge unreviewed. The click IS the consent.
    // "without the AI-review gate" only holds when a Tier-A check (ai-review /
    // ready-to-merge) is among the missing set — a Tier-B-only gap (lint/test/
    // build) has nothing to do with AI review, so name the consequence generically.
    const missingGateCheck = missing.some((c) => c === AI_REVIEW_CHECK || c === READY_TO_MERGE_CHECK);
    const consequence = missingGateCheck
      ? 'so a PR could merge without the AI-review gate'
      : 'so a PR could merge without full CI coverage';
    const choice = await vscode.window.showInformationMessage(
      `MinSpec: ${repo}'s branch ruleset does not require ${missing.join(' + ')}` +
        ` — ${consequence}. Add ${missing.length === 1 ? 'it' : 'them'}?`,
      RULESET_ADD_ACTION,
      RULESET_DECLINE_ACTION,
      RULESET_LEARN_MORE_ACTION,
    );
    if (choice === RULESET_ADD_ACTION) {
      const outcome = await updateRulesetRequiredChecks(owner, name, run, existing.rulesetId, missing);
      if (outcome.updated) {
        vscode.window.showInformationMessage(
          `MinSpec: added ${missing.join(' + ')} to ${repo}'s branch ruleset.`,
        );
        return;
      }
      const why = describeRulesetFailure(outcome);
      await linkRulesetDocs(
        `MinSpec: could not update the ruleset (${why}). Add the checks manually — see the GitHub docs.`,
        openExternal,
      );
      return;
    }
    if (choice === RULESET_LEARN_MORE_ACTION) openExternal(RULESET_DOCS_URL);
  } catch {
    // Advisory only — never let a ruleset-advisory failure break init.
  }
}

// ---------------------------------------------------------------------------
// Post-init GitHub Pull Requests extension advisory
// ---------------------------------------------------------------------------

/** Marketplace id of the official GitHub PR review/merge extension. */
export const GITHUB_PR_EXTENSION_ID = 'GitHub.vscode-pull-request-github';

/**
 * Zero-network fallback: the extension's Microsoft Marketplace listing. Used
 * only for official Microsoft builds — see {@link resolveGitHubPrExtensionLearnMoreUrl}.
 */
export const GITHUB_PR_EXTENSION_MARKETPLACE_URL =
  'https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github';

/**
 * Zero-network fallback for non-Microsoft builds (VSCodium, code-server forks,
 * etc.), which default to the Open VSX Registry rather than the Microsoft
 * Marketplace. The extension is dual-published under the SAME id
 * ({@link GITHUB_PR_EXTENSION_ID}) by GitHub's own `open-vsx` namespace, so
 * `workbench.extensions.installExtension` already resolves correctly on those
 * builds without any code change — this URL only affects which page "Learn
 * more" opens.
 */
export const GITHUB_PR_EXTENSION_OPEN_VSX_URL =
  'https://open-vsx.org/extension/GitHub/vscode-pull-request-github';

const GITHUB_PR_EXT_INSTALL_ACTION = 'Install';
const GITHUB_PR_EXT_DECLINE_ACTION = 'Not now';
const GITHUB_PR_EXT_LEARN_MORE_ACTION = 'Learn more';

/**
 * The Microsoft Marketplace's own ToS restricts its gallery to Microsoft's
 * official builds, so every non-Microsoft build (VSCodium, code-server forks,
 * Cursor, Windsurf, …) points `vscode.env.appName` at something other than
 * "Visual Studio Code" and defaults its extension gallery to Open VSX instead.
 * Only Microsoft's own builds ("Visual Studio Code", "Visual Studio Code -
 * Insiders") get the Marketplace link; everything else gets Open VSX, which
 * is where those builds actually install from.
 */
export function resolveGitHubPrExtensionLearnMoreUrl(appName: string): string {
  return /^Visual Studio Code\b/.test(appName)
    ? GITHUB_PR_EXTENSION_MARKETPLACE_URL
    : GITHUB_PR_EXTENSION_OPEN_VSX_URL;
}

/** Dependencies for {@link offerGitHubPrExtensionAdvisory}, injectable for tests. */
export interface GitHubPrExtAdvisoryDeps {
  /** Whether `folder` is a git working tree. Defaults to the same `.git`-existence check the other advisories use. */
  isRepo?: (folder: string) => boolean;
  /** Whether the extension is already installed. Defaults to `vscode.extensions.getExtension`. */
  isInstalled?: (id: string) => boolean;
  /** Trigger the install. Defaults to the `workbench.extensions.installExtension` command. */
  install?: (id: string) => Promise<void>;
  /** Open an external URL (defaults to VS Code's opener). */
  openExternal?: (url: string) => void;
  /** The running editor's name. Defaults to `vscode.env.appName`. */
  appName?: string;
}

/**
 * NON-BLOCKING, first-init-only advisory: recommend the GitHub Pull Requests
 * and Issues extension. Reviewing/merging locally through it avoids the messy
 * history GitHub's browser-side "Rebase and merge" button can leave behind —
 * merging locally keeps a clean merge commit and resolves conflicts in the
 * editor instead of the browser's limited UI.
 *
 * Silent when: not a git repo (nothing to review/merge), or the extension is
 * already installed (nothing for the user to do) — mirrors the "silent when
 * already satisfied" shape of {@link offerRulesetAdvisory}.
 *
 * Installing an extension is a mutating, network-touching action, so — same
 * consent rule as {@link offerRulesetAdvisory}'s ruleset create — it fires
 * ONLY on the user's explicit "Install" click; the toast's other choices
 * ("Not now", "Learn more") make no network call. Best-effort: any failure is
 * swallowed and never affects the init result.
 */
export async function offerGitHubPrExtensionAdvisory(
  folder: string,
  deps: GitHubPrExtAdvisoryDeps = {},
): Promise<void> {
  const isRepo = deps.isRepo ?? ((f: string) => fs.existsSync(path.join(f, '.git')));
  if (!isRepo(folder)) return;

  try {
    const isInstalled =
      deps.isInstalled ?? ((id: string) => vscode.extensions.getExtension(id) !== undefined);
    if (isInstalled(GITHUB_PR_EXTENSION_ID)) return; // already have it — nothing to do

    const install =
      deps.install ??
      (async (id: string) => {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
      });
    const openExternal =
      deps.openExternal ?? ((url: string) => vscode.env.openExternal(vscode.Uri.parse(url)));

    const choice = await vscode.window.showInformationMessage(
      'MinSpec tip: the GitHub Pull Requests and Issues extension lets you review and merge ' +
        "PRs from VS Code. It avoids the messy history GitHub's browser \"Rebase and merge\" " +
        'button can leave behind, and resolves conflicts locally instead of in the browser.',
      GITHUB_PR_EXT_INSTALL_ACTION,
      GITHUB_PR_EXT_DECLINE_ACTION,
      GITHUB_PR_EXT_LEARN_MORE_ACTION,
    );

    if (choice === GITHUB_PR_EXT_INSTALL_ACTION) {
      await install(GITHUB_PR_EXTENSION_ID);
      return;
    }
    if (choice === GITHUB_PR_EXT_LEARN_MORE_ACTION) {
      const appName = deps.appName ?? vscode.env.appName;
      openExternal(resolveGitHubPrExtensionLearnMoreUrl(appName));
    }
    // "Not now" / dismiss → nothing further.
  } catch {
    // Advisory only — never let this failing break init.
  }
}

// ---------------------------------------------------------------------------
// Post-init coverage-minimum onboarding prompt
// ---------------------------------------------------------------------------

/** VS Code setting id read for the QuickPick's pre-selected "recommended" value. */
const COVERAGE_MINIMUM_SETTING = 'minspec.coverage.minimumPercentage';

/** QuickPick action: type a percentage not in the preset list. */
const COVERAGE_CUSTOM_ACTION = 'Custom…';

/**
 * Resolve the "recommended" percentage the onboarding prompt pre-selects: the
 * `minspec.coverage.minimumPercentage` VS Code setting if set (e.g. a
 * committed `.vscode/settings.json` encoding a team's policy), else
 * {@link DEFAULT_COVERAGE_MINIMUM}. Read failures degrade to the default —
 * mirrors {@link resolveRequiredChecks}.
 */
function resolveRecommendedCoverageMinimum(): number {
  try {
    const configured = vscode.workspace.getConfiguration().get<unknown>(COVERAGE_MINIMUM_SETTING);
    if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 0 && configured <= 100) {
      return configured;
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_COVERAGE_MINIMUM;
}

/**
 * SPEC coverage-gate onboarding: `scaffold()` already wrote
 * `coverage.minimumPercentage: 80` into the fresh `.minspec/config.json` —
 * this asks the dev whether 80 (or their team's `minspec.coverage.minimumPercentage`
 * setting) is actually what they want enforced, and persists the answer via
 * {@link setCoverageMinimum}. `.minspec/config.json` is the file `vitest.config.ts`
 * and CI read — a VS Code setting alone can't reach a headless CI run.
 *
 * Non-modal-equivalent (QuickPick, dismissable), best-effort: any failure or
 * dismissal leaves the 80% default scaffold() already wrote in place and must
 * never break init.
 */
export async function offerCoverageThresholdPrompt(folder: string): Promise<void> {
  try {
    const recommended = resolveRecommendedCoverageMinimum();
    const presets = [60, 70, 80, 90].filter((p) => p !== recommended);
    const items: Array<{ label: string; value: number | typeof COVERAGE_CUSTOM_ACTION }> = [
      { label: `${recommended}% (recommended)`, value: recommended },
      ...presets.map((p) => ({ label: `${p}%`, value: p })),
      { label: COVERAGE_CUSTOM_ACTION, value: COVERAGE_CUSTOM_ACTION },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Minimum code coverage to enforce for this project (CI fails below it)',
    });
    if (!picked) return; // dismissed — keep the 80% scaffold() already wrote

    let pct: number;
    if (picked.value === COVERAGE_CUSTOM_ACTION) {
      const input = await vscode.window.showInputBox({
        prompt: 'Minimum coverage percentage (whole number, 0-100)',
        value: String(recommended),
        validateInput: (v) => {
          const n = Number(v);
          return Number.isInteger(n) && n >= 0 && n <= 100 ? undefined : 'Enter a whole number 0-100';
        },
      });
      if (input === undefined) return; // dismissed
      pct = Number(input);
    } else {
      pct = picked.value;
    }

    setCoverageMinimum(folder, pct);
    vscode.window.showInformationMessage(
      `MinSpec: coverage gate set to ${pct}% (enforced by vitest thresholds in CI).`,
    );
  } catch {
    // Advisory only — never let this prompt failing break init.
  }
}

export async function initCommand(
  folderArg?: string,
  deps?: OfferScaffoldCommitDeps & {
    ruleset?: RulesetAdvisoryDeps;
    remoteRename?: RemoteRenameDeps;
    githubPrExt?: GitHubPrExtAdvisoryDeps;
  },
): Promise<void> {
  const folder = folderArg ?? (await resolveTargetFolder());
  if (!folder) return;
  // Onboarding only makes sense the FIRST time a project gets a config.json —
  // check before scaffold() writes the default, since scaffold() is
  // idempotent and no-ops on an existing file (never re-prompt on refresh).
  const isFirstInit = !fs.existsSync(path.join(folder, '.minspec', 'config.json'));
  // The scaffold + harness writes are a multi-file synchronous sequence. If one
  // write fails partway, the project is left with a partial .minspec/ (and the
  // drift detector then reports false drift). Catch any failure, surface exactly
  // what went wrong, and do NOT report a misleading "Initialized" success (#153).
  let untrackedOnInit: string[] = [];
  try {
    scaffold(folder);
    // `?? []` — a stubbed generateHarnessFiles (several suites mock it) returns
    // undefined, and an un-iterable here would turn a reporting nicety into an
    // init-breaking TypeError. Reporting must never be able to fail the command.
    untrackedOnInit = generateHarnessFiles(folder) ?? [];
  } catch (err) {
    vscode.window.showErrorMessage(
      `MinSpec: Initialization failed — ${describeError(err)}. ` +
        'The .minspec/ folder may be incomplete; resolve the error and re-run.',
    );
    return;
  }
  vscode.window.showInformationMessage(
    'MinSpec: Initialized .minspec/ and generated harness files.',
  );
  // Report any `git rm --cached` the reconcile performed. initCommand is
  // re-runnable and NOT gated on first-init, so Initialize on an already-broken
  // repo does mutate the index — reporting it here is what keeps that from being
  // a silent git action (#1146). Same surface the refresh path uses.
  for (const outputPath of untrackedOnInit) {
    await surfaceManagedRegionWarning(folder, {
      outputPath,
      message: untrackedNoticeMessage(outputPath),
      kind: 'untracked',
    });
  }
  if (isFirstInit) {
    await offerCoverageThresholdPrompt(folder);
    // Onboarding-only nudge toward the GitHub PR extension (see doc comment on
    // offerGitHubPrExtensionAdvisory) — gated to first init like the coverage
    // prompt so it doesn't repeat on every harness refresh.
    await offerGitHubPrExtensionAdvisory(folder, deps?.githubPrExt);
  }
  // Post-init "what to commit" hint + offer (#222). Best-effort, non-modal,
  // never blocks the init result.
  await offerScaffoldCommit(folder, deps);
  // Post-init branch-ruleset advisory (#356; reworked per DR-050 Amendment
  // 2026-07-01). NON-BLOCKING; the read-only config PROBE runs autonomously
  // (no consent toast) — a ruleset that already exists is silent — and only the
  // MUTATING create is consent-gated behind an explicit "Create ruleset" click.
  // Failures never affect the init result.
  //
  // BEFORE the ruleset advisory (#1545): a remote that is not called `origin` is
  // exactly what stops the ruleset probe identifying the repo, so asking afterwards
  // would have the user fix the remote and still need to re-run init to get the
  // offer that the fix unblocks.
  await offerRemoteRenameAdvisory(folder, deps?.remoteRename);
  // `invokedBy` LAST, after the caller's deps, so the advisory's copy always names
  // THIS command and a caller cannot make it claim the other one (#1694 F6).
  await offerRulesetAdvisory(folder, { ...deps?.ruleset, invokedBy: INIT_COMMAND_TITLE });
}

// ---------------------------------------------------------------------------
// Managed-region missing-markers warning: attribution + actions (#604)
// ---------------------------------------------------------------------------

/** Warning action: consent-gated whole-file rewrite from the current template. */
const RESCAFFOLD_ACTION = 'Re-scaffold (overwrite)';
/** Warning action: open the affected file so the user can inspect/fix it by hand. */
const OPEN_FILE_ACTION = 'Open file';
/** Untracked-notice action: the index changed, so show where to review and commit it. */
const SHOW_SCM_ACTION = 'Show Source Control';

/**
 * Surface a single {@link ManagedRegionWarning} left behind by
 * `refreshHarnessFiles` after its auto-heal (scaffold.ts) couldn't prove the file
 * safe to recover automatically. Three defects this closes (#604):
 *   - the bare message carried no project attribution, so two folders with the
 *     identical broken file (e.g. two workspace roots) were indistinguishable —
 *     now prefixed with the workspace folder's label;
 *   - `showWarningMessage(w.message)` passed no action items, forcing a manual
 *     fix — now offers `Re-scaffold (overwrite)` (consent-gated whole-file
 *     rewrite) and `Open file`;
 * Best-effort: a re-scaffold failure is surfaced as an error but never throws out
 * of the refresh flow.
 */
async function surfaceManagedRegionWarning(folder: string, w: ManagedRegionWarning): Promise<void> {
  const label = workspaceFolderLabel(folder);

  // An 'untracked' notice reports a `git rm --cached`, not a scaffolding problem.
  // "Re-scaffold" would be meaningless (nothing was scaffolded) and actively
  // misleading, so this kind gets its own surface: state what changed to the index
  // and offer the place to review and commit it (#1146).
  if (w.kind === 'untracked') {
    const choice = await vscode.window.showInformationMessage(
      `[${label}] ${w.message}`,
      SHOW_SCM_ACTION,
      OPEN_FILE_ACTION,
    );
    if (choice === SHOW_SCM_ACTION) {
      await vscode.commands.executeCommand('workbench.view.scm');
    } else if (choice === OPEN_FILE_ACTION) {
      const doc = await vscode.workspace.openTextDocument(path.join(folder, w.outputPath));
      await vscode.window.showTextDocument(doc, { preview: false });
    }
    return;
  }

  // A 'project-name-mismatch' reports that the harness's own name beat the
  // directory's, so nothing is broken and "Re-scaffold" would be nonsense — worse,
  // it would imply the harness is damaged when it is the thing that was right.
  // Offer the file where a deliberate rename is declared instead (#1529).
  if (w.kind === 'project-name-mismatch') {
    const choice = await vscode.window.showInformationMessage(
      `[${label}] ${w.message}`,
      OPEN_FILE_ACTION,
    );
    if (choice === OPEN_FILE_ACTION) {
      const doc = await vscode.workspace.openTextDocument(path.join(folder, w.outputPath));
      await vscode.window.showTextDocument(doc, { preview: false });
    }
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `[${label}] ${w.message}`,
    RESCAFFOLD_ACTION,
    OPEN_FILE_ACTION,
  );

  if (choice === RESCAFFOLD_ACTION) {
    try {
      rescaffoldManagedRegionFile(folder, w.outputPath);
      vscode.window.showInformationMessage(`MinSpec: re-scaffolded ${w.outputPath}.`);
    } catch (err) {
      vscode.window.showErrorMessage(
        `MinSpec: could not re-scaffold ${w.outputPath} — ${describeError(err)}.`,
      );
    }
  } else if (choice === OPEN_FILE_ACTION) {
    const doc = await vscode.workspace.openTextDocument(path.join(folder, w.outputPath));
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}

export async function initRefreshCommand(
  folderArg?: string,
  deps?: OfferScaffoldCommitDeps & {
    ruleset?: RulesetAdvisoryDeps;
    remoteRename?: RemoteRenameDeps;
  },
): Promise<void> {
  const folder = folderArg ?? (await resolveTargetFolder());
  if (!folder) return;
  // Same all-or-nothing concern as initCommand: a mid-sequence write failure
  // must surface, not silently leave a partial/inconsistent harness (#153).
  let warnings: ReturnType<typeof refreshHarnessFiles>;
  try {
    warnings = refreshHarnessFiles(folder);
  } catch (err) {
    vscode.window.showErrorMessage(
      `MinSpec: Harness refresh failed — ${describeError(err)}. ` +
        'Some files may be partially written; resolve the error and re-run.',
    );
    return;
  }
  vscode.window.showInformationMessage(
    'MinSpec: Refreshed harness files (user edits preserved).',
  );
  for (const w of warnings) {
    await surfaceManagedRegionWarning(folder, w);
  }
  // Post-refresh "what to commit" offer — the SAME affordance init gives (#222).
  // Without this, a drift-triggered refresh (e.g. on window reload via
  // auto-bootstrap) rewrites the harness files but leaves them stranded
  // uncommitted, unlike init. Best-effort, non-modal; never blocks the refresh.
  await offerScaffoldCommit(folder, { ...deps, variant: 'refresh' });
  // Post-refresh ruleset advisory — the SAME governance provisioning init gives
  // (#564 / SPEC-033 FR-3). Refresh is where an EXISTING repo whose ruleset
  // predates the ai-review/ready-to-merge checks (the sealbox case) gets offered
  // the missing required checks; without this, only freshly-inited repos would.
  // Same ordering rationale as init (#1545).
  await offerRemoteRenameAdvisory(folder, deps?.remoteRename);
  // ...and the advisory is told it was REFRESH that invoked it, so its "re-run"
  // copy names the command the user actually used rather than always naming init
  // (#1694 F6). Reachable from the auto-bootstrap drift prompt as well as the
  // palette, which is why the wrong name here is repeated rather than one-off.
  await offerRulesetAdvisory(folder, { ...deps?.ruleset, invokedBy: REFRESH_COMMAND_TITLE });
}

/** Extract a human-readable message from an unknown thrown value. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
