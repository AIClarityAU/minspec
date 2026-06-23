/**
 * consequence-analyzers.ts — SPEC-023 (DR-022 §1, step 1)
 *
 * The always-on **consequence axis**: deterministic, offline (Tier-0) analyzers
 * that emit `ClassificationSignal`s describing how much a change can *hurt* (its
 * blast radius), as opposed to how *big* it is. They feed the existing
 * max-over-signals `classify()` alongside the diff-size signals.
 *
 * INVARIANTS (T0 — see consequence-analyzers.test.ts):
 *  - INV-1 Tier-0. This module imports **no** `vscode`, no `simple-git`, performs
 *    no network and no disk IO. Every analyzer is a pure
 *    `(input: ConsequenceInput) => ClassificationSignal[]`. Git/disk IO stays in
 *    the command layer and is passed *in* as data (the `ConsequenceInput`).
 *  - INV-3 Upward-only ratchet. A consequence signal can only floor ceremony UP.
 *    A clean analyzer emits **nothing** (or a `T1` signal), never a downgrade.
 *  - INV-4 Honest degrade, never silent. When the ideal data source is absent an
 *    analyzer emits a **visible** `degraded` marker (or nothing), never a
 *    silently-wrong tier.
 *
 * The only import is the *type* `ClassificationSignal` (+ `Tier`) — types are
 * erased at compile time, so this stays a leaf module with zero runtime deps.
 */
import type { Tier } from './config';
import type { ClassificationSignal } from './classifier';

// ─── Contract types (SPEC-023 FR-6) ──────────────────────────────────────────

/** A symbol reference, as the (future, #91-gated) reference index would key it. */
export interface SymbolRef {
  readonly name: string;
  readonly filePath: string;
}

/**
 * Cross-file reference/call-graph index. Built by the #91-gated follow-up;
 * **always `null` in v1** (there is no graph yet — see SPEC-023 Clarification 2).
 * When null, analyzers that would consume it degrade to a coarser read.
 */
export interface ReferenceIndex {
  callerCount(symbol: SymbolRef): number;
  reachCount(symbol: SymbolRef): number;
  exportedSymbolsOf(filePath: string): SymbolRef[];
}

/** Diff status of a changed file, normalized from git. */
export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

/** One changed file, as data the command layer hands to the pure analyzers. */
export interface ChangedFile {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly status: ChangeStatus;
  /** New (post-change) content, when the command could read it. */
  readonly content?: string;
  /** Pre-change content, when available (enables removed-vs-added deltas). */
  readonly oldContent?: string;
}

/** The full, pure input to every consequence analyzer. */
export interface ConsequenceInput {
  readonly changedFiles: ReadonlyArray<ChangedFile>;
  /** null ⇒ degrade. Always null in v1 (no reference index exists yet). */
  readonly refIndex: ReferenceIndex | null;
}

/** A consequence analyzer: pure, offline, `(input) => signals`. */
export type ConsequenceAnalyzer = (input: ConsequenceInput) => ClassificationSignal[];

// ─── Shared helpers ──────────────────────────────────────────────────────────

const CONSEQUENCE = 'consequence' as const;

/** Lower-cased file extension without the dot ('' when none). */
function ext(filePath: string): string {
  const i = filePath.lastIndexOf('.');
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (i <= slash) return '';
  return filePath.slice(i + 1).toLowerCase();
}

/** JS/TS source files we run content regexes over. */
const CODE_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts']);

function isCodeFile(filePath: string): boolean {
  return CODE_EXTS.has(ext(filePath));
}

/**
 * The "+ added" lines a unified diff would introduce, approximated when we only
 * have whole-file content (v1 has no hunk data). We treat the whole post-change
 * `content` as the surface to scan: a regex match anywhere means the pattern is
 * *present* after the change. This is intentionally inclusion-biased (INV-3:
 * over-tiering is safe, under-tiering is the failure mode we target).
 */
function scannable(file: ChangedFile): string | undefined {
  return file.content;
}

// ─── FR-1 Impact-reach (flagship, DEGRADED in v1) ────────────────────────────

