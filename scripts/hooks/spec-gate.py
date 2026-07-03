#!/usr/bin/env python3
"""MinSpec PreToolUse spec gate (DR-362, amended by SPEC-022 / DR-034, scoped #426).

Reads a Claude Code PreToolUse hook envelope on stdin and prints a JSON
permission decision on stdout. Blocks Edit/Write/MultiEdit to a file ONLY when
that file belongs to the OWNED FILE SET of a T3/T4 spec that DERIVES to
`implementing`/`done` and is unapproved (or approved then edited -> stale). This
is the only enforcement that survives bypass-permissions mode, because a
PreToolUse deny blocks the tool call before permission rules.

#426 scoping (DR-047 §3 — "doc-before-code for THAT doc, not a global freeze").
  Earlier this gate blocked EVERY non-allowlisted source file while ANY unapproved
  spec was in implementation — freezing unrelated work (e.g. a sibling P1 fix)
  behind a spec it had nothing to do with. That contradicted DR-047 §3, which
  scopes the doc-before-code sequence PAIRWISE to a doc and the code that realises
  THAT doc, never repo-wide. The block is now scoped to each unapproved spec's own
  file set:
    (3a) its own artifacts — the per-spec `SPEC-NNN-*/` directory (or, for the flat
         umbrella spec, its same-id sibling docs). ALWAYS owned; the fail-safe
         minimum even when nothing else is derivable.
    (3b) source files it EXPLICITLY names as implementation targets — a frontmatter
         `implements:`/`affects:` list (forward-compatible; not in the corpus yet)
         or backtick code-span paths in its own `tasks.md`, filtered to existing
         source files so prose/placeholder tokens never match.
    (3c) a spec that declares NO implementation files freezes only (3a); unrelated
         source edits pass (fail-OPEN for unrelated files is correct per DR-047 §3).
  A structured spec->impl-file convention (a first-class frontmatter glob list) is
  a follow-up (see #426); until it lands, (3a)+(3b) are the derivation.

SPEC-022 changes:
  - Approval ground truth is COMMITTED, path-keyed sidecars under
    `.minspec/approvals/<repo-relative-spec-path>.json`, read from `cwd` FIRST.
    The DR-031 `--git-common-dir` resolution is demoted to a FALLBACK for an
    uncommitted local approval during authoring — a committed sidecar exists in
    every clone/worktree/CI checkout, so the common-dir read is no longer
    load-bearing.
  - Status is DERIVED from {phases, approval}, not the literal `status:` line —
    so `implementing`/`done` is structurally impossible without an approval.
  - Hashing is CANONICAL (canonical.py's spec_hash), excluding the lifecycle
    fields, so the tool's own status flips don't void approval.
  - WARN phase (FR-5): a `migrated:true` sidecar counts as approved (non-blocking)
    but its message notes "approval migrated — re-approve to clear". Promotion to
    ERROR (migrated/drift -> deny) is a separate, later one-line change.

Invoked by spec-gate.sh (which handles the MINSPEC_GATE_OFF kill-switch).
"""
import json
import sys
import os
import re
import glob
import subprocess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import canonical  # noqa: E402  (sibling module; canonical.py spec_hash twin)


def allow():
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow"}}))
    sys.exit(0)


def passthrough():
    # Emit nothing -> Claude Code falls back to its normal permission flow.
    sys.exit(0)


def deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason}}))
    sys.exit(0)


def fm_value(text, key):
    m = re.search(r'^' + re.escape(key) + r':\s*(.+?)\s*$', text, re.M)
    return m.group(1).strip() if m else None


