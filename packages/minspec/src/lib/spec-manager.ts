import * as fs from 'fs';
import * as path from 'path';
import type { Tier, Phase } from './config';
import { loadConfig, PHASES, resolveAndValidate } from './config';
import type { SpecFrontmatter, ParsedSpec } from './spec';
import { parseSpec, writeSpec, readSpecFile, writeSpecFile } from './spec';
import type { PhaseState, SpecStatus, TransitionResult } from './lifecycle';
import {
  createInitialPhases,
  getCurrentPhase,
  getSpecStatus,
  advancePhase,
  skipPhase,
  goBackToPhase,
  archiveSpec as archiveSpecLifecycle,
} from './lifecycle';

/** Summary of a spec for listing/display */
export interface SpecSummary {
  readonly id: string;
  readonly title: string;
  readonly tier: Tier;
  readonly status: SpecStatus;
  readonly currentPhase: Phase | null;
  readonly filePath: string;
}

/** Full spec detail including content and phase states */
export interface SpecDetail {
  readonly summary: SpecSummary;
  readonly content: string;
  readonly phases: PhaseState;
}

// --- Slug generation ---

/**
 * Convert a title to a URL-friendly slug.
 * Lowercase, non-alphanumeric → hyphens, collapsed, trimmed, max 50 chars.
 */
export function slugify(title: string): string {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (slug.length > 50) {
    slug = slug.slice(0, 50).replace(/-$/, '');
  }

  return slug;
}

// --- ID generation ---

const SPEC_ID_RE = /^SPEC-(\d+)/;
const SPEC_FILE_RE = /^SPEC-\d{3,}.*\.md$/;

/**
 * Scan specs directory and return the next sequential SPEC ID.
 * E.g., if SPEC-003 exists, returns "SPEC-004".
 */
export function nextSpecId(specsDir: string): string {
  let maxNum = 0;

  if (fs.existsSync(specsDir)) {
    const entries = fs.readdirSync(specsDir);
    for (const entry of entries) {
      const match = entry.match(SPEC_ID_RE);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  }

  const nextNum = maxNum + 1;
  return `SPEC-${String(nextNum).padStart(3, '0')}`;
}

// --- Helpers ---

function resolveSpecsDir(rootDir: string): string {
  const config = loadConfig(rootDir);
  return resolveAndValidate(rootDir, config.specsDir);
}

function findSpecFile(specsDir: string, specId: string): string | null {
  if (!fs.existsSync(specsDir)) return null;

  const entries = fs.readdirSync(specsDir);
  for (const entry of entries) {
    if (entry.startsWith(specId) && entry.endsWith('.md')) {
      return path.join(specsDir, entry);
    }
  }
  return null;
}

function buildSummary(parsed: ParsedSpec, filePath: string): SpecSummary {
  return {
    id: parsed.frontmatter.id,
    title: parsed.frontmatter.title,
    tier: parsed.frontmatter.tier,
    status: parsed.frontmatter.status,
    currentPhase: getCurrentPhase(parsed.frontmatter.phases),
    filePath,
  };
}

// --- CRUD operations ---

/**
 * Create a new spec file with auto-generated ID and optional tier.
 */
export function createSpec(rootDir: string, title: string, tier: Tier = 'T2'): SpecSummary {
  const specsDir = resolveSpecsDir(rootDir);
  fs.mkdirSync(specsDir, { recursive: true });

  const id = nextSpecId(specsDir);
  const slug = slugify(title);
  const fileName = `${id}-${slug}.md`;
  const filePath = path.join(specsDir, fileName);
  const today = new Date().toISOString().slice(0, 10);

  const initialPhases = createInitialPhases();

  const frontmatter: SpecFrontmatter = {
    id,
    title,
    tier,
    status: 'new',
    created: today,
    phases: initialPhases as Record<Phase, import('./spec').PhaseStatus>,
  };

  // Build skeleton spec with phase sections based on tier
  const config = loadConfig(rootDir);
  const tierMapping = config.phaseMappings[tier];
  const relevantPhases = [...tierMapping.requiredPhases, ...tierMapping.optionalPhases];

  const sections = new Map<string, string>();
  for (const phase of PHASES) {
    if (relevantPhases.includes(phase)) {
      const capitalized = phase.charAt(0).toUpperCase() + phase.slice(1);
      sections.set(capitalized, '\n');
    }
  }

  const spec: ParsedSpec = {
    frontmatter,
    preamble: '',
    sections,
    phaseSections: {},
    raw: '',
  };

  const content = writeSpec(spec);
  fs.writeFileSync(filePath, content, 'utf-8');

  return {
    id,
    title,
    tier,
    status: 'new',
    currentPhase: getCurrentPhase(initialPhases),
    filePath,
  };
}

/**
 * List all specs, optionally filtered by status and/or tier.
 */
export function listSpecs(
  rootDir: string,
  filter?: { status?: SpecStatus; tier?: Tier },
): SpecSummary[] {
  const specsDir = resolveSpecsDir(rootDir);
  if (!fs.existsSync(specsDir)) return [];

  const entries = fs.readdirSync(specsDir).filter((e) => SPEC_FILE_RE.test(e)).sort();
  const results: SpecSummary[] = [];

  for (const entry of entries) {
    const filePath = path.join(specsDir, entry);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    try {
      const parsed = readSpecFile(filePath);
      const summary = buildSummary(parsed, filePath);

      if (filter?.status && summary.status !== filter.status) continue;
      if (filter?.tier && summary.tier !== filter.tier) continue;

      results.push(summary);
    } catch {
      continue;
    }
  }

  return results;
}

/**
 * Get full details for a single spec by ID.
 */
export function getSpec(rootDir: string, specId: string): SpecDetail | null {
  const specsDir = resolveSpecsDir(rootDir);
  const filePath = findSpecFile(specsDir, specId);
  if (!filePath) return null;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseSpec(content);
    const summary = buildSummary(parsed, filePath);

    return {
      summary,
      content,
      phases: parsed.frontmatter.phases,
    };
  } catch {
    return null;
  }
}

