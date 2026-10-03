---
id: SPEC-107
type: requirements
status: specifying
tier: T3
product: agent-execute
epic: EPIC-007  # Agent Execute Extension - DR-015/DR-044 place agent coupling in the Tier-1 Execute extension (SealBox), never in MinSpec core
aspects: [permission-mode, claude-code-hook, pretooluse, spec-gate, autonomy, tier-1, blast-radius, silent-gate]
relates_to: [DR-004, DR-008, DR-015, DR-017, DR-026, DR-031, DR-044, DR-049, DR-074, SPEC-019, "#77"]
# No `implements:` / `affects:` yet. Every file this spec would create lives in the SealBox
# repo (DR-044), and the spec gate matches repo-relative paths in THIS repo, so a SealBox path
# declared here would arm nothing. Ownership is declared in Plan once DQ-1 (where this spec
# lives) is answered; `validateOwnership` only requires it once the plan phase has started.
phases:
  specify: in-progress
---

# SPEC-107: An autonomous Claude Code session may edit only under an authorising spec

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers or accepts the recommendations under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the normal
> spec-approval gate before any code is written. Every requirement below is written under the
> recommended option of each decision, so approving as it stands accepts those
> recommendations.

**Triggered by:** [#77](https://github.com/AIClarityAU/minspec/issues/77) — *gate Claude Code
Bypass Permissions on spec existence (agent-execute)*.
**Rests on:** [DR-015](../../../docs/decisions/DR-015.md) (agent coupling ships in the third,
Tier-1 Execute extension) · [DR-044](../../../docs/decisions/DR-044.md) (that extension is
SealBox, in its own repo) · [DR-049](../../../docs/decisions/DR-049.md) (SealBox is public) ·
[DR-004](../../../docs/decisions/DR-004.md) (MinSpec core stays Tier 0) ·
[DR-031](../../../docs/decisions/DR-031.md) (the spec gate and its human-only, audited
kill-switch) · [DR-074](../../../docs/decisions/DR-074.md) (blast radius = the opted-in
project) · [DR-026](../../../docs/decisions/DR-026.md) (offer, never silently write).
**No new DR is minted by this spec.** The placement decision is already DR-015/DR-044's. If
DQ-1 is answered "MinSpec core" instead, that answer changes DR-004's Tier-0 boundary and
needs its own DR before Plan.

---

## Context

### What the issue asked, and the diagnosis it already carries

The founder asked whether MinSpec should notice when Claude Code runs in **Bypass
Permissions** mode (`bypassPermissions`, zero prompts) and propose a safer mode. The issue
itself diagnoses the naive "detect the mode, nudge the user" design as wrong on three counts
and reframes it: *do not police the toggle; gate the capability on the artifact.* Autonomous
edits are allowed only when a spec authorises the work. This spec specifies that reframing.

### Two of the issue's premises need correcting

1. **"The active mode is not observable; only `defaultMode` in settings is."** Partly
   outdated. The locally installed Claude Code (2.1.283) lists `permission_mode` among the
   common fields of every hook's input envelope, next to `session_id`, `cwd` and
   `hook_event_name`. Its mode enumeration is `default`, `acceptEdits`, `plan`, `auto`,
   `dontAsk`, `bypassPermissions`. *Observed in the installed bundle's strings, not in
   Anthropic's documentation.* I believe the field reports the mode current at the moment of
   the call, so it follows a live Shift+Tab, **unverified**. AC-9 makes that a measured fact
   before anything ships. If it holds, a PreToolUse hook does not read stale state the way a
   settings-file watcher would, and the issue's third objection does not apply to a hook.
2. **"Nothing enforces SDD under bypass today."** False for this repo, true for adopters.
   This repo's dev-time spec gate is a PreToolUse hook. A PreToolUse deny blocks the call
   before permission rules apply, so it already "survives bypass-permissions mode"
   (`scripts/hooks/spec-gate.py:7-9`). But it is scoped: it blocks only files that an
   unapproved T3/T4 spec *declares* it owns. Its own docstring discloses that greenfield or
   undeclared code "is NOT gated" (`scripts/hooks/spec-gate.py:45-51`). MinSpec ships only the
   session-title hook to adopters (`packages/minspec/src/lib/claude-settings.ts:40-57`). The
   spec gate is not shipped.

### What this spec adds

The gap is the one the spec gate discloses: **work that no spec claims at all.** In a
prompted mode, a human sees each edit before it happens, so that gap is covered by attention.
In an autonomous mode, nobody sees the edit. This spec adds a **mode-conditioned** rule. When
the session is autonomous, an edit must fall under an *authorising spec*. Without one, the
call is denied and the deny names the remedy: write the spec, or leave autonomous mode.

### What this spec is not

- **Not a mode switcher.** It never changes the session's mode and never writes `defaultMode`
  or `permissions.disableBypassPermissionsMode`. The model cannot change its own session, and
  doing it silently would break DR-026.
- **Not SealBox's dispatch path.** SPEC-019 already bans `bypassPermissions` from SealBox's
  own runner outright (`specs/agent-execute/SPEC-019-execution-substrate/design.md:137`,
  `:177`). This spec governs a **human's interactive session** in an opted-in repo.
- **Not containment.** An agent in bypass mode can edit the hook, the settings file, or the
  spec it is gated on. Containment is SealBox's credential-free sandbox (DR-008 Layer 2,
  DR-017). This gate forces the thinking artifact to exist, which is the SDD property, and
  makes casual circumvention visible and auditable. DR-031 states the same posture for the
  spec gate ("non-obvious and always-auditable, not impossible").