/**
 * Impact-reach — *intends* to measure downstream caller/reach count for each
 * changed exported symbol. v1 has no reference index (`refIndex` is always null),
 * so it emits a single honest `degraded` marker and NEVER a fabricated reach
 * number (FR-1 / INV-4). The real measurement is the #91-gated follow-up.
 *
 * When a (future) index is present it would emit per-symbol reach signals; that
 * path is intentionally not built in v1 (Clarification 2/3) — but the null guard
 * is the v1 contract and is what the INV-4 test pins.
 */
export const impactReachAnalyzer: ConsequenceAnalyzer = (input) => {
  if (input.refIndex === null) {
    return [
      {
        name: 'reach_unavailable',
        value: true,
        weight: 0,
        tierContribution: 'T1',
        axis: CONSEQUENCE,
        degraded: true,
        explain: 'call graph unavailable; using size signals',
      },
    ];
  }

  // #91-gated follow-up: with a real index, emit per-symbol reach signals here.
  // v1 never reaches this branch (refIndex is always null). Emitting nothing is
  // the correct upward-only behaviour until the index lands.
  return [];
};

// ─── FR-2 Public-API surface delta ───────────────────────────────────────────

/**
 * Files we treat as a package's public boundary (barrel / entry points).
 * A change at the public surface has higher blast radius than an internal one.
 */
function isPublicSurface(filePath: string): boolean {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const lower = base.toLowerCase();
  if (lower === 'index.ts' || lower === 'index.js' || lower === 'index.tsx') return true;
  if (lower === 'index.d.ts') return true;
  // common entry filenames
  if (lower === 'main.ts' || lower === 'main.js') return true;
  // package.json "exports"/"main" surface
  if (lower === 'package.json') return true;
  return false;
}

/** Match `export` declarations and re-exports in JS/TS source. */
const EXPORT_DECL = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:class|function|const|let|var|interface|type|enum|namespace)\s+([A-Za-z0-9_$]+)/gm;
const EXPORT_NAMED = /^\s*export\s*\{([^}]*)\}/gm;
const EXPORT_STAR = /^\s*export\s+\*/gm;

/** Collect the set of exported identifier names from source text. */
function exportedNames(src: string): Set<string> {
  const names = new Set<string>();
  let m: RegExpExecArray | null;

  EXPORT_DECL.lastIndex = 0;
  while ((m = EXPORT_DECL.exec(src)) !== null) {
    if (m[1]) names.add(m[1]);
  }

  EXPORT_NAMED.lastIndex = 0;
  while ((m = EXPORT_NAMED.exec(src)) !== null) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      // `foo as bar` → exported name is `bar`; bare `foo` → `foo`
      const asMatch = part.match(/\bas\s+([A-Za-z0-9_$]+)/);
      const name = asMatch ? asMatch[1] : part.split(/\s+/)[0];
      if (name) names.add(name);
    }
  }

  // `export *` re-exports an unknown set; record a sentinel so additions/removals
  // of a star line are themselves visible as a surface change.
  EXPORT_STAR.lastIndex = 0;
  if (EXPORT_STAR.test(src)) names.add('*');

  return names;
}

/**
 * Public-API surface delta — counts exported symbols added / removed / changed at
 * a package's public boundary. Removed or changed exports floor HIGHER than
 * additions (removing/renaming a public symbol breaks every downstream consumer).
 *
 * Degrade (FR-2): when pre-change content is absent we can only see what exists
 * now → additions-only, flagged `degraded`.
 */
