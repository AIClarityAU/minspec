import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { loadConfig, resolveAndValidate } from './config';
import { listAdrs } from './adr-manager';
import { parseSpec } from './spec';
import { slugify } from './spec-manager';
import {
  listEpics,
  createEpic,
  writeEpicIndex,
  setArtifactEpic,
  readArtifactEpic,
} from './epic-manager';
import type { EpicSummary } from './epic-manager';

const execFileAsync = promisify(execFile);

/**
 * Epic backfill (DR-016). Two engines producing one proposal shape:
 *   - heuristic (Tier 0, pure file-system) — always available
 *   - AI (Tier 1, `claude -p`) — opt-in, degrades to heuristic when absent
 *
 * Nothing here writes frontmatter until `applyBackfill` is called with an
 * approved proposal (HITL — DR-012 ethos). No `http`/`fetch`; the only network
 * touch is the locally-installed `claude` binary owning its own connection.
 */

// ─── Contract ─────────────────────────────────────────────────────────────────

export type ArtifactKind = 'spec' | 'adr';

/** A single artifact gathered for proposal input. */
export interface ArtifactRef {
  readonly id: string;          // SPEC-NNN / DR-NNN
  readonly kind: ArtifactKind;
  readonly title: string;
  readonly filePath: string;
  /** Existing epic ref, if already assigned. */
  readonly epic?: string;
  /** Parent directory basename (spec feature folder) — a heuristic signal. */
  readonly group?: string;
  /** First non-empty prose paragraph (for the AI digest). */
  readonly digest?: string;
}

export interface ProposedEpic {
  /** Present when mapping onto an already-registered epic; absent = new. */
  readonly id?: string;
  readonly slug: string;
  readonly title: string;
  readonly rationale: string;
}

export interface ProposedMapping {
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  readonly filePath: string;
  readonly epicSlug: string;
  /** 0..1 — heuristic similarity, or AI-reported confidence. */
  readonly confidence: number;
  readonly rationale: string;
}

export interface BackfillProposal {
  readonly epics: ProposedEpic[];
  readonly mappings: ProposedMapping[];
  readonly source: 'heuristic' | 'ai';
}

export interface ApplyResult {
  readonly epicsCreated: number;
  readonly artifactsTagged: number;
  readonly skipped: number;
}

// ─── Tier-1 budget + failure reporting ────────────────────────────────────────

/**
 * Why the AI pass produced no proposal. FR-4 makes every one of these a graceful
 * degrade to the heuristic — but they are NOT the same event, and collapsing them
 * into a bare `null` is what let a working `claude` be reported as "unavailable"
 * for as long as this command has shipped (#1570).
 */
export type AiFailureReason =
  | 'nothing-to-assign'
  | 'claude-absent'
  | 'timeout'
  | 'cancelled'
  | 'exit'
  | 'non-json'
  | 'unusable';

export interface AiFailure {
  readonly reason: AiFailureReason;
  /** One human-facing clause, e.g. "timed out after 10m". */
  readonly detail: string;
}

/** `proposal` is null exactly when `failure` is set. */
export interface AiResult {
  readonly proposal: BackfillProposal | null;
  readonly failure?: AiFailure;
}

/** Floor — a tiny corpus still gets a usable budget (the historic constant). */
export const AI_TIMEOUT_FLOOR_MS = 120_000;
/** Ceiling — a human is watching a progress toast; do not hang forever. */
export const AI_TIMEOUT_CEILING_MS = 900_000;
const AI_TIMEOUT_BASE_MS = 90_000;
const AI_TIMEOUT_PER_ARTIFACT_MS = 3_000;

/**
 * Budget for one `claude -p` pass, scaled to the size of the ask.
 *
 * The old flat 120s was sized for a small project and never revisited. The
 * prompt emits one line per artifact and asks for one mapping in reply, so the
 * work scales with the corpus while the budget did not — the pass then failed on
 * exactly the projects large enough to need it. MEASURED on this repo: a
 * 179-artifact / 76,937-char prompt returned valid JSON in 313s (exit 0) after
 * being SIGTERM'd at 120s on every previous run (#1570). ~3s per artifact over a
 * 90s base leaves roughly 2x headroom over that measurement.
 */
export function aiTimeoutMs(artifactCount: number): number {
  const scaled = AI_TIMEOUT_BASE_MS + Math.max(0, artifactCount) * AI_TIMEOUT_PER_ARTIFACT_MS;
  return Math.min(AI_TIMEOUT_CEILING_MS, Math.max(AI_TIMEOUT_FLOOR_MS, scaled));
}

