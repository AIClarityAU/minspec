---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — the spec→code ownership contract (SPEC-038's sibling)
aspects: [ownership, spec-gate, validation, parity, tier-0, non-ts-repos]
relates_to: [SPEC-038, SPEC-051, SPEC-070, DR-012, "#1521", "#1491"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — a Go/Rust/Ruby/Java/… repo must be able to declare true ownership, and a rejected token must never be reported as absent

> **SPECIFICATION ONLY.** No code, script, or test is created by the dispatch that
> produced this. A human reads it, answers **[Decisions needed
> (Clarify)](#decisions-needed-clarify)**, and approves it through the normal
> spec-approval gate before anything is built.

Materializes **[#1521](https://github.com/AIClarityAU/minspec/issues/1521)**, surfaced
during **#1491**'s adversarial review. Sibling of **SPEC-038** (the ownership
declaration requirement this spec extends) and **SPEC-051** (`implements: none` as an
honest escape — the same escape this defect turns into a forced falsehood for the
affected languages).

## One-Sentence Scope

Make `implements:`/`affects:` ownership declarable for the compiled/scripted languages
`OWNED_SRC_EXT_PATTERN` currently excludes, and make the validator's diagnostic say
"not a recognized source extension" — never "missing" — whenever a declared token is
present but discarded, regardless of which languages the pattern does or does not cover.

## Context

### The defect, verified against this repo's current `HEAD`

`OWNED_SRC_EXT_PATTERN` (`packages/minspec/src/lib/ownership-path-rules.ts:23-24`):

```
'\\.(?:ts|tsx|js|jsx|mjs|cjs|py|sh|bash|json|jsonc|css|scss|less|html|htm|vue|svelte|sql|ya?ml|toml)$'
```

has no entry for Go, Rust, Ruby, Java, Kotlin, C#, C/C++, PHP, Swift, Dart or Elixir.
`isValidOwnedPath` (`ownership-path-rules.ts:44-60`) rejects any token that does not end
in one of the listed extensions, and `spec-validator.ts:813` computes
`declaresCode = implTokens.some(isValidOwnedPath)`. A Go repo's spec declaring
`implements: [internal/server/handler.go]` gets `declaresCode === false` and, at
`spec-validator.ts:817-824`, the rule `ownership.implements.missing` fires with the
message *"T3/T4 spec past Clarify does not declare its owned code (`implements:`)"* —
which is false: the frontmatter plainly declares it. The token was recognized and
discarded, not absent.

**The mirror is exact, and pinned.** `scripts/hooks/spec-gate.py:313-315`'s
`_SRC_EXT_RE` carries the identical extension list, and
`packages/minspec/tests/ownership-path-parity.test.ts` asserts the two match
byte-for-byte by reading `spec-gate.py`'s source directly. Any widening must land in
both constants, in the same change, or that test fails — this is the parity gate
working as designed (SPEC-038), not an obstacle to route around.

### Why the severity matters now, not hypothetically

This repo's own `.minspec/config.json:57` already sets `"ownershipDeclaration": "error"`
— the state SPEC-038 FR-7's ratchet is designed to reach once a repo's corpus is clean.
Under `error`, `ownership.implements.missing` is a hard validator failure
(`spec-validator.ts:820`), which `violationsIntroducedByApproval` (`:860+`) treats as a
new error the approval step must not introduce. For an affected-language repo on
`error`, the only way past the check is `implements: none` + `implements_reason:` — a
declaration that the spec owns no code, which is false for a spec that plainly does.
That inverts SPEC-051's own reasoning for the escape: *"None is a valid explicit
answer"* becomes "none is the only answer available, true or not."

### Scope: MinSpec is not TS-only

`.minspec/` is the opt-in marker for any repo regardless of language (constitution
invariant 3), the extension ships to the general marketplace, and every other rule in
the ownership path (`/` required, no absolute/parent-escape, no infra prefix) is
language-agnostic. Nothing on record says the extension list was a deliberate TS/Python-
only scope decision — it reads as drawn from what this monorepo happens to contain.

### The asymmetry this spec closes, stated the SPEC-038 way

SPEC-038's own validator-asymmetry framing (`#137`) — checking that a *required*
declaration is present, not only that a present one resolves — has a second instance
here: the validator checks whether a present token is *recognized*, but when it is not,
it reports the wrong failure (*"absent"* instead of *"not recognized"*). Both the
missing-direction and the wrong-direction failures are in scope.

## Functional Requirements

- **FR-1 (the diagnostic must never say "missing" over a present-but-rejected token,
  independent of FR-2's outcome).** When `implTokens.length > 0`, at least one token
  fails `isValidOwnedPath`, `declaresCode` is still false (no token passed), and the
  spec is not using the `none` escape, the validator MUST NOT emit
  `ownership.implements.missing`'s current message. It MUST instead report that the
  declared token(s) were not recognized — naming the offending path(s) — distinct from
  the true-missing case (`implTokens.length === 0`). This closes the misleading-message
  defect on its own and is correct today regardless of which extensions the pattern
  covers tomorrow.
- **FR-2 (Clarify decides the extension-set strategy — see DQ-1).** The pattern that
  decides which paths `isValidOwnedPath` accepts MUST be changed, consistent with
  whichever option Clarify selects, so that the languages named in #1521
  (Go/Rust/Ruby/Java/Kotlin/C#/C/C++/PHP/Swift/Dart/Elixir, at minimum) can produce a
  real `implements:`/`affects:` declaration.
- **FR-3 (twin parity, unconditional).** Any change to the accepted-extension surface
  MUST land in `OWNED_SRC_EXT_PATTERN` (`ownership-path-rules.ts`) and `_SRC_EXT_RE`
  (`spec-gate.py`) in the same change, and
  `packages/minspec/tests/ownership-path-parity.test.ts` MUST continue to pass
  byte-for-byte. A change to one twin without the other is the exact defect class the
  parity test exists to catch (SPEC-038) and MUST NOT ship.
- **FR-4 (no narrowing).** Every extension currently accepted MUST remain accepted —
  this is an additive fix for excluded languages, not a redefinition of the existing
  TS/Python/etc. surface. A regression test MUST assert the pre-change accepted set is
  a subset of the post-change accepted set.
- **FR-5 (precision is preserved).** Whatever strategy Clarify selects, a bare prose
  token with no `/`, an absolute or parent-escaping path, an infra-prefixed path
  (`node_modules/`, `out/`, `dist/`, `coverage/`, `.git/`), and a `.md`/`.txt` doc path
  MUST remain rejected. The allowlist's purpose — keeping a non-code reference out of
  the owned set — MUST NOT be weakened as a side effect of closing the language gap.
- **FR-6 (existing escape untouched).** `implements: none` + `implements_reason:`
  continues to validate exactly as it does today (SPEC-051); nothing here changes its
  semantics, only removes the pressure to use it dishonestly.

## Acceptance Criteria

- **AC-1 (true positive, once FR-2 lands).** `implements: [internal/server/handler.go]`
  on a T3/T4 spec past Clarify (`plan: in-progress`) yields `declaresCode === true`; no
  `ownership.implements.missing` violation.
- **AC-2 (honest diagnostic, provable today).** `implements: [main.zig]` (an extension
  no option on the table adds) on the same spec shape yields a violation that names
  `main.zig` and states it is not a recognized source extension — never the
  "does not declare" wording. This AC is satisfiable by FR-1 alone, independent of
  FR-2's outcome, and should be the first thing a regression test locks in.
- **AC-3 (true absence still reports "missing").** No `implements:`/`affects:` key at
  all still yields today's `ownership.implements.missing` wording unchanged — FR-1 must
  not blur the two cases into one message.
- **AC-4 (parity, byte-for-byte).** `ownership-path-parity.test.ts` passes after the
  change with no manual edits to the test itself.
- **AC-5 (no narrowing).** Every extension in the pre-change `OWNED_SRC_EXT_PATTERN`
  still matches post-change, asserted by a regression test over the literal pre-change
  list.
- **AC-6 (precision preserved).** `docs/readme.md`, a bare token `the-thing`, and
  `node_modules/foo.go` (once `.go` is accepted) all still fail `isValidOwnedPath`.
- **AC-7 (escape unaffected).** `implements: none` + a reason still validates clean;
  without a reason it still fails, exactly as `ownership.test.ts` AC-2/AC-2b already
  pin.
- **AC-8 (Gate agreement, if FR-2 widens the pattern).** For each newly-accepted
  extension, `scripts/hooks/spec-gate.py`'s `declared_impl_files` actually adds the
  path to its owned set on a fixture repo — the validator accepting a token the gate
  does not arm would reopen exactly the parity gap SPEC-038 closed.

## Invariants

- **INV-1 (constitution 2, no silent gate).** The validator must never report a
  declaration as absent when one is present and was discarded — the affected repos'
  only route past an `error`-severity check must not be forced through a false
  statement (`implements: none` on a spec that owns code).
- **INV-2 (parity, existing — SPEC-038).** The TS validator's accepted-path set and the
  Python gate's owned-set computation never diverge; FR-3 is this invariant applied to
  this change.
- **INV-3 (constitution 1, offline).** No network call is introduced anywhere in this
  path; the fix is a regex/allowlist and a diagnostic string, evaluated locally.
- **INV-4 (constitution 3, blast radius).** The gate change lives in `scripts/hooks/
  spec-gate.py`, which only runs inside a repo carrying `.minspec/`; nothing here
  changes behaviour for a repo that has not opted in.

## Decisions needed (Clarify)

### DQ-1 — Which strategy closes the language gap?

- **Option A — widen `OWNED_SRC_EXT_PATTERN` to the common compiled/scripted languages,
  in both twins (rec).** Small, mechanical, restores the feature for most repos while
  keeping the allowlist's precision shape. *Cost:* an extension allowlist is a
  permanent guessing game — every language added is one more to remember, and the next
  unlisted language hits FR-1's honest "not recognized" message rather than a false
  "missing" one, but still can't declare ownership until someone widens the list again.
- **Option B — invert to a denylist:** any path with `/` and *some* extension counts as
  owned code, excluding known non-source (`.md`, `.txt`, lockfiles, generated/vendored
  dirs) and the existing infra prefixes. *Cost:* a genuine behaviour change for every
  existing repo — paths the allowlist previously discarded (e.g. a stray `.txt`
  reference, a config format nobody added) would start counting as owned, silently
  widening every spec's owned set on the day it ships. Needs a full corpus re-run
  (this repo's `specs/**`) to confirm zero new false-owned paths before it could merge,
  and gives up the precision guarantee Option A keeps.
- **Option C — keep the list exactly as-is; ship FR-1 alone.** The diagnostic becomes
  honest ("not a recognized source extension" instead of "missing"), but the affected
  languages still cannot use the feature at all. *Cost:* leaves the underlying defect
  (#1521's actual ask) unaddressed; likely reopens the issue.

FR-1 and FR-3 through FR-6 apply under every option; FR-2's content is whichever
option is chosen. Picking C alone, without a committed follow-up issue for the
language gap itself, leaves a "MinSpec doesn't really work outside TS/Python" prose
leak per this repo's traceability convention — file the follow-up if C is chosen.

### DQ-2 — If Option A, exactly which extensions?

- **Recommended starting set (rec):** `go`, `rs`, `rb`, `java`, `kt`, `kts`, `cs`, `c`,
  `h`, `cc`, `cpp`, `cxx`, `hpp`, `hxx`, `php`, `swift`, `dart`, `ex`, `exs` — the
  languages #1521 names by name, at their conventional extensions. *Cost:* still an
  incomplete list (no Scala, Clojure, Lua, R, Perl, Objective-C, Groovy, F#, Haskell,
  Erlang…); each omission repeats the same gap one language at a time, mitigated only
  by FR-1's honest message.
- **Broader set:** add the above plus `scala`, `clj`, `cljs`, `lua`, `r`, `pl`, `pm`,
  `m`, `mm`, `groovy`, `fs`, `fsx`, `hs`, `erl`. *Cost:* more surface to keep byte-
  identical across twins forever, and a wider precision trade-off (FR-5) to verify
  before shipping — each addition is one more thing the corpus re-run (AC-6-style)
  must clear.

## Why no new DR

The DR-359 filter asks whether the decision costs more than a day to undo. Widening (or
not widening) an extension allowlist behind a parity test is a small, revertable diff —
Option A/C are strictly additive to two constants and one message string; even Option B,
the costliest path, is a regex swap with no migration, no hash, no sidecar involved (no
kinship with SPEC-070's hash-exit class of irreversible decision). `docs/decisions/
INDEX.md` has no existing entry for ownership-path extension scope. If Clarify selects
Option B and the corpus re-run finds a nontrivial false-owned population, revisit this
— that would be the one outcome costly enough to warrant a DR.

## Out of scope

- Re-litigating SPEC-038's ownership requirement itself, or the `warn`/`error` ratchet
  (SPEC-038 FR-7) — this spec only fixes what counts as a valid declaration and what the
  validator says when one doesn't.
- Any language MinSpec's classifier or other Tier-0 code paths treat specially outside
  ownership (none currently do — verified: `OWNED_SRC_EXT_PATTERN` is the only
  language-extension allowlist gating `implements:`/`affects:`).
- `scripts/hooks/spec-gate.py`'s existence-filtered fuzzy (`tasks.md` backtick) arm
  beyond carrying whatever extension set DQ-1 settles on — its filter logic is
  unchanged.

## Test plan (for the Plan phase to place)

1. AC-1/AC-2/AC-3: extend `packages/minspec/tests/ownership.test.ts` with cases for a
   representative excluded extension (pre-fix: red) and the `main.zig`-style never-
   accepted case (diagnostic wording, independent of FR-2).
2. AC-4: `ownership-path-parity.test.ts` already exists and must keep passing — no new
   test, but re-run as a gate on the same PR.
3. AC-5: a regression test asserting `OLD_PATTERN_EXTENSIONS ⊆ NEW_PATTERN_EXTENSIONS`
   (literal list captured from `HEAD` at Plan time, per this repo's convenient-form
   discipline — measure the full set, not a truncated sample).
4. AC-6: extend the existing precision-guard tests (`ownership.test.ts` — the `#812`
   describe block already covers infra/comment/escape cases) with one non-source-
   extension case per newly-accepted language family.
5. AC-7: already pinned by `ownership.test.ts` AC-2/AC-2b; re-run, do not duplicate.
6. AC-8: a `spec-gate.py`-side fixture (mirroring `ownership.test.ts`'s
   `#460`/AC-5 describe block, `:119-158`) for one newly-accepted extension, proving
   `declared_impl_files` arms on it.
