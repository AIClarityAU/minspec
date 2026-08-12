/**
 * T0 — credential isolation for the GLM shadow-triage instrument (#1338).
 *
 * THIS IS A SECURITY TEST, not a feature test. The shadow call points
 * ANTHROPIC_BASE_URL at z.ai, a third party. If an Anthropic credential is reachable
 * at that moment, `claude -p` ships the founder's token to that third party. A defect
 * here is a credential exfiltration, and strictly worse than the quota jam (#1234)
 * the whole instrument exists to help relieve.
 *
 * There are TWO reachable credentials, and only one of them lives in the environment:
 *
 *   1. THE ENVIRONMENT — CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY /
 *      ANTHROPIC_AUTH_TOKEN inherited from the operator's shell. Closed by `env -u`.
 *
 *   2. THE ON-DISK STORE — ~/.claude/.credentials.json (present on the operator box)
 *      and the OS keychain. `env -u` cannot touch these. Measured, not inferred:
 *
 *        claude -p --bare  (no key in env)   → "Not logged in · Please run /login"
 *        claude -p --bare  (fake key in env) → "Invalid API key · Fix external API key"
 *        claude -p         (no key in env)   → answered normally
 *
 *      The third probe is the hazard demonstrated: without `--bare` the CLI silently
 *      used the stored subscription credential. So `--bare` is the second half of the
 *      property, and this file pins BOTH halves — scrubbing alone would leave the
 *      hole wide open while every environment assertion below still passed.
 *
 * Both halves are asserted BEHAVIOURALLY: the environment is observed by running
 * `env` under the constructed prefix (what the agent would actually see), and the
 * argv is observed from the same builder `record` uses. Neither is a grep of the
 * script for its own text — this repo has been bitten by source-text assertions
 * passing while the thing they described was inert.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

function findScriptsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'scripts');
    if (fs.existsSync(candidate) && fs.existsSync(path.join(dir, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo-root scripts/ directory from ' + __dirname);
}

const scriptsDir = findScriptsDir();
const SHADOW = path.join(scriptsDir, 'shadow-triage.sh');
// The pure seams live in the lib, sourced directly so the selection rule can be
// driven from fixtures without invoking the runner (or the network).
const LIB = path.join(scriptsDir, 'lib', 'shadow-triage.sh');

const ZAI_KEY = 'zai-key-for-the-shadow-run';

/**
 * Every Anthropic (and other-vendor) credential the operator's shell might be
 * carrying, seeded with a value containing the sentinel POISON so a single sweep can
 * assert none of them survived anywhere in the child environment.
 */
const POISON: Record<string, string> = {
  ANTHROPIC_API_KEY: 'sk-ant-POISON-api-key',
  ANTHROPIC_AUTH_TOKEN: 'sk-ant-POISON-auth-token',
  CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-POISON-oauth',
  ANTHROPIC_CUSTOM_HEADERS: 'Authorization: Bearer POISON-in-a-header',
  AWS_BEARER_TOKEN_BEDROCK: 'POISON-bedrock',
  GOOGLE_APPLICATION_CREDENTIALS: '/tmp/POISON-gcp.json',
  ANTHROPIC_VERTEX_PROJECT_ID: 'POISON-vertex',
  CLAUDE_CODE_USE_BEDROCK: '1',
  CLAUDE_CODE_USE_VERTEX: '1',
  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '55',
  // The tee-proxy value the operator really does carry — the shadow run must
  // override it, or the pilot would silently measure Anthropic and log it as GLM.
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:8788/POISON-tee-proxy',
};

/**
 * The environment the shadow agent would actually run under.
 *
 * The child env is built FROM SCRATCH (not spread from process.env) so the assertions
 * are hermetic: a value present here is one this harness put there, and a multi-line
 * inherited variable cannot smuggle a line that parses as another assignment.
 */
function effectiveEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out = execFileSync('bash', [SHADOW, '--print-effective-env'], {
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      ...POISON,
      MINSPEC_SHADOW_TRIAGE_KEY: ZAI_KEY,
      ...extra,
    },
  });
  const env: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function argv(extra: Record<string, string> = {}): string[] {
  return execFileSync('bash', [SHADOW, '--print-argv'], {
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      MINSPEC_SHADOW_TRIAGE_KEY: ZAI_KEY,
      ...extra,
    },
  }).split('\n');
}

describe('shadow-triage — no Anthropic credential can reach z.ai (the security property)', () => {
  it('NOTHING in the shadow environment carries a poisoned credential', () => {
    // The strongest single assertion available: a whole-environment sweep. It does
    // not depend on remembering to name each variable below, so a scrub list that
    // silently loses an entry fails here first.
    const env = effectiveEnv();
    const leaked = Object.entries(env).filter(([, v]) => v.includes('POISON'));
    expect(leaked, `these variables leaked a poisoned value into the z.ai call: ${JSON.stringify(leaked)}`).toEqual([]);
  });

  it.each([
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_CUSTOM_HEADERS',
    'AWS_BEARER_TOKEN_BEDROCK',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'ANTHROPIC_VERTEX_PROJECT_ID',
  ])('%s is absent entirely, not merely overwritten', (name) => {
    // Absence, not emptiness: an empty-but-present credential var is a different
    // state and some clients treat it as "configured".
    expect(effectiveEnv()[name]).toBeUndefined();
  });

  it.each(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])(
    '%s carries the z.ai key and only the z.ai key',
    (name) => {
      // Both are set to the SAME z.ai key on purpose: z.ai's docs use
      // ANTHROPIC_AUTH_TOKEN (Bearer) while `--bare`'s contract reads
      // ANTHROPIC_API_KEY (x-api-key). Either convention works, and neither can
      // carry an Anthropic credential because both hold the third party's own key.
      expect(effectiveEnv()[name]).toBe(ZAI_KEY);
    },
  );

  it('the provider switches are cleared, so the run cannot silently be a different vendor', () => {
    // Neither is a credential, but either one makes the CLI IGNORE ANTHROPIC_BASE_URL.
    // The row would then claim a GLM measurement of a non-GLM response — a false
    // sample, which is worse than a missing one.
    const env = effectiveEnv();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
  });

  it('the base URL is z.ai, overriding an inherited tee-proxy value', () => {
    expect(effectiveEnv().ANTHROPIC_BASE_URL).toBe('https://api.z.ai/api/anthropic');
  });

  it('--bare is on the command line — the on-disk credential store is unreachable', () => {
    // The half `env -u` cannot cover. ~/.claude/.credentials.json and the OS keychain
    // are read by an otherwise-unauthenticated `claude -p`; `--bare`'s documented
    // contract is "OAuth and keychain are never read". Measured on the operator box:
    // WITHOUT --bare and with no key in the environment, `claude -p` answered
    // normally — i.e. it used the stored subscription credential. Deleting this flag
    // reopens the exfiltration path with every environment assertion above still green.
    expect(argv()).toContain('--bare');
  });

  it('an unauthenticated fallback is impossible: the key is passed, never assumed', () => {
    // Belt to --bare's braces. If the key were ever dropped from the env builder the
    // run would fail to authenticate (absent) rather than fall back to something
    // inherited — absent beats inherited, which is why the `-u` on a var we then set
    // is a fail-safe rather than dead code.
    const env = effectiveEnv();
    expect(env.ANTHROPIC_API_KEY).toBeTruthy();
    expect(env.ANTHROPIC_API_KEY).not.toContain('POISON');
  });
});

