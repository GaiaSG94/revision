# Demo guide for judges

## Live demo

**<https://gaiasg94.github.io/revision/>** — public HTTPS, no account, no installation. Verified
HTTP 200 after the `pages` workflow succeeded. It is served by GitHub Pages from this repository's
`main` branch (`.github/workflows/pages.yml`, `VITE_BASE=/revision/`). The live path's model calls
depend on a configured edge proxy or a user-supplied key; the offline path below does not.

An older deployment of the upstream project exists under a different name; it is **not** evidence
for this submission — see [`PROVENANCE.md`](PROVENANCE.md).

**Recommended fallback:** the self-contained offline path below needs no API key, no account, no
network access and no deployed service. Judges can use either path.

## Offline demo path (recommended)

```bash
node --version        # Node >= 20
npm ci
npm run dev           # open http://localhost:5173
```

On the home screen:

1. **Try a sample paper** — pick one of the recorded papers. The app replays real model answers
   and their measured timings from `corpus/reponses/`, with **no network call and no key**. A clean
   paper returns "no mistake detected" with zero simulated classification calls.
2. **Watch the demo** — a guided multi-paper tour: four papers from the same student (Jordan),
   showing the diagnosis, the error profile, its trajectory and the teacher view entirely offline.

Both buttons are visible on the home screen and are labelled as recorded/offline in the UI. The
recordings are data files in `corpus/reponses/`; adding a new recording extends the demo without
code changes. Details: [`corpus/README.md`](corpus/README.md) and
[`docs/VALIDATION-MODELE.md`](docs/VALIDATION-MODELE.md).

The displayed durations are genuinely measured marketplace durations, replayed with capped waits;
they are not model inference times. This is stated explicitly in the project documentation.

## Verifying the offline demo

- `npm test` — runs the offline suite only (live API tests are excluded by `vitest.config.ts`).
  `npm run test:live` runs the optional live validation when credentials are configured.
- `npm run typecheck` — strict TypeScript check.
- `npm run build` — production build into `dist/`.
- Open the browser Network tab: offline replay performs **no** model request. For a live analysis,
  the image is sent as base64 in the request body and is not persisted.
- Local history is in IndexedDB (`idb-keyval`); the Settings screen can export and clear it.

## Optional: live analysis path (requires a configured proxy or your own key)

The live path is **not required** to evaluate the project. If the submitter has configured an edge
proxy or wants to use BYOK:

- Environment variable **names** used by the code, workflows and deploy configuration (no values
  are given here, and none are stored in this repository):
  - from `.env.example`: `INFERHUB_API_KEY`, `REVISION_AMONT`;
  - build/deploy: `VITE_BASE`, `VITE_PROXY_URL`, repository variable `REVISION_PROXY_URL`;
  - optional model override: `REVISION_MODELE`;
  - Modal proxy options: `REVISION_MAX_IN_PRICE`, `REVISION_MAX_OUT_PRICE`;
  - CI conflict/scope agents: `FIREWORKS_API_KEY`, `FIREWORKS_BASE_URL`, `FIREWORKS_MODEL`,
    `FIREWORKS_AGENT_RESOLVE`, `FIREWORKS_AGENT_SCOPE`;
  - local generation/recordings: `REVISION_POLICE_MANUSCRITE`, `REVISION_POLICE_IMPRIME`,
    `RECORD_COPIES`.
- The HTTP header `x-revision-cle` carries a user-supplied key in BYOK mode; it stays on the device.
- Secrets must be injected at deploy time (for example `wrangler secret put INFERHUB_API_KEY` or a
  Vercel project environment variable), never written to a file. See
  [`SECURITY.md`](SECURITY.md).

## Accessibility already present in the app

Based on the source and the stated non-functional requirement RNF-06:

- keyboard-operable controls, including clickable fault zones implemented as buttons with
  descriptive `aria-label` and `aria-pressed` state (`src/ui/components/ZoneFaute.tsx`);
- visible keyboard focus (`:focus-visible` outline in `src/styles.css`);
- status updates announced with `aria-live="polite"` on the pipeline steps
  (`src/ui/components/EtapesPipeline.tsx`) and errors exposed with `role="alert"`;
- labelled navigation and chart alternatives (`aria-label`, `role="img"`);
- base text size of 16 px, with `prefers-reduced-motion: reduce` honoured globally in
  `src/styles.css` and by the animated board in `src/ui/components/BoardDuo.tsx`;
- no red used for diagnosis in the UI (amber for diagnosis, green for progress), since the paper
  itself is already marked in red.

Some decorative labels are intentionally smaller than the base size; the accessibility target is
described as AA in the README rather than independently audited here.

## Provenance and compliance

See [`PROVENANCE.md`](PROVENANCE.md) for what predates this event,
[`CREDITS.md`](CREDITS.md) for libraries, assets and AI tools, and
[`SECURITY.md`](SECURITY.md) for credential handling and privacy.
