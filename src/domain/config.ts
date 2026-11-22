/** Product settings — a single place for the spec's thresholds. */

/** §17: below this confidence, the error becomes E99 and leaves the profile. */
export const SEUIL_CONFIANCE = 0.6

/** §18.3: two attempts maximum, then an honest message. */
export const MAX_TENTATIVES_EXERCICE = 2

/**
 * Second pass (batch 3): a typed error with a confidence below this threshold
 * is re-checked by a second, text-only call. Target: false positives, the risk
 * the spec qualifies as fatal (RNF-04).
 */
export const SEUIL_REVUE = 0.75

/** Beyond this number, only the least certain ones are reviewed (bounded latency). */
export const MAX_FAUTES_A_REVOIR = 5

/**
 * Input safeguards (crash test of 12/11): a model can return 10,000
 * annotations, 100 KB lines or absurd confidences. Without a cap, the UI
 * freezes and the profile becomes unreadable. We bound, we do not reject.
 */
export const MAX_ANNOTATIONS = 50
export const MAX_LONGUEUR_LIGNE = 300
export const MAX_LONGUEUR_TEXTE = 400

/**
 * Bounds for a model call (crash test of 12/11). Without them, a saturated
 * upstream makes you wait 6 models × 90 s, i.e. 9 minutes, before regaining
 * control.
 *
 * Calibrated by measurement, not guessed:
 *  - the proxy abandons an upstream call at 90 s (`DELAI_MS` in `proxy/modal_app.py`);
 *  - the client waits a little longer (100 s) so that it is the **proxy** that
 *    returns 504 with a usable message, rather than a local abort;
 *  - a 5-token text call took 56.7 s on 12/11 at 1 p.m.: a 60 s timeout would
 *    have cut off legitimate calls.
 * The overall budget bounds total waiting to ~2 attempts in the worst case.
 */
/** The local cache avoids paying again for an already analysed photo. */
export const CACHE_ACTIVE_PAR_DEFAUT = true

export const DELAI_APPEL_MS = 100_000
export const BUDGET_APPEL_MS = 200_000

/** §18.2: total photo → result budget. */
export const BUDGET_PIPELINE_MS = 20_000

/** RF-01: maximum accepted size before normalization. */
export const TAILLE_MAX_IMAGE_OCTETS = 10 * 1024 * 1024

/** Step 1: normalize to 1600 px wide — enough for handwriting, light to send. */
export const LARGEUR_CIBLE_IMAGE = 1600

/** Local storage keys (IndexedDB via idb-keyval). */
export const CLES = {
  diagnostics: 'revision/diagnostics',
  profil: 'revision/profil',
  reglages: 'revision/reglages',
  /** Prefix of the local analysis cache (SHA-256 fingerprint of the image). */
  cache: 'revision/cache',
} as const

/**
 * Edge proxy. The public URL is injected at build time (`VITE_PROXY_URL`, set
 * by the pages.yml workflow from the repository variable `REVISION_PROXY_URL`);
 * locally, the same-origin `/api/analyze` fallback remains valid. No key enters
 * the bundle: only the proxy address.
 */
const proxyInjecte = (import.meta.env?.VITE_PROXY_URL as string | undefined)?.trim()
export const PROXY_PAR_DEFAUT = proxyInjecte || '/api/analyze'

/**
 * Default model (InferHub, [OI]-compatible API). Chosen for latency:
 * `ag/gemini-4-carbon` answers in ~16 s where `ag/gemini-3.8-flash-high`
 * takes ~50 s (measured on 11 November on the corpus papers).
 */
export const MODELE_PAR_DEFAUT = 'ag/gemini-4-carbon'

/**
 * Fallback chain: InferHub is a marketplace; a model can be out of capacity
 * (503) or out of auction (402) from one minute to the next — measured on
 * 11 November: 5 of the 6 vision models were in 503 simultaneously, the sixth
 * answered. So we walk down the whole `ag/` family (the only one that answers
 * without an auction parameter) before giving up.
 *
 * Order: fastest to slowest (16 s → 50 s on a corpus paper).
 */
export const CHAINE_MODELES = [
  'ag/gemini-4-carbon',
  'ag/claude-sonnet-4-6',
  'ag/gemini-4-argon',
  'ag/claude-sonnet-5-5',
  'ag/gemini-3.8-flash-high',
  // zai/glm-4.6v: cheap vision (0.0003 USDC/Mtok), "Z.AI GLM Coding
  // Plan" family allowed by the InferHub account (the ali/ oai/ cb/ cc/ families are
  // filtered by "Models & pricing" — see docs/INFERHUB.md).
  'zai/glm-4.6v',
  'ag/claude-opus-4-6-thinking',
]

/** [OI]-compatible upstream used by the edge proxy. */
export const AMONT_PAR_DEFAUT = 'https://api.inferhub.dev/v1'
