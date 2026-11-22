import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHAINE_MODELES } from '../src/domain/config'
import { ErreurLLM, completer, transportParDefaut } from '../src/pipeline/llm'

/**
 * Falling back along the model chain is what lets an analysis succeed on an
 * evening when 5 models out of 6 are out of capacity. These tests also lock a
 * real bug from 11 November: `throw` in an `async` function without `await`
 * threw a **Promise** — hence no fallback and no readable message ("Analysis
 * impossible").
 */

const transport = transportParDefaut('/api/test')
const requete = { system: 's', user: 'u' }

function reponse(statut: number, corps: unknown): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'content-type': 'application/json' },
  })
}

function enregistrerAppels(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map(([, init]) => JSON.parse((init as { body: string }).body).model as string)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('model chain fallback', () => {
  it('a 503 moves to the next model, which answers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reponse(503, { erreur: 'no available provider for A' }))
      .mockResolvedValueOnce(reponse(200, { texte: '{"annotations":[]}' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(completer(transport, requete)).resolves.toBe('{"annotations":[]}')
    const appels = enregistrerAppels(fetchMock)
    expect(appels).toHaveLength(2)
    expect(appels[0]).not.toBe(appels[1])
  })

  it('whole chain unavailable → ErreurLLM with the real upstream message', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => reponse(503, { erreur: 'no available provider (all offers exhausted)' }))
    vi.stubGlobal('fetch', fetchMock)

    const erreur = await completer(transport, requete).catch((e: unknown) => e)
    expect(erreur).toBeInstanceOf(ErreurLLM)
    expect(erreur).toBeInstanceOf(Error)
    expect((erreur as ErreurLLM).message).toContain('no available provider')
    expect(enregistrerAppels(fetchMock)).toHaveLength(CHAINE_MODELES.length)
  })

  it('proxy 429 (shared quota) → raises immediately with BYOK recourse', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => reponse(429, { erreur: 'Proxy quota reached for this hour.', quota: 'proxy' }))
    vi.stubGlobal('fetch', fetchMock)

    const erreur = await completer(transport, requete).catch((e: unknown) => e)
    expect(erreur).toBeInstanceOf(ErreurLLM)
    expect((erreur as ErreurLLM).message).toContain('Paste your own key')
    expect(enregistrerAppels(fetchMock)).toHaveLength(1)
  })

  it('provider 429 → pause, same model, then next model', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reponse(429, { erreur: 'Provider rate limit.' }))
      .mockResolvedValueOnce(reponse(429, { erreur: 'Provider rate limit.' }))
      .mockResolvedValueOnce(reponse(200, { texte: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(completer(transport, requete)).resolves.toBe('ok')
    const appels = enregistrerAppels(fetchMock)
    expect(appels).toHaveLength(3)
    expect(appels[0]).toBe(appels[1])
    expect(appels[2]).not.toBe(appels[0])
  }, 20_000)

  it('proxy exhausted its chain → one call, we do not replay ours', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        reponse(503, { erreur: 'no available provider', chaineEpuisee: true, tentatives: 6 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const erreur = await completer(transport, requete).catch((e: unknown) => e)
    expect(erreur).toBeInstanceOf(ErreurLLM)
    expect((erreur as ErreurLLM).chaineEpuisee).toBe(true)
    expect(enregistrerAppels(fetchMock)).toHaveLength(1)
  })

  it('the model that actually answered is reported to the transport', async () => {
    const vus: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => reponse(200, { texte: 'ok', modele: 'ag/gemini-4-carbon', tentatives: 2 })),
    )
    await completer({ ...transport, surModele: (modele) => vus.push(modele) }, requete)
    expect(vus).toEqual(['ag/gemini-4-carbon'])
  })

  it('streaming (SSE): progress is relayed and the final text returned', async () => {
    const flux = new ReadableStream({
      start(controleur) {
        controleur.enqueue(
          new TextEncoder().encode(
            'event: progres\ndata: {"modele":"ag/gemini-4-carbon","statut":503,"essai":1}\n\n',
          ),
        )
        controleur.enqueue(
          new TextEncoder().encode(
            'event: resultat\ndata: {"texte":"ok","modele":"ag/claude-sonnet-4-6","tentatives":2}\n\n',
          ),
        )
        controleur.close()
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(flux, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      ),
    )
    const progres: string[] = []
    const modeles: string[] = []
    const reponse = await completer(
      { ...transport, stream: true, surProgres: (m) => progres.push(m), surModele: (m) => modeles.push(m) },
      requete,
    )
    expect(reponse).toBe('ok')
    expect(progres.join(' ')).toContain('attempt 1')
    expect(modeles).toEqual(['ag/claude-sonnet-4-6'])
  })

  it('streaming: an error event comes back as an ErreurLLM', async () => {
    const flux = new ReadableStream({
      start(controleur) {
        controleur.enqueue(
          new TextEncoder().encode('event: erreur\ndata: {"erreur":"no model","statut":503}\n\n'),
        )
        controleur.close()
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(flux, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      ),
    )
    const erreur = await completer({ ...transport, stream: true }, requete).catch((e: unknown) => e)
    expect(erreur).toBeInstanceOf(ErreurLLM)
    expect((erreur as ErreurLLM).chaineEpuisee).toBe(true)
  })

  it('a proxy that does not speak SSE falls back to the JSON path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ texte: 'json', modele: 'ag/gemini-4-carbon' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    await expect(completer({ ...transport, stream: true }, requete)).resolves.toBe('json')
  })

  it('a non-transient error (400) raises immediately', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reponse(400, { erreur: 'invalid body' }))
    vi.stubGlobal('fetch', fetchMock)

    const erreur = await completer(transport, requete).catch((e: unknown) => e)
    expect((erreur as ErreurLLM).message).toContain('invalid body')
    expect(enregistrerAppels(fetchMock)).toHaveLength(1)
  })
})
