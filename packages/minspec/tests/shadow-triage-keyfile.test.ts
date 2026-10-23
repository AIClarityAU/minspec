/**
 * T0 (queue item zaikey23) - the z.ai key can live in a 600 file instead of the session env,
 * and nothing on the way ever prints it.
 *
 * WHY. The key used to reach the shadow-triage instrument through `env` in
 * .claude/settings.local.json. That puts it in the environment of the whole session tree,
 * the long-running drain included, and any same-user process can read a live process's
 * environment from /proc/<pid>/environ. Job spec-2853-1023 did exactly that and printed it
 * into its own log. Read from a file by scripts/shadow-triage.sh itself, the key lives only
 * in that short-lived process's memory.
 *
 * Every case runs with an explicit MINSPEC_ZAI_API_KEY_FILE and a throwaway HOME, so no
 * case can ever read the operator's real key file.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(__dirname, '../../..');
const SHADOW = path.join(ROOT, 'scripts/shadow-triage.sh');
const LIB = path.join(ROOT, 'scripts/lib/shadow-triage.sh');
const DRAIN = path.join(ROOT, 'scripts/drain-inbox.sh');

// Shaped like a key and unique, so any appearance in output is unambiguous.
const FILE_SENTINEL = 'zai-file-sentinel-not-real';
const ENV_SENTINEL = 'zai-env-sentinel-not-real';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function scratch(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zai-keyfile-'));
  dirs.push(d);
  return d;
}

/** A key file in a fresh dir, with the given mode (default 600). */
function keyFile(content: string | null, mode = 0o600): { dir: string; file: string } {
  const dir = scratch();
  const file = path.join(dir, 'minspec-zai.key');
  if (content !== null) {
    fs.writeFileSync(file, content);
    fs.chmodSync(file, mode);
  }
  return { dir, file };
}

function baseEnv(dir: string, file: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: dir,
    MINSPEC_ZAI_API_KEY_FILE: file,
    MINSPEC_SHADOW_TRIAGE_MODEL: 'glm-5.2', // hermetic: no /v1/models lookup
    ...extra,
  };
}

/** Run a bash snippet with the lib sourced; returns exit status (0 = predicate true). */
function libCheck(snippet: string, env: Record<string, string>): number {
  const r = spawnSync('bash', ['-c', `source "$1"; ${snippet}`, 'x', LIB], { encoding: 'utf-8', env });
  return r.status ?? 1;
}

function libOut(fn: string, env: Record<string, string>): string {
  const r = spawnSync('bash', ['-c', `source "$1"; ${fn}`, 'x', LIB], { encoding: 'utf-8', env });
  return r.stdout ?? '';
}

describe('key resolution: env first, then the 600 file', () => {
  it('no env key + a 600 file → the file value is the key', () => {
    const { dir, file } = keyFile(FILE_SENTINEL);
    // Compared inside bash so the value is never round-tripped through a test log.
    expect(libCheck(`[[ "$(shadow_key)" == "${FILE_SENTINEL}" ]]`, baseEnv(dir, file))).toBe(0);
    expect(libOut('shadow_key_source', baseEnv(dir, file))).toBe('file');
  });

  it('a trailing newline (or CRLF) in the file is not part of the key', () => {
    const { dir, file } = keyFile(`${FILE_SENTINEL}\r\n`);
    expect(libCheck(`[[ "$(shadow_key)" == "${FILE_SENTINEL}" ]]`, baseEnv(dir, file))).toBe(0);
  });

  it('the env key wins over the file, so the move is order-safe', () => {
    const { dir, file } = keyFile(FILE_SENTINEL);
    const env = baseEnv(dir, file, { MINSPEC_ZAI_API_KEY: ENV_SENTINEL });
    expect(libCheck(`[[ "$(shadow_key)" == "${ENV_SENTINEL}" ]]`, env)).toBe(0);
    expect(libOut('shadow_key_source', env)).toBe('env');
  });

  it.each([
    [0o644, 'unsafe-mode:644'],
    [0o640, 'unsafe-mode:640'],
    [0o604, 'unsafe-mode:604'],
  ])('a file with group/other bits (%o) is refused, never read', (mode: number, state: string) => {
    const { dir, file } = keyFile(FILE_SENTINEL, mode);
    expect(libOut('shadow_key_file_state', baseEnv(dir, file))).toBe(state);
    expect(libCheck('[[ -z "$(shadow_key)" ]]', baseEnv(dir, file))).toBe(0);
  });

  it('400 is accepted as well as 600', () => {
    const { dir, file } = keyFile(FILE_SENTINEL, 0o400);
    expect(libOut('shadow_key_file_state', baseEnv(dir, file))).toBe('ok');
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['empty', '\n'],
  ])('state %s → no key', (state: string, content: string | null) => {
    const { dir, file } = keyFile(content);
    expect(libOut('shadow_key_file_state', baseEnv(dir, file))).toBe(state);
    expect(libCheck('[[ -z "$(shadow_key)" ]]', baseEnv(dir, file))).toBe(0);
  });

  it('the default path is ~/.claude/.secrets/minspec-zai.key under HOME', () => {
    const dir = scratch();
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir };
    expect(libOut('shadow_key_file', env)).toBe(path.join(dir, '.claude/.secrets/minspec-zai.key'));
  });
});

