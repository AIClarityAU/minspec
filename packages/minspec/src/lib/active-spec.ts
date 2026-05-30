import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, applyVSCodeOverrides, resolveAndValidate } from './config';
import { parseSpec } from './spec';
import { fromFrontmatter, computeProgress } from '../views/status-bar';

/**
 * Find the most likely active spec file in the workspace.
 * Prefers specs with implementing/specifying status, falling back to the first
 * spec file found.
 *
 * This is the SINGLE shared implementation used by both the status bar watcher
 * (in extension.ts) and the status-bar click command (commands/status.ts) so
 * the two never disagree about what the active spec is.
 */
export async function findActiveSpec(rootDir: string): Promise<string | null> {
  const config = loadConfig(rootDir);
  const vscodeConfig = vscode.workspace.getConfiguration('minspec');
  const finalConfig = applyVSCodeOverrides(config, {
    specsDir: vscodeConfig.get('specsDir'),
  });

  const specsDir = resolveAndValidate(rootDir, finalConfig.specsDir);
  if (!fs.existsSync(specsDir)) return null;

  const specFiles: string[] = [];
  const walk = (dir: string) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name.endsWith('.md')) {
          specFiles.push(fullPath);
        }
      }
    } catch {
      // Ignore unreadable directories
    }
  };
  walk(specsDir);

  if (specFiles.length === 0) return null;

  for (const filePath of specFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const spec = parseSpec(content);
      if (spec.frontmatter.status === 'implementing' || spec.frontmatter.status === 'specifying') {
        return filePath;
      }
    } catch {
      // Ignore unparseable files
    }
  }

  return specFiles[0];
}

/** Lightweight summary of an active spec for display in a message. */
export interface ActiveSpecSummary {
  readonly id: string;
  readonly title: string;
  readonly tier: string;
  /** Capitalized current phase name, or "Done" when all phases complete. */
  readonly phase: string;
  /** Progress string, e.g. "2/5 done". */
  readonly progress: string;
}

/**
 * Read and summarize a spec file for status display.
 * Reuses the same phase/progress derivation the status bar uses so the click
 * summary and the bar agree. Returns null if the file can't be read/parsed.
 */
export function summarizeActiveSpec(filePath: string): ActiveSpecSummary | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter } = parseSpec(content);
    const bar = fromFrontmatter(frontmatter);
    const phase = bar.currentPhase
      ? bar.currentPhase.charAt(0).toUpperCase() + bar.currentPhase.slice(1)
      : 'Done';
    return {
      id: bar.id,
      title: bar.title,
      tier: bar.tier,
      phase,
      progress: computeProgress(bar.phases),
    };
  } catch {
    return null;
  }
}
