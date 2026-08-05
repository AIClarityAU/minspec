#!/usr/bin/env tsx
/**
 * facts.ts — the read-only facts oracle (#1050): `npm run facts -- <command> <arg>`.
 *
 * The recurring failure this closes is not "wrong answer given" — it is "checkable
 * thing asserted without checking", because checking has always cost more than
 * asserting (know that specHash lives in @aiclarity/shared, know the package needs
 * building, hand-write a `node -e` that loads the sidecar and the spec and compares
 * — ~2-4 minutes). This CLI is that computation, already wired: cheaper to run than
 * to guess.
 *
 *   facts hash <spec>      stored vs computed specHash; VALID/STALE/UNAPPROVED, and
 *                          what canonicalization strips (status:/phases: lines).
 *   facts status <spec>    frontmatter `status:` vs deriveStatus() — the #886 drift,
 *                          for one spec file.
 *   facts fields [type]    which frontmatter fields are required/conditional, for an
 *                          optional split-layout `type` (requirements|design|tasks;
 *                          omit for a primary/single-file spec).
 *   facts approval <spec>  sidecar path, approvedBy, approvedAt, validity.
 *   facts owns <path>      which spec(s) declare this file in implements:/affects:.
 *
 * `<spec>` (hash/status/approval) accepts an id (`SPEC-040`), a spec
 * directory slug (`SPEC-040-import-boundaries`), or a file path — resolved
 * via `listSpecs` (#1068, spec-catalog.ts), so you don't need to already know
 * the product dir or which file (requirements.md vs spec.md) is canonical.
 * `owns <path>` stays path-only — it is asking about an owned file, not a spec.
 *
 * STRICTLY READ-ONLY (issue #1050 "Not in scope"): this file must never write,
 * mint, or mutate any spec, sidecar, or config — the moment it can flip a status or
 * mint an approval it becomes a forged-sign-off surface (#517). It only reads what
 * `lib/` already computes.
 *
 * Tier-0: no `vscode`, no network — fs/path/crypto only (transitively, via the
 * imports below). Safe to run in any checkout, offline, with no prior build step.
 *
 * Why this duplicates a few lines instead of importing them: `hash`/`status`/
 * `approval` reuse the REAL oracles (`specHash`/`canonicalizeSpec` from
 * `@aiclarity/shared`'s source, `deriveStatus` from lifecycle.ts, `getApprovalRecord`/
 * `getApprovalStatus`/`resolveStatus`/`sidecarPath` from approval.ts/approval-store.ts)
 * directly — no second implementation to drift. `fields`/`owns` want two small private
 * helpers from `spec-validator.ts` (`fmListField`/`rawFrontmatterField`) and its
 * `CLOSED_SET_FIELDS` schema; exporting those was deferred because, while building this
 * file, the MinSpec PreToolUse spec-gate denied an `export` edit to spec-validator.ts —
 * it is `affects:`-listed by the in-flight, unapproved SPEC-046 (po-only-auto-approve).
 * Follow-up filed to do the export (and delete the local mirrors below) once that
 * lands: see the issue linked in the PR this file ships with. The mirrors are pinned
 * to spec-validator.ts's own docstrings for the raw-read semantics; `fields`'s
 * required/conditional table is pinned to `CLOSED_SET_FIELDS`'s documented rules.
 */

import * as fs from 'fs';
import * as path from 'path';

import { specHash, canonicalizeSpec } from '../packages/shared/src/canonical';
import { parseSpec, stripInlineComment, SPEC_STATUSES, SPEC_TYPES } from '../packages/minspec/src/lib/spec';
import { TIERS, loadConfig, resolveAndValidate } from '../packages/minspec/src/lib/config';
import { deriveStatus, type ExplicitTerminal } from '../packages/minspec/src/lib/lifecycle';
import {
  specRelPath,
  resolveStatus,
  getApprovalRecord,
  getApprovalStatus,
} from '../packages/minspec/src/lib/approval';
import { sidecarPath } from '../packages/minspec/src/lib/approval-store';
import { isValidOwnedPath } from '../packages/minspec/src/lib/ownership-path-rules';
import { listSpecs, type SpecSummary } from '../packages/minspec/src/lib/spec-catalog';

// ─── repo/root plumbing ──────────────────────────────────────────────────────

/** Walk up from `start` looking for `.minspec/config.json` — the repo root marker. */
function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.minspec', 'config.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start); // not found — fall back to start
    dir = parent;
  }
}

const ROOT = findRepoRoot(process.cwd());

function die(msg: string): never {
  console.error(`facts: ${msg}`);
  process.exit(1);
}

/** cwd-relative or absolute → absolute filesystem path. */
function resolveInputPath(arg: string): string {
  return path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
}

function readFileOrDie(p: string): string {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    die(`cannot read file: ${p}`);
  }
}

