/**
 * dr-id-collision.ts — PURE decision logic for DR-id uniqueness (#1226).
 *
 * ## The defect this exists to close
 *
 * `nextAdrNumber` (packages/minspec/src/lib/adr-manager.ts:103) hands out
 * `max(existing DR-NNN) + 1` computed against the LOCAL checkout. That is correct
 * in isolation and unique only if DR creation is serialised through `main` —
 * which concurrent worktree sessions (#168, the normal working mode here) break
 * by design. Two sessions branching from the same `main` both compute the same
 * number, each correctly, and neither can see the other.
 *
 * Nothing then rejected the duplicate. `validateDrSequence` reports a `duplicate`
 * kind, but (a) only as a WARN, and (b) only for two FILE NAMES sharing a number —
 * it never reads the frontmatter `id:`, so a `DR-079.md` declaring `id: DR-077`
 * was invisible to every gate in the repo. And a blocked PR's number DECAYS: while
 * #1209 waited on a quota-blocked review it was renumbered twice in one day, and
 * ended up colliding with an ACCEPTED, MERGED DR-077 — merging it unchanged would
 * have overwritten an accepted decision record.
 *
 * ## Two halves, one definition of "the id"
 *
 *   A. `checkDeclaredDrIds` — offline, Tier-0, runs in the validator. Two decision
 *      files declaring one `id:` is a defect; so is a file whose declared `id:`
 *      disagrees with its own filename.
 *
 *   B. `decideDrIdCollision` — decides whether the ids a PR ADDS are free, against
 *      the base branch and every other open PR, and names the next free id.
 *
 * Half B keys on FILENAMES, because a PR's frontmatter is not cheaply readable
 * across every open PR (one content fetch per file per PR), whereas the file list
 * is one call. Half A's `id-filename-mismatch` rule is what makes that sound: if a
 * file could declare an id its name does not carry, it would walk straight past
 * half B. The two rules are a pair — do not drop one without the other.
 *
 * ## Purity
 *
 * No `fs`, no network, no `vscode`. Every function here is total and deterministic:
 * same input, same output, same order. The IO lives in the callers —
 * `scripts/validate-frontmatter.ts` (reads the decisions dir) and
 * `scripts/check-dr-id-collision.ts` (shells out to `gh`) — so the decisions can be
 * tested by CALLING them rather than by grepping a workflow for its own text, which
 * passes while inert.
 *
 * Nothing here is imported by `packages/` — the extension stays offline and
 * Tier-0 (constitution invariant 1); the cross-PR awareness lives only in CI.
 */

/** Minimum zero-pad width for a canonical DR id. Mirrors adr-manager's ADR_MIN_PAD_WIDTH. */
export const DR_ID_PAD_WIDTH = 3;

/** A DR id as written in frontmatter or a filename: `DR-` + digits. */
const DR_ID_RE = /^DR-(\d+)$/;

/** A decision FILE: `DR-` + digits, optional descriptor, `.md`. Mirrors adr-manager's ADR_FILE_RE. */
const DR_FILE_RE = /^DR-(\d+).*\.md$/;

/** The leading YAML frontmatter block. Mirrors adr-manager's FRONTMATTER_RE. */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

/** PR file statuses that INTRODUCE a path. `modified` does not: that file already exists on base. */
const CLAIMING_STATUSES = new Set(['added', 'renamed', 'copied']);

/** Canonical, zero-padded id for a DR number: `1` → `DR-001`, `1234` → `DR-1234`. */
export function formatDrId(num: number): string {
  return `DR-${String(num).padStart(DR_ID_PAD_WIDTH, '0')}`;
}

/**
 * The DR number an id string denotes, or `undefined` if it is not a DR id.
 * `DR-77` and `DR-077` both denote 77 — padding is spelling, not identity, so two
 * files spelling one number differently must still collide.
 */
