/**
 * Merge-on-refresh — section-level merge for harness file regeneration.
 *
 * Strategy:
 *   1. Parse both existing and generated files into sections (## headings)
 *   2. For each section in the new template:
 *      - If section exists in user file AND was modified (hash differs from
 *        last generation) → keep user version
 *      - If section exists in user file AND is unmodified (hash EQUALS the
 *        recorded baseline) → regenerate from template
 *      - If section exists in user file AND NO baseline hash was recorded for
 *        it → keep user version and REPORT it (#1697, fail closed). A missing
 *        baseline is absence of evidence, never evidence the section is
 *        pristine — see {@link mergeFile}. Exception: an existing body with no
 *        authored content (empty, or only commented-out placeholders) has
 *        nothing to lose, so the template is taken (#706 "no over-preserve").
 *      - If section is new in template → append
 *   3. Sections in user file not in template → preserve at end
 *   4. Store section hashes in .minspec/generated-hashes.json — and for any
 *      section whose body was KEPT rather than written, store the hash of the
 *      template body that was withheld, never the body that was kept (#1697 F1).
 *      The manifest is MinSpec's record of what IT generated; recording the
 *      user's bytes there claims authorship of them, and the next refresh reads
 *      that claim as permission to overwrite.
 *
 * Pure logic, no vscode dependency.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/** Section hash map: heading → SHA-256 hash of section body */
export interface SectionHashes {
  readonly [heading: string]: string;
}

/** Persisted hashes for all generated files */
export interface GeneratedHashes {
  readonly [filePath: string]: SectionHashes;
}

/** A parsed section: heading + body content */
export interface Section {
  readonly heading: string;
  readonly body: string;
}

/**
 * Result of a merge operation.
 *
 * It carries NO section-hash map, deliberately (#1697 NEW-A3). `mergeFile` used to
 * return one — `newHashes`, a hash per heading decided branch by branch — and
 * nothing in the product ever read it: {@link refreshHarnessFiles} destructures
 * `merged`, `preservedWithoutBaseline`, `withheldTemplateHashes` and
 * `unauthoredHeadings`, and the manifest is rebuilt from FINAL ON-DISK BYTES
 * instead (SPEC-043 D1/D2/D7, the #890 fix), corrected by the two fields below.
 *
 * Keeping it was not free, because it did not merely duplicate the persisted map —
 * it DISAGREED with it. A branch-decided hash is taken from the template body
 * BEFORE `sectionsToMarkdown` collapses internal blank runs, and before the
 * post-merge writers (`seedConstitution`, the AGENTS.md slash injection) touch the
 * file. Measured on a template body carrying `\n\n\n`: the merge decided
 * `3d74d181…` for the section it had just written, while the bytes on disk — and
 * therefore the manifest — hashed `2741b60e…`. A caller who fed that map back as
 * the next run's baseline pinned the section into the user-modified branch and
 * never received another template update for it, silently; the real persisted map
 * kept it tracking. That is the whole of the measured divergence, stated at its
 * true size: the tier that chained `merge(first.merged, T, first.newHashes)` was
 * measuring a value the product does not use, and that value diverges from the
 * product's on template bodies with internal blank runs. It is NOT a claim that
 * those tests were each getting a wrong answer: the divergence needs an internal
 * blank run in the template body, and the round-4 review that found this measured
 * three diverging sites, none of them a chained one. The defect being removed is a
 * tier steered by a second answer that CAN disagree, not a tally of tests that
 * already had.
 *
 * AC-62 pins the DIVERGENCE for that shape — the two values differ — and a control
 * body with no internal blank run does not diverge at all (measured). It does not
 * pin the CAUSE: with `collapseBlankRuns` mutated to the identity, AC-62 still
 * passes, because the merge then keeps the existing body on the NEW-1 same-content
 * branch and the two values differ for a different reason. The collapse itself is
 * pinned by AC-14d — the only test that mutant kills.
 *
 * A test that needs the baseline the NEXT refresh will read must compose it the way
 * production does — `sectionHashesFromMarkdown` over the bytes written, through
 * `applyAuthorshipCorrections` with the two fields below. There is no shortcut,
 * because there is no shortcut in the product.
 */
export interface MergeResult {
  readonly merged: string;
  /**
   * Headings whose existing body was kept while NO baseline hash was recorded
   * for them — i.e. {@link mergeFile} held the body without evidence and a
   * template update was WITHHELD (#1697).
   *
   * Covers BOTH baseline-less holds: the fail-closed branch and the INV-2
   * list-item guard (#1697 F7). The guard used to be excluded on the stated
   * ground that "the template's body is an unfilled scaffold, so nothing of
   * value was withheld" — but the guard's actual condition is only "the
   * generated body has no authored list items", which improved prose satisfies
   * just as well. An excluded hold whose justification is asserted rather than
   * guaranteed is a silent hold, so the exclusion is gone and a CONTENT test
   * decides both branches: {@link sectionContentDiffers} for the fail-closed
   * branch, which has no justification at all beyond absence of evidence, and
   * {@link generatedAddsContent} for the guard, which measures that branch's own
   * stated justification instead of assuming it.
   *
   * Restricted either way to headings where content really moved, NOT to headings
   * whose bytes differ. That qualifier is load-bearing twice over:
   *
   *   1. A baseline-less refresh has no evidence about any section, so an
   *      unrestricted list would name every section in the file — noise a human
   *      learns to skip.
   *   2. A BYTE comparison names sections MinSpec itself wrote. Several of
   *      MinSpec's own writers run AFTER the merge (`seedConstitution`'s DRAFT
   *      entries, the AGENTS.md slash-command marker region) and the constitution
   *      then feeds back into the CLAUDE.md / AGENTS.md / .cursorrules renders
   *      with different list markers and numbering — so `renderTemplate` output
   *      is PERMANENTLY byte-different from disk for those sections on a project
   *      nobody has touched. Measured before this change: a clean scaffold whose
   *      manifest was deleted produced three warnings and zero changed files.
   *      Comparing normalized content instead reports the same set for a real
   *      human edit and stays silent for a re-rendering of MinSpec's own output.
   *
   * Template-pass order, deduplicated, and ALWAYS an array (empty, never
   * `undefined`) so a caller can render it with no presence test. Reporting this
   * is part of the fix, not polish: silently preserving is better than silently
   * overwriting, but it is still silent (constitution invariant 2).
   */
  readonly preservedWithoutBaseline: readonly string[];
  /**
   * Headings whose body the merge KEPT while DECLINING to write the template it
   * had rendered for them — mapped to the hash of that unwritten template body
   * (#1697 F1).
   *
   * This is the manifest's authorship correction, and it is the whole fix. The
   * caller re-records `generated-hashes.json` from the FINAL ON-DISK BYTES
   * (`recordVerifyAndSaveManifest`, scaffold.ts) — bytes that, for exactly these
   * headings, are the USER's. Recording them unmodified converts "MinSpec has no
   * claim here" into "MinSpec wrote this", and the next refresh reads that false
   * claim as proof the body is a pristine template and overwrites it. So for
   * these headings the caller records THIS hash instead: a true statement about
   * what MinSpec generated, which makes the divergence positive evidence on the
   * next run rather than something re-guessed from absence.
   *
   * Covers EVERY hold that withheld something: the fail-closed no-baseline branch,
   * the user-modified branch, and — since #1697 NEW-3 — the INV-2 list-item guard.
   * The guard used to be exempt, on the ground that it "re-derives its verdict from
   * the two bodies on every run, so it needs no baseline and cannot be defeated by
   * one". Its VERDICT is re-derived; its RECORDING outlives the run that made it,
   * and a baseline defeats it in two steps — hold the user's list against an
   * unfilled scaffold (filing their hash), then ship a template that DOES carry
   * list items, at which point the guard goes inert and that hash reads as proof
   * the body is a pristine template. The guard now records disk only where the
   * baseline PROVES the bytes are MinSpec's own (the `seedConstitution` case the
   * old exemption was reaching for, decided by reading the proof rather than
   * assuming it), the withheld template hash where it held and withheld content,
   * and nothing at all where it held and withheld nothing
   * ({@link MergeResult.unauthoredHeadings}).
   *
   * First-template-occurrence-wins, matching `sectionHashesFromMarkdown`'s
   * duplicate-heading rule, so an override always describes the same occurrence
   * the recorder hashed. ALWAYS an object (empty, never `undefined`).
   */
  readonly withheldTemplateHashes: SectionHashes;
  /**
   * Headings this run has NO hash it may honestly record — MinSpec neither wrote
   * the body nor rendered a template body to record in its place, and no prior
   * baseline proves the bytes are its own output (#1697 NEW-2/NEW-3).
   *
   * The manifest's third state, and the one that was missing. Recording the disk
   * hash claims authorship; recording a withheld template hash claims a rendering
   * that never happened. Where neither is true the only true record is NO record,
   * so the caller DELETES these headings from the disk-derived manifest
   * (`ManifestAuthorship.unauthoredSections`, scaffold.ts) rather than correcting
   * them.
   *
   * "No record" is not a gap in the evidence — it IS the evidence. An absent
   * baseline is what routes the section to the fail-closed branch on the next run,
   * so the day a template finally ships that heading the body is HELD and REPORTED
   * instead of overwritten. Two paths reach it:
   *
   *   - the leftover-preserve pass, for every section the template does not
   *     contain (user-added sections, in every managed file). MinSpec rendered
   *     nothing for that heading, so it has nothing to say about it. Measured
   *     before this: the manifest recorded the user's own bytes, and a later
   *     template carrying the same heading spent that claim — #1697's mechanism
   *     exactly, total and silent.
   *   - the INV-2 list-item guard, when it holds a body it cannot prove is
   *     MinSpec's AND withheld nothing by holding it. Recording disk there was
   *     the guard's documented exemption, justified on the ground that the guard
   *     "cannot be defeated by [a baseline]"; it is defeated by one in two steps
   *     (hold the list against a scaffold, then ship a template that DOES carry
   *     list items and watch the guard go inert with the user's hash on file).
   *
   * Deduplicated, first-decision-wins, and filtered against the headings this run
   * DID decide a hash for, so a heading any occurrence really did record never
   * appears here.
   * ALWAYS an array (empty, never `undefined`).
   */
  readonly unauthoredHeadings: readonly string[];
}

