# Architecture

## Overview

```
[Browser]                        [Edge]                    [InferHub]
 Static webapp  ── HTTPS ──▶  Proxy (Worker / function) ──▶  [OI]-compatible API
       │                         hidden key, quota,           vision + reasoning
       │                         minimal logging
       └── IndexedDB: diagnostics, profile, settings (never the image)
```

There are three ways to reach a model, in order of preference:

1. **Edge proxy** — the `INFERHUB_API_KEY` stays server-side (`api/analyze.ts` for Vercel,
   `worker/worker.js` for Cloudflare). Without a proxy, anyone can consume the quota.
2. **BYOK** — the user pastes their own key; it is sent in the `x-revision-cle` header, stays on
   the device and replaces the server key. This is the safety net for judging day.
3. **Demo corpus** — `corpus/fixtures.ts` replays recorded answers, with no key and no network:
   tests and the offline demonstration use this path.

## The four structural choices

| Choice | Consequence |
|---|---|
| No data backend | No database, no auth, no server-side GDPR obligations. History lives in IndexedDB |
| A minimal edge proxy | The key never enters the bundle; the quota is bounded |
| Static webapp | One-command deployment, 24/7 availability during judging |
| BYOK as a fallback | A judge can test even if the shared quota is exhausted |

## The pipeline, step by step

| # | Step | File | Input | Output | Budget |
|---|---|---|---|---|---|
| 1 | Ingest | `src/pipeline/ingest.ts` | `File` | 1600 px data URL, contrast stretched | < 300 ms |
| 2 | Anonymise | `src/pipeline/anonymize.ts` | data URL | data URL, name banner pixelated | < 500 ms |
| 3+4 | Extract **and** type | `src/pipeline/analyse.ts` (single vision call) | data URL | `Extraction` + typed `Erreur[]` | < 20 s |
| 4b | Second pass | `src/pipeline/revue.ts` | mistakes with confidence < 0.75 | codes confirmed / reclassified / E99 | < 5 s |
| 5 | Aggregate | `src/domain/profil.ts` | errors + history | `Profil` (recurrence, evolution) | < 50 ms |
| 6 | Generate | `src/pipeline/exercise.ts` | dominant type | `ExerciceVerifie` or an honest message | < 6 s |

Orchestration: `src/pipeline/orchestrate.ts` — publishes a `Progression` for each step (state,
message, duration), with a total budget of 20 s; a failing step becomes a readable message.

**Why a single call for steps 3 and 4.** Every round trip with the upstream costs 16 to 50 s
(marketplace, sometimes no provider capacity). Two sequential calls pushed the "photo → diagnosis"
budget to 40–90 s; merging them brings it back to **22 s on average** (measured on five papers of
the corpus). The **rules** remain local and unchanged: the 0.6 threshold, downgrade to `E99`, zero
weight for `E11` — the model proposes, `normaliserErreur` disposes.

**Why a second pass.** The risk qualified as fatal in the brief is the false positive. Mistakes
typed with confidence < 0.75 are rechecked by a **text-only** call (therefore fast) that confirms,
reclassifies or downgrades to `E99` — it never adds a mistake. Capped at five mistakes to keep
latency down.

**One proof per step.** Along with its duration, each step publishes **what it actually produced**:
"image normalised to 1600 × 2212 px", "name banner pixelated (64% of width)", "3 annotation(s) read
from the paper", "3 mistake(s) typed: E01, E01, E11", "profile updated: dominant type E01",
"exercise drawn from the local bank on E01 — guard: 3 criteria validated". The proof is computed
from the step's result, so it cannot lie; it remains visible after the analysis, in the "analysis
trace" of the Diagnosis screen. This is what lets a judge verify the work without reading the code.

**Proxy health probe.** `src/pipeline/sante.ts` calls `GET /health` (5 s timeout) on load and on
every address change. If the upstream reports `ko`, a banner offers the demo or BYOK instead of
letting the user wait for a failure. The status dot is visible in the footer. The separate path
(`extract.ts` + `classify.ts`) remains in the repository as a reference for the comparison bench.

### The injection point

The whole pipeline talks to a `ClientBrut` (`src/pipeline/client.ts`), never to `fetch`. In
production it is `completer()` from `src/pipeline/llm.ts`; in tests it is `clientSimule()`, which
returns recorded JSON answers. As a result, **170 tests run without network or quota**, and the
validation corpus is replayable in CI.

## The step-6 guardrail

Two distinct calls, never one:

1. `prompts/generation.md` → the exercise (statement, hints, solution, level);
2. `prompts/garde-fou.md` → the verdict on three criteria: it works on the right type, it does not
   reveal the original solution, and it is at the same level.

One rejected criterion → regeneration. At most two attempts (`MAX_TENTATIVES_EXERCICE`), then
`exercice: null` plus an explicit message. An off-topic exercise is never served.

## Data model

Defined in `src/domain/types.ts`. Stored locally only (`src/storage/local.ts`, keys in
`src/domain/config.ts`):

- `Diagnostic` — id, timestamp, subject, mistakes, dominant type;
- `Erreur` — code, label, line (text, never the image), explanation ≤ 25 words, confidence,
  weight;
- `Profil` — weighted occurrences per type, number of analyses, evolution, and mistakes that are
  *flagged but not weighted* (E11, E99);
- `StatsClasse` — teacher-mode aggregate (`src/domain/classe.ts`).

No image, no name, no personal data crosses the storage layer.

## Privacy rules

| Ref | Requirement | Where it is enforced |
|---|---|---|
| RNF-P1 | the image is never persisted | data URL in session memory, never written to IndexedDB |
| RNF-P2 | name masked before display | step 2, pixelation of the banner |
| RNF-P3 | proxy without content logging | `api/analyze.ts`: timestamp, status, latency only |
| RNF-P4 | history exportable and deletable | Settings screen, `effacerHistorique()` |
| RNF-P5 | explicit notice in the UI | home, framing, settings, footer |

## Interface

Eight screens (`src/ui/screens/`), a home-made state router plus a `?ecran=` parameter for sharing
a specific screen during the demo. Design: `#0d0f14` background, `#f5c518` yellow for diagnosis,
`#3ecf8e` green for progress, **no red** — the paper is already annotated in red by the teacher.

## What the architecture allows without the taxonomy

Adding a subject (physics) would require a new taxonomy and new prompts, not a new architecture:
steps 1, 2, 5 and 6 are domain-independent. This is deliberately out of scope.
