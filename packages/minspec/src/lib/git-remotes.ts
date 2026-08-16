/**
 * Resolving "the" git remote WITHOUT assuming it is called `origin` (#1545).
 *
 * `origin` is a convention, not a rule: `git clone` picks that name, and everything
 * downstream quietly hardcodes it. A repo whose remote was added by hand
 * (`git remote add <project-name> <url>`) has no `origin` at all, and MinSpec read
 * that as "this repo has no remote" in ten independent places. Two consequences,
 * only one of them cosmetic:
 *
 *   1. The ruleset advisory told a user to "add a GitHub remote" they had already
 *      added, and skipped the [Create ruleset] offer it was otherwise able to make.
 *   2. Worse: the scaffolded protected-branch guard gated its default-branch
 *      fallback on `git config --get remote.origin.url`, found nothing, concluded
 *      nothing was push-protected, and returned 0. A merge-gating check went
 *      SILENTLY INERT on a repo that had a perfectly good remote — constitution
 *      invariant 2 ("no silent gate"), where a missing witness must fail closed and
 *      visibly rather than pass.
 *
 * The distinction this module exists to preserve is the one the old code collapsed:
 * "there are no remotes, so nothing can be push-protected" (a legitimate pass) is
 * NOT the same state as "there are remotes but I cannot pick one" (a resolution
 * FAILURE, which must never read as the former). {@link RemoteResolution} makes
 * those two different values, so a caller has to handle them separately rather than
 * inherit a wrong default.
 *
 * Tier-0: one `git config --get-regexp`, offline, read-only, no network (invariant
 * 1) and no `vscode` import.
 */
import type { CommandRunner } from './ruleset-advisor';

/** The conventional name, tried first so existing repos behave byte-identically. */
export const CONVENTIONAL_REMOTE = 'origin';

/** One configured remote: its name and its URL. */
export interface RemoteRef {
  name: string;
  url: string;
}

/**
 * The outcome of resolving a repo's remotes.
 *
 * Deliberately three states, not two. Collapsing `ambiguous` into `none` is exactly
 * the bug: it turns "I could not tell" into "there is nothing there", which is how a
 * gate ends up passing on a repo it was supposed to guard.
 */
export type RemoteResolution =
  /** No remotes are configured at all. Nothing to push to — a genuine, safe "no". */
  | { kind: 'none' }
  /** Exactly one remote is the obvious answer. */
  | { kind: 'resolved'; remote: RemoteRef; all: RemoteRef[] }
  /** Remotes exist but none is clearly "the" one. NEVER equivalent to `none`. */
  | { kind: 'ambiguous'; all: RemoteRef[] };

/**
 * Parse `git config --get-regexp '^remote\..*\.url$'` output into refs.
 *
 * Pure and exported so the parsing is testable without a repository. Tolerant of
 * blank lines and of remote names containing dots (`remote.my.fork.url`) — the name
 * is everything between the first `remote.` and the final `.url`, so a naive
 * `split('.')` would truncate such a name and resolve the wrong remote.
 */
export function parseRemoteConfig(stdout: string): RemoteRef[] {
  const out: RemoteRef[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(' ');
    if (sep <= 0) continue;
    const key = trimmed.slice(0, sep);
    const url = trimmed.slice(sep + 1).trim();
    if (!key.startsWith('remote.') || !key.endsWith('.url')) continue;
    const name = key.slice('remote.'.length, -'.url'.length);
    if (!name || !url) continue;
    out.push({ name, url });
  }
  return out;
}

/**
 * Choose "the" remote from a parsed list.
 *
 * Precedence, and why:
 *   1. `origin` when present — every repo that follows the convention keeps its
 *      exact previous behaviour, so this change cannot regress the common case.
 *   2. Otherwise the SOLE remote — unambiguous by construction.
 *   3. Otherwise `ambiguous` — several remotes, no conventional name. We do not
 *      guess: the caller may be about to write to it, and picking arbitrarily
 *      would mutate the wrong repository.
 */
