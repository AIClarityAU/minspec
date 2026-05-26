import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  classify,
  overrideClassification,
  loadCalibration,
  saveCalibration,
  recordOverride,
  applyCalibration,
  type ClassificationSignal,
  type CalibrationData,
} from '../src/lib/classifier';
import { DEFAULT_CONFIG, type MinspecConfig } from '../src/lib/config';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a signal with sensible defaults */
function makeSignal(
  overrides: Partial<ClassificationSignal> & { name: string; tierContribution: ClassificationSignal['tierContribution'] },
): ClassificationSignal {
  return {
    value: 1,
    weight: 1,
    ...overrides,
  };
}

// ─── T0 Tests: Core Classification Invariants ────────────────────────────────

describe('classify() — T0 invariant tests', () => {
  it('returns T1 with 0 confidence when given no signals', () => {
    const result = classify([], DEFAULT_CONFIG);
    expect(result.tier).toBe('T1');
    expect(result.confidence).toBe(0);
    expect(result.signals).toEqual([]);
    expect(result.suggestedPhases).toContain('specify');
  });

  it('classifies all-T1 signals as T1', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'files_changed', tierContribution: 'T1' }),
      makeSignal({ name: 'lines_changed', tierContribution: 'T1' }),
    ];
    const result = classify(signals, DEFAULT_CONFIG);
    expect(result.tier).toBe('T1');
    expect(result.confidence).toBe(1); // all signals at winning tier
  });

  it('classifies all-T3 signals as T3', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'schema_change', tierContribution: 'T3' }),
      makeSignal({ name: 'cross_directory', tierContribution: 'T3' }),
      makeSignal({ name: 'new_exports', tierContribution: 'T3' }),
    ];
    const result = classify(signals, DEFAULT_CONFIG);
    expect(result.tier).toBe('T3');
    expect(result.confidence).toBe(1);
  });

  it('highest-tier signal wins in mixed set', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'files_changed', tierContribution: 'T1' }),
      makeSignal({ name: 'lines_changed', tierContribution: 'T1' }),
      makeSignal({ name: 'schema_change', tierContribution: 'T3' }),
    ];
    const result = classify(signals, DEFAULT_CONFIG);
    expect(result.tier).toBe('T3');
    // Only 1 of 3 signals is T3
    expect(result.confidence).toBeCloseTo(1 / 3, 5);
  });

  it('single T4 signal among many T1 signals → T4', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'files_changed', tierContribution: 'T1' }),
      makeSignal({ name: 'lines_changed', tierContribution: 'T1' }),
      makeSignal({ name: 'file_types', tierContribution: 'T1' }),
      makeSignal({ name: 'removed_exports', tierContribution: 'T4' }),
    ];
    const result = classify(signals, DEFAULT_CONFIG);
    expect(result.tier).toBe('T4');
    expect(result.confidence).toBe(0.25);
  });

  it('user override always wins (invariant #5)', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'schema_change', tierContribution: 'T3' }),
    ];
    const original = classify(signals, DEFAULT_CONFIG);
    expect(original.tier).toBe('T3');

    const overridden = overrideClassification(original, 'T1', DEFAULT_CONFIG);
    expect(overridden.tier).toBe('T1');
    expect(overridden.overriddenBy).toBe('user');
    expect(overridden.signals).toEqual(original.signals);
  });

  it('phase selection matches config phaseMappings for each tier', () => {
    for (const tier of ['T1', 'T2', 'T3', 'T4'] as const) {
      const signals: ClassificationSignal[] = [
        makeSignal({ name: 'test_signal', tierContribution: tier }),
      ];
      const result = classify(signals, DEFAULT_CONFIG);
      const mapping = DEFAULT_CONFIG.phaseMappings[tier];
      const expectedPhases = [...mapping.requiredPhases, ...mapping.optionalPhases];
      expect(result.suggestedPhases).toEqual(expectedPhases);
    }
  });
});

// ─── T2 Tests: Feature Behavior ──────────────────────────────────────────────

describe('classify() — T2 feature tests', () => {
  it('confidence = 1 when all signals agree on tier', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'a', tierContribution: 'T2' }),
      makeSignal({ name: 'b', tierContribution: 'T2' }),
      makeSignal({ name: 'c', tierContribution: 'T2' }),
    ];
    const result = classify(signals, DEFAULT_CONFIG);
    expect(result.confidence).toBe(1);
  });

  it('confidence < 0.5 when minority signal dictates tier', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'a', tierContribution: 'T1' }),
      makeSignal({ name: 'b', tierContribution: 'T1' }),
      makeSignal({ name: 'c', tierContribution: 'T1' }),
      makeSignal({ name: 'd', tierContribution: 'T3' }),
    ];
    const result = classify(signals, DEFAULT_CONFIG);
    expect(result.tier).toBe('T3');
    expect(result.confidence).toBe(0.25);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('returns a copy of signals, not the original array', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'a', tierContribution: 'T1' }),
    ];
    const result = classify(signals, DEFAULT_CONFIG);
    expect(result.signals).toEqual(signals);
    expect(result.signals).not.toBe(signals);
  });

  it('works with boolean signal values', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'dependency_change', tierContribution: 'T2', value: true }),
      makeSignal({ name: 'new_files', tierContribution: 'T1', value: false }),
    ];
    const result = classify(signals, DEFAULT_CONFIG);
    expect(result.tier).toBe('T2');
  });

  it('respects custom config phaseMappings', () => {
    const customConfig: MinspecConfig = {
      ...DEFAULT_CONFIG,
      phaseMappings: {
        ...DEFAULT_CONFIG.phaseMappings,
        T1: { requiredPhases: ['specify', 'plan'], optionalPhases: ['clarify'] },
      },
    };
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'a', tierContribution: 'T1' }),
    ];
    const result = classify(signals, customConfig);
    expect(result.suggestedPhases).toEqual(['specify', 'plan', 'clarify']);
  });
});

