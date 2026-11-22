/**
 * Edge proxy probe — batch 2. Gives the user an honest signal before starting
 * an analysis: if the upstream is offline, we say so and offer the demo rather
 * than letting them wait 90 s for a failure.
 *
 * The probe is a simple `GET /health` (the Modal proxy exposes one, CPU only).
 * No key is sent, no quota consumed.
 */
import { PROXY_PAR_DEFAUT } from '../domain/config'

export type SanteProxy = 'ok' | 'ko' | 'inconnue'

/**
 * 12 s and a second attempt: the Modal proxy scales to zero, and a cold start
 * takes ~5 s. With a 5 s timeout, the probe wrongly reported "model
 * unavailable" on a cold container (observed in the browser).
 */
const DELAI_SONDE_MS = 12_000
const TENTATIVES = 2
const PAUSE_ENTRE_ESSAIS_MS = 1500

/** URL to probe: replace `/analyze` (the POST) with `/health` (the probe). */
export function urlSante(proxy: string): string {
  const base = proxy.replace(/\/analyze\/?$/, '').replace(/\/+$/, '')
  return `${base}/health`
}

/**
 * A same-origin proxy (or an empty address) has no deployed `/health`: probing
 * would give a 404 from the static host, hence a false "unavailable". Real bug
 * of 11/11: settings loaded after the first render left an empty string, and
 * the probe went to `https://<pages>/health`.
 */
function estSondable(proxy: string): boolean {
  // Only an absolute address has a `/health` reachable over CORS. An empty or
  // relative address (the same-origin fallback of a Vercel/Worker deployment)
  // is not probed: we return "inconnue" rather than a false "unavailable".
  // Note: PROXY_PAR_DEFAUT is ABSOLUTE in production (VITE_PROXY_URL is injected
  // at build time) — it must therefore remain probeable.
  return /^https?:\/\//.test(proxy)
}

function attendre(ms: number): Promise<void> {
  return new Promise((resoudre) => setTimeout(resoudre, ms))
}

async function sonderUneFois(proxy: string): Promise<SanteProxy> {
  try {
    const reponse = await fetch(urlSante(proxy), {
      method: 'GET',
      signal: AbortSignal.timeout(DELAI_SONDE_MS),
    })
    return reponse.ok ? 'ok' : 'ko'
  } catch {
    return 'ko'
  }
}

export type EtatModeles = { chaine: string[]; disjoncteur: Record<string, number> }

/**
 * Probes model availability (idea 5): the proxy holds a circuit breaker per
 * model (cooldown after a 402/503). We reorder the chain to start with a live
 * model — every dead model avoided saves 1 to 2 s. No model call: we read the
 * proxy's state, so it is free.
 */
export async function sonderModeles(proxy = PROXY_PAR_DEFAUT): Promise<string[] | null> {
  if (!estSondable(proxy)) return null
  try {
    const reponse = await fetch(urlSante(proxy).replace(/\/health$/, '/modeles'), {
      signal: AbortSignal.timeout(DELAI_SONDE_MS),
    })
    if (!reponse.ok) return null
    const etat = (await reponse.json()) as EtatModeles
    return reordonner(etat)
  } catch {
    return null
  }
}

/** Live models first (in chain order), cooling-down models afterwards. */
export function reordonner(etat: EtatModeles): string[] | null {
  if (!Array.isArray(etat?.chaine) || etat.chaine.length === 0) return null
  const morts = etat.disjoncteur && typeof etat.disjoncteur === 'object' ? etat.disjoncteur : {}
  const vivants = etat.chaine.filter((modele) => !(modele in morts))
  const refroidis = etat.chaine.filter((modele) => modele in morts)
  return [...vivants, ...refroidis]
}

export async function sonderProxy(proxy = PROXY_PAR_DEFAUT): Promise<SanteProxy> {
  if (!estSondable(proxy)) return 'inconnue'
  for (let essai = 1; essai <= TENTATIVES; essai += 1) {
    const etat = await sonderUneFois(proxy)
    if (etat === 'ok' || essai === TENTATIVES) return etat
    await attendre(PAUSE_ENTRE_ESSAIS_MS)
  }
  return 'ko'
}