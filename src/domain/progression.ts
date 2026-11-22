/**
 * Profile trajectory — batch 5. The product pitch: "1st paper → a diagnosis,
 * 3rd → a pattern, 5th → a plan". Until now the profile was a snapshot (counters);
 * this module turns it into a trajectory: how each type evolves across papers,
 * and when a weakness has disappeared.
 *
 * Pure, tested logic, with no DOM dependency.
 */
import { CODES_ERREUR, libelleDe } from './taxonomy'
import type { CodeErreur } from './taxonomy'
import { typeDominant } from './profil'
import type { Diagnostic, Profil } from './types'

export type Tendance = 'baisse' | 'hausse' | 'stable' | 'inconnue'

/**
 * Number of errors of a code per paper, in chronological order. E11 and E99
 * count 0 in the weighted series: they are not underlying gaps, and letting
 * them vary would suggest a progress that does not exist.
 */
export function occurrencesParCopie(diagnostics: Diagnostic[], code: CodeErreur): number[] {
  return diagnostics.map(
    (diagnostic) =>
      diagnostic.erreurs.filter((erreur) => erreur.code === code && erreur.ponderee).length,
  )
}

/**
 * Simple, documented trend: compare the average of the last 2 papers with that
 * of the previous papers. Fewer than 2 papers → "unknown" (we do not guess a
 * progress from a single paper).
 */
export function tendance(serie: number[]): Tendance {
  if (serie.length < 2) return 'inconnue'
  const recentes = serie.slice(-2)
  const anciennes = serie.slice(0, -2)
  const moyenne = (nombres: number[]) =>
    nombres.length === 0 ? 0 : nombres.reduce((a, b) => a + b, 0) / nombres.length
  const mRecente = moyenne(recentes)
  const mAncienne = anciennes.length === 0 ? moyenne(serie.slice(0, -1)) : moyenne(anciennes)
  if (mRecente < mAncienne - 0.001) return 'baisse'
  if (mRecente > mAncienne + 0.001) return 'hausse'
  return 'stable'
}

/**
 * A weakness has "disappeared" if it was dominant on the early papers and no
 * longer appears at all on the last 3. Deliberately cautious rule: at least 4
 * papers are required to claim this.
 */
export function failleDisparue(diagnostics: Diagnostic[], code: CodeErreur): boolean {
  if (diagnostics.length < 4) return false
  const premieres = diagnostics.slice(0, -3)
  const dernieres = diagnostics.slice(-3)
  const etaitDominante = premieres.some((d) => d.typeDominant === code)
  const plusAucune = dernieres.every((d) => !d.erreurs.some((e) => e.code === code && e.ponderee))
  return etaitDominante && plusAucune
}

export function pointsCourbe(serie: number[]): { index: number; valeur: number }[] {
  return serie.map((valeur, index) => ({ index, valeur }))
}

/** Caring sentence reflecting the trend of the dominant type. */
export function messageProgression(profil: Profil, diagnostics: Diagnostic[]): string {
  const dominant = typeDominant(profil)
  if (!dominant) return 'No recurring mistake yet: add a paper to start your trajectory.'
  const serie = occurrencesParCopie(diagnostics, dominant)
  const tendanceDuType = tendance(serie)
  const nom = libelleDe(dominant).toLowerCase()
  const total = serie.reduce((a, b) => a + b, 0)

  if (failleDisparue(diagnostics, dominant)) {
    return `Nice progress: "${nom}" no longer shows up in your last 3 papers.`
  }
  if (tendanceDuType === 'baisse') {
    return `"${nom}" is going down: ${total} time(s) in all, fewer on your recent papers. Keep going.`
  }
  if (tendanceDuType === 'hausse') {
    return `"${nom}" shows up more often lately: a good moment for a targeted exercise.`
  }
  if (tendanceDuType === 'stable') {
    return `"${nom}" stays steady (${total} time(s)): a targeted exercise can help bring it down.`
  }
  return `Analyse at least two papers to see your progress on "${nom}".`
}

/** Codes to plot: the 3 most frequent in the profile. */
export function codesATracer(profil: Profil): CodeErreur[] {
  return CODES_ERREUR.filter((code) => (profil.parType[code] ?? 0) > 0)
    .sort((a, b) => (profil.parType[b] ?? 0) - (profil.parType[a] ?? 0))
    .slice(0, 3)
}
