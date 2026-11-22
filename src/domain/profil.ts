/**
 * Error-profile aggregation (pipeline step 5) — pure, tested logic.
 *
 * Rules (REVISION.md §17):
 *  - one error = exactly one type;
 *  - E99 "untyped" is excluded from the profile;
 *  - E11 "copying" is reported but weighted 0;
 *  - the profile only knows counters: no image, no name.
 */
import { CODES_ERREUR, CODE_NON_TYPEE, entreDansLeProfil, estPonderee, libelleDe } from './taxonomy'
import type { CodeErreur } from './taxonomy'
import type { Diagnostic, Profil } from './types'

export function profilVide(): Profil {
  const parType = {} as Record<CodeErreur, number>
  for (const code of CODES_ERREUR) parType[code] = 0
  parType[CODE_NON_TYPEE] = 0
  return { parType, totalAnalyses: 0, evolution: [], signalees: {} }
}

/** Applies a diagnosis to the profile without ever mutating the input. */
export function agreger(profil: Profil, diagnostic: Diagnostic): Profil {
  // A local history can be damaged (browser quota, older version,
  // interrupted write): an unreadable diagnosis is ignored, never thrown.
  if (!diagnostic || !Array.isArray(diagnostic.erreurs)) return profil

  const parType = { ...profil.parType }
  const signalees = { ...profil.signalees }

  for (const erreur of diagnostic.erreurs) {
    // Every error is reported (honesty), but only weighted ones count in the
    // profile: E99 "untyped" and E11 "copying" stay at 0.
    signalees[erreur.code] = (signalees[erreur.code] ?? 0) + 1
    if (entreDansLeProfil(erreur.code) && estPonderee(erreur.code)) {
      parType[erreur.code] = (parType[erreur.code] ?? 0) + 1
    }
  }

  return {
    parType,
    signalees,
    totalAnalyses: profil.totalAnalyses + 1,
    evolution: [
      ...profil.evolution,
      { date: diagnostic.createdAt, typeDominant: diagnostic.typeDominant },
    ],
  }
}

export function totalPondere(profil: Profil): number {
  return CODES_ERREUR.reduce((somme, code) => somme + (profil.parType[code] ?? 0), 0)
}

/** Dominant type = highest weighted counter; null if the profile is empty. */
export function typeDominant(profil: Profil): CodeErreur | null {
  let meilleur: CodeErreur | null = null
  let max = 0
  for (const code of CODES_ERREUR) {
    const n = profil.parType[code] ?? 0
    if (n > max) {
      max = n
      meilleur = code
    }
  }
  return meilleur
}

/** Share of the type in the weighted total, 0..1. */
export function partDuType(profil: Profil, code: CodeErreur): number {
  const total = totalPondere(profil)
  if (total === 0) return 0
  return (profil.parType[code] ?? 0) / total
}

export function pourcentage(part: number): number {
  return Math.round(part * 100)
}

/**
 * Summary sentence displayed in the Profile view:
 * "62% of your mistakes: lost sign when expanding".
 */
export function phraseSynthese(profil: Profil): string {
  const dominant = typeDominant(profil)
  if (!dominant) return 'No recurring mistake yet: add a corrected paper.'
  const part = pourcentage(partDuType(profil, dominant))
  return `${part}% of your mistakes: ${libelleDe(dominant).toLowerCase()}`
}

/** Series sorted by decreasing frequency, for the Profile view bars. */
export function classement(profil: Profil): { code: CodeErreur; n: number; part: number }[] {
  const total = totalPondere(profil)
  return CODES_ERREUR.map((code) => ({
    code,
    n: profil.parType[code] ?? 0,
    part: total === 0 ? 0 : (profil.parType[code] ?? 0) / total,
  }))
    .filter((e) => e.n > 0)
    .sort((a, b) => b.n - a.n)
}

/** Readable evolution: number of papers where this type was dominant. */
export function occurrencesDominantes(profil: Profil, code: CodeErreur): number {
  return profil.evolution.filter((e) => e.typeDominant === code).length
}
