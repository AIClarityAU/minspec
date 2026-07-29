#!/usr/bin/env python3
"""Behavioural tests for the UserPromptSubmit session-title hook.

Contract: given a Claude Code `UserPromptSubmit` envelope on stdin, the hook
emits `hookSpecificOutput.sessionTitle` = "<Claude's auto-summary> — <IDs>",
where the IDs are the approvables the USER typed (newest first, deduped, capped)
— and emits NOTHING at all when the session has mentioned no approvable, so
Claude Code's own title is left alone.

Runs the real hook as a subprocess, exactly as Claude Code invokes it. Pure
stdlib unittest — run with:

    python3 scripts/hooks/test_session_title.py
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "session-title.py")
MAX_TITLE = 200


def user_line(text):
    return json.dumps({"type": "user", "message": {"role": "user", "content": text}})


def tool_result_line(text):
    """A tool result — content is an ARRAY, not a string. Must be ignored."""
    return json.dumps(
        {
            "type": "user",
            "message": {"role": "user", "content": [{"type": "tool_result", "content": text}]},
        }
    )


def assistant_line(text):
    return json.dumps({"type": "assistant", "message": {"role": "assistant", "content": text}})


def ai_title_line(title):
    return json.dumps({"type": "ai-title", "aiTitle": title, "sessionId": "s"})


def custom_title_line(title):
    return json.dumps({"type": "custom-title", "customTitle": title, "sessionId": "s"})


def run_hook(prompt="", transcript_lines=None):
    """Invoke the hook with a real envelope; return the parsed output (or None)."""
    with tempfile.TemporaryDirectory() as tmp:
        envelope = {
            "hook_event_name": "UserPromptSubmit",
            "session_id": "00000000-0000-4000-8000-000000000000",
            "cwd": tmp,
            "prompt": prompt,
        }
        if transcript_lines is not None:
            path = os.path.join(tmp, "transcript.jsonl")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("\n".join(transcript_lines) + "\n")
            envelope["transcript_path"] = path
        proc = subprocess.run(
            [sys.executable, HOOK],
            input=json.dumps(envelope),
            capture_output=True,
            text=True,
            timeout=30,
        )
    assert proc.returncode == 0, f"hook must never fail a turn: {proc.stderr}"
    out = proc.stdout.strip()
    return json.loads(out) if out else None


def title_of(result):
    return result["hookSpecificOutput"]["sessionTitle"]


class TestSessionTitle(unittest.TestCase):
    def test_no_refs_emits_nothing(self):
        """No approvable mentioned -> stay silent, don't clobber Claude's title."""
        self.assertIsNone(run_hook(prompt="fix the flaky test", transcript_lines=[]))

    def test_ref_in_current_prompt_is_appended_to_ai_title(self):
        result = run_hook(
            prompt="approve DR-071 please",
            transcript_lines=[ai_title_line("Standing consent for repeating network actions")],
        )
        self.assertEqual(
            title_of(result),
            "Standing consent for repeating network actions — DR-071",
        )

    def test_event_name_is_echoed(self):
        result = run_hook(prompt="see SPEC-019", transcript_lines=[])
        self.assertEqual(result["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit")

    def test_refs_are_newest_first_and_deduped(self):
        result = run_hook(
            prompt="now DR-071",
            transcript_lines=[
                user_line("start on SPEC-019"),
                user_line("also #1082 and SPEC-019 again"),
            ],
        )
        self.assertEqual(title_of(result), "DR-071 #1082 SPEC-019")

    def test_ids_in_tool_output_and_assistant_text_are_ignored(self):
        """Reading docs/decisions/INDEX.md must not flood the title."""
        result = run_hook(
            prompt="carry on",
            transcript_lines=[
                user_line("work on SPEC-019"),
                tool_result_line("DR-001 DR-002 DR-003 DR-004 DR-005 DR-006 DR-007"),
                assistant_line("I reviewed DR-055 and DR-056 for you"),
            ],
        )
        self.assertEqual(title_of(result), "SPEC-019")

    def test_ref_count_is_capped(self):
        result = run_hook(
            prompt="and #7",
            transcript_lines=[user_line(" ".join(f"DR-0{n:02d}" for n in range(10, 30)))],
        )
        self.assertEqual(len(title_of(result).split()), 6)

    def test_previously_appended_refs_are_not_double_appended(self):
        """Falling back to our own custom-title must strip the old ID tail."""
        result = run_hook(
            prompt="keep going",
            transcript_lines=[
                user_line("start SPEC-019"),
                custom_title_line("Migrate the approval store — SPEC-019"),
            ],
        )
        self.assertEqual(title_of(result), "Migrate the approval store — SPEC-019")

    def test_ai_title_wins_over_stale_custom_title(self):
        result = run_hook(
            prompt="check DR-071",
            transcript_lines=[
                custom_title_line("Old title — DR-062"),
                ai_title_line("Fresh summary"),
            ],
        )
        self.assertEqual(title_of(result), "Fresh summary — DR-071")

    def test_title_fits_the_harness_200_char_cap(self):
        result = run_hook(
            prompt="about SPEC-019",
            transcript_lines=[ai_title_line("x" * 400)],
        )
        title = title_of(result)
        self.assertLessEqual(len(title), MAX_TITLE)
        self.assertTrue(title.endswith("SPEC-019"), title)

    def test_missing_transcript_still_titles_from_the_prompt(self):
        result = run_hook(prompt="open #1082")
        self.assertEqual(title_of(result), "#1082")

    def test_malformed_transcript_lines_are_survived(self):
        result = run_hook(
            prompt="DR-071",
            transcript_lines=["{not json", "", '{"type":"user"}'],
        )
        self.assertEqual(title_of(result), "DR-071")

    def test_garbage_stdin_is_silent_and_clean(self):
        proc = subprocess.run(
            [sys.executable, HOOK], input="not json", capture_output=True, text=True, timeout=30
        )
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout.strip(), "")

    def test_kill_switch_wrapper_opts_out(self):
        env = dict(os.environ, MINSPEC_SESSION_TITLE_OFF="1")
        proc = subprocess.run(
            ["bash", os.path.join(HERE, "session-title.sh")],
            input=json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": "DR-071"}),
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
        )
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout.strip(), "")

    def test_wrapper_emits_the_same_title_as_the_hook(self):
        proc = subprocess.run(
            ["bash", os.path.join(HERE, "session-title.sh")],
            input=json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": "DR-071"}),
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(title_of(json.loads(proc.stdout)), "DR-071")


if __name__ == "__main__":
    unittest.main(verbosity=2)