/**
 * Sentinel "heading" for the content before the first `## ` heading. It is a key
 * in every hash map and can appear in {@link MergeResult.preservedWithoutBaseline},
 * so a reporting caller needs the same name this module parses with — hence a
 * shared constant rather than the literal repeated across modules.
 */
export const PREAMBLE_HEADING = '__preamble__';

/**
 * Parse markdown content into sections delimited by `## ` headings.
 * The content before the first heading is stored under the key "__preamble__"
 * ({@link PREAMBLE_HEADING}).
 */
export function parseSections(content: string): Section[] {
  const sections: Section[] = [];
  if (typeof content !== 'string') return sections;
  const lines = content.split('\n');
  let currentHeading: string = PREAMBLE_HEADING;
  let currentBody: string[] = [];

  const flush = () => {
    sections.push({
      heading: currentHeading,
      body: currentBody.join('\n'),
    });
    currentBody = [];
  };

  for (const line of lines) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      flush();
      currentHeading = match[1];
    } else {
      currentBody.push(line);
    }
  }
  flush();

  return sections;
}

/**
 * SHA-256 hash of section content (trimmed to ignore trailing whitespace).
 * Deterministic — same content always produces the same hash.
 */
export function hashSection(content: string): string {
  return crypto.createHash('sha256').update(content.trim()).digest('hex');
}

/**
 * Collapse a run of three or more newlines to one blank line — the ONE
 * normalization {@link sectionsToMarkdown} applies to a body on its way to disk.
 *
 * Lives here, named, because two callers have to agree about it: the writer that
 * applies it, and the merge branch that asks whether keeping the existing bytes
 * would actually differ from writing the template's. When the collapse erases the
 * whole difference there is no rewrite to avoid, so that branch must stand aside
 * and let the ordinary baseline logic decide (`merge-refresh-890.test.ts` AC-1
 * pins what the ordinary path records for exactly that shape). Two copies of this
 * rule would drift, and the branch would then stand aside for the wrong sections.
 */
const collapseBlankRuns = (text: string): string => text.replace(/\n{3,}/g, '\n\n');

/**
 * A section on its way out of {@link mergeFile}, tagged with WHO wrote its body.
 *
 * `verbatim` marks a body MinSpec KEPT rather than generated. It exists purely so
 * {@link sectionsToMarkdown} can leave those bytes alone (#1697 F6) — the merge's
 * decision logic never reads it.
 */
interface MergedSection extends Section {
  /** True when the body is the user's bytes, kept rather than generated. */
  readonly verbatim: boolean;
}

/**
 * Rebuild markdown from a merged sections array.
 *
 * Blank-line runs of three or more newlines collapse to one blank line —
 * EXCEPT inside the body of a section marked `verbatim`, whose interior bytes are
 * emitted exactly as they were read (#1697 F6).
 *
 * Why the exception exists. A "preserved" section that is silently reflowed is not
 * preserved, and reflow is the specific failure mode that hid #1697: the merge
 * rewrote the whole constitution to template wording, so the one section that lost
 * a ratified paragraph read as part of a reformat and passed review three times.
 * A hold that still edits the held bytes leaves exactly that camouflage in place.
 *
 * Why the collapse is kept everywhere else. It normalizes the SEAMS between
 * sections, so a template body's trailing blank lines plus the join's own newline
 * do not accumulate across refreshes; without it a generated file would grow a
 * blank line per run and never reach a fixed point (SPEC-043 INV-2 idempotence).
 * Template-derived bodies are MinSpec's own output, so normalizing them costs
 * nothing.
 *
 * What "interior" means, precisely, and the ONE byte a preserved section can still
 * lose: the protected span runs from a verbatim body's first non-whitespace
 * character to its last. The whitespace on either side of that span is seam
 * material — it sits between the heading above and the heading below, is stripped
 * by {@link hashSection} before any comparison, and must stay collapsible for the
 * idempotence reason above. So a deliberate blank-line run BETWEEN two of the
 * user's paragraphs survives byte-for-byte; a run of blank lines the user left
 * dangling before the NEXT heading still collapses to one.
 */
function sectionsToMarkdown(sections: readonly MergedSection[]): string {
  // The rendered document as a run of segments, each flagged protected (bytes
  // kept verbatim) or not. Only unprotected runs are whitespace-normalized. A
  // protected span always starts and ends on a non-whitespace character, so a
  // newline run can never straddle one — collapsing the unprotected runs
  // independently is therefore byte-identical to collapsing the whole document,
  // minus the protected interiors.
  const segments: Array<{ readonly text: string; readonly guarded: boolean }> = [];
  const pushPlain = (text: string): void => {
    if (text.length > 0) segments.push({ text, guarded: false });
  };

  let firstPart = true;
  const pushPart = (part: string, protectInterior: boolean): void => {
    // The separator the previous `parts.join('\n')` supplied.
    if (!firstPart) pushPlain('\n');
    firstPart = false;
    if (!protectInterior || part.trim().length === 0) {
      pushPlain(part);
      return;
    }
    const lead = part.length - part.replace(/^\s+/, '').length;
    const trail = part.length - part.replace(/\s+$/, '').length;
    pushPlain(part.slice(0, lead));
    segments.push({ text: part.slice(lead, part.length - trail), guarded: true });
    pushPlain(part.slice(part.length - trail));
  };

  for (const section of sections) {
    if (section.heading !== PREAMBLE_HEADING) pushPart(`## ${section.heading}`, false);
    pushPart(section.body, section.verbatim);
  }

  let out = '';
  let pending = '';
  for (const segment of segments) {
    if (segment.guarded) {
      out += collapseBlankRuns(pending);
      pending = '';
      out += segment.text;
    } else {
      pending += segment.text;
    }
  }
  out += collapseBlankRuns(pending);
  return out.trimEnd() + '\n';
}

/**
 * Build a hash map for all sections in the content.
 *
 * NOTE: last-occurrence-wins for a duplicate heading (a later section clobbers
 * an earlier one of the same name). Retained for the raw-template baseline path
 * (`computeTemplateBaseline`) and any non-manifest caller, but is NO LONGER the
 * manifest's source of truth — the persisted manifest is recorded from the final
 * on-disk bytes through {@link sectionHashesFromMarkdown} (first-occurrence-wins),
 * so a duplicate-heading document can never make the recorder and the self-check
 * disagree (SPEC-043 D2/D8).
 */
export function buildSectionHashes(sections: Section[]): SectionHashes {
  const hashes: Record<string, string> = {};
  for (const section of sections) {
    hashes[section.heading] = hashSection(section.body);
  }
  return hashes;
}

/**
 * Hash every section of an ALREADY-FINALIZED markdown document — i.e. the exact
 * bytes on disk — keyed by heading, **first-occurrence-wins** for a duplicate
 * heading (mirroring {@link mergeFile}'s preserve pass: the first
 * occurrence's hash is authoritative and a later duplicate never clobbers it).
 *
 * This is the SINGLE hashing path for every manifest recording site (SPEC-043
 * FR-1/FR-2/D2): the manifest is always the hash of what is finally on disk,
 * re-read after every write path (merge, `seedConstitution`, and the AGENTS.md
 * slash-section injection) has run — so `manifest == hash(disk)` by construction,
 * no matter which mechanism last touched the file. Pure, deterministic, offline.
 */
export function sectionHashesFromMarkdown(content: string): SectionHashes {
  const hashes: Record<string, string> = {};
  for (const section of parseSections(content)) {
    // First-occurrence-wins: a later duplicate heading never overwrites the hash
    // of the first occurrence (matches mergeFile's preserve pass).
    if (!(section.heading in hashes)) {
      hashes[section.heading] = hashSection(section.body);
    }
  }
  return hashes;
}

