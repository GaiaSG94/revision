#!/usr/bin/env python3
"""Fireworks scope agent for the pr-auto-merge queue.

A PR whose body has no `## Scope`, or whose section does not cover all
modified files, is refused by `couche0`: the sweeper sees it as `BLOCKED`
and, without this script, leaves it to rot — exactly what happened to author
PRs (Gaïa, 29/10).

Here a Fireworks model reads the diff and writes one bullet
``- `path` — reason`` per file, in English. The script checks the recomposed
body with `main`'s guard itself (imported, never rewritten) before writing
it: any undeclared file and any useless declaration remain refused. This is
not a bypass of `couche0`, it is the missing declaration that gets written,
with a reason drawn from the diff.

Standard library only. Usage:

  FIREWORKS_API_KEY=... python3 scope_agent.py fix \\
      --repo GaiaSG94/revision --pr 215 --sha <head> \\
      --guard /tmp/check_couche0.py

Exit codes: 0 = body completed; 1 = failure with report;
2 = nothing to do (compliant, another check red, already tried, disabled).
"""

import argparse
import fnmatch
import importlib.util
import json
import os
import re
import subprocess
import sys
import urllib.request

MODEL_DEFAULT = "accounts/fireworks/models/minimax-m3p1-flash"
API_DEFAULT = "https://api.fireworks.ai/inference/v1/chat/completions"
MAX_FILES = 25
MAX_EXCERPT_CHARS = 600
MAX_EXCERPT_LINES = 5
MAX_TOKENS = 3_000
TEMPEREVISION = 0.1
CALL_TIMEOUT_S = 90
COMMENT_PREFIX = "_fireworks · scope agent (MiniMax M3.1 Flash)_"
MARKER = "<!-- automerge-scope sha=%s -->"
LABEL_HUMAN = "intervention-humaine"
PUCE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+`?([^`\s]+)`?"
                  r"\s*(?:[—–:-]|-\s)\s+(.+?)\s*$")


class AgentError(Exception):
    """Failure with a publishable message (no secret)."""


class Skip(Exception):
    """Nothing to do: the caller skips the PR silently (exit 2)."""


def log(message):
    print("scope-agent: %s" % message, flush=True)


def env_or(name, default):
    """Env var or default. GitHub injects an absent var as ""
    (not unset): `os.environ.get(n, d)` would return "" → 400 Fireworks."""
    return os.environ.get(name) or default


def sh(args, timeout=90):
    proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise AgentError("%s : %s" % (" ".join(args[:3]),
                                      (proc.stderr or "").strip()[:200]))
    return (proc.stdout or "").strip()


def comment(repo, pr, body):
    """Comments on the PR; best-effort, never throws."""
    try:
        subprocess.run(["gh", "pr", "comment", str(pr), "--repo", repo,
                        "--body", COMMENT_PREFIX + "\n\n" + body],
                       capture_output=True, text=True, timeout=60)
    except Exception as exc:                                   # noqa: BLE001
        log("comment impossible: %s" % exc)


def add_label(repo, pr, label):
    """Sets a label; best-effort, never throws."""
    try:
        subprocess.run(["gh", "pr", "edit", str(pr), "--repo", repo,
                        "--add-label", label],
                       capture_output=True, text=True, timeout=60)
    except Exception as exc:                                   # noqa: BLE001
        log("label %s impossible: %s" % (label, exc))


def deja_tente(repo, pr, sha):
    """Marker already set for this head? (fingerprint in comments,
    not on disk: runners change from one pass to the next)."""
    try:
        out = sh(["gh", "pr", "view", str(pr), "--repo", repo,
                  "--json", "comments", "-q", ".comments[].body"])
    except AgentError:
        return False
    return (MARKER % sha) in out


def load_guard(path):
    """Imports main's guard, never a rewritten local copy."""
    spec = importlib.util.spec_from_file_location("couche0", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def excerpt(fichier):
    """A few added lines: enough for a reason, not the whole diff."""
    lignes = []
    for ligne in (fichier.get("patch") or "").splitlines():
        if ligne.startswith("+") and not ligne.startswith("+++"):
            lignes.append(ligne[1:])
        if len(lignes) >= MAX_EXCERPT_LINES:
            break
    texte = "\n".join(lignes)[:MAX_EXCERPT_CHARS]
    return texte or "(binary, rename or emptying)"


def messages_pour(pr, fichiers, necessaires, relance=False):
    system = (
        "You write the `## Scope` section of a pull request body: it "
        "declares, file by file, what the PR changes and why. "
        "For EACH listed file, return exactly one line of the form\n"
        "- `exact/path` — reason in English, at most 12 words\n"
        "Rules: copy the path as-is, no glob or folder; a "
        "concrete reason drawn from the diff (what changes, not 'file "
        "modification'); no line for an unlisted file; no title, "
        "no surrounding sentence; only the bullets, in the given order.")
    if relance:
        system += (" Retry: you omitted some files. Give a bullet "
                   "for EACH one, full path copied character by "
                   "character, no asterisk, no shortcut, no exception.")
    blocs = ["Title: %s" % pr["title"]]
    corps = (pr.get("body") or "").strip()
    if corps:
        blocs.append("Current body (excerpt):\n" + corps[:2_500])
    par_nom = {f["filename"]: f for f in fichiers}
    for chemin in necessaires:
        blocs.append("### %s\n%s" % (chemin, excerpt(par_nom[chemin])))
    blocs.append("Return one bullet per file above, nothing else.")
    return [{"role": "system", "content": system},
            {"role": "user", "content": "\n\n".join(blocs)}]


