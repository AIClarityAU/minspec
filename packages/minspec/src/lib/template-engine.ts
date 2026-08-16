/**
 * Template engine — renders Handlebars templates with project context.
 * Pure logic, no vscode dependency.
 */

import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import { loadConfig, type MinspecConfig } from './config';
import {
  TEMPLATES,
  TEMPLATE_NAMES,
  TEMPLATE_OUTPUT_PATHS,
  type TemplateName,
} from './template-registry';
import { parseConstitution, firstSentence, type Constitution } from './constitution';

/** Variables available to all templates */
export interface TemplateContext {
  readonly projectName: string;
  readonly specsDir: string;
  readonly decisionsDir: string;
  readonly invariants: string[];
  readonly principles: string[];
  readonly constraints: string[];
}

/**
 * Register custom Handlebars helpers.
 * Called once at module load.
 */
function registerHelpers(): void {
  // {{incremented @index}} → 1-based index for numbered lists
  Handlebars.registerHelper('incremented', (index: number) => index + 1);
  // {{firstSentence this}} → lead sentence only, for constitution mirrors (#705)
  Handlebars.registerHelper('firstSentence', (text: unknown) => firstSentence(String(text)));
}

// Register helpers on module load
registerHelpers();

/** Where a resolved project name came from, most authoritative first. */
export type ProjectNameSource = 'config' | 'package.json' | 'recorded' | 'basename';

/** The outcome of {@link resolveProjectName} — the name plus how it was reached. */
export interface ResolvedProjectName {
  /** The name to render into every template. */
  readonly name: string;
  /** Which source won. `recorded` means the basename guess was overridden (#1529). */
  readonly source: ProjectNameSource;
  /** The name already written into the harness on disk, when one is readable. */
  readonly recorded?: string;
  /** The directory-name guess, kept so a caller can report what it overrode. */
  readonly basename: string;
}

/** The H1 the CLAUDE.md template renders: `# <name> — Project Instructions`. */
const RECORDED_NAME_RE = /^#\s+(.+?)\s+—\s+Project Instructions\s*$/m;

/**
 * The project name already recorded in the generated harness, if it can be read.
 *
 * This is the only witness to what the project called itself BEFORE this run, and
 * it is what makes the basename fallback checkable rather than blindly trusted.
 */
function readRecordedProjectName(rootDir: string): string | undefined {
  const claudePath = path.join(rootDir, TEMPLATE_OUTPUT_PATHS['CLAUDE.md']);
  if (!fs.existsSync(claudePath)) return undefined;
  try {
    const match = fs.readFileSync(claudePath, 'utf-8').match(RECORDED_NAME_RE);
    return match?.[1]?.trim() || undefined;
  } catch {
    // Unreadable harness — fall through to the remaining sources.
    return undefined;
  }
}

/** The `package.json` name at rootDir, org prefix stripped (`@aiclarity/minspec` → `minspec`). */
function readPackageName(rootDir: string): string | undefined {
  const pkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg.name && typeof pkg.name === 'string') {
      return pkg.name.replace(/^@[^/]+\//, '');
    }
  } catch {
    // Malformed package.json — fall through.
  }
  return undefined;
}

/**
 * Resolve the project's name, and report which source won (#1529).
 *
 * Order, most authoritative first:
 *
 * 1. `projectName` in `.minspec/config.json` — the explicit, deliberate rename.
 * 2. root `package.json` name — an authored fact about the project.
 * 3. the name already recorded in the harness — outranks the basename, because a
 *    linked git worktree's directory name is arbitrary and carries no relationship
 *    to the project. Without this step a refresh run from `.worktrees/<branch>/`
 *    renamed the project in every generated file, silently.
 * 4. the directory's basename — the last-resort guess, correct only when the
 *    checkout happens to be named after the project.
 *
 * Pure reads; no network, no writes.
 */
export function resolveProjectName(
  rootDir: string,
  config?: MinspecConfig,
): ResolvedProjectName {
  const basename = path.basename(rootDir);
  const resolvedConfig = config ?? loadConfig(rootDir);
  const recorded = readRecordedProjectName(rootDir);

  const configured = resolvedConfig.projectName?.trim();
  if (configured) return { name: configured, source: 'config', recorded, basename };

  const fromPackage = readPackageName(rootDir);
  if (fromPackage) return { name: fromPackage, source: 'package.json', recorded, basename };

  // The recorded name only *overrides* when it actually disagrees; agreeing with
  // the basename is the ordinary case and must not read as a divergence.
  if (recorded && recorded !== basename) {
    return { name: recorded, source: 'recorded', recorded, basename };
  }

  return { name: basename, source: 'basename', recorded, basename };
}

/**
 * Build template context from project root directory.
 * Reads config and constitution if they exist.
 */
export function buildContext(rootDir: string, config?: MinspecConfig): TemplateContext {
  const resolvedConfig = config ?? loadConfig(rootDir);
  const projectName = resolveProjectName(rootDir, resolvedConfig).name;

  // Load constitution if it exists
  const constitutionPath = path.join(rootDir, '.minspec', 'constitution.md');
  let constitution: Constitution = { invariants: [], principles: [], constraints: [] };
  if (fs.existsSync(constitutionPath)) {
    const content = fs.readFileSync(constitutionPath, 'utf-8');
    constitution = parseConstitution(content);
  }

  return {
    projectName,
    specsDir: resolvedConfig.specsDir,
    decisionsDir: resolvedConfig.decisionsDir,
    invariants: constitution.invariants,
    principles: constitution.principles,
    constraints: constitution.constraints,
  };
}

/**
 * Render a single template by name with the given context.
 * Returns the rendered markdown string.
 */
export function renderTemplate(templateName: TemplateName, context: TemplateContext): string {
  const source = TEMPLATES[templateName];
  if (!source) {
    throw new Error(`Unknown template: ${templateName}`);
  }
  const compiled = Handlebars.compile(source, { noEscape: true });
  return compiled(context);
}

/**
 * Render all templates with the given context.
 * Returns a map of template name → rendered content.
 */
export function renderAll(context: TemplateContext): Map<TemplateName, string> {
  const results = new Map<TemplateName, string>();
  for (const name of TEMPLATE_NAMES) {
    results.set(name, renderTemplate(name, context));
  }
  return results;
}
