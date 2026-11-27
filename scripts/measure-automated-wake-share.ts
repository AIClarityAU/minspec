#!/usr/bin/env -S npx tsx
/**
 * measure-automated-wake-share.ts — what share of idle full-prefix cache rewrites was woken
 * by an automated message rather than a human prompt (SPEC-077 M8, #2208).
 *
 *   npx tsx scripts/measure-automated-wake-share.ts [--dir ~/.claude/projects] [--idle-s 3600] [--list]
 *
 * Read-only, offline (invariant 1). An "idle rewrite" is a FR-10 rewrite (see
 * diagnose-short-gap-rewrites.ts) whose gap to the previous assistant turn exceeds --idle-s
 * (default 3600) and whose cause is NOT compaction / context-shrink / model-switch (those
 * change the prefix; no wake policy could avoid them).
 *
 * The WAKE RECORD is the first main-chain user record after the previous assistant turn.
 * It is classified from its own fields, never from its text, except where no field exists:
 *
 *   human          turnOrigin "human" or origin.kind "human"
 *   peer-socket    origin.kind "peer" whose `from` starts `uds:`, or (older records) content
 *                  holds `<cross-session-message`  — another Claude session on the machine
 *   peer-subagent  origin.kind "peer" otherwise (a subagent hand-back), or `<agent-message`
 *   task-notif     turnOrigin "task_notification" / origin.kind "task-notification"
 *   scheduled      turnOrigin "scheduled"
 *   system         turnOrigin "system"
 *   coordinator    origin.kind "coordinator"
 *   sdk            turnOrigin "sdk" (a headless -p run; no human at the keyboard)
 *   continuation   isMeta user record with no origin fields (harness "Continue from where
 *                  you left off.")
 *   unlabelled     no origin fields and not isMeta: a pre-2.1.278 record. Cannot be told
 *                  apart from a typed prompt by fields, so it is reported on its own line and
 *                  EXCLUDED from the denominator of the headline share.
 *
 * RULE (the answer to "does a relayed founder instruction count as automated?"): YES for the
 * headline. The wake policy under test (SPEC-077 Part A) sees only the delivery channel, never
 * whether a person stands behind a socket message, so `peer-socket` counts as automated. The
 * LOWER BOUND excludes `peer-socket` entirely (its denominator too), which is the 2026-09-29
 * "36%" shape. Both numbers are always printed; the spread between them is the part that
 * DQ-1 (founder's "wake everything" instruction) decides.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { classify, parseTurns, type Turn } from './diagnose-short-gap-rewrites';

export type WakeClass =
  | 'human' | 'peer-socket' | 'peer-subagent' | 'task-notif' | 'scheduled'
  | 'system' | 'coordinator' | 'sdk' | 'continuation' | 'unlabelled';

export const WAKE_CLASSES: WakeClass[] = [
  'human', 'peer-socket', 'peer-subagent', 'task-notif', 'scheduled',
  'system', 'coordinator', 'sdk', 'continuation', 'unlabelled',
];

export const AUTOMATED: ReadonlySet<WakeClass> = new Set<WakeClass>([
  'peer-socket', 'peer-subagent', 'task-notif', 'scheduled', 'system', 'coordinator', 'sdk', 'continuation',
]);

const DEFAULT_IDLE_S = 3600;

function contentText(d: any): string {
  const c = d?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('\n');
  return '';
}

/** Classify one user record from its own origin fields. */
export function classifyWake(d: any): WakeClass {
  const o = d?.origin;
  const kind: string | undefined = o && typeof o === 'object' ? o.kind : undefined;
  const to: string | undefined = d?.turnOrigin;
  if (to === 'human' || kind === 'human') return 'human';
  if (kind === 'peer' || to === 'peer') {
    return typeof o?.from === 'string' && o.from.startsWith('uds:') ? 'peer-socket' : 'peer-subagent';
  }
  if (kind === 'task-notification' || to === 'task_notification') return 'task-notif';
  if (to === 'scheduled' || kind === 'scheduled') return 'scheduled';
  if (to === 'system' || kind === 'system') return 'system';
  if (kind === 'coordinator') return 'coordinator';
  if (to === 'sdk') return 'sdk';
  if (d?.isMeta === true) return 'continuation';
  const text = contentText(d);
  if (text.includes('<cross-session-message')) return 'peer-socket';
  if (text.includes('<agent-message')) return 'peer-subagent';
  return 'unlabelled';
}

