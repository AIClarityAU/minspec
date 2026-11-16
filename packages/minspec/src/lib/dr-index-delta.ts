/**
 * dr-index-delta.ts — which INDEX entries a burst of DR file events touched (#896).
 *
 * The decisions-directory watcher used to rebuild the whole INDEX on any event, so
 * creating a DR and discarding it again left INDEX.md modified whenever the INDEX had
 * drifted from a full rebuild. The watcher now records, per event, the decision id the
 * file contributes, and the debounced write touches only those entries
 * (`regenerateDrIndexEntries`).
 *
 * A deleted file can no longer be read, so the id seen when it was created or changed
 * is remembered and used for the delete. Without that, a record whose frontmatter `id:`
 * differs from its file name would leave its entry behind on delete.
 */
import * as path from 'path';
import { drIdForFile } from './adr-manager';

export interface DrIndexDelta {
  /** True when an event could not be mapped to ids; the caller rebuilds the whole INDEX. */
  readonly full: boolean;
  /** Decision ids whose INDEX entry must be brought in line with the files, in note order. */
  readonly ids: readonly string[];
}

export class DrIndexDeltaTracker {
  private readonly known = new Map<string, string>();
  private readonly pending = new Set<string>();
  private full = false;

  /** Record the id an existing file contributes, so its later delete names the right entry. */
  remember(filePath: string, id: string): void {
    this.known.set(filePath, id);
  }

  /** Ask the next {@link take} for a full rebuild (an event with no file). */
  markFull(): void {
    this.full = true;
  }

  /**
   * Record one watcher event. `decisionsDir` is the absolute register directory, or
   * null when it cannot be resolved (the next {@link take} then asks for a full rebuild).
   * Files outside the register's top level (sub-folders, which `listAdrs` never reads)
   * and files that are not DR files (INDEX.md, a README) contribute nothing.
   */
  note(filePath: string, deleted: boolean, decisionsDir: string | null): void {
    if (decisionsDir === null) {
      this.full = true;
      return;
    }
    if (path.relative(path.resolve(decisionsDir), path.resolve(path.dirname(filePath))) !== '') return;
    const remembered = this.known.get(filePath);
    if (deleted) {
      this.known.delete(filePath);
      const id = remembered ?? drIdForFile(filePath);
      if (id) this.pending.add(id);
      return;
    }
    const id = drIdForFile(filePath);
    // An edit that changed the record's `id:` must also clear the entry under the old id.
    if (remembered && remembered !== id) this.pending.add(remembered);
    if (id) {
      this.known.set(filePath, id);
      this.pending.add(id);
    } else {
      this.known.delete(filePath);
    }
  }

  /** The delta accumulated since the last call, and reset. */
  take(): DrIndexDelta {
    const delta = { full: this.full, ids: [...this.pending] };
    this.full = false;
    this.pending.clear();
    return delta;
  }
}
