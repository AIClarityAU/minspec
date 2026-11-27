#!/usr/bin/env -S npx tsx
/**
 * check-gate-signals.ts - SPEC-054 FR-1/FR-2: the DR-066 clause-1 gate-signal write linter.
 *
 * Constitution invariant 2, clause 1: no load-bearing gate signal is written with a
 * swallowed error. This scanner finds every WRITE of a gate signal - a commit status, a
 * check-run, or a gate-relevant label - in workflow YAML (`run:` and `actions/github-script`
 * `script:` blocks), in `.github/scripts/**.js`, and in `scripts/**` (`.sh`, `.js`, `.mjs`,
 * `.ts`), and judges whether the write's failure is OBSERVED (its exit status can reach a
 * branch or fail the step) and SURFACED (the failure branch emits a visible signal or fails
 * the step). A write that is neither is a finding. The predicate and the classification
 * tables are design.md's "FR-1 scanner" section; this file is their only implementation.
 *
 * It is a sibling of `check-swallowed-gate-signal.ts` (#1859), not an extension of it: that
 * lint judges a CAPTURED value that later drives control flow; this one judges a WRITE.
 * Neither predicate implies the other (design.md, "What Plan found", item 1).
 *
 * FR-2 waiver: a comment line `gate-signal-allow: <reason>` (after `#` in shell and YAML,
 * after `//` in JavaScript) on the line IMMEDIATELY above the write's first line exempts that
 * one write. A bare annotation (no reason) and an orphan annotation (no write below it) are
 * findings. Every run prints every waiver it honoured, including `0 waivers honoured`.
 *
 *   npx tsx scripts/check-gate-signals.ts [--root <dir>]
 *
 * Exit 0 = no findings. Exit 1 = findings. Exit 2 = the check could not do its job.
 *
 * FAIL CLOSED. An unreadable file, a missing root, a walk that found zero workflows, a block
 * scalar the extractor does not recognise, or shell it cannot parse is exit 2 naming the
 * file. No path exits 0 without having read the tree.
 *
 * NOT A PROOF. Like #1859's lexer this is not a full shell evaluator: it does not follow a
 * write into a function defined elsewhere, a `bash -c` string, or a JavaScript helper deeper
 * than one level. It under-reports. A pass is a floor on clause 1, not a proof of it.
 *
 * Offline (INV-2, AC-8): no process spawn, no network module. The only imports are the file
 * system, the `typescript` parser and the gate manifest.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import * as ts from 'typescript';

import { GATE_LABEL_PATTERNS } from './lib/gate-manifest';

// ── Public types ─────────────────────────────────────────────────────────────

/** "This check could not do its job" - always exit 2, never a silent pass. */
export class ScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanError';
  }
}

export type Verdict = 'ok' | 'unobserved' | 'unsurfaced';

/** One gate-signal write the scanner saw, and how its failure is handled. */
export interface WriteSite {
  file: string;
  /** 1-based source line of the write's first line. */
  line: number;
  verdict: Verdict;
  /** The source text of that line, trimmed. */
  text: string;
}

export type FindingKind = 'unobserved' | 'unsurfaced' | 'bare annotation' | 'orphan annotation';

export interface Finding {
  file: string;
  line: number;
  kind: FindingKind;
  text: string;
}

/** An FR-2 annotation that waived a write. */
export interface Waiver {
  file: string;
  /** Line of the annotation itself. */
  line: number;
  /** Line of the write it waived. */
  writeLine: number;
  reason: string;
}

export interface ScanResult {
  sites: WriteSite[];
  findings: Finding[];
  waivers: Waiver[];
}

/**
 * R5's allowlist of surfacing forms - extended only by a code change. A failure branch that
 * contains one of these, or fails the step, is surfaced.
 */
export const SURFACING_FORMS = {
  shell: [/::warning\b/, /::error\b/, />>\s*["']?\$\{?GITHUB_STEP_SUMMARY\b/] as readonly RegExp[],
  javascript: ['core.warning', 'core.error', 'core.setFailed', 'core.summary'] as readonly string[],
} as const;

// ── Write predicate (2.1) ────────────────────────────────────────────────────

const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/;

/** Remove shell quoting from a word; `$VAR` and `$(...)` text is kept as written. */
function dequote(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "'") {
      const end = raw.indexOf("'", i + 1);
      out += raw.slice(i + 1, end < 0 ? raw.length : end);
      i = end < 0 ? raw.length : end;
    } else if (c === '$' && raw[i + 1] === "'") {
      const end = raw.indexOf("'", i + 2);
      out += raw.slice(i + 2, end < 0 ? raw.length : end);
      i = end < 0 ? raw.length : end;
    } else if (c === '"') {
      continue;
    } else if (c === '\\' && i + 1 < raw.length) {
      out += raw[++i];
    } else {
      out += c;
    }
  }
  return out;
}

/** The command and its arguments, past leading assignments and `env`/`command`/`exec`. */
function commandArgs(words: readonly string[]): string[] {
  let i = 0;
  while (i < words.length && ASSIGN_RE.test(words[i])) i++;
  if (words[i] === 'env') {
    i++;
    while (i < words.length && (ASSIGN_RE.test(words[i]) || words[i].startsWith('-'))) i++;
  }
  while (words[i] === 'command' || words[i] === 'exec') i++;
  return words.slice(i);
}

const GH_API_VALUE_FLAGS = new Set([
  '-H',
  '--header',
  '-q',
  '--jq',
  '-t',
  '--template',
  '--hostname',
  '--cache',
  '-p',
  '--preview',
]);
const GH_API_FIELD_FLAGS = new Set(['-f', '-F', '--field', '--raw-field', '--input']);

function isApiWrite(args: readonly string[]): boolean {
  let endpoint: string | undefined;
  let method: string | undefined;
  let hasFields = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-X' || a === '--method') {
      method = args[++i] ?? '';
    } else if (a.startsWith('--method=')) {
      method = a.slice('--method='.length);
    } else if (/^-X./.test(a)) {
      method = a.slice(2);
    } else if (GH_API_FIELD_FLAGS.has(a)) {
      hasFields = true;
      i++;
    } else if (/^-[fF]./.test(a) || /^--(field|raw-field|input)=/.test(a)) {
      hasFields = true;
    } else if (GH_API_VALUE_FLAGS.has(a)) {
      i++;
    } else if (a.startsWith('-')) {
      // a boolean flag (--paginate, --silent, -i, ...) or a --flag=value form
    } else if (endpoint === undefined) {
      endpoint = a;
    }
  }
  if (endpoint === undefined) return false;
  const path = endpoint.split('?')[0];
  const m = method?.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return false;
  if (/(^|\/)statuses\/[^/]+/.test(path) && !/(^|\/)commits\//.test(path)) return true;
  if (/(^|\/)check-runs(\/|$)/.test(path)) {
    if (m !== undefined) return m === 'POST' || m === 'PATCH' || m === 'PUT' || m.includes('$');
    return hasFields;
  }
  return false;
}

/** A label is gate-relevant when it matches the manifest set, or the scanner cannot resolve it. */
function isGateLabel(label: string): boolean {
  const l = label.trim();
  if (l.includes('$') || l.includes('`')) return true;
  return GATE_LABEL_PATTERNS.some((p) => p.test(l));
}

function labelArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    let value: string | undefined;
    if (a === '--add-label' || a === '--remove-label') value = args[++i] ?? '';
    else if (a.startsWith('--add-label=') || a.startsWith('--remove-label=')) value = a.slice(a.indexOf('=') + 1);
    if (value !== undefined) out.push(...value.split(','));
  }
  return out;
}

/** Is this dequoted argument vector a gate-signal write? */
function isWriteArgs(words: readonly string[]): boolean {
  const args = commandArgs(words);
  if (args.length < 2 || !/(^|\/)gh$/.test(args[0])) return false;
  if (args[1] === 'api') return isApiWrite(args.slice(2));
  if ((args[1] === 'pr' || args[1] === 'issue') && args[2] === 'edit') {
    return labelArgs(args.slice(3)).some(isGateLabel);
  }
  return false;
}

/**
 * FR-1 write predicate for shell text: a commit-status post, a check-run POST/PATCH, or a
 * `gh pr|issue edit` adding or removing a gate-relevant label. Label-object creation
 * (`gh label create`) is never a write (DQ-7, the narrower predicate).
 */
export function isGateSignalWrite(command: string): boolean {
  const unit = makeShellUnit('<command>', command, 1, { errexit: true, pipefail: false });
  return scanShellUnit(unit).length > 0;
}

// ── Shell units, tokenizer and parser (2.2) ──────────────────────────────────

/** One shell text: a `run:` block or a `.sh` file. */
export interface ShellUnit {
  file: string;
  text: string;
  /** Source line (1-based) of every character of `text`. */
  charLine: readonly number[];
  /** The whole file's lines, so a site can quote its source line. */
  source: readonly string[];
  errexit: boolean;
  pipefail: boolean;
}

/** A shell unit whose text maps line-for-line onto source starting at `firstLine`. */
export function makeShellUnit(
  file: string,
  body: string,
  firstLine: number,
  opts: { errexit: boolean; pipefail: boolean },
): ShellUnit {
  const charLine: number[] = [];
  let line = firstLine;
  for (const c of body) {
    charLine.push(line);
    if (c === '\n') line++;
  }
  const source = [...Array<string>(firstLine - 1).fill(''), ...body.split('\n')];
  return { file, text: body, charLine, source, ...opts };
}

/** A `.sh` file: `errexit` only from a shebang `-e`; a later `set -e` turns it on as it runs. */
export function shellUnitFromScript(file: string, source: string): ShellUnit {
  const first = source.split('\n', 1)[0] ?? '';
  const errexit = /^#!.*\s-[a-zA-Z]*e[a-zA-Z]*(\s|$)/.test(first);
  return makeShellUnit(file, source, 1, { errexit, pipefail: false });
}

interface Sub {
  start: number;
  end: number;
}
interface WordTok {
  kind: 'word';
  raw: string;
  start: number;
  end: number;
  subs: Sub[];
  redirect: boolean;
}
interface OpTok {
  kind: 'op';
  op: string;
  start: number;
}
interface NlTok {
  kind: 'nl';
  start: number;
}
type Token = WordTok | OpTok | NlTok;

class Lexer {
  constructor(
    private readonly text: string,
    private readonly unit: ShellUnit,
  ) {}

  fail(at: number, why: string): never {
    throw new ScanError(`${this.unit.file}:${this.unit.charLine[at] ?? '?'}: could not parse shell (${why})`);
  }

  /** Index just past the `'` closing the single-quoted string opened at `i`. */
  single(i: number, to: number): number {
    const end = this.text.indexOf("'", i + 1);
    if (end < 0 || end >= to) this.fail(i, 'unterminated single quote');
    return end + 1;
  }

  /** Index just past the `"` closing the double-quoted string opened at `i`. */
  double(i: number, to: number, subs: Sub[]): number {
    let j = i + 1;
    while (j < to) {
      const c = this.text[j];
      if (c === '\\') j += 2;
      else if (c === '"') return j + 1;
      else if (c === '$' && this.text[j + 1] === '(') j = this.dollarParen(j, to, subs);
      else if (c === '$' && this.text[j + 1] === '{') j = this.brace(j + 1, to);
      else if (c === '`') j = this.backtick(j, to, subs);
      else j++;
    }
    return this.fail(i, 'unterminated double quote');
  }

  /** `$(` or `$((` at `i`; index just past the closing paren(s). */
  dollarParen(i: number, to: number, subs: Sub[]): number {
    if (this.text[i + 2] === '(') return this.parens(i + 1, to);
    const close = this.parens(i + 1, to);
    subs.push({ start: i + 2, end: close - 1 });
    return close;
  }

