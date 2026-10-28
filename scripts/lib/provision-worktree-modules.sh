#!/usr/bin/env bash
# provision-worktree-modules.sh - give an agent worktree its OWN node_modules (#3238).
#
# A fresh `git worktree add` has no node_modules (gitignored), and the agent sandbox has
# no network, so the agent's own `npm ci` cannot fix it. Installing here, from the local
# npm cache, is the parent's job. NEVER a symlink to another tree's node_modules: the
# agent may run `npm ci`, which deletes through a link and emptied a primary's tree
# (#3224). Fails closed: returns non-zero with a message unless the toolchain runs.
#
# Usage: source this file, then `provision_worktree_modules <worktree>`.

provision_worktree_modules() {
  local wt="$1"
  if [[ -L "${wt}/node_modules" ]]; then
    echo "  node_modules in ${wt} is a symlink; refusing to install through it (#3224)." >&2
    return 1
  fi
  if ! (cd "$wt" && npm ci --offline --no-audit --no-fund >&2); then
    echo "  node_modules: 'npm ci --offline' failed in ${wt}." >&2
    return 1
  fi
  if [[ -L "${wt}/node_modules" || ! -x "${wt}/node_modules/.bin/tsx" ]] \
     || ! (cd "$wt" && node -e "require('handlebars')" >/dev/null 2>&1); then
    echo "  node_modules: install left no runnable toolchain (tsx/handlebars) in ${wt}." >&2
    return 1
  fi
}