---

## Functional requirements

**FR-1 — Placement.** The rule ships in SealBox (the Tier-1 Execute extension, DR-015/DR-044)
as a Claude Code `PreToolUse` hook script plus its registration. No code in
`packages/minspec` or `packages/shared` reads, stores, or reacts to a Claude Code permission
mode.

**FR-2 — Install only with consent, only into an opted-in project.** SealBox offers to install
the hook through a visible, one-time prompt (DR-026). It installs only into a workspace whose
root holds `.minspec/` (DR-074). The registration goes into that project's
`.claude/settings.json` and appends alongside existing hooks, following the
`addSessionTitleHook` merge contract (`claude-settings.ts:117-136`): a foreign-shaped
`hooks` key is skipped and reported, never overwritten. It never writes user-level
`~/.claude/settings.json`, managed settings, or any other repo.

**FR-3 — Autonomous modes.** The hook treats a call as *autonomous* when the envelope's
`permission_mode` is `bypassPermissions` or `auto` (DQ-3). It treats every other recognised
mode as prompted, and the hook allows the call (it does not decide it): the spec gate and
Claude Code's own prompts remain in force.

**FR-4 — Unknown or missing mode fails toward the requirement.** If `permission_mode` is
absent (an older Claude Code), empty, or not in the recognised set, the hook applies the
autonomous rule. It does not allow by default. The deny reason states that the mode could not
be read. (Constitution invariant 2: a missing witness fails closed and visibly. Here
"closed" means "a spec is required", not "everything is denied", so a prompted user on an
old Claude Code who has an authorising spec is unaffected.)

**FR-5 — Gated tools.** Under the autonomous rule, the hook decides `Edit`, `Write`,
`MultiEdit` and `NotebookEdit`. It also decides `Bash` (DQ-4): a command on a fixed
read-only allowlist is allowed, and any other command is treated as a write to the repo and
needs an authorising spec like any other edit. Read-only tools (`Read`, `Glob`, `Grep`, and
similar) are never decided by this hook.

**FR-6 — Always-allowed paths.** These are allowed under the autonomous rule with no
authorising spec, so the remedy is always reachable and the gate cannot deadlock itself:
- anything under the project's spec root (default `specs/`, from `.minspec/config.json`),
- `docs/decisions/**` and `docs/epics/**`,
- `.minspec/**`.

