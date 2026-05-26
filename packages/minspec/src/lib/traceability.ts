/**
 * Traceability — Phase 7.2
 *
 * Manages bidirectional mappings between spec requirements and source code.
 * Stored in .minspec/traceability.json, never requires network or AI.
 *
 * Schema:
 * {
 *   "SPEC-001": {
 *     "requirements": {
 *       "rate-limit-100": {
 *         "files": ["src/middleware/rate-limit.ts:3-5"],
 *         "tests": ["tests/rate-limit.test.ts:12-30"]
 *       }
 *     }
 *   }
 * }
 */

import * as fs from 'fs';
import * as path from 'path';

// --- Types ---

/** A single requirement's traceability mapping */
export interface RequirementMapping {
  files: string[];
  tests: string[];
}

/** All requirement mappings for a single spec */
export interface SpecTraceability {
  requirements: Record<string, RequirementMapping>;
}

/** Root traceability data: specId -> spec traceability */
export type TraceabilityData = Record<string, SpecTraceability>;

/** A resolved code location (absolute path + line range) */
export interface CodeLocation {
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** A resolved requirement reference (spec file + requirement key + title) */
export interface RequirementRef {
  readonly specId: string;
  readonly requirementKey: string;
  readonly specFilePath: string | null;
}

// --- File I/O ---

const TRACEABILITY_FILE = 'traceability.json';

function traceabilityPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.minspec', TRACEABILITY_FILE);
}

/**
 * Load traceability data from .minspec/traceability.json.
 * Returns empty object if file doesn't exist or is invalid.
 */
export function loadTraceability(workspaceRoot: string): TraceabilityData {
  const filePath = traceabilityPath(workspaceRoot);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as TraceabilityData;
  } catch {
    return {};
  }
}

/**
 * Save traceability data to .minspec/traceability.json.
 * Creates .minspec directory if needed.
 */
