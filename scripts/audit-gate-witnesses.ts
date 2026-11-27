#!/usr/bin/env -S npx tsx
/**
 * audit-gate-witnesses.ts - SPEC-054 FR-3 (+ AC-10): the DR-066 clause-3 witness audit.
 *
 * Constitution invariant 2, clause 3: no required check hinges on a single producer that one
 * permission or config gap can disable. This reads the contexts `main`'s branch rulesets
 * actually require, and for each one asserts, against the FR-5 manifest
 * (`scripts/lib/gate-manifest.ts`), either two witnesses of DIFFERENT mechanisms (DQ-3:
 * commit status / check-run / label) or an explicit `failClosed` annotation on its sole
 * producer. It also asserts its own context and the FR-1 linter's (`SELF_CONTEXTS`) are
 * required (AC-10), so a later ruleset edit that demotes either job reds this one.
 *
 *   npx tsx scripts/audit-gate-witnesses.ts [--repo owner/name]   (else GITHUB_REPOSITORY)
 *
 * Exit 0 = every required context is witnessed. Exit 1 = findings. Exit 2 = could not run.
 *
 * READ (DQ-6, INV-4). The checker owns its `gh api` calls through an injected runner, so the
 * tests drive every branch with no network. It reuses the ruleset advisor's two pure helpers
 * (imported, never copied) but NOT `listRequiredCheckContexts`, which collapses a read
 * failure into the same `null` as "no ruleset" and `continue`s past a failed detail GET.
 * Here a failed list, a failed detail GET, or an unparseable body is exit 2, loudly; "no
 * guarding ruleset" and "zero contexts" are findings with their own messages. Contexts are
 * UNIONED across every guarding ruleset, because GitHub enforces every active one.
 *
 * NETWORK. This is the only networked path of SPEC-054 (FR-7, INV-2): it is never reached
 * from `npm run lint`, `pretest` or a `check:*` script, and it only ever GETs.
 */

import {
  defaultCommandRunner,
  extractRequiredContexts,
  rulesetGuardsDefaultBranchChecks,
  type CommandResult,
  type CommandRunner,
  type RulesetFull,
} from '../packages/minspec/src/lib/ruleset-advisor';

import { GATE_MANIFEST, type GateEntry } from './lib/gate-manifest';

/** The contexts this spec's own jobs report as; each must itself be required (AC-10). */
export const SELF_CONTEXTS: readonly string[] = ['lint', 'gate-witnesses'];

export type WitnessFindingKind =
  | 'no manifest entry'
  | 'single witness (AC-5)'
  | 'invalid fail-closed annotation'
  | 'not a required context'
  | 'no guarding ruleset'
  | 'zero required contexts';

export interface WitnessFinding {
  context: string;
  kind: WitnessFindingKind;
  detail: string;
}

export interface HonouredFailClosed {
  context: string;
  reason: string;
  evidence: string;
}

export interface Evaluation {
  findings: WitnessFinding[];
  /** Manifest entries whose context is not required: stale, but weaken no gate. */
  notices: string[];
  /** Every `failClosed` entry this run relied on - printed every run. */
  honoured: HonouredFailClosed[];
}

