#!/usr/bin/env python3
"""CI failure repair agent (zeroclaw `fw`) for pr-auto-merge.

When a PR is `BLOCKED` on a **real** failure (a red test, a red guard — not
an infra outage), the sweeper calls this driver in its clone:

1. it reads the failed-run logs of the head (check-runs over REST);
2. it launches the **zeroclaw `fw`** agent (`zeroclaw agent --agent fw -m`) on
   the clone, with a prompt carrying the real errors;
3. the agent modifies files, **it does not commit or push**: the driver keeps
   control. It refuses any change in `.github/`, in `.mergify.yml`, beyond
   20 files or 1,500 lines;
4. it compiles the touched modules (`compilation_gate.py`) — a fix that does
   not compile is never pushed;
5. it commits with the owner's identity and pushes with a lease.

One attempt per head (`<!-- test-agent sha=<head> -->`): an agent does not
loop. Circuit breaker: repository variable `TEST_AGENT=0`.

The agent runs in an isolated `--config-dir` (copy of `config.toml` and
`.secret_key`): the runner's ZeroClaw daemon holds its own state lock, a
concurrent agent would refuse to start. On a runner without `zeroclaw`, the
driver says so and returns 2 (nothing to do) — the PR stays visible with its
report.

Standard library only. Usage:

  python3 test_agent.py fix --repo O/R --pr 12 --branch feat/x --sha <sha>

Codes: 0 = fix pushed; 1 = failure (report on the PR); 2 = nothing
to do (disabled, already tried, no change proposed); 3 = tooling
missing on the runner (`zeroclaw` or its config) — **no attempt consumed**,
the sweeper will retry on the next pass.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
import types

BUDGET_S = 150            # time allowed to the agent, in a 5 min job
MAX_FICHIERS = 20
MAX_LIGNES = 1_500
MAX_JOURNAL_LIGNES = 120
REFUSES = (".github/", ".mergify.yml")
# Tool outputs (Gradle in particular): they appear in the clone when the
# agent ran a compilation, and have no place in the fix
# (seen: `.kotlin/` committed on test PR #652).
JAMAIS_COMMITES = (".kotlin/", "build/", ".gradle/", ".idea/", ".git/")
# Same exclusions on the git side (pathspec): the commit only takes code.
EXCLUSIONS_GIT = ("--", ":(exclude).kotlin/**", ":(exclude)**/build/**",
                  ":(exclude).gradle/**", ":(exclude).idea/**")
MARK = "<!-- test-agent sha=%s -->"
# Prefix for infrastructure outputs: an unprovisioned runner is not an
# agent failure, so we set **no marker** and the head's attempt stays open.
# Seen on 31/10 on #652: `zeroclaw not found` burned the only attempt two
# minutes before the binary was installed on r630.
INFRA = "OUTILLAGE: "
LABEL_OK = "agent-test"
LABEL_HUMAN = "intervention-humaine"
PREFIXE = "_fireworks · agent de test (zeroclaw `fw`)_"
MOTIFS_JOURNAL = ("FAILED", "AssertionError", "Expected", "expected:",
                  "e: file", "error:", "Error:", "Caused by", "Caused by:",
                  "Tests failed", "> Task", "Traceback", "File \"",
                  "ERROR:", "FAIL:")


def _charger(nom):
    """Neighbouring module: direct import, otherwise `origin/main` (earlier branch)."""
    try:
        return __import__(nom)
    except ImportError:
        pass
    try:
        proc = subprocess.run(["git", "show", "origin/main:.github/fireworks/"
                               "%s.py" % nom], capture_output=True, text=True,
                              timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    module = types.ModuleType(nom)
    exec(compile(proc.stdout, "%s.py" % nom, "exec"), module.__dict__)
    return module


compilation_gate = _charger("compilation_gate")


def log(message):
    print("fw-test-agent: %s" % message, flush=True)


def sh(args, **kw):
    """Runs a command, returns its stripped output; raises otherwise."""
    proc = subprocess.run(args, capture_output=True, text=True, **kw)
    if proc.returncode != 0:
        raise RuntimeError("%s : %s" % (" ".join(args[:3]),
                                        (proc.stderr or "").strip()[:200]))
    return (proc.stdout or "").strip()


def jeton_ecriture():
    """Write token: the PAT when present (owner identity)."""
    return os.environ.get("GH_ECRITURE") or os.environ.get("GH_TOKEN") or ""


def _gh(args, jeton=None, saisie=None):
    env = dict(os.environ)
    if jeton:
        env["GH_TOKEN"] = jeton
    return subprocess.run(["gh"] + args, capture_output=True, text=True,
                          env=env, timeout=saisie or 120)


def comment(repo, pr, body):
    """Comments on the PR; best-effort, never throws."""
    try:
        proc = _gh(["pr", "comment", str(pr), "--repo", repo, "--body",
                    PREFIXE + "\n\n" + body], jeton=jeton_ecriture())
        if proc.returncode != 0:
            log("comment refused: %s" % (proc.stderr or "").strip()[:150])
    except Exception as exc:                                   # noqa: BLE001
        log("comment impossible: %s" % exc)


def add_label(repo, pr, label):
    try:
        _gh(["pr", "edit", str(pr), "--repo", repo, "--add-label", label],
            jeton=jeton_ecriture())
    except Exception as exc:                                   # noqa: BLE001
        log("label %s impossible: %s" % (label, exc))


def labels(repo, pr):
    proc = _gh(["pr", "view", str(pr), "--repo", repo, "--json", "labels",
                "-q", ".labels[].name"], jeton=os.environ.get("GH_TOKEN"))
    if proc.returncode != 0:
        return []
    return [ligne for ligne in (proc.stdout or "").splitlines() if ligne]


def marque_presente(repo, pr, marque):
    """True if a PR comment already carries this marker."""
    proc = _gh(["api", "repos/%s/issues/%s/comments?per_page=100" % (repo, pr),
                "--jq", ".[].body"], jeton=os.environ.get("GH_TOKEN"))
    return proc.returncode == 0 and marque in (proc.stdout or "")


def runs_en_echec(repo, sha):
    """Ids of the head’s failed runs (required checks and halves)."""
    proc = _gh(["api", "repos/%s/commits/%s/check-runs?per_page=100"
                % (repo, sha), "--jq",
                '[.check_runs[] | select(.conclusion == "failure") | .html_url]'
                ' | .[]'], jeton=os.environ.get("GH_TOKEN"))
    ids = []
    for ligne in (proc.stdout or "").splitlines():
        morceau = ligne.strip().split("/runs/")[-1].split("/")[0]  # .../runs/<run>/job/<job>
        if morceau.isdigit() and morceau not in ids:
            ids.append(morceau)
    return ids


def extrait_journal(runs, limite=MAX_JOURNAL_LIGNES):
    """Useful lines from failure logs (best-effort, never fails)."""
    garde = []
    for run in runs[:3]:
        proc = _gh(["run", "view", str(run), "--log-failed"],
                   jeton=os.environ.get("GH_TOKEN"))
        for ligne in (proc.stdout or "").splitlines():
            texte = ligne.split("\t")[-1].rstrip()
            if any(motif in texte for motif in MOTIFS_JOURNAL):
                garde.append(texte)
    # Lines closest to the end carry the verdict: we keep the tail.
    return "\n".join(garde[-limite:])


def prompt_fix(repo, pr, dossier, extrait, etapes="", indice=""):
    """Repair prompt: the repository, the errors, the rules, the verdict.

    [indice] = verdict of `tools/triage_test.py` (workflow `triage-rouge`):
    without it, the agent searches blindly and returns 'budget exceeded' (#919).
    """
    if indice.strip():
        etapes = etapes or "after triage"
    return "\n".join([
        "You are the CI repair agent for %s (Android "
        "Kotlin/KMP app, code and comments in English)." % repo,
        "The git clone is %s, on the branch of PR #%s." % (dossier, pr),
        "CI fails there%s." % (" on: %s" % etapes if etapes else ""),
        "",
        "Excerpt from the failure log:",
        "```",
        extrait or "(log unavailable)",
        "```",
    ] + (["", "Automatic triage (already done, do not redo it):", "",
          indice.strip()] if indice.strip() else []) + [
        "",
        "Mission: fix the CAUSE, with the smallest possible diff.",
        "Strict rules:",
        "- never touch .github/, .mergify.yml, or a guard file;",
        "- do not commit, do not push, do not change branches;",
        "- at most %d files and %d lines changed;" % (MAX_FICHIERS,
                                                            MAX_LIGNES),
        "- keep the repository style (comments in English, useful sentences);",
        "- if a clean fix falls outside the scope (product, contract), change "
        "nothing and answer ABANDON.",
        "- you may check locally (`python3 -m unittest tools/test_X.py` "
        "or `./gradlew :core:testDebugUnitTest --tests \"*Name*\"`), but "
        "time is limited: CI will re-judge.",
        "",
        "Finish with a single line: `FIXED <files>` or "
        "`ABANDON <reason>`.",
    ])


def config_isolee(source=None):
    """Isolated `--config-dir`: copy of config.toml + .secret_key, mode 700.

    The runner's ZeroClaw daemon holds its state lock; a concurrent
    `zeroclaw agent` would refuse to start. Local copy, deleted afterwards.
    """
    source = source or os.path.expanduser("~/.zeroclaw")
    conf = os.path.join(source, "config.toml")
    cle = os.path.join(source, ".secret_key")
    if not (os.path.isfile(conf) and os.path.isfile(cle)):
        return None
    dossier = tempfile.mkdtemp(prefix="zc-agent-")
    os.chmod(dossier, 0o700)
    try:
        # `data/` must exist with mode 700 BEFORE launch: ZeroClaw creates it at the
        # process umask (002 on runners) and refuses a shared state.
        os.makedirs(os.path.join(dossier, "data"), mode=0o700, exist_ok=True)
        os.chmod(os.path.join(dossier, "data"), 0o700)
        shutil.copyfile(conf, os.path.join(dossier, "config.toml"))
        shutil.copyfile(cle, os.path.join(dossier, ".secret_key"))
        os.chmod(os.path.join(dossier, "config.toml"), 0o600)
        os.chmod(os.path.join(dossier, ".secret_key"), 0o600)
    except OSError as exc:
        log("isolated config impossible: %s" % exc)
        shutil.rmtree(dossier, ignore_errors=True)
        return None
    return dossier


def binaire_zeroclaw():
    """Path to `zeroclaw`: PATH, then known runner locations."""
    candidats = [shutil.which("zeroclaw")] + [
        os.path.join(maison, ".cargo", "bin", "zeroclaw")
        for maison in (os.path.expanduser("~"), "/home/gaia")]
    candidats.append("/usr/local/bin/zeroclaw")
    for chemin in candidats:
        if chemin and os.path.isfile(chemin) and os.access(chemin, os.X_OK):
            return chemin
    return None


def _umask_prive():
    """Umask 077 in the child process (unshared ZeroClaw state)."""
    os.umask(0o077)


def lancer_agent(prompt, dossier, budget=BUDGET_S):
    """Launches `zeroclaw agent --agent fw -m <prompt>`. Returns (ok, output)."""
    binaire = binaire_zeroclaw()
    if binaire is None:
        return False, INFRA + ("zeroclaw introuvable sur ce runner (PATH, "
                               "~/.cargo/bin, /home/gaia/.cargo/bin, "
                               "/usr/local/bin)")
    conf = config_isolee()
    if conf is None:
        return False, INFRA + "ZeroClaw config missing (config.toml + .secret_key)"
    try:
        proc = subprocess.run([binaire, "--config-dir", conf, "agent",
                               "--agent", "fw", "-m", prompt],
                              capture_output=True, text=True, timeout=budget,
                              cwd=dossier, preexec_fn=_umask_prive)
    except subprocess.TimeoutExpired:
        return False, "budget of %d s exceeded" % budget
    except (OSError, subprocess.SubprocessError) as exc:
        return False, "launch impossible: %s" % exc
    finally:
        shutil.rmtree(conf, ignore_errors=True)
    sortie = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
    return proc.returncode == 0, sortie[-2_000:]


def sortie_outil(chemin):
    """True for a tool output directory (Gradle, IDE)."""
    return chemin.startswith(JAMAIS_COMMITES) or "/build/" in chemin


def changements():
    """Files modified or added in the clone (excluding ignored tracked files)."""
    proc = subprocess.run(["git", "status", "--porcelain"], capture_output=True,
                          text=True, timeout=120)
    if proc.returncode != 0:
        return []
    fichiers = []
    for ligne in (proc.stdout or "").splitlines():
        chemin = ligne[3:].strip()
        if " -> " in chemin:
            chemin = chemin.split(" -> ", 1)[1]
        chemin = chemin.strip('"')
        if chemin and not sortie_outil(chemin):
            fichiers.append(chemin)
    return fichiers


def diff_lines():
    """Added + removed lines of the working diff (0 if unreadable)."""
    proc = subprocess.run(["git", "diff", "--numstat", "HEAD"],
                          capture_output=True, text=True, timeout=120)
    total = 0
    for ligne in (proc.stdout or "").splitlines():
        morceaux = ligne.split("\t")
        if len(morceaux) >= 2 and morceaux[0].isdigit():
            total += int(morceaux[0]) + int(morceaux[1])
    return total


def est_un_test(chemin):
    """True for a test file (Kotlin, JVM)."""
    return "/src/test/" in chemin or chemin.endswith("Test.kt")


def verifier_diff(fichiers):
    """(ok, reason): refusal of guards, volume and weakened test."""
    refuses = [f for f in fichiers if f.startswith(REFUSES)]
    if refuses:
        return False, "touches a guard file (%s)" % ", ".join(refuses[:3])
    # An agent that 'fixes' by rewriting the test proves nothing: the fix must
    # include at least one production file.
    if fichiers and all(est_un_test(f) for f in fichiers):
        return False, ("only touches tests — a rewritten test proves "
                       "nothing, fix refused")
    if len(fichiers) > MAX_FICHIERS:
        return False, "%d files (cap %d)" % (len(fichiers), MAX_FICHIERS)
    lignes = diff_lines()
    if lignes > MAX_LIGNES:
        return False, "%d lines changed (cap %d)" % (lignes, MAX_LIGNES)
    return True, ""


def commiter(pr):
    """Owner-identity commit (repository rule), tool outputs excluded."""
    subprocess.run(["git", "add", "-A"] + list(EXCLUSIONS_GIT),
                   capture_output=True, text=True, timeout=120)
    proc = subprocess.run(
        ["git", "-c", "user.name=GaiaSG94",
         "-c", "user.email=290536685+GaiaSG94@users.noreply.github.com",
         "commit", "-q", "-m",
         "fix(isee): CI fix proposed by the fw agent (PR #%s)" % pr],
        capture_output=True, text=True, timeout=120)
    return proc.returncode == 0, (proc.stderr or "").strip()[:200]


def pousser(repo, branch, sha):
    """Push with lease: never overwrite a push that arrived in the meantime."""
    url = ("https://x-access-token:%s@github.com/%s.git"
           % (jeton_ecriture(), repo)) if jeton_ecriture() else "origin"
    proc = subprocess.run(["git", "push", "--force-with-lease=%s:%s"
                           % (branch, sha), url, "HEAD:%s" % branch],
                          capture_output=True, text=True, timeout=180)
    return proc.returncode == 0, (proc.stderr or "").strip()[:200]


def preparer_clone(repo, pr):
    """Fetches the PR head and checks it out. Returns (ok, message)."""
    url = ("https://x-access-token:%s@github.com/%s.git"
           % (jeton_ecriture(), repo)) if jeton_ecriture() else "origin"
    try:
        sh(["git", "fetch", "-q", url, "pull/%s/head:pr-%s" % (pr, pr)],
           timeout=300)
        sh(["git", "checkout", "-q", "pr-%s" % pr], timeout=120)
    except (RuntimeError, subprocess.SubprocessError) as exc:
        return False, str(exc)
    return True, ""


def preflight(repo, pr, sha):
    """(failed runs, log excerpt), or None if nothing to do."""
    if os.environ.get("TEST_AGENT", "1") == "0":
        log("disabled (TEST_AGENT=0)")
        return None
    presents = set(labels(repo, pr))
    evites = presents & {"hold", LABEL_HUMAN}
    if evites:
        log("labels %s: human hand" % ",".join(sorted(evites)))
        return None
    if marque_presente(repo, pr, MARK % sha):
        log("already tried for this head")
        return None
    runs = runs_en_echec(repo, sha)
    if not runs:
        log("no failed run on %s" % sha[:7])
        return None
    return runs, extrait_journal(runs)


def lancer_sur_clone(repo, pr, extrait, indice=""):
    """Has the fw agent work in the clone (returns files, output)."""
    prompt = prompt_fix(repo, pr, os.getcwd(), extrait, indice=indice)
    log("fw agent launched (%d log lines)" % extrait.count("\n"))
    debut = time.time()
    ok, sortie = lancer_agent(prompt, os.getcwd())
    log("agent returned in %d s (ok=%s)" % (time.time() - debut, ok))
    if not ok and sortie.startswith(INFRA):
        # Unprovisioned runner: nothing was attempted, nothing must be marked.
        return None, sortie[len(INFRA):]
    return changements(), sortie


def refuser(repo, pr, marque, detail, raison):
    """Justified refusal: nothing is pushed, the human hand is named."""
    comment(repo, pr, "%s\n\nFix **refused**: %s.\n\n%s"
            % (marque, raison, detail))
    add_label(repo, pr, LABEL_HUMAN)
    return 1


def livrer(repo, pr, args, fichiers, sortie):
    """Safeguards, compilation, commit, push. Returns 0 or 1."""
    marque = MARK % args.sha
    if not fichiers:
        comment(repo, pr, "%s\n\nThe agent **proposed no change**"
                " (%s). The human hand is still needed.\n\n```\n%s\n```"
                % (marque, "agent failure" if not sortie else "ABANDON",
                   (sortie or "")[-800:]))
        add_label(repo, pr, LABEL_HUMAN)
        return 2
    valide, raison = verifier_diff(fichiers)
    if not valide:
        return refuser(repo, pr, marque, "The branch stays intact.", raison)
    if compilation_gate is not None:
        # The gate judges the files the agent REALLY touched, not the
        # PR/main diff (a test never modified by the PR is invisible there).
        ok, detail = compilation_gate.verifier_compilation(fichiers)
        if not ok:
            return refuser(repo, pr, marque, detail, "it does not compile")
    commit_ok, erreur = commiter(pr)
    if not commit_ok:
        return refuser(repo, pr, marque, erreur, "commit impossible")
    pousse, erreur = pousser(repo, args.branch, args.sha)
    if not pousse:
        return refuser(repo, pr, marque, erreur, "push refused (lease)")
    liste = ", ".join("`%s`" % f for f in sorted(fichiers)[:10])
    comment(repo, pr, "%s\n\nFix proposed and pushed to `%s`: %s.\n\n"
            "Compilation checked before push; CI re-judges behaviour."
            % (marque, args.branch, liste))
    add_label(repo, pr, LABEL_OK)
    log("fix pushed (%d files)" % len(fichiers))
    return 0


def cmd_fix(args):
    """Driver: preflight, agent in the clone, then guarded delivery."""
    pre = preflight(args.repo, args.pr, args.sha)
    if pre is None:
        return 2
    runs, extrait = pre
    ok, message = preparer_clone(args.repo, args.pr)
    if not ok:
        comment(args.repo, args.pr, "PR clone impossible: %s." % message)
        return 1
    indice = ""  # triage: never raises, it only helps
    if isinstance(args.indice, str) and args.indice:
        try:
            with open(args.indice, encoding="utf-8", errors="replace") as f:
                indice = f.read()[:4000]
        except OSError:  # index gone: the agent works without it, as before
            pass
    fichiers, sortie = lancer_sur_clone(args.repo, args.pr, extrait, indice)
    if fichiers is None:
        # Tooling absent: no marker, no comment (the sweeper says so in its log),
        # the head's only attempt stays open.
        log("tooling absent, nothing attempted: %s" % sortie)
        return 3
    return livrer(args.repo, args.pr, args, fichiers, sortie)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="test_agent")
    ap.add_argument("cmd", choices=["fix"])
    ap.add_argument("--repo", required=True)
    ap.add_argument("--pr", required=True)
    ap.add_argument("--branch", required=True)
    ap.add_argument("--sha", required=True)
    ap.add_argument("--indice", default="", help="triage (tools/triage_test.py)")
    args = ap.parse_args(argv)
    return cmd_fix(args)


if __name__ == "__main__":
    sys.exit(main())
