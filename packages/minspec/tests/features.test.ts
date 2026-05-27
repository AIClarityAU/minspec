/**
 * T2 — Feature Tests
 *
 * End-to-end happy paths for key features:
 *   - Classification: signals → classify → correct tier with phases
 *   - Spec CRUD: create → list → update phase → archive
 *   - ADR creation: create ADR → verify sequential numbering
 *   - Traceability: add mapping → query bidirectionally
 *   - Session: declare scope → check file in/out of scope
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { classify, overrideClassification, type ClassificationSignal } from '../src/lib/classifier';
import { DEFAULT_CONFIG } from '../src/lib/config';
import {
  createSpec,
  listSpecs,
  getSpec,
  transitionPhase,
  archiveSpecById,
} from '../src/lib/spec-manager';
import { createAdr, listAdrs } from '../src/lib/adr-manager';
import {
  addFileMapping,
  addTestMapping,
  findRequirementsForFile,
  findCodeForRequirement,
  saveTraceability,
  loadTraceability,
  type TraceabilityData,
} from '../src/lib/traceability';
import {
  createSession,
  saveSession,
  loadSession,
  isFileInScope,
  addToScope,
} from '../src/lib/session';

// ─── Classification Feature ────────────────────────────────────────────

describe('Feature: Classification happy path', () => {
  function makeSignal(name: string, tier: 'T1' | 'T2' | 'T3' | 'T4'): ClassificationSignal {
    return { name, value: 1, weight: 1, tierContribution: tier };
  }

  it('classifies a set of signals to the correct tier and suggests phases', () => {
    // Simulate: small change with one T2 signal among T1 signals
    const signals = [
      makeSignal('files_changed', 'T1'),
      makeSignal('lines_changed', 'T1'),
      makeSignal('dependency_added', 'T2'),
    ];

    const result = classify(signals, DEFAULT_CONFIG);

    // Highest tier wins
    expect(result.tier).toBe('T2');

    // T2 requires specify + plan
    expect(result.suggestedPhases).toContain('specify');
    expect(result.suggestedPhases).toContain('plan');

    // Confidence reflects how many signals match the winning tier
    expect(result.confidence).toBeCloseTo(1 / 3, 5);
  });

  it('user can override classification and get updated phases', () => {
    const signals = [makeSignal('complex_change', 'T4')];
    const original = classify(signals, DEFAULT_CONFIG);
    expect(original.tier).toBe('T4');

    // User says "this is simpler than you think"
    const overridden = overrideClassification(original, 'T2', DEFAULT_CONFIG);
    expect(overridden.tier).toBe('T2');
    expect(overridden.overriddenBy).toBe('user');
    expect(overridden.suggestedPhases).toContain('specify');
    expect(overridden.suggestedPhases).toContain('plan');
    // T4 phases should not be present
    const t4OnlyPhases = DEFAULT_CONFIG.phaseMappings.T4.requiredPhases.filter(
      p => !DEFAULT_CONFIG.phaseMappings.T2.requiredPhases.includes(p) &&
           !DEFAULT_CONFIG.phaseMappings.T2.optionalPhases.includes(p),
    );
    for (const phase of t4OnlyPhases) {
      expect(overridden.suggestedPhases).not.toContain(phase);
    }
  });
});

// ─── Spec CRUD Feature ─────────────────────────────────────────────────

describe('Feature: Spec CRUD', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-feat-spec-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('create → list → update phase → archive', () => {
    // CREATE
    const summary = createSpec(tmpDir, 'Add user authentication', 'T3');
    expect(summary.id).toBe('SPEC-001');
    expect(summary.title).toBe('Add user authentication');
    expect(summary.tier).toBe('T3');
    expect(summary.status).toBe('new');
    expect(fs.existsSync(summary.filePath)).toBe(true);

    // LIST
    const specs = listSpecs(tmpDir);
    expect(specs).toHaveLength(1);
    expect(specs[0].id).toBe('SPEC-001');

    // GET details
    const detail = getSpec(tmpDir, 'SPEC-001');
    expect(detail).not.toBeNull();
    expect(detail!.summary.title).toBe('Add user authentication');

    // UPDATE PHASE — start specify
    const advance1 = transitionPhase(tmpDir, 'SPEC-001', 'advance');
    expect(advance1.success).toBe(true);

    // Verify phase changed
    const afterAdvance = getSpec(tmpDir, 'SPEC-001');
    expect(afterAdvance!.phases.specify).toBe('in-progress');

    // Complete specify
    const advance2 = transitionPhase(tmpDir, 'SPEC-001', 'advance');
    expect(advance2.success).toBe(true);

    const afterComplete = getSpec(tmpDir, 'SPEC-001');
    expect(afterComplete!.phases.specify).toBe('done');

    // ARCHIVE
    const archiveResult = archiveSpecById(tmpDir, 'SPEC-001');
    expect(archiveResult.success).toBe(true);
    expect(archiveResult.newStatus).toBe('archived');

    const archived = getSpec(tmpDir, 'SPEC-001');
    expect(archived!.summary.status).toBe('archived');
  });

  it('creates multiple specs with sequential IDs', () => {
    createSpec(tmpDir, 'First feature');
    createSpec(tmpDir, 'Second feature');
    createSpec(tmpDir, 'Third feature');

    const specs = listSpecs(tmpDir);
    expect(specs.map(s => s.id)).toEqual(['SPEC-001', 'SPEC-002', 'SPEC-003']);
  });

  it('filters specs by status', () => {
    createSpec(tmpDir, 'Active spec');
    createSpec(tmpDir, 'To archive');

    archiveSpecById(tmpDir, 'SPEC-002');

    const active = listSpecs(tmpDir, { status: 'new' });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('SPEC-001');

    const archived = listSpecs(tmpDir, { status: 'archived' });
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe('SPEC-002');
  });
});

// ─── ADR Feature ────────────────────────────────────────────────────────

describe('Feature: ADR creation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-feat-adr-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('create ADR → verify sequential numbering → list', () => {
    const adr1 = createAdr(tmpDir, 'Use PostgreSQL');
    const adr2 = createAdr(tmpDir, 'Adopt TypeScript');

    expect(adr1.id).toBe('DR-001');
    expect(adr2.id).toBe('DR-002');

    const all = listAdrs(tmpDir);
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe('DR-001');
    expect(all[1].id).toBe('DR-002');

    // Verify file contents
    const content = fs.readFileSync(adr1.filePath, 'utf-8');
    expect(content).toContain('# DR-001: Use PostgreSQL');
    expect(content).toContain('## Context');
    expect(content).toContain('## Decision');
    expect(content).toContain('## Consequences');
  });
});

// ─── Traceability Feature ──────────────────────────────────────────────

describe('Feature: Traceability', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-feat-trace-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('add mapping → query bidirectionally → persist', () => {
    let data: TraceabilityData = {};

    // Add file and test mappings
    data = addFileMapping(data, 'SPEC-001', 'rate-limit', 'src/middleware/rate-limit.ts:5-20');
    data = addTestMapping(data, 'SPEC-001', 'rate-limit', 'tests/rate-limit.test.ts:1-30');
    data = addFileMapping(data, 'SPEC-001', 'auth', 'src/auth.ts:10-50');

    // Query: file → requirements
    const reqsForRateLimit = findRequirementsForFile(data, 'src/middleware/rate-limit.ts');
    expect(reqsForRateLimit).toHaveLength(1);
    expect(reqsForRateLimit[0].specId).toBe('SPEC-001');
    expect(reqsForRateLimit[0].requirementKey).toBe('rate-limit');

    // Query: requirement → code
    const codeForRateLimit = findCodeForRequirement(data, 'SPEC-001', 'rate-limit');
    expect(codeForRateLimit.files).toEqual(['src/middleware/rate-limit.ts:5-20']);
    expect(codeForRateLimit.tests).toEqual(['tests/rate-limit.test.ts:1-30']);

    // Persist and reload
    saveTraceability(tmpDir, data);
    const reloaded = loadTraceability(tmpDir);

    const reqsAfterReload = findRequirementsForFile(reloaded, 'src/auth.ts');
    expect(reqsAfterReload).toHaveLength(1);
    expect(reqsAfterReload[0].requirementKey).toBe('auth');
  });
});

// ─── Session Feature ───────────────────────────────────────────────────

describe('Feature: Session scope', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-feat-session-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('declare scope → add files → check in/out of scope', () => {
    // Create session
    let session = createSession(
      'Implement authentication',
      'minspec',
      'feat',
      ['SPEC-001'],
      ['src/auth'],
    );

    // Save and reload
    saveSession(tmpDir, session);
    const loaded = loadSession(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.scope).toBe('Implement authentication');
    expect(loaded!.specIds).toEqual(['SPEC-001']);

    // Check scope — file in allowed directory
    expect(isFileInScope(loaded!, path.join(tmpDir, 'src', 'auth', 'login.ts'), tmpDir)).toBe(true);

    // Check scope — file outside allowed directory
    expect(isFileInScope(loaded!, path.join(tmpDir, 'src', 'billing', 'invoice.ts'), tmpDir)).toBe(false);

    // Expand scope
    session = addToScope(loaded!, path.join(tmpDir, 'src', 'billing'), tmpDir);
    saveSession(tmpDir, session);

    const expanded = loadSession(tmpDir);
    expect(isFileInScope(expanded!, path.join(tmpDir, 'src', 'billing', 'invoice.ts'), tmpDir)).toBe(true);
  });

  it('empty allowlist means everything is in scope', () => {
    const session = createSession('Explore codebase', 'minspec', 'explore');
    expect(session.fileAllowlist).toEqual([]);

    // Any file should be in scope
    expect(isFileInScope(session, '/any/path/anywhere.ts', tmpDir)).toBe(true);
  });
});