/** FR-3 + AC-10, pure: judge the required contexts against the manifest. */
export function evaluateWitnesses(
  required: readonly string[],
  manifest: readonly GateEntry[],
  self: readonly string[],
): Evaluation {
  const findings: WitnessFinding[] = [];
  const honoured: HonouredFailClosed[] = [];
  for (const context of required) {
    const entry = manifest.find((e) => e.context === context);
    if (!entry) {
      findings.push({ context, kind: 'no manifest entry', detail: 'required, but the gate manifest names no producer for it' });
      continue;
    }
    const mechanisms = new Set(entry.witnesses.map((w) => w.mechanism));
    const fc = entry.failClosed;
    if (fc && (fc.reason.trim() === '' || fc.evidence.trim() === '')) {
      findings.push({ context, kind: 'invalid fail-closed annotation', detail: 'failClosed needs a non-empty reason and evidence path' });
      continue;
    }
    if (mechanisms.size >= 2) continue;
    if (fc) {
      honoured.push({ context, reason: fc.reason, evidence: fc.evidence });
      continue;
    }
    findings.push({
      context,
      kind: 'single witness (AC-5)',
      detail: `${entry.witnesses.length} witness(es), ${mechanisms.size} mechanism(s) (${[...mechanisms].join(', ') || 'none'}); needs a second mechanism or a failClosed annotation`,
    });
  }
  for (const s of self) {
    if (!required.includes(s)) {
      findings.push({
        context: s,
        kind: 'not a required context',
        detail: `observed required contexts (${required.length}): ${required.join(', ')}`,
      });
    }
  }
  const notices = manifest
    .filter((e) => !required.includes(e.context))
    .map((e) => `manifest entry '${e.context}' is not a required context (stale manifest, weakens no gate)`);
  return { findings, notices, honoured };
}

// ── Read (3.4) ───────────────────────────────────────────────────────────────

export type ReadResult =
  | { ok: true; contexts: string[] }
  | { ok: false; kind: 'read failure'; message: string; stderr: string }
  | { ok: false; kind: 'no guarding ruleset' | 'zero required contexts'; message: string };