export function drNumberFromId(id: string): number | undefined {
  const match = id.trim().match(DR_ID_RE);
  if (!match) return undefined;
  const num = Number.parseInt(match[1], 10);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * The DR number a file path denotes, or `undefined` for a non-decision file.
 * Only the basename is read, so the caller decides which directory is in scope.
 * `INDEX.md`, `README.md` and anything not matching `DR-NNN*.md` return undefined.
 */
export function drNumberFromPath(filePath: string): number | undefined {
  const base = filePath.split('/').pop() ?? '';
  const match = base.match(DR_FILE_RE);
  if (!match) return undefined;
  const num = Number.parseInt(match[1], 10);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * The verbatim `id:` value declared in a document's leading frontmatter block, or
 * `undefined` when there is no frontmatter or no `id:` in it. Deliberately reads
 * ONLY the leading block, so a body line that merely looks like `id: DR-077` is
 * never mistaken for a declaration.
 */
export function declaredIdFromContent(content: string): string | undefined {
  return frontmatterField(content, 'id');
}

/**
 * The verbatim value of one field in a document's leading frontmatter block, or
 * `undefined` when there is no frontmatter, no such field, or the field is empty.
 *
 * Reads ONLY the leading block and only a line that STARTS with the field name, so
 * neither a body line that looks like `id: DR-077` nor a nested key under some other
 * mapping is ever mistaken for a declaration. An empty value reads as absent: a
 * record that says `title:` and nothing else has not declared a title.
 */
export function frontmatterField(content: string, field: string): string | undefined {
  const fm = content.match(FRONTMATTER_RE);
  if (!fm) return undefined;
  const re = new RegExp(`^${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.*)$`);
  for (const line of fm[1].split('\n')) {
    const match = line.match(re);
    if (match) {
      const value = match[1].trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

// ─── A. Local, offline duplicate-id check ────────────────────────────────────

/** One decision file's path and full text. */
export interface DrFile {
  /** Path as it should be reported — repo-relative for a legible CI/validator message. */
  file: string;
  content: string;
}

export type DrIdDefectKind = 'duplicate-id' | 'id-filename-mismatch';

export interface DrIdDefect {
  kind: DrIdDefectKind;
  /** Canonical id at issue, e.g. `DR-077`. */
  id: string;
  /** Files involved, sorted. */
  files: string[];
  message: string;
}

/**
 * Find decision files that collide on a DR id, or whose declared id disagrees with
 * their filename.
 *
 * A file's id is its frontmatter `id:` when present, else the id in its filename —
 * exactly how `listAdrs` (adr-manager.ts) resolves a decision's identity, so this
 * gate and the extension agree on what a DR is called. Pre-MinSpec DRs carry no
 * frontmatter and are NOT a defect on that account; they still hold their filename
 * id against a duplicate.
 *
 * Non-decision files (`INDEX.md`, `README.md`, notes) are ignored entirely.
 *
 * Determinism: defects are sorted by id, then kind (`duplicate-id` before
 * `id-filename-mismatch`), then by the first file path.
 */
export function checkDeclaredDrIds(files: DrFile[]): DrIdDefect[] {
  const defects: DrIdDefect[] = [];
  /** canonical id → files claiming it */
  const byId = new Map<string, string[]>();

  for (const { file, content } of files) {
    const fromPath = drNumberFromPath(file);
    if (fromPath === undefined) continue; // not a decision file

    const declared = declaredIdFromContent(content);
    const declaredNum = declared === undefined ? undefined : drNumberFromId(declared);

    // A declared id that is not a DR id at all (`id: SPEC-004`, `id: 77`) is as
    // wrong as one naming a different number, and is reported the same way — the
    // filename is the only representation half B can see, so they must agree.
    if (declared !== undefined && declaredNum !== fromPath) {
      defects.push({
        kind: 'id-filename-mismatch',
        id: formatDrId(fromPath),
        files: [file],
        message:
          `${file} declares \`id: ${declared}\` but its filename says ` +
          `${formatDrId(fromPath)}. The cross-PR uniqueness check reads FILENAMES ` +
          `(a PR's frontmatter is not readable across every open PR), so an id that ` +
          `disagrees with its own filename escapes it. Make the two match.`,
      });
    }

    const canonical = formatDrId(declaredNum ?? fromPath);
    byId.set(canonical, [...(byId.get(canonical) ?? []), file]);
  }

  for (const [id, claimants] of byId) {
    if (claimants.length < 2) continue;
    const sorted = [...claimants].sort();
    defects.push({
      kind: 'duplicate-id',
      id,
      files: sorted,
      message:
        `${id} is claimed by ${sorted.length} decision files (${sorted.join(', ')}). ` +
        `A DR id is the register's primary key — two records under one id means one ` +
        `of them cannot be cited, and an accepted decision can be overwritten. ` +
        `Renumber all but the earliest claim.`,
    });
  }

  const kindOrder: Record<DrIdDefectKind, number> = {
    'duplicate-id': 0,
    'id-filename-mismatch': 1,
  };
  return defects.sort(
    (a, b) =>
      a.id.localeCompare(b.id) ||
      kindOrder[a.kind] - kindOrder[b.kind] ||
      (a.files[0] ?? '').localeCompare(b.files[0] ?? ''),
  );
}

// ─── B. Cross-PR decision seam ───────────────────────────────────────────────

/** One entry from GitHub's `pulls/:n/files` payload (only the fields this gate reads). */
export interface PrFileEntry {
  filename: string;
  status: string;
  previous_filename?: string;
}

/**
 * The decision-dir paths a PR INTRODUCES, sorted.
 *
 * `added` / `renamed` / `copied` introduce a path; `modified` / `removed` /
 * `unchanged` do not — a modified DR already exists on the base branch, so editing
 * it is not a claim on its id. For a rename, `filename` is the NEW name, which is
 * exactly the claim being made.
 */
export function claimedPathsFromPrFiles(entries: PrFileEntry[], decisionsDir: string): string[] {
  const prefix = decisionsDir.replace(/\/+$/, '') + '/';
  return entries
    .filter((e) => CLAIMING_STATUSES.has(e.status))
    .map((e) => e.filename)
    .filter((f) => f.startsWith(prefix) && drNumberFromPath(f) !== undefined)
    .sort();
}

/** The decision-dir paths one pull request adds. */
export interface PrClaims {
  pr: number;
  paths: string[];
}

export interface DrIdCollisionInput {
  /** Repo-relative decisions dir, e.g. `docs/decisions`. */
  decisionsDir: string;
  /** Name of the base branch, used in the message (`main`). */
  baseRef: string;
  /** Every path in the decisions dir on the base branch's CURRENT tip (not the merge base). */
  basePaths: string[];
  /** The PR under test. */
  subject: PrClaims;
  /** Every OTHER open PR and the decision paths it adds. May include the subject; it is filtered. */
  otherPrs: PrClaims[];
}

export interface DrIdCollisionFinding {
  /** Canonical id, e.g. `DR-077`. */
  id: string;
  /** Who already holds it: the base ref name, `PR #NNNN`, or `this PR`. */
  heldBy: string;
  /** The holder's path (or the subject's own second path, for an intra-PR duplicate). */
  file: string;
}

export interface DrIdCollisionVerdict {
  ok: boolean;
  /** Canonical ids this PR adds, sorted. */
  claimed: string[];
  findings: DrIdCollisionFinding[];
  /** `max(base ∪ every open PR ∪ this PR) + 1`, canonical. */
  nextFreeId: string;
  /** Ready to print. Names the next free id whenever there is a collision. */
  message: string;
}

/**
 * Decide whether the DR ids a PR adds are free.
 *
 * Deliberately compares against the base branch's CURRENT TIP rather than the PR's
 * merge base: the failure being closed is precisely that a blocked PR's number
 * decays as other DRs land, and a merge-base comparison would call that "fine"
 * right up until the merge conflicts.
 *
 * `nextFreeId` is the max over EVERYTHING in flight plus one — base, every open PR,
 * and the subject itself — so the renumber it recommends does not land straight in
 * the next collision. It is computed unconditionally (also reported on a pass) so
 * the same number is available to a human reading a green run.
 *
 * Total and deterministic. A PR that adds no decision file passes: this check runs
 * on every PR so it stays satisfiable as a required check (a `paths:` filter would
 * make it unsatisfiable on every non-decision PR — the #560 silent-gate class,
 * DR-066).
 */
export function decideDrIdCollision(input: DrIdCollisionInput): DrIdCollisionVerdict {
  const { baseRef, basePaths, subject } = input;
  const otherPrs = input.otherPrs.filter((p) => p.pr !== subject.pr);

  /** canonical id → the first holder that is NOT the subject */
  const held = new Map<string, { heldBy: string; file: string }>();
  const allNumbers: number[] = [];

  const claim = (paths: string[], heldBy: string): void => {
    for (const file of [...paths].sort()) {
      const num = drNumberFromPath(file);
      if (num === undefined) continue;
      allNumbers.push(num);
      const id = formatDrId(num);
      if (!held.has(id)) held.set(id, { heldBy, file });
    }
  };

  // Base first, so `main` is named as the holder when both main and another PR
  // hold an id — the more actionable of the two (the accepted record is on main).
  claim(basePaths, baseRef);
  for (const pr of [...otherPrs].sort((a, b) => a.pr - b.pr)) {
    claim(pr.paths, `PR #${pr.pr}`);
  }

  const findings: DrIdCollisionFinding[] = [];
  const claimed: string[] = [];
  /** ids the subject has already claimed once, for intra-PR duplicate detection */
  const seenInSubject = new Map<string, string>();

  for (const file of [...subject.paths].sort()) {
    const num = drNumberFromPath(file);
    if (num === undefined) continue;
    allNumbers.push(num);
    const id = formatDrId(num);
    if (!claimed.includes(id)) claimed.push(id);

    const holder = held.get(id);
    if (holder) {
      findings.push({ id, heldBy: holder.heldBy, file: holder.file });
      continue;
    }
    const twin = seenInSubject.get(id);
    if (twin !== undefined) {
      findings.push({ id, heldBy: 'this PR', file });
    } else {
      seenInSubject.set(id, file);
    }
  }

  // Dedupe: a subject that claims one id under TWO filenames while the base also
  // holds it hits the `held` branch twice and would otherwise print the same holder
  // line twice. The collision is one fact, so report it once.
  const seenFinding = new Set<string>();
  const unique = findings.filter((f) => {
    const key = `${f.id}\x00${f.heldBy}\x00${f.file}`;
    if (seenFinding.has(key)) return false;
    seenFinding.add(key);
    return true;
  });
  unique.sort((a, b) => a.id.localeCompare(b.id) || a.file.localeCompare(b.file));
  findings.length = 0;
  findings.push(...unique);
  claimed.sort();

  const nextFreeId = formatDrId(allNumbers.length === 0 ? 1 : Math.max(...allNumbers) + 1);
  const ok = findings.length === 0;

  return { ok, claimed, findings, nextFreeId, message: renderMessage(input, { ok, claimed, findings, nextFreeId }) };
}

/**
 * Render the verdict. On a failure this MUST name the next free id — the whole
 * point of the gate is that the fix is one rename with no guesswork, and the
 * previous state of the world (a human eyeballing `max+1` in a stale checkout) is
 * exactly what produced two renumbers of #1209 in one day.
 */
function renderMessage(
  input: DrIdCollisionInput,
  v: Pick<DrIdCollisionVerdict, 'ok' | 'claimed' | 'findings' | 'nextFreeId'>,
): string {
  if (v.ok) {
    return v.claimed.length === 0
      ? `DR id check: this PR adds no decision record. Nothing to collide. (Next free id: ${v.nextFreeId}.)`
      : `DR id check: ${v.claimed.join(', ')} ${v.claimed.length === 1 ? 'is' : 'are'} free ` +
          `on ${input.baseRef} and across every open PR. (Next free id: ${v.nextFreeId}.)`;
  }

  const lines = v.findings.map(
    (f) => `  • ${f.id} is already claimed by ${f.heldBy} (${f.file})`,
  );
  const plural = v.findings.length === 1 ? 'id is' : 'ids are';

  return [
    `DR id collision — ${v.findings.length} ${plural} already taken:`,
    ...lines,
    '',
    `Next free id: ${v.nextFreeId} — the max across ${input.baseRef} AND every open PR, plus one.`,
    `Renumber this PR's decision to ${v.nextFreeId}:`,
    `  1. git mv ${input.decisionsDir}/<file> ${input.decisionsDir}/${v.nextFreeId}.md`,
    `  2. update \`id:\` in its frontmatter to ${v.nextFreeId}`,
    '  3. regenerate the register index (MinSpec: Regenerate DR INDEX)',
    '  4. update the PR title and any prose references',
    '',
    'Why this is fatal rather than a warning: a DR id is the register\'s primary key.',
    'Two records under one id means one of them cannot be cited, and merging over an',
    'already-accepted decision overwrites it silently (#1226).',
  ].join('\n');
}

// ─── C. In-place repurposing ─────────────────────────────────────────────────

/**
 * Frontmatter fields that say WHICH decision a record IS, as opposed to what it
 * currently says. An amendment edits the body, `status:` and dated amendment
 * sections; it does not change the record's identity.
 *
 * Order is the report order, so a wholesale swap reads id, then title, then
 * provenance — narrowest to widest.
 */
export const DR_IDENTITY_FIELDS = ['id', 'title', 'triggered_by'] as const;

export type DrIdentityField = (typeof DR_IDENTITY_FIELDS)[number];

/** One modified decision file, as it stands on the base ref and on the PR head. */
export interface DrRevision {
  /** Repo-relative path, identical on both sides (a rename is a CLAIM, handled by half B). */
  file: string;
  /** Full text on the base branch's tip. */
  base: string;
  /** Full text on the PR head. */
  head: string;
}

export interface DrRepurposeFinding {
  file: string;
  field: DrIdentityField;
  /** The value on base. Always defined — an absent base value is not a finding. */
  base: string;
  /** The value on head, or `undefined` when the field was REMOVED. */
  head: string | undefined;
}

export interface DrRepurposeVerdict {
  ok: boolean;
  findings: DrRepurposeFinding[];
  /**
   * The label that turned a block into a recorded act, when one was present AND there
   * was something to acknowledge. `undefined` on a clean PR, so "nothing changed" and
   * "a change was waved through" never read the same in a log.
   */
  acknowledgedBy?: string;
  /** Ready to print. Quotes both sides of every changed field. */
  message: string;
}

/**
 * The PR label that converts a repurposing BLOCK into a recorded, reviewable act (#1982).
 *
 * The gate exists so a decision record cannot be replaced SILENTLY - not so it can never
 * be replaced. A DR created with a typo in its title, or the wrong `triggered_by:`, had
 * no in-band path at all: the check is required and had no bypass, so the only routes
 * were an admin merge or superseding the record with a new one.
 *
 * **This is an audit trail plus a speed bump, not a control, and it must not be sold as
 * one.** Whoever opens the PR can add the label, including an agent. What it buys is that
 * the act is named on the PR, appears in the check output, and is visible to the reviewers
 * — which is the property that was actually missing. Preventing it outright was never the
 * goal; #1756 was caught by review, and review is what this keeps in the loop.
 */
export const DR_IDENTITY_ACK_LABEL = 'dr-identity-change';

/**
 * Decide whether a PR is AMENDING existing decision records or REPURPOSING them.
 *
 * ## The failure this closes (#1757)
 *
 * Half B keys on the paths a PR INTRODUCES, because a claim on a number is what it
 * was built to catch. `modified` is excluded there and correctly so — a file that
 * already exists on both sides is not claiming anything. But that exclusion made an
 * entire second failure shape invisible: PR #1756 wrote a completely different
 * decision over the existing `DR-088.md` (`title:`, `triggered_by:` and the heading
 * all swapped) while DR-088 was merged and `status: proposed`, i.e. in force. Both
 * this gate and the required `DR id uniqueness` check passed it.
 *
 * The two shapes differ in consequence, which is why one gate could not serve both.
 * A claim collision produces a DUPLICATE — noisy, and recoverable by renumbering.
 * Repurposing produces a DELETION — silent, and recoverable only from history.
 *
 * ## The rule
 *
 * For each identity field: a value present on base and different on head is a
 * finding. That covers a swap AND a removal.
 *
 * An absent base value is deliberately NOT a finding. Pre-MinSpec decision records
 * carry no frontmatter at all, and adding `id:`/`title:` to one is an upgrade rather
 * than a replacement — treating it as a defect would block the very migration the
 * register wants.
 *
 * Total and deterministic: findings sort by file, then by the order in
 * `DR_IDENTITY_FIELDS`.
 */
export function decideDrRepurposing(
  revisions: DrRevision[],
  opts: { labels?: readonly string[] } = {},
): DrRepurposeVerdict {
  const findings: DrRepurposeFinding[] = [];

  for (const { file, base, head } of [...revisions].sort((a, b) => a.file.localeCompare(b.file))) {
    for (const field of DR_IDENTITY_FIELDS) {
      const before = frontmatterField(base, field);
      if (before === undefined) continue; // nothing to lose; adding a field is an upgrade
      const after = frontmatterField(head, field);
      if (after !== before) findings.push({ file, field, base: before, head: after });
    }
  }

  // The findings are computed and REPORTED either way. Acknowledging changes the verdict,
  // never the visibility — a label that suppressed the detail would leave the reviewer
  // with less than before, which is the opposite of what it is for.
  const acknowledged = findings.length > 0 && (opts.labels ?? []).includes(DR_IDENTITY_ACK_LABEL);
  const ok = findings.length === 0 || acknowledged;

  return {
    ok,
    findings,
    ...(acknowledged ? { acknowledgedBy: DR_IDENTITY_ACK_LABEL } : {}),
    message: renderRepurposeMessage(findings, acknowledged),
  };
}

/**
 * Render the repurposing verdict, quoting BOTH sides of every changed field.
 *
 * Quoting both is the whole diagnostic. The reviewer's question is "is the record
 * under this number still the same decision?", and only the before-and-after answers
 * it — naming the field alone would send them to the diff to find out what a gate
 * already knew.
 */
function renderRepurposeMessage(findings: DrRepurposeFinding[], acknowledged = false): string {
  if (findings.length === 0) {
    return 'DR repurposing check: no existing decision record has its identity changed.';
  }

  const files = [...new Set(findings.map((f) => f.file))];
  const lines: string[] = [
    `DR repurposing — ${findings.length} identity field(s) changed on ${files.length} ` +
      `existing decision record(s):`,
  ];
  for (const file of files) {
    lines.push(`  ${file}`);
    for (const f of findings.filter((x) => x.file === file)) {
      lines.push(`    • ${f.field}: ${quote(f.base)}  →  ${f.head === undefined ? '(removed)' : quote(f.head)}`);
    }
  }

  if (acknowledged) {
    lines.push(
      '',
      `ACKNOWLEDGED by the \`${DR_IDENTITY_ACK_LABEL}\` label — passing, and recorded above.`,
      '',
      'This is deliberately a speed bump plus an audit trail, NOT a control: whoever',
      'opened this pull request could add that label, including an agent. What it buys',
      'is that the change is named on the PR and printed here, so the reviewers see it.',
      'Preventing the edit outright was never the point — #1756 was caught by review,',
      'and keeping review in the loop is what this preserves.',
      '',
      'If that is not what you meant, remove the label: the fields above are the ones',
      'that decide WHICH decision each record is.',
    );
    return lines.join('\n');
  }

  lines.push(
    '',
    'These records already exist on the base branch, so this is not a new decision',
    'racing for a number — it is a different decision being written OVER one that is',
    'already in force. Merging it would destroy the original silently: unlike a',
    'duplicate id, nothing afterwards shows that a record used to say something else.',
    '',
    'If this is a NEW decision, give it the next free id instead of reusing this file',
    '(MinSpec: Create Architecture Decision Record computes it).',
    'If this is a genuine amendment, restore the identity fields and record the change',
    'as a dated amendment section in the body — that is what keeps the record citable.',
    '',
    `If the change IS intended and the record should keep its id — a typo in \`title:\`,`,
    `a wrong \`triggered_by:\` recorded at creation — add the \`${DR_IDENTITY_ACK_LABEL}\``,
    'label to this pull request. The check then passes and says so, leaving the change',
    'named on the PR rather than blocked with no in-band path (#1982).',
  );
  return lines.join('\n');
}

/** Single-line, quoted, with any newline made visible — an identity value is one line. */
function quote(value: string): string {
  return `"${value.replace(/\n/g, '\\n')}"`;
}

/**
 * The decision-dir paths a PR MODIFIES in place, sorted.
 *
 * The exact complement of `claimedPathsFromPrFiles` over decision files: that one
 * takes the statuses which INTRODUCE a path, this one takes `modified`, where the
 * path exists on both sides and only the content can have changed. `removed` is not
 * included — deleting a decision record is a visible, reviewable act in the diff,
 * not a silent swap under a number that still resolves.
 */
export function modifiedDecisionPaths(entries: PrFileEntry[], decisionsDir: string): string[] {
  const prefix = decisionsDir.replace(/\/+$/, '') + '/';
  return entries
    .filter((e) => e.status === 'modified')
    .map((e) => e.filename)
    .filter((f) => f.startsWith(prefix) && drNumberFromPath(f) !== undefined)
    .sort();
}
