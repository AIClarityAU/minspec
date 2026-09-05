import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_CONFIG, loadConfig, resolveAndValidate, TIERS, type Tier } from './config';
import { buildContext, renderTemplate, renderAll, resolveProjectName } from './template-engine';
import {
  TEMPLATE_NAMES,
  TEMPLATE_OUTPUT_PATHS,
  MANAGED_REGION_TEMPLATES,
  MINSPEC_HOOKS_DIR,
  managedRegionStartMarker,
  managedRegionEndMarker,
  renderManagedBlock,
  renderManagedFile,
  computeTemplateBaseline,
  claudeShimTemplateName,
  legacyClaudeShimOutputPath,
  type ManagedRegionTemplate,
} from './template-registry';
import { execFileSync } from 'child_process';
import {
  mergeFile,
  loadProvenHashes,
  type ManifestBaselineState,
  saveHashes,
  PREAMBLE_HEADING,
  saveTemplateBaseline,
  sectionHashesFromMarkdown,
  verifyGeneratedHashesConsistent,
  splitManagedRegion,
  spliceManagedRegion,
  type GeneratedHashes,
  type SectionHashes,
} from './merge-refresh';
import {
  generateSlashCommandShims,
  SPEC_KIT_COMMANDS,
  buildLegacyBareClaudeShim,
} from './slash-commands';
import { detectTools, type DetectedTools } from './tool-detector';
import { registerSessionTitleHook } from './claude-settings';
import { writeEpicIndex } from './epic-manager';
import { assembleContext } from './constitution-context';
import { seedProvider, integrateProposal, CONSTITUTION_SECTION_SCHEMA } from './constitution-proposer';

/** Output path of the constitution, relative to project root. */
const CONSTITUTION_REL_PATH = TEMPLATE_OUTPUT_PATHS['constitution.md'];

/**
 * SPEC-025 FR-4/FR-5: seed the constitution with deterministic DRAFT entries so
 * it is never empty (INV-4). Reads the current constitution, runs the offline
 * seed provider over the assembled context manifest, integrates additively
 * (never overwriting human content, idempotent), and writes the result back.
 *
 * SPEC-043 D8: `seedConstitution` NO LONGER feeds the hash manifest. It writes
 * `constitution.md` and returns; the manifest is recorded once, LAST, from the
 * final on-disk bytes of every tracked file through `sectionHashesFromMarkdown`
 * (first-occurrence-wins). This retires the old last-occurrence-wins
 * `buildSectionHashes(parseSections(merged))` recording, which could disagree
 * with the first-wins self-check on a duplicate-heading constitution.
 *
 * Best-effort: callers wrap in try/catch so a proposer failure never breaks
 * init/refresh (mirrors writeEpicIndex).
 */
function seedConstitution(rootDir: string): void {
  const fullPath = path.join(rootDir, CONSTITUTION_REL_PATH);
  if (!fs.existsSync(fullPath)) return;

  const existing = fs.readFileSync(fullPath, 'utf-8');
  const manifest = assembleContext(rootDir);
  const proposal = seedProvider.propose(manifest, CONSTITUTION_SECTION_SCHEMA);
  // seedProvider is synchronous (FR-5); integrate expects a resolved Proposal.
  if (proposal instanceof Promise) return;

  const { merged } = integrateProposal(existing, proposal);
  if (merged === existing) return;

  fs.writeFileSync(fullPath, merged);
}

export { DEFAULT_CONFIG };

// ─── Ensure-tasks.md (#225) ──────────────────────────────────────────────────
//
// A split-layout spec (`type: requirements|design|tasks`, one phase per sibling
// file) whose TIER requires the Tasks phase (T3/T4) must carry a `tasks.md`, or
// the implement phase has no spec-kit-native place to track step-by-step
// progress (DR-035). The spec-validator already WARNS on this
// (`split-coverage.tasks.missing`); #225 makes the warning ACTIONABLE by
// scaffolding the missing file. Deriving `done` from the checkboxes is OUT of
// scope — that is #208 (the #116/DR-034 task-tracking caveat).
//
// Tier-0: deterministic, offline, pure filesystem. The created file is body-only
// content under a frontmatter block that MIRRORS the requirements sibling — the
// corpus convention is exactly `id`, `type: tasks`, `status`, `product`, `epic`
// (no `tier`/`created`/`phases`; those live on the requirements artifact). The
// `id` line is what the CI frontmatter gate (scripts/validate-frontmatter.ts)
// requires on every `specs/**/*.md`, so the scaffolded file passes validation.

/** A frontmatter key whose RAW line is copied verbatim from requirements.md. */
const TASKS_MD_INHERITED_FIELDS = ['id', 'status', 'product', 'epic'] as const;

/**
 * Read the RAW value-bearing frontmatter line for `key` from a markdown source,
 * preserving any inline `# Title` comment verbatim (the corpus carries the epic's
 * human title that way). Returns the full `key: value` line, or undefined when
 * the field is absent. Only the top-level frontmatter block is scanned.
 */
function rawFrontmatterLine(raw: string, key: string): string | undefined {
  const block = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return undefined;
  const lineRe = new RegExp(`^(${key}\\s*:\\s*.*)$`, 'm');
  const m = block[1].match(lineRe);
  return m ? m[1].trimEnd() : undefined;
}

/**
 * Build the body of a scaffolded `tasks.md` from the requirements sibling's raw
 * source. Frontmatter mirrors the requirements file's `id`/`status`/`product`/
 * `epic` lines verbatim, with `type: tasks` (placed right after `id:`, matching
 * the corpus). The body is a single placeholder heading prompting the author to
 * fill in the task breakdown — intentionally minimal (no invented tasks).
 */
export function buildTasksMdContent(requirementsRaw: string): string {
  const idLine = rawFrontmatterLine(requirementsRaw, 'id') ?? 'id: SPEC-000';
  const fm: string[] = ['---', idLine, 'type: tasks'];
  for (const key of TASKS_MD_INHERITED_FIELDS) {
    if (key === 'id') continue; // already emitted first
    const line = rawFrontmatterLine(requirementsRaw, key);
    if (line) fm.push(line);
  }
  fm.push('---');

  const idValue = (idLine.match(/SPEC-\d+/) ?? ['the spec'])[0];
  const body = [
    '',
    `# ${idValue} — Task Breakdown`,
    '',
    '<!-- MinSpec scaffolded this tasks.md (#225). Break the plan into ordered,',
    '     checkable tasks. Ticking a checkbox here is body-only — it never voids',
    '     spec approval (DR-035). -->',
    '',
    '## Tasks',
    '',
    '- [ ] _Add the first task._',
    '',
  ];

  return fm.join('\n') + '\n' + body.join('\n');
}

/**
 * Scaffold a `tasks.md` into a split-layout spec directory that lacks one.
 *
 * No-op (returns false) when the dir has no `requirements.md` (nothing to mirror
 * frontmatter from) or already has a `tasks.md` (NEVER overwritten — a deliberate
 * author absence beyond the offer is respected). Returns true iff a file was
 * written. Pure filesystem, deterministic, offline (Tier-0 / DR-004).
 */
export function scaffoldTasksMd(dirPath: string): boolean {
  const requirementsPath = path.join(dirPath, 'requirements.md');
  const tasksPath = path.join(dirPath, 'tasks.md');
  if (fs.existsSync(tasksPath)) return false;
  if (!fs.existsSync(requirementsPath)) return false;

  let requirementsRaw: string;
  try {
    requirementsRaw = fs.readFileSync(requirementsPath, 'utf-8');
  } catch {
    return false;
  }

  fs.writeFileSync(tasksPath, buildTasksMdContent(requirementsRaw), 'utf-8');
  return true;
}

/** A split-layout spec directory that is missing its required `tasks.md`. */
export interface MissingTasksMdSpec {
  /** The spec's `id` (SPEC-NNN), read from requirements.md frontmatter. */
  readonly id: string;
  /** The spec's tier (the requirements artifact carries it). */
  readonly tier: Tier;
  /** Absolute path to the spec directory holding requirements.md. */
  readonly dirPath: string;
}

/** Strip an inline `# comment` from a raw frontmatter scalar value. */
function scalarValue(line: string | undefined): string {
  if (line === undefined) return '';
  const v = line.split(/:(.*)/s)[1]?.trim() ?? '';
  const m = v.match(/\s#/);
  return (m && m.index !== undefined ? v.slice(0, m.index) : v).trim();
}

/**
 * Walk the specs tree for split-layout spec directories whose tier REQUIRES the
 * Tasks phase (T3/T4 by default config) but which have no `tasks.md`.
 *
 * A directory qualifies when it contains a `requirements.md` carrying a `type:`
 * frontmatter (the split-layout signal) — single-file specs (one file, no
 * sibling files, no `type`) embed their Tasks phase in-file and are NEVER
 * offered. The tier is read from requirements.md; only tiers whose
 * `requiredPhases` include `tasks` are returned (T1/T2 don't, so they are
 * skipped). Deterministic + offline; tolerant of an absent specs/ dir.
 */
export function findSpecDirsMissingTasksMd(rootDir: string): MissingTasksMdSpec[] {
  const config = loadConfig(rootDir);
  let specsDir: string;
  try {
    specsDir = resolveAndValidate(rootDir, config.specsDir);
  } catch {
    return [];
  }
  if (!fs.existsSync(specsDir)) return [];

  const found: MissingTasksMdSpec[] = [];

  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const requirementsPath = path.join(dir, 'requirements.md');
    if (fs.existsSync(requirementsPath)) {
      try {
        const raw = fs.readFileSync(requirementsPath, 'utf-8');
        const type = scalarValue(rawFrontmatterLine(raw, 'type'));
        const id = scalarValue(rawFrontmatterLine(raw, 'id'));
        const tierRaw = scalarValue(rawFrontmatterLine(raw, 'tier'));
        const tier = (TIERS as readonly string[]).includes(tierRaw)
          ? (tierRaw as Tier)
          : 'T2';
        const requiresTasks =
          config.phaseMappings[tier]?.requiredPhases.includes('tasks') ?? false;
        const isSplit = type === 'requirements';
        if (
          isSplit &&
          requiresTasks &&
          id &&
          !fs.existsSync(path.join(dir, 'tasks.md'))
        ) {
          found.push({ id, tier, dirPath: dir });
        }
      } catch {
        /* unreadable requirements.md — skip this dir */
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory()) visit(path.join(dir, entry.name));
    }
  };

  visit(specsDir);
  return found;
}

