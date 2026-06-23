/**
 * constitution-context.ts — SPEC-025 FR-1 (deterministic context assembly).
 *
 * Reads the project's filesystem and emits a typed {@link ContextManifest} plus
 * a list of {@link ConstitutionSignal}s describing what the codebase implies its
 * constitution should say. This is the Tier-0 *analysis* half: the manifest is
 * the input both to the deterministic seed (FR-5) and to the prepared LLM prompt
 * (FR-2); neither this module nor anything it imports may call the network or an
 * LLM.
 *
 * INVARIANTS (T0 — see constitution-invariants.test.ts):
 *  - INV-1 Tier-0. No `vscode` import, no network, no exec — `fs` reads only.
 *    Mirrors the fs-read style of template-engine.ts and the typed-Signal shape
 *    of consequence-analyzers.ts.
 *  - INV-4 Degrade, never block. A missing or malformed `package.json` degrades
 *    to empty/false fields — it never throws or partial-crashes.
 *
 * Pure logic, no vscode dependency.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Which constitution section a signal argues for. */
export type ConstitutionSection = 'Invariants' | 'Principles' | 'Constraints' | 'Goals';

/** The kind of codebase signal observed. */
export type SignalKind =
  | 'no-network-deps'
  | 'tier0-package'
  | 'monorepo-layout'
  | 'node-engine'
  | 'has-claude-md'
  | 'has-decisions'
  | 'has-epics'
  | 'vscode-extension';

/**
 * One observed, deterministic fact about the codebase that argues for a
 * constitution entry. The same typed-record shape as a consequence-analyzer
 * `ClassificationSignal`: a stable `id`, a `kind`, a human `summary`, and the
 * `evidence` that produced it.
 */
export interface ConstitutionSignal {
  readonly id: string;
  readonly kind: SignalKind;
  readonly summary: string;
  readonly evidence: string;
  readonly section: ConstitutionSection;
}

/** The structured, deterministic read of the codebase (FR-1 output). */
export interface ContextManifest {
  readonly signals: ConstitutionSignal[];
  readonly packageName?: string;
  readonly engines?: Record<string, string>;
  readonly isMonorepo: boolean;
  readonly tier0Packages: string[];
  readonly hasNetworkDeps: boolean;
  readonly proseDocs: { claudeMd: boolean; decisions: number; epics: number };
}

/**
 * Dependency names that imply the project makes network calls at runtime.
 *
 * These are *data* — this module names HTTP clients only to detect them in a
 * project's manifest; it never imports or calls any of them (INV-1 Tier-0).
 * Because the repo's network-call invariant test greps source for a bare `axios`
 * token, this file is listed in that test's `NETWORK_NAME_DATA_ALLOWLIST`
 * (`invariants.test.ts`); its real no-network coverage lives in
 * `constitution-invariants.test.ts`.
 */
const NETWORK_DEP_NAMES: readonly string[] = [
  'axios',
  'node-fetch',
  'got',
  'undici',
  'superagent',
  'request',
  'socket.io',
  '@octokit/',
  'openai',
  '@anthropic-ai/',
  'graphql-request',
  'cross-fetch',
  'ws',
];

/** True if a dependency name denotes a known network client. */
function isNetworkDepName(name: string): boolean {
  return NETWORK_DEP_NAMES.some((n) => name === n || name.startsWith(n));
}

/** Read + JSON-parse a file, returning undefined on any failure (degrade, never throw). */
function readJsonSafe(filePath: string): Record<string, unknown> | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** True if `dir` exists and is a directory (never throws). */
function isDir(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** Count markdown files directly inside a docs subdirectory (never throws). */
function countMarkdown(dir: string): number {
  try {
    if (!isDir(dir)) return 0;
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')).length;
  } catch {
    return 0;
  }
}

/** Merge `dependencies` + `devDependencies` into one name→version record. */
function allDeps(pkg: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['dependencies', 'devDependencies'] as const) {
    const block = pkg?.[key];
    if (block && typeof block === 'object') {
      for (const [name, ver] of Object.entries(block as Record<string, unknown>)) {
        if (typeof ver === 'string') out[name] = ver;
      }
    }
  }
  return out;
}

/** Does a package look vscode-free (no `vscode`/`@types/vscode` dep, no engines.vscode)? */
function isVscodeFreePackage(pkg: Record<string, unknown> | undefined): boolean {
  if (!pkg) return false;
  const deps = allDeps(pkg);
  if ('vscode' in deps || '@types/vscode' in deps) return false;
  const engines = pkg.engines;
  if (engines && typeof engines === 'object' && 'vscode' in (engines as object)) return false;
  return true;
}

/**
 * Detect Tier-0 (vscode-free) workspace packages. A package is "Tier-0" when its
 * name reads like a shared/library package (e.g. `@aiclarity/shared`) OR it lives
 * in a `shared`/`core`/`lib`-style directory, AND it carries no vscode dependency.
 */
