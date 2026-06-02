/**
 * Pure target-folder selection logic (no vscode dependency → unit-testable).
 *
 *  - 0 folders → undefined (caller surfaces "no folder open")
 *  - 1 folder  → that folder
 *  - >1 folders → the folder containing the active file (longest-prefix match,
 *    so nested folders resolve correctly); else undefined to signal the caller
 *    must prompt with a folder picker.
 *
 * Replaces the legacy `workspaceFolders?.[0]` that silently targeted the first
 * folder in a multi-root workspace (harvest316/minspec#123).
 */
export function pickFolderPath(
  folderPaths: readonly string[],
  activeFilePath?: string,
): string | undefined {
  if (folderPaths.length === 0) return undefined;
  if (folderPaths.length === 1) return folderPaths[0];
  if (activeFilePath) {
    const match = folderPaths
      .filter(
        f =>
          activeFilePath === f ||
          activeFilePath.startsWith(f.endsWith('/') ? f : f + '/'),
      )
      .sort((a, b) => b.length - a.length)[0];
    if (match) return match;
  }
  return undefined;
}
