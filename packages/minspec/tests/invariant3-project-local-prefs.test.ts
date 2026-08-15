/**
 * T0 invariant tests for constitution invariant 3 (DR-074) as applied by DR-078:
 * MinSpec itself may only ever write the PROJECT-LOCAL preference store, never a
 * machine-wide surface.
 *
 * These are written BEFORE the implementation (CDD pre-coding checklist) and are
 * the highest-priority tests in this change: the source-scan below is the gate
 * that makes a future `ConfigurationTarget.Global` write un-committable, and the
 * read-order tests pin DR-078 §4 including the falsy-value trap that a naive
 * `??`/`||` resolution gets wrong.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  loadPreferences,
  savePreferences,
  preferencesPath,
  resolveProjectPreference,
} from '../src/lib/preferences';

const SRC_DIR = path.resolve(__dirname, '../src');

/** Every .ts file under packages/minspec/src, recursively. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, acc);
    else if (entry.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

describe('INVARIANT 3 — MinSpec never writes machine-wide config', () => {
  /**
   * The gate. DR-078 §3: "What this DR governs is what MinSpec itself may write,
   * which is only ever the project-local store." A user setting the VS Code
   * setting by hand is untouched by that rule — but the extension calling
   * `.update(..., ConfigurationTarget.Global)` is exactly the forbidden act.
   *
   * Asserted as a source scan rather than a behavioural test because the
   * invariant is a property of ALL call sites, present and future — a
   * behavioural test only ever covers the two that exist today (#1319 was
   * precisely two shipped instances nobody had a test for).
   */
  it('T0: no ConfigurationTarget.Global write exists anywhere in src/', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const text = fs.readFileSync(file, 'utf-8');
      text.split('\n').forEach((line, i) => {
        // Ignore prose: only a real member expression counts, not a mention in
        // a comment explaining why we do not use it.
        const stripped = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        if (/ConfigurationTarget\s*\.\s*Global/.test(stripped)) {
          offenders.push(`${path.relative(SRC_DIR, file)}:${i + 1}`);
        }
      });
    }
    expect(
      offenders,
      `ConfigurationTarget.Global is forbidden (constitution invariant 3 / DR-078 §3).\n` +
        `Persist to .minspec/preferences.json via savePreferences() instead.\n` +
        `Offending sites:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  /** The scan must be able to fail — a gate that cannot fire is not a gate. */
  it('T0 meta: the scan actually detects the forbidden pattern', () => {
    const sample = `await cfg.update('x', true, vscode.ConfigurationTarget.Global);`;
    expect(/ConfigurationTarget\s*\.\s*Global/.test(sample)).toBe(true);
  });
});

describe('DR-078 §4 — read order: project-local first, then the VS Code setting', () => {
  it('T0: an explicit project preference wins over the setting', () => {
    expect(resolveProjectPreference(true, false)).toBe(true);
  });

  /**
   * The trap. `projectValue || settingValue` and `projectValue ?? settingValue`
   * differ here, and `||` is WRONG: a deliberate project-local `false` must
   * override a global `true`, or opting OUT in one project is impossible.
   */
  it('T0: a project preference of FALSE still wins over a setting of true', () => {
    expect(resolveProjectPreference(false, true)).toBe(false);
  });

  it('T0: absent project preference falls back to the setting (back-compat)', () => {
    expect(resolveProjectPreference(undefined, true)).toBe(true);
    expect(resolveProjectPreference(undefined, false)).toBe(false);
  });
});

describe('the project-local store carries the two migrated preferences', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-inv3-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('T0: advancePhaseOnApprove round-trips through .minspec/preferences.json', () => {
    savePreferences(tmp, { advancePhaseOnApprove: true });
    expect(loadPreferences(tmp).advancePhaseOnApprove).toBe(true);
    expect(fs.existsSync(preferencesPath(tmp))).toBe(true);
  });

  it('T0: autoBackfillUseAi round-trips through .minspec/preferences.json', () => {
    savePreferences(tmp, { autoBackfillUseAi: true });
    expect(loadPreferences(tmp).autoBackfillUseAi).toBe(true);
  });

  /**
   * DR-078 §2: the offer's memory and the consent it grants share one store, so
   * writing one must never clobber the other.
   */
  it('T0: writing a new preference preserves existing answeredSignatures', () => {
    savePreferences(tmp, { answeredSignatures: { skipClassifyPrompt: 'sig-A' } });
    savePreferences(tmp, { advancePhaseOnApprove: true });
    const prefs = loadPreferences(tmp);
    expect(prefs.answeredSignatures?.skipClassifyPrompt).toBe('sig-A');
    expect(prefs.advancePhaseOnApprove).toBe(true);
  });

  it('T0: the store stays inside .minspec/, never a machine-wide path', () => {
    const p = preferencesPath(tmp);
    expect(p.startsWith(tmp)).toBe(true);
    expect(p).toContain(path.join('.minspec', 'preferences.json'));
  });
});
