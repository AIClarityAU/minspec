# Can a wiki log be made non-forgeable?

**Date:** 2026-08-23  
**Methodology:** Four parallel ground-truth passes (cryptographic requirements and trust
anchors; integrity prior art in the llm-wiki cohort; MinSpec's existing hashing, approval
and verdict machinery; what is achievable under the offline invariant), then three
candidate designs, each handed to an independent red team whose findings override the
designs' own self-assessments.  
**Scope:** Whether an append-only log can be made non-forgeable, for a local offline tool
and for a hosted enterprise system, which turn out to have opposite answers.  
**Evidence rule applied throughout:** every "measured" claim corresponds to a command that
was run, with output quoted.

---

## 1. The answer

**Partly. Here is the line, and it has three segments, not one.**

**Yes** you can make the log **tamper-evident to a verifier who independently holds `(count, tip)` recorded before the tamper**, where "independently" means on storage the writing agent cannot reach. That property is real, it is cheap, and it is the strongest thing on offer.

**No** you cannot make it tamper-evident to a verifier holding only the file. A truncated chain is a valid chain. A re-chained log is a valid log. A fresh three-entry log is a valid log. This is not an implementation gap and no amount of local cleverness closes it.

**No, at any rung, ever:** you cannot detect an entry that was **never written**. Every mechanism in every design protects entries after they exist. The cheapest cover-up is silence, and silence leaves a perfect chain, a matching anchor, a valid signature and a Bitcoin timestamp. Anchoring makes this worse, not better: it converts a silent omission into a permanently witnessed, cryptographically endorsed incomplete record.

Two corollaries that matter more than they sound:

- **A hash binds content, never authorship.** The `actor:` field in every one of the three candidate designs is unauthenticated free text. Attributing a fabricated T4 human approval to the founder costs one command, and the red team ran it. Do not describe an `actor:` field as attribution.
- **The window above the last witness is freely rewritable.** The red team's deepest finding (Break 3 against `git-witness`) needs no force push, no replace refs, no working-tree trick: reset to the pinned commit, re-append forged entries, push as an ordinary fast-forward. It survives a protected remote, a fresh clone, every other clone's reflog, and the GitHub activity API simultaneously, because from every witness's point of view nothing was rewritten. The offline-first posture that makes these designs pleasant deliberately widens that window.

So the honest one-line property, and this is the exact wording to use in any artifact: **tamper-evident below an independently held mark; freely rewritable above it; blind to omission everywhere; and it says nothing about who wrote any entry.**

Everything past this point is about which parts of that are worth building.

---

## 2. Why the strong version is impossible locally

A self-contained log is a function of its own bytes. Verification is a rule applied to those bytes. Whoever holds the bytes can compute any function of them, including the one the verifier computes, so they can rewrite the log and recompute every hash to match. Whoever holds the verifier can replace the rule with "always pass". If one party holds both, as an agent with write access to the working tree does, tamper-evidence requires at least one piece of state that party cannot reach. There is no local substitute for that one piece of state, because "local" is exactly the set of things they control.

Two concrete forms of this, both measured:

- **Tail truncation costs nothing at all.** The truncated log is a bit-identical prefix of the honest one. There is no recomputation and no anomaly, because "there is nothing after me" is not a statement any entry makes. The only fix is putting a **count** inside the externally held commitment, which is why RFC 6962's signed tree head carries `tree_size` and homegrown designs usually do not.
- **A co-located signing key adds nothing.** A three-commit SSH-signed history was rewritten with `filter-branch --commit-filter`, and all three commits still report `G`. Worse: `ssh-add` a key, `rm` the private key file, then sign attacker-chosen content, and it verifies. A key the agent can *use* signs whatever the agent hands it, so non-extractable is not unforgeable. Signing only starts to matter when each signature costs a human touch or PIN.

---

## 3. The ladder

Each rung names what enforces the property and what defeats it. Costs are cumulative.

