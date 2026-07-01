#!/usr/bin/env python3

# >>> minspec:managed:validate-py >>>
"""MinSpec mid-tier validator (DR-037 / #246).

Language-agnostic twin of the Node validate-frontmatter core FATAL checks:
  - specs/**/*.md must have `id: SPEC-NNN` frontmatter
  - docs/domain/*.md must have `type: domain` frontmatter

Frontmatter parsing mirrors the Node validator exactly (first --- ... --- block,
split each line on the first colon, trim) — no PyYAML, so it runs on a stock
python3. Deterministic + offline (Tier-0, DR-004)."""

import os
import re
import subprocess
import sys

FM_RE = re.compile(r"^---\n(.*?)\n---", re.DOTALL)
SPEC_ID_RE = re.compile(r"^SPEC-\d+$")


def repo_root():
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except Exception:
        return os.getcwd()


def parse_frontmatter(content):
    """Mirror the Node parseFrontmatter: first --- ... --- block, key:value split."""
    m = FM_RE.match(content)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).split("\n"):
        if ":" not in line:
            continue
        key, rest = line.split(":", 1)
        key = key.strip()
        if key:
            fm[key] = rest.strip()
    return fm


def staged_files(root):
    """Staged added/copied/modified files (pre-commit scope). [] on any git error."""
    try:
        out = subprocess.run(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
            cwd=root, capture_output=True, text=True, check=True,
        )
        return [f for f in out.stdout.splitlines() if f.strip()]
    except Exception:
        return []


def staged_content(root, rel):
    """Content of the staged blob (what is ACTUALLY being committed)."""
    try:
        out = subprocess.run(
            ["git", "show", ":" + rel],
            cwd=root, capture_output=True, text=True, check=True,
        )
        return out.stdout
    except Exception:
        return None


def all_md(root, rel_dir):
    base = os.path.join(root, rel_dir)
    found = []
    for dirpath, _dirs, files in os.walk(base):
        for name in files:
            if name.endswith(".md"):
                found.append(os.path.relpath(os.path.join(dirpath, name), root))
    return found


def main():
    pre_commit = "--pre-commit" in sys.argv[1:]
    root = repo_root()

    if pre_commit:
        targets = staged_files(root)
        reader = lambda rel: staged_content(root, rel)
    else:
        targets = all_md(root, "specs") + all_md(root, os.path.join("docs", "domain"))
        def reader(rel):
            try:
                with open(os.path.join(root, rel), "r", encoding="utf-8") as fh:
                    return fh.read()
            except Exception:
                return None

    errors = 0

    for rel in targets:
        norm = rel.replace(os.sep, "/")
        is_spec = norm.startswith("specs/") and norm.endswith(".md")
        is_domain = norm.startswith("docs/domain/") and norm.endswith(".md")
        if not (is_spec or is_domain):
            continue

        content = reader(rel)
        if content is None:
            continue
        fm = parse_frontmatter(content)

        if is_spec:
            spec_id = fm.get("id", "")
            # Strip an inline comment (`id: SPEC-001  # note`) before matching.
            spec_id = spec_id.split("#", 1)[0].strip()
            if not SPEC_ID_RE.match(spec_id):
                sys.stderr.write(
                    "FAIL " + norm + ": missing or invalid `id: SPEC-NNN` frontmatter\n"
                )
                errors += 1

        if is_domain:
            if fm.get("type", "").split("#", 1)[0].strip() != "domain":
                sys.stderr.write(
                    "FAIL " + norm + ": missing `type: domain` frontmatter\n"
                )
                errors += 1

    if errors:
        sys.stderr.write(
            "\n" + str(errors) + " validation error(s). Fix before committing.\n"
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
# <<< minspec:managed:validate-py <<<
