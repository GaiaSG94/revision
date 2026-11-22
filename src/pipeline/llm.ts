/**
 * LLM client — [OI]-compatible API served by InferHub.
 *
 * Two paths, a single request shape:
 *  - edge proxy (default): `/api/analyze`, the InferHub key stays server-side;
 *  - BYOK: the user's key goes in the `x-revision-cle` header, the proxy uses it
 *    instead of its own (safety net for judging day).
 *
 * No secret here: this module runs in the browser, with no embedded key.
 */
import {
  BUDGET_APPEL_MS,
  CHAINE_MODELES,
  DELAI_APPEL_MS,
  MODELE_PAR_DEFAUT,
  PROXY_PAR_DEFAUT,
} from '../domain/config'

export type RequeteLLM = {
  system: string
  user: string
  /** Image as a data URL (base64) — never persisted, never logged. */
  image?: string
  /** forces a strict JSON response on the model side. */
  json?: boolean
  temperevision?: number
  maxTokens?: number
}

export type Transport = {
  proxy: string
  cle?: string
  modele?: string
  /** true = the proxy answers in SSE and publishes its progress (idea 7). */
  stream?: boolean
  /** Notified at each proxy step: "model 2/6 tried, 503". */
  surProgres?: (message: string) => void
  /** Notified when a model actually answered (on-screen transparency). */
  surModele?: (modele: string, tentatives: number) => void
  /** Chain reordered by the availability probe (idea 5). */
  chaine?: string[]
}

export type ReponseProxy = {
  texte?: string
  erreur?: string
  /** `proxy` = shared proxy quota (BYOK is the only recourse). */
  quota?: string
  /** Model that actually answered (the proxy walks its own chain). */
  modele?: string
  tentatives?: number
  /** The proxy already exhausted its chain: no point replaying ours. */
  chaineEpuisee?: boolean
}

export class ErreurLLM extends Error {
  readonly statut: number
  /** true when it is the shared proxy quota: the only recourse is BYOK. */
  readonly quotaProxy: boolean
  /** true when the proxy already walked its whole chain: we do not replay ours. */
  readonly chaineEpuisee: boolean
  constructor(message: string, statut = 0, options: { quotaProxy?: boolean; chaineEpuisee?: boolean } = {}) {
    super(message)
    this.name = 'ErreurLLM'
    this.statut = statut
    this.quotaProxy = options.quotaProxy ?? false
    this.chaineEpuisee = options.chaineEpuisee ?? false
  }
}

export function transportParDefaut(proxy = PROXY_PAR_DEFAUT): Transport {
  return { proxy, modele: MODELE_PAR_DEFAUT }
}

type Partie =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export function construireMessages(requete: RequeteLLM): unknown[] {
  const parties: Partie[] = []
  if (requete.image) parties.push({ type: 'image_url', image_url: { url: requete.image } })
  parties.push({ type: 'text', text: requete.user })

  return [
    { role: 'system', content: requete.system },
    {
      role: 'user',
      // Text only: a simple form accepted by all models.
      content: requete.image ? parties : requete.user,
    },
  ]
}

export function construireCorps(requete: RequeteLLM, modele: string): Record<string, unknown> {
  const corps: Record<string, unknown> = {
    model: modele,
    messages: construireMessages(requete),
    temperevision: requete.temperevision ?? 0.2,
    max_tokens: requete.maxTokens ?? 2000,
  }
  if (requete.json) corps.response_format = { type: 'json_object' }
  return corps
}

/**
 * Tried chain: the requested model first, then the fallbacks. If an
 * availability probe reordered the chain (`transport.chaine`), it takes
 * precedence.
 */
export function chaineModeles(transport: Transport): string[] {
  const premier = transport.modele?.trim() || MODELE_PAR_DEFAUT
  const suite = transport.chaine?.length ? transport.chaine : CHAINE_MODELES
  return [premier, ...suite.filter((modele) => modele !== premier)]
}

/**
 * Transient statuses: 402 (out of auction), 429 (rate limit), 5xx (no
 * capacity, slow or unreachable upstream). On any of them we walk down the
 * model chain.
 */
const REESSAYABLES = new Set([402, 429, 500, 502, 503, 504])
const ATTENTE_429_MS = 2500

function attendre(ms: number): Promise<void> {
  return new Promise((resoudre) => setTimeout(resoudre, ms))
}

/** An SSE event: `event: name` + `data: {…}`. */
type EvenementFlux = { nom: string; donnees: Record<string, unknown> }