/**
 * Whether a section body contains at least one authored markdown list item
 * (numbered or bulleted), ignoring HTML comments. The constitution's content
 * sections (Invariants/Principles/Constraints/Goals) express their content as
 * lists; the bundled template ships them as a descriptive sentence plus
 * commented-out example placeholders — i.e. prose but NO real list items. This
 * is the signal the merge uses to refuse replacing populated human content with
 * an unfilled template scaffold (#706, INV-2).
 */
export function hasAuthoredListItems(body: string): boolean {
  const withoutComments = body.replace(/<!--[\s\S]*?-->/g, '');
  return withoutComments.split('\n').some((line) => /^\s*(?:\d+\.|[-*])\s+\S/.test(line));
}

/**
 * Whether a section body contains ANY authored content — i.e. anything at all once
 * HTML comments and whitespace are removed. Prose, a list, a table, a code fence:
 * all count. Only a body that is empty, blank, or nothing but commented-out
 * template placeholders returns `false`.
 *
 * This is the scope limit on the #1697 fail-closed rule. Failing closed exists to
 * stop the merge destroying content it has no evidence about; where the body holds
 * no authored content there is provably nothing to destroy, so the rule has nothing
 * to protect and withholding the template update would buy no safety. Without this
 * limit a section the user left empty could NEVER be populated from the template on
 * any machine lacking the gitignored baseline — which is most machines — turning a
 * data-loss fix into a permanent functional regression (#706's "no over-preserve"
 * boundary, merge-refresh-706.test.ts).
 *
 * Treating a comment as non-content is this module's existing, tested convention,
 * not a new one: {@link hasAuthoredListItems} strips comments the same way, and
 * #706 already defines an "effectively-empty" section as comments/whitespace only.
 * The residual risk is a deliberately hand-written HTML comment (`<!-- intentionally
 * empty, see DR-012 -->`) being replaced by the template; that is accepted as the
 * far smaller cost, and it is unchanged from the behaviour that shipped before.
 */
export function hasAuthoredContent(body: string): boolean {
  return body.replace(/<!--[\s\S]*?-->/g, '').trim().length > 0;
}

/**
 * The set of authored CONTENT items in a section body, normalized so that two
 * different RENDERINGS of the same content compare equal.
 *
 * An "item" is one markdown list item (joined with its indented continuation
 * lines) or one line of prose. HTML comments are dropped first — this module's
 * existing convention for "not authored content" ({@link hasAuthoredListItems},
 * {@link hasAuthoredContent}) — then each item is stripped of its leading list
 * marker or numbering and its internal whitespace is collapsed.
 *
 * The normalization is chosen to erase exactly the differences MinSpec's own
 * pipeline manufactures and nothing else:
 *
 *   - `seedConstitution` writes a DRAFT entry as `- text` + an INDENTED
 *     `> _proposed because …_` continuation; the constitution then feeds back
 *     into the CLAUDE.md / AGENTS.md / .cursorrules renders as a single
 *     `N. text > _proposed because …_` line. Joining continuations and stripping
 *     the marker makes those the same item.
 *   - re-rendering renumbers `1. 2. 3.` and re-picks `-` vs `1.`; stripping the
 *     marker makes that invisible.
 *   - the AGENTS.md slash-command region is bounded by HTML comment markers,
 *     which the comment strip already removes.
 *
 * Deliberately a SET, so a duplicated item does not read as new content: the
 * render can emit the same seeded entry more than once, and a duplicate is a
 * rendering artifact, never something a human would lose.
 */
export function contentItems(body: string): ReadonlySet<string> {
  const items = new Set<string>();
  let current: string | null = null;
  const flush = (): void => {
    if (current !== null) items.add(current);
    current = null;
  };

  for (const rawLine of body.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    if (rawLine.trim().length === 0) {
      flush();
      continue;
    }
    const text = rawLine.trim().replace(/\s+/g, ' ');
    // An indented line continues the item above it (a list item's second line).
    // Keep its own markers — the one-line rendering of the same entry keeps them
    // inline, so `- x` + `  > y` must normalize to the same item as `1. x > y`.
    if (/^[ \t]/.test(rawLine) && current !== null) {
      current = `${current} ${text}`;
      continue;
    }
    flush();
    current = text.replace(/^(?:[-*+]|\d+[.)])\s+/, '');
  }
  flush();
  return items;
}

/**
 * Whether two renderings of a section carry DIFFERENT content — the test that
 * decides whether a hold is worth telling a human about (#1697 F3/F7).
 *
 * NOT a byte comparison, and deliberately so. `renderTemplate`'s output is
 * permanently byte-different from disk for sections MinSpec's own post-merge
 * writers touch, so a byte test reports a project nobody has edited: measured on a
 * clean scaffold whose manifest was deleted, three warnings naming sections the
 * user never touched, against zero changed files.
 *
 * IT IS A MERGE DECISION, and the comment that used to stand here said the opposite
 * (#1697 NEW-A1). "`mergeFile` still fails closed on the bytes; this only chooses
 * what to SAY. A false negative here costs a notice about content that was kept
 * anyway — never data." Every clause of that is false as the code now stands: this
 * predicate gates three of `mergeFile`'s branches — the same-content re-render
 * branch, the fail-closed hold, and the user-modified hold — so `mergeFile` fails
 * closed on CONTENT, not on bytes, and a false negative costs the user's edit.
 *
 * What a false negative actually costs, measured: a section whose content is
 * set-equal to the template's takes the re-render branch, which keeps the bytes on
 * disk AND records them as MinSpec's own output. That is a true claim about content
 * and a false one about presentation, because {@link contentItems} is a SET of
 * marker-stripped, whitespace-collapsed, comment-free lines. Four edit shapes are
 * invisible here — enumerated as `INVISIBLE_EDITS` in `merge-refresh.test.ts`, which
 * feeds AC-64 — and each is recorded as MinSpec's, then overwritten with no notice by
 * the next template whose CONTENT for that section changes. All four are pinned at
 * the merge by AC-64. All four also reproduce over the REAL refresh path on a
 * scaffolded project (measured): the edit survives byte for byte, no notice names it,
 * and the manifest files the section as MinSpec's own.
 *
 * That cost is accepted rather than overlooked; {@link mergeFile}'s re-render branch
 * carries the measurement of the alternative and why it is worse.
 */
export function sectionContentDiffers(existingBody: string, generatedBody: string): boolean {
  const existingItems = contentItems(existingBody);
  const generatedItems = contentItems(generatedBody);
  if (existingItems.size !== generatedItems.size) return true;
  for (const item of existingItems) {
    if (!generatedItems.has(item)) return true;
  }
  return false;
}

/**
 * Whether the generated body carries content the existing body does NOT — the
 * ONE-DIRECTIONAL half of {@link sectionContentDiffers}, and the exact negation
 * of "nothing of value was withheld".
 *
 * This is the test the INV-2 list-item guard's hold is reported against (#1697
 * F7). That guard fires when the existing body has authored list items and the
 * generated body has none, and its stated justification is that the template body
 * is therefore an unfilled scaffold with nothing to lose. By construction the
 * existing body always has MORE there, so the symmetric test would name every
 * content section of a freshly seeded constitution — MinSpec's own DRAFT entries
 * reported back to the user as content it withheld from them. Asking instead
 * whether the TEMPLATE brought anything new answers the guard's own justification
 * directly: silent while it holds, loud the moment a future template ships real
 * prose into a scaffold section and the guard keeps swallowing it.
 *
 * Since #1697 NEW-3 it decides the guard's RECORDING as well as its report, which
 * is not two jobs but one: pinning is what a recorded hash that cannot match disk
 * does to a section, so "did this hold withhold anything" has to answer both, or
 * the guard pins sections nobody was told about — the freeze shape NEW-1 removed
 * from the fail-closed branch (see {@link MergeResult.unauthoredHeadings}).
 */
export function generatedAddsContent(existingBody: string, generatedBody: string): boolean {
  const existingItems = contentItems(existingBody);
  for (const item of contentItems(generatedBody)) {
    if (!existingItems.has(item)) return true;
  }
  return false;
}

