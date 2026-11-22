/**
 * Crash test — failures. Network down, dead proxy, saturated upstream (503/402),
 * quota exceeded, invalid response body: the product must **degrade cleanly**,
 * i.e. throw a readable `ErreurLLM` (never a `SyntaxError` nor a Promise), with
 * a bounded number of calls and no infinite loop.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHAINE_MODELES } from '../../src/domain/config'
import { construireDiagnostic } from '../../src/domain/diagnostic'
import { agreger, profilVide, totalPondere } from '../../src/domain/profil'
import { clientSimule } from '../../src/pipeline/client'
import { genererExerciceVerifie } from '../../src/pipeline/exercise'
import { ErreurLLM, completer, transportParDefaut } from '../../src/pipeline/llm'
import { appliquerRevue, indicesASurveiller, revoirFautesPeuSures } from '../../src/pipeline/revue'
import type { Erreur } from '../../src/domain/types'
import { creerQuota } from '../../api/_quota'

const transport = transportParDefaut('https://proxy.test/analyze')
const requete = { system: 's', user: 'u' }

function reponseBrute(statut: number, corps: string): Response {
  return new Response(corps, { status: statut, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('crash test — network and upstream failures', () => {
  it('network down: one call, readable ErreurLLM (no loop)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const erreur = await completer(transport, requete).catch((e: unknown) => e)
    expect(erreur).toBeInstanceOf(ErreurLLM)
    expect((erreur as ErreurLLM).message).toContain('Network unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('whole chain saturated: exactly one call per model, then the real error', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => reponseBrute(503, '{"erreur":"no available provider"}'))
    vi.stubGlobal('fetch', fetchMock)

    const erreur = await completer(transport, requete).catch((e: unknown) => e)
    expect(erreur).toBeInstanceOf(ErreurLLM)
    expect((erreur as ErreurLLM).message).toContain('no available provider')
    expect(fetchMock).toHaveBeenCalledTimes(CHAINE_MODELES.length)
  })

  it('mixed failures (503, 402, 500, 504): eventually succeeds', async () => {
    const statuts = [503, 402, 500, 504]
    let appel = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      const statut = statuts[appel] ?? 200
      appel += 1
      return statut === 200
        ? reponseBrute(200, '{"texte":"ok"}')
        : reponseBrute(statut, '{"erreur":"panne"}')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(completer(transport, requete)).resolves.toBe('ok')
    expect(appel).toBe(5)
  })

  it('proxy quota: one call, and the message offers BYOK', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        reponseBrute(429, '{"erreur":"Proxy quota reached for this hour.","quota":"proxy"}'),
      )
    vi.stubGlobal('fetch', fetchMock)

    const erreur = await completer(transport, requete).catch((e: unknown) => e)
    expect((erreur as ErreurLLM).message).toContain('Paste your own key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('upstream 429 then 503 everywhere: bounded calls (no storm)', async () => {
    let appel = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      appel += 1
      return appel === 1 ? reponseBrute(429, '{"erreur":"rate limit"}') : reponseBrute(503, '{"erreur":"ko"}')
    })
    vi.stubGlobal('fetch', fetchMock)

    await completer(transport, requete).catch(() => undefined)
    // 1st model: 429 then a second chance; the other 5: 1 call each.
    expect(appel).toBeLessThanOrEqual(CHAINE_MODELES.length + 1)
  }, 20_000)

  it('global budget: the chain stops instead of waiting 9 minutes', async () => {
    // The clock advances 90 s per read: with a 200 s budget, the chain must
    // stop before exhausting all six models.
    let maintenant = 1_700_000_000_000
    const horloge = vi.spyOn(Date, 'now').mockImplementation(() => {
      const valeur = maintenant
      maintenant += 90_000
      return valeur
    })
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => reponseBrute(503, '{"erreur":"no available provider"}'))
    vi.stubGlobal('fetch', fetchMock)

    const erreur = await completer(transport, requete).catch((e: unknown) => e)
    // Clock restored BEFORE the assertions: a failure here must not skew
    // the timing of following tests (cascading "over budget").
    horloge.mockRestore()
    expect(erreur).toBeInstanceOf(ErreurLLM)
    expect((erreur as ErreurLLM).message).toContain('too slow')
    // The budget must cut the chain short, whatever the bounds.
    expect(fetchMock.mock.calls.length).toBeLessThan(CHAINE_MODELES.length)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0)
  })

  it('invalid or empty body: ErreurLLM, never a SyntaxError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response('<html>502 Bad Gateway</html>', { status: 200 })),
    )
    const erreurHtml = await completer(transport, requete).catch((e: unknown) => e)
    expect(erreurHtml).toBeInstanceOf(ErreurLLM)
    expect(erreurHtml).not.toBeInstanceOf(SyntaxError)

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => reponseBrute(200, '{"texte":"   "}')))
    const erreurVide = await completer(transport, requete).catch((e: unknown) => e)
    expect((erreurVide as ErreurLLM).message).toContain('Empty')
  })

  it('exercise generation failure: the error propagates, not swallowed', async () => {
    const client = clientSimule([]) // no response: throws on the first call
    await expect(
      genererExerciceVerifie({ typeDominant: 'E01', extraitCopie: 'x', transport, client }),
    ).rejects.toThrow()
  })

  it('second pass: a hostile verdict does not corrupt the error list', async () => {
    const erreurs: Erreur[] = [
      { code: 'E01', libelle: 'l', ligne: 'a', explication: 'e', confiance: 0.7, ponderee: true },
      { code: 'E04', libelle: 'l', ligne: 'b', explication: 'e', confiance: 0.65, ponderee: true },
      { code: 'E06', libelle: 'l', ligne: 'c', explication: 'e', confiance: 0.95, ponderee: true },
    ]
    const indices = indicesASurveiller(erreurs)
    const verdictsPourris = [
      { index: 99, code: 'E12', confiance: 0.9, explication: 'out of list', decision: 'reclasse' },
      { index: -3, code: 'E12', confiance: 0.9, explication: 'negative', decision: 'reclasse' },
      { index: 0, code: 'PAS_UN_CODE', confiance: 5, explication: '', decision: 'x' },
    ]
    const { erreurs: revues } = appliquerRevue(erreurs, indices, verdictsPourris)
    expect(revues).toHaveLength(erreurs.length)
    // The out-of-review error (confidence 0.95) is intact.
    expect(revues[2]).toEqual(erreurs[2])
    // Out-of-list indices (99, -3) change nothing.
    const touchees = revues.filter((erreur, index) => erreur.code !== erreurs[index]!.code)
    expect(touchees).toHaveLength(1)
    // The unknown code falls back to E99, never an invention.
    expect(touchees[0]!.code).toBe('E99')
    expect(revues.every((erreur) => erreur.ligne.length > 0)).toBe(true)
  })

  it('second pass failure: original errors are kept unchanged', async () => {
    const erreurs: Erreur[] = [
      { code: 'E01', libelle: 'l', ligne: 'a', explication: 'e', confiance: 0.7, ponderee: true },
    ]
    await expect(revoirFautesPeuSures(erreurs, transport, clientSimule([]))).rejects.toThrow()
    expect(erreurs[0]!.code).toBe('E01')
    expect(erreurs[0]!.confiance).toBe(0.7)
  })
})

describe('crash test — proxy quota under load', () => {
  it('500 visitors × 40 calls: caps hold, memory stays bounded', () => {
    const quota = creerQuota({ parIpParHeure: 20, globalParJour: 2000 })
    const maintenant = 1_700_000_000_000
    let autorises = 0
    for (let visiteur = 0; visiteur < 500; visiteur += 1) {
      let accepts = 0
      for (let appel = 0; appel < 40; appel += 1) {
        if (quota.autoriser(`ip-${visiteur}`, maintenant + appel)) accepts += 1
      }
      expect(accepts, `visitor ${visiteur} over the cap`).toBeLessThanOrEqual(20)
      autorises += accepts
    }
    expect(autorises).toBeLessThanOrEqual(2000)
    expect(quota.restant('ip-0', maintenant + 100)).toBe(0)
    expect(quota.restant('jamais-vu', maintenant + 100)).toBe(0) // global cap reached
  })

  it('no overshoot after the day rolls over', () => {
    const quota = creerQuota({ parIpParHeure: 2, globalParJour: 3 })
    const maintenant = 1_700_000_000_000
    expect(quota.autoriser('a', maintenant)).toBe(true)
    expect(quota.autoriser('b', maintenant)).toBe(true)
    expect(quota.autoriser('c', maintenant)).toBe(true)
    expect(quota.autoriser('d', maintenant)).toBe(false)
    expect(quota.autoriser('d', maintenant + 86_400_001)).toBe(true)
  })
})

describe('crash test — corrupted local storage data', () => {
  it('a damaged diagnosis (null errors) does not break aggregation', () => {
    const corrompu = {
      id: 'x',
      createdAt: 'date-invalide',
      matiere: 'maths' as const,
      nbFautes: 0,
      erreurs: null as unknown as Erreur[],
      typeDominant: null,
    }
    const avant = profilVide()
    const apres = agreger(avant, corrompu)
    // The unreadable diagnosis is ignored, not counted: the profile stays healthy.
    expect(apres.totalAnalyses).toBe(0)
    expect(totalPondere(apres)).toBe(0)
  })

  it('a diagnosis with no fields still stands', () => {
    const squelette = { erreurs: [] } as unknown as Parameters<typeof agreger>[1]
    expect(() => agreger(profilVide(), squelette)).not.toThrow()
  })

  it('building a diagnosis with no error stays consistent', () => {
    const diagnostic = construireDiagnostic([], { id: 'vide', createdAt: '2026-11-12T12:00:00.000Z' })
    expect(diagnostic.nbFautes).toBe(0)
    expect(diagnostic.erreurs).toEqual([])
    expect(diagnostic.typeDominant).toBeNull()
  })
})
