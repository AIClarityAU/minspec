---
id: SPEC-072
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-009  # Team Readiness — guardrails a shared repo must carry (SPEC-033's sibling; the governance MinSpec provisions but cannot reach from CI)
aspects: [governance, advisory, network-boundary, tier-0, consent, invariants, blast-radius, secret-scanning, no-silent-gate, honesty]
depends_on: [SPEC-033]  # this extends the advisory pass SPEC-033 FR-3 built; it does not re-derive the tiered-check resolution
relates_to: [DR-050, DR-004, DR-066, DR-086, SPEC-033, SPEC-042, SPEC-063]
# INLINE list form, deliberately. Block-form YAML lists are truncated to their FIRST
# item by BOTH ownership parsers (`fm_value` at scripts/hooks/spec-gate.py:113 and the
# TypeScript twin at spec-validator.ts:432) — measured and filed as #1961, and recorded
# in SPEC-070's frontmatter for the same reason. A block-form declaration here would own
# the first path and silently release the rest.
implements: [packages/minspec/src/lib/secret-scanning-advisor.ts, packages/minspec/tests/secret-scanning-advisor.test.ts, packages/minspec/tests/gh-api-repo-scope.test.ts]
implements_reason: >-
  The three paths above are NEW files this spec creates and owns: the pure probe/mutation
  lib (FR-3/FR-7), its unit suite, and the invariant-3 property test (FR-8) that asserts
  every `gh api` path this feature can emit is repo-scoped. The advisory PASS that calls
  them is an existing function modified in place (`offerRulesetAdvisory`), and the
  boundary that authorises the calls is an existing decision record amended in place — both
  go under `affects:`, matching how SPEC-051/SPEC-059/SPEC-061/SPEC-067 classified the
  same modify-don't-own shape.
affects: [packages/minspec/src/commands/init.ts, packages/minspec/src/lib/ruleset-advisor.ts, docs/decisions/DR-050.md]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — advise on repo secret-scanning settings from the existing init advisory pass (Requirements)

