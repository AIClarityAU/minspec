/**
 * Command-reference extraction — structural gate helper (RCDD / DR-003, #126).
 *
 * MinSpec ships NO shell CLI: every package is `bin: null`; `minspec.*` are VS
 * Code commands declared in package.json `contributes.commands` (each has a
 * `command` id + palette `title` like "MinSpec: Classify Task Complexity").
 *
 * A generated harness (CLAUDE.md etc.) or the repo's own docs must therefore only
 * reference REAL palette titles, and must never advertise a `minspec <subcommand>`
 * shell invocation. Nothing previously asserted this correspondence, so a phantom
 * CLI shipped in both. These pure helpers let tests parse command references out of
 * any rendered/doc text and check them against the real command set.
 */

/** A `MinSpec: <Title>` palette title referenced in prose (without surrounding markup). */
export type PaletteTitleRef = string;

/**
 * Extract every `MinSpec: <Title>` palette-title reference from arbitrary text.
 *
 * Handles the markup the templates use (italic `*MinSpec: …*`, bold
 * `**MinSpec: …**`, table cells `| MinSpec: … |`, backticks). A real title starts
 * with an uppercase letter after `MinSpec: ` (so the bare quoted prefix `"MinSpec:"`
 * — prose that just names the command namespace — is NOT treated as a title) and
 * runs up to the first delimiter that cannot be part of a palette title: markup
 * (`*`, `|`, backtick, quote), newline, or end of string. A trailing sentence
 * period and surrounding whitespace are trimmed so the result matches package.json
 * titles verbatim.
 *
 * Returns a de-duplicated list in first-seen order.
 */
export function extractPaletteTitleRefs(text: string): PaletteTitleRef[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  // MinSpec:[ \t]+   the prefix + at least one space
  // [A-Z]            title must start with a capital (excludes the quoted prefix
  //                  string "MinSpec:" used in prose like: typing "MinSpec:")
  // [^*|`"\n\r]*     rest of the title up to markup / quote / newline
  const re = /MinSpec:[ \t]+[A-Z][^*|`"\n\r]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Normalize internal whitespace and drop a trailing sentence period.
    const title = m[0].replace(/\s+/g, ' ').replace(/\.\s*$/, '').trim();
    if (!seen.has(title)) {
      seen.add(title);
      refs.push(title);
    }
  }
  return refs;
}

/**
 * Extract every `minspec <subcommand>` shell-CLI-style invocation from text.
 *
 * A shell invocation is the canonical command-line shape: lowercase `minspec` as
 * the FIRST token on a line (after optional indentation and an optional shell
 * prompt `$`/`>`), followed by a subcommand token (e.g. `minspec init`,
 * `minspec classify`, `minspec init --refresh`). Anchoring to line-start avoids
 * flagging English prose such as "the minspec extension" while still catching the
 * exact phantom block the docs used to ship. `minspec.<id>` dotted VS Code command
 * ids are excluded via lookahead. Because MinSpec ships no CLI, ANY match is a
 * phantom invocation and must fail the gate.
 *
 * Returns de-duplicated invocations (`minspec <subcommand>`) in first-seen order.
 */
export function extractShellCliInvocations(text: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  // ^                  start of line (m flag)
  // [ \t]*             optional indentation (inside a code block)
  // (?:[$>][ \t]+)?     optional shell prompt
  // minspec(?!\.)      lowercase command word, not a dotted id (minspec.init)
  // [ \t]+(-{0,2}[a-z][a-z-]*)  subcommand or flag token
  const re = /^[ \t]*(?:[$>][ \t]+)?minspec(?!\.)[ \t]+(-{0,2}[a-z][a-z-]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const invocation = `minspec ${m[1]}`;
    if (!seen.has(invocation)) {
      seen.add(invocation);
      refs.push(invocation);
    }
  }
  return refs;
}
