/**
 * Application actions. Every analysis goes through `executerAnalyse`: demo mode
 * is just a different client (`clientDemoPour`), never a parallel path — that
 * is what guarantees the demo shows the real pipeline.
 */
import type { Dispatch, SetStateAction } from 'react'
import { useCallback } from 'react'
import type { Diagnostic, ResultatAnalyse } from '../domain/types'
import { clientDemoPour, echantillonDe, fichierEchantillon, fichierDemoPour } from '../pipeline/demo'
import { ID_COPIES_DEMO } from '../pipeline/demo'
import { obtenirExercice } from '../pipeline/exercise'
import { analyserCopie } from '../pipeline/orchestrate'
import type { Transport } from '../pipeline/llm'
import { enregistrerDiagnostic, effacerHistorique, sauverReglages } from '../storage/local'
import type { Etat, Modificateur } from './useEtatRevision'
import type { Ecran } from './useEtatRevision'
import { amontMort, fusionner, messageErreur, transportDe } from './useEtatRevision'
import type { Reglages } from '../domain/types'

const ATTENTE_DEMO_GUIDEE_MS = 850
/** Maximum wait for an analysis before giving up with an honest message. */
const DELAI_ANALYSE_MAX_MS = 150_000

export type { Reglages }

type Ctx = { etat: Etat; setEtat: Dispatch<SetStateAction<Etat>>; aller: (ecran: Ecran) => void }

/** Transport shared by all calls: optimized chain + model that answered. */
function transportPour({ etat, setEtat }: Ctx) {
  return transportDe(etat.reglages, {
    chaine: etat.chaineModeles,
    surModele: (modele) => setEtat((precedent) => ({ ...precedent, modeleRepondu: modele })),
    surProgres: (message) => setEtat((precedent) => ({ ...precedent, messageProgres: message })),
  })
}

/** One analysis, with progress reporting. Returns null on failure. */
async function executerAnalyse(
  fichier: File,
  options: { transport: Transport; demoId?: string; attenteMax?: number; setEtat: Ctx['setEtat'] },
): Promise<ResultatAnalyse | null> {
  const { demoId, setEtat } = options
  try {
    return await analyserCopie(fichier, {
      transport: options.transport,
      ...(demoId ? { client: clientDemoPour(demoId, { attenteMax: options.attenteMax }) } : {}),
      onProgression: (p) => setEtat((precedent) => ({ ...precedent, progression: fusionner(precedent.progression, p) })),
    })
  } catch (erreur) {
    setEtat((precedent) => ({
      ...precedent,
      erreur: messageErreur(erreur),
      ...(amontMort(erreur) ? { santeProxy: 'ko' as const } : {}),
    }))
    return null
  }
}

/**
 * Displays the diagnosis as soon as step 5 ends, then persists in the
 * background. Exception: if the user left the Analysis screen (async mode,
 * idea 8), we do not force a return — we light up a "diagnosis ready" badge.
 */
function publierPartiel(
  setEtat: Ctx['setEtat'],
  partiel: ResultatAnalyse,
  demoId: string | null,
): void {
  setEtat((precedent) => ({
    ...precedent,
    occupe: false,
    resultat: partiel,
    demoId,
    ecran: precedent.ecran === 'analyse' ? 'diagnostic' : precedent.ecran,
    diagnosticPret: precedent.ecran !== 'analyse' && precedent.ecran !== 'diagnostic',
  }))
  void enregistrerDiagnostic(partiel.diagnostic).then((profil) => {
    setEtat((precedent) => ({
      ...precedent,
      profil,
      diagnostics: [...precedent.diagnostics, partiel.diagnostic],
    }))
  })
}

