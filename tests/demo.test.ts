import { describe, expect, it } from 'vitest'
import { construireDiagnostic } from '../src/domain/diagnostic'
import { PROMPT_ANALYSE, decouperAnalyse } from '../src/pipeline/analyse'
import {
  COPIES_DEMO,
  ID_COPIES_DEMO,
  TOUR_DEMO,
  clientDemoPour,
  copieDemo,
  etapeDe,
  echantillonDe,
  origineDemo,
  titreCarte,
} from '../src/pipeline/demo'
import { PROMPT_GARDE_FOU, PROMPT_GENERATION, verdictAccepte } from '../src/pipeline/exercise'
import { PROMPT_REVUE } from '../src/pipeline/revue'
import { parserAnalyse, parserExercice, parserVerdict } from '../src/pipeline/schemas'

/**
 * Demo mode replays real model responses. These tests check that every recording
 * is still usable **on the product's current path**: a pipeline change (merged
 * calls, second pass) silently breaks the demo if we do not recapture — this
 * happened on 11/11, everything fell back to E99. The test now fails in that
 * case.
 */
describe('demo mode', () => {
  it('recognizes the step from the prompt', () => {
    const requete = (system: string) => ({ system, user: 'x' })
    expect(etapeDe(requete(PROMPT_ANALYSE))).toBe('analyse')
    expect(etapeDe(requete(PROMPT_REVUE))).toBe('revue')
    expect(etapeDe(requete(PROMPT_GENERATION))).toBe('exercice')
    expect(etapeDe(requete(PROMPT_GARDE_FOU))).toBe('verdict')
  })

  it('at least one paper is recorded, with a stable identifier', () => {
    expect(COPIES_DEMO.length).toBeGreaterThanOrEqual(1)
    expect(ID_COPIES_DEMO).toHaveLength(COPIES_DEMO.length)
    expect(copieDemo(ID_COPIES_DEMO[0])?.id).toBe(ID_COPIES_DEMO[0])
    expect(copieDemo('inexistant')).toBeUndefined()
    expect(copieDemo()).toBeDefined()
  })

  it.each(ID_COPIES_DEMO)('paper %s replays as a typed diagnosis', async (id) => {
    const client = clientDemoPour(id, { attente: false })
    const meta = origineDemo(id)
    expect(meta).not.toBeNull()

    const brut = parserAnalyse(await client({ system: PROMPT_ANALYSE, user: 'x' }))
    const { extraction, erreurs } = decouperAnalyse(brut)

    // A recorded "clean" paper: the expected diagnosis is no error (RNF-04),
    // and the pipeline stops before classification and exercise — there is
    // nothing left to replay.
    if (meta!.dominant === 'propre') {
      expect(extraction.copiePropre).toBe(true)
      expect(erreurs).toHaveLength(0)
      return
    }

    expect(extraction.copiePropre).toBe(false)
    expect(erreurs.length).toBeGreaterThanOrEqual(1)

    const diagnostic = construireDiagnostic(erreurs, { id, createdAt: '2026-11-12T12:00:00.000Z' })
    // Anti-E99 guard: if everything falls back to "untyped", the recording is obsolete.
    expect(diagnostic.erreurs.some((e) => e.code !== 'E99'), 'all errors in E99').toBe(true)
    expect(diagnostic.typeDominant).toBe(meta!.dominant)
    if (meta!.nbFautes !== null) expect(diagnostic.nbFautes).toBe(meta!.nbFautes)

    const exercice = parserExercice(await client({ system: PROMPT_GENERATION, user: 'x' }))
    expect(exercice.enonce.length).toBeGreaterThan(10)
    expect(exercice.solution.length).toBeGreaterThan(10)

    const verdict = parserVerdict(await client({ system: PROMPT_GARDE_FOU, user: 'x' }))
    if (!verdictAccepte(verdict)) {
      // Accepted refusal: two attempts exhausted, the product does not serve
      // an off-topic exercise and says so ("exercise unavailable"). A silent
      // refusal would be a bug — it must always be justified.
      expect(verdict.motifs.length).toBeGreaterThan(0)
    }
  })

  it('a recording with no second-pass answer raises an explicit message', async () => {
    const copie = COPIES_DEMO.find((c) => !c.enregistrement.reponses.revue)
    if (!copie) return // all papers have a recorded review: nothing to test
    const client = clientDemoPour(copie.id, { attente: false })
    await expect(client({ system: PROMPT_REVUE, user: 'x' })).rejects.toThrow(/recapture/)
  })
})

/**
 * Demo corpus v2 (papers from 15/11): four papers from the same Grade 12
 * student — the sign mistake comes back, then disappears. The expectations
 * below are **measured** (docs/VALIDATION-MODELE.md): if a recapture changes a
 * result, this test fails and the documentation must be updated in the same
 * commit — not the other way around.
 */
describe('demo corpus v2 — Jordan, Grade 12', () => {
  const ATTENDU: Record<string, string> = {
    'v2-copie-1': 'E01',
    'v2-copie-2': 'E01',
    'v2-copie-3': 'E01',
    'v2-copie-4': 'propre',
  }

  it('the four cards carry the announced titles', () => {
    const titres = Object.keys(ATTENDU).map((id) => titreCarte(echantillonDe(id)!))
    expect(titres).toEqual([
      'Jordan · Test 3 — Algebra & derivatives',
      'Jordan · Test 4 — Antiderivatives',
      'Jordan · Test 5 — Definite integrals',
      'Jordan · Quiz — Integration',
    ])
  })

  it.each(Object.entries(ATTENDU))('%s is recorded with the expected type', (id, dominant) => {
    const copie = copieDemo(id)
    expect(copie, `${id} missing from the demo corpus`).toBeDefined()
    expect(copie!.enregistrement.dominant).toBe(dominant)
  })

  it('paper 1 also detects E03, the clean paper no code', () => {
    const analyse = JSON.parse(copieDemo('v2-copie-1')!.enregistrement.reponses.analyse!) as {
      annotations: { code: string }[]
      copiePropre: boolean
    }
    const codes = analyse.annotations.map((annotation) => annotation.code)
    expect(codes).toContain('E03')
    expect(codes).toContain('E01')
    const propre = JSON.parse(copieDemo('v2-copie-4')!.enregistrement.reponses.analyse!) as {
      annotations: unknown[]
      copiePropre: boolean
    }
    expect(propre.copiePropre).toBe(true)
    expect(propre.annotations).toHaveLength(0)
  })

  it('the guided tour follows Jordan’s four papers', () => {
    expect(TOUR_DEMO).toEqual(['v2-copie-1', 'v2-copie-2', 'v2-copie-3', 'v2-copie-4'])
  })
})