describe('neither source → a clear, value-free note; the instrument stays inert', () => {
  it('record names the env var, the file path and why the file was not used', () => {
    const { dir, file } = keyFile(null);
    const r = spawnSync('bash', [SHADOW, 'record'], { encoding: 'utf-8', env: baseEnv(dir, file), cwd: dir });
    expect(r.status).toBe(0); // measurement only: never fails the triage that called it
    expect(r.stderr).toContain('no z.ai key configured');
    expect(r.stderr).toContain('MINSPEC_ZAI_API_KEY unset');
    expect(r.stderr).toContain(`key file ${file}: missing`);
  });

  it('an unsafe-mode file is reported as such, and its content never appears', () => {
    const { dir, file } = keyFile(FILE_SENTINEL, 0o644);
    const r = spawnSync('bash', [SHADOW, 'record'], { encoding: 'utf-8', env: baseEnv(dir, file), cwd: dir });
    expect(r.stderr).toContain(`key file ${file}: unsafe-mode:644`);
    expect(`${r.stdout}${r.stderr}`).not.toContain(FILE_SENTINEL);
  });
});

describe('the drain names the key SOURCE at start, never the value', () => {
  const note = (env: Record<string, string>): string => {
    const r = spawnSync('bash', [DRAIN, '--zai-key-note'], { encoding: 'utf-8', env });
    expect(r.status).toBe(0);
    return `${r.stdout}${r.stderr}`;
  };

  it('file → says it is read by shadow-triage only, not held by the drain', () => {
    const { dir, file } = keyFile(FILE_SENTINEL);
    const out = note(baseEnv(dir, file));
    expect(out).toContain(`read from ${file} by shadow-triage only`);
    expect(out).not.toContain(FILE_SENTINEL);
  });

  it('env → a loud warning that the drain holds it, with the move instruction', () => {
    const { dir, file } = keyFile(FILE_SENTINEL);
    const out = note(baseEnv(dir, file, { MINSPEC_ZAI_API_KEY: ENV_SENTINEL }));
    expect(out).toContain("WARNING: z.ai key is in this drain's ENVIRONMENT");
    expect(out).toContain(`Move it to ${file}`);
    expect(out).not.toContain(ENV_SENTINEL);
    expect(out).not.toContain(FILE_SENTINEL);
  });

  it('none → says the instrument is inert and why', () => {
    const { dir, file } = keyFile(null);
    expect(note(baseEnv(dir, file))).toContain(`key file ${file}: missing`);
  });
});

describe('end to end: a file key reaches the request header and nothing else', () => {
  it('the stub curl receives the file key on stdin; no argv, stdout or stderr carries it', () => {
    const { dir, file } = keyFile(FILE_SENTINEL);
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir);
    const argvLog = path.join(dir, 'argv.log');
    const configLog = path.join(dir, 'config.log');
    fs.writeFileSync(
      path.join(binDir, 'curl'),
      `#!/usr/bin/env bash
out=""; prev=""
for a in "$@"; do printf '%s\\n' "$a" >> "${argvLog}"; [[ "$prev" == "--output" ]] && out="$a"; prev="$a"; done
cat > "${configLog}"
printf '{"content":[{"type":"text","text":"TRIAGE_VERDICT_BEGIN\\ndecision: needs-review\\nrole: architect\\ntier: T3\\nhuman_only: yes\\nTRIAGE_VERDICT_END"}],"stop_reason":"end_turn"}' > "\${out:-/dev/stdout}"
printf '200'
`,
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(binDir, 'gh'),
      `#!/usr/bin/env bash
[[ "\${1:-}" == "repo" && "\${2:-}" == "view" ]] && echo '{"visibility":"PUBLIC","isPrivate":false}'
exit 0
`,
      { mode: 0o755 },
    );
    const prompt = path.join(dir, 'prompt.txt');
    const live = path.join(dir, 'live.txt');
    fs.writeFileSync(prompt, 'classify this issue');
    fs.writeFileSync(live, 'label=needs-review\nrole=architect\nhold=human\ntier=T3\nhuman_only=yes\n');

    const env = baseEnv(dir, file, {
      PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      MINSPEC_SHADOW_TRIAGE_LOG: path.join(dir, 'shadow.jsonl'),
    });
    const r = spawnSync(
      'bash',
      [SHADOW, 'record', '--issue', '7', '--repo', 'AIClarityAU/minspec', '--prompt-file', prompt, '--live-fields', live],
      { encoding: 'utf-8', env, cwd: dir },
    );

    // Control: the request really went out, with the file's key in its header.
    expect(fs.readFileSync(configLog, 'utf-8')).toContain(`x-api-key: ${FILE_SENTINEL}`);
    // The property: nowhere else.
    expect(fs.readFileSync(argvLog, 'utf-8')).not.toContain(FILE_SENTINEL);
    expect(r.stdout).not.toContain(FILE_SENTINEL);
    expect(r.stderr).not.toContain(FILE_SENTINEL);
    expect(fs.readFileSync(path.join(dir, 'shadow.jsonl'), 'utf-8')).not.toContain(FILE_SENTINEL);
  });
});
