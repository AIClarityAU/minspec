import * as fs from 'fs';
import * as path from 'path';
import type { Tier, Phase, MinspecConfig } from './config';

// ─── Shared Types ────────────────────────────────────────────────────────────

/** A single signal produced by an analyzer (git-diff, AST, etc.) */
export interface ClassificationSignal {
  readonly name: string;
  readonly value: number | boolean;
  readonly weight: number;
  readonly tierContribution: Tier;
}

/** Result of classifying a set of signals into a tier */
export interface ClassificationResult {
  readonly tier: Tier;
  readonly confidence: number; // 0-1
  readonly signals: ClassificationSignal[];
  readonly suggestedPhases: Phase[];
  readonly overriddenBy?: 'user';
}

/** Persistent calibration data stored in .minspec/calibration.json */
export interface CalibrationData {
  overrides: CalibrationOverride[];
  weightAdjustments: Record<string, number>; // signal name → weight multiplier
}

/** A single user override event */
export interface CalibrationOverride {
  readonly timestamp: string;
  readonly originalTier: Tier;
  readonly overriddenTier: Tier;
  readonly signals: string[]; // signal names present at time of override
}

// ─── Tier Utilities ──────────────────────────────────────────────────────────

const TIER_INDEX: Record<Tier, number> = { T1: 0, T2: 1, T3: 2, T4: 3 };

/** Compare two tiers. Returns positive if a > b, negative if a < b, 0 if equal. */
function compareTiers(a: Tier, b: Tier): number {
  return TIER_INDEX[a] - TIER_INDEX[b];
}

// ─── Core Classification ─────────────────────────────────────────────────────

/**
 * Classify a set of signals into a tier.
 *
 * Algorithm (from design.md):
 * 1. Find the HIGHEST tier among all signals (max tierContribution).
 * 2. Confidence = count of signals at winning tier / total signals.
 * 3. Look up suggestedPhases from config.phaseMappings.
 *
 * Pure function — no side effects.
 */
export function classify(
  signals: ClassificationSignal[],
  config: MinspecConfig,
): ClassificationResult {
  // Edge case: no signals → T1 with zero confidence
  if (signals.length === 0) {
    const mapping = config.phaseMappings.T1;
    return {
      tier: 'T1',
      confidence: 0,
      signals: [],
      suggestedPhases: [...mapping.requiredPhases, ...mapping.optionalPhases],
    };
  }

  // Find winning tier — highest tierContribution across all signals
  let winningTier: Tier = 'T1';
  for (const signal of signals) {
    if (compareTiers(signal.tierContribution, winningTier) > 0) {
      winningTier = signal.tierContribution;
    }
  }

  // Confidence = signals at winning tier / total signals
  const atWinningTier = signals.filter(
    (s) => s.tierContribution === winningTier,
  ).length;
  const confidence = atWinningTier / signals.length;

  // Phase selection from config
  const mapping = config.phaseMappings[winningTier];
  const suggestedPhases: Phase[] = [
    ...mapping.requiredPhases,
    ...mapping.optionalPhases,
  ];

  return {
    tier: winningTier,
    confidence,
    signals: [...signals],
    suggestedPhases,
  };
}

// ─── User Override ───────────────────────────────────────────────────────────

/**
 * Apply a user override to an existing classification result.
 *
 * Returns a new ClassificationResult with the overridden tier,
 * updated suggestedPhases, and `overriddenBy: 'user'`.
 * Confidence is preserved from the original classification.
 */
export function overrideClassification(
  result: ClassificationResult,
  newTier: Tier,
  config: MinspecConfig,
): ClassificationResult {
  const mapping = config.phaseMappings[newTier];
  const suggestedPhases: Phase[] = [
    ...mapping.requiredPhases,
    ...mapping.optionalPhases,
  ];

  return {
    tier: newTier,
    confidence: result.confidence,
    signals: result.signals,
    suggestedPhases,
    overriddenBy: 'user',
  };
}

// ─── Calibration Persistence ─────────────────────────────────────────────────

const CALIBRATION_FILE = 'calibration.json';
const CALIBRATION_THRESHOLD = 20; // overrides before weight adjustment kicks in
const EMA_ALPHA = 0.3; // exponential moving average smoothing factor

