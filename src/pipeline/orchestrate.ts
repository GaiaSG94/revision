/**
 * Pipeline orchestrator (§18.2): six steps, visible progress, latency measured
 * per step. Waiting becomes a demonstration of the product — and a step failure
 * says exactly where it broke.
 */
import { construireDiagnostic } from '../domain/diagnostic'
import { ecrireCache, empreinteImage, lireCache } from '../storage/cache'
import { libelleEtape } from '../domain/etapes'
import { analyserImage } from './analyse'
import { revoirFautesPeuSures } from './revue'
import type { CodeErreur } from '../domain/taxonomy'
import type { ExerciceVerifie, Progression, ResultatAnalyse, EtapeId } from '../domain/types'
import { masquerNom } from './anonymize'
import type { ClientBrut } from './client'
import type { Transport } from './llm'
import { obtenirExercice } from './exercise'
import { normaliserImage } from './ingest'

export type OptionsAnalyse = {
  transport: Transport
  onProgression?: (progression: Progression) => void
  client?: ClientBrut
  niveau?: string
  /** Injectable for tests: deterministic identifier and timestamp. */
  id?: string
  maintenant?: () => Date
  /** Local analysis cache (default: active). Can be disabled in Settings. */
  cache?: boolean
  /** Fresh exercise requested (model called) instead of the local bank. */
  inedit?: boolean
  /**
   * Published as soon as step 5 ends: the diagnosis is displayed while the
   * exercise is being prepared (RNF-01 covers photo → diagnosis, not
   * photo → exercise).
   */
  onResultatPartiel?: (partiel: ResultatAnalyse) => void
}

/**
 * Runs a step, publishing its state, duration **and proof**: what the step
 * actually produced. The proof is computed from the result, so it cannot lie.
 */
async function etape<T>(
  id: EtapeId,
  publier: (p: Progression) => void,
  travail: () => Promise<T>,
  preuve?: (resultat: T) => string,
): Promise<T> {
  publier({ etape: id, etat: 'en-cours', message: libelleEtape(id) })
  const debut = Date.now()
  try {
    const resultat = await travail()
    publier({
      etape: id,
      etat: 'fait',
      message: libelleEtape(id),
      ms: Date.now() - debut,
      ...(preuve ? { preuve: preuve(resultat) } : {}),
    })
    return resultat
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : 'Step failed.'
    publier({ etape: id, etat: 'echec', message, ms: Date.now() - debut })
    throw erreur
  }
}

/** Codes read in order, for the classification step's proof. */
export function codesDe(erreurs: { code: string }[]): string {
  const uniques = [...new Set(erreurs.map((erreur) => erreur.code))]
  return uniques.length > 0 ? uniques.join(', ') : 'none'
}

function extraitPourExercice(lignes: string[]): string {
  return lignes.filter((l) => l.trim().length > 0).slice(0, 6).join('\n')
}

