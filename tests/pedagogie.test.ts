import { describe, expect, it } from 'vitest'
import { CODES_ERREUR, libelleDe } from '../src/domain/taxonomy'
import { explicationDe, glossaire } from '../src/domain/pedagogie'

const MOTS_CULPABILISANTS = ["tu t'es trompé", 'tu as faux', 'nul', 'grave', 'honte', 'incapable', 'toujours faux']

function mots(texte: string): number {
  return texte.trim().split(/\s+/).filter(Boolean).length
}

describe('teaching content by type (batch 4)', () => {
  it('all 12 codes are covered, in order, and E99 has no explanation', () => {
    const codes = glossaire().map((e) => e.code)
    expect(codes).toEqual([...CODES_ERREUR])
    expect(explicationDe('E99')).toBeNull()
  })

  it('every entry has all its fields filled', () => {
    for (const code of CODES_ERREUR) {
      const e = explicationDe(code)!
      expect(e.titre).toBe(libelleDe(code))
      for (const champ of [e.pourquoi, e.geste, e.exemple, e.contreExemple, e.piege] as const) {
        expect(champ.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('why and move stay short (≤ 25 words)', () => {
    for (const code of CODES_ERREUR) {
      const e = explicationDe(code)!
      expect(mots(e.pourquoi)).toBeLessThanOrEqual(25)
      expect(mots(e.geste)).toBeLessThanOrEqual(25)
    }
  })

  it('example and counter-example differ (otherwise nothing is shown)', () => {
    for (const code of CODES_ERREUR) {
      const e = explicationDe(code)!
      expect(e.exemple).not.toBe(e.contreExemple)
    }
  })

  it('caring tone: no blameful word', () => {
    for (const code of CODES_ERREUR) {
      const e = explicationDe(code)!
      const texte = `${e.pourquoi} ${e.geste} ${e.piege}`.toLowerCase()
      for (const mot of MOTS_CULPABILISANTS) {
        expect(texte, `${code} contains "${mot}"`).not.toContain(mot)
      }
    }
  })

  it('each trap points to ANOTHER code (helps distinguish two close types)', () => {
    for (const code of CODES_ERREUR) {
      const e = explicationDe(code)!
      const autres = CODES_ERREUR.filter((c) => c !== code)
      expect(autres.some((c) => e.piege.includes(c)), `${code}: trap without another code`).toBe(true)
    }
  })
})