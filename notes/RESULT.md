# Review-gate audit (DECISION.md section 6, part zero), 2026-10-15
Seed random.Random(20261015).sample(sorted(pool), 20), pool = 60 PRs in changes_tl.jsonl.
Sample: 2631 1965 1956 2098 2115 1772 2452 2484 1783 1778 2239 2617 2144 2089 2067 2172 2280 2259 2294 2315
Judge A (opus): real 17/20 (8 code, 9 claim); NOT: 1783 2617 2144
Judge B (opus): real 16/20 (7 code, 9 claim); NOT: 1956 1783 2617 2144
Agreement 19/20 (exact category). Disagreement: 1956.
Bundles: notes/bundle/*.md (finding + first non-merge follow-up diff, from local git objects; commits API refused by the wrapper).
