# Revision CI infrastructure — runners, Mergify queue, conflict agents

> Operations note. This repository has **no dedicated machine**: its runners are self-hosted
> runners that were no longer in use elsewhere and were moved here on 2026-11-11 (see §1). CI
> gives its verdict in under 5 minutes.

## 1. The runners came from elsewhere (moved, not created)

The r630 was at **91% disk** usage: creating new runners (≈ 5 GB each) was out of the question.
Existing runners were therefore **moved** with `deplace-runner.sh` (from the `repo-bootstrap`
kit), which reuses the folder (re-registration only, `_work/` emptied, symlinks repaired).

| Runner | Origin | Status as of 12 Nov, 01:00 |
|---|---|---|
| `r630-revision-01` | created by the factory | online |
| `r630-revision-02` | moved from `actions-runner-stable-02` (deleted `stable` repository, orphan registration) | online |
| `r630-revision-03` | created by the factory | online |

**History of 11 Nov:** four runners had been moved that same evening (`stable-01`, `stable-02` —
the repository was deleted —, `near_tidewater-01`, `deja-vu-ci-01`, both without an open PR). Three
folders then disappeared during a disk cleanup started by another agent on the r630 (the volume
went from 91% to 49% used); their systemd units were stuck in a restart loop (`status=203/EXEC`,
executable missing). The units were removed, then two runners were recreated by the factory
(`fabrique-repo.sh --sans-socle --workers 3`), with a `systemctl --user restart` needed to bring
them `online` (new runners sometimes start "deaf").

Labels: `self-hosted`, `Linux`, `X64`, `revision-worker`, `ci-node`.
Services: **user** systemd units `actions-runner-revision-0N.service` (`Restart=always`), so no
`sudo` is needed.

Check status:

```bash
gh api repos/GaiaSG94/revision/actions/runners \
  --jq '[.runners[] | select(.status=="online")] | length'   # expected: 3
export XDG_RUNTIME_DIR=/run/user/$(id -u)                    # otherwise systemctl --user fails
systemctl --user list-units 'actions-runner-revision*' --all
```

A runner that is `offline` just after registration is fixed with
`systemctl --user restart actions-runner-revision-0N.service` (observed twice).

## 2. What CI requires (three checks, no more)

| Check | Role | Budget |
|---|---|---|
| `ci` | strict typecheck, tests, build, file/function size, guard tests | ≤ 5 min |
| `ci-budget` | configuration guard: no job declares more than 5 minutes | a few seconds |
| `couche0` | declared scope (`## Scope` bullets) + forbidden patterns (no secret, no force push) | ~17 s |

The `main` ruleset requires a PR, a linear history and these three checks; the equivalent of
`enforce_admins` is handled by the ruleset, so there are **no direct pushes**, not even by an
agent.

## 3. Mergify queue

`.mergify.yml`: `queue_rules.default` (all 3 checks green, no conflict, not a draft, base `main`),
`merge_method: rebase`, batches of 1 to 3,
`max_parallel_checks: 2` for four workers. The *Merge Queue* product was enabled through the API
(`PUT /v1/products/GaiaSG94/revision` → 204) and `merge_protections` with
`auto_merge_conditions: true`, so a green PR merges **without a comment**.

Manual brake: the `hold` label (put it on the PR). Priorities: `urgent` / `priority-low`.

## 4. Conflict agents — on InferHub

The `pr-auto-merge` sweep handles `DIRTY` (conflict) and `BEHIND` PRs: it rebases, and if the
rebase hits a conflict it calls `.github/fireworks/conflict_agent.py` (file-by-file resolution,
compilation gate before pushing, `quota.py` to bound invocations).

These agents are **connected to InferHub** (an [OI]-compatible API), not to a third-party
provider:

| Setting | Value |
|---|---|
| secret `FIREWORKS_API_KEY` | InferHub key |
| variable `FIREWORKS_BASE_URL` | `https://api.inferhub.dev/v1/chat/completions` |
| variable `FIREWORKS_MODEL` | `ag/gemini-3.8-flash-high` |
| variable `FIREWORKS_AGENT_RESOLVE` | `1` (circuit breaker: `0`) |

The name `fireworks` is historical (the code and its tests date from that provider); only the
upstream changed, the HTTP contract is InferHub's.

The same model serves the product itself (`src/domain/config.ts`), but through the edge proxy,
with a key that never reaches the bundle.

## 5. Deployment

`pages.yml` builds the static webapp and publishes it automatically to GitHub Pages (deployment
verified on 11 November, commit 6db57e8) (`https://gaiasg94.github.io/revision/`) on every push to
`main` — public, HTTPS, free, tokenless. The InferHub key is not there: the site talks to the edge
proxy (`/api/analyze`, see `api/analyze.ts` and the `worker/worker.js` variant), or otherwise uses
**BYOK** (the user pastes a key) or **demo mode** (recorded answers from the corpus).

> Status note: this is the configuration and the historical verification record. The current
> public availability of the rebranded URL is checked in [`../DEMO.md`](../DEMO.md); no live URL
> is guaranteed by this document.
