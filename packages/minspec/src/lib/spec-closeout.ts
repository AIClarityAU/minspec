/**
 * The implement close-out writer (#1595): the one function that moves a spec from
 * `implementing` to `done`.
 *
 * Before it, nothing wrote `phases.implement: done`. Phases advanced only through the
 * editor command or by hand, so a spec whose build had merged stayed `implementing` and the
 * signpost kept pointing at finished work (SPEC-038, ~33 days). The gate that notices is
 * `implement.finished-not-closed` in spec-validator.ts; the machine caller is
 * `scripts/lib/close-finished-specs.ts`, which runs this only on a spec that gate calls
 * `finished`, and cites the merged commit that ticked its last task.
 *
 * What it writes: `implement: done` in every `phases:` block of the spec's own files (the
 * primary and each sibling whose `id:` is this spec's), then the `status:` line those bytes
 * derive. Both fields are stripped before hashing (canonical.ts), so the approval stays
 * current. It never ticks or unticks a task, and never writes `approved`/`accepted`.
 *
 * Fails closed BEFORE any write: implement not `in-progress`, another phase still open (the
 * result would not derive `done`), a supplied approval verdict that is not `approved`, or a
 * body status line whose rewrite would invert its sentence. Tier 0: filesystem only.
 */
import * as fs from 'fs';
import * as path from 'path';

import { specHash } from '@aiclarity/shared';

import type { ApprovalStatus } from './approval';
import { deriveStatus, type PhaseState } from './lifecycle';
import { parseSpec, setSpecPhases, setSpecStatus, specStatusProseWouldInvert, type SpecStatus } from './spec';
import { bodyStatusToken } from './status-parity';
import { readDocumentText } from './text-io';

export interface CloseoutResult {
  /** The status written: always `done` (anything else throws before writing). */
  readonly status: SpecStatus;
  /** Absolute paths of the files rewritten, primary first. */
  readonly written: readonly string[];
}

const PHASES_IMPLEMENT_LINE = /^phases[ \t]*:[\s\S]*?^[ \t]+implement[ \t]*:/m;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Siblings in the spec's directory that carry this spec's id and a lifecycle mirror. */
function mirrorSiblings(primary: string, id: string | undefined): string[] {
  const dir = path.dirname(primary);
  const out: string[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    if (file === primary || !name.endsWith('.md')) continue;
    const fm = FRONTMATTER.exec(readDocumentText(file))?.[1];
    if (fm === undefined) continue;
    const owner = /^id:[ \t]*(\S+)/m.exec(fm)?.[1];
    if (owner === undefined || owner !== id) continue;
    if (PHASES_IMPLEMENT_LINE.test(fm) || /^status[ \t]*:/m.test(fm)) out.push(file);
  }
  return out;
}

export function closeSpecImplementation(
  primaryFile: string,
  opts: { readonly approvalState?: ApprovalStatus } = {},
): CloseoutResult {
  const name = path.basename(primaryFile);
  if (opts.approvalState !== undefined && opts.approvalState !== 'approved') {
    throw new Error(`Refusing to close ${name}: its approval is ${opts.approvalState}, so it cannot derive done.`);
  }
  const primaryText = readDocumentText(primaryFile);
  // The body's `**Status:**` line is NOT stripped before hashing (only frontmatter
  // `status`/`phases` are, canonical.ts), so `setSpecStatus` rewriting it on the sealed
  // primary would stale the approval this close-out depends on. Refuse rather than
  // trade a current approval for a matching body word.
  const bodyToken = bodyStatusToken(primaryText, 'spec');
  if (bodyToken) {
    throw new Error(
      `Refusing to close ${name}: its body status line (line ${bodyToken.line}) is covered by the approval hash, ` +
        'so rewriting it would stale the approval. Close it with a re-approval instead.',
    );
  }
  const hashBefore = specHash(primaryText);
  const spec = parseSpec(primaryText);
  const phases = spec.frontmatter.phases;
  if (phases.implement !== 'in-progress') {
    throw new Error(`Refusing to close ${name}: phases.implement is ${phases.implement}, not in-progress.`);
  }
  const next: PhaseState = { ...phases, implement: 'done' };
  const target = deriveStatus(next, 'approved', undefined);
  if (target !== 'done') {
    const open = Object.entries(next)
      .filter(([, v]) => v === 'pending' || v === 'in-progress')
      .map(([k, v]) => `${k}: ${v}`);
    throw new Error(`Refusing to close ${name}: with implement done it still derives ${target} (${open.join(', ')}).`);
  }

  const files = [primaryFile, ...mirrorSiblings(primaryFile, spec.frontmatter.id)];
  for (const f of files) {
    const inverts = specStatusProseWouldInvert(readDocumentText(f));
    if (inverts) {
      throw new Error(`Refusing to close ${name}: ${path.basename(f)} line ${inverts.line} negates a status word: ${inverts.text}`);
    }
  }

  for (const f of files) {
    setSpecPhases(f, { implement: 'done' }, { createIfAbsent: false });
    if (/^status[ \t]*:/m.test(FRONTMATTER.exec(readDocumentText(f))?.[1] ?? '')) setSpecStatus(f, target);
  }

  // The persisted primary must re-derive what was written (the #148 discipline), and its
  // approval hash must not have moved.
  const afterText = readDocumentText(primaryFile);
  if (specHash(afterText) !== hashBefore) {
    throw new Error(`closeSpecImplementation moved the approval hash of ${name} (should be impossible).`);
  }
  const after = parseSpec(afterText).frontmatter;
  if (after.phases.implement !== 'done' || deriveStatus(after.phases, 'approved', undefined) !== 'done' || after.status !== 'done') {
    throw new Error(`closeSpecImplementation left ${name} inconsistent: implement=${after.phases.implement}, status=${after.status}.`);
  }
  return { status: target, written: files };
}
