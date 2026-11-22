#!/usr/bin/env python3
"""Model invocation quota: fingerprints, cooldown, caps.

Runners change from one pass to the next: fingerprints live in
`~/.cache/fireworks-agent`, never in the clone. Two caps: global
(`SPAWN_CAP` per hour) and per PR (`SAISINES_PR_MAX` in 30 min). The second
was born on 29/10: #215, rebased in a loop, consumed the whole hourly quota
and the agent went silent for other PRs.

Standard library only. Imported by `conflict_agent.py`, which loads it
from `origin/main` (see `_charger`): the module may be missing on an older
deployment, in which case the caller handles the absence.
"""

import os
import time

COOLDOWN_S = 20 * 60
SPAWN_WINDOW_S = 3_600
SPAWN_CAP = 10
SAISINES_PR_MAX = 3
SAISINES_PR_FENETRE_S = 30 * 60


class Saisine(Exception):
    """Nothing to do: the caller skips the PR silently (exit 2)."""


def cache_dir():
    chemin = os.path.join(os.path.expanduser("~"), ".cache", "fireworks-agent")
    os.makedirs(chemin, exist_ok=True)
    return chemin


def stamp_path(pr, sha):
    return os.path.join(cache_dir(), "pr-%s-%s.stamp" % (pr, sha[:12]))


def gc_stamps(now):
    """Purges fingerprints older than one day."""
    jour_avant = now - 86_400
    for name in os.listdir(cache_dir()):
        if not name.endswith(".stamp"):
            continue
        full = os.path.join(cache_dir(), name)
        try:
            if os.path.getmtime(full) < jour_avant:
                os.unlink(full)
        except OSError:
            continue


def _recentes(prefixe, cutoff):
    """Fingerprints whose prefix starts with `prefixe` and that are recent."""
    total = 0
    for name in os.listdir(cache_dir()):
        if not name.startswith(prefixe) or not name.endswith(".stamp"):
            continue
        try:
            if os.path.getmtime(os.path.join(cache_dir(), name)) >= cutoff:
                total += 1
        except OSError:
            continue
    return total


def recent_runs(now):
    """Number of invocations in the sliding window."""
    return _recentes("pr-", now - SPAWN_WINDOW_S)


def saisines_pr(pr, now):
    """Recent invocations for THIS PR, across all heads (window)."""
    return _recentes("pr-%s-" % pr, now - SAISINES_PR_FENETRE_S)


def has_fresh_stamp(pr, sha, now):
    try:
        return os.path.getmtime(stamp_path(pr, sha)) >= now - COOLDOWN_S
    except OSError:
        return False


def touch_stamp(pr, sha):
    with open(stamp_path(pr, sha), "w") as fh:
        fh.write(str(int(time.time())))


def autoriser(pr, sha):
    """Raises Saisine if the model must not be called now.

    Separate from conflict reading so that the deterministic union of logs
    (free) is never blocked by a call cap.
    """
    maintenant = time.time()
    if has_fresh_stamp(pr, sha, maintenant):
        raise Saisine("recent invocation for %s, cooldown" % sha[:12])
    if recent_runs(maintenant) >= SPAWN_CAP:
        raise Saisine("cap of %d invocations/h reached" % SPAWN_CAP)
    if saisines_pr(pr, maintenant) >= SAISINES_PR_MAX:
        raise Saisine("%d invocations in %d min for this PR: fundamental disagreement, "
                      "human hand"
                      % (SAISINES_PR_MAX, SAISINES_PR_FENETRE_S // 60))
    touch_stamp(pr, sha)