  /** Balanced `(`...`)` starting at `i` (which holds `(`); index just past the match. */
  parens(i: number, to: number): number {
    let depth = 0;
    let j = i;
    const pending: string[] = [];
    while (j < to) {
      const c = this.text[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '\n' && pending.length) {
        j = this.heredocs(j + 1, to, pending.splice(0));
        continue;
      }
      if (c === '<' && this.text[j + 1] === '<' && this.text[j + 2] !== '<') {
        const here = /^<<-?\s*(['"]?)([^'"\s)]+)\1/.exec(this.text.slice(j, j + 200));
        if (here) {
          pending.push(here[2]);
          j += here[0].length;
          continue;
        }
      }
      if (c === "'") {
        j = this.single(j, to);
        continue;
      }
      if (c === '"') {
        j = this.double(j, to, []);
        continue;
      }
      if (c === '`') {
        j = this.backtick(j, to, []);
        continue;
      }
      if (c === '#' && (j === 0 || /\s/.test(this.text[j - 1]))) {
        while (j < to && this.text[j] !== '\n') j++;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return j + 1;
      j++;
    }
    return this.fail(i, 'unbalanced parenthesis');
  }

  /** `{` at `i` (after a `$`); index just past the matching `}`. */
  brace(i: number, to: number): number {
    let depth = 0;
    let j = i;
    while (j < to) {
      const c = this.text[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === "'" && depth > 1) {
        j = this.single(j, to);
        continue;
      }
      if (c === '"') {
        j = this.double(j, to, []);
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return j + 1;
      j++;
    }
    return this.fail(i, 'unbalanced brace');
  }

  backtick(i: number, to: number, subs: Sub[]): number {
    let j = i + 1;
    while (j < to) {
      if (this.text[j] === '\\') j += 2;
      else if (this.text[j] === '`') {
        subs.push({ start: i + 1, end: j });
        return j + 1;
      } else j++;
    }
    return this.fail(i, 'unterminated backtick');
  }

  word(i: number, to: number): WordTok {
    const start = i;
    const subs: Sub[] = [];
    let j = i;
    let redirect = false;
    while (j < to) {
      const c = this.text[j];
      const sofar = this.text.slice(start, j);
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') break;
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === "'") {
        j = this.single(j, to);
        continue;
      }
      if (c === '"') {
        j = this.double(j, to, subs);
        continue;
      }
      if (c === '`') {
        j = this.backtick(j, to, subs);
        continue;
      }
      if (c === '$' && this.text[j + 1] === '(') {
        j = this.dollarParen(j, to, subs);
        continue;
      }
      if (c === '$' && this.text[j + 1] === '{') {
        j = this.brace(j + 1, to);
        continue;
      }
      if ((c === '<' || c === '>') && this.text[j + 1] === '(') {
        const close = this.parens(j + 1, to);
        subs.push({ start: j + 2, end: close - 1 });
        j = close;
        continue;
      }
      if (c === '<' || c === '>' || (c === '&' && this.text[j + 1] === '>')) {
        if (sofar !== '' && !/^\d+$/.test(sofar) && !redirect) break;
        if (redirect && !/[<>&|-]$/.test(sofar)) break;
        redirect = true;
        while (j < to && /[<>&|-]/.test(this.text[j])) j++;
        while (j < to && (this.text[j] === ' ' || this.text[j] === '\t')) j++;
        continue;
      }
      if (c === '(') {
        if (/^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=$/.test(sofar) || /[?*+@!]$/.test(sofar)) {
          j = this.parens(j, to);
          continue;
        }
        break;
      }
      if (c === ';' || c === '|' || c === '&' || c === ')') break;
      j++;
    }
    return { kind: 'word', raw: this.text.slice(start, j), start, end: j, subs, redirect };
  }

  /** Skip heredoc bodies that start at `i`; index of the first line after the last one. */
  heredocs(i: number, to: number, delims: string[]): number {
    let j = i;
    for (const d of delims) {
      while (j < to) {
        let nl = this.text.indexOf('\n', j);
        if (nl < 0 || nl > to) nl = to;
        const line = this.text.slice(j, nl);
        j = nl + 1;
        if (line.trim() === d) break;
      }
    }
    return Math.min(j, to);
  }

  tokens(from: number, to: number): Token[] {
    const out: Token[] = [];
    const pending: string[] = [];
    let i = from;
    while (i < to) {
      const c = this.text[i];
      if (c === ' ' || c === '\t' || c === '\r') {
        i++;
      } else if (c === '\\' && this.text[i + 1] === '\n') {
        i += 2;
      } else if (c === '\n') {
        out.push({ kind: 'nl', start: i });
        i++;
        if (pending.length) i = this.heredocs(i, to, pending.splice(0));
      } else if (c === '#') {
        while (i < to && this.text[i] !== '\n') i++;
      } else if (c === '(' && this.text[i + 1] === '(') {
        const end = this.parens(i, to);
        out.push({ kind: 'word', raw: this.text.slice(i, end), start: i, end, subs: [], redirect: false });
        i = end;
      } else if (c === ';' || c === '|' || c === '(' || c === ')' || (c === '&' && this.text[i + 1] !== '>')) {
        const three = this.text.slice(i, i + 3);
        const two = this.text.slice(i, i + 2);
        const op = three === ';;&' ? three : ['&&', '||', ';;', ';&', '|&'].includes(two) ? two : c;
        out.push({ kind: 'op', op, start: i });
        i += op.length;
      } else {
        const w = this.word(i, to);
        if (w.end === i) this.fail(i, `unexpected character ${JSON.stringify(c)}`);
        out.push(w);
        const here = /^\d*<<-?\s*(['"]?)([^'"\s]+)\1/.exec(w.raw);
        if (here && !w.raw.includes('<<<')) pending.push(here[2]);
        i = w.end;
      }
    }
    return out;
  }
}

interface Simple {
  t: 'simple';
  words: WordTok[];
  redirs: WordTok[];
  start: number;
  end: number;
}
interface Pipeline {
  t: 'pipeline';
  negated: boolean;
  cmds: Cmd[];
  start: number;
  end: number;
}
interface AndOr {
  t: 'andor';
  items: Pipeline[];
  ops: Array<'&&' | '||'>;
  start: number;
  end: number;
}
interface List {
  t: 'list';
  items: Array<{ ao: AndOr; bg: boolean }>;
}
interface IfCmd {
  t: 'if';
  clauses: Array<{ cond: List; body: List }>;
  elseBody?: List;
  redirs: WordTok[];
}
interface LoopCmd {
  t: 'loop';
  kind: 'while' | 'until' | 'for';
  cond?: List;
  body: List;
  redirs: WordTok[];
}
interface CaseCmd {
  t: 'case';
  arms: List[];
  redirs: WordTok[];
}
interface GroupCmd {
  t: 'group';
  body: List;
  redirs: WordTok[];
}
interface FuncCmd {
  t: 'func';
  body: Cmd;
}
type Cmd = Simple | IfCmd | LoopCmd | CaseCmd | GroupCmd | FuncCmd;
type Node = Cmd | Pipeline | AndOr | List;

const RESERVED = new Set(['if', 'then', 'elif', 'else', 'fi', 'do', 'done', 'while', 'until', 'for', 'case', 'esac', '{', '}', '!', 'function', 'select']);

class Parser {
  private pos = 0;
  constructor(
    private readonly toks: Token[],
    private readonly lexer: Lexer,
    private readonly end: number,
  ) {}

  private peek(k = 0): Token | undefined {
    return this.toks[this.pos + k];
  }
  private isWord(t: Token | undefined, w: string): boolean {
    return t?.kind === 'word' && t.raw === w;
  }
  private isOp(t: Token | undefined, ...ops: string[]): boolean {
    return t?.kind === 'op' && ops.includes(t.op);
  }
  private fail(why: string): never {
    return this.lexer.fail(this.peek()?.start ?? this.end - 1, why);
  }
  private expectWord(w: string): void {
    if (!this.isWord(this.peek(), w)) this.fail(`expected '${w}'`);
    this.pos++;
  }
  private skipNl(): void {
    while (this.peek()?.kind === 'nl') this.pos++;
  }
  private redirs(): WordTok[] {
    const out: WordTok[] = [];
    while (this.peek()?.kind === 'word' && (this.peek() as WordTok).redirect) out.push(this.toks[this.pos++] as WordTok);
    return out;
  }

  parseAll(): List {
    const list = this.list(() => false);
    if (this.pos < this.toks.length) this.fail('unexpected token');
    return list;
  }

  list(stop: (t: Token) => boolean): List {
    const items: List['items'] = [];
    for (;;) {
      while (this.peek()?.kind === 'nl' || this.isOp(this.peek(), ';')) this.pos++;
      const t = this.peek();
      if (!t || stop(t) || this.isOp(t, ')', ';;', ';&', ';;&')) break;
      const ao = this.andOr();
      const sep = this.peek();
      let bg = false;
      if (this.isOp(sep, '&')) {
        bg = true;
        this.pos++;
      } else if (this.isOp(sep, ';') || sep?.kind === 'nl') {
        this.pos++;
      }
      items.push({ ao, bg });
    }
    return { t: 'list', items };
  }

  private stopAt(...words: string[]): (t: Token) => boolean {
    return (t) => t.kind === 'word' && words.includes(t.raw);
  }

  private andOr(): AndOr {
    const items = [this.pipeline()];
    const ops: AndOr['ops'] = [];
    while (this.isOp(this.peek(), '&&', '||')) {
      ops.push((this.toks[this.pos++] as OpTok).op as '&&' | '||');
      this.skipNl();
      items.push(this.pipeline());
    }
    return { t: 'andor', items, ops, start: items[0].start, end: items[items.length - 1].end };
  }

  private pipeline(): Pipeline {
    const first = this.peek();
    let negated = false;
    if (this.isWord(first, '!')) {
      negated = true;
      this.pos++;
    }
    const startAt = this.pos;
    const cmds = [this.command()];
    while (this.isOp(this.peek(), '|', '|&')) {
      this.pos++;
      this.skipNl();
      cmds.push(this.command());
    }
    const start = first?.start ?? 0;
    const lastTok = this.toks[Math.max(startAt, this.pos - 1)];
    const end = lastTok.kind === 'word' ? lastTok.end : lastTok.start + 1;
    return { t: 'pipeline', negated, cmds, start, end };
  }

  private command(): Cmd {
    const t = this.peek();
    if (!t) return this.fail('unexpected end of input');
    if (t.kind === 'op' && t.op === '(') {
      this.pos++;
      const body = this.list(() => false);
      if (!this.isOp(this.peek(), ')')) this.fail("expected ')'");
      this.pos++;
      return { t: 'group', body, redirs: this.redirs() };
    }
    if (t.kind !== 'word') return this.fail('expected a command');
    switch (t.raw) {
      case 'if':
        return this.ifCmd();
      case 'while':
      case 'until':
        return this.whileCmd(t.raw);
      case 'for':
      case 'select':
        return this.forCmd();
      case 'case':
        return this.caseCmd();
      case '{': {
        this.pos++;
        const body = this.list(this.stopAt('}'));
        this.expectWord('}');
        return { t: 'group', body, redirs: this.redirs() };
      }
      case 'function': {
        this.pos += 2;
        if (this.isOp(this.peek(), '(') && this.isOp(this.peek(1), ')')) this.pos += 2;
        this.skipNl();
        return { t: 'func', body: this.command() };
      }
      default:
        break;
    }
    if (!RESERVED.has(t.raw) && this.isOp(this.peek(1), '(') && this.isOp(this.peek(2), ')')) {
      this.pos += 3;
      this.skipNl();
      return { t: 'func', body: this.command() };
    }
    return this.simple();
  }

  private simple(): Simple {
    const words: WordTok[] = [];
    const redirs: WordTok[] = [];
    if (this.isWord(this.peek(), '[[')) {
      while (this.pos < this.toks.length && !this.isWord(this.peek(), ']]')) {
        const t = this.toks[this.pos++];
        if (t.kind === 'word') words.push(t);
      }
      if (!this.isWord(this.peek(), ']]')) this.fail("expected ']]'");
      words.push(this.toks[this.pos++] as WordTok);
    }
    while (this.peek()?.kind === 'word') {
      const w = this.toks[this.pos++] as WordTok;
      (w.redirect ? redirs : words).push(w);
    }
    const all = [...words, ...redirs];
    if (all.length === 0) this.fail('expected a command');
    const start = Math.min(...all.map((w) => w.start));
    const end = Math.max(...all.map((w) => w.end));
    return { t: 'simple', words, redirs, start, end };
  }

  private ifCmd(): IfCmd {
    this.pos++;
    const clauses: IfCmd['clauses'] = [];
    let elseBody: List | undefined;
    for (;;) {
      const cond = this.list(this.stopAt('then'));
      this.expectWord('then');
      const body = this.list(this.stopAt('elif', 'else', 'fi'));
      clauses.push({ cond, body });
      if (this.isWord(this.peek(), 'elif')) {
        this.pos++;
        continue;
      }
      if (this.isWord(this.peek(), 'else')) {
        this.pos++;
        elseBody = this.list(this.stopAt('fi'));
      }
      this.expectWord('fi');
      return { t: 'if', clauses, elseBody, redirs: this.redirs() };
    }
  }

  private whileCmd(kind: 'while' | 'until'): LoopCmd {
    this.pos++;
    const cond = this.list(this.stopAt('do'));
    this.expectWord('do');
    const body = this.list(this.stopAt('done'));
    this.expectWord('done');
    return { t: 'loop', kind, cond, body, redirs: this.redirs() };
  }

  private forCmd(): LoopCmd {
    this.pos++;
    while (this.pos < this.toks.length && !this.isWord(this.peek(), 'do')) this.pos++;
    this.expectWord('do');
    const body = this.list(this.stopAt('done'));
    this.expectWord('done');
    return { t: 'loop', kind: 'for', body, redirs: this.redirs() };
  }

  private caseCmd(): CaseCmd {
    this.pos += 2;
    this.skipNl();
    this.expectWord('in');
    const arms: List[] = [];
    for (;;) {
      this.skipNl();
      if (this.isWord(this.peek(), 'esac')) break;
      if (this.isOp(this.peek(), '(')) this.pos++;
      while (this.pos < this.toks.length && !this.isOp(this.peek(), ')')) this.pos++;
      if (!this.isOp(this.peek(), ')')) this.fail("expected ')' after a case pattern");
      this.pos++;
      arms.push(this.list(this.stopAt('esac')));
      if (this.isOp(this.peek(), ';;', ';&', ';;&')) this.pos++;
    }
    this.expectWord('esac');
    return { t: 'case', arms, redirs: this.redirs() };
  }
}

// ── Exit-status model ────────────────────────────────────────────────────────

/**
 * How a failure of the command being walked is handled:
 * - `stmt`: a statement; `errexit` decides.
 * - `ok`: observed by construction (a plain assignment whose substitution failed under -e).
 * - `unobs`: nothing can see it (non-final `&&` member, background, negated statement, ...).
 * - `tested`: the status is tested; `onFalse` runs when it fails (`null` = nothing does).
 *   `orForm` marks a `W || B` branch, where a `true`/`:`-only branch is the swallow idiom.
 */
type Ctx =
  | { kind: 'stmt' }
  | { kind: 'ok' }
  | { kind: 'unobs' }
  | { kind: 'tested'; onFalse: Node[] | null; onTrue: Node[] | null; orForm: boolean };

const STMT: Ctx = { kind: 'stmt' };
const UNOBS: Ctx = { kind: 'unobs' };

function negate(ctx: Ctx): Ctx {
  if (ctx.kind === 'tested') return { kind: 'tested', onFalse: ctx.onTrue, onTrue: ctx.onFalse, orForm: false };
  return UNOBS;
}

function simplesOf(nodes: readonly Node[]): Array<Simple | { t: 'redirs'; redirs: WordTok[] }> {
  const out: Array<Simple | { t: 'redirs'; redirs: WordTok[] }> = [];
  const visit = (n: Node): void => {
    switch (n.t) {
      case 'simple':
        out.push(n);
        break;
      case 'pipeline':
        n.cmds.forEach(visit);
        break;
      case 'andor':
        n.items.forEach(visit);
        break;
      case 'list':
        n.items.forEach((i) => visit(i.ao));
        break;
      case 'if':
        n.clauses.forEach((c) => {
          visit(c.cond);
          visit(c.body);
        });
        if (n.elseBody) visit(n.elseBody);
        out.push({ t: 'redirs', redirs: n.redirs });
        break;
      case 'loop':
        if (n.cond) visit(n.cond);
        visit(n.body);
        out.push({ t: 'redirs', redirs: n.redirs });
        break;
      case 'case':
        n.arms.forEach(visit);
        out.push({ t: 'redirs', redirs: n.redirs });
        break;
      case 'group':
        visit(n.body);
        out.push({ t: 'redirs', redirs: n.redirs });
        break;
      case 'func':
        visit(n.body);
        break;
    }
  };
  nodes.forEach(visit);
  return out;
}

class ShellWalker {
  readonly sites: WriteSite[] = [];
  private errexit: boolean;
  private pipefail: boolean;

  constructor(
    private readonly unit: ShellUnit,
    private readonly lexer: Lexer,
  ) {
    this.errexit = unit.errexit;
    this.pipefail = unit.pipefail;
  }

  private text(start: number, end: number): string {
    return this.unit.text.slice(start, end);
  }

  private surfaced(nodes: readonly Node[]): boolean {
    for (const s of simplesOf(nodes)) {
      const raw = s.t === 'simple' ? this.text(s.start, s.end) : s.redirs.map((r) => r.raw).join(' ');
      if (SURFACING_FORMS.shell.some((re) => re.test(raw))) return true;
      if (s.t !== 'simple') continue;
      const args = commandArgs(s.words.map((w) => dequote(w.raw)));
      if ((args[0] === 'exit' || args[0] === 'return') && /^[1-9]\d*$/.test(args[1] ?? '')) return true;
      if (args[0] === 'false' && args.length === 1) return true;
    }
    return false;
  }

  private swallowOnly(nodes: readonly Node[]): boolean {
    const all = simplesOf(nodes);
    const simples = all.filter((s): s is Simple => s.t === 'simple');
    if (simples.length === 0 || simples.length !== all.filter((s) => s.t === 'simple' || s.redirs.length).length) {
      return false;
    }
    return simples.every((s) => s.words.length === 1 && (s.words[0].raw === 'true' || s.words[0].raw === ':'));
  }

  private verdict(ctx: Ctx): Verdict {
    switch (ctx.kind) {
      case 'stmt':
        return this.errexit ? 'ok' : 'unobserved';
      case 'ok':
        return 'ok';
      case 'unobs':
        return 'unobserved';
      case 'tested':
        if (ctx.onFalse === null) return 'unobserved';
        if (ctx.orForm && this.swallowOnly(ctx.onFalse)) return 'unobserved';
        return this.surfaced(ctx.onFalse) ? 'ok' : 'unsurfaced';
    }
  }

  private isSwallowCommand(ao: AndOr): boolean {
    if (ao.items.length !== 1 || ao.items[0].negated || ao.items[0].cmds.length !== 1) return false;
    const c = ao.items[0].cmds[0];
    return c.t === 'simple' && c.words.length === 1 && (c.words[0].raw === 'true' || c.words[0].raw === ':');
  }

  walkList(list: List, ctx: Ctx): void {
    list.items.forEach((item, idx) => {
      const last = idx === list.items.length - 1;
      let c: Ctx = item.bg ? UNOBS : last ? ctx : ctx.kind === 'stmt' ? STMT : UNOBS;
      const next = list.items[idx + 1];
      if (
        !item.bg &&
        next &&
        this.isSwallowCommand(next.ao) &&
        this.unit.charLine[item.ao.end - 1] === this.unit.charLine[next.ao.start]
      ) {
        c = UNOBS;
      }
      this.walkAndOr(item.ao, c);
    });
  }

  private walkAndOr(ao: AndOr, ctx: Ctx): void {
    const n = ao.items.length;
    ao.items.forEach((p, i) => {
      let c: Ctx;
      if (i === n - 1) {
        c = ctx;
      } else if (ao.ops[i] === '||') {
        c = { kind: 'tested', onFalse: ao.items.slice(i + 1), onTrue: null, orForm: true };
      } else {
        const j = ao.ops.indexOf('||', i + 1);
        if (j >= 0) c = { kind: 'tested', onFalse: ao.items.slice(j + 1), onTrue: null, orForm: true };
        else if (ctx.kind === 'tested') c = { kind: 'tested', onFalse: ctx.onFalse, onTrue: null, orForm: ctx.orForm };
        else c = UNOBS;
      }
      this.walkPipeline(p, c);
    });
  }

  private walkPipeline(p: Pipeline, ctx: Ctx): void {
    const c = p.negated ? negate(ctx) : ctx;
    p.cmds.forEach((cmd, i) => {
      const last = i === p.cmds.length - 1;
      this.walkCmd(cmd, last || this.pipefail ? c : UNOBS);
    });
  }

  private walkSubs(words: readonly WordTok[], propagate: Ctx): void {
    for (const w of words) {
      for (const s of w.subs) {
        const list = new Parser(this.lexer.tokens(s.start, s.end), this.lexer, s.end).parseAll();
        const saved = this.errexit;
        this.errexit = false; // a command substitution does not inherit -e
        this.walkList(list, propagate);
        this.errexit = saved;
      }
    }
  }

  private applySet(args: readonly string[]): void {
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      const on = a.startsWith('-');
      if (a === '-o' || a === '+o') {
        this.setOption(args[++i], on);
      } else if (/^[-+][a-zA-Z]+$/.test(a)) {
        if (a.includes('e')) this.errexit = on;
        if (a.includes('o')) this.setOption(args[++i], on);
      }
    }
  }

  private setOption(name: string | undefined, on: boolean): void {
    if (name === 'errexit') this.errexit = on;
    if (name === 'pipefail') this.pipefail = on;
  }

  private record(start: number, ctx: Ctx): void {
    const line = this.unit.charLine[start];
    this.sites.push({
      file: this.unit.file,
      line,
      verdict: this.verdict(ctx),
      text: (this.unit.source[line - 1] ?? '').trim(),
    });
  }

  private walkCmd(cmd: Cmd, ctx: Ctx): void {
    switch (cmd.t) {
      case 'simple': {
        const words = cmd.words.map((w) => dequote(w.raw));
        const args = commandArgs(words);
        const assignOnly = words.length > 0 && args.length === 0;
        let propagate: Ctx = UNOBS;
        if (assignOnly) propagate = ctx.kind === 'stmt' ? (this.errexit ? { kind: 'ok' } : UNOBS) : ctx;
        this.walkSubs([...cmd.words, ...cmd.redirs], propagate);
        if (args[0] === 'set') this.applySet(args);
        if (isWriteArgs(words)) this.record(cmd.words[0]?.start ?? cmd.start, ctx);
        return;
      }
      case 'if':
        cmd.clauses.forEach((cl, k) => {
          const rest: Node[] = [];
          for (const later of cmd.clauses.slice(k + 1)) rest.push(later.cond, later.body);
          if (cmd.elseBody) rest.push(cmd.elseBody);
          this.walkList(cl.cond, { kind: 'tested', onTrue: [cl.body], onFalse: rest, orForm: false });
          this.walkList(cl.body, ctx);
        });
        if (cmd.elseBody) this.walkList(cmd.elseBody, ctx);
        this.walkSubs(cmd.redirs, UNOBS);
        return;
      case 'loop':
        if (cmd.cond) {
          const tested: Ctx =
            cmd.kind === 'until'
              ? { kind: 'tested', onTrue: [], onFalse: [cmd.body], orForm: false }
              : { kind: 'tested', onTrue: [cmd.body], onFalse: [], orForm: false };
          this.walkList(cmd.cond, tested);
        }
        this.walkList(cmd.body, ctx);
        this.walkSubs(cmd.redirs, UNOBS);
        return;
      case 'case':
        cmd.arms.forEach((arm) => this.walkList(arm, ctx));
        this.walkSubs(cmd.redirs, UNOBS);
        return;
      case 'group':
        this.walkList(cmd.body, ctx);
        this.walkSubs(cmd.redirs, UNOBS);
        return;
      case 'func':
        this.walkCmd(cmd.body, STMT);
        return;
    }
  }
}

/** Every gate-signal write in one shell unit, with its verdict. */
export function scanShellUnit(unit: ShellUnit): WriteSite[] {
  const lexer = new Lexer(unit.text, unit);
  const list = new Parser(lexer.tokens(0, unit.text.length), lexer, unit.text.length).parseAll();
  const walker = new ShellWalker(unit, lexer);
  walker.walkList(list, STMT);
  return walker.sites;
}

// ── Workflow extraction (2.3) ────────────────────────────────────────────────

/** One JavaScript text: a github-script `script:` block (wrapped) or a script file. */
export interface JsUnit {
  file: string;
  text: string;
  /** Source line of the text's first line. */
  firstLine: number;
  /** github-script bodies are a function body: wrap them so `await`/`return` parse. */
  wrap: boolean;
  source: readonly string[];
}

export function makeJsUnit(file: string, code: string, firstLine: number, wrap: boolean): JsUnit {
  const source = [...Array<string>(firstLine - 1).fill(''), ...code.split('\n')];
  return { file, text: code, firstLine, wrap, source };
}

interface Frame {
  col: number;
  key?: string;
  item?: StepProps;
}

interface StepProps {
  run?: Scalar;
  script?: Scalar;
  shell?: string;
  uses?: string;
  /** The job key this item sits under, when it is a step. */
  job?: string;
  isStep: boolean;
}

interface Scalar {
  /** Text lines and the source line each starts on; a line may be a folded join. */
  text: string;
  charLine: number[];
  firstLine: number;
}

const KEY_RE = /^(\s*)(?:(-)(\s+))?([A-Za-z0-9_][A-Za-z0-9_.\-/]*|"[^"]*"|'[^']*'):(?:\s+(.*?))?\s*$/;
const DASH_RE = /^(\s*)-(?:\s+(.*))?$/;
const BLOCK_RE = /^([|>])([1-9]?)([-+]?)([1-9]?)\s*(#.*)?$/;

const indentOf = (l: string): number => l.length - l.trimStart().length;
const isBlankOrComment = (l: string): boolean => l.trim() === '' || /^\s*#/.test(l);

/** Strip a trailing ` #comment` from a plain scalar, and quotes from a quoted one. */
function inlineScalar(value: string, where: string): string {
  if (value.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"\s*(#.*)?$/.exec(value);
    if (!m) throw new ScanError(`${where}: unrecognised quoted scalar`);
    return m[1].replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
  }
  if (value.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'\s*(#.*)?$/.exec(value);
    if (!m) throw new ScanError(`${where}: unrecognised quoted scalar`);
    return m[1].replace(/''/g, "'");
  }
  const hash = value.search(/\s#/);
  return hash >= 0 ? value.slice(0, hash) : value;
}

function shellFlags(shell: string | undefined, where: string): { errexit: boolean; pipefail: boolean } {
  if (shell === undefined) return { errexit: true, pipefail: false }; // Actions default: bash -e {0}
  const s = shell.trim();
  if (s === 'bash') return { errexit: true, pipefail: true }; // bash --noprofile --norc -eo pipefail {0}
  if (s === 'sh') return { errexit: true, pipefail: false }; // sh -e {0}
  if (/^(\S*\/)?(bash|sh)\s.*\{0\}/.test(s)) {
    const toks = s.split(/\s+/).slice(1);
    const errexit = toks.some((t) => /^-[a-zA-Z]*e[a-zA-Z]*$/.test(t));
    const pipefail = /(^|\s)-[a-zA-Z]*o\s+pipefail\b/.test(s);
    return { errexit, pipefail };
  }
  throw new ScanError(`${where}: unsupported step shell '${s}' (the scanner models bash and sh only)`);
}

/**
 * Line-based extraction of every step `run:` block and every `actions/github-script`
 * `script:` block, with each character mapped back to its source line, and the step's
 * effective `shell:` (step, then job `defaults.run.shell`, then workflow
 * `defaults.run.shell`) applied to the unit's initial `errexit`/`pipefail`. Any block shape
 * it does not recognise throws {@link ScanError}; it never returns fewer units silently.
 */
export function extractWorkflowUnits(file: string, src: string): { shell: ShellUnit[]; js: JsUnit[] } {
  const lines = src.split('\n');
  const source = lines;
  const stack: Frame[] = [];
  const items: StepProps[] = [];
  const defaults = new Map<string, string>(); // '' = workflow level, else job key
  const where = (i: number) => `${file}:${i + 1}`;

  const pathKeys = (): string[] => stack.filter((f) => f.key !== undefined).map((f) => f.key as string);
  const currentItem = (): StepProps | undefined => {
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].item) return stack[k].item;
    return undefined;
  };

  /** Read a block scalar whose header is on line `i`; return it and the next line index. */
  const readBlock = (i: number, keyCol: number, header: RegExpExecArray): { scalar: Scalar; next: number } => {
    const style = header[1];
    const digit = Number(header[2] || header[4] || 0);
    let j = i + 1;
    const content: Array<{ text: string; line: number }> = [];
    let blockIndent = digit ? keyCol + digit : -1;
    while (j < lines.length) {
      const l = lines[j];
      if (l.trim() === '') {
        content.push({ text: '', line: j + 1 });
        j++;
        continue;
      }
      const ind = indentOf(l);
      if (ind <= keyCol) break;
      if (blockIndent < 0) blockIndent = ind;
      if (ind < blockIndent) throw new ScanError(`${where(j)}: block scalar line is less indented than its block`);
      content.push({ text: l.slice(blockIndent), line: j + 1 });
      j++;
    }
    while (content.length && content[content.length - 1].text === '') content.pop();
    let text = '';
    const charLine: number[] = [];
    content.forEach((c, k) => {
      for (const ch of c.text) {
        text += ch;
        charLine.push(c.line);
      }
      if (k === content.length - 1) return;
      const nextText = content[k + 1].text;
      const fold =
        style === '>' && c.text !== '' && nextText !== '' && !/^\s/.test(c.text) && !/^\s/.test(nextText);
      text += fold ? ' ' : '\n';
      charLine.push(c.line);
    });
    return { scalar: { text, charLine, firstLine: content[0]?.line ?? i + 2 }, next: j };
  };

  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (isBlankOrComment(l) || /^(---|\.\.\.)\s*$/.test(l)) {
      i++;
      continue;
    }
    const km = KEY_RE.exec(l);
    const dm = km ? null : DASH_RE.exec(l);
    if (!km && !dm) {
      // a continuation of a multi-line flow or plain scalar owned by the enclosing key
      i++;
      continue;
    }
    const lead = (km ?? dm)![1].length;
    const isDash = km ? km[2] === '-' : true;
    if (isDash) {
      while (stack.length && (stack[stack.length - 1].col > lead || (stack[stack.length - 1].col === lead && stack[stack.length - 1].item))) {
        stack.pop();
      }
      const keys = pathKeys();
      const isStep = keys[keys.length - 1] === 'steps' && keys[0] === 'jobs' && keys.length === 3;
      const item: StepProps = { isStep, job: isStep ? keys[1] : undefined };
      items.push(item);
      stack.push({ col: lead, item });
      if (!km) {
        i++;
        continue;
      }
    }
    const col = isDash ? lead + 1 + km![3].length : lead;
    const key = km![4].replace(/^["']|["']$/g, '');
    const value = km![5] ?? '';
    while (stack.length && stack[stack.length - 1].col >= col) stack.pop();
    const parentKeys = pathKeys();
    const item = currentItem();
    const inStep = item?.isStep === true;
    const stepDepth = inStep ? stack.findIndex((f) => f.item === item) : -1;
    const keysInStep = inStep ? stack.slice(stepDepth + 1).filter((f) => f.key !== undefined).map((f) => f.key) : [];
    stack.push({ col, key });

    const isRun = inStep && keysInStep.length === 0 && key === 'run';
    const isScript = inStep && keysInStep.length === 1 && keysInStep[0] === 'with' && key === 'script';
    const header = BLOCK_RE.exec(value);
    if (value.startsWith('|') || value.startsWith('>')) {
      if (!header) throw new ScanError(`${where(i)}: unrecognised block scalar header '${value}'`);
      const { scalar, next } = readBlock(i, col, header);
      if (isRun) item!.run = scalar;
      if (isScript) item!.script = scalar;
      i = next;
      continue;
    }
    // inline value: any following line indented past the key is a multi-line scalar
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const continues = value !== '' && j < lines.length && indentOf(lines[j]) > col && !/^\s*#/.test(lines[j]);
    if ((isRun || isScript) && (value === '' || continues)) {
      throw new ScanError(`${where(i)}: unrecognised ${key}: scalar shape (multi-line plain or empty)`);
    }
    if (isRun || isScript) {
      const text = inlineScalar(value, where(i));
      const scalar: Scalar = { text, charLine: [...text].map(() => i + 1), firstLine: i + 1 };
      if (isRun) item!.run = scalar;
      else item!.script = scalar;
    } else if (inStep && keysInStep.length === 0 && key === 'shell') {
      item!.shell = inlineScalar(value, where(i)).trim();
    } else if (inStep && keysInStep.length === 0 && key === 'uses') {
      item!.uses = inlineScalar(value, where(i)).trim();
    } else if (key === 'shell' && parentKeys[parentKeys.length - 1] === 'run' && parentKeys[parentKeys.length - 2] === 'defaults') {
      const level = parentKeys.length === 2 ? '' : parentKeys[0] === 'jobs' && parentKeys.length === 4 ? parentKeys[1] : undefined;
      if (level !== undefined) defaults.set(level, inlineScalar(value, where(i)).trim());
    }
    i = continues ? skipContinuation(lines, i + 1, col) : i + 1;
  }

  const shell: ShellUnit[] = [];
  const js: JsUnit[] = [];
  for (const it of items) {
    if (it.run) {
      const sh = it.shell ?? defaults.get(it.job ?? '') ?? defaults.get('');
      const flags = shellFlags(sh, `${file}:${it.run.firstLine}`);
      shell.push({ file, text: it.run.text, charLine: it.run.charLine, source, ...flags });
    }
    if (it.script && it.uses && /^actions\/github-script@/.test(it.uses)) {
      js.push({ file, text: it.script.text, firstLine: it.script.firstLine, wrap: true, source });
    }
  }
  return { shell, js };
}

function skipContinuation(lines: readonly string[], from: number, col: number): number {
  let j = from;
  while (j < lines.length && (lines[j].trim() === '' || indentOf(lines[j]) > col)) j++;
  return j;
}

// ── JavaScript model (2.4) ───────────────────────────────────────────────────

const LABEL_METHODS = new Set(['addLabels', 'removeLabel', 'setLabels']);

function stringValues(e: ts.Expression): string[] | null {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isArrayLiteralExpression(e)) {
    const out: string[] = [];
    for (const el of e.elements) {
      const v = stringValues(el as ts.Expression);
      if (v === null) return null;
      out.push(...v);
    }
    return out;
  }
  return null;
}

/** A label call is gate-relevant unless every label it names is a literal outside the set. */
function labelCallRelevant(call: ts.CallExpression): boolean {
  const arg = call.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return true;
  let named = false;
  for (const p of arg.properties) {
    if (ts.isShorthandPropertyAssignment(p) && (p.name.text === 'labels' || p.name.text === 'name')) return true;
    if (!ts.isPropertyAssignment(p)) {
      if (ts.isSpreadAssignment(p)) return true;
      continue;
    }
    const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : '';
    if (key !== 'labels' && key !== 'name') continue;
    named = true;
    const values = stringValues(p.initializer);
    if (values === null || values.some(isGateLabel)) return true;
  }
  return !named;
}

function isWriteCall(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'createCommitStatus';
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const name = callee.name.text;
  const obj = callee.expression.getText();
  if (name === 'createCommitStatus') return true;
  if ((name === 'create' || name === 'update') && /(^|\.)checks$/.test(obj)) return true;
  if (LABEL_METHODS.has(name) && /(^|\.)issues$/.test(obj)) return labelCallRelevant(call);
  return false;
}

function isFunctionLike(n: ts.Node): n is ts.SignatureDeclaration & { body?: ts.Node } {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessor(n) ||
    ts.isSetAccessor(n)
  );
}

/** A same-scope helper named `name`, searched outward from `from`. */
function findHelper(from: ts.Node, name: string): ts.Node | undefined {
  for (let n: ts.Node | undefined = from; n; n = n.parent) {
    const stmts = ts.isBlock(n) || ts.isSourceFile(n) ? n.statements : undefined;
    if (!stmts) continue;
    for (const s of stmts) {
      if (ts.isFunctionDeclaration(s) && s.name?.text === name && s.body) return s.body;
      if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) {
            if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) return d.initializer.body;
          }
        }
      }
    }
  }
  return undefined;
}

