/**
 * Builds the diagnosis from the classified errors.
 *
 * Two safeguards applied here, before any display:
 *  1. confidence threshold (0.6) → below it, the error becomes E99 "untyped"
 *     and leaves the profile;
 *  2. clean paper: if the model returns no annotations, no error is fabricated
 *     (RNF-04: zero false positives tolerated).
 */
import { CODE_NON_TYPEE, estCodeConnu, estPonderee, libelleDe } from './taxonomy'
import type { CodeErreur } from './taxonomy'
import { SEUIL_CONFIANCE } from './config'
import { confianceAssainie, texteAssaini, zoneAssainie } from './tolerance'
import type { Erreur, Diagnostic } from './types'

export type ErreurBrute = {
  code: unknown
  ligne?: unknown
  explication?: unknown
  confiance?: unknown
  zone?: unknown
}

/**
 * Normalizes a raw input into a typed Error: confidence threshold applied,
 * texts bounded, zone sanitized. The invariants hold regardless of the caller
 * (pipeline, second pass, or test).
 */
export function normaliserErreur(brute: ErreurBrute): Erreur {
  const confiance = confianceAssainie(brute.confiance)
  const code: CodeErreur = estCodeConnu(brute.code) && confiance >= SEUIL_CONFIANCE ? brute.code : CODE_NON_TYPEE
  const zone = zoneAssainie(brute.zone)
  return {
    code,
    libelle: libelleDe(code),
    ligne: texteAssaini(brute.ligne, 'Line not located'),
    explication: texteAssaini(brute.explication, 'To review with your teacher.'),
    confiance,
    ponderee: estPonderee(code),
    ...(zone ? { zone } : {}),
  }
}

/** Dominant type of a list of errors: the most frequent among the weighted ones. */
export function dominantDe(erreurs: Erreur[]): CodeErreur | null {
  const compteurs = new Map<CodeErreur, number>()
  for (const erreur of erreurs) {
    if (!erreur.ponderee) continue
    compteurs.set(erreur.code, (compteurs.get(erreur.code) ?? 0) + 1)
  }
  let meilleur: CodeErreur | null = null
  let max = 0
  for (const [code, n] of compteurs) {
    if (n > max) {
      max = n
      meilleur = code
    }
  }
  return meilleur
}

export function construireDiagnostic(
  brutes: ErreurBrute[],
  options: { id: string; createdAt: string },
): Diagnostic {
  const erreurs = brutes.map(normaliserErreur)
  return {
    id: options.id,
    createdAt: options.createdAt,
    matiere: 'maths',
    nbFautes: erreurs.length,
    erreurs,
    typeDominant: dominantDe(erreurs),
  }
}
