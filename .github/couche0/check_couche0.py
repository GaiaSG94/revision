#!/usr/bin/env python3
"""Layer 0 anti-regression — declared scope + forbidden patterns.

Only two checks, standard library only.

  scope      every modified file must be declared in the PR body's `## Scope`
             section — and every declaration must be used.
  forbidden  patterns refused in ADDED diff lines, whatever the declared
             scope; guard files are frozen.

Usage: check_couche0.py check --pr N [--repo owner/name] [--control scope|forbidden]
Exit codes: 0 = OK, 1 = failed check(s), 2 = internal error.
"""

import argparse
import fnmatch
import json
import os
import re
import sys
import urllib.request

API = os.environ.get("GITHUB_API_URL", "https://api.github.com")
MAX_PAGES = 20
MAX_ERREURS_AFFICHEES = 12

# Guard files: modifying them requires an explicit mention in the body.
GUARD_FILES = (".github/ci-budget/", ".github/couche0/",
               ".github/workflows/couche0.yml",
               # Closed on 26/10: without it a PR could remove the tests from the `ci`
               # job without declaring it — the door left open behind the guard.
               # Same pattern on 29/10 for non-PR native and the merge queue:
               # emptying `lint`/`apk-release` or auto-merge would go unnoticed.
               # (`ci-budget.yml` removed on 31/10: the guard has been a job of
               # `ci.yml` since 29/10, the file no longer exists.)
               ".github/workflows/ci.yml", ".github/workflows/ci-native.yml",
               ".github/workflows/pr-auto-merge.yml")
GUARD_FLAG = "SAMVISION_ALLOW_GUARD_BUMP"

# Exempt from scope declaration: regenerable or unsigned.
EXEMPT_SUBSTR = ("/build/", "gradle/wrapper/", ".gradle/")
EXEMPT_SUFFIX = (".lock", ".png", ".webp", ".jpg", ".xml.bak")

# Third element: substring that exempts the line (documented false positive).
FORBIDDEN_PATTERNS = [
    (r"-X\s+(ours|theirs)\b", "forced side choice (-X ours/theirs)", None),
    (r"--force(?!-with-lease)\b", "forced push without --force-with-lease",
     "modal secret create"),  # false positive: idempotent overwrite of the Modal secret
    (r"pull_request_target", "privileged trigger pull_request_target", None),
    (r"sk-[A-Za-z0-9_\-]{24,}", "plaintext sk-… API key", None),
    (r"sk_[a-f0-9]{32}", "plaintext sk_… API key", None),
    (r"ghp_[A-Za-z0-9]{36}", "plaintext ghp_… GitHub token", None),
    (r"^sdk\.dir=", "hardcoded sdk.dir (local.properties must not be versioned)", None),
    (r"2026-10-2[0-5]\b|\b2[0-5]/10\b",
     "date earlier than 26/10 7 p.m. (cite 'earlier reading, outside this tree')", None),
]


