# Fireworks agents

Two agents, two distinct problems, never a merge gate: only green CI merges. Both are read from
`origin/main` by the sweep (a PR branch may be behind), and they only write text or verified
bullets.

## Conflict agent (`conflict_agent.py`)

When the `pr-auto-merge` sweep fails to rebase a PR, it calls `conflict_agent.py` in its clone,
with the rebase in progress. The agent asks the model for a resolution for each conflicting file,
finishes the rebase, pushes to the PR branch with a lease and reports in a comment. The queue picks
up at the next pass; only green CI merges.

Append-only logs (`CHANGELOG.md`, `CHANGELOG`) never go through the model: two entries written at
the top of a file are not a disagreement, they are merged losslessly (`union_journal.py`,
`union_sans_perte`). A block that would replace a common line, on the other hand, stays with the
model. This is what stopped the loop of 29 October (#215 rebased six times on `CHANGELOG.md`, one
invocation and one quota charge per rebase). Fingerprints and caps live in `quota.py`.

Both modules are loaded by `conflict_agent.py` from `origin/main` (direct import first): the sweep
only copies the agent script to `/tmp`, and a PR branch may predate that split.

## Call contract

```bash
FIREWORKS_API_KEY=... python3 conflict_agent.py resolve \
  --repo GaiaSG94/revision --pr 118 --branch feat/x --sha <head>
```

The script is read from `origin/main` (not the PR branch, which may be behind). Exit codes: `0`
pushed, `1` failure with a report, `2` nothing to do (the caller skips silently).

## Settings

| Variable / secret | Default | Effect |
|---|---|---|
| secret `FIREWORKS_API_KEY` | — | without it, the agent does nothing |
| var `FIREWORKS_MODEL` | `accounts/fireworks/models/minimax-m3p1-flash` | model queried |
| var `FIREWORKS_BASE_URL` | `https://api.fireworks.ai/inference/v1/chat/completions` | API endpoint |
| var `FIREWORKS_AGENT_RESOLVE` | `1` | `0` disables the agent without touching code |

## Guardrails

Fingerprint per PR head + 20 min cooldown, cap of 10 invocations/hour (`SPAWN_CAP`) and 3
invocations per PR in 30 min (`SAISINES_PR_MAX`: one PR cannot burn the whole hourly quota on its
own), 100 files max, refusal of conflicts under `.github/`, binaries and files over 200 KB, 240 s
budget, lease-only push. Dry run consumes neither fingerprint nor quota, and deterministic journal
unions consume nothing at all.
Labels `hold` / `intervention-humaine`: human hand-off, no invocation. Success: label
`agent-conflit`. The model only sees the edges of the conflict, never any secret.

Recipe: `python3 conflict_agent.py resolve --dry-run --repo GaiaSG94/revision
--pr N` prints the prompts without calling anything (in a clone with a conflict).

## Scope agent (`scope_agent.py`)

A PR whose body has no `## Scope` (or whose section does not cover every changed file) is rejected
by `couche0`, so the sweep sees it as `BLOCKED`. The agent reads the diff, writes one
``- `path` — reason`` bullet per file in French, then **replays the `main` guard's `check_scope`**
on the recomposed body before writing: an undeclared file and a useless declaration both remain
rejected. This is not a guard bypass, it is writing the missing declaration.

```bash
FIREWORKS_API_KEY=... python3 scope_agent.py fix \
  --repo GaiaSG94/revision --pr 215 --sha <head> --guard /tmp/check_couche0.py
```

Exit codes: `0` body completed (a comment carries the `automerge-scope` marker with the head, so
there is only one attempt per commit), `1` failure with a report, `2` nothing to do. Settings:
`FIREWORKS_MODEL` / `FIREWORKS_BASE_URL` as for the conflict agent, `FIREWORKS_AGENT_SCOPE=0` to
disable. Cap of 25 files; beyond that, label `intervention-humaine` and human hand-off.

A bullet written as a glob or a folder (`app/**/Settings*.kt`, `docs/`) is matched to the file
using the **guard's rule** (`matches`), not string equality: on 1 November, a correct glob was
counted as absent and the PR stayed blocked on "the model returned nothing". If files are still
missing, a **targeted retry** asks only for them, with their diff; the model's answer is logged on
any failure.

## Triage index (`--indice`)

Since 1 November, the agent no longer starts from the log alone. The `triage-rouge` workflow
re-runs the class that failed alone and writes its verdict to `/tmp/triage.txt` (class, scope,
suspects); `test_agent.py fix --indice /tmp/triage.txt` adds it to the prompt, under "Automatic
triage (already done, do not redo it)".

That is what was missing on #919: the failing class was not in the diff, the culprit was the PR's
new test (dirty session globals), and the agent — run without an index — returned "150 s budget
exceeded", twice.

Without `--indice`, behaviour is as before (log only). The option is optional and breaks no caller:
the sweep can pass it too.

## Validation

```bash
cd .github/fireworks
python3 -m unittest test_conflict_agent test_scope_agent \
    test_union_journal test_quota -v
```