/** Create an empty calibration data object */
function emptyCalibration(): CalibrationData {
  return { overrides: [], weightAdjustments: {} };
}

/**
 * Load calibration data from `.minspec/calibration.json`.
 * Returns empty calibration if file is missing or invalid.
 */
export function loadCalibration(rootDir: string): CalibrationData {
  const filePath = path.join(rootDir, '.minspec', CALIBRATION_FILE);
  if (!fs.existsSync(filePath)) {
    return emptyCalibration();
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as CalibrationData;
    // Basic shape validation
    if (!Array.isArray(parsed.overrides) || typeof parsed.weightAdjustments !== 'object') {
      return emptyCalibration();
    }
    return parsed;
  } catch {
    return emptyCalibration();
  }
}

/**
 * Save calibration data to `.minspec/calibration.json`.
 * Creates the `.minspec/` directory if it does not exist.
 */
export function saveCalibration(rootDir: string, data: CalibrationData): void {
  const dir = path.join(rootDir, '.minspec');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, CALIBRATION_FILE);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Record a user override and update calibration.
 *
 * After CALIBRATION_THRESHOLD overrides, recalculates weight adjustments
 * using an exponential moving average. Signals that frequently appear
 * when the user overrides to a LOWER tier get their weights reduced;
 * signals present when user overrides to a HIGHER tier get increased.
 */
export function recordOverride(
  rootDir: string,
  originalTier: Tier,
  overriddenTier: Tier,
  signalNames: string[],
): CalibrationData {
  const data = loadCalibration(rootDir);

  data.overrides.push({
    timestamp: new Date().toISOString(),
    originalTier,
    overriddenTier,
    signals: [...signalNames],
  });

  // Recalculate weight adjustments after threshold
  if (data.overrides.length >= CALIBRATION_THRESHOLD) {
    recalculateWeights(data);
  }

  saveCalibration(rootDir, data);
  return data;
}

/**
 * Recalculate weight adjustments from override history.
 *
 * For each signal that appears in overrides:
 * - If user consistently overrides DOWN (classifier over-estimated), reduce weight.
 * - If user consistently overrides UP (classifier under-estimated), increase weight.
 *
 * Uses EMA so recent overrides matter more than old ones.
 * Weight multiplier is clamped to [0.1, 3.0].
 */
function recalculateWeights(data: CalibrationData): void {
  // Track per-signal direction bias
  const signalBias: Record<string, number> = {};

  for (const override of data.overrides) {
    const direction = TIER_INDEX[override.overriddenTier] - TIER_INDEX[override.originalTier];
    // direction > 0 → user bumped UP, direction < 0 → user bumped DOWN

    for (const signalName of override.signals) {
      const prev = signalBias[signalName] ?? 0;
      // EMA: new = alpha * sample + (1 - alpha) * previous
      signalBias[signalName] = EMA_ALPHA * direction + (1 - EMA_ALPHA) * prev;
    }
  }

  // Convert bias to weight multiplier
  // Positive bias (user bumps UP) → increase weight (multiplier > 1)
  // Negative bias (user bumps DOWN) → decrease weight (multiplier < 1)
  for (const [signalName, bias] of Object.entries(signalBias)) {
    // Map bias [-3, 3] range to multiplier [0.1, 3.0]
    // bias 0 → multiplier 1.0 (no change)
    const multiplier = Math.max(0.1, Math.min(3.0, 1.0 + bias * 0.3));
    data.weightAdjustments[signalName] = Math.round(multiplier * 1000) / 1000;
  }
}

/**
 * Apply calibration weight adjustments to a set of signals.
 * Returns new signal array with adjusted weights. Does not mutate input.
 */
export function applyCalibration(
  signals: ClassificationSignal[],
  calibration: CalibrationData,
): ClassificationSignal[] {
  if (Object.keys(calibration.weightAdjustments).length === 0) {
    return signals;
  }
  return signals.map((signal) => {
    const multiplier = calibration.weightAdjustments[signal.name];
    if (multiplier === undefined) {
      return signal;
    }
    return { ...signal, weight: signal.weight * multiplier };
  });
}