export function saveTraceability(workspaceRoot: string, data: TraceabilityData): void {
  const dirPath = path.join(workspaceRoot, '.minspec');
  fs.mkdirSync(dirPath, { recursive: true });
  const filePath = traceabilityPath(workspaceRoot);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// --- Location parsing ---

/**
 * Parse a location string like "src/foo.ts:3-5" into components.
 * Supports formats:
 *   "src/foo.ts"         → whole file (line 1-1)
 *   "src/foo.ts:3"       → single line
 *   "src/foo.ts:3-5"     → line range
 */
export function parseLocationString(location: string): { relativePath: string; startLine: number; endLine: number } {
  const colonIdx = location.lastIndexOf(':');
  if (colonIdx === -1 || colonIdx === location.length - 1) {
    return { relativePath: location, startLine: 1, endLine: 1 };
  }

  const pathPart = location.slice(0, colonIdx);
  const lineSpec = location.slice(colonIdx + 1);

  // Check if lineSpec looks like a line range (digits possibly with dash)
  if (!/^\d+(-\d+)?$/.test(lineSpec)) {
    // Not a line spec — could be a Windows drive letter or similar
    return { relativePath: location, startLine: 1, endLine: 1 };
  }

  const dashIdx = lineSpec.indexOf('-');
  if (dashIdx === -1) {
    const line = parseInt(lineSpec, 10);
    return { relativePath: pathPart, startLine: line, endLine: line };
  }

  const startLine = parseInt(lineSpec.slice(0, dashIdx), 10);
  const endLine = parseInt(lineSpec.slice(dashIdx + 1), 10);
  return { relativePath: pathPart, startLine, endLine };
}

/**
 * Format a location string from components.
 */
export function formatLocationString(relativePath: string, startLine: number, endLine: number): string {
  if (startLine === endLine) {
    return `${relativePath}:${startLine}`;
  }
  return `${relativePath}:${startLine}-${endLine}`;
}

// --- Mutation helpers ---

/**
 * Add a code file mapping to a requirement.
 * Creates spec/requirement entries if they don't exist.
 */
export function addFileMapping(
  data: TraceabilityData,
  specId: string,
  requirementKey: string,
  location: string,
): TraceabilityData {
  const result = { ...data };
  if (!result[specId]) {
    result[specId] = { requirements: {} };
  } else {
    result[specId] = { requirements: { ...result[specId].requirements } };
  }

  const reqs = result[specId].requirements;
  if (!reqs[requirementKey]) {
    reqs[requirementKey] = { files: [], tests: [] };
  } else {
    reqs[requirementKey] = { ...reqs[requirementKey], files: [...reqs[requirementKey].files] };
  }

  if (!reqs[requirementKey].files.includes(location)) {
    reqs[requirementKey].files.push(location);
  }
  return result;
}

/**
 * Add a test file mapping to a requirement.
 */
export function addTestMapping(
  data: TraceabilityData,
  specId: string,
  requirementKey: string,
  location: string,
): TraceabilityData {
  const result = { ...data };
  if (!result[specId]) {
    result[specId] = { requirements: {} };
  } else {
    result[specId] = { requirements: { ...result[specId].requirements } };
  }

  const reqs = result[specId].requirements;
  if (!reqs[requirementKey]) {
    reqs[requirementKey] = { files: [], tests: [] };
  } else {
    reqs[requirementKey] = { ...reqs[requirementKey], tests: [...reqs[requirementKey].tests] };
  }

  if (!reqs[requirementKey].tests.includes(location)) {
    reqs[requirementKey].tests.push(location);
  }
  return result;
}

/**
 * Remove a file mapping from a requirement.
 */
export function removeFileMapping(
  data: TraceabilityData,
  specId: string,
  requirementKey: string,
  location: string,
): TraceabilityData {
  const spec = data[specId];
  if (!spec) return data;
  const req = spec.requirements[requirementKey];
  if (!req) return data;

  const result = { ...data };
  result[specId] = {
    requirements: {
      ...spec.requirements,
      [requirementKey]: {
        ...req,
        files: req.files.filter(f => f !== location),
      },
    },
  };
  return result;
}

// --- Query helpers ---

/**
 * Find all requirement refs that map to a given file path (relative).
 * Matches the path prefix of location strings (ignoring line numbers).
 */
export function findRequirementsForFile(
  data: TraceabilityData,
  relativePath: string,
): Array<{ specId: string; requirementKey: string; location: string }> {
  const results: Array<{ specId: string; requirementKey: string; location: string }> = [];
  const normalizedPath = relativePath.replace(/\\/g, '/');

  for (const [specId, spec] of Object.entries(data)) {
    for (const [reqKey, mapping] of Object.entries(spec.requirements)) {
      for (const loc of mapping.files) {
        const parsed = parseLocationString(loc);
        if (parsed.relativePath.replace(/\\/g, '/') === normalizedPath) {
          results.push({ specId, requirementKey: reqKey, location: loc });
        }
      }
      for (const loc of mapping.tests) {
        const parsed = parseLocationString(loc);
        if (parsed.relativePath.replace(/\\/g, '/') === normalizedPath) {
          results.push({ specId, requirementKey: reqKey, location: loc });
        }
      }
    }
  }

  return results;
}

/**
 * Find all code locations mapped to a specific spec requirement.
 */
export function findCodeForRequirement(
  data: TraceabilityData,
  specId: string,
  requirementKey: string,
): { files: string[]; tests: string[] } {
  const spec = data[specId];
  if (!spec) return { files: [], tests: [] };
  const req = spec.requirements[requirementKey];
  if (!req) return { files: [], tests: [] };
  return { files: [...req.files], tests: [...req.tests] };
}

/**
 * List all spec IDs that have traceability data.
 */
export function listTracedSpecs(data: TraceabilityData): string[] {
  return Object.keys(data).sort();
}

/**
 * List all requirement keys for a given spec ID.
 */
export function listRequirements(data: TraceabilityData, specId: string): string[] {
  const spec = data[specId];
  if (!spec) return [];
  return Object.keys(spec.requirements).sort();
}

// --- Auto-suggest helpers ---

/**
 * Extract file path references from spec task text.
 * Matches backticked paths like `src/foo.ts` and bare paths ending in known extensions.
 */
export function extractFileRefsFromText(text: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  // Backticked file paths: `some/path.ext`
  const backtickRe = /`([^`]+\.\w+)`/g;
  let match: RegExpExecArray | null;
  while ((match = backtickRe.exec(text)) !== null) {
    const candidate = match[1];
    if (isLikelyFilePath(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      refs.push(candidate);
    }
  }

  // Bare file paths: word/word.ext patterns (not inside backticks)
  const bareRe = /(?:^|\s)([\w./-]+\.\w{1,10})(?:\s|$|[,;:)])/gm;
  while ((match = bareRe.exec(text)) !== null) {
    const candidate = match[1];
    if (isLikelyFilePath(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      refs.push(candidate);
    }
  }

  return refs;
}

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt',
  'c', 'cpp', 'h', 'hpp', 'cs', 'swift',
  'vue', 'svelte', 'astro',
  'css', 'scss', 'less',
  'html', 'htm',
  'json', 'yaml', 'yml', 'toml',
  'sh', 'bash', 'zsh',
  'sql',
]);

function isLikelyFilePath(candidate: string): boolean {
  // Must contain a slash or dot
  if (!candidate.includes('/') && !candidate.includes('.')) return false;
  // Must have a known extension
  const ext = candidate.split('.').pop()?.toLowerCase();
  if (!ext || !CODE_EXTENSIONS.has(ext)) return false;
  // Must not start with http/https
  if (candidate.startsWith('http://') || candidate.startsWith('https://')) return false;
  return true;
}