function detectTier0Packages(rootDir: string): string[] {
  const found: string[] = [];
  const packagesDir = path.join(rootDir, 'packages');
  if (!isDir(packagesDir)) return found;

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(packagesDir);
  } catch {
    return found;
  }

  for (const entry of entries) {
    const pkgPath = path.join(packagesDir, entry, 'package.json');
    const pkg = readJsonSafe(pkgPath);
    if (!pkg) continue;
    const name = typeof pkg.name === 'string' ? pkg.name : entry;
    const looksShared =
      /(^|[/-])(shared|core|lib|common|types|engine)$/i.test(name) ||
      /(^|[/-])(shared|core|lib|common|types|engine)$/i.test(entry);
    if (looksShared && isVscodeFreePackage(pkg)) {
      found.push(name);
    }
  }
  return found;
}

/**
 * Assemble the deterministic context manifest for `rootDir` (FR-1).
 *
 * Pure aside from `fs` reads. Degrades gracefully: a missing `package.json`,
 * missing docs dirs, or malformed JSON yield empty/false fields, never a throw.
 */
export function assembleContext(rootDir: string): ContextManifest {
  const signals: ConstitutionSignal[] = [];

  const pkg = readJsonSafe(path.join(rootDir, 'package.json'));
  const packageName =
    pkg && typeof pkg.name === 'string' ? (pkg.name as string) : undefined;

  // engines (typically { node: '>=18' })
  let engines: Record<string, string> | undefined;
  if (pkg && pkg.engines && typeof pkg.engines === 'object') {
    const e: Record<string, string> = {};
    for (const [k, v] of Object.entries(pkg.engines as Record<string, unknown>)) {
      if (typeof v === 'string') e[k] = v;
    }
    if (Object.keys(e).length > 0) engines = e;
  }

  // Network-dependency detection over deps + devDeps.
  const deps = allDeps(pkg);
  const networkDeps = Object.keys(deps).filter(isNetworkDepName);
  const hasNetworkDeps = networkDeps.length > 0;

  // vscode-extension detection (whole-repo package.json).
  const rootIsVscodeExt = pkg ? !isVscodeFreePackage(pkg) : false;

  // Monorepo + Tier-0 packages.
  const isMonorepo =
    pkg !== undefined && 'workspaces' in pkg ? true : isDir(path.join(rootDir, 'packages'));
  const tier0Packages = detectTier0Packages(rootDir);

  // Prose docs presence.
  const claudeMd = fs.existsSync(path.join(rootDir, 'CLAUDE.md'));
  const decisions = countMarkdown(path.join(rootDir, 'docs', 'decisions'));
  const epics = countMarkdown(path.join(rootDir, 'docs', 'epics'));
  const proseDocs = { claudeMd, decisions, epics };

  // ─── Signals ───────────────────────────────────────────────────────────────

  if (pkg && !hasNetworkDeps) {
    signals.push({
      id: 'no-network-deps',
      kind: 'no-network-deps',
      summary: 'No runtime network-client dependencies detected.',
      evidence: 'package.json dependencies/devDependencies contain no known HTTP/socket client.',
      section: 'Invariants',
    });
  }

  for (const name of tier0Packages) {
    signals.push({
      id: `tier0-package:${name}`,
      kind: 'tier0-package',
      summary: `Tier-0 (vscode/network-free) package: ${name}.`,
      evidence: `packages/ workspace member ${name} carries no vscode dependency.`,
      section: 'Constraints',
    });
  }

  if (isMonorepo) {
    signals.push({
      id: 'monorepo-layout',
      kind: 'monorepo-layout',
      summary: 'Monorepo layout (workspaces / packages/).',
      evidence: 'package.json declares workspaces or a packages/ directory exists.',
      section: 'Constraints',
    });
  }

  if (engines && typeof engines.node === 'string') {
    signals.push({
      id: 'node-engine',
      kind: 'node-engine',
      summary: `Pinned Node engine: ${engines.node}.`,
      evidence: `package.json engines.node = ${engines.node}.`,
      section: 'Constraints',
    });
  }

  if (rootIsVscodeExt) {
    signals.push({
      id: 'vscode-extension',
      kind: 'vscode-extension',
      summary: 'VS Code extension package.',
      evidence: 'package.json declares a vscode dependency or engines.vscode.',
      section: 'Constraints',
    });
  }

  if (claudeMd) {
    signals.push({
      id: 'has-claude-md',
      kind: 'has-claude-md',
      summary: 'CLAUDE.md project instructions present.',
      evidence: 'A CLAUDE.md file exists at the project root.',
      section: 'Principles',
    });
  }

  if (decisions > 0) {
    signals.push({
      id: 'has-decisions',
      kind: 'has-decisions',
      summary: `${decisions} decision record(s) under docs/decisions/.`,
      evidence: `docs/decisions/ contains ${decisions} markdown file(s).`,
      section: 'Principles',
    });
  }

  if (epics > 0) {
    signals.push({
      id: 'has-epics',
      kind: 'has-epics',
      summary: `${epics} epic doc(s) under docs/epics/.`,
      evidence: `docs/epics/ contains ${epics} markdown file(s).`,
      section: 'Goals',
    });
  }

  return {
    signals,
    packageName,
    engines,
    isMonorepo,
    tier0Packages,
    hasNetworkDeps,
    proseDocs,
  };
}
