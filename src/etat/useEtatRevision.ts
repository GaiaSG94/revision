/**
 * Application state: current screen, local data, settings, proxy health.
 * Separated from actions (`useActions.ts`) to keep each function under the
 * 50-line limit.
 */
import { useCallback, useEffect, useState } from 'react'
import { MODELE_PAR_DEFAUT, PROXY_PAR_DEFAUT } from '../domain/config'
import { profilVide } from '../domain/profil'
import type { Diagnostic, Profil, Progression, Reglages, ResultatAnalyse } from '../domain/types'
import type { Transport } from '../pipeline/llm'
import { sonderModeles, sonderProxy } from '../pipeline/sante'
import type { SanteProxy } from '../pipeline/sante'
import { REGLAGES_VIDES, chargerDiagnostics, chargerProfil, chargerReglages } from '../storage/local'

export type Ecran =
  | 'accueil'
  | 'cadrage'
  | 'analyse'
  | 'diagnostic'
  | 'exemples'
  | 'profil'
  | 'exercice'
  | 'prof'
  | 'reglages'
  | 'apropos'

export const ECRANS: Ecran[] = [
  'accueil',
  'cadrage',
  'analyse',
  'diagnostic',
  'exemples',
  'profil',
  'exercice',
  'prof',
  'reglages',
  'apropos',
]

export type Etat = {
  ecran: Ecran
  diagnostics: Diagnostic[]
  profil: Profil
  reglages: Reglages
  resultat: ResultatAnalyse | null
  progression: Progression[]
  erreur: string | null
  occupe: boolean
  /** Identifier of the current demo paper, null in a real analysis. */
  demoId: string | null
  /** Proxy health: ok / ko (demo fallback offered) / inconnue. */
  santeProxy: SanteProxy
  /** Model chain reordered according to the proxy's circuit breaker (idea 5). */
  chaineModeles: string[] | null
  /** Model that actually answered the last call, for display. */
  modeleRepondu: string | null
  /** Analysis finished while the user was navigating elsewhere (idea 8). */
  diagnosticPret: boolean
  /** Latest progress published by the proxy (streaming, idea 7). */
  messageProgres: string | null
  /** Identifiers of exercises already served (to offer another one). */
  exercicesVus: string[]
  /** Last analysed file: allows a "Try again" without re-selecting the photo. */
  dernierFichier: File | null
}

export function ecranDepuisUrl(): Ecran {
  const demande = new URLSearchParams(window.location.search).get('ecran')
  return ECRANS.includes(demande as Ecran) ? (demande as Ecran) : 'accueil'
}

export function etatInitial(): Etat {
  return {
    ecran: ecranDepuisUrl(),
    diagnostics: [],
    profil: profilVide(),
    reglages: REGLAGES_VIDES,
    resultat: null,
    progression: [],
    erreur: null,
    occupe: false,
    demoId: null,
    santeProxy: 'inconnue',
    chaineModeles: null,
    modeleRepondu: null,
    diagnosticPret: false,
    messageProgres: null,
    exercicesVus: [],
    dernierFichier: null,
  }
}

/**
 * Effective transport: edge proxy, or personal key if provided. `surModele`
 * fills the state so the UI can say which model actually answered
 * (transparency about an upstream that changes all the time).
 */
export function transportDe(
  reglages: Reglages,
  options: {
    chaine?: string[] | null
    surModele?: (modele: string, tentatives: number) => void
    surProgres?: (message: string) => void
  } = {},
): Transport {
  return {
    proxy: reglages.proxy.trim() || PROXY_PAR_DEFAUT,
    modele: reglages.modele.trim() || MODELE_PAR_DEFAUT,
    // Streaming: the proxy publishes its progress while the upstream thinks.
    stream: true,
    ...(reglages.clePersonnelle.trim() ? { cle: reglages.clePersonnelle.trim() } : {}),
    ...(options.chaine ? { chaine: options.chaine } : {}),
    ...(options.surModele ? { surModele: options.surModele } : {}),
    ...(options.surProgres ? { surProgres: options.surProgres } : {}),
  }
}

export function messageErreur(erreur: unknown): string {
  if (erreur instanceof Error) {
    const statut = (erreur as { statut?: number }).statut ?? 0
    // 503/504: the marketplace has no capacity right now. Honest message +
    // fallback (the offline demo does not depend on the network).
    if (statut === 503 || statut === 504) {
      return 'The model provider has no capacity right now. Try again in a moment — or run the offline demo below.'
    }
    return erreur.message
  }
  return 'Analysis failed. Try again in a moment.'
}

/** Network or upstream exhausted: this is the signal that lights the "ko" dot. */
export function amontMort(erreur: unknown): boolean {
  const statut = erreur instanceof Error && 'statut' in erreur ? (erreur as { statut: number }).statut : 0
  return [0, 502, 503, 504].includes(statut)
}

/** Replaces a step's state in the list (one line per step, not a log). */
export function fusionner(liste: Progression[], nouvelle: Progression): Progression[] {
  return [...liste.filter((p) => p.etape !== nouvelle.etape), nouvelle]
}

export type Modificateur = (precedent: Etat) => Etat

export function useEtatRature() {
  const [etat, setEtat] = useState<Etat>(etatInitial)

  useEffect(() => {
    void (async () => {
      const [diagnostics, profil, reglages] = await Promise.all([
        chargerDiagnostics(),
        chargerProfil(),
        chargerReglages(),
      ])
      setEtat((precedent) => ({ ...precedent, diagnostics, profil, reglages }))
    })()
  }, [])

  // Probe the proxy on load and on every address change. We probe the EFFECTIVE
  // address (including fallback): the raw setting is empty until the user has
  // entered something.
  const proxyActif = transportDe(etat.reglages).proxy
  useEffect(() => {
    void (async () => {
      const [santeProxy, chaineModeles] = await Promise.all([
        sonderProxy(proxyActif),
        sonderModeles(proxyActif),
      ])
      setEtat((precedent) => ({ ...precedent, santeProxy, chaineModeles }))
    })()
  }, [proxyActif])

  const aller = useCallback((ecran: Ecran) => {
    setEtat((precedent) => ({
      ...precedent,
      ecran,
      // The "diagnosis ready" badge turns off as soon as we go see it.
      diagnosticPret: ecran === 'diagnostic' ? false : precedent.diagnosticPret,
    }))
    const url = new URL(window.location.href)
    url.searchParams.set('ecran', ecran)
    window.history.replaceState({}, '', url)
  }, [])

  return { etat, setEtat, aller }
}
