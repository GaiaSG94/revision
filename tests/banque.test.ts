import { describe, expect, it } from 'vitest'
import { BANQUE, exercicePour, exerciceVerifie, exercicesDe, origineExercice } from '../src/domain/banque'
import { CODES_ERREUR, libelleDe } from '../src/domain/taxonomy'
import type { CodeErreur } from '../src/domain/taxonomy'

/**
 * The bank replaces two network calls: if an exercise is off-topic, the product
 * serves an exercise that does not work on the student's weakness. These tests
 * are therefore the bank's safeguard — they check that each prompt really makes
 * the student perform its type's move.
 */
/** Word limits: "positive or zero" is not a blameful word. */
const MOTS_INTERDITS = [
  /tu t'es trompé/,
  /tu as faux/,
  // "zero" removed: in maths, "positive or zero" is a legitimate phrase; the
  // other terms are unambiguous.
  /\bgrave\b/,
  /\bhonte\b/,
  /\bincapable\b/,
  /toujours faux/,
]

/** Keyword of the expected move in the prompt, by code. */
const SIGNATURES: Record<string, RegExp> = {
  E01: /-\s*\d*\s*\(/, // a negative factor before parentheses
  E02: /\d?\(?x?\)?\(/, // parentheses to expand
  E03: /²|\) ?\(/, // a square or a product of two binomials
  E04: /\d\/\d/, // fractions
  E05: /domain|x² = |√\(/, // forbidden value, two roots, domain
  E06: /[²³ⁿ]|x⁵|÷ x/, // exponents
  E07: /√/, // roots
  E08: /=/, // an equation to transpose
  E09: /exact|arrondi/i, // precision
  E10: /unit|m²|km\/h|Convert/i, // units
  E11: /Copy/i, // copying
  E12: /Show|Prove|justif/i, // justification
}

describe('local exercise bank (idea 1)', () => {
  it('covers the 12 codes with 3 exercises and the 3 difficulty levels', () => {
    for (const code of CODES_ERREUR) {
      const liste = BANQUE[code]
      expect(liste, `${code} missing from the bank`).toHaveLength(3)
      expect(liste.map((e) => e.difficulte).sort()).toEqual([1, 2, 3])
      for (const exercice of liste) {
        expect(exercice.code).toBe(code)
        expect(exercice.niveau).toMatch(/Grade 10|Grade 11/)
      }
    }
  })

  it('unique identifiers across the whole bank', () => {
    const ids = CODES_ERREUR.flatMap((code) => BANQUE[code].map((e) => e.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(36)
  })

  it('no empty field, one or two hints, a solution that explains', () => {
    for (const code of CODES_ERREUR) {
      for (const exercice of BANQUE[code]) {
        expect(exercice.enonce.trim().length).toBeGreaterThan(8)
        expect(exercice.solution.trim().length).toBeGreaterThan(10)
        expect(exercice.piege.trim().length).toBeGreaterThan(5)
        expect(exercice.indices.length).toBeGreaterThanOrEqual(1)
        expect(exercice.indices.length).toBeLessThanOrEqual(2)
        expect(exercice.indices[0]!.length).toBeGreaterThan(8)
        // A hint must not give away the final answer.
        expect(exercice.indices[0]).not.toBe(exercice.solution)
      }
    }
  })

  it('each prompt really makes the student perform its type’s move', () => {
    for (const code of CODES_ERREUR) {
      const signature = SIGNATURES[code]!
      for (const exercice of BANQUE[code]) {
        expect(
          signature.test(exercice.enonce),
          `${exercice.id} (${libelleDe(code)}): "${exercice.enonce}" does not match the expected move`,
        ).toBe(true)
      }
    }
  })

  it('caring tone: no blameful word', () => {
    for (const code of CODES_ERREUR) {
      for (const exercice of BANQUE[code]) {
        const texte = `${exercice.enonce} ${exercice.indices.join(' ')} ${exercice.solution} ${exercice.piege}`.toLowerCase()
        for (const mot of MOTS_INTERDITS) {
          expect(mot.test(texte), `${exercice.id} contains "${mot.source}"`).toBe(false)
        }
      }
    }
  })

  it('E99 has no exercise: we do not work on an untyped error', () => {
    expect(exercicesDe('E99')).toEqual([])
    expect(exercicesDe('ZZZ' as CodeErreur)).toEqual([])
    expect(exercicePour('E99')).toBeUndefined()
  })

  it('exercicePour respects difficulty and avoids already-seen exercises', () => {
    expect(exercicePour('E01', { difficulte: 2 })?.difficulte).toBe(2)
    const premier = exercicePour('E04', { graine: 0 })!
    const second = exercicePour('E04', { graine: 0, exclure: [premier.id] })!
    expect(second.id).not.toBe(premier.id)
  })

  it('deterministic for equal options', () => {
    const a = exercicePour('E06', { graine: 1 })
    const b = exercicePour('E06', { graine: 1 })
    expect(a).toEqual(b)
  })

  it('falls back to an exercise of the same type when everything is excluded', () => {
    const tous = BANQUE.E07.map((e) => e.id)
    const resultat = exercicePour('E07', { exclure: tous })
    expect(resultat).toBeDefined()
    expect(resultat!.code).toBe('E07')
  })

  it('conversion produces a verified exercise, marked as coming from the bank', () => {
    const exercice = exerciceVerifie(BANQUE.E01[0]!)
    expect(exercice.exercice.typeTravaille).toBe('E01')
    expect(exercice.exercice.tentative).toBe(0)
    expect(exercice.verdict.travailleLeBonType).toBe(true)
    expect(exercice.verdict.neDonneLaSolutionOrigine).toBe(true)
    expect(exercice.verdict.memeNiveau).toBe(true)
    expect(origineExercice(exercice.exercice)).toContain('local bank')
    expect(origineExercice({ ...exercice.exercice, tentative: 1 })).toContain('Fresh')
  })
})
