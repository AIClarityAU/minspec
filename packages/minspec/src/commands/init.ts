import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  scaffold,
  generateHarnessFiles,
  refreshHarnessFiles,
  rescaffoldManagedRegionFile,
  type ManagedRegionWarning,
} from '../lib/scaffold';
import { TEMPLATE_NAMES, TEMPLATE_OUTPUT_PATHS, MANAGED_REGION_TEMPLATES } from '../lib/template-registry';
import { resolveTargetFolder, workspaceFolderLabel } from '../lib/resolve-folder';
import { setCoverageMinimum, DEFAULT_COVERAGE_MINIMUM } from '../lib/config';
import { evaluateConstitution } from '../lib/constitution-nudge';
import { getRepoFromRemote } from '../lib/github';
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
} from '../lib/ruleset-advisor';

/**
 * SPEC-025 FR-6: soft, NON-MODAL advisory when the constitution has no
 * human-authored rules yet. Advisory only — never modal, never blocks, and a
 * failure here must not affect the init result (best-effort).
 */
function surfaceConstitutionNudge(folder: string): void {
  try {
    const nudge = evaluateConstitution(folder);
    if (nudge.empty) {
      vscode.window.showInformationMessage(nudge.message);
    }
  } catch {
    // best-effort — the nudge is advisory; never let it break init.
  }
}

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
  /** Stage exactly the given pathspecs. */
  add(paths: readonly string[]): Promise<void>;
  /** Create a single commit with `message` (staged content only). */
  commit(message: string): Promise<void>;
  /**
   * Of `paths`, which currently show uncommitted changes (staged, unstaged, or
   * untracked) per `git status`. Used to decide whether the recoverable commit
   * offer (#758) has anything to do — a scaffolded path that's already
   * committed (or was never dirty) is not reported.
   */
  dirty(paths: readonly string[]): Promise<string[]>;
}

/** Default committer — wraps simple-git, lazily imported to keep init lean. */
async function defaultCommitter(folder: string): Promise<ScaffoldCommitter> {
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
      await git.add([...paths]);
    },
    async commit(message) {
      await git.commit(message);
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
  const choice = await vscode.window.showInformationMessage(
    `MinSpec ${verb}: ${summary}. Commit them now in a dedicated commit?`,
    COMMIT_ACTION,
  );
  if (choice !== COMMIT_ACTION) return; // decline / dismiss → no-op

  try {
    await committer.add(paths);
    await committer.commit(commitMessage);
    vscode.window.showInformationMessage(
      `MinSpec: committed ${committedNoun} ("${commitMessage}").`,
    );
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
 * are scaffolded AND the reviewer secrets are configured; Tier-B (`lint`/`test`/
 * `build`) only when `package.json` has a runnable script; plus the user's
 * `minspec.ruleset.requiredChecks` extras. The fs reads are local; the
 * reviewer-secret-NAMES probe is a read-only GET of the repo's own config.
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
 * Why the probe is autonomous: `isGhReady` and `hasRequiredChecksRuleset` are a
 * read-only capability probe + a GET of the repo's OWN configuration — they
 * egress no user artifacts, spec content, or telemetry (the same class as
 * MinSpec shelling `git fetch`). Per DR-050 they need no prior consent toast.
 * Only the CREATE mutates the repo, so it is the one action gated on an explicit
 * click.
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
        const why = outcome.forbidden ? 'your gh token lacks repo-admin scope' : 'the request failed';
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
    const choice = await vscode.window.showInformationMessage(
      `MinSpec: ${repo}'s branch ruleset does not require ${missing.join(' + ')}` +
        ` — so a PR could merge without the AI-review gate. Add ${missing.length === 1 ? 'it' : 'them'}?`,
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
      const why = outcome.forbidden ? 'your gh token lacks repo-admin scope' : 'the request failed';
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
  try {
    scaffold(folder);
    generateHarnessFiles(folder);
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
  surfaceConstitutionNudge(folder);
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
  await offerRulesetAdvisory(folder, deps?.ruleset);
}

// ---------------------------------------------------------------------------
// Managed-region missing-markers warning: attribution + actions (#604)
// ---------------------------------------------------------------------------

/** Warning action: consent-gated whole-file rewrite from the current template. */
const RESCAFFOLD_ACTION = 'Re-scaffold (overwrite)';
/** Warning action: open the affected file so the user can inspect/fix it by hand. */
const OPEN_FILE_ACTION = 'Open file';

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
  deps?: OfferScaffoldCommitDeps & { ruleset?: RulesetAdvisoryDeps },
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
  surfaceConstitutionNudge(folder);
  // Post-refresh "what to commit" offer — the SAME affordance init gives (#222).
  // Without this, a drift-triggered refresh (e.g. on window reload via
  // auto-bootstrap) rewrites the harness files but leaves them stranded
  // uncommitted, unlike init. Best-effort, non-modal; never blocks the refresh.
  await offerScaffoldCommit(folder, { ...deps, variant: 'refresh' });
  // Post-refresh ruleset advisory — the SAME governance provisioning init gives
  // (#564 / SPEC-033 FR-3). Refresh is where an EXISTING repo whose ruleset
  // predates the ai-review/ready-to-merge checks (the sealbox case) gets offered
  // the missing required checks; without this, only freshly-inited repos would.
  await offerRulesetAdvisory(folder, deps?.ruleset);
}

/** Extract a human-readable message from an unknown thrown value. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