/**
 * Transition a spec's phase (advance, skip, or go back).
 */
export function transitionPhase(
  rootDir: string,
  specId: string,
  action: 'advance' | 'skip' | 'back',
  reason?: string,
): TransitionResult {
  const specsDir = resolveSpecsDir(rootDir);
  const filePath = findSpecFile(specsDir, specId);
  if (!filePath) {
    return {
      success: false,
      newPhases: createInitialPhases(),
      newStatus: 'new',
      warning: `Spec '${specId}' not found`,
    };
  }

  const parsed = readSpecFile(filePath);
  const phases = parsed.frontmatter.phases;
  const current = getCurrentPhase(phases);

  if (!current) {
    return {
      success: false,
      newPhases: phases,
      newStatus: getSpecStatus(phases),
      warning: 'No active phase to transition',
    };
  }

  let result: TransitionResult;

  switch (action) {
    case 'advance':
      result = advancePhase(phases, current);
      break;
    case 'skip':
      result = skipPhase(phases, current, reason ?? 'Skipped');
      break;
    case 'back':
      result = goBackToPhase(phases, current, reason ?? 'Reopened');
      break;
  }

  if (result.success) {
    const newFm: SpecFrontmatter = {
      ...parsed.frontmatter,
      status: result.newStatus,
      phases: result.newPhases as Record<Phase, import('./spec').PhaseStatus>,
    };
    writeSpecFile(filePath, { ...parsed, frontmatter: newFm });
  }

  return result;
}

/**
 * Archive a spec — preserves completed phases, sets status to archived.
 */
export function archiveSpecById(rootDir: string, specId: string): TransitionResult {
  const specsDir = resolveSpecsDir(rootDir);
  const filePath = findSpecFile(specsDir, specId);
  if (!filePath) {
    return {
      success: false,
      newPhases: createInitialPhases(),
      newStatus: 'new',
      warning: `Spec '${specId}' not found`,
    };
  }

  const parsed = readSpecFile(filePath);
  const result = archiveSpecLifecycle(parsed.frontmatter.phases);

  if (result.success) {
    const newFm: SpecFrontmatter = {
      ...parsed.frontmatter,
      status: 'archived',
      phases: result.newPhases as Record<Phase, import('./spec').PhaseStatus>,
    };
    writeSpecFile(filePath, { ...parsed, frontmatter: newFm });
  }

  return result;
}

/**
 * Delete a spec file. Requires confirm=true as a safety measure.
 */
export function deleteSpec(rootDir: string, specId: string, confirm: boolean): boolean {
  if (!confirm) return false;

  const specsDir = resolveSpecsDir(rootDir);
  const filePath = findSpecFile(specsDir, specId);
  if (!filePath) return false;

  fs.unlinkSync(filePath);
  return true;
}
