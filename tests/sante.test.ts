import { afterEach, describe, expect, it, vi } from 'vitest'
import { reordonner, sonderModeles, sonderProxy, urlSante } from '../src/pipeline/sante'
import { controleBanque, controleBudget, controleTaxonomie } from '../src/pipeline/diagnostic'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('proxy probe (batch 2)', () => {
  it('replaces /analyze with /health, without breaking a simple origin', () => {
    expect(urlSante('https://h.modal.run/analyze')).toBe('https://h.modal.run/health')
    expect(urlSante('https://h.modal.run/analyze/')).toBe('https://h.modal.run/health')
    expect(urlSante('https://h.modal.run')).toBe('https://h.modal.run/health')
  })

  it('200 → ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })))
    await expect(sonderProxy('https://h.modal.run/analyze')).resolves.toBe('ok')
  })

  it('503 → ko', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })))
    await expect(sonderProxy('https://h.modal.run/analyze')).resolves.toBe('ko')
  })

  it('network error → ko', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')))
    await expect(sonderProxy('https://h.modal.run/analyze')).resolves.toBe('ko')
  })

  it('same-origin proxy or empty address → inconnue, with no network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(sonderProxy('/api/analyze')).resolves.toBe('inconnue')
    await expect(sonderProxy('')).resolves.toBe('inconnue')
    await expect(sonderProxy('/health')).resolves.toBe('inconnue')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an absolute address is probeable, including the default address injected at build', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(sonderProxy('https://proxy.exemple.run/analyze')).resolves.toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://proxy.exemple.run/health')
  })
})
describe('model availability probe (idea 5)', () => {
  it('puts live models first, without changing their relative order', () => {
    const ordre = reordonner({
      chaine: ['a', 'b', 'c', 'd'],
      disjoncteur: { b: 42, d: 7 },
    })
    expect(ordre).toEqual(['a', 'c', 'b', 'd'])
  })

  it('empty or absent chain → null (we keep the default chain)', () => {
    expect(reordonner({ chaine: [], disjoncteur: {} })).toBeNull()
    expect(reordonner({ chaine: ['a'], disjoncteur: null as unknown as Record<string, number> })).toEqual(['a'])
  })

  it('reads the proxy circuit breaker and returns the reordered chain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ chaine: ['m1', 'm2', 'm3'], disjoncteur: { m1: 30 } }), {
          status: 200,
        }),
      ),
    )
    await expect(sonderModeles('https://h.modal.run/analyze')).resolves.toEqual(['m2', 'm3', 'm1'])
  })

  it('unreachable or same-origin proxy → null, never an exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('ko')))
    await expect(sonderModeles('https://h.modal.run/analyze')).resolves.toBeNull()
    await expect(sonderModeles('/api/analyze')).resolves.toBeNull()
  })
})

describe('self-check (one proof per subsystem)', () => {
  it('the bank is judged complete only if all 12 types have 3 exercises', () => {
    const controle = controleBanque()
    expect(controle.ok).toBe(true)
    expect(controle.preuve).toContain('36 local exercises')
    expect(controle.preuve).toContain('0 network calls')
  })

  it('the taxonomy and wait budget are checked by facts', () => {
    expect(controleTaxonomie().ok).toBe(true)
    expect(controleTaxonomie().preuve).toContain('12 codes')
    expect(controleBudget().ok).toBe(true)
    expect(controleBudget().preuve).toMatch(/\d+ s per call/)
  })
})