function nonZeroLiteral(e: ts.Expression | undefined): boolean {
  return e !== undefined && ts.isNumericLiteral(e) && Number(e.text) !== 0;
}

/** Does `body` surface a failure: a JS surfacing form, a throw, or a non-zero process exit? */
function surfacesJs(body: ts.Node, followHelpers: boolean, scope: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (n !== body && isFunctionLike(n)) return;
    if (ts.isThrowStatement(n)) {
      found = true;
      return;
    }
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText().replace(/\s+/g, '');
      if (SURFACING_FORMS.javascript.some((f) => callee === f || callee.startsWith(`${f}.`))) found = true;
      else if (callee === 'process.exit' && nonZeroLiteral(n.arguments[0])) found = true;
      else if (followHelpers && ts.isIdentifier(n.expression)) {
        const helper = findHelper(scope, n.expression.text);
        if (helper && surfacesJs(helper, false, helper)) found = true;
      }
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      n.left.getText().replace(/\s+/g, '') === 'process.exitCode' &&
      nonZeroLiteral(n.right)
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(n, visit);
  };
  visit(body);
  return found;
}

function handlerVerdict(handler: ts.Expression | undefined, scope: ts.Node): Verdict {
  if (!handler) return 'unsurfaced';
  if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
    return surfacesJs(handler.body, true, scope) ? 'ok' : 'unsurfaced';
  }
  if (ts.isIdentifier(handler)) {
    const helper = findHelper(scope, handler.text);
    return helper && surfacesJs(helper, false, helper) ? 'ok' : 'unsurfaced';
  }
  return 'unsurfaced';
}