def fw_complete(api_url, key, model, messages):
    """One Fireworks chat/completions call, returns the response text."""
    payload = json.dumps({"model": model, "messages": messages,
                          "temperevision": TEMPEREVISION,
                          "max_tokens": MAX_TOKENS}).encode("utf-8")
    req = urllib.request.Request(api_url, data=payload, method="POST")
    req.add_header("Authorization", "Bearer " + key)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=CALL_TIMEOUT_S) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:                                   # noqa: BLE001
        raise AgentError("Fireworks call: %s" % str(exc)[:200])
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise AgentError("unreadable Fireworks response (no choices[0])")


def raisons_repondue(texte):
    """Model bullets → {pattern: reason}, without empty code blocks."""
    balise = "think"                       # possible internal reasoning
    texte = re.sub(r"<%s>.*?</%s>" % (balise, balise), "", texte, flags=re.S)
    raisons = {}
    for ligne in texte.splitlines():
        match = PUCE.match(ligne)
        if not match:
            continue
        chemin = match.group(1).strip().strip("`").strip()
        raison = match.group(2).strip().strip("`").strip()
        if chemin.startswith("./"):
            chemin = chemin[2:]
        if chemin and raison:
            raisons[chemin] = raison
    return raisons


def designe(motif, chemin, garde):
    """Does this pattern designate this file? (guard rule, then flexibility)

    The model returns a glob, a folder, or copies the path with approximate
    casing (`sam3Vision` for `sam3vision`, seen on #215 on 29/10). We look
    for the exact path, the guard rule, then case-insensitive equality: the
    declared file is always written with its true path.
    """
    if motif == chemin or garde.matches(motif, chemin):
        return True
    bas = motif.lower()
    if bas == chemin.lower():
        return True
    if re.search(r"[*?\[]", bas):
        return fnmatch.fnmatch(chemin.lower(), bas.replace("**", "*"))
    return chemin.lower().startswith(bas.rstrip("/") + "/")


def rapprocher(raisons, necessaires, garde):
    """Matches the returned bullets to the files to declare.

    A correct bullet must never be counted as absent: this is what left PRs
    stuck on 'the model returned nothing' (29/10, #215).
    Returns (covered {path: reason}, missing).
    """
    couverts = {}
    for chemin in necessaires:
        for motif, raison in raisons.items():
            if designe(motif, chemin, garde):
                couverts[chemin] = raison
                break
    manquants = [chemin for chemin in necessaires if chemin not in couverts]
    return couverts, manquants


