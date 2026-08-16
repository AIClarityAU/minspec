/**
 * T0 — every git subprocess a test spawns must have auto-maintenance OFF (#1532).
 *
 * From git 2.54 the default maintenance strategy is "geometric", and its repack
 * task fires at `maintenance.geometric-repack.auto` = 100 against an ESTIMATED
 * loose-object count (git samples one shard and multiplies by 256). A fixture repo
 * that makes a handful of commits clears that bar, so every `git commit` spawns a
 * detached `git repack -d -l -a` whose prune step unlinks loose objects the next
 * foreground git command is still reading — surfacing as `fatal: unable to read
 * tree (<sha>)` (observed on PR #1500, CI run 31767822412, git 2.54.0).
 *
 * It is a load-shaped flake rather than a hard failure because `git add -A`
 * recomputes any cached subtree whose object went missing, so a prune is only fatal
 * inside the window between the last add and a tree-walking commit. That is exactly
 * why a source-text or env-var-only assertion is not good enough here: this file
 * asserts what GIT ACTUALLY RESOLVES inside a fresh fixture repo.
 *
 * vitest.setup.ts pins the two keys via GIT_CONFIG_COUNT so ambient global config
 * is preserved rather than replaced.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

/** A throwaway repo with NO local config beyond `init`, so any resolved value came from the env. */
function freshRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitmaint-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, encoding: 'utf-8' });
  return dir;
}

/** `git config --get <key>`, or null when the key resolves to nothing (exit 1). */
function configGet(cwd: string, key: string, env: NodeJS.ProcessEnv): string | null {
  try {
    return execFileSync('git', ['config', '--get', key], { cwd, encoding: 'utf-8', env }).trim();
  } catch {
    return null;
  }
}

/** process.env minus every GIT_CONFIG_* pin — the state before vitest.setup.ts ran. */
function envWithoutPins(): NodeJS.ProcessEnv {
  const stripped: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(stripped)) {
    if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) delete stripped[key];
  }
  return stripped;
}

describe('git fixture repos run with auto-maintenance disabled', () => {
  it('resolves gc.auto=0 and maintenance.auto=false inside a fresh repo', () => {
    const repo = freshRepo();
    try {
      expect(configGet(repo, 'gc.auto', process.env)).toBe('0');
      expect(configGet(repo, 'maintenance.auto', process.env)).toBe('false');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('resolves neither key without the pins — so the assertion above is load-bearing', () => {
    // Guards against a vacuous pass: if these keys came from the developer's global
    // config rather than from vitest.setup.ts, the test above would go green with the
    // pins removed and would stop protecting CI. Strip them and the values must vanish.
    const repo = freshRepo();
    try {
      const bare = envWithoutPins();
      expect(configGet(repo, 'gc.auto', bare)).toBeNull();
      expect(configGet(repo, 'maintenance.auto', bare)).toBeNull();
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('leaves ambient global config reachable — the pins ADD keys, never replace the file', () => {
    // GIT_CONFIG_GLOBAL would have been the blunter tool: it swaps the whole global
    // config out, silently changing behaviour for any suite that legitimately reads
    // it. GIT_CONFIG_COUNT layers on top instead. Proven by injecting one extra key
    // through a real global config file and checking BOTH survive.
    const repo = freshRepo();
    const globalCfg = path.join(repo, 'ambient.gitconfig');
    fs.writeFileSync(globalCfg, '[minspec]\n\tprobe = ambient\n');
    try {
      const env = { ...process.env, GIT_CONFIG_GLOBAL: globalCfg };
      expect(configGet(repo, 'minspec.probe', env)).toBe('ambient');
      expect(configGet(repo, 'gc.auto', env)).toBe('0');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
