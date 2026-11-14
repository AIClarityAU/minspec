/**
 * A PATH on which named tools are unresolvable and everything else still is.
 *
 * The obvious way to make a tool "absent" - drop every PATH directory holding it -
 * is wrong wherever the tool shares a directory with sh, git and node. That is the
 * normal layout on a GitHub ubuntu runner, where shellcheck is preinstalled in
 * /usr/bin and /bin links to it, so dropping the directory dropped the shell the
 * hook runs under and the "absent" cases failed with exit -1 / null (#3676).
 *
 * Instead, each directory that holds a hidden tool is replaced by a mirror: a
 * scratch directory of symlinks to every other entry. The result is checked both
 * ways, so a case can neither pass vacuously (tool still reachable) nor fail for
 * the wrong reason (the shell or git no longer reachable).
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

/** Commands every hook run needs; they must survive hiding a tool. */
const MUST_KEEP = ['sh', 'git'];

/** Is `tool` resolvable as a command under `pathEnv`? */
export function resolvableOn(tool: string, pathEnv: string): boolean {
  const r = spawnSync('sh', ['-c', `command -v ${tool}`], {
    encoding: 'utf8',
    env: { ...process.env, PATH: pathEnv },
  });
  return r.status === 0;
}

function holdsAny(dir: string, tools: string[]): boolean {
  return tools.some((t) => {
    try {
      fs.accessSync(path.join(dir, t), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** A scratch copy of `dir` made of symlinks to every entry except `tools`. */
function mirrorWithout(dir: string, tools: string[], scratch: string): string {
  const mirror = fs.mkdtempSync(path.join(scratch, 'path-mirror-'));
  for (const name of fs.readdirSync(dir)) {
    if (tools.includes(name)) continue;
    fs.symlinkSync(path.join(dir, name), path.join(mirror, name));
  }
  return mirror;
}

/**
 * `pathEnv` with each of `tools` made unresolvable, every other command kept.
 * Mirror directories are created under `scratch`; the caller owns its cleanup.
 * Throws if a tool is still resolvable, or if hiding it lost sh or git.
 */
export function pathWithoutTools(tools: string[], pathEnv: string, scratch: string): string {
  const out = pathEnv
    .split(path.delimiter)
    .filter((dir) => dir)
    .map((dir) => (holdsAny(dir, tools) ? mirrorWithout(dir, tools, scratch) : dir))
    .join(path.delimiter);
  for (const t of tools) {
    if (resolvableOn(t, out)) {
      throw new Error(`pathWithoutTools: ${t} still resolvable after hiding it`);
    }
  }
  for (const c of MUST_KEEP) {
    if (resolvableOn(c, pathEnv) && !resolvableOn(c, out)) {
      throw new Error(`pathWithoutTools: hiding ${tools.join(', ')} also hid ${c}`);
    }
  }
  return out;
}
