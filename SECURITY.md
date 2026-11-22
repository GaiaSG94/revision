# Security and privacy

## Credentials

**No password, API key, token or other credential is committed in this submission.** The only
credential-shaped material found while preparing these documents was a truncated key fragment in a
pre-existing documentation file preserved in Git history; it has been removed from the current
working-tree version of that file. No value is reproduced in this document or in any other `.md`
file. Any historical secret-like string must be treated as exposed and rotated by the submitter.

Secrets must be **injected through the environment at runtime or deploy time**, never written to a
file, pasted into documentation, or committed:

- Cloudflare Worker: `wrangler secret put INFERHUB_API_KEY`;
- Vercel: project environment variables;
- local runs: shell environment or an untracked `.env` file (`.env.example` contains **names
  only**, no values).

The edge proxy keeps `INFERHUB_API_KEY` server-side; the browser never receives it. In BYOK mode
the user's own key travels in the `x-revision-cle` request header and remains in session memory on
the user's device (`src/storage/local.ts` explicitly excludes it from IndexedDB).

## Environment variable names used

Names only; no values are given or stored here.

| Name | Where it appears | Purpose |
|---|---|---|
| `INFERHUB_API_KEY` | `.env.example`, `api/analyze.ts`, `worker/worker.js`, `proxy/modal_app.py`, workflows, live tests | Model API key, server-side or supplied by the user |
| `REVISION_AMONT` | `.env.example`, `api/analyze.ts`, `proxy/modal_app.py`, live tests | OpenAI-compatible upstream base URL |
| `REVISION_MODELE` | live tests, validation notes | Optional model override |
| `REVISION_PROXY_URL` | `pages.yml`, `prewarm.yml`, recording test | Repository variable for the deployed proxy URL |
| `VITE_BASE` | `vite.config.ts`, `pages.yml` | Build-time base path |
| `VITE_PROXY_URL` | `src/domain/config.ts`, `pages.yml` | Build-injected proxy URL (public endpoint, not a secret) |
| `REVISION_MAX_IN_PRICE`, `REVISION_MAX_OUT_PRICE` | `proxy/modal_app.py` | Optional bid ceilings |
| `REVISION_POLICE_MANUSCRITE`, `REVISION_POLICE_IMPRIME` | `scripts/generer-copies.py` | Local font paths for corpus generation |
| `RECORD_COPIES` | `tests/live/enregistrer-demo.test.ts` | Selects a subset when re-recording the demo |
| `FIREWORKS_API_KEY` | `.github/fireworks/`, CI workflows | Key for the CI conflict/scope agents (historical variable name, InferHub endpoint) |
| `FIREWORKS_BASE_URL`, `FIREWORKS_MODEL` | `.github/fireworks/`, CI workflows | Agent endpoint and model name |
| `FIREWORKS_AGENT_RESOLVE`, `FIREWORKS_AGENT_SCOPE` | `.github/fireworks/`, CI workflows | Kill switches for the CI agents |

`x-revision-cle` is an HTTP header, not an environment variable.

## Privacy design

- **No image persistence.** The photo is normalised to an in-memory data URL (`src/pipeline/ingest.ts`)
  and is never written to IndexedDB or to any server (`docs/ARCHITECTURE.md`, requirement RNF-P1).
  It is sent to the model as base64 in the request body only when the user chooses live analysis.
- **Name masking before display.** Step 2 pixelates the header banner where the student's name
  usually appears (`src/pipeline/anonymize.ts`, requirement RNF-P2); pixelation is used rather than
  a blur, which could be guessed.
- **Local-only history.** Diagnostics, the aggregated profile and settings live in IndexedDB via
  `idb-keyval` (`src/storage/local.ts`); they contain codes, text excerpts and scores — no image,
  no name, no API key.
- **Export and delete.** The Settings screen can export or clear the local history
  (requirement RNF-P4), and the UI states this explicitly (RNF-P5).
- **Minimal proxy logging.** The edge proxy records timestamp, HTTP status and latency, not image
  content or extracted text (`api/analyze.ts`, requirement RNF-P3).
- **Offline demo contains no personal data.** `corpus/` consists of synthetic papers and recorded
  model answers; no photograph of an identified student is included.

## Reporting a suspected secret

If a credential appears in a file, log, diff or chat message: do not copy its value, remove the
occurrence, rotate the credential at its provider, and record only the affected variable name and
the action taken. Never paste a value into a chat, an issue, a commit message or a document.