function parserEvenement(brut: string): EvenementFlux | null {
  let nom = 'message'
  let donnees = ''
  for (const ligne of brut.split('\n')) {
    if (ligne.startsWith('event:')) nom = ligne.slice(6).trim()
    else if (ligne.startsWith('data:')) donnees += ligne.slice(5).trim()
  }
  if (!donnees) return null
  try {
    return { nom, donnees: JSON.parse(donnees) as Record<string, unknown> }
  } catch {
    return null
  }
}

/** Readable message for the analysis screen: we say what the proxy is trying. */
export function messageProgres(donnees: Record<string, unknown>): string {
  const modele = typeof donnees.modele === 'string' ? donnees.modele.split('/').pop() : 'model'
  const essai = typeof donnees.essai === 'number' ? donnees.essai : 0
  const statut = donnees.statut ?? '?'
  return `${modele} unavailable (${statut}) — attempt ${essai}, next model…`
}

/**
 * Streaming call (SSE): the proxy publishes each attempt while the upstream
 * thinks. Without it, the student watches a spinner for 30 to 60 s; with it,
 * they see the fallback chain working — waiting becomes a demonstration.
 */
async function appelerEnFlux(transport: Transport, requete: RequeteLLM, modele: string): Promise<string> {
  const entetes: Record<string, string> = { 'content-type': 'application/json' }
  if (transport.cle) entetes['x-revision-cle'] = transport.cle

  let reponse: Response
  try {
    reponse = await fetch(transport.proxy, {
      method: 'POST',
      headers: entetes,
      body: JSON.stringify({ ...construireCorps(requete, modele), stream: true }),
      signal: AbortSignal.timeout(DELAI_APPEL_MS),
    })
  } catch (erreur) {
    if (erreur instanceof Error && erreur.name === 'TimeoutError') {
      throw new ErreurLLM('The model is taking too long to answer.', 504)
    }
    throw new ErreurLLM('Network unavailable. Check your connection and try again.', 0)
  }
  if (!reponse.ok) throw await erreurDepuisReponse(reponse)

  const type = reponse.headers.get('content-type') ?? ''
  // A proxy that does not speak SSE: fall back to the classic JSON path.
  if (!type.includes('text/event-stream') || !reponse.body) return lireCorpsJson(reponse, transport)
  return lireFlux(reponse, transport)
}

async function lireFlux(reponse: Response, transport: Transport): Promise<string> {
  const lecteur = reponse.body!.getReader()
  const decodeur = new TextDecoder()
  let tampon = ''
  let texte = ''
  for (;;) {
    const { done, value } = await lecteur.read()
    if (done) break
    tampon += decodeur.decode(value, { stream: true })
    let separateur = tampon.indexOf('\n\n')
    while (separateur >= 0) {
      const evenement = parserEvenement(tampon.slice(0, separateur))
      tampon = tampon.slice(separateur + 2)
      separateur = tampon.indexOf('\n\n')
      if (!evenement) continue
      if (evenement.nom === 'progres') {
        transport.surProgres?.(messageProgres(evenement.donnees))
      } else if (evenement.nom === 'resultat') {
        texte = String(evenement.donnees.texte ?? '')
        if (typeof evenement.donnees.modele === 'string') {
          transport.surModele?.(evenement.donnees.modele, Number(evenement.donnees.tentatives ?? 1))
        }
      } else if (evenement.nom === 'erreur') {
        throw new ErreurLLM(
          String(evenement.donnees.erreur ?? 'Upstream unavailable.'),
          Number(evenement.donnees.statut ?? 503),
          { chaineEpuisee: true },
        )
      }
    }
  }
  if (!texte.trim()) throw new ErreurLLM('Empty response from the model.', 502)
  return texte
}

async function lireCorpsJson(reponse: Response, transport: Transport): Promise<string> {
  let data: ReponseProxy
  try {
    data = (await reponse.json()) as ReponseProxy
  } catch {
    throw new ErreurLLM('Unreadable proxy response (JSON expected).', 502)
  }
  const texte = typeof data.texte === 'string' ? data.texte : ''
  if (texte.trim().length === 0) throw new ErreurLLM('Empty response from the model.', 502)
  if (typeof data.modele === 'string' && data.modele) {
    transport.surModele?.(data.modele, data.tentatives ?? 1)
  }
  return texte
}

