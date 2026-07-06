import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadConfig,
  DEFAULT_CONFIG,
  DEFAULT_COVERAGE_MINIMUM,
  setCoverageMinimum,
  type MinspecConfig,
} from '../src/lib/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('loadConfig()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', () => {
    const config = loadConfig(tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('returns defaults when config.json is invalid JSON', () => {
    const dir = path.join(tmpDir, '.minspec');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), 'not json!!');
    const config = loadConfig(tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('merges user overrides with defaults', () => {
    const dir = path.join(tmpDir, '.minspec');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ version: '1', specsDir: 'my-specs' }),
    );
    const config = loadConfig(tmpDir);
    expect(config.specsDir).toBe('my-specs');
    // Non-overridden values use defaults
    expect(config.decisionsDir).toBe('docs/decisions');
    expect(config.phaseMappings).toEqual(DEFAULT_CONFIG.phaseMappings);
  });

  it('carries no scoring-threshold config (DR-021: dead t1Max/t2Max/t3Max removed)', () => {
    // The classifier ranks by tierContribution ("highest wins"), never sums a
    // score against a threshold. The old thresholds field was never read; DR-021
    // removed it. Guard against it creeping back into the config shape.
    expect((DEFAULT_CONFIG as Record<string, unknown>).thresholds).toBeUndefined();
  });

  it('deep merges phaseMappings partially', () => {
    const dir = path.join(tmpDir, '.minspec');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({
        phaseMappings: {
          T1: { requiredPhases: ['specify', 'plan'], optionalPhases: [] },
        },
      }),
    );
    const config = loadConfig(tmpDir);
    // T1 overridden
    expect(config.phaseMappings.T1.requiredPhases).toEqual(['specify', 'plan']);
    // T2-T4 still default
    expect(config.phaseMappings.T2).toEqual(DEFAULT_CONFIG.phaseMappings.T2);
  });

  it('default config has correct FR-2 phase mappings', () => {
    // T1: specify only
    expect(DEFAULT_CONFIG.phaseMappings.T1.requiredPhases).toEqual(['specify']);
    // T4: all phases required
    expect(DEFAULT_CONFIG.phaseMappings.T4.requiredPhases).toHaveLength(5);
    expect(DEFAULT_CONFIG.phaseMappings.T4.optionalPhases).toHaveLength(0);
  });

  it('defaults coverage.minimumPercentage to 80', () => {
    expect(DEFAULT_CONFIG.coverage.minimumPercentage).toBe(80);
    expect(DEFAULT_COVERAGE_MINIMUM).toBe(80);
  });

  it('merges a partial coverage override onto the default', () => {
    const dir = path.join(tmpDir, '.minspec');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ coverage: { minimumPercentage: 90 } }),
    );
    const config = loadConfig(tmpDir);
    expect(config.coverage.minimumPercentage).toBe(90);
    // Everything else still default
    expect(config.specsDir).toBe(DEFAULT_CONFIG.specsDir);
  });
});

describe('setCoverageMinimum()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes coverage.minimumPercentage into a fresh config.json', () => {
    fs.mkdirSync(path.join(tmpDir, '.minspec'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.minspec', 'config.json'),
      JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n',
    );

    setCoverageMinimum(tmpDir, 90);

    expect(loadConfig(tmpDir).coverage.minimumPercentage).toBe(90);
  });

  it('preserves every other field already in config.json', () => {
    const dir = path.join(tmpDir, '.minspec');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ ...DEFAULT_CONFIG, specsDir: 'my-specs' }, null, 2) + '\n',
    );

    setCoverageMinimum(tmpDir, 70);

    const config = loadConfig(tmpDir);
    expect(config.coverage.minimumPercentage).toBe(70);
    expect(config.specsDir).toBe('my-specs');
  });
});