### Rung 0 - commit the log to git, and turn on two ruleset rules
**Cost:** zero code, one browser visit, one `.gitattributes` line (`log.md -text`, non-optional: `core.autocrlf=true` on any clone breaks raw-byte hashing and reports it as tamper).
**Enforced by:** GitHub's server-side ruleset. `non_fast_forward` blocks force pushes, `deletion` blocks ref deletion. Both are needed: with `denyNonFastForwards` on, a plain delete still succeeded and emptied the branch in test.
**Stops:** rewrite or deletion of anything already pushed, by anyone without bypass. This is a git-server feature; the hash chain contributes nothing to it.
**Does not stop:** anything before the push; `bypass_actors`, which is a hole by design and already root-caused in this repo at `packages/minspec/src/lib/direct-push-audit.ts:1-25` ("Rulesets are REF-scoped, not PATH-scoped... the bypass grants an admin the ability to direct-push ANYTHING to `main`"); an admin deleting the ruleset, force-pushing, restoring it, which would be caught by an org audit log that this org does not have (`GET /orgs/AIClarityAU/audit-log` → 404, team plan); GitHub itself.

**This rung is currently missing.** `gh api repos/AIClarityAU/minspec/rules/branches/main` returns exactly one rule, `required_status_checks`. Today `main` is neither force-push-protected nor deletion-protected, and the activity API already records two force pushes on it. Every sentence anywhere in this codebase of the form "as trustworthy as the git remote" is currently worth less than it sounds.

### Rung 1 - a hash chain, built to survive the red team
**Cost:** a few hours, plus O(n) verification and roughly 25% file growth on realistic entries.
**Enforced by:** SHA-256 collision resistance, plus a verifier that actually walks the whole file.
**Stops, unconditionally:** bit rot, partial and torn writes, bad merges, a buggy writer that overwrites an entry in place, a human who edits a line in a text editor without re-running the sealer. This is genuine value at zero key and zero network cost.
**Does not stop:** any adversary who runs the sealer. The forging tool ships with the format; the red team re-chained 5000 entries in 0.03 seconds.

Six construction rules, each from a break that landed:

1. **Hash raw bytes, and pin the gaps.** Define the sealed region as `[start(i), start(i+1))`, so the bytes *between* a seal and the next heading are covered. Attack A1 inserted a fabricated entry into that unhashed gap with an HTML-entity heading: **tip unchanged, count unchanged, zero failures**, rendering identically to a real entry in any markdown viewer. It defeats a correct external witness.
2. **Never canonicalize before hashing.** Attack F8 produced two byte-different files with the same tip, because CR-folding is lossy. One of them silently loses a field from every line-based grep, and on a terminal the CR makes the next line overwrite it. Canonicalize-then-hash is right for spec approval where reflow is benign; it is wrong for a log, where the file *is* the evidence. As a bonus, raw-byte hashing has no Node/Python twin to drift, unlike `packages/shared/src/canonical.ts:126-128` and its hand-maintained partner `scripts/hooks/canonical.py`.
3. **Reject the grammar at write time, then re-read after writing.** Attack A3 appended, through the sanctioned API, an entry whose body contained a `## [` line. The writer reported success and a new tip; the verifier reported the old tip and three entries; every subsequent honest append was permanently refused, and the prescribed `repair` verb does not exist in the implementation. This is the pattern already used at `scripts/dispatch-ready-check.sh:239` (`record_scrub`) and `.github/scripts/ai-review-guard.js:102-121` (`defangProtocolTokens`).
4. **Never stop evaluating, and never exit 0 without a witness.** Attack A4 hid two wholesale rewrites behind a single trailing space on entry 1's seal, because the verifier returns on first failure. Attack A2 deleted one seal line, rewrote 301 entries, and got `exit 0` plus a warning that told the reader the condition was "NOT a tamper signal". Attack F4 simply ran the verifier the documented way with no witness and got `OK`, `exit 0`, on a forged file. All three are direct violations of `.minspec/constitution.md:8` ("a missing or errored witness fails the gate closed and visibly, never silently passes or **stops evaluating**"). Three named verdicts, three distinct exit codes, and the string `OK` must be unreachable without a resolved external witness.
5. **Verify one byte source.** Break 1 exploited a verifier that read the working-tree file for some checks and committed blobs for others, then hid the divergence with `git update-index --skip-worktree`. Read `git show HEAD:<path>` for everything, and assert `git diff --quiet HEAD -- <path>`.
6. **Pin the set, not just each chain.** Attack F1 deleted an entire per-writer chain plus its anchors file with two `rm`s. Nothing anywhere referenced it, so nothing noticed. Per-writer files avoid merge conflicts, but they need a joint checkpoint chain listing `(log_id, count, tip)` for every live writer, or the whole apparatus is bypassed one level up.

