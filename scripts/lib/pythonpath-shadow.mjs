// pythonpath-shadow.mjs — detect repo-root entries that shadow a module the
// ms-python test adapter imports (#1185).
//
// ms-python injects PYTHONPATH=<workspace root> for some profiles (Coverage). Python
// puts PYTHONPATH ahead of site-packages, and a bare directory with no __init__.py is
// an importable PEP 420 namespace package. So Vitest's gitignored `coverage/` report
// directory makes `import coverage` succeed as an empty namespace package when
// coverage.py is not installed; `coverage.__version__` then raises AttributeError at
// unittestadapter/execution.py module level, the adapter exits 1 with no results, and
// every requested test is stamped "error".
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Top-level modules the ms-python unittest/pytest adapters import. `coverage` is the
// one that bit us; the rest would fail the same way if a tool dropped a same-named dir.
export const ADAPTER_MODULES = ['coverage', 'unittest', 'pytest', 'pluginmanager', 'unittestadapter', 'vscode_pytest'];

/**
 * @param {string} root directory that becomes PYTHONPATH
 * @returns {{module: string, entry: string, kind: 'directory'|'file'}[]}
 */
export function findShadowingEntries(root, modules = ADAPTER_MODULES, isInstalled = () => false) {
  const hits = [];
  for (const m of modules) {
    for (const [entry, kind] of [[m, 'directory'], [`${m}.py`, 'file']]) {
      let st;
      try {
        st = fs.statSync(path.join(root, entry));
      } catch {
        continue; // absent is the good case
      }
      if (kind === 'directory' ? st.isDirectory() : st.isFile()) {
        // A bare directory is only a PEP 420 NAMESPACE package, which Python uses
        // solely when no regular package of that name exists on the path. So when the
        // real module is installed the directory is harmless (this repo's Vitest
        // coverage/ report dir is intentional). A .py file or a directory holding
        // __init__.py is a regular module and wins regardless.
        if (kind === 'directory' && !fs.existsSync(path.join(root, entry, '__init__.py')) && isInstalled(m)) continue;
        hits.push({ module: m, entry, kind });
      }
    }
  }
  return hits;
}

/**
 * True when `module` imports from the real interpreter install. The probe runs with
 * PYTHONPATH removed from the env and cwd '/', so it cannot be fooled by the very
 * directory under test. It deliberately does NOT use `-I`: `-I` also skips the user
 * site-packages, so a `pip install --user coverage` (exactly what the checker tells
 * you to do) would still read as missing.
 *
 * LIMIT: this asks the bare `python3` on PATH, while the extension runs the
 * workspace-selected interpreter (often a venv). A module installed only in that venv
 * reads as missing here, which fails closed (the checker keeps flagging the entry).
 * A missing python3 or a failed import is likewise reported as not installed.
 *
 * @param {string} module
 * @param {typeof spawnSync} [spawn] injectable for tests
 */
export function pythonModuleInstalled(module, spawn = spawnSync) {
  const env = { ...process.env };
  delete env.PYTHONPATH;
  const r = spawn('python3', ['-c', `import ${module}`], { stdio: 'ignore', cwd: '/', env });
  return r.status === 0;
}