export const MINSPEC_GITIGNORE_MARKER = '# MinSpec ephemeral data';
export const MINSPEC_GITIGNORE_ENTRIES = [
  '.minspec/session.json',
  // SPEC-026 FR-1 / INV-1: the session-presence heartbeat directory. One file per
  // live extension-host activation (<uuid>.session.json), refreshed every 30s,
  // pruned on the 120s stale threshold. Process-local ephemeral state — never
  // committed; a fresh clone must not contain it.
  '.minspec/sessions/',
  '.minspec/calibration.json',
  // Machine-local merge-refresh drift-detection state, rebuilt on every
  // generate/refresh — must be gitignored, never committed. These mirror
  // merge-refresh's HASHES_FILENAME / TEMPLATE_BASELINE_FILENAME (kept as plain
  // literals here to avoid an import cycle; gitignore.test.ts ties the literals
  // back to those source constants so a rename of either can't silently drift).
  '.minspec/generated-hashes.json',
  '.minspec/template-baseline.json',
  // DR-057 §2 / #733: local, LLM-free phase-advance request queue. Written by
  // the Alt-A follow-up toast (and, later, the drain-sweep #734); a downstream
  // consumer dequeues it. Never committed — it is machine-local intent, not
  // ground truth (the approval sidecar under .minspec/approvals/ is that).
  '.minspec/queue/',
  // Machine-local UI dismissal state (answeredSignatures: which one-shot prompts
  // this machine has already answered — e.g. skipClassifyPrompt, skipRefreshPrompt).
  // Rewritten by the ext at runtime; never committed, or it surfaces as perpetual
  // dirty noise and gets swept into "junk" commits (G-8). Sibling of the other
  // machine-local .minspec/*.json entries above; was the one that got missed.
  '.minspec/preferences.json',
  // Harness-owned worktree checkouts (created by the agent harness / EnterWorktree).
  // Transient, machine-local, auto-removed — must never be tracked, or a stray
  // second checkout shows up as untracked noise in the source-control panel (G-8:
  // keep the primary checkout clean). Not under .claude/commands/, so unaffected by
  // the slash-command-shim carve-out some repos keep in their own .gitignore.
  '.claude/worktrees/',
];

/**
 * Creates the .minspec/ directory structure in rootDir.
 * Idempotent — never overwrites existing config.json.
 */
export function scaffold(rootDir: string): void {
  const minspecDir = path.join(rootDir, '.minspec');
  fs.mkdirSync(minspecDir, { recursive: true });

  const configPath = path.join(minspecDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    // Record the project's name at creation, so it stops being re-derived from the
    // directory on every later refresh (#1529). Written ONLY here, never back-filled
    // into an existing config: a back-fill's first run could itself be from a
    // worktree, which would persist exactly the wrong name this guards against.
    const seeded = { projectName: resolveProjectName(rootDir).name, ...DEFAULT_CONFIG };
    fs.writeFileSync(configPath, JSON.stringify(seeded, null, 2) + '\n');
  }

  // Pre-create the epic registry directory + empty marker-bounded INDEX so the
  // explorer epic-grouping has a home from day one (DR-013 / SPEC-007 FR-10).
  // Idempotent — writeEpicIndex only rewrites content inside its own markers.
  try {
    writeEpicIndex(rootDir);
  } catch {
    // best-effort — epics are optional; a failure here must not break init.
  }
}

/**
 * Ensure MinSpec's machine-local files (session.json, calibration.json,
 * generated-hashes.json, template-baseline.json) are present in the project's
 * .gitignore — see MINSPEC_GITIGNORE_ENTRIES.
 *
 * Idempotent: skips any entry already listed (exact match, ignoring leading
 * whitespace). Creates .gitignore if missing. Preserves existing content.
 */
/**
 * Untrack any path MinSpec declares machine-local that git is nonetheless tracking.
 *
 * WHY THIS EXISTS. Writing an entry into `.gitignore` does NOT make a file ignored —
 * git does not apply `.gitignore` to a path already in the index. Every one of these
 * repos was scaffolded, committed, and only later given the ignore entries, so the
 * rules landed on files that were already tracked and have been inert ever since.
 * The extension rewrites those files on every generate/refresh, they surface as
 * modified, and they get swept into the next commit or sit as permanent dirty noise
 * (G-8). Declaring intent was never enough; nothing reconciled it.
 *
 * `--cached` only: the file stays on disk and the extension keeps rewriting it. This
 * removes it from the INDEX, which is what makes the existing ignore rule finally
 * take effect. Reversible with `git add` if a project genuinely wants one tracked —
 * in which case remove it from MINSPEC_GITIGNORE_ENTRIES, since that list is the
 * declaration that it must not be.
 *
 * Best-effort and silent on failure (not a repo, no git, permission): returns what it
 * actually untracked so the caller can SAY so. Never-wrong — a silent index change is
 * exactly the kind of invisible git action G-8 exists to remove.
 */
