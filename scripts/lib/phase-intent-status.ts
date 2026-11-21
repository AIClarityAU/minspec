/**
 * Phase-position status twin used by migrate-approvals (extracted so the parity test
 * can import it without running the script's main(); #899).
 */

export const PHASE_ORDER = ['specify', 'clarify', 'plan', 'tasks', 'implement'] as const;

/**
 * Phase-position status — mirrors lifecycle.ts getSpecStatus / the gate's
 * phase_intent_status. A spec is "in implementation" (gated, needs a record) when
 * this returns implementing/done. archived (explicit terminal) is never gated.
 *
 * DR-069 §3 — FREEZE-GATE TWIN, DO NOT ALIGN TO deriveStatus/#886. Keep plan/tasks in
 * the 'implementing' band; narrowing it so plan/tasks return 'planning' would drop
 * unapproved plan/tasks specs out of the gate range and silently reopen the freeze
 * hole that DR-012/DR-031 close (the local-register ids; DR-362 is the mmo-platform
 * parent-register number, not valid here). The #886 'planning' split lives ONLY in
 * deriveStatus (the signpost).
 */
export function phaseIntentStatus(
  phases: Record<string, string>,
  literalStatus: string,
): string {
  if (literalStatus === 'archived') return 'archived';
  const allPending = PHASE_ORDER.every((p) => (phases[p] ?? 'pending') === 'pending');
  if (allPending) return 'new';
  const allDone = PHASE_ORDER.every((p) => {
    const s = phases[p] ?? 'pending';
    return s !== 'pending' && s !== 'in-progress';
  });
  if (allDone) return 'done';
  const current =
    PHASE_ORDER.find((p) => (phases[p] ?? 'pending') === 'in-progress') ??
    PHASE_ORDER.find((p) => (phases[p] ?? 'pending') === 'pending');
  if (current === 'specify' || current === 'clarify') return 'specifying';
  return 'implementing';
}
