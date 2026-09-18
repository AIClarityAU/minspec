/**
 * swallowed-gate-signal.ts — the pure decision half of the DR-066 clause 1 lint (#1859).
 *
 * DR-066 "no silent gate" clause 1: *no load-bearing gate signal is written with a
 * swallowed error (`|| true`)*. That clause has been enforced by six hand-fixes and
 * nothing else, which is the shape the constitution names as "enforce, don't trust the
 * model" — a prose rule the model must remember drifts, so it drifts.
 *
 * ── What counts as a violation ───────────────────────────────────────────────
 * `|| true` is not itself a defect. `rm -f "$tmp" || true` is fine: nothing reads the
 * result. The defect needs THREE properties together, and this module requires all
 * three before it reports anything:
 *
 *   1. the failure is swallowed — `|| true` or `|| :`;
 *   2. the output is CAPTURED into a variable, so a caller consumes it; and
 *   3. that variable later drives CONTROL FLOW — an `if`, a `[[ ]]` test, a `while`,
 *      a `case`, an arithmetic context.
 *
 * Together those three are the definition of "load-bearing" that clause 1 is about:
 * a decision is being made from a value that is empty on success-with-no-results and
 * empty on total failure, with no way to tell the two apart. That is #1855 exactly —
 * `ready=$(gh ... || true)` feeding an emptiness test, so a failed query reports as
 * "cycle done".
 *
 * Requiring all three is what keeps the lint landable. The repo has 118 `|| true`
 * occurrences under `scripts/`; the overwhelming majority are cleanup or best-effort
 * notification, where swallowing is the correct and intended behaviour. A lint that
 * flagged those would be turned off in a week, and a lint that is off enforces nothing.
 *
 * ── Two markers, because "reviewed" and "fine" are different claims ──────────
 * A same-line comment silences a finding. The reason is mandatory in both forms — a
 * bare marker is not accepted — so the escape hatch costs a sentence of justification
 * and leaves it next to the code. This mirrors the secret scanner's `pii-ok`, which is
 * the idiom this repo already reaches for.
 *
 *   `# swallow-ok: <reason>`          reviewed and CORRECT. The swallowed exit status
 *                                     genuinely carries no information the branch needs
 *                                     (e.g. grep's exit 1 meaning "no match", which is
 *                                     the answer rather than a failure).
 *   `# swallow-known: #NNNN <reason>` reviewed and WRONG, with a tracking issue. Does
 *                                     not fail the build, but is printed on every run
 *                                     and counted in the summary.
 *
 * The second marker exists because this lint arrives after the violations do. Labelling
 * a known defect "ok" to get to green is how a baseline becomes a lie; naming it as debt
 * with an issue number keeps it countable and attributable. A `swallow-known` entry with
 * no issue number is rejected in the same way a reasonless `swallow-ok` is.
 *
 * ── Known limits, stated rather than hidden ──────────────────────────────────
 * This joins an assignment's continuation lines by paren depth, so a substitution
 * split across lines is seen — that mattered, because #1855's own line is split across
 * two and the first draft of this lint missed the defect it was written for.
 *
 * It is still not a shell parser. It does not follow a swallow inside a function
 * called elsewhere, a value that reaches a conditional through a second variable, or
 * a paren inside a quoted string (depth counting is quote-blind). It under-reports; it
 * is a floor on clause 1, not a proof of it. A pass here does not mean a script is
 * clause-1 clean.
 */

/** One flagged assignment: a swallowed capture whose value later decides something. */
export interface SwallowedSignal {
  /** Repo-relative path of the script. */
  file: string;
  /** 1-indexed line of the assignment that swallows. */
  line: number;
  /** The variable the swallowed output was captured into. */
  variable: string;
  /** The offending source line, trimmed. */
  text: string;
  /** 1-indexed lines where the variable goes on to drive control flow. */
  decidesAt: number[];
  /**
   * Set when the line carries `# swallow-known: #NNNN` — a violation that is real,
   * accepted for now, and tracked. Reported but not fatal. `undefined` means this is
   * an unannotated finding, which fails the build.
   */
  knownIssue?: number;
}

/**
 * An assignment capturing a command substitution. Covers the plain form, the
 * declaration keywords (`local`/`declare`/`readonly`/`export`), both swallow positions —
 * inside the substitution (`x=$(cmd || true)`) and outside it (`x=$(cmd) || true`) — and,
 * critically, the QUOTED idiom `x="$(cmd || true)"`.
 *
 * The quote is not cosmetic. The first version of this regex required an unquoted `$(`
 * immediately after `=`, which made 257 quoted captures under `scripts/` invisible while
 * the check cheerfully printed "clause 1: clean". One of them was
 * `review-decide.sh`'s BEGIN_COUNT, which decides the merge gate. A lint that reports
 * clean over the dominant idiom is worse than no lint, because it converts an unknown
 * into a false assurance. Caught by review on #1980, not by this file's own tests, which
 * is why INV-5 now asserts the quoted form directly.
 */
