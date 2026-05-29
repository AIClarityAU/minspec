import * as fs from 'fs';
import * as path from 'path';
import type { ParsedSpec, SpecFrontmatter } from './spec';
import { parseSpec, writeSpec } from './spec';
import { PHASES } from './config';

/**
 * Storage layout for a single spec on disk.
 *
 * Two shapes:
 * - `flat`: one markdown file per spec.
 *   filePath = `<specsDir>/SPEC-NNN-slug.md`
 *
 * - `spec-kit`: one directory per spec (strict GitHub Spec Kit compat).
 *   dirPath  = `<specsDir>/NNN-slug/`
 *   Files inside (any subset may exist):
 *     - `spec.md`  — frontmatter + preamble + `## Specify` + `## Clarify` + non-phase sections
 *     - `plan.md`  — `## Plan`
 *     - `tasks.md` — `## Tasks` + `## Implement`
 *
 *   Authoritative frontmatter lives in spec.md only. plan.md / tasks.md are body-only.
 */

const DIR_PREFIX_RE = /^(\d{3,})-/;

/** Files that may exist inside a spec-kit directory. */
export const SPEC_KIT_FILES = ['spec.md', 'plan.md', 'tasks.md'] as const;
export type SpecKitFile = (typeof SPEC_KIT_FILES)[number];

/** Map phase headings (capitalized) to the spec-kit file they belong in. */
const PHASE_FILE_MAP: Record<string, SpecKitFile> = {
  Specify: 'spec.md',
  Clarify: 'spec.md',
  Plan: 'plan.md',
  Tasks: 'tasks.md',
  Implement: 'tasks.md',
};

/** Strip the SPEC- prefix from an ID, returning the zero-padded numeric part. */
export function specIdToDirNumber(specId: string): string {
  const match = specId.match(/^SPEC-(\d+)/);
  if (!match) return specId;
  return match[1];
}

/** Build the spec-kit directory name from a spec id and slug. */
export function specKitDirName(specId: string, slug: string): string {
  const num = specIdToDirNumber(specId);
  return slug ? `${num}-${slug}` : num;
}

/** Does an entry under specsDir look like a spec-kit directory? */
export function isSpecKitDirEntry(entryName: string): boolean {
  return DIR_PREFIX_RE.test(entryName);
}

/**
 * Split a ParsedSpec into one ParsedSpec per spec-kit file.
 *
 * Returned shards are not directly writable as full specs (plan.md / tasks.md
 * should have no frontmatter); use {@link writeSpecKitDir} to serialize.
 *
 * Sections route by name:
 * - Phase sections (Specify/Clarify/Plan/Tasks/Implement) follow PHASE_FILE_MAP.
 * - Non-phase sections stay in spec.md so arbitrary user content is preserved.
 */
export function splitSpecForSpecKit(spec: ParsedSpec): Record<SpecKitFile, ParsedSpec> {
  const shards: Record<SpecKitFile, ParsedSpec> = {
    'spec.md': emptyShard(spec.frontmatter, spec.preamble),
    'plan.md': emptyShard(spec.frontmatter, ''),
    'tasks.md': emptyShard(spec.frontmatter, ''),
  };

  for (const [heading, body] of spec.sections) {
    const target = PHASE_FILE_MAP[heading] ?? 'spec.md';
    (shards[target].sections as Map<string, string>).set(heading, body);
  }

  return shards;
}

function emptyShard(fm: SpecFrontmatter, preamble: string): ParsedSpec {
  return {
    frontmatter: fm,
    preamble,
    sections: new Map<string, string>(),
    phaseSections: {},
    raw: '',
  };
}

/**
 * Merge a set of spec-kit shards back into a single ParsedSpec.
 *
 * spec.md is authoritative for frontmatter and preamble. plan.md / tasks.md
 * contribute body sections only; any frontmatter in those files is discarded.
 *
 * Sections are gathered in canonical phase order (Specify, Clarify, Plan,
 * Tasks, Implement), then any non-phase sections from spec.md in their
 * original order.
 */
export function mergeSpecKitShards(shards: Partial<Record<SpecKitFile, ParsedSpec>>): ParsedSpec {
  const specShard = shards['spec.md'];
  if (!specShard) {
    throw new Error('mergeSpecKitShards: spec.md is required');
  }

  const merged = new Map<string, string>();

  for (const phase of PHASES) {
    const heading = phase.charAt(0).toUpperCase() + phase.slice(1);
    const target = PHASE_FILE_MAP[heading];
    const shard = shards[target];
    if (shard) {
      const body = shard.sections.get(heading);
      if (body !== undefined) merged.set(heading, body);
    }
  }

  // Non-phase sections from spec.md preserved in original order
  for (const [heading, body] of specShard.sections) {
    if (!(heading in PHASE_FILE_MAP)) {
      merged.set(heading, body);
    }
  }

  return {
    frontmatter: specShard.frontmatter,
    preamble: specShard.preamble,
    sections: merged,
    phaseSections: {},
    raw: '',
  };
}

/**
 * Serialize a single spec-kit shard. Only spec.md gets frontmatter;
 * plan.md and tasks.md are body-only markdown.
 */
function writeShard(fileName: SpecKitFile, shard: ParsedSpec): string {
  if (fileName === 'spec.md') {
    return writeSpec(shard);
  }
  const parts: string[] = [];
  for (const [heading, body] of shard.sections) {
    parts.push(`## ${heading}`);
    parts.push(body);
    parts.push('');
  }
  if (parts.length === 0) return '';
  return parts.join('\n').trimEnd() + '\n';
}

/**
 * Read a spec-kit directory into a single ParsedSpec.
 * Missing files are tolerated — only spec.md is required.
 */
export function readSpecKitDir(dirPath: string): ParsedSpec {
  const shards: Partial<Record<SpecKitFile, ParsedSpec>> = {};
  for (const fileName of SPEC_KIT_FILES) {
    const filePath = path.join(dirPath, fileName);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    shards[fileName] = parseSpec(content);
  }
  return mergeSpecKitShards(shards);
}

/**
 * Write a ParsedSpec out to a spec-kit directory.
 * Creates the directory if needed. Only writes files that have content
 * (plan.md / tasks.md are skipped if empty), but spec.md is always written.
 */
export function writeSpecKitDir(dirPath: string, spec: ParsedSpec): void {
  fs.mkdirSync(dirPath, { recursive: true });
  const shards = splitSpecForSpecKit(spec);

  for (const fileName of SPEC_KIT_FILES) {
    const shard = shards[fileName];
    const content = writeShard(fileName, shard);
    const filePath = path.join(dirPath, fileName);

    if (fileName === 'spec.md') {
      fs.writeFileSync(filePath, content, 'utf-8');
      continue;
    }

    // Body-only files: write if non-empty, remove if empty + previously existed
    if (content.trim() === '') {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } else {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
  }
}
