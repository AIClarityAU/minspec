#!/usr/bin/env tsx
/**
 * validate-frontmatter.ts
 *
 * Enforces:
 * 1. docs/domain/*.md must have `type: domain` frontmatter
 * 2. specs/**\/*.md must have `id: SPEC-NNN` frontmatter
 * 3. Task checklists (- [ ]) not allowed in docs/domain/ files
 * 4. Acceptance criteria patterns not allowed in docs/domain/ files
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
let errors = 0;

function glob(dir: string, ext: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...glob(full, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) fm[key.trim()] = rest.join(':').trim();
  }
  return fm;
}

function fail(file: string, message: string): void {
  console.error(`FAIL ${relative(ROOT, file)}: ${message}`);
  errors++;
}

// Rule 1 + 3 + 4: docs/domain/*.md
const domainDir = join(ROOT, 'docs', 'domain');
try {
  const domainFiles = glob(domainDir, '.md');
  for (const file of domainFiles) {
    const content = readFileSync(file, 'utf-8');
    const fm = parseFrontmatter(content);

    if (fm['type'] !== 'domain') {
      fail(file, 'missing `type: domain` frontmatter');
    }
    if (/^- \[ \]/m.test(content)) {
      fail(file, 'task checklists (- [ ]) not allowed in domain docs');
    }
    if (/acceptance criteria/i.test(content)) {
      fail(file, 'acceptance criteria not allowed in domain docs');
    }
  }
} catch {
  // docs/domain/ doesn't exist yet — that's fine
}

// Build the registry of valid epic refs (ids + slugs, lowercased) from
// docs/epics/EPIC-*.md. Empty when the repo predates epics — the epic gate
// then skips entirely (graceful degradation: don't demand epics a repo hasn't
// adopted). Mirrors epicRefSet() in the extension.
function loadEpicRefs(): Set<string> {
  const refs = new Set<string>();
  const epicsDir = join(ROOT, 'docs', 'epics');
  try {
    for (const file of glob(epicsDir, '.md')) {
      const fm = parseFrontmatter(readFileSync(file, 'utf-8'));
      if (fm['id']) refs.add(fm['id'].toLowerCase());
      if (fm['slug']) refs.add(fm['slug'].toLowerCase());
    }
  } catch {
    // docs/epics/ doesn't exist — no epics registered.
  }
  return refs;
}

// Extract the machine ref from an `epic:` value, dropping any inline title
// comment (`epic: EPIC-004  # Classifier Validation`). Refs never contain `#`.
function epicRef(raw: string | undefined): string {
  if (!raw) return '';
  const hash = raw.indexOf('#');
  return (hash === -1 ? raw : raw.slice(0, hash)).trim();
}

// Rule 2 + 5: specs/**/*.md must have id: SPEC-NNN, and — once epics are
// registered — a resolvable `epic:` ref. The epic gate is the CI-side backstop
// for the asymmetry that stranded SPEC-004 (DR-003): a *missing* epic was as
// invisible as a *dangling* one. This is a project-policy gate for THIS repo
// (which has adopted epics); the shipped extension keeps epics soft (warning,
// FR-9). See DR-003 "RCDD on the RCDD" addendum.
const specsDir = join(ROOT, 'specs');
const epicRefs = loadEpicRefs();
try {
  const specFiles = glob(specsDir, '.md');
  for (const file of specFiles) {
    const content = readFileSync(file, 'utf-8');
    const fm = parseFrontmatter(content);

    if (!fm['id'] || !/^SPEC-\d+$/.test(fm['id'])) {
      fail(file, 'missing or invalid `id: SPEC-NNN` frontmatter');
    }

    if (epicRefs.size > 0) {
      const ref = epicRef(fm['epic']);
      if (!ref) {
        fail(file, 'missing `epic: EPIC-NNN` frontmatter (epics are registered — every spec must belong to one)');
      } else if (!epicRefs.has(ref.toLowerCase())) {
        fail(file, `epic "${ref}" does not match any registered epic (docs/epics/EPIC-NNN.md)`);
      }
    }
  }
} catch {
  // specs/ doesn't exist yet — fine
}

if (errors > 0) {
  console.error(`\n${errors} validation error(s). Fix before committing.`);
  process.exit(1);
} else {
  console.log('Frontmatter validation passed.');
}
