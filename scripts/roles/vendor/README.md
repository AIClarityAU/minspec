# Vendored `agency-agents` role prompts (DR-004 / #230)

Reference copies of upstream role prompts from
[msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) (MIT), pinned
to the commit recorded in [`agency-agents.lock.json`](agency-agents.lock.json).

## What this is — and isn't

- **Is:** a pinned, reviewed-on-bump reference tree for the 5 roles MinSpec actually
  dispatches (`scripts/roles/{architect,dev,reviewer,security,triage}.md`), per the
  fence in #232 ("adopt the 5 roles MinSpec actually dispatches... do NOT import a
  catalog"). `triage` has no upstream match and carries no vendor file.
- **Isn't:** a live dependency, a submodule, or an auto-merge source. MinSpec's own role
  files under `scripts/roles/` are hand-authored and carry MinSpec-specific invariants
  (CLAUDE.md invariants, inv-10 keychain, inv-11 localhost proxy bind, the TODO/stub
  gate) that upstream knows nothing about — never overwritten wholesale by a sync.

## Refresh = reviewed bump, never auto (#231 decision)

Run `scripts/sync-agency-agents.sh [<commit-sha>]` to re-fetch the mapped files at a new
pinned commit into this directory and update the lockfile. The script only **writes into
`vendor/`** — it never touches `scripts/roles/*.md` directly. After running it:

1. `git diff scripts/roles/vendor/` to see what changed upstream.
2. Decide, per role, whether anything in the diff is worth folding into the hand-authored
   overlay (`scripts/roles/<role>.md`) — a deliberate edit, not an automatic overwrite.
3. Update `reviewedBy` in the lockfile once a human has looked at the diff.

## Attribution

Upstream license: [`LICENSE`](LICENSE) (MIT, msitarzewski/agency-agents). Retained
verbatim per #231's bundling decision, even though attribution is not strictly required
by MIT for internal reference use.
