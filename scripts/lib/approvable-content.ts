/**
 * Whether two versions of an approvable are the same reviewed content (#3380).
 *
 * An approval pull request flips the lifecycle, and the lifecycle lives in two places: the
 * frontmatter `status:`/`phases:`, which the canonical hash strips, and the body's status
 * claim (`**Status:** Specifying`, a DR's `## Status` line), which it keeps. The writers
 * keep the two in step (#667, #1624), so approving a spec that has a body claim moves its
 * `specHash` even though nobody changed its content.
 *
 * The body claim is deliberately NOT stripped from the canonical form: that would stale
 * every existing approval of an artifact carrying one, and it would let a body status word
 * change on any later edit without voiding the approval. Instead, the head counts as the
 * same content only when it is exactly what the writers produce from the base: replaying
 * them is what makes this narrower than any diff heuristic. The word must be in the
 * artifact's status vocabulary, because the frontmatter `status:` is unhashed and free text
 * from it must never reach the body unreviewed. DR-065's retire rule names the same three
 * things as lifecycle: frontmatter `status:`, `phases:`, and the body's status word.
 *
 * One predicate for the caller and for `approval-integrity`, so they cannot drift.
 */
import { specHash } from '../../packages/shared/src/canonical';
import { reconcileBodyStatus, type AdrStatus } from '../../packages/minspec/src/lib/adr-manager';
import { withBodyStatusToken } from '../../packages/minspec/src/lib/spec';
import { statusWords } from '../../packages/minspec/src/lib/status-parity';
import { prepareText } from '../../packages/minspec/src/lib/text-io';
import type { SpecStatus } from '../../packages/minspec/src/lib/spec-vocabulary';
import { actForPath, frontmatterField } from './approval-actor';

/** True when `head` differs from `base` only by a lifecycle flip the writers would make. */
export function sameReviewedContent(artifactPath: string, base: string, head: string): boolean {
  if (specHash(base) === specHash(head)) return true;
  const isDr = actForPath(artifactPath) === 'engineering-dr-acceptance';
  const status = frontmatterField(head, 'status');
  if (status === undefined || !statusWords(isDr ? 'dr' : 'spec').has(status)) return false;
  const prepared = prepareText(base);
  const replayed = isDr
    ? reconcileBodyStatus(prepared, status as AdrStatus)
    : withBodyStatusToken(prepared, status as SpecStatus);
  return specHash(replayed) === specHash(head);
}
