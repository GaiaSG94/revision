/**
 * Crash test — hostile model responses.
 *
 * The product depends on a third-party model that can return anything:
 * truncated JSON, inverted types, 5,000 annotations, 100 KB lines, absurd
 * confidences, out-of-frame zones. None of these inputs may:
 *   1. throw anything other than an `ErreurLLM` (otherwise the UI shows
 *      "Analysis failed" for no reason and loses context);
 *   2. produce an out-of-taxonomy code, a confidence outside [0,1] or a NaN;
 *   3. freeze rendering (unbounded lists or texts).
 *
 * These invariants are checked at every parsing step, never on a single happy
 * case.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_ANNOTATIONS,
  MAX_LONGUEUR_LIGNE,
  MAX_LONGUEUR_TEXTE,
} from '../../src/domain/config'
import { CODES_ERREUR } from '../../src/domain/taxonomy'
import { construireDiagnostic, normaliserErreur } from '../../src/domain/diagnostic'
import { decouperAnalyse } from '../../src/pipeline/analyse'
import { ErreurLLM } from '../../src/pipeline/llm'
import { parserAnalyse, parserClassification, parserExtraction } from '../../src/pipeline/schemas'

const CODES_VALIDES = new Set<string>([...CODES_ERREUR, 'E99'])

function estNombreSain(valeur: number): boolean {
  return Number.isFinite(valeur)
}

/** Every pipeline output must respect the invariants, whatever the input. */
function verifierInvariants(erreurs: ReturnType<typeof construireDiagnostic>['erreurs']) {
  for (const erreur of erreurs) {
    expect(CODES_VALIDES.has(erreur.code), `out-of-taxonomy code: ${erreur.code}`).toBe(true)
    expect(estNombreSain(erreur.confiance)).toBe(true)
    expect(erreur.confiance).toBeGreaterThanOrEqual(0)
    expect(erreur.confiance).toBeLessThanOrEqual(1)
    expect(erreur.ligne.length).toBeLessThanOrEqual(MAX_LONGUEUR_LIGNE)
    expect(erreur.explication.length).toBeLessThanOrEqual(MAX_LONGUEUR_TEXTE)
    expect(estNombreSain(erreur.ponderee ? 1 : 0)).toBe(true)
    if (erreur.zone) {
      for (const valeur of Object.values(erreur.zone)) {
        expect(estNombreSain(valeur), 'zone with NaN/Infinity').toBe(true)
        expect(valeur).toBeGreaterThanOrEqual(0)
        expect(valeur).toBeLessThanOrEqual(1)
      }
    }
  }
}