def spec_hash(path):
    """Canonical spec hash (FR-3) of a file, or None if unreadable."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return canonical.spec_hash(fh.read())
    except Exception:
        return None


def parse_phases(fm):
    """Extract the `phases:` map from a frontmatter block as {phase: status}."""
    phases = {}
    in_block = False
    for line in fm.split("\n"):
        if in_block:
            m = re.match(r'^[ \t]+(\w[\w-]*)[ \t]*:[ \t]*(.+?)[ \t]*(?:#.*)?$', line)
            if re.match(r'^[ \t]+', line):
                if m:
                    phases[m.group(1)] = m.group(2).strip()
                continue
            in_block = False
        if re.match(r'^phases[ \t]*:', line):
            in_block = True
    return phases


_PHASE_ORDER = ["specify", "clarify", "plan", "tasks", "implement"]


def _all_pending(phases):
    return all(phases.get(p, "pending") == "pending" for p in _PHASE_ORDER)


def _all_required_done(phases):
    for p in _PHASE_ORDER:
        st = phases.get(p, "pending")
        if st in ("pending", "in-progress"):
            return False
    return True


def _current_phase(phases):
    """First in-progress phase, else first pending phase, else None (complete)."""
    for p in _PHASE_ORDER:
        if phases.get(p, "pending") == "in-progress":
            return p
    for p in _PHASE_ORDER:
        if phases.get(p, "pending") == "pending":
            return p
    return None


def phase_intent_status(phases, explicit_terminal):
    """Phase-position status — the gate's "is this spec in implementation?" test.

    Mirrors lifecycle.ts getSpecStatus (the preview-only, phase-based derivation):
    distinguishes specify/clarify (-> specifying) from plan/tasks/implement
    (-> implementing) by the CURRENT phase, NOT by approval. The gate uses THIS to
    decide whether a spec is gated (in the plan+ implementation range) — then the
    real approval verdict decides allow/deny. Using deriveStatus here instead
    would mis-gate a specify-phase spec, because deriveStatus discriminates
    specifying<->implementing by approval, not phase.
    """
    if explicit_terminal:
        return explicit_terminal
    if _all_pending(phases):
        return "new"
    if _all_required_done(phases):
        return "done"
    cur = _current_phase(phases)
    if cur in ("specify", "clarify"):
        return "specifying"
    return "implementing"


def canonical_minspec_dir(cwd):
    """Resolve the canonical (main worktree) .minspec/ dir for `cwd` (DR-031).

    DEMOTED to a fallback under SPEC-022: committed sidecars under cwd are read
    first; this only covers an uncommitted local approval during authoring when
    the cwd sidecar is absent. Returns the abs path to `<main-worktree>/.minspec`,
    or None if git is absent / cwd is not a repo / resolution fails.
    """
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
    except Exception:
        return None
    if out.returncode != 0:
        return None
    common = out.stdout.decode("utf-8", "replace").strip()
    if not common:
        return None
    main_worktree = os.path.dirname(os.path.normpath(common))
    if not main_worktree:
        return None
    return os.path.join(main_worktree, ".minspec")


def read_record(minspec_dir, rel_spec_path):
    """Read a path-keyed sidecar `<minspec_dir>/approvals/<rel>.json` or None."""
    if not minspec_dir:
        return None
    sidecar = os.path.join(minspec_dir, "approvals", rel_spec_path + ".json")
    if not os.path.exists(sidecar):
        return None
    try:
        with open(sidecar, "r", encoding="utf-8") as fh:
            rec = json.load(fh)
    except Exception:
        return None
    if not isinstance(rec, dict):
        return None
    # Shallow shape check — a malformed sidecar is treated as "no record".
    if not isinstance(rec.get("specHash"), str):
        return None
    return rec


def resolve_record(cwd, canon_dir, rel_spec_path):
    """Committed sidecar from cwd FIRST, then the common-dir fallback."""
    rec = read_record(os.path.join(cwd, ".minspec"), rel_spec_path)
    if rec is not None:
        return rec
    return read_record(canon_dir, rel_spec_path)


# --- #426 scoping: derive each spec's OWNED file set ------------------------

_SPEC_DIR_RE = re.compile(r'^SPEC-\d+', re.I)
# Source extensions a declared impl-file token must end in (3b precision filter).
_SRC_EXT_RE = re.compile(
    r'\.(?:ts|tsx|js|jsx|mjs|cjs|py|sh|bash|json|jsonc|css|scss|less|html|htm'
    r'|vue|svelte|sql|ya?ml|toml)$', re.I)
_INFRA_PREFIXES = ("node_modules/", "out/", "dist/", "coverage/", ".git/")
_CODE_SPAN_RE = re.compile(r'`([^`]+)`')


def _blocker_reason(sid, verdict):
    if verdict == "stale":
        return "%s (approval stale - spec edited since approval)" % sid
    return "%s (not approved)" % sid


def _same_id_md_siblings(cwd, spec_dir_abs, sid):
    """Immediate *.md files in a FLAT spec dir that carry the same `id` (POSIX rels).

    Used only for a flat/umbrella spec whose directory ALSO holds other specs'
    subdirs (e.g. `specs/minspec/`): the owned set is the same-id sibling docs,
    NEVER the whole parent tree. Fail-safe: read errors are skipped.
    """
    out = set()
    try:
        entries = glob.glob(os.path.join(spec_dir_abs, "*.md"))
    except Exception:
        return out
    for f in entries:
        try:
            with open(f, "r", encoding="utf-8") as fh:
                head = fh.read(8000)
        except Exception:
            continue
        m = re.match(r'^---\n(.*?)\n---', head, re.S)
        if not m or (fm_value(m.group(1), "id") or "") != sid:
            continue
        try:
            out.add(os.path.relpath(f, cwd).replace(os.sep, "/"))
        except Exception:
            out.add(f.replace(os.sep, "/"))
    return out


def declared_impl_files(cwd, fm, spec_dir_abs):
    """Source files a spec EXPLICITLY names as its implementation targets (3b).

    Signals, in priority order:
      - a frontmatter `implements:`/`affects:` list (structured; none in the
        corpus yet — forward-compatible, tracked as a follow-up on #426), then
      - backtick code-span paths in the spec's own `tasks.md`.
    Precision filter (defeats prose/example/placeholder false positives): a token
    counts only if it contains '/', ends in a known source extension, is not an
    infra/escape path, and RESOLVES TO AN EXISTING FILE under cwd. Fully
    fail-safe: any read error yields an empty set — the caller still applies the
    own-dir (3a) protection, so a parse failure never silently unfreezes a spec.
    """
    files = set()

    def consider(token):
        token = token.strip().strip('"').strip("'").strip()
        if not token or "/" not in token:
            return
        p = token.replace("\\", "/")
        if p.startswith("./"):
            p = p[2:]
        # No absolute / parent-escape / infra paths.
        if p.startswith("/") or p.startswith("../") or ".." in p.split("/"):
            return
        if p.startswith(_INFRA_PREFIXES):
            return
        if not _SRC_EXT_RE.search(p):
            return
        if os.path.isfile(os.path.join(cwd, p)):
            files.add(p)

    for key in ("implements", "affects"):
        raw = fm_value(fm, key)
        if raw:
            for tok in re.split(r'[,\s\[\]]+', raw):
                consider(tok)

    try:
        with open(os.path.join(spec_dir_abs, "tasks.md"), "r", encoding="utf-8") as fh:
            tasks_text = fh.read()
    except Exception:
        tasks_text = ""
    for m in _CODE_SPAN_RE.finditer(tasks_text):
        consider(m.group(1))
    return files


def owned_file_set(cwd, sp, sid, fm):
    """(prefixes, files) a spec OWNS — the ONLY files its unapproved state blocks.

    - prefixes: directory prefixes owned wholesale (its per-spec `SPEC-NNN-*/`
      dir, if it lives in one).
    - files:    exact POSIX rel paths owned (flat same-id docs + declared impl).
    Own artifacts (3a) are ALWAYS included — the fail-safe minimum even when the
    declared-file derivation yields nothing.
    """
    spec_dir_abs = os.path.dirname(sp)
    base = os.path.basename(spec_dir_abs)
    prefixes = []
    files = set()
    if _SPEC_DIR_RE.match(base):
        # Per-spec dir: own everything under it (prefix match, no glob needed).
        try:
            dir_rel = os.path.relpath(spec_dir_abs, cwd).replace(os.sep, "/")
        except Exception:
            dir_rel = spec_dir_abs.replace(os.sep, "/")
        prefixes.append(dir_rel.rstrip("/") + "/")
    else:
        # Flat/umbrella spec: own only its same-id sibling docs, never the whole
        # parent dir (which holds other specs' subdirs).
        files |= _same_id_md_siblings(cwd, spec_dir_abs, sid)
        try:
            files.add(os.path.relpath(sp, cwd).replace(os.sep, "/"))
        except Exception:
            files.add(sp.replace(os.sep, "/"))
    files |= declared_impl_files(cwd, fm, spec_dir_abs)
    return prefixes, files


def owned_match(rel, prefixes, files):
    """True if `rel` (POSIX, cwd-relative) falls inside a spec's owned set."""
    if rel in files:
        return True
    for pre in prefixes:
        if rel == pre.rstrip("/") or rel.startswith(pre):
            return True
    return False


def main():
    try:
        env = json.load(sys.stdin)
    except Exception:
        # Can't parse -> fail open, never block on our own bug.
        passthrough()

    tool = env.get("tool_name", "")
    if tool not in ("Edit", "Write", "MultiEdit"):
        passthrough()

    ti = env.get("tool_input", {}) or {}
    fpath = ti.get("file_path") or ti.get("path") or ""
    cwd = env.get("cwd") or os.getcwd()
    if not fpath:
        allow()

    abs_path = fpath if os.path.isabs(fpath) else os.path.join(cwd, fpath)
    try:
        rel = os.path.relpath(abs_path, cwd)
    except Exception:
        rel = fpath
    rel = rel.replace(os.sep, "/")

    # A path outside the repo (../…) can never be part of a spec's file set.
    if rel.startswith("../"):
        allow()

    # Approval resolution: committed sidecar under cwd FIRST (FR-1 — present in
    # every clone/worktree/CI checkout), then the DR-031 common-dir fallback for
    # an uncommitted local approval during authoring. The fallback is no longer
    # load-bearing, but its resolution also tells us whether cwd is in a repo for
    # the fail-closed guard below.
    canon_dir = canonical_minspec_dir(cwd)
    canon_resolved = canon_dir is not None

    # Build the blocking set: every T3/T4 spec whose PHASES put it in the
    # implementation range (plan/tasks/implement/done) AND whose approval is
    # missing/stale, paired with the file set it OWNS. A target file is blocked
    # ONLY if it falls inside one of these owned sets (#426 / DR-047 §3 — the
    # doc-before-code gate applies to the code implementing THAT doc, never a
    # repo-wide freeze).
    gated = 0
    blocking = []      # (sid, verdict, prefixes, files)
    migrated = []      # (sid, prefixes, files)
    seen_ids = set()
    for sp in glob.glob(os.path.join(cwd, "specs", "**", "*.md"), recursive=True):
        try:
            with open(sp, "r", encoding="utf-8") as fh:
                head = fh.read(8000)
        except Exception:
            continue
        fmatch = re.match(r'^---\n(.*?)\n---', head, re.S)
        if not fmatch:
            continue
        fm = fmatch.group(1)
        tier = (fm_value(fm, "tier") or "").upper()
        sid = fm_value(fm, "id") or ""
        if tier not in ("T3", "T4") or not sid:
            continue

        # Repo-relative POSIX path = the approval store key.
        try:
            spec_rel = os.path.relpath(sp, cwd)
        except Exception:
            spec_rel = sp
        spec_rel = spec_rel.replace(os.sep, "/")

        rec = resolve_record(cwd, canon_dir, spec_rel)
        cur = spec_hash(sp)
        phases = parse_phases(fm)

        # Approval verdict (canonical hash match). A migrated record still counts
        # as approved (WARN phase, FR-5) but is flagged.
        if rec and isinstance(cur, str) and rec.get("specHash") == cur:
            approval = "approved"
        elif rec:
            approval = "stale"
        else:
            approval = "unapproved"

        # The literal status can be archived (explicit terminal, human act) — an
        # archived spec is terminal and never gated.
        literal_status = (fm_value(fm, "status") or "").lower()
        explicit_terminal = "archived" if literal_status == "archived" else None

        # Is this spec gated? A spec is gated when its PHASES put it in the
        # implementation range (plan/tasks/implement), independent of approval.
        # We use the phase-position status (phase_intent_status), NOT deriveStatus:
        # an UNAPPROVED implementing-phase spec must still be recognised as gated
        # (deriveStatus(unapproved) -> 'specifying' would make the gate never fire,
        # the exact enforcement hole this gate exists to close), AND a genuine
        # specify/clarify-phase spec must NOT be gated. The real approval verdict
        # below then decides allow/deny. An explicit terminal (archived) is never
        # gated.
        intended = phase_intent_status(phases, explicit_terminal)
        if intended not in ("implementing", "done"):
            continue  # phases don't put it in implementation — nothing to gate

        # One entry per spec identity. In practice only requirements.md carries
        # the tier, but dedup defensively so a spec is never double-listed.
        if sid in seen_ids:
            continue
        seen_ids.add(sid)
        gated += 1

        prefixes, files = owned_file_set(cwd, sp, sid, fm)

        if approval in ("unapproved", "stale"):
            blocking.append((sid, approval, prefixes, files))
        elif rec and rec.get("migrated") is True:
            # WARN phase: migrated counts as approved -> non-blocking, but noted.
            migrated.append((sid, prefixes, files))

    # Does the target file fall inside any BLOCKING spec's owned set?
    matched = [(sid, verdict) for (sid, verdict, pre, fil) in blocking
               if owned_match(rel, pre, fil)]

    if matched:
        # Fail closed: if the canonical store is unresolvable (cwd is not a git
        # checkout) we cannot positively prove a human approved — and this file IS
        # in an unapproved spec's owned set, so deny rather than risk unfreezing
        # it. Unrelated files never reach here (matched would be empty), so the
        # fail-closed guard no longer freezes unrelated work. (python3-missing is
        # handled fail-open in the .sh.)
        if not canon_resolved:
            deny(
                "MinSpec gate: source edit to '%s' blocked. "
                "Cannot resolve the approval store (no readable git checkout) and "
                "the file is in the owned set of %d unapproved T3/T4 spec(s) in "
                "implementation. Failing closed: a human approval cannot be "
                "verified." % (rel, len(matched))
            )
        names = ", ".join(_blocker_reason(sid, v) for sid, v in matched)
        deny(
            "MinSpec gate: source edit to '%s' blocked. "
            "Unapproved T3/T4 spec(s) in implementation: %s. "
            "A human must review and approve the spec first "
            "(VS Code: 'MinSpec: Approve Spec for Implementation', or the checkmark "
            "in the MinSpec sidebar)."
            % (rel, names)
        )

    # No blocker owns this file. Surface a migrated-approval WARN only when the
    # file is inside a migrated spec's own set (FR-5, scoped), else plain allow.
    warn_ids = [sid for (sid, pre, fil) in migrated if owned_match(rel, pre, fil)]
    if warn_ids:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": (
                "MinSpec gate (WARN): approval migrated for %s — re-approve to "
                "clear (MinSpec: Approve Spec for Implementation). Allowed for "
                "now; promotion to a hard block is pending a clean corpus."
                % ", ".join(warn_ids))}}))
        sys.exit(0)
    allow()


if __name__ == "__main__":
    main()