export const publicApiAnalyzer: ConsequenceAnalyzer = (input) => {
  const signals: ClassificationSignal[] = [];

  for (const file of input.changedFiles) {
    if (!isPublicSurface(file.path)) continue;
    // package.json is a public surface but not JS/TS export syntax — skip the
    // name-diff for it; a touch to it is already captured by dependency_change.
    if (!isCodeFile(file.path)) continue;

    const now = scannable(file);

    // Deleting a public-surface file removes its entire exported surface.
    if (file.status === 'deleted') {
      signals.push({
        name: 'public_api_removed',
        value: true,
        weight: 0,
        tierContribution: 'T3',
        axis: CONSEQUENCE,
        explain: `public surface file removed: ${file.path}`,
      });
      continue;
    }

    if (now === undefined) {
      // Can't read content at all — but a public-surface file changed.
      signals.push({
        name: 'public_api_changed',
        value: true,
        weight: 0,
        tierContribution: 'T2',
        axis: CONSEQUENCE,
        degraded: true,
        explain: `public surface ${file.path} changed; content unavailable`,
      });
      continue;
    }

    const after = exportedNames(now);

    if (file.oldContent === undefined) {
      // FR-2 degrade: no baseline → additions-only, flagged.
      if (after.size > 0) {
        signals.push({
          name: 'public_api_added',
          value: after.size,
          weight: 0,
          tierContribution: 'T2',
          axis: CONSEQUENCE,
          degraded: true,
          explain: `${after.size} export(s) present at ${file.path}; no baseline (additions-only)`,
        });
      }
      continue;
    }

    const before = exportedNames(file.oldContent);
    const removed: string[] = [];
    const added: string[] = [];
    for (const n of before) if (!after.has(n)) removed.push(n);
    for (const n of after) if (!before.has(n)) added.push(n);

    if (removed.length > 0) {
      // Removed/renamed exports break consumers → floor higher.
      signals.push({
        name: 'public_api_removed',
        value: removed.length,
        weight: 0,
        tierContribution: 'T3',
        axis: CONSEQUENCE,
        explain: `${removed.length} export(s) removed/renamed at ${file.path}: ${removed.join(', ')}`,
      });
    }
    if (added.length > 0) {
      signals.push({
        name: 'public_api_added',
        value: added.length,
        weight: 0,
        tierContribution: 'T2',
        axis: CONSEQUENCE,
        explain: `${added.length} export(s) added at ${file.path}: ${added.join(', ')}`,
      });
    }
  }

  return signals;
};

// ─── FR-3 Irreversibility ────────────────────────────────────────────────────

const MIGRATION_PATH = /(^|[\\/])migrations?[\\/]/i;

function isMigrationFile(filePath: string): boolean {
  if (MIGRATION_PATH.test(filePath)) return true;
  const e = ext(filePath);
  return e === 'sql' || e === 'prisma';
}

/** Destructive schema operations in SQL/Prisma content. */
const DESTRUCTIVE_SQL = /\b(DROP\s+TABLE|DROP\s+DATABASE|DROP\s+SCHEMA|TRUNCATE\s+TABLE|DROP\s+COLUMN)\b/i;
const ALTER_DROP = /\bALTER\s+TABLE\b[\s\S]*?\bDROP\b/i;

