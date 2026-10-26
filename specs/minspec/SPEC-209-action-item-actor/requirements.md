---
id: SPEC-209
type: requirements
# 🔒 Once approved, hash-locked: approved bytes recorded in .minspec/approvals/. ANY edit voids approval (hash → stale) — re-run "MinSpec: Approve Spec". DR-012.
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination; a peer sweep re-sending another session's pending items is a cross-session coordination path
aspects: [hitl, action-items, cross-session, autonomy, no-silent-gate, blast-radius, tier-0, offline, determinism, never-wrong]
depends_on: [DR-086]  # the stop list whose classes define what "human-only" means here
relates_to: [SPEC-044, SPEC-027, SPEC-054, DR-072, DR-076, DR-003, "#1857", "#1236", "#1235", "#1816", "#2056"]
# Ownership (SPEC-038) is deliberately NOT declared yet. Which files this spec creates
# depends on Clarify D2 (where the parser lives) and D4 (whether any act-site refusal is
# built here). Declare implements:/affects: in Plan, BEFORE approval mints a hash -
# adding them afterwards voids it.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-209: Every ➡️ item says who may authorise it, and a non-human consumer can read that

Triggered by: #1857 (a peer sweep re-sent human-only items to an agent four times).
Rests on: [DR-086](../../../docs/decisions/DR-086.md) §2 (the enumerated stop list).
No new DR is minted: every choice below is a text convention plus a pure parser, and each
can be reverted in under a day (the parent register's ADR filter: a DR is required only for
a choice that cannot be undone in under a day). If Clarify D4 picks an act-site refusal
that changes a hook or a ruleset, Plan re-checks that filter.

## In plain terms

A ➡️ line already means "this waits on you" to a person. A program reading the same text
cannot tell "an agent could do this" from "only you may do this", because nothing in the
line says so. A chief-of-staff sweep reading a session's pending items saw four of them,
treated them as recommendations to carry out, and sent "do as you've recommended" four
times. All four were things only the founder may do. The only thing that stopped a
`--admin` merge was the receiving agent remembering a prose rule each time.

This spec adds one short tag to every ➡️ line saying who may authorise it, a small
offline parser that reads the tag, and a rule that an untagged line counts as human-only.
A sweep then asks the parser which items it may re-send, instead of guessing.

The tag is a **routing hint, not the safety boundary.** A wrongly tagged line still fails
open at the tag. The real refusal has to live where the act happens, the way `--admin`
merge already cannot be done with the bot token. Clarify D4 asks which other acts need
that.

## Context

**The convention is prose, three times over.** The "Human action items" section is
rendered from `packages/minspec/src/lib/template-registry.ts:221-243` (and again at `:678`
and `:758`, for the other harness files). It defines the ➡️ marker, the `**Your turn**`
block, reply keys, and done-signals for human-only acts (`:235`). It defines no field a
program can read: a done-signal ("tell me `x` once you have closed it") is distinguishable
from an agent key ("`r` re-review") only by reading the English.

