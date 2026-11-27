#!/usr/bin/env -S npx tsx
/**
 * diagnose-short-gap-rewrites.ts — names what produced a full-prefix cache rewrite that
 * followed a gap of one hour or less (SPEC-077 M13 / Follow-up 4, #2207).
 *
 *   npx tsx scripts/diagnose-short-gap-rewrites.ts [--dir ~/.claude/projects]
 *
 * Read-only, offline (invariant 1). Walks main-chain transcripts, deduplicates assistant
 * records by message id, and applies the FR-10 rewrite rule (cache_read below 0.5 x the
 * previous context AND cache_creation at least 0.3 x (previous context - cache_read)) plus
 * a LOOSER "context shrank" arm. Each short-gap rewrite is attributed to a mechanism:
 *
 *   compaction      a `compact_boundary` system record sits between the two turns
 *   context-shrink  new context below half the previous one with no boundary (clear/rewind)
 *   model-switch    the model id changed
 *   ttl-5m          the previous turn wrote its cache with the 5-minute TTL and gap > 300s
 *   unexplained     none of the above
 *
 * The first three are NOT cache expiry: the prefix legitimately changed, so a gap trigger
 * could never have avoided them. Only `ttl-5m` and `unexplained` are expiry-shaped.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type Mechanism = 'compaction' | 'context-shrink' | 'model-switch' | 'ttl-5m' | 'unexplained';

export interface Turn {
  id: string;
  t: number; // epoch seconds
  model: string;
  ctx: number;
  read: number;
  create: number;
  create5m: number;
  /** a compact_boundary record was seen after the previous turn */
  compactedBefore: boolean;
}

export interface Rewrite {
  file?: string;
  gap: number;
  tokens: number;
  mechanism: Mechanism;
}

const SHORT_GAP_S = 3600;
const MIN_PREV_CTX = 20_000;

/** Classify turn `cur` against `prev`; null when it is not a full-prefix rewrite. */
export function classify(prev: Turn, cur: Turn): Rewrite | null {
  if (prev.ctx < MIN_PREV_CTX) return null;
  const shrank = cur.ctx < 0.5 * prev.ctx;
  const fr10 = cur.read < 0.5 * prev.ctx && cur.create >= 0.3 * (prev.ctx - cur.read);
  if (!fr10 && !(shrank && cur.read < 0.5 * prev.ctx)) return null;
  const gap = cur.t - prev.t;
  let mechanism: Mechanism = 'unexplained';
  if (cur.compactedBefore) mechanism = 'compaction';
  else if (shrank) mechanism = 'context-shrink';
  else if (cur.model !== prev.model) mechanism = 'model-switch';
  else if (prev.create5m > 0 && gap > 300) mechanism = 'ttl-5m';
  return { gap, tokens: cur.create, mechanism };
}

/** Turns of one transcript's text, in order, main chain only, deduplicated by message id. */
export function parseTurns(text: string): Turn[] {
  const turns: Turn[] = [];
  const seen = new Set<string>();
  let compacted = false;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.isSidechain) continue;
    if (d.type === 'system' && d.subtype === 'compact_boundary') {
      compacted = true;
      continue;
    }
    if (d.type !== 'assistant') continue;
    const m = d.message;
    const u = m?.usage;
    if (!u || !m.id || seen.has(m.id) || !d.timestamp) continue;
    seen.add(m.id);
    const read = u.cache_read_input_tokens ?? 0;
    const create = u.cache_creation_input_tokens ?? 0;
    turns.push({
      id: m.id,
      t: Date.parse(d.timestamp) / 1000,
      model: m.model ?? '',
      ctx: (u.input_tokens ?? 0) + read + create,
      read,
      create,
      create5m: u.cache_creation?.ephemeral_5m_input_tokens ?? 0,
      compactedBefore: compacted,
    });
    compacted = false;
  }
  return turns;
}

export function rewritesOf(turns: Turn[]): Rewrite[] {
  const out: Rewrite[] = [];
  for (let i = 1; i < turns.length; i++) {
    const r = classify(turns[i - 1], turns[i]);
    if (r) out.push(r);
  }
  return out;
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (name.endsWith('.jsonl')) yield p;
  }
}

function main(): number {
  const i = process.argv.indexOf('--dir');
  const dir = i > 0 ? process.argv[i + 1] : join(homedir(), '.claude', 'projects');
  let files = 0;
  const all: Rewrite[] = [];
  try {
    for (const f of walk(dir)) {
      files++;
      all.push(...rewritesOf(parseTurns(readFileSync(f, 'utf8'))).map((r) => ({ ...r, file: f })));
    }
  } catch (e) {
    console.error(`cannot read ${dir}: ${(e as Error).message}`);
    return 1;
  }
  if (files === 0) {
    console.error(`no transcripts under ${dir}; nothing was measured`);
    return 1;
  }
  const short = all.filter((r) => r.gap <= SHORT_GAP_S);
  const tok = (rs: Rewrite[]) => rs.reduce((a, r) => a + r.tokens, 0);
  console.log(`transcripts ${files}; rewrites ${all.length} (${tok(all)} tokens)`);
  console.log(`short-gap (<=1h) ${short.length} (${tok(short)} tokens, ${((100 * tok(short)) / Math.max(1, tok(all))).toFixed(2)}%)`);
  for (const mech of ['compaction', 'context-shrink', 'model-switch', 'ttl-5m', 'unexplained'] as Mechanism[]) {
    const rs = short.filter((r) => r.mechanism === mech);
    console.log(`  ${mech}: ${rs.length} events, ${tok(rs)} tokens`);
  }
  if (process.argv.includes('--list')) {
    for (const r of short) console.log(`${r.mechanism} gap=${Math.round(r.gap)}s tokens=${r.tokens} ${r.file}`);
  }
  return 0;
}

if (process.argv[1]?.endsWith('diagnose-short-gap-rewrites.ts')) process.exit(main());
