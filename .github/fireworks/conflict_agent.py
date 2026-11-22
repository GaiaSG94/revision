#!/usr/bin/env python3
"""Fireworks conflict agent for the pr-auto-merge queue.

Called by the sweep INSIDE its clone when a rebase hits a conflict: it has
Fireworks resolve each elementary conflict, copies the rest of the file
unchanged (never a full rewrite: a large file would be truncated), loops over
stops (emptied commits skipped), pushes and reports. `union_journal.py` unites
logs without a model; `quota.py` bounds invocations (cooldown, hourly cap,
3 per PR in 30 min).

Compilation gate (v3, 31/10): a resolution that does not compile is
**never pushed** (`compilation_gate.py`). Reason: #615, broken reconciliation
classified as 'real failure' then abandoned. Circuit breaker:
`CONFLICT_COMPILE_GATE=0`. Usage: `resolve --repo O/R --pr N --branch b --sha s`
(`--dry-run`: prompt only). Codes: 0 pushed, 1 commented failure, 2 nothing
to do. No secret inside.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import types
import urllib.request


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


union_journal = _charger("union_journal")
quota = _charger("quota")
# v3: compilation gate alongside (`compilation_gate.py`): 500-line cap.
compilation_gate = _charger("compilation_gate")

MODEL_DEFAULT = "accounts/fireworks/models/minimax-m3p1-flash"
API_DEFAULT = "https://api.fireworks.ai/inference/v1/chat/completions"
MAX_FILES = 100
MAX_FILE_BYTES = 200_000
MAX_HUNKS = 20
HUNK_MAX_CHARS = 12_000
MAX_ROUNDS = 10
BUDGET_S = 240
CALL_TIMEOUT_S = 90
MAX_TOKENS = 8_000
TEMPEREVISION = 0.2
LABEL_OK = "agent-conflit"
LABEL_HUMAN = "intervention-humaine"
COMMENT_PREFIX = "_fireworks · conflict agent (MiniMax M3.1 Flash)_"
REFUSED_PREFIXES = (".github/", ".mergify.yml")


class AgentError(Exception):
    """Failure with a publishable message (no secret)."""


def sh(args, **kw):
    """Runs a command and returns its stripped text output."""
    proc = subprocess.run(args, capture_output=True, text=True, **kw)
    if proc.returncode != 0:
        raise AgentError("%s : %s" % (" ".join(args[:3]),
                                      (proc.stderr or "").strip()[:200]))
    return (proc.stdout or "").strip()


def log(message):
    print("fireworks-agent: %s" % message, flush=True)


def pr_labels(repo, pr):
    """Names of the PR labels (empty list if unreadable)."""
    try:
        out = sh(["gh", "pr", "view", str(pr), "--repo", repo,
                  "--json", "labels", "-q", ".labels[].name"])
        return [line for line in out.splitlines() if line]
    except AgentError:
        return []


def comment(repo, pr, body):
    """Comments on the PR; best-effort, never throws."""
    try:
        proc = subprocess.run(["gh", "pr", "comment", str(pr), "--repo", repo,
                               "--body", COMMENT_PREFIX + "\n\n" + body],
                              capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            log("comment refused: %s" % proc.stderr.strip()[:150])
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


def abort_rebase():
    try:
        subprocess.run(["git", "rebase", "--abort"], capture_output=True,
                       timeout=60)
    except Exception:                                          # noqa: BLE001
        pass


def unmerged_files():
    out = sh(["git", "diff", "--name-only", "--diff-filter=U"])
    return [line for line in out.splitlines() if line]


def split_hunks(text):
    """Cuts a marked file into: ("clean", txt) / ("hunk", dict).

    Handles diff and diff3 (with or without base). During a rebase, the first
    block ("head") is main (destination) and the second ("saved") the branch.
    """
    segments, buf = [], []
    lines = text.split("\n")
    n, i = len(lines), 0
    while i < n:
        if not lines[i].startswith("<<<<<<<"):
            buf.append(lines[i])
            i += 1
            continue
        if buf:
            segments.append(("clean", "\n".join(buf)))
            del buf[:]
        head, base, saved = [], None, []
        i += 1
        while (i < n and lines[i] != "======="
               and not lines[i].startswith("|||||||")):
            head.append(lines[i])
            i += 1
        if i < n and lines[i].startswith("|||||||"):
            base = []
            i += 1
            while i < n and lines[i] != "=======":
                base.append(lines[i])
                i += 1
        if i < n and lines[i] == "=======":
            i += 1
        while i < n and not lines[i].startswith(">>>>>>>"):
            saved.append(lines[i])
            i += 1
        i += 1
        segments.append(("hunk", {"head": head, "base": base, "saved": saved}))
    if buf:
        segments.append(("clean", "\n".join(buf)))
    return segments


def build_hunk_messages(path, hunk):
    """Resolution prompt for ONE elementary conflict (rebase)."""
    system = ("You resolve ONE git merge conflict (a single part of "
              "a file). Return ONLY the resolved text of that part, "
              "with no markers, keeping both intentions (never "
              "a side chosen blindly). Answer with the text only, "
              "in a single code block.")
    parts = ["File: %s (excerpt)" % path,
             "--- Branch version (keep it first in case of doubt) ---",
             "\n".join(hunk["saved"])]
    if hunk["base"] is not None:
        parts += ["--- Common ancestor version ---", "\n".join(hunk["base"])]
    parts += ["--- Main version ---", "\n".join(hunk["head"]),
              "Return the resolved part, in a single code block."]
    return [{"role": "system", "content": system},
            {"role": "user", "content": "\n".join(parts)}]


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


def extract_file(text):
    """Extracts the resolved file: code block, otherwise raw text."""
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    match = re.search(r"```[^\n]*\n(.*?)```", cleaned, flags=re.S)
    body = match.group(1) if match else cleaned
    return body.strip("\n") + "\n"


def still_marked(content):
    """True if git conflict markers remain."""
    for line in content.splitlines():
        if line.startswith("<<<<<<< ") or line == "<<<<<<<":
            return True
        if line.startswith(">>>>>>> ") or line == ">>>>>>>":
            return True
        if line == "=======":
            return True
    return False


def resolve_one(api_url, key, model, path, deadline, dry_run):
    """Resolves a file conflict by conflict, copying the rest unchanged."""
    if time.time() > deadline:
        raise AgentError("budget of %d s exceeded" % BUDGET_S)
    try:
        size = os.path.getsize(path)
    except OSError:
        raise AgentError("unreadable file: %s" % path)
    if size > MAX_FILE_BYTES:
        raise AgentError("file too large: %s (%d bytes)" % (path, size))
    with open(path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    if "\x00" in text[:8_000]:
        raise AgentError("binary: %s" % path)
    segments = split_hunks(text)
    hunks = [seg for kind, seg in segments if kind == "hunk"]
    if not hunks:
        raise AgentError("conflict without markers (deletion?): %s" % path)
    if len(hunks) > MAX_HUNKS:
        raise AgentError("%d elementary conflicts (cap %d): %s"
                         % (len(hunks), MAX_HUNKS, path))
    if dry_run:
        for seg in hunks:
            messages = build_hunk_messages(path, seg)
            print("===== %s =====" % path)
            print(messages[1]["content"][:4_000])
        return
    log("resolving %s (%d conflicts)" % (path, len(hunks)))
    out = []
    for kind, seg in segments:
        if kind == "clean":
            out.append(seg)
            continue
        if time.time() > deadline:
            raise AgentError("budget of %d s exceeded" % BUDGET_S)
        total = sum(len("\n".join(seg[k])) for k in ("head", "saved"))
        if seg["base"] is not None:
            total += len("\n".join(seg["base"]))
        if total > HUNK_MAX_CHARS:
            raise AgentError("elementary conflict too large: %s" % path)
        messages = build_hunk_messages(path, seg)
        resolved = extract_file(fw_complete(api_url, key, model, messages))
        if still_marked(resolved):
            raise AgentError("the model returned markers: %s" % path)
        out.append(resolved.rstrip("\n"))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
    sh(["git", "add", "--", path])


def fail(repo, pr, reason):
    """Failure report: rebase aborted, comment + human label."""
    abort_rebase()
    comment(repo, pr, "Conflict **unresolved**: %s\n\nAuthor must rebase." % reason)
    add_label(repo, pr, LABEL_HUMAN)
    log("failure: %s" % reason)
    return 1


class _SaisineLocale(Exception):
    """Fallback if `quota.py` is unreachable (older deployment)."""


Skip = quota.Saisine if quota else _SaisineLocale


def env_or(name, default):
    """Env var or default. GitHub injects an absent var as ""
    (not unset): `os.environ.get(n, d)` would return "" → 400 Fireworks."""
    return os.environ.get(name) or default


def preflight(repo, pr, sha, dry_run, now):
    """Safeguards and reading of conflicting files. Returns (key, model, url, files)."""
    if os.environ.get("FIREWORKS_AGENT_RESOLVE", "1") == "0":
        raise Skip("disabled (FIREWORKS_AGENT_RESOLVE=0)")
    key = os.environ.get("FIREWORKS_API_KEY", "")
    if not key and not dry_run:
        raise Skip("no FIREWORKS_API_KEY key")
    if quota is not None:
        quota.gc_stamps(now)
    labels = pr_labels(repo, pr)
    if "hold" in labels or LABEL_HUMAN in labels:
        raise Skip("labels %s: human hand" % ",".join(labels))
    # Cooldown and caps at invocation time: a pure-addition conflict
    # resolves without a model, even when the cap is exhausted.
    try:
        files = unmerged_files()
    except AgentError as exc:
        raise Skip("unreadable git: %s" % exc)
    if not files:
        raise Skip("no conflicting file")
    check_round_files(files)
    model = env_or("FIREWORKS_MODEL", MODEL_DEFAULT)
    api_url = env_or("FIREWORKS_BASE_URL", API_DEFAULT)
    return key, model, api_url, files


def push_url(repo):
    """Authenticated push URL (GH_TOKEN); "origin" as local fallback."""
    token = os.environ.get("GH_TOKEN", "")
    if not token:
        return "origin"
    return "https://x-access-token:%s@github.com/%s.git" % (token, repo)


def rebase_in_progress():
    """True if a rebase is in progress (state directory present)."""
    try:
        gitdir = sh(["git", "rev-parse", "--absolute-git-dir"])
    except AgentError:
        return False
    return os.path.isdir(os.path.join(gitdir, "rebase-merge")) or \
        os.path.isdir(os.path.join(gitdir, "rebase-apply"))


def continue_or_skip(env):
    """One rebase step: --continue, --skip if commit emptied. Returns (ok, error)."""
    cont = subprocess.run(["git", "rebase", "--continue"], env=env,
                          capture_output=True, text=True, timeout=120)
    if cont.returncode == 0:
        return True, ""
    err = (((cont.stderr or "") + "\n" + (cont.stdout or "")).strip())[:200]
    if "empty" in err.lower():
        try:
            leftover = unmerged_files()
        except AgentError:
            leftover = ["?"]
        if not leftover:
            skip = subprocess.run(["git", "rebase", "--skip"], env=env,
                                  capture_output=True, text=True, timeout=120)
            if skip.returncode == 0:
                log("commit emptied by resolution, --skip")
                return True, ""
    return False, err


def check_round_files(files):
    """Safeguards for one round: refused paths and file cap."""
    refused = [p for p in files if p.startswith(REFUSED_PREFIXES)]
    if refused:
        raise AgentError("conflict in %s (human hand required)"
                         % ", ".join(refused))
    if len(files) > MAX_FILES:
        raise AgentError("%d conflicting files (cap %d)"
                         % (len(files), MAX_FILES))


def autorisation_saisine(pr, sha):
    """Cooldown and caps, at the moment of calling the model (quota.py).

    Separate from `preflight` so that the deterministic union of logs
    (free) is never blocked by a call cap.
    """
    if quota is not None:
        quota.autoriser(pr, sha)


def finish_loop(api_url, key, model, deadline, autorisation=None):
    """Multi-round loop: resolve each stop, continue/skip. Returns files."""
    resolved = []
    env = dict(os.environ, GIT_EDITOR="true")
    autorise = autorisation is None
    for round_no in range(1, MAX_ROUNDS + 1):
        if time.time() > deadline:
            raise AgentError("budget of %d s exceeded" % BUDGET_S)
        files = unmerged_files()
        if files:
            check_round_files(files)
            log("round %d: %d file(s)" % (round_no, len(files)))
            faits = (union_journal.resoudre_par_union(files)
                     if union_journal else [])
            reste = [path for path in files if path not in faits]
            if reste:
                if not autorise:
                    autorisation()
                    autorise = True
                for path in reste:
                    resolve_one(api_url, key, model, path, deadline, False)
            resolved.extend(files)
        done, err = continue_or_skip(env)
        if not rebase_in_progress():
            if done:
                return resolved
            raise AgentError("rebase interrupted: %s" % err)
        if not unmerged_files():
            raise AgentError("rebase stuck without conflict: %s" % err)
    raise AgentError("rebase with more than %d stops, human hand" % MAX_ROUNDS)


def porte_compilation(files, branch):
    """(ok, message, body); neutral if the neighbouring module is unreachable."""
    if compilation_gate is None:
        return True, "", "Conflict reconciled, rebase pushed to `%s`." % branch
    return compilation_gate.prepare_push(files, branch)


def finish(repo, pr, branch, sha, files):
    """Pushes the finished rebase with a lease, reports. Returns 0 or 1."""
    ok, message, corps = porte_compilation(files, branch)
    if not ok:
        # Nothing is pushed: branch intact, PR DIRTY (back to the next round).
        comment(repo, pr, "**Non-compilable** resolution: nothing is pushed, "
                "the branch stays intact.\n\n%s" % message)
        add_label(repo, pr, LABEL_HUMAN)
        log("compilation gate red: nothing is pushed")
        return 1
    push = subprocess.run(["git", "push",
                           "--force-with-lease=%s:%s" % (branch, sha),
                           push_url(repo), "HEAD:%s" % branch],
                          capture_output=True, text=True, timeout=120)
    if push.returncode != 0:
        log("push refused (lease, next pass): %s"
            % push.stderr.strip()[:150])
        return 1
    comment(repo, pr, corps)   # body carries the head marker (sweeper)
    add_label(repo, pr, LABEL_OK)
    log("PR #%s rebased and pushed (%d files)" % (pr, len(set(files))))
    return 0


def cmd_resolve(args):
    repo, pr = args.repo, args.pr
    now = time.time()
    try:
        key, model, api_url, files = preflight(repo, pr, args.sha,
                                               args.dry_run, now)
    except Skip as exc:
        log(str(exc))
        return 2
    except AgentError as exc:
        return fail(repo, pr, str(exc))
    deadline = now + BUDGET_S
    if args.dry_run:
        try:
            for path in files:
                resolve_one(api_url, key, model, path, deadline, True)
        except AgentError as exc:
            return fail(repo, pr, str(exc))
        return 0
    # Dry-run never touches the fingerprint (no cooldown or hourly cap).
    try:
        resolved = finish_loop(api_url, key, model, deadline,
                               lambda: autorisation_saisine(pr, args.sha))
    except Skip as exc:
        # Union done, invocation refused: nothing is pushed, the caller abandons
        # the rebase and the PR goes to the next round.
        log(str(exc))
        return 2
    except AgentError as exc:
        return fail(repo, pr, str(exc))
    return finish(repo, pr, args.branch, args.sha, resolved)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="conflict_agent")
    ap.add_argument("cmd", choices=["resolve"])
    ap.add_argument("--repo", required=True)
    ap.add_argument("--pr", required=True)
    ap.add_argument("--branch", default="")
    ap.add_argument("--sha", default="")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    if args.cmd == "resolve" and not args.dry_run and not (args.branch and args.sha):
        ap.error("--branch and --sha are required outside --dry-run")
    return cmd_resolve(args)


if __name__ == "__main__":
    sys.exit(main())