def motif_declare(ligne):
    """Pattern a guard reads as a declaration in `## Scope`.

    Same expression as `parse_scope`: a guard reads `- `Parler`` even without
    a reason, while `PUCE` (which requires one) took it for prose. Such lines
    must not survive if they serve no file: the guard would count them as an
    oversized scope (#263).
    """
    match = re.match(r"^\s*[-*]\s+`?([^`\s]+)`?", ligne)
    return match.group(1).strip().strip("`") if match else None


def recomposer(corps, fichiers, raisons, garde):
    """Recomposed body: useful bullets kept, missing ones added,
    useless ones removed. Returns (new body, additions, removals)."""
    necessaires = [f["filename"] for f in fichiers
                   if not garde.is_exempt(f["filename"])]
    lignes = corps.splitlines()
    debut = next((i for i, ligne in enumerate(lignes)
                  if ligne.strip().lower().startswith("## scope")), None)
    if debut is None:
        ajouts = ["- `%s` — %s" % (chemin, raisons[chemin])
                  for chemin in necessaires]
        nouveau = (corps.rstrip() + "\n\n## Scope\n" + "\n".join(ajouts) + "\n"
                   if corps.strip() else "## Scope\n" + "\n".join(ajouts) + "\n")
        return nouveau, ajouts, []
    fin = next((i for i in range(debut + 1, len(lignes))
                if lignes[i].strip().startswith("## ")), len(lignes))
    gardees, couverts, retires = [], set(), []
    for ligne in lignes[debut + 1:fin]:
        motif = motif_declare(ligne)
        if motif is None:
            if ligne.strip():
                gardees.append(ligne)          # author's prose: untouched
            continue
        servis = [chemin for chemin in necessaires
                  if designe(motif, chemin, garde)]
        if servis:
            gardees.append(ligne)
            couverts.update(servis)
        else:
            retires.append(motif)
    ajouts = ["- `%s` — %s" % (chemin, raisons[chemin])
              for chemin in necessaires if chemin not in couverts]
    nouveau = "\n".join(lignes[:debut + 1] + gardees + ajouts
                        + lignes[fin:]).rstrip() + "\n"
    return nouveau, ajouts, retires


def ecrire_corps(repo, pr, corps):
    chemin = "/tmp/scope-agent-corps.md"
    with open(chemin, "w", encoding="utf-8") as fh:
        fh.write(corps)
    sh(["gh", "pr", "edit", str(pr), "--repo", repo, "--body-file", chemin])


def verifier_reglages():
    """Keys and circuit breaker; raises Skip if the agent must stay silent."""
    key = env_or("FIREWORKS_API_KEY", "")
    if env_or("FIREWORKS_AGENT_SCOPE", "1") == "0":
        raise Skip("scope agent disabled (FIREWORKS_AGENT_SCOPE=0)")
    if not key:
        raise Skip("FIREWORKS_API_KEY missing: scope left to the author")
    return (key, env_or("FIREWORKS_MODEL", MODEL_DEFAULT),
            env_or("FIREWORKS_BASE_URL", API_DEFAULT))


def contexte(args, garde):
    """Body, PR files and files to declare. Raises Skip if the guard is red
    for something other than scope: we do not rewrite a body for a failure
    that rewriting would not fix."""
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    if not token:
        raise AgentError("no GitHub token in the environment")
    try:
        corps, fichiers = garde.pr_context(args.repo, args.pr, token)
    except Exception as exc:                                   # noqa: BLE001
        raise AgentError("API GitHub : %s" % str(exc)[:200])
    erreurs = []
    garde.check_scope(fichiers, corps, erreurs)
    if not erreurs:
        raise Skip("scope already compliant")
    autres = [e for e in erreurs if not e.startswith("scope")]
    if autres:
        raise Skip("couche0 red for something other than scope: %s"
                   % " ; ".join(autres)[:300])
    necessaires = [f["filename"] for f in fichiers
                   if not garde.is_exempt(f["filename"])]
    if not necessaires:
        raise Skip("no file to declare")
    if len(necessaires) > MAX_FILES:
        raise Skip("%d files (cap %d): human hand"
                   % (len(necessaires), MAX_FILES))
    return corps, fichiers, necessaires