/** Human-readable duration for a failure detail ("2m 30s"). */
function humanMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`;
}

// ─── Tier-1 availability ──────────────────────────────────────────────────────

/** True when the local `claude` binary is callable (mirrors isGhAvailable). */
export async function isClaudeAvailable(): Promise<boolean> {
  try {
    await execFileAsync('claude', ['--version'], { timeout: 5000, env: { ...process.env } });
    return true;
  } catch {
    return false;
  }
}

// ─── Artifact collection (vscode-free) ────────────────────────────────────────

const STOP = new Set(['the', 'a', 'an', 'for', 'to', 'of', 'and', 'or', 'use', 'with', 'in', 'on', 'minspec', 'spec', 'epic']);

function titleTokens(title: string): Set<string> {
  return new Set(slugify(title).split('-').filter(t => t.length > 0 && !STOP.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** First non-empty paragraph after frontmatter + H1, capped. */
function firstParagraph(body: string, cap = 280): string {
  const afterFm = body.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const lines = afterFm.split('\n');
  const para: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#') || t.startsWith('<!--') || t === '') {
      if (para.length > 0) break;
      continue;
    }
    para.push(t);
    if (para.join(' ').length >= cap) break;
  }
  return para.join(' ').slice(0, cap);
}

/** Recursively collect SPEC-*.md artifacts under specsDir (any nesting). */
function collectSpecs(rootDir: string): ArtifactRef[] {
  const config = loadConfig(rootDir);
  let specsDir: string;
  try {
    specsDir = resolveAndValidate(rootDir, config.specsDir);
  } catch {
    return [];
  }
  if (!fs.existsSync(specsDir)) return [];

  const out: ArtifactRef[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        let content: string;
        try {
          content = fs.readFileSync(full, 'utf-8');
        } catch {
          continue;
        }
        let fm;
        try {
          fm = parseSpec(content).frontmatter;
        } catch {
          continue;
        }
        if (!fm.id || !/^SPEC-/.test(fm.id)) continue;
        // Folder name is an epic signal ONLY when it's a feature folder — not the
        // product container itself (e.g. specs/minspec/ holds the core specs but
        // "minspec" is the product, not an epic). Skip when folder == product.
        const folder = path.basename(path.dirname(full));
        const product = (content.match(/^---\n[\s\S]*?\n---/)?.[0].match(/^product\s*:\s*(.+)$/m)?.[1] ?? '').trim();
        // A folder NAMED AFTER the spec it holds (specs/minspec/SPEC-019-execution-
        // substrate/requirements.md) is that spec's own directory, not a feature
        // grouping. Seeding an epic from it produces one epic per spec — the exact
        // opposite of grouping a body of work, and how a single run proposed 54
        // per-spec epics (#1571).
        const isOwnSpecDir = slugify(folder).startsWith(slugify(fm.id));
        const isProductRoot = Boolean(product) && slugify(folder) === slugify(product);
        const group = isProductRoot || isOwnSpecDir ? undefined : folder;
        out.push({
          id: fm.id,
          kind: 'spec',
          title: fm.title || fm.id,
          filePath: full,
          epic: fm.epic,
          group,
          digest: firstParagraph(content),
        });
      }
    }
  };
  walk(specsDir);
  return out;
}

function collectAdrs(rootDir: string): ArtifactRef[] {
  return listAdrs(rootDir).map(a => {
    let digest = '';
    try {
      digest = firstParagraph(fs.readFileSync(a.filePath, 'utf-8'));
    } catch {
      // best-effort
    }
    return {
      id: a.id,
      kind: 'adr' as const,
      title: a.title,
      filePath: a.filePath,
      epic: a.epic,
      digest,
    };
  });
}

/** All specs + ADRs in the project, for proposal input. */
export function collectArtifacts(rootDir: string): ArtifactRef[] {
  return [...collectSpecs(rootDir), ...collectAdrs(rootDir)];
}

// ─── Heuristic engine (Tier 0) ────────────────────────────────────────────────

const SUBDIR_CONFIDENCE = 0.9;
// Matches ADR_SIMILARITY_THRESHOLD (adr-manager) — the gate only proposes; a
// weak match costs one unchecked review row, a missed match costs a manual tag.
const TOKEN_THRESHOLD = 0.3;

function titleCase(slug: string): string {
  return slug.split(/[-_]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Cluster artifacts into candidate epics from repo signals (pure, Tier 0):
 *  1. existing registered epics are kept as anchors,
 *  2. spec feature-subdir names seed strong candidate epics,
 *  3. remaining artifacts attach to the best candidate by title-token overlap
 *     (Jaccard ≥ threshold); below threshold → left unmapped (no forced guess).
 */
export function proposeHeuristic(rootDir: string): BackfillProposal {
  const artifacts = collectArtifacts(rootDir);
  const registered = listEpics(rootDir);

  // Candidate epics keyed by slug. Seed from the registry.
  const epicsBySlug = new Map<string, ProposedEpic>();
  const tokensBySlug = new Map<string, Set<string>>();
  for (const e of registered) {
    epicsBySlug.set(e.slug, { id: e.id, slug: e.slug, title: e.title, rationale: 'Existing registered epic.' });
    tokensBySlug.set(e.slug, titleTokens(e.title));
  }

  // Seed candidates from spec feature-subdir names.
  for (const a of artifacts) {
    if (a.kind !== 'spec' || !a.group) continue;
    const slug = slugify(a.group);
    if (!slug || epicsBySlug.has(slug)) continue;
    epicsBySlug.set(slug, { slug, title: titleCase(a.group), rationale: `Spec feature folder "${a.group}".` });
    tokensBySlug.set(slug, titleTokens(titleCase(a.group)));
  }

  const mappings: ProposedMapping[] = [];
  for (const a of artifacts) {
    // Subdir-based: a spec in a feature folder maps to that folder's epic.
    if (a.kind === 'spec' && a.group) {
      const slug = slugify(a.group);
      if (epicsBySlug.has(slug)) {
        mappings.push({
          artifactId: a.id, kind: a.kind, filePath: a.filePath, epicSlug: slug,
          confidence: SUBDIR_CONFIDENCE, rationale: `In feature folder "${a.group}".`,
        });
        continue;
      }
    }
    // Token-overlap: best candidate epic by title similarity.
    const aTokens = titleTokens(a.title);
    let best: { slug: string; score: number } | null = null;
    for (const [slug, eTokens] of tokensBySlug) {
      const score = jaccard(aTokens, eTokens);
      if (!best || score > best.score) best = { slug, score };
    }
    if (best && best.score >= TOKEN_THRESHOLD) {
      mappings.push({
        artifactId: a.id, kind: a.kind, filePath: a.filePath, epicSlug: best.slug,
        confidence: Number(best.score.toFixed(2)),
        rationale: `Title overlaps epic "${epicsBySlug.get(best.slug)!.title}".`,
      });
    }
    // else: unmapped — heuristic declines to guess.
  }

  // Drop candidate epics that ended up with no mapping (keep registered anchors).
  const used = new Set(mappings.map(m => m.epicSlug));
  const epics = [...epicsBySlug.values()].filter(e => used.has(e.slug) || e.id);
  return { epics, mappings, source: 'heuristic' };
}

// ─── AI engine (Tier 1) ───────────────────────────────────────────────────────

/**
 * Artifacts a backfill can actually change: the ones with no `epic:` yet.
 *
 * `applyBackfill` skips an already-tagged artifact by default (FR-6), so a
 * mapping for one is discarded the moment it is applied. Asking the AI to
 * produce those mappings anyway spent the whole budget generating output that
 * was contractually guaranteed to be thrown away (#1570), and made the review
 * surface quote a tag count that could never happen (#1571).
 */
export function pendingArtifacts(artifacts: ArtifactRef[]): ArtifactRef[] {
  return artifacts.filter(a => !a.epic);
}

/** How much work a backfill actually has, so the command can say which. */
export interface BackfillScope {
  readonly total: number;
  /** Artifacts with no `epic:` — the only ones apply can write. */
  readonly pending: number;
}

/**
 * Answers "is there anything to backfill?" before any consent prompt or AI call.
 *
 * Deliberately NOT `hasUnbackfilledEpics` (auto-bootstrap): that carries an
 * offer threshold of 3 untagged artifacts — the right bar for interrupting
 * someone unprompted, the wrong bar for a command they just invoked, where one
 * untagged artifact is still work worth doing.
 */
export function backfillScope(rootDir: string): BackfillScope {
  const artifacts = collectArtifacts(rootDir);
  return { total: artifacts.length, pending: pendingArtifacts(artifacts).length };
}

/**
 * The ask covers `pending` only; already-assigned artifacts appear as taxonomy
 * context (id + title + epic, no digest) so the model reuses the established
 * epics instead of inventing a parallel set.
 */
function buildPrompt(
  pending: ArtifactRef[],
  assigned: ArtifactRef[],
  registered: EpicSummary[],
): string {
  const digest = pending.map(a =>
    `- ${a.id} [${a.kind}] "${a.title}"${a.digest ? ` — ${a.digest}` : ''}`,
  ).join('\n');
  const existing = registered.length
    ? registered.map(e => `- ${e.id} slug=${e.slug} "${e.title}"`).join('\n')
    : '(none)';
  const context = assigned.length
    ? assigned.map(a => `- ${a.id} [${a.kind}] "${a.title}" → ${a.epic}`).join('\n')
    : '(none)';
  return [
    'You are organizing a software project\'s specs and architecture decisions (ADRs) into "epics" — coherent bodies of work.',
    '',
    'EXISTING EPICS (reuse these slugs where an artifact fits):',
    existing,
    '',
    'ALREADY ASSIGNED (context only — do NOT map these; they show the taxonomy in use):',
    context,
    '',
    'ARTIFACTS TO ASSIGN (map only these):',
    digest,
    '',
    'Reuse an existing epic wherever an artifact fits one; propose a new epic only when nothing fits (prefer 3–8 epics total across the project). Map each artifact listed under ARTIFACTS TO ASSIGN to exactly one epic where confident. Leave an artifact unmapped rather than force a poor fit.',
    '',
    'Output ONLY a JSON object, no prose, no markdown fences, matching exactly:',
    '{"epics":[{"slug":"kebab-case","title":"Title Case","rationale":"why"}],"mappings":[{"artifactId":"SPEC-001","epicSlug":"kebab-case","confidence":0.0,"rationale":"why"}]}',
  ].join('\n');
}

/** Extract the first balanced top-level JSON object from arbitrary stdout. */
function extractJson(stdout: string): string | null {
  const start = stdout.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < stdout.length; i++) {
    const c = stdout[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return stdout.slice(start, i + 1); }
  }
  return null;
}

/**
 * Validate + normalize a parsed AI object into a BackfillProposal. Drops
 * mappings whose artifactId is unknown or epicSlug has no epic. Returns null on
 * structural failure so the caller falls back to the heuristic.
 *
 * `registered` lets a mapping name an epic that ALREADY exists without the model
 * having to re-declare it under `epics[]`. The prompt asks it to reuse existing
 * slugs, so on an organized project the correct answer is mappings onto epics it
 * never declares — which this used to reject wholesale, reporting "no usable
 * epics" for a perfectly good reply (found verifying #1570 against this repo).
 */
export function normalizeAiProposal(
  parsed: unknown,
  artifacts: ArtifactRef[],
  registered: EpicSummary[] = [],
): BackfillProposal | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.epics) || !Array.isArray(obj.mappings)) return null;

  const byId = new Map(artifacts.map(a => [a.id, a]));
  const epics: ProposedEpic[] = [];
  const slugs = new Set<string>();
  for (const e of obj.epics) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const slug = typeof r.slug === 'string' ? slugify(r.slug) : '';
    const title = typeof r.title === 'string' ? r.title : titleCase(slug);
    if (!slug || slugs.has(slug)) continue;
    slugs.add(slug);
    epics.push({ slug, title, rationale: typeof r.rationale === 'string' ? r.rationale : '' });
  }

  // Registered epics are addressable by slug even when undeclared: reusing one
  // is the outcome the prompt asks for, so it must not read as a bad reply.
  const registeredBySlug = new Map(registered.map(e => [e.slug, e]));

  const mappings: ProposedMapping[] = [];
  for (const m of obj.mappings) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const artifactId = typeof r.artifactId === 'string' ? r.artifactId : '';
    const epicSlug = typeof r.epicSlug === 'string' ? slugify(r.epicSlug) : '';
    const art = byId.get(artifactId);
    if (!art) continue; // unknown artifact → drop
    if (!slugs.has(epicSlug)) {
      const known = registeredBySlug.get(epicSlug);
      if (!known) continue; // epic neither declared nor registered → drop
      slugs.add(epicSlug);
      epics.push({
        id: known.id,
        slug: known.slug,
        title: known.title,
        rationale: 'Existing registered epic.',
      });
    }
    const confRaw = typeof r.confidence === 'number' ? r.confidence : 0.5;
    mappings.push({
      artifactId, kind: art.kind, filePath: art.filePath, epicSlug,
      confidence: Math.max(0, Math.min(1, confRaw)),
      rationale: typeof r.rationale === 'string' ? r.rationale : '',
    });
  }

  if (epics.length === 0) return null;
  // Drop epics no mapping references.
  const used = new Set(mappings.map(m => m.epicSlug));
  return { epics: epics.filter(e => used.has(e.slug)), mappings, source: 'ai' };
}

/**
 * Run the Tier-1 AI proposal via `claude -p`. Returns null on ANY failure
 * (binary absent, timeout, non-JSON, empty) — caller falls back to heuristic.
 * Never throws.
 *
 * Probes `isClaudeAvailable()` before dispatch, mirroring the `isGhAvailable`
 * gate on the gh path (SPEC-011 FR-3 / Risk R1 / Failure-Mode 1). The probe is
 * the asserted precondition-check mechanism; the surrounding try/catch remains
 * the backstop for failures after a successful probe (timeout, non-JSON). (#141)
 */
export async function proposeAI(
  rootDir: string,
  opts: { signal?: AbortSignal } = {},
): Promise<AiResult> {
  const artifacts = collectArtifacts(rootDir);
  const pending = pendingArtifacts(artifacts);
  if (pending.length === 0) {
    return {
      proposal: null,
      failure: {
        reason: 'nothing-to-assign',
        detail: artifacts.length === 0
          ? 'found no specs or decisions to organize'
          : 'found nothing to assign — every spec and decision already carries an epic',
      },
    };
  }
  if (!(await isClaudeAvailable())) {
    return { proposal: null, failure: { reason: 'claude-absent', detail: 'could not run `claude` (Claude Code is not on PATH)' } };
  }

  const assigned = artifacts.filter(a => a.epic);
  const prompt = buildPrompt(pending, assigned, listEpics(rootDir));
  const timeout = aiTimeoutMs(pending.length);
  try {
    const { stdout } = await execFileAsync('claude', ['-p', prompt], {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env },
      signal: opts.signal,
    });
    const json = extractJson(stdout);
    if (!json) {
      return { proposal: null, failure: { reason: 'non-json', detail: 'returned output that was not JSON' } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { proposal: null, failure: { reason: 'non-json', detail: 'returned malformed JSON' } };
    }
    // Only `pending` may be mapped — a mapping onto an already-tagged artifact
    // is discarded at apply, so accepting one would re-inflate the same lie.
    const proposal = normalizeAiProposal(parsed, pending, listEpics(rootDir));
    if (!proposal) {
      return { proposal: null, failure: { reason: 'unusable', detail: 'returned JSON with no usable epics' } };
    }
    return { proposal };
  } catch (err) {
    return { proposal: null, failure: classifyExecFailure(err, timeout) };
  }
}

/**
 * Name the failure mode from execFile's error. The distinction that matters: a
 * child we KILLED (timeout/cancel) is a defect or a user act, not the absent
 * binary the old single message blamed (#1570).
 */
function classifyExecFailure(err: unknown, timeout: number): AiFailure {
  const e = (err ?? {}) as { killed?: boolean; signal?: string; code?: unknown; name?: string };
  if (e.name === 'AbortError' || e.code === 'ABORT_ERR') {
    return { reason: 'cancelled', detail: 'was cancelled' };
  }
  if (e.killed === true || e.signal === 'SIGTERM') {
    return { reason: 'timeout', detail: `timed out after ${humanMs(timeout)}` };
  }
  if (e.code === 'ENOENT') {
    return { reason: 'claude-absent', detail: 'could not run `claude` (Claude Code is not on PATH)' };
  }
  if (typeof e.code === 'number') {
    return { reason: 'exit', detail: `exited with code ${e.code}` };
  }
  return { reason: 'exit', detail: 'failed to run' };
}

/**
 * Strip everything the apply step would silently discard, so the counts a human
 * approves are the counts that actually happen.
 *
 * A mapping onto an artifact that already carries `epic:` is skipped by
 * `applyBackfill` (FR-6), and an epic left with no surviving mapping is a body
 * of work nothing belongs to. Leaving both in the proposal is how one run asked
 * to "tag 97 artifact(s)", tagged none, and wrote 54 empty epic files (#1571).
 */
export function withoutAlreadyTagged(
  proposal: BackfillProposal,
  opts: { override?: boolean } = {},
): BackfillProposal {
  const mappings = opts.override
    ? [...proposal.mappings]
    : proposal.mappings.filter(m => !readArtifactEpic(m.filePath));
  const used = new Set(mappings.map(m => m.epicSlug));
  return { epics: proposal.epics.filter(e => used.has(e.slug)), mappings, source: proposal.source };
}

// ─── Apply (HITL — only after approval) ───────────────────────────────────────

/**
 * Apply an approved proposal: create new epics, tag mapped artifacts, regenerate
 * the INDEX. Idempotent. An artifact already carrying an `epic:` is skipped
 * unless `override`. Pure file-system.
 */
export function applyBackfill(
  rootDir: string,
  proposal: BackfillProposal,
  opts: { override?: boolean } = {},
): ApplyResult {
  // Map proposed epic slugs → concrete ref (existing id, or freshly created),
  // plus slug → title so each tagged artifact gets a human-facing comment.
  const refBySlug = new Map<string, string>();
  const titleBySlug = new Map<string, string>();
  let epicsCreated = 0;
  const registered = new Map(listEpics(rootDir).map(e => [e.slug, e]));

  // Decide which mappings will actually write BEFORE creating anything. Epic
  // creation used to run first, so an epic whose every mapping was about to be
  // skipped was still written to disk and into the INDEX — 54 empty epics in one
  // run (#1571). An epic nothing joins is not a body of work; do not create it.
  const proposedSlugs = new Set(proposal.epics.map(e => e.slug));
  const effective = proposal.mappings.filter(
    m => proposedSlugs.has(m.epicSlug) && (opts.override || !readArtifactEpic(m.filePath)),
  );
  const willReceive = new Set(effective.map(m => m.epicSlug));

  for (const e of proposal.epics) {
    const existing = e.id ? e.id : registered.get(e.slug)?.id;
    // Prefer the registry's canonical title for existing epics; else the proposal's.
    titleBySlug.set(e.slug, registered.get(e.slug)?.title ?? e.title);
    if (existing) {
      refBySlug.set(e.slug, existing);
    } else {
      if (!willReceive.has(e.slug)) continue; // the gate: no members, no epic
      // Thread the proposal's rationale into the new epic's `## Goal` so a
      // backfilled epic is born complete, not as a bare skeleton (#79).
      const created = createEpic(rootDir, e.title, e.slug, undefined, e.rationale);
      refBySlug.set(e.slug, created.id);
      epicsCreated++;
    }
  }

  let artifactsTagged = 0;
  let skipped = 0;
  for (const m of proposal.mappings) {
    const ref = refBySlug.get(m.epicSlug);
    if (!ref) { skipped++; continue; }
    if (!opts.override && readArtifactEpic(m.filePath)) { skipped++; continue; }
    try {
      setArtifactEpic(m.filePath, ref, titleBySlug.get(m.epicSlug));
      artifactsTagged++;
    } catch {
      skipped++;
    }
  }

  writeEpicIndex(rootDir);
  return { epicsCreated, artifactsTagged, skipped };
}

