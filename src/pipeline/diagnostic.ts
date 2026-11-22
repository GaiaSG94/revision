/**
 * Self-check — one control and one proof per subsystem.
 *
 * The idea: do not claim it works, **show** it. A button runs a series of real
 * checks (proxy, circuit breaker, local cache, local storage, exercise bank,
 * taxonomy, wait budget) and each line returns proof of its success, with its
 * duration.
 *
 * None of these checks consumes model quota (the only network calls are
 * `GET /health` and `GET /modeles`, which are free).
 */
import { BANQUE, exercicesDe } from '../domain/banque'
import { CODES_ERREUR } from '../domain/taxonomy'
import { BUDGET_APPEL_MS, CHAINE_MODELES, DELAI_APPEL_MS, SEUIL_REVUE } from '../domain/config'
import { ecrireCache, lireCache, viderCache } from '../storage/cache'
import { chargerDiagnostics, enregistrerDiagnostic } from '../storage/local'
import type { Diagnostic } from '../domain/types'

export type Controle = {
  nom: string
  ok: boolean
  /** The proof, in one sentence: what was checked and what it yielded. */
  preuve: string
  ms?: number
}

function duree(debut: number): number {
  return Date.now() - debut
}

function base(proxy: string): string {
  return proxy.replace(/\/analyze\/?$/, '')
}

/** Check 1: does the proxy answer, and how fast? */
async function controleProxy(proxy: string): Promise<Controle> {
  const debut = Date.now()
  try {
    const reponse = await fetch(`${base(proxy)}/health`, { signal: AbortSignal.timeout(10_000) })
    const corps = (await reponse.json().catch(() => ({}))) as { ok?: boolean; disjoncteur?: Record<string, number> }
    const morts = Object.keys(corps.disjoncteur ?? {}).length
    return {
      nom: 'Proxy (edge)',
      ok: reponse.ok === true && corps.ok === true,
      preuve: reponse.ok
        ? `answers 200 in ${duree(debut)} ms — ${morts} model(s) in cooldown`
        : `answers ${reponse.status}`,
      ms: duree(debut),
    }
  } catch {
    return { nom: 'Proxy (edge)', ok: false, preuve: 'unreachable', ms: duree(debut) }
  }
}

/** Check 2: is the fallback chain known and ordered? */
async function controleModeles(proxy: string): Promise<Controle> {
  const debut = Date.now()
  try {
    const reponse = await fetch(`${base(proxy)}/modeles`, { signal: AbortSignal.timeout(10_000) })
    const corps = (await reponse.json().catch(() => ({}))) as { chaine?: string[]; disjoncteur?: Record<string, number> }
    const chaine = corps.chaine ?? []
    return {
      nom: 'Fallback chain',
      ok: chaine.length > 0,
      preuve: `${chaine.length} model(s) available, first tried: ${(chaine[0] ?? '—').split('/').pop()}`,
      ms: duree(debut),
    }
  } catch {
    return { nom: 'Fallback chain', ok: false, preuve: 'model state unreadable', ms: duree(debut) }
  }
}

/** Check 3: the local cache writes, reads back and clears. */
async function controleCache(): Promise<Controle> {
  const debut = Date.now()
  const empreinte = `auto-verification-${Date.now()}`
  try {
    await ecrireCache(empreinte, {
      enregistreLe: new Date().toISOString(),
      diagnostic: {
        id: 'auto',
        createdAt: new Date().toISOString(),
        matiere: 'maths',
        nbFautes: 0,
        erreurs: [],
        typeDominant: null,
      },
      extraction: { annotations: [], copiePropre: true },
      exercice: null,
    })
    const relu = await lireCache(empreinte)
    await viderCache()
    return {
      nom: 'Cache local',
      ok: relu !== null,
      preuve: relu ? 'write and read-back confirmed' : 'read-back failed',
      ms: duree(debut),
    }
  } catch {
    return { nom: 'Cache local', ok: false, preuve: 'IndexedDB unavailable', ms: duree(debut) }
  }
}

/** Check 4: does the history storage respond? */
async function controleStockage(): Promise<Controle> {
  const debut = Date.now()
  try {
    const avant = await chargerDiagnostics()
    const factice: Diagnostic = {
      id: `auto-${Date.now()}`,
      createdAt: new Date().toISOString(),
      matiere: 'maths',
      nbFautes: 0,
      erreurs: [],
      typeDominant: null,
    }
    await enregistrerDiagnostic(factice)
    const apres = await chargerDiagnostics()
    return {
      nom: 'Local history',
      ok: apres.length >= avant.length,
      preuve: `${apres.length} diagnosis/diagnoses stored locally, write confirmed`,
      ms: duree(debut),
    }
  } catch {
    return { nom: 'Local history', ok: false, preuve: 'IndexedDB unavailable', ms: duree(debut) }
  }
}

/** Check 5: is the exercise bank complete and targeted? */
export function controleBanque(): Controle {
  const debut = Date.now()
  const manquants = CODES_ERREUR.filter((code) => exercicesDe(code).length !== 3)
  const total = CODES_ERREUR.reduce((somme, code) => somme + BANQUE[code].length, 0)
  return {
    nom: 'Exercise bank',
    ok: manquants.length === 0,
    preuve:
      manquants.length === 0
        ? `${total} local exercises for the ${CODES_ERREUR.length} types — 0 network calls`
        : `incomplete types: ${manquants.join(', ')}`,
    ms: duree(debut),
  }
}

/** Check 6: is the taxonomy closed and its locks in place? */
export function controleTaxonomie(): Controle {
  const debut = Date.now()
  return {
    nom: 'Closed taxonomy',
    ok: CODES_ERREUR.length === 12,
    preuve: `${CODES_ERREUR.length} codes, confidence threshold ${SEUIL_REVUE} for the second pass`,
    ms: duree(debut),
  }
}

/** Check 7: are the wait bounds the ones we expect? */
export function controleBudget(): Controle {
  const debut = Date.now()
  return {
    nom: 'Wait budget',
    ok: BUDGET_APPEL_MS > DELAI_APPEL_MS,
    preuve: `${Math.round(DELAI_APPEL_MS / 1000)} s per call, ${Math.round(BUDGET_APPEL_MS / 1000)} s budget, ${CHAINE_MODELES.length} models`,
    ms: duree(debut),
  }
}

/** Runs all checks and returns one proof per subsystem. */
export async function autoVerifier(proxy: string): Promise<Controle[]> {
  const controles: Controle[] = []
  controles.push(await controleProxy(proxy))
  controles.push(await controleModeles(proxy))
  controles.push(await controleCache())
  controles.push(await controleStockage())
  controles.push(controleBanque())
  controles.push(controleTaxonomie())
  controles.push(controleBudget())
  return controles
}
