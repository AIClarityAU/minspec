#!/usr/bin/env bash
# governance-transition.sh — the bash mirror of
# packages/minspec/src/lib/governance-transition.ts's GOVERNANCE_PATH_PATTERN /
# STATUS_TRANSITION_PATTERN (#1847, #2078, #2158). Sourced, never executed.
#
# WHY THIS EXISTS. The docs-lane workflow (.github/workflows/docs-lane.yml) refuses to
# arm auto-merge on a PR whose diff changes a `status:` line under docs/decisions/ or
# specs/ — a DR acceptance or spec approval is a human act (DR-029, DR-086 §2), and it is
# docs-only by construction, so the docs-corpus check alone cannot see it. `push-docs.sh`
# is a LABEL PRODUCER for that lane and, before this file existed, knew only the corpus
# rule and not this second precondition: it applied `docs-lane` unconditionally and
# opened PRs the lane was guaranteed to refuse with `exit 1` (#2158).
#
# MUST stay byte-identical to the other enforcers, or the never-wrong signpost is lost:
#   - packages/minspec/src/lib/governance-transition.ts   GOVERNANCE_PATH_PATTERN /
#                                                          STATUS_TRANSITION_PATTERN
#   - .github/workflows/docs-lane.yml                      govern= / the status
#                                                          gate's `grep -qE` pattern
# tests/governance-lane-eligibility.test.ts (#2078, extended #2158) pins this file's two
# literals against both of the above, so a drift on any one of the three producers is a
# red here rather than a silently reintroduced guaranteed-red PR.
#
# THIS IS A FLOOR, NOT A CENSUS — see governance-transition.ts's doc comment on
# STATUS_TRANSITION_PATTERN for the two classes known NOT to be covered (a `## Status`
# section whose body carries the ruling, and an amendment whose disposition lives only in
# its heading). Both are tracked on #2124.
# shellcheck disable=SC2034
GOVERNANCE_PATH_RE='^(docs/decisions/|specs/)'
STATUS_TRANSITION_RE='^[+-]([*_>|-]+ ?)?[*_]*[Ss]tatus:'
