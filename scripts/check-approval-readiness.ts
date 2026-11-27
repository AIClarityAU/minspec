#!/usr/bin/env -S npx tsx
/**
 * check-approval-readiness.ts - may an approval of this spec be ASKED for now?
 *
 *   npx tsx scripts/check-approval-readiness.ts SPEC-227 [SPEC-213 ...]
 *   npx tsx scripts/check-approval-readiness.ts specs/minspec/SPEC-227-x/requirements.md
 *   npx tsx scripts/check-approval-readiness.ts --root <checkout> SPEC-227
 *
 * Run it before filing any approval ask (the runner's `tasks.py add`, a delegated approval,
 * a pre-flight job) against the bytes the approver will see. Prints one READY / NOT READY
 * block per spec. Exit 0 = every spec is ready; 1 = at least one is not; 2 = a spec could
 * not be found or read (fail closed: never a green because it did not look).
 *
 * Not ready means any of: status already past approval; a refusal the Approve Spec command
 * itself would make (`specNotApprovable`, incl. implements:/validator errors); an unrecorded
 * Clarify decision; body text declaring the spec unfinished (lifecycle state that approval
 * will flip, "not ready to approve", or an edit still owed such as "FR-10 needs rewriting").
 * See `lib/approval-readiness.ts` for why (the 2026-11-12 SPEC-213/217/227 re-approvals).
 *
 * Enforcement: this script alone is advisory (no required check runs it). It becomes a gate
 * when the runner's `tasks.py add` calls it and refuses on a non-zero exit; that patch is
 * staged outside this repo (/home/jason/code/.cos-patches/appr-preflight-1114/).
 *
 * Offline; reads only; writes nothing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { readinessVerdict } from './lib/approval-readiness';
import { specNotApprovable } from './lib/delegated-approval';
import { parseSpec } from '../packages/minspec/src/lib/spec';

/** `SPEC-227` -> the one requirements.md under specs/ whose directory starts `SPEC-227-`. */
export function resolveSpec(root: string, ref: string): string {
  if (!/^SPEC-\d+$/i.test(ref)) {
    const abs = path.resolve(root, ref);
    if (!fs.existsSync(abs)) throw new Error(`${ref}: no such file`);
    return abs;
  }
  const want = ref.toUpperCase() + '-';
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (e.name.toUpperCase().startsWith(want) && fs.existsSync(path.join(p, 'requirements.md'))) {
        hits.push(path.join(p, 'requirements.md'));
      } else walk(p);
    }
  };
  walk(path.join(root, 'specs'));
  if (hits.length !== 1) throw new Error(`${ref}: expected one spec directory, found ${hits.length}${hits.length ? ` (${hits.join(', ')})` : ''}`);
  return hits[0];
}

function main(argv: readonly string[]): number {
  let root = process.cwd();
  const refs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] ?? '');
    else refs.push(argv[i]);
  }
  if (refs.length === 0) {
    console.error('usage: check-approval-readiness.ts [--root <checkout>] SPEC-NNN|<requirements.md> ...');
    return 2;
  }
  let worst = 0;
  for (const ref of refs) {
    let abs: string;
    let content: string;
    let status: unknown;
    let notApprovable: string | undefined;
    try {
      abs = resolveSpec(root, ref);
      content = fs.readFileSync(abs, 'utf-8');
      status = parseSpec(content).frontmatter.status;
      notApprovable = specNotApprovable(root, abs, content);
    } catch (err) {
      console.log(`ERROR ${ref}: ${err instanceof Error ? err.message : String(err)}`);
      worst = 2;
      continue;
    }
    const v = readinessVerdict({ status, notApprovable, content });
    const rel = path.relative(root, abs);
    console.log(`${v.ready ? 'READY' : 'NOT READY'} ${ref} (${rel})`);
    for (const r of v.reasons) console.log(`  - ${r}`);
    if (!v.ready && worst < 1) worst = 1;
  }
  return worst;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