describe('overrideClassification()', () => {
  it('preserves confidence from original result', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'a', tierContribution: 'T1' }),
      makeSignal({ name: 'b', tierContribution: 'T3' }),
    ];
    const original = classify(signals, DEFAULT_CONFIG);
    const overridden = overrideClassification(original, 'T2', DEFAULT_CONFIG);
    expect(overridden.confidence).toBe(original.confidence);
  });

  it('updates suggestedPhases to match new tier', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'a', tierContribution: 'T1' }),
    ];
    const original = classify(signals, DEFAULT_CONFIG);
    expect(original.suggestedPhases).toEqual(['specify']);

    const overridden = overrideClassification(original, 'T4', DEFAULT_CONFIG);
    const t4Mapping = DEFAULT_CONFIG.phaseMappings.T4;
    expect(overridden.suggestedPhases).toEqual([
      ...t4Mapping.requiredPhases,
      ...t4Mapping.optionalPhases,
    ]);
  });

  it('can override to same tier (no-op on tier, still marks overriddenBy)', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'a', tierContribution: 'T2' }),
    ];
    const original = classify(signals, DEFAULT_CONFIG);
    const overridden = overrideClassification(original, 'T2', DEFAULT_CONFIG);
    expect(overridden.tier).toBe('T2');
    expect(overridden.overriddenBy).toBe('user');
  });
});

// ─── Calibration Persistence Tests ───────────────────────────────────────────

