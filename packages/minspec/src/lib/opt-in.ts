import * as fs from 'fs';
import * as path from 'path';

/**
 * The opt-in rule, in one place (SPEC-096).
 *
 * `.minspec/` at the root of a workspace folder is the opt-in marker: MinSpec's
 * blast radius is the project it is installed in, and a folder says it is one by
 * carrying that directory (constitution invariant 3, DR-074). The marker is only
 * worth anything if MinSpec's own writes cannot manufacture it. They could: ten
 * stores each ran their own `mkdir -p .minspec/...`, so any command that reached
 * one before opt-in created the marker as a side effect (#2364, and before it
 * #2328 for the presence heartbeat and #2355 for the setup toast).
 *
 * This module removes the capability instead of asking each writer to check
 * first. It holds:
 *   - the predicate, {@link hasOptInMarker} - the ONE definition;
 *   - the refusal, {@link NotOptedInError}, and its wording;
 *   - {@link ensureDirectory}, the one operation through which the extension
 *     creates a directory inside a workspace folder. It cannot create a path
 *     component that is the marker.
 *
 * Exactly one call elsewhere may create the marker: the `mkdir` in `scaffold()`,
 * reached from "MinSpec: Initialize SDD Structure". That is the opt-in itself.
 * `tests/opt-in-writer-inventory.test.ts` fails when a directory-creating call
 * appears anywhere but here, there, and three other named places.
 *
 * DELIBERATELY DEPENDENCY-FREE (`fs` and `path` only, no `vscode`). The presence
 * heartbeat imports the predicate from here and must stay a lean Tier-0 module,
 * and a store that only wants to make its directory must not drag anything in.
 */

/** The directory whose existence at a workspace-folder root is the opt-in. */
const MARKER = '.minspec';

/**
 * Palette title of the one command that opts a folder in (`minspec.init`). The
 * refusal names it, so a title that drifted from the manifest would send the user
 * looking for a command the palette does not list. Pinned to
 * `package.json` by `tests/opt-in-guard.test.ts`.
 */
export const INITIALIZE_COMMAND_TITLE = 'MinSpec: Initialize SDD Structure';

/**
 * Has this folder opted in to MinSpec?
 *
 * True when the folder is named and `.minspec` exists at its root. Nothing else
 * is read: a `.minspec/` holding only `preferences.json` is opted in (whether a
 * folder an earlier build marked by accident should count is #2365, and is not
 * decided here).
 *
 * An empty root means "no folder open". `path.join('', '.minspec')` resolves
 * against the process's working directory, so without the explicit check an
 * extension host that happened to start inside a MinSpec project would answer
 * "opted in" for a window with no folder at all.
 */
export function hasOptInMarker(rootDir: string): boolean {
  return rootDir !== '' && fs.existsSync(path.join(rootDir, MARKER));
}

/**
 * The refusal, in words (SPEC-096 FR-8): it names the folder, says the marker is
 * absent and that nothing was written, and names the command to run.
 *
 * `notWritten` replaces "nothing was written there" for a caller whose write was
 * something specific. The preference store is the only one that passes it, so
 * the message mentions a preference only when a preference was the write.
 */
export function notOptedInMessage(
  rootDir: string,
  notWritten = 'nothing was written there',
): string {
  if (rootDir === '') {
    return 'MinSpec: no folder is open, so there is no project to write to.';
  }
  return (
    `MinSpec: ${rootDir} has no ${MARKER}/ directory (it has not opted in), so ${notWritten}. ` +
    `Run "${INITIALIZE_COMMAND_TITLE}" first.`
  );
}

/**
 * Thrown when a write is refused because its folder has not opted in. A distinct
 * class so a caller can tell "this folder never opted in" from an ordinary I/O
 * failure, show {@link Error.message} as it stands, and skip its own success
 * message.
 */
export class NotOptedInError extends Error {
  /** The folder that has not opted in; `''` when no folder is open. */
  readonly rootDir: string;

