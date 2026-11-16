/**
 * T0 - constitution invariant 3 applied to the bootstrap toast and to the
 * preference store behind it (#2355).
 *
 * The opt-in marker is `.minspec/` at the workspace root. The "not initialized"
 * toast is shown exactly when that marker is ABSENT, so remembering the answer
 * in `.minspec/preferences.json` made declining to opt in create the marker.
 * The property pinned here:
 *
 *   - no `.minspec/` at the root => no answer to any bootstrap toast (closing it,
 *     "Don't ask again", "Always", or a primary action whose command did not opt
 *     the folder in) creates ANY file or directory under that root;
 *   - the answer is still remembered, per folder, in the host's per-workspace
 *     memory, so a one-time prompt stays "ask once, then silence" across reloads;
 *   - the preference STORE itself refuses to bring `.minspec/` into existence,
 *     so no other caller can reintroduce the defect;
 *   - `.minspec/` already present => exactly the old behaviour: the file is read,
 *     the file is written, and an answer already recorded there is honoured.
 *
 * Real temp dirs, no fs mock: the assertion is on the whole recursive directory
 * listing, which sees a stray file anywhere under the root, not only a
 * `.minspec` directory. The opted-in cases are the control - they prove the same
 * `runBootstrap` and the same store really do write when allowed to, so the
 * "nothing created" cases cannot pass because the writer is simply dead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BOOTSTRAP_STEPS,
  runBootstrap,
  hasUnclassifiedChanges,
  isMinspecInitialized,
  loadPreferences,
  savePreferences,
  preferencesPath,
  PRE_OPT_IN_MEMORY_KEY_PREFIX,
  type BootstrapMemory,
  type BootstrapStep,
  type BootstrapVsCode,
} from '../src/lib/auto-bootstrap';
import { hasOptInMarker, NotOptedInError } from '../src/lib/preferences';

const DONT_ASK = "Don't ask again";

/** Every path under `dir`, relative, sorted - the whole observable write surface. */
function listTree(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = path.join(rel, entry.name);
    out.push(p);
    if (entry.isDirectory()) out.push(...listTree(dir, p));
  }
  return out.sort();
}

/**
 * A stand-in for VS Code's `workspaceState`: values survive for as long as the
 * object does, which models "the same workspace, reloaded". A NEW object models
 * a different workspace (or a wiped store).
 */
function makeMemory() {
  const data = new Map<string, unknown>();
  // Mirrors real `Memento.update`: writing `undefined` REMOVES the key, it
  // doesn't just store an undefined value under it (#2367 relies on this to
  // actually clear a stale pre-opt-in entry rather than leave it present).
  const update = vi.fn(async (key: string, value: unknown) => {
    if (value === undefined) data.delete(key);
    else data.set(key, value);
  });
  const memory: BootstrapMemory = {
    get: <T,>(key: string) => data.get(key) as T | undefined,
    update,
  };
  return { memory, update, data };
}

function makeHost(
  response: string | undefined,
  memory?: BootstrapMemory,
  onCommand?: (folder?: string) => void,
) {
  const showPrompt = vi.fn(async () => response);
  const executeCommand = vi.fn(async (_id: string, folder?: string) => {
    onCommand?.(folder);
  });
  const host: BootstrapVsCode = {
    isEnabled: () => true,
    showPrompt,
    executeCommand,
    ...(memory ? { preOptInMemory: memory } : {}),
  };
  return { host, showPrompt, executeCommand };
}

/** A step that is eligible in ANY folder, opted in or not, with an "Always". */
function anyFolderStep(overrides: Partial<BootstrapStep> = {}): BootstrapStep {
  return {
    kind: 'classify',
    shouldRun: (_root, prefs) => !prefs.skipClassifyPrompt,
    message: 'probe step',
    primaryAction: 'Go',
    commandId: 'probe.go',
    skipPrefKey: 'skipClassifyPrompt',
    signature: () => 'state-1',
    ...overrides,
  };
}

