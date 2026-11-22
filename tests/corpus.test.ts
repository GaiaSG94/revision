import { describe, expect, it } from 'vitest'
import {
  COPIES_CORRIGEES,
  COPIES_PROPRES,
  reponseClassification,
  reponseExtraction,
} from '../corpus/fixtures'
import type { FixtureCopie } from '../corpus/fixtures'
import { construireDiagnostic } from '../src/domain/diagnostic'
import { classerAnnotations } from '../src/pipeline/classify'
import { clientSimule } from '../src/pipeline/client'
import { extraireAnnotations } from '../src/pipeline/extract'
import { transportParDefaut } from '../src/pipeline/llm'

const transport = transportParDefaut('/api/test')
const IMAGE = 'data:image/jpeg;base64,AAA'
const MAINTENANT = '2026-11-11T10:00:00.000Z'

/** Simulated extraction: the same annotations as the fixture. */
function extractionDe(fixture: FixtureCopie) {
  return { annotations: fixture.annotations, copiePropre: fixture.estPropre }
}

describe('RNF-03 — classification on the corpus', () => {
  it('at least 80% of papers recover their dominant type', async () => {
    let bons = 0
    for (const fixture of COPIES_CORRIGEES) {
      const erreurs = await classerAnnotations(
        extractionDe(fixture),
        transport,
        clientSimule([reponseClassification(fixture)]),
      )
      const diagnostic = construireDiagnostic(erreurs, { id: fixture.id, createdAt: MAINTENANT })
      if (diagnostic.typeDominant === fixture.typeDominantAttendu) bons += 1
    }
    expect(bons / COPIES_CORRIGEES.length).toBeGreaterThanOrEqual(0.8)
  })

  it('an uncertain annotation becomes E99 and leaves the profile', async () => {
    const fixture = COPIES_CORRIGEES[3]!
    const erreurs = await classerAnnotations(
      extractionDe(fixture),
      transport,
      clientSimule([reponseClassification(fixture)]),
    )
    const codes = erreurs.map((erreur) => erreur.code)
    expect(codes).toContain('E07')
    expect(codes).toContain('E99')
  })

  it('E11 stays reported but does not weigh on the dominant type', async () => {
    const fixture = COPIES_CORRIGEES[0]!
    const erreurs = await classerAnnotations(
      extractionDe(fixture),
      transport,
      clientSimule([reponseClassification(fixture)]),
    )
    const recopie = erreurs.find((erreur) => erreur.code === 'E11')
    expect(recopie?.ponderee).toBe(false)
  })
})

describe('RNF-04 — zero false positive on a clean paper', () => {
  it('no error, and no classification call', async () => {
    for (const fixture of COPIES_PROPRES) {
      const extraction = await extraireAnnotations(
        IMAGE,
        transport,
        clientSimule([reponseExtraction(fixture)]),
      )
      expect(extraction.copiePropre).toBe(true)
      // clientSimule([]) would throw if a call were attempted: the guarantee is there.
      const erreurs = await classerAnnotations(extraction, transport, clientSimule([]))
      expect(erreurs).toHaveLength(0)
      const diagnostic = construireDiagnostic(erreurs, { id: fixture.id, createdAt: MAINTENANT })
      expect(diagnostic.nbFautes).toBe(0)
      expect(diagnostic.typeDominant).toBeNull()
    }
  })
})