function classifyJs(call: ts.Expression, followed: boolean): Verdict {
  let node: ts.Node = call;
  for (;;) {
    const p = node.parent;
    if (ts.isPropertyAccessExpression(p) && p.expression === node && ts.isCallExpression(p.parent) && p.parent.expression === p) {
      const m = p.name.text;
      if (m === 'catch') return handlerVerdict(p.parent.arguments[0], p.parent);
      if (m === 'then' && p.parent.arguments.length >= 2) return handlerVerdict(p.parent.arguments[1], p.parent);
      node = p.parent;
      continue;
    }
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p)) {
      node = p;
      continue;
    }
    if (ts.isArrayLiteralExpression(p) && ts.isCallExpression(p.parent) && /^Promise\.all$/.test(p.parent.expression.getText())) {
      node = p.parent;
      continue;
    }
    break;
  }
  const p = node.parent;
  const awaited = ts.isAwaitExpression(p);
  const returned = ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === node);
  if (!awaited && !returned) return 'unobserved';
  if (returned && !followed) {
    let fn: ts.Node | undefined = p;
    while (fn && !isFunctionLike(fn)) fn = fn.parent;
    if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isCallExpression(fn.parent) && fn.parent.arguments.includes(fn as ts.Expression)) {
      return classifyJs(fn.parent, true);
    }
  }
  for (let cur: ts.Node = node; cur.parent && !isFunctionLike(cur.parent); cur = cur.parent) {
    const par = cur.parent;
    if (ts.isTryStatement(par) && par.tryBlock === cur && par.catchClause) {
      return surfacesJs(par.catchClause.block, true, par.catchClause.block) ? 'ok' : 'unsurfaced';
    }
  }
  return 'ok';
}