/**
 * Merge an existing file with a newly generated version, using stored hashes
 * to determine which sections the user has modified.
 *
 * FAILS CLOSED on a missing baseline (#1697). A heading with no entry in
 * `oldHashes` is NOT evidence that the section is an untouched template body — it
 * is no evidence at all, so the existing body is kept and the heading is reported
 * on {@link MergeResult.preservedWithoutBaseline}. Before this, an absent hash fell
 * through to "unmodified → use new template" and the template body overwrote the
 * user's; in `AIClarityAU/voip-sms-inbox` that silently deleted a ratified standing
 * exception from `.minspec/constitution.md` on three separate branches.
 *
 * The fail-closed rule is scoped to sections that HOLD authored content
 * ({@link hasAuthoredContent}). An existing body that is empty or nothing but
 * commented-out placeholders has nothing to destroy, so it still takes the template
 * — otherwise a section the user left empty could never be populated on any machine
 * without the baseline, which is #706's "no over-preserve" boundary.
 *
 * The baseline is missing far more often than the old code assumed: it lives in
 * `.minspec/generated-hashes.json`, which MinSpec declares machine-local and
 * gitignores, so it is absent in every fresh clone, every new linked worktree, and
 * every checkout that did not itself scaffold. A merge DECISION input that cannot
 * travel with the repo will be missing on most machines that run the merge.
 *
 * The loss also concealed itself: with no baseline EVERY section fell through, so
 * the whole file reflowed to template wording and the one section that lost real
 * prose read as part of a reformat. All three occurrences were found by an
 * automated pass, never by a human reading the diff.
 *
 * Failing closed decides ONE refresh. What the run RECORDS decides every refresh
 * after it, and that is the second half of the same defect (#1697 F1). The caller
 * re-records the manifest from the final on-disk bytes, which for a held section
 * are the user's — so an unmodified recording launders "no evidence" into
 * "MinSpec wrote this", and the next refresh takes the template with no notice at
 * all. Every body this function KEEPS on evidence grounds is therefore recorded
 * as the hash of the template body it DECLINED to write, and reported on
 * {@link MergeResult.withheldTemplateHashes} so the caller records it too. The
 * hold then rests on positive evidence from the second refresh onward, which is
 * also why the fail-closed report correctly stops firing after the first.
 *
 * @param existing   - Current file content on disk
 * @param generated  - Freshly rendered template content
 * @param oldHashes  - Section hashes from the last generation, and EVIDENCE: every
 *                     branch below reads a match as proof MinSpec wrote those bytes.
 *                     Callers must therefore source it from {@link loadProvenHashes},
 *                     never from {@link loadHashes} — the raw reader will happily
 *                     hand back a pre-#1697 manifest whose entries were copied off
 *                     disk, user content included (#1697 NEW-A2). `{}` is always a
 *                     safe argument; it means "no evidence" and fails closed.
 * @returns merged content + the headings held for lack of a baseline + the
 *          withheld-template hashes the manifest must record + the headings no
 *          hash may honestly be filed for. NO hash map: nothing in the product read
 *          the one this used to return, and it disagreed with the manifest — see
 *          {@link MergeResult} (#1697 NEW-A3).
 */
