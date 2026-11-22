import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * idb-keyval replaced by an in-memory Map: the cache is tested without a
 * browser. `__store` lets us inspect what is really written.
 */
vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>()
  return {
    get: async (cle: string) => store.get(cle),
    set: async (cle: string, valeur: unknown) => void store.set(cle, valeur),
    del: async (cle: string) => void store.delete(cle),
    keys: async () => Array.from(store.keys()),
    clear: async () => store.clear(),
    __store: store,
  }
})

import * as idb from 'idb-keyval'
import {
  MAX_ENTREES_CACHE,
  TTL_CACHE_MS,
  ecrireCache,
  empreinteImage,
  lireCache,
  purgerCache,
  viderCache,
} from '../src/storage/cache'
import type { AnalyseEnCache } from '../src/storage/cache'
import type { Diagnostic } from '../src/domain/types'

const magasin = (idb as unknown as { __store: Map<string, unknown> }).__store

function diagnostic(id: string): Diagnostic {
  return {
    id,
    createdAt: '2026-11-12T12:00:00.000Z',
    matiere: 'maths',
    nbFautes: 1,
    erreurs: [
      { code: 'E01', libelle: 'Signe perdu', ligne: 'a', explication: 'b', confiance: 0.9, ponderee: true },
    ],
    typeDominant: 'E01',
  }
}

function analyse(id: string, enregistreLe: string): AnalyseEnCache {
  return {
    enregistreLe,
    diagnostic: diagnostic(id),
    extraction: { annotations: [{ ligne: 'a', annotation: 'faux' }], copiePropre: false },
    exercice: null,
  }
}

beforeEach(() => {
  magasin.clear()
  vi.useRealTimers()
})

describe('local analysis cache (idea 4)', () => {
  it('the fingerprint is stable, deterministic and distinct per image', async () => {
    const a = await empreinteImage('data:image/png;base64,AAA')
    const b = await empreinteImage('data:image/png;base64,AAA')
    const c = await empreinteImage('data:image/png;base64,BBB')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('writes then reads back an analysis, with no image inside', async () => {
    const empreinte = await empreinteImage('data:image/png;base64,AAA')
    await ecrireCache(empreinte, analyse('d1', new Date().toISOString()))
    const relu = await lireCache(empreinte)
    expect(relu?.diagnostic.id).toBe('d1')
    expect(relu?.diagnostic.erreurs[0]?.code).toBe('E01')
    // RNF-P1: never an image in what is persisted.
    const brut = JSON.stringify(magasin.get(`revision/cache/${empreinte}`))
    expect(brut).not.toContain('base64')
    expect(brut).not.toContain('imageAnonymisee')
  })

  it('an expired entry is ignored then deleted', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-11-12T12:00:00Z'))
    const empreinte = await empreinteImage('data:image/png;base64,CCC')
    await ecrireCache(empreinte, analyse('vieux', '2026-11-12T12:00:00.000Z'))
    vi.setSystemTime(new Date(Date.parse('2026-11-12T12:00:00Z') + TTL_CACHE_MS + 1000))
    expect(await lireCache(empreinte)).toBeNull()
    expect(magasin.has(`revision/cache/${empreinte}`)).toBe(false)
  })

  it('the cache is capped: the oldest entries are dropped', async () => {
    const reference = Date.parse('2026-11-12T12:00:00Z')
    // Clock frozen just after the most recent write: without it, the test
    // depends on the real date and fails once 24 h have passed.
    vi.useFakeTimers().setSystemTime(new Date(reference + (MAX_ENTREES_CACHE + 6) * 1000))
    for (let i = 0; i < MAX_ENTREES_CACHE + 5; i += 1) {
      const empreinte = `empreinte-${i}`
      await ecrireCache(empreinte, analyse(`d${i}`, new Date(reference + i * 1000).toISOString()))
    }
    const restants = (await purgerCache()) as number
    expect(restants).toBeLessThanOrEqual(MAX_ENTREES_CACHE)
    // The oldest was purged, the newest kept.
    expect(await lireCache('empreinte-0')).toBeNull()
    expect((await lireCache(`empreinte-${MAX_ENTREES_CACHE + 4}`))?.diagnostic.id).toBe(
      `d${MAX_ENTREES_CACHE + 4}`,
    )
  })

  it('viderCache does not touch the diagnosis history', async () => {
    await ecrireCache('e1', analyse('d1', new Date().toISOString()))
    magasin.set('revision/diagnostics', [diagnostic('autre')])
    await viderCache()
    expect(magasin.has('revision/cache/e1')).toBe(false)
    expect(magasin.has('revision/diagnostics')).toBe(true)
  })

  it('a missing key returns null, not an exception', async () => {
    await expect(lireCache('inconnue')).resolves.toBeNull()
  })
})