**No consumer in this repo parses ➡️ lines today.** A search of `packages/*/src`,
`scripts/` and `.githooks/` for the ➡️ character finds only `template-registry.ts`. The
sweep in #1857 is the chief-of-staff skill, which lives in the operator's own Claude
configuration outside this repository (the same place CLAUDE.md says the merge-funnel ask
rule lives, #2056). So this repo can define the contract and ship the reader; it cannot by
itself change the sweep. That limit is stated in Limitations and AC-8.

**#1236 (the block is emitted at all) has no code in this tree.** I searched `packages/`
and `scripts/` for `1236` and found only a CHANGELOG line and a test fixture. This spec's
validator (FR-6) is written so #1236's backstop can call it, but this spec does not build
that backstop.

**Where acts are already refused, and where they are not.**

- `--admin` merge: the issue states, and the founder rule in memory agrees, that no App
  token can bypass the ruleset, so an agent in the container cannot perform it. I believe
  this, unverified here: no ruleset read was possible on this dispatch (no network).
- Any `gh` write from a HOST session: refused by `scripts/hooks/host-write-guard.py`
  (#1816), which allows the container path unchanged (its docstring, lines 16-19).
- Closing an issue "as discharged" (an acceptance decision, DR-086 §2.2): **nothing
  refuses it.** I believe the bot token can close issues, unverified. This is the one item
  of the four in #1857 with no act-site witness at all.
- A design-intent answer on a `hold:human` issue: `hold:human` is never liftable through
  `scripts/approve-issue.sh` (`:247`, DR-072 §3), but an agent answering the question in a
  comment is not refused by anything.

## Terms

- **Item** - one line beginning with ➡️, inline or inside a `**Your turn**` block.
- **Actor tag** - the token on an item naming who may authorise it.
- **Human-only** - an item in any DR-086 §2 class (irreversible or outward-facing, spec
  approval or DR acceptance, spend, evidence-incomplete, genuine tie, edits to the stop
  list), or one whose act only a person can physically perform (a click, a keystroke in the
  founder's terminal, an `--admin` merge).
- **Agent-ok** - an item a non-human consumer acting for the human (a sweep, the merge
  funnel driver) may trigger, for example re-review, or a plain merge of a mechanical PR
  that the founder has delegated.
- **Consumer** - any program or agent that reads another session's items to decide what
  to send next.

## Requirements

### A. The tag

- **FR-1 - Every item carries exactly one actor tag.** The tag sits in a fixed position on
  the line (Clarify D1) and takes one of two values, human-only or agent-ok. Existing
  content of the line - the subject, the observed state, reply keys, `(rec)` and its cost -
  is unchanged.
- **FR-2 - Untagged means human-only.** A consumer MUST treat an item with no tag, an
  unknown tag, or more than one tag as human-only. Missing evidence fails closed
  (constitution invariant 2).
- **FR-3 - The tag is judged against DR-086 §2, not against the agent's confidence.** An
  item in any stop-list class is human-only regardless of autonomy level. An item whose
  reply key is a done-signal (template `:235`) is always human-only.
- **FR-4 - A mixed item is split.** An item that bundles a human-only step with an
  agent-ok step (for example "close the tab, then I will re-run the drain") is written as
  two items, so no single tag has to describe both.

### B. The reader

- **FR-5 - A pure, offline parser.** One function takes turn text and returns the items
  in order, each with its line text, its actor (after FR-2 defaulting), its reply keys, and
  any `#N` it cites. No network, no filesystem, no clock (invariant 1, Tier 0). It never
  throws on malformed input; it reports.
- **FR-6 - A validator over the same parse.** A second function returns a list of
  findings: untagged item, unknown tag, duplicate tag, a done-signal key on an agent-ok
  item, a ➡️ on the `**Your turn**` heading. #1236's backstop and SPEC-054's gate-signal
  linter may call it; this spec does not wire either.
- **FR-7 - A command-line entry for consumers outside the extension.** A script reads
  turn text on stdin and prints the parse as JSON. A `--agent-ok` flag prints only agent-ok
  items. Exit codes distinguish "parsed, no findings", "parsed with findings", and "could
  not read input"; the last never prints an empty agent-ok list, so an unreadable input
  can never look like "nothing to re-send".

### C. The convention text

- **FR-8 - The convention states the tag.** The "Human action items" text gains the tag
  rule, the untagged-means-human-only default, and the split rule, and its two example
  lines are tagged. Where that text goes (shipped template or this repo only) is Clarify
  D3.
- **FR-9 - The convention says what the tag is not.** The added text states in one
  sentence that the tag is a routing hint and that a wrongly tagged line fails open, so
  no reader takes it for the safety boundary.

### D. Consumers

- **FR-10 - The re-dispatch rule.** A consumer that re-sends another session's items
  ("do as you've recommended", or a per-item instruction) MUST send only agent-ok items,
  and MUST surface human-only items to the human instead, carrying their reply keys
  unchanged. This repo states the rule in the convention text and provides FR-7; adopting
  it in the chief-of-staff skill is out of repo (see Limitations).
- **FR-11 - The receiving side refuses too.** A session that receives an instruction from
  a non-human sender covering its own items acts only on its agent-ok items, and replies
  naming each human-only item it did not act on. This is a second witness that does not
  depend on the sender having parsed anything. How a session knows the sender is not the
  human is Clarify D5.

### E. Boundaries

- **FR-12 - No act is newly permitted.** Tagging an item agent-ok never widens what an
  agent may do. Every existing refusal (the ruleset, `host-write-guard.py`, DR-072 §3,
  DR-086 §2) stays in force, and an agent-ok tag on a stop-list item is a defect FR-6
  cannot see but FR-3 forbids.
- **FR-13 - Nothing new leaves the machine.** The parser, validator and script make no
  network call and write no file.

## Acceptance criteria

- **AC-1** The parser returns, for the two example lines in the current convention text
  once tagged, two items with the expected actor, keys and `#1231`.
- **AC-2** A line with no tag, a line with an unknown tag, and a line with two tags each
  parse as human-only, and the validator reports each one by name.
- **AC-3** An item whose key text is a done-signal ("tell me `x` once ...") and is tagged
  agent-ok produces a validator finding.
- **AC-4** A `**Your turn**` heading carrying ➡️ produces a finding and is not parsed as an
  item.
- **AC-5** Fed the four items from #1857 (the `--admin` merge of #1740, closing #1482 as
  discharged, the design question on #1750, keeping #1504 held), each correctly tagged,
  `--agent-ok` prints an empty list and exits "parsed, no findings". The same four with
  tags removed print an empty list and exit "parsed with findings".
- **AC-6** Unreadable input (a closed or non-UTF-8 stdin) exits with the "could not read"
  code and prints no list. A test proves the agent-ok list is absent, not empty.
- **AC-7** The parser makes no network, filesystem or clock call: a test runs it with those
  modules stubbed to throw.
- **AC-8** The convention text, wherever Clarify D3 puts it, contains the tag rule, the
  default, the split rule and the FR-9 sentence, asserted on the rendered bytes, not on the
  template source.
- **AC-9** Mutation check: removing the FR-2 default (so an untagged item parses agent-ok)
  fails at least one test.

## Invariants this must not break

- **Invariant 1 (offline).** Parser, validator and script are Tier 0.
- **Invariant 2 (no silent gate).** Untagged, unknown and unreadable all fail closed and
  visibly (FR-2, FR-7, AC-6). The spec does not call the tag a gate; FR-9 says so in the
  text a reader sees.
- **Invariant 3 (blast radius).** If D3 ships the convention to adopters, it changes only
  repos with `.minspec/`, through the existing managed render. The re-dispatch rule (FR-10)
  is about consumers in the user's own fleet and calls nothing outside the repo.
- **DR-086 §5.** Autonomy stays this repo's own; the tag describes items, it does not
  grant an autonomy level to adopters.

## Limitations, stated plainly

- **A wrong tag fails open.** If a session tags a human-only act agent-ok, a consumer that
  obeys this spec re-sends it. Only an act-site refusal (D4) closes that. This is the cost
  the issue names, and this spec does not remove it.
- **The sweep that caused #1857 is outside this repo.** Until the chief-of-staff skill
  calls FR-7 or follows FR-10, the incident can recur exactly as described. FR-11 is the
  in-repo half that does not wait on that.
- **More grammar in model-written prose.** A turn can now be wrong a second way: block
  present, tag wrong. FR-6 catches a missing or malformed tag, not a wrong one.
- **FR-11 is model-trusted** unless D5 finds a sender signal the harness exposes. It is
  still worth having: it turns "remember the founder rule" into "read your own tag", which
  is a smaller thing to remember.

## Decisions needed (Clarify)

Each selection below restates the option this document already marks (rec). It was
copied by an agent session; neither a human nor a delegation chose it, and DLG-001
(DR-108) does not cover recording Clarify selections. This section is not marked
resolved: it needs the founder's answer before approval.

### D1 - What the tag looks like

**Recorded selection: Option a,** `[human]` / `[agent]` immediately after the arrow
gives a fixed position and one regex while still reading naturally.

- **a** `[human]` / `[agent]` immediately after ➡️ **(rec)** - fixed position, plain ASCII,
  one regex, still reads naturally. Cost: two extra words on every line the founder reads.
- **b** A trailing `· actor:human` field - out of the reader's way. Cost: trailing text is
  the part most often reworded or truncated, so it is the least reliable place to parse.
- **c** Two different arrows (➡️ for human, another glyph for agent). Cost: breaks the
  "count the arrows to count what waits on you" property the convention is built on.

### D2 - Where the parser lives

**Recorded selection: Option a,** `packages/shared` is Tier 0, already holds pure
parsers, and serves both scripts and the extension from one copy.

- **a** `packages/shared` (`@aiclarity/shared`) **(rec)** - Tier 0, no vscode, already
  holds pure parsers (`project-prefix.ts`), usable from scripts and the extension. Cost: it
  ships inside the extension bundle even if only dev-time scripts use it.
- **b** `scripts/lib/` only - dev-time, ships nothing. Cost: the extension and #1236's
  backstop, if it lands in the extension, would need a second copy.

### D3 - Who gets the convention text

**Recorded selection: Option a,** this repo only, since the problem needs peer sessions
that solo adopters do not run, following the merge-funnel precedent.

- **a** This repo only, as a project-specific CLAUDE.md section beside "Merge asks in THIS
  repo" **(rec)** - the problem needs peer sessions, which solo adopters do not run, and it
  follows the merge-funnel precedent. Cost: an adopter who does run a fleet does not get
  it until a later spec ships it.
- **b** The shipped template (all three copies in `template-registry.ts`). Cost: every
  adopter's ➡️ lines gain a tag for a consumer most of them will never have.

### D4 - Which act-site refusals, if any, this spec builds

**Recorded selection: Option a,** none here, with one issue per unwitnessed act class,
keeping this spec to a convention and a reader.

The issue's own conclusion is that the safety boundary belongs where the act happens. Of
the four acts in #1857, `--admin` merge already has one and the other three do not.

- **a** None here; file one issue per unwitnessed act class (close as discharged,
  answering a `hold:human` question) **(rec)** - keeps this spec to a convention and a
  reader, and each refusal gets its own design. Cost: until those land, the only witness
  for those acts is still the model plus this tag.
- **b** Add a `host-write-guard`-style PreToolUse deny on `gh issue close` with a
  "discharged/accepted" reason from the container. Cost: it reads command text, so it is
  evadable the same way that hook says it is, and it blocks legitimate agent closes unless
  it can tell the two apart, which I do not yet see how to do.

### D5 - How a receiving session knows the sender is not the human (FR-11)

**Recorded selection: Option a,** treat a self-declared inter-session instruction as
non-human and state that FR-11 is model-trusted, which is buildable now.

- **a** Treat any instruction whose text says it comes from another session as non-human,
  and state that FR-11 is model-trusted **(rec)** - buildable now. Cost: a sender that does
  not say so is treated as the human.
- **b** First find out whether the harness marks inter-session messages in a way a
  `UserPromptSubmit` hook can read, and gate on that. Cost: unknown whether such a marker
  exists (I have not verified either way); FR-11 waits on that research.

### D6 - Two values or three

**Recorded selection: Option a,** two values, human-only and agent-ok, matching the
issue and FR-2's default.

- **a** Two: human-only and agent-ok **(rec)** - matches the issue and FR-2's default.
  Cost: "the human decides, then an agent executes" and "only the human can physically do
  it" share a tag, so a consumer cannot tell a decision from a keystroke.
- **b** Three: human-act, human-decision, agent-ok. Cost: one more value to get wrong in
  every turn, for a distinction no current consumer uses.

## Rejected alternatives (DR-086 §4)

- **Do nothing; the rule held four times.** Rejected for the reason the issue gives: four
  for four under rising repetition shows the rule is load-bearing and unwitnessed.
- **Fold into #1236.** Rejected: #1236 asks whether the block exists, this asks whether a
  program can read it. FR-6 is shaped so #1236 can reuse it without merging the two.
- **Tell sweeps to stop sending "do as you've recommended".** Rejected: it puts the burden
  on every consumer forever. The producer carries the signal (FR-1), and FR-11 adds a
  receiver-side witness.
- **Make the tag the gate.** Rejected: model-written text cannot fail closed on a wrong
  value. FR-9 and D4 keep the boundary at the act.
- **Default untagged to agent-ok for backward compatibility.** Rejected: it makes every
  existing untagged line re-dispatchable, which is the incident.

## Follow-ups (tracked)

- Adopting FR-7 / FR-10 in the chief-of-staff skill - out of repo; to be filed as a
  `harvest316/mmo-platform` issue or recorded with #2056 once Clarify settles D1.
- Act-site refusals per D4 option a - one issue per unwitnessed act class, filed when D4
  is answered.
- #1236 calling FR-6 - tracked by #1236 itself.

## Traceability

- Issue: #1857. Related: #1236 (emission backstop), #1235 (the convention), #1816 (an agent
  posted a human act as the founder), #2056 (in-repo home for the merge-ask rule).
- Decisions: DR-086 §2 and §4 and §5, DR-072 §3, DR-076.
- Specs: SPEC-044 FR-4b (the funnel driver, an agent-ok consumer), SPEC-027 (inter-session
  mailbox, planning, unbuilt - a possible future carrier for D5), SPEC-054 (gate-signal
  linter, a possible FR-6 caller).
