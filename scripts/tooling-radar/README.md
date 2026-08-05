# Weekly tooling radar

Scans for new external tooling relevant to this workspace — token savings, code-quality
gates, agent infrastructure, competitive threats — and files the actionable findings as
bot-attributed GitHub issues.

Runs Mondays at 07:13 local via a systemd user timer.

## Why two stages

| Stage | What it is | Tools | Holds credentials |
|---|---|---|---|
| 1. scan | `claude -p` reading the open web | `WebSearch`, `WebFetch` only | no |
| 2. file | `file-findings.mjs`, no model at all | `gh` via argv array | yes |

Web pages are untrusted input. The global rule (DR-345) is that a model reading untrusted
documents gets no filesystem or shell tools — in `-p` mode `Read` resolves absolute paths
outside cwd, so "cwd is the sandbox" is false and prompt hygiene is not a control.

The split means a hostile page can shape the **text** of an issue, because text is what
stage 1 produces. It cannot reach a shell, choose a repository, or promote a watch item
into a filed one. Every dangerous decision lives in stage 2, in a fixed table:

- repo comes from a closed category enum (`minspec` / `scrooge` / `sealbox`), never from
  model output;
- `gh` is invoked with an argv array, never a shell string;
- the body arrives on stdin, not on the command line;
- labels are constants; every field is clamped and stripped of control characters.

`packages/minspec/tests/tooling-radar.test.ts` pins all of that. Widening the scan stage's
tool allowlist fails a test on purpose — that is a security decision, not a config tweak.

## Commands

```bash
scripts/tooling-radar/install.sh              # install + start the weekly timer
scripts/tooling-radar/install.sh --status     # timer state + last-run health
scripts/tooling-radar/install.sh --uninstall  # remove the units
scripts/tooling-radar/run-radar.sh --dry-run  # scan, print, file nothing
scripts/tooling-radar/run-radar.sh --status   # health only; non-zero if failed or stale
systemctl --user start minspec-tooling-radar.service   # run now
journalctl --user -u minspec-tooling-radar.service -n 50
```

## Monitoring

The radar is itself an installed tool, so it obeys the rule it enforces on others:
configured, triggered, **monitored**.

Every run writes `.radar/health.json` (gitignored). If the run dies before it can write
one, the `OnFailure=` watchdog unit writes it instead. `run-radar.sh --status` exits
non-zero when the last run failed, or when the last success is older than
`RADAR_STALE_DAYS` (default 10 — one missed Monday plus slack).

That staleness check is the entire point. A radar that silently stopped running produces
an empty inbox, and so does a genuinely quiet week; without a timestamped health record
those two are indistinguishable, and the dead one wins by default. Same failure shape the
constitution's no-silent-gate invariant exists to prevent.

## Output

| Path | What |
|---|---|
| `.radar/briefing-YYYY-MM-DD.md` | human-readable briefing, including watch items |
| `.radar/findings-YYYY-MM-DD.json` | validated scan output |
| `.radar/raw-YYYY-MM-DD.json` | raw CLI transcript, kept for diagnosis |
| `.radar/health.json` | last-run status, read by `--status` |

Filed issues land on `AIClarityAU/minspec`, `AIClarityAU/scroogellm`, or
`AIClarityAU/sealbox` with `idea,inbox`, authored by `minspec-sdd[bot]`, and each one
carries an adoption checklist: an install that was never configured, triggered, or
monitored is dead weight that still looks like coverage, so those issues do not close on
"installed".

## Tuning

| Env | Default | Effect |
|---|---|---|
| `RADAR_MAX_ISSUES` | 3 | cap per run; overflow is reported, never dropped silently |
| `RADAR_MODEL` | `sonnet` | scan model — synthesis, not architecture, 52 runs a year |
| `RADAR_STALE_DAYS` | 10 | how old a successful run may be before `--status` fails |