export interface Wake {
  file?: string;
  gap: number;
  tokens: number;
  wake: WakeClass;
}

/** Idle rewrites of one transcript with their wake class. Pure over the transcript text. */
export function idleWakes(text: string, idleS = DEFAULT_IDLE_S): Wake[] {
  const turns: Turn[] = parseTurns(text);
  // first user record at or after each turn's timestamp, keyed by turn index
  const firstUserAfter = new Map<number, any>();
  const seen = new Set<string>();
  let idx = -1; // index of the last assistant turn seen
  const byId = new Map<string, number>();
  turns.forEach((t, i) => byId.set(t.id, i));
  for (const line of text.split('\n')) {
    if (!line) continue;
    let d: any;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.isSidechain) continue;
    if (d.type === 'assistant') {
      const id = d.message?.id;
      if (id && byId.has(id) && !seen.has(id)) { seen.add(id); idx = byId.get(id)!; }
      continue;
    }
    if (d.type !== 'user') continue;
    if (Array.isArray(d.message?.content) && d.message.content.every((p: any) => p?.type === 'tool_result')) continue;
    if (idx >= 0 && !firstUserAfter.has(idx)) firstUserAfter.set(idx, d);
  }
  const out: Wake[] = [];
  for (let i = 1; i < turns.length; i++) {
    const r = classify(turns[i - 1], turns[i]);
    if (!r || r.gap <= idleS) continue;
    if (r.mechanism === 'compaction' || r.mechanism === 'context-shrink' || r.mechanism === 'model-switch') continue;
    const u = firstUserAfter.get(i - 1);
    out.push({ gap: r.gap, tokens: r.tokens, wake: u ? classifyWake(u) : 'unlabelled' });
  }
  return out;
}

export interface Share {
  total: number;
  counts: Record<WakeClass, number>;
  /** headline: automated / (all - unlabelled); null when the denominator is 0 */
  headline: number | null;
  /** lower bound: peer-socket removed from numerator and denominator */
  lowerBound: number | null;
}

export function summarize(ws: Wake[]): Share {
  const counts = Object.fromEntries(WAKE_CLASSES.map((c) => [c, 0])) as Record<WakeClass, number>;
  for (const w of ws) counts[w.wake]++;
  const labelled = ws.length - counts.unlabelled;
  const auto = WAKE_CLASSES.filter((c) => AUTOMATED.has(c)).reduce((a, c) => a + counts[c], 0);
  const lbDen = labelled - counts['peer-socket'];
  return {
    total: ws.length,
    counts,
    headline: labelled > 0 ? auto / labelled : null,
    lowerBound: lbDen > 0 ? (auto - counts['peer-socket']) / lbDen : null,
  };
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (name.endsWith('.jsonl')) yield p;
  }
}

const pct = (x: number | null) => (x === null ? 'n/a' : `${(100 * x).toFixed(1)}%`);

function main(): number {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const dir = arg('--dir') ?? join(homedir(), '.claude', 'projects');
  const idleS = Number(arg('--idle-s') ?? DEFAULT_IDLE_S);
  if (!Number.isFinite(idleS) || idleS < 0) { console.error('--idle-s must be a non-negative number'); return 1; }
  let files = 0;
  const all: Wake[] = [];
  try {
    for (const f of walk(dir)) {
      files++;
      all.push(...idleWakes(readFileSync(f, 'utf8'), idleS).map((w) => ({ ...w, file: f })));
    }
  } catch (e) {
    console.error(`cannot read ${dir}: ${(e as Error).message}`);
    return 1;
  }
  if (files === 0) { console.error(`no transcripts under ${dir}; nothing was measured`); return 1; }
  const s = summarize(all);
  console.log(`transcripts ${files}; idle rewrites (gap > ${idleS}s, prefix-preserving causes only) ${s.total}`);
  for (const c of WAKE_CLASSES) console.log(`  ${c}: ${s.counts[c]}`);
  console.log(`automated share, headline (peer-socket counts as automated; unlabelled excluded): ${pct(s.headline)}`);
  console.log(`automated share, lower bound (peer-socket excluded entirely): ${pct(s.lowerBound)}`);
  if (process.argv.includes('--list')) for (const w of all) console.log(`${w.wake} gap=${Math.round(w.gap)}s tokens=${w.tokens} ${w.file}`);
  return 0;
}

if (process.argv[1]?.endsWith('measure-automated-wake-share.ts')) process.exit(main());
