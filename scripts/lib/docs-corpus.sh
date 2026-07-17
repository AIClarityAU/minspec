#!/usr/bin/env bash
# docs-corpus.sh — the ONE bash definition of the docs-lane / human-owned path
# corpus (SPEC-039 INV-2). Sourced, never executed.
#
# A path in this corpus is owned by the docs-lane / human approval, NOT by
# code-quality auto-merge:
#   - push-docs.sh          uses it to decide what it may push onto the docs-lane
#   - dispatch-issue.sh (#833) uses it to WITHHOLD native auto-merge (DR-061) on an
#     agent PR that touches it — such a change lands as a human-reviewed proposal
#     (the docs-lane / Approve owns its merge), never auto-merged on ai-review:pass.
#
# MUST stay byte-identical to the other enforcers, or the never-wrong signpost is
# lost (validator-asymmetry class this repo tracks):
#   - packages/minspec/src/lib/docs-corpus.ts   DOCS_CORPUS_REGEX (the TS canonical)
#   - .github/workflows/docs-lane.yml            allowed=
# The docs-corpus lock-step test pins the TS copy; the dispatch test pins THIS copy
# against it.
#
# Coverage: specs/** · docs/** · .minspec/approvals/** · top-level *.md.
# Known residual (tracked, NOT covered here so the four enforcers stay in lock-step):
# .minspec/constitution.md and .cursorrules are approvables but sit outside this
# regex; extending the corpus to them is a SPEC-039 amendment across all enforcers.
# shellcheck disable=SC2034
DOCS_CORPUS_RE='^(specs/|docs/|\.minspec/approvals/|[^/]+\.md$)'