/** Every gate-signal write call in one JavaScript unit, with its verdict. */
export function scanJsUnit(unit: JsUnit): WriteSite[] {
  const prefix = unit.wrap ? '(async function () {\n' : '';
  const code = `${prefix}${unit.text}${unit.wrap ? '\n});\n' : ''}`;
  const kind = /\.tsx?$/.test(unit.file) && !unit.wrap ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(unit.file, code, ts.ScriptTarget.Latest, true, kind);
  const offset = unit.firstLine - 1 - (unit.wrap ? 1 : 0);
  const sites: WriteSite[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && isWriteCall(n)) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 + offset;
      sites.push({ file: unit.file, line, verdict: classifyJs(n, false), text: (unit.source[line - 1] ?? '').trim() });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return sites;
}

// ── FR-2 annotations and the report (2.5) ────────────────────────────────────

const ANNOTATION_RE = /^\s*(?:#|\/\/)\s*gate-signal-allow:(.*)$/;

function sitesOf(file: string, source: string): WriteSite[] {
  if (/\.ya?ml$/.test(file)) {
    const u = extractWorkflowUnits(file, source);
    return [...u.shell.flatMap(scanShellUnit), ...u.js.flatMap(scanJsUnit)];
  }
  if (/\.sh$/.test(file)) return scanShellUnit(shellUnitFromScript(file, source));
  if (/\.([cm]?js|ts)$/.test(file)) return scanJsUnit(makeJsUnit(file, source, 1, false));
  throw new ScanError(`${file}: not a file type the scanner reads`);
}

/** Scan one file and apply its FR-2 annotations. */
export function scanSource(file: string, source: string): ScanResult {
  const sites = sitesOf(file, source).sort((a, b) => a.line - b.line);
  const lines = source.split('\n');
  const annotations = new Map<number, string>();
  lines.forEach((l, k) => {
    const m = ANNOTATION_RE.exec(l);
    if (m) annotations.set(k + 1, m[1].trim());
  });
  const siteLines = new Set(sites.map((s) => s.line));
  const findings: Finding[] = [];
  const waivers: Waiver[] = [];
  for (const s of sites) {
    if (s.verdict === 'ok') continue;
    const reason = annotations.get(s.line - 1);
    if (reason) waivers.push({ file, line: s.line - 1, writeLine: s.line, reason });
    else findings.push({ file, line: s.line, kind: s.verdict, text: s.text });
  }
  for (const [line, reason] of annotations) {
    const text = lines[line - 1].trim();
    if (!reason) findings.push({ file, line, kind: 'bare annotation', text });
    if (!siteLines.has(line + 1)) findings.push({ file, line, kind: 'orphan annotation', text });
  }
  findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
  return { sites, findings, waivers };
}

/** Findings, then the always-printed waiver summary, then the count. */
export function renderReport(findings: readonly Finding[], waivers: readonly Waiver[]): string {
  const out: string[] = findings.map((f) => `${f.file}:${f.line}  ${f.kind}  ${f.text}`);
  if (out.length) out.push('');
  out.push(`${waivers.length} waiver${waivers.length === 1 ? '' : 's'} honoured`);
  for (const w of waivers) out.push(`  ${w.file}:${w.writeLine}  ${w.reason}`);
  out.push(`${findings.length} finding${findings.length === 1 ? '' : 's'}`);
  return out.join('\n');
}

// ── IO entry (3.1) ───────────────────────────────────────────────────────────

export interface Io {
  out(s: string): void;
  err(s: string): void;
}

const defaultIo: Io = {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
};

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]s$/;
const SKIP_DIRS = new Set(['node_modules', 'tests', '__tests__', 'fixtures']);

