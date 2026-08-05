#!/usr/bin/env node
// parse-scan.mjs — turn one `claude -p --output-format json` transcript into a
// validated findings file plus a human-readable briefing.
//
// Two unwrapping steps, both of which can fail, and both of which fail LOUDLY:
//   1. the CLI envelope — `{ "type": "result", "result": "<model text>", ... }`
//   2. the model text itself, which is supposed to be bare JSON but in practice
//      arrives fenced in ```json roughly as often as not.
//
// A parse failure here is a real failure, not a quiet week. The distinction
// matters enough to be worth stating: "the scan found nothing" and "the scan
// broke" produce the same empty inbox, so if this script cannot tell them apart
// it will eventually report a broken radar as a calm one. Exit non-zero, keep the
// raw transcript on disk for diagnosis, and let the caller mark the run failed.
//
// Usage:  node parse-scan.mjs <raw-claude-output.json> <out-findings.json> <out-briefing.md>

import { readFileSync, writeFileSync } from 'node:fs';

/** Pull the model's text out of the CLI result envelope. */
export function unwrapEnvelope(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`claude output was not JSON (${error.message}); raw transcript kept`);
  }
  if (parsed && parsed.is_error) {
    throw new Error(`claude reported an error: ${parsed.result || '(no detail)'}`);
  }
  const text = typeof parsed?.result === 'string' ? parsed.result : null;
  if (!text) throw new Error('claude output had no string `result` field');
  return text;
}

/** Strip an optional ```json fence and parse the findings object. */
export function parseFindings(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  let obj;
  try {
    obj = JSON.parse(candidate);
  } catch (error) {
    throw new Error(`scan result was not JSON (${error.message})`);
  }
  if (!obj || typeof obj !== 'object') throw new Error('scan result was not an object');
  if (!Array.isArray(obj.findings)) {
    throw new Error('scan result has no `findings` array — contract drift, not a quiet week');
  }
  return obj;
}

/**
 * Compose the on-disk briefing. The model supplies the prose; everything that a
 * reader needs in order to TRUST the prose is added here, where no model can edit
 * it — counts, the provenance warning, and the excluded-source list.
 */
export function renderBriefing(obj, stampedAt) {
  const findings = obj.findings || [];
  const actionable = findings.filter((f) => f && f.act === true);
  const lines = [
    `# Tooling radar — ${stampedAt}`,
    '',
    `Verdict: **${obj.verdict || 'unstated'}** · ${findings.length} finding(s), ` +
      `${actionable.length} actionable.`,
    '',
    typeof obj.briefing_markdown === 'string' ? obj.briefing_markdown : '_(no briefing text)_',
  ];
  if (Array.isArray(obj.excluded) && obj.excluded.length > 0) {
    lines.push('', '## Sources excluded by the scan', '');
    for (const item of obj.excluded) lines.push(`- ${String(item)}`);
  }
  if (Array.isArray(obj.searched_empty) && obj.searched_empty.length > 0) {
    lines.push('', '## Searched, came up empty', '', obj.searched_empty.map(String).join(', '));
  }
  lines.push(
    '',
    '---',
    '',
    'Produced by `scripts/tooling-radar/`. The scan stage had web access only — no',
    'shell, no filesystem — so everything above is derived from untrusted pages and',
    'should be spot-checked before it drives a decision.',
  );
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [rawPath, findingsPath, briefingPath] = process.argv.slice(2);
  if (!rawPath || !findingsPath || !briefingPath) {
    console.error('usage: parse-scan.mjs <raw.json> <out-findings.json> <out-briefing.md>');
    process.exit(2);
  }
  try {
    const obj = parseFindings(unwrapEnvelope(readFileSync(rawPath, 'utf8')));
    const stampedAt = new Date().toISOString().slice(0, 10);
    writeFileSync(findingsPath, JSON.stringify(obj, null, 2));
    writeFileSync(briefingPath, renderBriefing(obj, stampedAt));
    const actionable = obj.findings.filter((f) => f && f.act === true).length;
    console.log(
      `radar: parsed ${obj.findings.length} finding(s), ${actionable} actionable → ${briefingPath}`,
    );
  } catch (error) {
    console.error(`radar: parse FAILED — ${error.message}`);
    process.exit(1);
  }
}
