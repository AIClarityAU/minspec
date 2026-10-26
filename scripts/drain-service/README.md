# drain-service - a durable owner for the inbox drain (#3011)

`minspec-drain.service` is a host user unit with `Restart=always`. It keeps
`drain-service.sh` running **inside the claude-agent container** (through `docker exec`),
and `drain-service.sh` keeps `scripts/drain-inbox.sh` running. No keeper session is
needed any more.

The drain never runs on the host: on the host the founder's git credentials are ambient,
so a drain there would push as the founder. `drain-service.sh` refuses (exit 78) unless
pid 1 is `docker-init`, and the unit does not restart after that refusal.

## Install (on the host, once)

```bash
bash ~/code/MinSpecPro/scripts/drain-service/install.sh
```

It copies the unit to `~/.config/systemd/user/`, enables it and starts it. Installing
the unit is the opt-in: the service starts the drain with `--continuous`, whatever
`.minspec/auto-drain` says. If a drain is already running (a keeper's, or the
session-start hook's), the service adopts it, waits for it to end, then starts its own.

## Concurrency

The drain the service starts runs 8 agents in parallel per cycle, the value the keeper
sessions used. Override it with `MINSPEC_DRAIN_CONCURRENCY` in the service's environment;
`drain-inbox.sh` clamps a bad value. `drain-inbox.sh` on its own (the session-start drain)
still defaults to 1. The quota cap still throttles the drain whatever the concurrency.

## Pause and resume

The pause marker is a file in the primary checkout, so it outlives restarts of the unit
and of the container. A running drain finishes the cycle in flight, then idles. While
the marker is there, a restarted service starts no drain at all.

Either side works, because the container mounts `~/code` at the same path:

```bash
touch ~/code/MinSpecPro/.minspec/drain-pause
```

```bash
rm -f ~/code/MinSpecPro/.minspec/drain-pause
```

Inside the container, `scripts/drain-inbox.sh --pause` and `--resume` do the same.

## Status and logs

```bash
systemctl --user status minspec-drain
```

```bash
journalctl --user -u minspec-drain -n 50
```

When a drain ends, the service prints the drain's last log lines to the journal and
exits 0 for a normal end (the 8 h lifetime cap) or 1 for a failure (consecutive cycle
errors, a failed launch, or a drain that vanished without its exit line). More than 6
starts in an hour leaves the unit `failed`. The drain's full log is
`/tmp/minspec-drain-inbox.log` inside the container.

## Stop and remove

```bash
systemctl --user stop minspec-drain
```

Stop sends SIGTERM to the supervisor and, through it, to the drain. A cycle's foreground
step can delay the drain's handler until that step returns; the journal says so if it
does. systemd does not restart a unit that was stopped on purpose.

```bash
bash ~/code/MinSpecPro/scripts/drain-service/install.sh --uninstall
```
