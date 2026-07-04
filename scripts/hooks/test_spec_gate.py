#!/usr/bin/env python3
"""Behavioural tests for the #426-scoped PreToolUse spec gate.

Contract (DR-362 scoped by #426 / DR-047 §3): an unapproved T3/T4 spec in
implementation blocks edits ONLY to files in its OWN file set — its per-spec
directory (3a) plus the source files it explicitly declares (3b) — and NOT
unrelated source files (3c). Approved specs block nothing; the MINSPEC_GATE_OFF
human kill-switch still bypasses and logs.

Runs the real gate as a subprocess against throwaway fixture repos, exactly as
Claude Code invokes it (PreToolUse envelope on stdin -> JSON decision on stdout).
Pure stdlib unittest — run with:

    python3 scripts/hooks/test_spec_gate.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import canonical  # noqa: E402

GATE_PY = os.path.join(_HERE, "spec-gate.py")
GATE_SH = os.path.join(_HERE, "spec-gate.sh")

IMPLEMENTING_PHASES = (
    "phases:\n"
    "  specify: done\n"
    "  clarify: done\n"
    "  plan: pending\n"
    "  tasks: pending\n"
    "  implement: pending\n"
)
SPECIFYING_PHASES = (
    "phases:\n"
    "  specify: in-progress\n"
    "  clarify: pending\n"
    "  plan: pending\n"
    "  tasks: pending\n"
    "  implement: pending\n"
)


def _spec_text(sid, phases, body="The requirements body.\n", tier="T4",
               status="implementing", extra_fm=""):
    return (
        "---\n"
        f"id: {sid}\n"
        "type: requirements\n"
        f"status: {status}\n"
        f"tier: {tier}\n"
        f"{extra_fm}"
        f"{phases}"
        "---\n\n"
        f"# {sid}\n\n{body}"
    )


class GateFixture:
    """A throwaway repo-shaped directory the gate can be pointed at."""

    def __init__(self, git=False):
        self.root = tempfile.mkdtemp(prefix="specgate-")
        if git:
            subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, rel, content):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
        return path

    def write_spec(self, rel, sid, phases, body="The requirements body.\n",
                   tier="T4", status="implementing", extra_fm=""):
        content = _spec_text(sid, phases, body=body, tier=tier, status=status,
                             extra_fm=extra_fm)
        self.write(rel, content)
        return content

    def approve(self, spec_rel, spec_content, migrated=False, good=True):
        """Write an approval sidecar. good=True -> matches (approved); else stale."""
        digest = canonical.spec_hash(spec_content) if good else ("0" * 64)
        rec = {
            "specPath": spec_rel,
            "specHash": digest,
            "approvedBy": "tester@example.com",
            "tier": "T4",
            "migrated": migrated,
        }
        self.write(
            os.path.join(".minspec", "approvals", spec_rel + ".json"),
            json.dumps(rec),
        )

    def decision(self, rel, tool="Edit"):
        """Feed a PreToolUse envelope for editing `rel`; return the decision.

        Returns 'allow', 'deny', or None (passthrough / empty output).
        """
        env = {
            "tool_name": tool,
            "tool_input": {"file_path": os.path.join(self.root, rel)},
            "cwd": self.root,
        }
        proc = subprocess.run(
            [sys.executable, GATE_PY],
            input=json.dumps(env).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=self.root,
        )
        out = proc.stdout.decode("utf-8").strip()
        if not out:
            return None
        return json.loads(out)["hookSpecificOutput"]["permissionDecision"]


class ScopedGateTests(unittest.TestCase):
    def setUp(self):
        self.fx = GateFixture()
        self.addCleanup(self.fx.cleanup)

    # --- #426 core: unrelated work is no longer frozen ---------------------

    def test_unrelated_source_file_allowed_when_spec_unapproved(self):
        """An unapproved implementing spec must NOT freeze unrelated packages/**."""
        self.fx.write_spec(
            "specs/minspec/SPEC-901-widget/requirements.md",
            "SPEC-901", IMPLEMENTING_PHASES,
        )  # no approval sidecar -> unapproved
        self.fx.write("packages/other/src/unrelated.ts", "export const x = 1;\n")
        self.assertEqual(
            self.fx.decision("packages/other/src/unrelated.ts"), "allow"
        )

    def test_spec_own_dir_blocked_when_unapproved(self):
        """3a: the unapproved spec's own directory is always in its owned set."""
        self.fx.write_spec(
            "specs/minspec/SPEC-901-widget/requirements.md",
            "SPEC-901", IMPLEMENTING_PHASES,
        )
        self.assertEqual(
            self.fx.decision("specs/minspec/SPEC-901-widget/requirements.md"),
            "deny",
        )
        self.fx.write("specs/minspec/SPEC-901-widget/design.md", "# design\n")
        self.assertEqual(
            self.fx.decision("specs/minspec/SPEC-901-widget/design.md"), "deny"
        )

    # --- 3b: explicitly-declared impl files ARE blocked, siblings are not ---

    def test_declared_impl_file_blocked_but_undeclared_allowed(self):
        self.fx.write_spec(
            "specs/minspec/SPEC-902-thing/requirements.md",
            "SPEC-902", IMPLEMENTING_PHASES,
        )
        # tasks.md names one real impl file; the other file is not named.
        self.fx.write("packages/core/src/thing.ts", "export const t = 1;\n")
        self.fx.write("packages/core/src/sibling.ts", "export const s = 2;\n")
        self.fx.write(
            "specs/minspec/SPEC-902-thing/tasks.md",
            "- [ ] Build `packages/core/src/thing.ts` (impl)\n"
            "- [ ] Prose mentions a word like classify but no path here.\n",
        )
        self.assertEqual(
            self.fx.decision("packages/core/src/thing.ts"), "deny",
            "explicitly-declared impl file must be blocked",
        )
        self.assertEqual(
            self.fx.decision("packages/core/src/sibling.ts"), "allow",
            "an undeclared sibling must NOT be blocked",
        )

    def test_declared_token_that_is_not_a_real_file_does_not_block(self):
        """Precision filter: a path-shaped prose token that does not resolve to an
        existing source file must never widen the block set."""
        self.fx.write_spec(
            "specs/minspec/SPEC-903-ghost/requirements.md",
            "SPEC-903", IMPLEMENTING_PHASES,
        )
        self.fx.write(
            "specs/minspec/SPEC-903-ghost/tasks.md",
            "- [ ] Touch `packages/ghost/does-not-exist.ts` and "
            "`export * from './rework';`\n",
        )
        self.fx.write("packages/real/src/keep.ts", "export const k = 1;\n")
        # The non-existent declared path resolves to nothing -> unrelated real
        # files still pass.
        self.assertEqual(self.fx.decision("packages/real/src/keep.ts"), "allow")

    # --- 3b STRUCTURED signal: creation-blocking (the #426 review core fix) --

    def test_structured_declared_missing_file_blocks_creation(self):
        """A frontmatter `implements:` path is owned REGARDLESS of whether the
        file exists yet, so a Write that would CREATE it is DENIED. Without this
        (the old existence-only filter) the gate only bit edits to code that had
        already landed, re-opening DR-362's hole for greenfield impl code."""
        self.fx.write_spec(
            "specs/minspec/SPEC-909-green/requirements.md",
            "SPEC-909", IMPLEMENTING_PHASES,
            extra_fm="implements: packages/core/src/brand_new.ts\n",
        )  # unapproved; the declared impl file does NOT exist on disk yet
        target = os.path.join(self.fx.root, "packages/core/src/brand_new.ts")
        self.assertFalse(
            os.path.exists(target), "precondition: declared file is not yet created"
        )
        self.assertEqual(
            self.fx.decision("packages/core/src/brand_new.ts", tool="Write"),
            "deny",
            "creating a structurally-declared impl file of an unapproved spec "
            "must be blocked (creation-blocking)",
        )
        # Contrast: an UNDECLARED, also-not-yet-existing sibling stays creatable —
        # the block is scoped to the declaration, not a blanket freeze.
        self.assertEqual(
            self.fx.decision("packages/core/src/undeclared_new.ts", tool="Write"),
            "allow",
            "an undeclared new sibling must NOT be blocked",
        )

    def test_structured_declared_blocks_case_mismatched_target(self):
        """Case-insensitive owned_match (#426 review fix 3): a structured
        `implements:` (block-list form) declaring lowercase `thing.ts` must still
        DENY a Write to the real-cased `Thing.ts`. On a case-insensitive FS the
        existence check resolves either case, so the owned-set membership test must
        match case-insensitively too, or the real-cased target slips the gate."""
        self.fx.write_spec(
            "specs/minspec/SPEC-910-case/requirements.md",
            "SPEC-910", IMPLEMENTING_PHASES,
            extra_fm=(
                "implements:\n"
                "  - packages/core/src/thing.ts\n"
            ),
        )  # unapproved; block-list form also exercises fm_list block parsing
        self.assertEqual(
            self.fx.decision("packages/core/src/Thing.ts", tool="Write"),
            "deny",
            "a case-mismatched declared impl file must still be blocked",
        )

    def test_undeclared_greenfield_impl_file_is_the_disclosed_gap(self):
        """DISCLOSED GAP (intended behaviour, not a silent hole): a spec that names
        its impl work only in prose `tasks.md` — the FUZZY, existence-filtered
        signal — and carries NO structured `implements:` list does NOT block
        creation of a not-yet-existing impl file it references. This is the
        deliberate tradeoff of DR-047 §3 (unblock unrelated work rather than
        repo-wide freeze); the durable fix is the structured convention + validator
        tracked as #460. Encoded as a test so the gap can never silently change to
        a block without someone updating this contract."""
        self.fx.write_spec(
            "specs/minspec/SPEC-911-prose/requirements.md",
            "SPEC-911", IMPLEMENTING_PHASES,  # no `implements:` frontmatter
        )
        self.fx.write(
            "specs/minspec/SPEC-911-prose/tasks.md",
            "- [ ] Create `packages/core/src/to_be_written.ts` (does not exist yet)\n",
        )
        target = os.path.join(self.fx.root, "packages/core/src/to_be_written.ts")
        self.assertFalse(
            os.path.exists(target), "precondition: the impl file is not yet created"
        )
        self.assertEqual(
            self.fx.decision("packages/core/src/to_be_written.ts", tool="Write"),
            "allow",
            "prose-only (fuzzy tasks.md) greenfield code is NOT gated — the "
            "disclosed #460 gap; only a structured `implements:` list would block it",
        )

    # --- approval + phase gating -------------------------------------------

    def test_approved_spec_blocks_nothing(self):
        spec = self.fx.write_spec(
            "specs/minspec/SPEC-904-ok/requirements.md",
            "SPEC-904", IMPLEMENTING_PHASES,
        )
        self.fx.approve("specs/minspec/SPEC-904-ok/requirements.md", spec, good=True)
        self.fx.write("packages/x/src/a.ts", "export const a = 1;\n")
        self.assertEqual(self.fx.decision("packages/x/src/a.ts"), "allow")
        self.assertEqual(
            self.fx.decision("specs/minspec/SPEC-904-ok/requirements.md"), "allow",
            "an approved spec does not even freeze its own dir",
        )

    def test_stale_approval_blocks_owned_file(self):
        spec = self.fx.write_spec(
            "specs/minspec/SPEC-905-stale/requirements.md",
            "SPEC-905", IMPLEMENTING_PHASES,
        )
        self.fx.approve(
            "specs/minspec/SPEC-905-stale/requirements.md", spec, good=False
        )  # hash mismatch -> stale
        self.assertEqual(
            self.fx.decision("specs/minspec/SPEC-905-stale/requirements.md"), "deny"
        )

    def test_specifying_phase_spec_not_gated(self):
        """A specify/clarify-phase spec is not in implementation -> not gated, so
        even its own dir stays editable (matches 'edit unapproved specs directly')."""
        self.fx.write_spec(
            "specs/minspec/SPEC-906-early/requirements.md",
            "SPEC-906", SPECIFYING_PHASES, status="specifying",
        )
        self.fx.write("packages/y/src/b.ts", "export const b = 1;\n")
        self.assertEqual(self.fx.decision("packages/y/src/b.ts"), "allow")
        self.assertEqual(
            self.fx.decision("specs/minspec/SPEC-906-early/requirements.md"), "allow"
        )

    # --- flat/umbrella edge: must not freeze the whole specs/ tree ----------

    def test_flat_umbrella_spec_does_not_freeze_subspecs_or_packages(self):
        """The flat umbrella spec's dir (specs/minspec/) holds OTHER specs' subdirs;
        its owned set must be its same-id sibling docs only, never the tree."""
        self.fx.write_spec(
            "specs/minspec/requirements.md", "SPEC-800", IMPLEMENTING_PHASES,
        )  # unapproved flat umbrella
        # A sub-spec (approved) whose files must stay editable.
        sub = self.fx.write_spec(
            "specs/minspec/SPEC-901-widget/requirements.md",
            "SPEC-901", IMPLEMENTING_PHASES,
        )
        self.fx.approve(
            "specs/minspec/SPEC-901-widget/requirements.md", sub, good=True
        )
        self.fx.write("packages/z/src/c.ts", "export const c = 1;\n")
        # Umbrella owns its OWN flat doc -> blocked.
        self.assertEqual(self.fx.decision("specs/minspec/requirements.md"), "deny")
        # But NOT the sub-spec's dir, and NOT packages/**.
        self.assertEqual(
            self.fx.decision("specs/minspec/SPEC-901-widget/requirements.md"),
            "allow",
            "flat umbrella must not freeze a sub-spec's directory",
        )
        self.assertEqual(self.fx.decision("packages/z/src/c.ts"), "allow")

    # --- other tools / edge inputs -----------------------------------------

    def test_non_edit_tool_passes_through(self):
        self.fx.write_spec(
            "specs/minspec/SPEC-907-x/requirements.md",
            "SPEC-907", IMPLEMENTING_PHASES,
        )
        self.assertIsNone(
            self.fx.decision("specs/minspec/SPEC-907-x/requirements.md", tool="Read")
        )


@unittest.skipUnless(shutil.which("git"), "git required for bypass-log test")
class GateOffBypassTests(unittest.TestCase):
    def setUp(self):
        self.fx = GateFixture(git=True)
        self.addCleanup(self.fx.cleanup)

    def test_gate_off_bypass_allows_and_logs(self):
        """MINSPEC_GATE_OFF=1 must bypass (empty output -> normal flow) AND append
        an audit line to the canonical .minspec/gate-bypass.log."""
        self.fx.write_spec(
            "specs/minspec/SPEC-908-b/requirements.md",
            "SPEC-908", IMPLEMENTING_PHASES,
        )  # unapproved -> would otherwise DENY its own dir
        target = os.path.join(
            self.fx.root, "specs/minspec/SPEC-908-b/requirements.md"
        )
        env = {
            "tool_name": "Edit",
            "tool_input": {"file_path": target},
            "cwd": self.fx.root,
        }
        proc = subprocess.run(
            ["bash", GATE_SH],
            input=json.dumps(env).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=self.fx.root,
            env={**os.environ, "MINSPEC_GATE_OFF": "1"},
        )
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(
            proc.stdout.decode("utf-8").strip(), "",
            "bypass must emit nothing (fall through to normal permission flow)",
        )
        log = os.path.join(self.fx.root, ".minspec", "gate-bypass.log")
        self.assertTrue(os.path.exists(log), "bypass must be audit-logged")
        with open(log, encoding="utf-8") as fh:
            line = fh.read()
        self.assertIn("SPEC-908-b/requirements.md", line)
        self.assertIn("tool=Edit", line)


if __name__ == "__main__":
    unittest.main()
