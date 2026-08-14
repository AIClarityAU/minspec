import { execFile } from 'child_process';
import { promisify } from 'util';
import type { CommandRunner } from './ruleset-advisor';
import { resolveRemotes, githubSlug } from './git-remotes';

const execFileAsync = promisify(execFile);

/**
 * Check if the `gh` CLI is available and authenticated.
 */
export async function isGhAvailable(): Promise<boolean> {
  try {
    await execFileAsync('gh', ['auth', 'status'], {
      timeout: 5000,
      env: { ...process.env },
    });
    return true;
  } catch {
    return false;
  }
}

/** Adapter so this module can drive the shared resolver without importing a runner. */
const run: CommandRunner = async (cmd, args) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 5000 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

/**
 * Get the GitHub repo (`owner/name`) for the repository at `rootDir`, or null when
 * there is no unambiguous GitHub remote.
 *
 * Does NOT assume the remote is called `origin` (#1545). This previously ran
 * `git remote get-url origin` and treated the resulting throw as "no remote", so a
 * repo whose remote was added by hand under any other name read as having none at
 * all — MinSpec then advised the user to add the remote they had already added, and
 * skipped the offer it was otherwise able to make.
 *
 * Resolution and the github.com URL parsing now live in {@link resolveRemotes} /
 * {@link githubSlug}, shared with every other caller so the assumption cannot be
 * re-introduced one site at a time. Behaviour for a conventional repo is unchanged:
 * `origin` still wins whenever it exists.
 *
 * Null covers three genuinely different situations — no remotes, no github.com
 * remote, and several remotes pointing at DIFFERENT repos. The last one is a refusal
 * to guess, not an absence: picking arbitrarily there would target the wrong
 * repository. A caller that must tell them apart should use `resolveRemotes`.
 */
export async function getRepoFromRemote(rootDir: string): Promise<string | null> {
  return githubSlug(await resolveRemotes(run, rootDir));
}