**FR-7 — The authorising spec (binding).** An edit to a path outside FR-6 is authorised when
**at least one** of these holds (DQ-2):
- (a) **Ownership.** Some spec lists the path, or a path prefix of it, in `implements:` or
  `affects:`, using the same matcher the spec gate uses (`_SRC_EXT_RE` and
  `_INFRA_PREFIXES`, mirrored by `packages/minspec/src/lib/ownership-path-rules.ts`).
- (b) **Declared active spec.** The session has declared an active spec (MinSpec's session
  scope), and that spec exists on disk.

That spec must also pass FR-8.

**FR-8 — Tier and approval of the authorising spec.**
- A spec with `tier: T1` or `tier: T2` authorises on existence.
- A spec with `tier: T3` or `tier: T4` authorises only when its approval is current: the
  canonical sidecar hash matches, exactly as the spec gate computes it.
- A spec with no `tier:` value, or a value it cannot parse, does not authorise. An unreadable
  tier fails closed (invariant 2).

The tier is read from frontmatter and never recomputed by a model (determinism, constitution Goal G-6).

**FR-9 — Deny message.** A deny carries a `permissionDecisionReason` that names:
- the mode it saw (or that it could not read one),
- the path,
- why no spec authorised it,
- the two remedies: write or declare a spec, or switch to a prompted mode with Shift+Tab or
  `/permissions`.

It does **not** name any kill-switch or environment variable (DR-031 §2a).

**FR-10 — Human kill-switch, audited.** One environment variable disables the rule for a
human. Like the spec gate's `MINSPEC_GATE_OFF` (`scripts/hooks/spec-gate.sh:20`), every
honoured bypass is appended to `.minspec/gate-bypass.log` with timestamp, cwd, tool, target,
and the mode seen. Unlike `spec-gate.sh:51`, a failed write to that log must not be
swallowed: if the audit line cannot be written, the bypass is not honoured, and the hook
says so (invariant 2).

**FR-11 — Offline and deterministic.** The hook makes no network call. It reads only the
envelope on stdin and files inside the project. Its decision is a pure function of those
inputs.

**FR-12 — Coexists with the spec gate.** If the project also runs MinSpec's spec gate, both
hooks run, and a deny from either blocks the call. This hook never emits `allow` for a call
it does not gate. Emitting nothing (or `allow` with no reason) defers to the other hooks and
to Claude Code's normal decision. It must not shadow a deny from the spec gate.

**FR-13 — Visible state.** SealBox surfaces whether the hook is installed and active for the
workspace (a status-bar item or command, chosen in Plan). An installed but inert hook would
otherwise be indistinguishable from a hook that simply never had to deny anything.

## Acceptance criteria

| # | Given / When | Then |
|---|---|---|
| AC-1 | `permission_mode: bypassPermissions`. Write to `src/new.ts`, which no spec claims. No active spec declared. | Deny. The reason names the mode, the path and both remedies, and does not contain the kill-switch name. |
| AC-2 | Same as AC-1, but a `tier: T2` spec lists `src/new.ts` in `implements:`. | Not denied by this hook. |
| AC-3 | Same as AC-1, but the owning spec is `tier: T4` with a stale approval. | Deny. The reason says approval is stale. |
| AC-4 | `permission_mode: default` or `acceptEdits` or `plan`. Write to an unclaimed path. | This hook does not deny. |
| AC-5 | Envelope has no `permission_mode`. Write to an unclaimed path. | Deny, and the reason says the mode was unreadable. With an authorising T2 spec: not denied. |
| AC-6 | Bypass mode. Write to `specs/x/requirements.md`, `docs/decisions/DR-9.md`, `.minspec/approvals/a.json`. | All not denied (FR-6). |
| AC-7 | Bypass mode. `Bash` with `sed -i s/a/b/ src/x.ts`, unclaimed. Then `Bash` with `git status`. | The first is denied; the second is not. |
| AC-8 | Kill-switch set, and the audit log is writable / is not writable. | Writable: allowed, and one log line is written. Not writable: denied, with the reason stated. |
| AC-9 | A live Claude Code session started in `default`. Shift+Tab to bypass, then trigger an Edit. | The hook's recorded envelope shows `permission_mode: bypassPermissions`. This is a **manual probe**, run and recorded before FR-3 ships. If it fails, FR-3 is re-specified, not shipped. |
| AC-10 | A workspace without `.minspec/` at its root. | SealBox neither offers nor installs the hook. No file outside the workspace is written. |
| AC-11 | `.claude/settings.json` has a foreign-shaped `hooks` key. | Install skips it and reports why. The file is byte-identical afterwards. |
| AC-12 | A grep of `packages/minspec/src` and `packages/shared/src`. | No `permission_mode` / `permissionMode` read. This is an inventory test, run in this repo. |
| AC-13 | MinSpec's spec gate denies a call, and this hook would not. | The call is denied (FR-12). |

