#!/usr/bin/env -S npx tsx
/**
 * check-issue-template-labels.ts - #1206. Fails if any .github/ISSUE_TEMPLATE/*.yml
 * grants a gate-output label (see GATE_OUTPUT_LABELS). Fails closed: unreadable or
 * unparseable template, or no templates found, is a RED.
 *
 *   npx tsx scripts/check-issue-template-labels.ts [--dir .github/ISSUE_TEMPLATE]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkTemplate } from './lib/issue-template-labels';

const i = process.argv.indexOf('--dir');
const dir = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : '.github/ISSUE_TEMPLATE';
const problems: string[] = [];
let files: string[] = [];
try {
  files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f) && f !== 'config.yml');
} catch (e) {
  problems.push(`cannot read ${dir}: ${(e as Error).message}`);
}
if (files.length === 0 && problems.length === 0) problems.push(`no issue templates found in ${dir}`);
for (const f of files) {
  try {
    problems.push(...checkTemplate(f, readFileSync(join(dir, f), 'utf8')));
  } catch (e) {
    problems.push(`${f}: unreadable: ${(e as Error).message}`);
  }
}
if (problems.length > 0) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`✓ ${files.length} issue template(s) grant no gate-output label`);