export function mergeFile(
  existing: string,
  generated: string,
  oldHashes: SectionHashes,
): MergeResult {
  const existingSections = parseSections(existing);
  const generatedSections = parseSections(generated);

  // Index existing sections by heading as an occurrence-ordered queue.
  // A plain Map<string,string> would collapse duplicate-named headings and
  // silently drop one section's body (#153). We retain every occurrence and
  // consume them positionally instead.
  const existingByHeading = new Map<string, Section[]>();
  for (const s of existingSections) {
    const queue = existingByHeading.get(s.heading);
    if (queue) {
      queue.push(s);
    } else {
      existingByHeading.set(s.heading, [s]);
    }
  }
  // Track which existing sections have been consumed (by reference identity)
  // so the preserve pass can append everything left over — including extra
  // duplicate occurrences — verbatim.
  const consumed = new Set<Section>();

  const mergedSections: MergedSection[] = [];
  // Headings this run reached a hash DECISION for — a Set, not a map, because the
  // hashes themselves go nowhere (#1697 NEW-A3). The manifest is rebuilt from final
  // disk by `recordVerifyAndSaveManifest`; the only thing the rest of this function
  // needs from a decision is THAT it was made: the preserve pass skips a heading
  // already decided in the template pass, and `unauthoredHeadings` is filtered by it
  // so a heading some occurrence recorded is never also reported as unrecordable.
  // Holding the values as well would recreate the divergent second answer the
  // deleted per-branch hash map was — see {@link MergeResult}.
  //
  // The Set also fixes HALF of #1752 (heading-keyed maps are plain objects), by
  // accident rather than by design, and only half — so do not read this line as
  // closing it. The filter below used to be `heading in newHashes` over a plain
  // object literal, where every `Object.prototype` key is present before the loop
  // starts: a user's `## constructor` section was filtered out of
  // `unauthoredHeadings` and its entry was then hashed off disk as MinSpec's own.
  // A Set has no prototype keys, so measured on a `## constructor` section this run
  // reports `["constructor"]` where the previous one reported `[]`.
  // STILL OPEN in #1752: `preservedWithoutBaseline`. See `oldHashes[heading]` below.
  const hashedThisRun = new Set<string>();
  // Headings held with NO baseline — by the fail-closed path OR by the INV-2
  // guard (#1697 F7) — whose template body carried content the kept body did not,
  // i.e. a real update was withheld. Template-pass order; the Set deduplicates a
  // heading that occurs more than once in the template.
  const preservedWithoutBaseline: string[] = [];
  const reportedWithoutBaseline = new Set<string>();
  /** Record one baseline-less hold, once per heading, when it withheld content. */
  const reportHold = (heading: string, withheldSomething: boolean): void => {
    if (!withheldSomething || reportedWithoutBaseline.has(heading)) return;
    reportedWithoutBaseline.add(heading);
    preservedWithoutBaseline.push(heading);
  };
  // Headings kept while their rendered template body was withheld → the hash of
  // that unwritten template body (#1697 F1). See MergeResult.withheldTemplateHashes.
  const withheldTemplateHashes: Record<string, string> = {};
  // Headings this run may record NOTHING for (#1697 NEW-2/NEW-3). See
  // MergeResult.unauthoredHeadings. First decision wins, so a heading is never
  // demoted by a later duplicate occurrence.
  const unauthoredHeadings: string[] = [];
  const unauthoredSeen = new Set<string>();
  /** Record that MinSpec has no honest hash to file for this heading. */
  const recordNothing = (heading: string): void => {
    if (unauthoredSeen.has(heading)) return;
    unauthoredSeen.add(heading);
    unauthoredHeadings.push(heading);
  };
  // Headings whose disposition has already been decided by an earlier occurrence
  // in the template pass. `sectionHashesFromMarkdown` is first-occurrence-wins, so
  // only the FIRST occurrence may contribute an override — otherwise a heading
  // taken from the template at its first occurrence and withheld at a later one
  // would override the hash of a section MinSpec really did write.
  const dispositionDecided = new Set<string>();

  // Process sections in the order they appear in the new template
  for (const genSection of generatedSections) {
    const heading = genSection.heading;
    const queue = existingByHeading.get(heading);
    const existSection = queue && queue.length > 0 ? queue.shift()! : undefined;

    if (existSection) {
      // Section exists in both files — consume the first unmatched occurrence.
      consumed.add(existSection);
      const existingBody = existSection.body;
      const existingHash = hashSection(existingBody);
      // #1752, the half NOT fixed: `oldHashes` is a plain object straight out of
      // `JSON.parse`, so for a heading that names an `Object.prototype` member —
      // `## constructor`, `## toString`, `## valueOf` and four more — this reads the
      // inherited function, which is TRUTHY. Every `!oldHash` below is therefore
      // false for such a section: the fail-closed branch is skipped and the INV-2
      // guard's `if (!oldHash) reportHold(...)` never fires, so a hold on it is
      // SILENT — the shape constitution invariant 2 forbids. Today's net outcome is
      // still safe (no entry is filed, and MinSpec ships no template heading with a
      // prototype name), which is why #1752 is filed as latent rather than fixed
      // here; the fix is `Object.create(null)` for every heading-keyed map, so the
      // class becomes impossible instead of each site having to remember.
      const oldHash = oldHashes[heading];

      if (hasAuthoredListItems(existingBody) && !hasAuthoredListItems(genSection.body)) {
        // INV-2 guard (#706): never replace populated human content with an
        // unfilled template scaffold. The constitution's content sections
        // (Invariants/Principles/Constraints/Goals) ship as descriptive prose +
        // commented example placeholders — prose but no real list items — so the
        // "unmodified → use template" path below would silently destroy
        // hand-authored list content.
        //
        // STILL LOAD-BEARING, and it no longer records the EXISTING body's hash
        // unconditionally. It used to, on the stated ground that the guard
        // "re-derives its verdict from the two bodies on every run, so it needs no
        // baseline and CANNOT BE DEFEATED BY ONE". That was false, and it was the
        // last exemption from the rule the rest of this function runs on. Measured
        // defeat, in two steps (#1697 NEW-3):
        //
        //   1. the guard holds the user's list against an unfilled scaffold and
        //      records the USER's hash;
        //   2. a later template ships real list items in that section, so the guard
        //      goes inert — and the hash it filed in step 1 now reads as "proven
        //      unmodified", so the ordinary path replaces the list with the
        //      template's. Silent, total, and the same mechanism as #1697 itself.
        //
        // The guard's verdict is re-derived each run; its RECORDING is not, and a
        // recording outlives the run that made it. So the recording asks the same
        // question every other branch asks — did MinSpec write these bytes? — and
        // answers it from evidence:
        //
        //   - the baseline PROVES it (`oldHash === existingHash`): record disk. This
        //     is the case the old justification was reaching for, including the
        //     `seedConstitution` DRAFT entries seeded into the constitution's
        //     Goals/Principles after the merge — on any machine that has scaffolded,
        //     the manifest was recorded from those very bytes, so the proof is
        //     there to be read rather than assumed. The section keeps tracking.
        //   - no proof, and the hold WITHHELD something: record the template body
        //     declined, exactly as the fail-closed branch does. The section is
        //     pinned — and it is reported in the same breath, so the NEW-1 rule
        //     (pinned exactly when reported) holds here too.
        //   - no proof, and the hold withheld NOTHING: record nothing at all
        //     ({@link MergeResult.unauthoredHeadings}). Pinning a section nobody was
        //     told about is the freeze this fix removed, and a false authorship
        //     claim is the loss it removed — no record is the only remaining true
        //     answer, and it is the one that makes the next template to ship this
        //     heading fail CLOSED and say so.
        //
        // Its blind spot is unchanged and deliberate: it protects list items only,
        // so it never fires when both sides carry lists, or when the content is
        // prose. That blind spot is exactly what let #1697 through — which is why
        // the branches below no longer lean on it, and record what MinSpec
        // generated rather than what happened to be on disk.
        //
        // A hold here with NO baseline is REPORTED like any other (#1697 F7). It
        // used to be exempt on the stated ground that the template body is an
        // unfilled scaffold so nothing of value was withheld — but the condition
        // this branch actually tests is only "the generated body has no authored
        // list items", which a genuinely improved paragraph of prose satisfies
        // too. The exemption was an assertion, not a guarantee, and an unreported
        // hold on an unguaranteed justification is a silent gate. Where the
        // justification IS true, `generatedAddsContent` sees the template add
        // nothing and the notice stays quiet on its own — which is the same
        // answer, reached by measurement instead of by assumption.
        mergedSections.push({ heading, body: existingBody, verbatim: true });
        const guardWithheld = generatedAddsContent(existingBody, genSection.body);
        if (oldHash === existingHash) {
          hashedThisRun.add(heading);
        } else if (guardWithheld) {
          hashedThisRun.add(heading);
          if (!dispositionDecided.has(heading)) {
            withheldTemplateHashes[heading] = hashSection(genSection.body);
          }
        } else {
          recordNothing(heading);
        }
        if (!oldHash) reportHold(heading, guardWithheld);
      } else if (
        hasAuthoredContent(existingBody) &&
        !sectionContentDiffers(existingBody, genSection.body) &&
        existingHash !== hashSection(collapseBlankRuns(genSection.body))
      ) {
        // SAME CONTENT, different bytes: there is nothing to update and nothing to
        // hold, whatever the baseline says (#1697 NEW-1).
        //
        // The third clause asks whether the bytes on disk would really change. This
        // branch exists to avoid REWRITING a file for a difference that is not
        // content; where {@link collapseBlankRuns} erases the whole difference on
        // the way to disk, both choices emit the same bytes, so there is nothing to
        // avoid and the ordinary baseline logic below decides — including what it
        // records, which `merge-refresh-890.test.ts` AC-1 pins for that shape.
        //
        // This is the branch that decides when a managed section gets REWRITTEN,
        // and the rule it enforces is that MinSpec rewrites a section exactly when
        // the template brings different CONTENT. A re-rendering of the content
        // already on disk is not an update: `renderTemplate` renumbers `1. 2. 3.`,
        // re-picks `-` versus `1.`, and folds `seedConstitution`'s indented
        // provenance line back onto one line, so its output is permanently
        // byte-different from disk for every section MinSpec's own post-merge
        // writers touch. Writing those bytes back buys the user nothing and costs
        // them a diff in a file they did not edit.
        //
        // Two defects collapse into this one rule.
        //
        //   1. Idempotence (SPEC-043 INV-2). Rewriting on a byte difference alone
        //      never reaches a fixed point here, because `seedConstitution` runs
        //      AFTER the merge and re-seeds the entry whose rendering the merge just
        //      normalized away. Measured on a project nobody had touched: one extra
        //      DRAFT line in `.minspec/constitution.md` and `.cursorrules` per
        //      refresh, for ever, on the pre-#1697 code as well.
        //   2. The freeze (#1697 NEW-1). The fail-closed branch below used to hold
        //      on the mere ABSENCE of a baseline, so it caught these byte-only
        //      differences too — and a hold RECORDS the withheld template hash,
        //      which can never equal the body on disk, so the section was pinned
        //      into the user-modified branch from the next run on. Permanently, and
        //      silently, because the report has always been content-based and had
        //      nothing to say about them. Measured: a pure REORDER of two
        //      constitution invariants pinned CLAUDE.md and AGENTS.md with no notice
        //      naming either, and the next ratified invariant never arrived at all.
        //
        // What it RECORDS is the hash of the bytes that are actually there, and that
        // recording is a DECISION, re-argued here rather than inherited (#1697
        // NEW-A1). It is a true claim about CONTENT and a false one about
        // PRESENTATION, and the previous comment claimed both: "this body holds
        // nothing but MinSpec's own content in MinSpec's own rendering… Nothing
        // authored is at stake either way." The first half stands — content equality
        // means every item on disk is an item the template carries. The second does
        // not.
        //
        // Say plainly what is NOT protected. `contentItems` is a SET of
        // marker-stripped, whitespace-collapsed, comment-free lines, so this branch
        // cannot see any of the four edit shapes `merge-refresh.test.ts` enumerates
        // as `INVISIBLE_EDITS`. Such an edit is recorded as MinSpec's own output, and
        // the next template whose CONTENT for this section changes replaces it —
        // SILENTLY, with no entry in `preservedWithoutBaseline`. Reproduced for all
        // four shapes at the merge (AC-64), the sharpest being a user's
        // `<!-- ratified …, do not remove -->` annotation deleted on the second
        // refresh while the toast said "user edits preserved". So: MinSpec protects
        // the CONTENT of a section, never its presentation, and a comment carries no
        // protection at all. Anything that must survive belongs in the prose.
        //
        // The alternative was measured before it was rejected. Recording NOTHING
        // here (`recordNothing(heading)`, the treatment every other unproven hold
        // gets) does protect the reorder — and costs the delivery of every template
        // update to every section MinSpec re-renders. With no baseline on file, the
        // next template that changes this section's content lands on the fail-closed
        // branch, which HOLDS the old body and reports it — for every such section,
        // by the branch order above, not merely for the one that was measured.
        // Measured on the ordinary settled case, where nobody had edited anything and
        // only `renderTemplate`'s own re-rendering made the bytes differ: the new
        // invariant did not arrive, and the refresh raised a notice about MinSpec's
        // own prose. `merge-refresh.test.ts` AC-65 holds the property that would be
        // destroyed, so the trade cannot be reversed without turning a test red. Trading a
        // silent loss of ORDERING for silent non-delivery of GOVERNANCE, plus the
        // F3 notice noise earlier rounds removed, is the worse side of the trade —
        // one costs presentation the user can restore, the other costs the
        // constitution updates this whole command exists to deliver.
        //
        // A recorded hash that MATCHES disk is also what keeps the section tracking:
        // the moment the template carries content this body does not,
        // `sectionContentDiffers` is true, this branch stops catching it, and the
        // whole template body lands (bringing the newer rendering with it).
        mergedSections.push({ heading, body: existingBody, verbatim: true });
        hashedThisRun.add(heading);
      } else if (
        !oldHash &&
        hasAuthoredContent(existingBody) &&
        sectionContentDiffers(existingBody, genSection.body)
      ) {
        // FAIL CLOSED (#1697): no recorded baseline → no evidence this section is
        // an untouched template body. Keep what is on disk and report it, rather
        // than assume pristine and overwrite.
        //
        // Reached only when the CONTENT differs — the branch above has already
        // taken every section whose content the template already carries. That is
        // the SAME basis the report is decided on (#1697 NEW-1), so the set of
        // sections this branch holds and the set it names are the same set by
        // construction rather than by two tests that happen to agree. They did not
        // agree before: the hold fired on any byte difference at all while the
        // report asked whether the content had moved, so every byte-only difference
        // was pinned (see below) and never reported — permanent and invisible at
        // once.
        //
        // Scoped to bodies that HOLD authored content: an empty or
        // comments-only section has nothing to destroy, so it falls through to
        // the template below rather than being frozen forever on every machine
        // without the gitignored baseline (see {@link hasAuthoredContent}).
        //
        // What is RECORDED is the other half of the fix (#1697 F1). Recording the
        // body we kept would claim MinSpec authored the user's prose, and the very
        // next refresh would read that claim as "proven unmodified" and overwrite
        // it — the same loss, deferred one command and now unreported. Record the
        // template body we DECLINED to write instead: true about what MinSpec
        // generated, and it turns this guess into evidence for the next run.
        mergedSections.push({ heading, body: existingBody, verbatim: true });
        hashedThisRun.add(heading);
        if (!dispositionDecided.has(heading)) {
          withheldTemplateHashes[heading] = hashSection(genSection.body);
        }
        // The hold condition IS the report condition, so a hold is never silent.
        reportHold(heading, true);
      } else if (
        oldHash &&
        existingHash !== oldHash &&
        hasAuthoredContent(existingBody) &&
        sectionContentDiffers(existingBody, genSection.body)
      ) {
        // User modified this section → keep user version.
        //
        // Recorded the same way as the fail-closed branch above, and for the same
        // reason (#1697 F1): the baseline PROVED this body is the user's, so
        // re-recording it as MinSpec's would throw that proof away and let the
        // next refresh classify it as unmodified. A preserved edit must not
        // survive exactly one refresh.
        //
        // Scoped to bodies that HOLD authored content, exactly as the fail-closed
        // branch is, and for the same reason — but here the boundary is also the
        // WAY OUT of a hold (#1697 NEW-1). A section this branch keeps is kept on
        // every later run, so without an exit a hold is a freeze: the fail-closed
        // branch pins the section on run 1, this branch re-pins it on run 2, and no
        // template update reaches it again. Emptying the body is the release, and it
        // has to keep working after the pin, not just before it — measured, it did
        // not: the emptied body landed here, was preserved as a user edit, and the
        // template never came back. The notice names this as the way out
        // (`preservedWithoutBaselineMessage`), so it must be true.
        mergedSections.push({ heading, body: existingBody, verbatim: true });
        hashedThisRun.add(heading);
        if (!dispositionDecided.has(heading)) {
          withheldTemplateHashes[heading] = hashSection(genSection.body);
        }
      } else {
        // Section proven unmodified against the recorded baseline → use new template
        mergedSections.push({ heading, body: genSection.body, verbatim: false });
        hashedThisRun.add(heading);
      }
      dispositionDecided.add(heading);
    } else {
      // New section in template → append from template
      mergedSections.push({ heading, body: genSection.body, verbatim: false });
      hashedThisRun.add(heading);
    }
  }

  // Preserve every existing section the template did not consume — in original
  // document order. This covers both user-added sections (heading absent from
  // template) and surplus occurrences of duplicate-named headings, so no user
  // content is ever dropped (#153).
  for (const existSection of existingSections) {
    if (consumed.has(existSection)) continue;
    mergedSections.push({ ...existSection, verbatim: true });
    const heading = existSection.heading;
    // A heading the template pass already decided is a surplus duplicate
    // occurrence, not a user-added section: its disposition — including the
    // decision to record nothing — was made there and must not be re-made here.
    // First-occurrence-wins, matching `sectionHashesFromMarkdown`.
    if (hashedThisRun.has(heading) || dispositionDecided.has(heading)) continue;

    // Everything left is a section the TEMPLATE DOES NOT CONTAIN — a user-added
    // section, or one an older template shipped and this one dropped. MinSpec
    // rendered no body for it this run, so "record the final bytes on disk" has
    // nothing true to say: it files the user's own prose as MinSpec's output, and
    // the next template to ship that heading reads the forgery as proof the
    // section is a pristine template body and overwrites it (#1697 NEW-2 —
    // reproduced end to end as a total, silent loss of a hand-written runbook).
    //
    // So the hash is recorded only where a PRIOR run already proved these exact
    // bytes are MinSpec's own output, and otherwise not at all.
    //
    // Carrying that proof forward is not a new claim; it is the same claim,
    // unchanged — the distinction `ManifestAuthorship.unauthored` already draws
    // for a whole file MinSpec skipped. Dropping it would demote a section MinSpec
    // demonstrably wrote (the common shape: a template heading RENAMED upstream,
    // whose old body is still MinSpec's) onto the fail-closed path, and a hold
    // reported on MinSpec's own stale prose is a notice the user cannot act on.
    //
    // That reasoning is sound about a PROOF and says nothing about where the proof
    // came from, which is the hole it left (#1697 NEW-A2). `oldHashes` is only ever
    // as good as the manifest it was read out of, and until now that could be a
    // manifest an older MinSpec built by hashing final disk — user paragraphs and
    // all. Measured: an ops runbook the user wrote, recorded by the old code,
    // carried forward HERE by the new one because the forged entry matched the
    // bytes it had forged it from, and overwritten one template later. So the
    // caller decides what may be spent, once, at
    // {@link loadProvenHashes} — and passes `{}` when the manifest predates the
    // authorship rules, which lands every heading in the `recordNothing` branch
    // below.
    //
    // The trade that makes explicit, stated here because this comment is where the
    // opposite was argued: on the first refresh after an upgrade, a heading an older
    // template shipped and a newer one dropped loses its entry, so if that heading
    // ever returns it is HELD and reported — the exact false hold, on MinSpec's own
    // stale prose, that the paragraph above invokes. It is accepted, because the two
    // outcomes are not the same size. The false hold costs one notice about a
    // section the reader can release by emptying it, and
    // `preservedWithoutBaselineMessage` now says outright that a held body may be
    // MinSpec's own older wording rather than theirs, so the notice is actionable
    // instead of merely alarming. Believing the old manifest costs ratified
    // governance text, deleted with no notice at all. A hold is recoverable in one
    // keystroke; a silent deletion is recoverable only from a backup the user does
    // not know they need.
    const existingHash = hashSection(existSection.body);
    if (oldHashes[heading] === existingHash) {
      // Marking the DECISION matters even though the hash itself goes nowhere: a
      // heading that occurs twice as a leftover is skipped at the top of this loop
      // on its second occurrence, so it cannot reach `recordNothing` and delete the
      // entry this occurrence just proved is MinSpec's own (first-occurrence-wins,
      // matching `sectionHashesFromMarkdown`). Removing this one line left the whole
      // suite green until AC-72 was written to pin it.
      hashedThisRun.add(heading);
    } else {
      recordNothing(heading);
    }
  }

  return {
    merged: sectionsToMarkdown(mergedSections),
    preservedWithoutBaseline,
    withheldTemplateHashes,
    // Filtered last: any heading some occurrence really did record has a true hash
    // on file, and must not also be reported as unrecordable.
    unauthoredHeadings: unauthoredHeadings.filter((heading) => !hashedThisRun.has(heading)),
  };
}

