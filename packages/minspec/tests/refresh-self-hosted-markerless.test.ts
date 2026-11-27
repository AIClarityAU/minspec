/**
 * #1166 — Refresh Harness Files must not marker-wrap minspec's own self-hosted
 * (deliberately markerless) template-source files, while adopters keep the heal.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { generateHarnessFiles, refreshHarnessFiles } from '../src/lib/scaffold';
import {
  MANAGED_REGION_TEMPLATES,
  SELF_HOSTED_TEMPLATE_NAMES,
  managedRegionStartMarker,
  managedRegionEndMarker,
} from '../src/lib/template-registry';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-1166-'));
  fs.mkdirSync(path.join(tmp, '.minspec'), { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const tpl = MANAGED_REGION_TEMPLATES.find((t) => t.name === 'ai-review-guard-test')!;

function stripMarkers(): string {
  const full = path.join(tmp, tpl.outputPath);
  const s = managedRegionStartMarker(tpl.name, tpl.commentStyle);
  const e = managedRegionEndMarker(tpl.name, tpl.commentStyle);
  const stripped = fs
    .readFileSync(full, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== s && l.trim() !== e)
    .join('\n');
  fs.writeFileSync(full, stripped);
  return stripped;
}

describe('refreshHarnessFiles self-hosted exemption (#1166)', () => {
  it('names the template as self-hosted (precondition)', () => {
    expect(SELF_HOSTED_TEMPLATE_NAMES).toContain(tpl.name);
  });

  it('leaves a markerless self-hosted file byte-identical in minspec’s own repo', () => {
    generateHarnessFiles(tmp);
    const registry = path.join(tmp, 'packages/minspec/src/lib/template-registry.ts');
    fs.mkdirSync(path.dirname(registry), { recursive: true });
    fs.writeFileSync(registry, '// stand-in\n');
    const before = stripMarkers();
    const warnings = refreshHarnessFiles(tmp);
    expect(fs.readFileSync(path.join(tmp, tpl.outputPath), 'utf-8')).toBe(before);
    expect(warnings.filter((w) => w.outputPath === tpl.outputPath)).toEqual([]);
  });

  it('still heals the same markerless file in an adopter repo', () => {
    generateHarnessFiles(tmp);
    const before = stripMarkers();
    refreshHarnessFiles(tmp);
    const after = fs.readFileSync(path.join(tmp, tpl.outputPath), 'utf-8');
    expect(after).not.toBe(before);
    expect(after).toContain(managedRegionStartMarker(tpl.name, tpl.commentStyle));
  });
});