/** absolute or cwd-relative path → repo-root-relative POSIX path. */
function toRepoRelPosix(p: string): string {
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

// ─── spec-id/slug resolution (#1068) ───────────────────────────────────────
// `hash`/`status`/`approval` accept a `<spec>` arg. Requiring the caller to
// already know the full file path (product dir, slug, requirements.md-vs-
// spec.md) reintroduces the friction #1050 removed: three lookups before the
// "cheap" check can run. Resolve an id (`SPEC-040`) or directory slug
// (`SPEC-040-import-boundaries`) via the same `listSpecs` catalog the rest of
// the extension uses, so the representative file (requirements.md/spec.md
// preference, per spec-catalog.ts's `rankOf`) is picked the same way
// everywhere. `owns` stays path-only (#1068: it is genuinely path-based).

/** True when `arg` reads like a path the user typed, not a bare id/slug. */
function looksLikePath(arg: string): boolean {
  return arg.includes('/') || arg.includes(path.sep) || arg.endsWith('.md') || path.isAbsolute(arg);
}

/** Levenshtein edit distance — used only to power the "did you mean" hint. */
function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** Closest known spec id to `arg` by edit distance, or undefined if nothing is close. */
function closestId(arg: string, ids: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  const upper = arg.toUpperCase();
  for (const id of ids) {
    const d = editDistance(upper, id.toUpperCase());
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  // Cap how far we'll reach so an unrelated arg doesn't produce a misleading guess.
  return best !== undefined && bestDist <= Math.max(3, Math.ceil(upper.length / 3)) ? best : undefined;
}

/**
 * Resolve a `<spec>` CLI arg to an absolute file path: a real path (today's
 * behaviour, unchanged), a frontmatter `id` (`SPEC-040`), or a spec directory
 * slug (`SPEC-040-import-boundaries`) — resolved via `listSpecs` (#1068).
 *
 * On a miss for an id/slug-shaped arg, dies with what was looked for and a
 * "did you mean" hint instead of a filesystem error about a path the user
 * never typed. A path-shaped arg (contains a separator, `.md`, or is
 * absolute) that doesn't exist falls through unchanged — the caller's
 * `readFileOrDie` reports the miss against the path the user actually typed.
 */
function resolveSpecArg(root: string, arg: string): string {
  const asPath = resolveInputPath(arg);
  if (fs.existsSync(asPath) && fs.statSync(asPath).isFile()) {
    return asPath;
  }

  let specs: SpecSummary[];
  try {
    specs = listSpecs(root);
  } catch {
    specs = [];
  }

  const byId = specs.find((s) => s.id.toLowerCase() === arg.toLowerCase());
  if (byId) return byId.filePath;

  const bySlug = specs.filter(
    (s) => path.basename(path.dirname(s.filePath)).toLowerCase() === arg.toLowerCase(),
  );
  if (bySlug.length === 1) return bySlug[0].filePath;
  if (bySlug.length > 1) {
    die(
      `ambiguous spec "${arg}" matches multiple specs: ${bySlug
        .map((s) => `${s.id} (${toRepoRelPosix(s.filePath)})`)
        .join(', ')}`,
    );
  }

  if (looksLikePath(arg)) {
    return asPath; // preserve today's behaviour — readFileOrDie reports the miss
  }

  const suggestion = closestId(arg, specs.map((s) => s.id));
  die(
    `no spec with id "${arg}"${suggestion ? `; did you mean ${suggestion}?` : ''} ` +
      '(looked for a matching id, directory slug, and file path — none found)',
  );
}

// ─── local mirrors of spec-validator.ts's raw-frontmatter readers ───────────
// See the file header: spec-validator.ts is currently gate-blocked for editing.
// Semantics pinned to spec-validator.ts `rawFrontmatterField`/`fmListField`
// (and their Python twin, `scripts/hooks/spec-gate.py` `fm_value`/`fm_list`).

const FRONTMATTER_BLOCK_RE = /^---\n([\s\S]*?)\n---\n?/;

/** The raw frontmatter block text (without the `---` fences), or '' if absent. */
function frontmatterBlock(raw: string): string {
  const m = raw.match(FRONTMATTER_BLOCK_RE);
  return m ? m[1] : '';
}

/** A top-level scalar frontmatter field's raw, comment-stripped value. */
function rawField(raw: string, key: string): string | undefined {
  const block = frontmatterBlock(raw);
  if (!block) return undefined;
  const m = block.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, 'm'));
  if (!m) return undefined;
  const stripped = stripInlineComment(m[1]);
  return stripped === '' ? undefined : stripped;
}