export const HASHES_FILENAME = 'generated-hashes.json';

/**
 * Reserved top-level key in `generated-hashes.json`. It carries the manifest's own
 * provenance, and it is NOT a file path — nothing under
 * {@link TEMPLATE_OUTPUT_PATHS} can collide with it, and {@link loadHashes} strips
 * it so no consumer ever sees it as one.
 *
 * It rides INSIDE the manifest rather than beside it deliberately. One file and one
 * write means the marker and the entries it vouches for cannot drift apart — and
 * "one write" is asserted, not assumed (`merge-refresh.test.ts` AC-73): there
 * is no ordering in which a crash leaves stamped entries unstamped or vice versa,
 * and no second path that a `.gitignore` written before this existed would fail to
 * exclude — a sibling marker file would be committed by every project scaffolded to
 * date and would then travel to machines whose manifest it does not describe,
 * vouching for entries it has never seen.
 */
export const MANIFEST_STAMP_KEY = '__minspec__';

/**
 * The manifest format this MinSpec writes, and the ONLY value it accepts as proof
 * of authorship (#1697 NEW-A2; the issue it closes is #1718, the pre-fix manifest
 * migration gap, whose third option — "version-stamp the manifest and treat pre-fix
 * entries as absent on read" — is what this constant is).
 *
 * `2` is the format in which a recorded hash means "MinSpec generated these bytes".
 * `1` — every manifest written before this fix, and the one on disk in every
 * project that has ever run an older MinSpec — is a hash of whatever was on disk at
 * the end of the run, user-authored paragraphs included. The two files are
 * byte-indistinguishable: same keys, same shape, same 64 hex characters. Nothing in
 * a v1 entry can tell you whether it records MinSpec's output or the user's, so
 * there is no reading of it that makes it evidence, and this stamp is the only
 * thing that separates them.
 *
 * Compared with `===`, so an UNKNOWN version is distrusted too. A manifest written
 * by a future MinSpec whose rules this code has never seen is exactly as unproven
 * as one written by a past MinSpec whose rules it knows were wrong; a downgrade
 * must fail closed for the same reason an upgrade does. A future bump therefore has
 * to decide EXPLICITLY whether its predecessor's entries remain proof, rather than
 * inheriting the answer from a `>=`.
 *
 * That strictness is a GATE, not a preference, so it is pinned rather than
 * described: `merge-refresh.test.ts` AC-68 asserts that `1` AND `3` are both
 * distrusted, which no `>=` and no `<=` can satisfy. Distrust is not the same as
 * unreadability, though — see {@link ManifestBaselineState}, which keeps the three
 * refused shapes apart so the user is told the true one.
 */
export const MANIFEST_HASH_VERSION = '2';

/**
 * How the manifest on disk may be read: one spendable state and three unspendable
 * ones, kept DISTINCT (#1697 NEW-A2, #1718 pre-fix manifest migration gap).
 *
 * {@link MANIFEST_HASH_VERSION} is compared with `===`, so everything that is not
 * that exact version fails closed together. That is the right MERGE decision and
 * the wrong REPORT. Three different files reach it — the stamp is ABSENT, the stamp
 * is OLDER, the stamp is one this build cannot read — and the notice used to assert
 * the middle one for all three. "Written by an older version of MinSpec" is false
 * of a manifest a NEWER MinSpec wrote, and it sends the reader hunting a downgrade
 * that never happened; a true hold explained by a false reason is still a false
 * statement (`preservedWithoutBaselineMessage`). So the GATE stays one comparison
 * and the REASON is three.
 *
 * The cost is a third variant and a third sentence to keep true, on a notice that
 * is already long. Accepted: a long true message beats a short false one here,
 * because the notice is the only thing standing between a withheld update and a
 * user who never learns of it.
 */
