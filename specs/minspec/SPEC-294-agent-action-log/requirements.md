---
id: SPEC-294
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - who acted, as whom, with what result
aspects: [dispatch, remediation, audit, identity, secrets, offline, dev-time]
depends_on: []
relates_to: ["#2986", "#358", "#2233", "#2641", "SPEC-263", "DR-015", "DR-003"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after the
  Decisions needed (Clarify) below are resolved.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-294: A durable, searchable log of what each agent did

> **This is a SPECIFICATION ONLY.** Written for issue #2986. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
> No decision record is minted: every choice below can be undone in under a day, except the
> git-committed storage option in D1, which would need one if chosen.

## In plain terms

When an agent builds, specifies, or remediates something, the record of it is scattered:
the session transcript (local, unindexed), the drain log (in `/tmp`, gone on container
restart), and GitHub events (writes only, no failures, no "declined"). So "which agent touched
this file last week, and why" has no single answer. This spec adds one append-only row per
agent action, written by the dispatcher (never by the agent), kept somewhere that survives a
restart, plus a local query command over it.

This is a **dev-time** tool for building this monorepo. Agent dispatch does not ship inside
MinSpec (DR-015, Tier 0 / air-gapped), so neither does this log or its query.

## Measured state (this base, 118548be)

- The drain log path is `/tmp/minspec-drain-inbox.log` (`scripts/drain-inbox.sh:225`,
  `scripts/drain-service/drain-service.sh:56`). `/proc/self/mountinfo` in this container
  shows `/home/jason/code` as a bind mount of the host's root volume and no mount for `/tmp`,
  so `/tmp` lives in the container's own filesystem and is lost when it is recreated;
  `~/code/...` survives. (Observed in one container; Plan re-checks on the drain host.)
- Agent worktrees live under `/tmp/minspec-agent/...` (this dispatch's own path), so any file
  written inside a worktree dies with it. The log must resolve to the primary checkout.
- Precedent for a machine-local JSONL instrument: `.minspec/shadow-triage.jsonl`, written by
  `scripts/shadow-triage.sh:87`, gitignored at `.gitignore:126`, versioned by a schema string
  (`scripts/lib/shadow-triage.sh`, `SHADOW_TRIAGE_SCHEMA="minspec-shadow-triage/1"`).
- `scripts/dispatch-issue.sh:54-68` records why its outcome travels on its exit status, not in
  a file: the agent runs as the same user, so any file or output line the agent can reach can
  be forged by it (#2233, #2641). The same threat applies to this log.
- An egress secret scanner already exists and fails closed: `scripts/egress-scan.sh` (#358),
  called via `agent_egress_scan` (`scripts/lib/agent-egress.sh:46`) from both
  `dispatch-issue.sh` (`run_egress_guard`, line 1797) and `remediate-pr.sh:1091`.
- Bot identity for writes is set by `scripts/lib/gh-bot.sh`; identity-by-account (not login)
  is in flight as SPEC-263 (on an open branch, not on this base).

## Root cause (mechanism)

Each action path writes its outcome only to the channel it needed at the time (exit status
to its caller, prose to a `/tmp` log, a comment to GitHub). No path writes a typed,
cross-run record, and there is no store whose lifetime exceeds the container's. Nothing is
missing a gate; a capability is missing.

## Functional requirements

- **FR-1 One row per action.** Every terminal outcome of `scripts/dispatch-issue.sh` and
  `scripts/remediate-pr.sh` appends exactly one row, including declined, held, auth-failed,
  escalated, scope-guard-held, egress-blocked, and failed runs, not only successes. A run
  killed by a signal before it can write leaves no row; the drain's cycle summary (FR-9) is
  the second witness for that case.
- **FR-2 Writer is the parent, after the agent exits.** Rows are written by the dispatcher
  process from values it observed itself: its own exit-status decision, `git` over the
  committed tree, the PR number its own `gh` call returned, the identity its own write used.
  No field is copied from agent-writable material (`.agent-summary.md`,
  `.review-signals.json`, agent stdout) except one explicitly-named, length-capped,
  egress-scanned `agent_claim` field (D4), so a row never carries an agent's word as fact.
- **FR-3 Row schema (closed, versioned).** JSON, one object per line, `schema:
  "minspec-agent-action/1"`, fields:
  - `ts` (UTC ISO-8601, from the parent's clock), `run_id` (unique per run), `host`
    (container hostname);
  - `path` (`dispatch` | `remediate`), `phase` (`specify` | `build` | `fix` | `rebase` |
    ...; enumerated at Plan), `role` (from the `role:X` label), `model` (resolved model id);
  - `target`: `{ repo, issue?, pr? }`;
  - `changed`: `{ base_sha, head_sha?, branch?, files: [paths], files_truncated: bool }` -
    paths only, never diff content;
  - `identity`: `{ kind: "bot" | "human" | "unknown", login?, account_id? }` as observed by
    the parent for its GitHub write; `unknown` when it could not classify, never defaulted to
    `bot`;
  - `outcome`: a closed enum (`pr-opened`, `pr-updated`, `declined`, `held`, `escalated`,
    `egress-blocked`, `scope-held`, `auth-failed`, `failed`, `no-op`) plus `exit_code`;
  - `agent_claim` (optional, see FR-2 and D4).
  Unknown fields are rejected by the writer; a row that fails schema validation is not
  appended and the failure is reported (FR-7).
- **FR-4 Survives restart.** The log resolves to the **primary** checkout (via
  `git rev-parse --git-common-dir`, not the worktree and not `/tmp`), default path per D1.
  Overridable by one env var for tests.
- **FR-5 Append-only and concurrency-safe.** Parallel dispatches append to the same file
  without interleaving: each row is written with a single `O_APPEND` write under an exclusive
  `flock`. The writer never rewrites or truncates the file. Tamper evidence per D3.
- **FR-6 No secrets.** Before append, the serialised row is passed through the existing
  `egress-scan.sh`. A hit does not append the row raw: it appends the row with the offending
  field replaced by `"<redacted:egress-scan>"` and `redacted: true`, and prints a warning.
  The scan erroring is treated as a hit (fail closed, matching `egress-scan.sh`'s own rule).
  Token-bearing env vars (`GH_TOKEN`, `GITHUB_TOKEN`, `*_API_KEY`, ...) are never read by the
  writer.
- **FR-7 Log-write failure is visible, never silent (invariant 2).** A failed append (disk,
  lock timeout, schema reject) prints one `WARNING: agent-action log not written ...` line to
  stderr naming the run and the reason, and increments a counter the drain reports per cycle.
  It does not change the run's own exit status (the log is a record, not a gate; D2). No
  `|| true` on the write.
- **FR-8 Query command.** A repo script (D5), offline, reads only the local log and answers
  "what did agents do to X between dates", with filters: `--issue N`, `--pr N`,
  `--file <path or glob>`, `--identity <login|kind>`, `--outcome <enum>`, `--since`,
  `--until`. Output: one human line per row by default, `--json` for raw rows. It states how
  many rows it scanned and how many matched; a missing or empty log is reported as such, never
  as "no matches". Malformed lines are counted and reported, not skipped silently.
- **FR-9 Second witness for unlogged runs.** Each drain cycle compares the runs it launched
  with rows present for their `run_id`s and prints any launched-but-unlogged run. This catches
  a killed run and a broken writer, which FR-7 alone cannot (a writer that never runs cannot
  warn).

## Acceptance criteria

- AC-1 (FR-1) For each outcome enum value, a hermetic test drives the dispatcher or
  remediator to that outcome with stubbed `gh`/`claude` and asserts exactly one row with that
  outcome.
- AC-2 (FR-2) A test in which the stub agent writes a forged `.agent-summary.md` and
  `.review-signals.json` claiming success, and a forged row directly into the log path,
  asserts the parent's own row reports the parent-observed outcome; the forged row is caught
  per D3 (or, under D3 option b, documented as undetectable and the test pins that).
- AC-3 (FR-3) A writer given an unknown field or a non-enum outcome refuses and warns.
- AC-4 (FR-4) Run from a linked worktree under `/tmp`, the row lands in the primary
  checkout's log path.
- AC-5 (FR-5) N concurrent writers (N >= 8) produce N parseable lines, none interleaved.
- AC-6 (FR-6) **Secret test (issue acceptance):** with sentinel token shapes placed in the
  environment, in a branch name, in a file path, and in `agent_claim`, the resulting log file
  contains none of the sentinel values, asserted by grepping the file for each sentinel, with
  a control run proving the sentinel would be found if written raw. A scanner error yields a
  redacted row, not a raw one.
- AC-7 (FR-7) With the log path unwritable, the run's exit status is unchanged and stderr
  contains the warning line; a source check finds no `|| true` on the write.
- AC-8 (FR-8) Against a fixture log: each filter returns exactly the expected rows; a missing
  log prints "log not found", an empty one "0 rows scanned"; a malformed line is counted.
- AC-9 (FR-9) A drain fixture with a launched run that wrote no row prints it.
- AC-10 Offline: writer and query make no network call and import no `vscode`.
- AC-11 Mutation check: removing the egress-scan call from the writer turns AC-6 red;
  removing the `flock` turns AC-5 red under the concurrent fixture.

## Invariants this must not break

1. **Offline (invariant 1).** Writer and query touch only local files. The `identity` field
   is taken from the parent's existing write, not from a new network call.
2. **No silent gate (invariant 2).** The log is not a gate, but a failed write, a missing
   log, a malformed line, and an unlogged run are each visible (FR-7, FR-8, FR-9).
3. **Blast radius (invariant 3).** The log lives inside the repo that has `.minspec/` and is
   never written elsewhere; dispatch scripts already refuse a REPO_ROOT without `.minspec/`
   (`dispatch-issue.sh:174-178`).
4. **Outcome channel unchanged.** Exit-status semantics of `dispatch-issue.sh` (#2641) are
   not altered; the log reads the outcome, it does not become the outcome channel.
5. **Egress guard unchanged.** The log is a new consumer of `egress-scan.sh`, not a fork of
   its patterns.

## Decisions needed (Clarify)

- **D1 Where the log lives.**
  (a) `.minspec/agent-actions.jsonl` in the primary checkout, gitignored, as
  `shadow-triage.jsonl` already is **(rec)**: survives restart on this host, zero repo churn;
  cost: machine-local, so a second machine has its own log and the record is lost if the
  host checkout is deleted.
  (b) Committed to git on a dedicated branch or path: searchable from any clone, backed up by
  the remote; cost: a commit per action, and any redaction miss is in history permanently -
  irreversible, so this option needs a DR.
  (c) `$XDG_STATE_HOME/minspec/` under home: survives restart only if home is persistent,
  which this container does not guarantee (only `~/code` is bind-mounted, observed above).
- **D2 Does a failed log write block the run?**
  (a) No - warn plus drain counter plus FR-9 cross-check **(rec)**: a full disk cannot stall
  the fleet; cost: a period of missing rows is possible, visible but not prevented.
  (b) Yes - fail the run: the log is complete by construction; cost: makes a record into a
  gate and a single disk or lock fault stops all dispatch.
- **D3 Tamper evidence against the agent.** The agent runs as the same user and could edit
  the log (the `dispatch-issue.sh:54-68` threat).
  (a) Hash chain: each row carries the SHA-256 of the previous line; the query verifies the
  chain and reports the first break **(rec)**; cost: detects, does not prevent, and a
  concurrent-append design must serialise chain computation inside the lock.
  (b) No integrity, documented as "same-user forgeable"; cost: the log cannot be cited as
  evidence of what an agent did not do.
  (c) Write the log as a different OS user; cost: new privilege setup on the host, outside
  this repo's blast radius.
- **D4 Keep the agent's own words?** (a) Optional `agent_claim`, first 280 chars of
  `.agent-summary.md`, egress-scanned, labelled as a claim **(rec)**: answers "why" in the
  query; cost: a prompt-injected summary can put misleading text in the log (labelled, never a
  fact field). (b) Omit; cost: "why" needs the PR or issue, so the log answers "what" only.
- **D5 Query surface.** (a) `npm run agent-log -- <filters>` repo script, like
  `npm run facts` **(rec)**: dev-time, consistent with DR-015 keeping dispatch out of MinSpec;
  cost: not in the editor. (b) A MinSpec palette command; cost: ships a dev-time dispatch
  concern inside the Tier-0 extension, contrary to DR-015.
- **D6 Which action paths beyond the two named.** The issue names dispatch and remediation.
  (a) Those two now; the reviewer stage, triage, and delegated-merge acts as follow-ups
  **(rec)**; cost: a merge by an agent is not in the log until the follow-up lands.
  (b) All agent-write paths now; cost: roughly doubles the change surface of a T3.
- **D7 Retention.** (a) Unbounded single file, rotation deferred **(rec)**; I believe a row is
  under 1 KB, so a few hundred runs a day stays under 100 MB a year (estimate, unmeasured);
  cost: unbounded growth. (b) Monthly files; cost: the query and hash chain must span files.

## Out of scope

- Session transcript indexing (the issue's other scattered source).
- Any remote telemetry or upload of the log.
- Retroactive backfill from GitHub events or old `/tmp` logs.

## Follow-ups (tracked)

- D6(a) deferred paths (reviewer stage, triage, delegated merge): file an issue at Plan if D6
  resolves to (a); none filed now because the choice is open.
- D7(a) rotation: `backlog: agent-action log rotation (SPEC-294 D7)` at Plan if chosen.
- SPEC-263 (bot identity by account, in flight) supplies `identity.account_id`; until it
  lands the field may be absent and `kind` is classified as today.
