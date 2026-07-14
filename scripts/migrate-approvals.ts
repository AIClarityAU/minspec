#!/usr/bin/env tsx
/**
 * migrate-approvals.ts — SPEC-022 / DR-034 (FR-5). One-shot, idempotent.
 *
 * Converts the legacy local id-keyed `.minspec/approvals.json` store into the
 * committed, path-keyed, canonically-hashed sidecar tree under
 * `.minspec/approvals/`, and backfills `migrated:true` sidecars for shipped specs
 * that derive to implementing/done with no source record. Warn-first, no flag day:
 *
 *   1. Read the legacy store from the CANONICAL checkout (git rev-parse
 *      --git-common-dir, the same path the gate used). For each id-keyed record,
 *      resolve the spec FILE (id -> the representative requirements artifact),
 *      RECOMPUTE specHash under FR-3 canonicalization (raw-byte hashes are invalid
 *      now), set approvedBy = repo owner's git config user.email, carry
 *      tier/approvedAt, and write the path-keyed sidecar. `migrated` is `false`
 *      only when the captured email passes the DR-056 `checkApprover` denylist
 *      (a provable human identity); an agent/bot/absent identity is written as
 *      `migrated:true` (unverified) — a one-time script must never stamp an
 *      agent as a genuine human approver (#719, sibling of DR-056).
 *   2. For each shipped spec that DERIVES (phase-position) to implementing/done
 *      with no sidecar from step 1, write a sidecar marked migrated:true
 *      (attributed to the owner + migration date) — honest provenance, valid but
 *      flagged ("re-approve to clear"). The set is computed at runtime, not hardcoded.
 *
 * Idempotent: a spec that already has a sidecar (from a prior run or step 1) is
 * never overwritten by step 2. Re-running converts nothing new.
 *
 * Run (from the repo root):  npx tsx scripts/migrate-approvals.ts [--dry-run]
 */
import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join, relative, sep } from 'path';
import { parseSpec } from '../packages/minspec/src/lib/spec';
import { checkApprover, parseAgentIdentities } from '../packages/minspec/src/lib/approval';
import { specHash } from '@aiclarity/shared';

const ROOT = process.cwd();
const DRY_RUN = process.argv.includes('--dry-run');

interface LegacyRecord {
  specHash: string;
  approvedAt: string;
  tier: string;
}

interface ApprovalRecord {
  specPath: string;
  specHash: string;
  approvedAt: string;
  approvedBy: string;
  tier: string;
  migrated: boolean;
}

function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

/** repo-relative POSIX path (the approval store key). */
function toPosixRel(abs: string): string {
  return relative(ROOT, abs).split(sep).join('/');
}

/** The canonical checkout's .minspec dir (git common-dir parent), or ROOT/.minspec. */
function canonicalMinspecDir(): string {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (common) return join(dirname(common.replace(/[/\\]$/, '')), '.minspec');
  } catch {
    // fall through
  }
  return join(ROOT, '.minspec');
}

function ownerEmail(): string {
  try {
    return (
      execFileSync('git', ['config', 'user.email'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || 'unknown'
    );
  } catch {
    return 'unknown';
  }
}

function sidecarPath(specRel: string): string {
  return join(ROOT, '.minspec', 'approvals', ...specRel.split('/')) + '.json';
}

// Tracks sidecars planned/written this run so step 2 sees step 1's writes even in
// --dry-run (where nothing hits disk) — keeps the preview accurate and idempotent.
const written = new Set<string>();

function writeRecord(rec: ApprovalRecord): void {
  const p = sidecarPath(rec.specPath);
  written.add(rec.specPath);
  if (DRY_RUN) {
    log(`  [dry-run] would write ${toPosixRel(p)}`);
    return;
  }
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(rec, null, 2) + '\n', 'utf-8');
}

function hasSidecar(specRel: string): boolean {
  return written.has(specRel) || existsSync(sidecarPath(specRel));
}

/** Walk specs/**\/*.md. */
function walkSpecs(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (e.endsWith('.md')) out.push(full);
    }
  };
  walk(join(ROOT, 'specs'));
  return out;
}

const PHASE_ORDER = ['specify', 'clarify', 'plan', 'tasks', 'implement'] as const;

/**
 * Phase-position status — mirrors lifecycle.ts getSpecStatus / the gate's
 * phase_intent_status. A spec is "in implementation" (gated, needs a record) when
 * this returns implementing/done. archived (explicit terminal) is never gated.
 */
function phaseIntentStatus(
  phases: Record<string, string>,
  literalStatus: string,
): string {
  if (literalStatus === 'archived') return 'archived';
  const allPending = PHASE_ORDER.every((p) => (phases[p] ?? 'pending') === 'pending');
  if (allPending) return 'new';
  const allDone = PHASE_ORDER.every((p) => {
    const s = phases[p] ?? 'pending';
    return s !== 'pending' && s !== 'in-progress';
  });
  if (allDone) return 'done';
  const current =
    PHASE_ORDER.find((p) => (phases[p] ?? 'pending') === 'in-progress') ??
    PHASE_ORDER.find((p) => (phases[p] ?? 'pending') === 'pending');
  if (current === 'specify' || current === 'clarify') return 'specifying';
  return 'implementing';
}