export function chooseRemote(all: RemoteRef[]): RemoteResolution {
  if (all.length === 0) return { kind: 'none' };
  const conventional = all.find((r) => r.name === CONVENTIONAL_REMOTE);
  if (conventional) return { kind: 'resolved', remote: conventional, all };
  if (all.length === 1) return { kind: 'resolved', remote: all[0], all };
  return { kind: 'ambiguous', all };
}

/**
 * Resolve the repo's remotes by reading git config.
 *
 * A failed/erroring git call yields `none` — the same as a repo with no remotes,
 * because both mean "no remote information available here" and neither is a claim
 * that resolution failed. (`ambiguous` is reserved for the case where we positively
 * KNOW remotes exist and cannot choose, which is the state that must not pass a
 * gate.)
 */
export async function resolveRemotes(
  run: CommandRunner,
  cwd?: string,
): Promise<RemoteResolution> {
  try {
    const args = ['config', '--get-regexp', '^remote\\..*\\.url$'];
    const result = await run('git', cwd ? ['-C', cwd, ...args] : args);
    // Exit 1 with empty output is git's "no matching keys" — a repo with no
    // remotes, not an error.
    if (result.code !== 0 && !result.stdout.trim()) return { kind: 'none' };
    return chooseRemote(parseRemoteConfig(result.stdout));
  } catch {
    return { kind: 'none' };
  }
}

/** SSH (`git@github.com:owner/repo.git`) and HTTPS (`https://github.com/owner/repo`). */
const GITHUB_SSH_RE = /github\.com[:/]([^/]+\/[^/.]+)/;
const GITHUB_HTTPS_RE = /github\.com\/([^/]+\/[^/.]+)/;

/** The `owner/repo` slug for a single URL, or null when it is not a github.com URL. */
export function githubSlugFromUrl(url: string): string | null {
  return url.match(GITHUB_SSH_RE)?.[1] ?? url.match(GITHUB_HTTPS_RE)?.[1] ?? null;
}

/**
 * The repo's GitHub slug, or null when there isn't an unambiguous one.
 *
 * When a remote RESOLVES, that remote's slug is the answer — full stop. This is the
 * fork case and it must not be clever: a fork checkout has `origin` (your fork) and
 * `upstream` (theirs) pointing at two DIFFERENT repos, and the right answer is
 * unambiguously `origin`, exactly as before this change. An earlier version of this
 * function deduped across ALL remotes and returned null whenever two disagreed,
 * which silently broke every fork checkout — a regression the old
 * `git remote get-url origin` never had.
 *
 * Only when resolution itself is ambiguous (several remotes, none named `origin`)
 * do we fall back to agreement: if every GitHub remote names the SAME repo the
 * answer is still obvious, and otherwise there is genuinely no answer and guessing
 * would target the wrong repository. Callers needing to tell "no GitHub remote"
 * from "several that disagree" should read {@link RemoteResolution} directly.
 */
export function githubSlug(state: RemoteResolution): string | null {
  if (state.kind === 'none') return null;
  if (state.kind === 'resolved') return githubSlugFromUrl(state.remote.url);

  const slugs = new Set<string>();
  for (const r of state.all) {
    const slug = githubSlugFromUrl(r.url);
    if (slug) slugs.add(slug);
  }
  return slugs.size === 1 ? [...slugs][0] : null;
}

/**
 * Should MinSpec offer to rename this remote to `origin`?
 *
 * True only in the unambiguous, safe case: exactly one remote, it points at GitHub,
 * and it is not already conventionally named. Anything else (no remotes, several
 * remotes, a non-GitHub remote) is left alone — an offer that fires on an ambiguous
 * setup is a prompt to break something.
 */
export function renameToOriginCandidate(state: RemoteResolution): RemoteRef | null {
  if (state.kind !== 'resolved') return null;
  if (state.all.length !== 1) return null;
  const only = state.all[0];
  if (only.name === CONVENTIONAL_REMOTE) return null;
  if (!githubSlugFromUrl(only.url)) return null;
  return only;
}