export type ManifestBaselineState =
  /** Stamped {@link MANIFEST_HASH_VERSION}: the entries may be spent as proof. */
  | 'proven'
  /**
   * No manifest on disk, or one carrying no file entries — MinSpec distrusted
   * NOTHING. The fresh-clone / new-worktree case.
   */
  | 'absent'
  /**
   * Entries present, and the stamp is either ABSENT — every manifest written before
   * #1718 was fixed, because the stamp did not exist — or a LOWER version. Written
   * by an older MinSpec, which recorded whatever was on disk at the end of the run,
   * so its entries cannot be told apart from MinSpec's own output.
   */
  | 'pre-authorship'
  /**
   * Entries present, and the stamp is one this build cannot read: a HIGHER version
   * (a newer MinSpec wrote the file) or not a version at all (hand-edited, or a
   * `hashVersion` that is not a string). Distrusted for the same reason as
   * `pre-authorship` and reported differently, because nothing here was written by
   * an older MinSpec and saying so would be a guess.
   */
  | 'unrecognised-version';

/** The prior manifest, split by whether it may be spent as proof. */
export interface ManifestBaseline {
  /**
   * The entries usable as evidence of MinSpec authorship. EMPTY unless the manifest
   * carries {@link MANIFEST_HASH_VERSION} — absence of evidence, which
   * {@link mergeFile} already fails closed on.
   */
  readonly proven: GeneratedHashes;
  /**
   * WHY `proven` is what it is. `'proven'` and `'absent'` both mean nothing was
   * distrusted; the other two mean a manifest WAS on disk and MinSpec declined to
   * spend it, and they differ only in the sentence the user is owed for the hold
   * that follows.
   */
  readonly state: ManifestBaselineState;
}

