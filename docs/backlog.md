# Backlog

One line per follow-up that would **not** change a decision within 30 days, so it gets no
GitHub issue (DR-023 amendment 2026-10-17, proposed; queue item ctg change 4). Anything
that would change a decision within 30 days is a GitHub issue instead.

Format: `- YYYY-MM-DD - <one-line follow-up> (source: <DR/SPEC/PR/issue>)`. A decision
record cites a line as `backlog: <the line's text after the date>`. When a line starts to
bear on a near-term decision, file it as an issue and strike it here with the issue number.

Newest first.

- 2026-10-18 - `parseVoterRecords` greedy base64 group over-consumes if two voter records are ever concatenated without a separator; fails safe (digest mismatch drops the record) (source: #2371)
- 2026-10-18 - `validate.py` `is_escaping_path` reports `error` regardless of `ownershipDeclaration`, so a `..` segment in `implements:` newly fails in a repo still at `warn`; unannounced (source: #2371)
- 2026-10-18 - a voter on voip-sms-inbox #121 read a harness-refresh PR as reverting a DR from accepted to proposed; not reproduced from the three-dot diff (`scripts/review-branch.sh:75`), only from a two-dot diff against a moved base; possibly related to #2052 (source: #2371)
- 2026-10-18 - ai-review guard exports `ROUND_RECORD_PREFIX` and `PENDING` with no reference in the shipped suite; SPEC-211's export gate covers functions only (source: SPEC-211)
- 2026-10-27 - drain-inbox same-file serialisation and queue de-duplication still unbuilt; the drain service now runs at concurrency 8 (source: DR-114)
