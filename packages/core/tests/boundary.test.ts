// SPEC-136 FR-8 (INV-3): a folder without `.minspec/` is refused with exit 2 and
// `not-a-minspec-project`, never a pass. Control: the same call passes once `.minspec/` exists.
//
// SPEC-136 task 12 (FR-4, FR-10, FR-12, FR-17): the `--require` trap harness. Every operation, and
// a full tool-server session, runs as a child of the built bundle under `boundary-trap.cjs` with
// `HOME` set to an empty directory. The trap records each forbidden call to stderr before it
// throws, so the test reads the record and not the (swallowable) exception. Each trap has a
// planted control that must go red. FR-12: `minspec-core` appears in rendered templates only
// inside workflow and hook templates.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MANAGED_REGION_TEMPLATES, TEMPLATES, TEMPLATE_OUTPUT_PATHS } from '../../minspec/src/lib/template-registry';
import { buildBundle, runCore } from './helpers';

let work: string;
let bundle: string;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'minspec-core-boundary-'));
  bundle = await buildBundle(join(work, 'bundle'));
}, 60_000);
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('opt-in refusal (FR-8)', () => {
  it('a folder without .minspec/ is refused, exit 2, nothing written', () => {
    const folder = join(work, 'plain');
    mkdirSync(join(folder, 'specs'), { recursive: true });
    writeFileSync(join(folder, 'specs', 'a.md'), '---\nid: SPEC-1\n---\nx\n');
    const r = runCore(bundle, ['hash', '--root', folder, '--spec', 'specs/a.md']);
    expect(r.status).toBe(2);
    expect(r.json.outcome).toBe('refused');
    expect(r.json.refusal.code).toBe('not-a-minspec-project');
    expect(r.json.refusal.message).toContain(folder);
    expect(r.json.data).toBeUndefined();
    expect(readdirSync(folder).sort()).toEqual(['specs']);
  });

  it('control: the same call passes once .minspec/ exists', () => {
    const folder = join(work, 'optedin');
    mkdirSync(join(folder, 'specs'), { recursive: true });
    mkdirSync(join(folder, '.minspec'));
    writeFileSync(join(folder, 'specs', 'a.md'), '---\nid: SPEC-1\n---\nx\n');
    const r = runCore(bundle, ['hash', '--root', folder, '--spec', 'specs/a.md']);
    expect(r.status).toBe(0);
    expect(r.json.outcome).toBe('pass');
  });

  it('the current directory is the root when --root is absent', () => {
    const folder = join(work, 'plain-cwd');
    mkdirSync(folder);
    const r = runCore(bundle, ['hash', '--spec', 'a.md'], folder);
    expect(r.status).toBe(2);
    expect(r.json.refusal.code).toBe('not-a-minspec-project');
  });
});

// ---------------------------------------------------------------------------------------------
// The trap harness (FR-4, FR-10, FR-17)
// ---------------------------------------------------------------------------------------------

const TRAP = join(__dirname, 'boundary-trap.cjs');
const MARK = 'MINSPEC-TRAP';

interface Trapped {
  status: number | null;
  stdout: string;
  stderr: string;
  records: string[];
}

function trapEnv(home: string, allow: string[]): NodeJS.ProcessEnv {
  return { ...process.env, HOME: home, USERPROFILE: home, MINSPEC_TRAP_ALLOW: JSON.stringify(allow) };
}
const recordsOf = (stderr: string): string[] => stderr.split('\n').filter((l) => l.startsWith(MARK));

