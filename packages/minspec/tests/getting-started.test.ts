/**
 * SPEC-042 - `MinSpec: Getting Started`. T0 invariants first, then the feature tests.
 *
 * Two kinds of subject, on purpose:
 *   - the REAL controller and renderer driven through `OnboardingPage.handle` with recording
 *     fakes for every effect, so "fires only on click" is asserted as a call count; and
 *   - the REAL `buildPageDeps` over a real temp folder, with only `vscode` and the
 *     child-process boundary replaced, so the render path is shown to touch no network and
 *     the dismissal is shown to land in the real `.minspec/preferences.json`.
 *
 * Skipped by design: AC-10 and FR-12 (the ScroogeLLM nudge row). SPEC-086 removed that
 * setting, so there is nothing to show; the last describe block pins that it stays gone
 * (superseded by SPEC-086 per #2361).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';

// ─── The recorded boundaries ────────────────────────────────────────────────

const spawned: Array<{ file: string; args: readonly string[] }> = [];
const settings = new Map<string, unknown>();
const updates: Array<{ key: string; value: unknown; target: unknown }> = [];

vi.mock('child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('child_process')>();
  const record = (file: string, args: readonly string[] = []) => spawned.push({ file, args });
  return {
    ...real,
    execFileSync: (file: string, args?: readonly string[], opts?: never) => {
      record(file, args);
      return real.execFileSync(file, args as string[], opts);
    },
    execFile: (file: string, ...rest: unknown[]) => {
      record(file, Array.isArray(rest[0]) ? (rest[0] as string[]) : []);
      throw new Error(`unexpected execFile(${file}) in a test that must not spawn it`);
    },
    spawn: (file: string, ...rest: unknown[]) => {
      record(file, Array.isArray(rest[0]) ? (rest[0] as string[]) : []);
      throw new Error(`unexpected spawn(${file})`);
    },
  };
});

vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  ViewColumn: { Active: -1, Beside: -2 },
  Uri: { file: (p: string) => ({ fsPath: p }), parse: (s: string) => ({ toString: () => s }) },
  window: {
    createWebviewPanel: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    activeTextEditor: undefined,
  },
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({
      get: <T,>(key: string, fallback: T) => (settings.has(key) ? (settings.get(key) as T) : fallback),
      update: async (key: string, value: unknown, target: unknown) => {
        updates.push({ key, value, target });
        settings.set(key, value);
      },
    }),
  },
  commands: { executeCommand: vi.fn() },
  extensions: { getExtension: () => undefined },
  env: { appName: 'Visual Studio Code', openExternal: vi.fn() },
}));

import {
  GettingStartedPanel,
  OnboardingPage,
  renderGettingStartedHtml,
  DIVERGENCE_COPY,
  type PageDeps,
} from '../src/views/getting-started-webview';
import { buildPageDeps, hotkeysFromManifest } from '../src/commands/getting-started';
import { COVERAGE_HELPER, type GhIdentity } from '../src/lib/onboarding-settings';
import { escapeHtml } from '../src/views/getting-started-webview';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
) as {
  contributes: {
    commands: Array<{ command: string }>;
    keybindings: Array<{ command: string; key: string }>;
    configuration: { properties: Record<string, { default?: unknown }> };
  };
};

const tmpDirs: string[] = [];
function tmpFolder(opts: { optedIn: boolean }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-gs-'));
  tmpDirs.push(dir);
  if (opts.optedIn) fs.mkdirSync(path.join(dir, '.minspec'));
  return dir;
}

/** Every file under `dir` -> its bytes, so "nothing was written" is a full-tree comparison. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        out[path.relative(dir, full) + '/'] = '';
        walk(full);
      } else out[path.relative(dir, full)] = fs.readFileSync(full, 'utf-8');
    }
  };
  walk(dir);
  return out;
}

interface Fakes {
  deps: PageDeps;
  writes: Array<[string, unknown]>;
  commands: Array<[string, unknown[]]>;
  install: ReturnType<typeof vi.fn>;
  lookup: ReturnType<typeof vi.fn>;
  saved: Array<[string, string]>;
  opened: string[];
  sig: { current: string };
}

function fakes(over: Partial<PageDeps> = {}, gh: GhIdentity | null | 'throw' = null): Fakes {
  const writes: Array<[string, unknown]> = [];
  const commands: Array<[string, unknown[]]> = [];
  const saved: Array<[string, string]> = [];
  const opened: string[] = [];
  const sig = { current: 'sig-1' };
  const answered: Record<string, string> = {};
  const install = vi.fn(async () => {});
  const lookup = vi.fn(async () => {
    if (gh === 'throw') throw new Error('gh: not found');
    return gh;
  });
  const deps: PageDeps = {
    rootDir: '/fake/root',
    readSetting: <T,>(_id: string, fb: T) => fb,
    writeSetting: async (id, value) => {
      writes.push([id, value]);
    },
    runCommand: async (id, ...args) => {
      commands.push([id, args]);
    },
    installGitHubPrExtension: install,
    seedEmail: () => 'dev@example.com',
    lookupGhIdentity: lookup,
    openSettingsEditor: async (id) => {
      opened.push(id);
    },
    hotkeys: {},
    signatureFor: () => sig.current,
    loadAnswered: () => ({ ...answered }),
    saveAnswered: (key, signature) => {
      saved.push([key, signature]);
      answered[key] = signature;
    },
    isOptedIn: () => true,
    ...over,
  };
  return { deps, writes, commands, install, lookup, saved, opened, sig };
}

const html = (page: OnboardingPage) => renderGettingStartedHtml(page.view(), 'nonce123', 'vscode-resource:');

/** The rows of the rendered page: id -> whether the whole row is click-toggled. */
function renderedRows(markup: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const m of markup.matchAll(/<div class="row[^"]*" data-row="([^"]+)"([^>]*)>/g)) {
    out[m[1]] = /data-rowclick="1"/.test(m[2]);
  }
  return out;
}