### Rung 2 - an externally held `(count, tip)`
**Cost:** the discipline to keep a mark somewhere the agent cannot write.
**Enforced by:** the physical separation of the mark. Nothing else.
**Stops:** adaptive re-chaining and truncation **below the mark**. This is the first rung that beats an adversary rather than an accident.
**Does not stop:** everything above the mark (Break 3); omission; a count-only mark, because attack A6 truncated and then made honest appends to restore the count exactly, so the **tip is the load-bearing half**.

The mark must not be a file in the repo. Attacks F2 and F3 shredded and neutered a local anchors file: F2 kept only the oldest row and then re-chained freely, and because the verifier prints "N entries appended since, UNWITNESSED" from the surviving row, **the adversary chooses the size of its own alarm**. F3 forged a row with `count=0` using the publicly computable genesis value and got a green `OK anchored`. F5 pushed a forged log to a side branch and pointed the anchor row at that real commit while labelling it `refs/heads/main`, because nothing checked the commit against the ref. An anchor row is a receipt index, not a witness; it is worth nothing until the external lookup happens and the ancestry is checked.

Honest sources of a mark, all cheap: the protected remote itself; another machine's clone (its `origin/<ref>` reflog accumulates for free, 212 entries in this checkout); GitHub's `activity` API, which remembered two force pushes on `main` that this checkout's reflog did not; a twelve-hex prefix in a phone note.

### Rung 3 - the witness binds current state
**Cost:** verification becomes a network act.
**Enforced by:** fetching the ref at verify time and requiring `HEAD == origin/<logref>` rather than "the pin is an ancestor".
**Stops:** Break 3, the standing rewrite window above the mark. This is the only fix; it is a design change, not a patch.
**Does not stop:** omission; a compromised or colluding remote; anything during a genuine offline stretch, which now cannot be verified at all.

### Rung 4 - presence-gated key, or OS-level append-only
**Cost:** hardware and a touch per entry, or one privileged setup act.
**Enforced by:** the human's finger, or the kernel.
**Stops:** silent minting (forging N entries now costs N touches, each an out-of-band alarm), and, for the privilege variant, same-uid rewrite outright.
**Does not stop:** truncation, omission, or `rm && init && three innocuous entries` (three touches, not N). A touch proves presence, not consent to content: `ssh-keygen -Y sign` displays nothing about what is being signed, and the agent picks the bytes.

MinSpec cannot take the privilege route itself. `chattr +a` as uid 1000 returns `Operation not permitted`, and a per-project tool writing machine-wide surfaces is out of bounds under `.minspec/constitution.md:9`. It can document it as an operator act; it must not perform it.

### Rung 5 - third-party transparency log with a witness quorum
**Cost:** a real network dependency, k independent parties, and someone who monitors. RFC 9162 §11.2 is blunt that the log does not detect its own misbehaviour, and §11.3 declines to specify the gossip protocol that would.
**Stops:** split views, where the log shows different histories to different readers.
**Does not stop:** omission. Out of scope for a solo tool.

### Which rung is worth it for a solo tool

**Rung 0, then Rung 1, then stop.** Rung 0 is free and is the only thing on the ladder that currently protects anything at all. Rung 1 buys real integrity against accidents and bugs, which is the failure class that actually occurs weekly.

Rung 2 sounds like the obvious next step and is the one to be skeptical about, because it is the only rung whose value depends entirely on human discipline that decays. A solo founder will not keep a phone note of tip prefixes current, so in practice Rung 2 degrades to Rung 1 while carrying Rung 2's language. That mismatch, a system described as tamper-evident and operating as integrity-against-bugs, is exactly the class of defect that this project treats as worst.