## Invariants this change must not break

- **INV-1 — Constitution 1 / DR-004 (offline, Tier 0).** MinSpec core gains no permission-mode
  coupling (AC-12). The hook itself is offline (FR-11).
- **INV-2 — Constitution 2 (no silent gate).**
  - An unreadable mode (FR-4), an unreadable tier (FR-8), or an unwritable audit log (FR-10)
    each fails toward denial, visibly.
  - No `|| true` on a gate signal.
  - A broken interpreter is the one deliberate exception, and it must be decided in Plan and
    disclosed in the deny/allow output. The spec gate fails open there today
    (`spec-gate.py:461` fails open on a parse error).
- **INV-3 — Constitution 3 / DR-074 (blast radius).** Install is gated on `.minspec/` at the
  workspace root and writes only that project's `.claude/settings.json` (AC-10, AC-11).
- **INV-4 — DR-026 (offer, never silent).** The hook is never installed without a visible
  offer. The rule never switches mode or writes permission settings.
- **INV-5 — DR-031 §2 (human-only kill-switch).** The kill-switch is unadvertised in agent
  output and always audited.
- **INV-6 — SPEC-019.** SealBox's own runner still has no `bypassPermissions` code path. This
  spec adds no reason for one.

## Decisions needed (Clarify)

**DQ-1 — Where does this spec live, and therefore where is it built?**
- **A (rec).** Here for now, in `specs/agent-execute/` beside SPEC-016 and SPEC-019. It moves
  to the SealBox repo with them, under DR-044's pending specs migration, and is built in
  SealBox. *Cost:* until that migration happens, the spec and the code are in different repos.
  The spec gate here cannot arm its ownership, so Plan has to name the SealBox paths without a
  gate behind them.
- **B.** Re-file now in `AIClarityAU/sealbox` and close this copy. *Cost:* SealBox has its own
  spec register and conventions. This would be the first agent-execute spec to move ahead of
  SPEC-016/019, and it would split the epic's corpus.
- **C.** Ship it from MinSpec core as an adopter-scaffolded hook, as the session-title hook
  is. *Cost:* this contradicts the issue's own placement and DR-015, and needs a new DR that
  amends DR-004's Tier-0 boundary. It is the only option that reaches adopters who never
  install SealBox.

**DQ-2 — How does the gate know which spec authorises an edit?**
- **A (rec).** Either ownership (`implements:`/`affects:` covers the path) or a declared
  active spec (FR-7). *Cost:* a declared active spec authorises *every* path, so one T2 spec
  declared at session start unlocks the whole repo for that session. The binding is to the
  session, not to the file.
- **B.** Ownership only. *Cost:* the strictest option and the most precise. But every new file
  must be pre-declared in a spec before the first autonomous write, which means editing the
  spec mid-session (allowed under FR-6, but slower).
