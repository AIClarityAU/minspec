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
import { resolveRemotes, renameToOriginCandidate } from '../lib/git-remotes';
import {
  type CommandRunner,
  RULESET_DOCS_URL,
  DEFAULT_REQUIRED_CHECK_CONTEXTS,
  createRequiredChecksRuleset,
  defaultCommandRunner,
  isGhReady,
  resolveCheckContexts,
  listRequiredCheckContexts,
  probeReviewerConfigured,
  updateRulesetRequiredChecks,
  resolveTieredRequiredChecks,
  detectCodeChecks,
  AI_REVIEW_CHECK,
  READY_TO_MERGE_CHECK,
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

/** Toast action: open the GitHub rulesets docs page (zero-network-path fallback). */
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
/** Create-offer action: decline — make no `gh api` write. */
const RULESET_DECLINE_ACTION = 'Not now';
/** Create-offer action: open the rulesets docs instead of creating. */
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
 */
function describeRulesetFailure(outcome: {
  forbidden: boolean;
  planLimited: boolean;
  reason: string | null;
}): string {
  if (outcome.planLimited) {
    return (
      outcome.reason ??
      'rulesets are not available for this repository — private repositories need a paid plan'
    );
  }
  if (outcome.reason) return `GitHub said: ${outcome.reason}`;
  if (outcome.forbidden) return 'the request was refused — your gh token may lack repo-admin scope';
  return 'the request failed';
}

/** Show an info toast linking the rulesets docs, with a one-click open action. */
async function linkRulesetDocs(
  message: string,
  openExternal: (url: string) => void,
): Promise<void> {
  const choice = await vscode.window.showInformationMessage(message, RULESET_DOCS_ACTION);
  if (choice === RULESET_DOCS_ACTION) openExternal(RULESET_DOCS_URL);
}

/**
 * NON-BLOCKING post-init advisory (#356, reworked per DR-050 Amendment
 * 2026-07-01): nudge the user toward a branch ruleset that requires CI status
 * checks on the default branch — but only surface a toast when there is
 * something for the user to DO.
 *
 * Network discipline (Tier-0 boundary, per DR-050 Amendment 2026-07-01): the
 * READ-ONLY CONFIG PROBE runs AUTONOMOUSLY; only the MUTATING create is
 * consent-gated.
 *   - not a git repo → return (zero process, zero toast).
 *   - `gh` missing/unauthed → info toast linking the docs. Zero `gh api`. Done.
 *   - `gh` ready + no GitHub remote (or a malformed slug) → docs link. Zero
 *     `gh api`. Done.
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
 * Why the probe is autonomous: `isGhReady`, `hasRequiredChecksRuleset` /
 * `listRequiredCheckContexts`, and the reviewer-secret-NAMES probe
 * ({@link probeReviewerConfigured}, via {@link resolveWantedChecks}) are a
 * read-only capability probe + GETs of the repo's OWN configuration — they
 * egress no user artifacts, spec content, secret VALUES, or telemetry (the same
 * class as MinSpec shelling `git fetch`). Per DR-050 they need no prior consent
 * toast: the rulesets read under Amendment 2026-07-01, and the `actions/secrets`
 * NAMES read under Amendment 2026-07-16 (materialising the founder's decision on
 * #796). Only the CREATE/ADD mutates the repo, so it is the one action gated on
 * an explicit click.
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
  const openExternal = deps.openExternal ?? ((url: string) => vscode.env.openExternal(vscode.Uri.parse(url)));
  const isRepo = deps.isRepo ?? ((f: string) => fs.existsSync(path.join(f, '.git')));

  // Cheap guard: not a git repo → no remote, no ruleset to advise about. Return
  // before probing gh at all (mirrors offerScaffoldCommit) so non-repo init
  // flows stay both toast-free AND zero-process.
  if (!isRepo(folder)) return;

  try {
    // gh unavailable/unauthed → zero-network docs link. Done.
    if (!(await isGhReady(run))) {
      await linkRulesetDocs(
        'MinSpec: protect your default branch with a ruleset that requires CI ' +
          `(${DEFAULT_REQUIRED_CHECK_CONTEXTS.join(', ')}) status checks. ` +
          'Install/authenticate the `gh` CLI to let MinSpec offer to create one, or see the GitHub docs.',
        openExternal,
      );
      return;
    }

    const repo = await resolveRepo(folder);
    if (!repo) {
      // gh is ready but we cannot identify the GitHub repo (no github.com
      // remote). Nothing to probe or create against → docs link only.
      await linkRulesetDocs(
        'MinSpec: to require CI status checks on your default branch, add a ' +
          'GitHub remote, then create a branch ruleset — see the GitHub docs.',
        openExternal,
      );
      return;
    }
    // Defense-in-depth: the resolved slug is about to be interpolated into a
    // `gh api repos/{owner}/{repo}/...` path. Assert its charset here, right
    // where it reaches `gh`, before any network read. A slug that fails this is
    // treated like "no GitHub repo" → docs link, zero `gh api`.
    if (!REPO_SLUG_RE.test(repo)) {
      await linkRulesetDocs(
        'MinSpec: to require CI status checks on your default branch, add a ' +
          'GitHub remote, then create a branch ruleset — see the GitHub docs.',
        openExternal,
      );
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
  await offerRulesetAdvisory(folder, deps?.ruleset);
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
  await offerRulesetAdvisory(folder, deps?.ruleset);
}

/** Extract a human-readable message from an unknown thrown value. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
