# Backlog

One line per follow-up that would **not** change a decision within 30 days, so it gets no
GitHub issue (DR-023 amendment 2026-10-17, proposed; queue item ctg change 4). Anything
that would change a decision within 30 days is a GitHub issue instead.

Format: `- YYYY-MM-DD - <one-line follow-up> (source: <DR/SPEC/PR/issue>)`. A decision
record cites a line as `backlog: <the line's text after the date>`. When a line starts to
bear on a near-term decision, file it as an issue and strike it here with the issue number.

Newest first.

- 2026-10-31 - DR-092 follow-up (d) still applies to any adopter that keeps its hand-written `minspec-ci-parity.yml`, whose remedy text keeps the self-defeating advice; moot wherever the managed copy replaces it (source: SPEC-079 DQ-3, the parity-ownership record, number 120, in docs/decisions/)
- 2026-10-30 - a normal build dispatch whose only deliverable is a spec or decision record, with a legitimate `Closes #N`, is refused by the delegated spec merge with `spec-pr-closes-build-issue`; fails closed, code left as it is (source: #3351)
- 2026-10-28 - CLAUDE.md "never write, suggest, or attempt a `minspec` shell command" needs a carve-out for agents calling the headless core's `minspec-core.cjs` once SPEC-136 ships; person-facing half stays (source: DR-116)
- 2026-10-18 - `parseVoterRecords` greedy base64 group over-consumes if two voter records are ever concatenated without a separator; fails safe (digest mismatch drops the record) (source: #2371)
- 2026-10-18 - `validate.py` `is_escaping_path` reports `error` regardless of `ownershipDeclaration`, so a `..` segment in `implements:` newly fails in a repo still at `warn`; unannounced (source: #2371)
- 2026-10-18 - a voter on voip-sms-inbox #121 read a harness-refresh PR as reverting a DR from accepted to proposed; not reproduced from the three-dot diff (`scripts/review-branch.sh:75`), only from a two-dot diff against a moved base; possibly related to #2052 (source: #2371)
- 2026-10-18 - ai-review guard exports `ROUND_RECORD_PREFIX` and `PENDING` with no reference in the shipped suite; SPEC-211's export gate covers functions only (source: SPEC-211)
- 2026-10-27 - drain-inbox same-file serialisation and queue de-duplication still unbuilt; the drain service now runs at concurrency 8 (source: the drain-concurrency record, number 114, in docs/decisions/)
- 2026-10-31 - the #3282 triage hold (`built-spec`) refuses planning, implementing and done as specified; specs with status `archived` or `superseded` still reach specify with the same duplicate-write risk, and an unreadable status line reads as no spec named (fails open) (source: #3376)