function listDir(abs: string, rel: string): string[] {
  try {
    return readdirSync(abs).sort();
  } catch (e) {
    throw new ScanError(`cannot read directory ${rel}: ${(e as Error).message}`);
  }
}

function walk(root: string, rel: string, accept: (name: string) => boolean): string[] {
  return listDir(join(root, rel), rel).flatMap((name) => {
    const childRel = `${rel}/${name}`;
    const abs = join(root, childRel);
    let isDir: boolean;
    try {
      isDir = statSync(abs).isDirectory();
    } catch (e) {
      throw new ScanError(`cannot stat ${childRel}: ${(e as Error).message}`);
    }
    if (isDir) return SKIP_DIRS.has(name) ? [] : walk(root, childRel, accept);
    return accept(name) ? [childRel] : [];
  });
}

/** Every file the scanner reads under `root`, as `/`-separated relative paths. */
export function collectFiles(root: string): string[] {
  if (!existsSync(join(root, '.github/workflows'))) throw new ScanError('no .github/workflows directory under the root');
  const workflows = walk(root, '.github/workflows', (n) => /\.ya?ml$/.test(n));
  if (workflows.length === 0) throw new ScanError('no workflow files found under .github/workflows');
  const ghScripts = existsSync(join(root, '.github/scripts'))
    ? walk(root, '.github/scripts', (n) => n.endsWith('.js') && !TEST_FILE_RE.test(n))
    : [];
  const scripts = existsSync(join(root, 'scripts'))
    ? walk(root, 'scripts', (n) => /\.(sh|js|mjs|ts)$/.test(n) && !TEST_FILE_RE.test(n))
    : [];
  return [...workflows, ...ghScripts, ...scripts];
}

