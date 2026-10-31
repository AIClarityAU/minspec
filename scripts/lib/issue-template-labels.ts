/**
 * issue-template-labels.ts — pure logic for the #1206 gate.
 *
 * An issue form's `labels:` list is applied by GitHub to whoever files the issue,
 * anonymous or not. A label that AUTHORISES work (`agent-ready`) is a gate OUTPUT -
 * written by a bot or maintainer after a verdict - so no template may grant one.
 * #1134 removed it from agent-task.yml by hand; this makes it un-landable again.
 *
 * No YAML dependency (dependency budget): templates only need the top-level
 * `labels:` key, parsed in flow (`["a", "b"]`) or block (`- a`) form. Anything else
 * is reported as a problem - fail closed, never skip.
 */

/** Gate-output labels: add a future one here and nowhere else. */
export const GATE_OUTPUT_LABELS: readonly string[] = [
  'agent-ready',
  'agent-ready-specify',
  'ai-review:pass',
];

export type LabelsResult =
  | { ok: true; labels: string[] }
  | { ok: false; reason: string };

function unquote(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return null;
  const q = s[0];
  if (q === '"' || q === "'") {
    if (s.length < 2 || s[s.length - 1] !== q) return null;
    // YAML decodes escapes in double-quoted scalars (`"agent-read\x79"`); we don't, so fail closed.
    if (q === '"' && s.includes('\\')) return null;
    return s.slice(1, -1);
  }
  if (/[\[\]{},"'#]/.test(s)) return null;
  return s;
}

function parseFlow(body: string): LabelsResult {
  const m = /^\[(.*)\]\s*(#.*)?$/.exec(body);
  if (!m) return { ok: false, reason: `unparseable flow list: ${body}` };
  const inner = m[1].trim();
  if (inner === '') return { ok: true, labels: [] };
  const items: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      items.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (quote) return { ok: false, reason: `unterminated quote in: ${body}` };
  items.push(cur);
  const labels: string[] = [];
  for (const it of items) {
    const v = unquote(it);
    if (v === null) return { ok: false, reason: `unparseable label item: ${it.trim()}` };
    labels.push(v);
  }
  return { ok: true, labels };
}

/** Extract the top-level `labels:` list. A template without the key has no labels. */
export function extractLabels(yaml: string): LabelsResult {
  const lines = yaml.replace(/\r\n?/g, '\n').split('\n');
  const idx = lines.findIndex((l) => /^labels\s*:/.test(l));
  if (lines.filter((l) => /^labels\s*:/.test(l)).length > 1) {
    return { ok: false, reason: 'duplicate top-level labels: key' };
  }
  if (idx === -1) return { ok: true, labels: [] };
  const rest = lines[idx].replace(/^labels\s*:/, '').replace(/(^|\s)#.*$/, '').trim();
  if (rest.startsWith('[')) return parseFlow(rest);
  if (rest !== '' && !rest.startsWith('#')) {
    // scalar (comma-separated string is valid for GitHub) - parse as list of names
    if (/^["'].*["']$/.test(rest) || !/[\[\]{}|>&*!]/.test(rest)) {
      if (rest.includes('\\')) return { ok: false, reason: `escape sequence in labels value: ${rest}` };
      const inner = rest.replace(/^["']|["']$/g, '');
      return { ok: true, labels: inner.split(',').map((s) => s.trim()).filter(Boolean) };
    }
    return { ok: false, reason: `unparseable labels value: ${rest}` };
  }
  const labels: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '' || /^\s*#/.test(l)) continue;
    const m = /^\s*-\s+(.*)$/.exec(l);
    if (!m) {
      if (/^\s/.test(l)) return { ok: false, reason: `unparseable labels entry: ${l.trim()}` };
      break;
    }
    const v = unquote(m[1].replace(/\s+#.*$/, ''));
    if (v === null) return { ok: false, reason: `unparseable label item: ${m[1].trim()}` };
    labels.push(v);
  }
  return { ok: true, labels };
}

/** Problems for one template; empty = clean. */
export function checkTemplate(
  name: string,
  yaml: string,
  forbidden: readonly string[] = GATE_OUTPUT_LABELS,
): string[] {
  if (!/^body\s*:/m.test(yaml) || !/^name\s*:/m.test(yaml)) {
    return [`${name}: not a recognisable issue form (missing top-level name:/body:)`];
  }
  const r = extractLabels(yaml);
  if (!r.ok) return [`${name}: ${r.reason}`];
  const deny = new Set(forbidden.map((f) => f.toLowerCase()));
  return r.labels
    .filter((l) => deny.has(l.toLowerCase()))
    .map((l) => `${name}: grants gate-output label "${l}" - labels authorising work must come from a bot/maintainer write, never an issue form`);
}

/** Problems for a classic markdown template: `labels:` lives in the leading `---` frontmatter. */
export function checkMarkdownTemplate(
  name: string,
  md: string,
  forbidden: readonly string[] = GATE_OUTPUT_LABELS,
): string[] {
  const text = md.replace(/\r\n?/g, '\n');
  if (!text.startsWith('---\n')) return [];
  const end = text.indexOf('\n---', 4);
  if (end === -1) return [`${name}: unterminated frontmatter`];
  const r = extractLabels(text.slice(4, end));
  if (!r.ok) return [`${name}: ${r.reason}`];
  const deny = new Set(forbidden.map((f) => f.toLowerCase()));
  return r.labels
    .filter((l) => deny.has(l.toLowerCase()))
    .map((l) => `${name}: grants gate-output label "${l}" - labels authorising work must come from a bot/maintainer write, never an issue template`);
}