function runTrapped(script: string, args: string[], cwd: string, home: string, allow: string[]): Trapped {
  const r = spawnSync(process.execPath, ['--require', TRAP, script, ...args], {
    cwd,
    encoding: 'utf8',
    env: trapEnv(home, allow),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, records: recordsOf(r.stderr) };
}

/** A fixture project: opted in, one spec, a git repo so `activate` and `git` calls are real. */
function makeProject(name: string): string {
  const dir = realpathSync(mkdtempSync(join(work, `${name}-`)));
  mkdirSync(join(dir, '.minspec'));
  mkdirSync(join(dir, 'specs'));
  writeFileSync(join(dir, 'specs', 'one.md'), '---\nid: SPEC-901\nstatus: specifying\n---\n\n# T\n\nBody.\n');
  if (spawnSync('git', ['init', '-q'], { cwd: dir }).status !== 0) throw new Error('git init failed');
  return dir;
}
function emptyHome(name: string): string {
  const home = realpathSync(mkdtempSync(join(work, `${name}-home-`)));
  expect(readdirSync(home)).toEqual([]);
  return home;
}

const OP_ARGS: Record<string, string[]> = { hash: ['--spec', 'specs/one.md'] };
const listOperations = (): string[] =>
  runCore(bundle, ['--list']).stdout.split('\n').filter(Boolean).map((l) => l.split('\t')[0]);

describe('trap controls: a planted violation is recorded (the trap can go red)', () => {
  const planted: Record<string, { code: string; expect: RegExp }> = {
    fetch: { code: "fetch('http://127.0.0.1:1/').catch(() => {});", expect: /network fetch/ },
    'spawn gh': { code: "require('child_process').spawnSync('gh', ['--version']);", expect: /child_process spawnSync gh/ },
    'exec claude': { code: "require('node:child_process').execSync('claude --version');", expect: /child_process execSync claude/ },
    'http request': { code: "require('node:http').request('http://127.0.0.1:1/');", expect: /network http\.request/ },
    'read /etc/hostname': { code: "require('fs').readFileSync('/etc/hostname');", expect: /fs fs\.readFileSync \/etc\/hostname/ },
    'fs promises outside': { code: "require('fs').promises.readFile('/etc/hostname').catch(() => {});", expect: /fs fs\.promises\.readFile/ },
    listen: { code: "require('net').createServer().listen(0);", expect: /network net\.createServer/ },
    'a net.Server built directly': { code: "new (require('net').Server)();", expect: /network net\.Server/ },
    dgram: { code: "require('dgram').createSocket('udp4').bind(0);", expect: /network dgram\.createSocket/ },
    'write HOME': { code: "require('fs').writeFileSync(process.env.HOME + '/x', '1');", expect: /fs fs\.writeFileSync/ },
  };
  for (const [label, p] of Object.entries(planted)) {
    it(`records ${label}, even when the program swallows the throw`, () => {
      const dir = makeProject('ctl');
      const home = emptyHome('ctl');
      const script = join(dir, 'planted.cjs');
      writeFileSync(script, `try { ${p.code} } catch (e) { /* swallowed */ }\n`);
      const r = runTrapped(script, [], dir, home, [dir]);
      expect(r.records.join('\n')).toMatch(p.expect);
    });
  }

  it('control: allowed work leaves no record (git, a file inside the root)', () => {
    const dir = makeProject('ok');
    const home = emptyHome('ok');
    const script = join(dir, 'fine.cjs');
    writeFileSync(
      script,
      "require('child_process').spawnSync('git', ['--version']);require('fs').readFileSync('specs/one.md');\n",
    );
    const r = runTrapped(script, [], dir, home, [dir]);
    expect(r.status).toBe(0);
    expect(r.records).toEqual([]);
  });
});

describe('every operation stays offline, git-only, inside the root (FR-4, FR-17)', () => {
  it('the table is not empty and names the operations the harness has args for', () => {
    const ops = listOperations();
    expect(ops.length).toBeGreaterThanOrEqual(4);
    for (const op of ops) {
      expect(
        ['validate', 'hash', 'status', 'next', 'activate'].includes(op) || op === 'approve',
        `operation ${op} has no boundary-harness entry`,
      ).toBe(true);
    }
  });

  it('runs each operation through the command line: no record, HOME still empty', () => {
    const ops = listOperations().filter((o) => o !== 'approve');
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      const dir = makeProject(`op-${op}`);
      const home = emptyHome(`op-${op}`);
      const r = runTrapped(bundle, [op, '--root', dir, ...(OP_ARGS[op] ?? [])], dir, home, [dir, bundle]);
      expect(r.records, `${op}: ${r.stderr}`).toEqual([]);
      expect(JSON.parse(r.stdout).operation, `${op}: ${r.stderr}`).toBe(op);
      expect(readdirSync(home), `${op} wrote into HOME`).toEqual([]);
    }
  }, 60_000);

  it('control: a run whose root is outside the allowed set is recorded', () => {
    const dir = makeProject('narrow');
    const home = emptyHome('narrow');
    const r = runTrapped(bundle, ['validate', '--root', dir], dir, home, [bundle]);
    expect(r.records.length).toBeGreaterThan(0);
  });
});