export async function analyserCopie(
  fichier: File,
  options: OptionsAnalyse,
): Promise<ResultatAnalyse> {
  const publier = options.onProgression ?? (() => {})
  const maintenant = options.maintenant ?? (() => new Date())

  const image = await etape(
    'ingest',
    publier,
    () => normaliserImage(fichier),
    (resultat) => `photo normalised to ${resultat.largeur} × ${resultat.hauteur} px`,
  )
  const anonyme = await etape(
    'anonymise',
    publier,
    () => masquerNom(image.dataUrl),
    (resultat) =>
      resultat.zoneMasquee
        ? `name banner pixelated (${Math.round(resultat.zoneMasquee.largeur * 100)}% of the width)`
        : 'no name area to mask',
  )

  // Local cache: same photo (byte-for-byte after normalization) → immediate
  // answer, no call. Never the image in cache, only its fingerprint.
  if (options.cache !== false) {
    const depuisCache = await depuisLeCache(anonyme.dataUrl, options, publier)
    if (depuisCache) return depuisCache
  }
  // A single vision call for steps 3 and 4: the upstream costs 16 to 50 s per
  // round trip, merging keeps the "photo → diagnosis" budget (RNF-01).
  const analyse = await etape(
    'extrait',
    publier,
    () => analyserImage(anonyme.dataUrl, options.transport, options.client),
    (resultat) =>
      `${resultat.extraction.annotations.length} annotation(s) found on the paper` +
      (resultat.extraction.copiePropre ? ' — clean paper, no errors' : ''),
  )
  const { extraction } = analyse
  // Step 4: the rules stay local (0.6 threshold, E99, E11 weighted 0), then a
  // second pass on uncertain errors — target: zero false positives.
  const classification = await etape(
    'classifie',
    publier,
    async () => {
      const revue = await revoirFautesPeuSures(analyse.erreurs, options.transport, options.client)
      return { erreurs: revue.erreurs, bilan: { revues: revue.revues, modifiees: revue.modifiees } }
    },
    (resultat) =>
      `${resultat.erreurs.length} typed mistake(s): ${codesDe(resultat.erreurs)}` +
      (resultat.bilan.revues > 0
        ? ` — second pass: ${resultat.bilan.revues} review(s), ${resultat.bilan.modifiees} corrected`
        : ' — no mistake needed a second pass'),
  )
  const erreurs = classification.erreurs

  const diagnostic = await etape(
    'agrege',
    publier,
    async () =>
      construireDiagnostic(erreurs, {
        id: options.id ?? crypto.randomUUID(),
        createdAt: maintenant().toISOString(),
      }),
    (resultat) =>
      `profile updated: ${resultat.nbFautes} mistake(s), main type ${resultat.typeDominant ?? 'none'}`,
  )

  // The diagnosis is displayed now: the exercise is prepared behind the scenes
  // (RNF-01 covers photo → diagnosis).
  options.onResultatPartiel?.({
    diagnostic,
    extraction,
    imageAnonymisee: anonyme.dataUrl,
    revue: classification.bilan,
    exercice: null,
    messageExercice: 'Exercise in preparation…',
  })

  const exercice = await etape(
    'genere',
    publier,
    () => produireExercice(diagnostic.typeDominant, extraction, options, publier),
    (resultat) =>
      resultat.exercice
        ? `exercise ${
            resultat.exercice.exercice.source === 'banque'
              ? 'from the local bank'
              : 'fresh, generated by the model'
          } on ${resultat.exercice.exercice.typeTravaille} — safeguard: ${
            resultat.exercice.verdict.travailleLeBonType &&
            resultat.exercice.verdict.neDonneLaSolutionOrigine &&
            resultat.exercice.verdict.memeNiveau
              ? '3 criteria passed'
              : 'rejected'
          }`
        : (resultat.message ?? 'no exercise available'),
  )
  const resultat: ResultatAnalyse = {
    diagnostic,
    extraction,
    imageAnonymisee: anonyme.dataUrl,
    revue: classification.bilan,
    exercice: exercice.exercice,
    ...(exercice.message ? { messageExercice: exercice.message } : {}),
  }
  if (options.cache !== false) {
    // The image is never cached (RNF-P1): only the diagnosis.
    const { imageAnonymisee: _image, ...sansImage } = resultat
    void ecrireCache(await empreinteImage(anonyme.dataUrl), {
      ...sansImage,
      enregistreLe: maintenant().toISOString(),
    })
  }
  return resultat
}

/** Result replayed from the local cache, with progress published to stay readable. */
async function depuisLeCache(
  dataUrl: string,
  options: OptionsAnalyse,
  publier: (p: Progression) => void,
): Promise<ResultatAnalyse | null> {
  const enCache = await lireCache(await empreinteImage(dataUrl))
  if (!enCache) return null
  const etapes: EtapeId[] = ['extrait', 'classifie', 'agrege', 'genere']
  const preuves: Record<string, string> = {
    extrait: `${enCache.extraction.annotations.length} annotation(s) already found`,
    classifie: `${enCache.diagnostic.erreurs.length} mistake(s) already typed: ${codesDe(enCache.diagnostic.erreurs)}`,
    agrege: `profile already up to date: ${enCache.diagnostic.nbFautes} mistake(s)`,
    genere: enCache.exercice
      ? `exercise already ready on ${enCache.exercice.exercice.typeTravaille}`
      : (enCache.messageExercice ?? 'no exercise available'),
  }
  for (const etapeId of etapes) {
    publier({
      etape: etapeId,
      etat: 'fait',
      message: 'answer from local cache',
      ms: 0,
      preuve: `${preuves[etapeId]} — no network call`,
    })
  }
  options.onResultatPartiel?.({ ...enCache, imageAnonymisee: dataUrl })
  return { ...enCache, imageAnonymisee: dataUrl }
}

/** Step 6 must never make the diagnosis fail: it is optional. */
async function produireExercice(
  typeDominant: CodeErreur | null,
  extraction: { annotations: { ligne: string }[] },
  options: OptionsAnalyse,
  publier: (p: Progression) => void,
): Promise<{ exercice: ExerciceVerifie | null; message?: string }> {
  if (!typeDominant) {
    publier({ etape: 'genere', etat: 'sautee', message: 'No mistake to work on' })
    return { exercice: null, message: "No recurring mistake: nothing to work on, and that's good news." }
  }
  const extrait = extraitPourExercice(extraction.annotations.map((a) => a.ligne))
  try {
    // Local bank first: step 6 then costs **no** network call.
    return await etape('genere', publier, () =>
      obtenirExercice({
        typeDominant,
        extraitCopie: extrait,
        transport: options.transport,
        ...(options.client ? { client: options.client } : {}),
        ...(options.niveau ? { niveau: options.niveau } : {}),
        ...(options.inedit ? { inedit: true } : {}),
      }),
    )
  } catch {
    return { exercice: null, message: 'Exercise unavailable right now: try again in a moment.' }
  }
}