/** Parse the manifest file, or `undefined` when absent/unreadable/not JSON. */
function readManifestFile(rootDir: string): Record<string, unknown> | undefined {
  const hashesPath = path.join(rootDir, '.minspec', HASHES_FILENAME);
  if (!fs.existsSync(hashesPath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(hashesPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Split a parsed manifest into its file entries and its stamped version. */
function splitManifest(parsed: Record<string, unknown> | undefined): {
  entries: Record<string, SectionHashes>;
  /**
   * The stamp KEY was present at all — reported separately from `version` because
   * the two answer different questions. A file with no stamp key dates itself: the
   * key did not exist before #1718, so its absence identifies a pre-authorship
   * manifest. A file whose stamp key holds something unreadable (a number, an empty
   * string) identifies nothing, and must not be described as old.
   */
  stamped: boolean;
  version: string | undefined;
} {
  const entries: Record<string, SectionHashes> = {};
  let stamped = false;
  let version: string | undefined;
  for (const key of Object.keys(parsed ?? {})) {
    const value = (parsed as Record<string, unknown>)[key];
    if (key === MANIFEST_STAMP_KEY) {
      stamped = true;
      const recorded = (value as { hashVersion?: unknown } | undefined)?.hashVersion;
      if (typeof recorded === 'string') version = recorded;
      continue;
    }
    entries[key] = value as SectionHashes;
  }
  return { entries, stamped, version };
}

/**
 * Which of the two "a manifest was here and MinSpec would not spend it" sentences
 * is TRUE of this stamp (#1697 NEW-A2, #1718 pre-fix manifest migration gap).
 *
 * Called only once the entries have already been refused, so it changes no merge
 * decision and cannot loosen the gate — it decides what the user is TOLD, which is
 * the half `===` collapses.
 */
function classifyUnspentManifest(
  stamped: boolean,
  version: string | undefined,
): 'pre-authorship' | 'unrecognised-version' {
  // No stamp key at all IS the pre-#1718 format — for a manifest MINSPEC WROTE. Two
  // things make that reading sound, and neither is "nobody else touches the file":
  // the stamp did not exist before that fix, so no older MinSpec could have written
  // one; and {@link saveHashes} is the only writer in `src/` and stamps everything it
  // emits, so no current MinSpec can omit one. That pair is a gate, not a habit —
  // `merge-refresh.test.ts` AC-73 asserts it, the writer-side twin of AC-60.
  //
  // It says nothing about a file edited by hand, and a hand-DELETED stamp key is
  // misdated here as old. The cost of that is bounded to ONE SENTENCE: this function
  // is reached only after {@link loadProvenHashes} has already refused the entries,
  // so a misdating changes what the user is told and never what is spent.
  if (!stamped) return 'pre-authorship';
  // A stamp both sides can be read as a plain integer, and lower than this build's,
  // is an older MinSpec's. Everything else — higher, non-numeric, empty, or a
  // `hashVersion` that was not even a string — is a file this build cannot read;
  // calling that one "older" would be a guess, and the guess points the reader at a
  // downgrade that may never have happened.
  const isPlainInteger = (candidate: string): boolean => /^\d+$/.test(candidate);
  if (
    version !== undefined &&
    isPlainInteger(version) &&
    isPlainInteger(MANIFEST_HASH_VERSION) &&
    Number(version) < Number(MANIFEST_HASH_VERSION)
  ) {
    return 'pre-authorship';
  }
  return 'unrecognised-version';
}

/**
 * Load persisted section hashes from .minspec/generated-hashes.json.
 * Returns empty object if file doesn't exist or is invalid.
 *
 * The {@link MANIFEST_STAMP_KEY} entry is stripped: `GeneratedHashes` means
 * "file path → section hashes", and the stamp is not a file. This is the RAW
 * reader — it reports what the manifest says, not what may be believed. Use
 * {@link loadProvenHashes} for anything that treats a recorded hash as evidence.
 */
export function loadHashes(rootDir: string): GeneratedHashes {
  return splitManifest(readManifestFile(rootDir)).entries;
}

/**
 * Load the prior manifest AS EVIDENCE — the reader every merge decision must use
 * (#1697 NEW-A2, closing #1718 pre-fix manifest migration gap).
 *
 * The whole of #1697 rests on one sentence: a recorded hash is a permission slip,
 * and MinSpec must never forge one. Fixing the code that forges them does nothing
 * about the slips ALREADY IN THE DRAWER. A project that has run any older MinSpec
 * has a manifest built by hashing final disk — so it already claims authorship of
 * the user's own paragraphs — and the fixed code, reading that manifest, believes
 * it. Measured end to end across the upgrade (probes `rv3-upgradeA/B.ts`): a
 * hand-written ops runbook, recorded by the old code, carried forward by the new
 * one at the leftover-preserve pass, and then overwritten by a template shipping
 * that heading, silently and totally. The identical outcome as the original bug, on
 * the code that fixes it.
 *
 * So an unstamped manifest yields NO evidence at all. Not "some entries are
 * suspect" — there is no test that separates a v1 entry recording MinSpec's output
 * from one recording the user's, so a partial rule would be a guess wearing a
 * proof's clothes. `mergeFile` already handles a total absence of evidence
 * correctly: it holds every section with authored content whose content differs
 * from the template, and reports what it held. One refresh later the manifest has
 * been rewritten under the current rules and every refresh after it is quiet again.
 *
 * ── What this costs, stated plainly ──────────────────────────────────────────
 *
 * The first refresh after the upgrade behaves like a fresh clone: sections are held
 * on absence of evidence and reported, including sections MinSpec itself wrote. The
 * sharpest case is a heading an older template shipped and a newer one dropped — the
 * leftover-preserve pass can no longer carry its entry forward, so if that heading
 * ever returns it is HELD and reported instead of updated, and the body being
 * protected is MinSpec's own stale prose. That is a false hold, and the comment at
 * the carry-forward used to invoke exactly it as the reason never to drop a proven
 * entry.
 *
 * It is still the right trade, and the two sides are not comparable. The false hold
 * costs a notice about a section the user can release in one keystroke (empty it;
 * the template returns on the next refresh) — and `preservedWithoutBaselineMessage`
 * now says so, rather than telling the reader the held body is theirs. Trusting the
 * old manifest costs the user's ratified governance text, deleted with no notice at
 * all, which is the bug that opened #1697 and the one shape this module exists to
 * make impossible. A hold is recoverable; a silent deletion is not.
 */
export function loadProvenHashes(rootDir: string): ManifestBaseline {
  const { entries, stamped, version } = splitManifest(readManifestFile(rootDir));
  if (version === MANIFEST_HASH_VERSION) {
    return { proven: entries, state: 'proven' };
  }
  // No entries ⇒ nothing was distrusted, so this is an ABSENT baseline and must not
  // be reported as a superseded one.
  if (Object.keys(entries).length === 0) return { proven: {}, state: 'absent' };
  // Refused either way; the state only decides which true sentence the hold gets.
  return { proven: {}, state: classifyUnspentManifest(stamped, version) };
}

/**
 * Save section hashes to .minspec/generated-hashes.json, stamped with the format
 * version that makes them readable as evidence (#1697 NEW-A2, closing #1718 pre-fix
 * manifest migration gap).
 *
 * This is the only writer of the file in `src/`, and its single write always emits
 * the stamp, so MinSpec cannot produce an unstamped manifest and forgetting to stamp
 * is not a reachable state for code in `src/`. That is asserted rather than
 * asked for: `merge-refresh.test.ts` AC-73 is the writer-side twin of AC-60. It
 * claims nothing about a manifest edited by hand or written by another program —
 * {@link classifyUnspentManifest} carries what such a file costs, and the answer is
 * one sentence in a notice, never a spent entry. Written FIRST, and any stamp key in
 * `hashes` dropped, so the serialized bytes stay deterministic for identical input
 * (SPEC-043 INV-4).
 */
export function saveHashes(rootDir: string, hashes: GeneratedHashes): void {
  const hashesPath = path.join(rootDir, '.minspec', HASHES_FILENAME);
  fs.mkdirSync(path.dirname(hashesPath), { recursive: true });
  const stamped: Record<string, unknown> = {
    [MANIFEST_STAMP_KEY]: { hashVersion: MANIFEST_HASH_VERSION },
  };
  for (const key of Object.keys(hashes)) {
    if (key === MANIFEST_STAMP_KEY) continue;
    stamped[key] = hashes[key];
  }
  fs.writeFileSync(hashesPath, JSON.stringify(stamped, null, 2) + '\n');
}

export const TEMPLATE_BASELINE_FILENAME = 'template-baseline.json';

/**
 * Load the raw-template section-hash baseline from
 * `.minspec/template-baseline.json`.
 *
 * This records the hash of each *unrendered* bundled template section (with
 * `{{placeholders}}` intact) as of the last generate/refresh — the like-for-like
 * reference `hasHarnessDrift` compares the current bundled template against. It
 * is deliberately SEPARATE from `generated-hashes.json`, which stores
 * rendered + user-merged content hashes for edit preservation. Comparing the raw
 * template against those rendered/merged hashes is what produced the perpetual
 * false-positive drift toast (#117): a raw `{{projectName}}` never hash-matches
 * the rendered project name.
 *
 * Returns `{}` if the file is missing or invalid.
 */
export function loadTemplateBaseline(rootDir: string): GeneratedHashes {
  const baselinePath = path.join(rootDir, '.minspec', TEMPLATE_BASELINE_FILENAME);
  if (!fs.existsSync(baselinePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(baselinePath, 'utf-8');
    return JSON.parse(raw) as GeneratedHashes;
  } catch {
    return {};
  }
}

/**
 * Persist the raw-template baseline to `.minspec/template-baseline.json`.
 * Written at every generate/refresh so drift detection always has a current
 * like-for-like reference. See {@link loadTemplateBaseline}.
 */
export function saveTemplateBaseline(rootDir: string, baseline: GeneratedHashes): void {
  const baselinePath = path.join(rootDir, '.minspec', TEMPLATE_BASELINE_FILENAME);
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
}

/**
 * A single manifest/disk disagreement discovered by
 * {@link verifyGeneratedHashesConsistent} (SPEC-043 FR-3 / INV-3).
 */
export interface ManifestInconsistency {
  /** Relative path of the managed file whose recorded hash disagrees with disk. */
  readonly filePath: string;
  /** The section (heading) whose recorded hash ≠ its on-disk body hash. */
  readonly heading: string;
  /** Hash recorded in the (in-memory / generated) manifest. */
  readonly recorded: string;
  /** `hashSection` of the section's current on-disk body (or a marker when absent). */
  readonly onDisk: string;
}

/**
 * Fail-closed consistency predicate (SPEC-043 FR-3 / FR-3a / INV-3). For every file
 * path in `hashes` that is ALSO present on disk, re-read the file, hash its sections
 * through the one shared {@link sectionHashesFromMarkdown} helper, and assert every
 * recorded section hash equals the on-disk section hash. Returns the list of
 * violations — empty ⇒ the manifest is consistent with disk.
 *
 * A recorded path whose file is ABSENT on disk is SKIPPED, not a violation
 * (FR-3a): a legitimately-removed template must never brick a refresh. A recorded
 * *section* that is missing from an otherwise-present file IS a violation — the
 * manifest is claiming a hash for content that is not on disk.
 *
 * NOTE on the write-path caller (`recordVerifyAndSaveManifest` in scaffold.ts): there
 * the manifest is recorded from the SAME final disk this function re-reads, so the
 * result is EMPTY by construction (Slice 1) — the gate is a fail-closed tripwire that
 * cannot fire in correct code, and defends only against a FUTURE change that records
 * the manifest from a non-disk source (record-before-write). Its independent value is
 * as a reusable predicate: an offline commit/CI-time check (#760) that hashes the
 * manifest against disk at a DIFFERENT time than it was recorded CAN legitimately
 * catch drift, and that is where this predicate actively earns its keep.
 *
 * Deterministic, offline (pure fs + SHA-256, INV-4). Read-only — it never writes. The
 * write-path caller aborts-without-persist on any non-empty result (D4).
 */
export function verifyGeneratedHashesConsistent(
  rootDir: string,
  hashes: GeneratedHashes,
): ManifestInconsistency[] {
  const violations: ManifestInconsistency[] = [];
  for (const filePath of Object.keys(hashes)) {
    const fullPath = path.join(rootDir, filePath);
    if (!fs.existsSync(fullPath)) continue; // absent file → skip (FR-3a)
    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue; // unreadable → treat as absent, never abort on an fs error
    }
    const diskHashes = sectionHashesFromMarkdown(content);
    const recorded = hashes[filePath];
    for (const heading of Object.keys(recorded)) {
      const onDisk = diskHashes[heading];
      if (onDisk !== recorded[heading]) {
        violations.push({
          filePath,
          heading,
          recorded: recorded[heading],
          onDisk: onDisk ?? '(section absent on disk)',
        });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Managed-region merge (#249, DR-037)
//
// Generalizes the existing `<!-- minspec:dr-index:start -->` marker convention to
// ANY file type via a per-call comment style. A managed region is the content
// between a start and end marker; on refresh MinSpec overwrites ONLY that region
// and preserves everything outside it verbatim. No content baseline is needed —
// the markers ARE the boundary, so user edits outside the region always survive and
// MinSpec's region is always brought current (unlike a whole-file preserve-on-edit
// rule, which one stray edit could freeze forever).
// ---------------------------------------------------------------------------

/** Parsed split of a file around a single managed region. */
export interface ManagedRegionSplit {
  /** Everything before the start marker (start marker excluded). */
  readonly before: string;
  /** Everything after the end marker (end marker excluded). */
  readonly after: string;
}

/**
 * Locate a managed region delimited by `startMarker` … `endMarker` (exact,
 * trimmed line matches) and return the content surrounding it. Returns `null` when
 * the markers are missing, out of order, or incomplete — the caller MUST treat a
 * `null` as "no recognizable region" and never clobber the file (never-wrong: a
 * deleted/corrupted marker is a skip-and-warn, not a silent whole-file overwrite).
 *
 * Matching is whole-line and whitespace-tolerant (the marker line may be indented
 * or trailing-padded) so reasonable hand-formatting of the surrounding file does
 * not break detection, while still requiring the exact marker text.
 */
export function splitManagedRegion(
  content: string,
  startMarker: string,
  endMarker: string,
): ManagedRegionSplit | null {
  if (typeof content !== 'string') return null;
  const lines = content.split('\n');

  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (startIdx === -1) {
      if (trimmed === startMarker) startIdx = i;
    } else if (trimmed === endMarker) {
      endIdx = i;
      break;
    }
  }

  // Both markers must be present, in order, and the end must follow the start.
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;

  const before = lines.slice(0, startIdx).join('\n');
  const after = lines.slice(endIdx + 1).join('\n');
  return { before, after };
}

/**
 * Rebuild a file from its preserved surroundings and a freshly rendered managed
 * block. Joins `before` + block + `after`, collapsing the seams so the block is
 * separated from non-empty surrounding content by exactly one blank line and no
 * stray leading/trailing whitespace accumulates across refreshes (idempotent: a
 * refresh that re-inserts the same block produces byte-identical output).
 *
 * Surrounding content is whitespace-trimmed at the seams (the user's own
 * non-whitespace bytes are preserved verbatim); the result ends in exactly one
 * trailing newline.
 */
export function spliceManagedRegion(
  split: ManagedRegionSplit,
  block: string,
): string {
  const beforeTrim = split.before.replace(/\s+$/, '');
  const afterTrim = split.after.replace(/^\s+/, '').replace(/\s+$/, '');
  const blockTrim = block.replace(/^\n+/, '').replace(/\n+$/, '');

  let out = '';
  if (beforeTrim.length > 0) out += beforeTrim + '\n\n';
  out += blockTrim + '\n';
  if (afterTrim.length > 0) out += '\n' + afterTrim + '\n';
  return out;
}