/** rank: representative requirements artifact wins as the record's file. */
function rankOf(name: string): number {
  return name === 'requirements.md' ? 0 : name === 'spec.md' ? 1 : name === 'design.md' ? 2 : 3;
}

interface SpecFile {
  abs: string;
  rel: string;
  id: string;
  tier: string;
  phases: Record<string, string>;
  literalStatus: string;
}

function loadSpecFiles(): SpecFile[] {
  const out: SpecFile[] = [];
  for (const abs of walkSpecs()) {
    let parsed;
    try {
      parsed = parseSpec(readFileSync(abs, 'utf-8'));
    } catch {
      continue;
    }
    const fm = parsed.frontmatter;
    if (!fm.id) continue;
    out.push({
      abs,
      rel: toPosixRel(abs),
      id: fm.id,
      tier: fm.tier,
      phases: fm.phases as unknown as Record<string, string>,
      literalStatus: fm.status,
    });
  }
  return out;
}

/** id -> the representative spec file (lowest rank). */
function representativeById(files: SpecFile[]): Map<string, SpecFile> {
  const byId = new Map<string, { f: SpecFile; rank: number }>();
  for (const f of files) {
    const rank = rankOf(f.abs.split(sep).pop() ?? '');
    const prev = byId.get(f.id);
    if (!prev || rank < prev.rank) byId.set(f.id, { f, rank });
  }
  const out = new Map<string, SpecFile>();
  for (const [id, { f }] of byId) out.set(id, f);
  return out;
}

function main(): void {
  const email = ownerEmail();
  const now = new Date().toISOString();
  const files = loadSpecFiles();
  const byId = representativeById(files);
  const approverCheck = checkApprover(email, parseAgentIdentities(process.env.MINSPEC_AGENT_IDENTITIES));
  const step1Migrated = !approverCheck.ok;

  log(`migrate-approvals (FR-5)${DRY_RUN ? ' [dry-run]' : ''}`);
  log(`  owner email: ${email}`);
  if (!approverCheck.ok) {
    log(`  ! captured identity is agent/absent (${approverCheck.reason}) — step 1 records will be written migrated:true`);
  }
  log(`  spec files: ${files.length}, distinct ids: ${byId.size}`);

  // ── Step 1: convert legacy id-keyed records → committed path-keyed sidecars.
  const canonMinspec = canonicalMinspecDir();
  const legacyPath = join(canonMinspec, 'approvals.json');
  let converted = 0;
  let convertedIds = new Set<string>();
  if (existsSync(legacyPath)) {
    let store: Record<string, LegacyRecord> = {};
    try {
      store = JSON.parse(readFileSync(legacyPath, 'utf-8')) as Record<string, LegacyRecord>;
    } catch {
      store = {};
    }
    log(`  legacy store: ${Object.keys(store).length} record(s) at ${legacyPath}`);
    for (const [id, rec] of Object.entries(store)) {
      const f = byId.get(id);
      if (!f) {
        log(`  ! legacy record ${id} matches no spec file — skipped`);
        continue;
      }
      if (hasSidecar(f.rel)) {
        convertedIds.add(id);
        continue; // idempotent — already converted
      }
      const recomputed = specHash(readFileSync(f.abs, 'utf-8'));
      writeRecord({
        specPath: f.rel,
        specHash: recomputed,
        approvedAt: rec.approvedAt,
        approvedBy: email,
        tier: rec.tier ?? f.tier,
        migrated: step1Migrated,
      });
      converted++;
      convertedIds.add(id);
    }
  } else {
    log(`  no legacy store at ${legacyPath} — skipping step 1`);
  }
  log(`  step 1: converted ${converted} legacy record(s) → committed sidecars`);

  // ── Step 2: backfill migrated:true for shipped implementing/done specs with
  //    no record. Computed at runtime: phase-intent implementing/done AND no sidecar.
  let migrated = 0;
  for (const f of byId.values()) {
    const intent = phaseIntentStatus(f.phases, f.literalStatus);
    if (intent !== 'implementing' && intent !== 'done') continue;
    if (hasSidecar(f.rel)) continue; // already backed (step 1 or prior)
    writeRecord({
      specPath: f.rel,
      specHash: specHash(readFileSync(f.abs, 'utf-8')),
      approvedAt: now,
      approvedBy: email,
      tier: f.tier,
      migrated: true,
    });
    migrated++;
    log(`  migrated:true → ${f.rel} (${f.id}, derives ${intent})`);
  }
  log(`  step 2: wrote ${migrated} migrated:true sidecar(s) for unbacked implementing/done specs`);

  log(
    `done. ${converted} converted + ${migrated} migrated = ${converted + migrated} sidecar(s)` +
      `${DRY_RUN ? ' (dry-run — nothing written)' : ''}.`,
  );
  if (migrated > 0) {
    log('  NOTE: migrated records keep the gate in WARN — promotion to ERROR is blocked until zero migrated remain.');
  }
}

main();
