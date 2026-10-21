/**
 * Approval-only pull request judge (founder decision in36, 2026-10-21; DR-111).
 *
 * The founder approves a spec or accepts a decision record in the editor (Alt-A). The
 * editor opens a pull request under his account that carries that approval and nothing
 * else. Waiting for his merge keystroke on such a PR asks him to approve the same thing
 * twice. His answer, verbatim: "let PRs that only land his own Alt-A (an approval or
 * acceptance he made in the editor) merge themselves once a check proves they carry only
 * that approval."
 *
 * This module is the check. It is PURE apart from the `git` reader it is handed, and it
 * FAILS CLOSED: every guard that cannot establish its fact returns `needs-founder`, and
 * the only path to `eligible` is every guard passing. The caller (`scripts/alta-self-merge.ts`)
 * still requires every required status check to be green, and binds the merge to the
 * head SHA judged here, so a later push can never ride along.
 *
 * A PR is eligible only when ALL of these hold:
 *   - it is open, not a draft, targets the default branch, and comes from this repo
 *     (no fork);
 *   - its author is the founder, every non-merge commit on it is attributed by GitHub
 *     to the founder, and no merge commit touches a file the PR changes;
 *   - it carries `ai-review:pass`, and no `ai-review:changes`, `ai-review:blocked` or
 *     `hold:*` label;
 *   - the base tip is an ancestor of the head (so the squash lands exactly the diff
 *     judged here), and the head the API reported is present in the fetched objects;
 *   - the base..head diff is non-empty, every entry is an add or modify of a regular
 *     file (mode 100644), with no rename, delete, symlink or submodule;
 *   - at least one entry is an approval record `.minspec/approvals/<path>.json` whose
 *     `<path>` is an approvable artifact (`classifyApprovablePath`) under `specs/`,
 *     `docs/decisions/` or `docs/epics/`;
 *   - each record parses through the repo's own sidecar reader (`readRecord`), carries
 *     no key outside the known record shape, names its own path as `specPath`, is not
 *     `migrated`, is attributed to a founder email, and its `specHash` equals
 *     `specHash()` of the artifact as it stands on the head;
 *   - every other entry is the artifact of one of those records, already present on the
 *     base (an approval PR never adds an artifact), and differs from the base ONLY in
 *     the frontmatter `status:` line and `phases:` block: with those removed the two
 *     files are byte-identical (which implies `specHash()` agrees on base and head).
 *
 * Anything else, including a decision record acceptance that also edits the record's
 * own Status section or `docs/decisions/INDEX.md`, is the founder's to merge.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { specHash } from '../../packages/shared/src/canonical';
import { readRecord } from '../../packages/minspec/src/lib/approval-store';
import { classifyApprovablePath } from '../../packages/minspec/src/lib/approvable';

/** Runs `git <args>` and returns stdout as raw bytes; throws on a non-zero exit. */
export type GitBytes = (args: readonly string[]) => Buffer;

export interface PrCommit {
  readonly sha: string;
  readonly parentCount: number;
  /** GitHub's attribution of the commit author, or null when it maps to no account. */
  readonly authorLogin: string | null;
}

/** What the GitHub API said about the PR. Every field is read, none is trusted blindly. */
export interface PrFacts {
  readonly number: number;
  readonly state: string;
  readonly draft: boolean;
  readonly merged: boolean;
  readonly baseRef: string;
  readonly defaultBranch: string;
  readonly baseRepo: string;
  readonly headRepo: string | null;
  readonly authorLogin: string;
  readonly headSha: string;
  readonly labels: readonly string[];
  /** The PR's own commit count, so a truncated commit listing is detectable. */
  readonly commitCount: number;
  readonly commits: readonly PrCommit[];
}

export interface GateConfig {
  readonly founderLogins: readonly string[];
  readonly founderEmails: readonly string[];
}

export type Verdict =
  | { readonly decision: 'eligible'; readonly headSha: string; readonly baseSha: string; readonly records: readonly string[] }
  | { readonly decision: 'needs-founder'; readonly reason: string };

export const APPROVALS_PREFIX = '.minspec/approvals/';
export const APPROVABLE_ROOTS: readonly string[] = ['specs/', 'docs/decisions/', 'docs/epics/'];
/** Every key `ApprovalRecord` defines. A record carrying any other key is not one the editor wrote. */
export const RECORD_KEYS: ReadonlySet<string> = new Set([
  'specPath',
  'specHash',
  'approvedAt',
  'approvedBy',
  'tier',
  'migrated',
  'baselineBlob',
  'reviewStart',
]);
const TIERS: ReadonlySet<string> = new Set(['T1', 'T2', 'T3', 'T4']);
const SHA_RE = /^[0-9a-f]{40}$/;
const REGULAR_FILE = '100644';