  constructor(rootDir: string, notWritten?: string) {
    super(notOptedInMessage(rootDir, notWritten));
    this.name = 'NotOptedInError';
    this.rootDir = rootDir;
  }
}

/**
 * Throw the refusal unless `rootDir` has opted in.
 *
 * For a caller whose first side effect is not a directory at all, so
 * {@link ensureDirectory} would come too late: `approveSpec` writes a git blob
 * and a ref before it reaches a file under `.minspec/`, and Refresh Harness Files
 * writes into the folder's root.
 */
export function assertOptedIn(rootDir: string): void {
  if (!hasOptInMarker(rootDir)) throw new NotOptedInError(rootDir);
}

/**
 * Is `name` the marker, as a filesystem would resolve it?
 *
 * The predicate asks the filesystem whether `.minspec` exists. On a
 * case-insensitive volume (the macOS and Windows defaults) a directory created
 * as `.MINSPEC` answers yes, and Windows drops trailing dots and spaces from a
 * name, so `.minspec.` is the same directory there. Each of those spellings can
 * therefore BE the marker, and the rule is applied to all of them on every
 * platform, so it does not depend on which disk the folder happens to be on.
 */
function isMarkerName(name: string): boolean {
  return name.replace(/[. ]+$/, '').toLowerCase() === MARKER;
}

/** The directories on the way to `target` that do not exist, outermost first. */
function missingComponents(target: string): string[] {
  const missing: string[] = [];
  let current = target;
  while (!fs.existsSync(current)) {
    missing.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) break; // a filesystem root that is not there
    current = parent;
  }
  return missing;
}

/**
 * Bring a directory into existence, with any missing parents - but never a path
 * component that is the opt-in marker (SPEC-096 FR-2).
 *
 * This is the ONE operation through which the extension creates a directory
 * inside a workspace folder. Use it in place of `fs.mkdirSync(dir, { recursive:
 * true })`.
 *
 *   (a) An existing directory is not an error. A path that exists and is not a
 *       directory is, as it is for `mkdir -p`.
 *   (b) Asked for a directory at or under a `.minspec/` that does not exist, it
 *       creates NOTHING - not the parents above the marker either - and throws
 *       {@link NotOptedInError} naming the folder. The whole path is looked at
 *       before the first create, which is what makes "nothing" true.
 *   (c) That holds under a race. Each level is created with its own
 *       non-recursive `mkdir`, so if the marker is removed after the look, the
 *       next level has no parent and the create fails; it is never the thing
 *       that puts the marker back. That failure is reported as the refusal when
 *       a marker component of the path is missing by then, and as the filesystem
 *       error it is otherwise.
 *   (d) A path that is not absolute is refused. That is what an empty root (no
 *       folder open) produces, and a relative path would be created under the
 *       extension host's working directory, a folder nobody chose.
 */
export function ensureDirectory(dirPath: string): void {
  if (!path.isAbsolute(dirPath)) throw new NotOptedInError('');
  const target = path.resolve(dirPath);

  const missing = missingComponents(target);
  refuseIfMarkerIsMissing(missing);

  // Nothing missing normally means nothing to do. When what is there is not a
  // directory, the create below is attempted anyway so that the filesystem
  // reports it (EEXIST), exactly as it would for `mkdir -p`.
  const toCreate = missing.length > 0 || isDirectory(target) ? missing : [target];

  for (const dir of toCreate) {
    try {
      fs.mkdirSync(dir);
    } catch (err) {
      // Lost a race to another creator: fine, as long as it is a directory now.
      if (isErrno(err, 'EEXIST') && isDirectory(dir)) continue;
      // The marker went after the look: the caller gets the refusal, not a bare ENOENT.
      refuseIfMarkerIsMissing(missingComponents(target));
      throw err;
    }
  }
}

/** Throw the refusal when one of `missing` is the marker, naming the folder it would be in. */
function refuseIfMarkerIsMissing(missing: readonly string[]): void {
  const marker = missing.find((dir) => isMarkerName(path.basename(dir)));
  if (marker !== undefined) throw new NotOptedInError(path.dirname(marker));
}

function isErrno(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