let root: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-opt-in-')));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('T0 invariant 3: answering a bootstrap toast in a folder that did not opt in creates nothing (#2355)', () => {
  it('guard: the temp root starts empty and not opted in', () => {
    expect(listTree(root)).toEqual([]);
    expect(isMinspecInitialized(root)).toBe(false);
  });

  it.each([
    ['the toast is closed (the X)', undefined],
    ['"Don\'t ask again" is clicked', DONT_ASK],
    ['"Initialize" is clicked but the command does not opt the folder in', 'Initialize'],
  ])('the real init toast creates nothing when %s', async (_name, answer) => {
    const { memory } = makeMemory();
    const { host, showPrompt } = makeHost(answer, memory);

    const result = await runBootstrap(root, host);

    // Not vacuous: the toast really was offered, for the init step.
    expect(result.offered).toBe('init');
    expect(showPrompt).toHaveBeenCalledTimes(1);
    expect(listTree(root)).toEqual([]);
  });

  it('creates nothing when the host supplies no per-workspace memory at all', async () => {
    for (const answer of [undefined, DONT_ASK, 'Initialize']) {
      const { host } = makeHost(answer);
      const result = await runBootstrap(root, host);
      expect(result.offered).toBe('init');
      expect(listTree(root)).toEqual([]);
    }
  });

  it('creates nothing for ANY step answered before opt-in, including "Always"', async () => {
    const step = anyFolderStep({
      alwaysAction: 'Always',
      alwaysPrefKey: 'autoClassifyOnCommit',
    });
    for (const answer of [undefined, DONT_ASK, 'Go', 'Always']) {
      const { memory } = makeMemory();
      const { host, showPrompt } = makeHost(answer, memory);
      const result = await runBootstrap(root, host, [step]);
      expect(result.offered).toBe('classify');
      expect(showPrompt).toHaveBeenCalledTimes(1);
      expect(listTree(root)).toEqual([]);
    }
  });
});

/** A git repo with fresh staging activity: the state the classify detector fires on. */
function stageActivity(dir: string): void {
  fs.mkdirSync(path.join(dir, '.git'));
  const head = path.join(dir, '.git', 'HEAD');
  const index = path.join(dir, '.git', 'index');
  fs.writeFileSync(head, 'ref: refs/heads/main\n');
  fs.writeFileSync(index, 'binary index contents');
  const now = Date.now();
  fs.utimesSync(head, (now - 60000) / 1000, (now - 60000) / 1000);
  fs.utimesSync(index, now / 1000, now / 1000);
}

describe('T0: a detector cannot create the opt-in marker either (#2355)', () => {
  it('hasUnclassifiedChanges leaves a non-opted-in git repo untouched and reports nothing to classify', () => {
    stageActivity(root);
    const before = listTree(root);

    expect(hasUnclassifiedChanges(root)).toBe(false);
    expect(listTree(root)).toEqual(before);
  });

  it('control: the same staging activity IS detected once the folder has opted in', () => {
    stageActivity(root);
    fs.mkdirSync(path.join(root, '.minspec'));

    expect(hasUnclassifiedChanges(root)).toBe(true);
    expect(listTree(root)).toContain(path.join('.minspec', 'classifications'));
  });
});

