/**
 * RECURRENCE GATE (SPEC-268, #2982) - an adopter of the MinSpec extension needs ONE secret.
 *
 * The founder asked (2026-11-26): "The published MinSpec vsix still wants APP_ID and APP_KEY
 * secrets - can we prioritise their removal?" The cause was a gating set that grew without
 * anything saying how many credentials an adopter must hand-set. This file is that statement,
 * as an allowlist. It fails when:
 *
 *   1. any `secrets.<NAME>` in ANY scaffolded workflow is not declared in a reviewer-secret
 *      category (required, optional, or identity) or is GitHub's own GITHUB_TOKEN;
 *   2. REVIEWER_SECRETS (the set that decides whether the review runs, and so whether the
 *      Tier-A checks may be required - the #559 guard) holds anything beyond the allowlist;
 *   3. an identity secret (the MinSpec App) is used for anything but choosing the identity:
 *      it may only feed the guard step's env, the App-token mint, or a `!= ''` boolean;
 *   4. the SCAFFOLDED ai-review guard (the shipped copy, not this repo's file) skips when only
 *      the Claude secret is set. Executed, not grepped.
 *
 * Adding a required adopter secret is possible, but only by editing ADOPTER_REQUIRED_SECRETS
 * below, which a reviewer sees as a product decision rather than a side effect.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import { MANAGED_REGION_TEMPLATES } from '../src/lib/template-registry';
import { AI_REVIEW_WORKFLOW } from '../src/lib/ci-review-templates';
import {
  REVIEWER_SECRETS,
  REVIEWER_OPTIONAL_SECRETS,
  REVIEWER_IDENTITY_SECRETS,
} from '../src/lib/ruleset-advisor';

/** The ONLY secrets an adopter must set. Changing this is a product decision (#2982). */
const ADOPTER_REQUIRED_SECRETS = ['CLAUDE_CODE_OAUTH_TOKEN'] as const;
/** Provided by GitHub in every run; never set by an adopter. */
const PLATFORM_SECRETS = ['GITHUB_TOKEN'] as const;

const scaffoldedWorkflows = MANAGED_REGION_TEMPLATES.filter((t) => t.outputPath.startsWith('.github/workflows/'));

useShellTimeout();

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length) fs.rmSync(scratch.pop() as string, { recursive: true, force: true });
});

function secretsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))].sort();
}

/** The `run: |` body of the scaffolded guard step, dedented. */
function guardRun(yaml: string): string {
  const rows = yaml.split('\n');
  const at = rows.findIndex((l) => l.trim() === '- name: Check reviewer is configured (skip cleanly if not)');
  if (at < 0) throw new Error('scaffolded ai-review.yml has no reviewer guard step');
  const stepIndent = rows[at].length - rows[at].trimStart().length;
  let runAt = -1;
  for (let i = at + 1; i < rows.length; i++) {
    const ind = rows[i].length - rows[i].trimStart().length;
    if (rows[i].trim() !== '' && ind <= stepIndent) break;
    if (rows[i].trim() === 'run: |') {
      runAt = i;
      break;
    }
  }
  if (runAt < 0) throw new Error('guard step has no run block');
  const keyIndent = rows[runAt].length - rows[runAt].trimStart().length;
  const body: string[] = [];
  let bi = -1;
  for (let i = runAt + 1; i < rows.length; i++) {
    const l = rows[i];
    if (l.trim() === '') {
      body.push('');
      continue;
    }
    const ind = l.length - l.trimStart().length;
    if (ind <= keyIndent) break;
    if (bi < 0) bi = ind;
    body.push(l.slice(bi));
  }
  return body.join('\n');
}

describe('RECURRENCE GATE: adopters need only the Claude secret (#2982)', () => {
  it('finds the scaffolded workflows (a vacuous pass is a failure)', () => {
    const paths = scaffoldedWorkflows.map((t) => t.outputPath);
    expect(paths).toEqual(expect.arrayContaining(['.github/workflows/ai-review.yml', '.github/workflows/ready-to-merge.yml']));
  });

  it('REVIEWER_SECRETS (what gates the review and the #559 required-check guard) stays within the allowlist', () => {
    for (const name of REVIEWER_SECRETS) expect(ADOPTER_REQUIRED_SECRETS as readonly string[]).toContain(name);
  });

  it('every secret a scaffolded workflow references is declared, and only the allowlist is required', () => {
    const declared = new Set<string>([
      ...ADOPTER_REQUIRED_SECRETS,
      ...REVIEWER_OPTIONAL_SECRETS,
      ...REVIEWER_IDENTITY_SECRETS,
      ...PLATFORM_SECRETS,
    ]);
    for (const t of scaffoldedWorkflows) {
      for (const name of secretsIn(t.content)) {
        expect(declared.has(name), `${t.outputPath} references undeclared secret ${name}`).toBe(true);
      }
    }
  });

  it('an identity secret only chooses the identity: guard env, App-token mint, or a != \'\' boolean', () => {
    const allowed = [
      /^\s*APP_ID: \$\{\{ secrets\.MINSPEC_APP_ID \}\}$/,
      /^\s*APP_KEY: \$\{\{ secrets\.MINSPEC_APP_PRIVATE_KEY \}\}$/,
      /^\s*app-id: \$\{\{ secrets\.MINSPEC_APP_ID \}\}$/,
      /^\s*private-key: \$\{\{ secrets\.MINSPEC_APP_PRIVATE_KEY \}\}$/,
      /^\s*[A-Z_]+: \$\{\{ secrets\.(MINSPEC_APP_ID|MINSPEC_APP_PRIVATE_KEY) != '' \}\}$/,
    ];
    let seen = 0;
    for (const t of scaffoldedWorkflows) {
      for (const line of t.content.split('\n')) {
        if (line.trim().startsWith('#')) continue;
        if (!REVIEWER_IDENTITY_SECRETS.some((n) => line.includes(`secrets.${n}`))) continue;
        seen++;
        expect(allowed.some((re) => re.test(line)), `${t.outputPath}: identity secret used outside the identity choice: ${line.trim()}`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('the SHIPPED ai-review guard runs the review with only the Claude secret set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adopter-gate-'));
    scratch.push(dir);
    const out = path.join(dir, 'out');
    fs.writeFileSync(out, '');
    const res = spawnSync('bash', ['-c', guardRun(AI_REVIEW_WORKFLOW)], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, OAUTH_TOKEN: 'x-shape-only-not-a-credential', APP_ID: '', APP_KEY: '' },
      encoding: 'utf-8',
    });
    expect(res.status).toBe(0);
    const outputs = fs.readFileSync(out, 'utf-8');
    expect(outputs).toContain('configured=true');
    expect(outputs).toContain('identity=actions');
  });
});
