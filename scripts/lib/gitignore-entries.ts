/**
 * #383: the committed `.gitignore` must cover every MINSPEC_GITIGNORE_ENTRIES literal.
 *
 * `ensureGitignoreEntries()` backfills at runtime, but that depends on the installed
 * extension version; a stale VSIX never adds newer entries, so an ephemeral file
 * (template-baseline.json) leaked untracked. This is the deterministic, version-independent
 * assertion of the same set, using the same line-match semantics as the writer.
 */
export function missingGitignoreEntries(gitignoreText: string, entries: readonly string[]): string[] {
  const lines = new Set(
    gitignoreText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  );
  return entries.filter((e) => !lines.has(e));
}
