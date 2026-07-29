/**
 * #1038 — the reaper-strip pretest guard, as `npm run pretest` actually runs it.
 *
 * A host-side core-dump reaper (outside the container, outside this repo) has
 * twice deleted every `core.*` file under `node_modules`, including package
 * internals like `node_modules/obug/dist/core.js`. The symptom looks like a
 * dependency bug (`ERR_MODULE_NOT_FOUND` naming an unrelated package) and costs
 * a fresh diagnosis every time. `scripts/check-node-modules-integrity.mjs` is
 * the recognition guard: it runs first in `pretest` and turns that cryptic
 * crash into `run npm ci`.
 *
 * Each case here builds a throwaway `node_modules`-shaped tree and spawns the
 * real script with `cwd` pointed at it — proving what a developer actually
 * sees, not just the pure `checkNodeModulesIntegrity()` verdict.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { SENTINELS } from '../../../scripts/check-node-modules-integrity.mjs';

const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'check-node-modules-integrity.mjs');

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-nm-integrity-cli-'));
  tempRoots.push(root);
  return root;
}

/** Materialise `<root>/node_modules/<rel>` for every sentinel, all present. */
function intactNodeModules(): string {
  const root = tempRoot();
  for (const rel of SENTINELS) {
    const abs = path.join(root, 'node_modules', ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '// sentinel\n', 'utf-8');
  }
  return root;
}

interface GateResult {
  status: number | null;
  output: string;
}

function runGate(cwd: string): GateResult {
  const result = spawnSync('node', [SCRIPT], { cwd, encoding: 'utf-8' });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

describe('scripts/check-node-modules-integrity.mjs — the pretest gate (#1038)', () => {
  it('exits 0 on an intact tree, naming how many sentinels it checked', () => {
    const { status, output } = runGate(intactNodeModules());

    expect(status).toBe(0);
    expect(output).toContain(
      `node_modules integrity check passed — ${SENTINELS.length} core.* sentinel(s) present.`,
    );
  });

  it('exits 1 and names the reaper when a single sentinel is stripped, siblings intact', () => {
    const root = intactNodeModules();
    // The reaper's actual signature: only the core.* file is gone, everything
    // else in the package survives untouched.
    fs.rmSync(path.join(root, 'node_modules', 'obug', 'dist', 'core.js'));
    fs.writeFileSync(
      path.join(root, 'node_modules', 'obug', 'dist', 'node.js'),
      '// sibling survives\n',
      'utf-8',
    );

    const { status, output } = runGate(root);

    expect(status).toBe(1);
    expect(output).toContain(
      'FAIL node_modules has been stripped of core.* files (host core-dump reaper) — run `npm ci`.',
    );
    expect(output).toContain('missing: node_modules/obug/dist/core.js');
    expect(output).not.toContain('integrity check passed');
  });

  it('exits 1 and lists every stripped sentinel when the reaper hits several packages', () => {
    const root = intactNodeModules();
    fs.rmSync(path.join(root, 'node_modules', 'obug', 'dist', 'core.js'));
    fs.rmSync(path.join(root, 'node_modules', 'lodash', 'core.js'));

    const { status, output } = runGate(root);

    expect(status).toBe(1);
    expect(output).toContain('missing: node_modules/obug/dist/core.js');
    expect(output).toContain('missing: node_modules/lodash/core.js');
  });

  it('exits 1 with a plain "run npm ci" — not a reaper claim — when node_modules is simply absent', () => {
    // A fresh checkout that never ran `npm ci` is a different mechanism than
    // reaper damage; the message must not misdiagnose one as the other (RCDD).
    const { status, output } = runGate(tempRoot());

    expect(status).toBe(1);
    expect(output).toContain('FAIL node_modules not found — run `npm ci`.');
    expect(output).not.toContain('reaper');
  });
});
