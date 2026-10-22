/**
 * SPEC-095 (CRLF files read the same as LF and are written back as found), FR-1: the one
 * place where text read from disk is prepared for parsing, and where a writer's output is
 * put back in the line endings the file had.
 *
 * Three steps, and no other file in `packages/minspec/src` is meant to perform them:
 *
 *  - PREPARING ({@link prepareText}): every CRLF and every lone CR becomes LF. That is the
 *    rule the approval hash applies before anything else (`canonicalizeSpec` in
 *    `@aiclarity/shared`), so a parser handed prepared text sees what the hash sees. The
 *    hash keeps its own copy of the rule: this spec does not change what the approval
 *    hash covers (FR-8).
 *  - DETECTING ({@link lineEndingOf}): the ending most of a file's terminated lines use. A
 *    tie, or a file with no terminator at all, is LF (FR-4).
 *  - RESTORING ({@link restoreLineEndings}): each line of a writer's LF output gets an
 *    ending back. A line whose text stands in the input keeps the ending it had there,
 *    occurrences of a repeated text paired in order; every other line takes the file's
 *    ending (FR-4). So a file with one ending comes back in it (FR-3), a line MinSpec did
 *    not change keeps its bytes (INV-6), and an LF file comes back byte for byte (FR-11).
 *
 * Text is prepared where it is read and restored where it is written, and nowhere in
 * between: every parser downstream of a read sees LF and needs no line-ending code of its
 * own. A file MinSpec creates, the JSON it re-serializes and a managed file its own
 * `.gitattributes` block pins to LF are written LF, and do not come through here (FR-5).
 *
 * A leading byte order mark is not handled here yet. SPEC-095's second slice moves the
 * #2404 strip into the preparing step and teaches restoring to put the mark back, never
 * adding one (DQ-3, DQ-8); until then a marked file reads and writes as it does today.
 *
 * Plain library code: no `vscode`, no dependency, and no platform branch. The result
 * depends on the bytes alone, so the same input gives the same output on every machine
 * (INV-5, INV-7).
 */
import * as fs from 'fs';

/** A line terminator: CRLF, LF, or a lone CR. */
export type LineEnding = '\r\n' | '\n' | '\r';

/**
 * Preparing: turn every CRLF and every lone CR into LF.
 *
 * LF text comes back unchanged. Preparing text that is already prepared is therefore
 * harmless, which is what lets a function in the Context tables prepare at its own entry
 * even when its caller already read through this module.
 */
export function prepareText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n');
}

interface Line {
  readonly text: string;
  /** `''` only for a last line that has no terminator. */
  readonly eol: LineEnding | '';
}

function splitLines(raw: string): Line[] {
  const lines: Line[] = [];
  const terminator = /\r\n|\n|\r/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = terminator.exec(raw)) !== null) {
    lines.push({ text: raw.slice(start, m.index), eol: m[0] as LineEnding });
    start = m.index + m[0].length;
  }
  if (start < raw.length) lines.push({ text: raw.slice(start), eol: '' });
  return lines;
}

function majorityOf(lines: readonly Line[]): LineEnding {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (const line of lines) {
    if (line.eol === '\r\n') crlf++;
    else if (line.eol === '\n') lf++;
    else if (line.eol === '\r') cr++;
  }
  if (crlf > lf && crlf > cr) return '\r\n';
  if (cr > lf && cr > crlf) return '\r';
  // LF is the majority, or there is a tie, or there is no terminator at all (FR-4).
  return '\n';
}

function asList(original: string | readonly string[]): readonly string[] {
  return typeof original === 'string' ? [original] : original;
}

/**
 * Detecting: the line ending of a text, which is whichever of CRLF, LF and lone CR ends
 * most of its lines; a tie, or no terminator at all, is LF (FR-4).
 *
 * Several texts are counted together. That is one case only: the files of a spec-kit
 * directory migrated into one flat file, whose input is all of them.
 */
export function lineEndingOf(original: string | readonly string[]): LineEnding {
  return majorityOf(asList(original).flatMap(splitLines));
}

/**
 * Restoring: give each line of `lfText`, a writer's output, the ending FR-4 assigns it, on
 * the evidence of `original`, the text that writer read.
 *
 * Every line of `lfText` that is followed by `\n` is a terminated line. One whose text
 * stands, terminated, in `original` takes the ending it had there; when the same text
 * stands more than once, its occurrences are paired in order. Every other terminated line
 * takes the original's own ending ({@link lineEndingOf}). The last piece of `lfText`, after
 * its final `\n`, keeps no terminator, as it had none.
 *
 * A carriage return INSIDE `lfText` is content, not an ending, so a writer's output is
 * never re-split. When `original` holds no carriage return at all this returns `lfText`
 * itself, so an LF file is written exactly as it was before this module existed (FR-11).
 */
export function restoreLineEndings(lfText: string, original: string | readonly string[]): string {
  const originals = asList(original);
  if (!originals.some((text) => text.includes('\r'))) return lfText;

  const lines = originals.flatMap(splitLines);
  const fileEnding = majorityOf(lines);
  const endingsOf = new Map<string, { readonly endings: LineEnding[]; next: number }>();
  for (const line of lines) {
    if (line.eol === '') continue;
    const seen = endingsOf.get(line.text);
    if (seen) seen.endings.push(line.eol);
    else endingsOf.set(line.text, { endings: [line.eol], next: 0 });
  }

  const pieces = lfText.split('\n');
  let out = '';
  for (let i = 0; i < pieces.length - 1; i++) {
    const seen = endingsOf.get(pieces[i]);
    const paired = seen && seen.next < seen.endings.length ? seen.endings[seen.next++] : undefined;
    out += pieces[i] + (paired ?? fileEnding);
  }
  return out + pieces[pieces.length - 1];
}

/** A document as read: its prepared text, and the text exactly as it was on disk. */
export interface TextDocument {
  /** LF text, for parsing and for a writer to work on. */
  readonly text: string;
  /** The text as read, for {@link restoreLineEndings} when the document is written back. */
  readonly original: string;
}

/**
 * Read a document a writer will write back: the prepared text to work on, and the text as
 * it was, to restore from. Throws whatever `fs.readFileSync` throws.
 */
export function readDocument(filePath: string): TextDocument {
  const original = fs.readFileSync(filePath, 'utf-8');
  return { text: prepareText(original), original };
}

/** Read a document for a reader that writes nothing back: its prepared text. */
export function readDocumentText(filePath: string): string {
  return prepareText(fs.readFileSync(filePath, 'utf-8'));
}
