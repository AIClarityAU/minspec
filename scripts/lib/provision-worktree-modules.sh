#!/usr/bin/env bash
# provision-worktree-modules.sh - give an agent worktree its OWN node_modules (#3238).
#
# A fresh `git worktree add` has no node_modules (gitignored), and the agent sandbox has
# no network, so the agent's own `npm ci` cannot fix it. Installing here, from the local
# npm cache, is the parent's job. NEVER a symlink to another tree's node_modules: the
# agent may run `npm ci`, which deletes through a link and emptied a primary's tree
# (#3224). --ignore-scripts: the worktree is an untrusted PR branch and this runs in the
# launcher, so the install goes through the agent's scrubbed environment ($AGENT_LAUNCH_ENV,
# no token) and no lifecycle script of the tree may run. Fails closed: returns non-zero with a message unless the toolchain runs.
#
# --offline and --ignore-scripts do not stop the tree steering npm itself. npm reads a
# `.npmrc` committed in the tree, and fetches whatever `resolved` source the lockfile names:
# measured with npm 10.9.9, a tree's `git=<path>` plus a git dependency made
# `npm ci --offline --ignore-scripts` execute <path>, and a git dependency reaches the
# network despite --offline. So, before npm starts: a tree with its own .npmrc is refused,
# and every lockfile entry must be a registry.npmjs.org tarball or a workspace link that
# stays inside the tree. --git=false backs that up should a git source get past the check.
#
# Usage: source this file, then `provision_worktree_modules <worktree>`.

provision_worktree_modules() {
  local wt="$1"
  if [[ -L "${wt}/node_modules" ]]; then
    echo "  node_modules in ${wt} is a symlink; refusing to install through it (#3224)." >&2
    return 1
  fi
  if [[ -e "${wt}/.npmrc" || -L "${wt}/.npmrc" ]]; then
    echo "  ${wt} carries its own .npmrc; refusing to let the tree configure npm." >&2
    return 1
  fi
  # `npm ci` reads npm-shrinkwrap.json in preference to package-lock.json, so a shrinkwrap
  # would bypass the lockfile vetting below: refuse it the way .npmrc is refused.
  if [[ -e "${wt}/npm-shrinkwrap.json" || -L "${wt}/npm-shrinkwrap.json" ]]; then
    echo "  ${wt} carries npm-shrinkwrap.json, which npm would use instead of the vetted package-lock.json; refusing to install." >&2
    return 1
  fi
  local bad
  # jq exits non-zero on a missing or unparseable lockfile, and `error` on one without a
  # v2+ packages map: either way nothing is printed and the install is refused.
  if ! bad=$(jq -r '
      if (.lockfileVersion | type) == "number" and .lockfileVersion >= 2
         and (.packages | type) == "object"
      then .packages | to_entries[] | select(.key != "")
        | def intree: type == "string" and (startswith("/") | not)
            and (split("/") | index("..") == null);
          select(
            if (.key | intree | not) then true
            elif .value.link == true then (.value.resolved | intree | not)
            elif (.key | test("(^|/)node_modules/")) then
              ((.value.resolved | type) != "string"
               or (.value.resolved | startswith("https://registry.npmjs.org/") | not))
            else .value.resolved != null
            end)
        | "\(.key) resolved=\(.value.resolved // "<none>")"
      else error("no lockfileVersion>=2 packages map") end
    ' "${wt}/package-lock.json" 2>/dev/null); then
    echo "  ${wt}/package-lock.json is missing, unreadable or not a v2+ lockfile; refusing to install." >&2
    return 1
  fi
  if [[ -n "$bad" ]]; then
    echo "  ${wt}/package-lock.json names sources other than the npm registry or an in-tree workspace; refusing to install:" >&2
    sed 's/^/    /' <<<"$bad" >&2
    return 1
  fi
  # An unset launcher makes this `bash ""`, which fails: no scrubbed environment, no install.
  if ! (cd "$wt" && bash "$AGENT_LAUNCH_ENV" npm ci --offline --ignore-scripts --git=false --no-audit --no-fund >&2); then
    echo "  node_modules: 'npm ci --offline' failed in ${wt}." >&2
    return 1
  fi
  if [[ -L "${wt}/node_modules" || ! -x "${wt}/node_modules/.bin/tsx" ]] \
     || ! (cd "$wt" && node -e "require.resolve('handlebars',{paths:['.','packages/minspec']})" >/dev/null 2>&1); then
    echo "  node_modules: install left no runnable toolchain (tsx/handlebars) in ${wt}." >&2
    return 1
  fi
}
