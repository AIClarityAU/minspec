/**
 * Phase-claim drift — a spec's `phases.implement: pending` must not contradict
 * code it owns that is already on the default branch (#1518, SPEC-080).
 *
 * Root cause: nothing writes `phases:` forward when implementation merges (the
 * phase-advance-queue consumer is unbuilt, #732/#734/#735) and no validator rule
 * compared a declared phase against observable reality (#137, declared-vs-observed).
 *
 * Pure core: the caller injects `existsOnDefault`, so the check does no git, fs or
 * network itself. `undefined` from the probe means "default-branch ref not
 * resolvable" — reported as `unchecked`, never as a pass (constitution invariant 2).
 * Only `implements:` arms the rule; `affects:` is never an ownership claim (INV-3).
 */

export interface PhaseClaimSpec {
  readonly file: string;
  /** Declared `phases.implement` value. */
  readonly implement: string | undefined;
  /** Raw `implements:` tokens (`none` escape included). */
  readonly implementsTokens: readonly string[];
}

export interface PhaseClaimResult {
  readonly flagged: { readonly file: string; readonly paths: string[] }[];
  /** Specs that needed the probe but it could not answer. */
  readonly unchecked: string[];
}

export function checkPhaseClaimDrift(
  specs: readonly PhaseClaimSpec[],
  existsOnDefault: (path: string) => boolean | undefined,
): PhaseClaimResult {
  const flagged: { file: string; paths: string[] }[] = [];
  const unchecked: string[] = [];
  for (const s of specs) {
    if (s.implement !== 'pending') continue;
    const paths = s.implementsTokens.filter((t) => t.length > 0 && t.toLowerCase() !== 'none');
    if (paths.length === 0) continue;
    const present: string[] = [];
    let unresolved = false;
    for (const p of paths) {
      const r = existsOnDefault(p);
      if (r === undefined) {
        unresolved = true;
        break;
      }
      if (r) present.push(p);
    }
    if (unresolved) unchecked.push(s.file);
    else if (present.length > 0) flagged.push({ file: s.file, paths: present });
  }
  return { flagged, unchecked };
}
