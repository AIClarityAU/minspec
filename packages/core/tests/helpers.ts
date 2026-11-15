// Shared by the SPEC-136 core tests: build the bundle once, run it as a child process.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildCore } from '../build.mjs';

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  json: Record<string, any>;
}

export async function buildBundle(dir: string): Promise<string> {
  const outfile = join(dir, 'minspec-core.cjs');
  await buildCore({ outfile });
  return outfile;
}

export function runCore(bundle: string, args: string[], cwd?: string): Run {
  const r = spawnSync(process.execPath, [bundle, ...args], { cwd, encoding: 'utf8' });
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* non-JSON output (--list, --version) */
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}
