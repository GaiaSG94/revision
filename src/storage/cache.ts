/**
 * Local analysis cache — idea 4 from the "stay on InferHub" brainstorm.
 *
 * Why client-side and not proxy-side: a server cache would keep the text
 * extracted from a student's paper, which RNF-P3 forbids ("the proxy logs
 * neither images nor extracted text"). The local cache stays in IndexedDB, on
 * the device, with the history — and can be cleared in one click. Accepted
 * trade-off: two visitors analysing the same photo do not share the answer.
 *
 * What is cached: the structured diagnosis, the annotations and the exercise.
 * **Never the image** (RNF-P1): the key is its SHA-256 fingerprint.
 */
import { del, get, keys, set } from 'idb-keyval'
import { CLES } from '../domain/config'
import type { BilanRevue, Diagnostic, Extraction, ExerciceVerifie } from '../domain/types'

export type AnalyseEnCache = {
  enregistreLe: string
  diagnostic: Diagnostic
  extraction: Extraction
  exercice: ExerciceVerifie | null
  revue?: BilanRevue
  messageExercice?: string
  /** Model that had answered: displayed for transparency. */
  modele?: string
}

/** Time to live: a corrected paper does not change, but prompts do. */
export const TTL_CACHE_MS = 24 * 60 * 60 * 1000
/** Beyond this, the oldest entries are purged: the cache must not grow indefinitely. */
export const MAX_ENTREES_CACHE = 40

const PREFIXE = `${CLES.cache}/`

export async function empreinteImage(dataUrl: string): Promise<string> {
  const octets = new TextEncoder().encode(dataUrl)
  const condense = await crypto.subtle.digest('SHA-256', octets)
  return Array.from(new Uint8Array(condense))
    .map((octet) => octet.toString(16).padStart(2, '0'))
    .join('')
}

export async function lireCache(empreinte: string): Promise<AnalyseEnCache | null> {
  const entree = await get<AnalyseEnCache>(`${PREFIXE}${empreinte}`)
  if (!entree) return null
  const age = Date.now() - Date.parse(entree.enregistreLe)
  if (!Number.isFinite(age) || age > TTL_CACHE_MS) {
    await del(`${PREFIXE}${empreinte}`)
    return null
  }
  return entree
}

export async function ecrireCache(empreinte: string, analyse: AnalyseEnCache): Promise<void> {
  await set(`${PREFIXE}${empreinte}`, analyse)
  await purgerCache()
}

/** Removes expired entries, then the oldest ones beyond the cap. */
export async function purgerCache(): Promise<number> {
  const cles = (await keys()).filter((cle) => typeof cle === 'string' && cle.startsWith(PREFIXE)) as string[]
  const maintenant = Date.now()
  const vivantes: { cle: string; enregistreLe: number }[] = []
  for (const cle of cles) {
    const entree = await get<AnalyseEnCache>(cle)
    const temps = entree ? Date.parse(entree.enregistreLe) : Number.NaN
    if (!entree || !Number.isFinite(temps) || maintenant - temps > TTL_CACHE_MS) {
      await del(cle)
    } else {
      vivantes.push({ cle, enregistreLe: temps })
    }
  }
  if (vivantes.length <= MAX_ENTREES_CACHE) return vivantes.length
  vivantes.sort((a, b) => a.enregistreLe - b.enregistreLe)
  const enTrop = vivantes.slice(0, vivantes.length - MAX_ENTREES_CACHE)
  for (const entree of enTrop) await del(entree.cle)
  return vivantes.length - enTrop.length
}

export async function viderCache(): Promise<void> {
  const cles = (await keys()).filter((cle) => typeof cle === 'string' && cle.startsWith(PREFIXE)) as string[]
  for (const cle of cles) await del(cle)
}
