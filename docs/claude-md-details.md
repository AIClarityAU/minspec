# CLAUDE.md detail notes

Detail moved out of `CLAUDE.md` verbatim so it loads on demand instead of every session.
No rule changed; `CLAUDE.md` keeps a pointer to each section below.

<a id="merge-funnel"></a>
## Merge asks in THIS repo - a single funnel (minspec-monorepo only)

**Project-specific, and this repo only.** It overrides one line of the shared convention (in CLAUDE.md)
and is deliberately absent from the shipped templates: an adopter running MinSpec solo has no
funnel to route through and keeps the `m` merge key the shared convention gives them
(constitution invariant 3 - nothing MinSpec ships may change behaviour in a repo that did not
opt in).

Here, a session never offers `m` merge on its own pull request. Report the state you observed
and stop. The reply keys on a pull request line are `c` close, `d` diff, `r` re-review - `m` is
the one key this repo does not use. Founder instruction, 2026-09-12:

> update the CoS skill to tell each session not to ask me to merge any PRs when you're
> shepherding the merges.

**Where the funnel is defined.** Half is in this repo - SPEC-044 FR-4b
(`specs/minspec/SPEC-044-coordinated-self-completing-sessions/requirements.md:229`): "A single
driver holds the queue view and owns branch updates and merge confirmation. It picks the next PR
to update, waits for it to land, then picks the next." The other half - that no session OTHER than the driver may put a merge or
approval keystroke in front of the founder - is the founder instruction quoted earlier in this section, which lives only
in the chief-of-staff skill, outside this repository in the operator's own Claude configuration;
restated here because a link there resolves to nothing for any reader but the operator. A
citable in-repo home for it is tracked as #2056. Why a single
funnel: around fifteen sessions run concurrently on this repo, and it is the only place the whole
set of in-flight pull requests is visible, and the only place path-disjointness across a batch is
checked before it is handed over - a command block is pasted whole, so two independently
reasonable merge asks arrive as one action with nobody having checked whether the two pull
requests touch the same file.

**Your job on your own pull request is unchanged:** fix the red checks, resolve the conflicts,
drive it to greenlit, then stop and say so. Branch updates
are the funnel's call, not yours (SPEC-044 FR-4b gives it branch updates and merge
confirmation): a machinery pull request merges by human `--admin`, which bypasses the up-to-date
requirement, so updating a BEHIND machinery branch spends a full CI cycle for nothing.

**This rule is a stopgap, and the spec says so.** SPEC-044's "The mechanism - capability
REMOVED, not merely reassigned" says of the sibling capability: "A rule telling shepherds to
refrain is the exact 'trust the model' shape the constitution names as the failure mode." That
applies here unchanged - asking sessions not to offer a merge key is prose where a gate belongs,
and there the answer was to remove the capability, not ask for restraint. Until the equivalent exists for the ask side (#2056), this rule
holds only as far as each session reads and remembers it, which is exactly the property the
constitution tells us not to rely on.

<a id="scrooge-model-fit-advisory"></a>
## Scrooge Model-Fit Advisory

Watch whether the session's active **model** matches what the current task needs. When they
diverge in **either** direction, append a **single-line advisory** at the end of the response,
but only about the **next** session. An ongoing nag, not a gate: never pause the thread, never
ask - surface and continue.

- **Never recommend a mid-session switch (#2734).** Changing model, effort or thinking inside a
  running session invalidates the prompt cache; the token-saving research measured the next turn
  at about 14.5 times a normal turn. A "switch now" nudge can cost more than it saves, so the
  advisory is always framed as how to *start the next session*, never as `/model` or `/effort`
  on this one. Cost of this rule: a hard task on a badly under-powered model is no longer
  flagged for an immediate switch.
- **Format — one *italic* line** (wrap it all in `*…*`) so it sets apart and reads low-weight:
  `*💲 Scrooge: this <task> suits <model> — you're on <current>. Start the NEXT session on <model>.*`
  Model fit only: no effort or thinking half. Font size is fixed by the terminal, so italic is
  the only emphasis available here; a genuinely smaller font belongs to the statusline/webview
  surface, not this nag.
- **Only on a genuine mismatch, and only while the session is short.** Already well-matched →
  say nothing. Session already long (a switch or restart would discard a warm cache) → say
  nothing. One line, never a paragraph; if unsure, stay silent rather than cry wolf.
- **Direction-neutral.** Recommend *down* (cheaper — the common case) or *up* (a hard task on a
  weak model) with equal willingness. Frugality is the default lean, not a floor.
- **Advisory only — never a silent auto-switch.** The model cannot change its own session, and a
  silently-swapped model makes the UI's model label lie (never-wrong invariant). The human
  decides and acts when they next start a session.
- **Heuristic, not authority.** A cheap task-shape read, not a guarantee — a soft advisory
  layer. The deterministic, always-visible version is a Scrooge statusline (tracked in
  `AIClarityAU/scroogellm`); this CLAUDE.md nag does not replace it.

<a id="dr-053-transition"></a>
## DR-053 v2 transition note

> **Transition.** v2 is **accepted** but **not yet shipped** — accepted is a decision, not an
> implementation. The corpus is **not migrated yet** (record now, reformat later) and the
> `project-prefix` module still emits the **v1** dash grammar (`MS-SPEC-019` → now
> `MIN-SPEC-019` with the 3-letter code) until #679 lands the `/`-joined paragraph grammar and
> #681 migrates the corpus. Until then, write refs in whichever form is clearest and don't
> mass-rewrite.