- **C.** Any spec on disk authorises everything (the issue's literal "spec.md exists"). *Cost:*
  in any repo with one spec, the gate is a no-op. Rejected as the recommendation, and listed
  only because it is the issue's literal wording.

**DQ-3 — Which modes count as autonomous?**
- **A (rec).** `bypassPermissions` and `auto`. *Cost:* `acceptEdits` also auto-approves file
  edits without a prompt, but it stays ungated. It is the "safer" mode the issue proposes
  users move to, and gating it would leave no prompt-free editing mode below bypass.
- **B.** Also `acceptEdits`. *Cost:* the gate then binds almost every working session, so it
  stops being a bypass control and becomes a general "no edit without a spec" rule. That is a
  larger behaviour change than #77 asked for.

`dontAsk` is not a candidate under either option: it auto-*denies* anything not
pre-allowed, so it is stricter than `default`. *(I believe this from the mode's name and
enumeration only, unverified against docs. Plan checks it.)*

**DQ-4 — Does the gate cover `Bash`?**
- **A (rec).** Yes, with a read-only allowlist (FR-5). *Cost:* any allowlist is incomplete.
  Legitimate commands such as `npm test` that write build output will be denied under
  bypass without a spec until the allowlist covers them. Expect friction, and an allowlist
  that grows.
- **B.** No: gate only the file-editing tools, and disclose the hole. *Cost:* in bypass mode,
  `Bash` writes files freely (`sed -i`, `>`, `git apply`). Gating edits only would close the
  path, not the capability, and the gate would report clean while the hole stays open.

**DQ-5 — What stops the agent from authorising itself?** In bypass mode, the agent can write
`specs/x/requirements.md` with `tier: T1` (FR-6 allows it) and then edit freely.
- **A (rec).** Accept it and disclose it. The gate's job is to force the spec to exist; the
  spec then exists for the human to read. A T3/T4 spec still needs a human approval hash
  (FR-8). *Cost:* a mis-tiered self-written T1/T2 spec unlocks autonomous edits with no human
  in the loop. The deterministic classifier is an upward-only floor elsewhere, but it is not
  applied here.
- **B.** A T1/T2 spec authorises only if it is committed at a commit that predates the
  session's first autonomous call. *Cost:* this kills the "write a T2 spec, then build it"
  flow in a single autonomous session. Committing in bypass is also possible, so it raises the
  bar rather than closing the gap.
- **C.** Re-run MinSpec's deterministic tier classifier over the spec, and take the higher of
  the declared and computed tiers. *Cost:* this couples SealBox to the classifier engine's
  location, which is still unsettled (DR-014 is `proposed`, #54), and needs an input the
  classifier can score.

## Out of scope

- Detecting or reporting the mode inside MinSpec core (triage rule 3: detection is not
  integration, and FR-1 forbids it here).
- Switching mode on the user's behalf, or writing `disableBypassPermissionsMode` (INV-4).
  Pointing an org admin at that managed setting in docs is a possible follow-up, and is not
  filed by this spec.
- Containment against a determined agent. That is SealBox's sandbox (DR-008 Layer 2,
  SPEC-019).
- Shipping MinSpec's own spec gate to adopters. That is a separate question, and this spec
  does not depend on it.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | `permission_mode` turns out not to follow a live Shift+Tab (AC-9 fails). | FR-3 is not shipped on the inference. Re-specify, for example by requiring the spec in every mode. |
| R2 | The field is renamed or removed in a future Claude Code. | FR-4 fails toward the requirement, so a vanished field tightens the gate and never opens it. |
| R3 | Two PreToolUse hooks with overlapping matchers interact unexpectedly. | FR-12 plus AC-13. Plan confirms Claude Code's documented multi-hook precedence. |
| R4 | The Bash allowlist (DQ-4 A) causes friction, and the user reaches for the kill-switch habitually. | Every use is audited (FR-10). The allowlist grows from the log, not by guess. |
| R5 | The ownership matcher drifts from the spec gate's. | FR-7(a) mandates the same matcher. Plan adds a parity test like the existing `ownership-path-rules.ts` mirror. |

## Follow-ups (tracked)

- AC-9's live probe of `permission_mode` must run before FR-3 ships. It is part of this
  spec's Plan, not a separate issue.
- DR-044's pending migration of `specs/agent-execute/` to the SealBox repo already covers
  where this spec ends up under DQ-1 A. This spec adds nothing to that follow-up.
- None other.