> Materializes **[#1809](https://github.com/AIClarityAU/minspec/issues/1809)**
> (`role:architect`, **Specify phase only** — nothing here is built). The network
> boundary every requirement below stands on is
> **[DR-050](../../../docs/decisions/DR-050.md)**, whose *Amendment (2026-09-22)* was
> written alongside this spec and is **`proposed`, not accepted**. FR-1 makes that
> ratification a binding precondition: **no probe may ship before a human ratifies the
> amendment**, exactly as DR-050's own 2026-08-25 amendment holds #1694.
>
> **Tier T4 (complete ceremony)** — not because the diff is large (it is two source files
> plus tests), but because the work moves a constitution-invariant boundary and ships a
> **new class of repository mutation** inside an installed extension build. A capability
> that is already on ten thousand disks cannot be recalled by a later commit, so the
> Clarify read is the control, and this spec carries a *Decisions needed (Clarify)*
> section for it.

---

## One-Sentence Scope

Teach MinSpec's existing post-init/post-refresh advisory pass to read the repo's **own**
secret-scanning settings and offer to enable the ones that are missing **and actually
available**, as a **separately dismissible** offer beside the required-checks offer, never
touching org-level configuration and never enabling anything without a click.

---

## Context

### Why MinSpec is the only actor in its own architecture that can fix this

MinSpec already ships a two-layer secret gate to every repo it initializes, and both
layers stop exactly where repository *settings* begin:

1. **The client-side hook.** `.githooks/pre-commit` (scaffolded from
   `SECRET_SCAN_HOOK`-family content in
   [`template-registry.ts:1416-1442`](../../../packages/minspec/src/lib/template-registry.ts#L1416))
   runs `gitleaks protect --staged` and blocks on a finding. It is **optional by design**:
   a missing `gitleaks` binary prints a warning and the commit proceeds
   ([`template-registry.ts:1440-1441`](../../../packages/minspec/src/lib/template-registry.ts#L1440)),
   because a missing optional local tool must never wedge a commit.
2. **The CI second witness.** Because (1) is a single producer one machine's missing
   binary silently disables — the shape constitution invariant 2 forbids — #1620 added
   `.github/workflows/secret-scan.yml`, and #1186 made it a managed template shipped to
   adopters
   ([`template-registry.ts:2143-2153`](../../../packages/minspec/src/lib/template-registry.ts#L2143);
   asserted by `packages/minspec/tests/secret-scan-workflow-shipped.test.ts:59`).

The workflow's own header states the wall both layers hit, and it is the premise of this
spec:

> *"Adding a job here makes the signal exist; making it BLOCK a merge is a separate,
> repository-settings act (Settings → Rules → main → require this check) that a workflow
> file cannot perform on itself, and the App installation token that runs as this repo's
> bot identity cannot write org/repo rulesets either."*
> — [`.github/workflows/secret-scan.yml:49-57`](../../../.github/workflows/secret-scan.yml#L49)

So: **CI cannot configure CI, and the bot is deliberately unprivileged.** The only actor
in MinSpec's architecture holding a credential that can change repository settings is the
*user's own `gh`*, running in the *user's own editor* — which is precisely the seam
`offerRulesetAdvisory` already occupies. That is the architectural argument for putting
this work on that path, and it is stronger than the issue's "same class of fact" framing:
it is not merely that the advisory *could* carry the check, it is that **nothing else in
the system can**.

The concrete failure this closes, reported on #1809: MinSpec scaffolds a gitleaks gate into
every project it initializes, and its own repo — and every other repo in its org — had
GitHub secret scanning switched off. Nothing looked, so nobody noticed.

### The seam, cited precisely (the issue's locations are off by a file)

#1809 places `offerRulesetAdvisory` in `packages/minspec/src/lib/ruleset-advisor.ts`. It is
not there. The split matters to every requirement below, so it is stated once:

| Concern | Where it actually lives |
|---|---|
| The advisory **pass** (toasts, branching, consent) | [`init.ts:887-1021`](../../../packages/minspec/src/commands/init.ts#L887) |
| Its **dependency injection** shape | [`RulesetAdvisoryDeps`, `init.ts:711-733`](../../../packages/minspec/src/commands/init.ts#L711) |
| The **pure** probe/mutation functions | `packages/minspec/src/lib/ruleset-advisor.ts` (895 lines) |
| The single sanctioned process spawn | [`defaultCommandRunner`, `ruleset-advisor.ts:124`](../../../packages/minspec/src/lib/ruleset-advisor.ts#L124) |
| Call sites | `initCommand` [`init.ts:1290`](../../../packages/minspec/src/commands/init.ts#L1290) · `initRefreshCommand` [`init.ts:1516`](../../../packages/minspec/src/commands/init.ts#L1516) |

The pass's shape, which this spec extends rather than rewrites:

- not a git repo → return, zero process, zero toast ([`init.ts:899`](../../../packages/minspec/src/commands/init.ts#L899));
- `gh` missing/unauthed → zero-network docs link, zero `gh api` ([`:903-911`](../../../packages/minspec/src/commands/init.ts#L903));
- no GitHub remote, or a slug failing `REPO_SLUG_RE` ([`init.ts:608`](../../../packages/minspec/src/commands/init.ts#L608), asserted at [`:928`](../../../packages/minspec/src/commands/init.ts#L928)) → docs link, zero `gh api`;
- otherwise **autonomous read-only probe**, then **silence if there is nothing to do**
  ([`if (missing.length === 0) return;`, `:955`](../../../packages/minspec/src/commands/init.ts#L955));
- one toast, one click, one mutation ([`:957-1017`](../../../packages/minspec/src/commands/init.ts#L957));
- the whole pass is wrapped in a swallowing `catch {}`
  ([`:1018-1020`](../../../packages/minspec/src/commands/init.ts#L1018)) — advisory only,
  never breaks init. INV-5 states what that swallow costs and forbids the one use that
  would turn it into a silent gate.

### The consent model the issue describes is not the consent model in force

#1809 states the constraint as *"No probe without the user having opted in; absent consent
the advisory simply does not run."* That is a **false description of DR-050 as amended**,
and building to it would over-gate the read in exactly the way DR-050 Amendment 2026-07-01
was written to stop. The rule actually in force
([`DR-050.md:117-121`](../../../docs/decisions/DR-050.md#L117)):

> **read-only-config-probe = autonomous OK; mutation/egress = consent-gated (and the
> mutation's own confirm toast is that consent).**

The founder has already ruled on this precise question once. An interim change (commit
`aa93c95`) gated the reviewer-secret-names probe behind the write consent; the founder
**overrode it** on #796, and Amendment 2026-07-16 records the reversal
([`DR-050.md:171-180`](../../../docs/decisions/DR-050.md#L171)). Re-introducing a prior
consent toast for a zero-egress GET would re-litigate a decided question.

What *is* true, and is the real constraint the issue was reaching for: **the carve-out is
enumerated endpoint by endpoint, not granted as a class.** Amendment 2026-07-01 named
`.../rulesets`; Amendment 2026-07-16 named `.../actions/secrets` (NAMES only); Amendment
2026-08-25 named `/user/memberships/orgs` and, because its *subject* widened from the repo
to the account, was born `proposed` and is still held. A read of
`GET /repos/{owner}/{repo}` is subject-wise identical to the rulesets read — the repo's own
settings — so it is an **enumeration inside the existing boundary**, not a widening. The
`PATCH` is the part that is new in kind, and FR-1 and the DR-050 Amendment (2026-09-22)
handle it as such.

### What is verified here, and what is not

Per the evidence-discipline rule, the two classes are separated rather than blended.

**Verified in this worktree** (every `file:line` above, plus): the advisory pass's
branching and silence rule; the `RENAME_DECLINED_CONFIG` decline-persistence pattern
([`init.ts:628`](../../../packages/minspec/src/commands/init.ts#L628), read at
[`:672-673`](../../../packages/minspec/src/commands/init.ts#L672), written at
[`:703`](../../../packages/minspec/src/commands/init.ts#L703)); the failure-honesty helpers
([`describeRulesetFailure`, `init.ts:820-834`](../../../packages/minspec/src/commands/init.ts#L820);
`isPlanLimited`/`githubReason`, `ruleset-advisor.ts:569`/`:589`); the tiered required-check
set, which contains `lint`/`test`/`build` and **no secret-scanning context**
([`TIER_B_CODE_CHECKS`, `ruleset-advisor.ts:355`](../../../packages/minspec/src/lib/ruleset-advisor.ts#L355));
and DR-050's three amendments.

**NOT verified — asserted by #1809 and by model knowledge, and carrying no network access
on this dispatch.** Everything about GitHub's live API surface: the field names
`secret_scanning`, `secret_scanning_push_protection`,
`secret_scanning_non_provider_patterns`; their location under a `security_and_analysis`
object on `GET /repos/{owner}/{repo}`; their `{ status: "enabled" | "disabled" }` shape;
the free-on-public / GHAS-on-private entitlement split; and the report that *"the three
private repos do not even expose an `advanced_security` field."* **None of these may be
treated as established.** FR-3 is written so the implementation does not *depend* on the
entitlement rule being what we think it is (it reads capability out of the response instead
of predicting it), and AC-1 requires the Plan to re-verify every field name against a live
`gh api` response before a single one is hardcoded. GitHub has re-packaged this product
line at least once; a spec that hardcodes today's pricing model ships a nag that rots.

---

## Functional Requirements

- **FR-1 (BINDING PRECONDITION — no network call ships before the boundary is ratified).**
  No code implementing FR-3 or FR-7 may merge to `main` until **DR-050 Amendment
  (2026-09-22)** carries `accepted`, ratified by a comment from the founder's **own**
  GitHub account and cited by permalink in the amendment. This mirrors, verbatim in
  mechanism, the hold DR-050's 2026-08-25 amendment places on #1694
  ([`DR-050.md:266-283`](../../../docs/decisions/DR-050.md#L266)), and the reason is the
  same: an agent's report of a verbal decision is not ratification of a boundary the
  amendment itself reserved for a human. Tests, types, toast copy and the FR-8 property
  test may land ahead of ratification **only if** no `gh api` invocation is reachable from
  a shipped code path; the Plan must state how that reachability is enforced rather than
  intended.

- **FR-2 (one pass and one consent model; two separately dismissible offers).** The
  secret-scanning advisory MUST run inside the **existing** `offerRulesetAdvisory` pass —
  reusing its repo guard, its `isGhReady` gate, its `resolveRepo`, its `REPO_SLUG_RE`
  assertion, its injected `CommandRunner` and its docs-link fallback — and MUST NOT add a
  second advisory entry point, a second consent decision, or a second `gh` readiness probe.
  It MUST, however, surface as its **own toast**, resolved independently of the
  required-checks toast.

  *This is the issue's recommended option with its stated cost removed, so the trade-off is
  recorded rather than quietly dropped (DR-086 §4).* #1809 recommends extending the existing
  advisory and names the cost: *"couples two unrelated forge checks into one prompt the user
  may dismiss as a unit — dismissing the required-checks nag would also dismiss the
  secret-scanning one."* That cost is not intrinsic to sharing the pass; it is intrinsic to
  sharing the **prompt**. Splitting the toast while sharing the pass keeps every benefit the
  issue argues for (one network round of readiness checks, one consent model to explain, one
  place to reason about the Tier-0 boundary) and discards the one drawback it names.

  The residual cost, stated: a cold repo can now produce **two** toasts from one init where
  it produced one. FR-5's per-repo decline memory and FR-6's silence rule bound how often
  that recurs; the toast **ordering and any one-toast-per-pass cap** is OQ-3.

  Rejected alternative — **a second advisory surface with its own consent**: cleaner
  separation, independently dismissible, but a second `isGhReady` probe, a second consent
  story to document, and a second place where the Tier-0 boundary has to be got right. For a
  check that fires roughly once per repository lifetime, that is a poor trade. Rejected.

  Rejected alternative — **fold the probe into `resolveWantedChecks`**
  ([`init.ts:775-798`](../../../packages/minspec/src/commands/init.ts#L775)): that function
  resolves *which status checks a ruleset should require*. Secret-scanning settings are not
  status checks, and overloading it would make the "producible check set" concept mean two
  things. Rejected.

- **FR-3 (the probe — one read-only GET, capability derived from the response, never
  predicted).** The advisory MUST determine the repo's secret-scanning posture with a
  single autonomous read-only `gh api` **GET** of the repository's own settings, issued
  through the injected `CommandRunner`, and MUST classify **each** of the three settings
  independently into exactly one of:

  1. **`enabled`** — nothing to offer for this setting;
  2. **`available-and-disabled`** — the setting is togglable on this repo and is off. The
     only state that may produce an offer;
  3. **`unavailable`** — the repo cannot have this setting (no entitlement, endpoint
     refused, field absent). MUST be **silent**: no toast, no warning, no docs link for
     that setting;
  4. **`unknown`** — the read failed, the payload did not parse, or the field's value was
     not a shape this code recognises. MUST be **silent**, and MUST NOT be coerced to any of
     the other three.

  **`unavailable` MUST be derived from the response, not computed from `visibility` plus a
  hardcoded entitlement rule.** #1809 proposes branching on `visibility` and on whether GHAS
  is available; its own supporting observation is the better mechanism — *"the three private
  repos do not even expose an `advanced_security` field"*. A response that omits a field is
  self-describing and stays correct across GitHub's pricing changes; a hardcoded
  public-is-free/private-needs-GHAS rule is a prediction that silently inverts the day the
  packaging moves, and inverts in the **nagging** direction (telling a user to enable
  something they cannot enable), which #1809 correctly calls worse than silence. `visibility`
  MAY be used to phrase an explanatory clause; it MUST NOT be the predicate that decides
  whether to offer.

  The probe is **fail-safe in the direction of silence**: any non-zero exit, unparseable
  body, missing object, or unrecognised value yields `unknown` for every setting it could
  not establish. Per DR-050 condition 3 this keeps a zero-network fallback intact, and per
  FR-6 it produces no toast.

- **FR-4 (all three settings, each named for what it actually buys).** The advisory MUST
  evaluate and be able to offer, independently: **secret scanning** (detection),
  **push protection** (blocking), and **non-provider patterns** (generic-shape detection).
  Offering a strict subset is a defect — each of the three is separately togglable and
  separately off-by-default, and two of the three were off on this org while the third was
  the one anybody thought about.

  Two points of copy are normative, not cosmetic:

  - **Non-provider patterns is the server-side analogue of what MinSpec already scaffolds,
    and the copy must say so.** GitHub's provider patterns match *registered vendors'*
    credential formats. The gitleaks gate MinSpec scaffolds matches generic shapes — a
    high-entropy string in a `.env`, a PEM block, a bearer token with no vendor prefix. A
    repo with secret scanning on but non-provider patterns off has a server-side witness
    that is **blind to most of what its own client-side gate exists to catch**, which is a
    materially different and less obvious failure than "scanning is off".
  - **Push protection commits the user's collaborators, and the toast must disclose it.**
    Enabling push protection blocks pushes *for everyone with write access*, not just for
    the person who clicked. That remains inside constitution invariant 3 — the repo opted in
    the moment `.minspec/` was created — but a one-word "Enable" that silently changes a
    colleague's push behaviour is a consent the clicker was not clearly asked for. The offer
    MUST name that consequence in the toast, in the same spirit as the existing
    `consequence` clause at
    [`init.ts:991-994`](../../../packages/minspec/src/commands/init.ts#L991).

- **FR-5 (the mutation — consent-gated, repo-scoped, additive, and honest when it fails).**
  Enabling is permitted ONLY as the direct result of an explicit click on the offer toast;
  that click IS the per-action consent, exactly as it is for
  `createRequiredChecksRuleset`. Beyond that:

  1. **Repo-scoped endpoint only** (FR-8 enforces this mechanically, INV-2 states why).
  2. **Additive and minimal.** The write MUST carry **only** the secret-scanning settings
     being enabled and MUST NOT resend, default, or round-trip any other repository setting.
     The endpoint that toggles these fields also accepts a large slice of repository
     configuration; a payload assembled by re-serialising a previously-read repo object can
     silently revert a field the user changed elsewhere — the failure mode recorded in memory
     as *"Ruleset PUT replaces everything"*, where a retyped payload dropped required checks.
     A test MUST pin the exact key set of the request body.
  3. **Never enables what the user did not choose.** Enabling all three from one click is
     permitted only if the toast named all three.
  4. **Failure is reported without an invented cause.** Reuse the established honesty
     discipline: quote GitHub's own `message` where there is one, name a plan/entitlement
     limit where that is what GitHub said, and fall back to a deliberately non-committal
     phrase otherwise — the rule `describeRulesetFailure`
     ([`init.ts:820-834`](../../../packages/minspec/src/commands/init.ts#L820)) and
     `isPlanLimited`/`githubReason` (`ruleset-advisor.ts:569`/`:589`) already encode, and for
     the reason recorded there: *"it named a remedy (re-authenticate) that could not possibly
     work, so acting on it costs time and teaches the user the tool's diagnoses are
     unreliable."* The most likely failure here is a token without `administration:write` on
     the repo, which reads as a 403 — the same ambiguity that produced that comment.
  5. **A decline is remembered per repo.** "Not now" MUST be persisted with the existing
     local-git-config pattern (`minspec.secretScanningDeclined`, mirroring
     `RENAME_DECLINED_CONFIG` at [`init.ts:628`](../../../packages/minspec/src/commands/init.ts#L628)
     / [`:672-673`](../../../packages/minspec/src/commands/init.ts#L672) /
     [`:703`](../../../packages/minspec/src/commands/init.ts#L703)) and MUST suppress the
     offer on later refreshes. Git config is local, per-repo and zero-network, so the memory
     itself neither egresses anything nor escapes the repo's blast radius.

- **FR-6 (silence is the default outcome, and it is a requirement).** A toast MUST be shown
  only when at least one setting is `available-and-disabled` and the decline flag is unset.
  All three enabled, all three unavailable, any `unknown`, a declined repo, no `gh`, no
  GitHub remote, not a git repo → **no secret-scanning toast at all**. This mirrors
  [`init.ts:955`](../../../packages/minspec/src/commands/init.ts#L955) and is load-bearing:
  an advisory that speaks when it has nothing to say trains the user to dismiss it unread,
  destroying the one moment it needs to be heard.

- **FR-7 (module placement — a new pure lib, called from the existing pass).** The probe,
  the classification, the payload construction and the failure interpretation MUST live in a
  **new** pure module, `packages/minspec/src/lib/secret-scanning-advisor.ts`, which:
  1. MUST NOT import `child_process` — it takes the injected `CommandRunner` type from
     `ruleset-advisor.ts`, so the single sanctioned spawn point
     ([`defaultCommandRunner`, `ruleset-advisor.ts:124`](../../../packages/minspec/src/lib/ruleset-advisor.ts#L124))
     stays single, and the `child_process` allowlist in
     `packages/minspec/tests/invariants.test.ts:171-172` needs **no new entry** (AC-7);
  2. MUST NOT import `vscode` — toasts belong to the pass in `init.ts`, keeping the module
     unit-testable with a mocked runner and no VS Code host, as `ruleset-advisor.ts` already is.

  *Why a new file and not an addition to `ruleset-advisor.ts`:* FR-2 rejects a second
  advisory *surface*; a second *file* is a different thing and costs nothing. The existing
  module is 895 lines, named for rulesets, and opens with a 56-line Tier-0 boundary docstring
  enumerating exactly which calls it makes — a docstring whose precision is load-bearing and
  which a fourth unrelated endpoint would erode. Splitting is also reversible in minutes,
  which is the test that keeps it out of the decision record. `ruleset-advisor.ts`'s header
  MUST gain a one-line cross-reference so the boundary narrative stays findable from either
  file.

- **FR-8 (invariant 3, enforced mechanically — every emitted API path is repo-scoped).** A
  test MUST assert that **every** `gh api` path this feature can emit, on every branch
  including error paths, matches a repo-scoped pattern anchored on the resolved
  `owner/repo` — and that no path reachable from this feature targets `/orgs/`, `/user/`, or
  `/enterprises/`.

  The enforcement MUST be a **property over the module's behaviour**, not an allowlist of
  the call sites someone remembered. A path allowlist reports clean by omission: it passes
  for a call site it was never told about, which is the failure shape recorded in memory as
  *"Path-closed ≠ capability-closed"* (three all-clears while the hole stayed live). The
  concrete form: drive the module across its full input matrix with a recording
  `CommandRunner`, assert the recorded argv of every invocation, and assert the count of
  recorded invocations against an expected count so a **new, unrecorded** call fails the
  test rather than passing it unnoticed.

  `secret_scanning_enabled_for_new_repositories` and its org-level siblings are named here
  once, to be explicit about what is forbidden: they MAY be **read and reported as context**
  only if a future amendment authorises the read — no such authorisation exists today, so
  FR-3's single GET is repo-scoped and this spec reads nothing at org level — and they MUST
  **never** be written by MinSpec under any circumstance, ratified amendment or not.

- **FR-9 (the honest statement of what this does and does not close).** The advisory changes
  repository settings; it does not make the resulting signal a merge gate. GitHub secret
  scanning alerts do not block merges, and push protection blocks pushes rather than merges.
  Any copy or documentation produced by this work MUST NOT claim that enabling these
  settings gates anything it does not. The still-open half of #1620 — making the
  `Secret scan (gitleaks)` check *required* on the default branch — is a **required-checks**
  change in the sibling advisory, not a secret-scanning-settings change, and it is
  deliberately **out of scope here**; OQ-2 puts it to the human as the natural follow-up.

---

## Contract

```ts
// packages/minspec/src/lib/secret-scanning-advisor.ts — all pure; runner injected.

/** The three repository settings this advisory evaluates (FR-4). */
export type SecretScanningSetting =
  | 'secretScanning'
  | 'pushProtection'
  | 'nonProviderPatterns';

/**
 * FR-3. Exactly four states, none collapsible into another.
 *  - 'unavailable' = the repo cannot have this setting (entitlement/field absent) → SILENT.
 *  - 'unknown'     = we could not establish it (read failed / unparseable / unrecognised
 *                    value) → SILENT, and never coerced to 'disabled'.
 * Only 'disabled' may produce an offer.
 */
export type SettingState = 'enabled' | 'disabled' | 'unavailable' | 'unknown';

/** FR-3. The whole probe result. Every field defaults to 'unknown' on any failure. */
export interface SecretScanningPosture {
  readonly secretScanning: SettingState;
  readonly pushProtection: SettingState;
  readonly nonProviderPatterns: SettingState;
  /** Context for copy ONLY — never the predicate that decides whether to offer (FR-3). */
  readonly visibility?: 'public' | 'private' | 'internal';
}

/**
 * FR-3. ONE autonomous read-only GET of the repository's OWN settings, via the injected
 * runner. Authorised by DR-050 Amendment (2026-09-22) — see FR-1: this function must not
 * be reachable from a shipped path until that amendment is `accepted`.
 * Never throws: any failure resolves to an all-'unknown' posture.
 */
export function probeSecretScanning(
  owner: string,
  repo: string,
  run: CommandRunner,
): Promise<SecretScanningPosture>;

/** FR-6. The offerable subset: exactly the settings whose state is 'disabled'. */
export function offerableSettings(
  posture: SecretScanningPosture,
): readonly SecretScanningSetting[];

/**
 * FR-5.2. The MINIMAL request body: the chosen settings and nothing else. Never built by
 * re-serialising a previously-read repo object.
 */
export function enablePayload(
  settings: readonly SecretScanningSetting[],
): Record<string, unknown>;

/** FR-5. Mirrors CreateRulesetOutcome's shape so the honesty helpers apply unchanged. */
export interface EnableSecretScanningOutcome {
  readonly enabled: boolean;
  readonly forbidden: boolean;
  readonly planLimited: boolean;
  /** GitHub's own `message`, never a paraphrase; null when it said nothing quotable. */
  readonly reason: string | null;
}

/** FR-5. Consent-gated: called ONLY from the toast's affirmative branch. Repo-scoped. */
export function enableSecretScanning(
  owner: string,
  repo: string,
  run: CommandRunner,
  settings: readonly SecretScanningSetting[],
): Promise<EnableSecretScanningOutcome>;
```

The pass in `init.ts` gains one injectable dependency so the new branch is testable without
a VS Code host, matching how `RulesetAdvisoryDeps`
([`init.ts:711-733`](../../../packages/minspec/src/commands/init.ts#L711)) already injects
`run` / `resolveRepo` / `openExternal` / `isRepo` / `requiredChecks`:

```ts
export interface RulesetAdvisoryDeps {
  // …existing fields unchanged…
  /** FR-3/FR-6. Overrides the probe in tests; never a user-facing setting. */
  secretScanningPosture?: SecretScanningPosture;
}
```

**No shape here is licensed until AC-1 passes.** Every field name the probe parses is
`unknown`-until-verified per the evidence split above; the Plan re-derives the parse from a
live response and this contract is amended to match, not the other way round.

---

## Invariants

- **INV-1 (offline by default — constitution invariant 1, via DR-050).** MinSpec opens no
  socket: every call is delegated to the user's own authenticated `gh` through the injected
  `CommandRunner`. No `http`/`https`/`fetch`/`net` import is added to `packages/minspec` or
  `packages/shared`; the Tier-0 lint gate is untouched. Nothing here runs at activation or
  in the background — the pass is reachable only from `MinSpec: Initialize` / the refresh
  command ([`init.ts:1290`](../../../packages/minspec/src/commands/init.ts#L1290) and
  [`:1516`](../../../packages/minspec/src/commands/init.ts#L1516)). The zero-network
  fallback (the docs link) stays intact on every branch.

- **INV-2 (blast radius — constitution invariant 3).** MinSpec may read and, on a click,
  write **the repository's own** settings, and nothing else. No org-level, user-level or
  enterprise-level configuration is read or written on any branch. The opt-in marker is
  `.minspec/` at the repo root, and it is already satisfied structurally: the pass is only
  reachable from init/refresh, which is the act of creating or maintaining `.minspec/`.
  FR-8 makes this mechanical rather than reviewed, because "we did not write one" is
  clean-by-omission and this invariant deserves a property, not an inspection.

- **INV-3 (nothing mutates autonomously).** Every write is downstream of an explicit,
  in-context click naming what will change. No global toggle, no setting, no "enable all my
  repos" affordance — the *Costly to Refactor* prohibition in
  [`DR-050.md:354`](../../../docs/decisions/DR-050.md#L354) stands and this spec does not
  seek an exception.

- **INV-4 (never assert an unestablished cause).** No copy may state a reason GitHub did not
  give, name a remedy that cannot work, or claim MinSpec detected something it inferred.
  `unknown` reads as unknown or stays silent; it never reads as `disabled`.

- **INV-5 (this advisory is not a gate, and must never become one — constitution invariant
  2).** The pass is wrapped in a swallowing `catch {}`
  ([`init.ts:1018-1020`](../../../packages/minspec/src/commands/init.ts#L1018)). That is
  correct for an advisory and forbidden for a gate. Therefore: **no output of this feature
  may be written to a gate signal, a label, a status check, a CI artifact, or any
  merge-gating file.** The moment a swallowed-error advisory feeds a gate, the gate passes
  best-effort — precisely the `|| true` shape invariant 2 forbids. If a future change wants
  secret-scanning posture to *gate* anything, it must produce that signal from a path that
  fails closed and visibly (the `secret-scan.yml` witness is the existing example), never
  from here.

- **INV-6 (silence over a wrong nag).** An advisory that tells a user to enable something
  they cannot enable is worse than silence — it is a never-wrong product asserting a false
  fact about the user's own repo. Every ambiguous state resolves to silence (FR-3, FR-6).

---

## Acceptance Criteria

- **AC-1 (the field contract is verified against a live response before it is hardcoded).**
  The Plan records an actual `gh api repos/{owner}/{repo}` response — one public repo and
  one private repo — showing the exact object path and value shape of all three settings,
  and shows what a repo **without** the entitlement returns. Every name in the FR-3 parse
  traces to that captured evidence. A parser written from this spec's prose alone fails this
  criterion; the prose is explicitly marked unverified.

- **AC-2 (a fully-configured repo is silent).** All three settings `enabled` ⇒ zero toasts,
  zero mutations, and the pass's required-checks behaviour is byte-identical to today.

- **AC-3 (an unavailable repo is silent).** A response in which the settings are absent /
  not togglable ⇒ zero toasts. Asserted **without** reference to `visibility`, so that a
  public repo lacking the fields and a private repo lacking them behave identically.

- **AC-4 (`unknown` never becomes `disabled`).** Non-zero exit, empty stdout, invalid JSON,
  a valid payload with no `security_and_analysis`, and a recognised field carrying an
  unrecognised value each produce `unknown` and zero toasts. Five separate cases, five
  assertions. (Memory: *"Empty query ≠ settled gate"* — a no-output read must mean
  keep-quiet, never conclude.)

- **AC-5 (the two offers are independently dismissible — FR-2).** With **both** a missing
  required check and a disabled secret-scanning setting, dismissing the required-checks
  toast leaves the secret-scanning offer still presented, and vice versa. This is the
  assertion that proves the issue's stated coupling cost was actually removed rather than
  described.

- **AC-6 (invariant 3, as a property — FR-8).** Driving the module across its full input
  matrix with a recording runner yields argv whose every `gh api` path is repo-scoped, no
  path contains `/orgs/`, `/user/` or `/enterprises/`, **and** the recorded invocation count
  matches the expected count — so a newly added, unrecorded call fails the test.

- **AC-7 (the spawn point stays single).** `secret-scanning-advisor.ts` imports neither
  `child_process` nor `vscode`, and the `child_process` allowlist in
  `packages/minspec/tests/invariants.test.ts:171-172` is **unchanged** by this work.

- **AC-8 (the write is minimal — FR-5.2).** The request body's key set is pinned exactly.
  A test asserts that enabling one setting sends that setting alone, and that no other
  repository field appears in the payload.

- **AC-9 (declines are remembered — FR-5.5).** "Not now" writes the local git-config flag;
  a subsequent pass over the same repo shows no secret-scanning toast **and issues no
  secret-scanning probe**, asserted on recorded argv rather than on the absence of a toast.

- **AC-10 (failure copy is honest — FR-5.4, INV-4).** A 403 with a quotable GitHub
  `message` surfaces that message; a 403 with an entitlement/plan message surfaces the
  entitlement reason and not a scope diagnosis; a 403 with nothing quotable surfaces a
  non-committal phrase. No branch renders a remedy that could not work.

- **AC-11 (push protection discloses its reach — FR-4).** The toast text offering push
  protection names that it blocks pushes for everyone with write access, asserted on the
  string.

- **AC-12 (nothing regresses in the existing pass).** The full existing
  `packages/minspec/tests/ruleset-advisor.test.ts` suite passes unmodified, except where a
  test asserts an exact toast count that FR-2's second toast legitimately changes — and each
  such edit is called out individually in the PR rather than absorbed silently.

- **AC-13 (FR-1's hold is real).** Until DR-050 Amendment (2026-09-22) is `accepted`, no
  merged code path can reach `probeSecretScanning` or `enableSecretScanning` from a shipped
  command. The Plan names the mechanism that enforces this (and it must be a mechanism, not
  a convention — constitution: *enforce, don't trust the model*).

---

## Out of Scope

- **Making any secret-scanning signal a required status check.** That is a required-checks
  change in the sibling advisory (see OQ-2), not a settings change.
- **Org-level configuration, read or write** — `secret_scanning_enabled_for_new_repositories`
  and its siblings. FR-8 forbids it mechanically; this spec does not seek an amendment for it.
- **Any change to the gitleaks hook, `secret-scan.yml`, or the `.gitleaksignore` migration
  (#1663).** This spec touches repository *settings* only.
- **Bulk or cross-repo operation.** One repo — the open workspace — per pass, always.
- **Detecting or reporting existing secret-scanning *alerts*.** Reading alert contents is a
  different data class from reading a settings toggle (it returns the neighbourhood of real
  secrets), and DR-050's carve-out does not cover it. A separate decision would be required.

---

## Decisions needed (Clarify)

These are the human's read. Each names a recommendation **and what that recommendation
costs**, per the project's decision convention.

- **OQ-1 — Ratify the DR-050 Amendment (2026-09-22), and on what terms?**
  The amendment enumerates the repo-settings **GET** (subject-identical to the already-
  authorised `.../rulesets` read) and, separately, the repo-settings **PATCH** — the first
  time MinSpec would write a *repository setting* rather than a rulesets resource. The two
  halves can be ratified independently.
  **(rec) Ratify both, with the FR-5.2 minimal-payload bound written in as a load-bearing
  condition of acceptance** (the same way the 2026-08-25 amendment's branch-scoped and
  no-persistence bounds are conditions, not hardening). *Cost:* it authorises MinSpec to
  `PATCH` a broad repository endpoint, whose payload surface is much larger than the three
  fields we intend to send; the bound is enforced by our own test, and a future careless
  edit to that payload builder would be a settings-clobber bug with no external guard. The
  alternative — ratify the read, defer the write, ship advisory-plus-docs-link only — is
  genuinely safer and reduces the feature to *"we tell you, you click through to GitHub"*,
  which is where every other never-quite-done governance nag has ended up.

- **OQ-2 — Should the required-checks advisory also learn to require the
  `Secret scan (gitleaks)` check on the default branch?**
  This is #1620's still-open half: `secret-scan.yml` is shipped to adopters and runs on every
  PR, but `TIER_B_CODE_CHECKS` is `['lint','test','build']`
  ([`ruleset-advisor.ts:355`](../../../packages/minspec/src/lib/ruleset-advisor.ts#L355)) — no
  secret-scanning context — so the witness is *visible but not binding*, by the workflow's own
  admission ([`secret-scan.yml:49-57`](../../../.github/workflows/secret-scan.yml#L49)). It is
  arguably the higher-value half of #1809, since it produces an actual merge gate rather than
  an alert feed. It is also *tacked-on scope* under the project's scope-expansion rule, so it
  is surfaced here rather than silently absorbed into an FR.
  **(rec) Yes, but as its own issue against the tiered-check resolver, not inside this spec.**
  *Cost:* two threads for one coherent idea, and the smaller half ships first, so the gap that
  actually lets a secret merge stays open longer. Folding it in here would be faster —
  it is the same module and the same toast — at the price of a spec whose scope no longer
  matches the issue the human approved.

- **OQ-3 — Toast budget and ordering when a cold repo has both gaps.**
  FR-2 permits two toasts from one pass. Options: (a) show both, required-checks first;
  (b) show both, secret-scanning first; (c) cap at one per pass, deferring the other to the
  next refresh.
  **(rec) (a) — both, required-checks first.** *Cost:* two toasts in a row on a fresh repo is
  measurably more annoying than one, and the second is the one more likely to be dismissed
  unread — which inverts the priority if the human judges secret scanning the more urgent gap.
  (c) is the calmest but means a user who only ever runs init once never sees the second offer
  at all, which reproduces the "nothing looks" failure that filed this issue.

- **OQ-4 — If the entitlement is missing on a private repo, is silence really right?**
  FR-3/INV-6 say silence: telling a user to buy something is the wrong job for a spec tool,
  and a nag they cannot act on is worse than none. The counter-argument is real: a private
  repo with a gitleaks hook that a developer can silently skip and no server-side scanning at
  all is the **weakest** posture in the matrix, and it is the one case where the user hears
  nothing.
  **(rec) Stay silent in the toast, but surface the posture as a row on SPEC-042's onboarding
  checklist**, where a user is deliberately reading a status list rather than being
  interrupted. *Cost:* it defers the visible half of this feature to another spec's surface,
  so on merge day the private-repo case ships with no user-visible change whatsoever — and
  SPEC-042 is not done, so "later" may mean "not soon".

- **OQ-5 — Tier.** Set to **T4** here: the mechanical diff is small, but the change moves a
  constitution-invariant boundary and ships an unrecallable mutation capability inside an
  installed build. SPEC-033, whose mechanical scope is strictly larger, is T3, so this is an
  inconsistency the human should either bless or correct. Tier is an upward-only floor, so
  T4 can be kept without further justification; lowering it to T3 is a deliberate human act.

---

## Risks

- **The API contract is assumed, not measured.** The single largest risk in this spec: three
  field names and an entitlement model are taken from #1809 and model knowledge, with no
  network access on this dispatch. AC-1 is the control, and it gates the parser, not merely
  the review.
- **GitHub re-packages this product line.** It has before. FR-3's derive-from-response rule
  is the mitigation; a `visibility`-based predicate would be the vulnerability.
- **Toast fatigue eats the signal.** Two offers where there was one. FR-6's silence rule and
  FR-5.5's decline memory bound it; OQ-3 is where the human tunes it.
- **The 403 ambiguity recurs.** A token lacking repo-admin and a repo lacking entitlement both
  surface as 403. This is the exact failure `describeRulesetFailure` was written for after a
  confidently-wrong diagnosis shipped once already
  ([`init.ts:801-818`](../../../packages/minspec/src/commands/init.ts#L801)); FR-5.4 reuses
  that discipline rather than re-deriving it.
- **A future author wires this into a gate.** The advisory's swallowed `catch` makes that a
  silent gate. INV-5 forbids it in prose only — which is model-trusted and will drift. If the
  human wants that enforced, it needs its own check; noted rather than claimed.

---

## Tests to Pass

Commands, so the Plan recomputes rather than quotes:

```bash
# The advisory pass and its existing suite (AC-12).
npx vitest run packages/minspec/tests/ruleset-advisor.test.ts

# The new suites (AC-2..AC-6, AC-8..AC-11).
npx vitest run packages/minspec/tests/secret-scanning-advisor.test.ts
npx vitest run packages/minspec/tests/gh-api-repo-scope.test.ts

# AC-7 — the child_process allowlist must be untouched by this work.
git diff --stat main -- packages/minspec/tests/invariants.test.ts   # expect: no output
grep -n "child_process" packages/minspec/src/lib/secret-scanning-advisor.ts  # expect: none
grep -n "from 'vscode'" packages/minspec/src/lib/secret-scanning-advisor.ts  # expect: none

# INV-2 / FR-8 — no org-, user- or enterprise-scoped path anywhere in the feature.
grep -rn "orgs/\|/user/\|enterprises/" packages/minspec/src/lib/secret-scanning-advisor.ts

# Frontmatter + reference gate.
npm run validate
```

Note for the Plan: **CI runs `npx vitest`, not `npm test`**, so a `pretest` hook never fires
in CI — any gate this work needs in CI must be a `ci.yml` step or a test.

---

## Follow-ups (tracked)

- **DR-050 Amendment (2026-09-22)** — written with this spec, `proposed`. Ratification is
  FR-1's precondition and OQ-1's question. Tracked by **#1809**.
- **Making `Secret scan (gitleaks)` a required check** — #1620's still-open half. **Not yet
  filed**; OQ-2 decides whether it is filed as its own issue or folded here. Recorded as
  explicitly-unfiled rather than left as a prose intention.
- **`docs/decisions/INDEX.md`'s DR-050 summary is stale** — it describes only the 2026-07-01
  amendment and mentions neither 2026-07-16 nor 2026-08-25, and its `auto=` hash is
  `0000000000000000`. The block is generated (`<!-- minspec:dr-index:start -->`), so it is
  **not** hand-edited here; regenerating it is a harness-refresh act. Observation only, no
  action taken.