describe('Calibration persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-classifier-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadCalibration()', () => {
    it('returns empty calibration when no file exists', () => {
      const data = loadCalibration(tmpDir);
      expect(data.overrides).toEqual([]);
      expect(data.weightAdjustments).toEqual({});
    });

    it('returns empty calibration when file is invalid JSON', () => {
      const dir = path.join(tmpDir, '.minspec');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'calibration.json'), 'not json!!');
      const data = loadCalibration(tmpDir);
      expect(data.overrides).toEqual([]);
      expect(data.weightAdjustments).toEqual({});
    });

    it('returns empty calibration when file has wrong shape', () => {
      const dir = path.join(tmpDir, '.minspec');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'calibration.json'),
        JSON.stringify({ overrides: 'not an array', weightAdjustments: 42 }),
      );
      const data = loadCalibration(tmpDir);
      expect(data.overrides).toEqual([]);
      expect(data.weightAdjustments).toEqual({});
    });

    it('loads valid calibration data', () => {
      const dir = path.join(tmpDir, '.minspec');
      fs.mkdirSync(dir, { recursive: true });
      const calibration: CalibrationData = {
        overrides: [
          {
            timestamp: '2026-01-01T00:00:00Z',
            originalTier: 'T3',
            overriddenTier: 'T1',
            signals: ['files_changed'],
          },
        ],
        weightAdjustments: { files_changed: 0.7 },
      };
      fs.writeFileSync(
        path.join(dir, 'calibration.json'),
        JSON.stringify(calibration),
      );
      const data = loadCalibration(tmpDir);
      expect(data.overrides).toHaveLength(1);
      expect(data.overrides[0].originalTier).toBe('T3');
      expect(data.weightAdjustments.files_changed).toBe(0.7);
    });
  });

  describe('saveCalibration()', () => {
    it('creates .minspec directory if missing', () => {
      const data: CalibrationData = { overrides: [], weightAdjustments: {} };
      saveCalibration(tmpDir, data);
      expect(fs.existsSync(path.join(tmpDir, '.minspec', 'calibration.json'))).toBe(true);
    });

    it('writes valid JSON', () => {
      const data: CalibrationData = {
        overrides: [
          {
            timestamp: '2026-01-01T00:00:00Z',
            originalTier: 'T2',
            overriddenTier: 'T3',
            signals: ['schema_change'],
          },
        ],
        weightAdjustments: { schema_change: 1.2 },
      };
      saveCalibration(tmpDir, data);
      const raw = fs.readFileSync(
        path.join(tmpDir, '.minspec', 'calibration.json'),
        'utf-8',
      );
      const parsed = JSON.parse(raw);
      expect(parsed.overrides).toHaveLength(1);
      expect(parsed.weightAdjustments.schema_change).toBe(1.2);
    });
  });

  describe('recordOverride()', () => {
    it('appends override to calibration', () => {
      const data = recordOverride(tmpDir, 'T3', 'T1', ['files_changed', 'lines_changed']);
      expect(data.overrides).toHaveLength(1);
      expect(data.overrides[0].originalTier).toBe('T3');
      expect(data.overrides[0].overriddenTier).toBe('T1');
      expect(data.overrides[0].signals).toEqual(['files_changed', 'lines_changed']);
      expect(data.overrides[0].timestamp).toBeTruthy();
    });

    it('accumulates overrides across calls', () => {
      recordOverride(tmpDir, 'T3', 'T1', ['a']);
      recordOverride(tmpDir, 'T2', 'T1', ['b']);
      const data = recordOverride(tmpDir, 'T4', 'T2', ['c']);
      expect(data.overrides).toHaveLength(3);
    });

    it('does not adjust weights before threshold (20 overrides)', () => {
      for (let i = 0; i < 19; i++) {
        recordOverride(tmpDir, 'T3', 'T1', ['signal_a']);
      }
      const data = loadCalibration(tmpDir);
      expect(Object.keys(data.weightAdjustments)).toHaveLength(0);
    });

    it('adjusts weights after reaching threshold (20 overrides)', () => {
      // Record 20 overrides where user consistently downgrades T3 → T1
      for (let i = 0; i < 20; i++) {
        recordOverride(tmpDir, 'T3', 'T1', ['overestimated_signal']);
      }
      const data = loadCalibration(tmpDir);
      // Signal should have reduced weight (multiplier < 1) because user always downgraded
      expect(data.weightAdjustments.overestimated_signal).toBeDefined();
      expect(data.weightAdjustments.overestimated_signal).toBeLessThan(1);
    });

    it('increases weight for signals when user consistently upgrades', () => {
      for (let i = 0; i < 20; i++) {
        recordOverride(tmpDir, 'T1', 'T3', ['underestimated_signal']);
      }
      const data = loadCalibration(tmpDir);
      expect(data.weightAdjustments.underestimated_signal).toBeGreaterThan(1);
    });

    it('weight adjustments are clamped to [0.1, 3.0]', () => {
      // Extreme downgrade: T4 → T1 repeatedly (direction = -3 each time)
      for (let i = 0; i < 30; i++) {
        recordOverride(tmpDir, 'T4', 'T1', ['extreme_signal']);
      }
      const data = loadCalibration(tmpDir);
      expect(data.weightAdjustments.extreme_signal).toBeGreaterThanOrEqual(0.1);
      expect(data.weightAdjustments.extreme_signal).toBeLessThanOrEqual(3.0);
    });
  });
});

// ─── Calibration Application Tests ───────────────────────────────────────────

describe('applyCalibration()', () => {
  it('returns signals unchanged when no adjustments exist', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'a', tierContribution: 'T1', weight: 1 }),
    ];
    const calibration: CalibrationData = { overrides: [], weightAdjustments: {} };
    const adjusted = applyCalibration(signals, calibration);
    expect(adjusted).toEqual(signals);
  });

  it('multiplies weight by adjustment factor', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'a', tierContribution: 'T2', weight: 0.8 }),
      makeSignal({ name: 'b', tierContribution: 'T1', weight: 1.0 }),
    ];
    const calibration: CalibrationData = {
      overrides: [],
      weightAdjustments: { a: 0.5 }, // halve weight of signal 'a'
    };
    const adjusted = applyCalibration(signals, calibration);
    expect(adjusted[0].weight).toBeCloseTo(0.4, 5);
    expect(adjusted[1].weight).toBe(1.0); // 'b' unchanged
  });

  it('does not mutate original signals', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'a', tierContribution: 'T2', weight: 1 }),
    ];
    const calibration: CalibrationData = {
      overrides: [],
      weightAdjustments: { a: 2.0 },
    };
    applyCalibration(signals, calibration);
    expect(signals[0].weight).toBe(1); // unchanged
  });
});

// ─── Integration: Classify + Calibration ─────────────────────────────────────

describe('Integration: classify with calibration', () => {
  it('calibration-adjusted signals still classify correctly', () => {
    const signals: ClassificationSignal[] = [
      makeSignal({ name: 'a', tierContribution: 'T1', weight: 1 }),
      makeSignal({ name: 'b', tierContribution: 'T3', weight: 1 }),
    ];
    const calibration: CalibrationData = {
      overrides: [],
      weightAdjustments: { b: 0.5 }, // reduce b's weight, but tier algorithm is "highest wins"
    };

    // Even with reduced weight, T3 still wins because algorithm is "highest tier wins"
    const adjusted = applyCalibration(signals, calibration);
    const result = classify(adjusted, DEFAULT_CONFIG);
    expect(result.tier).toBe('T3');
  });
});
