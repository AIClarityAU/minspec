#!/usr/bin/env node
// Is the current directory a runnable toolchain? (#3238) Exit 0 only when node_modules is
// a real directory (never a link into a shared tree), node_modules/.bin/tsx is
// executable, and `handlebars` resolves FROM the current directory. Run by
// remediate-pr.sh through the token-free allowlist, with the worktree as cwd; this file
// itself comes from the launcher's tree, not the pull request's.
const fs = require('fs');
const path = require('path');
const cwd = process.cwd();
try {
  const nm = path.join(cwd, 'node_modules');
  if (!fs.lstatSync(nm).isDirectory()) throw new Error('node_modules is not a real directory');
  fs.accessSync(path.join(nm, '.bin', 'tsx'), fs.constants.X_OK);
  require(require.resolve('handlebars', { paths: [cwd] }));
} catch (e) {
  process.stderr.write(`worktree-toolchain-check: ${e.message}\n`);
  process.exit(1);
}
