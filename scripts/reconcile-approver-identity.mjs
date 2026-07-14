#!/usr/bin/env node
// DR-056 Decision 4 — reconcile pre-gate approval provenance.
//
// Before the DR-056 approver gate existed, a repo-local `user.email=claude@…`
// override made `approvedBy` indistinguishable between a human approving a spec
// and an agent/container running *Approve Spec*. The approval records attributed
// to a KNOWN AGENT identity therefore cannot be proven to be a human act.
//
// This script does the ONLY safe, truth-increasing thing an automated pass may do
// to them: it DOWNGRADES each such record to `migrated: true` — the codebase's
// existing "an approval the human never (verifiably) performed, flagged" state
// (approval.ts). A `migrated:true` record still resolves to `approved` (so no spec
// is suddenly blocked), but its honest, unproven provenance is now VISIBLE to the
// gate/validator. It NEVER mints a human approval, NEVER upgrades provenance,
// NEVER touches a human-attributed record — it can only make a signpost more
// honest, never less. Clearing the flag (re-ratification) is a HUMAN act: run
// *MinSpec: Approve Spec* under your own identity.
//
// Idempotent. Tier-0/offline: reads and rewrites local JSON sidecars only.
//
// Usage:
//   node scripts/reconcile-approver-identity.mjs [--dry-run] [--root <dir>]
//   MINSPEC_AGENT_IDENTITIES="extra@bot" node scripts/reconcile-approver-identity.mjs

import * as fs from 'node:fs';
import * as path from 'node:path';

// Keep in sync with BUILTIN_AGENT_IDENTITIES in packages/minspec/src/lib/approval.ts
// (a plain .mjs cannot import the TS lib without a build step; the list is tiny).
const BUILTIN_AGENT_IDENTITIES = [
  'claude@harvest316.com',
  'minspec-sdd[bot]@users.noreply.github.com',
  '299695933+minspec-sdd[bot]@users.noreply.github.com',
];
const UNKNOWN_IDENTITY = 'unknown';

function parseAgentIdentities(raw) {
  return String(raw == null ? '' : raw)
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** An identity that must never stand as a proven human approver (DR-056 gate parity). */
function isAgentOrAbsent(email, denied) {
  const lower = String(email ?? '').trim().toLowerCase();
  if (!lower || lower === UNKNOWN_IDENTITY) return true;
  return denied.has(lower);
}

/**
 * A parsed JSON value is an approval record we may classify/mutate ONLY if it is a
 * plain object with a string `approvedBy` (mirrors approval-store's `isValidRecord`).
 * Anything else — `null` (a valid JSON literal that parses fine), an array, or an
 * object lacking `approvedBy` — is NOT a record: we leave it untouched, never inject
 * a `migrated` flag into it, and never crash on `rec.approvedBy`. Without this guard
 * a stray `null`/array sidecar would either throw mid-walk (half-reconciling the
 * corpus) or be silently reformatted and re-flagged every run (non-idempotent).
 */
function isApprovalRecord(rec) {
  return (
    rec !== null &&
    typeof rec === 'object' &&
    !Array.isArray(rec) &&
    typeof rec.approvedBy === 'string'
  );
}

function walkJson(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJson(full, out);
    else if (e.isFile() && e.name.endsWith('.json')) out.push(full);
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd();

  const denied = new Set([
    ...BUILTIN_AGENT_IDENTITIES.map((s) => s.toLowerCase()),
    ...parseAgentIdentities(process.env.MINSPEC_AGENT_IDENTITIES),
  ]);

  const approvalsDir = path.join(root, '.minspec', 'approvals');
  const files = walkJson(approvalsDir);

  const flagged = [];
  const alreadyFlagged = [];
  const humanKept = [];

  for (const file of files) {
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      continue; // unparseable — leave untouched
    }
    if (!isApprovalRecord(rec)) continue; // parseable but not a record (null/array/no approvedBy) — leave untouched
    const rel = path.relative(root, file);
    if (!isAgentOrAbsent(rec.approvedBy, denied)) {
      humanKept.push(`${rel}  (${rec.approvedBy})`);
      continue;
    }
    if (rec.migrated === true) {
      alreadyFlagged.push(`${rel}  (${rec.approvedBy})`);
      continue;
    }
    flagged.push(`${rel}  (${rec.approvedBy})`);
    if (!dryRun) {
      rec.migrated = true; // in-place mutation preserves key order → clean diff
      fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n', 'utf-8');
    }
  }

  const verb = dryRun ? 'WOULD flag' : 'Flagged';
  console.log(`DR-056 reconcile — ${approvalsDir}`);
  console.log(`  json files scanned:     ${files.length}`);
  console.log(`  human-attributed kept:  ${humanKept.length}`);
  console.log(`  already flagged:        ${alreadyFlagged.length}`);
  console.log(`  ${verb} (agent/absent → migrated:true): ${flagged.length}`);
  for (const f of flagged) console.log(`      • ${f}`);
  if (dryRun && flagged.length) console.log('\n  (dry run — nothing written; drop --dry-run to apply)');
}

main();
