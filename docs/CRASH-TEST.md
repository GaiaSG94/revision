# Crash test — 12 November 2026

Goal: verify that the product breaks neither on **hostile data**, nor under **volume**, nor in case
of **failure**. Three parts, all automated except the last one.

Summary: **75 crash tests added** (171 tests in total), **8 real defects found and fixed**, plus one
honestly documented infrastructure behaviour (best-effort quota).

---

## Part 1 — Hostile data (`tests/crash/modele-hostile.test.ts`)

17 adversarial payloads × 3 entry points (extraction, merged analysis, classification) = 53 cases.
Payloads: truncated JSON, non-JSON, an array instead of an object, `null` everywhere, inverted
types, absurd confidences (`-5`, `999`, `NaN`, `"0.9"`), unknown codes (`E42`, `""`, `null`, `12`),
out-of-frame zones (`x: -3`, `width: 1e9`, `NaN`, `Infinity`), a **100 KB** line,
**5,000 annotations**, unknown fields, prompt injection, markdown around the JSON.

**Required invariants**: no exception other than `ErreurLLM`; no code outside the taxonomy;
confidence in [0,1] and finite; bounded texts and lists; sanitised or discarded zones; a paper
with no valid annotation remains "clean" (RNF-04).

### Defects found and fixed

| # | Defect | Real impact | Fix |
|---|---|---|---|
| 1 | Unbounded line: a model could return 100 KB of text | Unreadable diagnosis card, huge DOM | `tronquer()` to 300 characters, ellipsis at the end |
| 2 | Unbounded list: 5,000 annotations accepted | Rendering freeze (5,000 cards + 5,000 rectangles) | `MAX_ANNOTATIONS = 50` cap |
| 3 | **One invalid annotation rejected the whole answer** | A single `NaN` zone lost an entire paper | parsing **element by element** (`listeTolerante`): the faulty element is dropped, not the batch |
| 4 | Zones not sanitised | `x: -3` or `width: 1e9` → off-screen rectangle, broken layout | `zoneAssainie()`: finite numbers, clamped to [0,1], bounded width/height; otherwise the zone is dropped and the annotation stays valid |
| 5 | Non-JSON response body on a 200 | bare `SyntaxError` → raw English message in the UI | translated into `ErreurLLM` "Unreadable proxy response" |
| 6 | Missing/unreadable guardrail verdict | silence = exercise served without verification | every missing field counts as `false`: **an unreadable verdict is a refusal** |
| 8 | **Unbounded wait**: 6 models × 90 s proxy timeout = up to 9 minutes before yielding | the user stares at an endless analysis screen | 60 s timeout **per call** (`AbortSignal.timeout`) + **130 s global budget** for the whole chain, then an explicit message offering the demo |

The new `src/domain/tolerance.ts` module centralises these rules (bounds, sanitisation, caps): no
duplication between extraction, merged analysis, classification and the second pass.

---

## Part 2 — Volume (`tests/crash/volume.test.ts`)

Deterministic generator (fixed seed, so no flaky tests).

| Scenario | Result |
|---|---|
| 1,000 papers × 4 mistakes aggregated | **< 1 s** (measured ~50 ms), shares sum to 1.000 ± 0.001, no NaN |
| Ranking + summary sentence on 1,000 papers | bounded (≤ 12 lines, sentence < 200 characters) |
| CSV / Markdown sheet exports on 1,000 papers | **do not grow**: CSV ≤ 14 lines, sheet < 40 lines (last 5 papers only) |
| Trajectory on 1,000 papers | complete series, coherent trend |
| Teacher mode, batch of 200 papers × 5 mistakes | < 300 ms, exact total, 200 entries |
| One diagnostic with 5,000 raw mistakes | correct dominant, E99 out of profile but flagged |
| Extreme confidences (`MAX_VALUE`, `MIN_VALUE`, negative) | no NaN/Infinity propagation |

### Verification in a real browser (published site)