beforeEach(() => {
  spawned.length = 0;
  updates.length = 0;
  settings.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

// ═══ T0 - Slice 1: the page exists, read-only ═══════════════════════════════

describe('INV-1 / AC-1 - open and render make no network call', () => {
  it('real deps over a real folder: no fetch, no http(s), no gh, and no write', async () => {
    const folder = tmpFolder({ optedIn: true });
    fs.writeFileSync(path.join(folder, '.minspec', 'preferences.json'), '{}\n');
    const before = snapshot(folder);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    // The namespace object is frozen under ESM; the CJS default export is what callers share.
    const httpSpy = vi.spyOn((http as unknown as { default: typeof http }).default, 'request');
    const httpsSpy = vi.spyOn((https as unknown as { default: typeof https }).default, 'request');
    const lookup = vi.fn(async () => null);
    const install = vi.fn(async () => {});
    const run = vi.fn(async () => undefined);

    const page = new OnboardingPage(
      buildPageDeps(folder, hotkeysFromManifest(MANIFEST as never), {
        lookupGhIdentity: lookup,
        installGitHubPrExtension: install,
        runCommand: run,
      }),
    );
    const markup = html(page); // open + render, the identity seeded from local git config

    expect(markup).toContain('Initialize SDD structure');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(httpSpy).not.toHaveBeenCalled();
    expect(httpsSpy).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    // The offline seed reads local git config; that is the only process render may start.
    expect(spawned.filter((s) => s.file !== 'git')).toEqual([]);
    for (const s of spawned) expect(s.args.slice(0, 1)).toEqual(['config']);
    expect(updates).toEqual([]);
    expect(snapshot(folder)).toEqual(before);
  });

  it('the markup loads nothing remote and the CSP forbids it (holds by construction)', () => {
    const markup = html(new OnboardingPage(fakes().deps));
    expect(markup).not.toMatch(/(?:src|href)\s*=\s*["']?https?:/i);
    expect(markup).not.toMatch(/@import|url\(/i);
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(markup)![1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("script-src 'nonce-nonce123'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
  });

  it('rendering never invokes any injected effect', () => {
    const f = fakes();
    html(new OnboardingPage(f.deps));
    expect(f.writes).toEqual([]);
    expect(f.commands).toEqual([]);
    expect(f.install).not.toHaveBeenCalled();
    expect(f.lookup).not.toHaveBeenCalled();
    expect(f.saved).toEqual([]);
  });
});

// A deny-list over the markup, so a later slice cannot reintroduce a meter silently.
const METER =
  /<progress\b|<meter\b|role="progressbar"|aria-valuenow|\b\d+\s*(?:of|\/)\s*\d+\s*(?:set ?up|complete|done|steps?)\b|\bpercent(?:age)? complete\b|\d+\s*%\s*(?:complete|done|set ?up)/i;

describe('INV-2 / AC-2 - no progress meter or tally', () => {
  it('the deny-list itself catches each meter shape (control)', () => {
    for (const bad of [
      '<progress value="3" max="5"></progress>',
      '<meter value="1"></meter>',
      '<div role="progressbar"></div>',
      '<span>3 of 5 set up</span>',
      '<span>60% complete</span>',
    ]) {
      expect(METER.test(bad), bad).toBe(true);
    }
  });

  it('the page renders hero, four-point primer and the three tiers, with no meter', () => {
    const markup = html(new OnboardingPage(fakes().deps));
    expect(METER.test(markup)).toBe(false);
    expect(markup).toContain('Initialize SDD structure');
    expect(markup.match(/<li>/g)).toHaveLength(4);
    for (const tier of ['Required', 'Recommended', 'Optional']) {
      expect(markup).toContain(`<h2>${tier}</h2>`);
    }
    expect(markup.match(/data-row="hero"/g)).toHaveLength(1);
  });

  it('stays meter-free in every state it can reach', async () => {
    const f = fakes({}, { login: 'octo', id: 1, email: null });
    const page = new OnboardingPage(f.deps);
    await page.handle({ type: 'verifyGitHub' });
    await page.handle({ type: 'setField', settingId: 'minspec.approverEmail', value: 'nope' });
    await page.handle({ type: 'showIds', value: true });
    expect(METER.test(html(page))).toBe(false);
  });
});

describe('AC-11 - no reading-time or conformance control', () => {
  it('neither appears anywhere on the page', () => {
    const markup = html(new OnboardingPage(fakes().deps));
    expect(markup).not.toMatch(/reading[- ]time|conformance/i);
  });
});

describe('the hero', () => {
  it('runs minspec.init on click, with the folder, once', async () => {
    const f = fakes();
    const page = new OnboardingPage(f.deps);
    expect(f.commands).toEqual([]);
    await page.handle({ type: 'run', hero: true });
    expect(f.commands).toEqual([['minspec.init', ['/fake/root']]]);
  });
});

// ═══ T0 - Slice 2: standing switches and meta-controls ══════════════════════

describe('INV-3 / AC-3 - a dismissal rides the #883 answeredSignatures store', () => {
  it('stays hidden until the state signature changes, then returns; no second store', async () => {
    const folder = tmpFolder({ optedIn: true });
    const sig = { current: 'drift-A' };
    const page = new OnboardingPage(
      buildPageDeps(folder, {}, { signatureFor: () => sig.current }),
    );
    const refreshVisible = () => 'refreshNow' in renderedRows(html(page));

    expect(refreshVisible()).toBe(true);
    await page.handle({ type: 'dismiss', rowId: 'refreshNow' });

    const prefs = JSON.parse(fs.readFileSync(path.join(folder, '.minspec', 'preferences.json'), 'utf-8'));
    expect(prefs.answeredSignatures).toEqual({ skipRefreshPrompt: 'drift-A' });
    expect(refreshVisible()).toBe(false); // same state: still hidden

    sig.current = 'drift-B'; // a genuine change
    expect(refreshVisible()).toBe(true);

    // Dismissing one offer never hides the other, and the single store is the only file written.
    await page.handle({ type: 'dismiss', rowId: 'refreshNow' });
    await page.handle({ type: 'dismiss', rowId: 'backfillEpics' });
    const merged = JSON.parse(fs.readFileSync(path.join(folder, '.minspec', 'preferences.json'), 'utf-8'));
    expect(merged.answeredSignatures).toEqual({ skipRefreshPrompt: 'drift-B', skipBackfillPrompt: 'drift-B' });
    expect(fs.readdirSync(path.join(folder, '.minspec'))).toEqual(['preferences.json']);
  });

  it('in a folder that has not opted in, it offers no dismissal and writes nothing', async () => {
    const folder = tmpFolder({ optedIn: false });
    const page = new OnboardingPage(buildPageDeps(folder, {}, { signatureFor: () => 'x' }));
    expect(html(page)).not.toContain('data-act="dismiss"');
    await page.handle({ type: 'dismiss', rowId: 'refreshNow' });
    expect(fs.readdirSync(folder)).toEqual([]); // no .minspec/ was manufactured
  });
});

describe('INV-5 - honest labelling', () => {
  it('silentRefresh renders disabled with a Planned tag and cannot be written', async () => {
    const f = fakes();
    const page = new OnboardingPage(f.deps);
    const markup = html(page);
    const row = /data-row="silentRefresh".*?<\/div><button[^>]*>/s.exec(markup)![0];
    expect(row).toContain('Planned');
    expect(row).toMatch(/disabled/);
    expect(row).not.toContain('data-act="toggle"');

    await page.handle({ type: 'toggle', settingId: 'minspec.silentRefresh', value: true });
    expect(f.writes).toEqual([]);
  });
});

describe('AC-4 - each switch reads and writes exactly its named setting', () => {
  it('writes the one named key, once, per live toggle row', async () => {
    const expected = [
      'minspec.autoClassifyOnCommit',
      'minspec.commitOnApprove',
      'minspec.advancePhaseOnApprove',
      'minspec.autoBootstrap.enabled',
    ];
    for (const id of expected) {
      const f = fakes();
      const page = new OnboardingPage(f.deps);
      await page.handle({ type: 'toggle', settingId: id, value: false });
      expect(f.writes, id).toEqual([[id, false]]);
    }
  });

  it('refuses a key the page does not own, and a non-boolean value', async () => {
    const f = fakes();
    const page = new OnboardingPage(f.deps);
    for (const id of [
      'minspec.pushOnApprove',
      'minspec.autoBackfillUseAi',
      'minspec.approverEmail',
      'minspec.coverage.minimumPercentage',
      'files.autoSave',
    ]) {
      await page.handle({ type: 'toggle', settingId: id, value: true });
    }
    await page.handle({ type: 'toggle', settingId: 'minspec.commitOnApprove', value: 'yes' });
    expect(f.writes).toEqual([]);
  });

  it('advancePhaseOnApprove renders ON by default; autoBackfillUseAi is never shown (FR-6, FR-8)', () => {
    expect(MANIFEST.contributes.configuration.properties['minspec.advancePhaseOnApprove'].default).toBe(true);
    const markup = html(new OnboardingPage(fakes().deps));
    const row = /data-row="advancePhaseOnApprove".*?<\/button>/s.exec(markup)![0];
    expect(row).toContain('aria-checked="true"');
    expect(markup).not.toContain('autoBackfillUseAi');
  });

  it('commitOnApprove is a single unified consent', () => {
    const markup = html(new OnboardingPage(fakes().deps));
    expect(markup.match(/data-setting="minspec\.commitOnApprove"/g)).toHaveLength(1);
  });

  it('the real writer honours scope and keeps a project-local preference in step', async () => {
    const folder = tmpFolder({ optedIn: true });
    fs.writeFileSync(
      path.join(folder, '.minspec', 'preferences.json'),
      JSON.stringify({ advancePhaseOnApprove: false }) + '\n',
    );
    const page = new OnboardingPage(buildPageDeps(folder, {}));
    // The project-local preference outranks the setting, so the switch shows what will happen.
    expect(/data-row="advancePhaseOnApprove".*?aria-checked="(\w+)"/s.exec(html(page))![1]).toBe('false');

    await page.handle({ type: 'toggle', settingId: 'minspec.advancePhaseOnApprove', value: true });
    expect(updates).toEqual([{ key: 'advancePhaseOnApprove', value: true, target: 2 }]);
    expect(JSON.parse(fs.readFileSync(path.join(folder, '.minspec', 'preferences.json'), 'utf-8'))).toEqual({
      advancePhaseOnApprove: true,
    });
    expect(/data-row="advancePhaseOnApprove".*?aria-checked="(\w+)"/s.exec(html(page))![1]).toBe('true');
  });

  it('writing a setting never CREATES a project-local preference', async () => {
    const folder = tmpFolder({ optedIn: true });
    const page = new OnboardingPage(buildPageDeps(folder, {}));
    await page.handle({ type: 'toggle', settingId: 'minspec.autoClassifyOnCommit', value: true });
    expect(fs.existsSync(path.join(folder, '.minspec', 'preferences.json'))).toBe(false);
  });
});

describe('AC-7 - whole-row click flips single-toggle rows only', () => {
  it('only toggle rows are row-clickable; email, coverage, refresh, backfill, install, planned are not', () => {
    const rows = renderedRows(html(new OnboardingPage(fakes().deps)));
    const clickable = Object.keys(rows).filter((id) => rows[id]).sort();
    expect(clickable).toEqual(
      ['advancePhaseOnApprove', 'autoBootstrapEnabled', 'autoClassifyOnCommit', 'commitOnApprove'].sort(),
    );
    for (const id of ['approverEmail', 'coverageMinimum', 'refreshNow', 'backfillEpics', 'installGitHubPrExtension', 'silentRefresh', 'hero']) {
      expect(rows[id], id).toBe(false);
    }
  });

  it('a row-click message path cannot mutate a field or fire a secondary control', async () => {
    // The row click is a click on the row's own switch, so it posts `toggle`. The model refuses
    // a toggle aimed at any non-toggle row, which is what stops a stray click mutating them.
    const f = fakes();
    const page = new OnboardingPage(f.deps);
    for (const id of ['minspec.approverEmail', 'minspec.coverage.minimumPercentage', 'minspec.silentRefresh']) {
      await page.handle({ type: 'toggle', settingId: id, value: true });
    }
    expect(f.writes).toEqual([]);
    expect(f.commands).toEqual([]);
    expect(f.install).not.toHaveBeenCalled();
  });
});

describe('AC-8 - setting ids, shortcuts, footer', () => {
  it('"Show setting ids" defaults off and the footer exposes autoBootstrap.enabled', () => {
    const page = new OnboardingPage(fakes().deps);
    const markup = html(page);
    expect(markup).toContain('<body>');
    expect(markup).not.toContain('class="show-ids"');
    expect(/data-row="showSettingIds".*?aria-checked="(\w+)"/s.exec(markup)![1]).toBe('false');
    expect(markup).toMatch(/data-row="autoBootstrapEnabled"[\s\S]*data-setting="minspec\.autoBootstrap\.enabled"/);
  });

  it('the toggle turns ids on and it survives the next render', async () => {
    const page = new OnboardingPage(fakes().deps);
    await page.handle({ type: 'showIds', value: true });
    expect(html(page)).toContain('<body class="show-ids">');
    await page.handle({ type: 'showIds', value: false });
    expect(html(page)).toContain('<body>');
  });

  it('shows a keybinding on exactly the rows that carry one, and invents none', () => {
    expect(html(new OnboardingPage(fakes().deps))).not.toContain('<kbd');

    const withKeys = html(
      new OnboardingPage(fakes({ hotkeys: { 'minspec.init': 'Alt+I', 'minspec.backfillEpics': 'Alt+B' } }).deps),
    );
    expect(withKeys.match(/<kbd[^>]*>[^<]*<\/kbd>/g)).toHaveLength(2);
    expect(/data-row="hero".*?<kbd[^>]*>Alt\+I<\/kbd>/s.test(withKeys)).toBe(true);
    expect(/data-row="backfillEpics".*?<kbd[^>]*>Alt\+B<\/kbd>/s.test(withKeys)).toBe(true);
    expect(/data-row="commitOnApprove"[^]*?<\/div><button/.exec(withKeys)![0]).not.toContain('<kbd');
  });

  it('builds the hotkey map from the manifest only', () => {
    const map = hotkeysFromManifest(MANIFEST as never);
    for (const [command, key] of Object.entries(map)) {
      expect(MANIFEST.contributes.keybindings.some((k) => k.command === command)).toBe(true);
      expect(key).toMatch(/[A-Z]/);
    }
    expect(hotkeysFromManifest(undefined)).toEqual({});
  });
});

// ═══ T0 - Slice 3: identity, per-action buttons, seed ═══════════════════════

describe('INV-1 / INV-4 / AC-14 - the gh read is click-gated', () => {
  it('never fires on render; fires once per Verify click', async () => {
    const f = fakes({}, { login: 'octo', id: 7, email: 'octo@corp.com' });
    const page = new OnboardingPage(f.deps);
    html(page);
    page.view();
    expect(f.lookup).not.toHaveBeenCalled();
    expect(html(page)).toContain('value="dev@example.com"'); // the offline seed
    expect(html(page)).not.toContain(escapeHtml(DIVERGENCE_COPY));

    await page.handle({ type: 'verifyGitHub' });
    expect(f.lookup).toHaveBeenCalledTimes(1);
  });

  it('air-gapped: lookup returns null or throws, the page still renders, the offline value stands', async () => {
    for (const gh of [null, 'throw'] as const) {
      const f = fakes({}, gh);
      const page = new OnboardingPage(f.deps);
      await expect(page.handle({ type: 'verifyGitHub' })).resolves.toBeUndefined();
      const markup = html(page);
      expect(markup).toContain('value="dev@example.com"');
      expect(markup).toContain('The offline value stands');
      expect(markup).not.toContain(escapeHtml(DIVERGENCE_COPY));
      expect(f.writes).toEqual([]);
    }
  });

  it('a valid but divergent email shows the amber flag and is NOT rejected', async () => {
    const f = fakes({}, { login: 'octo', id: 7, email: 'octo@corp.com' });
    const page = new OnboardingPage(f.deps);
    await page.handle({ type: 'verifyGitHub' });
    const markup = html(page);
    expect(markup).toContain(`<div class="amber" role="status">⚠ ${escapeHtml(DIVERGENCE_COPY)}</div>`);
    expect(markup).not.toContain('class="error"');
    expect(f.writes).toEqual([]); // flagging is not writing

    // ...and typing a different valid email is accepted as input (no format error), still flagged.
    await page.handle({ type: 'setField', settingId: 'minspec.approverEmail', value: 'me@elsewhere.org' });
    expect(html(page)).not.toContain('class="error"');
    expect(html(page)).toContain(escapeHtml(DIVERGENCE_COPY));
  });

  it('a matching email shows no flag', async () => {
    const f = fakes({ seedEmail: () => '7+octo@users.noreply.github.com' }, { login: 'octo', id: 7, email: null });
    const page = new OnboardingPage(f.deps);
    await page.handle({ type: 'verifyGitHub' });
    expect(html(page)).not.toContain(escapeHtml(DIVERGENCE_COPY));
    expect(html(page)).toContain('Matches your GitHub account');
  });

  it('the real lookup is never reached by rendering real deps', () => {
    const folder = tmpFolder({ optedIn: true });
    html(new OnboardingPage(buildPageDeps(folder, {})));
    expect(spawned.some((s) => s.file === 'gh')).toBe(false);
  });
});

describe('INV-4 / AC-5 - the approver field mints no sign-off and writes no machine-wide setting', () => {
  it('a full interaction leaves the approval store byte-identical', async () => {
    const folder = tmpFolder({ optedIn: true });
    const store = path.join(folder, '.minspec', 'approvals', 'specs', 'minspec', 'SPEC-001-x');
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, 'requirements.md.json'), '{"specHash":"abc"}\n');
    fs.writeFileSync(path.join(folder, '.minspec', 'preferences.json'), '{}\n');
    const approvalsBefore = snapshot(path.join(folder, '.minspec', 'approvals'));

    const page = new OnboardingPage(
      buildPageDeps(folder, {}, {
        lookupGhIdentity: async () => ({ login: 'octo', id: 7, email: null }),
        runCommand: async () => undefined,
        installGitHubPrExtension: async () => {},
      }),
    );
    await page.handle({ type: 'setField', settingId: 'minspec.approverEmail', value: 'human@example.com' });
    await page.handle({ type: 'verifyGitHub' });
    await page.handle({ type: 'toggle', settingId: 'minspec.advancePhaseOnApprove', value: true });
    await page.handle({ type: 'dismiss', rowId: 'refreshNow' });
    await page.handle({ type: 'setField', settingId: 'minspec.approverEmail', value: 'bad' });
    await page.handle({ type: 'openSetting', settingId: 'minspec.approverEmail' });

    expect(snapshot(path.join(folder, '.minspec', 'approvals'))).toEqual(approvalsBefore);
    // Nothing the page did touched the identity setting: it is machine-wide, so MinSpec never writes it.
    expect(updates.filter((u) => u.key === 'approverEmail')).toEqual([]);
    expect(updates.every((u) => u.target === 2)).toBe(true); // every write the page made was workspace-scoped
  });

  it('typing an email checks it and writes NOTHING; "Open in Settings" is the save path', async () => {
    const f = fakes();
    const page = new OnboardingPage(f.deps);
    await page.handle({ type: 'setField', settingId: 'minspec.approverEmail', value: ' you@example.com ' });
    expect(f.writes).toEqual([]);
    expect(html(page)).toContain('value="you@example.com"');
    expect(html(page)).toContain('Not saved here');
    expect(f.opened).toEqual([]);

    await page.handle({ type: 'openSetting', settingId: 'minspec.approverEmail' });
    expect(f.opened).toEqual(['minspec.approverEmail']);
    expect(f.writes).toEqual([]);
  });

  it('an invalid email shows a format error and no save hint', async () => {
    const f = fakes();
    const bad = new OnboardingPage(f.deps);
    await bad.handle({ type: 'setField', settingId: 'minspec.approverEmail', value: 'not-an-email' });
    expect(f.writes).toEqual([]);
    expect(html(bad)).toContain('class="error" role="alert"');
    expect(html(bad)).toContain('Enter a valid email address');
    expect(html(bad)).not.toContain('Not saved here');
  });

  it('openSetting opens only the approver setting, never a key the webview names', async () => {
    const f = fakes();
    const page = new OnboardingPage(f.deps);
    for (const id of ['minspec.pushOnApprove', 'files.autoSave', '', 42]) {
      await page.handle({ type: 'openSetting', settingId: id });
    }
    expect(f.opened).toEqual([]);
  });

  it('the real writer refuses an application-scoped setting outright (constitution invariant 3)', async () => {
    const folder = tmpFolder({ optedIn: true });
    const deps = buildPageDeps(folder, {});
    await expect(deps.writeSetting('minspec.approverEmail', 'a@b.co')).rejects.toThrow(/machine-wide/);
    expect(updates).toEqual([]);
  });

  it('real "Open in Settings" navigates the editor and writes nothing', async () => {
    const folder = tmpFolder({ optedIn: true });
    const vscode = await import('vscode');
    const page = new OnboardingPage(buildPageDeps(folder, {}));
    await page.handle({ type: 'openSetting', settingId: 'minspec.approverEmail' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'minspec.approverEmail');
    expect(updates).toEqual([]);
  });

  it('seeds from the offline resolver: the setting, else local git config', () => {
    const folder = tmpFolder({ optedIn: true });
    settings.set('approverEmail', 'configured@example.com');
    const markup = html(new OnboardingPage(buildPageDeps(folder, {})));
    expect(markup).toContain('value="configured@example.com"');
  });

  it("shows a blank field, not 'unknown', when there is no identity", () => {
    expect(html(new OnboardingPage(fakes({ seedEmail: () => '' }).deps))).toContain('id="approverEmail" data-act="field" data-setting="minspec.approverEmail" value=""');
  });
});

describe('Verify against GitHub is shown only when a lookup is wired', () => {
  it('with a lookup: the button renders; without one the page shows no dead button', () => {
    expect(html(new OnboardingPage(fakes().deps))).toContain('data-act="verifyGitHub"');
    const noLookup = fakes({ lookupGhIdentity: undefined }).deps;
    expect(html(new OnboardingPage(noLookup))).not.toContain('data-act="verifyGitHub"');
  });

  it('a verify message with no lookup does nothing and does not throw', async () => {
    const page = new OnboardingPage(fakes({ lookupGhIdentity: undefined }).deps);
    await expect(page.handle({ type: 'verifyGitHub' })).resolves.toBeUndefined();
    expect(html(page)).not.toContain('The offline value stands');
  });

  it('the production command wires no gh caller (a new one needs a README network row first)', () => {
    const folder = tmpFolder({ optedIn: true });
    const deps = buildPageDeps(folder, {});
    expect(deps.lookupGhIdentity).toBeUndefined();
    expect(html(new OnboardingPage(deps))).not.toContain('data-act="verifyGitHub"');
  });
});

describe('FR-14 / AC-6 / AC-12 / AC-13 - external actions fire only on click', () => {
  it('Backfill: zero on render, once on click, with { aiConsent: true } after the folder', async () => {
    const f = fakes();
    const page = new OnboardingPage(f.deps);
    html(page);
    expect(f.commands).toEqual([]);
    await page.handle({ type: 'run', rowId: 'backfillEpics' });
    expect(f.commands).toEqual([['minspec.backfillEpics', ['/fake/root', { aiConsent: true }]]]);
  });

  it('Refresh now: zero on render, once on click, as minspec.initRefresh', async () => {
    const f = fakes();
    const page = new OnboardingPage(f.deps);
    html(page);
    expect(f.commands).toEqual([]);
    await page.handle({ type: 'run', rowId: 'refreshNow' });
    expect(f.commands).toEqual([['minspec.initRefresh', ['/fake/root']]]);
  });

  it('Install: the button exists, installs on click only, and takes no second prompt', async () => {
    const f = fakes();
    const page = new OnboardingPage(f.deps);
    const markup = html(page);
    // An implementation that omits the button fails here.
    expect(markup).toMatch(/<button data-act="run" data-row-id="installGitHubPrExtension">Install<\/button>/);
    expect(f.install).not.toHaveBeenCalled();
    await page.handle({ type: 'run', rowId: 'installGitHubPrExtension' });
    expect(f.install).toHaveBeenCalledTimes(1);
    expect(f.commands).toEqual([]);
  });

  it('a run message naming a non-action row, an unknown row or junk does nothing', async () => {
    const f = fakes();
    const page = new OnboardingPage(f.deps);
    for (const m of [
      { type: 'run', rowId: 'commitOnApprove' },
      { type: 'run', rowId: 'approverEmail' },
      { type: 'run', rowId: 'nope' },
      { type: 'run' },
      { type: 'run', rowId: 42 },
      { type: 'bogus' },
      null,
      'text',
    ]) {
      await page.handle(m);
    }
    expect(f.commands).toEqual([]);
    expect(f.install).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
  });

  it('a rejected command surfaces to the caller rather than being swallowed', async () => {
    const f = fakes({
      runCommand: async () => {
        throw new Error('init failed');
      },
    });
    await expect(new OnboardingPage(f.deps).handle({ type: 'run', hero: true })).rejects.toThrow('init failed');
  });
});

describe('AC-9 - the coverage field is a non-enforced seed', () => {
  it('renders the manifest description verbatim, which says it is not enforced', () => {
    const markup = html(new OnboardingPage(fakes().deps));
    expect(markup).toContain(escapeHtml(COVERAGE_HELPER));
    expect(COVERAGE_HELPER).toMatch(/does NOT itself change an already-initialized project's enforced threshold/);
  });

  it('writes a number in range, and refuses anything else', async () => {
    const f = fakes();
    const page = new OnboardingPage(f.deps);
    await page.handle({ type: 'setField', settingId: 'minspec.coverage.minimumPercentage', value: '90' });
    expect(f.writes).toEqual([['minspec.coverage.minimumPercentage', 90]]);
    for (const bad of ['', 'abc', '101', '-1', 'NaN']) {
      await page.handle({ type: 'setField', settingId: 'minspec.coverage.minimumPercentage', value: bad });
    }
    expect(f.writes).toHaveLength(1);
    expect(html(page)).toContain('Enter a number from 0 to 100.');
  });

  it('refuses a setField for a key the page does not own', async () => {
    const f = fakes();
    await new OnboardingPage(f.deps).handle({ type: 'setField', settingId: 'minspec.pushOnApprove', value: 'always' });
    expect(f.writes).toEqual([]);
  });
});

describe('rendering escapes what it interpolates', () => {
  it('an email carrying markup cannot break out of the attribute', () => {
    const markup = html(new OnboardingPage(fakes({ seedEmail: () => '"><script>alert(1)</script>@x.io' }).deps));
    expect(markup).not.toContain('<script>alert(1)</script>');
    expect(markup).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('SPEC-086 (#2361) - the ScroogeLLM nudge stays gone; FR-12 and AC-10 are not built', () => {
  it('no row, no write and no markup mentions it', async () => {
    const f = fakes();
    const page = new OnboardingPage(f.deps);
    const markup = html(page);
    expect(markup).not.toMatch(/scrooge/i);
    expect(MANIFEST.contributes.configuration.properties['minspec.scroogellmNudge.enabled']).toBeUndefined();
    await page.handle({ type: 'toggle', settingId: 'minspec.scroogellmNudge.enabled', value: false });
    expect(f.writes).toEqual([]);
  });
});

describe('FR-1 re-open - show() on an open panel hands later messages to the NEW page', () => {
  it('a message after the second show() is handled by the second page, not the first', async () => {
    const vscodeMod = await import('vscode');
    let listener: ((m: unknown) => Promise<void>) | undefined;
    const fakePanel = {
      reveal: vi.fn(),
      onDidDispose: vi.fn(),
      webview: {
        html: '',
        cspSource: '',
        onDidReceiveMessage: (cb: (m: unknown) => Promise<void>) => {
          listener = cb;
          return { dispose: vi.fn() };
        },
      },
    };
    (vscodeMod.window.createWebviewPanel as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fakePanel);

    const first = new OnboardingPage(fakes().deps);
    const second = new OnboardingPage(fakes().deps);
    const firstHandle = vi.spyOn(first, 'handle').mockResolvedValue();
    const secondHandle = vi.spyOn(second, 'handle').mockResolvedValue();

    const panel = new GettingStartedPanel();
    panel.show(first);
    panel.show(second);
    await listener!({ type: 'showIds', value: true });

    expect(secondHandle).toHaveBeenCalledTimes(1);
    expect(firstHandle).not.toHaveBeenCalled();
  });
});
