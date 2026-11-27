/**
 * Phase-advance request queue — DR-057 §2 / #733 (Alt-A toast producer).
 *
 * A path-keyed, gitignored, LOCAL request file under `.minspec/queue/` — the
 * mechanism DR-057 requires so the free (Tier-0) extension can flag "this spec
 * is ready for its next phase" WITHOUT running an LLM itself (the never-call-an-
 * LLM invariant holds by construction: this module is `fs` + `path` only, same
 * shape as the existing `recordApproval` sidecar write in approval-store.ts).
 *
 * A downstream consumer (the drain-sweep / agent-execute, #732/#734/#735 — not
 * built by this change) dequeues and performs the actual generation. Writing is
 * path-keyed and idempotent by construction (re-enqueuing the same spec
 * overwrites its one request file with a fresh timestamp) — full dedup by
 * upstream spec hash is `.minspec/queue/`'s own follow-up (#731/#738), not
 * needed here since this producer only ever writes its own key.
 */

import * as fs from 'fs';
import * as path from 'path';
import { toPosixRel } from './approval-store';
import { ensureDirectory } from './opt-in';

const QUEUE_DIR = '.minspec/queue';

/** What triggered this request — distinguishes producers sharing the queue. */
export type PhaseAdvanceSource = 'alt-a-toast';

export interface PhaseAdvanceRequest {
  /** Repo-relative POSIX path of the spec the request is about. */
  readonly specPath: string;
  /** ISO timestamp of the request. */
  readonly requestedAt: string;
  readonly source: PhaseAdvanceSource;
}

/** The request file path for a spec — pure function of (rootDir, repo-relative spec path). */
export function queueRequestPath(rootDir: string, specRelPath: string): string {
  const posix = toPosixRel(specRelPath);
  return path.join(rootDir, ...QUEUE_DIR.split('/'), ...posix.split('/')) + '.json';
}

/**
 * Enqueue a phase-advance request for a spec.
 * Overwrites any existing request for the same spec — one pending request per
 * spec is all a detect-and-enqueue producer needs; the consumer resolves what
 * to actually do.
 *
 * The request's nested directory is created below an existing `.minspec/`, never
 * together with it: that directory is the opt-in marker (constitution invariant
 * 3), so in a folder that has not opted in this throws `NotOptedInError` and
 * writes nothing (SPEC-096 FR-5).
 */
export function enqueuePhaseAdvance(
  rootDir: string,
  specRelPath: string,
  source: PhaseAdvanceSource,
): void {
  const p = queueRequestPath(rootDir, specRelPath);
  ensureDirectory(path.dirname(p));
  const req: PhaseAdvanceRequest = {
    specPath: toPosixRel(specRelPath),
    requestedAt: new Date().toISOString(),
    source,
  };
  fs.writeFileSync(p, JSON.stringify(req, null, 2) + '\n', 'utf-8');
}

/** One pending request as seen by the visibility surfaces (status bar / viewer). */
export interface QueuedRequestSummary {
  /** Repo-relative POSIX spec path the request is about. */
  readonly specPath: string;
  /** ISO timestamp from the request file, or undefined when unreadable. */
  readonly requestedAt: string | undefined;
}

/**
 * List the pending phase-advance requests (#737 — queue-depth visibility).
 * Read-only and offline: `fs` + `path` only, writes nothing, so it is safe to
 * call in a folder that has not opted in (no `.minspec/queue/` → empty list).
 *
 * An unreadable or malformed request file is still COUNTED (with the spec path
 * recovered from its file name): a request that cannot be parsed is exactly the
 * kind that would rot, so it must never silently drop out of the depth. Sorted
 * oldest-first (unknown timestamps first) so the head of the list is the one
 * that has waited longest.
 */
export function listQueuedRequests(rootDir: string): QueuedRequestSummary[] {
  const base = path.join(rootDir, ...QUEUE_DIR.split('/'));
  const out: QueuedRequestSummary[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.endsWith('.json')) {
        const rel = toPosixRel(path.relative(base, full)).replace(/\.json$/, '');
        let specPath = rel;
        let requestedAt: string | undefined;
        try {
          const parsed = JSON.parse(fs.readFileSync(full, 'utf-8')) as Partial<PhaseAdvanceRequest>;
          if (typeof parsed.specPath === 'string' && parsed.specPath) specPath = parsed.specPath;
          if (typeof parsed.requestedAt === 'string') requestedAt = parsed.requestedAt;
        } catch {
          // counted anyway — see doc comment
        }
        out.push({ specPath, requestedAt });
      }
    }
  };
  walk(base);
  return out.sort((a, b) => (a.requestedAt ?? '').localeCompare(b.requestedAt ?? '') || a.specPath.localeCompare(b.specPath));
}