/** One call, one model, one text. Every error becomes ErreurLLM + status. */
async function appeler(transport: Transport, requete: RequeteLLM, modele: string): Promise<string> {
  if (transport.stream) return appelerEnFlux(transport, requete, modele)
  const entetes: Record<string, string> = { 'content-type': 'application/json' }
  if (transport.cle) entetes['x-revision-cle'] = transport.cle

  let reponse: Response
  try {
    reponse = await fetch(transport.proxy, {
      method: 'POST',
      headers: entetes,
      body: JSON.stringify(construireCorps(requete, modele)),
      signal: AbortSignal.timeout(DELAI_APPEL_MS),
    })
  } catch (erreur) {
    if (erreur instanceof Error && erreur.name === 'TimeoutError') {
      throw new ErreurLLM('The model is taking too long to answer.', 504)
    }
    throw new ErreurLLM('Network unavailable. Check your connection and try again.', 0)
  }

  // `await` is essential: without it we would throw a Promise, not an error —
  // hence no fallback to the next model, no readable message (bug of 11/11).
  if (!reponse.ok) throw await erreurDepuisReponse(reponse)

  // A non-JSON body (host error page, proxy returning HTML) must not leak as a
  // SyntaxError: we translate it into a usable ErreurLLM.
  return lireCorpsJson(reponse, transport)
}

/** The proxy returns `{erreur, quota?}`: we show its message, not a generic one. */
async function erreurDepuisReponse(reponse: Response): Promise<ErreurLLM> {
  let data: ReponseProxy = {}
  try {
    data = (await reponse.json()) as ReponseProxy
  } catch {
    data = {}
  }
  const chaineEpuisee = data.chaineEpuisee === true
  if (reponse.status === 429) {
    // Shared proxy quota: the user's key is the only recourse.
    if (data.quota === 'proxy') {
      return new ErreurLLM(
        `${data.erreur || 'Proxy quota reached.'} Paste your own key in Settings, or try again later.`,
        429,
        { quotaProxy: true },
      )
    }
    // Provider rate limit: transient, retry after a pause.
    return new ErreurLLM(data.erreur || 'Model provider rate limit.', 429)
  }
  const message = data.erreur || `Analysis refused (HTTP ${reponse.status}).`
  return new ErreurLLM(message, reponse.status, { chaineEpuisee })
}

/** A "provider" 429 deserves a second chance after a short pause. */
async function appelerAvecPause(
  transport: Transport,
  requete: RequeteLLM,
  modele: string,
): Promise<string> {
  try {
    return await appeler(transport, requete, modele)
  } catch (erreur) {
    if (!(erreur instanceof ErreurLLM) || erreur.statut !== 429 || erreur.quotaProxy) throw erreur
    await attendre(ATTENTE_429_MS)
    return appeler(transport, requete, modele)
  }
}

/**
 * InferHub is a marketplace: a model can be out of capacity (503) or out of
 * auction (402) at the moment of the call — measured on 11 November: 5 of the
 * 6 vision models were in 503 simultaneously. So we walk the whole chain
 * before giving up. Only exception: the shared proxy quota, where changing
 * models changes nothing (the recourse is the personal key).
 */
export async function completer(transport: Transport, requete: RequeteLLM): Promise<string> {
  let derniere: ErreurLLM | null = null
  let arreteeParBudget = false
  const echeance = Date.now() + BUDGET_APPEL_MS
  const chaine = chaineModeles(transport)
  for (const [index, modele] of chaine.entries()) {
    if (Date.now() > echeance) {
      arreteeParBudget = true
      break
    }
    // Visibility: even without SSE, the user knows which model is being tried.
    // Without this message, a saturated upstream leaves the screen stuck in
    // silence (bug of 15/11).
    transport.surProgres?.(
      `trying model ${index + 1}/${chaine.length}: ${modele.split('/').pop() ?? modele}…`,
    )
    try {
      return await appelerAvecPause(transport, requete, modele)
    } catch (erreur) {
      if (!(erreur instanceof ErreurLLM)) throw erreur
      // The proxy already walked its whole chain: replaying ours would only
      // multiply round trips for the same result.
      if (erreur.quotaProxy || erreur.chaineEpuisee || !REESSAYABLES.has(erreur.statut)) throw erreur
      derniere = erreur
      transport.surProgres?.(messageProgres({ modele, essai: index + 1, statut: erreur.statut }))
    }
  }
  if (arreteeParBudget) {
    throw new ErreurLLM(
      'The model provider is too slow right now. Try again in a moment — or run the offline demo below.',
      504,
    )
  }
  throw derniere ?? new ErreurLLM('No model available right now.', 503)
}

/** Extracts the first JSON object from a text (the model sometimes wraps it). */
export function extraireJson(texte: string): unknown {
  const direct = tentativeParse(texte)
  if (direct !== undefined) return direct
  const debut = texte.indexOf('{')
  const fin = texte.lastIndexOf('}')
  if (debut >= 0 && fin > debut) {
    const interne = tentativeParse(texte.slice(debut, fin + 1))
    if (interne !== undefined) return interne
  }
  throw new ErreurLLM('The model answered outside JSON format.', 502)
}

function tentativeParse(texte: string): unknown {
  try {
    return JSON.parse(texte)
  } catch {
    return undefined
  }
}
