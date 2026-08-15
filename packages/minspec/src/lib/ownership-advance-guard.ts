/**
 * ownership-advance-guard.ts — SPEC-051's refusal, in one place, reachable from BOTH
 * actors that cross a spec into the Plan build-band (#1446).
 *
 * WHY A SEPARATE MODULE. The guard needs `violationsIntroducedByApproval`
 * (`spec-validator`). `approveSpec` lives in `approval.ts`, which value-imports
 * `parseSpec` from `./spec` — so `spec.ts` cannot import the guard from there without
 * closing a cycle. Taking an ALREADY-PARSED spec keeps this module's only edge back to
 * `./spec` type-only, which the compiler erases:
 *
 *     spec.ts ─────────────┐
 *     approval.ts ─────────┼──> ownership-advance-guard ──> spec-validator ──> spec-vocabulary
 *                          │                                      ╎
 *                          └───────── (type-only, erased) ────────┘
 *
 * One implementation, two call sites, no cycle — rather than two copies that drift, or a
 * lazy `require` that hides a cycle from `check-import-cycles.ts` instead of removing it.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ParsedSpec } from './spec';
import { violationsIntroducedByApproval } from './spec-validator';
import { loadConfig } from './config';

/**
 * Walk up from a spec file to the repo root (the directory carrying `.minspec`).
 * Derived rather than taken as a parameter: a guard a caller can misdirect by passing the
 * wrong root is a guard that silently reads the wrong config.
 */
function repoRootFor(specFilePath: string): string | undefined {
  let dir = path.dirname(path.resolve(specFilePath));
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(dir, '.minspec'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Throw if approving/advancing `parsed` would move it into a status its own validator
 * rejects. Returns silently when the advance is legal.
 *
 * Two properties are inherited from `violationsIntroducedByApproval` rather than
 * re-implemented, and both are founder decisions pinned by tests:
 *   • CONFIG-RESPECTING — re-runs `validateSpec` under the caller's own config, so a repo
 *     on the default `ownershipDeclaration: 'warn'` is never refused (SPEC-038 FR-7).
 *   • ONLY NEWLY-INTRODUCED errors — a spec already in the build band and already
 *     undeclared is untouched, so re-approving after an ordinary edit cannot lock a
 *     human out.
 *
 * FAILS OPEN on its own infrastructure, but never silently: this exists to stop a
 * KNOWN-bad advance, not to make approval unavailable because the guard itself broke.
 * CI's `validateOwnership` remains the visible backstop, and the degrade is announced so
 * a recurring one is discoverable rather than invisible (constitution invariant 2).
 */
export function assertOwnershipDeclaredForAdvance(
  specFilePath: string,
  parsed: ParsedSpec,
): void {
  let introduced;
  try {
    const rootDir = repoRootFor(specFilePath);
    if (!rootDir) return; // not inside a MinSpec project — nothing to validate against
    // NO validation context (knownEpicRefs / siblingShardFiles) is passed, and that is
    // safe rather than a shortcut: `violationsIntroducedByApproval` runs `validateSpec`
    // twice with the SAME options and returns only the DIFF. Options do not depend on the
    // phase map, so every rule they affect appears identically on both sides and cancels
    // out — omitting them cannot change the verdict, only the (discarded) absolute sets.
    //
    // It also removes the last cycle: `epic-manager` and `spec-layout` both reach back to
    // `./spec`, so importing them here would re-close the loop this module exists to open
    // (measured: 3 cycles with them, 0 without).
    introduced = violationsIntroducedByApproval(parsed, loadConfig(rootDir));
  } catch (err) {
    console.warn(
      `[minspec] ownership pre-check skipped for ${path.basename(specFilePath)} — the ` +
        `guard could not evaluate it (${err instanceof Error ? err.message : String(err)}). ` +
        'The advance proceeds; `npm run validate` remains the backstop.',
    );
    return;
  }
  if (introduced.length === 0) return;

  const detail = introduced.map((v) => `  • ${v.message}\n    ↳ ${v.fixHint}`).join('\n');
  throw new Error(
    `Approval refused: ${path.basename(specFilePath)} is not ready for the status it would ` +
      `be advanced into.\n\n${detail}\n\n` +
      'Advancing past Clarify arms rules that do not apply to this spec yet. Fixing it now ' +
      'costs one edit; advancing first means the edit lands on an already-approved spec, ' +
      'staling the approval and needing a second human sign-off.',
  );
}