Rung 2 becomes worth it, cheaply, in one specific form: **the protected remote is the mark**. Verify with a fetch and an ancestry check when online, and print `internally-consistent-unwitnessed` with the window size when not. That gets most of Rung 2 with no new artifact to maintain, and it is honest about Break 3.

---

## 4. MinSpec

**Recommendation: do not build the wiki log. Fix three things you already have.**

MinSpec's problem is not that it lacks a tamper-evident log. It is that the strongest record it owns is undersold and the weakest ones are unprotected. The approval sidecars at `.minspec/approvals/**` are committed (carved in explicitly at `.gitignore:103-106`, 59 to 64 tracked files), content-addressed via `specHash`, recoverable from git history, and already held from agent auto-merge so a forged one still needs a human merge keystroke. That is a better artifact than any markdown log a new format would produce. Adding a chained `log.md` beside it creates a second, weaker source of truth about the same events, and two sources of truth about approvals is worse than one.

**Do these, in order.**

**(a) Enable `non_fast_forward` and `deletion` on `main`.** Zero cost, five minutes, biggest single improvement on this page. Downside, stated plainly: legitimate history repair now needs an admin bypass, and `bypass_actors` remains a ref-scoped hole that `direct-push-audit.ts` already documents, so this raises the floor without closing the ceiling. **No DR.** It is a config flip, reversible in a minute, and fails the "can this be undone in under a day" test in the direction of "just do it".

**(b) Remove the `|| true` from `scripts/hooks/spec-gate.sh:51`.** The bypass log is appended best-effort, so a failed write is silent. Today that is defensible because the bypass log is not load-bearing. But any proposal that makes a log load-bearing inherits the full weight of `.minspec/constitution.md:8`, and the correct pattern already exists in this repo at `scripts/auto-merge-gate.ts:882-905`: `applyAuditFailsafe` downgrades an ELIGIBLE decision to HOLD when its audit line did not persist. If the log entry did not land, the logged action did not happen. Downside: a full disk or a permissions problem now blocks a commit instead of quietly proceeding, which is the intended behaviour and will still be annoying the first time it fires. **No DR** if it is a one-line change to an existing best-effort write; **DR** if it changes whether the gate blocks.

**(c) Chain the four untracked logs, if and only if you want the accident coverage.** `.minspec/auto-merge-audit.log` (`.gitignore:67`), `.minspec/gate-bypass.log`, `.minspec/shadow-triage.jsonl` (`.gitignore:117`), `.minspec/calibration.json` are all gitignored and none is tamper-evident. Chaining them is strictly better than the status quo at zero network cost, and it costs nothing under the offline invariant because a chain is `crypto` and nothing else. Be precise about what it buys: **integrity against accident and non-adaptive bugs, in files that are not committed and therefore have no external witness at all**. Against the agent that writes them, it buys nothing.

**And do not do these.**

- **Do not introduce signing.** A key the agent can use is worth nothing (demonstrated above). `required_signatures` on the ruleset is not a free flip: 85 of the last 500 commits on `main` are genuinely unsigned, all locally created, including every agent commit, and the bot identity is a bare `-c user.email=` flag at `scripts/remediate-pr.sh:572`. Turning it on breaks the agent path the same afternoon.
- **Do not add a network anchor.** The only consent seam is the push at `packages/minspec/src/lib/approve-push.ts:11-16` ("A push IS a network call, so it never happens implicitly"), and anchoring there adds no new network surface. But per-write anchoring converts an offline-first tool into a network-coupled one, and under `.minspec/constitution.md:8` its failure then has to be *visible*, so every flight becomes a blocker.

**On the wording, and this needs a DR.** If you adopt any of this, the accompanying naming discipline is a convention that will drift the moment it is prose only, which is this project's own stated failure mode. A DR should record: the three verdict strings and their exit codes; that `unwitnessed` is never a pass and no gate may key on a verdict string alone; that "tamper-proof", "non-forgeable" and "non-repudiable" are forbidden in MinSpec artifacts; and that a hash binds content, never authorship, extending the root cause already written at `scripts/dispatch-ready-check.sh:405-422`. That is not undoable in a day once a corpus of log entries and downstream gates exists, so it clears the ADR filter. The ruleset flip and the `|| true` removal do not.

