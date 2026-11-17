/**
 * #2000 — no validate-frontmatter rule may swallow a mid-sweep read failure.
 *
 * Constitution invariant 2: "a missing or errored witness fails the gate closed and
 * visibly (never silently passes or stops evaluating)". Most rules wrapped their whole
 * sweep in a bare `try { … } catch {}`, so one unreadable file aborted the loop, every
 * REMAINING file went unchecked, and the run still printed "Frontmatter validation
 * passed." Which files were lost depended on `readdirSync` order, which a test cannot
 * pin — so the assertions here do not depend on it: every rule that could not read the
 * dangling symlink must NAME it, and the readable probes must all still be evaluated.
 *
 * Subprocess rather than import: the script has top-level side effects incl.
 * `process.exit(1)`.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "validate-frontmatter.ts");
// Absolute tsx (not npx): cwd is a tmpdir outside the repo; npx could try to fetch it.
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

const COULD_NOT_RUN = "could not run on this file";
const BAD = "aaa-unreadable.md";

function writeSpec(dir: string, name: string, body = ""): void {
  const full = path.join(dir, "specs", name, "requirements.md");
  fs.mkdirSync(path.dirname(full), { recursive: true });
  // No `id:` → Rule 2 fires once per readable probe, which counts evaluated files.
  fs.writeFileSync(
    full,
    `---\ntitle: Probe\ntier: T1\nstatus: draft\n---\n\n# Probe\n${body}\n`,
    "utf-8",
  );
}

/** An entry the walker admits (ends in .md, not a directory) whose read throws ENOENT. */
function plantDangling(root: string): void {
  fs.mkdirSync(root, { recursive: true });
  fs.symlinkSync("/nonexistent/nowhere.md", path.join(root, BAD));
}

function runValidate(cwd: string): { status: number | null; output: string } {
  const r = spawnSync(TSX_BIN, [SCRIPT_PATH], { cwd, encoding: "utf-8" });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

function withTmp(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-sweep-skip-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Lines mentioning the bad file AND the could-not-run phrase, per rule label. */
function namedBy(output: string, rule: string): boolean {
  return output
    .split("\n")
    .some(
      (l) => l.includes(BAD) && l.includes(COULD_NOT_RUN) && l.includes(rule),
    );
}

describe("#2000 — a dangling symlink is named by every sweep that could not read it", { timeout: 60_000 }, () => {
  it("control: no unreadable file → no could-not-run output", () => {
    withTmp((dir) => {
      writeSpec(dir, "probe");
      const { output } = runValidate(dir);
      expect(output).not.toContain(COULD_NOT_RUN);
      expect(output).toContain("missing or invalid `id: SPEC-NNN`");
    });
  });

  it("specs/: Rules 2/5, 7, 9, 11, 13, 15, 22 each name the file", () => {
    withTmp((dir) => {
      writeSpec(dir, "probe");
      plantDangling(path.join(dir, "specs"));
      const { output } = runValidate(dir);
      for (const rule of [
        "Rule 2/5",
        "Rule 7",
        "Rule 9",
        "Rule 11",
        "Rule 13",
        "Rule 15",
        "Rule 22",
      ]) {
        expect(
          namedBy(output, rule),
          `${rule} must name ${BAD}\n${output}`,
        ).toBe(true);
      }
    });
  });

  it("docs/domain: Rules 1/3/4 name the file", () => {
    withTmp((dir) => {
      plantDangling(path.join(dir, "docs", "domain"));
      const { output, status } = runValidate(dir);
      expect(namedBy(output, "Rule 1/3/4"), output).toBe(true);
      expect(status).not.toBe(0);
    });
  });

  it("decisions + epics: Rules 9, 11, 20b name the file", () => {
    withTmp((dir) => {
      plantDangling(path.join(dir, "docs", "decisions"));
      plantDangling(path.join(dir, "docs", "epics"));
      const { output } = runValidate(dir);
      for (const rule of ["Rule 9", "Rule 11", "Rule 20b"]) {
        expect(
          namedBy(output, rule),
          `${rule} must name ${BAD}\n${output}`,
        ).toBe(true);
      }
    });
  });

  it("finding count does not depend on where the bad file sorts", () => {
    withTmp((dir) => {
      for (const n of ["a-probe", "m-probe", "z-probe"]) writeSpec(dir, n);
      plantDangling(path.join(dir, "specs"));
      const { output } = runValidate(dir);
      const found = output
        .split("\n")
        .filter((l) => l.includes("missing or invalid `id: SPEC-NNN`")).length;
      expect(found).toBe(3);
    });
  });

  it("a FATAL rule fails the run closed on the unreadable file", () => {
    withTmp((dir) => {
      writeSpec(dir, "probe");
      plantDangling(path.join(dir, "specs"));
      const { status, output } = runValidate(dir);
      expect(output).toContain(COULD_NOT_RUN);
      expect(status).not.toBe(0);
    });
  });
});