// ─── Review rendering ─────────────────────────────────────────────────────────

/** Human-readable markdown for the HITL review surface. */
export function renderProposalMarkdown(proposal: BackfillProposal): string {
  const lines: string[] = [
    `# Epic Backfill Proposal (${proposal.source})`,
    '',
    `Proposes **${proposal.epics.length} epic(s)** and **${proposal.mappings.length} mapping(s)**.`,
    'Review below. Nothing is written until you approve.',
    '',
    '## Epics',
    '',
  ];
  for (const e of proposal.epics) {
    lines.push(`- **${e.title}** \`${e.slug}\`${e.id ? ` (existing ${e.id})` : ' (new)'} — ${e.rationale}`);
  }
  lines.push('', '## Mappings', '');
  const bySlug = new Map<string, ProposedMapping[]>();
  for (const m of proposal.mappings) {
    (bySlug.get(m.epicSlug) ?? bySlug.set(m.epicSlug, []).get(m.epicSlug)!).push(m);
  }
  for (const [slug, ms] of bySlug) {
    lines.push(`### ${slug}`, '');
    for (const m of ms) {
      lines.push(`- ${m.artifactId} \`${path.basename(m.filePath)}\` (${(m.confidence * 100).toFixed(0)}%) — ${m.rationale}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