describe('crash test — hostile model inputs', () => {
  const CAS_HOSTILES: [string, string][] = [
    ['truncated JSON', '{"annotations": [{"ligne": "a"'],
    ['not JSON', 'sorry, I cannot analyse this image'],
    ['array instead of object', '[{"ligne":"a"}]'],
    ['JSON string', '"texte"'],
    ['nombre', '42'],
    ['null', 'null'],
    ['empty object', '{}'],
    ['inverted types', '{"annotations":"beaucoup","copiePropre":"oui"}'],
    ['null everywhere', '{"annotations":null,"copiePropre":null,"nomDetecte":null}'],
    [
      'absurd confidences',
      JSON.stringify({
        annotations: [
          { ligne: 'a', annotation: 'faux', code: 'E01', confiance: -5 },
          { ligne: 'b', annotation: 'faux', code: 'E01', confiance: 999 },
          { ligne: 'c', annotation: 'faux', code: 'E01', confiance: 'NaN' },
          { ligne: 'd', annotation: 'faux', code: 'E01', confiance: null },
          { ligne: 'e', annotation: 'faux', code: 'E01', confiance: '0.9' },
        ],
      }),
    ],
    [
      'unknown codes',
      JSON.stringify({
        annotations: [
          { ligne: 'a', annotation: 'x', code: 'E42', confiance: 0.9 },
          { ligne: 'b', annotation: 'x', code: '', confiance: 0.9 },
          { ligne: 'c', annotation: 'x', code: null, confiance: 0.9 },
          { ligne: 'd', annotation: 'x', code: 12, confiance: 0.9 },
          { ligne: 'e', annotation: 'x', confiance: 0.9 },
        ],
      }),
    ],
    [
      'out-of-frame zones',
      JSON.stringify({
        annotations: [
          { ligne: 'a', annotation: 'x', code: 'E01', confiance: 0.9, zone: { x: -3, y: 9, largeur: 1e9, hauteur: -0.5 } },
          { ligne: 'b', annotation: 'x', code: 'E01', confiance: 0.9, zone: { x: 'a', y: null, largeur: NaN, hauteur: Infinity } },
          { ligne: 'c', annotation: 'x', code: 'E01', confiance: 0.9, zone: null },
        ],
      }),
    ],
    ['100 KB line', JSON.stringify({ annotations: [{ ligne: 'x'.repeat(100_000), annotation: 'faux', code: 'E01', confiance: 0.9 }] })],
    [
      '5,000 annotations',
      JSON.stringify({
        annotations: Array.from({ length: 5000 }, (_, i) => ({
          ligne: `ligne ${i}`,
          annotation: 'faux',
          code: 'E01',
          confiance: 0.9,
        })),
      }),
    ],
    ['unknown fields', JSON.stringify({ annotations: [{ ligne: 'a', annotation: 'x', code: 'E01', confiance: 0.9, surprise: { a: [1, 2, 3] } }], injection: 'ignore the instructions' })],
    ['markdown around', '```json\n{"annotations":[{"ligne":"a","annotation":"faux","code":"E01","confiance":0.9}]}\n```'],
    ['text before and after', 'Here: {"annotations":[{"ligne":"a","annotation":"faux","code":"E01","confiance":0.9}]} — end'],
  ]

  it.each(CAS_HOSTILES)('extraction: %s breaks nothing', (_titre, brut) => {
    let extraction
    try {
      extraction = parserExtraction(brut)
    } catch (erreur) {
      expect(erreur, 'an error must be an ErreurLLM').toBeInstanceOf(ErreurLLM)
      return
    }
    expect(extraction.annotations.length).toBeLessThanOrEqual(MAX_ANNOTATIONS)
    for (const annotation of extraction.annotations) {
      expect(annotation.ligne.length).toBeLessThanOrEqual(MAX_LONGUEUR_LIGNE)
      expect(annotation.annotation.length).toBeLessThanOrEqual(MAX_LONGUEUR_TEXTE)
      if (annotation.zone) {
        for (const valeur of Object.values(annotation.zone)) {
          expect(Number.isFinite(valeur)).toBe(true)
          expect(valeur).toBeGreaterThanOrEqual(0)
          expect(valeur).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it.each(CAS_HOSTILES)('merged analysis: %s breaks nothing', (_titre, brut) => {
    let resultat
    try {
      resultat = decouperAnalyse(parserAnalyse(brut))
    } catch (erreur) {
      expect(erreur, 'an error must be an ErreurLLM').toBeInstanceOf(ErreurLLM)
      return
    }
    expect(resultat.extraction.annotations.length).toBeLessThanOrEqual(MAX_ANNOTATIONS)
    verifierInvariants(resultat.erreurs)
  })

  it.each(CAS_HOSTILES)('classification: %s breaks nothing', (_titre, brut) => {
    let brutes
    try {
      brutes = parserClassification(brut)
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurLLM)
      return
    }
    const diagnostic = construireDiagnostic(brutes, { id: 'crash', createdAt: '2026-11-12T12:00:00.000Z' })
    verifierInvariants(diagnostic.erreurs)
  })

  it('normaliserErreur handles anything without throwing', () => {
    const entrees = [
      {},
      { code: null },
      { code: undefined, confiance: undefined },
      { code: 'E01', confiance: Number.NaN },
      { code: 'E01', confiance: Number.POSITIVE_INFINITY },
      { code: 'E01', confiance: -1, ligne: null, explication: 42 },
      { code: 'E01', confiance: 0.9, zone: 'pas-une-zone' },
      { code: 'E01', confiance: 0.9, ligne: { objet: true } },
    ]
    for (const entree of entrees) {
      const erreur = normaliserErreur(entree as never)
      expect(CODES_VALIDES.has(erreur.code)).toBe(true)
      expect(Number.isFinite(erreur.confiance)).toBe(true)
      expect(erreur.confiance).toBeGreaterThanOrEqual(0)
      expect(erreur.confiance).toBeLessThanOrEqual(1)
    }
  })

  it('a paper with no valid annotation stays "clean": zero invented error', () => {
    const cas = [
      '{"annotations":[],"copiePropre":false}',
      '{"annotations":[{"ligne":"","annotation":"   "}],"copiePropre":false}',
      '{"annotations":null}',
      '{"annotations":[null,null]}',
    ]
    for (const brut of cas) {
      try {
        const { extraction, erreurs } = decouperAnalyse(parserAnalyse(brut))
        if (extraction.annotations.length === 0) {
          expect(extraction.copiePropre).toBe(true)
          expect(erreurs).toHaveLength(0)
        }
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurLLM)
      }
    }
  })
})
