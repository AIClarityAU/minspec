/**
 * template-version-bump.ts — pure decision for the template-edit => version-bump gate (#1989).
 *
 * Two `.vsix` builds both called themselves 0.1.26 while carrying different scaffolded
 * templates; VS Code keys an install on publisher.name@version, so reinstalling could no-op
 * and leave stale templates resident. Nothing coupled a template edit to a version change.
 *
 * Branch-level, not per-commit: a branch touching templates twice needs ONE bump, so the
 * rule compares the branch tip with its merge-base rather than demanding a bump per commit.
 *
 * Runs locally only (pre-push hook, `npm run check:template-version`); no CI job calls it.
 */

/** Sources of every scaffolded artifact's content. A change to any alters what an install renders. */
export const TEMPLATE_CONTENT_FILES: readonly string[] = [
  'packages/minspec/src/lib/template-registry.ts',
  'packages/minspec/src/lib/ci-review-templates.ts',
  'packages/minspec/src/lib/hook-templates.ts',
  'packages/minspec/src/lib/slash-commands.ts',
  'packages/minspec/src/lib/ownership-path-rules.ts',
];

export const VERSION_FILE = 'packages/minspec/package.json';

/**
 * Exit code the CLI uses ONLY for a proven violation. Deliberately not 1 (what npx and tsx
 * return when the runner is missing or the script crashes) and not 2 ("could not
 * determine"), so the pre-push hook can block on this code alone and warn on everything
 * else. .githooks/pre-push hardcodes the same number; a test pins the two together.
 */
export const VIOLATION_EXIT_CODE = 17;

export interface BumpVerdict {
  ok: boolean;
  touched: string[];
  message: string;
}

/** Read the `version` field out of package.json text; null if absent or unparseable. */
export function readVersion(packageJson: string): string | null {
  try {
    const v = (JSON.parse(packageJson) as { version?: unknown }).version;
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * ok when no template content file changed, or when the version differs from the base's.
 * An unreadable version while templates changed is NOT ok (fail closed).
 */
export function checkTemplateVersionBump(
  changedFiles: readonly string[],
  baseVersion: string | null,
  headVersion: string | null,
): BumpVerdict {
  const touched = TEMPLATE_CONTENT_FILES.filter((f) => changedFiles.includes(f));
  if (touched.length === 0) {
    return { ok: true, touched, message: 'no shipped template content changed' };
  }
  if (headVersion === null || baseVersion === null) {
    return {
      ok: false,
      touched,
      message: `template content changed but a version could not be read from ${VERSION_FILE} (base=${baseVersion}, head=${headVersion})`,
    };
  }
  if (headVersion === baseVersion) {
    return {
      ok: false,
      touched,
      message:
        `shipped template content changed (${touched.join(', ')}) but ${VERSION_FILE} is still ${headVersion}. ` +
        'Two builds with one version let a reinstall silently no-op and leave stale templates resident. ' +
        'Bump the version.',
    };
  }
  return { ok: true, touched, message: `templates changed and version bumped ${baseVersion} -> ${headVersion}` };
}
