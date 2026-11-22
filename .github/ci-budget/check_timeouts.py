#!/usr/bin/env python3
"""CI budget guard: every GitHub Actions job must be bounded to 5 min.

User rule 2026-10-24. Standard library only (self-hosted runners are not
guaranteed to have PyYAML). Deliberately simple analysis: we read the
workflows line by line, locate the `jobs:` section and, for each job (key at
2 spaces), the `timeout-minutes:` at 4 spaces.

Errors (exit 1): job without `timeout-minutes`, or timeout > MAX_MINUTES
on a pull_request workflow. Non-PR workflows (push to the protected branch,
tags, manual trigger) may exceed it, with an explicit timeout and a comment
justifying the number.
Warnings (exit 0): missing `concurrency`, checkout without fetch-depth: 1.
"""

import glob
import os
import re
import sys

MAX_MINUTES = 5
WORKFLOWS = ".github/workflows"
SKIP_FILES = set()  # the guard checks itself

TOP_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*:")
JOB_KEY = re.compile(r"^  ([A-Za-z0-9_.-]+):\s*(#.*)?$")
TIMEOUT = re.compile(r"^    timeout-minutes:\s*(\d+)\s*(#.*)?$")


def read_lines(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read().splitlines()


def scan_jobs(lines):
    """Returns [(name, timeout|None)] for the file’s jobs: section."""
    jobs = []
    in_jobs = False
    for line in lines:
        if line.startswith("jobs:"):
            in_jobs = True
            continue
        if in_jobs and TOP_KEY.match(line):
            in_jobs = False
        if not in_jobs:
            continue
        match = JOB_KEY.match(line)
        if match:
            jobs.append([match.group(1), None])
            continue
        match = TIMEOUT.match(line)
        if match and jobs:
            jobs[-1][1] = int(match.group(1))
    return jobs


def runs_on_pr(lines):
    """True if the workflow triggers on pull_request (therefore subject to the budget)."""
    for line in lines:
        if line.startswith("jobs:"):
            break
        code = line.split("#", 1)[0]
        if re.search(r"\bpull_request\b", code):
            return True
    return False


def check_file(path, errors, warnings, display=None):
    rel = display if display is not None else path
    lines = read_lines(path)
    jobs = scan_jobs(lines)
    if not jobs:
        warnings.append("%s: no job detected (empty workflow?)" % rel)
        return
    on_pr = runs_on_pr(lines)
    for name, timeout in jobs:
        if timeout is None:
            errors.append(
                "%s: job '%s' without timeout-minutes (default 360 min, forbidden)"
                % (rel, name))
        elif timeout > MAX_MINUTES and on_pr:
            errors.append(
                "%s: job '%s' timeout-minutes: %d > %d (CI budget)"
                % (rel, name, timeout, MAX_MINUTES))
    if not any(line.startswith("concurrency:") for line in lines):
        warnings.append("%s: no concurrency (cancelling stale runs)"
                        % rel)
    if "actions/checkout" in "\n".join(lines) and "fetch-depth: 1" not in "\n".join(lines):
        warnings.append("%s: checkout without fetch-depth: 1" % rel)


def main():
    root = os.environ.get("CI_BUDGET_ROOT", ".")
    paths = sorted(glob.glob(os.path.join(root, WORKFLOWS, "*.yml")))
    paths += sorted(glob.glob(os.path.join(root, WORKFLOWS, "*.yaml")))
    paths = [p for p in paths if os.path.basename(p) not in SKIP_FILES]

    errors, warnings = [], []
    if not paths:
        print("::warning::No workflow in %s" % WORKFLOWS)
    for path in paths:
        # We read the real path (CI_BUDGET_ROOT may point elsewhere than the
        # current directory) but display the stable relative path.
        check_file(path, errors, warnings,
                   display=os.path.relpath(path, root))

    for message in warnings:
        print("::warning::%s" % message)
    for message in errors:
        print("::error::%s" % message)

    print("%d workflow(s) checked: %d error(s), %d warning(s)"
          % (len(paths), len(errors), len(warnings)))
    if errors:
        print("Rule: CI ≤ %d min per job — see ~/Desktop/CI-BUDGET-5MIN.md"
              % MAX_MINUTES)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())