import * as fs from 'fs';
import * as path from 'path';

/**
 * The project-local preference store: `.minspec/preferences.json`.
 *
 * DR-078 §1 names this as the ONE place MinSpec itself may persist a
 * preference. It is gitignored (so per-developer, never imposed on a
 * co-contributor) and lives inside the `.minspec/` opt-in marker (so
 * per-project), which satisfies DR-071's "personal decision" corollary and
 * constitution invariant 3 simultaneously, with no amendment to either.
 *
 * DELIBERATELY DEPENDENCY-FREE (`fs`/`path` only, no `vscode`). It was inlined
 * in `auto-bootstrap.ts` until #1319, but that module pulls in
 * `template-registry`, `epic-backfill`, `epic-manager`, `merge-refresh` and
 * `scaffold` — so any command wanting a preference dragged that whole chain in
 * with it. Keep this module's import list empty; a preference read must stay
 * cheap enough that nobody is tempted to reach for a global setting instead.
 *
 * `auto-bootstrap.ts` re-exports every symbol here, so existing importers are
 * unaffected.
 */

export interface BootstrapPreferences {
  readonly skipInitPrompt?: boolean;
  readonly skipRefreshPrompt?: boolean;
  readonly skipClassifyPrompt?: boolean;
  readonly skipBackfillPrompt?: boolean;
  /**
   * Per-prompt opt-out for the DESIGN.md-stub-removal offer (#315). Distinct
   * from `skipBackfillPrompt` (epic backfill) even though both are `kind:
   * 'backfill'` — declining one must never suppress the other.
   */
  readonly skipDesignStubPrompt?: boolean;
  /**
   * Per-prompt opt-out for the missing-tasks.md offer (#225). A third
   * `kind: 'backfill'` step with its own skip flag so declining it never
   * cross-suppresses the epic-backfill or DESIGN.md-stub offers (and vice-versa).
   */
  readonly skipTasksMdPrompt?: boolean;
  /**
   * Per-(prompt, state-signature) answer memory (#883). Maps a step's unique
   * `skipPrefKey` (e.g. `"skipRefreshPrompt"`) → the state SIGNATURE the user last
   * answered for. A step is suppressed on later activations while its current
   * signature equals the recorded one, so an already-answered prompt is NOT
   * re-offered until the underlying state genuinely changes (e.g. a NEW template
   * bump makes drift differ). This is a SOFTER memory than the `skip*` booleans:
   *   - the `skip*` booleans (from "Don't ask again") are a forever-skip;
   *   - `answeredSignatures` is "you already dealt with THIS state" and self-clears
   *     when the state moves.
   * Additive + optional: a preferences.json without it behaves exactly as before
   * (no suppression) until a fresh answer is recorded (#883 back-compat). Keyed by
   * the UNIQUE `skipPrefKey`, never by `kind`, so the three `kind: 'backfill'`
   * steps never cross-suppress.
   */
  readonly answeredSignatures?: Record<string, string>;
  /**
   * "Always enqueue a phase-advance request on approve" (DR-057 §3 / #733).
   *
   * Project-local, NOT `ConfigurationTarget.Global`. It was global until #1319:
   * constitution invariant 3 (DR-074) puts `~/.config/**` out of bounds for a
   * per-project write, and DR-078 §3 ruled that what MinSpec ITSELF writes is
   * only ever this store. Living here makes it per-developer (the file is
   * gitignored, so never imposed on a co-contributor) AND per-project (inside
   * the `.minspec/` opt-in marker) at the same time.
   */
  readonly advancePhaseOnApprove?: boolean;
  /**
   * "Always use the AI pass for epic backfill" (#213). Same migration and same
   * reasoning as {@link advancePhaseOnApprove} — and it matters more here,
   * because a global value silently enabled an AI/network code path in every
   * other MinSpec project on the machine, including ones chosen for the
   * offline Tier-0 posture (invariant 1).
   */
  readonly autoBackfillUseAi?: boolean;
}

/**
 * DR-078 §4 read order: a project-local preference is a narrower, more recently
 * expressed intent than a global default, so it wins wherever both are present;
 * absent one, the VS Code setting (and its contributed default) applies
 * unchanged, so existing configurations keep working.
 *
 * Deliberately `!== undefined` and NOT `||`: a project preference of `false`
 * must override a setting of `true`, or opting OUT in a single project becomes
 * impossible. Pinned by a T0 test.
 */
export function resolveProjectPreference<T>(
  projectValue: T | undefined,
  settingValue: T,
): T {
  return projectValue !== undefined ? projectValue : settingValue;
}

const PREFS_FILENAME = 'preferences.json';

/** Resolve the absolute path to `.minspec/preferences.json` */
export function preferencesPath(rootDir: string): string {
  return path.join(rootDir, '.minspec', PREFS_FILENAME);
}

/**
 * Load preferences from `.minspec/preferences.json`. Returns empty object if
 * file does not exist or is invalid JSON.
 */
export function loadPreferences(rootDir: string): BootstrapPreferences {
  const filePath = preferencesPath(rootDir);
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as BootstrapPreferences;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Merge new preferences with existing ones and persist to disk.
 * Creates `.minspec/` if it does not exist.
 */
export function savePreferences(
  rootDir: string,
  update: BootstrapPreferences,
): void {
  const minspecDir = path.join(rootDir, '.minspec');
  fs.mkdirSync(minspecDir, { recursive: true });
  const current = loadPreferences(rootDir);
  const merged = { ...current, ...update };
  fs.writeFileSync(
    preferencesPath(rootDir),
    JSON.stringify(merged, null, 2) + '\n',
  );
}