/** Drive `serve` over pipes for one full session; resolves with each response by id. */
function session(dir: string, home: string, calls: object[]): Promise<{ responses: any[]; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--require', TRAP, bundle, 'serve', '--root', dir], {
      cwd: dir,
      env: trapEnv(home, [dir, bundle]),
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', () => {
      const responses = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
      resolve({ responses, stderr: err });
    });
    for (const c of calls) child.stdin.write(`${JSON.stringify(c)}\n`);
    child.stdin.end();
  });
}

// The tool server is task 11; until `serve` exists in the command line there is no session to run.
// This test turns on by itself the moment `packages/core/src/tool-server.ts` lands.
const hasServer = existsSync(join(__dirname, '..', 'src', 'tool-server.ts'));
describe.runIf(hasServer)('the tool server session binds no socket and leaves no record (FR-10, FR-17)', () => {
  it('a full session: initialize, ping, tools/list, one tools/call per tool, then stdin closes', async () => {
    const dir = makeProject('serve');
    const home = emptyHome('serve');
    const rpc = (id: number, method: string, params?: object) => ({ jsonrpc: '2.0', id, method, params });
    const calls: object[] = [
      rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } }),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      rpc(2, 'ping'),
      rpc(3, 'tools/list'),
    ];
    const names = listOperations().filter((o) => o !== 'approve');
    names.forEach((n, i) => calls.push(rpc(10 + i, 'tools/call', { name: n, arguments: { root: dir, ...Object.fromEntries(chunk(OP_ARGS[n] ?? [])) } })));
    const { responses, stderr } = await session(dir, home, calls);
    expect(recordsOf(stderr)).toEqual([]);
    expect(responses.find((r) => r.id === 3)?.result.tools.map((t: any) => t.name).sort()).toEqual([...names].sort());
    expect(readdirSync(home)).toEqual([]);
  }, 60_000);
});
function chunk(a: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < a.length; i += 2) out.push([a[i].replace(/^--/, ''), a[i + 1]]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// FR-12: `minspec-core` is for hooks and workflows, never prose meant for a person
// ---------------------------------------------------------------------------------------------

interface Rendered {
  name: string;
  outputPath: string;
  content: string;
}
const MACHINE_PATH = /^(\.github\/workflows\/|\.minspec\/hooks\/|\.claude\/hooks\/)/;

/** Names of rendered templates that mention `minspec-core` but are not a workflow or hook. */
function proseMentions(rendered: readonly Rendered[]): string[] {
  return rendered.filter((t) => t.content.includes('minspec-core') && !MACHINE_PATH.test(t.outputPath)).map((t) => t.name);
}

const renderedTemplates = (): Rendered[] => [
  ...Object.entries(TEMPLATES).map(([name, content]) => ({
    name,
    outputPath: TEMPLATE_OUTPUT_PATHS[name as keyof typeof TEMPLATE_OUTPUT_PATHS],
    content,
  })),
  ...MANAGED_REGION_TEMPLATES.map((t) => ({
    name: t.name,
    outputPath: t.outputPath,
    content: `${t.preamble ?? ''}\n${t.content}`,
  })),
];

describe('minspec-core stays out of user-facing prose (FR-12)', () => {
  it('every template that renders `minspec-core` is a workflow or a hook', () => {
    const rendered = renderedTemplates();
    expect(rendered.length).toBeGreaterThan(5);
    expect(proseMentions(rendered)).toEqual([]);
  });

  it('control: a planted prose template (and a slash-command shim) naming it is reported', () => {
    const planted: Rendered = { name: 'planted', outputPath: 'CLAUDE.md', content: 'Run minspec-core validate yourself.' };
    expect(proseMentions([...renderedTemplates(), planted])).toEqual(['planted']);
    const shim: Rendered = { name: 'shim', outputPath: '.claude/commands/x.md', content: 'minspec-core hash' };
    expect(proseMentions([shim])).toEqual(['shim']);
  });

  it('control: the same text inside a workflow path is allowed', () => {
    const ok: Rendered = { name: 'wf', outputPath: '.github/workflows/x.yml', content: 'node minspec-core.cjs validate' };
    expect(proseMentions([ok])).toEqual([]);
  });
});
