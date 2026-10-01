/**
 * ownership-ratchet.ts — where SPEC-038's FR-7 ratchet starts in a newly scaffolded
 * repo (#2250).
 *
 * FR-7 ships the ownership rule as a warning, backfills the specs that already violate
 * it, and only then flips `ownershipDeclaration` to `error`: "a grandfather ratchet,
 * never a flag day". The design names the two positions — `"warn"` (pre-backfill) and
 * `"error"` (post-backfill). MinSpec's own repo made that flip in #829.
 *
 * Adopters never did. `scaffold()` wrote the pre-backfill value into every new repo,
 * including one with no specs, where there is nothing to backfill, and nothing
 * afterwards advances it. So a fresh repo sat at `warn` indefinitely: its approve
 * command never refused a T3 spec without `implements:`, and neither did anything
 * else. voip-sms-inbox was scaffolded that way on 2026-08-14 with zero specs, and its
 * SPEC-003 reached main at T3 with no declaration (#2250).
 *
 * This computes the position FR-7 defines instead of hard-coding the first one: the
 * repo is post-backfill exactly when none of its specs has an undeclared owner at
 * `error` (`ownership.implements.missing`), the only finding this dial decides. Its
 * sibling, `ownership.implements.invalid`, is an error at either setting, so the seed
 * cannot change its outcome and it is not consulted. An existing config is never
 * touched (`scaffold()` writes this only when it creates the file), so no repo that
 * already chose a value is moved, and the `loadConfig` default for a config without
 * the key stays `warn`.
 *
 * The specs scanned are every `.md` under the default specs directory, the same set
 * the shipped CI validator (`.minspec/hooks/validate.py`) scans, so "would fail at
 * error" means "CI would go red". A read failure answers `warn`, and says so on the
 * console: `warn` is the value every repo got before this change, so being unable to
 * prove the corpus clean can cost the stricter default but never a flag day.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_CONFIG, type MinspecConfig } from './config';
import { parseSpec } from './spec';
import { validateOwnership } from './spec-validator';

type OwnershipDeclaration = NonNullable<MinspecConfig['ownershipDeclaration']>;

const STRICT: MinspecConfig = { ...DEFAULT_CONFIG, ownershipDeclaration: 'error' };

/**
 * Every `.md` entry under `dir`, recursively — the set `validate.py`'s `os.walk` visits:
 * symlinked directories are not descended, symlinked files are included.
 */
function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * The `ownershipDeclaration` a new config should carry for the repo at `rootDir`:
 * `error` when no spec there lacks its ownership declaration at `error`, else `warn`.
 */
export function initialOwnershipDeclaration(rootDir: string): OwnershipDeclaration {
  const specsDir = path.join(rootDir, DEFAULT_CONFIG.specsDir);
  try {
    if (!fs.existsSync(specsDir)) return 'error';
    for (const file of markdownFiles(specsDir)) {
      const violations = validateOwnership(parseSpec(fs.readFileSync(file, 'utf-8')), STRICT);
      if (violations.some((v) => v.rule === 'ownership.implements.missing')) return 'warn';
    }
  } catch (err) {
    // Unreadable corpus: keep the pre-#2250 default rather than guess (see header), and
    // announce it, so a recurring degrade is discoverable rather than invisible.
    console.warn(
      `[minspec] could not read ${specsDir} to choose ownershipDeclaration ` +
        `(${err instanceof Error ? err.message : String(err)}); seeding "warn".`,
    );
    return 'warn';
  }
  return 'error';
}
