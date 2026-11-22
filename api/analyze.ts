/**
 * Edge proxy — the InferHub key never makes it into the bundle.
 *
 * Contract: POST {model, messages, …} → relayed as-is to the [OI]-compatible
 * upstream; response {texte}. Errors → {erreur} + HTTP status.
 *
 * Privacy (RNF-P3): we log ONLY the timestamp, status and latency. Never the
 * image, never the extracted text, never the key, never the raw IP (it serves
 * only as an in-memory quota key).
 */
import { creerQuota } from './_quota'

declare const process: { env: Record<string, string | undefined> }

type Entetes = Record<string, string | string[] | undefined>

type Requete = {
  method?: string
  headers: Entetes
  on?: (evenement: string, ecouteur: (donnees?: unknown) => void) => void
}

type Reponse = {
  statusCode: number
  setHeader: (nom: string, valeur: string) => void
  end: (corps?: string) => void
}

/** bodyParser disabled: we read the raw stream and keep nothing in memory on Vercel. */
export const config = { api: { bodyParser: false } }

const TAILLE_MAX_OCTETS = 15 * 1024 * 1024
const decodeur = new TextDecoder()
const DELAI_MS = 60_000
const quota = creerQuota()

function amont(): string {
  return process.env.REVISION_AMONT ?? 'https://api.inferhub.dev/v1'
}

function entete(req: Requete, nom: string): string {
  const valeur = req.headers[nom] ?? req.headers[nom.toLowerCase()]
  return Array.isArray(valeur) ? (valeur[0] ?? '') : (valeur ?? '')
}

/** Quota key: fingerprint of the IP, never the IP itself in the logs. */
function identifiantVisiteur(req: Requete): string {
  const brute = entete(req, 'x-forwarded-for').split(',')[0]?.trim() || 'inconnu'
  let empreinte = 0
  for (let i = 0; i < brute.length; i += 1) empreinte = (empreinte * 31 + brute.charCodeAt(i)) >>> 0
  return `v${empreinte.toString(36)}`
}

async function lireCorps(req: Requete): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const morceaux: string[] = []
    let taille = 0
    req.on?.('data', (donnees) => {
      const texte = typeof donnees === 'string' ? donnees : decodeur.decode(donnees as Uint8Array, { stream: true })
      taille += texte.length
      if (taille > TAILLE_MAX_OCTETS) {
        rejeter(new ErreurHttp('Photo too large (15 MB max after encoding).', 413))
        return
      }
      morceaux.push(texte)
    })
    req.on?.('end', () => resoudre(morceaux.join('')))
    req.on?.('error', () => rejeter(new ErreurHttp('Body read interrupted.', 400)))
  })
}

class ErreurHttp extends Error {
  readonly statut: number
  constructor(message: string, statut: number) {
    super(message)
    this.statut = statut
  }
}

function repondre(res: Reponse, statut: number, corps: unknown, debut: number): void {
  res.statusCode = statut
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(corps))
  // Only allowed log: timestamp, status, latency.
  console.info(`${new Date().toISOString()} ${statut} ${Date.now() - debut}ms`)
}

function extraireTexte(data: unknown): string {
  const choix = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]
  return choix?.message?.content ?? ''
}

export default async function handler(req: Requete, res: Reponse): Promise<void> {
  const debut = Date.now()
  res.setHeader('access-control-allow-origin', entete(req, 'origin') || '*')
  res.setHeader('access-control-allow-headers', 'content-type, x-revision-cle')
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS')

  if (req.method === 'OPTIONS') return repondre(res, 204, {}, debut)
  if (req.method !== 'POST') return repondre(res, 405, { erreur: 'Method not allowed.' }, debut)

  const cle = entete(req, 'x-revision-cle').trim() || process.env.INFERHUB_API_KEY || ''
  if (!cle) return repondre(res, 503, { erreur: 'Proxy not configured: paste your key in Settings (BYOK).' }, debut)

  const visiteur = identifiantVisiteur(req)
  if (!quota.autoriser(visiteur, Date.now())) {
    // `quota: proxy` distinguishes our cap from an upstream rate limit.
    return repondre(res, 429, { erreur: 'Proxy quota reached for this hour. Try again later.', quota: 'proxy' }, debut)
  }

  let corps: string
  try {
    corps = await lireCorps(req)
  } catch (erreur) {
    return repondre(res, erreur instanceof ErreurHttp ? erreur.statut : 400, { erreur: 'Unreadable body.' }, debut)
  }

  try {
    const reponse = await fetch(`${amont()}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cle}` },
      body: corps,
      signal: AbortSignal.timeout(DELAI_MS),
    })
    const data = await reponse.json()
    if (!reponse.ok) {
      if (reponse.status === 429) {
        return repondre(res, 429, { erreur: 'Model provider rate limit: try again in a minute.' }, debut)
      }
      const message = (data as { error?: { message?: string } })?.error?.message ?? 'Upstream unavailable.'
      return repondre(res, reponse.status, { erreur: message }, debut)
    }
    const texte = extraireTexte(data)
    if (!texte) return repondre(res, 502, { erreur: 'Empty response from the model.' }, debut)
    return repondre(res, 200, { texte }, debut)
  } catch (erreur) {
    const delai = erreur instanceof Error && erreur.name === 'TimeoutError'
    return repondre(res, delai ? 504 : 502, { erreur: delai ? 'Analysis took too long: try again.' : 'Upstream unreachable.' }, debut)
  }
}