def titre_pr(repo, pr):
    return sh(["gh", "pr", "view", str(pr), "--repo", repo,
               "--json", "title", "-q", ".title"])


def rendre_compte(args, ajouts, retires):
    """Single comment: what was written, and the per-head marker."""
    lignes = ["Scope completed from the diff: **%d file(s)** declared."
              % len(ajouts)]
    if retires:
        lignes.append("Declaration(s) with no matching file removed: %s."
                      % ", ".join("`%s`" % m for m in retires))
    lignes.append("Verified with `main`'s guard before writing: every touched "
                  "file is declared, no useless declaration. `couche0` re-judges "
                  "on this new body.")
    lignes.append(MARKER % args.sha)
    comment(args.repo, args.pr, "\n\n".join(lignes))


def cmd_fix(args):
    key, model, api_url = verifier_reglages()
    if deja_tente(args.repo, args.pr, args.sha):
        raise Skip("scope already tried for this head")
    garde = load_guard(args.guard)
    corps, fichiers, necessaires = contexte(args, garde)
    titre = titre_pr(args.repo, args.pr)
    if args.dry_run:
        messages = messages_pour({"title": titre, "body": corps},
                                 fichiers, necessaires)
        print("===== prompt =====")
        print(messages[1]["content"][:6_000])
        return 0
    log("writing scope (%d files)" % len(necessaires))
    texte = fw_complete(api_url, key, model,
                        messages_pour({"title": titre, "body": corps},
                                      fichiers, necessaires))
    couverts, manquants = rapprocher(raisons_repondue(texte), necessaires, garde)
    if manquants:
        # Targeted retry: the forgotten files only, with the diff at hand.
        # A model omission must not cost the PR.
        log("targeted retry: %d file(s) without a bullet" % len(manquants))
        texte2 = fw_complete(api_url, key, model,
                             messages_pour({"title": titre, "body": corps},
                                           fichiers, manquants, relance=True))
        trouves, manquants = rapprocher(raisons_repondue(texte2), manquants, garde)
        couverts.update(trouves)
    if manquants:
        apercu = " ".join((texte or "").split())[:200]
        log("model response: %s" % (apercu or "(empty)"))
        raise AgentError("the model returned nothing for: %s"
                         % ", ".join(manquants)[:300])
    nouveau, ajouts, retires = recomposer(corps, fichiers, couverts, garde)
    verif = []
    garde.check_scope(fichiers, nouveau, verif)
    if verif:
        raise AgentError("the guard still refuses the recomposed body: %s"
                         % " ; ".join(verif)[:300])
    ecrire_corps(args.repo, args.pr, nouveau)
    rendre_compte(args, ajouts, retires)
    log("body rewritten (%d addition(s), %d removal(s))" % (len(ajouts), len(retires)))
    return 0


def fail(repo, pr, sha, raison):
    """Failure report: once per head, never a loop."""
    comment(repo, pr, "Scope **not completed**: %s\n\n"
                      "Author must declare `## Scope`.\n\n%s"
                      % (raison, MARKER % sha))
    add_label(repo, pr, LABEL_HUMAN)
    log("failure: %s" % raison)
    return 1


def main(argv=None):
    ap = argparse.ArgumentParser(prog="scope_agent")
    ap.add_argument("cmd", choices=["fix"])
    ap.add_argument("--repo", required=True)
    ap.add_argument("--pr", required=True)
    ap.add_argument("--sha", required=True)
    ap.add_argument("--guard", required=True,
                    help="path to check_couche0.py downloaded from main")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    try:
        return cmd_fix(args)
    except Skip as exc:
        log(str(exc))
        return 2
    except AgentError as exc:
        return fail(args.repo, args.pr, args.sha, str(exc))


if __name__ == "__main__":
    sys.exit(main())