describe('T0: a declined prompt is still asked only once, without a file (#2355)', () => {
  it.each([
    ['closed', undefined],
    ['"Don\'t ask again"', DONT_ASK],
  ])('init toast %s is not shown again on reload of the same workspace', async (_n, answer) => {
    const { memory, update } = makeMemory();

    const first = makeHost(answer, memory);
    await runBootstrap(root, first.host);
    expect(first.showPrompt).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);

    // "Reload": a fresh host object, the same workspace memory.
    const second = makeHost(answer, memory);
    const result = await runBootstrap(root, second.host);
    expect(second.showPrompt).not.toHaveBeenCalled();
    expect(result.offered).toBeNull();
    expect(listTree(root)).toEqual([]);
  });

  it('control: a DIFFERENT workspace memory asks again, so the memory is what silences it', async () => {
    const a = makeMemory();
    await runBootstrap(root, makeHost(undefined, a.memory).host);

    const b = makeMemory();
    const again = makeHost(undefined, b.memory);
    await runBootstrap(root, again.host);
    expect(again.showPrompt).toHaveBeenCalledTimes(1);
  });

  it('an "Always" taken before opt-in is honoured on reload (the step runs itself, unasked)', async () => {
    const step = anyFolderStep({
      alwaysAction: 'Always',
      alwaysPrefKey: 'autoClassifyOnCommit',
    });
    const { memory } = makeMemory();
    await runBootstrap(root, makeHost('Always', memory).host, [step]);

    const second = makeHost(undefined, memory);
    await runBootstrap(root, second.host, [step]);
    expect(second.showPrompt).not.toHaveBeenCalled();
    expect(second.executeCommand).toHaveBeenCalledTimes(1);
    expect(listTree(root)).toEqual([]);
  });

  it('is per folder: declining in one folder of a multi-root workspace does not silence another', async () => {
    const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-opt-in-b-')));
    try {
      const { memory } = makeMemory();
      await runBootstrap(root, makeHost(DONT_ASK, memory).host);

      const inOther = makeHost(undefined, memory);
      const result = await runBootstrap(other, inOther.host);
      expect(inOther.showPrompt).toHaveBeenCalledTimes(1);
      expect(result.offered).toBe('init');

      const backInRoot = makeHost(undefined, memory);
      await runBootstrap(root, backInRoot.host);
      expect(backInRoot.showPrompt).not.toHaveBeenCalled();
      expect(listTree(other)).toEqual([]);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('a signature answer is re-asked when the state changes (#883 semantics kept)', async () => {
    let state = 'state-1';
    const step = anyFolderStep({ signature: () => state });
    const { memory } = makeMemory();
    await runBootstrap(root, makeHost(undefined, memory).host, [step]);

    const same = makeHost(undefined, memory);
    await runBootstrap(root, same.host, [step]);
    expect(same.showPrompt).not.toHaveBeenCalled();

    state = 'state-2';
    const moved = makeHost(undefined, memory);
    await runBootstrap(root, moved.host, [step]);
    expect(moved.showPrompt).toHaveBeenCalledTimes(1);
    expect(listTree(root)).toEqual([]);
  });

  it('answers to two different steps in one folder do not overwrite each other', async () => {
    const one = anyFolderStep();
    const two = anyFolderStep({
      kind: 'backfill',
      skipPrefKey: 'skipBackfillPrompt',
      shouldRun: (_r, prefs) => !prefs.skipBackfillPrompt,
    });
    const { memory } = makeMemory();
    await runBootstrap(root, makeHost(undefined, memory).host, [one, two]); // answers `one`
    await runBootstrap(root, makeHost(undefined, memory).host, [one, two]); // answers `two`

    const third = makeHost(undefined, memory);
    const result = await runBootstrap(root, third.host, [one, two]);
    expect(third.showPrompt).not.toHaveBeenCalled();
    expect(result.offered).toBeNull();
  });
});

describe('T0: the preference store never creates the opt-in marker (#2355)', () => {
  it('savePreferences refuses, visibly, in a folder without .minspec/ and creates nothing', () => {
    expect(() => savePreferences(root, { skipInitPrompt: true })).toThrow(NotOptedInError);
    expect(() => savePreferences(root, { advancePhaseOnApprove: true })).toThrow(/\.minspec/);
    expect(listTree(root)).toEqual([]);
  });

  it('a FILE named .minspec is never replaced by a directory: the write fails and the file is untouched', () => {
    fs.writeFileSync(path.join(root, '.minspec'), 'not a directory');
    expect(() => savePreferences(root, { skipInitPrompt: true })).toThrow();
    expect(listTree(root)).toEqual(['.minspec']);
    expect(fs.readFileSync(path.join(root, '.minspec'), 'utf-8')).toBe('not a directory');
  });

  it('an empty root (no folder open) is refused and nothing lands in the working directory', () => {
    // `path.join('', '.minspec')` resolves against the working directory. When the
    // suite runs from this repository's root that directory IS a MinSpec project,
    // which is the live hazard: without the explicit empty-root check the store
    // answers "opted in" and writes the repo's own preferences file.
    const cwdPrefs = path.resolve('.minspec', 'preferences.json');
    const read = () => (fs.existsSync(cwdPrefs) ? fs.readFileSync(cwdPrefs, 'utf-8') : null);
    const before = read();

    expect(hasOptInMarker('')).toBe(false);
    expect(isMinspecInitialized('')).toBe(false);
    expect(() => savePreferences('', { skipInitPrompt: true })).toThrow(NotOptedInError);
    expect(read()).toBe(before);
  });
});

describe('control: an opted-in folder behaves exactly as before (#2355)', () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(root, '.minspec'));
  });

  it('savePreferences writes and merges .minspec/preferences.json', () => {
    savePreferences(root, { skipInitPrompt: true });
    savePreferences(root, { advancePhaseOnApprove: true });
    expect(listTree(root)).toEqual(['.minspec', path.join('.minspec', 'preferences.json')]);
    expect(JSON.parse(fs.readFileSync(preferencesPath(root), 'utf-8'))).toEqual({
      skipInitPrompt: true,
      advancePhaseOnApprove: true,
    });
  });

  it('a dismissed toast is recorded in the FILE, and the workspace memory is never touched', async () => {
    const { memory, update } = makeMemory();
    const step = anyFolderStep();
    await runBootstrap(root, makeHost(undefined, memory).host, [step]);

    expect(loadPreferences(root).answeredSignatures).toEqual({ skipClassifyPrompt: 'state-1' });
    expect(update).not.toHaveBeenCalled();
  });

  it('"Don\'t ask again" and "Always" are recorded in the FILE', async () => {
    const { memory, update } = makeMemory();
    await runBootstrap(root, makeHost(DONT_ASK, memory).host, [anyFolderStep()]);
    expect(loadPreferences(root).skipClassifyPrompt).toBe(true);

    const always = anyFolderStep({
      kind: 'backfill',
      skipPrefKey: 'skipBackfillPrompt',
      shouldRun: (_r, prefs) => !prefs.skipBackfillPrompt,
      alwaysAction: 'Always',
      alwaysPrefKey: 'autoClassifyOnCommit',
    });
    await runBootstrap(root, makeHost('Always', memory).host, [always]);
    expect(loadPreferences(root).autoClassifyOnCommit).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it('a dismissal already recorded in the file is still honoured', async () => {
    fs.writeFileSync(
      preferencesPath(root),
      JSON.stringify({ answeredSignatures: { skipClassifyPrompt: 'state-1' } }),
    );
    const sig = makeHost(undefined, makeMemory().memory);
    await runBootstrap(root, sig.host, [anyFolderStep()]);
    expect(sig.showPrompt).not.toHaveBeenCalled();

    fs.writeFileSync(preferencesPath(root), JSON.stringify({ skipClassifyPrompt: true }));
    const flag = makeHost(undefined, makeMemory().memory);
    await runBootstrap(root, flag.host, [anyFolderStep({ signature: () => 'other-state' })]);
    expect(flag.showPrompt).not.toHaveBeenCalled();
  });

  it('the file, not a stale pre-opt-in memory, is the authority once the folder has opted in', async () => {
    // Memory says "never ask"; the folder has since opted in and its file says nothing.
    const { memory } = makeMemory();
    fs.rmdirSync(path.join(root, '.minspec'));
    await runBootstrap(root, makeHost(DONT_ASK, memory).host, [anyFolderStep()]);
    fs.mkdirSync(path.join(root, '.minspec'));

    const after = makeHost(undefined, memory);
    await runBootstrap(root, after.host, [anyFolderStep()]);
    expect(after.showPrompt).toHaveBeenCalledTimes(1);
  });

  it('a stale pre-opt-in entry is deleted, not merely ignored, once the folder has opted in (#2367)', async () => {
    const { memory, update, data } = makeMemory();
    const key = PRE_OPT_IN_MEMORY_KEY_PREFIX + root;
    data.set(key, { skipClassifyPrompt: true });
    // A second folder's entry must survive - this is per-folder cleanup, not a wipe.
    const otherKey = PRE_OPT_IN_MEMORY_KEY_PREFIX + '/some/other/folder';
    data.set(otherKey, { skipInitPrompt: true });

    await runBootstrap(root, makeHost(undefined, memory).host, [anyFolderStep()]);

    expect(data.has(key)).toBe(false);
    expect(update).toHaveBeenCalledWith(key, undefined);
    expect(data.get(otherKey)).toEqual({ skipInitPrompt: true });
  });

  it('does not write to memory at all when the folder never had a pre-opt-in entry', async () => {
    const { memory, update } = makeMemory();
    await runBootstrap(root, makeHost(undefined, memory).host, [anyFolderStep()]);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('control: a real opt-in through the toast still records to the file (#2355)', () => {
  it('"Initialize" whose command creates .minspec/ records the answer in preferences.json', async () => {
    const { memory, update } = makeMemory();
    const { host } = makeHost('Initialize', memory, (folder) => {
      fs.mkdirSync(path.join(folder as string, '.minspec'));
    });

    const result = await runBootstrap(root, host);

    expect(result.offered).toBe('init');
    expect(isMinspecInitialized(root)).toBe(true);
    expect(loadPreferences(root).answeredSignatures).toEqual({ skipInitPrompt: 'uninit' });
    expect(update).not.toHaveBeenCalled();
  });

  it('the shipped step list has exactly one step that can run before opt-in: init', () => {
    const eligible = BOOTSTRAP_STEPS.filter((s) => {
      try {
        return s.shouldRun(root, {});
      } catch {
        return false;
      }
    });
    expect(eligible.map((s) => s.skipPrefKey)).toEqual(['skipInitPrompt']);
  });
});
