/**
 * "What to review on Monday" decision (teacher mode) — pure, tested logic.
 *
 * From the class statistic, we pull out the two most common error types and
 * propose a concrete whole-class review. The instructions are **static** (a
 * table by code): no generation, no network dependency, no blameful wording
 * towards students.
 */
import { CODES_ERREUR, estPonderee, libelleDe } from './taxonomy'
import type { CodeErreur } from './taxonomy'
import type { StatsClasse } from './types'

/** Review plan proposed to the teacher. */
export type PlanLundi = {
  /** Selected types, sorted by decreasing frequency (1 or 2 entries). */
  types: CodeErreur[]
  /** Action sentence in English, neutral and useful tone. */
  phrase: string
  /** Whole-class exercise instruction for each selected type. */
  exercices: { code: CodeErreur; consigne: string }[]
  /** Cumulative share (0..1) of the selected types in the weighted total. */
  partCumulee: number
}

/**
 * Retention threshold for the second type, expressed as a share of the
 * weighted total.
 *
 * We keep the second type only if it accounts for at least 20% of the class's
 * weighted errors. Below that, the signal is too weak to justify a whole-class
 * review, so we keep a single majority type.
 */
const SEUIL_DEUXIEME_TYPE = 0.2

/** Whole-class instructions, one per type — static content, never generated. */
const CONSIGNES: Record<(typeof CODES_ERREUR)[number], string> = {
  E01: 'Five expansions with a negative factor, done at the board while naming each sign.',
  E02: 'Three double distributivities where every term in the parentheses is multiplied, checked in pairs.',
  E03: 'Four special products to expand by writing all three terms, including the double product.',
  E04: 'Three sums of fractions over a common denominator, rewriting each adjusted numerator.',
  E05: 'Five equations to solve by discussing the values excluded from the domain before concluding.',
  E06: 'Four power computations to detail by applying each exponent rule, step by step.',
  E07: 'Three root simplifications to justify by keeping each factor under the radical.',
  E08: 'Five equations to transpose by naming the inverse operation applied to each side.',
  E09: 'Three computations kept in exact values until the last step, then rounded once.',
  E10: 'Four word problems to solve by writing the unit on every result and checking conversions.',
  E11: 'Reread the statement aloud before starting, then point to the copied line.',
  E12: 'Two short proofs to complete by writing each logical implication that links the steps.',
}

/** Instruction for a selected type; since E99 is never selected, this fallback is defensive. */
function consignePour(code: CodeErreur): string {
  if (code === 'E99') return 'Targeted review with the class.'
  return CONSIGNES[code]
}

/** Weighted total restricted to actually weighted codes (excluding E11, E99). */
function totalPondereStats(stats: StatsClasse): number {
  return CODES_ERREUR.reduce((somme, code) => somme + (estPonderee(code) ? stats.parType[code] ?? 0 : 0), 0)
}

/** Weighted types sorted by decreasing frequency, then by taxonomy order. */
function typesTries(stats: StatsClasse): CodeErreur[] {
  return CODES_ERREUR.filter((code) => estPonderee(code) && (stats.parType[code] ?? 0) > 0).sort(
    (a, b) => (stats.parType[b] ?? 0) - (stats.parType[a] ?? 0),
  )
}

export function quoiReprendreLundi(stats: StatsClasse): PlanLundi {
  const total = totalPondereStats(stats)
  if (total === 0) {
    return { types: [], phrase: 'Nothing to review with the whole class.', exercices: [], partCumulee: 0 }
  }

  const classes = typesTries(stats)
  const premier = classes[0]
  if (!premier) {
    return { types: [], phrase: 'Nothing to review with the whole class.', exercices: [], partCumulee: 0 }
  }

  const second = classes[1]
  const partSecond = second ? (stats.parType[second] ?? 0) / total : 0
  const garderSecond = second !== undefined && partSecond >= SEUIL_DEUXIEME_TYPE

  const types = garderSecond ? [premier, second] : [premier]
  const partCumulee = types.reduce((somme, code) => somme + (stats.parType[code] ?? 0), 0) / total

  const libelles = types.map((code) => libelleDe(code).toLowerCase())
  const phrase =
    libelles.length === 1
      ? `To review on Monday: ${libelles[0]}.`
      : `To review on Monday: ${libelles[0]} and ${libelles[1]}.`

  return {
    types,
    phrase,
    exercices: types.map((code) => ({ code, consigne: consignePour(code) })),
    partCumulee,
  }
}