const deny = (reason: string): Verdict => ({ decision: 'needs-founder', reason });

/** Comma/whitespace separated list, lowercased, empty entries dropped. */
export function parseList(raw: string | undefined): string[] {
  return String(raw ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** One `git diff --raw -z` entry. */
export interface RawDiffEntry {
  readonly oldMode: string;
  readonly newMode: string;
  readonly status: string;
  readonly path: string;
}

/**
 * Parse `git diff --raw -z --no-renames` output. Throws on any shape it does not
 * recognise, so a format surprise denies instead of being skipped.
 */
export function parseRawDiff(out: string): RawDiffEntry[] {
  const parts = out.split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  if (parts.length % 2 !== 0) throw new Error('raw diff: odd field count');
  const entries: RawDiffEntry[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const m = parts[i].match(/^:(\d{6}) (\d{6}) [0-9a-f]{40} [0-9a-f]{40} ([A-Z])$/);
    if (!m) throw new Error(`raw diff: unrecognised header ${JSON.stringify(parts[i])}`);
    const p = parts[i + 1];
    if (!p) throw new Error('raw diff: empty path');
    entries.push({ oldMode: m[1], newMode: m[2], status: m[3], path: p });
  }
  return entries;
}

/** A repo-relative POSIX path with no traversal, absolute root, backslash or control byte. */
export function isSafeRelPath(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('\\') || p.includes('//')) return false;
  if (/[\x00-\x1f\x7f]/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** The approvable artifact path a sidecar path names, or undefined when it names none. */
export function artifactForSidecar(sidecar: string): string | undefined {
  if (!sidecar.startsWith(APPROVALS_PREFIX) || !sidecar.endsWith('.json')) return undefined;
  const artifact = sidecar.slice(APPROVALS_PREFIX.length, -'.json'.length);
  if (!isSafeRelPath(artifact)) return undefined;
  if (!APPROVABLE_ROOTS.some((root) => artifact.startsWith(root))) return undefined;
  if (!classifyApprovablePath(artifact)) return undefined;
  return artifact;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const STATUS_KEY_RE = /^status[ \t]*:/;
const PHASES_KEY_RE = /^phases[ \t]*:/;
const INDENTED_RE = /^[ \t]+/;
const STATUS_LINE_RE = /^status:[ \t]*[a-z][a-z-]*[ \t]*(#.*)?$/;
const PHASES_LINE_RE = /^phases:[ \t]*(#.*)?$/;
const PHASE_CHILD_RE = /^[ \t]+[a-z][a-z-]*:[ \t]*[a-z][a-z-]*[ \t]*(#.*)?$/;

/**
 * Remove the frontmatter `status:` line and `phases:` block, and nothing else. Stricter
 * than `canonicalizeSpec` on purpose: that collapses link URLs and trailing whitespace,
 * which would let a changed link or a whitespace edit ride along. Here every byte outside
 * the lifecycle lines is kept, so two results compare equal only when the files differ in
 * lifecycle lines alone.
 *
 * Throws (denies) on a missing frontmatter block, a lifecycle line that is not
 * a plain `key: word` shape, or a second `status:` or `phases:` key.
 */
export function stripLifecycleStrict(content: string): string {
  const m = content.match(FRONTMATTER_RE);
  if (!m) throw new Error('no frontmatter block');
  const kept: string[] = [];
  let inPhases = false;
  let statusSeen = 0;
  let phasesSeen = 0;
  for (const line of m[1].split('\n')) {
    if (inPhases) {
      if (INDENTED_RE.test(line)) {
        if (!PHASE_CHILD_RE.test(line)) throw new Error(`unexpected phases line ${JSON.stringify(line)}`);
        continue;
      }
      inPhases = false;
    }
    if (PHASES_KEY_RE.test(line)) {
      if (!PHASES_LINE_RE.test(line)) throw new Error(`unexpected phases key ${JSON.stringify(line)}`);
      phasesSeen++;
      inPhases = true;
      continue;
    }
    if (STATUS_KEY_RE.test(line)) {
      if (!STATUS_LINE_RE.test(line)) throw new Error(`unexpected status line ${JSON.stringify(line)}`);
      statusSeen++;
      continue;
    }
    kept.push(line);
  }
  if (statusSeen > 1 || phasesSeen > 1) throw new Error('duplicate lifecycle key');
  return `---\n${kept.join('\n')}\n---\n${content.slice(m[0].length)}`;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** A blob at `rev:p` as strict UTF-8, or null when absent. Invalid UTF-8 throws. */
function readText(git: GitBytes, rev: string, p: string): string | null {
  let buf: Buffer;
  try {
    buf = git(['cat-file', 'blob', `${rev}:${p}`]);
  } catch {
    return null;
  }
  return utf8.decode(buf);
}

/**
 * Validate one approval record through the repo's own sidecar reader. The raw JSON is
 * materialised into a scratch `.minspec/approvals/` tree so `readRecord` reads it exactly
 * as it reads a committed sidecar; nothing is parsed by a second implementation.
 */
function checkRecord(
  raw: string,
  artifact: string,
  headArtifact: string,
  cfg: GateConfig,
): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `${artifact}: approval record is not valid JSON`;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return `${artifact}: approval record is not a JSON object`;
  }
  const extra = Object.keys(parsed).filter((k) => !RECORD_KEYS.has(k));
  if (extra.length > 0) return `${artifact}: approval record carries unknown key(s) ${extra.join(', ')}`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alta-record-'));
  let rec: ReturnType<typeof readRecord>;
  try {
    const p = path.join(tmp, ...APPROVALS_PREFIX.split('/').filter(Boolean), ...artifact.split('/')) + '.json';
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, raw, 'utf-8');
    rec = readRecord(tmp, artifact);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (!rec) return `${artifact}: approval record is malformed (rejected by readRecord)`;
  if (rec.specPath !== artifact) return `${artifact}: record names specPath ${JSON.stringify(rec.specPath)}, not its own path`;
  if (rec.migrated !== false) return `${artifact}: record is a migrated backfill, not an editor approval`;
  if (!TIERS.has(rec.tier)) return `${artifact}: record tier ${JSON.stringify(rec.tier)} is not T1-T4`;
  if (!cfg.founderEmails.includes(rec.approvedBy.trim().toLowerCase())) {
    return `${artifact}: record approvedBy ${JSON.stringify(rec.approvedBy)} is not the founder`;
  }
  if (rec.specHash !== specHash(headArtifact)) {
    return `${artifact}: record specHash does not match specHash() of the artifact on the head`;
  }
  return undefined;
}

/**
 * Judge whether a PR carries only the founder's own Alt-A. `baseSha` is the base branch
 * tip the caller fetched; `git` reads the local object store, which must hold both
 * `baseSha` and `facts.headSha`. Never throws: any error is a `needs-founder` verdict.
 */
export function judgeApprovalOnly(facts: PrFacts, baseSha: string, cfg: GateConfig, git: GitBytes): Verdict {
  try {
    return judge(facts, baseSha, cfg, git);
  } catch (e) {
    return deny(`error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function judge(facts: PrFacts, baseSha: string, cfg: GateConfig, git: GitBytes): Verdict {
  // ── Config: an empty founder list could match nothing, but deny loudly rather than rely on that.
  if (cfg.founderLogins.length === 0 || cfg.founderEmails.length === 0) return deny('founder identity is not configured');

  // ── The PR itself.
  if (facts.state !== 'open') return deny(`PR is ${facts.state}, not open`);
  if (facts.draft) return deny('PR is a draft');
  if (facts.merged) return deny('PR is already merged');
  if (!facts.defaultBranch || facts.baseRef !== facts.defaultBranch) {
    return deny(`PR targets ${facts.baseRef}, not the default branch`);
  }
  if (!facts.headRepo || facts.headRepo !== facts.baseRepo) return deny('PR head is not in this repository');
  if (!SHA_RE.test(facts.headSha)) return deny('PR head SHA is unreadable');
  if (!SHA_RE.test(baseSha)) return deny('base SHA is unreadable');

  // ── Who made it.
  if (!cfg.founderLogins.includes(facts.authorLogin.toLowerCase())) {
    return deny(`PR author ${facts.authorLogin} is not the founder`);
  }
  if (facts.commits.length === 0 || facts.commits.length !== facts.commitCount) {
    return deny(`commit listing is incomplete (${facts.commits.length} of ${facts.commitCount})`);
  }
  // GitHub's commit listing stops at 250; the PR's own count does not, so a longer PR
  // shows as a mismatch above and is denied.
  for (const c of facts.commits) {
    if (c.parentCount > 1) continue; // a base-branch update merge; checked below against the diff
    if (!c.authorLogin || !cfg.founderLogins.includes(c.authorLogin.toLowerCase())) {
      return deny(`commit ${c.sha.slice(0, 12)} is not attributed to the founder`);
    }
  }

  // ── Labels: the required checks enforce these too; this is a cheap second witness.
  const labels = facts.labels.map((l) => l.toLowerCase());
  const hold = labels.find((l) => l.startsWith('hold:'));
  if (hold) return deny(`PR carries ${hold}`);
  if (labels.includes('ai-review:changes') || labels.includes('ai-review:blocked')) {
    return deny('AI review asked for changes');
  }
  if (!labels.includes('ai-review:pass')) return deny('PR has no ai-review:pass');

  // ── The objects judged are the objects that will land.
  // `--is-ancestor` exits 1 for "not an ancestor" and 128 for an error (a missing
  // object); only the former is "behind", the latter is an error and denies as one.
  try {
    git(['merge-base', '--is-ancestor', baseSha, facts.headSha]);
  } catch (e) {
    if ((e as { status?: unknown }).status === 1) {
      return deny('PR is behind its base branch; the diff that would land is not the one judged');
    }
    throw e;
  }

  const raw = git(['diff', '--raw', '--no-abbrev', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', baseSha, facts.headSha]);
  const entries = parseRawDiff(raw.toString('utf-8'));
  if (entries.length === 0) return deny('PR changes nothing');

  const sidecars = new Map<string, string>(); // artifact -> sidecar path
  const artifacts: RawDiffEntry[] = [];
  for (const e of entries) {
    if (!isSafeRelPath(e.path)) return deny(`unsafe path ${JSON.stringify(e.path)}`);
    if (e.status !== 'A' && e.status !== 'M') return deny(`${e.path}: change type ${e.status} is not add or modify`);
    if (e.newMode !== REGULAR_FILE || (e.status === 'M' && e.oldMode !== REGULAR_FILE)) {
      return deny(`${e.path}: not a regular file change (${e.oldMode} -> ${e.newMode})`);
    }
    if (e.path.startsWith(APPROVALS_PREFIX)) {
      const artifact = artifactForSidecar(e.path);
      if (!artifact) return deny(`${e.path}: not an approval record for an approvable artifact`);
      sidecars.set(artifact, e.path);
    } else {
      artifacts.push(e);
    }
  }
  // No "at least one record" guard is needed: a non-empty diff with no record has an
  // artifact entry, and every artifact entry must have a record (below).

  // A merge commit is exempt from founder attribution only because it brings in base
  // content. So it may not touch any file this PR changes: if it did, it could carry a
  // record or a lifecycle edit no founder-attributed commit made.
  const changed = new Set(entries.map((e) => e.path));
  for (const c of facts.commits) {
    if (c.parentCount < 2) continue;
    if (!SHA_RE.test(c.sha)) throw new Error('merge commit SHA is unreadable');
    const touched = git(['diff', '--name-only', '-z', '--no-renames', `${c.sha}^1`, c.sha])
      .toString('utf-8')
      .split('\0')
      .filter(Boolean);
    const overlap = touched.find((p) => changed.has(p));
    if (overlap) return deny(`merge commit ${c.sha.slice(0, 12)} changes ${overlap}, a file this PR changes`);
  }

  for (const e of artifacts) {
    if (!sidecars.has(e.path)) return deny(`${e.path}: changed without an approval record for it`);
    if (e.status !== 'M') return deny(`${e.path}: an approval PR does not add an artifact`);
    const base = readText(git, baseSha, e.path);
    const head = readText(git, facts.headSha, e.path);
    if (base === null || head === null) throw new Error(`${e.path}: modified, yet unreadable on base or head`);
    // Equal after removing only the lifecycle lines implies equal `specHash()`: the
    // canonical form removes the same lines and normalises more. So the approved
    // content on the head is byte-for-byte the content on the base.
    if (stripLifecycleStrict(base) !== stripLifecycleStrict(head)) {
      return deny(`${e.path}: changes more than the frontmatter status/phases`);
    }
  }

  for (const [artifact, sidecar] of sidecars) {
    const headArtifact = readText(git, facts.headSha, artifact);
    if (headArtifact === null) return deny(`${artifact}: approved artifact does not exist on the head`);
    const recordRaw = readText(git, facts.headSha, sidecar);
    if (recordRaw === null) throw new Error(`${sidecar}: in the diff, yet unreadable on the head`);
    const problem = checkRecord(recordRaw, artifact, headArtifact, cfg);
    if (problem) return deny(problem);
  }

  return { decision: 'eligible', headSha: facts.headSha, baseSha, records: [...sidecars.keys()].sort() };
}
