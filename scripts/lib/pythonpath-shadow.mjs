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

// Top-level modules the ms-python unittest/pytest adapters import. `coverage` is the
// one that bit us; the rest would fail the same way if a tool dropped a same-named dir.
export const ADAPTER_MODULES = ['coverage', 'unittest', 'pytest', 'pluginmanager', 'unittestadapter', 'vscode_pytest'];

/**
 * @param {string} root directory that becomes PYTHONPATH
 * @returns {{module: string, entry: string, kind: 'directory'|'file'}[]}
 */
export function findShadowingEntries(root, modules = ADAPTER_MODULES) {
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
        hits.push({ module: m, entry, kind });
      }
    }
  }
  return hits;
}
