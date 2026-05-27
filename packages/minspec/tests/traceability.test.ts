/**
 * T1 — Contract Tests: Traceability
 *
 * Tests all public exports from src/lib/traceability.ts:
 *   - loadTraceability, saveTraceability
 *   - addFileMapping, addTestMapping, removeFileMapping
 *   - findRequirementsForFile, findCodeForRequirement
 *   - parseLocationString, formatLocationString
 *   - extractFileRefsFromText
 *   - listTracedSpecs, listRequirements
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  loadTraceability,
  saveTraceability,
  parseLocationString,
  formatLocationString,
  addFileMapping,
  addTestMapping,
  removeFileMapping,
  findRequirementsForFile,
  findCodeForRequirement,
  listTracedSpecs,
  listRequirements,
  extractFileRefsFromText,
  type TraceabilityData,
} from '../src/lib/traceability';

describe('traceability', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-trace-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── File I/O ─────────────────────────────────────────────────────────

  describe('loadTraceability()', () => {
    it('returns empty object when file does not exist', () => {
      const data = loadTraceability(tmpDir);
      expect(data).toEqual({});
    });

    it('returns empty object for invalid JSON', () => {
      const dir = path.join(tmpDir, '.minspec');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'traceability.json'), 'not json!!');
      expect(loadTraceability(tmpDir)).toEqual({});
    });

    it('loads valid traceability data', () => {
      const data: TraceabilityData = {
        'SPEC-001': {
          requirements: {
            'rate-limit': {
              files: ['src/rate-limit.ts:3-5'],
              tests: ['tests/rate-limit.test.ts:10-20'],
            },
          },
        },
      };
      const dir = path.join(tmpDir, '.minspec');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'traceability.json'), JSON.stringify(data));

      const loaded = loadTraceability(tmpDir);
      expect(loaded['SPEC-001']).toBeDefined();
      expect(loaded['SPEC-001'].requirements['rate-limit'].files).toEqual(['src/rate-limit.ts:3-5']);
    });
  });

  describe('saveTraceability()', () => {
    it('creates .minspec directory and file', () => {
      const data: TraceabilityData = {
        'SPEC-001': { requirements: { req1: { files: ['a.ts:1'], tests: [] } } },
      };
      saveTraceability(tmpDir, data);

      const filePath = path.join(tmpDir, '.minspec', 'traceability.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const loaded = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(loaded['SPEC-001'].requirements.req1.files).toEqual(['a.ts:1']);
    });

    it('round-trips with loadTraceability', () => {
      const data: TraceabilityData = {
        'SPEC-001': {
          requirements: {
            auth: { files: ['src/auth.ts:1-10'], tests: ['tests/auth.test.ts:5'] },
          },
        },
        'SPEC-002': {
          requirements: {
            cache: { files: ['src/cache.ts'], tests: [] },
          },
        },
      };
      saveTraceability(tmpDir, data);
      const loaded = loadTraceability(tmpDir);

      expect(loaded['SPEC-001'].requirements.auth.files).toEqual(['src/auth.ts:1-10']);
      expect(loaded['SPEC-002'].requirements.cache.files).toEqual(['src/cache.ts']);
    });
  });

  // ─── Location Parsing ─────────────────────────────────────────────────

  describe('parseLocationString()', () => {
    it('parses file path with line range', () => {
      const result = parseLocationString('src/foo.ts:3-5');
      expect(result).toEqual({ relativePath: 'src/foo.ts', startLine: 3, endLine: 5 });
    });

    it('parses file path with single line', () => {
      const result = parseLocationString('src/foo.ts:3');
      expect(result).toEqual({ relativePath: 'src/foo.ts', startLine: 3, endLine: 3 });
    });

    it('parses bare file path (no line spec)', () => {
      const result = parseLocationString('src/foo.ts');
      expect(result).toEqual({ relativePath: 'src/foo.ts', startLine: 1, endLine: 1 });
    });

    it('handles path ending with colon (no line number)', () => {
      const result = parseLocationString('src/foo.ts:');
      expect(result).toEqual({ relativePath: 'src/foo.ts:', startLine: 1, endLine: 1 });
    });

    it('handles Windows-style drive letters without confusion', () => {
      // C:src/foo.ts should not interpret "src/foo.ts" as a line range
      const result = parseLocationString('C:src/foo.ts');
      // The colon after C doesn't look like digits, so treated as whole path
      expect(result.relativePath).toBe('C:src/foo.ts');
    });
  });

  describe('formatLocationString()', () => {
    it('formats single line', () => {
      expect(formatLocationString('src/foo.ts', 3, 3)).toBe('src/foo.ts:3');
    });

    it('formats line range', () => {
      expect(formatLocationString('src/foo.ts', 3, 5)).toBe('src/foo.ts:3-5');
    });

    it('round-trips with parseLocationString', () => {
      const original = 'src/bar.ts:10-20';
      const parsed = parseLocationString(original);
      const formatted = formatLocationString(parsed.relativePath, parsed.startLine, parsed.endLine);
      expect(formatted).toBe(original);
    });
  });

  // ─── Mutation Helpers ─────────────────────────────────────────────────

  describe('addFileMapping()', () => {
    it('adds mapping to empty data', () => {
      const data: TraceabilityData = {};
      const result = addFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:1-10');

      expect(result['SPEC-001']).toBeDefined();
      expect(result['SPEC-001'].requirements.auth.files).toEqual(['src/auth.ts:1-10']);
      expect(result['SPEC-001'].requirements.auth.tests).toEqual([]);
    });

    it('adds to existing spec and requirement', () => {
      let data: TraceabilityData = {};
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:1-10');
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src/middleware.ts:5');

      expect(data['SPEC-001'].requirements.auth.files).toEqual([
        'src/auth.ts:1-10',
        'src/middleware.ts:5',
      ]);
    });

    it('does not add duplicate locations', () => {
      let data: TraceabilityData = {};
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:1-10');
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:1-10');

      expect(data['SPEC-001'].requirements.auth.files).toEqual(['src/auth.ts:1-10']);
    });

    it('does not mutate original data', () => {
      const original: TraceabilityData = {};
      const updated = addFileMapping(original, 'SPEC-001', 'auth', 'src/auth.ts:1');

      expect(original).toEqual({});
      expect(updated['SPEC-001']).toBeDefined();
    });

    it('adds to new requirement on existing spec', () => {
      let data: TraceabilityData = {};
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:1');
      data = addFileMapping(data, 'SPEC-001', 'cache', 'src/cache.ts:5');

      expect(Object.keys(data['SPEC-001'].requirements)).toEqual(['auth', 'cache']);
    });
  });

  describe('addTestMapping()', () => {
    it('adds test mapping to empty data', () => {
      const data: TraceabilityData = {};
      const result = addTestMapping(data, 'SPEC-001', 'auth', 'tests/auth.test.ts:1-20');

      expect(result['SPEC-001'].requirements.auth.tests).toEqual(['tests/auth.test.ts:1-20']);
      expect(result['SPEC-001'].requirements.auth.files).toEqual([]);
    });

    it('does not add duplicate test locations', () => {
      let data: TraceabilityData = {};
      data = addTestMapping(data, 'SPEC-001', 'auth', 'tests/auth.test.ts:1');
      data = addTestMapping(data, 'SPEC-001', 'auth', 'tests/auth.test.ts:1');

      expect(data['SPEC-001'].requirements.auth.tests).toHaveLength(1);
    });

    it('does not mutate original data', () => {
      const original: TraceabilityData = {};
      addTestMapping(original, 'SPEC-001', 'auth', 'tests/auth.test.ts:1');
      expect(original).toEqual({});
    });
  });

  describe('removeFileMapping()', () => {
    it('removes existing file mapping', () => {
      let data: TraceabilityData = {};
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:1');
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src/middleware.ts:5');

      data = removeFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:1');

      expect(data['SPEC-001'].requirements.auth.files).toEqual(['src/middleware.ts:5']);
    });

    it('returns data unchanged when spec does not exist', () => {
      const data: TraceabilityData = {};
      const result = removeFileMapping(data, 'SPEC-999', 'auth', 'src/auth.ts:1');
      expect(result).toEqual(data);
    });

    it('returns data unchanged when requirement does not exist', () => {
      let data: TraceabilityData = {};
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:1');

      const result = removeFileMapping(data, 'SPEC-001', 'nonexistent', 'src/auth.ts:1');
      expect(result['SPEC-001'].requirements.auth.files).toEqual(['src/auth.ts:1']);
    });

    it('returns data unchanged when location not found', () => {
      let data: TraceabilityData = {};
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:1');

      const result = removeFileMapping(data, 'SPEC-001', 'auth', 'src/other.ts:99');
      expect(result['SPEC-001'].requirements.auth.files).toEqual(['src/auth.ts:1']);
    });
  });

  // ─── Query Helpers ────────────────────────────────────────────────────

  describe('findRequirementsForFile()', () => {
    it('finds requirements mapped to a file', () => {
      let data: TraceabilityData = {};
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:1-10');
      data = addFileMapping(data, 'SPEC-001', 'cache', 'src/auth.ts:20-30');
      data = addFileMapping(data, 'SPEC-002', 'logging', 'src/logger.ts:5');

      const results = findRequirementsForFile(data, 'src/auth.ts');

      expect(results).toHaveLength(2);
      expect(results.map(r => r.requirementKey).sort()).toEqual(['auth', 'cache']);
      expect(results.every(r => r.specId === 'SPEC-001')).toBe(true);
    });

    it('finds requirements mapped via test files too', () => {
      let data: TraceabilityData = {};
      data = addTestMapping(data, 'SPEC-001', 'auth', 'tests/auth.test.ts:5');

      const results = findRequirementsForFile(data, 'tests/auth.test.ts');
      expect(results).toHaveLength(1);
      expect(results[0].specId).toBe('SPEC-001');
      expect(results[0].requirementKey).toBe('auth');
    });

    it('returns empty array when no mappings match', () => {
      const data: TraceabilityData = {};
      expect(findRequirementsForFile(data, 'src/unknown.ts')).toEqual([]);
    });

    it('normalizes path separators', () => {
      let data: TraceabilityData = {};
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src\\auth.ts:1');

      const results = findRequirementsForFile(data, 'src/auth.ts');
      expect(results).toHaveLength(1);
    });
  });

  describe('findCodeForRequirement()', () => {
    it('returns files and tests for a requirement', () => {
      let data: TraceabilityData = {};
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:1-10');
      data = addTestMapping(data, 'SPEC-001', 'auth', 'tests/auth.test.ts:5-20');

      const result = findCodeForRequirement(data, 'SPEC-001', 'auth');
      expect(result.files).toEqual(['src/auth.ts:1-10']);
      expect(result.tests).toEqual(['tests/auth.test.ts:5-20']);
    });

    it('returns empty arrays when spec does not exist', () => {
      const result = findCodeForRequirement({}, 'SPEC-999', 'auth');
      expect(result).toEqual({ files: [], tests: [] });
    });

    it('returns empty arrays when requirement does not exist', () => {
      let data: TraceabilityData = {};
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:1');

      const result = findCodeForRequirement(data, 'SPEC-001', 'nonexistent');
      expect(result).toEqual({ files: [], tests: [] });
    });

    it('returns copies (not references to internal arrays)', () => {
      let data: TraceabilityData = {};
      data = addFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:1');

      const result = findCodeForRequirement(data, 'SPEC-001', 'auth');
      result.files.push('injected');

      const result2 = findCodeForRequirement(data, 'SPEC-001', 'auth');
      expect(result2.files).toEqual(['src/auth.ts:1']);
    });
  });

  describe('listTracedSpecs()', () => {
    it('returns sorted spec IDs', () => {
      let data: TraceabilityData = {};
      data = addFileMapping(data, 'SPEC-003', 'a', 'x.ts:1');
      data = addFileMapping(data, 'SPEC-001', 'b', 'y.ts:1');

      expect(listTracedSpecs(data)).toEqual(['SPEC-001', 'SPEC-003']);
    });

    it('returns empty array for empty data', () => {
      expect(listTracedSpecs({})).toEqual([]);
    });
  });

  describe('listRequirements()', () => {
    it('returns sorted requirement keys for a spec', () => {
      let data: TraceabilityData = {};
      data = addFileMapping(data, 'SPEC-001', 'cache', 'a.ts:1');
      data = addFileMapping(data, 'SPEC-001', 'auth', 'b.ts:1');

      expect(listRequirements(data, 'SPEC-001')).toEqual(['auth', 'cache']);
    });

    it('returns empty array for unknown spec', () => {
      expect(listRequirements({}, 'SPEC-999')).toEqual([]);
    });
  });

  // ─── Auto-suggest Helpers ─────────────────────────────────────────────

  describe('extractFileRefsFromText()', () => {
    it('extracts backticked file paths', () => {
      const text = 'Implement the logic in `src/auth.ts` and test in `tests/auth.test.ts`.';
      const refs = extractFileRefsFromText(text);
      expect(refs).toContain('src/auth.ts');
      expect(refs).toContain('tests/auth.test.ts');
    });

    it('extracts bare file paths', () => {
      const text = 'See src/middleware/rate-limit.ts for details.';
      const refs = extractFileRefsFromText(text);
      expect(refs).toContain('src/middleware/rate-limit.ts');
    });

    it('deduplicates results', () => {
      const text = 'Use `src/auth.ts` and also check `src/auth.ts` again.';
      const refs = extractFileRefsFromText(text);
      const authCount = refs.filter(r => r === 'src/auth.ts').length;
      expect(authCount).toBe(1);
    });

    it('ignores URLs', () => {
      const text = 'See https://example.com/path/file.ts for docs.';
      const refs = extractFileRefsFromText(text);
      expect(refs).not.toContain('https://example.com/path/file.ts');
    });

    it('returns empty array for text with no file references', () => {
      const text = 'This is just plain text with no file paths.';
      expect(extractFileRefsFromText(text)).toEqual([]);
    });

    it('recognizes common code extensions', () => {
      const text = '`app.py` `main.go` `lib.rs` `index.tsx` `style.css` `data.json`';
      const refs = extractFileRefsFromText(text);
      expect(refs).toContain('app.py');
      expect(refs).toContain('main.go');
      expect(refs).toContain('lib.rs');
      expect(refs).toContain('index.tsx');
      expect(refs).toContain('style.css');
      expect(refs).toContain('data.json');
    });
  });

  // ─── Integration: Save → Load → Query ────────────────────────────────

  describe('Integration: full workflow', () => {
    it('persists mappings and queries them bidirectionally', () => {
      let data: TraceabilityData = {};

      // Add mappings
      data = addFileMapping(data, 'SPEC-001', 'rate-limit', 'src/middleware/rate-limit.ts:3-15');
      data = addTestMapping(data, 'SPEC-001', 'rate-limit', 'tests/rate-limit.test.ts:10-30');
      data = addFileMapping(data, 'SPEC-002', 'cache', 'src/cache.ts:1-50');

      // Save and reload
      saveTraceability(tmpDir, data);
      const loaded = loadTraceability(tmpDir);

      // Query: file → requirements
      const reqs = findRequirementsForFile(loaded, 'src/middleware/rate-limit.ts');
      expect(reqs).toHaveLength(1);
      expect(reqs[0].specId).toBe('SPEC-001');
      expect(reqs[0].requirementKey).toBe('rate-limit');

      // Query: requirement → code
      const code = findCodeForRequirement(loaded, 'SPEC-001', 'rate-limit');
      expect(code.files).toEqual(['src/middleware/rate-limit.ts:3-15']);
      expect(code.tests).toEqual(['tests/rate-limit.test.ts:10-30']);

      // List specs
      expect(listTracedSpecs(loaded)).toEqual(['SPEC-001', 'SPEC-002']);

      // List requirements
      expect(listRequirements(loaded, 'SPEC-001')).toEqual(['rate-limit']);
    });
  });
});