/** A frontmatter list field's raw tokens — inline (`key: [a, b]`/`key: a, b`) or block-list form. */
function listField(raw: string, key: string): string[] {
  const block = frontmatterBlock(raw);
  if (!block) return [];
  const inline = rawField(raw, key);
  if (inline !== undefined) {
    return inline
      .split(/[,\s[\]]+/)
      .filter((t) => t.length > 0)
      .map((t) => t.replace(/^["']+|["']+$/g, ''));
  }
  const lines = block.split('\n');
  const keyLine = new RegExp(`^${key}[ \\t]*:[ \\t]*(?:#.*)?$`);
  const item = /^[ \t]+-[ \t]*(.+?)[ \t]*(?:#.*)?$/;
  const toks: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (keyLine.test(lines[i])) {
      for (const cont of lines.slice(i + 1)) {
        if (/^[ \t]*$/.test(cont)) continue;
        const m = cont.match(item);
        if (!m) break; // de-indented / next key → list ended
        toks.push(m[1].replace(/^["']+|["']+$/g, ''));
      }
      break;
    }
  }
  return toks;
}

/** Normalize a declared owned-path token for matching (mirrors isValidOwnedPath's cleanup). */
function normalizeOwnedToken(token: string): string {
  const t = token.trim().replace(/^["']+|["']+$/g, '').trim();
  let p = t.replace(/\\/g, '/');
  if (p.startsWith('./')) p = p.slice(2);
  return p;
}

/** Recursively collect every `.md` file under `dir` (specsDir walk). */
function walkMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMarkdownFiles(full));
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// ─── facts hash <spec> ────────────────────────────────────────────────────────

function cmdHash(specArg: string | undefined): void {
  if (!specArg) die('usage: facts hash <spec>');
  const specPath = resolveSpecArg(ROOT, specArg);
  const raw = readFileOrDie(specPath);
  const computed = specHash(raw);
  const rel = specRelPath(ROOT, specPath);
  const record = getApprovalRecord(ROOT, specPath);
  const verdict = resolveStatus(record, computed);

  const canon = canonicalizeSpec(raw);
  const rawFmLines = frontmatterBlock(raw).split('\n');
  const canonFmSet = new Set(frontmatterBlock(canon).split('\n'));
  const stripped = rawFmLines.filter((l) => l.length > 0 && !canonFmSet.has(l));

  console.log(`spec:      ${rel}`);
  console.log(`stored:    ${record ? record.specHash : '(none — no approval sidecar)'}`);
  console.log(`computed:  ${computed}`);
  console.log(`verdict:   ${verdict.toUpperCase()}`);
  console.log('canonicalization strips (raw frontmatter lines absent from the canonical form):');
  if (stripped.length === 0) {
    console.log('  (none — no status:/phases: block present)');
  } else {
    for (const line of stripped) console.log(`  ${line}`);
  }
}

// ─── facts status <spec> ──────────────────────────────────────────────────────

function cmdStatus(specArg: string | undefined): void {
  if (!specArg) die('usage: facts status <spec>');
  const specPath = resolveSpecArg(ROOT, specArg);
  const raw = readFileOrDie(specPath);
  const parsed = parseSpec(raw);
  const fm = parsed.frontmatter;
  const rel = specRelPath(ROOT, specPath);

  const approvalState = getApprovalStatus(ROOT, specPath);
  const explicitTerminal: ExplicitTerminal =
    fm.status === 'archived' ? 'archived' : fm.status === 'superseded' ? 'superseded' : undefined;
  const derived = deriveStatus(fm.phases, approvalState, explicitTerminal);

  console.log(`spec:                ${rel}${fm.id ? ` (id: ${fm.id})` : ''}`);
  console.log(`frontmatter status:  ${fm.status}`);
  console.log(`derived status:      ${derived}`);
  console.log(`approval state:      ${approvalState}`);
  console.log(`verdict:             ${fm.status === derived ? 'MATCH' : 'DRIFT'}`);
}

// ─── facts fields [type] ──────────────────────────────────────────────────────

/**
 * Mirrors spec-validator.ts `CLOSED_SET_FIELDS` — the required/conditional rules
 * are pinned to that array's own documentation (see the file header for why this
 * is a local table rather than an import). `evaluate` reproduces each field's
 * `requiredWhen`/`requiredWhenStatus` predicate.
 */
interface FieldFact {
  readonly key: string;
  readonly validValues?: readonly string[];
  readonly reference?: boolean;
  /** Human-readable required-ness for a given split-layout `type` ('' = primary). */
  readonly evaluate: (specType: string) => string;
}

const isPrimarySpec = (specType: string): boolean => specType === '' || specType === 'requirements';

const FIELD_FACTS: readonly FieldFact[] = [
  { key: 'id', evaluate: () => 'required' },
  { key: 'status', validValues: SPEC_STATUSES, evaluate: () => 'required' },
  {
    key: 'tier',
    validValues: TIERS,
    evaluate: (specType) =>
      isPrimarySpec(specType)
        ? 'required (primary/requirements spec)'
        : 'not required (secondary split-layout file)',
  },
  { key: 'type', validValues: SPEC_TYPES, evaluate: () => 'not required (single-file specs omit it)' },
  {
    key: 'superseded-by',
    reference: true,
    evaluate: () => 'conditional — required only when status: superseded',
  },
];

function cmdFields(typeArg: string | undefined): void {
  const specType = (typeArg ?? '').toLowerCase();
  console.log(`frontmatter fields for type: ${typeArg ?? '(primary/single-file)'}`);
  for (const field of FIELD_FACTS) {
    console.log(`  ${field.key}`);
    console.log(`    required:  ${field.evaluate(specType)}`);
    if (field.validValues) console.log(`    valid:     ${field.validValues.join(' | ')}`);
    if (field.reference) console.log('    reference: must resolve to a known artifact when present');
  }
}

// ─── facts approval <spec> ────────────────────────────────────────────────────

function cmdApproval(specArg: string | undefined): void {
  if (!specArg) die('usage: facts approval <spec>');
  const specPath = resolveSpecArg(ROOT, specArg);
  const rel = specRelPath(ROOT, specPath);
  const sc = sidecarPath(ROOT, rel);
  const record = getApprovalRecord(ROOT, specPath);
  const raw = readFileOrDie(specPath);
  const verdict = resolveStatus(record, specHash(raw));

  console.log(`spec:        ${rel}`);
  console.log(`sidecar:     ${sc}${fs.existsSync(sc) ? '' : ' (MISSING)'}`);
  if (!record) {
    console.log('approvedBy:  (none — unapproved)');
    console.log('approvedAt:  (none)');
  } else {
    console.log(`approvedBy:  ${record.approvedBy}`);
    console.log(`approvedAt:  ${record.approvedAt}`);
    console.log(`tier:        ${record.tier}`);
    console.log(`migrated:    ${record.migrated}`);
  }
  console.log(`validity:    ${verdict.toUpperCase()}`);
}

// ─── facts owns <path> ─────────────────────────────────────────────────────────

function cmdOwns(pathArg: string | undefined): void {
  if (!pathArg) die('usage: facts owns <repo-path>');
  const targetRel = toRepoRelPosix(pathArg).toLowerCase();
  let specsDir: string;
  try {
    specsDir = resolveAndValidate(ROOT, loadConfig(ROOT).specsDir);
  } catch {
    specsDir = path.join(ROOT, 'specs'); // config unreadable/invalid — fall back to the default
  }

  const owners: { id: string; file: string; via: string }[] = [];
  for (const file of walkMarkdownFiles(specsDir)) {
    const raw = readFileOrDie(file);
    const id = rawField(raw, 'id') ?? path.relative(ROOT, file);
    for (const via of ['implements', 'affects'] as const) {
      const declared = listField(raw, via).filter(isValidOwnedPath);
      const hit = declared.some((tok) => normalizeOwnedToken(tok).toLowerCase() === targetRel);
      if (hit) owners.push({ id, file: path.relative(ROOT, file).split(path.sep).join('/'), via });
    }
  }

  console.log(`path: ${targetRel}`);
  if (owners.length === 0) {
    console.log('owner(s): none — no spec declares this path in implements:/affects:');
    return;
  }
  console.log('owner(s):');
  for (const o of owners) console.log(`  ${o.id} (${o.file}) — via ${o.via}:`);
}

// ─── dispatch ──────────────────────────────────────────────────────────────────

function usage(): void {
  console.error(
    [
      'usage: facts <command> <arg>',
      '',
      '  facts hash <spec>      stored vs computed specHash; VALID/STALE/UNAPPROVED,',
      '                         and what canonicalization strips.',
      '  facts status <spec>    frontmatter status: vs deriveStatus().',
      '  facts fields [type]    which frontmatter fields are required/conditional.',
      '  facts approval <spec>  sidecar path, approvedBy, approvedAt, validity.',
      '  facts owns <path>      which spec(s) declare this file in implements:/affects:.',
      '',
      '  <spec> (hash/status/approval) accepts an id (SPEC-040), a spec directory',
      '  slug (SPEC-040-import-boundaries), or a file path.',
      '  <path> (owns) is always a file path.',
      '',
      'Read-only. Never writes a file.',
    ].join('\n'),
  );
}

function main(): void {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'hash':
      cmdHash(arg);
      break;
    case 'status':
      cmdStatus(arg);
      break;
    case 'fields':
      cmdFields(arg);
      break;
    case 'approval':
      cmdApproval(arg);
      break;
    case 'owns':
      cmdOwns(arg);
      break;
    default:
      usage();
      process.exit(1);
  }
}

main();
