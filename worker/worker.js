/**
 * Cloudflare Worker variant of the proxy (§18.1) — same contract as the Modal
 * proxy, zero dependencies. The quota is in memory per isolate: an accepted
 * approximation (a Worker restarts often), enough to bound a demo quota.
 *
 * This Worker does not speak SSE: the `stream` field is removed before relaying,
 * the response stays JSON and the client falls back to its classic path.
 *
 * Like the Modal proxy, it walks **the model chain server-side**: InferHub is a
 * marketplace, a model can be out of capacity (503) or out of auction (402)
 * from one minute to the next.
 *
 * Deployment: `wrangler deploy worker/worker.js --name revision-proxy`
 * then `wrangler secret put INFERHUB_API_KEY`.
 */

const TAILLE_MAX = 15 * 1024 * 1024
const PAR_IP_PAR_HEURE = 20
const HEURE_MS = 60 * 60 * 1000
const COOLDOWN_S = 60
const DELAI_AMONT_MS = 60_000
const REESSAYABLES = new Set([402, 429, 500, 502, 503, 504])

const historique = new Map()
const horsService = new Map()

const ORIGINES = [
  'https://gaiasg94.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

/** Server chain, aligned with CHAINE_MODELES in src/domain/config.ts. */
const CHAINE = [
  'ag/gemini-4-carbon',
  'ag/claude-sonnet-4-6',
  'ag/gemini-4-argon',
  'ag/claude-sonnet-5-5',
  'ag/gemini-3.8-flash-high',
  'zai/glm-4.6v',
  'ag/claude-opus-4-6-thinking',
]

const AMONT = 'https://api.inferhub.dev/v1'

/** The CORS header is only returned for a known origin. */
function entetesCors(request) {
  const origine = request.headers.get('origin')
  if (!origine || !ORIGINES.includes(origine)) return {}
  return {
    'access-control-allow-origin': origine,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-revision-cle',
    'access-control-max-age': '600',
    vary: 'Origin',
  }
}

function autoriser(id, maintenant) {
  const fenetre = (historique.get(id) || []).filter((t) => maintenant - t < HEURE_MS)
  if (fenetre.length >= PAR_IP_PAR_HEURE) {
    historique.set(id, fenetre)
    return false
  }
  fenetre.push(maintenant)
  historique.set(id, fenetre)
  return true
}

function json(corps, statut = 200, cors = {}) {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...cors,
    },
  })
}

function empreinte(ip) {
  let h = 0
  for (let i = 0; i < ip.length; i += 1) h = (h * 31 + ip.charCodeAt(i)) >>> 0
  return `v${h.toString(36)}`
}

/** A dead model (402/503) is not retried for 60 s. */
function disponible(modele, maintenant) {
  return (horsService.get(modele) || 0) <= maintenant
}

function signaler(modele, maintenant, panne) {
  if (panne) horsService.set(modele, maintenant + COOLDOWN_S)
  else horsService.delete(modele)
}

function etatDisjoncteur(maintenant) {
  const etat = {}
  for (const [modele, fin] of horsService) if (fin > maintenant) etat[modele] = Number((fin - maintenant).toFixed(1))
  return etat
}

/** Requested model first, then the rest of the chain, without duplicates. */
function chainePour(demande) {
  if (!demande) return [...CHAINE]
  return [demande, ...CHAINE.filter((m) => m !== demande)]
}

/** One upstream call: JSON in, `{statut, texte|erreur}` out. On 429
 *  ("retry shortly"), a single 3 s pause before giving up. */
async function appelerAmont(charge, modele, cle) {
  const tenter = () =>
    fetch(`${AMONT}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cle}` },
      body: JSON.stringify({ ...charge, model: modele }),
      signal: AbortSignal.timeout(DELAI_AMONT_MS),
    })
  let reponse = await tenter()
  if (reponse.status === 429) {
    await new Promise((resoudre) => setTimeout(resoudre, 3000))
    reponse = await tenter()
  }
  const data = await reponse.json()
  if (reponse.status === 200) {
    const texte = data?.choices?.[0]?.message?.content || ''
    if (!texte) return { statut: 502, erreur: 'Empty response from the model.' }
    return { statut: 200, texte }
  }
  return { statut: reponse.status, erreur: data?.error?.message || 'Upstream unavailable.' }
}

/** Walks the chain: a dead model does not cost a client round trip. */
async function relayer(charge, cle, maintenant) {
  let derniereErreur = 'no model available'
  let dernierStatut = 503
  let tentatives = 0
  for (const modele of chainePour(charge.model)) {
    if (!disponible(modele, maintenant)) continue
    tentatives += 1
    let resultat
    try {
      resultat = await appelerAmont(charge, modele, cle)
    } catch {
      signaler(modele, maintenant, true)
      derniereErreur = 'Upstream unreachable or too slow.'
      dernierStatut = 504
      continue
    }
    if (resultat.statut === 200) {
      signaler(modele, maintenant, false)
      return { statut: 200, texte: resultat.texte, modele, tentatives }
    }
    signaler(modele, maintenant, REESSAYABLES.has(resultat.statut))
    dernierStatut = resultat.statut
    derniereErreur = resultat.erreur
    if (!REESSAYABLES.has(resultat.statut)) break
  }
  return { erreur: derniereErreur, statut: dernierStatut, tentatives, chaineEpuisee: true }
}

export default {
  async fetch(request, env) {
    const cors = entetesCors(request)
    const chemin = new URL(request.url).pathname
    const maintenant = Date.now()

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method === 'GET' && chemin === '/health') {
      return json({ ok: true, service: 'revision-proxy-worker', disjoncteur: etatDisjoncteur(maintenant) }, 200, cors)
    }
    if (request.method === 'GET' && chemin === '/modeles') {
      return json({ chaine: CHAINE, disjoncteur: etatDisjoncteur(maintenant), amont: AMONT }, 200, cors)
    }
    if (request.method !== 'POST') return json({ erreur: 'Method not allowed.' }, 405, cors)

    const cle = request.headers.get('x-revision-cle') || env.INFERHUB_API_KEY
    if (!cle) return json({ erreur: 'Proxy not configured: paste your key (BYOK).' }, 503, cors)

    const ip = request.headers.get('cf-connecting-ip') || 'inconnu'
    if (!autoriser(empreinte(ip), maintenant)) {
      return json({ erreur: 'Proxy quota reached for this hour. Try again later.', quota: 'proxy' }, 429, cors)
    }

    const brut = await request.text()
    if (brut.length > TAILLE_MAX) return json({ erreur: 'Photo too large.' }, 413, cors)

    let charge
    try {
      charge = JSON.parse(brut)
    } catch {
      return json({ erreur: 'Invalid JSON body.' }, 400, cors)
    }
    // This proxy does not speak SSE: without removing the field, the upstream
    // would answer with an event stream and this Worker would return unreadable JSON.
    delete charge.stream

    const debut = Date.now()
    const resultat = await relayer(charge, cle, maintenant)
    if (resultat.statut === 200) {
      console.info(`${new Date().toISOString()} 200 ${Date.now() - debut}ms`)
      return json({ texte: resultat.texte, modele: resultat.modele, tentatives: resultat.tentatives }, 200, cors)
    }
    console.info(`${new Date().toISOString()} ${resultat.statut} ${Date.now() - debut}ms`)
    return json(
      { erreur: resultat.erreur, chaineEpuisee: true, tentatives: resultat.tentatives },
      resultat.statut,
      cors,
    )
  },
}
