#!/usr/bin/env python3
"""Compilation gate for the conflict agent (pr-auto-merge).

A conflict resolution **must never reach the branch without compiling**.
Pattern measured on 31/10 (PR #615): the reconciliation pushed a broken head
— missing `motion` parameter, `hushed` variable out of scope, a test with
swapped arguments — the sweeper classified the failure as 'real' ('no agent
writes a code fix'), and the PR died silently until a human took over.

Here: we compile the touched modules (`:core:compileDebugKotlin`,
`:app:compileDebugKotlin`, `py_compile` for the server) BEFORE the push. Red
→ nothing is pushed, the branch stays intact, the PR stays `DIRTY` (the next
round recalls the agent, within the quota limit) and the report quotes the
compiler errors.

A gate that cannot run (no `gradlew`, no Android SDK, timeout) blocks
nothing and says so: the CI lease remains the proof.
Circuit breaker: `CONFLICT_COMPILE_GATE=0`.

Standard library only, no implicit clock, no secret.
"""

import os
import subprocess
import sys

# A `.kt` outside these trees cannot compile on its own (`settings.gradle.kts`).
MODULES_GRADLE = ("core", "app")
GATE_ENV = "CONFLICT_COMPILE_GATE"
GATE_TIMEOUT_S = 150
GATE_EXCERPT = 1_500
# Marker of the head set by the agent: the sweeper looks for it verbatim to
# attribute a failure to the resolution (label `intervention-humaine`) instead
# of letting the PR die silently.
MARK_AGENT = "<!-- agent-conflit sha=%s -->"


def _log(message):
    print("fireworks-agent: %s" % message, flush=True)


def fichiers_modifies(base="origin/main"):
    """Files the branch changes relative to `base` (best-effort)."""
    try:
        proc = subprocess.run(["git", "diff", "--name-only", "%s...HEAD" % base],
                              capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        _log("unreadable diff, nothing to compile: %s" % exc)
        return []
    if proc.returncode != 0:
        _log("unreadable diff (%s), nothing to compile" % base)
        return []
    return [line for line in (proc.stdout or "").splitlines() if line.strip()]


def taches_compilation(fichiers):
    """(Gradle tasks, Python files) to check for these paths.

    A `.kt` under `core/` or `app/` requires compiling its module; a
    `.py` is checked on its own (`py_compile`). Everything else (docs, JSON,
    `.kts`, non-Gradle trees) proves nothing and is not compiled here.
    """
    gradle, python = [], []
    for path in fichiers:
        if path.endswith(".py"):
            python.append(path)
            continue
        if not path.endswith(".kt") or "/" not in path:
            continue
        module = path.split("/", 1)[0]
        tache = ":%s:compileDebugKotlin" % module
        if module in MODULES_GRADLE and tache not in gradle:
            gradle.append(tache)
    return gradle, python


def sdk_android():
    """Android SDK, or `None`: without it Gradle refuses to configure."""
    for var in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        chemin = os.environ.get(var)
        if chemin and os.path.isdir(chemin):
            return chemin
    maison = os.path.join(os.path.expanduser("~"), "Android", "Sdk")
    return maison if os.path.isdir(maison) else None


def ecrire_local_properties(sdk):
    """`local.properties` (gitignored): the sweeper's clone does not have it."""
    try:
        with open("local.properties", "w", encoding="utf-8") as fichier:
            fichier.write("sdk.dir=%s\n" % sdk)
    except OSError as exc:
        _log("local.properties not written: %s" % exc)


def extrait_compilateur(etape, texte):
    """Publishable excerpt: error lines, otherwise the end of the log."""
    lignes = [ligne.strip() for ligne in texte.splitlines() if ligne.strip()]
    fautes = [ligne for ligne in lignes
              if ligne.startswith("e: ") or "error:" in ligne
              or ligne.startswith("FAILURE:")]
    garde = fautes[:8] or lignes[-8:]
    return "`%s` :\n```\n%s\n```" % (etape, "\n".join(garde)[:GATE_EXCERPT])


def verifier_compilation(fichiers=None):
    """Compiles the touched modules before the push. Returns (ok, message).

    `ok` false is not a failure: it is proof that the resolution is
    broken, so the push is refused and the branch stays intact.
    """
    if os.environ.get(GATE_ENV, "1") == "0":
        return True, "compilation gate disabled (%s=0)" % GATE_ENV
    if not os.path.exists("gradlew"):
        return True, "compilation gate skipped: no `gradlew` here"
    fichiers = fichiers_modifies() if fichiers is None else fichiers
    gradle, python = taches_compilation(fichiers)
    if not gradle and not python:
        return True, "compilation gate: no touched module"
    for path in python:
        try:
            proc = subprocess.run([sys.executable, "-m", "py_compile", path],
                                  capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.SubprocessError) as exc:
            return True, "compilation gate skipped (Python): %s" % exc
        if proc.returncode != 0:
            return False, extrait_compilateur("Python %s" % path,
                                              proc.stderr or proc.stdout)
    if not gradle:
        return True, "compilation gate: Python OK"
    sdk = sdk_android()
    if sdk:
        ecrire_local_properties(sdk)
    commande = ["./gradlew", "--console=plain", "--quiet",
                "-Dorg.gradle.jvmargs=-Xmx2g", "--max-workers=2"] + gradle
    try:
        proc = subprocess.run(commande, capture_output=True, text=True,
                              timeout=GATE_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return True, ("compilation gate inconclusive: %d s exceeded "
                      "(%s)" % (GATE_TIMEOUT_S, " ".join(gradle)))
    except (OSError, subprocess.SubprocessError) as exc:
        return True, "compilation gate skipped: %s" % exc
    if proc.returncode == 0:
        return True, "compilation gate: %s OK" % " ".join(gradle)
    return False, extrait_compilateur(" ".join(gradle),
                                      (proc.stdout or "") + "\n"
                                      + (proc.stderr or ""))


def tete_git():
    """SHA of the head (the push does not change it: exact marker)."""
    try:
        proc = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True,
                              text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return ""
    return (proc.stdout or "").strip() if proc.returncode == 0 else ""


def prepare_push(files, branch, fichiers=None):
    """(ok, message, body): decides the push and prepares its report.

    The body carries the head marker on the first line; the caller only posts
    it after a successful push.
    """
    ok, message = verifier_compilation(fichiers)
    if not ok:
        return False, message, ""
    unique = sorted(set(files))
    corps = ("%s\n\nConflict reconciled by the agent: %d file(s) (%s), "
             "rebase pushed to `%s` (%s). The queue resumes."
             % (MARK_AGENT % tete_git(), len(unique), ", ".join(unique),
                branch, message))
    return True, message, corps