1,000 diagnostics (**1.37 MB**) injected into IndexedDB on the publicly deployed site, then the
Profile screen opened:

- load + render: **412 ms** (DOMContentLoaded 164 ms)
- JS heap: **6 MB**
- **0** occurrence of `NaN` or `undefined` in the rendered DOM
- **0** console errors
- correct summary: "10% of your mistakes: forgotten special case", 8 types listed

Pitfall encountered: the `idb-keyval` IndexedDB database is called **`keyval-store`** (not
`keyval`); the first injection went into a database created for the occasion, and the screen
legitimately showed the empty state.

### Defect found and fixed

| # | Defect | Fix |
|---|---|---|
| 7 | A damaged diagnostic in local storage (`erreurs: null`) made aggregation throw | `agreger()` ignores an unreadable diagnostic; `chargerDiagnostics()` and `chargerProfil()` **filter and rebuild** on load (interrupted write, browser quota, data from an older version) |

---

## Part 3 — Failures (`tests/crash/pannes.test.ts` + real tests on the proxy)

### Simulated (offline)

| Scenario | Expected and verified behaviour |
|---|---|
| Network cut (`fetch` rejects) | **1 call only**, `ErreurLLM` "Network unavailable" — no loop |
| Whole chain on 503 | exactly **6 calls** (one per model), real upstream message propagated |
| Mix of 503 / 402 / 500 / 504 then success | reaches the 5th model, **5 calls** |
| 429 "proxy quota" | **1 call**, message offering BYOK |
| Upstream 429 then 503 everywhere | bounded to **≤ 7 calls** (one second chance per model), no storm |
| HTML body on a 200 | `ErreurLLM`, never `SyntaxError` |
| Exercise generation fails | the error propagates (the orchestrator turns it into an honest message) |
| Hostile second-pass verdicts (index 99, −3, unknown code) | list **intact in length**, only the targeted mistake changes, unknown code → E99 |
| Second pass fails | the original mistakes are kept as is |

### Real, on the deployed proxy (Modal)

- **20 parallel `/health` requests**: 20 × 200, ~0.87 s each — no queue.
- **25 parallel `/analyze` calls** (short text): 14 successes, 2 upstream timeouts (504),
  2 internal Modal errors (500, "function was terminated by signal"), the rest in 200.
  The 500/504 statuses are part of the client-side fallback chain: they are replayed.
- **16 MB body**: `413` and "Photo too heavy (15 MB max after encoding)" in 4.5 s — the size guard
  holds in production.
- **Real 476 KB image under full saturation**: `504` after 90 s (proxy timeout on the upstream).
  This exact case revealed defect #8: without a global budget, the browser would have chained six
  90 s waits.

**Honest finding on quota**: no 429 was observed across 25 parallel calls. The quota is in memory
**per container** and Modal recycles instances under load (the two observed 500s): the cap is
therefore **best-effort**, not a guarantee. Acceptable for a demonstration guard, insufficient for
a paid product. The caps were divided by the number of containers (`PAR_IP_PAR_HEURE = 20 / 4`) so
that the total seen by a visitor stays close to the target; a real cap would need a shared counter
(KV, Upstash), hence a third-party service.

---

## What this crash test does not cover

- **The DOM**: tests run in a Node environment without `jsdom`. Rendering under load was therefore
  verified **manually in a real browser** (part 2), not automated. A replayable E2E test
  (Playwright/agent-browser) remains to be added — idea #94 in the pre-existing idea list.
- **Real images**: the corpus is synthetic. Behaviour on a real handwritten paper, a reflection, a
  fold or a very blurry photo is not measured (protocol: [`../corpus/README.md`](../corpus/README.md)).
- **Concurrent IndexedDB writes**: two analyses started at the same time in the same browser
  (double click). The button is `disabled` during analysis, but this is not tested automatically.
- **Long outages**: network loss mid-call, recovery, offline queue (idea #62, not implemented).
