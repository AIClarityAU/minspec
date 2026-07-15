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
 * Enqueue a phase-advance request for a spec (mkdir -p its nested dir).
 * Overwrites any existing request for the same spec — one pending request per
 * spec is all a detect-and-enqueue producer needs; the consumer resolves what
 * to actually do.
 */
export function enqueuePhaseAdvance(
  rootDir: string,
  specRelPath: string,
  source: PhaseAdvanceSource,
): void {
  const p = queueRequestPath(rootDir, specRelPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const req: PhaseAdvanceRequest = {
    specPath: toPosixRel(specRelPath),
    requestedAt: new Date().toISOString(),
    source,
  };
  fs.writeFileSync(p, JSON.stringify(req, null, 2) + '\n', 'utf-8');
}
