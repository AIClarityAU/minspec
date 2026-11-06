#!/usr/bin/env -S npx tsx
/**
 * check-template-version-bump.ts — a branch that changes shipped template content must bump
 * the extension version (#1989).
 *
 *   npx tsx scripts/check-template-version-bump.ts [--base <ref>]
 *
 * Exit 0 = ok. Exit 1 = templates changed without a bump. Exit 2 = could not determine
 * (no base ref, git failure): visible, never a silent pass. Offline: local refs only.
 * Wired into .githooks/pre-push and `npm run check:template-version`.
 */
import { execFileSync } from 'node:child_process';

import {
  checkTemplateVersionBump,
  readVersion,
  TEMPLATE_CONTENT_FILES,
  VERSION_FILE,
} from './lib/template-version-bump';

const git = (...args: string[]): string =>
  execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

function resolveBase(): string {
  const i = process.argv.indexOf('--base');
  const candidates = i !== -1 && process.argv[i + 1] ? [process.argv[i + 1]] : ['origin/main', 'main'];
  for (const ref of candidates) {
    try {
      return git('merge-base', 'HEAD', ref).trim();
    } catch {
      /* try next */
    }
  }
  throw new Error(`no merge-base with ${candidates.join(' / ')}`);
}

try {
  const base = resolveBase();
  const changed = git('diff', '--name-only', `${base}...HEAD`, '--', ...TEMPLATE_CONTENT_FILES)
    .split('\n')
    .filter(Boolean);
  const show = (rev: string): string | null => {
    try {
      return git('show', `${rev}:${VERSION_FILE}`);
    } catch {
      return null;
    }
  };
  const verdict = checkTemplateVersionBump(
    changed,
    readVersion(show(base) ?? ''),
    readVersion(show('HEAD') ?? ''),
  );
  if (!verdict.ok) {
    console.error(`template-version-bump: ${verdict.message}`);
    process.exit(1);
  }
  console.log(`template-version-bump: ok — ${verdict.message}`);
} catch (error) {
  console.error(
    `template-version-bump: could not determine (${error instanceof Error ? error.message : String(error)}). ` +
      'This is NOT a pass — it is an unrun check.',
  );
  process.exit(2);
}