**The one thing worth keeping from the candidate designs, and it is not the chain.** A legitimate append touches zero existing lines, so `git diff -U0 <log> | grep '^-'` returning anything at all is a hard, deterministic signal that something other than an append happened. It is chain-independent, it survives most of the attacks above, and it costs one line in a pre-commit hook. Note what it is not: the "diff amplification" property that the `local-chain` design called its strongest residual defence was measured at 404 lines for an honest re-chain and **3 lines** under attack A2, and it is worth exactly zero if nobody reads the diff. The `grep '^-'` test is a gate; amplification is a hope.

---

## 5. Knowledge Fabric

**Different trust model, so the answer inverts. And signing is the wrong problem.**

The theorem in §2 needs one party to control both the storage and the verifier. In an enterprise that party does not exist: the claims store is a server the claim's subject cannot write, identity comes from Entra ID rather than a `git config` string, and the audit log is administered by someone else. The "one bit of state the adversary does not control" is free. So the properties that are impossible for a solo offline tool are ordinary here, and they cost a schema, not cryptography:

- **Server-assigned monotonic sequence and server timestamp on every claim row.** Enforced by the write API having only an append verb and no update or delete. Defeated by a database admin, which is what the platform's own audit trail is for. This gives you non-elision and freshness for free, and no client ever sees a sequence number it can choose. Compare: backdating was free in all three candidate designs, and none of them checked timestamp monotonicity.
- **Attribution from the IdP token at write time, not a self-asserted `actor` field.** Enforced by the token's issuer and audience validation. Defeated by token theft and by service principals shared across a team, which is the same real-world hole as a shared CI key. This is the property that a hash can never provide and an identity provider provides trivially.
- **Immutable retention where claims will be evidence.** If claims are ever cited in a compliance or legal context, this is a procurement decision (retention-locked storage), not a design one. State it as such.

**Do not sign claims.** Per-claim signatures buy non-repudiation, and non-repudiation is a property nobody in this system needs: no one is going to deny having asserted a claim in a corporate KM tool, and if they do, the server's audit record settles it more cheaply and more credibly than a signature whose key management you would then own forever. Signing here is cost with no matching threat.

**The two things that actually determine whether "traceable knowledge rather than unsupported summaries" is true or false, and neither is cryptography:**

**(a) Provenance captured at extraction, or never.** The moment a claim is extracted, record the source item's immutable identifier, its version or eTag, and the exact span, on the server, in the same transaction as the claim. Microsoft Graph exposes item ids and versions; a citation captured then is checkable forever, and a citation reconstructed later is a guess. This is the single highest-value engineering decision in the whole proposal. The failure it prevents is the one that kills these systems: a claim that cites a document which has since been rewritten, so the citation resolves, looks green, and no longer supports the claim. Note that a line-range or span check only proves the span exists, not that it says what the claim says, and a still-in-bounds citation goes stale silently. Version-pin the source, and re-verify on source change rather than trusting an in-bounds span.

**(b) Permissions inherited and evaluated at read time, never cached at write time.** A derived claim's ACL is a function of its sources' **current** ACLs. Caching the inherited ACL at extraction is not a performance optimisation, it is an exfiltration channel: source permissions tighten, the claim keeps the stale ACL, and the system now summarises documents that people have lost access to. Enforced by evaluating against the source systems on every read, defeated by any caching layer added later for latency, which is why the caching decision needs to be made once, deliberately, at the start.

And treat "users can discover that knowledge exists without seeing it" as a security surface in its own right. A claim's title is frequently the secret. "Acme is renegotiating after the Q3 outage" leaks the entire fact while formally withholding the body. Decide per-claim, at extraction, whether the *existence* is disclosable, and default it closed.

**On confidence levels: they are an editorial property, not a security one.** A confidence score does not make an unsourced claim traceable; it makes it a labelled guess. The risk is that confidence becomes the thing that launders an unsourced claim into a generated view. The gate should be evidence-presence, not confidence-threshold: a claim with no resolvable source citation should be ineligible for a generated view at any confidence.

