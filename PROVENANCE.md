# Provenance — pre-existing work vs. work done during the event

This document exists so that judges are not misled about what was built for this submission. It
separates **pre-existing code, templates and assets** from **work done during the event** (the
current working-tree changes, dated 2026-11-22). The original Git history is preserved in this
repository and can be checked at any time with `git log`; `git show <commit>:<file>` reads a file
as it existed at a given commit.

## A. Pre-existing code, templates and assets

The submitter reports that this codebase is a rebranded copy of the public repository
`GaiaSG94/errata`, itself an English-language and design copy of a project called *Raturé*,
originally created as `BaptisteFaisy/rature` and then `Tradoooo/rature` (initial commits in
November 2026). These are **historical, pre-existing proper names**, not work created for this
submission. The repository's current `origin` remote still points at `https://github.com/GaiaSG94/errata.git`,
which is consistent with that history.

What the local history verifies:

| Date (from `git log`) | Commit | Evidence of pre-existing work |
|---|---|---|
| 2026-11-11 17:40 +0100 | `24fe0ea` | First local commit, "Raturé — socle du projet : taxonomie fermée, profil d'erreur, client InferHub, socle CI 5 min" — the closed taxonomy, error-profile rules, model client and CI base already existed |
| 2026-11-11 18:23 +0100 | `d050095` | "produit Raturé — pipeline 6 étapes, UI 8 écrans, proxy edge, corpus et tests" — the six-step pipeline, eight UI screens, edge proxy, corpus and tests already existed |
| 2026-11-11 18:43 +0100 | `83dea2a` | "livrables concours — README, write-up, …, licence et guide de contribution" — README, licence and contribution guide predate the current changes |
| 2026-11-13 | `43cd2b6` | "design Duello + site en anglais (Errata)" — the English-language design system predates the current changes |
| 2026-11-16 | `fdc9440` | Current `HEAD`: "point repo URL, CORS origin, CI identities and license at GaiaSG94/errata" |

Specifically pre-existing, and **not** claimed as new work in this submission:

- the application architecture and the six-step pipeline (`src/pipeline/`, `src/domain/`), the
  closed taxonomy and profile rules, the prompts (`prompts/`), the UI screens and design system
  (`src/ui/`, `src/styles.css`, `src/v9.css`), the CI workflows and guards (`.github/`), the edge
  proxy (`api/analyze.ts`, `worker/worker.js`, `proxy/modal_app.py`) and the test suite (`tests/`);
- the validation corpus (`corpus/images/`, `corpus/demo/`, `corpus/reponses/`, `corpus/fixtures.ts`,
  `corpus/images/manifeste.json`), generated and recorded before 2026-11-22;
- the package set in `package.json` and the MIT `LICENSE`;
- all documentation committed before 2026-11-22, including the earlier README, architecture note,
  model-validation notes and the now-removed event-submission documents.

The removed event-submission documents are still readable in history, for example with
`git show HEAD:docs/DECLARATION-IA.md` and `git show HEAD:docs/WRITEUP.md`. One of them stated that
the code was "100% new"; that statement describes the earlier project's own framing and **does not
apply to this rebranded submission** — the provenance above is the accurate record.

## B. Work done during the event (2026-11-22)

All items below were introduced in this submission's final commit, on top of the original HEAD
`fdc9440`. They can be inspected with `git show <commit>` or `git diff fdc9440..HEAD`:

| Area | What changed | Evidence |
|---|---|---|
| Rebrand | Project name changed from the previous names to **Revision**; URLs, CORS header (`x-revision-cle`), build variable (`REVISION_PROXY_URL`), runner labels and code identifiers renamed | `git diff` over `README.md`, `index.html`, `vite.config.ts`, `src/`, `worker/worker.js`, `.github/`; new `src/etat/useEtatRevision.ts` and `src/etat/useRevision.tsx` replace the deleted `useEtatRature.ts` / `useRature.tsx` |
| Documentation cleanup | Event-submission-only documents deleted (`devpost/formulaire.md`, `docs/CHECKLIST-SOUMISSION.md`, `docs/DECLARATION-IA.md`, `docs/IDEES-100.md`, `docs/IDEES-100-INFERHUB.md`, `docs/PITCH.md`, `docs/RATURE-SPEC.md`, `docs/SCRIPT-VIDEO.md`, `docs/TRACKS.md`, `docs/WRITEUP.md`) | `git diff --diff-filter=D fdc9440..HEAD` |
| English rewrite | Remaining French text translated to English across documentation, code comments, UI strings, test descriptions and CI comments | `git diff fdc9440..HEAD` over `docs/`, `src/`, `tests/`, `.github/`, `prompts/` |
| New compliance documentation | `PROVENANCE.md` (this file), `CREDITS.md`, `DEMO.md`, `SECURITY.md`, `docs/AI-DISCLOSURE.md`, plus the "Submission compliance" section added to `README.md` | new/modified `.md` files |
| Test and privacy hygiene | Live API tests moved to a separate `npm run test:live` config so `npm test` is offline-only; a personal commit email replaced with the GitHub noreply address | `vitest.config.ts`, `vitest.live.config.ts`, `package.json`, `.github/workflows/`, `.github/fireworks/test_agent.py` |

These code-file changes are verifiable in the final commit and in `git diff` against the original
HEAD `fdc9440`; this document does not attribute authorship of individual edits to a particular
tool or agent beyond the declarations in [`CREDITS.md`](CREDITS.md) and
[`docs/AI-DISCLOSURE.md`](docs/AI-DISCLOSURE.md).

## How to verify

```bash
git log --format='%h %ad %an <%ae> %s' --date=short
git show fdc9440:docs/DECLARATION-IA.md
git diff --stat fdc9440..HEAD
git diff fdc9440..HEAD -- README.md docs corpus prompts CONTRIBUTING.md .github
```