def api_get(path, token):
    """GET on the GitHub API, returns decoded JSON."""
    req = urllib.request.Request(API + path)
    req.add_header("Authorization", "bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "couche0")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def pr_context(repo, number, token):
    """Fetches (PR body, list of modified files)."""
    pr = api_get("/repos/%s/pulls/%s" % (repo, number), token)
    files, page = [], 1
    while page <= MAX_PAGES:
        chunk = api_get("/repos/%s/pulls/%s/files?per_page=100&page=%d"
                        % (repo, number, page), token)
        files.extend(chunk)
        if len(chunk) < 100:
            break
        page += 1
    return (pr.get("body") or ""), files


def parse_scope(body):
    r"""Patterns declared in `## Scope` (bullets `- \`pattern\` — reason`)."""
    patterns, inside = [], False
    for line in body.splitlines():
        if line.strip().lower().startswith("## scope"):
            inside = True
            continue
        if inside and line.strip().startswith("## "):
            break
        if not inside:
            continue
        match = re.match(r"^\s*[-*]\s+`?([^`\s]+)`?", line)
        if match:
            patterns.append(match.group(1).strip().strip("`"))
    return patterns


def matches(pattern, path):
    """A pattern designates a file: exact, folder (prefix), or glob."""
    if pattern == path:
        return True
    if pattern.endswith("/"):
        return path.startswith(pattern) or ("/" + pattern) in ("/" + path)
    if not re.search(r"[*?\[]", pattern):
        return path.startswith(pattern + "/")
    return fnmatch.fnmatch(path, pattern.replace("**", "*"))


def is_exempt(path):
    """Regenerable files: no need to declare them."""
    return any(s in path for s in EXEMPT_SUBSTR) or path.endswith(EXEMPT_SUFFIX)


def suggerer_scope(files):
    """Patterns ready to paste into `## Scope`, grouped when the glob is obvious.

    A refusal with nothing to copy costs minutes (human or Fireworks agent
    round trip, then a new run): here the guard does not loosen, it makes the
    declaration possible with a copy-paste. Three or more files from the same
    folder with the same extension become `folder/*.ext` — `matches()` already
    knows how to read that.
    """
    groupes, ordre = {}, []
    for f in files:
        path = f["filename"]
        if is_exempt(path):
            continue
        dossier, _, base = path.rpartition("/")
        extension = "." + base.rsplit(".", 1)[1] if "." in base.lstrip(".") else ""
        cle = (dossier, extension)
        if cle not in groupes:
            groupes[cle] = []
            ordre.append(cle)
        groupes[cle].append(path)
    motifs = []
    for cle in ordre:
        dossier, extension = cle
        membres = groupes[cle]
        if len(membres) >= 3 and dossier and extension:
            motifs.append("%s/*%s" % (dossier, extension))
        else:
            motifs.extend(membres)
    return motifs


def bloc_scope(files):
    """The markdown block to paste into the PR body."""
    motifs = suggerer_scope(files)
    if not motifs:
        return ""
    lignes = ["## Scope", ""]
    lignes += ["- `%s` — to specify" % m for m in motifs]
    return "\n".join(lignes)


def publier_suggestion(files):
    """Writes the block to the job summary (and the log): copyable."""
    bloc = bloc_scope(files)
    if not bloc:
        return
    print("Scope that can be declared as-is in the PR body:")
    print(bloc)
    resume = os.environ.get("GITHUB_STEP_SUMMARY")
    if not resume:
        return
    try:
        with open(resume, "a", encoding="utf-8") as fh:
            fh.write("### Scope to declare\n\n"
                     "This block, pasted into the PR body, makes `couche0` green "
                     "(re-running the workflow without a new commit then suffices).\n\n"
                     "```markdown\n%s\n```\n" % bloc)
    except OSError:
        pass


def check_scope(files, body, errors):
    """Every modified file declared, every declaration used."""
    declared = parse_scope(body)
    paths = [f["filename"] for f in files if not is_exempt(f["filename"])]
    if not declared:
        if paths:
            errors.append("scope: no `## Scope` section in the PR body, "
                          "while %d file(s) are modified." % len(paths))
        return
    used = set()
    for path in paths:
        hit = [p for p in declared if matches(p, path)]
        if hit:
            used.update(hit)
        else:
            errors.append("scope: `%s` modified but not declared in `## Scope`." % path)
    unused = [p for p in declared if p not in used]
    if unused:
        errors.append("scope: unused declaration(s) — oversized scope: %s"
                      % ", ".join("`%s`" % p for p in unused))


def added_lines(files):
    """Added lines of the diff, per file (file headers excluded)."""
    for f in files:
        for line in (f.get("patch") or "").splitlines():
            if line.startswith("+") and not line.startswith("+++"):
                yield f["filename"], line[1:]


def check_forbidden(files, body, errors):
    """Forbidden patterns in added lines + frozen guard files."""
    compiled = [(re.compile(p, re.M), m, x) for p, m, x in FORBIDDEN_PATTERNS]
    for path, line in added_lines(files):
        # The guard cites itself (patterns, examples): it is already frozen
        # below (GUARD_FLAG), so outside the pattern scan.
        if path.startswith(".github/couche0/"):
            continue
        for rx, message, exempt in compiled:
            if exempt and exempt in line:
                continue
            if rx.search(line):
                errors.append("forbidden: %s — `%s` in %s" % (message, line.strip()[:90], path))
    frozen = [f["filename"] for f in files if f["filename"].startswith(GUARD_FILES)]
    if frozen and GUARD_FLAG not in body:
        errors.append("forbidden: guard file(s) modified without the `%s` mention "
                      "in the body: %s" % (GUARD_FLAG, ", ".join(frozen)))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="check_couche0")
    ap.add_argument("cmd", choices=["check"])
    ap.add_argument("--pr", required=True, type=int)
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    ap.add_argument("--control", choices=["scope", "forbidden"], default=None)
    args = ap.parse_args(argv)
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not args.repo or not token:
        print("::error::GITHUB_REPOSITORY and GITHUB_TOKEN are required")
        return 2
    try:
        body, files = pr_context(args.repo, args.pr, token)
    except Exception as exc:                         # noqa: BLE001
        print("::error::GitHub API: %s" % exc)
        return 2
    errors = []
    if args.control in (None, "scope"):
        check_scope(files, body, errors)
        if any(e.startswith("scope :") for e in errors):
            publier_suggestion(files)
    if args.control in (None, "forbidden"):
        check_forbidden(files, body, errors)
    # A refusal can list 38 files: the log becomes unreadable and drowns the
    # cause. The first twelve are enough to understand; the job summary holds
    # the complete block to paste (publier_suggestion).
    for message in errors[:MAX_ERREURS_AFFICHEES]:
        print("::error::%s" % message)
    if len(errors) > MAX_ERREURS_AFFICHEES:
        print("::error::… and %d more — full `## Scope` block in the "
              "job summary." % (len(errors) - MAX_ERREURS_AFFICHEES))
    print("%s — %d file(s) checked, %d error(s)"
          % ("OK" if not errors else "REJECTED", len(files), len(errors)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