export function untrackDeclaredMachineLocalPaths(rootDir: string): string[] {
  // A directory entry (`.minspec/sessions/`) is a valid pathspec without the
  // trailing slash; `git ls-files` expands it to the tracked files beneath.
  // All entries go in ONE invocation — per-entry calls meant a subprocess spawn
  // for each of the eight on every generate/refresh, for a list that is almost
  // always empty.
  const pathspecs = MINSPEC_GITIGNORE_ENTRIES.map((e) => (e.endsWith('/') ? e.slice(0, -1) : e));

  let tracked = '';
  try {
    tracked = execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // Not a git repo, or no git on PATH — nothing to reconcile.
    return [];
  }

  const paths = tracked.split('\0').filter((p) => p.length > 0);
  if (paths.length === 0) return [];

  try {
    execFileSync('git', ['rm', '--cached', '-q', '--ignore-unmatch', '--', ...paths], {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    // Leave them tracked rather than half-reconciled; the next refresh retries.
    return [];
  }
  return paths;
}

/**
 * @returns the paths removed from the git index, for the caller to REPORT. Never
 * discard this — an unreported `git rm --cached` is precisely the invisible git
 * action G-8 exists to remove.
 *
 * Both callers propagate it: {@link refreshHarnessFiles} turns each into an
 * `'untracked'` {@link ManagedRegionWarning}, and {@link generateHarnessFiles}
 * returns the list for `initCommand` to surface the same way. Each is covered by a
 * test that asserts the path reaches the caller — the first revision of this change
 * claimed the threading in prose while discarding the value, which is the defect
 * this whole function exists to stop.
 */
export function ensureGitignoreEntries(rootDir: string): string[] {
  // Reconcile FIRST, and unconditionally — before the early return below.
  //
  // That return fires whenever `.gitignore` already lists every entry, which is the
  // steady state of every already-scaffolded project. Putting the reconcile after it
  // would skip precisely the repos that need it: the ones whose ignore rules are
  // present, correct-looking, and inert because the files were tracked first.
  const untracked = untrackDeclaredMachineLocalPaths(rootDir);

  const gitignorePath = path.join(rootDir, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf-8')
    : '';

  const existingLines = new Set(
    existing.split('\n').map((line) => line.trim()).filter((line) => line.length > 0),
  );

  const missing = MINSPEC_GITIGNORE_ENTRIES.filter((entry) => !existingLines.has(entry));
  if (missing.length === 0) {
    return untracked;
  }

  const hasMarker = existing.includes(MINSPEC_GITIGNORE_MARKER);
  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  const block =
    (hasMarker ? '' : MINSPEC_GITIGNORE_MARKER + '\n') + missing.join('\n') + '\n';
  const separator = existing.length > 0 && !existing.endsWith('\n\n') ? '\n' : '';

  fs.writeFileSync(gitignorePath, existing + prefix + separator + block);
  return untracked;
}

/**
 * Warning emitted when a managed-region refresh cannot safely update a file
 * because its MinSpec markers are missing or corrupted. Surfaced (not thrown) so a
 * single un-restorable file never aborts the whole refresh, and never triggers a
 * silent whole-file overwrite (never-wrong).
 */
export interface ManagedRegionWarning {
  /** The output path (relative to project root) that was left untouched. */
  readonly outputPath: string;
  /** Human-readable, actionable message. */
  readonly message: string;
  /**
   * Every path this ONE notice covers, when it covers more than one — the
   * `'preserved-without-baseline'` notice is emitted once per refresh rather than
   * once per file (#1697 F3), because the surfacing layer awaits each notice in
   * turn and a run of modal-ish toasts is read as noise and dismissed unread.
   *
   * Optional and defaulting to `[outputPath]`, so every existing producer and
   * consumer is unaffected; `outputPath` always names the first path, so a caller
   * that only understands the single-path field still points somewhere true.
   */
  readonly outputPaths?: readonly string[];
  /**
   * What KIND of notice this is, so the surfacing layer can offer the right
   * actions. Optional and defaulting to `'missing-markers'` so every existing
   * producer and consumer is unaffected.
   *
   * `'untracked'` notices must NOT offer "Re-scaffold" — nothing was scaffolded,
   * a file was removed from the git index — which is why this discriminator
   * exists rather than reusing the marker warning verbatim.
   *
   * `'project-name-mismatch'` reports that the directory's name disagreed with the
   * project's, and the project's won (#1529). Nothing is broken and nothing needs
   * re-scaffolding; its `outputPath` points at `.minspec/config.json`, where a
   * deliberate rename is declared.
   *
   * `'preserved-without-baseline'` reports that the section merge kept existing
   * content because no baseline hash was recorded for it, so a template update was
   * withheld (#1697). Nothing is broken and nothing needs re-scaffolding — the
   * files are INTACT, which is the point; the human is told so they can decide
   * whether they still want the template's version. It fires ONCE, on the refresh
   * that has no baseline, while the hold it announces lasts until the section's
   * content converges or its body is emptied — so the message has to carry that
   * standing consequence itself (#1697 NEW-1), or the reader takes "your files are
   * intact" for "and everything still updates". It MUST therefore be surfaced
   * informationally, with no overwrite action: routing it to the default
   * missing-markers branch offers "Re-scaffold (overwrite)", which for a
   * section-merged path is not in `MANAGED_REGION_TEMPLATES`, silently does
   * nothing, and then reports success (#1697 F2).
   *
   * Emitted ONCE per refresh, covering every affected file through
   * {@link ManagedRegionWarning.outputPaths} — the one notice kind here that is not
   * per-path.
   */
  readonly kind?:
    | 'missing-markers'
    | 'untracked'
    | 'project-name-mismatch'
    | 'preserved-without-baseline';
}

/** The notice raised when a declared machine-local path is removed from the index. */
/**
 * The notice raised when the directory's name disagreed with the project's (#1529).
 *
 * Names BOTH sides deliberately: a warning that says only "mismatch" makes the
 * reader go and find which name won, which is the same silence in a smaller box.
 */
export function projectNameMismatchMessage(recorded: string, basename: string): string {
  return (
    `Kept the project name "${recorded}" from the existing harness. This directory ` +
    `is named "${basename}" — a linked git worktree, or a renamed checkout — and ` +
    'using it would have renamed the project in every generated file. To rename ' +
    'deliberately, set "projectName" in .minspec/config.json.'
  );
}

export function untrackedNoticeMessage(outputPath: string): string {
  return (
    `${outputPath} was tracked by git but MinSpec declares it machine-local, so it ` +
    'has been removed from the index (the file is untouched on disk). It was ' +
    'rewritten on every refresh and showed as a permanent change; a .gitignore ' +
    'entry alone could not stop that, because git does not ignore an already-' +
    'tracked path. Commit this removal to make it stick. Reverse with `git add`.'
  );
}

/**
 * Render a section heading for a human. `mergeFile` reports the pre-heading
 * content under the {@link PREAMBLE_HEADING} sentinel, which is a parser token,
 * not something to show a user.
 */
function displayHeading(heading: string): string {
  return heading === PREAMBLE_HEADING ? 'the text above the first heading' : `"${heading}"`;
}

/** One file's baseline-less holds, as reported by a single refresh. */
export interface PreservedWithoutBaselineFile {
  /** Output path, relative to the project root. */
  readonly outputPath: string;
  /** The headings whose bodies were kept, in template-pass order. */
  readonly headings: readonly string[];
}

/**
 * Why a refresh had no baseline to read for the sections it held.
 *
 * The hold is identical in all three cases; the sentence a human is given for it is
 * not. The first version of this notice said only "machine-local and gitignored, so
 * it is absent in a fresh clone", which is flatly false when the file is sitting
 * right there (#1697 NEW-A2). The second added the pre-#1718 case — and then
 * asserted THAT for a manifest MinSpec merely could not READ, which is false of one
 * a newer MinSpec wrote. Three states, three sentences.
 *
 * Derived from {@link ManifestBaselineState} rather than restated, minus the one
 * state that raises no notice (`'proven'` — nothing was distrusted), so the merge's
 * classification and the user's sentence cannot drift apart: a fourth refused shape
 * added there is a compile error in {@link preservedWithoutBaselineMessage} until it
 * gets a sentence. That is a `never` default on a switch, not a promise — measured
 * both ways: with the fourth state added, the switch fails the build at exactly one
 * site, and the ternary chain it replaced accepted it with no error at all.
 */
export type PreservedWithoutBaselineReason = Exclude<ManifestBaselineState, 'proven'>;

/**
 * The notice raised when the section merge kept existing content because no
 * baseline hash was recorded for it, so a template update was withheld (#1697).
 *
 * This report IS part of the fix, not polish. Preserving silently is better than
 * overwriting silently, but it is still silent, and constitution invariant 2
 * requires a governance-editing command to act visibly. It is also what would have
 * caught the three `voip-sms-inbox` losses the moment they happened: the merge
 * reflowed the whole constitution to template wording, so the one section that lost
 * a ratified standing exception read as part of a reformat in review.
 *
 * ONE message for the whole refresh, not one per file (#1697 F3). The surfacing
 * layer awaits each notice before showing the next, so a per-file notice turned a
 * multi-file refresh into a queue of toasts to click through — and a queue is read
 * as noise and dismissed, which is how a report meant to be un-missable becomes
 * invisible.
 *
 * Names the sections outright rather than only counting them — a count sends the
 * reader to diff the file to find out which ones, which is the same silence in a
 * smaller box (cf. {@link projectNameMismatchMessage}).
 *
 * It does NOT tell the reader the held sections are theirs (#1697 NEW-A2). MinSpec
 * does not know that; what it knows is that it cannot prove they are its own, and
 * its OWN older wording is held on exactly the same footing — that is the standing
 * cost of dropping an entry it cannot vouch for, and the sharpest case is a heading
 * an older template shipped and a newer one dropped, whose stale body is then
 * protected as if it were the user's. Naming that is what makes the release
 * ("empty it") an instruction the reader can follow rather than one they would only
 * risk on content they wrote.
 */
export function preservedWithoutBaselineMessage(
  files: readonly PreservedWithoutBaselineFile[],
  reason: PreservedWithoutBaselineReason = 'absent',
): string {
  const sectionCount = files.reduce((n, f) => n + f.headings.length, 0);
  const manySections = sectionCount !== 1;
  const detail = files
    .map((f) => `${f.outputPath} (${f.headings.map(displayHeading).join(', ')})`)
    .join('; ');
  const scope = files.length === 1 ? files[0].outputPath : `${files.length} files`;
  // One sentence per reason, and each must be true of ITS state alone (#1697
  // NEW-A2, #1718 pre-fix manifest migration gap). `===` on the manifest stamp
  // sends three different files down one hold, and the version of this notice that
  // named only the middle one was false for the other two.
  //
  // A SWITCH with a `never` default, not a ternary chain. The chain that stood here
  // ended in a catch-all arm, so a fourth `ManifestBaselineState` would have
  // compiled and silently collected the `'absent'` sentence — a true hold with a
  // false reason, which is the exact defect AC-70 pins for the other three. The
  // docstring above claimed the compile error; this is what makes the claim true.
  const why = ((): string => {
    switch (reason) {
      case 'pre-authorship':
        return (
          'The baseline in .minspec/generated-hashes.json was written by an older version ' +
          'of MinSpec, which recorded whatever was on disk at the time — your own edits ' +
          'included — so it says nothing about who wrote what and MinSpec would not act ' +
          'on it. This refresh has replaced it with one MinSpec can stand behind, so ' +
          'later refreshes go back to being quiet.'
        );
      case 'unrecognised-version':
        // A NEWER MinSpec wrote it, or the stamp was hand-edited. Saying "older"
        // here would point the reader at a downgrade that never happened, and
        // promising permanent quiet would be false while two versions take turns
        // on the one project — each distrusts the other's manifest every time.
        return (
          'The baseline in .minspec/generated-hashes.json carries a format version this ' +
          'MinSpec cannot read — a newer MinSpec wrote it, or the stamp has been edited ' +
          'by hand — so there is no reading of it this version can act on. This refresh ' +
          'has replaced it with one this version can stand behind; if a newer MinSpec is ' +
          'what you meant to be running, upgrade and refresh with that one rather than ' +
          'alternating, because each version distrusts the other’s baseline and will ' +
          'hold again.'
        );
      case 'absent':
        return (
          'MinSpec has no entry there for ' +
          `${manySections ? 'them' : 'it'}: the baseline lives in ` +
          '.minspec/generated-hashes.json, which is machine-local and gitignored, so it ' +
          'is absent in a fresh clone or a new worktree — and a section MinSpec has ' +
          'never been able to vouch for carries no entry in it even where the file is ' +
          'present.'
        );
      default: {
        // Unreachable by TYPE. A fourth refused state widens
        // `PreservedWithoutBaselineReason`, and this assignment stops compiling
        // until that state is given its own sentence above.
        const unhandled: never = reason;
        throw new Error(`Unhandled no-baseline reason: ${String(unhandled)}`);
      }
    }
  })();
  return (
    `Kept ${sectionCount} existing section${manySections ? 's' : ''} as-is in ${scope} — ` +
    `MinSpec has no recorded baseline for ${manySections ? 'them' : 'it'}, so it cannot tell ` +
    'your content from an untouched template and withheld the template update rather than ' +
    `overwrite you: ${detail}. ${why} ` +
    'Nothing is broken and nothing needs re-scaffolding — your files are intact. This ' +
    `is the only notice you will get about ${manySections ? 'them' : 'it'}, and the hold ` +
    `STANDS: MinSpec goes on keeping ${manySections ? 'these sections' : 'this section'} ` +
    `and goes on withholding template updates to ${manySections ? 'them' : 'it'} on every ` +
    'refresh, so later changes to the constitution will not reach ' +
    `${manySections ? 'them' : 'it'} either. MinSpec is not claiming ` +
    `${manySections ? 'these sections are' : 'this section is'} yours — it is saying it ` +
    `cannot prove ${manySections ? 'they are' : 'it is'} its own, and MinSpec's own older ` +
    'wording is held on exactly the same footing. Review and re-apply anything you want ' +
    'from the current template by hand; if you do not recognise a section as yours, ' +
    'emptying it ends the hold and takes the current template back on the next refresh.'
  );
}

/**
 * The skip+warn message for a file whose managed markers are gone. Single source
 * so the message is identical wherever it is produced (tests match on it).
 */
function missingMarkersMessage(outputPath: string): string {
  return (
    `MinSpec-managed markers missing in ${outputPath}; left untouched — ` +
    'restore the markers or delete the file to re-scaffold.'
  );
}

/**
 * Scaffold managed-region templates (#249, DR-037) at first init.
 *
 * Managed-region templates (YAML workflows, scripts) cannot go through the
 * Markdown section-merge engine, so MinSpec wraps its owned content in
 * comment-delimited markers (`renderManagedBlock`) and writes the block verbatim —
 * but only if the output path is absent (idempotent: an existing file, MinSpec- or
 * user-authored, is never overwritten here). The markers written now ARE the
 * boundary Refresh later uses to update only MinSpec's region. The user is expected
 * to add any custom content OUTSIDE the markers.
 */
function generateManagedRegionTemplates(rootDir: string, tools: DetectedTools): void {
  for (const tpl of MANAGED_REGION_TEMPLATES) {
    // Tool-gated templates (the slash-command shims, #241) are only scaffolded for a
    // tool the project actually uses; tool-independent templates (CI workflow, git
    // hooks) have no condition and are always scaffolded.
    if (tpl.condition && !tpl.condition(tools)) continue;
    const fullPath = path.join(rootDir, tpl.outputPath);
    if (!fs.existsSync(fullPath)) {
      writeManagedFile(fullPath, tpl);
    }
  }
}

/**
 * Write the full on-disk file for a managed-region template (shebang preamble +
 * marked block) and, for executable templates (the git hooks), set the execute bit
 * so git will actually run the hook. Single place both scaffold and the deleted-file
 * re-scaffold path go through, so the bytes and the mode never diverge.
 */
function writeManagedFile(fullPath: string, tpl: ManagedRegionTemplate): void {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, renderManagedFile(tpl));
  if (tpl.executable) {
    try {
      fs.chmodSync(fullPath, 0o755);
    } catch {
      // chmod can fail on filesystems without POSIX modes (e.g. some Windows
      // mounts). Git on those platforms ignores the bit anyway — best-effort.
    }
  }
}

/**
 * Register the scaffolded Claude Code hooks in the project's `.claude/settings.json`
 * (#1093, DR-073). Scaffolding the hook files is inert on its own — Claude Code only
 * runs a hook that is listed under its event.
 *
 * Gated on `tools.claude`, the same condition that gates scaffolding the hook files.
 * The write itself is additive, idempotent, and never-clobbering (claude-settings.ts),
 * and the whole call is best-effort: a cosmetic session title must never fail an init
 * or a refresh.
 */
function registerClaudeHooks(rootDir: string, tools: DetectedTools): void {
  if (!tools.claude) return;
  try {
    registerSessionTitleHook(rootDir);
  } catch {
    // Best-effort — the scaffolded hook simply stays unregistered.
  }
}

/**
 * Clean up pre-#534 bare-name Claude Code slash-command shims
 * (`.claude/commands/specify.md`, …) once a project has moved to the
 * `minspec-`-prefixed names (`.claude/commands/minspec-specify.md`). Because the
 * output path changed, `refreshManagedRegionTemplates` never revisits the old
 * path — left alone it would sit forever as a stale, un-refreshed duplicate of
 * the new shim, both routable, which is exactly the "harness upgrades cleanly"
 * gap #534 calls out.
 *
 * Two legacy shapes exist on disk depending on when the project was scaffolded,
 * and each is deleted only when it is still pure and unmodified:
 *
 *  - **Post-#241, pre-#534** — a managed-region file (markers intact, same
 *    marker name as the new shim — only the path moved) with nothing besides
 *    the frontmatter preamble added outside the region.
 *  - **Pre-#241** — a raw, markerless file written directly by the old
 *    `generateSlashCommandShims` (no region to parse at all — this is what every
 *    real pre-#534 project actually has on disk, #599). Recognized instead by a
 *    full-content byte match (modulo trailing newline) against
 *    `buildLegacyBareClaudeShim(command)`, the exact bytes MinSpec itself wrote
 *    pre-#534.
 *
 * Either way: markers missing AND content not a pristine bare-heading match, or
 * real user content outside a present region, means leave the file untouched —
 * never a silent clobber, mirroring the missing-markers refresh rule.
 */
function migrateLegacyClaudeSlashCommandShims(rootDir: string): void {
  for (const command of SPEC_KIT_COMMANDS) {
    const legacyRel = legacyClaudeShimOutputPath(command);
    const legacyFull = path.join(rootDir, legacyRel);
    if (!fs.existsSync(legacyFull)) continue;

    const onDisk = fs.readFileSync(legacyFull, 'utf-8');

    const start = managedRegionStartMarker(claudeShimTemplateName(command), 'html');
    const end = managedRegionEndMarker(claudeShimTemplateName(command), 'html');
    const split = splitManagedRegion(onDisk, start, end);
    if (split) {
      const leftover = (split.before + split.after).replace(/^---[\s\S]*?---/, '').trim();
      if (leftover.length > 0) continue; // user added content outside the region — keep the file
      fs.unlinkSync(legacyFull);
      continue;
    }

    // No managed region: the pre-#241 raw shape. Only remove when byte-identical
    // (modulo trailing newline) to what MinSpec itself wrote pre-#534 — any
    // drift (user edit, foreign extension, hand-written file) is left alone.
    const pristine = buildLegacyBareClaudeShim(command);
    if (onDisk.replace(/\n+$/, '') === pristine.replace(/\n+$/, '')) {
      fs.unlinkSync(legacyFull);
    }
  }
}

/**
 * Point the project's git `core.hooksPath` at `.minspec/hooks` so the scaffolded
 * editor-independent hooks (DR-037, #247) run on EVERY commit — terminal, another
 * editor, or an AI agent — not just the VS Code command path.
 *
 * Idempotent: reads the current value first and only writes when it differs (a no-op
 * when already configured). Best-effort and fail-quiet — a repo without git, or a git
 * error, must never break init/refresh; the GitHub Actions backstop (DR-037) still
 * gates such repos on push.
 */
function ensureHooksPath(rootDir: string): void {
  try {
    let current = '';
    try {
      current = execFileSync('git', ['config', '--local', 'core.hooksPath'], {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // Unset → git exits non-zero; treat as empty and set it below.
      current = '';
    }
    if (current !== MINSPEC_HOOKS_DIR) {
      execFileSync('git', ['config', '--local', 'core.hooksPath', MINSPEC_HOOKS_DIR], {
        cwd: rootDir,
        stdio: 'ignore',
      });
    }
  } catch {
    // No git repo / git not on PATH / config write failed — non-fatal.
  }
}

/**
 * The managed body's lines exactly as `renderManagedBlock` sandwiches them between
 * the start/end markers — i.e. `tpl.content` normalized to a single trailing
 * newline, split into lines. Single source so the auto-heal search below can never
 * disagree with what a fresh scaffold actually wrote between the markers.
 */
function managedBlockBodyLines(tpl: ManagedRegionTemplate): string[] {
  const block = renderManagedBlock(tpl);
  // block === `${start}\n${body}${end}\n` where body already ends in '\n', so
  // splitting on '\n' gives [start, ...bodyLines, end, '']; drop the marker lines
  // and the trailing empty element from the final newline.
  return block.split('\n').slice(1, -2);
}

/**
 * Auto-heal (#604): the common way markers go missing is a stray strip of the two
 * marker comment lines with the MinSpec body otherwise untouched (a markdown/YAML
 * linter, a hand-edit trimming "clutter") — losslessly recoverable because MinSpec
 * knows the exact body it owns. Locates the current template's body as a contiguous
 * line-run in the on-disk file; if it occurs EXACTLY ONCE, re-inserts the start/end
 * marker lines around it and returns the healed content. Returns `null` when the
 * body cannot be pinned down unambiguously (not found, or found more than once) —
 * the caller must then fall back to skip+warn, never a guess (never-wrong: a heal
 * only ever inserts the 2 marker lines, never rewrites a single body byte, so it is
 * safe exactly when the match is unambiguous and unsafe otherwise).
 */
function tryAutoHealManagedRegion(
  onDisk: string,
  tpl: ManagedRegionTemplate,
  startMarker: string,
  endMarker: string,
): string | null {
  const bodyLines = managedBlockBodyLines(tpl);
  if (bodyLines.length === 0) return null;

  const fileLines = onDisk.split('\n');
  const matchStarts: number[] = [];
  for (let i = 0; i + bodyLines.length <= fileLines.length; i++) {
    let matches = true;
    for (let j = 0; j < bodyLines.length; j++) {
      if (fileLines[i + j] !== bodyLines[j]) {
        matches = false;
        break;
      }
    }
    if (matches) matchStarts.push(i);
  }

  if (matchStarts.length !== 1) return null;

  const start = matchStarts[0];
  const end = start + bodyLines.length;
  const healedLines = [
    ...fileLines.slice(0, start),
    startMarker,
    ...fileLines.slice(start, end),
    endMarker,
    ...fileLines.slice(end),
  ];
  return healedLines.join('\n');
}

/**
 * Reconcile managed-region templates on Refresh (#249, DR-037).
 *
 * For each managed-region template, by parsing its markers — never a whole-file
 * compare:
 *   - file missing             → re-scaffold it with markers (a deleted managed file)
 *   - markers present          → OVERWRITE only the content between the markers with
 *                                the current template; PRESERVE everything outside
 *                                verbatim (user edits outside the region survive,
 *                                and MinSpec's region is always brought current)
 *   - file exists, NO markers  → try {@link tryAutoHealManagedRegion} (markers merely
 *                                stripped, body intact); if that can't prove it
 *                                safely, SKIP + warn — never a silent whole-file
 *                                overwrite
 *
 * No content baseline is consulted — the markers ARE the boundary between
 * MinSpec-owned and user-owned content, which is the key improvement over the old
 * preserve-on-any-edit whole-file rule: a stray edit outside the region no longer
 * freezes MinSpec out of its own region.
 *
 * Returns the warnings for any files left untouched (missing markers, un-healable)
 * so the vscode-aware caller can surface them. The file is NEVER modified on a
 * warning.
 */
function refreshManagedRegionTemplates(rootDir: string, tools: DetectedTools): ManagedRegionWarning[] {
  const warnings: ManagedRegionWarning[] = [];

  for (const tpl of MANAGED_REGION_TEMPLATES) {
    // Skip a tool-gated template whose tool the project does not use (#241): never
    // scaffold a Claude shim into a Cursor-only project, and never re-scaffold one a
    // user removed by uninstalling the tool. Tool-independent templates are unconditional.
    if (tpl.condition && !tpl.condition(tools)) continue;

    const fullPath = path.join(rootDir, tpl.outputPath);

    if (!fs.existsSync(fullPath)) {
      // Re-scaffold a deleted managed file, shebang + markers and all.
      writeManagedFile(fullPath, tpl);
      continue;
    }

    const onDisk = fs.readFileSync(fullPath, 'utf-8');
    const startMarker = managedRegionStartMarker(tpl.name, tpl.commentStyle);
    const endMarker = managedRegionEndMarker(tpl.name, tpl.commentStyle);
    const split = splitManagedRegion(onDisk, startMarker, endMarker);

    if (!split) {
      // Markers missing/corrupted — cannot identify MinSpec's region by markers
      // alone. Try the lossless auto-heal (body byte-intact, only the marker
      // lines gone) before giving up.
      const healed = tryAutoHealManagedRegion(onDisk, tpl, startMarker, endMarker);
      if (healed !== null) {
        fs.writeFileSync(fullPath, healed);
        continue;
      }
      // Can't prove it's safe — NEVER clobber the whole file; skip and warn so
      // the user can restore the markers.
      warnings.push({ outputPath: tpl.outputPath, message: missingMarkersMessage(tpl.outputPath) });
      continue;
    }

    // Overwrite ONLY the managed region with the current template; preserve the
    // user's surrounding content verbatim.
    const updated = spliceManagedRegion(split, renderManagedBlock(tpl));
    if (updated !== onDisk) {
      fs.writeFileSync(fullPath, updated);
    }
  }

  return warnings;
}

/**
 * Consent-gated whole-file re-scaffold for a SINGLE managed-region template, keyed
 * by its output path (#604's "Re-scaffold (overwrite)" warning action). Unlike the
 * automatic paths above (which never clobber on an ambiguous match), this
 * deliberately overwrites the whole file with a fresh {@link renderManagedFile} —
 * the user has explicitly asked for it because the file could not be proven safe to
 * heal automatically. Returns `false` when `outputPath` doesn't match any
 * managed-region template (defensive; should not happen for a warning this module
 * itself produced).
 */
export function rescaffoldManagedRegionFile(rootDir: string, outputPath: string): boolean {
  const tpl = MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === outputPath);
  if (!tpl) return false;
  writeManagedFile(path.join(rootDir, tpl.outputPath), tpl);
  return true;
}

/**
 * A managed-region output path present on disk without valid markers (#760).
 *
 * `refreshManagedRegionTemplates` only ever *discovers* this state, and only when
 * a human happens to run Refresh — until then the file is fully committable, so a
 * managed file introduced marker-less (a hand-port, a copy, a linter strip) can sit
 * unnoticed indefinitely. This is a read-only ASSERTION of the same on-disk state
 * Refresh checks, meant to run at commit/CI time instead of reactively:
 *
 *   - `'warning'` — markers are gone but the body is still byte-identical to the
 *     template, so {@link tryAutoHealManagedRegion} (the same logic Refresh uses)
 *     can restore the markers losslessly. Not urgent, but worth surfacing: markers
 *     do not vanish on their own, so something stripped them.
 *   - `'error'`   — markers are gone AND the body has diverged from the template.
 *     Refresh cannot prove a heal is safe, so it will silently skip + warn this
 *     file FOREVER (never self-resolving) until a human restores the markers by
 *     hand. This is the actual bug: a diverged, marker-less managed file merges
 *     and stays merged with no gate ever catching it.
 */
export interface ManagedRegionMarkerViolation {
  /** The output path (relative to project root) missing valid markers. */
  readonly outputPath: string;
  /** `'error'` when the body diverged (unhealable); `'warning'` when it did not. */
  readonly severity: 'error' | 'warning';
  /** Human-readable, actionable message. */
  readonly message: string;
}

/** Message for a marker-less file whose body still matches the template exactly. */
function healableMarkersMessage(outputPath: string): string {
  return (
    `MinSpec-managed markers missing in ${outputPath}, but its content is unmodified — ` +
    'run "MinSpec: Refresh Harness Files" (auto-heal will restore the markers losslessly).'
  );
}

/** Message for a marker-less file whose body has diverged from the template. */
function divergedMarkersMessage(outputPath: string): string {
  return (
    `MinSpec-managed markers missing in ${outputPath}, AND its content has diverged from ` +
    'the template — Refresh cannot safely restore the markers and will skip this file ' +
    'silently. Upstream the local edit into the MinSpec template, then re-scaffold ' +
    '("Re-scaffold (overwrite)") to restore markers.'
  );
}

/**
 * Assert every {@link MANAGED_REGION_TEMPLATES} output path present on disk carries
 * valid start/end markers (#760 harden). Absent files are skipped — Refresh
 * re-scaffolds those, so a file that was never created is not this gate's concern.
 * A tool-gated template whose tool is not detected is skipped, mirroring
 * `refreshManagedRegionTemplates`.
 *
 * `exclude` names templates whose canonical source is the CALLING project's own
 * working file rather than a scaffolded output (minspec's own repo authors the
 * #564 CI-review-stack files directly and gates their freshness a different way —
 * see `SELF_HOSTED_TEMPLATE_NAMES` in template-registry.ts); every other project
 * that scaffolds FROM these templates has no such exclusion.
 */
export function checkManagedRegionMarkers(
  rootDir: string,
  tools: DetectedTools,
  opts?: { readonly exclude?: readonly string[] },
): ManagedRegionMarkerViolation[] {
  const exclude = new Set(opts?.exclude ?? []);
  const violations: ManagedRegionMarkerViolation[] = [];

  for (const tpl of MANAGED_REGION_TEMPLATES) {
    if (exclude.has(tpl.name)) continue;
    if (tpl.condition && !tpl.condition(tools)) continue;

    const fullPath = path.join(rootDir, tpl.outputPath);
    if (!fs.existsSync(fullPath)) continue;

    const onDisk = fs.readFileSync(fullPath, 'utf-8');
    const startMarker = managedRegionStartMarker(tpl.name, tpl.commentStyle);
    const endMarker = managedRegionEndMarker(tpl.name, tpl.commentStyle);
    if (splitManagedRegion(onDisk, startMarker, endMarker)) continue;

    const healed = tryAutoHealManagedRegion(onDisk, tpl, startMarker, endMarker);
    violations.push(
      healed !== null
        ? { outputPath: tpl.outputPath, severity: 'warning', message: healableMarkersMessage(tpl.outputPath) }
        : { outputPath: tpl.outputPath, severity: 'error', message: divergedMarkersMessage(tpl.outputPath) },
    );
  }

  return violations;
}

/**
 * What MinSpec did NOT author during this run, so the manifest does not claim it
 * did (#1697 F1).
 *
 * `generated-hashes.json` is read back as the merge's authorship baseline: a
 * recorded hash that equals the on-disk body is taken as proof MinSpec wrote that
 * body, which licenses replacing it with the current template. Recording a hash
 * for content MinSpec never wrote is therefore not a harmless inaccuracy — it is a
 * forged permission slip, and the next refresh cashes it.
 */
export interface ManifestAuthorship {
  /**
   * relPath → heading → hash of the TEMPLATE body MinSpec rendered for that
   * heading and then declined to write, from
   * {@link MergeResult.withheldTemplateHashes}. Recorded INSTEAD of the on-disk
   * hash for those headings, so the next refresh sees the divergence as evidence
   * the body is the user's rather than re-deciding it from absence.
   */
  readonly withheld?: { readonly [relPath: string]: SectionHashes };
  /**
   * relPaths whose bytes MinSpec did not RENDER this run — the files the template
   * loop skipped because they already existed (`seedConstitution` and
   * `generateSlashCommandShims` run after that loop and may still write to one). MinSpec rendered a template, found a file
   * already there, and wrote none of it, so it has no NEW claim to make about any
   * section: the run must not hash those bytes and call them its own output. A
   * project with no prior manifest therefore gets no entry, and its first refresh
   * reaches the fail-closed branch honestly instead of reading the user's own bytes
   * back as its own handiwork.
   *
   * Making no new claim is NOT the same as retracting the old one. Any entry the
   * previous run recorded for such a file is CARRIED FORWARD verbatim: it is
   * MinSpec's own record of what it last wrote there, it is still the correct merge
   * baseline, and dropping it would silently demote a project that has a valid
   * baseline to the fail-closed path — freezing its harness — every time Initialize
   * is re-run. Initialize is explicitly re-runnable, so that is the common path.
   */
  readonly unauthored?: readonly string[];
  /**
   * relPath → headings MinSpec has NO hash it may honestly record, from
   * {@link MergeResult.unauthoredHeadings}. DELETED from the disk-derived
   * recording rather than corrected (#1697 NEW-2/NEW-3).
   *
   * `unauthored` is this rule at whole-file granularity; this is the same rule one
   * level down, for a file MinSpec did write but whose individual sections it did
   * not. The recorder hashes final disk, so every user-added section in a managed
   * file — the documented, supported thing to do with these files — was being
   * hashed and filed as MinSpec's own output. There is no correction available for
   * those headings, because MinSpec rendered no body to record in their place: the
   * only true record is none.
   *
   * The absence is load-bearing, not cosmetic. `mergeFile` reads a missing baseline
   * as "no evidence" and fails closed, so an omitted heading is precisely what makes
   * a future template carrying that same heading HOLD the user's body and report it,
   * instead of spending a claim MinSpec never had the right to make.
   */
  readonly unauthoredSections?: { readonly [relPath: string]: readonly string[] };
}

/**
 * Compose ONE file's persisted manifest entry: the disk-derived hashes, corrected
 * for the two things disk cannot tell you (#1697 F1 / NEW-2 / NEW-3).
 *
 * This is the CORRECTION half of "what baseline will the next refresh read?", and
 * it is exported so that half has exactly one implementation (#1697 NEW-A3). The
 * other half is the argument: `sectionHashesFromMarkdown` over the bytes actually on
 * disk, which a real refresh reads AFTER the post-merge writers (`seedConstitution`,
 * the AGENTS.md slash injection) have run. A caller who wants the whole answer owes
 * both halves; sharing this one does not compose the other for them.
 *
 * `mergeFile` used to return a per-branch hash map that looked like the whole answer
 * and was not — it hashed template bodies before `sectionsToMarkdown` normalized
 * them and before the post-merge writers ran, so a caller who fed it back pinned
 * sections the real manifest kept tracking (measured: `3d74d181…` at the branch
 * against `2741b60e…` on disk). The map is gone; the product and its tests now call
 * THIS rather than each composing their own, so a change to the correction rule
 * reaches both at once. `merge-refresh.test.ts` AC-63 pins the pair against a real
 * refresh.
 *
 * @param diskHashes         `sectionHashesFromMarkdown` over the bytes actually written
 * @param withheld           headings whose template body MinSpec rendered but declined
 *                           to write → the hash of that unwritten body
 * @param unauthoredSections headings MinSpec rendered no body for at all
 */
export function applyAuthorshipCorrections(
  diskHashes: SectionHashes,
  withheld?: SectionHashes,
  unauthoredSections?: readonly string[],
): SectionHashes {
  // Rebuilt by spreading the disk map first, so section key order stays
  // `parseSections` document order and the serialization stays byte-stable
  // across identical runs (SPEC-043 INV-4).
  const corrected: Record<string, string> = { ...diskHashes };
  if (withheld) {
    for (const heading of Object.keys(withheld)) {
      // A heading the recorder did not hash is not corrected — a withheld heading
      // no longer on disk would otherwise add a manifest entry for a section that
      // does not exist, which is the class of lie this module exists to prevent.
      //
      // With ONE documented exception, and it is #1752's class again: `in` walks the
      // prototype chain, so for the eight `Object.prototype` names (`constructor`,
      // `toString`, `valueOf`, …) this test passes on a heading disk does NOT carry,
      // and the entry is invented. Measured: `{Invariants}` plus a withheld
      // `constructor` yields a `constructor` key. Latent rather than live — a
      // withheld hash exists only for a heading the TEMPLATE also carries, and
      // MinSpec ships no template heading with a prototype name (checked: zero) — so
      // it is filed with #1752 rather than patched here, and the fix is the same one:
      // `Object.create(null)` for every heading-keyed map.
      if (heading in corrected) corrected[heading] = withheld[heading];
    }
  }
  // Deleted, not corrected: MinSpec rendered no body for these headings, so there
  // is no hash it may honestly file for them (#1697 NEW-2/NEW-3). Applied AFTER
  // the withheld overrides so a heading that legitimately has a withheld template
  // hash keeps it — the two sets are disjoint by construction in `mergeFile`, and
  // this ordering makes that independent of it.
  if (unauthoredSections) {
    for (const heading of unauthoredSections) delete corrected[heading];
  }
  return corrected;
}

/**
 * Record the hash manifest from the FINAL on-disk bytes, run the fail-closed
 * self-check, and persist it LAST (SPEC-043 D1/D2/D7 + Slice 2 gate).
 *
 * MUST be called only after EVERY write path — the section-merge loop,
 * `seedConstitution`, and `generateSlashCommandShims`'s AGENTS.md injection — has
 * run, so the manifest equals disk by construction no matter which mechanism last
 * touched a file. For each present {@link TEMPLATE_OUTPUT_PATHS} file, records
 * `sectionHashesFromMarkdown(disk)`; a tracked file absent on disk is skipped, and
 * any key not in the current tracked set is pruned by rebuilding the manifest from
 * scratch (FR-3a stale-key prune).
 *
 * That recording IS the active #890 fix: the manifest is a faithful hash of final
 * disk. The subsequent {@link verifyGeneratedHashesConsistent} call is a FAIL-CLOSED
 * TRIPWIRE, not active runtime protection — it re-reads the SAME final disk with the
 * SAME helper the recording just used, so in this correct code it is green by
 * construction and CANNOT throw here (Slice 1 guarantees record == verify). It earns
 * its place by failing closed — throwing before `saveHashes`, so nothing is persisted
 * and the last-good manifest survives (INV-3 / D4) — only if a FUTURE refactor
 * reintroduces a record-before-write path (recording the manifest from a non-disk
 * source, or before a later mutator) that makes the recorded set diverge from final
 * disk. The predicate is exported and reusable for that guarantee and for an
 * independent commit/CI-time consistency check (#760); it does not defend #890 alone.
 *
 * ── The `authorship` argument, and what it narrows (#1697 F1) ────────────────
 *
 * "Record the final bytes on disk" is the right rule for every byte MinSpec WROTE,
 * and the wrong rule for the bytes it merely found there. `mergeFile` keeps the
 * user's body whenever the evidence says the section is theirs (or says nothing at
 * all), and `generateHarnessFiles` writes nothing to a file that already exists in
 * the template loop (`seedConstitution` and `generateSlashCommandShims` run after it
 * and can write to one) — so a straight disk recording ends up asserting MinSpec
 * authored a paragraph it has just gone out of its way not to touch. Because that
 * manifest is exactly what the NEXT merge consults, the assertion is
 * self-fulfilling: `oldHash ===
 * existingHash` reads as "pristine template" and the template overwrites the
 * paragraph, unreported. That is bug #1697, one refresh later.
 *
 * So the recording is disk-derived by default and corrected in three places only:
 * headings in `authorship.withheld` record the template body MinSpec generated but
 * did not write, headings in `authorship.unauthoredSections` are recorded not at
 * all, and files in `authorship.unauthored` are recorded not at all.
 *
 * The self-check runs against the DISK-DERIVED map, before the corrections are
 * applied, and therefore keeps exactly the strength it had: every hash it can
 * check is still checked against the same final disk, and a record-before-write
 * regression still fails closed. The corrections are deliberately outside its
 * remit because they are not claims about disk — verifying them against disk would
 * be a category error, and would abort every refresh that preserved user content.
 *
 * This narrows SPEC-043's INV-1 from "every recorded hash equals disk" to "every
 * hash MinSpec RECORDS FOR ITS OWN OUTPUT equals disk", which is the property the
 * manifest's only consumer actually needs. `verifyGeneratedHashesConsistent` read
 * back over a persisted manifest can now legitimately report a withheld heading, so
 * an offline commit/CI-time check built on it (#760) must be given the same
 * authorship information rather than assuming a pure disk mirror.
 */
export function recordVerifyAndSaveManifest(
  rootDir: string,
  authorship: ManifestAuthorship = {},
): void {
  const unauthored = new Set(authorship.unauthored ?? []);
  // PROVEN entries only (#1697 NEW-A2, closing #1718 pre-fix manifest migration
  // gap — Initialize is the second door into the same drawer). The carry-forward
  // re-persists whatever it
  // reads, and `saveHashes` stamps everything it writes — so reading the raw
  // manifest here would take a pre-#1697 file whose entries were copied off disk,
  // stamp them, and hand them the authority the stamp confers. Initialize is
  // explicitly re-runnable, so that is a one-command laundering path, and the
  // refresh gate would never see the entries again to catch it. An upgraded project
  // therefore drops its old baseline on the first Initialize as well as on the first
  // Refresh, and reaches the fail-closed path honestly on the next merge.
  const priorHashes: GeneratedHashes =
    unauthored.size > 0 ? loadProvenHashes(rootDir).proven : {};

  // Disk-derived and therefore self-checkable: the files MinSpec wrote this run.
  const allHashes: Record<string, SectionHashes> = {};
  // Prior claims about files MinSpec did NOT write this run, preserved as-is. Not
  // re-verified against disk on purpose — the file may well have diverged since it
  // was recorded, and detecting exactly that divergence is what the baseline is for.
  const carriedForward: Record<string, SectionHashes> = {};

  for (const name of TEMPLATE_NAMES) {
    const relativePath = TEMPLATE_OUTPUT_PATHS[name];
    // MinSpec wrote nothing to this file this run → it has no NEW hash to record
    // for any section of it, so its bytes are never hashed as MinSpec's output
    // (#1697 F1). Whatever the previous run recorded still stands.
    if (unauthored.has(relativePath)) {
      const prior = priorHashes[relativePath];
      if (prior) carriedForward[relativePath] = prior;
      continue;
    }
    const fullPath = path.join(rootDir, relativePath);
    if (!fs.existsSync(fullPath)) continue; // absent tracked file → skip (FR-3a)
    const disk = fs.readFileSync(fullPath, 'utf-8');
    allHashes[relativePath] = sectionHashesFromMarkdown(disk);
  }

  const inconsistencies = verifyGeneratedHashesConsistent(rootDir, allHashes);
  if (inconsistencies.length > 0) {
    const detail = inconsistencies
      .map(
        (v) =>
          `  - ${v.filePath} › ${v.heading}: manifest ${v.recorded.slice(0, 8)} ≠ disk ${v.onDisk.slice(0, 8)}`,
      )
      .join('\n');
    throw new Error(
      'MinSpec refresh aborted: the generated-hashes manifest disagrees with the files ' +
        'on disk (a recorded section hash does not match its on-disk content). Nothing was ' +
        'persisted; the previous manifest is intact. Re-run "MinSpec: Refresh Harness Files".\n' +
        detail,
    );
  }

  // Apply the authorship corrections AFTER the self-check (#1697 F1). These are
  // not claims about disk, so they are not the self-check's business; see the
  // docstring, and {@link applyAuthorshipCorrections} for the correction rule
  // itself — which tests read from here rather than reimplementing, so a change to
  // that rule reaches the product and its tests together (#1697 NEW-A3). It does not
  // make the two manifests identical by construction: each side still composes its
  // own disk argument. `merge-refresh.test.ts` AC-63 is what pins the pair against a
  // real refresh.
  //
  // Assembled in TEMPLATE_NAMES order so the file-key order — and therefore the
  // serialized bytes — is the same whether an entry came from disk or was carried
  // forward (SPEC-043 INV-4 byte-stability). Only tracked names are visited, which
  // is also what prunes stale keys (FR-3a).
  const persisted: Record<string, SectionHashes> = {};
  for (const name of TEMPLATE_NAMES) {
    const relativePath = TEMPLATE_OUTPUT_PATHS[name];
    const carried = carriedForward[relativePath];
    if (carried) {
      persisted[relativePath] = carried;
      continue;
    }
    const diskHashes = allHashes[relativePath];
    if (!diskHashes) continue;
    const withheld = authorship.withheld?.[relativePath];
    const unauthoredSections = authorship.unauthoredSections?.[relativePath];
    // Nothing to correct → the disk map IS the entry. Kept as a distinct path only
    // to avoid re-allocating an identical object; `applyAuthorshipCorrections`
    // returns the same content for these arguments.
    if (!withheld && (!unauthoredSections || unauthoredSections.length === 0)) {
      persisted[relativePath] = diskHashes;
      continue;
    }
    persisted[relativePath] = applyAuthorshipCorrections(
      diskHashes,
      withheld,
      unauthoredSections,
    );
  }

  saveHashes(rootDir, persisted);
}

/**
 * Generate all harness files from templates.
 * The template loop only writes files that do not already exist (first-time init);
 * `seedConstitution` and `generateSlashCommandShims` run after it and can write to a
 * file that was already there.
 * Stores initial section hashes for future merge-on-refresh.
 */
export function generateHarnessFiles(rootDir: string): string[] {
  // Ensure .minspec/ exists
  scaffold(rootDir);
  // Returned, not discarded. `initCommand` is re-runnable and is NOT gated on
  // first-init, so Initialize on an already-broken repo — the exact population
  // this reconcile targets — reaches here and can perform a `git rm --cached`.
  // Discarding it would leave that index change silent on the init path while the
  // refresh path reports it: the same G-8 defect, one caller over (#1146 review).
  const untracked = ensureGitignoreEntries(rootDir);

  const config = loadConfig(rootDir);
  const context = buildContext(rootDir, config);
  const rendered = renderAll(context);

  // Files that were already there, so MinSpec wrote none of their bytes. Tracked
  // because the manifest must NOT be recorded for them (#1697 F1): recording the
  // user's own file as MinSpec's output is what makes the very next Refresh call a
  // hand-written paragraph an untouched template and delete it. `initCommand` is
  // explicitly re-runnable, so this is the ordinary path, not an edge case — and
  // it is the one the fail-closed merge branch never even reaches, because by then
  // a matching baseline already exists.
  const skippedExisting: string[] = [];

  for (const name of TEMPLATE_NAMES) {
    const relativePath = TEMPLATE_OUTPUT_PATHS[name];
    const fullPath = path.join(rootDir, relativePath);
    const content = rendered.get(name)!;

    // Only write if file doesn't exist (first-time generation). The manifest is
    // recorded LAST from the final on-disk bytes (SPEC-043), not here.
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    } else {
      skippedExisting.push(relativePath);
    }
  }

  // SPEC-025 FR-4/FR-5: seed the freshly written constitution so first-init is
  // never empty. Best-effort — a proposer failure must never break init. Writes
  // the file only; no longer a manifest source (SPEC-043 D8).
  try {
    seedConstitution(rootDir);
  } catch {
    // best-effort — the constitution stays as the template scaffold on failure.
  }

  // Record the raw-template baseline so drift detection compares like-for-like
  // (raw template now vs raw template at generation), never raw vs the rendered/
  // user-merged content in generated-hashes.json — the cause of #117's perpetual
  // false-positive drift toast.
  saveTemplateBaseline(rootDir, computeTemplateBaseline());

  // Scaffold managed-region templates (#249, #241) — harness artifacts the Markdown
  // section-merge engine cannot carry (CI workflow, git hooks) PLUS the tool-gated
  // slash-command shims — wrapping MinSpec's content in comment-delimited markers. No
  // content baseline is recorded: the markers themselves are the boundary Refresh uses
  // to update only MinSpec's region. Tools are detected here, AFTER the Markdown
  // templates are written, so freshly-written CLAUDE.md / .cursorrules gate the shims.
  const tools = detectTools(rootDir);
  generateManagedRegionTemplates(rootDir, tools);

  // Wire the just-scaffolded Claude Code hooks into .claude/settings.json (#1093) —
  // the hook files are inert until the event lists them.
  registerClaudeHooks(rootDir, tools);

  // Clean up any pre-#534 bare-name Claude shims left behind by a prior init of
  // this same directory (defensive — a fresh init normally has none).
  migrateLegacyClaudeSlashCommandShims(rootDir);

  // Point git at the scaffolded editor-independent hooks so terminal / other-editor
  // / AI-agent commits run the SDD gates too (DR-037, #247). Idempotent + fail-quiet.
  ensureHooksPath(rootDir);

  // Inject the AGENTS.md slash-command marker section (already merge-safe). The Claude
  // per-command files and the Cursor file are now owned by the managed-region path
  // above, so this is a no-op for those (they already exist with markers); it remains
  // the writer for the AGENTS.md table.
  generateSlashCommandShims(rootDir, { tools });

  // SPEC-043 D1/D2/D7: record the manifest from the FINAL on-disk bytes (after the
  // AGENTS.md slash injection) and persist LAST — the active #890 fix. The embedded
  // self-check is a fail-closed tripwire (green by construction here; guards a future
  // record-before-write regression, INV-3 / D4), not standalone #890 protection.
  //
  // …except for the files above that already existed, which are recorded not at all
  // (#1697 F1): "record the final bytes on disk" is only truthful about bytes
  // MinSpec put there.
  recordVerifyAndSaveManifest(rootDir, { unauthored: skippedExisting });

  return untracked;
}

/**
 * Refresh harness files — merge template updates with user edits.
 * Uses section-level hashing to preserve user modifications.
 *
 * For each generated file:
 *   - User-modified sections (hash differs from the recorded baseline) → preserved
 *   - Sections PROVEN unmodified (hash equals the recorded baseline) → updated
 *     from latest template
 *   - Sections with NO recorded baseline → preserved, and REPORTED when the
 *     template carried content the kept body did not (#1697): a missing baseline
 *     is no evidence, and `generated-hashes.json` is gitignored machine-local
 *     state, so it is absent in every fresh clone and worktree. The report
 *     compares normalized CONTENT, not bytes — MinSpec's own post-merge writers
 *     leave `renderTemplate` output permanently byte-different from disk, so a
 *     byte test warned about a project nobody had edited (F3)
 *   - New template sections → appended
 *   - User-added sections (not in template) → preserved, and recorded in the
 *     manifest NOT AT ALL: MinSpec rendered no body for that heading, so hashing
 *     the bytes it found there would file the user's own prose as its own output
 *     and license the next template that ships the heading to overwrite it
 *     (#1697 NEW-2)
 *
 * Returns the notices the vscode-aware caller should surface: sections held for
 * lack of a baseline, files left untouched because their MinSpec markers were
 * deleted, paths removed from the git index, and a project-name mismatch. An empty
 * array means a fully clean refresh.
 */
export function refreshHarnessFiles(rootDir: string): ManagedRegionWarning[] {
  // Ensure .minspec/ exists
  scaffold(rootDir);
  // Backfill any missing ignore entries on auto-refresh-on-open so existing
  // projects (scaffolded before a new state file was added) stop committing
  // machine-local merge-refresh state. Idempotent — adds only what's missing.
  // Its return is the set of paths removed from the git index; it is REPORTED at
  // the end of this function, never discarded (#1146 review).
  const untrackedOnRefresh = ensureGitignoreEntries(rootDir);

  const config = loadConfig(rootDir);
  const context = buildContext(rootDir, config);

  // #1529: the directory's name is a guess, and the harness on disk is the witness.
  // When the guess loses, say so — a rename averted with no notice is the same
  // "no silent gate" failure, just in the safe direction.
  const projectName = resolveProjectName(rootDir, config);
  const projectNameWarnings: ManagedRegionWarning[] =
    projectName.source === 'recorded' && projectName.recorded
      ? [
          {
            outputPath: path.join('.minspec', 'config.json'),
            message: projectNameMismatchMessage(projectName.recorded, projectName.basename),
            kind: 'project-name-mismatch' as const,
          },
        ]
      : [];

  // Prior manifest — the merge DECISION input only (which body to keep, INV-5).
  // It is NOT the recorded manifest: that is rebuilt LAST from final on-disk bytes.
  //
  // Read as EVIDENCE, so it is loaded through the gate that decides what may be
  // spent (#1697 NEW-A2, closing #1718 pre-fix manifest migration gap: the fix
  // stopped MinSpec MINTING a false authorship claim, and this is what stops it
  // CASHING one an older build already wrote). A manifest written before the
  // authorship rules existed was
  // built by hashing final disk, user paragraphs included; every entry in it is
  // shaped exactly like a true one and none of them is. `proven` is empty for such a
  // file, which drops this refresh onto the fail-closed path for every section — the
  // same path a fresh clone takes, with the same one-time notice, after which the
  // manifest has been rewritten under the current rules and refreshes are quiet
  // again.
  const baseline = loadProvenHashes(rootDir);
  const priorHashes: GeneratedHashes = baseline.proven;

  // Sections the merge held for lack of a baseline (#1697), collected per file and
  // surfaced as ONE notice for the whole refresh (F3). REPORTED at the end of this
  // function, never discarded: a withheld update the user is not told about is the
  // same "no silent gate" failure as the silent overwrite this fix removed, just in
  // the safe direction (invariant 2).
  const preservedByFile: PreservedWithoutBaselineFile[] = [];

  // Per file, the headings whose body the merge KEPT while withholding the
  // template it had rendered → the hash of that unwritten template body. Fed to
  // the recorder so the manifest records what MinSpec GENERATED for those
  // headings, never the user bytes it declined to replace (#1697 F1). Without
  // this the recording below launders every hold into a matching baseline and the
  // next refresh overwrites the content this one just protected — silently, since
  // the fail-closed report only fires while the baseline is absent.
  const withheldByFile: Record<string, SectionHashes> = {};

  // Per file, the headings the merge kept but has NO honest hash for — sections the
  // template does not contain (every user-added section) and INV-2 guard holds it
  // cannot prove are its own. Fed to the recorder so those headings are OMITTED
  // rather than hashed from disk (#1697 NEW-2/NEW-3). Without this the recording
  // below files the user's own prose as MinSpec's output, and the next template to
  // ship the same heading reads that as permission to overwrite it — #1697's
  // mechanism, in the one path the manifest correction did not reach.
  const unauthoredByFile: Record<string, readonly string[]> = {};

  for (const name of TEMPLATE_NAMES) {
    const relativePath = TEMPLATE_OUTPUT_PATHS[name];
    const fullPath = path.join(rootDir, relativePath);
    const generated = renderTemplate(name, context);

    if (!fs.existsSync(fullPath)) {
      // File doesn't exist yet — write fresh
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, generated);
    } else {
      // File exists — merge (decision logic + oldHashes reads unchanged, INV-5).
      const existing = fs.readFileSync(fullPath, 'utf-8');
      const oldHashes = priorHashes[relativePath] ?? {};
      const { merged, preservedWithoutBaseline, withheldTemplateHashes, unauthoredHeadings } =
        mergeFile(existing, generated, oldHashes);
      fs.writeFileSync(fullPath, merged);
      if (Object.keys(withheldTemplateHashes).length > 0) {
        withheldByFile[relativePath] = withheldTemplateHashes;
      }
      if (unauthoredHeadings.length > 0) {
        unauthoredByFile[relativePath] = unauthoredHeadings;
      }
      if (preservedWithoutBaseline.length > 0) {
        preservedByFile.push({ outputPath: relativePath, headings: preservedWithoutBaseline });
      }
    }
  }

  // SPEC-025 FR-4/FR-5: re-seed after merge so a still-empty section gains DRAFT
  // entries on refresh too; additive + idempotent, never overwrites human edits.
  // Writes the file only; no longer a manifest source (SPEC-043 D8).
  try {
    seedConstitution(rootDir);
  } catch {
    // best-effort — never break a refresh on a proposer failure.
  }

  // Re-record the raw-template baseline: after a refresh the user's files are in
  // sync with the current bundled template, so drift must read false until the
  // template next moves upstream (#117).
  saveTemplateBaseline(rootDir, computeTemplateBaseline());

  // Reconcile managed-region templates (#249, #241): re-scaffold if deleted, overwrite
  // only the marker-bounded MinSpec region (preserving the user's surrounding content),
  // or skip+warn if the markers were deleted. The slash-command shims ride this path
  // now, so a guidance update reaches existing projects and a drifted shim is brought
  // current — the create-only behaviour is gone. Collect warnings to return.
  const tools = detectTools(rootDir);
  const managedRegionWarnings = refreshManagedRegionTemplates(rootDir, tools);

  // Re-assert the Claude Code hook registration on refresh too, so a project
  // scaffolded before #1093 — or one whose .claude/settings.json was reset — gains
  // it. Idempotent: an existing registration is recognized and left alone.
  registerClaudeHooks(rootDir, tools);

  // Migrate a pre-#534 project off the bare-name Claude shims (#534): the new
  // `minspec-<cmd>.md` files were just (re-)scaffolded above, so the stale
  // `<cmd>.md` duplicates — if still pure MinSpec scaffolds — are safe to remove.
  migrateLegacyClaudeSlashCommandShims(rootDir);

  // Re-assert git's hooksPath on refresh too (a repo cloned without it, or whose
  // config was reset, regains the gate). Idempotent + fail-quiet (DR-037, #247).
  ensureHooksPath(rootDir);

  // Re-inject the AGENTS.md slash-command marker section (regenerated in place). The
  // Claude per-command files and the Cursor file are refreshed by the managed-region
  // path above, so this no longer owns them.
  generateSlashCommandShims(rootDir, { tools });

  // SPEC-043 D1/D2/D7: record the manifest from the FINAL on-disk bytes (after the
  // AGENTS.md slash injection) and persist LAST — the active #890 fix. The embedded
  // self-check is a fail-closed tripwire (green by construction here; guards a future
  // record-before-write regression, INV-3 / D4), not standalone #890 protection.
  //
  // …corrected for the sections the merge held (#1697 F1). Final disk is the right
  // source for every byte MinSpec wrote and the wrong one for the bodies it kept:
  // recording those makes the manifest claim authorship of the user's content, and
  // the next refresh spends that claim.
  recordVerifyAndSaveManifest(rootDir, {
    withheld: withheldByFile,
    unauthoredSections: unauthoredByFile,
  });

  // Report the index change. A `git rm --cached` is invisible in the editor
  // otherwise, and an unreported one is the exact G-8 / never-wrong failure this
  // feature's own docstring forbids — three reviewers on #1146 caught it discarded.
  const untrackedNotices: ManagedRegionWarning[] = untrackedOnRefresh.map((outputPath) => ({
    outputPath,
    message: untrackedNoticeMessage(outputPath),
    kind: 'untracked' as const,
  }));

  // One notice for every baseline-less hold this refresh made, across every file
  // (#1697 F3) — see {@link preservedWithoutBaselineMessage} for why it is not one
  // per file. `outputPath` names the first affected file so a consumer that reads
  // only that field still points at something real.
  const preservedNotices: ManagedRegionWarning[] =
    preservedByFile.length > 0
      ? [
          {
            outputPath: preservedByFile[0].outputPath,
            outputPaths: preservedByFile.map((f) => f.outputPath),
            // Why there was nothing to read, so the explanation matches what
            // actually happened (#1697 NEW-A2, #1718 pre-fix manifest migration
            // gap). A manifest MinSpec declined to spend is present on disk; telling
            // the reader it is "absent in a fresh clone" would send them looking for
            // a missing file that is right there, and a true hold explained by a
            // false reason is still a false statement. The merge's own classification
            // is FORWARDED rather than re-derived — through the single mapping named
            // just below, and no other — so the notice cannot disagree with the gate
            // about why the baseline was refused.
            //
            // `'proven'` maps to `'absent'`: the manifest was spendable and simply
            // carried no entry for these headings — a user-added section, or one an
            // earlier run recorded nothing for. That is the `'absent'` sentence's
            // second half, which is why it names the missing ENTRY as well as the
            // missing file.
            message: preservedWithoutBaselineMessage(
              preservedByFile,
              baseline.state === 'proven' ? 'absent' : baseline.state,
            ),
            kind: 'preserved-without-baseline' as const,
          },
        ]
      : [];

  // Content notices first: everything else here reports scaffolding or index
  // state, while these report that YOUR words were about to be replaced and were
  // not. That is the one a human must not miss (#1697).
  return [
    ...preservedNotices,
    ...managedRegionWarnings,
    ...untrackedNotices,
    ...projectNameWarnings,
  ];
}