describe('shadow-triage — one resolved model id reaches every surface', () => {
  // #1338: "z.ai" is not a model, and it publishes no floating alias (verified
  // against a live key 2026-08-07 — GET /v1/models returns only concrete ids). The
  // default is now the `latest` SENTINEL, resolved per run; what must not vary is
  // that whatever id is chosen reaches BOTH the CLI flag and every alias route, and
  // is the id recorded on the row.
  //
  // These cases pass the id explicitly so they stay hermetic: an explicit
  // MINSPEC_SHADOW_TRIAGE_MODEL short-circuits resolution, so no test touches the
  // network. Resolution itself is covered by the pure-seam cases below.
  const PINNED = { MINSPEC_SHADOW_TRIAGE_MODEL: 'glm-5.2' };

  it('the resolved id appears on the command line', () => {
    const a = argv(PINNED);
    expect(a).toContain('--model');
    expect(a[a.indexOf('--model') + 1]).toBe('glm-5.2');
  });

  it('the same id also pins every alias-resolution path', () => {
    // Setting only the CLI flag would leave the ANTHROPIC_DEFAULT_*_MODEL route free
    // to resolve elsewhere inside the CLI, and the row would still claim glm-5.2.
    const env = effectiveEnv(PINNED);
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-5.2');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('glm-5.2');
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('glm-5.2');
  });

  // ── "latest" resolution — the pure selection rule ──────────────────────────
  // `shadow_pick_latest_model` takes a /v1/models body on stdin and prints the id to
  // use. Driven by fixtures, so the rule is provable without a z.ai account and
  // without a network call. The runner SKIPS on a non-zero exit rather than falling
  // back to a guess: a row labelled with the wrong model is worse than no row.
  function pick(body: string): { out: string; code: number } {
    const r = spawnSync(
      'bash',
      ['-c', `source "${LIB}" >/dev/null 2>&1; shadow_pick_latest_model`],
      { input: body, encoding: 'utf-8' },
    );
    return { out: (r.stdout ?? '').trim(), code: r.status ?? 1 };
  }

  it('picks the newest by created_at, not by list order or version string', () => {
    // The REAL listing as returned by z.ai on 2026-08-07, order preserved.
    const real = JSON.stringify({
      data: [
        { id: 'glm-4.5', created_at: '2025-07-28T00:00:00Z' },
        { id: 'glm-4.6', created_at: '2025-10-01T08:00:00Z' },
        { id: 'glm-4.7', created_at: '2025-12-22T00:00:00Z' },
        { id: 'glm-5', created_at: '2026-02-11T00:00:00Z' },
        { id: 'glm-5.1', created_at: '2026-03-27T22:00:00Z' },
        { id: 'glm-5.2', created_at: '2026-06-17T00:00:00Z' },
      ],
    });
    expect(pick(real).out).toBe('glm-5.2');
  });

  it('a two-digit minor still resolves correctly (a lexical sort would not)', () => {
    // 'glm-5.10' < 'glm-5.9' as TEXT. Reading created_at is what makes this right.
    expect(
      pick(
        JSON.stringify({
          data: [
            { id: 'glm-5.9', created_at: '2026-06-17T00:00:00Z' },
            { id: 'glm-5.10', created_at: '2026-09-01T00:00:00Z' },
          ],
        }),
      ).out,
    ).toBe('glm-5.10');
  });

  it('SKIPS a lite sibling even when it is the newest — newer is not better', () => {
    // The silent-downgrade hazard: a future `-air`/`-turbo` would be newest by date
    // yet weaker, and the log would still say "latest".
    for (const lite of ['glm-5.3-air', 'glm-5.3-turbo', 'glm-5.3-flash', 'glm-5.3-mini']) {
      expect(
        pick(
          JSON.stringify({
            data: [
              { id: 'glm-5.2', created_at: '2026-06-17T00:00:00Z' },
              { id: lite, created_at: '2026-09-01T00:00:00Z' },
            ],
          }),
        ).out,
      ).toBe('glm-5.2');
    }
  });

  it('fails rather than guesses on a malformed, empty, or all-lite listing', () => {
    expect(pick('not json').code).not.toBe(0);
    expect(pick('{"data":[]}').code).not.toBe(0);
    expect(pick('{"data":"nope"}').code).not.toBe(0);
    // every candidate excluded → nothing choosable, so no id is emitted
    const allLite = JSON.stringify({ data: [{ id: 'glm-5-turbo', created_at: '2026-01-01T00:00:00Z' }] });
    expect(pick(allLite).code).not.toBe(0);
    expect(pick(allLite).out).toBe('');
    // a row missing created_at is skipped, not treated as newest
    const partial = JSON.stringify({
      data: [
        { id: 'glm-5.2', created_at: '2026-06-17T00:00:00Z' },
        { id: 'glm-9.9' },
      ],
    });
    expect(pick(partial).out).toBe('glm-5.2');
  });

  it('an explicit model short-circuits resolution entirely (no request)', () => {
    // Proven by behaviour: with a base URL that could not answer, an explicit id
    // still resolves, which is only possible if no listing call was attempted.
    const r = spawnSync(
      'bash',
      [SHADOW, '--resolve-model'],
      {
        encoding: 'utf-8',
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: process.env.HOME ?? '/tmp',
          MINSPEC_SHADOW_TRIAGE_KEY: ZAI_KEY,
          MINSPEC_SHADOW_TRIAGE_MODEL: 'glm-4.7',
          MINSPEC_SHADOW_TRIAGE_BASE_URL: 'http://127.0.0.1:9/anthropic',
        },
      },
    );
    expect(r.status).toBe(0);
    expect((r.stdout ?? '').trim()).toBe('glm-4.7');
  });

  it('MINSPEC_SHADOW_TRIAGE_MODEL overrides it consistently across both surfaces', () => {
    const over = { MINSPEC_SHADOW_TRIAGE_MODEL: 'glm-4.7' };
    const a = argv(over);
    expect(a[a.indexOf('--model') + 1]).toBe('glm-4.7');
    const env = effectiveEnv(over);
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('glm-4.7');
    // A partial override would be the worst outcome: the row would record one model
    // while the endpoint served another.
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-4.7');
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('glm-4.7');
  });

  it('MINSPEC_SHADOW_TRIAGE_BASE_URL is overridable without touching the scrub', () => {
    expect(effectiveEnv({ MINSPEC_SHADOW_TRIAGE_BASE_URL: 'https://example.test/anthropic' }).ANTHROPIC_BASE_URL).toBe(
      'https://example.test/anthropic',
    );
    // …and the credentials stay isolated regardless of where it points.
    expect(effectiveEnv({ MINSPEC_SHADOW_TRIAGE_BASE_URL: 'https://example.test/anthropic' }).CLAUDE_CODE_OAUTH_TOKEN)
      .toBeUndefined();
  });
});

describe('shadow-triage — the shadow measures the SAME task as the live agent', () => {
  // A shadow run that differs in task shape measures a different task, and its
  // agreement number would not be evidence about anything the pilot cares about.
  it('uses the same role file the live triage call uses', () => {
    const a = argv();
    const i = a.indexOf('--system-prompt-file');
    expect(i).toBeGreaterThan(-1);
    expect(a[i + 1].endsWith(path.join('roles', 'triage.md'))).toBe(true);
    expect(fs.existsSync(a[i + 1])).toBe(true);
  });

  it('grants no tools, exactly as the live call does (the issue body is untrusted)', () => {
    // Same reasoning as triage-inbox.sh: the body is a prompt-injection surface, so
    // per the `claude -p` subprocess rule the tool set is ELIMINATED, not justified.
    // It matters doubly here — this run is authenticated to a third party.
    const a = argv();
    const i = a.indexOf('--tools');
    expect(i).toBeGreaterThan(-1);
    expect(a[i + 1]).toBe('');
  });

  it('never asks for permission bypass', () => {
    expect(argv().join(' ')).not.toMatch(/dangerously-skip-permissions/);
  });
});