**The real adversaries here are not forgers.** They are drift (sources change, claims do not), over-broad permission propagation, and plausible-but-unsourced generated views. Zero of the three are touched by signing, and all three are touched by (a) and (b).

---

## 6. What not to build

Named, because each of these was measured failing, and each looks rigorous.

1. **A hash chain with the tip stored beside the log.** The `.llmwiki/events.head` pattern: truncate, reseal, overwrite the anchor, verify green. The source's own header says so. As a bonus failure, a clone that lacks the private directory reports a permanent false break, so the alarm trains people to ignore it.
2. **Any signing key the writing agent can use.** File, ssh-agent, OS keychain, TPM, non-touch FIDO. Rewriting a signed history left all commits reading `G`; signing continued to work after the private key file was deleted, because the agent held it.
3. **`git notes` for the tip.** Not fetched by default, verified empty on a fresh clone, and rewritable in place. A commit trailer is inside the commit object; a note is not.
4. **Canonicalize-then-hash in a log.** Produces byte-different files with identical tips, and one of them can hide a field from every line-based tool.
5. **A verifier that prints `OK` without a witness, exits 0 on a torn tail, or stops at the first failure.** Three separate measured breaks, three separate violations of `.minspec/constitution.md:8`, and each one turns the gate into a green light on a forged log. A gate that reads its own artifact to decide whether it passed proves nothing.
6. **A count-only witness.** Truncate, then make honest appends, and the count is restored exactly. `(count, tip)` jointly, with the tip load-bearing.
7. **An anchors or receipts file inside the repo, described as a witness.** It is an index of places to look. Shredding it, neutering a row to `count=0` using the publicly computable genesis, or pointing a row at a real commit on a side branch all pass. And never compute the alarm ("N entries unwitnessed") from a row the adversary can choose.
8. **Per-writer chains with no joint checkpoint.** Two `rm`s erase a writer and nothing references it.
9. **Timestamps treated as evidence.** Unauthenticated free text in every candidate, no monotonicity check anywhere, and the prescribed cross-writer read view sorted a backdated forgery into chronological place so it read as the earliest event in the record.
10. **`|| true` on a load-bearing log write.** Currently at `scripts/hooks/spec-gate.sh:51`, currently defensible only because that log is not load-bearing.
11. **Diff amplification as a security property.** It is a review-surface property. Under attack it dropped from 404 lines to 3, and it is worth zero if nobody reads the diff.
12. **Per-entry blockchain anchoring, or an OpenTimestamps path that never gets installed.** Anchoring proves existence by a time. It proves nothing about completeness, and it cannot prove non-existence. In one candidate the OTS path was specified in detail and recorded as never executed.
13. **`required_signatures` on `main` to "make history non-forgeable".** It breaks the 85-in-500 local commit path immediately, and GitHub's notion of "verified" is rooted in keys registered to a GitHub account, not a PKI you control.
14. **Any artifact that says "tamper-proof", "non-forgeable" or "non-repudiable".** In a product whose pitch is that the signpost never lies, a false claim of a property is the defect, and this codebase has already made this exact mistake once with a `bodyHash` believed to resist forgery on a public repo.

**Your turn**
➡️ Enable `non_fast_forward` and `deletion` on `main` - `e` enable **(rec)**, free and the only item here that protects anything today; costs you the ability to force-push history repair without an admin bypass, and leaves `bypass_actors` open.
➡️ Decide whether MinSpec gets a wiki log at all - `n` no log, fix the three existing things instead **(rec)**, because a chained `log.md` would sit beside the stronger approval sidecars as a second, weaker truth about the same events; costs you the greppable narrative record the Karpathy-style log was meant to provide · `l` build it at Rung 1 with the six construction rules · `d` details on any rung.
➡️ If a log or verdict contract is adopted, write the DR fixing the three verdict strings, the exit codes, and the forbidden words - `w` write it. Not undoable in a day once a corpus exists, so it clears the ADR filter; the ruleset flip and the `|| true` removal do not.

*💲 Scrooge: synthesis across five adversarial reports with a judgment call at the centre is correctly matched to Opus. No change recommended.*