export function useActionsRature({ etat, setEtat, aller }: Ctx) {
  const analyser = useCallback(
    async (fichier: File, options: { demoId?: string; attenteMax?: number } = {}) => {
      aller('analyse')
      setEtat((precedent) => ({
        ...precedent,
        occupe: true,
        erreur: null,
        progression: [],
        demoId: null,
        dernierFichier: fichier,
      }))
      const demoId = options.demoId ?? null
      // Honest timeout: beyond it, we give control back with a clear message
      // instead of leaving the screen stuck on an "in progress" step for
      // several minutes (bug of 15/11 in front of a judge).
      let vidange: ReturnType<typeof setTimeout> | undefined
      const delaiMax = new Promise<null>((resoudre) => {
        vidange = setTimeout(() => resoudre(null), DELAI_ANALYSE_MAX_MS)
      })
      const course = analyserCopie(fichier, {
        transport: transportPour({ etat, setEtat, aller }),
        ...(demoId ? { client: clientDemoPour(demoId, { attenteMax: options.attenteMax }) } : {}),
        onProgression: (p) =>
          setEtat((precedent) => ({ ...precedent, progression: fusionner(precedent.progression, p) })),
        onResultatPartiel: (partiel) => publierPartiel(setEtat, partiel, demoId),
      }).catch((erreur: unknown) => {
        setEtat((precedent) => ({
          ...precedent,
          occupe: false,
          erreur: messageErreur(erreur),
          ...(amontMort(erreur) ? { santeProxy: 'ko' as const } : {}),
        }))
        return null
      })
      const resultat = await Promise.race([course, delaiMax]).finally(() => clearTimeout(vidange))
      if (resultat) {
        setEtat((precedent) => ({ ...precedent, occupe: false, resultat, demoId }))
        return
      }
      // The watchdog won (the race returned nothing and did not fail): we give
      // control back. The analysis keeps running in the background: if it
      // succeeds, the "diagnosis ready" badge will still light up (idea 8).
      setEtat((precedent) => ({
        ...precedent,
        occupe: false,
        erreur: `The model is taking too long (over ${Math.round(DELAI_ANALYSE_MAX_MS / 1000)}s). Try again — or run the offline demo below.`,
      }))
    },
    [aller, etat.reglages, setEtat],
  )

  /** Demo: one paper (real pace), or several in a row (guided tour: profile trajectory, faster pace). */
  const analyserDemo = useCallback(
    async (ids?: string[]) => {
      const cibles = ids && ids.length > 0 ? ids : ID_COPIES_DEMO.slice(0, 1)
      const guide = cibles.length > 1
      for (const id of cibles) {
        await analyser(await fichierDemoPour(id), {
          demoId: id,
          ...(guide ? { attenteMax: ATTENTE_DEMO_GUIDEE_MS } : {}),
        })
      }
      // Several papers: what matters is the trajectory, not the last paper.
      if (guide) aller('profil')
    },
    [analyser, aller],
  )

  /**
   * A sample played by the user: a real paper photo. If the model responses are
   * recorded for THAT photo, we replay offline; otherwise the analysis goes
   * online to the edge proxy.
   */
  const analyserEchantillon = useCallback(
    async (id: string) => {
      const echantillon = echantillonDe(id)
      if (!echantillon) {
        setEtat((precedent) => ({ ...precedent, erreur: `Sample paper not found: ${id}` }))
        return
      }
      const demoId = echantillon.enregistrement ? id : undefined
      await analyser(await fichierEchantillon(id), demoId ? { demoId } : {})
    },
    [analyser, setEtat],
  )

  /**
   * Teacher mode: papers analysed here do NOT join the personal history — a
   * student's profile and a class statistic must not be mixed.
   */
  const analyserLot = useCallback(
    async (fichiers: File[], demoIds?: string[]) => {
      const collectes: Diagnostic[] = []
      setEtat((precedent) => ({ ...precedent, occupe: true, erreur: null, progression: [] }))
      for (const [index, fichier] of fichiers.entries()) {
        const resultat = await executerAnalyse(fichier, {
          transport: transportPour({ etat, setEtat, aller }),
          ...(demoIds?.[index] ? { demoId: demoIds[index] } : {}),
          setEtat,
        })
        if (resultat) collectes.push(resultat.diagnostic)
      }
      setEtat((precedent) => ({ ...precedent, occupe: false, demoId: demoIds ? 'lot' : null }))
      return collectes
    },
    [etat.reglages, setEtat],
  )

  /** Offline teacher mode: the demo batch, with recorded responses. */
  const analyserLotDemo = useCallback(async () => {
    const fichiers: File[] = []
    for (const id of ID_COPIES_DEMO) fichiers.push(await fichierDemoPour(id))
    return analyserLot(fichiers, ID_COPIES_DEMO)
  }, [analyserLot])

  const enregistrerReglages = useCallback(
    async (reglages: Reglages) => {
      await sauverReglages(reglages)
      setEtat((precedent) => ({ ...precedent, reglages }))
    },
    [setEtat],
  )

  const viderHistorique = useCallback(async () => {
    await effacerHistorique()
    setEtat((precedent) => ({
      ...precedent,
      diagnostics: [],
      profil: precedent.profil && { ...precedent.profil, parType: precedent.profil.parType, totalAnalyses: 0, evolution: [], signalees: {} },
      resultat: null,
    }))
  }, [setEtat])

  const reinitialiserErreur = useCallback(() => {
    setEtat((precedent) => ({ ...precedent, erreur: null }))
  }, [setEtat])

  /**
   * Another exercise. By default: **local bank**, so no network call (idea 1).
   * `inedit: true` asks the model for a fresh exercise — two calls, so 30 to
   * 110 s on the upstream: it is a choice, not the default.
   */
  const nouvelExercice = useCallback(
    async (options: { inedit?: boolean } = {}) => {
      const resultat = etat.resultat
      const type = resultat?.diagnostic.typeDominant
      if (!resultat || !type) return
      setEtat((precedent) => ({ ...precedent, occupe: true }))
      try {
        const extrait = resultat.extraction.annotations.map((a) => a.ligne).slice(0, 6).join('\n')
        const obtenu = await obtenirExercice({
          typeDominant: type,
          extraitCopie: extrait,
          transport: transportPour({ etat, setEtat, aller }),
          inedit: options.inedit ?? false,
          dejaVus: etat.exercicesVus,
          graine: Date.now() % 1000,
          ...(etat.demoId ? { client: clientDemoPour(etat.demoId) } : {}),
        })
        setEtat((precedent) => ({
          ...precedent,
          occupe: false,
          exercicesVus: obtenu.exercice?.exercice.id
            ? [...precedent.exercicesVus, obtenu.exercice.exercice.id]
            : precedent.exercicesVus,
          resultat: precedent.resultat
            ? {
                ...precedent.resultat,
                exercice: obtenu.exercice,
                ...(obtenu.message ? { messageExercice: obtenu.message } : {}),
              }
            : precedent.resultat,
        }))
      } catch (erreur) {
        setEtat((precedent) => ({ ...precedent, occupe: false, erreur: messageErreur(erreur) }))
      }
    },
    [etat.resultat, etat.reglages, etat.demoId, etat.exercicesVus, setEtat, aller],
  )

  /** Retry after a failure: the same photo, without re-selecting the file. */
  const reprendreAnalyse = useCallback(async () => {
    const fichier = etat.dernierFichier
    if (!fichier) return
    await analyser(fichier)
  }, [analyser, etat.dernierFichier])

  return {
    analyser,
    analyserDemo,
    analyserEchantillon,
    analyserLot,
    analyserLotDemo,
    enregistrerReglages,
    viderHistorique,
    reinitialiserErreur,
    nouvelExercice,
    reprendreAnalyse,
  }
}

export type ModificateurEtat = Modificateur
