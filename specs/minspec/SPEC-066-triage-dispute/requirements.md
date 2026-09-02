---
id: SPEC-066
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — triage classification is the methodology's admission gate
aspects: [triage, dispatch, gates, hitl, record-schema, provenance, measurement, prompt-injection, no-silent-gate]
depends_on: [SPEC-022]  # nothing here re-derives approval state; the verdict-record grammar it extends is DR-072's
relates_to: [DR-090, DR-072, DR-070, DR-076, DR-062, DR-066, DR-003, SPEC-046]
implements:
  - scripts/dispute-triage.sh
  - scripts/dispute-report.sh
  - packages/minspec/tests/triage-dispute.test.ts
implements_reason: >-
  The three paths above are NEW files this spec creates and owns. The dispute record
  grammar, its selector and its policy predicate are added to an EXISTING owned module
  (dispatch-ready-check.sh), and the two consumption sites are existing scripts modified
  in place — all three go under `affects:`, matching how SPEC-051/SPEC-059/SPEC-061
  classified the same modify-don't-own shape.
affects:
  - scripts/dispatch-ready-check.sh
  - scripts/triage-inbox.sh
  - scripts/roles/triage.md
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — the triage dispute lane: correct the classifier's INPUT, never override its output (Requirements)

> Materializes **[#1106](https://github.com/AIClarityAU/minspec/issues/1106)**
> (`role:architect`, Specify phase only) and implements **[DR-090](../../../docs/decisions/DR-090.md)**.
> DR-090 holds the *why* and the policy; this spec holds the *what*, the contracts, and
> the file allowlists. Read DR-090 §1–§8 first — every FR below traces to one of its
> numbered sections, and an FR that appears to contradict DR-090 is a defect in this
> spec, not a decision.

## One-Sentence Scope

Add a bounded, attributed, `bodyHash`-bound **dispute** lane that lets a named human
declare the work **type** the triage classifier misread, re-runs the unmodified
deterministic gate over that corrected input, and retains every disagreement as a
labelled corpus — without making any triage hold liftable and without modifying
`triage-decide.sh`.

## Context

`scripts/approve-issue.sh` (#1084 / DR-072) gives a held issue a human exit, but only
for `hold:tier`. `hold:human` is absolute because `human_only` is a **content class** —
who may *author* the work, not who may *permit* it. That boundary stays.

It assumes the classification is correct. When triage is wrong the only remedy today is
the sentence in DR-072 §3: *"make the issue body unambiguous about its type and
re-triage."* That is undocumented outside two script headers, teaches unbounded
prompt-gaming against a non-deterministic classifier, and destroys the human/classifier
disagreement — the only corpus that could ever say how often the human-only filter is
wrong, and in which direction.

**The distinction this spec is built on** (DR-090 §Context):

> **Correcting an input** = telling the gate what the work *is*. The gate then decides.
> **Overriding an output** = telling the gate what to *conclude*. The gate has not decided.

## Contract

### C-1 — The dispute record schema (`minspec-triage-dispute/1`)

Rendered and parsed by `scripts/dispatch-ready-check.sh`, so writer and reader are the
same code by construction (#983's rule, inherited unchanged).

```ts
/**
 * A human's CORRECTED INPUT to triage. Deliberately NOT a verdict:
 * `decision`, `hold`, `human_only`, `role` and `tier` are ABSENT and
 * unexpressible, so a perfectly forged dispute record authorises nothing.
 */
interface TriageDisputeRecord {
  /** Literal `"minspec-triage-dispute/1"`. */
  readonly gate: 'minspec-triage-dispute/1';
  /** The work type the human declares. Closed vocabulary — see C-2. */
  readonly declaredType: DisputableType;
  /** Derived from `declaredType`, never supplied by the caller. See C-2. */
  readonly direction: 'loosening' | 'tightening';
  /** The `hold` of the verdict being disputed, as recorded in that verdict. */
  readonly disputedHold: 'human' | 'none';
  /** The `verdictAt` of the verdict being disputed — pins WHICH verdict this is about. */
  readonly disputedVerdictAt: string;   // ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`
  /** GitHub login of the disputing human. Refused if a bot identity. */
  readonly disputedBy: string;
  /** sha256 of the issue body AS COMPOSED FOR TRIAGE: `"# " + title + "\n\n" + body`. */
  readonly bodyHash: string;            // `sha256:<hex>`
  /** When this dispute was minted. ISO-8601 UTC, not future-dated. */
  readonly verdictAt: string;
}
```

Wire form, delimited by a sentinel family **distinct from** the verdict family:

```
MINSPEC_DISPUTE_BEGIN
gate: minspec-triage-dispute/1
declaredType: chore
direction: loosening
disputedHold: human
disputedVerdictAt: 2026-08-31T04:11:07Z
disputedBy: <login>
bodyHash: sha256:…
verdictAt: 2026-09-02T09:20:00Z
MINSPEC_DISPUTE_END
```

`reason` is **not** a field (DR-090 §5): `record_scrub` restricts field values to
`[A-Za-z0-9:._/[]-]` so a value cannot forge a sibling field, and that charset cannot
carry a sentence. The reason goes in the comment prose above the fenced block.

### C-2 — The disputable type vocabulary

```ts
type AutoBuildableType =
  | 'bug' | 'feat' | 'chore' | 'docs' | 'test' | 'ci' | 'gate-repair';

type HumanOnlyType =
  | 'idea' | 'marketing' | 'positioning' | 'copy' | 'legal' | 'decide'
  | 'monetization' | 'billing' | 'irreversible-architecture'
  | 'cross-product-schema' | 'published-site' | 'live-outbound';

type DisputableType = AutoBuildableType | HumanOnlyType;

/** Derived, never supplied: an auto-buildable declaration LOOSENS, a human-only one TIGHTENS. */
declare function disputeDirection(t: DisputableType): 'loosening' | 'tightening';
```

Both vocabularies mirror `scripts/roles/triage.md`'s human-only type filter. A token
outside the union is refused at the writer with the valid set printed — never coerced,
never guessed.

### C-3 — New pure entry points on `scripts/dispatch-ready-check.sh`

| entry point | stdin | stdout | exit |
|---|---|---|---|
| `--render-dispute <declaredType> <disputedHold> <disputedVerdictAt> <disputedBy> [verdictAt]` | issue body | the comment-embeddable dispute block | `0` rendered · `1` refused (bad type, bot `disputedBy`, unhashable body, non-disputable hold) |
| `--newest-dispute` | trusted comment bodies | the dispute block with the newest well-formed `verdictAt` | `0` always (empty output = none) |
| `--may-dispute <hold> <human_only> <direction>` | — | `disputable` · `not-disputable [<code>]: <reason>` | `0` · `1` |
| `--fresh-dispute <bodyHash>` | trusted comment bodies | the newest dispute whose `bodyHash` equals the argument | `0` found · `1` none |

`--newest-dispute` and the existing `--newest-record` MUST share one
sentinel-parameterised implementation (DR-090 §5). Two selectors carrying their own
"take the newest one" is exactly how two of three readers kept the quoted-record defect
after the third was fixed (DR-072 §5a).

### C-4 — `scripts/dispute-triage.sh` (credentialed front end)

```
scripts/dispute-triage.sh <issue-number> --type <DisputableType> --reason "<one line>"
```

Provenance controls are DR-072 §4's, verbatim and for the same reasons: interactive-only
(no `--yes`, no `--force`), typed confirmation of the issue number, identity from
`gh api user` with bot logins refused. It holds **no policy of its own** — every rule is
asked of `dispatch-ready-check.sh`'s pure predicates.

### C-5 — `scripts/dispute-report.sh` (the corpus)

```
scripts/dispute-report.sh [--json] [--since <ISO-8601>]
```

Emits one row per dispute: issue, `declaredType`, `direction`, `disputedHold`,
`outcome ∈ {upheld, rejected, tightened, pending}`, and the aggregate upheld rate over
loosening disputes with its `n`. `pending` rows are reported **separately** and are never
folded into the rate (FR-11).

## Requirements

### FR-1 — The dispute record is rendered by the reader, in its own sentinel namespace

`--render-dispute` mints a `minspec-triage-dispute/1` block delimited by
`MINSPEC_DISPUTE_BEGIN` / `MINSPEC_DISPUTE_END`. Every field value passes through the
existing `record_scrub`. `bodyHash` is computed from stdin by the existing `body_hash`
and the render **fails closed** if no digest can be computed — an unfalsifiable record
is worse than none. (DR-090 §5)

### FR-2 — The dispute schema cannot express an authorisation

`--render-dispute` MUST NOT emit `decision`, `hold`, `human_only`, `role` or `tier`, and
`dispatch-ready-check.sh`'s dispatch reader MUST NOT read the dispute sentinel family at
all. A dispute record placed on an issue changes nothing about that issue's
dispatchability until a **new verdict record** is minted. (DR-090 §3.3)

### FR-3 — `--may-dispute` is deny-by-default and refuses the overlapping lanes

| `hold` of the disputed verdict | `direction` | outcome |
|---|---|---|
| `human` | `loosening` | **disputable** — the primary case |
| `none` | `tightening` | **disputable** — the classifier may have been wrong permissively |
| `tier`, `specify` | any | refused `[use-approval]`, naming `scripts/approve-issue.sh` (DR-090 §3.4) |
| `info`, `unknown` | any | refused `[no-type-to-correct]` — a type declaration does not supply missing information, and the gate reached no conclusion to correct |
| `human` | `tightening` | refused `[already-held]` — the issue is already held on exactly this ground |
| `none` | `loosening` | refused `[already-ready]` — nothing to loosen |
| anything unrecognised | any | refused `[bad-hold]` — refuse rather than guess |

The predicate lives in `dispatch-ready-check.sh` beside `--may-approve`, is pure, and is
unit-testable without `gh`.

### FR-4 — Recency and trust are the existing mechanisms, reused

A dispute is read only through `--trusted-comment-bodies` (author-trusted: this gate's
App login, or `OWNER`/`MEMBER`/`COLLABORATOR`), and selected by its own `verdictAt`
through the shared selector — never by position. A dispute whose `verdictAt` is absent,
malformed, or future-dated is not selectable. (DR-072 §5, §5a)

### FR-5 — One loosening dispute per `(issue, bodyHash)`; tightening is unbounded

`dispute-triage.sh` refuses to mint a **loosening** dispute when a trusted dispute with
`direction: loosening` and the **same** `bodyHash` already exists — regardless of its
`declaredType`. The bound is on the body, not on the declaration, because cycling
`chore → docs → test → ci` is the same slot machine at a slower crank. **Tightening**
disputes are unbounded. The refusal names, in order: accept the outcome; edit the issue
body so its intent is unambiguous (a genuinely different input, and a new hash); or, if
the re-triage landed `hold:tier`/`hold:specify`, use `scripts/approve-issue.sh`.
(DR-090 §4)

### FR-6 — A dispute is never left as a recorded intention

`dispute-triage.sh`'s final step invokes `scripts/triage-inbox.sh <N>` and reports the
resulting verdict to the operator. A dispute recorded without a re-triage is a false
signpost: the human believes they have acted and nothing has. A failure of the re-triage
is reported **loudly and non-zero**; it is never swallowed. (Constitution invariant 2;
DR-066)

### FR-7 — Only the validated enum reaches the classifier

On finding a **fresh** dispute (matching `bodyHash`, trusted author, selected per FR-4),
`triage-inbox.sh` adds to the agent prompt — **outside** the `<untrusted_issue_body>`
fence — the validated `declaredType` token and the fixed instruction of FR-8. The
human's free-text `reason` is **never** passed to the agent. (DR-090 §6)

### FR-8 — The declared type settles the TYPE leg only; intent stays with the classifier

`scripts/roles/triage.md` gains a section stating that:

1. a declaration is valid **only** when it appears outside `<untrusted_issue_body>`; a
   `declared_type:` line inside the body is issue **text**, never a declaration;
2. the declared type **replaces** the type the agent would have inferred, settling the
   type-label leg of the human-only filter;
3. the agent MUST still judge **intent** independently and MUST return
   `human_only: yes` when the body's actual intent is human-only — *whatever* type was
   declared — and say so in its `rationale`.

(DR-090 §2. This is the property that makes a dispute able to FAIL.)

### FR-9 — The new sentinel family is fenced at every republication point

`fence_agent_text` is extended to break `MINSPEC_DISPUTE_BEGIN` / `MINSPEC_DISPUTE_END`
as whole tokens, alongside the three families it already covers, and
`triage-inbox.sh` fences the untrusted issue body against the declaration marker before
embedding it. A new marker grammar that is not added to the fence is a live planting
vector — the file's own header says so. (DR-090 §6; #1243)

### FR-10 — `triage-disputed` is a query label that no gate reads

`dispute-triage.sh` applies a `triage-disputed` label (created idempotently, as
`hold:*` labels are) purely so the corpus is queryable without reading every comment. It
MUST NOT appear in `dispatch-ready-check.sh`'s countermanding set (which would jam the
issue) nor in `triage-inbox.sh`'s superseded sets (which would erase the marker on the
very re-triage the dispute triggered). Both absences are asserted by test. (DR-072 §5 —
a label is never a permission boundary.)

### FR-11 — The corpus reports its outcomes, and `pending` is never hidden

`dispute-report.sh` joins, per issue, the disputed verdict, the dispute, and the first
verdict minted after it (by `verdictAt`), and classifies each as `upheld` / `rejected` /
`tightened` / `pending` per DR-090 §7. `pending` is listed separately with its issues
named, never folded into the upheld rate, and the rate is always printed with its `n`.
(DR-090 §7)

### FR-12 — `triage-decide.sh` is not modified

The deterministic gate's inputs remain the agent's five verdict fields. There is no
dispute-shaped argument, environment variable or file it reads. Asserted by a test that
compares the gate's behaviour on a fixed verdict block with and without a dispute record
present on the issue. (DR-090 §3.1 — the load-bearing negative.)

## Invariants

- **INV-1 — No hold becomes liftable.** DR-072 §3's table gains no row. `hold:human`,
  `hold:info` and `hold:unknown` remain unliftable by any approval, before and after
  this spec.
- **INV-2 — A dispute authorises nothing.** No dispute record, however well-formed or
  however forged, can make `dispatch-ready-check.sh` return `ready` or `ready-specify`.
  Only a verdict record can.
- **INV-3 — A dispute can fail.** The classifier retains the authority to return
  `human_only: yes` over a declared auto-buildable type, and doing so is a **correct**
  outcome (FR-8).
- **INV-4 — Bounded retry.** At most one loosening dispute exists per
  `(issue, bodyHash)` (FR-5).
- **INV-5 — Untrusted text never becomes a declaration.** Only the enum crosses into the
  prompt, and only from outside the untrusted fence (FR-7, FR-8, FR-9).
- **INV-6 — Repo invariant 1 (offline core) is untouched.** Every path added here lives
  in `scripts/`, is dev-time dispatch machinery, and ships in no `.vsix` (DR-015).
- **INV-7 — Repo invariant 2 (no silent gate).** The dispute lane is an *instrument plus
  a front end*, not a gate — but FR-6's re-triage failure and FR-11's `pending` rows are
  reported loudly and non-zero, so nothing here fails quietly.

## Acceptance Criteria

- [ ] **Corrected input, not overridden output** — a dispute changes what the classifier
      is told the issue *is*, and `triage-decide.sh` is byte-identical. (FR-1, FR-7, FR-12)
- [ ] **A forged dispute buys nothing** — a dispute record authored by an untrusted
      identity, or one hand-crafted with extra `hold: none` / `human_only: no` lines,
      leaves dispatch refusing exactly as before. (FR-2, FR-4, INV-2)
- [ ] **`hold:human` is still absolute** — `--may-approve` refuses it before and after,
      and no configuration or dispute permutation reaches an affirmative. (INV-1)
- [ ] **The lane can refuse a human** — a loosening dispute on an issue whose body reads
      as a decision re-triages to `human_only: yes`, and that is recorded as `rejected`,
      not as an error. (FR-8, INV-3)
- [ ] **No slot machine** — a second loosening dispute against an unchanged body is
      refused, and the refusal names the three honest remedies. (FR-5, INV-4)
- [ ] **Lanes do not overlap** — a dispute against `hold:tier` is refused with a pointer
      to `approve-issue.sh`; an approval against `hold:human` is refused as it is today.
      (FR-3)
- [ ] **No recorded intention** — a dispute always ends with a re-triage having been
      attempted, and a failed re-triage exits non-zero with the reason printed. (FR-6)
- [ ] **The marker is fenced** — an agent summary or issue body containing
      `MINSPEC_DISPUTE_BEGIN` is republished broken, and is not selectable as a dispute.
      (FR-9)
- [ ] **The label is inert** — adding `triage-disputed` by hand changes no gate outcome,
      and a re-triage does not remove it. (FR-10)
- [ ] **The corpus answers the question** — `dispute-report.sh` prints an upheld rate
      with its `n`, lists `pending` disputes separately by issue number, and distinguishes
      `rejected` from `tightened`. (FR-11)
- [ ] **The kill criterion is checkable** — the report's output is sufficient, with no
      further tooling, to evaluate DR-090 §8 at `n ≥ 20`. (FR-11)

## Open Questions (Clarify)

- **DQ-1 — Does `--type` accept the human-only vocabulary in v1, or only tightening
  against `hold:none`?** This spec says the full union (C-2), with `--may-dispute`
  (FR-3) doing the admissibility work. The alternative is a narrower `--type` that only
  accepts auto-buildable tokens plus a separate `--tighten` flag. **Recommendation: the
  full union (rec)** — one vocabulary means one predicate and one corpus schema; **its
  cost** is that a human-only token is typeable in a position where it is usually a
  refusal, so the refusal text has to do real explanatory work.
- **DQ-2 — Where does `dispute-report.sh` read from: `gh` at report time, or a cached
  JSONL like `shadow-triage.sh`?** **Recommendation: `gh` at report time (rec)** — the
  records are already the durable, fresh-clone-surviving store and a cache is a second
  source of truth to drift; **its cost** is that the report is slow and unavailable
  offline, which is acceptable for dev-time machinery but must be stated in its header.
- **DQ-3 — Should a `rejected` dispute be re-openable after the human edits the body?**
  FR-5 already permits it (a new `bodyHash` is a new pair). The question is whether the
  report should link the chain across body revisions. **Recommendation: link it (rec)**,
  because DR-090 §4's residual is only *visible* if the chain is; **its cost** is that
  the join needs the issue's edit history, which `gh` exposes awkwardly and may push this
  to a follow-up.
- **DQ-4 — Is `gate-repair` a real type token or prose?** `triage.md` lists
  "gate-repairs / validator-tightening" as auto-buildable but not as a label. C-2 mints
  `gate-repair` as a token. Confirm, or fold it into `chore`.

## Sub-issues

Each is a `role:dev`, `agent-ready`-shaped task. **None is filed yet** — the authoring
agent runs without network or `gh` access by dispatch policy (DR-008), so these are
written to be transcribed, not designed. Each must carry `role:dev` + `agent-ready` and
the line `See DR-090 for design rationale`.

### (A) The pure half — dispute grammar, selector and predicate

- **Contract:** C-1, C-2, C-3 (`--render-dispute`, `--newest-dispute`, `--may-dispute`,
  `--fresh-dispute`), plus the `fence_agent_text` extension of FR-9.
- **File allowlist:** `scripts/dispatch-ready-check.sh`,
  `packages/minspec/tests/triage-dispute.test.ts`.
- **Invariants:** INV-2, INV-5. Repo invariants 1 and 2.
- **Tests to pass:** round-trip render→select→parse; a dispute block is invisible to
  `--newest-record` and to the dispatch reader; a dispute carrying injected
  `hold: none` / `human_only: no` lines still yields `not-ready` at dispatch; the full
  FR-3 refusal table, one case per row; `--render-dispute` refused for a bot
  `disputedBy` and for an out-of-vocabulary type; the shared selector is proven shared
  by driving both sentinel families through it; `fence_agent_text` breaks the new pair.
- **Note:** `--newest-dispute` MUST be implemented by parameterising the existing
  `_newest_record_impl`, not by copying it.

### (B) The credentialed front end

- **Contract:** C-4, and FR-5, FR-6, FR-10.
- **File allowlist:** `scripts/dispute-triage.sh` (new),
  `packages/minspec/tests/triage-dispute.test.ts`.
- **Invariants:** INV-4, INV-7.
- **Tests to pass:** refuses without a TTY; refuses a bot `gh api user` identity;
  refuses a second loosening dispute against an unchanged `bodyHash` and prints all
  three remedies; refuses on a stale verdict (`bodyHash` mismatch) before doing anything
  else; posts the record **before** the label; exits non-zero and prints the reason when
  the FR-6 re-triage fails.
- **Note:** the dispute record is written under the **human's** identity while the
  re-triage it invokes writes under the **bot's** (`scripts/lib/gh-bot.sh`). Both are
  trusted authors; the separation is deliberate and must not be collapsed.

### (C) The consumption half — prompt injection and the role instruction

- **Contract:** FR-7, FR-8, FR-9 (the `triage-inbox.sh` half).
- **File allowlist:** `scripts/triage-inbox.sh`, `scripts/roles/triage.md`,
  `packages/minspec/tests/triage-dispute.test.ts`.
- **Invariants:** INV-3, INV-5, and FR-12's negative.
- **Tests to pass:** with a fresh dispute present, the composed prompt contains the
  declared-type line outside the untrusted fence and does **not** contain the reason
  text; with a stale or untrusted dispute, the prompt is byte-identical to today's; an
  issue body containing a `declared_type:` line is fenced and does not alter the prompt's
  declaration section; driving the real `triage-inbox.sh` with a stub agent that returns
  `human_only: yes` over a `chore` declaration still yields `hold:human` (INV-3).

### (D) The corpus report and the kill-criterion review

- **Contract:** C-5, FR-11.
- **File allowlist:** `scripts/dispute-report.sh` (new),
  `packages/minspec/tests/triage-dispute.test.ts`.
- **Invariants:** INV-7.
- **Tests to pass:** outcome classification over a fixture corpus covering all four
  outcomes; `pending` excluded from the rate and listed by issue; the rate is never
  printed without its `n`; `--json` output is stable and parseable.
- **Note:** resolve DQ-2 before implementing.

## Non-goals

- Disputing **tier** or **role** (DR-090 §3.4). `hold:tier` already has DR-072's
  approval path.
- Any change to `triage-decide.sh` (FR-12).
- Any widening of DR-072 §3's liftable-hold table (INV-1).
- Deterministic type inference from GitHub type labels — blocked on #1134, recorded as a
  DR-090 follow-up rather than assumed here.
- Backfilling disputes over the existing `needs-review` corpus. DR-072's "deliberately
  NOT a `--backfill`" reasoning applies unchanged: minting a record no human authored is
  the hole itself.
