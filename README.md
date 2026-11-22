# Revision 🖊️

> Photograph your corrected math paper. Revision finds the mistake you keep repeating — and builds
> the exercise that works exactly on it.

[![Demo guide](https://img.shields.io/badge/demo-offline-f2a516?style=flat-square)](DEMO.md)
[![CI](https://img.shields.io/github/actions/workflow/status/GaiaSG94/revision/ci.yml?branch=main&label=ci&style=flat-square)](https://github.com/GaiaSG94/revision/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-offline%20suite-43d18c?style=flat-square)](tests)
[![MIT licence](https://img.shields.io/badge/licence-MIT-9aa3b2?style=flat-square)](LICENSE)

## Try it now

**No live URL is claimed for this rebranded submission.** At the time of writing the configured
Pages URL did not serve a deployment. The dependable, key-free and network-free demonstration is
the local offline demo — see [`DEMO.md`](DEMO.md).

| You want to… | Do this |
|---|---|
| See the product in seconds, without sending anything | Home → **Try a sample paper** (papers written for this demo, real model answers recorded and replayed offline) |
| Watch the whole story | Home → **Watch the demo** (one student, four papers, profile and trajectory) |
| Analyse **your own** corrected paper | Home → **Photograph my paper**: when an edge proxy is deployed, the analysis goes through it and no key is needed; otherwise use BYOK or the offline demo |
| Analyse without depending on the shared proxy | Settings (⚙) → paste your own InferHub key (BYOK); it stays on your device |
| Check that no image is kept | Open the Network tab: the image travels as base64 in the request, nothing is written, history lives in IndexedDB |

The live path uses a **Cloudflare Worker** edge proxy (`worker/worker.js`: server-side model
fallback chain, quota, 60 s circuit breaker). Its URL is injected at build time through the
repository variable `REVISION_PROXY_URL`. A Modal variant (CPU, scale-to-zero) remains in
`proxy/modal_app.py`. The proxy's current deployment status must be verified before relying on the
live path; the offline demo in [`DEMO.md`](DEMO.md) needs neither.

---

## The problem

A student hands in a test, the teacher marks it, the student looks at it for ten seconds and puts it
away. The most personal information in their schooling — the exact list of the mistakes they keep
making — is thrown away within a day.

Existing tools answer the question you ask (Photomath, ChatGPT) or assume you already know what to
revise (Anki, Khan Academy). None of them starts from the one artefact that already holds the
answer: **the marked paper**.

## The idea

You don't photograph the exercise, you photograph **the correction**. Revision is not an exercise
generator: it is a **personal error profile** that sharpens with every paper.

- 1st paper → a diagnosis
- 3rd paper → a pattern
- 5th paper → a plan

## The pipeline, in 6 steps

```
 photo ──▶ 1 Ingest ──▶ 2 Anonymise ──▶ 3 Read ──▶ 4 Classify ──▶ 5 Aggregate ──▶ 6 Generate
           normalise     mask the name    teacher's   type each       local profile   targeted drill
           + contrast                     marks       mistake         (IndexedDB)     + relevance
                                                      (E01..E12/E99)                   guard
```

| Step | Input | Output | Budget |
|---|---|---|---|
| 1 Ingest | image file | normalised image (contrast stretched) | < 300 ms |
| 2 Anonymise | image | pixelated name banner | < 500 ms |
| 3+4 Read and type | image | marks + `[{code, line, explanation, confidence}]` in **one call** | < 20 s target |
| 4b Second pass | mistakes with confidence < 0.75 | codes confirmed, reclassified or downgraded to E99 | < 5 s |
| 5 Aggregate | classifications + history | error profile (recurrence per type) | < 50 ms |
| 6 Generate | dominant type | exercise + hidden solution + **relevance guard** | < 6 s |

The analysis screen shows every step and its duration: the wait becomes a demonstration. Upstream
latency is the hard part (16 to 130 s per vision round trip depending on which model of the chain
answers), which is why steps 3 and 4 are **merged into a single vision call**.

Also shipped: a **second pass** re-checks low-confidence mistakes, a **health probe** offers the
offline demo or BYOK when the upstream is down, the paper is **zoomable and clickable**, each error
type has a **teaching explanation**, the profile shows the **trajectory** of each weakness, and the
teacher view answers "**what should I re-teach on Monday?**".

## The closed taxonomy — the core of the product

12 types of math mistakes, and nothing else. The model cannot invent a category:

`E01` lost sign · `E02` incomplete expansion · `E03` misused special product · `E04` wrong common
denominator · `E05` forgotten special case · `E06` mishandled power · `E07` wrongly simplified root ·
`E08` faulty transposition · `E09` rounding / precision · `E10` missing unit or conversion ·
`E11` copying mistake · `E12` unjustified conclusion.

Three rules hold the diagnosis together:

1. one mistake = **one** type (otherwise the profile becomes unreadable);
2. confidence < **0.6** → `E99` "untyped", **excluded** from the profile;
3. `E11` (copying) is **flagged but weighted 0**: a slip is not a gap.

Details: [`src/domain/taxonomy.ts`](src/domain/taxonomy.ts), rules in
[`src/domain/profil.ts`](src/domain/profil.ts). Model answers are validated against a Zod schema
before anything is shown.

## The relevance guard (step 6)

An off-topic exercise is worse than no exercise. After generation, a second pass checks three
things: the exercise **really** works on the identified type, it does **not** give away the solution
of the original exercise, and it is **at the same level**. A refusal triggers a regeneration, two
attempts at most, then an honest message: "no exercise available for this type".

## In scope — and out of scope

**Included:** photo upload, reading the teacher's marks, typed classification, diagnosis drawn on
the paper, name masking, longitudinal profile, targeted exercise, teacher mode (batch + class
statistics + CSV), CSV/Markdown exports, BYOK.

**Excluded, on purpose:** subjects other than math (the architecture allows it, the taxonomy does
not), heavily degraded cursive, accounts and server database, automatic grading of the paper.
Narrowing the scope is a design decision, not an admission.

## Hard decisions

| Decision | Why |
|---|---|
| **Closed** taxonomy instead of a free prompt | A measurable, defensible diagnosis; a label invented by the model can't be checked |
| **No classic OCR** | Tesseract fails on handwriting: all reading goes through the multimodal model, in one call |
| **Zero data backend** | No database, no auth, no server-side personal data: history lives in IndexedDB |
| **Minimal edge proxy** | The InferHub key never reaches the bundle; without it anyone could burn the quota |
| **Name masked before display** | The header banner is pixelated, never blurred (a blur can be guessed) |
| **No red in the UI** | The paper is already marked in red: we don't add shame to it. Diagnosis in amber, progress in green |

## What failed

- **Classic OCR on handwriting:** dropped after the first try — the read rate on the teacher's
  handwritten marks is unusable. All reading goes through the multimodal model.
- **False positives on clean papers:** the first extraction prompt "found" mistakes where the
  teacher had written nothing. Fix: `copiePropre` (clean paper) is now an explicit expected answer,
  and classification is **not called** in that case (test `RNF-04`: zero calls, zero mistakes).
- **Over-confident model:** a model that writes "0.95" everywhere makes the threshold useless. The
  prompt now carries a calibration instruction, and the corpus contains a 0.31 annotation that must
  end up as `E99`.
- **Off-topic exercises:** without a second pass, generation drifts to the general topic
  (fractions) instead of the faulty gesture (the common denominator). Hence the guard.
- **Silent hangs when the upstream is saturated:** the whole vision chain once answered 503 and
  the analysis screen waited forever. Fix: a global time budget, progress messages naming the model
  being tried, and an honest error with **Try again**.

## Run it locally

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # 206 tests, no network (live tests are skipped without a key)
npm run typecheck
npm run build      # dist/ — ~127 KB gzip JS
```

Node ≥ 20. No paid dependency.

## Model configuration

The product speaks an OpenAI-compatible API served by **InferHub**. Three modes, in order:

1. **Edge proxy** (recommended): the `INFERHUB_API_KEY` stays server-side.
   - Cloudflare Worker: `worker/worker.js` (`wrangler deploy`, `wrangler secret put INFERHUB_API_KEY`);
   - Vercel: `vercel.json` + `api/analyze.ts`.
2. **BYOK**: the user pastes their key in Settings; it is sent in the `x-revision-cle` header and stays
   on the device. Safety net if the proxy quota runs out.
3. **Offline demo**: the **Try a sample paper** screen and **Watch the demo** replay the full path
   on papers written for this demo — four tests from the same student (Jordan), rendered as real
   photos (page tilted on a desk, uneven light, teacher's red pen), plus two other students. They
   were analysed by the real model; the answers **and measured timings** are recorded in
   `corpus/reponses/` and replayed with no network call and no key — and the UI says so. Four papers
   are what makes the **profile**, its **trajectory** and the teacher view visible offline. Adding a
   recording extends the demo without touching the code (discovered at build time).

Variables: see [`.env.example`](.env.example).

## Non-functional requirements

| Ref | Requirement | Target | Status |
|---|---|---|---|
| RNF-01 | photo → diagnosis | < 20 s | measured per step, shown in the UI; depends on which upstream model answers |
| RNF-02 | UI latency outside the API | < 100 ms | React rendering, no request on click |
| RNF-03 | classification accuracy | ≥ 80 % on 12 types | 100 % on the synthetic corpus (5/5), to confirm on real papers |
| RNF-04 | false positives on a clean paper | 0 tolerated | dedicated test: 0 calls, 0 mistakes |
| RNF-05 | mobile (direct photo) | required | `capture="environment"`, targets ≥ 48 px |
| RNF-06 | accessibility AA, keyboard, ≥ 16 px | required | visible focus, `aria-live`, text ≥ 16 px |
| RNF-07 | initial bundle | < 300 KB gzip | ~127 KB gzip JS + 8 KB CSS |
| RNF-08 | availability | 24/7 | GitHub Pages workflow configured (static, no backend); verify current deployment — see [`DEMO.md`](DEMO.md) |
| RNF-09 | quota exhausted → clear message + BYOK | required | plain-English message, BYOK field |
| RNF-10 | no paid dependency | required | $0 |

## Privacy

No image is persisted, neither on the client nor on the proxy. The name is masked before any
display. The proxy only logs the timestamp, the HTTP status and the latency. Local history can be
exported and deleted in one click, and the UI says so. Credential handling and the full privacy
design are documented in [`SECURITY.md`](SECURITY.md).

## CI and infrastructure

CI in under 5 minutes on GitHub-hosted runners (`ubuntu-latest`); three required checks (`ci`,
`ci-budget`, `couche0`); merges through the Mergify queue; GitHub Pages deploys on every push to
`main`. Details: [`docs/INFRA-CI.md`](docs/INFRA-CI.md).

## Licence

MIT — see [`LICENSE`](LICENSE). External libraries and corpus assets are credited in
[`CREDITS.md`](CREDITS.md); AI-assisted work is declared in
[`docs/AI-DISCLOSURE.md`](docs/AI-DISCLOSURE.md).

## Provenance

This project is a rebrand of an existing codebase. Work completed during the event is separated
from pre-existing code, templates and assets in [`PROVENANCE.md`](PROVENANCE.md), with dates
verifiable from the preserved Git history (`git log`).

## Submission compliance

- **Deadline:** the submitter must submit before the published deadline; this repository does not
  claim that submission has already happened.
- **Distinguish event work:** pre-existing code and assets are identified in
  [`PROVENANCE.md`](PROVENANCE.md).
- **Credit sources:** libraries, datasets/assets and AI-assisted tools are listed in
  [`CREDITS.md`](CREDITS.md).
- **Permission to use materials:** the corpus is synthetic and generated in-repository; font
  licences and design-mockup permission are marked "to be confirmed by the submitter" in
  [`CREDITS.md`](CREDITS.md).
- **No exposed secrets:** no credentials are committed; environment-variable names and handling
  rules are in [`SECURITY.md`](SECURITY.md).
- **Accessible demonstration:** setup and the key-free offline demo are explained in
  [`DEMO.md`](DEMO.md); no undeployed live URL is advertised.