/** A Prisma model block removed between old and new content. */
function removedPrismaModels(oldContent: string, newContent: string): string[] {
  const modelNames = (src: string): Set<string> => {
    const out = new Set<string>();
    const re = /^\s*model\s+([A-Za-z0-9_]+)\s*\{/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.add(m[1]);
    return out;
  };
  const before = modelNames(oldContent);
  const after = modelNames(newContent);
  const removed: string[] = [];
  for (const n of before) if (!after.has(n)) removed.push(n);
  return removed;
}

/**
 * Irreversibility — detect changes that are hard or impossible to undo: file
 * deletions, migration files, and destructive schema ops. Works from diff status
 * + path + content.
 *
 * Degrade (FR-3): when content is absent we fall back to path/status alone (e.g.
 * a touched `migrations/` file or `.sql`), flagged `degraded`.
 */
export const irreversibilityAnalyzer: ConsequenceAnalyzer = (input) => {
  const signals: ClassificationSignal[] = [];

  for (const file of input.changedFiles) {
    // 1. Deletions are inherently irreversible at the file granularity.
    if (file.status === 'deleted') {
      signals.push({
        name: 'irreversible_deletion',
        value: true,
        weight: 0,
        tierContribution: 'T3',
        axis: CONSEQUENCE,
        explain: `file deleted: ${file.path}`,
      });
      // A deleted migration/schema file is still schema-destructive below, but
      // the deletion signal already floors T3; continue to next file.
      continue;
    }

    const migration = isMigrationFile(file.path);
    const content = scannable(file);

    if (migration) {
      if (content === undefined) {
        // Path/status fallback — a migration/schema file changed, no content.
        signals.push({
          name: 'irreversible_migration',
          value: true,
          weight: 0,
          tierContribution: 'T3',
          axis: CONSEQUENCE,
          degraded: true,
          explain: `migration/schema file ${file.path} changed; content unavailable`,
        });
        continue;
      }
      // New migration files are themselves schema events (often irreversible).
      signals.push({
        name: 'irreversible_migration',
        value: true,
        weight: 0,
        tierContribution: 'T3',
        axis: CONSEQUENCE,
        explain:
          file.status === 'added'
            ? `new migration/schema file: ${file.path}`
            : `migration/schema file changed: ${file.path}`,
      });
    }

    // 2. Destructive schema ops anywhere in content (not just migration paths).
    if (content !== undefined) {
      if (DESTRUCTIVE_SQL.test(content) || ALTER_DROP.test(content)) {
        signals.push({
          name: 'destructive_schema_op',
          value: true,
          weight: 0,
          tierContribution: 'T4',
          axis: CONSEQUENCE,
          explain: `destructive schema operation in ${file.path}`,
        });
      }
      // 3. Removed Prisma model/columns (needs a baseline).
      if (ext(file.path) === 'prisma' && file.oldContent !== undefined) {
        const removed = removedPrismaModels(file.oldContent, content);
        if (removed.length > 0) {
          signals.push({
            name: 'destructive_schema_op',
            value: removed.length,
            weight: 0,
            tierContribution: 'T4',
            axis: CONSEQUENCE,
            explain: `Prisma model(s) removed in ${file.path}: ${removed.join(', ')}`,
          });
        }
      }
    }
  }

  return signals;
};

// ─── FR-4 Sensitive-sink reach ───────────────────────────────────────────────

/**
 * Capped sensitive-sink catalog (SPEC-023 C4 / DR-022 R2). Growth requires a
 * deliberate edit here, NOT silent drift. Two kinds of entry:
 *  - path/identifier substrings (case-insensitive) — auth/payment/PII surfaces;
 *  - raw-SQL / credential regexes — direct dangerous patterns in content.
 */
const SENSITIVE_TERMS: readonly string[] = [
  'auth',
  'login',
  'token',
  'secret',
  'password',
  'passwd',
  'payment',
  'charge',
  'stripe',
  'pii',
  'credential',
];

const SENSITIVE_REGEXES: ReadonlyArray<{ name: string; re: RegExp }> = [
  // Raw SQL string interpolation — classic injection sink.
  { name: 'raw-sql', re: /\b(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,200}?(\$\{|"\s*\+|'\s*\+|%s|\?\?)/i },
  // Hard-coded credential-ish assignments.
  { name: 'inline-credential', re: /\b(password|secret|api[_-]?key|token)\b\s*[:=]\s*['"][^'"]{6,}['"]/i },
];

function sensitiveTermHits(haystack: string): string[] {
  const lower = haystack.toLowerCase();
  return SENSITIVE_TERMS.filter((t) => lower.includes(t));
}

/**
 * Sensitive-sink reach — flag changes touching sensitive regions per the capped
 * C4 catalog (path + identifier + raw-SQL/credential regex).
 *
 * Transitive sink reach (does this change *reach* a sink through the call graph?)
 * requires a reference index → NOT available in v1. So v1 degrades to **direct**
 * matches (path/identifier/content in the changed file itself), flagged
 * `degraded` to make the missing transitive analysis honest (INV-4).
 */
export const sensitiveSinkAnalyzer: ConsequenceAnalyzer = (input) => {
  const signals: ClassificationSignal[] = [];

  for (const file of input.changedFiles) {
    const reasons: string[] = [];

    // Path/identifier match on the path itself.
    const pathHits = sensitiveTermHits(file.path);
    if (pathHits.length > 0) reasons.push(`path: ${pathHits.join('/')}`);

    const content = scannable(file);
    if (content !== undefined) {
      // Identifier matches in content.
      const contentHits = sensitiveTermHits(content);
      if (contentHits.length > 0) reasons.push(`identifier: ${contentHits.join('/')}`);
      // Raw-SQL / credential regexes.
      for (const { name, re } of SENSITIVE_REGEXES) {
        if (re.test(content)) reasons.push(`pattern: ${name}`);
      }
    }

    if (reasons.length === 0) continue;

    signals.push({
      name: 'sensitive_sink',
      value: reasons.length,
      weight: 0,
      tierContribution: 'T3',
      axis: CONSEQUENCE,
      // v1 has no reference index → only DIRECT matches; transitive reach is
      // deferred. Mark degraded so "we only checked the changed file" is visible.
      degraded: input.refIndex === null,
      explain:
        `sensitive region touched in ${file.path} (${reasons.join('; ')})` +
        (input.refIndex === null ? ' — direct match only (transitive reach unavailable)' : ''),
    });
  }

  return signals;
};

// ─── FR-5 Concurrency ────────────────────────────────────────────────────────

/**
 * Concurrency primitives, regex over changed JS/TS content. Introducing/
 * modifying concurrency raises the odds of race conditions / ordering bugs that
 * size-only scoring never sees.
 */
const CONCURRENCY_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'Promise.all', re: /\bPromise\s*\.\s*(all|allSettled|race|any)\b/ },
  { name: 'Worker', re: /\bnew\s+Worker\b|\bworker_threads\b/ },
  { name: 'lock/mutex', re: /\b(Mutex|Semaphore|acquireLock|releaseLock|withLock)\b/i },
  { name: 'Atomics', re: /\bAtomics\s*\./ },
  { name: 'SharedArrayBuffer', re: /\bSharedArrayBuffer\b/ },
  { name: 'timer', re: /\b(setInterval|setTimeout|setImmediate|queueMicrotask)\s*\(/ },
  { name: 'transaction', re: /\b(\$transaction|BEGIN\s+TRANSACTION|beginTransaction|\.transaction\s*\()/i },
];

/**
 * Concurrency — detect introduced/modified concurrency primitives via content
 * regex over changed JS/TS files.
 *
 * NO degraded marker (FR-5): there is no size proxy for concurrency, so when
 * content is absent the analyzer emits **nothing** ("absent, not wrong"). A
 * stat-only diff therefore produces no concurrency signal at all.
 */
export const concurrencyAnalyzer: ConsequenceAnalyzer = (input) => {
  const signals: ClassificationSignal[] = [];

  for (const file of input.changedFiles) {
    if (!isCodeFile(file.path)) continue;
    const content = scannable(file);
    if (content === undefined) continue; // stat-only → emit nothing (FR-5)
    if (file.status === 'deleted') continue;

    const hits: string[] = [];
    for (const { name, re } of CONCURRENCY_PATTERNS) {
      if (re.test(content)) hits.push(name);
    }
    if (hits.length === 0) continue;

    signals.push({
      name: 'concurrency',
      value: hits.length,
      weight: 0,
      tierContribution: 'T3',
      axis: CONSEQUENCE,
      explain: `concurrency primitive(s) in ${file.path}: ${hits.join(', ')}`,
    });
  }

  return signals;
};

// ─── Aggregator (FR-1…FR-5) ──────────────────────────────────────────────────

/** All v1 consequence analyzers, in stable order. */
export const CONSEQUENCE_ANALYZERS: readonly ConsequenceAnalyzer[] = [
  impactReachAnalyzer, // FR-1 (degraded in v1)
  publicApiAnalyzer, // FR-2
  irreversibilityAnalyzer, // FR-3
  sensitiveSinkAnalyzer, // FR-4
  concurrencyAnalyzer, // FR-5
];

/**
 * Run every consequence analyzer over the input and concatenate their signals.
 * Pure: the only IO already happened in the command layer that built `input`.
 *
 * The returned signals are fed straight into `classify([...sizeSignals, ...here])`
 * — `classify()` is unchanged and still ranks by max `tierContribution`, so a
 * consequence signal can only ratchet the tier UP (INV-3).
 */
export function runConsequenceAnalyzers(input: ConsequenceInput): ClassificationSignal[] {
  const out: ClassificationSignal[] = [];
  for (const analyzer of CONSEQUENCE_ANALYZERS) {
    out.push(...analyzer(input));
  }
  return out;
}

// Re-export Tier for downstream convenience (type-only; erased at runtime).
export type { Tier };