const ASSIGN =
  /^\s*(?:local\s+|declare\s+(?:-\w+\s+)?|readonly\s+|export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(?:"\s*)?\$\(/;

/**
 * `|| true` / `|| :` — the swallow itself. `:` is bash's no-op builtin.
 *
 * The trailing boundary must admit `;` and `&` as well as whitespace, end-of-line and
 * `)`. `{ cmd || true; }` inside a capture is a common idiom — 12 occurrences under
 * `scripts/` — and requiring whitespace-or-paren made every one invisible. That is the
 * THIRD boundary bug of this exact shape on this lint: first the unquoted-only `=$(`,
 * then physical-line scanning, now this. Each one reported "clause 1: clean" over a
 * whole idiom, which is the failure mode that makes a lint worse than none. Pinned by
 * INV-7 on the real gh-bot.sh.
 */
const SWALLOW = /\|\|\s*(?:true|:)(?:[\s;&)]|$)/;

/** Reviewed and correct. The reason after the colon is required. */
const OK = /#\s*swallow-ok:\s*\S/;

/** Reviewed, wrong, and tracked. The `#NNNN` issue reference is required. */
const KNOWN = /#\s*swallow-known:\s*#(\d+)\s*\S/;

/** Lines that branch. A variable read here is deciding something. */
const CONTROL_FLOW = /^\s*(?:if|elif|while|until|case|for)\b|\[\[|\(\(|^\s*\[\s/;

/** `$VAR`, `${VAR}`, `${VAR:-…}` — any read of the captured value. */
const readsVariable = (line: string, variable: string): boolean =>
  new RegExp(`\\$\\{?${variable}\\b`).test(line);

/**
 * Report every swallowed capture in one script whose value later drives control flow.
 *
 * @param file   repo-relative path, echoed back on each finding
 * @param source full text of the script
 */
/**
 * One shell statement, which may span several physical lines.
 *
 * Both halves of this lint need the same joining. An assignment's substitution can span
 * lines (`x=$(cmd \n --flag || true)`), and so can the conditional that consumes it
 * (`if VERDICT=$(check \n "$CAPTURED")`). Scanning physical lines missed the first and
 * then missed the second, so joining happens once, here, and both passes read the result.
 */
interface Statement {
  text: string;
  /** 1-indexed first physical line. */
  start: number;
  /** 1-indexed last physical line. */
  end: number;
  /** The physical lines, so a marker on any of them applies to the whole statement. */
  lines: string[];
}

/**
 * Group physical lines into statements, joining while parentheses are unbalanced or the
 * line ends in a backslash continuation.
 *
 * Depth counting is quote-blind: a `)` inside a quoted string closes the span early. That
 * under-reports (the swallow past it goes unseen) rather than over-reports, which is the
 * safe direction for a lint people have to live with.
 */
function statements(lines: string[]): Statement[] {
  const out: Statement[] = [];
  let index = 0;

  while (index < lines.length) {
    let depth = 0;
    let end = index;
    for (; end < lines.length; end += 1) {
      for (const ch of lines[end]) {
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
      }
      if (depth <= 0 && !lines[end].trimEnd().endsWith('\\')) break;
    }
    if (end >= lines.length) end = lines.length - 1;

    const span = lines.slice(index, end + 1);
    out.push({ text: span.join(' '), start: index + 1, end: end + 1, lines: span });
    index = end + 1;
  }

  return out;
}

/**
 * Report every swallowed capture in one script whose value later drives control flow.
 *
 * @param file   repo-relative path, echoed back on each finding
 * @param source full text of the script
 */
export function findSwallowedGateSignals(file: string, source: string): SwallowedSignal[] {
  const stmts = statements(source.split('\n'));
  const findings: SwallowedSignal[] = [];

  stmts.forEach((stmt, position) => {
    const assignment = ASSIGN.exec(stmt.lines[0]);
    if (!assignment) return;
    if (!SWALLOW.test(stmt.text)) return;
    // A marker anywhere in the statement applies to it, so the reason can sit on
    // whichever of its lines reads best.
    if (stmt.lines.some((line) => OK.test(line))) return;
    const known = stmt.lines.map((line) => KNOWN.exec(line)).find(Boolean);

    const variable = assignment[1];

    // Only statements AFTER this one can be reading the capture. A read above it belongs
    // to whatever the variable held before, which is not this finding.
    const decidesAt: number[] = [];
    for (let i = position + 1; i < stmts.length; i += 1) {
      const later = stmts[i];
      if (CONTROL_FLOW.test(later.text) && readsVariable(later.text, variable)) {
        decidesAt.push(later.start);
      }
    }

    if (decidesAt.length > 0) {
      findings.push({
        file,
        line: stmt.start,
        variable,
        text: stmt.text.trim(),
        decidesAt,
        ...(known ? { knownIssue: Number(known[1]) } : {}),
      });
    }
  });

  return findings;
}

/** Findings with no marker. These are what fail the build. */
export const unannotated = (findings: SwallowedSignal[]): SwallowedSignal[] =>
  findings.filter((f) => f.knownIssue === undefined);

/** Human-readable report for one finding, in the `file:line` form the editor links. */
export function formatSwallowedSignal(finding: SwallowedSignal): string {
  const where = finding.decidesAt.map((n) => `${finding.file}:${n}`).join(', ');
  if (finding.knownIssue !== undefined) {
    return [
      `${finding.file}:${finding.line}  $${finding.variable} — known, tracked by #${finding.knownIssue}`,
      `    ${finding.text}`,
      `    decides at: ${where}`,
    ].join('\n');
  }
  return [
    `${finding.file}:${finding.line}  $${finding.variable} captures a swallowed failure, then decides`,
    `    ${finding.text}`,
    `    decides at: ${where}`,
    `    A failed command and a successful empty result are indistinguishable here, so the`,
    `    branch treats "could not look" as "looked, found nothing" (DR-066 clause 1).`,
    `    Fix: keep the exit status and fail closed on it. If the swallow is genuinely`,
    `    correct, say why inline:            # swallow-ok: <reason>`,
    `    If it is a real defect you are not fixing now, track it:`,
    `                                        # swallow-known: #NNNN <reason>`,
  ].join('\n');
}
