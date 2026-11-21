/**
 * Pure decision for Rule 30 (#1227): a committed approval sidecar must still describe
 * the file it approves.
 *
 * THE GAP. #1205 landed a sidecar + `status: planning`; #1181 then added `implements:`
 * (a canonical-hashed field), so `main` carried an approved-looking spec whose record
 * resolved `stale`. Each PR was green: CI checked that `implements:` was PRESENT, never
 * the invariant its arrival broke. The write-side pre-commit gate (#424) cannot see a
 * pair of PRs that are each fine alone, so the check has to run on the merged tree.
 *
 * Severity: a stale SPEC sidecar is fatal. A stale decision-record/epic sidecar is only a
 * warning, because the corpus already carries such records and failing on history would
 * strand the build; they stay visible rather than silent.
 *
 * I/O-free: the caller lists records and supplies the file hash and the kind classifier.
 */

export type StaleKind = 'spec' | 'adr' | 'epic';

export interface SidecarRecordRef {
  readonly specPath: string;
  readonly specHash: string;
}

export interface StaleSidecar {
  readonly specPath: string;
  readonly kind: StaleKind;
  readonly recorded: string;
  readonly current: string;
  readonly fatal: boolean;
}

/**
 * @param currentHash canonical hash of the file at `specPath`; null when the file is
 *   absent/unreadable (not this rule's concern - a missing file has no hash to disagree).
 * @param classify    approvable-kind classifier; undefined = not approvable (an orphan,
 *   reported by Rule 10), so skipped here.
 */
export function findStaleSidecars(
  records: readonly SidecarRecordRef[],
  currentHash: (specPath: string) => string | null,
  classify: (specPath: string) => StaleKind | undefined,
): StaleSidecar[] {
  const out: StaleSidecar[] = [];
  for (const rec of records) {
    const kind = classify(rec.specPath);
    if (!kind) continue;
    const current = currentHash(rec.specPath);
    if (current === null || current === rec.specHash) continue;
    out.push({ specPath: rec.specPath, kind, recorded: rec.specHash, current, fatal: kind === 'spec' });
  }
  return out;
}