function argRoot(argv: readonly string[]): string | undefined {
  const i = argv.indexOf('--root');
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (!v) throw new ScanError('--root needs a directory');
  return v;
}

/** The CLI: walk, read, scan, print, and return the exit code (0 clean, 1 findings, 2 could not run). */
export function runCheck(argv: readonly string[], io: Io = defaultIo): 0 | 1 | 2 {
  try {
    const root = argRoot(argv) ?? process.cwd();
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new ScanError(`root ${root} is not a directory`);
    const findings: Finding[] = [];
    const waivers: Waiver[] = [];
    for (const rel of collectFiles(root)) {
      let text: string;
      try {
        text = readFileSync(join(root, rel), 'utf8');
      } catch (e) {
        throw new ScanError(`cannot read ${rel}: ${(e as Error).message}`);
      }
      const r = scanSource(rel, text);
      findings.push(...r.findings);
      waivers.push(...r.waivers);
    }
    io.out(renderReport(findings, waivers));
    return findings.length ? 1 : 0;
  } catch (e) {
    io.err(`check-gate-signals: could not run: ${(e as Error).message}`);
    return 2;
  }
}

// Run only when executed directly, so importing this module for tests runs nothing.
if (/check-gate-signals\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  process.exitCode = runCheck(process.argv.slice(2));
}
