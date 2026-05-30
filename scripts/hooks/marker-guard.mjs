#!/usr/bin/env node
/**
 * marker-guard — PreToolUse hook (DR-011).
 *
 * Auto-approves Edit/MultiEdit calls that fall ENTIRELY within MinSpec's own
 * `<!-- minspec:NAME:start -->` … `<!-- minspec:NAME:end -->` marker blocks in a
 * managed harness file. Every other case stays silent and defers to the normal
 * permission flow (and to any other PreToolUse hook, e.g. spec-gate.sh).
 *
 * Default-deny by construction: the ONLY output that changes behaviour is an
 * "allow" decision, emitted solely when containment is proven. A bug can only
 * fail to allow (→ normal prompt), never over-approve. Whole-file Write is never
 * auto-approved — it cannot be marker-bounded.
 *
 * Reads the PreToolUse event JSON on stdin. Pure file-system; no network, no AI.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const MANAGED = new Set([
  'CLAUDE.md',
  'AGENTS.md',
  '.cursorrules',
  'DESIGN.md',
  '.minspec/constitution.md',
  'docs/decisions/INDEX.md',
]);

const MARKER_RE =
  /<!--\s*minspec:[a-z0-9-]+:start\s*-->([\s\S]*?)<!--\s*minspec:[a-z0-9-]+:end\s*-->/g;

/** Stay neutral: emit nothing, defer to normal flow. */
function defer() {
  process.exit(0);
}

/** Auto-approve this tool call. */
function allow(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

/** Inner [start,end) char ranges of every minspec marker block in `text`. */
function markerRanges(text) {
  const ranges = [];
  for (const m of text.matchAll(MARKER_RE)) {
    const innerStart = m.index + m[0].indexOf(m[1]);
    ranges.push([innerStart, innerStart + m[1].length]);
  }
  return ranges;
}

/** True iff `needle` occurs exactly once in `text` and that span ⊆ a marker block. */
function containedOnce(text, needle) {
  if (!needle) return false;
  const first = text.indexOf(needle);
  if (first === -1) return false;
  if (text.indexOf(needle, first + 1) !== -1) return false; // ambiguous → defer
  const end = first + needle.length;
  return markerRanges(text).some(([s, e]) => first >= s && end <= e);
}

function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf-8');
  } catch {
    return defer();
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return defer();
  }

  const tool = event.tool_name;
  const input = event.tool_input || {};
  const filePath = input.file_path;
  if (!filePath || (tool !== 'Edit' && tool !== 'MultiEdit')) return defer();

  const cwd = event.cwd || process.cwd();
  const rel = path.relative(cwd, path.resolve(cwd, filePath));
  if (!MANAGED.has(rel)) return defer();

  let text;
  try {
    text = fs.readFileSync(path.resolve(cwd, filePath), 'utf-8');
  } catch {
    return defer(); // new/unreadable file: cannot prove containment
  }

  if (tool === 'Edit') {
    if (containedOnce(text, input.old_string)) {
      return allow(`Edit confined to a minspec:* marker block in ${rel}`);
    }
    return defer();
  }

  // MultiEdit: every edit must be independently contained.
  const edits = Array.isArray(input.edits) ? input.edits : [];
  if (edits.length > 0 && edits.every(e => containedOnce(text, e.old_string))) {
    return allow(`All ${edits.length} edits confined to minspec:* marker blocks in ${rel}`);
  }
  return defer();
}

main();