async function call(run: CommandRunner, args: string[]): Promise<CommandResult> {
  try {
    return await run('gh', args);
  } catch (e) {
    return { code: 127, stdout: '', stderr: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Parse `gh api --paginate` output: one JSON array, or several concatenated (one per page).
 * Throws on anything else.
 */
export function parsePages(text: string): unknown[] {
  const out: unknown[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;
    if (text[i] !== '[') throw new Error(`expected a JSON array at offset ${i}`);
    let depth = 0;
    let j = i;
    let inString = false;
    for (; j < n; j++) {
      const c = text[j];
      if (inString) {
        if (c === '\\') j++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '[' || c === '{') depth++;
      else if ((c === ']' || c === '}') && --depth === 0) break;
    }
    if (j >= n) throw new Error('unterminated JSON array');
    const page = JSON.parse(text.slice(i, j + 1)) as unknown;
    if (!Array.isArray(page)) throw new Error('page is not a JSON array');
    out.push(...page);
    i = j + 1;
  }
  if (out.length === 0 && text.trim() === '') throw new Error('empty response');
  return out;
}

const readFailure = (message: string, stderr = ''): ReadResult => ({ ok: false, kind: 'read failure', message, stderr });

/** The contexts every guarding branch ruleset requires, unioned; or why that is unknown. */
export async function readRequiredContexts(owner: string, repo: string, run: CommandRunner): Promise<ReadResult> {
  const list = await call(run, ['api', '--paginate', `repos/${owner}/${repo}/rulesets`]);
  if (list.code !== 0) return readFailure(`listing rulesets for ${owner}/${repo} failed (exit ${list.code})`, list.stderr);
  let rulesets: unknown[];
  try {
    rulesets = parsePages(list.stdout);
  } catch (e) {
    return readFailure(`the ruleset list is not a JSON array: ${(e as Error).message}`, list.stderr);
  }

  const details: unknown[] = [];
  for (const rs of rulesets) {
    if (typeof rs !== 'object' || rs === null) continue;
    const r = rs as { id?: unknown; target?: unknown; enforcement?: unknown };
    if (r.target !== 'branch' || r.enforcement === 'disabled') continue;
    if (typeof r.id !== 'number' || !Number.isInteger(r.id)) continue;
    const detail = await call(run, ['api', `repos/${owner}/${repo}/rulesets/${r.id}`]);
    if (detail.code !== 0) return readFailure(`reading ruleset ${r.id} failed (exit ${detail.code})`, detail.stderr);
    let parsed: unknown;
    try {
      parsed = JSON.parse(detail.stdout) as unknown;
    } catch (e) {
      return readFailure(`ruleset ${r.id} is not JSON: ${(e as Error).message}`, detail.stderr);
    }
    if (typeof parsed !== 'object' || parsed === null) return readFailure(`ruleset ${r.id} is not a JSON object`);
    details.push(parsed);
  }

  const guarding = details.filter((d) => rulesetGuardsDefaultBranchChecks(d));
  if (guarding.length === 0) {
    return { ok: false, kind: 'no guarding ruleset', message: 'no active branch ruleset requires status checks' };
  }
  const contexts: string[] = [];
  for (const d of guarding) {
    for (const c of extractRequiredContexts(d as RulesetFull)) if (!contexts.includes(c)) contexts.push(c);
  }
  if (contexts.length === 0) {
    return { ok: false, kind: 'zero required contexts', message: 'every guarding ruleset requires zero status-check contexts' };
  }
  return { ok: true, contexts };
}

// ── IO entry (3.5) ───────────────────────────────────────────────────────────

export interface AuditDeps {
  env: Record<string, string | undefined>;
  run: CommandRunner;
  io: { out(s: string): void; err(s: string): void };
}

function repoArg(argv: readonly string[], env: AuditDeps['env']): string | undefined {
  const i = argv.indexOf('--repo');
  if (i >= 0) return argv[i + 1] ?? '';
  return env.GITHUB_REPOSITORY;
}

export function renderEvaluation(required: readonly string[], e: Evaluation): string {
  const out: string[] = [`required contexts (${required.length}): ${required.join(', ')}`];
  out.push(`${e.honoured.length} fail-closed entr${e.honoured.length === 1 ? 'y' : 'ies'} honoured`);
  for (const h of e.honoured) out.push(`  ${h.context}: ${h.reason} (evidence: ${h.evidence})`);
  for (const n of e.notices) out.push(`notice: ${n}`);
  for (const f of e.findings) out.push(`${f.context}: ${f.kind} - ${f.detail}`);
  out.push(`${e.findings.length} finding${e.findings.length === 1 ? '' : 's'}`);
  return out.join('\n');
}

/** The CLI: resolve the repo, read, evaluate, print; 0 clean, 1 findings, 2 could not run. */
export async function runAudit(argv: readonly string[], deps: AuditDeps): Promise<0 | 1 | 2> {
  const { io } = deps;
  const repoFull = repoArg(argv, deps.env);
  if (!repoFull) {
    io.err('audit-gate-witnesses: could not run: no repository (pass --repo owner/name or set GITHUB_REPOSITORY)');
    return 2;
  }
  const m = /^([^/\s]+)\/([^/\s]+)$/.exec(repoFull);
  if (!m) {
    io.err(`audit-gate-witnesses: could not run: '${repoFull}' is not owner/name`);
    return 2;
  }
  try {
    const read = await readRequiredContexts(m[1], m[2], deps.run);
    if (!read.ok && read.kind === 'read failure') {
      io.err(`audit-gate-witnesses: could not run: ${read.message}`);
      if (read.stderr.trim()) io.err(read.stderr.trim());
      return 2;
    }
    if (!read.ok) {
      const e = evaluateWitnesses([], GATE_MANIFEST, SELF_CONTEXTS);
      e.findings.unshift({ context: `${m[1]}/${m[2]}`, kind: read.kind, detail: read.message });
      io.out(renderEvaluation([], e));
      return 1;
    }
    const e = evaluateWitnesses(read.contexts, GATE_MANIFEST, SELF_CONTEXTS);
    io.out(renderEvaluation(read.contexts, e));
    return e.findings.length ? 1 : 0;
  } catch (e) {
    io.err(`audit-gate-witnesses: could not run: ${(e as Error).message}`);
    return 2;
  }
}

// Run only when executed directly, so importing this module for tests runs nothing.
if (/audit-gate-witnesses\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  void runAudit(process.argv.slice(2), {
    env: process.env,
    run: defaultCommandRunner,
    io: { out: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`) },
  }).then((code) => {
    process.exitCode = code;
  });
}
