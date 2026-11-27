/**
 * T3 regression (#3676): the "tool absent" PATH must hide only the tool.
 *
 * On a GitHub ubuntu runner shellcheck is preinstalled in /usr/bin (and /bin is a
 * symlink to it), so a helper that drops every PATH directory holding the tool
 * also dropped sh, git and node. The hook then could not even be spawned, and the
 * "shellcheck absent" cases failed with exit -1 / null in CI while passing on a
 * machine without shellcheck. This reproduces that layout: the tool sits in the
 * same directory as sh and git.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { pathWithoutTools, resolvableOn } from './helpers/path-without-tool';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-path-without-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function which(cmd: string): string {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} not on PATH`);
  return r.stdout.trim();
}

/** A single-directory PATH holding sh, git and a fake `tool`, like /usr/bin on CI. */
function sharedBin(tool: string): string {
  const bin = fs.mkdtempSync(path.join(scratch, 'bin-'));
  for (const cmd of ['sh', 'git']) fs.symlinkSync(which(cmd), path.join(bin, cmd));
  fs.writeFileSync(path.join(bin, tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return bin;
}

describe('pathWithoutTools hides only the tool (#3676)', () => {
  it('keeps sh and git resolvable when the tool shares their directory', () => {
    const bin = sharedBin('shellcheck');
    expect(resolvableOn('shellcheck', bin)).toBe(true); // control: the tool really is there
    const p = pathWithoutTools(['shellcheck'], bin, scratch);
    expect(resolvableOn('shellcheck', p)).toBe(false);
    expect(resolvableOn('sh', p)).toBe(true);
    expect(resolvableOn('git', p)).toBe(true);
  });

  it('hides several tools at once and the kept commands still run', () => {
    const bin = sharedBin('shellcheck');
    fs.writeFileSync(path.join(bin, 'actionlint'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const p = pathWithoutTools(['shellcheck', 'actionlint'], bin, scratch);
    expect(resolvableOn('shellcheck', p)).toBe(false);
    expect(resolvableOn('actionlint', p)).toBe(false);
    const r = spawnSync('git', ['--version'], { encoding: 'utf8', env: { ...process.env, PATH: p } });
    expect(r.status).toBe(0);
  });

  it('leaves a PATH that never held the tool unchanged', () => {
    const bin = fs.mkdtempSync(path.join(scratch, 'bin-'));
    fs.symlinkSync(which('sh'), path.join(bin, 'sh'));
    expect(pathWithoutTools(['shellcheck'], bin, scratch)).toBe(bin);
  });
});
